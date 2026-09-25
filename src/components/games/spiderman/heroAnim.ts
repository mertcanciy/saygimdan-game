import * as THREE from "three";
import type { BoneName, HeroRig } from "./heroModel";

/**
 * Hero animation: mocap clips (AnimationMixer) blended by a continuous state
 * machine, plus procedural layers on top for things no stock clip covers
 * (web-arm aiming, swinging legs, flips, skydive spread, dive).
 *
 *  - Base layer: every clip is always "playing"; we drive each action's time
 *    and weight ourselves. Target weights come from the movement state and the
 *    actual weights follow with critically-damped springs, so every change is
 *    a smooth crossfade (≈0.1–0.3 s), never a pop.
 *  - Locomotion is a 1-D blend space (idle/walk/jog/sprint) with a shared,
 *    foot-aligned phase advanced by distance travelled → no foot skating and
 *    no leg scissoring while blending.
 *  - Procedural layers aim bones at world-space directions in the body frame
 *    (rest-axis agnostic); their directions and weights are springs too.
 *  - Body orientation uses a two-stage (C1-continuous) slerp.
 * No allocations per frame.
 */

export const Mode = { Ground: 0, Swing: 1, Air: 2 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface AnimInput {
  mode: Mode;
  /** horizontal speed m/s */
  speed: number;
  /** vertical speed m/s */
  vy: number;
  /** downward speed at the last touchdown (m/s) — read on landing */
  impact: number;
  /** web anchor (world) while swinging */
  anchor: THREE.Vector3 | null;
  /** which hand holds the web: 0 = left, 1 = right */
  hand: 0 | 1;
  /** seconds since the web was fired */
  webT: number;
  /** 0 = behind anchor, 0.5 = bottom of arc, 1 = past it and rising */
  swingPhase: number;
  /** flip progress 0..1, or <0 when not flipping */
  flip: number;
  dive: boolean;
  /** desired body up / forward (world, unit) */
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** how fast the body turns towards up/fwd (1/s) */
  orientRate: number;
}

/* ---------- critically damped spring (Holden, "Spring-It-On") ---------- */
const LN2x4 = 4 * Math.LN2;
function springStep(x: Float32Array, v: Float32Array, i: number, target: number, halflife: number, dt: number) {
  const y = LN2x4 / (halflife + 1e-5) / 2;
  const j0 = x[i] - target;
  const j1 = v[i] + j0 * y;
  const e = Math.exp(-y * dt);
  x[i] = e * (j0 + j1 * dt) + target;
  v[i] = e * (v[i] - j1 * y * dt);
}

/** spring-damped direction (vec3 components), renormalised on read */
class DirSpring {
  x = new Float32Array(3);
  v = new Float32Array(3);
  init = false;
  step(t: THREE.Vector3, out: THREE.Vector3, halflife: number, dt: number) {
    if (!this.init) {
      this.x[0] = t.x;
      this.x[1] = t.y;
      this.x[2] = t.z;
      this.init = true;
    }
    springStep(this.x, this.v, 0, t.x, halflife, dt);
    springStep(this.x, this.v, 1, t.y, halflife, dt);
    springStep(this.x, this.v, 2, t.z, halflife, dt);
    out.set(this.x[0], this.x[1], this.x[2]);
    if (out.lengthSq() < 1e-6) out.copy(t);
    return out.normalize();
  }
}

/* ---------- clips ---------- */
const C = {
  idle: 0,
  walk: 1,
  jog: 2,
  sprint: 3,
  rise: 4,
  fall: 5,
  air: 6,
  land: 7,
  hardLand: 8,
  roll: 9,
} as const;
const NC = 10;
const CLIP_NAMES: Record<number, string> = {
  [C.idle]: "idle",
  [C.walk]: "walk",
  [C.jog]: "jog",
  [C.sprint]: "sprint",
  [C.rise]: "ninjaStart",
  [C.fall]: "jumpLoop",
  [C.air]: "ninjaAir",
  [C.land]: "jumpLand",
  [C.hardLand]: "ninjaLand",
  [C.roll]: "roll",
};
/** locomotion blend space: [speed m/s, clip, metres per full cycle] */
const LOCO: [number, number, number][] = [
  [0, C.idle, 1],
  [2.2, C.walk, 1.9],
  [6.5, C.jog, 4.2],
  [11.5, C.sprint, 6.2],
];
/** frozen sample time (fraction) for the "rise" pose */
const RISE_T = 0.42;

/* ---------- procedural layers ---------- */
const L = { swing: 0, flip: 1, spread: 2, dive: 3, aimL: 4, aimR: 5 } as const;
const NL = 6;

// scratch
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _qT = new THREE.Quaternion();
const _qW = new THREE.Quaternion();
const _qP = new THREE.Quaternion();
const _qD = new THREE.Quaternion();
const _qI = new THREE.Quaternion();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dir2 = new THREE.Vector3();
const U = new THREE.Vector3();
const F = new THREE.Vector3();
const S = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _prevFwd = new THREE.Vector3();

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Rotate `bone` (in world space) so its direction towards `child` becomes `dir`, blended by w. */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number) {
  if (w <= 0.002 || !bone.parent) return;
  bone.getWorldPosition(_p0);
  child.getWorldPosition(_p1);
  _cur.subVectors(_p1, _p0);
  const l = _cur.length();
  if (l < 1e-5) return;
  _cur.divideScalar(l);
  _qD.setFromUnitVectors(_cur, dir);
  _qI.identity().slerp(_qD, Math.min(1, w));
  bone.getWorldQuaternion(_qW).premultiply(_qI);
  bone.parent.getWorldQuaternion(_qP).invert();
  bone.quaternion.copy(_qP.multiply(_qW));
  bone.updateMatrixWorld(true);
}

const LIMBS = ["fuL", "flL", "fuR", "flR", "auL", "alL", "ahL", "auR", "alR", "ahR", "thL", "caL", "ftL", "thR", "caR", "ftR"] as const;
type LimbKey = (typeof LIMBS)[number];
const SWING_SPRINGS: LimbKey[] = ["fuL", "flL", "fuR", "flR", "thL", "caL", "ftL", "thR", "caR", "ftR"];
const AIM_L: LimbKey[] = ["auL", "alL", "ahL"];
const AIM_R: LimbKey[] = ["auR", "alR", "ahR"];

export class HeroAnimator {
  rig: HeroRig;
  private mixer: THREE.AnimationMixer;
  private actions: (THREE.AnimationAction | null)[] = [];
  private dur = new Float32Array(NC);
  /** per-clip phase offset so every loop starts on the same foot */
  private footOff = new Float32Array(NC);
  private w = new Float32Array(NC);
  private wv = new Float32Array(NC);
  private wt = new Float32Array(NC);
  private lw = new Float32Array(NL);
  private lwv = new Float32Array(NL);
  private lt = new Float32Array(NL);
  private phase = 0;
  private t = 0;
  private oneShot = -1;
  private oneShotT = 0;
  private prevMode: Mode = Mode.Ground;
  private q1 = new THREE.Quaternion();
  private qInit = false;
  private yawRate = 0;
  private lean = new Float32Array(2);
  private leanV = new Float32Array(2);
  private flipAngle = 0;
  private springs: Record<LimbKey, DirSpring>;
  private swingPhaseS = new Float32Array(1);
  private swingPhaseV = new Float32Array(1);
  /** world-space palm positions, valid after update() */
  palmWorld: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(rig: HeroRig) {
    this.rig = rig;
    this.mixer = new THREE.AnimationMixer(rig.model);
    for (let i = 0; i < NC; i++) {
      const clip = rig.clips.find((c) => c.name === CLIP_NAMES[i]);
      if (!clip) {
        this.actions.push(null);
        continue;
      }
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = 0; // we drive .time ourselves
      a.play();
      a.setEffectiveWeight(0);
      this.actions.push(a);
      this.dur[i] = clip.duration;
    }
    this.springs = {} as Record<LimbKey, DirSpring>;
    for (const k of LIMBS) this.springs[k] = new DirSpring();
    this.alignFeet();
    this.w[C.idle] = 1;
  }

  /** Find, per loop clip, the phase where the left foot is furthest forward. */
  private alignFeet() {
    const b = this.rig.bones;
    for (const [, ci] of LOCO) {
      const a = this.actions[ci];
      if (!a || ci === C.idle) continue;
      let best = -Infinity;
      let bestT = 0;
      for (let k = 0; k < 48; k++) {
        const tt = (k / 48) * this.dur[ci];
        for (const o of this.actions) o?.setEffectiveWeight(0);
        a.setEffectiveWeight(1);
        a.time = tt;
        this.mixer.update(0);
        this.rig.model.updateMatrixWorld(true);
        b.foot_l.getWorldPosition(_p0);
        b.foot_r.getWorldPosition(_p1);
        const d = _p0.z - _p1.z;
        if (d > best) {
          best = d;
          bestT = tt / this.dur[ci];
        }
      }
      this.footOff[ci] = bestT;
      a.setEffectiveWeight(0);
    }
  }

  private setLocoTargets(speed: number) {
    const s = Math.max(0, speed);
    let cycle = LOCO[0][2];
    for (let i = 0; i < LOCO.length; i++) {
      const [s0, c0, l0] = LOCO[i];
      const nx = LOCO[i + 1];
      if (!nx) {
        this.wt[c0] = 1;
        cycle = l0;
        break;
      }
      if (s < nx[0]) {
        const k = smooth(0, 1, (s - s0) / (nx[0] - s0));
        this.wt[c0] = 1 - k;
        this.wt[nx[1]] = k;
        cycle = i === 0 ? nx[2] : l0 + (nx[2] - l0) * k;
        break;
      }
    }
    return cycle;
  }

  update(dt: number, inp: AnimInput) {
    this.t += dt;
    const rig = this.rig;
    const b = rig.bones;
    this.wt.fill(0);
    this.lt.fill(0);

    /* ---------- landing one-shots ---------- */
    const landed = inp.mode === Mode.Ground && this.prevMode !== Mode.Ground;
    if (landed) {
      const imp = inp.impact;
      let clip = -1;
      if (imp > 22) clip = inp.speed > 9 ? C.roll : C.hardLand;
      else if (imp > 12) clip = inp.speed > 9 ? C.roll : C.land;
      else if (imp > 6 && inp.speed < 5) clip = C.land;
      if (clip >= 0 && this.actions[clip]) {
        this.oneShot = clip;
        this.oneShotT = clip === C.land ? 0.25 : clip === C.hardLand ? 0.08 : 0.05;
        // snap-in fast but still blended
        this.wv[clip] = 12;
      }
    }
    if (inp.mode !== Mode.Ground) this.oneShot = -1;
    this.prevMode = inp.mode;

    /* ---------- base layer targets ---------- */
    let cycle = 1;
    if (inp.mode === Mode.Ground) {
      cycle = this.setLocoTargets(inp.speed);
      if (this.oneShot >= 0) {
        const os = this.oneShot;
        const rate = os === C.roll ? 1.25 : os === C.hardLand ? 1.1 : 1.3;
        this.oneShotT += dt * rate;
        const d = this.dur[os];
        // leave early when the player starts moving again
        const moving = os !== C.roll && inp.speed > 3.5 && this.oneShotT > 0.35;
        const endT = d - 0.25;
        if (this.oneShotT >= endT || moving) this.oneShot = -1;
        else {
          const k = os === C.roll ? 1 : 1 - smooth(endT - 0.35, endT, this.oneShotT);
          for (let i = 0; i < NC; i++) this.wt[i] *= 1 - k;
          this.wt[os] = k;
        }
      }
    } else if (inp.mode === Mode.Swing) {
      this.wt[C.air] = 1;
      this.lt[L.swing] = 1;
    } else {
      const rise = smooth(-3, 6, inp.vy);
      this.wt[C.rise] = rise;
      this.wt[C.fall] = 1 - rise;
      if (inp.flip >= 0) this.lt[L.flip] = 1 - smooth(0.8, 1, inp.flip);
      else if (inp.dive) this.lt[L.dive] = 1;
      else this.lt[L.spread] = smooth(9, 22, -inp.vy);
    }
    // arm aim towards the anchor (web hand)
    if (inp.mode === Mode.Swing && inp.anchor) this.lt[inp.hand === 0 ? L.aimL : L.aimR] = 1;

    /* ---------- weights: critically damped, normalised ---------- */
    let sum = 0;
    for (let i = 0; i < NC; i++) {
      const hl = this.wt[i] > this.w[i] ? 0.07 : 0.1;
      springStep(this.w, this.wv, i, this.wt[i], hl, dt);
      if (this.w[i] < 0) {
        this.w[i] = 0;
        this.wv[i] = 0;
      }
      sum += this.w[i];
    }
    if (sum < 1e-4) {
      this.w[C.idle] = 1;
      sum = 1;
    }
    for (let i = 0; i < NL; i++) {
      const up = this.lt[i] > this.lw[i];
      const hl = i === L.aimL || i === L.aimR ? (up ? 0.045 : 0.14) : i === L.flip ? 0.05 : up ? 0.08 : 0.12;
      springStep(this.lw, this.lwv, i, this.lt[i], hl, dt);
      this.lw[i] = Math.min(1, Math.max(0, this.lw[i]));
    }

    /* ---------- clip times ---------- */
    // shared locomotion phase, advanced by distance travelled
    this.phase = (this.phase + (dt * Math.max(inp.speed, 0)) / cycle) % 1;
    for (let i = 0; i < NC; i++) {
      const a = this.actions[i];
      if (!a) continue;
      const wi = this.w[i] / sum;
      a.setEffectiveWeight(wi);
      if (wi <= 0) continue;
      const d = this.dur[i];
      if (i === C.walk || i === C.jog || i === C.sprint) a.time = ((this.phase + this.footOff[i]) % 1) * d;
      else if (i === C.rise) a.time = RISE_T * d;
      else if (i === this.oneShot) a.time = Math.min(this.oneShotT, d - 0.01);
      else if (i === C.land || i === C.hardLand || i === C.roll) {
        /* fading out after its one-shot: hold */
      } else a.time = this.t % d;
    }
    this.mixer.update(0);

    /* ---------- body orientation (two-stage slerp → C1 continuous) ---------- */
    // run lean: forward with speed, bank into turns
    const fwdLen = Math.hypot(inp.fwd.x, inp.fwd.z);
    if (inp.mode === Mode.Ground && fwdLen > 0.5) {
      const cross = _prevFwd.x * inp.fwd.z - _prevFwd.z * inp.fwd.x;
      const dotp = _prevFwd.x * inp.fwd.x + _prevFwd.z * inp.fwd.z;
      const yr = dt > 0 ? Math.atan2(cross, dotp) / dt : 0;
      this.yawRate += (yr - this.yawRate) * (1 - Math.exp(-10 * dt));
    } else this.yawRate *= Math.exp(-10 * dt);
    _prevFwd.copy(inp.fwd);
    const ground = inp.mode === Mode.Ground ? 1 : 0;
    const leanF = ground * Math.min(0.22, inp.speed * 0.012);
    const bank = ground * THREE.MathUtils.clamp(-this.yawRate * inp.speed * 0.025, -0.35, 0.35);
    springStep(this.lean, this.leanV, 0, leanF, 0.15, dt);
    springStep(this.lean, this.leanV, 1, bank, 0.15, dt);

    _y.copy(inp.up).normalize();
    _z.copy(inp.fwd);
    _x.crossVectors(_y, _z);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
    _x.normalize();
    _z.crossVectors(_x, _y).normalize();
    _y.addScaledVector(_z, this.lean[0]).addScaledVector(_x, this.lean[1]).normalize();
    _x.crossVectors(_y, _z).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    _qT.setFromRotationMatrix(_m);
    if (!this.qInit) {
      this.q1.copy(_qT);
      rig.root.quaternion.copy(_qT);
      this.qInit = true;
    }
    const r = 1 - Math.exp(-inp.orientRate * 1.6 * dt);
    this.q1.slerp(_qT, r);
    rig.root.quaternion.slerp(this.q1, r);

    // flip about the body's side axis (ease in-out, full turn)
    if (inp.flip >= 0) {
      const f = inp.flip;
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      this.flipAngle = e * Math.PI * 2;
    } else this.flipAngle = 0;
    rig.flip.quaternion.setFromAxisAngle(_x.set(1, 0, 0), this.flipAngle);
    rig.root.updateMatrixWorld(true);

    /* ---------- procedural layers ---------- */
    rig.flip.getWorldQuaternion(_qW);
    U.set(0, 1, 0).applyQuaternion(_qW);
    F.set(0, 0, 1).applyQuaternion(_qW);
    S.set(1, 0, 0).applyQuaternion(_qW); // character's left
    const sp = this.springs;
    const hl = 0.07;

    // skydive spread (face-down fall)
    const wsp = this.lw[L.spread] * (1 - this.lw[L.swing]);
    if (wsp > 0.01) {
      const wob = Math.sin(this.t * 7) * 0.08;
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1;
        const ua = side === 0 ? b.upperarm_l : b.upperarm_r;
        const la = side === 0 ? b.lowerarm_l : b.lowerarm_r;
        const ha = side === 0 ? b.hand_l : b.hand_r;
        _dir.copy(S).multiplyScalar(0.85 * sg).addScaledVector(U, 0.3 + wob).addScaledVector(F, -0.15);
        aim(ua, la, _dir.normalize(), wsp);
        _dir.copy(S).multiplyScalar(0.5 * sg).addScaledVector(U, 0.65).addScaledVector(F, 0.2);
        aim(la, ha, _dir.normalize(), wsp);
        const th = side === 0 ? b.thigh_l : b.thigh_r;
        const ca = side === 0 ? b.calf_l : b.calf_r;
        const ft = side === 0 ? b.foot_l : b.foot_r;
        _dir.copy(U).multiplyScalar(-0.95).addScaledVector(S, 0.28 * sg).addScaledVector(F, -wob);
        aim(th, ca, _dir.normalize(), wsp);
        _dir.copy(U).multiplyScalar(-0.55).addScaledVector(F, -0.8).addScaledVector(S, 0.1 * sg);
        aim(ca, ft, _dir.normalize(), wsp * 0.9);
      }
    }

    // dive: arms swept back, legs together
    const wdv = this.lw[L.dive];
    if (wdv > 0.01) {
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1;
        _dir.copy(U).multiplyScalar(-0.9).addScaledVector(S, 0.3 * sg).addScaledVector(F, -0.25);
        aim(side === 0 ? b.upperarm_l : b.upperarm_r, side === 0 ? b.lowerarm_l : b.lowerarm_r, _dir.normalize(), wdv);
        _dir.copy(U).multiplyScalar(-0.95).addScaledVector(S, 0.12 * sg).addScaledVector(F, -0.2);
        aim(side === 0 ? b.lowerarm_l : b.lowerarm_r, side === 0 ? b.hand_l : b.hand_r, _dir.normalize(), wdv);
        _dir.copy(U).multiplyScalar(-1).addScaledVector(S, 0.05 * sg).addScaledVector(F, -0.12);
        aim(side === 0 ? b.thigh_l : b.thigh_r, side === 0 ? b.calf_l : b.calf_r, _dir.normalize(), wdv);
        _dir.copy(U).multiplyScalar(-1).addScaledVector(F, -0.3);
        aim(side === 0 ? b.calf_l : b.calf_r, side === 0 ? b.foot_l : b.foot_r, _dir.normalize(), wdv);
      }
    }

    // swing: free arm out for balance, legs trail then tuck through the bottom of the arc
    const wsw = this.lw[L.swing];
    springStep(this.swingPhaseS, this.swingPhaseV, 0, inp.swingPhase, 0.12, dt);
    if (wsw <= 0.01) for (const k of SWING_SPRINGS) sp[k].init = false;
    else {
      const ph = this.swingPhaseS[0];
      const tuck = smooth(0.35, 0.85, ph);
      const freeLeft = inp.hand === 1;
      const fs = freeLeft ? 1 : -1;
      // free arm
      _dir.copy(S).multiplyScalar(0.8 * fs).addScaledVector(U, -0.2 - 0.25 * tuck).addScaledVector(F, -0.3 + 0.2 * tuck);
      aim(
        freeLeft ? b.upperarm_l : b.upperarm_r,
        freeLeft ? b.lowerarm_l : b.lowerarm_r,
        (freeLeft ? sp.fuL : sp.fuR).step(_dir.normalize(), _tmp, hl, dt),
        wsw
      );
      _dir.copy(S).multiplyScalar(0.3 * fs).addScaledVector(F, 0.45).addScaledVector(U, -0.45);
      aim(
        freeLeft ? b.lowerarm_l : b.lowerarm_r,
        freeLeft ? b.hand_l : b.hand_r,
        (freeLeft ? sp.flL : sp.flR).step(_dir.normalize(), _tmp, hl, dt),
        wsw
      );
      // legs: the leg on the free-arm side leads the tuck
      for (let side = 0; side < 2; side++) {
        const left = side === 0;
        const sg = left ? 1 : -1;
        const lead = left === freeLeft;
        const k = lead ? tuck : tuck * 0.6;
        _dir.copy(U).multiplyScalar(-0.95 + 0.55 * k).addScaledVector(F, -0.28 + 1.05 * k).addScaledVector(S, 0.1 * sg);
        aim(left ? b.thigh_l : b.thigh_r, left ? b.calf_l : b.calf_r, (left ? sp.thL : sp.thR).step(_dir.normalize(), _tmp, hl, dt), wsw);
        _dir.copy(U).multiplyScalar(-1).addScaledVector(F, -0.35 - 0.55 * k);
        aim(left ? b.calf_l : b.calf_r, left ? b.foot_l : b.foot_r, (left ? sp.caL : sp.caR).step(_dir.normalize(), _tmp, hl, dt), wsw);
        _dir.copy(U).multiplyScalar(-0.75).addScaledVector(F, -0.65 + 0.5 * k);
        aim(left ? b.foot_l : b.foot_r, left ? b.ball_l : b.ball_r, (left ? sp.ftL : sp.ftR).step(_dir.normalize(), _tmp, hl, dt), wsw * 0.7);
      }
    }

    // web arm: straight line from the shoulder to the anchor, with a short
    // bent-arm anticipation right after firing
    for (let h = 0; h < 2; h++) {
      const wa = this.lw[h === 0 ? L.aimL : L.aimR];
      if (wa <= 0.01 || !inp.anchor) {
        for (const k of h === 0 ? AIM_L : AIM_R) sp[k].init = false;
        continue;
      }
      const ua = h === 0 ? b.upperarm_l : b.upperarm_r;
      const la = h === 0 ? b.lowerarm_l : b.lowerarm_r;
      const ha = h === 0 ? b.hand_l : b.hand_r;
      const fi = h === 0 ? b.middle_01_l : b.middle_01_r;
      ua.getWorldPosition(_p0);
      _dir.copy(inp.anchor).sub(_p0).normalize();
      const ext = inp.mode === Mode.Swing ? smooth(0.0, 0.16, inp.webT) : 1;
      // anticipation: elbow bent, forearm pointing up the rope
      _dir2.copy(_dir).multiplyScalar(0.6).addScaledVector(F, 0.35).addScaledVector(U, -0.25).normalize();
      _dir2.lerp(_dir, 0.3 + 0.7 * ext).normalize();
      aim(ua, la, (h === 0 ? sp.auL : sp.auR).step(_dir2, _tmp, 0.04, dt), wa);
      aim(la, ha, (h === 0 ? sp.alL : sp.alR).step(_dir, _tmp, 0.04, dt), wa);
      aim(ha, fi, (h === 0 ? sp.ahL : sp.ahR).step(_dir, _tmp, 0.05, dt), wa * 0.8);
    }

    // flip: tight tuck
    const wfl = this.lw[L.flip];
    if (wfl > 0.01) {
      for (let side = 0; side < 2; side++) {
        const left = side === 0;
        const sg = left ? 1 : -1;
        _dir.copy(F).multiplyScalar(0.9).addScaledVector(U, 0.3).addScaledVector(S, 0.12 * sg);
        aim(left ? b.thigh_l : b.thigh_r, left ? b.calf_l : b.calf_r, _dir.normalize(), wfl);
        _dir.copy(U).multiplyScalar(-0.95).addScaledVector(F, 0.15);
        aim(left ? b.calf_l : b.calf_r, left ? b.foot_l : b.foot_r, _dir.normalize(), wfl);
        _dir.copy(F).multiplyScalar(0.75).addScaledVector(U, -0.35).addScaledVector(S, 0.25 * sg);
        aim(left ? b.upperarm_l : b.upperarm_r, left ? b.lowerarm_l : b.lowerarm_r, _dir.normalize(), wfl);
        _dir.copy(U).multiplyScalar(-0.5).addScaledVector(S, -0.6 * sg).addScaledVector(F, 0.3);
        aim(left ? b.lowerarm_l : b.lowerarm_r, left ? b.hand_l : b.hand_r, _dir.normalize(), wfl);
      }
    }

    b.middle_01_l.getWorldPosition(this.palmWorld[0]);
    b.middle_01_r.getWorldPosition(this.palmWorld[1]);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig.model);
  }
}

export type { BoneName };

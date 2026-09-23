import * as THREE from "three";
import type { HeroRig } from "./heroModel";

/**
 * Procedural pose animator for the hero rig. Each frame a target pose is
 * built from the current movement state, then every joint is damped towards
 * it (critically-damped-ish exponential smoothing) so all transitions blend.
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
  /** web anchor (world) while swinging */
  anchor: THREE.Vector3 | null;
  /** which hand holds the web: 0 = left, 1 = right */
  hand: 0 | 1;
  /** 0 = behind anchor, 0.5 = bottom of arc, 1 = past it and rising */
  swingPhase: number;
  /** flip progress 0..1, or <0 when not flipping */
  flip: number;
  /** superhero-landing weight 0..1 */
  land: number;
  dive: boolean;
  /** desired body up / forward (world, unit) */
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** how fast the body turns towards up/fwd (1/s) */
  orientRate: number;
}

const J = {
  pelvis: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  shL: 5,
  shR: 6,
  elL: 7,
  elR: 8,
  wrL: 9,
  wrR: 10,
  hipL: 11,
  hipR: 12,
  knL: 13,
  knR: 14,
  anL: 15,
  anR: 16,
} as const;
const NJ = 17;

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _y = new THREE.Vector3();
const _qT = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qE = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export class HeroAnimator {
  rig: HeroRig;
  private joints: THREE.Object3D[];
  private cur = new Float32Array(NJ * 3);
  private tgt = new Float32Array(NJ * 3);
  private rate = new Float32Array(NJ);
  private pelvisY = 0;
  private pelvisYT = 0;
  private runPhase = 0;
  private t = 0;
  private aimW = [0, 0];
  private flipAngle = 0;
  /** world-space palm positions, valid after update() */
  palmWorld: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(rig: HeroRig) {
    this.rig = rig;
    this.joints = [
      rig.pelvis,
      rig.spine,
      rig.chest,
      rig.neck,
      rig.head,
      rig.shoulder[0],
      rig.shoulder[1],
      rig.elbow[0],
      rig.elbow[1],
      rig.wrist[0],
      rig.wrist[1],
      rig.hip[0],
      rig.hip[1],
      rig.knee[0],
      rig.knee[1],
      rig.ankle[0],
      rig.ankle[1],
    ];
  }

  private s(j: number, x: number, y: number, z: number) {
    this.tgt[j * 3] = x;
    this.tgt[j * 3 + 1] = y;
    this.tgt[j * 3 + 2] = z;
  }

  /** set a left/right pair; z (abduction) and y (twist) are mirrored */
  private pair(jL: number, x: number, y: number, z: number, xR = x) {
    this.s(jL, x, y, z);
    this.s(jL + 1, xR, -y, -z);
  }

  private setRate(r: number) {
    this.rate.fill(r);
  }

  private poseIdle() {
    const b = Math.sin(this.t * 1.7);
    this.s(J.pelvis, 0.02, 0, 0);
    this.s(J.spine, -0.02 + b * 0.012, 0, 0);
    this.s(J.chest, -0.05 - b * 0.02, 0, 0);
    this.s(J.neck, 0.06, 0, 0);
    this.s(J.head, -0.04, Math.sin(this.t * 0.37) * 0.25, 0);
    this.pair(J.shL, 0.06, 0, 0.16 + b * 0.015);
    this.pair(J.elL, -0.3, 0, 0);
    this.pair(J.wrL, 0.05, 0, 0.05);
    this.pair(J.hipL, -0.03, 0.08, 0.06);
    this.pair(J.knL, 0.06, 0, 0);
    this.pair(J.anL, -0.03, 0, -0.04);
    this.pelvisYT = -0.01 + b * 0.004;
    this.setRate(8);
  }

  private poseRun(speed: number) {
    const k = Math.min(1, Math.max(0, (speed - 6) / 12));
    const p = this.runPhase;
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    const A = 0.55 + 0.35 * k;
    this.s(J.pelvis, 0.12 + 0.12 * k, 0.14 * sp, 0);
    this.s(J.spine, 0.04, 0, 0);
    this.s(J.chest, 0.02, -0.26 * sp, 0);
    this.s(J.neck, -0.08 - 0.06 * k, 0.1 * sp, 0);
    this.s(J.head, -0.06, 0, 0);
    // arms opposite to legs
    this.s(J.shL, A * 0.95 * sp + 0.05, 0, 0.14);
    this.s(J.shR, -A * 0.95 * sp + 0.05, 0, -0.14);
    this.s(J.elL, -1.25 - 0.25 * Math.max(0, -sp), 0, 0);
    this.s(J.elR, -1.25 - 0.25 * Math.max(0, sp), 0, 0);
    this.pair(J.wrL, 0, 0, 0);
    this.s(J.hipL, -A * sp - 0.18, 0, 0.03);
    this.s(J.hipR, A * sp - 0.18, 0, -0.03);
    const kneeAmp = 1.0 + 0.55 * k;
    this.s(J.knL, 0.2 + kneeAmp * smooth(-0.2, 1, Math.cos(p - 0.5)), 0, 0);
    this.s(J.knR, 0.2 + kneeAmp * smooth(-0.2, 1, Math.cos(p + Math.PI - 0.5)), 0, 0);
    this.s(J.anL, 0.1 + 0.3 * sp, 0, 0);
    this.s(J.anR, 0.1 - 0.3 * sp, 0, 0);
    this.pelvisYT = -0.05 - 0.03 * k + 0.045 * Math.abs(cp);
    this.setRate(22);
  }

  private poseSwing(hand: 0 | 1, phase: number) {
    // mirror sign: web hand on the right → free (left) arm balances outward
    const m = hand === 1 ? 1 : -1;
    const tuck = smooth(0.45, 0.9, phase);
    const trail = 1 - smooth(0.1, 0.5, phase);
    this.s(J.pelvis, -0.05, 0, 0);
    this.s(J.spine, -0.12 + tuck * 0.25, 0, -0.06 * m);
    this.s(J.chest, -0.12 + tuck * 0.15, 0.1 * m, -0.1 * m);
    this.s(J.neck, -0.2, 0, 0.05 * m);
    this.s(J.head, -0.15, -0.1 * m, 0);
    // free arm (the aim arm gets overridden after)
    const free = hand === 1 ? J.shL : J.shR;
    const fs = hand === 1 ? 1 : -1;
    this.s(free, -0.4 - tuck * 0.5, 0, fs * (0.75 - tuck * 0.2));
    this.s(free + 2, -1.0 - tuck * 0.4, 0, 0); // elbow
    const aim = hand === 1 ? J.shR : J.shL;
    this.s(aim, -2.8, 0, -fs * 0.2);
    this.s(aim + 2, -0.12, 0, 0);
    this.pair(J.wrL, 0.1, 0, 0);
    // legs: trail behind at the start, tuck up past the bottom (PS4 look)
    const lead = hand === 1 ? J.hipL : J.hipR; // leg on the free-arm side tucks more
    const other = lead === J.hipL ? J.hipR : J.hipL;
    this.s(lead, -0.25 - 1.25 * tuck + 0.3 * trail, 0, (lead === J.hipL ? 1 : -1) * 0.12);
    this.s(other, -0.05 - 0.75 * tuck + 0.35 * trail, 0, (other === J.hipL ? 1 : -1) * 0.08);
    this.s(lead + 2, 0.45 + 1.7 * tuck, 0, 0);
    this.s(other + 2, 0.25 + 0.9 * tuck + 0.3 * trail, 0, 0);
    this.pair(J.anL, 0.55, 0, 0);
    this.pelvisYT = 0;
    this.setRate(9);
  }

  private poseFlip() {
    this.s(J.pelvis, 0, 0, 0);
    this.s(J.spine, 0.35, 0, 0);
    this.s(J.chest, 0.3, 0, 0);
    this.s(J.neck, 0.35, 0, 0);
    this.s(J.head, 0.1, 0, 0);
    this.pair(J.shL, -1.0, 0, 0.35);
    this.pair(J.elL, -1.7, 0, 0);
    this.pair(J.wrL, 0.3, 0, 0);
    this.pair(J.hipL, -1.6, 0, 0.15);
    this.pair(J.knL, 2.25, 0, 0);
    this.pair(J.anL, 0.5, 0, 0);
    this.pelvisYT = 0;
    this.setRate(16);
  }

  private poseFall(vy: number) {
    // body is pitched face-down by the orientation; spread like a skydiver
    const w = Math.sin(this.t * 9) * 0.05;
    this.s(J.pelvis, 0, 0, 0);
    this.s(J.spine, -0.2, 0, 0);
    this.s(J.chest, -0.18, 0, 0);
    this.s(J.neck, -0.55, 0, 0);
    this.s(J.head, -0.25, 0, 0);
    const lift = Math.min(1, Math.max(0, -vy / 30));
    this.pair(J.shL, -0.25 - 0.3 * lift, 0, 1.25 + w);
    this.pair(J.elL, -0.45, 0, 0);
    this.pair(J.wrL, -0.2, 0, 0);
    this.pair(J.hipL, 0.1, 0, 0.2 - w);
    this.pair(J.knL, 0.75, 0, 0, 0.55);
    this.pair(J.anL, 0.45, 0, 0);
    this.pelvisYT = 0;
    this.setRate(7);
  }

  private poseRise() {
    // launched upward after a release: one arm up, legs split
    this.s(J.pelvis, 0, 0, 0);
    this.s(J.spine, -0.1, 0, 0);
    this.s(J.chest, -0.15, 0.1, 0);
    this.s(J.neck, -0.15, 0, 0);
    this.s(J.head, -0.1, 0, 0);
    this.s(J.shR, -2.6, 0, -0.25);
    this.s(J.elR, -0.3, 0, 0);
    this.s(J.shL, 0.45, 0, 0.5);
    this.s(J.elL, -0.6, 0, 0);
    this.pair(J.wrL, 0, 0, 0);
    this.s(J.hipL, -0.7, 0, 0.1);
    this.s(J.knL, 1.3, 0, 0);
    this.s(J.hipR, 0.25, 0, -0.08);
    this.s(J.knR, 0.45, 0, 0);
    this.pair(J.anL, 0.5, 0, 0);
    this.pelvisYT = 0;
    this.setRate(8);
  }

  private poseDive() {
    this.s(J.pelvis, 0, 0, 0);
    this.s(J.spine, -0.1, 0, 0);
    this.s(J.chest, -0.1, 0, 0);
    this.s(J.neck, -0.6, 0, 0);
    this.s(J.head, -0.3, 0, 0);
    this.pair(J.shL, 0.35, 0, 0.3);
    this.pair(J.elL, -0.15, 0, 0);
    this.pair(J.wrL, 0.2, 0, 0);
    this.pair(J.hipL, 0.05, 0, 0.03);
    this.pair(J.knL, 0.15, 0, 0);
    this.pair(J.anL, 0.6, 0, 0);
    this.pelvisYT = 0;
    this.setRate(6);
  }

  private blendLand(w: number) {
    if (w <= 0.001) return;
    const L = (j: number, x: number, y: number, z: number) => {
      const i = j * 3;
      this.tgt[i] += (x - this.tgt[i]) * w;
      this.tgt[i + 1] += (y - this.tgt[i + 1]) * w;
      this.tgt[i + 2] += (z - this.tgt[i + 2]) * w;
    };
    L(J.pelvis, 0.5, 0, 0);
    L(J.spine, 0.3, 0, 0);
    L(J.chest, 0.1, 0.15, 0);
    L(J.neck, -0.55, 0, 0);
    L(J.head, -0.25, 0, 0);
    // superhero landing: left hand to the ground, right arm swept back
    L(J.shL, -1.15, 0, 0.18);
    L(J.elL, -0.15, 0, 0);
    L(J.shR, 0.55, 0, -1.05);
    L(J.elR, -0.35, 0, 0);
    L(J.hipL, -1.45, 0, 0.3);
    L(J.hipR, -0.55, 0, -0.35);
    L(J.knL, 2.05, 0, 0);
    L(J.knR, 2.2, 0, 0);
    L(J.anL, -0.75, 0, 0);
    L(J.anR, 0.4, 0, 0);
    this.pelvisYT += (-0.42 - this.pelvisYT) * w;
    for (let j = 0; j < NJ; j++) this.rate[j] = Math.max(this.rate[j], 30 * w);
  }

  update(dt: number, inp: AnimInput) {
    this.t += dt;
    const rig = this.rig;

    if (inp.mode === Mode.Ground) {
      if (inp.speed > 1.2) {
        const stride = 1.2 + inp.speed * 0.09;
        this.runPhase = (this.runPhase + (dt * inp.speed * Math.PI * 2) / (stride * 2)) % (Math.PI * 2);
        this.poseRun(inp.speed);
      } else this.poseIdle();
    } else if (inp.mode === Mode.Swing) {
      this.poseSwing(inp.hand, inp.swingPhase);
    } else if (inp.flip >= 0) {
      this.poseFlip();
    } else if (inp.dive) {
      this.poseDive();
    } else if (inp.vy > 4) {
      this.poseRise();
    } else {
      this.poseFall(inp.vy);
    }
    this.blendLand(inp.land);

    // damp joints
    for (let j = 0; j < NJ; j++) {
      const a = 1 - Math.exp(-this.rate[j] * dt);
      const i = j * 3;
      this.cur[i] += (this.tgt[i] - this.cur[i]) * a;
      this.cur[i + 1] += (this.tgt[i + 1] - this.cur[i + 1]) * a;
      this.cur[i + 2] += (this.tgt[i + 2] - this.cur[i + 2]) * a;
      this.joints[j].rotation.set(this.cur[i], this.cur[i + 1], this.cur[i + 2]);
    }
    this.pelvisY += (this.pelvisYT - this.pelvisY) * (1 - Math.exp(-(inp.land > 0.1 ? 30 : 12) * dt));
    rig.pelvis.position.y = this.pelvisY;

    // flip spin around the body's side axis
    if (inp.flip >= 0) {
      const e = inp.flip < 0.5 ? 2 * inp.flip * inp.flip : 1 - Math.pow(-2 * inp.flip + 2, 2) / 2;
      this.flipAngle = e * Math.PI * 2;
    } else {
      this.flipAngle = 0;
    }
    rig.pelvis.rotation.x += this.flipAngle;

    // body orientation (root)
    _y.copy(inp.up).normalize();
    _x.crossVectors(_y, inp.fwd);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
    _x.normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    _qT.setFromRotationMatrix(_m);
    rig.root.quaternion.slerp(_qT, 1 - Math.exp(-inp.orientRate * dt));

    // aim the web arm at the anchor
    for (let h = 0; h < 2; h++) {
      const want = inp.mode === Mode.Swing && inp.anchor && inp.hand === h ? 1 : 0;
      this.aimW[h] += (want - this.aimW[h]) * (1 - Math.exp(-(want ? 18 : 6) * dt));
    }
    if (this.aimW[0] > 0.01 || this.aimW[1] > 0.01) {
      rig.root.updateMatrixWorld(true);
      for (let h = 0; h < 2; h++) {
        const w = this.aimW[h];
        if (w <= 0.01 || !inp.anchor) continue;
        const sh = rig.shoulder[h];
        sh.getWorldPosition(_p);
        _dir.copy(inp.anchor).sub(_p).normalize();
        rig.chest.getWorldQuaternion(_qC).invert();
        _dir.applyQuaternion(_qC);
        _qA.setFromUnitVectors(DOWN, _dir);
        _qE.copy(sh.quaternion);
        sh.quaternion.copy(_qE).slerp(_qA, w);
      }
    }
    rig.root.updateMatrixWorld(true);
    rig.palm[0].getWorldPosition(this.palmWorld[0]);
    rig.palm[1].getWorldPosition(this.palmWorld[1]);
  }
}

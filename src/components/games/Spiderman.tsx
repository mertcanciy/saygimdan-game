"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import City from "./shared/City";
import { WorldAtmosphere, WorldEffects, CANVAS_GL } from "./shared/World";
import { generateCity, aabbCollide, raycastBuildings, groundHeightAt, mulberry32, type CityData } from "./shared/cityGen";
import { useKeys, makeEdge } from "./shared/useKeys";
import { usePointerLook } from "./shared/usePointerLook";
import Rings, { type RingData } from "./shared/Rings";
import Particles, { type ParticleHandle } from "./shared/Particles";
import { HudStat, HudCenter, HudBanner, HudHint } from "./shared/GameHud";
import { getGame } from "@/lib/games";
import { buildHero, PELVIS_HEIGHT, type HeroRig } from "./spiderman/heroModel";
import { HeroAnimator, Mode, type AnimInput } from "./spiderman/heroAnim";
import { WebRibbon } from "./spiderman/webLine";

const ACCENT = getGame("spiderman")!.accent;
const GRAV = 25;
const SUB = 1 / 120;
const MAX_SPEED = 64;
const RING_COUNT = 40;
/** centre of mass above the feet */
const COM_H = PELVIS_HEIGHT;
const RUN = 10;
const SPRINT = 16;

// scratch objects (no per-frame allocation)
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _com = new THREE.Vector3();
const _hv = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _bodyUp = new THREE.Vector3();
const _bodyFwd = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _best = new THREE.Vector3();

interface Hud {
  speed: number;
  height: number;
  locked: boolean;
  attached: boolean;
  rings: number;
  score: number;
  combo: number;
  bannerId: number;
  bannerText: string;
}

/* ---------- spawn + rings along streets ---------- */

/** Road intersection near the south edge, looking north down a long avenue. */
function spawnPoint(city: CityData) {
  const zs = city.roads.filter((r) => r.axis === "z").map((r) => r.pos);
  const xs = city.roads.filter((r) => r.axis === "x").map((r) => r.pos);
  // avenue closest to the centre (x) × second-to-last cross street (z)
  const x = zs.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a), zs[0]);
  const sorted = [...xs].sort((a, b) => a - b);
  const z = sorted[sorted.length - 2];
  return { x, z, yaw: 0 }; // yaw 0 → looking towards -Z
}

function makeRings(city: CityData): RingData[] {
  const rand = mulberry32(21);
  const out: RingData[] = [];
  const sp = spawnPoint(city);
  const lo = city.bounds.min + 40;
  const hi = city.bounds.max - 40;
  // interior roads only (edge roads have buildings on one side only)
  const roads = city.roads.filter((r) => r.pos > lo && r.pos < hi);
  // first a guided line straight up the starting avenue, then scattered streets
  for (let i = 0; i < 6 && out.length < RING_COUNT; i++) {
    out.push({ x: sp.x + (rand() - 0.5) * 3, y: 15 + i * 2.5 + rand() * 5, z: sp.z - 60 - i * 70, rotY: 0, collected: false });
  }
  let guard = 0;
  while (out.length < RING_COUNT && guard++ < 500) {
    const r = roads[Math.floor(rand() * roads.length)];
    const start = lo + rand() * (hi - lo - 200);
    const n = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < n && out.length < RING_COUNT; k++) {
      const t = start + k * (65 + rand() * 25);
      if (t > hi) break;
      const x = r.axis === "x" ? t : r.pos + (rand() - 0.5) * 4;
      const z = r.axis === "x" ? r.pos + (rand() - 0.5) * 4 : t;
      // keep rings apart
      if (out.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 35 * 35)) continue;
      out.push({ x, y: 14 + rand() * 20, z, rotY: r.axis === "x" ? Math.PI / 2 : 0, collected: false });
    }
  }
  return out;
}

/* ---------- speed lines: faint streaks in the peripheral view ---------- */
const SL_COUNT = 40;
const _lineObj = new THREE.Object3D();

/** camera-space streak positions (module scope: mutated every frame, never re-rendered) */
const SL_DATA = (() => {
  const rnd = mulberry32(99);
  const a = new Float32Array(SL_COUNT * 3);
  for (let i = 0; i < SL_COUNT; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = 2.4 + rnd() * 3.2;
    a[i * 3] = Math.cos(ang) * r;
    a[i * 3 + 1] = Math.sin(ang) * r * 0.7;
    a[i * 3 + 2] = -2 - rnd() * 22;
  }
  return a;
})();

function SpeedLines({ speedRef }: { speedRef: React.RefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useFrame(({ camera }, dt) => {
    const data = SL_DATA;
    const im = mesh.current;
    if (!im) return;
    const sp = speedRef.current;
    const k = Math.min(1, Math.max(0, (sp - 30) / 28));
    const mat = im.material as THREE.MeshBasicMaterial;
    mat.opacity = k * 0.22;
    im.visible = k > 0.01;
    if (!im.visible) return;
    const stretch = 1.5 + k * 4;
    _lineObj.quaternion.copy(camera.quaternion);
    for (let i = 0; i < SL_COUNT; i++) {
      let z = data[i * 3 + 2] + sp * dt * 0.9;
      if (z > -1.5) z -= 22;
      data[i * 3 + 2] = z;
      _tmp.set(data[i * 3], data[i * 3 + 1], z).applyQuaternion(camera.quaternion);
      _lineObj.position.copy(camera.position).add(_tmp);
      _lineObj.scale.set(0.012, 0.012, stretch);
      _lineObj.updateMatrix();
      im.setMatrixAt(i, _lineObj.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SL_COUNT]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#e8f1ff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}

/* ---------- scene ---------- */
interface Gfx {
  rig: HeroRig;
  anim: HeroAnimator;
  web: WebRibbon;
  animIn: AnimInput;
}

function makeAnimInput(): AnimInput {
  return {
    mode: Mode.Ground,
    speed: 0,
    vy: 0,
    anchor: null,
    hand: 1,
    swingPhase: 0.5,
    flip: -1,
    land: 0,
    dive: false,
    up: new THREE.Vector3(0, 1, 0),
    fwd: new THREE.Vector3(0, 0, -1),
    orientRate: 10,
  };
}

function SpidermanScene({ started, onHud }: { started: boolean; onHud: (h: Hud) => void }) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 10,
        blockSize: 46,
        roadWidth: 16,
        seed: 7,
        maxHeight: 150,
        towerChance: 0.28,
      }),
    []
  );
  const spawn = useMemo(() => spawnPoint(city), [city]);
  const ringsRef = useRef<RingData[]>([]);
  useEffect(() => {
    ringsRef.current = makeRings(city);
  }, [city]);

  const keys = useKeys();
  const edge = useMemo(() => makeEdge(), []);
  const { yaw, pitch, locked, mouseDown } = usePointerLook(0.0022, 1.2);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // three.js objects live in a ref (built once on mount, mutated every frame)
  const holder = useRef<THREE.Group>(null);
  const gfx = useRef<Gfx | null>(null);
  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const rig = buildHero();
    const g: Gfx = { rig, anim: new HeroAnimator(rig), web: new WebRibbon(), animIn: makeAnimInput() };
    parent.add(rig.root, g.web.mesh);
    gfx.current = g;
    return () => {
      parent.remove(rig.root, g.web.mesh);
      rig.dispose();
      g.web.dispose();
      gfx.current = null;
    };
  }, []);

  const particles = useRef<ParticleHandle>(null);
  const dust = useRef<ParticleHandle>(null);
  const speedRef = useRef(0);
  const focus = useRef<THREE.Vector3>(new THREE.Vector3());

  const st = useRef({
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    web: null as { anchor: THREE.Vector3; len: number; maxLen: number; t: number; hand: 0 | 1 } | null,
    holding: false,
    onGround: true,
    airTime: 0,
    fallSpeed: 0,
    swings: 0,
    combo: 0,
    score: 0,
    ringsGot: 0,
    bannerId: 0,
    bannerText: "",
    bannerT: 0,
    acc: 0,
    hudT: 0,
    camInit: false,
    camYaw: spawn.yaw,
    camPitch: -0.12,
    camRoll: 0,
    yawOffset: 0,
    wasLocked: false,
    lastHud: null as Hud | null,
    facing: Math.PI, // hero yaw (atan2(x,z)); π → facing -Z
    flipT: -1,
    releases: 0,
    landT: 0,
    lastHand: 1 as 0 | 1,
    camSmooth: new THREE.Vector3(spawn.x, COM_H, spawn.z),
    time: 0,
    camColl: 99,
    /** dev/test only: fixed camera distance / yaw offset (0 = off) */
    dbgDist: 0,
    dbgYaw: 0,
  });

  // dev-only debug handle for headless tests
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __spider?: unknown }).__spider = { st: st.current, city };
    }
  }, [city]);


  /** Pick an anchor on a building face above and ahead (PS4-style). */
  const findAnchor = (out: THREE.Vector3): boolean => {
    const s = st.current;
    _origin.copy(s.pos).setY(s.pos.y + COM_H);
    // heading: camera look direction, biased towards current travel when fast
    const hv = Math.hypot(s.vel.x, s.vel.z);
    let heading = s.camYaw;
    if (hv > 8) {
      const velYaw = Math.atan2(-s.vel.x, -s.vel.z);
      let diff = velYaw - heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      heading += diff * 0.35;
    }
    const hx = -Math.sin(heading);
    const hz = -Math.cos(heading);
    let bestScore = -Infinity;
    for (let e = 0; e < 5; e++) {
      const elev = 0.5 + e * 0.2; // 29°..74°
      const ce = Math.cos(elev);
      const se = Math.sin(elev);
      for (let yi = -4; yi <= 4; yi++) {
        const yo = yi * 0.2;
        const yv = heading + yo;
        _d.set(-Math.sin(yv) * ce, se, -Math.cos(yv) * ce);
        const hit = raycastBuildings(_origin, _d, 130, city.buildings);
        if (!hit) continue;
        const ay = Math.min(hit.point.y, hit.building.h - 0.2);
        const rise = ay - _origin.y;
        if (rise < 7) continue;
        const dx = hit.point.x - _origin.x;
        const dz = hit.point.z - _origin.z;
        const horiz = Math.hypot(dx, dz) + 1e-3;
        const ahead = (dx * hx + dz * hz) / horiz;
        if (ahead < 0.25) continue;
        const ropeLen = Math.hypot(horiz, rise);
        const score =
          ahead * 26 + Math.min(rise, 42) * 0.55 - Math.abs(horiz - 24) * 0.45 - Math.max(0, ropeLen - 70) * 0.8 -
          Math.abs(yo) * 4;
        if (score > bestScore) {
          bestScore = score;
          _best.set(hit.point.x, ay, hit.point.z);
        }
      }
    }
    if (bestScore > -Infinity) {
      out.copy(_best);
      return true;
    }
    // no building in reach (open sky / high above roofs): forgiving sky anchor
    if (s.pos.y > 150) return false;
    out.set(_origin.x + hx * 24, _origin.y + 30, _origin.z + hz * 24);
    return true;
  };

  const attachWeb = () => {
    const s = st.current;
    const anchor = new THREE.Vector3();
    if (!findAnchor(anchor)) return;
    _com.copy(s.pos).setY(s.pos.y + COM_H);
    const dist = _com.distanceTo(anchor);
    // lowest point of the arc stays ≥ 3 m above the street
    const maxLen = Math.max(8, Math.min(dist, anchor.y - 6 - COM_H));
    // pick the hand on the anchor's side
    _right.set(-Math.cos(s.facing), 0, Math.sin(s.facing));
    _d.copy(anchor).sub(_com);
    const hand: 0 | 1 = _d.dot(_right) > 0 ? 1 : 0;
    s.web = { anchor, len: dist, maxLen, t: 0, hand };
    s.lastHand = hand;
    s.holding = true;
    s.flipT = -1;
    // launch off the ground so the pendulum engages
    if (s.onGround) {
      _fwd.set(-Math.sin(s.camYaw), 0, -Math.cos(s.camYaw));
      s.vel.y = Math.max(s.vel.y, 13);
      s.vel.addScaledVector(_fwd, 9);
      s.onGround = false;
    } else if (s.vel.length() < 14) {
      // slow in the air: a small tug towards the anchor
      _d.normalize();
      s.vel.addScaledVector(_d, 6);
    }
    s.swings++;
  };

  const releaseWeb = () => {
    const s = st.current;
    const w = s.web;
    if (!w) return;
    s.web = null;
    s.holding = false;
    const sp = s.vel.length();
    if (sp > 10) {
      // PS4-style release boost: forward along travel + up
      _d.copy(s.vel).setY(0);
      if (_d.lengthSq() > 1) s.vel.addScaledVector(_d.normalize(), 3.5);
      s.vel.y += 6;
      s.releases++;
      // flip on a strong upward release (every other one to keep it fresh)
      if (s.vel.y > 9 && s.releases % 2 === 1) s.flipT = 0;
    }
    // strand puff at the hand
    const g = gfx.current;
    if (g) particles.current?.emit(g.anim.palmWorld[w.hand], _tmp2.set(0, 0.5, 0), { life: 0.3, size: 0.5, color: "#ffffff", grow: 1.5 });
  };

  const reset = () => {
    const s = st.current;
    s.pos.set(spawn.x, 0, spawn.z);
    s.vel.set(0, 0, 0);
    s.web = null;
    s.holding = false;
    s.combo = 0;
    s.flipT = -1;
    s.camYaw = spawn.yaw;
    s.facing = Math.PI;
    s.camInit = false;
    if (lockedRef.current) s.yawOffset = s.camYaw - yaw.current;
  };

  const banner = (text: string) => {
    const s = st.current;
    s.bannerId++;
    s.bannerText = text;
    s.bannerT = 1.2;
  };

  function step(h: number, k: Set<string>) {
    const s = st.current;
    _fwd.set(-Math.sin(s.camYaw), 0, -Math.cos(s.camYaw));
    _right.copy(_fwd).cross(_up);
    _wish.set(0, 0, 0);
    if (k.has("KeyW") || k.has("ArrowUp")) _wish.add(_fwd);
    if (k.has("KeyS") || k.has("ArrowDown")) _wish.sub(_fwd);
    if (k.has("KeyD") || k.has("ArrowRight")) _wish.add(_right);
    if (k.has("KeyA") || k.has("ArrowLeft")) _wish.sub(_right);
    if (_wish.lengthSq() > 0) _wish.normalize();
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");

    const gy = groundHeightAt(s.pos.x, s.pos.z, s.pos.y, city.buildings);
    const grounded = !s.web && s.pos.y <= gy + 0.03 && s.vel.y <= 0.5;
    const w = s.web;

    if (grounded) {
      const target = _tmp.copy(_wish).multiplyScalar(sprint ? SPRINT : RUN);
      const a = 1 - Math.exp(-14 * h);
      s.vel.x += (target.x - s.vel.x) * a;
      s.vel.z += (target.z - s.vel.z) * a;
      s.vel.y = 0;
      if (!s.onGround) {
        // touchdown
        const impact = s.fallSpeed;
        if (impact > 13) {
          s.landT = Math.min(1, 0.45 + impact / 45);
          s.vel.x *= 0.35;
          s.vel.z *= 0.35;
          for (let i = 0; i < 16; i++) {
            const a2 = (i / 16) * Math.PI * 2;
            _tmp2.set(Math.cos(a2) * 5, 0.6 + Math.random(), Math.sin(a2) * 5);
            dust.current?.emit(_tmp.copy(s.pos).setY(s.pos.y + 0.15), _tmp2, {
              life: 0.9,
              size: 1.3,
              color: "#b9b4ab",
              grow: 2.2,
            });
          }
        }
        s.combo = 0;
        s.flipT = -1;
      }
      s.onGround = true;
      s.airTime = 0;
      s.pos.addScaledVector(s.vel, h);
    } else {
      s.onGround = false;
      s.airTime += h;
      s.vel.y -= GRAV * h;
      if (s.pos.y > 170) s.vel.y -= (s.pos.y - 170) * 2 * h; // soft ceiling
      // quadratic air drag
      const sp = s.vel.length();
      s.vel.multiplyScalar(1 - Math.min(0.5, 0.0016 * sp * h));

      if (w && s.holding) {
        w.t += h;
        _com.copy(s.pos).setY(s.pos.y + COM_H);
        _d.copy(_com).sub(w.anchor);
        const dl = _d.length();
        _n.copy(_d).divideScalar(dl || 1); // radial (anchor → hero)
        // tangential pump along travel keeps the swing alive
        _tmp.copy(s.vel).addScaledVector(_n, -s.vel.dot(_n));
        const tl = _tmp.length();
        if (tl > 0.5 && sp < 46) s.vel.addScaledVector(_tmp.divideScalar(tl), 7.5 * h);
        // steer: camera forward (+W/A/S/D), projected on the tangent plane
        _tmp2.copy(_fwd).multiplyScalar(6).addScaledVector(_wish, 7);
        _tmp2.addScaledVector(_n, -_tmp2.dot(_n));
        s.vel.addScaledVector(_tmp2, h);
        // reel the rope in towards the safe length (lifts you off the street)
        if (w.len > w.maxLen) w.len = Math.max(w.maxLen, w.len - 26 * h);
        s.pos.addScaledVector(s.vel, h);
        // inextensible rope
        _com.copy(s.pos).setY(s.pos.y + COM_H);
        _d.copy(_com).sub(w.anchor);
        const L = _d.length();
        if (L > w.len) {
          _d.divideScalar(L);
          _com.copy(w.anchor).addScaledVector(_d, w.len);
          s.pos.set(_com.x, _com.y - COM_H, _com.z);
          const vr = s.vel.dot(_d);
          if (vr > 0) s.vel.addScaledVector(_d, -vr);
        }
        // swung above the anchor → auto release (keeps the flow going)
        if (_com.y > w.anchor.y - 1.5 && w.t > 0.4) releaseWeb();
      } else {
        // air control
        s.vel.addScaledVector(_wish, 8 * h);
        if (sprint) {
          // dive: trade height for speed
          s.vel.y -= 20 * h;
          _d.copy(s.vel).setY(0);
          if (_d.lengthSq() > 1) s.vel.addScaledVector(_d.normalize(), 7 * h);
        }
        s.pos.addScaledVector(s.vel, h);
      }
      s.fallSpeed = Math.max(0, -s.vel.y);
    }
    if (s.vel.length() > MAX_SPEED) s.vel.setLength(MAX_SPEED);

    // walls (volumes spanning the hero's height)
    const col = aabbCollide(s.pos.x, s.pos.z, 0.42, city.buildings, s.pos.y + 0.05);
    if (col) {
      s.pos.x += col.x;
      s.pos.z += col.z;
      if (col.x !== 0) s.vel.x *= -0.05;
      if (col.z !== 0) s.vel.z *= -0.05;
    }
    // ground / roofs
    const g2 = groundHeightAt(s.pos.x, s.pos.z, s.pos.y, city.buildings);
    if (s.pos.y < g2) {
      s.pos.y = g2;
      if (s.vel.y < 0) s.vel.y = 0;
    }
    if (s.pos.y < 0) {
      s.pos.y = 0;
      s.vel.y = Math.max(0, s.vel.y);
    }
    const b = city.bounds.max + 40;
    s.pos.x = THREE.MathUtils.clamp(s.pos.x, -b, b);
    s.pos.z = THREE.MathUtils.clamp(s.pos.z, -b, b);

    // rings (tested at the chest)
    const rings = ringsRef.current;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (r.collected) continue;
      const dx = s.pos.x - r.x;
      const dy = s.pos.y + COM_H - r.y;
      const dz = s.pos.z - r.z;
      if (dx * dx + dy * dy + dz * dz < 5.4 * 5.4) {
        r.collected = true;
        s.ringsGot++;
        s.combo = s.onGround ? 1 : s.combo + 1;
        const pts = 100 * s.combo;
        s.score += pts;
        banner(s.combo > 1 ? `+${pts} · ×${s.combo} kombo` : `+${pts}`);
        for (let p = 0; p < 18; p++) {
          _tmp2.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
          particles.current?.emit(_tmp.set(r.x, r.y, r.z), _tmp2, { life: 0.7, size: 1.1, color: "#7dd3fc", grow: 1 });
        }
      }
    }
  }

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    s.time += dt;
    const k = keys.current;

    // ---- camera yaw: mouse when locked, otherwise auto-follow travel ----
    const hvel = Math.hypot(s.vel.x, s.vel.z);
    if (lockedRef.current) {
      if (!s.wasLocked) s.yawOffset = s.camYaw - yaw.current;
      s.camYaw = yaw.current + s.yawOffset;
    } else if (hvel > 3 && !s.onGround) {
      const target = Math.atan2(-s.vel.x, -s.vel.z);
      let diff = target - s.camYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.camYaw += diff * Math.min(1, 2.2 * dt);
    } else if (hvel > 3) {
      // on foot without mouse: A/D turn the view gently
      const turn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
      s.camYaw += turn * 1.4 * dt;
    }
    s.wasLocked = lockedRef.current;

    // ---- input ----
    const wantWeb = k.has("Space") || k.has("KeyE") || mouseDown.current;
    if (started) {
      if (wantWeb && !s.holding) attachWeb();
      if (!wantWeb && s.holding) releaseWeb();
      if (edge(k, "KeyR")) reset();
    }
    if (s.bannerT > 0) s.bannerT -= dt;

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB, k);
        s.acc -= SUB;
      }
    }
    if (s.flipT >= 0) {
      s.flipT += dt / 0.8;
      if (s.flipT >= 1) s.flipT = -1;
    }
    if (s.landT > 0) s.landT = Math.max(0, s.landT - dt * 1.6);

    // ---- hero pose ----
    const g = gfx.current;
    if (!g) return;
    const { rig, anim, web, animIn } = g;
    const hv = Math.hypot(s.vel.x, s.vel.z);
    if (hv > 0.6) s.facing = Math.atan2(s.vel.x, s.vel.z);
    _hv.set(Math.sin(s.facing), 0, Math.cos(s.facing));
    const w = s.web;
    animIn.speed = hv;
    animIn.vy = s.vel.y;
    animIn.anchor = w ? w.anchor : null;
    animIn.hand = w ? w.hand : s.lastHand;
    animIn.flip = s.flipT;
    animIn.land = s.onGround ? s.landT : 0;
    animIn.dive = !s.onGround && !w && (k.has("ShiftLeft") || k.has("ShiftRight")) && s.vel.y < -4;
    if (s.onGround) {
      animIn.mode = Mode.Ground;
      _bodyUp.copy(_up);
      _bodyFwd.copy(_hv);
      animIn.orientRate = 14;
    } else if (w) {
      animIn.mode = Mode.Swing;
      _com.copy(s.pos).setY(s.pos.y + COM_H);
      _bodyUp.copy(w.anchor).sub(_com).normalize().lerp(_up, 0.15).normalize();
      _bodyFwd.copy(s.vel);
      if (_bodyFwd.lengthSq() < 1) _bodyFwd.copy(_hv);
      _bodyFwd.normalize();
      _d.copy(_com).sub(w.anchor).setY(0);
      const along = _d.dot(_hv);
      animIn.swingPhase = 0.5 + 0.5 * THREE.MathUtils.clamp(along / (0.6 * w.len), -1, 1);
      animIn.orientRate = 9;
    } else {
      animIn.mode = Mode.Air;
      let p: number;
      if (animIn.dive) p = Math.atan2(hv, s.vel.y);
      else if (s.vel.y > 4) p = 0.25;
      else p = THREE.MathUtils.clamp(-s.vel.y / 22, 0, 1) * 1.2;
      const c = Math.cos(p);
      const sn = Math.sin(p);
      _bodyUp.copy(_up).multiplyScalar(c).addScaledVector(_hv, sn);
      _bodyFwd.copy(_hv).multiplyScalar(c).addScaledVector(_up, -sn);
      animIn.orientRate = 5;
    }
    animIn.up.copy(_bodyUp);
    animIn.fwd.copy(_bodyFwd);
    rig.root.position.set(s.pos.x, s.pos.y + COM_H, s.pos.z);
    anim.update(dt, animIn);
    focus.current.copy(rig.root.position);

    // ---- web strand ----
    if (w) {
      web.mesh.visible = true;
      const extend = Math.min(1, w.t / 0.09 + (started ? 0 : 1));
      const slack = Math.max(0, 1 - w.t / 0.25);
      web.update(anim.palmWorld[w.hand], w.anchor, camera.position, extend, slack, s.time);
      if (w.t > 0.09 && w.t - dt <= 0.09) {
        // impact puff where the strand sticks
        particles.current?.emit(w.anchor, _tmp2.set(0, 0, 0), { life: 0.4, size: 1.4, color: "#ffffff", grow: 1.2 });
      }
    } else web.mesh.visible = false;

    // ---- camera ----
    const speed = s.vel.length();
    speedRef.current = speed;
    _com.copy(s.pos).setY(s.pos.y + COM_H);
    s.camSmooth.lerp(_com, 1 - Math.exp(-(s.onGround ? 16 : 11) * dt));
    // don't let the smoothed target trail too far behind at high speed
    _d.copy(s.camSmooth).sub(_com);
    if (_d.length() > 0.8) s.camSmooth.copy(_com).addScaledVector(_d.normalize(), 0.8);
    const targetPitch = lockedRef.current
      ? pitch.current
      : s.onGround
        ? -0.14
        : THREE.MathUtils.clamp(-0.16 + s.vel.y * 0.006, -0.45, 0.05);
    s.camPitch += (targetPitch - s.camPitch) * Math.min(1, (lockedRef.current ? 30 : 3) * dt);
    const dist = s.dbgDist || 3.7 + Math.min(1.0, speed / 45);
    const vYaw = s.camYaw + s.dbgYaw;
    _right.set(Math.cos(vYaw), 0, -Math.sin(vYaw));
    _camTarget.copy(s.camSmooth).addScaledVector(_up, 0.55).addScaledVector(_right, 0.45);
    const cp = Math.cos(s.camPitch);
    _camPos
      .set(Math.sin(vYaw) * cp, -Math.sin(s.camPitch), Math.cos(vYaw) * cp)
      .multiplyScalar(dist)
      .add(_camTarget);
    if (_camPos.y < 0.6) _camPos.y = 0.6;
    _d.copy(_camPos).sub(_camTarget);
    const cd = _d.length();
    _d.divideScalar(cd);
    // wall occlusion: pull in instantly, ease back out
    const hit = raycastBuildings(_camTarget, _d, cd, city.buildings);
    const want = hit ? Math.max(0.9, hit.dist - 0.4) : cd;
    if (!s.camInit || want < s.camColl) s.camColl = want;
    else s.camColl += (want - s.camColl) * Math.min(1, 4 * dt);
    s.camInit = true;
    camera.position.copy(_camTarget).addScaledVector(_d, Math.min(cd, s.camColl));
    cam.lookAt(_camTarget);
    // roll into the swing
    let rollT = 0;
    if (w) {
      _d.copy(w.anchor).sub(_com);
      rollT = THREE.MathUtils.clamp(-_d.dot(_right) / (w.len + 1), -1, 1) * 0.1;
    }
    s.camRoll += (rollT - s.camRoll) * Math.min(1, 3 * dt);
    cam.rotateZ(s.camRoll);
    const targetFov = 60 + Math.min(1, speed / 55) * 15;
    cam.fov += (targetFov - cam.fov) * Math.min(1, 4 * dt);
    cam.updateProjectionMatrix();

    // ---- HUD throttle ~10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh: Hud = {
        speed: Math.round(speed * 3.6),
        height: Math.round(s.pos.y),
        locked: lockedRef.current,
        attached: !!s.web,
        rings: s.ringsGot,
        score: s.score,
        combo: s.combo,
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
      };
      const o = s.lastHud;
      if (
        !o ||
        o.speed !== nh.speed ||
        o.height !== nh.height ||
        o.locked !== nh.locked ||
        o.attached !== nh.attached ||
        o.rings !== nh.rings ||
        o.score !== nh.score ||
        o.combo !== nh.combo ||
        o.bannerId !== nh.bannerId
      ) {
        s.lastHud = nh;
        onHud(nh);
      }
    }
  });

  return (
    <>
      <WorldAtmosphere preset="day" focus={focus} />
      <City city={city} night={0} />
      <group ref={holder} />
      <Rings rings={ringsRef} count={RING_COUNT} radius={4.2} tube={0.3} color="#38bdf8" />
      <Particles ref={particles} count={300} gravity={-2} drag={2} blending={THREE.AdditiveBlending} />
      <Particles ref={dust} count={160} gravity={0.6} drag={3} opacity={0.55} />
      <SpeedLines speedRef={speedRef} />
      <WorldEffects preset="day" />
    </>
  );
}

export default function Spiderman({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    height: 0,
    locked: false,
    attached: false,
    rings: 0,
    score: 0,
    combo: 0,
    bannerId: 0,
    bannerText: "",
  });
  return (
    <div className="absolute inset-0">
      <Canvas shadows="percentage" dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 60, near: 0.1, far: 3000 }}>
        <SpidermanScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Skor" value={`${hud.score}`} accent={ACCENT} sub={hud.combo > 1 ? `×${hud.combo} kombo` : undefined} />
        <HudStat label="Halka" value={`${hud.rings}/${RING_COUNT}`} accent="#0284c7" />
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent="#14141f" />
        <HudStat label="Yükseklik" value={`${hud.height} m`} accent="#6b6880" />
      </div>
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} accent="#0284c7" />}
      {started && !hud.locked && <HudCenter text="Tıkla: fare ile bak · Space / Sol tık basılı: ağ at" />}
      {started && hud.rings === RING_COUNT && (
        <HudBanner text="Tüm halkalar toplandı!" accent={ACCENT} sub={`Skor ${hud.score}`} />
      )}
      {started && !hud.attached && hud.height < 2 && hud.speed < 5 && (
        <HudHint text="Ağ atmak için Space'e basılı tut, bırakınca uçarsın · Shift ile dalış" />
      )}
    </div>
  );
}

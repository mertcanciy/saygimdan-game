"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import City from "./shared/City";
import { generateCity, aabbCollide, type Building } from "./shared/cityGen";
import { WorldAtmosphere, WorldEffects, CANVAS_GL, PRESETS } from "./shared/World";
import { useKeys, makeEdge } from "./shared/useKeys";
import { usePointerLook } from "./shared/usePointerLook";
import Rings, { type RingData, ringHit } from "./shared/Rings";
import Particles, { type ParticleHandle } from "./shared/Particles";
import { HudStat, HudCenter, HudBanner, HudModal, HudBar, HudHint, HudEdge } from "./shared/GameHud";
import Jet, { makeJetControls } from "./f16/Jet";
import Cockpit, { EYE, makeHudData } from "./f16/Cockpit";
import Explosion, { type ExplosionHandle } from "./f16/Explosion";
import { Ribbon } from "./f16/Ribbon";
import { WINGTIP, zs } from "./f16/jetGeometry";
import { getGame } from "@/lib/games";

const ACCENT = getGame("f16")!.accent;
const PRESET = "golden" as const;
const SUB = 1 / 120;
const RING_COUNT = 22;
const RING_R = 10;
const CRASH_RESET = 3.2;

/* scratch objects (no allocations in the frame loop) */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _p = new THREE.Vector3();
const _eul = new THREE.Euler();
const _dq = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.PI);
const _aimAxis = new THREE.Vector3();
const _local = new THREE.Vector3();
const _camM = new THREE.Matrix4();

/*
 * Mouse aim (War Thunder style): the mouse moves an aim direction in the world,
 * the camera looks along it and a small autopilot flies the jet towards it.
 * Tunables live here so the feel can be calibrated in one place.
 */
const AIM = {
  /** radians of aim per pixel of mouse movement */
  sensitivity: 0.0016,
  /** the aim can't wander further than this from the nose (rad) */
  maxOffNose: THREE.MathUtils.degToRad(70),
  /** max climb / dive angle of the aim (rad) */
  maxElevation: THREE.MathUtils.degToRad(80),
  /** roll: gain on the angle to put the target above the canopy */
  rollGain: 1.15,
  /** roll damping on the measured roll rate */
  rollDamp: 0.22,
  /** pitch: gain on the pitch error */
  pitchGain: 2.6,
  pitchDamp: 0.35,
  /** small errors are handled with rudder + wings level instead of banking */
  bankStart: THREE.MathUtils.degToRad(2.5),
  bankFull: THREE.MathUtils.degToRad(14),
  yawGain: 3.0,
};

/** Put a DOM reticle where `dir` (seen from the camera) lands on screen. */
function placeReticle(el: HTMLDivElement | null, cam: THREE.Camera, dir: THREE.Vector3, on: boolean) {
  if (!el) return;
  _p.copy(cam.position).addScaledVector(dir, 600).project(cam);
  const vis = on && _p.z < 1;
  el.style.opacity = vis ? "1" : "0";
  if (vis) el.style.transform = `translate(${((_p.x + 1) / 2) * 100}vw, ${((1 - _p.y) / 2) * 100}vh)`;
}

/* jet-local sample points used for collision (x, y, z) */
const PROBES: [number, number, number, number][] = [
  // x, y, z, radius
  [0, 0, 6.8, 0.8], // nose
  [4.7, -0.1, -4.0, 0.6], // port wingtip
  [-4.7, -0.1, -4.0, 0.6], // starboard wingtip
  [0, 3.1, -6.2, 0.6], // fin tip
  [0, -1.1, 2.0, 0.6], // intake belly
];

interface Hud {
  speed: number;
  alt: number;
  throttle: number;
  crashed: boolean;
  cockpit: boolean;
  score: number;
  rings: number;
  combo: number;
  lowPass: boolean;
  afterburner: boolean;
  bannerId: number;
  bannerText: string;
  stall: boolean;
  g: number;
  edge: boolean;
}

interface PhotoOpts {
  yaw: number;
  pitch: number;
  dist: number;
  ab: number;
  g: number;
  cockpit: boolean;
  x: number;
  y: number;
  z: number;
  hdg: number;
  bank: number;
  boom: number;
  speed: number;
  throttle: number;
}

/** Dev-only "photo mode" (?photo=1&yaw=..): parked camera orbit for screenshots. */
function readPhoto(): PhotoOpts | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (!q.has("photo")) return null;
  const n = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  return {
    yaw: n("yaw", 30),
    pitch: n("pitch", 12),
    dist: n("dist", 22),
    ab: n("ab", 0),
    g: n("g", 0),
    cockpit: q.get("cockpit") === "1",
    x: n("x", 0),
    y: n("y", 60),
    z: n("z", 0),
    hdg: n("hdg", 0),
    bank: n("bank", 0),
    boom: n("boom", 0),
    speed: n("speed", 120),
    throttle: n("throttle", 0.7),
  };
}

/** Rings along a rectangular loop of streets, at canyon altitude. */
function makeRingRoute(city: ReturnType<typeof generateCity>) {
  const half = city.size / 2;
  const cell = city.blockSize + city.roadWidth;
  const road = (i: number) => -half + city.roadWidth / 2 + i * cell;
  const a = road(3);
  const b = road(city.blocks - 3);
  const corners = [
    [a, a],
    [b, a],
    [b, b],
    [a, b],
  ];
  const side = b - a;
  const per = side * 4;
  const out: RingData[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const d = ((i + 0.5) / RING_COUNT) * per;
    const seg = Math.floor(d / side);
    const t = (d - seg * side) / side;
    const [x0, z0] = corners[seg];
    const [x1, z1] = corners[(seg + 1) % 4];
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const alongX = Math.abs(x1 - x0) > 1;
    const y = 30 + Math.sin(i * 1.3) * 12 + (i % 4 === 0 ? 10 : 0);
    out.push({ x, y, z, rotY: alongX ? Math.PI / 2 : 0, collected: false });
  }
  return { rings: out, start: new THREE.Vector3(a - 320, 85, a) };
}

/* ---------------------------------------------------------------- scene */
function F16Scene({
  started,
  onHud,
  reticle,
}: {
  started: boolean;
  onHud: (h: Hud) => void;
  reticle: React.RefObject<{ aim: HTMLDivElement | null; nose: HTMLDivElement | null }>;
}) {
  const photo = useMemo(() => readPhoto(), []);
  const city = useMemo(
    () =>
      generateCity({
        blocks: 16,
        blockSize: 70,
        roadWidth: 26,
        seed: 11,
        maxHeight: 175,
        towerChance: 0.2,
      }),
    []
  );
  const route = useMemo(() => makeRingRoute(city), [city]);
  const ringsRef = useRef<RingData[]>(route.rings);

  const keys = useKeys();
  const edge = useMemo(() => makeEdge(), []);
  const { yaw: lookYaw, pitch: lookPitch, locked } = usePointerLook(AIM.sensitivity, 1e6, true);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const jet = useRef<THREE.Group>(null);
  const controls = useRef(makeJetControls());
  const hudData = useRef(makeHudData());
  const focus = useRef(new THREE.Vector3());
  const boom = useRef<ExplosionHandle>(null);
  const sparks = useRef<ParticleHandle>(null);

  const ribbons = useMemo(
    () => ({
      tipL: new Ribbon(110, 1.5, 0.22, 0.9, "#f7f9ff", 0.85),
      tipR: new Ribbon(110, 1.5, 0.22, 0.9, "#f7f9ff", 0.85),
      lerxL: new Ribbon(40, 0.3, 0.8, 6, "#ffffff", 0.45),
      lerxR: new Ribbon(40, 0.3, 0.8, 6, "#ffffff", 0.45),
    }),
    []
  );
  const ribbonList = useMemo(() => [ribbons.tipL, ribbons.tipR, ribbons.lerxL, ribbons.lerxR], [ribbons]);
  const candRef = useRef<Building[]>([]);

  const startQ = useMemo(() => new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.PI / 2), []);
  const st = useRef({
    pos: route.start.clone(),
    q: startQ.clone(),
    camQ: startQ.clone(),
    speed: 95,
    throttle: 0.65,
    ab: 0,
    stickX: 0,
    stickY: 0,
    pitchRate: 0,
    g: 1,
    crashed: false,
    crashT: 0,
    cockpit: false,
    barrelT: 0,
    barrelDir: 1,
    score: 0,
    ringsGot: 0,
    combo: 0,
    lowPassT: 0,
    lowPassAcc: 0,
    bannerId: 0,
    bannerText: "",
    bannerT: 0,
    acc: 0,
    hudT: 0,
    hudCanvasT: 0,
    camInit: false,
    shake: 0,
    prox: 0,
    lastHud: "",
    stall: false,
    yawIn: 0,
    photoT: 0,
    photoBoomed: false,
    /** world-space direction the player wants to fly */
    aim: new THREE.Vector3(0, 0, 1).applyQuaternion(startQ),
    lastLookYaw: 0,
    lastLookPitch: 0,
    lastRollErr: 0,
    lastPitchErr: 0,
    keyboardFlying: false,
    locked: false,
    yawAuto: 0,
  });

  const banner = (text: string) => {
    const s = st.current;
    s.bannerId++;
    s.bannerText = text;
    s.bannerT = 1.3;
  };

  const clearTrails = () => {
    ribbons.tipL.clear();
    ribbons.tipR.clear();
    ribbons.lerxL.clear();
    ribbons.lerxR.clear();
  };

  const reset = () => {
    const s = st.current;
    s.pos.copy(route.start);
    s.q.copy(startQ);
    s.camQ.copy(startQ);
    s.speed = 95;
    s.throttle = 0.65;
    s.crashed = false;
    s.crashT = 0;
    s.combo = 0;
    s.camInit = false;
    s.barrelT = 0;
    s.aim.set(0, 0, 1).applyQuaternion(startQ);
    clearTrails();
  };

  const crash = () => {
    const s = st.current;
    if (s.crashed) return;
    s.crashed = true;
    s.crashT = 0;
    s.combo = 0;
    s.shake = 1.4;
    _fwd.set(0, 0, 1).applyQuaternion(s.q);
    _v.copy(_fwd).multiplyScalar(s.speed);
    boom.current?.trigger(s.pos, _v);
  };

  // dev-only handle for headless tests
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __f16?: unknown }).__f16 = st.current;
  }, []);

  // photo mode: place the jet (window.__f16photo lets a screenshot script re-pose it)
  const photoRef = useRef(photo);
  useEffect(() => {
    if (!photo) return;
    const place = () => {
      const p = photoRef.current!;
      const s = st.current;
      s.pos.set(p.x, p.y, p.z);
      s.q.setFromEuler(_eul.set(0, THREE.MathUtils.degToRad(p.hdg), 0, "YXZ"));
      s.q.multiply(_dq.setFromAxisAngle(_v.set(0, 0, 1), THREE.MathUtils.degToRad(p.bank)));
      s.speed = p.speed;
      s.throttle = p.throttle;
      s.ab = p.ab;
      s.cockpit = p.cockpit;
      s.crashed = false;
      s.photoT = 0;
      s.photoBoomed = false;
      clearTrails();
    };
    place();
    (window as unknown as { __f16photo?: (o: Partial<PhotoOpts>) => void }).__f16photo = (o) => {
      Object.assign(photoRef.current!, o);
      place();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);


  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;
    const cand = candRef.current;
    const active = started || !!photo;

    if (started && !photo) {
      if (edge(k, "KeyC")) s.cockpit = !s.cockpit;
      if (edge(k, "KeyR")) reset();
      if (edge(k, "Space") && !s.crashed && s.barrelT <= 0) {
        s.barrelT = 1.0;
        s.barrelDir = s.stickX < 0 ? -1 : 1;
      }
    }
    if (s.bannerT > 0) s.bannerT -= dt;
    s.shake = Math.max(0, s.shake - dt * 1.2);
    if (s.crashed) {
      s.crashT += dt;
      if (s.crashT > CRASH_RESET && !photo) reset();
    }

    // ---- mouse aim: turn the aim direction by this frame's mouse movement ----
    {
      const dYaw = lookYaw.current - s.lastLookYaw;
      const dPitch = lookPitch.current - s.lastLookPitch;
      s.lastLookYaw = lookYaw.current;
      s.lastLookPitch = lookPitch.current;
      s.locked = lockedRef.current;
      _fwd.set(0, 0, 1).applyQuaternion(s.q);
      if (s.locked && !s.crashed && !s.keyboardFlying) {
        s.aim.applyAxisAngle(WORLD_UP, dYaw);
        _aimAxis.crossVectors(s.aim, WORLD_UP);
        if (_aimAxis.lengthSq() > 1e-6) s.aim.applyAxisAngle(_aimAxis.normalize(), dPitch);
        // keep the aim within reach of the nose and away from straight up/down
        const off = s.aim.angleTo(_fwd);
        if (off > AIM.maxOffNose) {
          _v.copy(s.aim);
          s.aim.copy(_fwd).lerp(_v, AIM.maxOffNose / off).normalize();
        }
        const el = Math.asin(THREE.MathUtils.clamp(s.aim.y, -1, 1));
        if (Math.abs(el) > AIM.maxElevation) {
          const hz = Math.hypot(s.aim.x, s.aim.z) || 1;
          const c = Math.cos(AIM.maxElevation) / hz;
          s.aim.set(s.aim.x * c, Math.sign(el) * Math.sin(AIM.maxElevation), s.aim.z * c);
        }
      } else {
        // no mouse control (not captured / keyboard / crashed): aim follows the
        // nose, levelled out, so the jet settles into straight and level flight
        _v.set(_fwd.x, s.keyboardFlying ? _fwd.y : 0, _fwd.z);
        if (_v.lengthSq() < 1e-4) _v.copy(_fwd);
        s.aim.lerp(_v.normalize(), s.keyboardFlying ? 1 : Math.min(1, dt * 1.5)).normalize();
      }
    }

    // ---- broad phase: buildings near the jet (once per frame) ----
    cand.length = 0;
    {
      const px = s.pos.x;
      const pz = s.pos.z;
      const py = s.pos.y;
      const bl = city.buildings;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.h < py - 40 || b.y0 > py + 40) continue;
        if (Math.abs(b.x - px) > b.w / 2 + 80 || Math.abs(b.z - pz) > b.d / 2 + 80) continue;
        cand.push(b);
      }
    }

    const ph = photoRef.current;
    if (ph) {
      s.photoT += dt;
      _fwd.set(0, 0, 1).applyQuaternion(s.q);
      if (!s.crashed) s.pos.addScaledVector(_fwd, s.speed * dt);
      s.g = 1 + ph.g;
      if (ph.boom && s.photoT > ph.boom && !s.photoBoomed) {
        s.photoBoomed = true;
        crash();
      }
    } else if (started && !s.crashed) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
        if (s.crashed) break;
      }
    }

    const abHeld = (k.has("ShiftLeft") || k.has("ShiftRight")) && s.throttle > 0.5 && !s.crashed;
    if (!photo) s.ab += ((abHeld ? 1 : 0) - s.ab) * Math.min(1, dt * 6);

    // ---- jet transform + control surfaces ----
    const c = controls.current;
    c.roll = THREE.MathUtils.clamp(s.stickX + (s.barrelT > 0 ? s.barrelDir : 0), -1, 1);
    c.pitch = s.stickY;
    c.yaw = s.yawIn;
    c.throttle = s.throttle;
    c.ab = s.ab;
    c.cockpit = s.cockpit && !s.crashed;
    if (jet.current) {
      jet.current.position.copy(s.pos);
      jet.current.quaternion.copy(s.q);
      jet.current.visible = !s.crashed;
    }
    focus.current.copy(s.pos);

    _fwd.set(0, 0, 1).applyQuaternion(s.q);
    _up.set(0, 1, 0).applyQuaternion(s.q);
    _right.set(-1, 0, 0).applyQuaternion(s.q);

    // ---- proximity to buildings (camera shake, FOV) ----
    let near = 1e9;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      const dx = Math.max(0, Math.abs(s.pos.x - b.x) - b.w / 2);
      const dz = Math.max(0, Math.abs(s.pos.z - b.z) - b.d / 2);
      const dy = Math.max(0, s.pos.y - b.h, b.y0 - s.pos.y);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < near) near = d;
    }
    near = Math.min(near, s.pos.y * s.pos.y);
    const proxT = s.crashed ? 0 : 1 - THREE.MathUtils.clamp((Math.sqrt(near) - 6) / 34, 0, 1);
    s.prox += (proxT * Math.min(1, s.speed / 120) - s.prox) * Math.min(1, dt * 5);

    // ---- vortices + LERX vapour ----
    const trailOn = active && !s.crashed;
    const gK = THREE.MathUtils.smoothstep(s.g, 3.2, 7.5);
    const vap = THREE.MathUtils.smoothstep(s.g, 4.5, 8.5);
    if (trailOn && jet.current) {
      const m = jet.current.matrixWorld;
      jet.current.updateMatrixWorld();
      _p.set(WINGTIP.x, WINGTIP.y, zs(WINGTIP.s)).applyMatrix4(m);
      ribbons.tipL.push(_p, gK);
      _p.set(-WINGTIP.x, WINGTIP.y, zs(WINGTIP.s)).applyMatrix4(m);
      ribbons.tipR.push(_p, gK);
      _p.set(0.95, 0.15, zs(7.6)).applyMatrix4(m);
      ribbons.lerxL.push(_p, vap);
      _p.set(-0.95, 0.15, zs(7.6)).applyMatrix4(m);
      ribbons.lerxR.push(_p, vap);
    }

    // ---- camera ----
    const shakeAmt = s.shake * 1.2 + s.prox * 0.22 + s.ab * 0.03;
    if (ph && !s.cockpit) {
      const yaw = THREE.MathUtils.degToRad(ph.yaw);
      const pit = THREE.MathUtils.degToRad(ph.pitch);
      _v.set(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit)).multiplyScalar(ph.dist);
      if (s.crashed) {
        _v.multiplyScalar(4);
        cam.position.copy(s.pos).add(_v.set(_v.x, Math.abs(_v.y) + 20, _v.z));
      } else cam.position.copy(s.pos).add(_v.applyQuaternion(s.q));
      cam.up.copy(WORLD_UP);
      cam.lookAt(s.pos);
    } else if (s.crashed) {
      // hold position, watch the fireball, drift back a little
      _v.copy(cam.position).sub(s.pos);
      _v.y += dt * 6;
      cam.position.copy(s.pos).addScaledVector(_v, 1 + dt * 0.08);
      cam.up.lerp(WORLD_UP, Math.min(1, dt * 3));
      cam.lookAt(s.pos);
    } else if (s.cockpit) {
      cam.position.copy(EYE).applyQuaternion(s.q).add(s.pos);
      cam.quaternion.copy(s.q).multiply(Q_FLIP);
      const sh = shakeAmt * 0.012 + Math.max(0, s.g - 5) * 0.0006;
      cam.position.x += (Math.random() - 0.5) * sh;
      cam.position.y += (Math.random() - 0.5) * sh;
    } else {
      // the camera looks along the aim; the jet chases it through the frame
      _camM.lookAt(s.aim, _v.set(0, 0, 0), WORLD_UP);
      _dq.setFromRotationMatrix(_camM);
      if (!s.camInit) {
        s.camQ.copy(_dq);
      } else {
        s.camQ.slerp(_dq, Math.min(1, dt * 7));
      }
      _v.set(0, 3.9, -17.5 - s.ab * 2.5).applyQuaternion(s.camQ);
      _camPos.copy(s.pos).add(_v);
      // don't dip under the street
      _camPos.y = Math.max(_camPos.y, 1.5);
      _camPos.x += (Math.random() - 0.5) * shakeAmt;
      _camPos.y += (Math.random() - 0.5) * shakeAmt;
      _camPos.z += (Math.random() - 0.5) * shakeAmt;
      if (!s.camInit) {
        cam.position.copy(_camPos);
        s.camInit = true;
      } else {
        cam.position.lerp(_camPos, Math.min(1, dt * 12));
      }
      // partial roll follow
      // a little of the jet's bank leaks into the horizon for feel
      _v2.copy(WORLD_UP).lerp(_up, 0.22).normalize();
      cam.up.copy(_v2);
      _v.set(0, 0, 1).applyQuaternion(s.camQ);
      _look.copy(s.pos).addScaledVector(_v, 22).addScaledVector(WORLD_UP, 1.2);
      cam.lookAt(_look);
    }
    for (let i = 0; i < ribbonList.length; i++) ribbonList[i].update(dt, cam.position);

    // ---- screen reticles: where the mouse aims (circle) and where the nose points (cross) ----
    {
      const r = reticle.current;
      const showAim = started && !photo && !s.crashed && s.locked && !s.keyboardFlying;
      cam.updateMatrixWorld();
      placeReticle(r?.aim ?? null, cam, s.aim, showAim);
      placeReticle(r?.nose ?? null, cam, _fwd, started && !photo && !s.crashed && !s.cockpit);
    }

    const baseFov = s.cockpit && !s.crashed ? 68 : 60;
    const targetFov = baseFov + Math.min(s.speed, 220) * 0.045 + s.ab * 9 + s.prox * 5;
    cam.fov += (targetFov - cam.fov) * Math.min(1, 4 * dt);
    cam.near = 0.2;
    cam.far = 4500;
    cam.updateProjectionMatrix();

    // ---- in-cockpit HUD data (30 Hz is plenty) ----
    s.hudCanvasT += dt;
    if (s.cockpit && s.hudCanvasT > 1 / 30) {
      s.hudCanvasT = 0;
      const h = hudData.current;
      h.pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1)));
      // roll: angle of the right wing below the horizon
      h.roll = Math.atan2(-_right.y, _up.y);
      h.heading = (THREE.MathUtils.radToDeg(Math.atan2(_fwd.x, -_fwd.z)) + 360) % 360;
      h.speed = s.speed * 3.6;
      h.alt = s.pos.y;
      h.g = s.g;
      h.throttle = s.throttle;
      h.ab = s.ab > 0.5;
      h.mach = s.speed / 340;
      // nearest uncollected ring in front
      let best = 1e12;
      h.cueX = NaN;
      h.cueY = NaN;
      _qInv.copy(s.q).invert();
      for (const r of ringsRef.current) {
        if (r.collected) continue;
        _v.set(r.x - s.pos.x, r.y - s.pos.y, r.z - s.pos.z);
        const d2 = _v.lengthSq();
        if (_v.dot(_fwd) < 0 || d2 > best) continue;
        best = d2;
        _v.applyQuaternion(_qInv);
        h.cueX = THREE.MathUtils.radToDeg(Math.atan2(-_v.x, _v.z));
        h.cueY = THREE.MathUtils.radToDeg(Math.atan2(_v.y - EYE.y, _v.z));
      }
    }

    // ---- DOM HUD 10 Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh: Hud = {
        speed: Math.round(s.speed * 3.6),
        alt: Math.round(s.pos.y),
        throttle: Math.round(s.throttle * 100) / 100,
        crashed: s.crashed,
        cockpit: s.cockpit,
        score: s.score,
        rings: s.ringsGot,
        combo: s.combo,
        lowPass: s.lowPassT > 0.3,
        afterburner: s.ab > 0.5,
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
        stall: s.stall,
        g: Math.round(s.g * 10) / 10,
        // past the street grid: the jet is being turned back towards the city
        edge: Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z)) > city.bounds.max + 120,
      };
      const key = `${nh.speed}|${nh.alt}|${nh.throttle}|${nh.crashed}|${nh.cockpit}|${nh.score}|${nh.rings}|${nh.combo}|${nh.lowPass}|${nh.afterburner}|${nh.bannerId}|${nh.stall}|${nh.g}|${nh.edge}`;
      if (key !== s.lastHud) {
        s.lastHud = key;
        onHud(nh);
      }
    }

    function step(h: number) {
      const stt = st.current;
      if (k.has("KeyW")) stt.throttle = Math.min(1, stt.throttle + 0.45 * h);
      if (k.has("KeyS")) stt.throttle = Math.max(0, stt.throttle - 0.55 * h);
      const abNow = (k.has("ShiftLeft") || k.has("ShiftRight")) && stt.throttle > 0.5;

      // stick: arrow keys fly directly; otherwise the mouse-aim autopilot does
      let sx = 0;
      let sy = 0;
      if (k.has("ArrowLeft")) sx -= 1;
      if (k.has("ArrowRight")) sx += 1;
      if (k.has("ArrowUp")) sy += 1;
      if (k.has("ArrowDown")) sy -= 1;
      stt.keyboardFlying = sx !== 0 || sy !== 0;
      if (!stt.keyboardFlying) {
        _fwd.set(0, 0, 1).applyQuaternion(stt.q);
        _up.set(0, 1, 0).applyQuaternion(stt.q);
        _right.set(-1, 0, 0).applyQuaternion(stt.q);
        _qInv.copy(stt.q).invert();
        _local.copy(stt.aim).applyQuaternion(_qInv); // +z ahead, +y canopy, -x right
        const off = Math.acos(THREE.MathUtils.clamp(_local.z, -1, 1));
        const pitchErr = Math.atan2(_local.y, Math.max(0.05, _local.z));
        // roll so the target sits "above the canopy"; if it's mostly below, push instead
        let rollErr = Math.atan2(-_local.x, _local.y);
        if (_local.y < 0 && Math.abs(_local.x) < -_local.y * 0.6) rollErr = Math.atan2(-_local.x, -_local.y);
        const bank = Math.atan2(-_right.y, _up.y);
        const w = THREE.MathUtils.smoothstep(off, AIM.bankStart, AIM.bankFull);
        // near the target: wings level + rudder does the fine work
        const levelErr = -bank;
        const rollTarget = w * rollErr + (1 - w) * levelErr;
        const rollRate = (rollTarget - stt.lastRollErr) / h;
        stt.lastRollErr = rollTarget;
        const pitchRate = (pitchErr - stt.lastPitchErr) / h;
        stt.lastPitchErr = pitchErr;
        sx = AIM.rollGain * rollTarget + AIM.rollDamp * THREE.MathUtils.clamp(rollRate, -4, 4) * 0.1;
        sy = AIM.pitchGain * pitchErr + AIM.pitchDamp * THREE.MathUtils.clamp(pitchRate, -4, 4) * 0.1;
        // don't pull hard while still rolling towards a big lateral target
        sy *= 1 - 0.6 * w * THREE.MathUtils.smoothstep(Math.abs(rollErr), 0.5, 1.4);
        const yawErr = Math.atan2(-_local.x, Math.max(0.05, _local.z));
        stt.yawAuto = THREE.MathUtils.clamp(yawErr * AIM.yawGain * (1 - w), -1, 1);
      } else {
        stt.yawAuto = 0;
      }
      sx = THREE.MathUtils.clamp(sx, -1, 1);
      sy = THREE.MathUtils.clamp(sy, -1, 1);
      stt.stickX += (sx - stt.stickX) * Math.min(1, 9 * h);
      stt.stickY += (sy - stt.stickY) * Math.min(1, 9 * h);
      const yawIn = THREE.MathUtils.clamp((k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + stt.yawAuto, -1, 1);
      stt.yawIn += (yawIn - stt.yawIn) * Math.min(1, 8 * h);

      const authority = THREE.MathUtils.clamp(stt.speed / 70, 0.3, 1.1);
      let rollRight = stt.stickX * 3.3 * authority;
      let pitchUp = stt.stickY * 1.25 * authority;
      let yawRight = stt.yawIn * 0.55;

      _fwd.set(0, 0, 1).applyQuaternion(stt.q);
      _up.set(0, 1, 0).applyQuaternion(stt.q);
      _right.set(-1, 0, 0).applyQuaternion(stt.q);

      if (stt.barrelT > 0) {
        stt.barrelT -= h;
        rollRight = stt.barrelDir * ((Math.PI * 2) / 1.0);
        pitchUp += 0.35;
      } else if (stt.keyboardFlying && Math.abs(stt.stickX) < 0.05 && _up.y > 0) {
        // hands off: gently roll wings level
        rollRight += _right.y * 1.7;
      }
      // bank -> the nose comes around (lift vector tilted)
      yawRight += -_right.y * 0.85 * Math.min(1, stt.speed / 60) * Math.max(0, _up.y);

      stt.stall = stt.speed < 38;
      if (stt.stall) pitchUp -= (1 - stt.speed / 38) * 1.3;

      _eul.set(-pitchUp * h, -yawRight * h, rollRight * h, "XYZ");
      _dq.setFromEuler(_eul);
      stt.q.multiply(_dq).normalize();

      // g-load (arcade-scaled so a hard pull reads ~9 g)
      const gRaw = _up.y + (pitchUp * stt.speed) / 9.81 * 0.45;
      stt.g += (THREE.MathUtils.clamp(gRaw, -3, 9.9) - stt.g) * Math.min(1, 10 * h);

      // speed: thrust vs drag, gravity along the flight path, bleed in hard turns
      const targetSpeed = (32 + stt.throttle * 108) * (abNow ? 1.45 : 1);
      stt.speed += (targetSpeed - stt.speed) * Math.min(1, (abNow ? 0.9 : 0.45) * h);
      _fwd.set(0, 0, 1).applyQuaternion(stt.q);
      stt.speed -= 9.8 * _fwd.y * 0.6 * h;
      stt.speed -= Math.abs(pitchUp) * stt.speed * 0.035 * h;
      stt.speed = THREE.MathUtils.clamp(stt.speed, 15, 230);

      stt.pos.addScaledVector(_fwd, stt.speed * h);

      // soft world bounds: turn back toward the city
      const bnd = city.bounds.max + 260;
      if (Math.abs(stt.pos.x) > bnd || Math.abs(stt.pos.z) > bnd) {
        _v.set(-stt.pos.x, 0, -stt.pos.z).normalize();
        const cross = _fwd.z * _v.x - _fwd.x * _v.z;
        stt.q.premultiply(_dq.setFromAxisAngle(WORLD_UP, (cross > 0 ? 1 : -1) * 1.0 * h)).normalize();
        stt.pos.x = THREE.MathUtils.clamp(stt.pos.x, -bnd - 5, bnd + 5);
        stt.pos.z = THREE.MathUtils.clamp(stt.pos.z, -bnd - 5, bnd + 5);
      }
      if (stt.pos.y > 600) {
        stt.pos.y = 600;
        stt.q.multiply(_dq.setFromAxisAngle(_v.set(1, 0, 0), 0.5 * h)).normalize();
      }

      // ---- collisions: probes on the airframe vs building volumes / ground ----
      for (let i = 0; i < PROBES.length; i++) {
        const pr = PROBES[i];
        _p.set(pr[0], pr[1], pr[2]).applyQuaternion(stt.q).add(stt.pos);
        if (_p.y < 0.4) {
          stt.pos.y = Math.max(stt.pos.y, 1);
          crash();
          return;
        }
        if (aabbCollide(_p.x, _p.z, pr[3], cand, _p.y - 0.8)) {
          crash();
          return;
        }
      }

      // low pass bonus
      if (stt.pos.y < 28) {
        stt.lowPassT += h;
        stt.lowPassAcc += 18 * h * (abNow ? 1.5 : 1);
        if (stt.lowPassAcc >= 10) {
          stt.score += 10;
          stt.lowPassAcc -= 10;
        }
      } else {
        stt.lowPassT = 0;
      }

      // rings
      const rings = ringsRef.current;
      let allDone = rings.length > 0;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.collected) continue;
        allDone = false;
        if (ringHit(r, stt.pos.x, stt.pos.y, stt.pos.z, RING_R, stt.speed * h + 2.5)) {
          r.collected = true;
          stt.ringsGot++;
          stt.combo++;
          const pts = 100 * Math.min(10, stt.combo);
          stt.score += pts;
          banner(stt.combo > 1 ? `+${pts} · ×${stt.combo}` : `+${pts}`);
          _v.set(r.x, r.y, r.z);
          for (let p = 0; p < 24; p++) {
            _v2.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
            sparks.current?.emit(_v, _v2, { life: 0.7, size: 2.5, color: "#7dd3fc", grow: 1 });
          }
        }
      }
      if (allDone) {
        stt.score += 1000;
        banner("Tur tamam! +1000");
        for (const r of rings) r.collected = false;
      }
    }
  });

  const night = PRESETS[PRESET].night;
  return (
    <>
      <WorldAtmosphere preset={PRESET} focus={focus} shadowSize={250} />
      <City city={city} night={night} />
      <group ref={jet}>
        <Jet controls={controls} />
        <Cockpit data={hudData} active={controls} />
      </group>
      <primitive object={ribbons.tipL.mesh} />
      <primitive object={ribbons.tipR.mesh} />
      <primitive object={ribbons.lerxL.mesh} />
      <primitive object={ribbons.lerxR.mesh} />
      <Rings rings={ringsRef} count={RING_COUNT} radius={RING_R} tube={0.55} color="#38bdf8" />
      <Particles ref={sparks} count={300} gravity={0} drag={1.5} blending={THREE.AdditiveBlending} life={0.8} />
      <Explosion ref={boom} />
      <WorldEffects preset={PRESET} />
    </>
  );
}

export default function F16({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    alt: 0,
    throttle: 0,
    crashed: false,
    cockpit: false,
    score: 0,
    rings: 0,
    combo: 0,
    lowPass: false,
    afterburner: false,
    bannerId: 0,
    bannerText: "",
    stall: false,
    g: 1,
    edge: false,
  });
  const photoMode = useMemo(() => readPhoto() !== null, []);
  const reticle = useRef<{ aim: HTMLDivElement | null; nose: HTMLDivElement | null }>({ aim: null, nose: null });
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", on);
    return () => document.removeEventListener("pointerlockchange", on);
  }, []);
  // the 3D tree must not re-render with every HUD update (≈10×/s)
  const scene = useMemo(() => <F16Scene started={started} onHud={setHud} reticle={reticle} />, [started, reticle]);
  return (
    <div className="absolute inset-0">
      {/* reticles are positioned every frame from the scene (see F16Scene) */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <div
          ref={(el) => {
            reticle.current.aim = el;
          }}
          className="absolute left-0 top-0 opacity-0"
        >
          <div className="-translate-x-1/2 -translate-y-1/2 size-9 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
        </div>
        <div
          ref={(el) => {
            reticle.current.nose = el;
          }}
          className="absolute left-0 top-0 opacity-0"
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2 size-5">
            <span className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#ffd400] shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            <span className="absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2 bg-[#ffd400] shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
          </div>
        </div>
      </div>
      <Canvas shadows="percentage" dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 62, near: 0.2, far: 4500 }}>
        {scene}
      </Canvas>
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Skor" value={`${hud.score}`} accent={ACCENT} sub={hud.combo > 1 ? `×${hud.combo} kombo` : undefined} />
        <HudStat label="Halka" value={`${hud.rings}/${RING_COUNT}`} accent="#0ea5e9" />
        <HudStat
          label="Hız"
          value={`${hud.speed} km/h`}
          accent="#14141f"
          sub={hud.afterburner ? "AFTERBURNER" : hud.stall ? "STALL!" : hud.g >= 4 ? `${hud.g.toFixed(1)} G` : undefined}
        />
        <HudStat label="İrtifa" value={`${hud.alt} m`} accent={hud.lowPass ? "#f97316" : "#6b6880"} sub={hud.lowPass ? "alçak uçuş bonusu" : undefined} />
        <HudBar label="Gaz" value={hud.throttle} accent="#f97316" />
      </div>
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} accent="#0ea5e9" />}
      <HudEdge show={started && !photoMode && !hud.crashed && hud.edge} text="Şehrin dışındasın, uçak geri dönüyor." />
      {hud.crashed && !photoMode && (
        <HudModal
          title="Çakıldın!"
          accent="#e11d48"
          lines={[`Skor: ${hud.score}`, "Otomatik yeniden başlatılıyor…"]}
          hint="R: hemen başlat"
          tone="danger"
        />
      )}
      {started && !photoMode && !hud.crashed && !locked && (
        <HudCenter text="Ekrana tıkla, fareyle nişan al: uçak beyaz halkaya döner. Esc ile bırak." />
      )}
      {started && !photoMode && !hud.crashed && <HudHint text="C: kokpit · halkalar sokak aralarında · binalara dikkat" touchText="Ekranı sürükle: nişan al" />}
    </div>
  );
}

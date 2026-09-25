"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import City from "./shared/City";
import Car, { CarHandle } from "./shared/Car";
import { generateCity, mulberry32, clampToPlayArea, distanceToEdge, BOUNDARY_WARN } from "./shared/cityGen";
import { WorldAtmosphere, WorldEffects, CANVAS_GL, PRESETS } from "./shared/World";
import { useKeys, makeEdge } from "./shared/useKeys";
import { stepDrift, TYRE, type DriftBody } from "./cars/driftPhysics";
import Particles, { type ParticleHandle } from "./shared/Particles";
import TireSmoke, { type SmokeHandle } from "./cars/TireSmoke";
import TrafficFleet, { type FleetCar } from "./cars/TrafficFleet";
import { buildCar, type CarType } from "./cars/carGeometry";
import { TRAFFIC_PAINTS } from "./cars/carMaterials";
import { ROUTE_GAP, STALL_D, STALL_N, STALL_W, STALL_X0, ROW_Z0 } from "./cars/plaza";
import { HudStat, HudCenter, HudBanner, HudHint, HudEdge } from "./shared/GameHud";
import { buildTrack, collideBlocks, BoxGrid, type Box, type Push } from "./drift/route";
import TrackProps, { type CarProbe } from "./drift/Track";
import Plaza, { MASTS } from "./drift/Plaza";
import SkidMarks, { type SkidEmit } from "./drift/SkidMarks";
import { getGame } from "@/lib/games";

const ACCENT = getGame("drift")!.accent;
const SUB = 1 / 120;
const WHEEL_R = 0.345;
const PRESET = "night" as const;
const DEG = Math.PI / 180;
/** car collision: two circles on the axles */
const AXLE = 1.25;
const CAR_R = 1.0;
/** a corner counts as drifted after this much drift time around it (s) */
const CORNER_MIN = 0.4;
const CORNER_ZONE = 40;
const LAP_BONUS = 1000;

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rw = [new THREE.Vector3(), new THREE.Vector3()];
const _push: Push = { x: 0, z: 0, depth: 0 };

interface Hud {
  speed: number;
  drifting: boolean;
  chain: number;
  mult: number;
  total: number;
  angle: number;
  bannerId: number;
  bannerText: string;
  bannerSub: string;
  gate: number;
  gates: number;
  lap: number;
  lapTime: number;
  best: number;
  navDeg: number;
  navDist: number;
  edge: boolean;
  tip: boolean;
  idle: boolean;
}

const HUD0: Hud = {
  speed: 0,
  drifting: false,
  chain: 0,
  mult: 1,
  total: 0,
  angle: 0,
  bannerId: 0,
  bannerText: "",
  bannerSub: "",
  gate: 0,
  gates: 1,
  lap: 0,
  lapTime: 0,
  best: 0,
  navDeg: 0,
  navDist: 0,
  edge: false,
  tip: true,
  idle: true,
};

function smoothAngle(cur: number, target: number, k: number) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * k;
}

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};

/* ---------- main scene ---------- */
function DriftScene({ started, onHud }: { started: boolean; onHud: (h: Hud) => void }) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 10,
        blockSize: 60,
        roadWidth: 24,
        seed: 3,
        maxHeight: 70,
        plazaBlocks: 2,
        towerChance: 0.1,
      }),
    []
  );
  const track = useMemo(() => buildTrack(), []);
  const plazaHalf = (city.plaza?.w ?? 168) / 2 - city.roadWidth / 2;

  // parked cars: along the route's curbs + a few in the plaza stalls (lights off)
  const parked = useMemo<FleetCar[]>(() => {
    const r = mulberry32(4242);
    const types: CarType[] = ["sedan", "sedan", "hatch", "hatch", "suv", "suv", "van"];
    const paint = () => new THREE.Color(TRAFFIC_PAINTS[Math.floor(r() * TRAFFIC_PAINTS.length)]);
    const out: FleetCar[] = [];
    for (const s of track.parked) {
      out.push({ type: types[Math.floor(r() * types.length)], color: paint(), x: s.x, y: 0, z: s.z, rotY: s.rotY, visible: true });
    }
    for (const sgn of [1, -1])
      for (const row of [0, 1]) {
        for (let i = 0; i < STALL_N; i++) {
          const x = STALL_X0 + (i + 0.5) * STALL_W;
          if (sgn > 0 && Math.abs(x) < ROUTE_GAP + 1.5) continue;
          if (r() > 0.2) continue;
          const zc = sgn * (ROW_Z0 + STALL_D * (row + 0.5));
          const rotY = (row === 0) === sgn > 0 ? 0 : Math.PI;
          out.push({
            type: types[Math.floor(r() * types.length)],
            color: paint(),
            x: x + (r() - 0.5) * 0.25,
            y: 0,
            z: zc + (r() - 0.5) * 0.3,
            rotY: rotY + (r() - 0.5) * 0.05,
            visible: true,
          });
        }
      }
    return out;
  }, [track]);

  // solid obstacles (blocks are handled analytically in collideBlocks)
  const obstacles = useMemo(() => {
    const out: Box[] = [...track.colliders];
    const box = (x: number, z: number, w: number, d: number) => out.push({ minX: x - w / 2, minZ: z - d / 2, maxX: x + w / 2, maxZ: z + d / 2 });
    for (const [x, z] of MASTS) box(x, z, 1.0, 1.0);
    for (const c of parked) {
      const g = buildCar(c.type, 0);
      const flip = Math.abs(Math.sin(c.rotY)) > 0.7;
      box(c.x, c.z, flip ? g.spec.L : g.spec.W, flip ? g.spec.W : g.spec.L);
    }
    return new BoxGrid(out);
  }, [track, parked]);

  const debugCam = useMemo(
    () => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("cam") : null),
    []
  );

  const keys = useKeys();
  const edge = useMemo(() => makeEdge(), []);
  const car = useRef<CarHandle>(null);
  const smoke = useRef<SmokeHandle>(null);
  const sparks = useRef<ParticleHandle>(null);
  const skid = useRef<SkidEmit>({ active: false, pts: [new THREE.Vector3(), new THREE.Vector3()], strength: 0 });
  const focus = useRef<THREE.Vector3>(new THREE.Vector3(track.start.x, 0, track.start.z));
  const nextGate = useRef(0);
  const conesReset = useRef(0);

  const st = useRef({
    body: { vF: 0, vR: 0, yawRate: 0, steer: 0, aLong: 0 } as DriftBody,
    pos: new THREE.Vector3(track.start.x, 0, track.start.z),
    prevPos: new THREE.Vector3(track.start.x, 0, track.start.z),
    stepPrev: new THREE.Vector3(track.start.x, 0, track.start.z),
    rPos: new THREE.Vector3(),
    prevHeading: track.start.heading,
    vel: new THREE.Vector3(),
    heading: track.start.heading,
    yawRate: 0,
    steer: 0,
    vFPrev: 0,
    aLong: 0,
    aLat: 0,
    roll: 0,
    rollV: 0,
    pitch: 0,
    pitchV: 0,
    driftTime: 0,
    chain: 0,
    bankTimer: 0,
    total: 0,
    hood: false,
    mult: 1,
    bannerId: 0,
    bannerText: "",
    bannerSub: "",
    bannerT: 0,
    smokeAcc: 0,
    acc: 0,
    hudT: 0,
    camInit: false,
    camYaw: track.start.heading,
    camLook: new THREE.Vector3(),
    shake: 0,
    lastHud: null as Hud | null,
    slip: 0,
    drifting: false,
    t: 0,
    playT: 0,
    // route progress
    lastGate: -1,
    lap: 0,
    lapT: 0,
    lapOn: false,
    best: 0,
    preDrift: 0,
    zone: -1,
    zoneDrift: 0,
    zoneAngle: 0,
    edge: false,
  });

  const banner = (text: string, sub = "") => {
    const s = st.current;
    s.bannerId++;
    s.bannerText = text;
    s.bannerSub = sub;
    s.bannerT = 1.4;
  };

  // dev-only handle for headless tests
  const gl = useThree((x) => x.gl);
  const scene = useThree((x) => x.scene);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __drift?: unknown; __driftTrack?: unknown; __driftNext?: unknown; __driftGL?: unknown; __driftScene?: unknown };
    w.__drift = st.current;
    w.__driftTrack = track;
    w.__driftNext = nextGate;
    w.__driftGL = gl;
    w.__driftScene = scene;
  }, [track, gl, scene]);

  const probe = useRef<CarProbe>({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0 });

  // dev map view (?cam=map): the route as a bright ribbon, fog off
  const mapRibbon = useMemo(() => {
    if (debugCam !== "map") return null;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 1; i < track.path.length; i++) {
      const a = track.path[i - 1];
      const c = track.path[i];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const g = new THREE.PlaneGeometry(7, len + 7);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(c.x - a.x, c.z - a.z));
      g.translate((a.x + c.x) / 2, 1, (a.z + c.z) / 2);
      parts.push(g);
    }
    return parts;
  }, [debugCam, track]);

  useFrame(({ camera, scene }, rawDt) => {
    const s = st.current;
    if (debugCam === "map" && scene.fog) scene.fog = null;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;
    s.t += dt;
    if (started) s.playT += dt;

    if (started) {
      if (edge(k, "KeyC")) s.hood = !s.hood;
      if (edge(k, "KeyR")) respawn();
    }
    if (s.bannerT > 0) s.bannerT -= dt;
    s.shake = Math.max(0, s.shake - dt * 2.5);

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        s.prevPos.copy(s.pos);
        s.prevHeading = s.heading;
        step(SUB);
        s.acc -= SUB;
      }
      if (s.lapOn) s.lapT += dt;
    }
    // render between the last two physics states (physics runs at a fixed 120 Hz)
    const alpha = started ? s.acc / SUB : 1;
    const rp = s.rPos.lerpVectors(s.prevPos, s.pos, alpha);
    const rh = s.prevHeading + (s.heading - s.prevHeading) * alpha;
    probe.current.heading = rh;
    probe.current.pos.copy(rp);
    probe.current.vel.copy(s.vel);

    const speed = s.vel.length();
    const vF = Math.sin(s.heading) * s.vel.x + Math.cos(s.heading) * s.vel.z;
    const vR = Math.cos(s.heading) * s.vel.x - Math.sin(s.heading) * s.vel.z;
    const slip = Math.atan2(Math.abs(vR), Math.abs(vF));
    // rear-axle slide (tyre smoke even before drift mode latches)
    const rearSlip = Math.atan2(Math.abs(vR - TYRE.b * s.yawRate), Math.abs(vF) + 0.5);
    // a drift scores while drift mode is on and the car is really sideways
    const drifting = !!s.body.drift && slip > 10 * DEG && slip < 80 * DEG && vF > 7;
    s.slip = slip;
    s.drifting = drifting;
    focus.current.copy(rp);

    // ---- suspension: spring-damper roll / pitch driven by accelerations ----
    const rollTarget = THREE.MathUtils.clamp(s.aLat * 0.0075, -0.085, 0.085);
    const pitchTarget = THREE.MathUtils.clamp(-s.aLong * 0.0055, -0.055, 0.055);
    s.rollV += ((rollTarget - s.roll) * 70 - s.rollV * 9) * dt;
    s.roll += s.rollV * dt;
    s.pitchV += ((pitchTarget - s.pitch) * 60 - s.pitchV * 8.5) * dt;
    s.pitch += s.pitchV * dt;

    // ---- car transform ----
    const g = car.current;
    const throttle = started && (k.has("KeyW") || k.has("ArrowUp"));
    const hb = started && k.has("Space");
    if (g?.group) {
      g.group.position.set(rp.x, 0, rp.z);
      g.group.rotation.y = rh;
      if (g.body) {
        g.body.rotation.z = s.roll;
        g.body.rotation.x = s.pitch;
      }
      for (const w of g.frontAxle) if (w) w.rotation.y = s.steer * 0.55;
      const spinF = (vF / WHEEL_R) * dt;
      // rear wheels spin faster than the road while power-sliding
      const rearSpin = hb ? 0 : spinF * (drifting && throttle ? 1.8 : 1);
      g.wheels.forEach((w, i) => {
        if (w) w.rotation.x += i < 2 ? spinF : rearSpin;
      });
      if (g.tailMat) g.tailMat.emissiveIntensity = k.has("KeyS") || k.has("Space") || k.has("ArrowDown") ? 4.5 : 1.6;
    }

    // ---- smoke + skid emit points (rear wheels, world space) ----
    _fwd.set(Math.sin(rh), 0, Math.cos(rh));
    _right.set(Math.cos(rh), 0, -Math.sin(rh));
    const wheelSlide = started && speed > 4 && (drifting || hb || (rearSlip > 9 * DEG && speed > 9));
    if (wheelSlide) {
      _rw[0].copy(rp).addScaledVector(_fwd, -1.3).addScaledVector(_right, -0.82);
      _rw[1].copy(rp).addScaledVector(_fwd, -1.3).addScaledVector(_right, 0.82);
      const intensity = THREE.MathUtils.clamp((Math.max(slip, rearSlip) - 0.15) * 1.6 + speed * 0.012, 0.15, 1);
      skid.current.active = true;
      skid.current.pts[0].copy(_rw[0]);
      skid.current.pts[1].copy(_rw[1]);
      skid.current.strength = 0.25 + intensity * 0.5;
      s.smokeAcc += dt * (8 + intensity * 30);
      while (s.smokeAcc >= 1) {
        s.smokeAcc -= 1;
        for (const p of _rw) {
          const jitter = 0.35;
          smoke.current?.emit(
            p.x + (Math.random() - 0.5) * jitter,
            0.35 + Math.random() * 0.2,
            p.z + (Math.random() - 0.5) * jitter,
            s.vel.x * 0.18 + (Math.random() - 0.5) * 1.6,
            0.4 + Math.random() * 0.6,
            s.vel.z * 0.18 + (Math.random() - 0.5) * 1.6,
            0.8 + Math.random() * 0.5,
            1.6 + Math.random() * 1.2,
            0.22 + intensity * 0.3
          );
        }
      }
    } else {
      skid.current.active = false;
    }

    // ---- camera ----
    const near = s.hood ? 0.1 : 0.2;
    if (cam.near !== near) cam.near = near;
    if (debugCam === "look") {
      // dev: fixed camera from ?px&py&pz → ?tx&ty&tz
      const q = new URLSearchParams(window.location.search);
      const n = (key: string, d: number) => Number(q.get(key) ?? d);
      cam.position.set(n("px", 0), n("py", 10), n("pz", 0));
      cam.lookAt(n("tx", 0), n("ty", 0), n("tz", 1));
      cam.fov = n("fov", 55);
      cam.updateProjectionMatrix();
    } else if (debugCam === "top" || debugCam === "map") {
      const hgt = debugCam === "map" ? 1180 : 110;
      const cx = debugCam === "map" ? 0 : rp.x;
      const cz = debugCam === "map" ? 0 : rp.z;
      cam.position.set(cx, hgt, cz + 0.01);
      cam.lookAt(cx, 0, cz);
      cam.far = 4000;
      cam.fov = 45;
      cam.updateProjectionMatrix();
    } else if (debugCam === "orbit" || debugCam === "front" || debugCam === "side") {
      const a = debugCam === "orbit" ? s.t * 0.35 + 0.7 : debugCam === "front" ? 0.55 : Math.PI / 2;
      cam.position.set(rp.x + Math.sin(rh + a) * 6.2, 1.7, rp.z + Math.cos(rh + a) * 6.2);
      cam.lookAt(rp.x, 0.65, rp.z);
      cam.fov = 45;
      cam.updateProjectionMatrix();
    } else if (s.hood) {
      _camPos.copy(rp).addScaledVector(_fwd, 0.3).setY(1.18);
      _look.copy(rp).addScaledVector(_fwd, 14).setY(0.9);
      cam.position.copy(_camPos);
      cam.lookAt(_look);
      cam.rotateZ(-s.roll * 0.6);
      cam.fov += (72 + Math.min(12, speed * 0.25) - cam.fov) * Math.min(1, 4 * dt);
      cam.updateProjectionMatrix();
    } else {
      // yaw follows a blend of heading and travel direction, critically damped
      let targetYaw = rh;
      if (speed > 3) {
        const velYaw = Math.atan2(s.vel.x, s.vel.z);
        const back = Math.cos(velYaw - rh) < -0.2; // reversing
        if (!back) targetYaw = smoothAngle(rh, velYaw, 0.5);
      }
      if (!s.camInit) s.camYaw = targetYaw;
      s.camYaw = smoothAngle(s.camYaw, targetYaw, 1 - Math.exp(-3.6 * dt));
      const dist = 7.2 + Math.min(2.2, speed * 0.045);
      const height = 2.5 + Math.min(0.9, speed * 0.018);
      _camPos.set(rp.x - Math.sin(s.camYaw) * dist, height, rp.z - Math.cos(s.camYaw) * dist);
      // smooth, low-frequency shake (impacts + a little at speed)
      const sh = s.shake * 0.35 + Math.min(0.03, speed * 0.0006);
      _camPos.x += Math.sin(s.t * 23.1) * sh;
      _camPos.y += Math.sin(s.t * 19.7 + 1.3) * sh;
      _look.copy(rp).addScaledVector(_fwd, 2.5).setY(1.0);
      if (!s.camInit) {
        cam.position.copy(_camPos);
        s.camLook.copy(_look);
        s.camInit = true;
      } else {
        cam.position.lerp(_camPos, 1 - Math.exp(-9 * dt));
        s.camLook.lerp(_look, 1 - Math.exp(-14 * dt));
      }
      cam.lookAt(s.camLook);
      cam.fov += (62 + Math.min(14, speed * 0.3) - cam.fov) * Math.min(1, 4 * dt);
      cam.updateProjectionMatrix();
    }

    // ---- score ----
    if (drifting) {
      s.driftTime += dt;
      const mult = 1 + Math.min(3, Math.floor(s.driftTime / 1.5) * 0.5);
      // angle reward saturates around 40 deg so clean, held drifts beat wild ones
      s.chain += speed * Math.min(slip, 0.7) * dt * 12 * mult;
      s.bankTimer = 0;
      s.mult = mult;
    } else {
      s.driftTime = 0;
      s.mult = 1;
      s.bankTimer += dt;
      if (s.chain > 0 && s.bankTimer > 1.2) {
        const banked = Math.round(s.chain);
        s.total += banked;
        s.chain = 0;
        if (banked > 200 && s.bannerT <= 0) banner(`+${banked}`);
      }
    }

    // ---- HUD 10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const gate = track.gates[nextGate.current];
      const toX = gate.x - rp.x;
      const toZ = gate.z - rp.z;
      const yawTo = Math.atan2(toX, toZ);
      const viewYaw = s.hood ? rh : s.camYaw;
      const rel = Math.atan2(Math.sin(yawTo - viewYaw), Math.cos(yawTo - viewYaw));
      const nh: Hud = {
        speed: Math.round(speed * 3.6),
        drifting,
        chain: Math.round(s.chain),
        mult: s.mult,
        total: s.total,
        angle: Math.round(slip / DEG),
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
        bannerSub: s.bannerSub,
        gate: nextGate.current,
        gates: track.gates.length,
        lap: s.lap,
        lapTime: Math.floor(s.lapT * 10) / 10,
        best: s.best,
        // screen: + yaw is to the left, CSS rotate + is clockwise
        navDeg: Math.round(-rel / DEG / 3) * 3,
        navDist: Math.round(Math.hypot(toX, toZ) / 5) * 5,
        edge: s.edge,
        tip: s.playT < 14,
        idle: speed < 2,
      };
      const l = s.lastHud;
      if (!l || (Object.keys(nh) as (keyof Hud)[]).some((key) => l[key] !== nh[key])) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function respawn() {
      const stt = st.current;
      const gi = stt.lastGate;
      const gg = gi >= 0 ? track.gates[gi] : null;
      if (gg) {
        stt.pos.set(gg.x + gg.dx * 2, 0, gg.z + gg.dz * 2);
        stt.heading = Math.atan2(gg.dx, gg.dz);
      } else {
        stt.pos.set(track.start.x, 0, track.start.z);
        stt.heading = track.start.heading;
      }
      stt.prevPos.copy(stt.pos);
      stt.stepPrev.copy(stt.pos);
      stt.prevHeading = stt.heading;
      stt.vel.set(0, 0, 0);
      stt.yawRate = 0;
      stt.steer = 0;
      stt.body = { vF: 0, vR: 0, yawRate: 0, steer: 0, aLong: 0 };
      stt.chain = 0;
      stt.driftTime = 0;
      stt.zone = -1;
      stt.preDrift = 0;
      stt.camInit = false;
    }

    function step(h: number) {
      const stt = st.current;
      const b = stt.body;
      const fwdX = Math.sin(stt.heading);
      const fwdZ = Math.cos(stt.heading);
      const rgtX = fwdZ;
      const rgtZ = -fwdX;
      let bvF = stt.vel.x * fwdX + stt.vel.z * fwdZ;
      let bvR = stt.vel.x * rgtX + stt.vel.z * rgtZ;

      const handbrake = k.has("Space");
      const gas = k.has("KeyW") || k.has("ArrowUp");
      const brake = k.has("KeyS") || k.has("ArrowDown");
      const steerIn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);

      // ---- tyre model (see cars/driftPhysics.ts) ----
      b.vF = bvF;
      b.vR = bvR;
      b.yawRate = stt.yawRate;
      b.steer = stt.steer;
      b.aLong = stt.aLong;
      stepDrift(b, gas, brake, handbrake, steerIn, h);
      bvF = b.vF;
      bvR = b.vR;
      stt.yawRate = b.yawRate;
      stt.steer = b.steer;
      stt.heading += stt.yawRate * h;

      // accelerations for the suspension (smoothed)
      const aLong = (bvF - stt.vFPrev) / h;
      stt.vFPrev = bvF;
      stt.aLong += (aLong - stt.aLong) * Math.min(1, 10 * h);
      stt.aLat += (stt.yawRate * bvF - stt.aLat) * Math.min(1, 10 * h);

      // back to world space with the NEW heading: the body-frame result
      // already contains the frame rotation (vR·r terms), so converting with
      // the old heading would apply it twice (path lags, slip doubles)
      const nfX = Math.sin(stt.heading);
      const nfZ = Math.cos(stt.heading);
      stt.vel.set(nfX * bvF + nfZ * bvR, 0, nfZ * bvF - nfX * bvR);
      stt.stepPrev.copy(stt.pos);
      stt.pos.addScaledVector(stt.vel, h);

      // ---- collision: two circles (front / rear axle) vs blocks + obstacles;
      // walls take the normal velocity (small bounce) and some tangential
      // speed, so the car slides along instead of sticking
      let worst = 0;
      for (let oi = 0; oi < 2; oi++) {
        const off = oi === 0 ? AXLE : -AXLE;
        const cx = stt.pos.x + nfX * off;
        const cz = stt.pos.z + nfZ * off;
        _push.x = _push.z = _push.depth = 0;
        collideBlocks(cx, cz, CAR_R, _push);
        obstacles.collide(cx, cz, CAR_R, _push);
        if (_push.depth <= 0) continue;
        stt.pos.x += _push.x;
        stt.pos.z += _push.z;
        _tmp.set(_push.x, 0, _push.z).normalize();
        worst = Math.max(worst, hitWall(_tmp, cx, cz));
      }
      // play-area edge (the concrete barrier <City> draws along bounds.max)
      const wall = clampToPlayArea(stt.pos, city, 2.3);
      if (wall) {
        _tmp.set(-wall.nx, 0, -wall.nz);
        worst = Math.max(worst, hitWall(_tmp, stt.pos.x + wall.nx * 2.3, stt.pos.z + wall.nz * 2.3));
      }
      stt.edge = distanceToEdge(stt.pos.x, stt.pos.z, city) < BOUNDARY_WARN;
      if (worst > 7 && stt.chain > 0) {
        stt.chain = 0;
        stt.driftTime = 0;
        banner("Zincir koptu!", "Duvara sert çarptın");
      }

      // ---- gates ----
      const gi = nextGate.current;
      const gt = track.gates[gi];
      const before = (stt.stepPrev.x - gt.x) * gt.dx + (stt.stepPrev.z - gt.z) * gt.dz;
      const after = (stt.pos.x - gt.x) * gt.dx + (stt.pos.z - gt.z) * gt.dz;
      const lat = Math.abs((stt.pos.x - gt.x) * -gt.dz + (stt.pos.z - gt.z) * gt.dx);
      const isDrift = !!b.drift && stt.slip > 10 * DEG;
      // drift around the upcoming corner counts even before its gate
      if (gt.turn !== 0 && Math.hypot(stt.pos.x - gt.cx, stt.pos.z - gt.cz) < CORNER_ZONE && isDrift) stt.preDrift += h;
      if (before < 0 && after >= 0 && lat < gt.half + 2) {
        stt.lastGate = gi;
        if (gi === 0) {
          if (stt.lapOn) {
            stt.lap++;
            const lt = stt.lapT;
            const best = !stt.best || lt < stt.best;
            if (best) stt.best = lt;
            stt.total += LAP_BONUS;
            banner(`Tur ${stt.lap}: ${fmtTime(lt)}`, best ? `En iyi tur! +${LAP_BONUS}` : `+${LAP_BONUS}`);
            conesReset.current++;
          }
          stt.lapOn = true;
          stt.lapT = 0;
        } else {
          // corner gate: start judging this corner
          stt.zone = gi;
          stt.zoneDrift = stt.preDrift;
          stt.zoneAngle = 0;
        }
        stt.preDrift = 0;
        nextGate.current = (gi + 1) % track.gates.length;
      }
      // corner drift bonus once the car leaves the corner
      if (stt.zone >= 0) {
        const zg = track.gates[stt.zone];
        const d = Math.hypot(stt.pos.x - zg.cx, stt.pos.z - zg.cz);
        if (isDrift && d < CORNER_ZONE) {
          stt.zoneDrift += h;
          stt.zoneAngle = Math.max(stt.zoneAngle, stt.slip);
        }
        if (d > CORNER_ZONE) {
          if (stt.zoneDrift >= CORNER_MIN) {
            const bonus = Math.round((150 + stt.zoneDrift * 220 + (stt.zoneAngle / DEG) * 4) / 10) * 10;
            stt.total += bonus;
            banner(`Köşe drifti! +${bonus}`, `${Math.round(stt.zoneAngle / DEG)}° açı`);
          }
          stt.zone = -1;
        }
      }
    }

    /** Wall response along normal `n` (pointing away from the wall). Returns the impact speed. */
    function hitWall(n: THREE.Vector3, cx: number, cz: number) {
      const stt = st.current;
      const vn = stt.vel.dot(n);
      if (vn >= 0) return 0;
      const impact = -vn;
      // kill the normal component (+ a small bounce), scrub a little tangential speed
      stt.vel.addScaledVector(n, -vn * 1.15);
      const scrub = 1 - Math.min(0.3, impact * 0.02);
      const vn2 = stt.vel.dot(n);
      _tmp2.copy(stt.vel).addScaledVector(n, -vn2).multiplyScalar(scrub);
      stt.vel.copy(_tmp2).addScaledVector(n, vn2);
      if (impact > 2) stt.yawRate *= 1 - Math.min(0.5, impact * 0.04);
      if (impact > 4) {
        stt.shake = Math.min(1, impact / 18);
        for (let i = 0; i < Math.min(26, impact * 2); i++) {
          _tmp2.set((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10).addScaledVector(n, 4);
          sparks.current?.emit(_camPos.set(cx - n.x * CAR_R, 0.5, cz - n.z * CAR_R), _tmp2, { life: 0.5, size: 0.5, color: "#ffb347", grow: 0.2 });
        }
      }
      return impact;
    }
  });

  return (
    <>
      <color attach="background" args={["#0a0f1f"]} />
      <WorldAtmosphere preset={PRESET} focus={focus} />
      <City city={city} night={PRESETS[PRESET].night} />
      <Plaza half={plazaHalf} />
      <TrackProps track={track} nextGate={nextGate} car={probe} resetCones={conesReset} />
      <TrafficFleet cars={parked} flares={false} beams={false} lights={false} shadows={false} />
      <Car ref={car} color="#c2185b" glow={ACCENT} />
      <SkidMarks emitRef={skid} />
      <TireSmoke ref={smoke} count={700} color="#8e929c" fogColor={PRESETS[PRESET].fog} fogDensity={PRESETS[PRESET].fogDensity} />
      <Particles ref={sparks} count={240} gravity={-12} drag={1} blending={THREE.AdditiveBlending} />
      {mapRibbon?.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color="#ffd400" toneMapped={false} />
        </mesh>
      ))}
      <WorldEffects preset={PRESET} />
    </>
  );
}

function NavArrow({ deg, label }: { deg: number; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center short:top-3 narrow:top-[13.5rem]">
      <div className="flex items-center gap-2.5 rounded-full bg-[#0a0a0a]/80 py-1.5 pl-1.5 pr-4 text-white backdrop-blur">
        <span className="grid size-8 place-items-center rounded-full bg-[#ffd400]">
          <svg
            viewBox="0 0 24 24"
            className="size-5 transition-transform duration-100"
            style={{ transform: `rotate(${deg}deg)` }}
            aria-hidden
          >
            <path d="M12 3 L20 19 L12 15 L4 19 Z" fill="#0a0a0a" />
          </svg>
        </span>
        <span className="text-[14px] font-semibold tabular-nums">{label}</span>
      </div>
    </div>
  );
}

export default function Drift({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>(HUD0);
  const gateLabel = hud.gate === 0 ? (hud.lap === 0 && hud.lapTime === 0 ? "Başlangıç" : "Bitiş") : `Kapı ${hud.gate}/${hud.gates - 1}`;

  // the 3D tree must not re-render with every HUD update (≈10×/s)
  const scene = useMemo(() => <DriftScene started={started} onHud={setHud} />, [started]);
  return (
    <div className="absolute inset-0">
      <Canvas shadows="percentage" dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 62, near: 0.2, far: 3000, position: [-68, 3, 0] }}>
        {scene}
      </Canvas>
      {started && <NavArrow deg={hud.navDeg} label={`${gateLabel} · ${hud.navDist} m`} />}
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Toplam" value={`${hud.total}`} accent={ACCENT} />
        <HudStat
          label="Drift Zinciri"
          value={`${hud.chain}`}
          accent="#f97316"
          sub={hud.mult > 1 ? `×${hud.mult.toFixed(1)} çarpan` : hud.drifting ? `${hud.angle}° açı` : "—"}
        />
        <HudStat
          label={hud.lap > 0 ? `Tur ${hud.lap + 1}` : "Tur"}
          value={fmtTime(hud.lapTime)}
          accent="#0284c7"
          sub={hud.best ? `En iyi ${fmtTime(hud.best)}` : undefined}
        />
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent="#14141f" />
      </div>
      {hud.drifting && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.6rem] flex justify-center short:top-14 narrow:top-28">
          <span
            className="text-3xl font-black italic tracking-widest animate-pulse short:text-2xl"
            style={{ color: ACCENT, WebkitTextStroke: "1px rgba(255,255,255,0.9)" }}
          >
            DRIFT {hud.mult > 1 ? `×${hud.mult.toFixed(1)}` : ""}
          </span>
        </div>
      )}
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} sub={hud.bannerSub || undefined} accent="#f97316" />}
      <HudEdge show={started && hud.edge} />
      {started && hud.idle && hud.lap === 0 && hud.chain === 0 && (
        <HudCenter
          className="top-[4.4rem] short:top-14 narrow:top-28"
          text="Sarı ışıklı kapıları sırayla geç · virajdan önce Space'e dokun, A/D ile açıyı tut"
          touchText="Sarı kapıları sırayla geç · virajdan önce el frenine dokun"
        />
      )}
      {started && hud.tip && !hud.idle && (
        <HudHint
          text="Drift: 60+ km/h'de Space'e dokun ya da gazla direksiyonu kır · gazı bırak ya da karşı direksiyon ver, araç toparlar · R: son kapıya dön"
          touchText="Drift: hızlıyken el freni · toparlamak için gazı bırak"
        />
      )}
    </div>
  );
}

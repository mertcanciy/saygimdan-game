"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import City, { makeGlowTexture } from "./shared/City";
import Car, { CarHandle } from "./shared/Car";
import { generateCity, aabbCollide, mulberry32, randomRoadPoint, type Building, type CityData } from "./shared/cityGen";
import { WorldAtmosphere, WorldEffects, CANVAS_GL, PRESETS } from "./shared/World";
import { pavingTexture } from "./shared/streetAssets";
import { useKeys, makeEdge } from "./shared/useKeys";
import Rings, { type RingData, ringHit } from "./shared/Rings";
import Particles, { type ParticleHandle } from "./shared/Particles";
import TireSmoke, { type SmokeHandle } from "./cars/TireSmoke";
import TrafficFleet, { type FleetCar } from "./cars/TrafficFleet";
import { buildCar, type CarType } from "./cars/carGeometry";
import { TRAFFIC_PAINTS } from "./cars/carMaterials";
import { makePlazaMarkings, SQ_X, SQ_Z, STALL_D, STALL_N, STALL_W, STALL_X0, ROW_Z0 } from "./cars/plaza";
import { HudStat, HudCenter, HudBanner, HudModal } from "./shared/GameHud";
import { getGame } from "@/lib/games";

const ACCENT = getGame("drift")!.accent;
const SUB = 1 / 120;
const MAX_VF = 48; // m/s (~170 km/h)
const WHEELBASE = 2.66;
const RING_COUNT = 10;
const WHEEL_R = 0.345;
const PRESET = "night" as const;

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rw = [new THREE.Vector3(), new THREE.Vector3()];

interface Hud {
  speed: number;
  drifting: boolean;
  chain: number;
  mult: number;
  total: number;
  hit: boolean;
  hood: boolean;
  rings: number;
  bannerId: number;
  bannerText: string;
  angle: number;
}

/* ---------- skid marks: ring buffer of quads with per-vertex alpha ---------- */
const SKID_N = 6000;
function makeSkidGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 4), 4));
  const idx = new Uint32Array(SKID_N * 6);
  for (let i = 0; i < SKID_N; i++) {
    const o = i * 4;
    const io = i * 6;
    idx[io] = o;
    idx[io + 1] = o + 2;
    idx[io + 2] = o + 1;
    idx[io + 3] = o;
    idx[io + 4] = o + 3;
    idx[io + 5] = o + 2;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

interface SkidEmit {
  active: boolean;
  pts: THREE.Vector3[];
  strength: number;
}

function SkidMarks({ emitRef }: { emitRef: React.RefObject<SkidEmit> }) {
  const geo = useMemo(() => makeSkidGeo(), []);
  const st = useRef({ cursor: 0, last: [new THREE.Vector3(), new THREE.Vector3()], lastA: [0, 0], has: false });

  useFrame(() => {
    const e = emitRef.current;
    const s = st.current;
    if (!e.active) {
      s.has = false;
      return;
    }
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;
    const a = posAttr.array as Float32Array;
    const c = colAttr.array as Float32Array;
    if (s.has) {
      for (let k = 0; k < 2; k++) {
        const prev = s.last[k];
        const cur = e.pts[k];
        _tmp.copy(cur).sub(prev);
        if (_tmp.lengthSq() < 0.09) continue; // lay a quad every ~30 cm
        const i = s.cursor % SKID_N;
        const o = i * 12;
        _right.set(-_tmp.z, 0, _tmp.x).normalize().multiplyScalar(0.13);
        const y = 0.022;
        a[o] = prev.x - _right.x; a[o + 1] = y; a[o + 2] = prev.z - _right.z;
        a[o + 3] = cur.x - _right.x; a[o + 4] = y; a[o + 5] = cur.z - _right.z;
        a[o + 6] = cur.x + _right.x; a[o + 7] = y; a[o + 8] = cur.z + _right.z;
        a[o + 9] = prev.x + _right.x; a[o + 10] = y; a[o + 11] = prev.z + _right.z;
        const a0 = s.lastA[k];
        const a1 = e.strength;
        const co = i * 16;
        for (let v = 0; v < 4; v++) {
          c[co + v * 4] = 0.035;
          c[co + v * 4 + 1] = 0.034;
          c[co + v * 4 + 2] = 0.036;
          c[co + v * 4 + 3] = v === 0 || v === 3 ? a0 : a1;
        }
        s.cursor++;
        prev.copy(cur);
        s.lastA[k] = a1;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geo.setDrawRange(0, Math.min(s.cursor, SKID_N) * 6);
    } else {
      s.last[0].copy(e.pts[0]);
      s.last[1].copy(e.pts[1]);
      s.lastA[0] = s.lastA[1] = 0;
      s.has = true;
    }
  });

  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={1}>
      <meshBasicMaterial
        vertexColors
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-3}
        polygonOffsetUnits={-6}
      />
    </mesh>
  );
}

/* ---------- the plaza: pavers, markings, flood-light masts, parked cars ---------- */
const MASTS: [number, number][] = [
  [SQ_X + 0.6, SQ_Z + 0.6],
  [-SQ_X - 0.6, SQ_Z + 0.6],
  [SQ_X + 0.6, -SQ_Z - 0.6],
  [-SQ_X - 0.6, -SQ_Z - 0.6],
  [SQ_X + 0.6, 0],
  [-SQ_X - 0.6, 0],
];
const MAST_H = 17;

function Plaza({ half, parked }: { half: number; parked: FleetCar[] }) {
  const markTex = useMemo(() => makePlazaMarkings(half), [half]);
  const paveMat = useMemo(() => {
    const t = pavingTexture().clone();
    t.repeat.set(SQ_X, SQ_Z);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#9c9a95", roughness: 0.82 });
  }, []);
  const glow = useMemo(() => makeGlowTexture("rgba(255,236,205,0.95)"), []);
  const targets = useMemo(() => MASTS.map(() => new THREE.Object3D()), []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} material={paveMat} receiveShadow>
        <planeGeometry args={[SQ_X * 2, SQ_Z * 2]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow>
        <planeGeometry args={[half * 2, half * 2]} />
        <meshStandardMaterial map={markTex} transparent depthWrite={false} roughness={0.7} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>

      {MASTS.map(([x, z], i) => {
        const ang = Math.atan2(-x, -z);
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 0.4, 0]} castShadow>
              <cylinderGeometry args={[0.45, 0.5, 0.8, 12]} />
              <meshStandardMaterial color="#8d8b86" roughness={0.9} />
            </mesh>
            <mesh position={[0, MAST_H / 2, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.24, MAST_H, 10]} />
              <meshStandardMaterial color="#4b4f55" metalness={0.7} roughness={0.45} />
            </mesh>
            <group position={[0, MAST_H, 0]} rotation={[0, ang, 0]}>
              <mesh>
                <boxGeometry args={[3.4, 0.14, 0.14]} />
                <meshStandardMaterial color="#3a3d42" metalness={0.7} roughness={0.4} />
              </mesh>
              {[-1.25, -0.42, 0.42, 1.25].map((lx) => (
                <group key={lx} position={[lx, -0.2, 0.25]} rotation={[0.55, 0, 0]}>
                  <mesh>
                    <boxGeometry args={[0.7, 0.14, 0.5]} />
                    <meshStandardMaterial color="#2a2c30" metalness={0.6} roughness={0.5} />
                  </mesh>
                  <mesh position={[0, -0.075, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[0.6, 0.42]} />
                    <meshStandardMaterial color="#fff6e6" emissive="#fff1d8" emissiveIntensity={14} side={THREE.DoubleSide} />
                  </mesh>
                </group>
              ))}
            </group>
            <mesh position={[-x * 0.25, 0.02, -z * 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[46, 46]} />
              <meshBasicMaterial map={glow} color="#ffe2b8" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            {(i === 0 || i === 3) && (
              <>
                <spotLight
                  position={[0, MAST_H - 0.3, 0]}
                  target={targets[i]}
                  color="#ffe8cc"
                  intensity={9000}
                  distance={150}
                  angle={1.05}
                  penumbra={0.65}
                  decay={2}
                />
                <primitive object={targets[i]} position={[-x * 0.55, 0, -z * 0.55]} />
              </>
            )}
          </group>
        );
      })}

      <TrafficFleet cars={parked} flares={false} beams={false} lights={false} shadows />
    </group>
  );
}

/** Sidewalk / park slabs are raised 0.18 m: find the ground height under (x, z). */
function makeGroundFn(city: CityData) {
  const cell = city.blockSize + city.roadWidth;
  const origin = city.bounds.min + city.roadWidth;
  const pz = city.plaza;
  return (x: number, z: number) => {
    const lx = x - origin;
    const lz = z - origin;
    const bx = Math.floor(lx / cell);
    const bz = Math.floor(lz / cell);
    if (bx < 0 || bz < 0 || bx >= city.blocks || bz >= city.blocks) return 0;
    if (lx - bx * cell > city.blockSize || lz - bz * cell > city.blockSize) return 0;
    if (pz && Math.abs(x - pz.x) < pz.w / 2 && Math.abs(z - pz.z) < pz.d / 2) return 0;
    return 0.18;
  };
}

function smoothAngle(cur: number, target: number, k: number) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * k;
}

/* ---------- main scene ---------- */
function DriftScene({ started, onHud }: { started: boolean; onHud: (h: Hud) => void }) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 12,
        blockSize: 60,
        roadWidth: 24,
        seed: 3,
        maxHeight: 70,
        plazaBlocks: 2,
        towerChance: 0.1,
      }),
    []
  );
  const plazaHalf = (city.plaza?.w ?? 168) / 2 - city.roadWidth / 2;
  const plazaR = plazaHalf - 10;

  // parked cars in the stalls
  const parked = useMemo<FleetCar[]>(() => {
    const r = mulberry32(4242);
    const types: CarType[] = ["sedan", "sedan", "hatch", "hatch", "suv", "suv", "van"];
    const out: FleetCar[] = [];
    for (const sgn of [1, -1])
      for (const row of [0, 1]) {
        for (let i = 0; i < STALL_N; i++) {
          if (r() > 0.55) continue;
          const type = types[Math.floor(r() * types.length)];
          const zc = sgn * (ROW_Z0 + STALL_D * (row + 0.5));
          // nose into the stall
          const rotY = (row === 0) === sgn > 0 ? 0 : Math.PI;
          out.push({
            type,
            color: new THREE.Color(TRAFFIC_PAINTS[Math.floor(r() * TRAFFIC_PAINTS.length)]),
            x: STALL_X0 + (i + 0.5) * STALL_W + (r() - 0.5) * 0.25,
            y: 0,
            z: zc + (r() - 0.5) * 0.3,
            rotY: rotY + (r() - 0.5) * 0.05,
            visible: true,
          });
        }
      }
    return out;
  }, []);

  // collision volumes: buildings + masts + parked cars + tree trunks + lamp posts
  const colliders = useMemo<Building[]>(() => {
    const vol = (x: number, z: number, w: number, d: number, h: number): Building => ({
      x, z, w, d, h, y0: 0, style: 0, seed: 0, colorIdx: 0, kind: 0, top: false,
    });
    const out: Building[] = [...city.buildings];
    for (const [x, z] of MASTS) out.push(vol(x, z, 1.0, 1.0, MAST_H));
    for (const c of parked) {
      const g = buildCar(c.type, 0);
      const flip = Math.abs(Math.sin(c.rotY)) > 0.7;
      out.push(vol(c.x, c.z, flip ? g.spec.L : g.spec.W, flip ? g.spec.W : g.spec.L, 2));
    }
    for (const t of city.trees) out.push(vol(t.x, t.z, 0.5, 0.5, 4));
    for (const l of city.lamps) out.push(vol(l.x, l.z, 0.35, 0.35, 7));
    return out;
  }, [city, parked]);
  const groundAt = useMemo(() => makeGroundFn(city), [city]);

  const ringsRef = useRef<RingData[]>([]);
  useEffect(() => {
    const rand = mulberry32(88);
    const out: RingData[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      out.push({ x: Math.cos(a) * plazaR * 0.5, y: 3.2, z: Math.sin(a) * plazaR * 0.5, rotY: a + Math.PI / 2, collected: false });
    }
    for (let i = 4; i < RING_COUNT; i++) {
      const p = randomRoadPoint(rand, city, 60);
      out.push({ x: p.x, y: 3.2, z: p.z, rotY: p.axis === "x" ? Math.PI / 2 : 0, collected: false });
    }
    ringsRef.current = out;
  }, [city, plazaR]);

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
  const focus = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 10));

  const st = useRef({
    pos: new THREE.Vector3(0, 0, 10),
    y: 0,
    vel: new THREE.Vector3(),
    heading: 0,
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
    hitFlash: 0,
    hood: false,
    mult: 1,
    ringsGot: 0,
    bannerId: 0,
    bannerText: "",
    bannerT: 0,
    smokeAcc: 0,
    acc: 0,
    hudT: 0,
    camInit: false,
    camYaw: 0,
    camLook: new THREE.Vector3(),
    shake: 0,
    lastHud: null as Hud | null,
    slip: 0,
    drifting: false,
    spinRL: 0,
    t: 0,
  });

  const banner = (text: string) => {
    const s = st.current;
    s.bannerId++;
    s.bannerText = text;
    s.bannerT = 1.2;
  };

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;
    s.t += dt;

    if (started) {
      if (edge(k, "KeyC")) s.hood = !s.hood;
      if (edge(k, "KeyR")) {
        s.pos.set(0, 0, 10);
        s.vel.set(0, 0, 0);
        s.heading = 0;
        s.yawRate = 0;
        s.chain = 0;
      }
    }
    if (s.hitFlash > 0) s.hitFlash -= dt;
    if (s.bannerT > 0) s.bannerT -= dt;
    s.shake = Math.max(0, s.shake - dt * 2.5);

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
      }
    }

    const speed = s.vel.length();
    const vF = Math.sin(s.heading) * s.vel.x + Math.cos(s.heading) * s.vel.z;
    const vR = Math.cos(s.heading) * s.vel.x - Math.sin(s.heading) * s.vel.z;
    const slip = Math.atan2(Math.abs(vR), Math.abs(vF));
    const drifting = slip > (14 * Math.PI) / 180 && speed > 7;
    s.slip = slip;
    s.drifting = drifting;
    focus.current.copy(s.pos);

    // ---- suspension: spring-damper roll / pitch driven by accelerations ----
    const rollTarget = THREE.MathUtils.clamp(s.aLat * 0.0075, -0.085, 0.085);
    const pitchTarget = THREE.MathUtils.clamp(-s.aLong * 0.0055, -0.055, 0.055);
    s.rollV += ((rollTarget - s.roll) * 70 - s.rollV * 9) * dt;
    s.roll += s.rollV * dt;
    s.pitchV += ((pitchTarget - s.pitch) * 60 - s.pitchV * 8.5) * dt;
    s.pitch += s.pitchV * dt;

    // ---- car transform ----
    const g = car.current;
    const ground = groundAt(s.pos.x, s.pos.z);
    s.y += (ground - s.y) * Math.min(1, 18 * dt);
    if (g?.group) {
      g.group.position.set(s.pos.x, s.y, s.pos.z);
      g.group.rotation.y = s.heading;
      if (g.body) {
        g.body.rotation.z = s.roll;
        g.body.rotation.x = s.pitch;
      }
      for (const w of g.frontAxle) if (w) w.rotation.y = s.steer * 0.55;
      const spinF = (vF / WHEEL_R) * dt;
      // rear wheels spin faster than the road while power-sliding
      const throttle = started && (k.has("KeyW") || k.has("ArrowUp"));
      const hb = started && k.has("Space");
      const rearSpin = hb ? 0 : spinF * (drifting && throttle ? 1.8 : 1);
      g.wheels.forEach((w, i) => {
        if (w) w.rotation.x += i < 2 ? spinF : rearSpin;
      });
      if (g.tailMat) g.tailMat.emissiveIntensity = k.has("KeyS") || k.has("Space") || k.has("ArrowDown") ? 4.5 : 1.6;
    }

    // ---- smoke + skid emit points (rear wheels, world space) ----
    _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    _right.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
    const wheelSlide = drifting || (started && k.has("Space") && speed > 4);
    if (wheelSlide && started) {
      _rw[0].copy(s.pos).addScaledVector(_fwd, -1.3).addScaledVector(_right, -0.82);
      _rw[1].copy(s.pos).addScaledVector(_fwd, -1.3).addScaledVector(_right, 0.82);
      const intensity = THREE.MathUtils.clamp((slip - 0.15) * 1.6 + speed * 0.012, 0.15, 1);
      skid.current.active = true;
      skid.current.pts[0].copy(_rw[0]);
      skid.current.pts[1].copy(_rw[1]);
      skid.current.strength = 0.25 + intensity * 0.5;
      s.smokeAcc += dt * (10 + intensity * 38);
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
    if (debugCam && debugCam.startsWith("parked")) {
      const px = Number(debugCam.slice(6) || -8);
      cam.position.set(px, 2.1, 40.5);
      cam.lookAt(px - 6, 0.7, 49);
      cam.fov = 50;
      cam.updateProjectionMatrix();
    } else if (debugCam === "top") {
      cam.position.set(s.pos.x, 110, s.pos.z + 0.01);
      cam.lookAt(s.pos.x, 0, s.pos.z);
      cam.fov = 60;
      cam.updateProjectionMatrix();
    } else if (debugCam === "orbit" || debugCam === "front" || debugCam === "side") {
      const a = debugCam === "orbit" ? s.t * 0.35 + 0.7 : debugCam === "front" ? 0.55 : Math.PI / 2;
      cam.position.set(s.pos.x + Math.sin(s.heading + a) * 6.2, 1.7, s.pos.z + Math.cos(s.heading + a) * 6.2);
      cam.lookAt(s.pos.x, 0.65, s.pos.z);
      cam.fov = 45;
      cam.updateProjectionMatrix();
    } else if (s.hood) {
      _camPos.copy(s.pos).addScaledVector(_fwd, 0.3).setY(s.y + 1.18);
      _look.copy(s.pos).addScaledVector(_fwd, 14).setY(s.y + 0.9);
      cam.position.copy(_camPos);
      cam.lookAt(_look);
      cam.rotateZ(-s.roll * 0.6);
      cam.fov += (72 + Math.min(12, speed * 0.25) - cam.fov) * Math.min(1, 4 * dt);
      cam.updateProjectionMatrix();
    } else {
      // yaw follows a blend of heading and travel direction, critically damped
      let targetYaw = s.heading;
      if (speed > 3) {
        const velYaw = Math.atan2(s.vel.x, s.vel.z);
        const back = Math.cos(velYaw - s.heading) < -0.2; // reversing
        if (!back) targetYaw = smoothAngle(s.heading, velYaw, 0.5);
      }
      if (!s.camInit) s.camYaw = targetYaw;
      s.camYaw = smoothAngle(s.camYaw, targetYaw, 1 - Math.exp(-3.6 * dt));
      const dist = 7.2 + Math.min(2.2, speed * 0.045);
      const height = 2.5 + Math.min(0.9, speed * 0.018);
      _camPos.set(
        s.pos.x - Math.sin(s.camYaw) * dist,
        s.y + height,
        s.pos.z - Math.cos(s.camYaw) * dist
      );
      // smooth, low-frequency shake (impacts + a little at speed)
      const sh = s.shake * 0.35 + Math.min(0.03, speed * 0.0006);
      _camPos.x += Math.sin(s.t * 23.1) * sh;
      _camPos.y += Math.sin(s.t * 19.7 + 1.3) * sh;
      _look.copy(s.pos).addScaledVector(_fwd, 2.5).setY(s.y + 1.0);
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
      s.chain += speed * slip * dt * 12 * mult;
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
        if (banked > 200) banner(`+${banked}`);
      }
    }

    // ---- HUD 10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh: Hud = {
        speed: Math.round(speed * 3.6),
        drifting,
        chain: Math.round(s.chain),
        mult: s.mult,
        total: s.total,
        hit: s.hitFlash > 0,
        hood: s.hood,
        rings: s.ringsGot,
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
        angle: Math.round((slip * 180) / Math.PI),
      };
      const l = s.lastHud;
      if (
        !l ||
        l.speed !== nh.speed ||
        l.drifting !== nh.drifting ||
        l.chain !== nh.chain ||
        l.mult !== nh.mult ||
        l.total !== nh.total ||
        l.hit !== nh.hit ||
        l.hood !== nh.hood ||
        l.rings !== nh.rings ||
        l.bannerId !== nh.bannerId ||
        l.angle !== nh.angle
      ) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function step(h: number) {
      const stt = st.current;
      const fwdX = Math.sin(stt.heading);
      const fwdZ = Math.cos(stt.heading);
      const rgtX = fwdZ;
      const rgtZ = -fwdX;
      let vF = stt.vel.x * fwdX + stt.vel.z * fwdZ;
      let vR = stt.vel.x * rgtX + stt.vel.z * rgtZ;

      const handbrake = k.has("Space");
      const throttle = k.has("KeyW") || k.has("ArrowUp");
      const brake = k.has("KeyS") || k.has("ArrowDown");

      // engine / brake / drag
      if (throttle) {
        const power = 24 * (1 - Math.max(0, vF) / (MAX_VF * 1.1));
        vF += power * h;
      } else if (brake) {
        if (vF > 0.5) vF = Math.max(0, vF - 32 * h);
        else vF = Math.max(-10, vF - 12 * h);
      }
      vF *= Math.exp(-0.18 * h);
      if (handbrake) vF *= Math.exp(-1.2 * h);

      // steering (rate-limited, speed-sensitive max angle)
      const steerIn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
      const rate = steerIn !== 0 ? 5 : 8;
      stt.steer += THREE.MathUtils.clamp(steerIn - stt.steer, -rate * h, rate * h);
      const maxSteer = THREE.MathUtils.lerp(0.6, 0.3, THREE.MathUtils.clamp(Math.abs(vF) / 35, 0, 1));
      const steerAngle = stt.steer * maxSteer;

      // grip model with weight transfer: braking loads the nose (rear goes
      // light and steps out), throttle mid-slide keeps the rear spinning
      const slipNow = Math.atan2(Math.abs(vR), Math.abs(vF) + 0.5);
      const driftingNow = handbrake || slipNow > (16 * Math.PI) / 180;
      let latGrip = driftingNow ? (handbrake ? 1.8 : 2.6) : 9.5;
      const load = THREE.MathUtils.clamp(-stt.aLong * 0.03, -0.25, 0.3); // + = weight to the front
      latGrip *= 1 - load * 0.8;
      if (driftingNow && throttle && !handbrake) latGrip *= 0.8;

      const kin = (vF / WHEELBASE) * Math.tan(steerAngle);
      const assist = driftingNow ? 1.55 : 1.0;
      let targetYaw = kin * assist;
      if (driftingNow) {
        const slipSigned = Math.atan2(vR, Math.abs(vF) + 0.5);
        targetYaw += slipSigned * 1.6 * Math.sign(vF || 1);
      }
      stt.yawRate += (targetYaw - stt.yawRate) * Math.min(1, 7 * h);
      stt.heading += stt.yawRate * h;

      vR *= Math.exp(-latGrip * h);

      // accelerations for the suspension (smoothed)
      const aLong = (vF - stt.vFPrev) / h;
      stt.vFPrev = vF;
      stt.aLong += (aLong - stt.aLong) * Math.min(1, 10 * h);
      stt.aLat += (stt.yawRate * vF - stt.aLat) * Math.min(1, 10 * h);

      stt.vel.set(fwdX * vF + rgtX * vR, 0, fwdZ * vF + rgtZ * vR);
      stt.pos.addScaledVector(stt.vel, h);

      // collision: two circles (front / rear axle) against every obstacle
      for (let oi = 0; oi < 2; oi++) {
        const off = oi === 0 ? 1.25 : -1.25;
        const cx = stt.pos.x + fwdX * off;
        const cz = stt.pos.z + fwdZ * off;
        const col = aabbCollide(cx, cz, 1.0, colliders);
        if (!col) continue;
        stt.pos.x += col.x;
        stt.pos.z += col.z;
        _tmp.set(col.x, 0, col.z).normalize();
        const vn = stt.vel.dot(_tmp);
        if (vn < 0) {
          stt.vel.addScaledVector(_tmp, -vn * 1.35);
          const impact = -vn;
          if (impact > 4) {
            stt.shake = Math.min(1, impact / 20);
            for (let i = 0; i < Math.min(30, impact * 2); i++) {
              _tmp2.set((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10).addScaledVector(_tmp, 4);
              sparks.current?.emit(_camPos.set(cx, 0.5, cz), _tmp2, { life: 0.5, size: 0.5, color: "#ffb347", grow: 0.2 });
            }
            if (stt.chain > 0) stt.hitFlash = 1.4;
            stt.chain = 0;
            stt.driftTime = 0;
          }
        }
        stt.yawRate *= 0.5;
      }

      // rings (drive through)
      const rings = ringsRef.current;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.collected) continue;
        if (ringHit(r, stt.pos.x, 1.5, stt.pos.z, 4.5, 2.5)) {
          r.collected = true;
          stt.ringsGot++;
          const bonus = 500 + Math.round(stt.chain * 0.5);
          stt.total += bonus;
          banner(`Halka! +${bonus}`);
          for (let p = 0; p < 16; p++) {
            _tmp2.set((Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10);
            sparks.current?.emit(_tmp.set(r.x, r.y, r.z), _tmp2, { life: 0.8, size: 0.8, color: "#fb923c", grow: 0.5 });
          }
        }
      }

      const b = city.bounds.max + 30;
      stt.pos.x = THREE.MathUtils.clamp(stt.pos.x, -b, b);
      stt.pos.z = THREE.MathUtils.clamp(stt.pos.z, -b, b);
    }
  });

  return (
    <>
      <color attach="background" args={["#0a0f1f"]} />
      <WorldAtmosphere preset={PRESET} focus={focus} />
      <City city={city} night={PRESETS[PRESET].night} />
      <Plaza half={plazaHalf} parked={parked} />
      <Car ref={car} color="#c2185b" glow={ACCENT} />
      <Rings rings={ringsRef} count={RING_COUNT} radius={4.5} tube={0.3} color="#fb923c" />
      <SkidMarks emitRef={skid} />
      <TireSmoke ref={smoke} count={900} color="#8e929c" fogColor={PRESETS[PRESET].fog} fogDensity={PRESETS[PRESET].fogDensity} />
      <Particles ref={sparks} count={300} gravity={-12} drag={1} blending={THREE.AdditiveBlending} />
      <WorldEffects preset={PRESET} />
    </>
  );
}

export default function Drift({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    drifting: false,
    chain: 0,
    mult: 1,
    total: 0,
    hit: false,
    hood: false,
    rings: 0,
    bannerId: 0,
    bannerText: "",
    angle: 0,
  });

  return (
    <div className="absolute inset-0">
      <Canvas shadows dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 62, near: 0.1, far: 3000, position: [0, 3, 0] }}>
        <DriftScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Toplam" value={`${hud.total}`} accent={ACCENT} />
        <HudStat
          label="Drift Zinciri"
          value={`${hud.chain}`}
          accent="#f97316"
          sub={hud.mult > 1 ? `×${hud.mult.toFixed(1)} çarpan` : hud.drifting ? `${hud.angle}° açı` : "—"}
        />
        <HudStat label="Halka" value={`${hud.rings}/${RING_COUNT}`} accent="#0284c7" />
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent="#14141f" />
      </div>
      {hud.drifting && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <span
            className="text-3xl font-black italic tracking-widest animate-pulse"
            style={{ color: ACCENT, WebkitTextStroke: "1px rgba(255,255,255,0.9)" }}
          >
            DRIFT {hud.mult > 1 ? `×${hud.mult.toFixed(1)}` : ""}
          </span>
        </div>
      )}
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} accent="#f97316" />}
      {hud.hit && <HudModal title="Çarptın!" accent="#e11d48" lines={["Drift zinciri sıfırlandı"]} tone="danger" />}
      {started && !hud.drifting && hud.chain === 0 && hud.speed < 5 && (
        <HudCenter text="W: gaz · A/D: direksiyon · Space basılı: el freni → drift · C: kamera · R: sıfırla" />
      )}
    </div>
  );
}

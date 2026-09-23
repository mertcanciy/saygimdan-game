"use client";

import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import Car from "./shared/Car";
import { makeFacadeTexture } from "./shared/City";
import { mulberry32 } from "./shared/city";
import { useKeys } from "./shared/useKeys";
import { HudStat } from "./shared/GameHud";
import { getGame } from "@/lib/games";

const ACCENT = getGame("traffic")!.accent;
const SUB = 1 / 120;
const LANE_W = 3.6;
const SEG_LEN = 60;
const SEG_COUNT = 14;
const _obj = new THREE.Object3D();
const _col = new THREE.Color();

const PALETTE = ["#1b2138", "#232946", "#2a2038", "#1a2530", "#241d33"];
const CAR_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#e5e7eb", "#f97316", "#94a3b8", "#14b8a6", "#f43f5e"];

interface Hud {
  speed: number;
  score: number;
  combo: number;
  makas: number; // popup counter/timestamp
  crashed: number;
}

/* ---------- endless roadside scenery ---------- */
const B_PER_SIDE = 26; // buildings per side per cycle
const LAMPS = 20;

function Roadside({ zRef }: { zRef: React.MutableRefObject<number> }) {
  const facadeTex = useMemo(() => makeFacadeTexture(), []);
  const bRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const dashRef = useRef<THREE.InstancedMesh>(null);
  const cycle = SEG_LEN * SEG_COUNT;

  const { bData, lampData, dashData } = useMemo(() => {
    const rand = mulberry32(42);
    const bData: { x: number; z: number; w: number; d: number; h: number; c: number }[] = [];
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      for (let i = 0; i < B_PER_SIDE; i++) {
        bData.push({
          x: side * (14 + rand() * 45),
          z: rand() * cycle,
          w: 12 + rand() * 14,
          d: 12 + rand() * 14,
          h: 15 + rand() * 55,
          c: Math.floor(rand() * 5),
        });
      }
    }
    const lampData: { x: number; z: number }[] = [];
    for (let i = 0; i < LAMPS; i++) {
      lampData.push({
        x: (i % 2 ? 1 : -1) * (LANE_W * 1.5 + 2.2),
        z: (i / LAMPS) * cycle,
      });
    }
    const dashData: { x: number; z: number }[] = [];
    const dashCount = Math.floor(cycle / 9);
    for (let i = 0; i < dashCount; i++) {
      for (const lx of [-LANE_W / 2, LANE_W / 2]) {
        dashData.push({ x: lx, z: i * 9 });
      }
    }
    return { bData, lampData, dashData };
  }, [cycle]);

  useFrame(() => {
    const pz = zRef.current;
    const im = bRef.current;
    const lm = lampRef.current;
    const dm = dashRef.current;
    if (!im || !lm || !dm) return;
    // recycle: place each item at z = base + k*cycle ahead of player (player drives -z)
    const base = Math.floor(pz / cycle) * cycle;
    bData.forEach((b, i) => {
      let z = b.z + base;
      while (z > pz - 20) z -= cycle; // keep behind->ahead ordering: we want z < pz+... player faces -z, so ahead = z < pz
      _obj.position.set(b.x, b.h / 2, z);
      _obj.scale.set(b.w, b.h, b.d);
      _obj.rotation.set(0, 0, 0);
      _obj.updateMatrix();
      im.setMatrixAt(i, _obj.matrix);
      im.setColorAt(i, _col.set(PALETTE[b.c]));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    lampData.forEach((l, i) => {
      let z = l.z + base;
      while (z > pz - 20) z -= cycle;
      _obj.position.set(l.x, 5, z);
      _obj.scale.setScalar(0.35);
      _obj.rotation.set(0, 0, 0);
      _obj.updateMatrix();
      lm.setMatrixAt(i, _obj.matrix);
    });
    lm.instanceMatrix.needsUpdate = true;

    dashData.forEach((d, i) => {
      let z = d.z + base;
      while (z > pz - 20) z -= cycle;
      _obj.position.set(d.x, 0.03, z);
      _obj.scale.set(0.18, 0.01, 4);
      _obj.rotation.set(0, 0, 0);
      _obj.updateMatrix();
      dm.setMatrixAt(i, _obj.matrix);
    });
    dm.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bRef} args={[undefined, undefined, bData.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          emissiveMap={facadeTex}
          emissive="#ffffff"
          emissiveIntensity={0.9}
          roughness={0.8}
        />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[undefined, undefined, lampData.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial color="#ffd28a" emissive="#ffd28a" emissiveIntensity={3} />
      </instancedMesh>
      <instancedMesh ref={dashRef} args={[undefined, undefined, dashData.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#e8e8c8" />
      </instancedMesh>
    </group>
  );
}

/* ---------- dashboard / cockpit ---------- */
function Dashboard({ steerRef }: { steerRef: React.MutableRefObject<number> }) {
  const wheel = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (wheel.current) wheel.current.rotation.z = -steerRef.current * 1.6;
  });
  return (
    <group position={[0, -0.55, -1.1]}>
      {/* hood lip */}
      <mesh position={[0, -0.08, -0.9]}>
        <boxGeometry args={[3.4, 0.3, 1.6]} />
        <meshStandardMaterial color="#151018" roughness={0.7} />
      </mesh>
      {/* dash */}
      <mesh position={[0, 0.02, -0.35]}>
        <boxGeometry args={[3.2, 0.28, 0.5]} />
        <meshStandardMaterial color="#0e0d14" roughness={0.9} />
      </mesh>
      {/* steering wheel */}
      <mesh ref={wheel} position={[0, -0.05, 0.05]} rotation={[0.5, 0, 0]}>
        <torusGeometry args={[0.22, 0.035, 8, 20]} />
        <meshStandardMaterial color="#1c1a22" roughness={0.6} />
      </mesh>
      {/* speed glow strip */}
      <mesh position={[0, 0.06, -0.32]}>
        <boxGeometry args={[1.2, 0.03, 0.03]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

/* ---------- scene ---------- */
const TRAFFIC_N = 24;

function TrafficScene({
  started,
  onHud,
}: {
  started: boolean;
  onHud: (h: Hud) => void;
}) {
  const keys = useKeys();
  const carsGroup = useRef<THREE.Group>(null);
  const roadRef = useRef<THREE.Mesh>(null);
  const groundRef = useRef<THREE.Mesh>(null);
  const playerZ = useRef(0);
  const steerVis = useRef(0);

  const rand = useMemo(() => mulberry32(1234), []);

  const st = useRef({
    pz: 0,
    px: 0,
    vx: 0,
    speed: 25, // m/s
    score: 0,
    combo: 0,
    makasT: 0,
    crashT: 0,
    acc: 0,
    hudT: 0,
    lastHud: { speed: 0, score: 0, combo: 0, makas: 0, crashed: 0 },
    makasCount: 0,
  });

  const cars = useMemo(() => {
    const r = mulberry32(777);
    return Array.from({ length: TRAFFIC_N }, (_, i) => ({
      lane: Math.floor(r() * 3),
      z: -60 - i * 35 - r() * 30,
      speed: 14 + r() * 10,
      color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)],
      passed: false,
      scored: false,
    }));
  }, []);

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
      }
    }
    if (s.makasT > 0) s.makasT -= dt;
    if (s.crashT > 0) s.crashT -= dt;

    playerZ.current = s.pz;
    steerVis.current = s.vx / 6;
    if (roadRef.current) roadRef.current.position.z = s.pz - 400;
    if (groundRef.current) groundRef.current.position.z = s.pz - 400;

    // camera: dashboard cam
    const shake = Math.min(0.06, s.speed * 0.0006);
    cam.position.set(
      s.px + (Math.random() - 0.5) * shake,
      1.3 + (Math.random() - 0.5) * shake,
      s.pz
    );
    cam.lookAt(s.px + s.vx * 0.4, 1.0, s.pz - 20);
    cam.fov += (70 + s.speed * 0.12 - cam.fov) * 0.08;
    cam.updateProjectionMatrix();

    // traffic cars
    const grp = carsGroup.current;
    if (grp) {
      grp.children.forEach((child, i) => {
        const c = cars[i];
        if (started) c.z -= c.speed * dt;
        // recycle ahead when passed far behind player
        if (c.z > s.pz + 30) {
          c.z = s.pz - 450 - rand() * 250;
          c.lane = Math.floor(rand() * 3);
          c.speed = 14 + rand() * 10;
          c.passed = false;
        }
        // near-miss / collision detection
        const dz = c.z - s.pz;
        const dx = c.lane * LANE_W - s.px;
        if (!c.passed && dz > -1.5 && dz < 1.5) {
          const ax = Math.abs(dx);
          if (ax < 0.95) {
            s.crashT = 1.5;
            s.speed = Math.max(17, s.speed * 0.4);
            s.combo = 0;
          } else if (ax < 2.4) {
            s.combo += 1;
            s.score += 100 * s.combo;
            s.makasT = 1.2;
            s.makasCount++;
          }
          c.passed = true;
        }
        child.position.set(c.lane * LANE_W, 0.02, c.z);
        child.rotation.y = Math.PI; // faces -z
      });
    }

    // HUD 10Hz
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh = {
        speed: Math.round(s.speed * 3.6),
        score: Math.round(s.score),
        combo: s.combo,
        makas: s.makasT > 0 ? s.makasCount : 0,
        crashed: s.crashT > 0 ? 1 : 0,
      };
      const o = s.lastHud;
      if (JSON.stringify(nh) !== JSON.stringify(o)) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function step(h: number) {
      const stt = st.current;
      // speed
      if (k.has("KeyW") || k.has("ArrowUp")) stt.speed = Math.min(61, stt.speed + 18 * h);
      else if (k.has("Space")) stt.speed = Math.max(0, stt.speed - 40 * h);
      else if (k.has("KeyS") || k.has("ArrowDown")) stt.speed = Math.max(8, stt.speed - 25 * h);
      stt.speed *= Math.exp(-0.06 * h);
      stt.speed = Math.max(0, stt.speed);
      // lateral
      const inX = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      stt.vx += (inX * 6 - stt.vx) * Math.min(1, 8 * h);
      stt.px += stt.vx * h;
      stt.px = THREE.MathUtils.clamp(stt.px, -LANE_W * 1.6, LANE_W * 1.6);
      stt.pz -= stt.speed * h;
    }
  });

  return (
    <>
      <color attach="background" args={["#070714"]} />
      <fog attach="fog" args={["#070714", 120, 500]} />
      <Stars radius={600} depth={50} count={3000} factor={4} fade />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#4455aa", "#221133", 0.8]} />
      <directionalLight position={[200, 300, 100]} intensity={0.5} color="#8899ff" />

      {/* road slab follows player */}
      <mesh ref={roadRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -400]}>
        <planeGeometry args={[LANE_W * 3 + 8, 1200]} />
        <meshStandardMaterial color="#0d0d15" roughness={1} />
      </mesh>
      {/* ground beyond */}
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, -400]}>
        <planeGeometry args={[600, 1400]} />
        <meshStandardMaterial color="#08080f" roughness={1} />
      </mesh>

      <Roadside zRef={playerZ} />
      <Dashboard steerRef={steerVis} />

      <group ref={carsGroup}>
        {cars.map((c, i) => (
          <Car key={i} color={c.color} glow="#2de2ff" />
        ))}
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.7} intensity={0.9} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function Traffic({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    score: 0,
    combo: 0,
    makas: 0,
    crashed: 0,
  });

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 70, near: 0.1, far: 1500 }}
      >
        <TrafficScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-16 right-6 space-y-2">
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent={ACCENT} />
        <HudStat label="Skor" value={`${hud.score}`} accent="#4ade80" />
        <HudStat label="Kombo" value={`×${hud.combo}`} accent="#f472b6" />
      </div>
      {hud.makas > 0 && (
        <div className="absolute top-1/3 inset-x-0 flex justify-center pointer-events-none">
          <span
            className="text-3xl font-black italic"
            style={{ color: ACCENT, textShadow: `0 0 25px ${ACCENT}` }}
          >
            Makas!
          </span>
        </div>
      )}
      {hud.crashed > 0 && (
        <div className="absolute inset-0 bg-red-900/25 flex items-center justify-center pointer-events-none">
          <span className="text-3xl font-extrabold text-red-400">Çarptın!</span>
        </div>
      )}
    </div>
  );
}

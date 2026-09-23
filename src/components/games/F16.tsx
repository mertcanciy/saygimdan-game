"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import City from "./shared/City";
import { generateCity, aabbCollide } from "./shared/city";
import { useKeys } from "./shared/useKeys";
import { usePointerLook } from "./shared/usePointerLook";
import { HudStat, HudCenter } from "./shared/GameHud";
import { getGame } from "@/lib/games";

const ACCENT = getGame("f16")!.accent;
const SUB = 1 / 120;

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _eul = new THREE.Euler();
const _q = new THREE.Quaternion();

interface Hud {
  speed: number;
  alt: number;
  throttle: number;
  crashed: boolean;
  cockpit: boolean;
}

/* ---------- jet ---------- */
function Jet({
  group,
  burner,
}: {
  group: React.RefObject<THREE.Group | null>;
  burner: React.RefObject<THREE.Mesh | null>;
}) {
  return (
    <group ref={group}>
      {/* fuselage */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 5.5, 8]} />
        <meshStandardMaterial color="#7d8a99" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* nose cone */}
      <mesh position={[0, 0, 3.4]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.32, 1.6, 8]} />
        <meshStandardMaterial color="#8b98a8" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* canopy */}
      <mesh position={[0, 0.42, 1.4]}>
        <sphereGeometry args={[0.3, 10, 8]} />
        <meshStandardMaterial color="#0e2233" roughness={0.1} metalness={0.8} />
      </mesh>
      {/* delta wings */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.5, -0.05, -0.9]} rotation={[0, s * 0.35, s * -0.08]}>
          <boxGeometry args={[2.6, 0.08, 1.7]} />
          <meshStandardMaterial color="#6b7887" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
      {/* twin tail fins */}
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.65, -2.3]} rotation={[0, 0, x * -0.3]}>
          <boxGeometry args={[0.08, 1.1, 0.9]} />
          <meshStandardMaterial color="#5d6a78" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
      {/* afterburner */}
      <mesh ref={burner} position={[0, 0, -2.9]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.28, 1.8, 8]} />
        <meshStandardMaterial
          color="#ff7a1a"
          emissive="#ff7a1a"
          emissiveIntensity={2.5}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}

/* ---------- wingtip contrails (2 x THREE.Line, ring buffers) ---------- */
const TRAIL_N = 60;

function makeTrail(): {
  line: THREE.Line;
  pos: Float32Array;
  head: number;
} {
  const pos = new Float32Array(TRAIL_N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({
    color: "#bfe3ff",
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return { line: new THREE.Line(g, m), pos, head: 0 };
}

const trailL = makeTrail();
const trailR = makeTrail();
const _tip = new THREE.Vector3();

function pushTrail(t: { pos: Float32Array; head: number; line: THREE.Line }, p: THREE.Vector3) {
  const i = t.head % TRAIL_N;
  t.pos[i * 3] = p.x;
  t.pos[i * 3 + 1] = p.y;
  t.pos[i * 3 + 2] = p.z;
  t.head++;
  // rewrite ordered
  const attr = t.line.geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const start = t.head % TRAIL_N;
  for (let k = 0; k < TRAIL_N; k++) {
    const src = (start + k) % TRAIL_N;
    arr[k * 3] = t.pos[src * 3];
    arr[k * 3 + 1] = t.pos[src * 3 + 1];
    arr[k * 3 + 2] = t.pos[src * 3 + 2];
  }
  attr.needsUpdate = true;
  t.line.geometry.setDrawRange(0, Math.min(t.head, TRAIL_N));
}

/* ---------- scene ---------- */
function F16Scene({
  started,
  onHud,
}: {
  started: boolean;
  onHud: (h: Hud) => void;
}) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 14,
        blockSize: 70,
        roadWidth: 24,
        seed: 11,
        maxHeight: 120,
      }),
    []
  );
  const keys = useKeys();
  const { yaw: lookYaw, pitch: lookPitch, locked } = usePointerLook(0.0016, 1.4);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const jet = useRef<THREE.Group>(null);
  const burner = useRef<THREE.Mesh>(null);

  const st = useRef({
    pos: new THREE.Vector3(0, 120, city.size / 2 - 60),
    heading: Math.PI, // face -z (city center ahead)... heading 0 = +z
    pitch: 0,
    roll: 0,
    speed: 50,
    throttle: 0.55,
    crashed: false,
    crashFlash: 0,
    cockpit: false,
    barrelT: 0,
    barrelDir: 1,
    prevC: false,
    prevR: false,
    prevSpace: false,
    mousePitch: 0,
    mouseRoll: 0,
    acc: 0,
    hudT: 0,
    camInit: false,
    lastHud: { speed: 0, alt: 0, throttle: 0, crashed: false, cockpit: false },
  });

  // track mouse deltas as control input
  const lastLook = useRef({ yaw: 0, pitch: 0 });

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;

    const cDown = k.has("KeyC");
    if (started && cDown && !s.prevC) s.cockpit = !s.cockpit;
    s.prevC = cDown;
    const rDown = k.has("KeyR");
    if (started && rDown && !s.prevR) reset();
    s.prevR = rDown;
    const spaceDown = k.has("Space");
    if (started && spaceDown && !s.prevSpace && !s.crashed) {
      s.barrelT = 0.8;
      s.barrelDir = s.roll >= 0 ? -1 : 1;
    }
    s.prevSpace = spaceDown;
    if (s.crashFlash > 0) s.crashFlash -= dt;

    if (started && !s.crashed) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
      }
    }

    // ---- jet transform ----
    let visRoll = s.roll;
    if (s.barrelT > 0) {
      s.barrelT -= dt;
      visRoll += (1 - s.barrelT / 0.8) * Math.PI * 2 * s.barrelDir;
    }
    if (jet.current) {
      jet.current.position.copy(s.pos);
      _eul.set(-s.pitch, s.heading, visRoll, "YXZ");
      jet.current.quaternion.setFromEuler(_eul);
    }
    if (burner.current) {
      const ab = k.has("ShiftLeft") || k.has("ShiftRight");
      const sc = 0.6 + s.throttle * 0.9 + (ab ? 0.8 : 0);
      burner.current.scale.set(1, sc, 1);
      (burner.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        1.5 + s.throttle * 2 + (ab ? 3 : 0);
    }

    // ---- contrails ----
    const showTrails = s.speed > 40 && !s.crashed;
    trailL.line.visible = showTrails;
    trailR.line.visible = showTrails;
    if (showTrails && jet.current) {
      _tip.set(-1.9, 0, -1.6).applyQuaternion(jet.current.quaternion).add(s.pos);
      pushTrail(trailL, _tip);
      _tip.set(1.9, 0, -1.6).applyQuaternion(jet.current.quaternion).add(s.pos);
      pushTrail(trailR, _tip);
    }

    // ---- camera ----
    _eul.set(-s.pitch, s.heading, visRoll * 0.4, "YXZ");
    _q.setFromEuler(_eul);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    if (s.cockpit) {
      _camPos.copy(s.pos).addScaledVector(_fwd, 1.8).add(_v.set(0, 0.5, 0).applyQuaternion(_q));
      cam.position.copy(_camPos);
      _look.copy(s.pos).addScaledVector(_fwd, 30);
      cam.up.set(0, 1, 0).applyQuaternion(_q);
      cam.lookAt(_look);
    } else {
      cam.up.set(0, 1, 0);
      _camPos.copy(s.pos).addScaledVector(_fwd, -11).add(_v.set(0, 3.2, 0));
      if (!s.camInit) {
        cam.position.copy(_camPos);
        s.camInit = true;
      } else {
        cam.position.lerp(_camPos, Math.min(1, 6 * dt));
      }
      _look.copy(s.pos).addScaledVector(_fwd, 12);
      cam.lookAt(_look);
    }
    const ab = k.has("ShiftLeft") || k.has("ShiftRight");
    const targetFov = 70 + s.speed * 0.15 + (ab ? 8 : 0);
    cam.fov += (targetFov - cam.fov) * 0.08;
    cam.updateProjectionMatrix();

    // ---- HUD 10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh = {
        speed: Math.round(s.speed * 3.6),
        alt: Math.round(s.pos.y),
        throttle: Math.round(s.throttle * 100),
        crashed: s.crashed,
        cockpit: s.cockpit,
      };
      const o = s.lastHud;
      if (JSON.stringify(nh) !== JSON.stringify(o)) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function reset() {
      s.pos.set(0, 120, city.size / 2 - 60);
      s.heading = Math.PI;
      s.pitch = 0;
      s.roll = 0;
      s.speed = 50;
      s.throttle = 0.55;
      s.crashed = false;
    }

    function step(h: number) {
      const stt = st.current;
      // throttle
      if (k.has("KeyW")) stt.throttle = Math.min(1, stt.throttle + 0.4 * h);
      if (k.has("KeyS")) stt.throttle = Math.max(0, stt.throttle - 0.5 * h);
      const ab = k.has("ShiftLeft") || k.has("ShiftRight");
      const targetSpeed = (11 + stt.throttle * 50) * (ab ? 1.4 : 1);
      stt.speed += (targetSpeed - stt.speed) * Math.min(1, 1.2 * h);

      // mouse control → target pitch/roll
      const dy = lookYaw.current - lastLook.current.yaw;
      const dp = lookPitch.current - lastLook.current.pitch;
      lastLook.current.yaw = lookYaw.current;
      lastLook.current.pitch = lookPitch.current;
      stt.mouseRoll = THREE.MathUtils.clamp(stt.mouseRoll + dy * 3.5, -1.1, 1.1);
      stt.mousePitch = THREE.MathUtils.clamp(
        stt.mousePitch - dp * 2.5,
        -0.9,
        0.9
      );
      // decay toward level
      stt.mouseRoll *= Math.exp(-0.9 * h);
      stt.mousePitch *= Math.exp(-0.6 * h);

      // arrow keys alternative
      if (k.has("ArrowLeft")) stt.mouseRoll = Math.max(-1.1, stt.mouseRoll - 2 * h);
      if (k.has("ArrowRight")) stt.mouseRoll = Math.min(1.1, stt.mouseRoll + 2 * h);
      if (k.has("ArrowUp")) stt.mousePitch = Math.min(0.9, stt.mousePitch + 1.6 * h);
      if (k.has("ArrowDown")) stt.mousePitch = Math.max(-0.9, stt.mousePitch - 1.6 * h);

      stt.roll += (stt.mouseRoll - stt.roll) * Math.min(1, 5 * h);
      stt.pitch += (stt.mousePitch - stt.pitch) * Math.min(1, 4 * h);

      // A/D yaw assist + roll-coordinated turn
      let yawRate = -stt.roll * 1.4 * Math.min(1, stt.speed / 30);
      if (k.has("KeyA")) yawRate += 0.5;
      if (k.has("KeyD")) yawRate -= 0.5;
      stt.heading += yawRate * h;

      // integrate
      _eul.set(-stt.pitch, stt.heading, 0, "YXZ");
      _fwd.set(0, 0, 1).applyEuler(_eul);
      stt.pos.addScaledVector(_fwd, stt.speed * h);

      // soft world bounds: pull back in
      const b = city.bounds.max;
      if (Math.abs(stt.pos.x) > b || Math.abs(stt.pos.z) > b) {
        stt.heading += Math.atan2(-stt.pos.x, -stt.pos.z) * 0; // keep simple: clamp
        stt.pos.x = THREE.MathUtils.clamp(stt.pos.x, -b, b);
        stt.pos.z = THREE.MathUtils.clamp(stt.pos.z, -b, b);
      }
      stt.pos.y = Math.min(400, stt.pos.y);

      // crashes
      if (stt.pos.y <= 1.5) {
        stt.crashed = true;
        stt.crashFlash = 2;
        stt.pos.y = 1.5;
      }
      const col = aabbCollide(stt.pos.x, stt.pos.z, 2.2, city.buildings, stt.pos.y);
      if (col) {
        stt.crashed = true;
        stt.crashFlash = 2;
      }
    }
  });

  return (
    <>
      <City city={city} />
      <Jet group={jet} burner={burner} />
      <primitive object={trailL.line} />
      <primitive object={trailR.line} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.7} intensity={0.9} mipmapBlur />
      </EffectComposer>
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
  });
  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 70, near: 0.1, far: 1500 }}
      >
        <F16Scene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-16 right-6 space-y-2">
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent={ACCENT} />
        <HudStat label="İrtifa" value={`${hud.alt} m`} accent="#7dd3fc" />
        <HudStat label="Gaz" value={`%${hud.throttle}`} accent="#fb923c" />
      </div>
      {hud.crashed && (
        <div className="absolute inset-0 bg-red-900/30 flex items-center justify-center">
          <span className="text-3xl font-extrabold text-red-400 bg-black/60 px-8 py-4 rounded-xl border border-red-500/40">
            Çakıldın! R: yeniden başla
          </span>
        </div>
      )}
      {started && !hud.crashed && (
        <HudCenter text="Fare/ok tuşları: pitch·roll · W/S: gaz · Shift: afterburner · Space: takla · C: kokpit" />
      )}
    </div>
  );
}

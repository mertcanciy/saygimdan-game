"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import City from "./shared/City";
import Car, { CarHandle } from "./shared/Car";
import { generateCity, aabbCollide } from "./shared/city";
import { useKeys } from "./shared/useKeys";
import { HudStat, HudCenter } from "./shared/GameHud";
import { getGame } from "@/lib/games";

const ACCENT = getGame("drift")!.accent;
const SUB = 1 / 120;
const MAX_VF = 45;

const _tmp = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

interface Hud {
  speed: number;
  drifting: boolean;
  chain: number;
  mult: number;
  total: number;
  hit: boolean;
  hood: boolean;
}

/* ---------- tire smoke ---------- */
function makeSmokeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const SMOKE_N = 300;
const _smokeParts = Array.from({ length: SMOKE_N }, () => ({
  pos: new THREE.Vector3(0, -10, 0),
  life: 0,
}));
const _smokeObj = new THREE.Object3D();
const _smokeAlpha = new THREE.InstancedBufferAttribute(
  new Float32Array(SMOKE_N),
  1
);

function TireSmoke({
  emitRef,
}: {
  emitRef: React.MutableRefObject<THREE.Vector3[]>;
}) {
  const tex = useMemo(() => makeSmokeTexture(), []);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aAlpha", _smokeAlpha);
    return g;
  }, []);
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: new THREE.Color(0.82, 0.84, 0.9),
    });
    // real per-instance alpha so puffs stay light grey and never turn black
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float aAlpha; varying float vSmokeAlpha;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvSmokeAlpha = aAlpha;"
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vSmokeAlpha;"
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( diffuse, opacity * vSmokeAlpha );"
        );
    };
    m.customProgramCacheKey = () => "tire-smoke-alpha";
    return m;
  }, [tex]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = _smokeParts;
  const obj = _smokeObj;
  const cursor = useRef(0);
  const emitAcc = useRef(0);

  useFrame(({ camera }, dt) => {
    const im = mesh.current;
    if (!im) return;
    // spawn up to 6/frame from emit points
    emitAcc.current += dt;
    for (const p of emitRef.current) {
      const n = Math.min(3, Math.floor(emitAcc.current * 18));
      for (let k = 0; k < n; k++) {
        const part = parts[cursor.current];
        part.pos.copy(p);
        part.pos.x += (Math.random() - 0.5) * 0.6;
        part.pos.z += (Math.random() - 0.5) * 0.6;
        part.life = 1.2;
        cursor.current = (cursor.current + 1) % SMOKE_N;
      }
    }
    if (emitAcc.current > 0.1) emitAcc.current = 0;

    const alphaArr = _smokeAlpha.array as Float32Array;
    for (let i = 0; i < SMOKE_N; i++) {
      const part = parts[i];
      if (part.life <= 0) {
        obj.position.set(0, -100, 0);
        obj.scale.setScalar(0.001);
        obj.updateMatrix();
        im.setMatrixAt(i, obj.matrix);
        alphaArr[i] = 0;
        continue;
      }
      part.life -= dt;
      part.pos.y += 1.6 * dt;
      const t = 1 - part.life / 1.2;
      obj.position.copy(part.pos);
      obj.quaternion.copy(camera.quaternion);
      obj.scale.setScalar(0.7 + t * 1.8); // max ~2.5 m
      obj.updateMatrix();
      im.setMatrixAt(i, obj.matrix);
      alphaArr[i] = 0.5 * (1 - t);
    }
    im.instanceMatrix.needsUpdate = true;
    _smokeAlpha.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geo, mat, SMOKE_N]}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}

/* ---------- skid marks ---------- */
const SKID_N = 4000; // quads

const _skidGeo = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 3), 3)
  );
  const idx = new Uint32Array(SKID_N * 6);
  for (let i = 0; i < SKID_N; i++) {
    const o = i * 4;
    const io = i * 6;
    idx[io] = o;
    idx[io + 1] = o + 1;
    idx[io + 2] = o + 2;
    idx[io + 3] = o;
    idx[io + 4] = o + 2;
    idx[io + 5] = o + 3;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  return g;
})();

function SkidMarks({ emitRef }: { emitRef: React.MutableRefObject<THREE.Vector3[]> }) {
  const geo = _skidGeo;

  const cursor = useRef(0);
  const lastL = useRef<THREE.Vector3 | null>(null);
  const lastR = useRef<THREE.Vector3 | null>(null);

  useFrame(() => {
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const pts = emitRef.current;
    const dirty = pts.length === 2;
    if (!dirty) {
      lastL.current = null;
      lastR.current = null;
      return;
    }
    const [pl, pr] = pts;
    if (lastL.current && lastR.current) {
      for (const [prev, cur] of [
        [lastL.current, pl],
        [lastR.current, pr],
      ] as const) {
        const i = cursor.current % SKID_N;
        const o = i * 12;
        const a = posAttr.array as Float32Array;
        // quad: prev-left, cur-left, cur-right... use width dir
        _tmp.copy(cur).sub(prev);
        if (_tmp.lengthSq() < 0.0004) continue;
        _right.set(-_tmp.z, 0, _tmp.x).normalize().multiplyScalar(0.22);
        const y = 0.02;
        a[o] = prev.x - _right.x; a[o + 1] = y; a[o + 2] = prev.z - _right.z;
        a[o + 3] = cur.x - _right.x; a[o + 4] = y; a[o + 5] = cur.z - _right.z;
        a[o + 6] = cur.x + _right.x; a[o + 7] = y; a[o + 8] = cur.z + _right.z;
        a[o + 9] = prev.x + _right.x; a[o + 10] = y; a[o + 11] = prev.z + _right.z;
        cursor.current++;
      }
      posAttr.needsUpdate = true;
      geo.setDrawRange(0, Math.min(cursor.current, SKID_N) * 6);
    }
    lastL.current = (lastL.current ?? new THREE.Vector3()).copy(pl);
    lastR.current = (lastR.current ?? new THREE.Vector3()).copy(pr);
  });

  return (
    <mesh geometry={geo} frustumCulled={false}>
      <meshBasicMaterial
        color="#000000"
        transparent
        opacity={0.85}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-4}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ---------- neon ring around the plaza ---------- */
const _ringObj = new THREE.Object3D();
const _ringCol = new THREE.Color();

function PlazaRing({ radius }: { radius: number }) {
  const N = 24;
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const obj = _ringObj;
    const col = _ringCol;
    const im = mesh.current;
    if (!im) return;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      obj.position.set(Math.cos(a) * radius, 3.2, Math.sin(a) * radius);
      obj.scale.setScalar(1);
      obj.updateMatrix();
      im.setMatrixAt(i, obj.matrix);
      col.setHSL((i / N + 0.8) % 1, 1, 0.6);
      im.setColorAt(i, col);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [radius]);
  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
        <sphereGeometry args={[0.4, 10, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.2} />
      </instancedMesh>
      {Array.from({ length: N }).map((_, i) => {
        const a = (i / N) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, 1.6, Math.sin(a) * radius]}>
            <cylinderGeometry args={[0.08, 0.08, 3.2, 5]} />
            <meshStandardMaterial color="#11121a" />
          </mesh>
        );
      })}
    </group>
  );
}

/* ---------- main scene ---------- */
function DriftScene({
  started,
  onHud,
}: {
  started: boolean;
  onHud: (h: Hud) => void;
}) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 12,
        blockSize: 60,
        roadWidth: 22,
        seed: 3,
        maxHeight: 60,
        plazaBlocks: 2,
      }),
    []
  );
  const keys = useKeys();
  const car = useRef<CarHandle>(null);
  const smokeEmit = useRef<THREE.Vector3[]>([]);
  const skidEmit = useRef<THREE.Vector3[]>([]);
  const plazaR = (city.plaza?.w ?? 100) / 2 - 12;

  const st = useRef({
    pos: new THREE.Vector3(0, 0, 8),
    vel: new THREE.Vector3(),
    heading: 0,
    steer: 0,
    driftTime: 0,
    chain: 0,
    bankTimer: 0,
    total: 0,
    hitFlash: 0,
    hood: false,
    mult: 1,
    prevC: false,
    prevR: false,
    acc: 0,
    hudT: 0,
    camInit: false,
    lastHud: {
      speed: 0,
      drifting: false,
      chain: 0,
      mult: 1,
      total: 0,
      hit: false,
      hood: false,
    },
  });

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;

    // camera toggle (edge)
    const cDown = k.has("KeyC");
    if (started && cDown && !s.prevC) s.hood = !s.hood;
    s.prevC = cDown;
    // reset (edge)
    const rDown = k.has("KeyR");
    if (started && rDown && !s.prevR) {
      s.pos.set(0, 0, 8);
      s.vel.set(0, 0, 0);
      s.heading = 0;
      s.chain = 0;
    }
    s.prevR = rDown;
    if (s.hitFlash > 0) s.hitFlash -= dt;

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
    const drifting = slip > (15 * Math.PI) / 180 && speed > 8;

    // ---- car transform ----
    const g = car.current;
    if (g?.group) {
      g.group.position.set(s.pos.x, 0.02, s.pos.z);
      g.group.rotation.y = s.heading;
      // body roll into drift
      g.group.rotation.z = THREE.MathUtils.clamp(-vR * 0.02, -0.12, 0.12);
      for (const w of g.frontAxle) {
        if (w) w.rotation.y = s.steer * 0.5;
      }
      const wheelSpin = (vF / 0.33) * dt;
      for (const w of g.wheels) {
        if (w) w.rotation.x += wheelSpin;
      }
      if (g.tailMat) {
        g.tailMat.emissiveIntensity =
          k.has("KeyS") || k.has("Space") ? 4 : 1.5;
      }
    }

    // ---- emit points (rear wheels, world space) ----
    if (drifting && started) {
      _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
      _right.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
      const l = _tmp
        .copy(s.pos)
        .addScaledVector(_fwd, -1.4)
        .addScaledVector(_right, -0.9);
      const r = s.pos
        .clone()
        .addScaledVector(_fwd, -1.4)
        .addScaledVector(_right, 0.9);
      l.y = 0.25;
      r.y = 0.25;
      smokeEmit.current = [l.clone(), r];
      skidEmit.current = [l, r];
    } else {
      smokeEmit.current = [];
      skidEmit.current = [];
    }

    // ---- camera ----
    _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    const velDirLen = Math.hypot(s.vel.x, s.vel.z);
    let hx = _fwd.x;
    let hz = _fwd.z;
    if (velDirLen > 2) {
      // blend heading 0.6 / velocity dir 0.4
      hx = _fwd.x * 0.6 + (s.vel.x / velDirLen) * 0.4;
      hz = _fwd.z * 0.6 + (s.vel.z / velDirLen) * 0.4;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl;
      hz /= hl;
    }
    if (s.hood) {
      _camPos.copy(s.pos).addScaledVector(_fwd, 0.6).setY(1.15);
      _look.copy(s.pos).addScaledVector(_fwd, 10).setY(1.0);
      cam.position.copy(_camPos);
      cam.lookAt(_look);
    } else {
      _camPos
        .copy(s.pos)
        .addScaledVector(_tmp.set(hx, 0, hz), -7)
        .setY(3);
      // tiny shake with speed
      _camPos.y += Math.sin(performance.now() * 0.05) * Math.min(0.05, speed * 0.001);
      if (!s.camInit) {
        cam.position.copy(_camPos);
        s.camInit = true;
      } else {
        cam.position.lerp(_camPos, 0.1);
      }
      _look.copy(s.pos).addScaledVector(_fwd, 3).setY(0.8);
      cam.lookAt(_look);
    }
    cam.fov += (70 + Math.min(12, speed * 0.28) - cam.fov) * 0.08;
    cam.updateProjectionMatrix();

    // ---- score ----
    if (drifting) {
      s.driftTime += dt;
      const mult = 1 + Math.min(2, Math.floor(s.driftTime / 2) * 0.5);
      s.chain += speed * slip * dt * 10 * mult;
      s.bankTimer = 0;
      s.mult = mult;
    } else {
      s.driftTime = 0;
      s.mult = 1;
      s.bankTimer += dt;
      if (s.chain > 0 && s.bankTimer > 1.5) {
        s.total += Math.round(s.chain);
        s.chain = 0;
      }
    }

    // ---- HUD 10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh = {
        speed: Math.round(speed * 3.6),
        drifting,
        chain: Math.round(s.chain),
        mult: s.mult,
        total: s.total,
        hit: s.hitFlash > 0,
        hood: s.hood,
      };
      const o = s.lastHud;
      if (JSON.stringify(nh) !== JSON.stringify(o)) {
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
      // throttle / brake
      if (k.has("KeyW")) vF = Math.min(MAX_VF, vF + 22 * h);
      else if (k.has("KeyS")) {
        if (vF > 0.5) vF = Math.max(0, vF - 30 * h);
        else vF = Math.max(-8, vF - 12 * h);
      }

      // steering
      const steerIn = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
      const rate = steerIn !== 0 ? 4 : 6;
      stt.steer += THREE.MathUtils.clamp(steerIn - stt.steer, -rate * h, rate * h);

      const spdFactor = THREE.MathUtils.clamp(Math.abs(vF) / 12, 0, 1);
      const speedDrop = 1 - 0.5 * THREE.MathUtils.clamp(vF / MAX_VF, 0, 1);
      const driftBoost = handbrake || Math.abs(vR) > 4 ? 1.6 : 1;
      stt.heading +=
        stt.steer * 2.4 * spdFactor * speedDrop * driftBoost * Math.sign(vF || 1) * h;

      // grip / drift slip
      const slipNow = Math.abs(Math.atan2(vR, Math.abs(vF)));
      const driftingNow = handbrake || slipNow > (20 * Math.PI) / 180;
      const grip = driftingNow ? 2.2 : 9;
      vR *= Math.exp(-grip * h);
      if (handbrake) vF *= Math.exp(-1.5 * h);

      stt.vel.set(
        fwdX * vF + rgtX * vR,
        0,
        fwdZ * vF + rgtZ * vR
      );
      stt.vel.multiplyScalar(Math.exp(-0.35 * h));
      stt.pos.addScaledVector(stt.vel, h);

      // collision with buildings
      const col = aabbCollide(stt.pos.x, stt.pos.z, 1.4, city.buildings);
      if (col) {
        stt.pos.x += col.x;
        stt.pos.z += col.z;
        // reflect velocity along push-out normal with 0.3 restitution
        _tmp.set(col.x, 0, col.z).normalize();
        const vn = stt.vel.dot(_tmp);
        if (vn < 0) stt.vel.addScaledVector(_tmp, -vn * 1.3);
        if (stt.chain > 0) stt.hitFlash = 1.5;
        stt.chain = 0;
        stt.driftTime = 0;
      }

      // keep inside world
      const b = city.bounds.max + 40;
      stt.pos.x = THREE.MathUtils.clamp(stt.pos.x, -b, b);
      stt.pos.z = THREE.MathUtils.clamp(stt.pos.z, -b, b);
    }
  });

  return (
    <>
      <City city={city} />
      <PlazaRing radius={plazaR} />
      <Car ref={car} color="#d81b60" glow={ACCENT} />
      <TireSmoke emitRef={smokeEmit} />
      <SkidMarks emitRef={skidEmit} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.7} intensity={0.9} mipmapBlur />
      </EffectComposer>
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
  });

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 70, near: 0.1, far: 1500 }}
      >
        <DriftScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-16 right-6 space-y-2">
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent={ACCENT} />
        <HudStat
          label="Drift Puanı"
          value={`${hud.chain}${hud.mult > 1 ? ` ×${hud.mult.toFixed(1)}` : ""}`}
          accent="#fb923c"
        />
        <HudStat label="Toplam" value={`${hud.total}`} accent="#e879f9" />
      </div>
      {hud.drifting && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2">
          <span
            className="text-3xl font-black italic tracking-widest animate-pulse"
            style={{ color: ACCENT, textShadow: `0 0 25px ${ACCENT}` }}
          >
            DRIFT
          </span>
        </div>
      )}
      {hud.hit && (
        <div className="absolute top-1/3 inset-x-0 flex justify-center pointer-events-none">
          <span className="text-2xl font-bold text-red-500 animate-ping-once">
            Çarptın!
          </span>
        </div>
      )}
      {started && !hud.drifting && hud.chain === 0 && (
        <HudCenter text="W: gaz · Space (basılı): el freni → drift · R: sıfırla · C: kamera" />
      )}
      <style jsx>{`
        @keyframes ping-once {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          30% {
            transform: scale(1.1);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-ping-once {
          animation: ping-once 0.5s ease-out both;
        }
      `}</style>
    </div>
  );
}

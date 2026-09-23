"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import City from "./shared/City";
import {
  generateCity,
  aabbCollide,
  raycastBuildings,
  groundHeightAt,
} from "./shared/city";
import { useKeys } from "./shared/useKeys";
import { usePointerLook } from "./shared/usePointerLook";
import { HudStat, HudCenter } from "./shared/GameHud";
import { getGame } from "@/lib/games";

const ACCENT = getGame("spiderman")!.accent;
const GRAV = 32;
const SUB = 1 / 120;
const MAX_SPEED = 55;

// scratch objects (no per-frame allocation)
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface Hud {
  speed: number;
  height: number;
  locked: boolean;
  attached: boolean;
}

function Hero({
  group,
  armRight,
}: {
  group: React.RefObject<THREE.Group | null>;
  armRight: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={group}>
      {/* torso */}
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[0.6, 0.9, 0.35]} />
        <meshStandardMaterial color="#d0192b" roughness={0.6} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.24, 16, 12]} />
        <meshStandardMaterial color="#d0192b" roughness={0.5} />
      </mesh>
      {/* eyes */}
      {[-0.09, 0.09].map((x) => (
        <mesh key={x} position={[x, 1.78, 0.2]}>
          <boxGeometry args={[0.11, 0.05, 0.02]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={2}
          />
        </mesh>
      ))}
      {/* legs */}
      {[-0.16, 0.16].map((x) => (
        <mesh key={`l${x}`} position={[x, 0.3, 0]}>
          <boxGeometry args={[0.2, 0.65, 0.22]} />
          <meshStandardMaterial color="#1a3fb5" roughness={0.7} />
        </mesh>
      ))}
      {/* left arm */}
      <group position={[-0.38, 1.35, 0]}>
        <mesh position={[0, -0.3, 0]}>
          <boxGeometry args={[0.16, 0.6, 0.18]} />
          <meshStandardMaterial color="#d0192b" roughness={0.6} />
        </mesh>
      </group>
      {/* right arm (points at web anchor) */}
      <group ref={armRight} position={[0.38, 1.35, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.16, 0.6, 0.18]} />
          <meshStandardMaterial color="#d0192b" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

const SPEED_SEEDS = Array.from({ length: 40 }, () => ({
  x: (Math.random() - 0.5) * 14,
  y: (Math.random() - 0.5) * 10,
  z: (Math.random() - 0.5) * 20,
  o: Math.random() * 20,
}));
const _lineObj = new THREE.Object3D();
const COUNT = 40;

function SpeedLines({ speedRef }: { speedRef: React.MutableRefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seeds = SPEED_SEEDS;
  const obj = _lineObj;

  useFrame(({ camera }) => {
    const im = mesh.current;
    if (!im) return;
    const sp = speedRef.current;
    const vis = sp > 30;
    im.visible = vis;
    if (!vis) return;
    const stretch = Math.min(6, sp * 0.09);
    obj.quaternion.copy(camera.quaternion);
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      const z = ((s.z + s.o + performance.now() * 0.001 * sp) % 20) - 10;
      obj.position.copy(camera.position);
      _tmp.set(s.x, s.y, z - 4).applyQuaternion(camera.quaternion);
      obj.position.add(_tmp);
      obj.scale.set(0.02, 0.02, stretch);
      obj.updateMatrix();
      im.setMatrixAt(i, obj.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color="#aaccff"
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

function SpidermanScene({
  started,
  onHud,
}: {
  started: boolean;
  onHud: (h: Hud) => void;
}) {
  const city = useMemo(
    () =>
      generateCity({
        blocks: 10,
        blockSize: 45,
        roadWidth: 14,
        seed: 7,
        maxHeight: 140,
      }),
    []
  );
  const keys = useKeys();
  const { yaw, pitch, locked } = usePointerLook();
  const gl = useThree((s) => s.gl);

  const hero = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const webLine = useRef<THREE.Mesh>(null);
  const speedRef = useRef(0);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const st = useRef({
    // spawn on the central N-S road (x=7), looking -z toward the city core
    pos: new THREE.Vector3(7, 0, 50),
    vel: new THREE.Vector3(),
    web: null as { anchor: THREE.Vector3; len: number } | null,
    holding: false,
    acc: 0,
    hudT: 0,
    camInit: false,
    lastHud: { speed: 0, height: 0, locked: false, attached: false },
  });

  // web attach/detach input
  const attachWeb = () => {
    const s = st.current;
    const origin = _tmp.copy(s.pos).setY(s.pos.y + 1.5);
    // camera forward pitched up 35deg, then 60deg fallback, then sky anchor
    for (const up of [0.61, 1.05]) {
      _fwd.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      _d.copy(_fwd).multiplyScalar(Math.cos(up)).setY(Math.sin(up));
      _d.normalize();
      const hit = raycastBuildings(origin, _d, 90, city.buildings);
      if (hit) {
        const a = new THREE.Vector3(
          hit.point.x,
          Math.min(hit.point.y, hit.building.h),
          hit.point.z
        );
        s.web = { anchor: a, len: clampLen(s.pos.distanceTo(a)) };
        launch();
        return;
      }
    }
    // sky anchor: 40m ahead, 45m up — still produces a forward pendulum
    const a = origin
      .clone()
      .addScaledVector(_fwd, 40)
      .add(new THREE.Vector3(0, 45, 0));
    st.current.web = { anchor: a, len: clampLen(st.current.pos.distanceTo(a)) };
    launch();
  };
  // get airborne when attaching from standstill so the pendulum engages
  const launch = () => {
    const s = st.current;
    if (s.vel.length() < 5 || s.pos.y < groundHeightAt(s.pos.x, s.pos.z, s.pos.y, city.buildings) + 0.2) {
      s.vel.y += 9;
      _fwd.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      s.vel.addScaledVector(_fwd, 6);
    }
  };
  const clampLen = (l: number) => Math.min(70, Math.max(12, l));

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);

    // input edge detection
    const attachKey = keys.current.has("KeyE");
    if (started && !s.holding && attachKey) {
      s.holding = true;
      attachWeb();
    }
    if (!attachKey && s.holding && !mouseDown.current) s.holding = false;
    if (!s.holding && s.web) {
      s.web = null;
      s.vel.y += 3; // release boost
    }

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
      }
    }

    // ---- render-side updates ----
    const h = hero.current;
    if (h) {
      h.position.copy(s.pos);
      // face velocity horizontally + lean forward with speed
      const hv = Math.hypot(s.vel.x, s.vel.z);
      if (hv > 0.5) {
        h.rotation.y = Math.atan2(s.vel.x, s.vel.z);
        h.rotation.x = Math.min(0.7, hv / 60);
      } else h.rotation.x = 0;
      // swing wobble
      if (s.web) h.rotation.z = Math.sin(performance.now() * 0.006) * 0.12;
      else h.rotation.z = 0;
    }
    // right arm aims at anchor
    if (armRight.current) {
      if (s.web && h) {
        _d.copy(s.web.anchor).sub(s.pos).normalize();
        // rotate local +Y toward anchor dir (arm points up)
        const ang = Math.acos(THREE.MathUtils.clamp(_d.y, -1, 1));
        const axis = _n.crossVectors(_up, _d).normalize();
        armRight.current.quaternion.setFromAxisAngle(
          axis.lengthSq() < 0.001 ? _fwd.set(1, 0, 0) : axis,
          ang
        );
      } else {
        armRight.current.quaternion.identity();
      }
    }
    // web line
    if (webLine.current) {
      if (s.web && h) {
        webLine.current.visible = true;
        const hand = _tmp.copy(s.pos).add(_n.set(0.38, 1.65, 0));
        const anchor = s.web.anchor;
        _d.copy(anchor).sub(hand);
        const len = _d.length();
        webLine.current.position.copy(hand).addScaledVector(_d, 0.5);
        webLine.current.quaternion.setFromUnitVectors(_up, _d.normalize());
        webLine.current.scale.set(0.03, len, 0.03);
      } else webLine.current.visible = false;
    }

    // ---- camera ----
    speedRef.current = s.vel.length();
    const dist = 7 + Math.min(3, speedRef.current / 18);
    _camTarget.copy(s.pos).add(_tmp.set(0, 1.5, 0));
    const cp = Math.cos(pitch.current);
    _camPos.set(
      Math.sin(yaw.current) * cp,
      -Math.sin(pitch.current),
      Math.cos(yaw.current) * cp
    ).multiplyScalar(dist).add(_camTarget);
    // keep camera out of buildings: ray from target to camPos
    _d.copy(_camPos).sub(_camTarget);
    const cd = _d.length();
    _d.normalize();
    const hit = raycastBuildings(_camTarget, _d, cd, city.buildings);
    if (hit) _camPos.copy(_camTarget).addScaledVector(_d, Math.max(1.2, hit.dist * 0.9));
    if (!s.camInit) {
      camera.position.copy(_camPos);
      s.camInit = true;
    } else {
      camera.position.lerp(_camPos, 0.15);
    }
    cam.lookAt(_camTarget);
    const targetFov = 70 + Math.min(15, speedRef.current / 55) * 15;
    cam.fov += (targetFov - cam.fov) * 0.1;
    cam.updateProjectionMatrix();

    // ---- HUD throttle ~10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh = {
        speed: Math.round(speedRef.current * 3.6),
        height: Math.round(s.pos.y),
        locked: lockedRef.current,
        attached: !!s.web,
      };
      const o = s.lastHud;
      if (
        nh.speed !== o.speed ||
        nh.height !== o.height ||
        nh.locked !== o.locked ||
        nh.attached !== o.attached
      ) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function step(h: number) {
      const stt = st.current;
      const k = keys.current;
      // camera-space wish dir
      _fwd.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      _right.copy(_fwd).cross(_up);
      _wish.set(0, 0, 0);
      if (k.has("KeyW")) _wish.add(_fwd);
      if (k.has("KeyS")) _wish.sub(_fwd);
      if (k.has("KeyD")) _wish.add(_right);
      if (k.has("KeyA")) _wish.sub(_right);
      if (_wish.lengthSq() > 0) _wish.normalize();

      const groundY = groundHeightAt(
        stt.pos.x,
        stt.pos.z,
        stt.pos.y,
        city.buildings
      );
      const onGround = stt.pos.y <= groundY + 0.05 && stt.vel.y <= 0;

      stt.vel.y -= GRAV * h;
      if (stt.pos.y > 120) stt.vel.y -= (stt.pos.y - 120) * 2 * h;

      if (onGround) {
        // run
        const target = _wish.multiplyScalar(12);
        stt.vel.x += (target.x - stt.vel.x) * Math.min(1, 40 * h);
        stt.vel.z += (target.z - stt.vel.z) * Math.min(1, 40 * h);
        if (k.has("Space")) stt.vel.y = 14;
      } else {
        stt.vel.addScaledVector(_wish, 6 * h);
      }

      // web constraint
      const web = stt.web;
      if (web && stt.holding) {
        _fwd.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
        stt.vel.addScaledVector(_fwd, 14 * h); // swing pump
        web.len = Math.max(12, web.len - 4 * h); // reel in while holding
        if (stt.vel.length() > MAX_SPEED) stt.vel.setLength(MAX_SPEED);
        stt.pos.addScaledVector(stt.vel, h);
        _d.copy(stt.pos).sub(web.anchor);
        const dl = _d.length();
        if (dl > web.len) {
          _d.normalize();
          stt.pos.copy(web.anchor).addScaledVector(_d, web.len);
          const vr = stt.vel.dot(_d);
          if (vr > 0) stt.vel.addScaledVector(_d, -vr);
        }
      } else {
        stt.pos.addScaledVector(stt.vel, h);
      }

      // collisions
      const col = aabbCollide(
        stt.pos.x,
        stt.pos.z,
        0.45,
        city.buildings,
        stt.pos.y - 0.2
      );
      if (col) {
        stt.pos.x += col.x;
        stt.pos.z += col.z;
        if (col.x !== 0) stt.vel.x = 0;
        if (col.z !== 0) stt.vel.z = 0;
      }
      // ground / roofs
      const gy = groundHeightAt(
        stt.pos.x,
        stt.pos.z,
        stt.pos.y,
        city.buildings
      );
      if (stt.pos.y < gy) {
        stt.pos.y = gy;
        if (stt.vel.y < 0) stt.vel.y = 0;
      }
      if (stt.pos.y < 0) {
        stt.pos.y = 0;
        stt.vel.y = 0;
      }
      // world bounds
      const b = city.bounds.max + 60;
      stt.pos.x = THREE.MathUtils.clamp(stt.pos.x, -b, b);
      stt.pos.z = THREE.MathUtils.clamp(stt.pos.z, -b, b);
    }
  });

  // mouse web attach (left button while locked)
  const mouseDown = useRef(false);
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: Event) => {
      if ((e as MouseEvent).button !== 0 || document.pointerLockElement !== el)
        return;
      mouseDown.current = true;
      st.current.holding = true;
      attachWeb();
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouseDown.current = false;
      st.current.holding = false;
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("pointerdown", down);
    window.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  return (
    <>
      <City city={city} />
      <Hero group={hero} armRight={armRight} />
      <mesh ref={webLine} visible={false}>
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshBasicMaterial color="#eeeeff" />
      </mesh>
      <SpeedLines speedRef={speedRef} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.7} intensity={0.9} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function Spiderman({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    height: 0,
    locked: false,
    attached: false,
  });
  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 70, near: 0.1, far: 1500 }}
      >
        <SpidermanScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-16 right-6 space-y-2">
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent={ACCENT} />
        <HudStat label="Yükseklik" value={`${hud.height} m`} accent="#7dd3fc" />
      </div>
      {started && !hud.locked && (
        <HudCenter text="Tıkla: fareyi kilitle · Sol tık basılı: ağ at" />
      )}
    </div>
  );
}

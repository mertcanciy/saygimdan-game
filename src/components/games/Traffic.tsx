"use client";

import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { mulberry32 } from "./shared/cityGen";
import { useKeys } from "./shared/useKeys";
import Particles, { type ParticleHandle } from "./shared/Particles";
import { WorldAtmosphere, WorldEffects, CANVAS_GL } from "./shared/World";
import { HudStat, HudBanner, HudModal, HudBar, HudCenter } from "./shared/GameHud";
import Highway, { LANE_W, LANES, ONCOMING_X, REBASE } from "./cars/Highway";
import Cockpit from "./cars/Cockpit";
import Car, { type CarHandle } from "./shared/Car";
import TrafficFleet, { type FleetCar } from "./cars/TrafficFleet";
import { buildCar, type CarType } from "./cars/carGeometry";
import { beamTexture, TRAFFIC_PAINTS } from "./cars/carMaterials";
import { getGame } from "@/lib/games";

const ACCENT = getGame("traffic")!.accent;
const SUB = 1 / 120;
const MAX_SPEED = 62; // m/s ≈ 223 km/h
const EYE_Y = 1.09;
const PLAYER_HALF_W = 0.95;
const PLAYER_HALF_L = 2.25;
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

interface Hud {
  speed: number;
  score: number;
  combo: number;
  crashed: boolean;
  nitro: number;
  distance: number;
  bannerId: number;
  bannerText: string;
  best: number;
}

/* ---------- traffic model ---------- */
const TRAFFIC_N = 28;
const ONCOMING_N = 14;
const TYPE_POOL: CarType[] = ["sedan", "sedan", "sedan", "hatch", "hatch", "hatch", "suv", "suv", "suv", "van", "van", "bus", "truck", "truck"];

interface TrafficCar extends FleetCar {
  lane: number;
  targetLane: number;
  laneT: number;
  cruise: number;
  speed: number;
  passed: boolean;
  halfW: number;
  halfL: number;
  blinkT: number;
}

interface OncomingCar extends FleetCar {
  speed: number;
}

function heavy(t: CarType) {
  return t === "bus" || t === "truck";
}

function TrafficScene({ started, onHud }: { started: boolean; onHud: (h: Hud) => void }) {
  const keys = useKeys();
  const headlight = useRef<THREE.SpotLight>(null);
  const headTarget = useMemo(() => new THREE.Object3D(), []);
  const beam = useRef<THREE.Mesh>(null);
  const sparks = useRef<ParticleHandle>(null);
  const playerZ = useRef(0);
  const shift = useRef(0);
  const steerVis = useRef(0);
  const kmhVis = useRef(0);
  const rpmVis = useRef(0);
  const focus = useRef(new THREE.Vector3());
  const rand = useMemo(() => mulberry32(1234), []);
  const beamTex = useMemo(() => beamTexture(), []);
  const debugCam = useMemo(
    () => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("cam") : null),
    []
  );
  const playerCar = useRef<CarHandle>(null);

  const st = useRef({
    pz: 0,
    px: LANE_W,
    vx: 0,
    speed: 20,
    score: 0,
    best: 0,
    combo: 0,
    comboT: 0,
    crashT: 0,
    nitro: 0.5,
    distAcc: 0,
    distance: 0,
    bannerId: 0,
    bannerText: "",
    bannerT: 0,
    shake: 0,
    acc: 0,
    hudT: 0,
    t: 0,
    gear: 1,
    lastHud: null as Hud | null,
  });

  const makeCars = (): TrafficCar[] => {
    const r = mulberry32(777);
    return Array.from({ length: TRAFFIC_N }, (_, i) => {
      const type = TYPE_POOL[Math.floor(r() * TYPE_POOL.length)];
      const lane = heavy(type) ? LANES - 1 - Math.floor(r() * 2) : Math.floor(r() * LANES);
      const spec = buildCar(type, 0).spec;
      const cruise = heavy(type) ? 14 + r() * 5 : 17 + r() * 11;
      return {
        type,
        color: new THREE.Color(heavy(type) && r() < 0.6 ? "#e8e8e4" : TRAFFIC_PAINTS[Math.floor(r() * TRAFFIC_PAINTS.length)]),
        x: lane * LANE_W,
        y: 0,
        z: -60 - i * 30 - r() * 20,
        rotY: Math.PI,
        visible: true,
        brake: 0,
        lane,
        targetLane: lane,
        laneT: 1,
        cruise,
        speed: cruise,
        passed: false,
        halfW: spec.W / 2,
        halfL: spec.L / 2,
        blinkT: 0,
      };
    });
  };
  const makeOncoming = (): OncomingCar[] => {
    const r = mulberry32(999);
    return Array.from({ length: ONCOMING_N }, (_, i) => {
      const type = TYPE_POOL[Math.floor(r() * TYPE_POOL.length)];
      return {
        type,
        color: new THREE.Color(TRAFFIC_PAINTS[Math.floor(r() * TRAFFIC_PAINTS.length)]),
        x: ONCOMING_X[heavy(type) ? 2 : Math.floor(r() * 3)],
        y: 0,
        z: -80 - i * 70 - r() * 40,
        rotY: 0,
        visible: true,
        speed: heavy(type) ? 16 + r() * 4 : 20 + r() * 12,
      };
    });
  };
  // simulation state lives in a ref (mutated every frame); the fleet renderer
  // reads the very same objects
  const [world] = useState(() => {
    const cars = makeCars();
    const oncoming = makeOncoming();
    return { cars, oncoming, fleet: [...cars, ...oncoming] as FleetCar[] };
  });
  const sim = useRef(world);

  const banner = (text: string) => {
    const s = st.current;
    s.bannerId++;
    s.bannerText = text;
    s.bannerT = 1.0;
  };

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const { cars, oncoming } = sim.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30);
    const k = keys.current;
    s.t += dt;

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        step(SUB);
        s.acc -= SUB;
      }
    }
    if (s.bannerT > 0) s.bannerT -= dt;
    if (s.crashT > 0) s.crashT -= dt;
    if (s.comboT > 0) {
      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 0;
    }
    s.shake = Math.max(0, s.shake - dt * 2);

    // floating origin: keep the player within one strip period of z = 0 so
    // the sky dome, stars and float precision all stay happy
    if (s.pz < -REBASE) {
      const k2 = Math.floor(-s.pz / REBASE) * REBASE;
      s.pz += k2;
      for (const c of cars) c.z += k2;
      for (const c of oncoming) c.z += k2;
      shift.current += k2;
    }

    playerZ.current = s.pz;
    focus.current.set(s.px, 0, s.pz);
    steerVis.current += (s.vx / 9 - steerVis.current) * Math.min(1, 10 * dt);
    kmhVis.current = s.speed * 3.6;
    // fake 6-speed gearbox for the rev counter
    const gearTop = [0, 14, 24, 34, 44, 54, 70];
    while (s.gear < 6 && s.speed > gearTop[s.gear]) s.gear++;
    while (s.gear > 1 && s.speed < gearTop[s.gear - 1] - 3) s.gear--;
    const lo = gearTop[s.gear - 1];
    const hi = gearTop[s.gear];
    const targetRpm = 1.2 + ((s.speed - lo) / (hi - lo)) * 5.6;
    rpmVis.current += (THREE.MathUtils.clamp(targetRpm, 0.9, 7.6) - rpmVis.current) * Math.min(1, 8 * dt);

    if (headlight.current) {
      headlight.current.position.set(s.px + 0.0, 0.75, s.pz - 2.4);
      headTarget.position.set(s.px + s.vx * 0.5, 0, s.pz - 45);
      headTarget.updateMatrixWorld();
    }
    if (beam.current) {
      beam.current.position.set(s.px, 0.035, s.pz - 12.5);
      beam.current.rotation.set(-Math.PI / 2, 0, Math.PI - s.vx * 0.03);
    }

    // camera: driver's eye, with road-feel shake and lean into lane changes
    const nitro = (k.has("ShiftLeft") || k.has("ShiftRight")) && s.nitro > 0.02 && started;
    const rough = Math.min(0.012, s.speed * 0.00018) + s.shake * 0.06 + (nitro ? 0.006 : 0);
    cam.position.set(
      s.px - 0.36 + Math.sin(s.t * 31) * rough,
      EYE_Y + Math.sin(s.t * 27.3 + 1.1) * rough + Math.sin(s.t * 3.1) * 0.004,
      s.pz + 0.6
    );
    cam.lookAt(s.px - 0.36 + s.vx * 0.45, EYE_Y - 0.7, s.pz - 30);
    cam.rotateZ(-s.vx * 0.006);
    cam.fov += (66 + s.speed * 0.16 + (nitro ? 7 : 0) - cam.fov) * Math.min(1, 5 * dt);
    if (debugCam) {
      // debug views (?cam=chase / ?cam=side) — third person, cockpit hidden
      if (debugCam === "side") {
        cam.position.set(s.px - 9, 1.6, s.pz - 6);
        cam.lookAt(s.px + 2, 1, s.pz - 16);
      } else if (debugCam === "low") {
        cam.position.set(s.px + 1.6, 1.5, s.pz + 7);
        cam.lookAt(s.px + 1, 1.0, s.pz - 30);
      } else {
        cam.position.set(s.px, 4.2, s.pz + 11);
        cam.lookAt(s.px, 1.2, s.pz - 25);
      }
      cam.fov = 55;
    }
    cam.updateProjectionMatrix();
    const pc = playerCar.current?.group;
    if (pc) {
      pc.position.set(s.px, 0, s.pz);
      pc.rotation.y = Math.PI - s.vx * 0.02;
    }

    // ---- same-direction traffic (moves towards -Z) ----
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (started) {
        // car-following: slow down behind a slower car (or the player)
        let gapMin = Infinity;
        let leadSpeed = c.cruise;
        for (let j = 0; j < cars.length; j++) {
          if (j === i) continue;
          const o = cars[j];
          if (Math.abs(o.x - c.x) > 2.4) continue;
          const gap = c.z - o.z - c.halfL - o.halfL;
          if (gap > 0 && gap < gapMin) {
            gapMin = gap;
            leadSpeed = o.speed;
          }
        }
        if (Math.abs(s.px - c.x) < 2.4) {
          const gap = c.z - s.pz - c.halfL - PLAYER_HALF_L;
          if (gap > 0 && gap < gapMin) {
            gapMin = gap;
            leadSpeed = s.speed;
          }
        }
        let target = c.cruise;
        if (gapMin < 32) target = Math.min(target, leadSpeed + (gapMin - 12) * 0.25);
        target = Math.max(0, target);
        const accel = target < c.speed ? 7 : 2.5;
        c.speed += THREE.MathUtils.clamp(target - c.speed, -accel * dt, accel * dt);
        c.brake = target < c.speed - 0.3 || (gapMin < 16 && leadSpeed < c.speed) ? 1 : Math.max(0, (c.brake ?? 0) - dt * 3);
        c.z -= c.speed * dt;

        // overtake when stuck behind a slower car
        if (c.laneT >= 1 && gapMin < 28 && leadSpeed < c.cruise - 3 && !heavy(c.type) && rand() < dt * 1.2) {
          const dir = rand() < 0.5 ? -1 : 1;
          for (const d of [dir, -dir]) {
            const nl = c.lane + d;
            if (nl < 0 || nl >= LANES) continue;
            const nx = nl * LANE_W;
            const blocked =
              cars.some((o) => o !== c && Math.abs(o.x - nx) < 2.6 && Math.abs(o.z - c.z) < o.halfL + c.halfL + 8) ||
              (Math.abs(s.px - nx) < 2.6 && Math.abs(s.pz - c.z) < c.halfL + 10);
            if (!blocked) {
              c.targetLane = nl;
              c.laneT = 0;
              break;
            }
          }
        }
        if (c.laneT < 1) {
          c.laneT = Math.min(1, c.laneT + dt * 0.45);
          const e = c.laneT * c.laneT * (3 - 2 * c.laneT);
          c.x = THREE.MathUtils.lerp(c.lane * LANE_W, c.targetLane * LANE_W, e);
          if (c.laneT >= 1) c.lane = c.targetLane;
        } else c.x = c.lane * LANE_W;
      }
      // recycle far ahead once left behind
      if (c.z > s.pz + 40) {
        c.lane = heavy(c.type) ? LANES - 1 - Math.floor(rand() * 2) : Math.floor(rand() * LANES);
        c.targetLane = c.lane;
        c.laneT = 1;
        c.x = c.lane * LANE_W;
        c.cruise = heavy(c.type) ? 14 + rand() * 5 : 16 + rand() * 12;
        c.speed = c.cruise;
        c.color.set(heavy(c.type) && rand() < 0.6 ? "#e8e8e4" : TRAFFIC_PAINTS[Math.floor(rand() * TRAFFIC_PAINTS.length)]);
        let z = s.pz - 420 - rand() * 320;
        for (let tries = 0; tries < 8; tries++) {
          const conflict = cars.some((o) => o !== c && Math.abs(o.x - c.x) < 2.4 && Math.abs(o.z - z) < o.halfL + c.halfL + 14);
          if (!conflict) break;
          z -= 30;
        }
        c.z = z;
        c.passed = false;
      }
      // near-miss / collision
      const dz = c.z - s.pz;
      const dx = c.x - s.px;
      const zOverlap = c.halfL + PLAYER_HALF_L;
      if (!c.passed && dz > -zOverlap && dz < zOverlap) {
        const ax = Math.abs(dx);
        const crashX = c.halfW + PLAYER_HALF_W;
        if (ax < crashX && s.crashT <= 0) {
          s.crashT = 1.6;
          s.shake = 1;
          s.speed = Math.max(10, Math.min(s.speed, c.speed) * 0.6);
          s.combo = 0;
          s.nitro = Math.max(0, s.nitro - 0.3);
          c.speed *= 0.7;
          for (let p = 0; p < 34; p++) {
            _tmp2.set((Math.random() - 0.5) * 10, Math.random() * 6, 6 + Math.random() * 10);
            sparks.current?.emit(_tmp.set(s.px + dx * 0.5, 0.8, s.pz - 2.2), _tmp2, { life: 0.6, size: 0.6, color: "#ffb347", grow: 0.3 });
          }
          c.passed = true;
        } else if (ax >= crashX && ax < crashX + 1.3 && dz < -c.halfL * 0.2 && s.speed > 18) {
          s.combo += 1;
          s.comboT = 2.5;
          const closeness = 1 - (ax - crashX) / 1.3;
          const bonus = heavy(c.type) ? 1.5 : 1;
          const pts = Math.round((60 + closeness * 90) * Math.min(8, s.combo) * (s.speed / 40) * bonus);
          s.score += pts;
          s.nitro = Math.min(1, s.nitro + 0.12 + closeness * 0.1);
          banner(closeness > 0.6 ? `MAKAS! +${pts}` : `+${pts}`);
          c.passed = true;
        }
      }
      c.rotY = Math.PI + (c.laneT < 1 ? (c.lane - c.targetLane) * 0.06 * Math.sin(c.laneT * Math.PI) : 0);
    }

    // ---- oncoming ----
    for (const c of oncoming) {
      if (started) c.z += c.speed * dt;
      if (c.z > s.pz + 50) {
        c.z = s.pz - 700 - rand() * 500;
        c.x = ONCOMING_X[heavy(c.type) ? 2 : Math.floor(rand() * 3)];
        c.speed = heavy(c.type) ? 16 + rand() * 4 : 20 + rand() * 14;
        c.color.set(TRAFFIC_PAINTS[Math.floor(rand() * TRAFFIC_PAINTS.length)]);
      }
    }

    // ---- HUD 10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      s.best = Math.max(s.best, s.score);
      const nh: Hud = {
        speed: Math.round(s.speed * 3.6),
        score: Math.round(s.score),
        combo: s.combo,
        crashed: s.crashT > 0,
        nitro: Math.round(s.nitro * 100) / 100,
        distance: Math.round(s.distance / 100) / 10,
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
        best: Math.round(s.best),
      };
      const l = s.lastHud;
      if (
        !l ||
        l.speed !== nh.speed ||
        l.score !== nh.score ||
        l.combo !== nh.combo ||
        l.crashed !== nh.crashed ||
        l.nitro !== nh.nitro ||
        l.distance !== nh.distance ||
        l.bannerId !== nh.bannerId
      ) {
        s.lastHud = nh;
        onHud(nh);
      }
    }

    function step(h: number) {
      const stt = st.current;
      const nitroOn = (k.has("ShiftLeft") || k.has("ShiftRight")) && stt.nitro > 0.02;
      const gas = k.has("KeyW") || k.has("ArrowUp");
      const brake = k.has("KeyS") || k.has("ArrowDown") || k.has("Space");
      if (nitroOn) {
        stt.speed = Math.min(MAX_SPEED * 1.15, stt.speed + 28 * h);
        stt.nitro = Math.max(0, stt.nitro - 0.35 * h);
      } else if (gas) stt.speed = Math.min(MAX_SPEED, stt.speed + 16 * h * (1 - stt.speed / (MAX_SPEED * 1.2)));
      else if (brake) stt.speed = Math.max(0, stt.speed - 30 * h);
      else stt.speed = Math.max(0, stt.speed - 3 * h);
      if (stt.crashT > 0.8) stt.speed = Math.min(stt.speed, 14);

      const inX = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      const agility = 7 + Math.min(4, stt.speed * 0.08);
      stt.vx += (inX * agility - stt.vx) * Math.min(1, 9 * h);
      stt.px += stt.vx * h;
      const minX = -LANE_W * 0.35;
      const maxX = LANE_W * (LANES - 1) + LANE_W * 0.35;
      if (stt.px < minX) {
        stt.px = minX;
        if (stt.vx < 0) {
          stt.vx = -stt.vx * 0.2;
          stt.shake = Math.max(stt.shake, 0.4);
          stt.speed *= 0.995;
        }
      }
      if (stt.px > maxX) {
        stt.px = maxX;
        if (stt.vx > 0) {
          stt.vx = -stt.vx * 0.2;
          stt.shake = Math.max(stt.shake, 0.4);
          stt.speed *= 0.995;
        }
      }
      const moved = stt.speed * h;
      stt.pz -= moved;
      stt.distance += moved;
      if (stt.speed > 30) {
        stt.distAcc += moved;
        if (stt.distAcc > 10) {
          stt.distAcc -= 10;
          stt.score += 1 + (stt.speed > 50 ? 1 : 0);
        }
      }
    }
  }, -1); // run before the scenery so a floating-origin shift is seen the same frame

  return (
    <>
      <WorldAtmosphere preset="night" focus={focus} />
      <Highway zRef={playerZ} shiftRef={shift} />

      {/* player's headlights */}
      <spotLight ref={headlight} color="#e4ecff" intensity={420} distance={110} angle={0.42} penumbra={0.6} decay={1.5} target={headTarget} />
      <primitive object={headTarget} />
      <mesh ref={beam}>
        <planeGeometry args={[9, 22]} />
        <meshBasicMaterial map={beamTex} color="#c9d8ff" transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <TrafficFleet cars={world.fleet} />
      <Cockpit steerRef={steerVis} speedRef={kmhVis} rpmRef={rpmVis} color="#b4530a" visible={!debugCam} />
      {debugCam && <Car ref={playerCar} color="#b4530a" headlights={false} underglow={false} />}
      <Particles ref={sparks} count={300} gravity={-12} drag={1} blending={THREE.AdditiveBlending} />
      <WorldEffects preset="night" />
    </>
  );
}

export default function Traffic({ started }: { started: boolean }) {
  const [hud, setHud] = useState<Hud>({
    speed: 0,
    score: 0,
    combo: 0,
    crashed: false,
    nitro: 0.5,
    distance: 0,
    bannerId: 0,
    bannerText: "",
    best: 0,
  });

  return (
    <div className="absolute inset-0">
      <Canvas shadows="percentage" dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 66, near: 0.05, far: 3000 }}>
        <TrafficScene started={started} onHud={setHud} />
      </Canvas>
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Skor" value={`${hud.score}`} accent={ACCENT} sub={hud.combo > 1 ? `×${Math.min(8, hud.combo)} kombo` : undefined} />
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent="#14141f" />
        <HudStat label="Mesafe" value={`${hud.distance.toFixed(1)} km`} accent="#6b6880" />
        <HudBar label="Nitro" value={hud.nitro} accent="#0ea5e9" />
      </div>
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} accent={ACCENT} />}
      {hud.crashed && <HudModal title="Çarptın!" accent="#e11d48" lines={["Kombo sıfırlandı, hız düştü"]} tone="danger" />}
      {started && hud.score === 0 && hud.speed < 25 && (
        <HudCenter text="W: gaz · A/D: şerit · Shift: nitro · Arabalara yakın geç, çarpma!" />
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import City from "./shared/City";
import { WorldAtmosphere, WorldEffects, CANVAS_GL } from "./shared/World";
import {
  generateCity,
  aabbCollide,
  raycastBuildings,
  groundHeightAt,
  mulberry32,
  clampToPlayArea,
  distanceToEdge,
  BOUNDARY_WARN,
  type Building,
  type CityData,
} from "./shared/cityGen";
import { useKeys, makeEdge } from "./shared/useKeys";
import { usePointerLook } from "./shared/usePointerLook";
import { isTouchDevice, virtualStick } from "./shared/input";
import Rings, { type RingData } from "./shared/Rings";
import Particles, { type ParticleHandle } from "./shared/Particles";
import { HudStat, HudCenter, HudBanner, HudHint, HudEdge } from "./shared/GameHud";
import { getGame } from "@/lib/games";
import { loadHero, PELVIS_HEIGHT, type HeroRig } from "./spiderman/heroModel";
import { HeroAnimator, Mode, type AnimInput } from "./spiderman/heroAnim";
import { WebRibbon } from "./spiderman/webLine";
import { WebSplats } from "./spiderman/webSplat";
import { facePlane, faceHalf, faceCenterU, nearestFace, volumeAt, type Face } from "./spiderman/wall";

const ACCENT = getGame("spiderman")!.accent;
const GRAV = 25;
const SUB = 1 / 120;
const MAX_SPEED = 64;
const RING_COUNT = 40;
/** centre of mass above the feet */
const COM_H = PELVIS_HEIGHT;
const RUN = 10;
const SPRINT = 16;
/** distance from a wall's plane to the hero's reference point while on it */
const WALL_R = 0.45;
const CRAWL = 5.5;
const WALL_RUN = 15;
/** web strand flight speed (m/s): the rope only pulls once it has arrived */
const WEB_SPEED = 240;
const ZIP_RANGE = 95;

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
const _rp = new THREE.Vector3();
const _off = new THREE.Vector3();
const _old = new THREE.Vector3();

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
  edge: boolean;
  /** 0 ground, 1 air/swing, 2 wall */
  place: 0 | 1 | 2;
  /** show the wall-controls hint (first few wall visits) */
  wallHint: boolean;
}

interface WallState {
  f: Face;
  t: number;
  /** wall-running (sprint) rather than crawling */
  run: boolean;
  /** seconds of wall-run left from entry momentum (no Shift needed) */
  boost: number;
}

interface ZipState {
  /** where the feet go */
  target: THREE.Vector3;
  /** where the strand sticks */
  anchor: THREE.Vector3;
  /** perch on a roof edge (else: land on the wall face) */
  perch: boolean;
  face: Face | null;
  t: number;
  travel: number;
  hand: 0 | 1;
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

/**
 * Frames left in which normally-hidden effects are drawn invisibly. Compiling
 * a shader isn't enough on some GPUs (Metal builds the pipeline on the first
 * real draw), so the first swing would still hitch.
 */
let primeFrames = 0;

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
    im.visible = k > 0.01 || primeFrames > 0;
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
  splats: WebSplats;
  animIn: AnimInput;
}

function makeAnimInput(): AnimInput {
  return {
    mode: Mode.Ground,
    speed: 0,
    vy: 0,
    impact: 0,
    anchor: null,
    hand: 1,
    webT: 0,
    swingPhase: 0.5,
    flip: -1,
    trick: 0,
    dive: false,
    up: new THREE.Vector3(0, 1, 0),
    fwd: new THREE.Vector3(0, 0, -1),
    orientRate: 10,
  };
}

/**
 * Compile every material now, including ones that start hidden (web strand,
 * splats, speed lines), so the first swing doesn't stall on shader compilation.
 */
function warmUp(get: () => { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }) {
  const { gl, scene, camera } = get();
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  // the post-processing composer renders the scene into a linear, un-tonemapped
  // target: compile for that, or every material gets a second variant later
  const prev = gl.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  gl.setRenderTarget(rt);
  gl.compileAsync(scene, camera).catch(() => {});
  gl.setRenderTarget(prev);
  rt.dispose();
  for (const o of hidden) o.visible = false;
}

/** Outward normal of the building face a ray hit (roof hits → +Y). */
function hitNormal(b: Building, p: { x: number; y: number; z: number }) {
  if (p.y >= b.h - 0.05) return { x: 0, y: 1, z: 0 };
  const f = nearestFace(b, p.x, p.z);
  return { x: f.nx, y: 0, z: f.nz };
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
  // what the hero collides with / stands on: buildings plus the rooftop HVAC
  // units and water tanks (these don't take webs and can't be climbed)
  const solids = useMemo(() => {
    const list: Building[] = [...city.buildings];
    const props = new Set<Building>();
    const add = (x: number, z: number, w: number, d: number, y0: number, h: number) => {
      const b: Building = { x, z, w, d, y0, h, style: 0, seed: 0, colorIdx: 0, kind: 0, top: true };
      list.push(b);
      props.add(b);
    };
    for (const p of city.hvac) add(p.x, p.z, p.w, p.d, p.y, p.y + p.h);
    for (const p of city.tanks) add(p.x, p.z, p.w * 2, p.d * 2, p.y, p.y + p.h + 0.6);
    // roof parapets (same layout as <City>): walk into one and you step up onto the ledge
    const t = 0.35;
    const ph = 1.1;
    for (const b of city.buildings) {
      if (!b.top || b.w <= 6) continue;
      add(b.x, b.z + b.d / 2 - t / 2, b.w, t, b.h, b.h + ph);
      add(b.x, b.z - b.d / 2 + t / 2, b.w, t, b.h, b.h + ph);
      add(b.x + b.w / 2 - t / 2, b.z, t, b.d - t * 2, b.h, b.h + ph);
      add(b.x - b.w / 2 + t / 2, b.z, t, b.d - t * 2, b.h, b.h + ph);
    }
    return { list, props };
  }, [city]);
  const ringsRef = useRef<RingData[]>([]);
  useEffect(() => {
    ringsRef.current = makeRings(city);
  }, [city]);

  const keys = useKeys();
  const edge = useMemo(() => makeEdge(), []);
  const { yaw, pitch: pitchRef, locked, mouseDown, rightDown, lastLook } = usePointerLook(0.0022, 1.2);
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  const touch = useMemo(() => isTouchDevice(), []);
  const get = useThree((s) => s.get);

  // three.js objects live in a ref (built once on mount, mutated every frame)
  const holder = useRef<THREE.Group>(null);
  const gfx = useRef<Gfx | null>(null);
  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    let alive = true;
    let g: Gfx | null = null;
    loadHero()
      .then((rig) => {
        if (!alive) {
          rig.dispose();
          return;
        }
        g = { rig, anim: new HeroAnimator(rig), web: new WebRibbon(), splats: new WebSplats(), animIn: makeAnimInput() };
        parent.add(rig.root, g.web.mesh, g.splats.group);
        gfx.current = g;
        warmUp(get);
      })
      .catch((e) => console.error("spiderman: hero failed to load", e));
    return () => {
      alive = false;
      if (g) {
        parent.remove(g.rig.root, g.web.mesh, g.splats.group);
        g.anim.dispose();
        g.rig.dispose();
        g.web.dispose();
        g.splats.dispose();
      }
      gfx.current = null;
    };
  }, [get]);

  // again once the game starts: by then the environment map exists, and
  // materials that use it need their final shader variant
  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => {
      warmUp(get);
      primeFrames = 4;
    }, 300);
    return () => clearTimeout(t);
  }, [started, get]);

  const particles = useRef<ParticleHandle>(null);
  const dust = useRef<ParticleHandle>(null);
  const speedRef = useRef(0);
  const focus = useRef<THREE.Vector3>(new THREE.Vector3());

  const st = useRef({
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    /** physics state before the last substep (render interpolation) */
    prevPos: new THREE.Vector3(spawn.x, 0, spawn.z),
    /** interpolated position used for rendering + camera */
    renderPos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    web: null as { anchor: THREE.Vector3; len: number; maxLen: number; t: number; arrive: number; hand: 0 | 1 } | null,
    holding: false,
    wall: null as WallState | null,
    zip: null as ZipState | null,
    /** in-plane climbing direction (crawl body orientation) */
    wallDir: new THREE.Vector3(0, 1, 0),
    wallCool: 0,
    wallVisits: 0,
    /** +1/−1: which way along the wall "right" on screen is */
    wallSide: 1,
    /** raw movement input (stick or keys): x right, y forward */
    inX: 0,
    inY: 0,
    zipCool: 0,
    /** a web needs a fresh press (after a wall jump / zip) */
    webLock: false,
    prevWant: false,
    prevRmb: false,
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
    camDist: 4,
    yawOffset: 0,
    wasLocked: false,
    lastHud: null as Hud | null,
    facing: Math.PI, // hero yaw (atan2(x,z)); π → facing -Z
    flipT: -1,
    trick: 0,
    releases: 0,
    lastHand: 1 as 0 | 1,
    camSmooth: new THREE.Vector3(spawn.x, COM_H, spawn.z),
    camDir: new THREE.Vector3(0, 0, -1),
    time: 0,
    camColl: 99,
    edge: false,
    /** analog input magnitude 0..1 (touch stick) */
    wishMag: 0,
    /** render-only offset that absorbs position snaps (vaults, corners), decays to 0 */
    visOff: new THREE.Vector3(),
    /** smoothed offset from `pos` to the body's centre of mass */
    comOff: new THREE.Vector3(0, COM_H, 0),
    shake: 0,
    /** dev/test only: fixed camera distance / yaw offset (0 = off) */
    dbgDist: 0,
    dbgYaw: 0,
    /** dev/test only: slow-motion factor (0 = off) */
    dbgTime: 0,
  });

  // dev-only debug handle for headless tests
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __spider?: unknown }).__spider = { st: st.current, city, gfx, get };
    }
  }, [city, get]);

  /** Pick an anchor on a building face above and ahead (PS4-style). */
  const findAnchor = (out: THREE.Vector3, normal: THREE.Vector3): boolean => {
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
    // alternate sides for a rhythm (left hand, right hand, …)
    _right.set(-hz, 0, hx);
    const prefer = s.lastHand === 1 ? -1 : 1;
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
        const side = (dx * _right.x + dz * _right.z) / horiz;
        const ropeLen = Math.hypot(horiz, rise);
        const score =
          ahead * 26 +
          Math.min(rise, 42) * 0.55 -
          Math.abs(horiz - 24) * 0.45 -
          Math.max(0, ropeLen - 70) * 0.8 -
          Math.abs(yo) * 4 +
          (hv > 8 ? side * prefer * 3 : 0);
        if (score > bestScore) {
          bestScore = score;
          _best.set(hit.point.x, ay, hit.point.z);
          const nn = hitNormal(hit.building, hit.point);
          normal.set(nn.x, nn.y, nn.z);
        }
      }
    }
    if (bestScore > -Infinity) {
      out.copy(_best);
      return true;
    }
    // no building in reach (open sky / high above roofs): forgiving sky anchor
    if (s.pos.y > 150) return false;
    normal.set(0, 0, 0);
    out.set(_origin.x + hx * 24, _origin.y + 30, _origin.z + hz * 24);
    // never let a sky anchor pull the hero out of the play area
    const lim = city.bounds.max - 25;
    out.x = THREE.MathUtils.clamp(out.x, -lim, lim);
    out.z = THREE.MathUtils.clamp(out.z, -lim, lim);
    return true;
  };

  const _anchorN = useMemo(() => new THREE.Vector3(), []);

  const attachWeb = () => {
    const s = st.current;
    const anchor = new THREE.Vector3();
    if (!findAnchor(anchor, _anchorN)) return;
    _com.copy(s.pos).setY(s.pos.y + COM_H);
    const dist = _com.distanceTo(anchor);
    // lowest point of the arc stays ≥ 3 m above the street
    const maxLen = Math.max(8, Math.min(dist, anchor.y - 6 - COM_H));
    // pick the hand on the anchor's side
    _right.set(-Math.cos(s.facing), 0, Math.sin(s.facing));
    _d.copy(anchor).sub(_com);
    const hand: 0 | 1 = _d.dot(_right) > 0 ? 1 : 0;
    s.web = { anchor, len: dist, maxLen, t: 0, arrive: dist / WEB_SPEED, hand };
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
    const g = gfx.current;
    if (g && _anchorN.lengthSq() > 0.5) g.splats.add(anchor, _anchorN.x, _anchorN.y, _anchorN.z);
  };

  const releaseWeb = (boost = true) => {
    const s = st.current;
    const w = s.web;
    if (!w) return;
    s.web = null;
    s.holding = false;
    const sp = s.vel.length();
    if (boost && sp > 10) {
      // PS4-style release boost: forward along travel + up
      _d.copy(s.vel).setY(0);
      if (_d.lengthSq() > 1) s.vel.addScaledVector(_d.normalize(), 3.5);
      s.vel.y += 6;
      s.releases++;
      // a trick on a strong upward release: somersault / corkscrew, alternating
      if (s.vel.y > 9 && s.releases % 2 === 1) {
        s.flipT = 0;
        s.trick = (s.releases >> 1) % 2;
      }
    }
    // strand puff at the hand
    const g = gfx.current;
    if (g) particles.current?.emit(g.anim.palmWorld[w.hand], _tmp2.set(0, 0.5, 0), { life: 0.3, size: 0.5, color: "#ffffff", grow: 1.5 });
  };

  /* ---------- walls ---------- */

  const attachWall = (b: Building, nx: number, nz: number) => {
    const s = st.current;
    if (s.web) releaseWeb(false);
    s.zip = null;
    const vIn = -(s.vel.x * nx + s.vel.z * nz);
    const tx = nz;
    const tz = -nx;
    const along = s.vel.x * tx + s.vel.z * tz;
    const speed = s.vel.length();
    const sprint = keys.current.has("ShiftLeft") || keys.current.has("ShiftRight");
    const run = sprint || speed > 11;
    s.wall = { f: { b, nx, nz }, t: 0, run, boost: run ? 1.1 : 0 };
    s.wallVisits++;
    if (run) {
      // momentum turns into a run up the wall
      const upV = THREE.MathUtils.clamp(Math.max(0, s.vel.y) + Math.max(0, vIn) * 0.8 + Math.abs(along) * 0.25, 9, 24);
      s.vel.set(tx * along * 0.5, upV, tz * along * 0.5);
    } else {
      s.vel.set(tx * along * 0.3, THREE.MathUtils.clamp(s.vel.y * 0.3, -3, 3), tz * along * 0.3);
    }
    s.wallDir.set(0, 1, 0);
    s.onGround = false;
    s.flipT = -1;
    s.fallSpeed = 0;
    if (vIn > 9) {
      s.shake = Math.min(1, s.shake + vIn / 40);
      _tmp.set(s.pos.x - nx * WALL_R, s.pos.y + COM_H, s.pos.z - nz * WALL_R);
      for (let i = 0; i < 8; i++) {
        _tmp2.set(nx * 2 + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, nz * 2 + (Math.random() - 0.5) * 3);
        dust.current?.emit(_tmp, _tmp2, { life: 0.6, size: 0.9, color: "#cfcac2", grow: 1.8 });
      }
    }
  };

  /** Climb over the top edge of the current wall onto the roof. */
  const vault = (f: Face, run: boolean) => {
    const s = st.current;
    const plane = facePlane(f);
    _old.copy(s.pos);
    s.pos.y = f.b.h;
    const inset = 0.8;
    if (f.nx !== 0) s.pos.x = plane - f.nx * inset;
    else s.pos.z = plane - f.nz * inset;
    // along the face: keep inside the roof
    const c = faceCenterU(f);
    const half = faceHalf(f) - 0.4;
    if (f.nx !== 0) s.pos.z = THREE.MathUtils.clamp(s.pos.z, c - half, c + half);
    else s.pos.x = THREE.MathUtils.clamp(s.pos.x, c - half, c + half);
    s.prevPos.add(_tmp.copy(s.pos).sub(_old));
    s.visOff.add(_old).sub(s.pos);
    s.vel.set(-f.nx * (run ? 7 : 4), run ? 7.5 : 4.5, -f.nz * (run ? 7 : 4));
    s.wall = null;
    s.wallCool = 0.3;
    s.onGround = false;
    if (run) { s.flipT = 0; s.trick = 0; }
    s.facing = Math.atan2(-f.nx, -f.nz);
  };

  const wallJump = () => {
    const s = st.current;
    const w = s.wall;
    if (!w) return;
    const { nx, nz } = w.f;
    const runUp = w.run && s.vel.y > 6;
    // steer the leap a little with the stick (tangential part only)
    const tx = nz;
    const tz = -nx;
    const side = s.inX * s.wallSide;
    s.vel.set(
      nx * (runUp ? 7 : 10) + tx * side * 5,
      runUp ? Math.max(s.vel.y * 0.8, 13) : 11,
      nz * (runUp ? 7 : 10) + tz * side * 5
    );
    s.wall = null;
    s.wallCool = 0.4;
    s.webLock = true;
    s.flipT = 0;
    s.trick = 0;
    s.facing = Math.atan2(nx, nz);
  };

  /* ---------- zip (point launch) ---------- */

  const startZip = () => {
    const s = st.current;
    if (s.zipCool > 0) return;
    _origin.copy(s.pos).setY(s.pos.y + COM_H);
    // look direction, lifted a touch: players aim at the edge they want
    const cd = s.camDir;
    const baseYaw = Math.atan2(-cd.x, -cd.z);
    const basePitch = Math.asin(THREE.MathUtils.clamp(cd.y, -1, 1)) + 0.1;
    let bestScore = -Infinity;
    let best: ZipState | null = null;
    for (let pi = 0; pi < 4; pi++) {
      const p = basePitch + pi * 0.09;
      for (let yi = -3; yi <= 3; yi++) {
        const yv = baseYaw + yi * 0.08;
        _d.set(-Math.sin(yv) * Math.cos(p), Math.sin(p), -Math.cos(yv) * Math.cos(p));
        const hit = raycastBuildings(_origin, _d, ZIP_RANGE, city.buildings);
        if (!hit || hit.dist < 6) continue;
        const b = hit.building;
        const n = hitNormal(b, hit.point);
        let perch = false;
        const target = new THREE.Vector3();
        const anchor = new THREE.Vector3();
        let face: Face | null = null;
        if (n.y > 0.5) {
          // roof: land on it
          perch = true;
          target.set(hit.point.x, b.h, hit.point.z);
          anchor.copy(target);
        } else {
          face = { b, nx: n.x, nz: n.z };
          if (b.h - hit.point.y < 16) {
            // close to the top edge: perch on it
            perch = true;
            anchor.set(hit.point.x, b.h - 0.1, hit.point.z);
            target.set(hit.point.x + n.x * 0.6, b.h + 0.5, hit.point.z + n.z * 0.6);
          } else {
            anchor.set(hit.point.x, hit.point.y, hit.point.z);
            target.set(hit.point.x + n.x * WALL_R, hit.point.y - COM_H, hit.point.z + n.z * WALL_R);
          }
        }
        const score = (perch ? 12 : 0) - Math.abs(yi) * 2 - pi * 1.5 - hit.dist * 0.04;
        if (score > bestScore) {
          bestScore = score;
          best = { target, anchor, perch, face, t: 0, travel: hit.dist / WEB_SPEED, hand: 1 };
        }
      }
    }
    if (s.web) releaseWeb(false);
    if (best) {
      _right.set(-Math.cos(s.facing), 0, Math.sin(s.facing));
      _d.copy(best.anchor).sub(_origin);
      best.hand = _d.dot(_right) > 0 ? 1 : 0;
      s.lastHand = best.hand;
      s.zip = best;
      s.wall = null;
      s.onGround = false;
      s.flipT = -1;
      s.zipCool = 0.35;
      const g = gfx.current;
      const n = best.face ? { x: best.face.nx, y: 0, z: best.face.nz } : { x: 0, y: 1, z: 0 };
      g?.splats.add(best.anchor, n.x, n.y, n.z, 1.0);
    } else if (!s.onGround && !s.wall) {
      // nothing to grab: a short web-zip dash through the air
      _d.set(cd.x, 0, cd.z);
      if (_d.lengthSq() < 1e-4) _d.set(-Math.sin(s.camYaw), 0, -Math.cos(s.camYaw));
      _d.normalize();
      s.vel.addScaledVector(_d, 14);
      s.vel.y = Math.max(s.vel.y, 0) + 4;
      s.zipCool = 0.8;
      const g = gfx.current;
      if (g) particles.current?.emit(g.anim.palmWorld[s.lastHand], _tmp2.set(0, 0, 0), { life: 0.35, size: 0.9, color: "#ffffff", grow: 2 });
    }
  };

  const reset = () => {
    const s = st.current;
    s.pos.set(spawn.x, 0, spawn.z);
    s.prevPos.copy(s.pos);
    s.renderPos.copy(s.pos);
    s.vel.set(0, 0, 0);
    s.web = null;
    s.holding = false;
    s.wall = null;
    s.zip = null;
    s.combo = 0;
    s.flipT = -1;
    s.visOff.set(0, 0, 0);
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

  function collectRings() {
    const s = st.current;
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

  /** One physics substep on a wall: crawl / wall-run, corners, top edge, bottom. */
  function stepWall(h: number, sprint: boolean) {
    const s = st.current;
    const w = s.wall!;
    let f = w.f;
    w.t += h;
    w.boost -= h;
    const tx = f.nz;
    const tz = -f.nx;
    // stick → wall, screen-relative: up is up, left/right as the camera sees
    // the wall (stable while the camera swings round after a corner)
    const cr = _right.x * tx + _right.z * tz;
    if (Math.abs(cr) > 0.3) s.wallSide = Math.sign(cr);
    const il = Math.hypot(s.inX, s.inY);
    const upIn = il > 1 ? s.inY / il : s.inY;
    const side = (il > 1 ? s.inX / il : s.inX) * s.wallSide;
    const mag = Math.min(1, Math.hypot(upIn, side));
    w.run = mag > 0.2 && (sprint || w.boost > 0);
    const speed = w.run ? WALL_RUN : CRAWL * mag;
    _d.set(tx * side, upIn, tz * side);
    if (_d.lengthSq() > 1e-4) _d.normalize();
    _d.multiplyScalar(speed);
    const a = 1 - Math.exp(-(w.run ? 4 : 10) * h);
    s.vel.x += (_d.x - s.vel.x) * a;
    s.vel.y += (_d.y - s.vel.y) * a;
    s.vel.z += (_d.z - s.vel.z) * a;
    const vn = s.vel.x * f.nx + s.vel.z * f.nz;
    s.vel.x -= f.nx * vn;
    s.vel.z -= f.nz * vn;
    s.pos.addScaledVector(s.vel, h);
    // stay on the plane
    let plane = facePlane(f);
    if (f.nx !== 0) s.pos.x = plane + f.nx * WALL_R;
    else s.pos.z = plane + f.nz * WALL_R;

    // side edges: step onto a coplanar neighbour or wrap round the corner
    const c = faceCenterU(f);
    const half = faceHalf(f);
    const u = f.nx !== 0 ? s.pos.z : s.pos.x;
    const du = u - c;
    if (Math.abs(du) > half - 0.2) {
      const sg = Math.sign(du);
      const uBeyond = c + sg * (half + 1.4);
      const px = f.nx !== 0 ? plane - f.nx * 0.3 : uBeyond;
      const pz = f.nx !== 0 ? uBeyond : plane - f.nz * 0.3;
      const nb = volumeAt(px, s.pos.y + COM_H, pz, city.buildings);
      const movingOut = (f.nx !== 0 ? s.vel.z : s.vel.x) * sg > 0.3;
      if (nb && nb !== f.b && movingOut) {
        // neighbour flush with this wall: carry on over the gap
        f = { b: nb, nx: f.nx, nz: f.nz };
        w.f = f;
        _old.copy(s.pos);
        plane = facePlane(f);
        const u2 = c + sg * (half + 1.4);
        if (f.nx !== 0) {
          s.pos.x = plane + f.nx * WALL_R;
          s.pos.z = u2;
        } else {
          s.pos.z = plane + f.nz * WALL_R;
          s.pos.x = u2;
        }
        s.prevPos.add(_tmp.copy(s.pos).sub(_old));
        s.visOff.add(_old).sub(s.pos);
      } else if (movingOut) {
        // wrap around the outside corner onto the side face
        const nnx = tx * sg;
        const nnz = tz * sg;
        const nf: Face = { b: f.b, nx: nnx, nz: nnz };
        _old.copy(s.pos);
        const np = facePlane(nf);
        // just round the corner, on the new face
        if (nnx !== 0) {
          s.pos.x = np + nnx * WALL_R;
          s.pos.z = plane - f.nz * 0.35;
        } else {
          s.pos.z = np + nnz * WALL_R;
          s.pos.x = plane - f.nx * 0.35;
        }
        // tangential speed carries on along the new face (away from the corner)
        const sp = Math.abs(f.nx !== 0 ? s.vel.z : s.vel.x);
        s.vel.x = -f.nx * sp;
        s.vel.z = -f.nz * sp;
        w.f = nf;
        f = nf;
        s.prevPos.add(_tmp.copy(s.pos).sub(_old));
        s.visOff.add(_old).sub(s.pos);
      } else {
        const lim = half - 0.2;
        if (f.nx !== 0) s.pos.z = c + THREE.MathUtils.clamp(du, -lim, lim);
        else s.pos.x = c + THREE.MathUtils.clamp(du, -lim, lim);
      }
    }

    // climbing direction for the crawl pose
    if (s.vel.lengthSq() > 0.4) _tmp.copy(s.vel).normalize();
    else _tmp.copy(s.wallDir);
    s.wallDir.lerp(_tmp, 1 - Math.exp(-6 * h)).normalize();

    // top edge: vault onto the roof
    if (s.pos.y + COM_H * 0.95 >= f.b.h && s.vel.y > 0.3) {
      vault(f, w.run);
      return;
    }
    if (s.pos.y + COM_H * 1.2 > f.b.h) s.pos.y = Math.min(s.pos.y, f.b.h - COM_H * 0.95);
    // bottom: street or a podium roof (an upper tier's face ends at its own base)
    const gy = Math.max(f.b.y0, groundHeightAt(s.pos.x, s.pos.z, s.pos.y + 0.3, city.buildings));
    if (s.pos.y <= gy + 0.01) {
      s.pos.y = gy;
      if (s.vel.y <= 0.05 && upIn < 0.25) {
        s.wall = null;
        s.onGround = true;
        s.vel.set(0, 0, 0);
        s.facing = Math.atan2(f.nx, f.nz);
        s.wallCool = 0.35;
      } else if (s.vel.y < 0) s.vel.y = 0;
    }
    s.fallSpeed = 0;
    s.airTime = 0;
    clampToPlayArea(s.pos, city, 0.5);
  }

  /** One physics substep of a zip towards its target. */
  function stepZip(h: number) {
    const s = st.current;
    const z = s.zip!;
    z.t += h;
    if (z.t < z.travel) {
      // strand still flying: coast
      if (!s.onGround) s.vel.y -= GRAV * 0.5 * h;
      s.pos.addScaledVector(s.vel, h);
      return;
    }
    _d.copy(z.target).sub(s.pos);
    const dist = _d.length();
    _d.divideScalar(dist || 1);
    const want = Math.min(52, 16 + dist * 2.6);
    const a = 1 - Math.exp(-9 * h);
    s.vel.x += (_d.x * want - s.vel.x) * a;
    s.vel.y += (_d.y * want - s.vel.y) * a;
    s.vel.z += (_d.z * want - s.vel.z) * a;
    const stepLen = s.vel.length() * h;
    if (dist <= Math.max(0.6, stepLen * 1.5) || z.t > 3.5) {
      arriveZip(z);
      return;
    }
    s.pos.addScaledVector(s.vel, h);
  }

  function arriveZip(z: ZipState) {
    const s = st.current;
    s.zip = null;
    s.webLock = true;
    if (z.perch) {
      _old.copy(s.pos);
      s.pos.copy(z.target);
      if (z.face) {
        // over the edge onto the roof
        s.pos.y = z.face.b.h;
        s.pos.x -= z.face.nx * 1.2;
        s.pos.z -= z.face.nz * 1.2;
      }
      s.prevPos.add(_tmp.copy(s.pos).sub(_old));
      s.visOff.add(_old).sub(s.pos);
      const held = keys.current.has("KeyQ") || rightDown.current;
      _d.set(s.vel.x, 0, s.vel.z);
      if (_d.lengthSq() < 1) _d.set(-Math.sin(s.camYaw), 0, -Math.cos(s.camYaw));
      _d.normalize();
      if (held) {
        // point launch: spring off the perch
        s.vel.set(_d.x * 17, 16, _d.z * 17);
        s.onGround = false;
        s.flipT = 0;
        s.trick = 0;
        banner("Fırla!");
        s.shake = Math.min(1, s.shake + 0.25);
      } else {
        s.vel.set(_d.x * 2, 0, _d.z * 2);
        s.fallSpeed = 16; // perch crouch
        s.facing = Math.atan2(_d.x, _d.z);
      }
    } else if (z.face) {
      attachWall(z.face.b, z.face.nx, z.face.nz);
      s.vel.set(0, 0, 0);
    }
    s.wallCool = 0.1;
  }

  function step(h: number, k: Set<string>) {
    const s = st.current;
    _fwd.set(-Math.sin(s.camYaw), 0, -Math.cos(s.camYaw));
    _right.copy(_fwd).cross(_up);
    if (virtualStick.active) {
      s.inX = virtualStick.x;
      s.inY = virtualStick.y;
    } else {
      s.inX = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      s.inY = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    }
    _wish.set(0, 0, 0).addScaledVector(_fwd, s.inY).addScaledVector(_right, s.inX);
    const wl = _wish.length();
    s.wishMag = Math.min(1, wl);
    if (wl > 1) _wish.divideScalar(wl);
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    s.wallCool -= h;
    s.zipCool -= h;

    if (s.wall) {
      stepWall(h, sprint);
      collectRings();
      return;
    }

    const w = s.web;
    if (s.zip) {
      stepZip(h);
      if (!s.zip && (s.wall || s.onGround)) {
        collectRings();
        return;
      }
    } else {
      const gy = groundHeightAt(s.pos.x, s.pos.z, s.pos.y, solids.list);
      const grounded = !s.web && s.pos.y <= gy + 0.03 && s.vel.y <= 0.5;
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
            // fast forward landings roll out (keep momentum), slow ones plant
            const keep = Math.hypot(s.vel.x, s.vel.z) > 12 ? 0.7 : 0.35;
            s.vel.x *= keep;
            s.vel.z *= keep;
            if (impact > 20) s.shake = Math.min(1, s.shake + (impact - 16) / 30);
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
          const taut = w.t >= w.arrive;
          if (taut) {
            // tangential pump along travel keeps the swing alive
            _tmp.copy(s.vel).addScaledVector(_n, -s.vel.dot(_n));
            const tl = _tmp.length();
            if (tl > 0.5 && sp < 46) s.vel.addScaledVector(_tmp.divideScalar(tl), 7.5 * h);
            // steer: camera forward (+stick), projected on the tangent plane
            _tmp2.copy(_fwd).multiplyScalar(6).addScaledVector(_wish, 7);
            _tmp2.addScaledVector(_n, -_tmp2.dot(_n));
            s.vel.addScaledVector(_tmp2, h);
            // reel the rope in towards the safe length (lifts you off the street)
            if (w.len > w.maxLen) w.len = Math.max(w.maxLen, w.len - 26 * h);
          } else {
            // strand still flying: the rope length follows (no pull yet)
            w.len = Math.max(dl, 1);
          }
          s.pos.addScaledVector(s.vel, h);
          // inextensible rope
          _com.copy(s.pos).setY(s.pos.y + COM_H);
          _d.copy(_com).sub(w.anchor);
          const L = _d.length();
          if (taut && L > w.len) {
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
    }
    if (s.vel.length() > MAX_SPEED) s.vel.setLength(MAX_SPEED);

    // walls (volumes spanning the hero's height): climb or bump
    const col = aabbCollide(s.pos.x, s.pos.z, 0.42, solids.list, s.pos.y + 0.05);
    if (col && solids.props.has(col.building) && col.building.h - s.pos.y < 1.7 && !s.web && s.vel.y <= 0.5) {
      // knee-high rooftop unit: hop up onto it
      _old.copy(s.pos);
      s.pos.y = col.building.h;
      s.prevPos.y += s.pos.y - _old.y;
      s.visOff.y -= s.pos.y - _old.y;
    } else if (col && solids.props.has(col.building)) {
      s.pos.x += col.x;
      s.pos.z += col.z;
      if (col.x !== 0) s.vel.x *= -0.05;
      if (col.z !== 0) s.vel.z *= -0.05;
    } else if (col) {
      const b = col.building;
      const cl = Math.hypot(col.x, col.z) || 1;
      const nx = Math.round(col.x / cl);
      const nz = Math.round(col.z / cl);
      const into = -(_wish.x * nx + _wish.z * nz);
      const vIn = -(s.vel.x * nx + s.vel.z * nz);
      s.pos.x += col.x;
      s.pos.z += col.z;
      const zipNear = s.zip && s.zip.target.distanceTo(s.pos) < 4;
      const tall = b.h - s.pos.y > 2.2;
      const wantClimb = s.onGround ? into > 0.55 : vIn > 2.5 || into > 0.55;
      if (!zipNear && tall && s.wallCool <= 0 && wantClimb) {
        if (s.pos.y + COM_H > b.h - 0.4 && !s.onGround) {
          // caught the ledge: straight over the top
          attachWall(b, nx, nz);
          vault({ b, nx, nz }, s.vel.y > 6);
        } else attachWall(b, nx, nz);
        collectRings();
        return;
      }
      if (col.x !== 0) s.vel.x *= -0.05;
      if (col.z !== 0) s.vel.z *= -0.05;
    }
    // ground / roofs
    const g2 = groundHeightAt(s.pos.x, s.pos.z, s.pos.y, solids.list);
    if (s.pos.y < g2) {
      s.pos.y = g2;
      if (s.vel.y < 0) s.vel.y = 0;
      if (s.zip && !s.zip.perch) s.zip = null;
    }
    if (s.pos.y < 0) {
      s.pos.y = 0;
      s.vel.y = Math.max(0, s.vel.y);
    }
    // play-area edge: an invisible wall up to the sky — slide along it with a small bounce
    const wall = clampToPlayArea(s.pos, city, 0.5);
    if (wall) {
      const vn = s.vel.x * wall.nx + s.vel.z * wall.nz;
      if (vn > 0) {
        // slide on foot, small bounce in the air
        const kk = s.onGround ? 1 : 1.3;
        s.vel.x -= wall.nx * vn * kk;
        s.vel.z -= wall.nz * vn * kk;
      }
      // a web anchored across the wall would keep dragging us into it
      if (s.web && s.web.anchor.x * wall.nx + s.web.anchor.z * wall.nz > city.bounds.max - 2) releaseWeb();
      if (s.zip) s.zip = null;
    }
    collectRings();
  }

  useFrame(({ camera }, rawDt) => {
    const s = st.current;
    const cam = camera as THREE.PerspectiveCamera;
    const dt = Math.min(rawDt, 1 / 30) * (s.dbgTime || 1);
    s.time += dt;
    const k = keys.current;
    const now = performance.now();

    // ---- camera yaw: mouse / touch drag when active, otherwise auto-follow ----
    const hvel = Math.hypot(s.vel.x, s.vel.z);
    const touchIdle = touch && now - lastLook.current > 1400;
    const manual = lockedRef.current && !touchIdle;
    if (lockedRef.current) {
      if (!s.wasLocked) s.yawOffset = s.camYaw - yaw.current;
      s.camYaw = yaw.current + s.yawOffset;
    }
    if (!manual) {
      let target: number | null = null;
      let rate = 2.2;
      if (s.wall) {
        target = Math.atan2(s.wall.f.nx, s.wall.f.nz);
        rate = 2.6;
      } else if (s.zip) {
        _d.copy(s.zip.target).sub(s.pos);
        target = Math.atan2(-_d.x, -_d.z);
        rate = 3;
      } else if (hvel > 3 && (!s.onGround || touch)) {
        target = Math.atan2(-s.vel.x, -s.vel.z);
        rate = s.onGround ? 1.2 : 2.2;
      }
      if (target !== null) {
        let diff = target - s.camYaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const dy = diff * (1 - Math.exp(-rate * dt));
        s.camYaw += dy;
        if (lockedRef.current) s.yawOffset += dy;
      } else if (!lockedRef.current && hvel > 3) {
        // on foot without mouse: A/D turn the view gently
        const turn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
        s.camYaw += turn * 1.4 * dt;
      }
    }
    s.wasLocked = lockedRef.current;

    // ---- input ----
    const wantWeb = k.has("Space") || k.has("KeyE") || mouseDown.current;
    const rmbPressed = rightDown.current && !s.prevRmb;
    s.prevRmb = rightDown.current;
    if (started) {
      const pressed = wantWeb && !s.prevWant;
      if (!wantWeb) s.webLock = false;
      if (s.wall) {
        if (pressed) wallJump();
      } else {
        if (wantWeb && !s.holding && !s.webLock && !s.zip) attachWeb();
        if (!wantWeb && s.holding) releaseWeb();
      }
      if (edge(k, "KeyQ") || rmbPressed) startZip();
      if (edge(k, "KeyR")) reset();
      s.prevWant = wantWeb;
    }
    if (s.bannerT > 0) s.bannerT -= dt;

    if (started) {
      s.acc += dt;
      while (s.acc >= SUB) {
        s.prevPos.copy(s.pos);
        step(SUB, k);
        s.acc -= SUB;
      }
    }
    // render state interpolated between the last two physics states (no judder at 120/144 Hz)
    s.renderPos.lerpVectors(s.prevPos, s.pos, started ? s.acc / SUB : 1);
    s.visOff.multiplyScalar(Math.exp(-11 * dt));
    if (s.flipT >= 0) {
      s.flipT += dt / 0.8;
      if (s.flipT >= 1) s.flipT = -1;
    }

    // ---- centre of mass offset (walls push the body off the plane) ----
    const wl = s.wall;
    if (wl) {
      const out = wl.run ? 0.5 : -0.05;
      _off.set(wl.f.nx * out, COM_H, wl.f.nz * out);
    } else _off.set(0, COM_H, 0);
    s.comOff.lerp(_off, 1 - Math.exp(-12 * dt));
    const rp = _rp.copy(s.renderPos).add(s.visOff);

    // ---- hero pose ----
    const g = gfx.current;
    const hv = Math.hypot(s.vel.x, s.vel.z);
    if (hv > 0.6 && !wl) s.facing = Math.atan2(s.vel.x, s.vel.z);
    _hv.set(Math.sin(s.facing), 0, Math.cos(s.facing));
    const w = s.web;
    const z = s.zip;
    if (g) {
      const { rig, anim, web, animIn, splats } = g;
      animIn.speed = hv;
      animIn.vy = s.vel.y;
      animIn.anchor = w ? w.anchor : z ? z.anchor : null;
      animIn.hand = w ? w.hand : z ? z.hand : s.lastHand;
      animIn.flip = s.flipT;
      animIn.trick = s.trick;
      animIn.impact = s.fallSpeed;
      animIn.webT = w ? w.t : z ? z.t : 0;
      animIn.dive = !s.onGround && !w && !wl && !z && (k.has("ShiftLeft") || k.has("ShiftRight")) && s.vel.y < -4;
      _com.copy(rp).add(s.comOff);
      if (wl) {
        const n = _n.set(wl.f.nx, 0, wl.f.nz);
        animIn.speed = s.vel.length();
        if (wl.run && animIn.speed > 3) {
          // running on the wall: the wall is the floor
          animIn.mode = Mode.WallRun;
          _bodyUp.copy(n);
          _bodyFwd.copy(s.vel).normalize();
          animIn.orientRate = 9;
        } else {
          animIn.mode = Mode.WallCrawl;
          _bodyUp.copy(s.wallDir);
          if (Math.abs(_bodyUp.dot(n)) > 0.9) _bodyUp.set(0, 1, 0);
          _bodyFwd.copy(n).negate();
          animIn.orientRate = 8;
        }
      } else if (z) {
        animIn.mode = Mode.Zip;
        _bodyFwd.copy(z.anchor).sub(_com).normalize();
        _bodyUp.copy(_up).addScaledVector(_bodyFwd, -_bodyFwd.y).normalize();
        if (_bodyUp.lengthSq() < 0.1) _bodyUp.copy(_hv);
        animIn.orientRate = 8;
      } else if (s.onGround) {
        animIn.mode = Mode.Ground;
        _bodyUp.copy(_up);
        _bodyFwd.copy(_hv);
        animIn.orientRate = 12;
      } else if (w) {
        animIn.mode = Mode.Swing;
        _bodyUp.copy(w.anchor).sub(_com).normalize().lerp(_up, 0.15).normalize();
        _bodyFwd.copy(s.vel);
        if (_bodyFwd.lengthSq() < 1) _bodyFwd.copy(_hv);
        _bodyFwd.normalize();
        _d.copy(_com).sub(w.anchor).setY(0);
        const along = _d.dot(_hv);
        animIn.swingPhase = 0.5 + 0.5 * THREE.MathUtils.clamp(along / (0.6 * w.len), -1, 1);
        animIn.orientRate = 7;
      } else {
        animIn.mode = Mode.Air;
        let p: number;
        if (animIn.dive) p = Math.atan2(hv, s.vel.y);
        else if (s.vel.y > 4) p = 0.2;
        else p = THREE.MathUtils.clamp(-s.vel.y / 24, 0, 1) * 1.1;
        const c = Math.cos(p);
        const sn = Math.sin(p);
        _bodyUp.copy(_up).multiplyScalar(c).addScaledVector(_hv, sn);
        _bodyFwd.copy(_hv).multiplyScalar(c).addScaledVector(_up, -sn);
        animIn.orientRate = 4.5;
      }
      animIn.up.copy(_bodyUp);
      animIn.fwd.copy(_bodyFwd);
      rig.root.position.copy(_com);
      anim.update(dt, animIn);
      splats.update(dt);

      // ---- web strand (swing rope or zip line) ----
      const strand = w ? { anchor: w.anchor, hand: w.hand, t: w.t, arrive: w.arrive } : z ? { anchor: z.anchor, hand: z.hand, t: z.t, arrive: z.travel } : null;
      if (strand) {
        web.mesh.visible = true;
        const extend = Math.min(1, (strand.t + 0.012) / Math.max(0.03, strand.arrive) + (started ? 0 : 1));
        const slack = Math.max(0, 1 - (strand.t - strand.arrive) / 0.2) * (w ? 1 : 0.4);
        web.update(anim.palmWorld[strand.hand], strand.anchor, camera.position, extend, Math.min(1, slack), s.time);
        if (strand.t >= strand.arrive && strand.t - dt < strand.arrive) {
          // impact puff where the strand sticks
          particles.current?.emit(strand.anchor, _tmp2.set(0, 0, 0), { life: 0.4, size: 1.4, color: "#ffffff", grow: 1.2 });
        }
      } else if (primeFrames > 0) {
        // degenerate (zero-length) strand: draws nothing visible
        web.mesh.visible = true;
        web.update(anim.palmWorld[0], anim.palmWorld[0], camera.position, 0, 0, s.time);
      } else web.mesh.visible = false;
      if (primeFrames > 0) {
        splats.prime(primeFrames > 1);
        primeFrames--;
      }
    } else _com.copy(rp).add(s.comOff);
    focus.current.copy(_com);

    // ---- camera (all smoothing is exponential/critically damped → frame-rate independent) ----
    const speed = s.vel.length();
    speedRef.current = speed;
    if (!s.camInit) s.camSmooth.copy(_com);
    s.camSmooth.lerp(_com, 1 - Math.exp(-(s.onGround ? 14 : wl ? 10 : 9) * dt));
    // don't let the smoothed target trail too far behind at high speed (soft limit)
    _d.copy(s.camSmooth).sub(_com);
    const lag = _d.length();
    const maxLag = 0.9;
    if (lag > maxLag) s.camSmooth.copy(_com).addScaledVector(_d, (maxLag + (lag - maxLag) * 0.25) / lag);
    const autoPitch = wl
      ? wl.run && s.vel.y > 2
        ? 0.5
        : s.vel.y < -2
          ? -0.3
          : 0.08
      : s.onGround
        ? -0.14
        : THREE.MathUtils.clamp(-0.16 + s.vel.y * 0.006, -0.45, 0.05);
    if (lockedRef.current && touchIdle) {
      // touch: drift the drag pitch back towards the automatic framing
      pitchRef.current += (autoPitch - pitchRef.current) * (1 - Math.exp(-1.5 * dt));
    }
    const targetPitch = lockedRef.current ? pitchRef.current : autoPitch;
    s.camPitch += (targetPitch - s.camPitch) * (1 - Math.exp(-(manual ? 30 : lockedRef.current ? 12 : 3) * dt));
    const wantDist = wl ? (wl.run ? 4.8 : 4.3) : 3.9 + Math.min(1.2, speed / 40);
    s.camDist += (wantDist - s.camDist) * (1 - Math.exp(-3 * dt));
    const dist = s.dbgDist || s.camDist;
    const vYaw = s.camYaw + s.dbgYaw;
    _right.set(Math.cos(vYaw), 0, -Math.sin(vYaw));
    _camTarget.copy(s.camSmooth).addScaledVector(_up, 0.55).addScaledVector(_right, 0.45);
    // on a wall: pivot a little off the wall so the camera never grazes it
    if (wl) _off.set(wl.f.nx * 0.35, 0, wl.f.nz * 0.35);
    else _off.set(0, 0, 0);
    _camTarget.add(_off);
    // the over-the-shoulder offset must never put the pivot inside a building
    if (volumeAt(_camTarget.x, _camTarget.y, _camTarget.z, city.buildings, 0.25)) {
      _camTarget.copy(s.camSmooth).addScaledVector(_up, 0.55).add(_off);
    }
    const cp = Math.cos(s.camPitch);
    _camPos
      .set(Math.sin(vYaw) * cp, -Math.sin(s.camPitch), Math.cos(vYaw) * cp)
      .multiplyScalar(dist)
      .add(_camTarget);
    if (_camPos.y < 0.6) _camPos.y = 0.6;
    _d.copy(_camPos).sub(_camTarget);
    const cd = _d.length();
    _d.divideScalar(cd);
    // occlusion: a fat ray (centre + 4 offset rays ≈ sphere cast r=0.35)
    let free = cd;
    for (let i = 0; i < 5; i++) {
      _origin.copy(_camTarget);
      if (i > 0) {
        const a = (i - 1) * (Math.PI / 2);
        _tmp.crossVectors(_d, _up).normalize();
        _tmp2.crossVectors(_tmp, _d);
        _origin.addScaledVector(_tmp, Math.cos(a) * 0.35).addScaledVector(_tmp2, Math.sin(a) * 0.35);
      }
      const hit = raycastBuildings(_origin, _d, cd, city.buildings);
      if (hit && hit.dist < free) free = hit.dist;
    }
    const want = Math.max(1.0, free - 0.35);
    if (!s.camInit) {
      s.camColl = want;
    } else if (want < s.camColl) {
      // pull in fast but continuously; only hard-snap if the camera would be inside a wall
      s.camColl += (want - s.camColl) * (1 - Math.exp(-28 * dt));
      if (s.camColl > free) s.camColl = want;
    } else {
      s.camColl += (want - s.camColl) * (1 - Math.exp(-2.5 * dt));
    }
    s.camInit = true;
    camera.position.copy(_camTarget).addScaledVector(_d, Math.min(cd, s.camColl));
    // impact shake (landings, wall hits, launches)
    if (s.shake > 0.001) {
      const a = s.shake * s.shake * 0.12;
      camera.position.x += Math.sin(s.time * 61) * a;
      camera.position.y += Math.sin(s.time * 47 + 1.3) * a;
      camera.position.z += Math.sin(s.time * 53 + 2.1) * a;
      s.shake *= Math.exp(-5 * dt);
    }
    // never look at the hero from behind the boundary fence
    {
      const lim = city.bounds.max - 1.2;
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -lim, lim);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -lim, lim);
    }
    cam.lookAt(_camTarget);
    // roll into the swing
    let rollT = 0;
    if (w) {
      _d.copy(w.anchor).sub(_com);
      rollT = THREE.MathUtils.clamp(-_d.dot(_right) / (w.len + 1), -1, 1) * 0.1;
    }
    s.camRoll += (rollT - s.camRoll) * (1 - Math.exp(-3 * dt));
    cam.rotateZ(s.camRoll);
    cam.getWorldDirection(s.camDir);
    const targetFov = 60 + Math.min(1, speed / 55) * 14;
    const nf = cam.fov + (targetFov - cam.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(nf - cam.fov) > 1e-3) {
      cam.fov = nf;
      cam.updateProjectionMatrix();
    }
    s.edge = distanceToEdge(s.pos.x, s.pos.z, city) < BOUNDARY_WARN;

    // ---- HUD throttle ~10Hz ----
    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      const nh: Hud = {
        speed: Math.round(speed * 3.6),
        height: Math.round(s.pos.y),
        locked: lockedRef.current,
        attached: !!s.web || !!s.zip,
        rings: s.ringsGot,
        score: s.score,
        combo: s.combo,
        bannerId: s.bannerT > 0 ? s.bannerId : 0,
        bannerText: s.bannerText,
        edge: s.edge,
        place: s.wall ? 2 : s.onGround ? 0 : 1,
        wallHint: !!s.wall && s.wallVisits <= 3,
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
        o.bannerId !== nh.bannerId ||
        o.edge !== nh.edge ||
        o.place !== nh.place ||
        o.wallHint !== nh.wallHint
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
    edge: false,
    place: 0,
    wallHint: false,
  });
  // the 3D tree must not re-render with every HUD update (≈10×/s)
  const scene = useMemo(() => <SpidermanScene started={started} onHud={setHud} />, [started]);
  return (
    <div className="absolute inset-0">
      <Canvas shadows="percentage" dpr={[1, 1.5]} gl={CANVAS_GL} camera={{ fov: 60, near: 0.2, far: 3000 }}>
        {scene}
      </Canvas>
      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
        <HudStat label="Skor" value={`${hud.score}`} accent={ACCENT} sub={hud.combo > 1 ? `×${hud.combo} kombo` : undefined} />
        <HudStat label="Halka" value={`${hud.rings}/${RING_COUNT}`} accent="#0284c7" />
        <HudStat label="Hız" value={`${hud.speed} km/h`} accent="#14141f" />
        <HudStat label="Yükseklik" value={`${hud.height} m`} accent="#6b6880" />
      </div>
      <HudEdge show={started && hud.edge} />
      {hud.bannerId > 0 && <HudBanner keyId={hud.bannerId} text={hud.bannerText} accent="#0284c7" />}
      {started && !hud.locked && <HudCenter text="Tıkla: fare ile bak · Space / Sol tık basılı: ağ at · Q / Sağ tık: zip" />}
      {started && hud.rings === RING_COUNT && (
        <HudBanner text="Tüm halkalar toplandı!" accent={ACCENT} sub={`Skor ${hud.score}`} />
      )}
      {started && hud.wallHint && (
        <HudHint
          text="W/A/S/D tırman · Shift ile duvarda koş · Space ile sıçra"
          touchText="Joystick ile tırman · Koş ile duvarda koş · Ağ ile sıçra"
        />
      )}
      {started && hud.place === 0 && !hud.attached && hud.height < 2 && hud.speed < 5 && (
        <HudHint
          text="Ağ için Space'e basılı tut, bırakınca uçarsın · Binaya doğru koş: tırman"
          touchText="Ağ tuşuna basılı tut, bırakınca uçarsın · Binaya doğru it: tırman"
        />
      )}
    </div>
  );
}

"use client";

// Endless night highway for "Makas": dual three-lane carriageway with a
// concrete median, W-beam guard rails, twin-arm median lights with light
// pools, overhead gantry signs, verges with trees, and procedural-facade
// buildings on both sides that recycle as the player drives (-Z).

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../shared/cityGen";
import { getFacadeMaterial, makeFacadeAttributes } from "../shared/facade";
import { asphaltTexture, grassTexture, lampGeometries, pavingTexture, treeGeometries } from "../shared/streetAssets";
import { makeGlowTexture } from "../shared/City";

export const LANE_W = 3.7;
export const LANES = 3;
/** player carriageway lane centres: 0, 3.7, 7.4 (driving towards -Z) */
export const R_EDGE = LANE_W * (LANES - 0.5); // 9.25
export const L_EDGE = -LANE_W / 2; // -1.85
export const MEDIAN_X = -3.1;
export const ONCOMING_X = [-6.2, -9.9, -13.6];
const ON_IN = -4.35;
const ON_OUT = -15.45;
const R_RAIL = 12.4;
const L_RAIL = -18.4;
const ROAD_X0 = -18.9;
const ROAD_X1 = 12.9;

const P = 72; // repeat period of everything in the scrolling strip
const AHEAD = 1260;
const BEHIND = 108;
const STRIP = AHEAD + BEHIND;
export const CYCLE = 960;
/** floating-origin step (must be a multiple of the strip period) */
export const REBASE = 72; // building recycle length
const GANTRY_GAP = 480;

const _o = new THREE.Object3D();

/* ------------------------------------------------------------ textures */

function markingTexture(): THREE.CanvasTexture {
  const x0 = ROAD_X0;
  const x1 = ROAD_X1;
  const ppm = 28;
  const W = Math.round((x1 - x0) * ppm);
  const H = Math.round(18 * ppm);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  const X = (x: number) => (x - x0) * ppm;
  const white = "rgba(240,240,232,0.95)";
  const solid = (x: number, w = 0.2, col = white) => {
    g.fillStyle = col;
    g.fillRect(X(x) - (w * ppm) / 2, 0, w * ppm, H);
  };
  const dash = (x: number) => {
    g.fillStyle = white;
    g.fillRect(X(x) - 0.075 * ppm, 0, 0.15 * ppm, 6 * ppm);
  };
  solid(R_EDGE);
  solid(L_EDGE, 0.2, "rgba(240,200,70,0.95)");
  solid(ON_IN, 0.2, "rgba(240,200,70,0.95)");
  solid(ON_OUT);
  dash(LANE_W / 2);
  dash(LANE_W * 1.5);
  dash((ONCOMING_X[0] + ONCOMING_X[1]) / 2);
  dash((ONCOMING_X[1] + ONCOMING_X[2]) / 2);
  // rumble strip on the right shoulder
  g.fillStyle = "rgba(200,200,196,0.35)";
  for (let y = 0; y < 18; y += 0.6) g.fillRect(X(R_EDGE + 0.35), y * ppm, 0.5 * ppm, 0.25 * ppm);
  // tyre polish in the wheel paths (lighter, smoother bands)
  const lanes = [0, LANE_W, LANE_W * 2, ...ONCOMING_X];
  for (const lx of lanes) {
    for (const off of [-0.8, 0.8]) {
      const grad = g.createLinearGradient(X(lx + off - 0.45), 0, X(lx + off + 0.45), 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, "rgba(10,10,12,0.22)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(X(lx + off - 0.45), 0, 0.9 * ppm, H);
    }
    // oil drip line in the lane centre
    const grad = g.createLinearGradient(X(lx - 0.35), 0, X(lx + 0.35), 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(8,8,10,0.18)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(X(lx - 0.35), 0, 0.7 * ppm, H);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const SIGNS = [
  [
    { w: 7.2, lines: ["Kadıköy", "Üsküdar"], arrow: "↓", tag: "O-1" },
    { w: 5.2, lines: ["Levent", "Maslak"], arrow: "↘", tag: "ÇIKIŞ 7" },
  ],
  [
    { w: 7.2, lines: ["15 Temmuz Şehitler", "Köprüsü"], arrow: "↓", tag: "O-1" },
    { w: 5.2, lines: ["Beşiktaş", "Ortaköy"], arrow: "↘", tag: "ÇIKIŞ 8" },
  ],
];

function signTexture(s: { w: number; lines: string[]; arrow: string; tag: string }): THREE.CanvasTexture {
  const ppm = 96;
  const W = Math.round(s.w * ppm);
  const H = Math.round(2.2 * ppm);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a5a34";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#f2f2ee";
  g.lineWidth = 6;
  g.strokeRect(9, 9, W - 18, H - 18);
  g.fillStyle = "#f2f2ee";
  g.font = `700 ${Math.round(H * 0.25)}px system-ui, "Helvetica Neue", Arial, sans-serif`;
  g.textBaseline = "middle";
  s.lines.forEach((l, i) => g.fillText(l, 30, H * (0.34 + i * 0.3)));
  g.font = `700 ${Math.round(H * 0.5)}px system-ui, sans-serif`;
  g.textAlign = "right";
  g.fillText(s.arrow, W - 30, H * 0.52);
  // route shield
  g.textAlign = "left";
  g.font = `800 ${Math.round(H * 0.15)}px system-ui, sans-serif`;
  const tw = g.measureText(s.tag).width;
  g.fillStyle = s.tag.startsWith("O") ? "#f2f2ee" : "#e8b400";
  g.fillRect(W - tw - 150, 20, tw + 24, H * 0.2);
  g.fillStyle = "#0a0a0a";
  g.fillText(s.tag, W - tw - 138, 20 + H * 0.1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------ geometry */

function barrierGeometry(len: number): THREE.BufferGeometry {
  // New-Jersey concrete profile (x, y)
  const s = new THREE.Shape();
  s.moveTo(-0.41, 0);
  s.lineTo(-0.41, 0.08);
  s.lineTo(-0.2, 0.33);
  s.lineTo(-0.09, 0.86);
  s.lineTo(0.09, 0.86);
  s.lineTo(0.2, 0.33);
  s.lineTo(0.41, 0.08);
  s.lineTo(0.41, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -len);
  return g;
}

function railGeometry(len: number): THREE.BufferGeometry {
  // W-beam, facing +x (towards the road on the left side it is mirrored)
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [0, 0.54],
    [0.07, 0.6],
    [0.07, 0.64],
    [0.02, 0.7],
    [0.07, 0.76],
    [0.07, 0.8],
    [0, 0.86],
    [-0.012, 0.86],
    [0.055, 0.8],
    [0.055, 0.76],
    [0.005, 0.7],
    [0.055, 0.64],
    [0.055, 0.6],
    [-0.012, 0.54],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -len);
  g.computeVertexNormals();
  return g;
}

function medianLampGeometry(): { pole: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const H = 12;
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.09, 0.16, H, 10);
  pole.translate(0, H / 2 + 0.86, 0);
  parts.push(pole);
  const base = new THREE.BoxGeometry(0.5, 0.25, 0.5);
  base.translate(0, 0.98, 0);
  parts.push(base);
  const heads: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const arm = new THREE.CylinderGeometry(0.05, 0.06, 2.8, 8);
    arm.rotateZ((sx * -Math.PI) / 2 + sx * 0.12);
    arm.translate(sx * 1.35, H + 0.86 + 0.12, 0);
    parts.push(arm);
    const housing = new THREE.BoxGeometry(0.9, 0.16, 0.36);
    housing.translate(sx * 2.8, H + 0.86 + 0.26, 0);
    parts.push(housing);
    const lens = new THREE.BoxGeometry(0.76, 0.03, 0.26);
    lens.translate(sx * 2.8, H + 0.86 + 0.17, 0);
    heads.push(lens);
  }
  return { pole: mergeGeometries(parts)!, heads: mergeGeometries(heads)! };
}

function gantryGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const xa = MEDIAN_X;
  const xb = R_RAIL + 0.8;
  const H = 7.6;
  for (const x of [xa, xb]) {
    for (const dz of [-0.4, 0.4]) {
      const post = new THREE.CylinderGeometry(0.13, 0.15, H, 10);
      post.translate(x, H / 2, dz);
      parts.push(post);
    }
    const foot = new THREE.BoxGeometry(1.2, 0.5, 1.4);
    foot.translate(x, 0.25, 0);
    parts.push(foot);
  }
  const span = xb - xa;
  for (const y of [H - 1.25, H - 0.1]) {
    for (const dz of [-0.4, 0.4]) {
      const chord = new THREE.CylinderGeometry(0.07, 0.07, span, 8);
      chord.rotateZ(Math.PI / 2);
      chord.translate((xa + xb) / 2, y, dz);
      parts.push(chord);
    }
  }
  // web members
  const n = Math.round(span / 1.2);
  for (let i = 0; i <= n; i++) {
    const x = xa + (span * i) / n;
    for (const dz of [-0.4, 0.4]) {
      const v = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 6);
      v.translate(x, H - 0.68, dz);
      parts.push(v);
    }
    if (i < n) {
      const d = new THREE.CylinderGeometry(0.03, 0.03, Math.hypot(span / n, 1.15), 6);
      d.rotateZ(Math.atan2(span / n, 1.15) * (i % 2 ? 1 : -1));
      d.translate(x + span / n / 2, H - 0.68, 0.4);
      parts.push(d);
      const d2 = d.clone();
      d2.translate(0, 0, -0.8);
      parts.push(d2);
    }
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/* ------------------------------------------------------------ buildings */

interface Vol {
  b: number;
  x: number;
  zOff: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  style: number;
  seed: number;
  solid?: boolean;
}

function makeBuildings(): { vols: Vol[]; bz: number[]; bHalf: number[] } {
  const rand = mulberry32(2024);
  const vols: Vol[] = [];
  const bz: number[] = [];
  const bHalf: number[] = [];
  const pick = (tall: boolean) => {
    const r = rand();
    if (tall) return r < 0.45 ? 0 : r < 0.7 ? 4 : r < 0.88 ? 1 : 5;
    return r < 0.35 ? 3 : r < 0.6 ? 2 : r < 0.8 ? 5 : 1;
  };
  const add = (side: number, xNear: number, xFar: number, len0: number, len1: number, gap0: number, gap1: number, h0: number, h1: number, tallChance: number) => {
    let z = BEHIND - 10;
    while (z > BEHIND - 10 - CYCLE) {
      const len = len0 + rand() * (len1 - len0);
      const depth = Math.min(xFar - xNear, 12 + rand() * 22);
      const xc = side * (xNear + depth / 2 + rand() * Math.max(0, xFar - xNear - depth));
      const zc = z - len / 2;
      const bi = bz.length;
      bz.push(zc);
      bHalf.push(len / 2);
      const tall = rand() < tallChance;
      let h = tall ? h1 * (0.55 + rand() * 0.45) : h0 + rand() * (h1 * 0.45 - h0);
      h = Math.round(h / 3.4) * 3.4 + 1.2;
      const style = pick(tall);
      const seed = rand();
      // only some buildings get lit shopfronts (y0 = 0 turns them on in the facade shader)
      const g0 = xNear < 60 && rand() < 0.4 ? 0 : 0.02;
      if (tall && depth > 16 && len > 16) {
        const podH = 3.4 * (2 + Math.floor(rand() * 3)) + 1.2;
        vols.push({ b: bi, x: xc, zOff: 0, w: depth, d: len, y0: g0, h: podH, style: rand() < 0.5 ? 1 : 5, seed });
        const inset = 2 + rand() * 2;
        const tw = depth - inset * 2;
        const td = len - inset * 2;
        const top = rand() < 0.5 ? h * 0.78 : h;
        vols.push({ b: bi, x: xc, zOff: 0, w: tw, d: td, y0: podH, h: top, style, seed });
        if (top < h) vols.push({ b: bi, x: xc, zOff: 0, w: tw * 0.7, d: td * 0.7, y0: top, h, style, seed });
        const tt = top < h ? { w: tw * 0.7, d: td * 0.7, h } : { w: tw, d: td, h: top };
        vols.push({ b: bi, x: xc, zOff: 0, w: tt.w, d: tt.d, y0: tt.h, h: tt.h + 1.1, style, seed, solid: true });
      } else {
        vols.push({ b: bi, x: xc, zOff: 0, w: depth, d: len, y0: g0, h, style, seed });
        vols.push({ b: bi, x: xc, zOff: 0, w: depth + 0.3, d: len + 0.3, y0: h, h: h + 0.9, style, seed, solid: true });
      }
      z -= len + gap0 + rand() * (gap1 - gap0);
    }
  };
  for (const side of [1, -1]) {
    const near = side > 0 ? 29 : 33;
    add(side, near, near + 26, 16, 38, 2, 9, 9, 48, 0.12);
    add(side, near + 34, near + 90, 20, 44, 6, 30, 18, 110, 0.35);
    add(side, near + 150, near + 420, 26, 50, 40, 140, 40, 190, 0.8);
  }
  return { vols, bz, bHalf };
}

function Buildings({ zRef, shiftRef }: { zRef: React.RefObject<number>; shiftRef: React.RefObject<number> }) {
  const seenShift = useRef(0);
  const facade = getFacadeMaterial();
  useLayoutEffect(() => {
    getFacadeMaterial().uniforms.uNight.value = 1;
  }, []);
  const data = useMemo(() => makeBuildings(), []);
  // mutable building z positions (recycled as the player drives)
  const bzRef = useRef<number[]>([]);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const list = data.vols.map((v) => ({ ...v, z: data.bz[v.b] + v.zOff }));
    const { aBox, aParams } = makeFacadeAttributes(list);
    aBox.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aBox", aBox);
    g.setAttribute("aParams", aParams);
    return g;
  }, [data]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const byB = useMemo(() => {
    const m: number[][] = data.bz.map(() => []);
    data.vols.forEach((v, i) => m[v.b].push(i));
    return m;
  }, [data]);
  const place = (im: THREE.InstancedMesh, bz: number[], i: number) => {
    const v = data.vols[i];
    const z = bz[v.b] + v.zOff;
    _o.position.set(v.x, (v.y0 + v.h) / 2, z);
    _o.rotation.set(0, 0, 0);
    _o.scale.set(v.w, v.h - v.y0, v.d);
    _o.updateMatrix();
    im.setMatrixAt(i, _o.matrix);
    const ab = geo.getAttribute("aBox") as THREE.InstancedBufferAttribute;
    ab.setXYZW(i, v.x, z, v.w, v.d);
  };
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    bzRef.current = data.bz.slice();
    for (let i = 0; i < data.vols.length; i++) place(im, bzRef.current, i);
    im.instanceMatrix.needsUpdate = true;
    (geo.getAttribute("aBox") as THREE.InstancedBufferAttribute).needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, geo]);

  useFrame(() => {
    const im = ref.current;
    if (!im) return;
    const pz = zRef.current ?? 0;
    let dirty = false;
    const bz = bzRef.current;
    const shift = (shiftRef.current ?? 0) - seenShift.current;
    if (shift !== 0) {
      seenShift.current += shift;
      for (let b = 0; b < bz.length; b++) bz[b] += shift;
      for (let i = 0; i < data.vols.length; i++) place(im, bz, i);
      dirty = true;
    }
    for (let b = 0; b < bz.length; b++) {
      if (bz[b] - data.bHalf[b] > pz + 60) {
        bz[b] -= CYCLE;
        for (const i of byB[b]) place(im, bz, i);
        dirty = true;
      }
    }
    if (dirty) {
      im.instanceMatrix.needsUpdate = true;
      (geo.getAttribute("aBox") as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  });

  return <instancedMesh ref={ref} args={[geo, facade.material, data.vols.length]} frustumCulled={false} />;
}

/* ------------------------------------------------------------ gantries */

function Gantries({ zRef, shiftRef }: { zRef: React.RefObject<number>; shiftRef: React.RefObject<number> }) {
  const seenShift = useRef(0);
  const frame = useMemo(() => gantryGeometry(), []);
  const signs = useMemo(
    () =>
      SIGNS.map((set) =>
        set.map((s) => {
          const t = signTexture(s);
          return {
            w: s.w,
            mat: new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: "#ffffff", emissiveIntensity: 0.32, roughness: 0.55 }),
          };
        })
      ),
    []
  );
  const groups = useRef<(THREE.Group | null)[]>([]);
  const zs = useRef([-260, -260 - GANTRY_GAP]);
  useFrame(() => {
    const pz = zRef.current ?? 0;
    const shift = (shiftRef.current ?? 0) - seenShift.current;
    seenShift.current += shift;
    zs.current.forEach((z0, i) => {
      const z = z0 + shift;
      zs.current[i] = z;
      if (z > pz + 40) zs.current[i] = z - GANTRY_GAP * 2;
      const g = groups.current[i];
      if (g) g.position.z = zs.current[i];
    });
  });
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8d949c", metalness: 0.75, roughness: 0.42 }), []);
  const lampMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#f3f7ff", emissiveIntensity: 5 }), []);
  return (
    <>
      {[0, 1].map((gi) => (
        <group key={gi} ref={(g) => { groups.current[gi] = g; }}>
          <mesh geometry={frame} material={steel} />
          {signs[gi].map((s, si) => {
            const x = si === 0 ? LANE_W * 0.5 : LANE_W * 2.35 + 0.4;
            return (
              <group key={si} position={[x, 5.25, 0.55]}>
                <mesh material={s.mat}>
                  <planeGeometry args={[s.w, 2.2]} />
                </mesh>
                <mesh position={[0, 0, -0.06]} material={steel}>
                  <boxGeometry args={[s.w + 0.1, 2.3, 0.08]} />
                </mesh>
                {[-0.3, 0, 0.3].map((f) => (
                  <group key={f} position={[f * s.w, -1.25, 0.35]}>
                    <mesh material={steel}>
                      <boxGeometry args={[0.5, 0.08, 0.3]} />
                    </mesh>
                    <mesh position={[0, 0.045, 0.0]} rotation={[-Math.PI / 2, 0, 0]} material={lampMat}>
                      <planeGeometry args={[0.4, 0.2]} />
                    </mesh>
                  </group>
                ))}
              </group>
            );
          })}
        </group>
      ))}
    </>
  );
}

/* ------------------------------------------------------------ periodic strip */

function Strip({ zRef }: { zRef: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const road = useMemo(() => {
    const t = asphaltTexture().clone();
    t.repeat.set((ROAD_X1 - ROAD_X0) / 8, STRIP / 8);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#9a9a9a", roughness: 0.72, metalness: 0.0 });
  }, []);
  const marks = useMemo(() => {
    const t = markingTexture();
    t.repeat.set(1, STRIP / 18);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map: t,
      transparent: true,
      depthWrite: false,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }, []);
  const ground = useMemo(() => {
    const t = asphaltTexture().clone();
    t.repeat.set(1200 / 8, STRIP / 8);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#55565a", roughness: 0.95 });
  }, []);
  const grass = useMemo(() => {
    const t = grassTexture().clone();
    t.repeat.set(10 / 4, STRIP / 4);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#8c9a80", roughness: 1 });
  }, []);
  const pave = useMemo(() => {
    const t = pavingTexture().clone();
    t.repeat.set(6 / 2, STRIP / 2);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#bdbab4", roughness: 0.9 });
  }, []);
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a8a59e", roughness: 0.88 }), []);
  const galv = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a9b0b6", metalness: 0.85, roughness: 0.38 }), []);
  const lampPole = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6d737a", metalness: 0.7, roughness: 0.45 }), []);
  const lampHead = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#fff4e0", emissive: "#ffd9a6", emissiveIntensity: 9 }),
    []
  );
  const glowTex = useMemo(() => makeGlowTexture("rgba(255,214,160,0.95)"), []);
  const poolMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: "#ffc98a",
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [glowTex]
  );
  const reflMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffb347", emissive: "#ff9d2e", emissiveIntensity: 2.2 }), []);
  const reflWMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#e8eeff", emissiveIntensity: 1.6 }), []);

  const geo = useMemo(() => {
    const barrier = barrierGeometry(STRIP);
    const railR = railGeometry(STRIP);
    const railL = railGeometry(STRIP);
    railL.scale(-1, 1, 1);
    // scale(-1) flips winding: rebuild faces by flipping index order
    const idx = railL.index;
    if (idx) {
      const a = idx.array as Uint16Array;
      for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    } else {
      const pos = railL.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i += 3)
        for (let k = 0; k < 3; k++) [arr[(i + 1) * 3 + k], arr[(i + 2) * 3 + k]] = [arr[(i + 2) * 3 + k], arr[(i + 1) * 3 + k]];
    }
    railL.computeVertexNormals();
    const post = new THREE.BoxGeometry(0.1, 0.8, 0.15);
    post.translate(0, 0.4, 0);
    const lamp = medianLampGeometry();
    const tree = treeGeometries();
    const cityLamp = lampGeometries();
    return { barrier, railR, railL, post, lamp, tree, cityLamp };
  }, []);

  // per-period layouts (repeated every P metres across the strip)
  const layout = useMemo(() => {
    const reps = Math.ceil(STRIP / P);
    const posts: { x: number; z: number }[] = [];
    const lamps: { z: number }[] = [];
    const pools: { x: number; z: number }[] = [];
    const refl: { x: number; z: number }[] = [];
    const reflW: { x: number; z: number }[] = [];
    const trees: { x: number; z: number; s: number; r: number }[] = [];
    const cityLamps: { x: number; z: number; r: number }[] = [];
    const rand = mulberry32(5);
    const treeSlots: { x: number; z: number; s: number; r: number }[] = [];
    for (let i = 0; i < 6; i++) {
      treeSlots.push({ x: 16 + rand() * 5, z: -(i / 6) * P - rand() * 6, s: 0.9 + rand() * 0.5, r: rand() * 6.28 });
      treeSlots.push({ x: -(22 + rand() * 4), z: -(i / 6) * P - rand() * 6, s: 0.9 + rand() * 0.5, r: rand() * 6.28 });
    }
    for (let r = 0; r < reps; r++) {
      const z0 = BEHIND - r * P;
      for (let z = 0; z < P; z += 2) {
        posts.push({ x: R_RAIL + 0.1, z: z0 - z });
        posts.push({ x: L_RAIL - 0.1, z: z0 - z });
      }
      for (let z = 0; z < P; z += 36) {
        lamps.push({ z: z0 - z });
        pools.push({ x: MEDIAN_X + 4.2, z: z0 - z });
        pools.push({ x: MEDIAN_X - 4.2, z: z0 - z });
        cityLamps.push({ x: 24.2, z: z0 - z - 18, r: -Math.PI / 2 });
        cityLamps.push({ x: -28.2, z: z0 - z - 18, r: Math.PI / 2 });
      }
      for (let z = 0; z < P; z += 12) {
        refl.push({ x: R_RAIL - 0.02, z: z0 - z });
        reflW.push({ x: L_RAIL + 0.02, z: z0 - z });
        refl.push({ x: MEDIAN_X - 0.3, z: z0 - z - 6 });
        reflW.push({ x: MEDIAN_X + 0.3, z: z0 - z - 6 });
      }
      for (const t of treeSlots) trees.push({ ...t, z: z0 + t.z });
    }
    return { posts, lamps, pools, refl, reflW, trees, cityLamps };
  }, []);

  const postRef = useRef<THREE.InstancedMesh>(null);
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const reflRef = useRef<THREE.InstancedMesh>(null);
  const reflWRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const cPoleRef = useRef<THREE.InstancedMesh>(null);
  const cHeadRef = useRef<THREE.InstancedMesh>(null);
  const cPoolRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const set = <T,>(ref: React.RefObject<THREE.InstancedMesh | null>, list: T[], f: (t: T, o: THREE.Object3D) => void, col?: (t: T, c: THREE.Color) => void) => {
      const im = ref.current;
      if (!im) return;
      const c = new THREE.Color();
      list.forEach((t, i) => {
        _o.position.set(0, 0, 0);
        _o.rotation.set(0, 0, 0);
        _o.scale.set(1, 1, 1);
        f(t, _o);
        _o.updateMatrix();
        im.setMatrixAt(i, _o.matrix);
        if (col) {
          col(t, c);
          im.setColorAt(i, c);
        }
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    set(postRef, layout.posts, (p, o) => o.position.set(p.x, 0, p.z));
    set(poleRef, layout.lamps, (l, o) => o.position.set(MEDIAN_X, 0, l.z));
    set(headRef, layout.lamps, (l, o) => o.position.set(MEDIAN_X, 0, l.z));
    set(poolRef, layout.pools, (p, o) => {
      o.position.set(p.x, 0.03, p.z);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.scale.set(17, 22, 1);
    });
    set(reflRef, layout.refl, (p, o) => o.position.set(p.x, 0.78, p.z));
    set(reflWRef, layout.reflW, (p, o) => o.position.set(p.x, 0.78, p.z));
    set(trunkRef, layout.trees, (t, o) => {
      o.position.set(t.x, 0, t.z);
      o.rotation.set(0, t.r, 0);
      o.scale.setScalar(t.s);
    });
    set(
      crownRef,
      layout.trees,
      (t, o) => {
        o.position.set(t.x, 0, t.z);
        o.rotation.set(0, t.r, 0);
        o.scale.set(t.s, t.s, t.s);
      },
      (t, c) => {
        const k = (t.r * 7.13) % 1;
        c.setRGB(0.2 + k * 0.1, 0.32 + k * 0.1, 0.13 + k * 0.05);
      }
    );
    set(cPoleRef, layout.cityLamps, (l, o) => {
      o.position.set(l.x, 0.15, l.z);
      o.rotation.set(0, l.r, 0);
    });
    set(cHeadRef, layout.cityLamps, (l, o) => {
      o.position.set(l.x, 0.15, l.z);
      o.rotation.set(0, l.r, 0);
    });
    set(cPoolRef, layout.cityLamps, (l, o) => {
      o.position.set(l.x + Math.sin(l.r) * 2, 0.2, l.z);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.scale.set(11, 11, 1);
    });
  }, [layout]);

  useFrame(() => {
    const g = group.current;
    if (g) g.position.z = Math.ceil((zRef.current ?? 0) / P) * P;
  });

  const zc = BEHIND - STRIP / 2;
  const n = (l: unknown[]) => l.length;
  return (
    <group ref={group}>
      {/* carriageways + shoulders */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ROAD_X0 + ROAD_X1) / 2, 0, zc]} material={road} receiveShadow>
        <planeGeometry args={[ROAD_X1 - ROAD_X0, STRIP]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ROAD_X0 + ROAD_X1) / 2, 0.006, zc]} material={marks}>
        <planeGeometry args={[ROAD_X1 - ROAD_X0, STRIP]} />
      </mesh>
      {/* verges, sidewalks, urban ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_X1 + 5, 0.02, zc]} material={grass}>
        <planeGeometry args={[10, STRIP]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_X0 - 5, 0.02, zc]} material={grass}>
        <planeGeometry args={[10, STRIP]} />
      </mesh>
      <mesh position={[ROAD_X1 + 13, 0.075, zc]} material={pave}>
        <boxGeometry args={[6, 0.15, STRIP]} />
      </mesh>
      <mesh position={[ROAD_X0 - 13, 0.075, zc]} material={pave}>
        <boxGeometry args={[6, 0.15, STRIP]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, zc]} material={ground}>
        <planeGeometry args={[1200, STRIP]} />
      </mesh>

      {/* median barrier + guard rails */}
      <mesh geometry={geo.barrier} material={concrete} position={[MEDIAN_X, 0, BEHIND]} />
      <mesh geometry={geo.railL} material={galv} position={[R_RAIL - 0.07, 0, BEHIND]} />
      <mesh geometry={geo.railR} material={galv} position={[L_RAIL + 0.07, 0, BEHIND]} />
      <instancedMesh ref={postRef} args={[geo.post, galv, n(layout.posts)]} frustumCulled={false} />
      <instancedMesh ref={reflRef} args={[undefined, reflMat, n(layout.refl)]} frustumCulled={false}>
        <boxGeometry args={[0.04, 0.09, 0.05]} />
      </instancedMesh>
      <instancedMesh ref={reflWRef} args={[undefined, reflWMat, n(layout.reflW)]} frustumCulled={false}>
        <boxGeometry args={[0.04, 0.09, 0.05]} />
      </instancedMesh>

      {/* median lighting */}
      <instancedMesh ref={poleRef} args={[geo.lamp.pole, lampPole, n(layout.lamps)]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[geo.lamp.heads, lampHead, n(layout.lamps)]} frustumCulled={false} />
      <instancedMesh ref={poolRef} args={[undefined, poolMat, n(layout.pools)]} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* trees + city street lamps beyond the verge */}
      <instancedMesh ref={trunkRef} args={[geo.tree.trunk, undefined, n(layout.trees)]} frustumCulled={false}>
        <meshStandardMaterial color="#3e3126" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[geo.tree.crown, undefined, n(layout.trees)]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={cPoleRef} args={[geo.cityLamp.pole, lampPole, n(layout.cityLamps)]} frustumCulled={false} />
      <instancedMesh ref={cHeadRef} args={[geo.cityLamp.head, lampHead, n(layout.cityLamps)]} frustumCulled={false} />
      <instancedMesh ref={cPoolRef} args={[undefined, poolMat, n(layout.cityLamps)]} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  );
}

/**
 * `zRef`: player z. `shiftRef`: accumulated floating-origin shift (the game
 * moves everything by +k·72 m now and then to stay near the origin).
 */
export default function Highway({ zRef, shiftRef }: { zRef: React.RefObject<number>; shiftRef: React.RefObject<number> }) {
  return (
    <>
      <color attach="background" args={["#0a0f1f"]} />
      <Strip zRef={zRef} />
      <Buildings zRef={zRef} shiftRef={shiftRef} />
      <Gantries zRef={zRef} shiftRef={shiftRef} />
    </>
  );
}

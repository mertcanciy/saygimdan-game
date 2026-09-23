// Procedural F-16 Fighting Falcon geometry.
//
// Local frame: +Z forward (nose), +Y up, +X = pilot's LEFT (port).
// Dimensions are real-world metres: length ~15.3 m, span ~9.9 m over the
// wingtip missiles. Stations `s` are measured aft from the nose tip:
// z = NOSE_Z - s.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const NOSE_Z = 7.5;
export const zs = (s: number) => NOSE_Z - s;

/* ---------------------------------------------------------------- lofts */

export interface Sec {
  s: number;
  w: number;
  ht: number;
  hb: number;
  yc: number;
  n: number;
}

const KEYS = ["s", "w", "ht", "hb", "yc", "n"] as const;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smoothly subdivide key sections (Catmull-Rom on every parameter). */
function resample(secs: Sec[], sub: number): Sec[] {
  const out: Sec[] = [];
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[Math.max(0, i - 1)];
    const b = secs[i];
    const c = secs[i + 1];
    const d = secs[Math.min(secs.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const o = {} as Sec;
      for (const key of KEYS) o[key] = catmull(a[key], b[key], c[key], d[key], t);
      o.w = Math.max(0.002, o.w);
      o.ht = Math.max(0.001, o.ht);
      o.hb = Math.max(0.001, o.hb);
      out.push(o);
    }
  }
  out.push({ ...secs[secs.length - 1] });
  return out;
}

/** Interpolated section at a station (for placing things on the skin). */
export function sectionAt(secs: Sec[], s: number): Sec {
  for (let i = 0; i < secs.length - 1; i++) {
    if (s >= secs[i].s && s <= secs[i + 1].s) {
      const a = secs[Math.max(0, i - 1)];
      const b = secs[i];
      const c = secs[i + 1];
      const d = secs[Math.min(secs.length - 1, i + 2)];
      const t = (s - b.s) / (c.s - b.s);
      const o = {} as Sec;
      for (const key of KEYS) o[key] = catmull(a[key], b[key], c[key], d[key], t);
      return o;
    }
  }
  return { ...secs[secs.length - 1] };
}

const se = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

/** y of the superellipse top at lateral offset x. */
export function topAt(sec: Sec, x: number) {
  const a = Math.min(0.999, Math.abs(x) / (sec.w / 2));
  return sec.yc + sec.ht * Math.pow(1 - Math.pow(a, sec.n), 1 / sec.n);
}

/**
 * Loft superellipse cross-sections along the station axis.
 * `half`: only the upper half (canopy bubble).
 */
function loft(keySecs: Sec[], seg: number, sub: number, half = false) {
  const secs = resample(keySecs, sub);
  const rows = secs.length;
  const cols = seg + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    const sec = secs[r];
    for (let j = 0; j < cols; j++) {
      const a = half ? (j / seg) * Math.PI : -Math.PI / 2 + (j / seg) * Math.PI * 2;
      const cx = se(Math.cos(a), sec.n);
      const cy = se(Math.sin(a), sec.n);
      const i = r * cols + j;
      pos[i * 3] = (cx * sec.w) / 2;
      pos[i * 3 + 1] = sec.yc + cy * (cy > 0 ? sec.ht : sec.hb);
      pos[i * 3 + 2] = NOSE_Z - sec.s;
      uv[i * 2] = sec.s / 16;
      uv[i * 2 + 1] = j / seg;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < seg; j++) {
      const a = r * cols + j;
      const b = a + cols;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure normals point outwards (top vertex of a middle ring must face up)
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const probe = Math.floor(rows / 2) * cols + Math.floor(seg / 2);
  if (n.getY(probe) < 0) {
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  if (!half) {
    // weld the seam normals (seam runs along the belly)
    const nn = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let r = 0; r < rows; r++) {
      const a = r * cols;
      const b = a + seg;
      const x = (nn.getX(a) + nn.getX(b)) / 2;
      const y = (nn.getY(a) + nn.getY(b)) / 2;
      const z = (nn.getZ(a) + nn.getZ(b)) / 2;
      const l = Math.hypot(x, y, z) || 1;
      nn.setXYZ(a, x / l, y / l, z / l);
      nn.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}

/* ------------------------------------------------------ extruded panels */

type P2 = [number, number];

function shapeFrom(pts: P2[]) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  return sh;
}

/** Quadratic bezier sampled into points (for smooth planform curves). */
function qbez(a: P2, c: P2, b: P2, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/**
 * Thin bevelled horizontal surface from a planform given as (x, station)
 * points. Returned geometry lies in the XZ plane, centred on y = 0.
 * `taper(x)` scales thickness (airfoil thins toward the tip).
 */
function hPanel(pts: P2[], thick: number, taper?: (x: number) => number) {
  const sh = shapeFrom(pts.map(([x, s]) => [x, s - NOSE_Z] as P2));
  const bevel = thick * 0.35;
  const depth = Math.max(0.004, thick - bevel * 2);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: Math.min(bevel * 1.2, 0.05),
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2); // shape Y -> -Z (so z = NOSE_Z - s), extrusion -> +Y
  g.translate(0, -depth / 2, 0);
  if (taper) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * taper(Math.abs(p.getX(i))));
  }
  g.computeVertexNormals();
  return g;
}

/** Vertical surface from (station, y) points; centred on x = 0. */
function vPanel(pts: P2[], thick: number, taper?: (y: number) => number) {
  const sh = shapeFrom(pts.map(([s, y]) => [NOSE_Z - s, y] as P2));
  const bevel = thick * 0.35;
  const depth = Math.max(0.004, thick - bevel * 2);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: Math.min(bevel * 1.2, 0.05),
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.rotateY(-Math.PI / 2); // shape X -> +Z, extrusion -> -X
  g.translate(depth / 2, 0, 0);
  if (taper) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getY(i)));
  }
  g.computeVertexNormals();
  return g;
}

/** Mirror across X (port -> starboard) keeping triangles front-facing. */
function mirrorX(src: THREE.BufferGeometry) {
  const g = (src.index ? src.toNonIndexed() : src.clone()) as THREE.BufferGeometry;
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const s = a.itemSize;
    const arr = a.array as Float32Array;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
    a.needsUpdate = true;
  }
  return g;
}

/* --------------------------------------------------------- paint scheme */

const C_TOP = new THREE.Color("#76797c"); // FS 36118-ish upper camo
const C_SIDE = new THREE.Color("#8f9295"); // FS 36270
const C_BELLY = new THREE.Color("#abadae"); // FS 36375
const C_RADOME = new THREE.Color("#63666a");
const _c = new THREE.Color();

/** Bake the counter-shaded grey scheme into vertex colours from normals. */
function paint(g: THREE.BufferGeometry, radomeTo = -1) {
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i);
    const s = NOSE_Z - p.getZ(i);
    if (s < radomeTo) {
      _c.copy(C_RADOME);
    } else if (ny > 0) {
      _c.copy(C_SIDE).lerp(C_TOP, THREE.MathUtils.smoothstep(ny, 0.35, 0.8));
    } else {
      _c.copy(C_SIDE).lerp(C_BELLY, THREE.MathUtils.smoothstep(-ny, 0.15, 0.6));
    }
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function prep(g: THREE.BufferGeometry, radomeTo = -1) {
  const ng = g.index ? g.toNonIndexed() : g;
  paint(ng, radomeTo);
  // keep only the attributes every part shares (for merging)
  for (const k of Object.keys(ng.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(k)) ng.deleteAttribute(k);
  }
  return ng;
}

/* -------------------------------------------------------------- the jet */

export const FUSELAGE: Sec[] = [
  { s: 0.0, w: 0.03, ht: 0.015, hb: 0.015, yc: 0.1, n: 2 },
  { s: 0.4, w: 0.3, ht: 0.15, hb: 0.15, yc: 0.1, n: 2 },
  { s: 1.0, w: 0.56, ht: 0.28, hb: 0.28, yc: 0.09, n: 2 },
  { s: 1.8, w: 0.8, ht: 0.4, hb: 0.39, yc: 0.07, n: 2.05 },
  { s: 2.6, w: 0.96, ht: 0.48, hb: 0.45, yc: 0.05, n: 2.2 },
  { s: 3.4, w: 1.06, ht: 0.54, hb: 0.48, yc: 0.04, n: 2.35 },
  { s: 4.3, w: 1.12, ht: 0.57, hb: 0.49, yc: 0.03, n: 2.45 },
  { s: 5.2, w: 1.18, ht: 0.6, hb: 0.5, yc: 0.02, n: 2.55 },
  { s: 6.1, w: 1.28, ht: 0.62, hb: 0.52, yc: 0.02, n: 2.65 },
  { s: 7.2, w: 1.38, ht: 0.63, hb: 0.55, yc: 0.02, n: 2.8 },
  { s: 8.4, w: 1.44, ht: 0.62, hb: 0.58, yc: 0.02, n: 2.9 },
  { s: 9.6, w: 1.46, ht: 0.6, hb: 0.6, yc: 0.02, n: 2.9 },
  { s: 10.8, w: 1.44, ht: 0.58, hb: 0.6, yc: 0.02, n: 2.8 },
  { s: 12.0, w: 1.36, ht: 0.56, hb: 0.58, yc: 0.02, n: 2.6 },
  { s: 13.0, w: 1.24, ht: 0.54, hb: 0.54, yc: 0.02, n: 2.35 },
  { s: 13.9, w: 1.1, ht: 0.52, hb: 0.52, yc: 0.02, n: 2.1 },
  { s: 14.5, w: 1.02, ht: 0.5, hb: 0.5, yc: 0.02, n: 2 },
];

/** Dorsal spine behind the canopy (narrow hump carrying fuel & avionics). */
const SPINE: Sec[] = [
  { s: 5.6, w: 0.5, ht: 0.18, hb: 0.25, yc: 0.4, n: 2.2 },
  { s: 6.5, w: 0.66, ht: 0.44, hb: 0.3, yc: 0.4, n: 2.3 },
  { s: 7.6, w: 0.74, ht: 0.48, hb: 0.3, yc: 0.4, n: 2.4 },
  { s: 9.2, w: 0.76, ht: 0.43, hb: 0.3, yc: 0.4, n: 2.4 },
  { s: 10.8, w: 0.72, ht: 0.35, hb: 0.3, yc: 0.4, n: 2.4 },
  { s: 12.4, w: 0.6, ht: 0.26, hb: 0.3, yc: 0.4, n: 2.3 },
  { s: 13.6, w: 0.42, ht: 0.16, hb: 0.3, yc: 0.4, n: 2.2 },
  { s: 14.3, w: 0.3, ht: 0.05, hb: 0.25, yc: 0.4, n: 2 },
];

/** Chin intake duct under the cockpit, blending into the belly. */
export const INTAKE: Sec[] = [
  { s: 4.25, w: 1.0, ht: 0.39, hb: 0.39, yc: -0.89, n: 2.9 },
  { s: 4.9, w: 1.04, ht: 0.395, hb: 0.395, yc: -0.875, n: 2.9 },
  { s: 5.6, w: 1.08, ht: 0.47, hb: 0.47, yc: -0.77, n: 2.9 },
  { s: 6.5, w: 1.12, ht: 0.54, hb: 0.54, yc: -0.64, n: 2.9 },
  { s: 8.0, w: 1.18, ht: 0.535, hb: 0.535, yc: -0.535, n: 2.8 },
  { s: 9.5, w: 1.22, ht: 0.475, hb: 0.475, yc: -0.475, n: 2.7 },
  { s: 11.0, w: 1.2, ht: 0.41, hb: 0.41, yc: -0.41, n: 2.6 },
  { s: 12.3, w: 1.05, ht: 0.33, hb: 0.33, yc: -0.33, n: 2.4 },
  { s: 13.3, w: 0.7, ht: 0.225, hb: 0.225, yc: -0.225, n: 2.2 },
];

/** Bubble canopy: width at base and height above the fuselage top line. */
const CANOPY_KEYS = [
  { s: 2.85, wc: 0.24, hc: 0.02 },
  { s: 3.3, wc: 0.62, hc: 0.2 },
  { s: 4.0, wc: 0.8, hc: 0.52 },
  { s: 4.8, wc: 0.86, hc: 0.68 },
  { s: 5.6, wc: 0.86, hc: 0.68 },
  { s: 6.3, wc: 0.8, hc: 0.52 },
  { s: 7.0, wc: 0.68, hc: 0.32 },
  { s: 7.5, wc: 0.52, hc: 0.12 },
];

function canopySecs(inset = 0): Sec[] {
  return CANOPY_KEYS.map(({ s, wc, hc }) => {
    const f = sectionAt(FUSELAGE, s);
    const base = topAt(f, wc / 2) - 0.05;
    return { s, w: Math.max(0.01, wc - inset * 2), ht: Math.max(0.005, hc + 0.05 - inset), hb: 0.01, yc: base, n: 2.25 };
  });
}

export interface JetGeometries {
  paintLoft: THREE.BufferGeometry;
  paintFlat: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  canopyInner: THREE.BufferGeometry;
  canopyFrame: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  intakeMouth: THREE.BufferGeometry;
  flaperon: THREE.BufferGeometry;
  stab: THREE.BufferGeometry;
  rudder: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  nozzleInner: THREE.BufferGeometry;
  missileBody: THREE.BufferGeometry;
  missileWhite: THREE.BufferGeometry;
  seeker: THREE.BufferGeometry;
  cockpitTub: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
}

/* hinge lines used by the component */
export const FLAPERON = { x0: 1.02, x1: 3.3, s0: 11.5, s1: 12.08 };
export const STAB = { x: 0.62, s: 13.75, y: -0.05, anhedral: 0.17 };
export const RUDDER = { s: 13.5, y0: 1.0, y1: 3.05 };
export const WING_Y = -0.08;
/** Wingtip positions (port side, +x) where vortices come off (missile fin tips). */
export const WINGTIP = { x: 4.86, s: 12.7, y: WING_Y };
/** Nozzle exit. */
export const NOZZLE = { s0: 14.35, s1: 15.35, r0: 0.5, r1: 0.43 };

let _cache: JetGeometries | null = null;

export function buildJetGeometries(): JetGeometries {
  if (_cache) return _cache;

  const parts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];

  /* fuselage, spine, intake */
  const loftParts = [prep(loft(FUSELAGE, 40, 5), 2.15), prep(loft(SPINE, 28, 4)), prep(loft(INTAKE, 32, 4))];

  // boundary-layer diverter between intake and fuselage
  {
    const g = new THREE.BoxGeometry(0.08, 0.14, 1.5);
    g.translate(0, -0.47, zs(5.0));
    parts.push(prep(g));
  }

  /* wing + strake (LERX), port side; starboard is mirrored */
  const tipLE = 11.02;
  const tipTE = 12.08;
  const strake: P2[] = [[0.5, 4.7], ...qbez([0.5, 4.7], [0.72, 7.0], [1.62, 8.55], 14)];
  const wingPts: P2[] = [
    ...strake,
    [4.5, tipLE],
    [4.6, tipLE + 0.02],
    [4.6, tipTE],
    [FLAPERON.x1 + 0.02, tipTE],
    [FLAPERON.x1 + 0.02, FLAPERON.s0],
    [FLAPERON.x0 - 0.02, FLAPERON.s0],
    [FLAPERON.x0 - 0.02, tipTE],
    [0.45, tipTE],
  ];
  const wingTaper = (x: number) => 1 - 0.6 * THREE.MathUtils.clamp((x - 0.6) / 4, 0, 1);
  const wing = hPanel(wingPts, 0.2, wingTaper);
  wing.translate(0, WING_Y, 0);
  const wingP = prep(wing);
  parts.push(wingP, mirrorX(wingP));

  /* flaperon (pivot at hinge line, local z <= 0) */
  const flap = hPanel(
    [
      [FLAPERON.x0, FLAPERON.s0],
      [FLAPERON.x1, FLAPERON.s0],
      [FLAPERON.x1, FLAPERON.s1],
      [FLAPERON.x0, FLAPERON.s1],
    ],
    0.1,
    wingTaper
  );
  flap.translate(0, 0, -zs(FLAPERON.s0));
  const flaperon = prep(flap);

  /* horizontal stabilizer (port), pivot at root hinge */
  const stabG = hPanel(
    [
      [0, 12.45],
      [2.2, 14.25],
      [2.2, 14.95],
      [0, 14.95],
    ],
    0.12,
    (x) => 1 - 0.45 * THREE.MathUtils.clamp(x / 2.2, 0, 1)
  );
  stabG.translate(0, 0, -zs(STAB.s));
  const stab = prep(stabG);

  /* vertical tail with dorsal fillet, rudder cut out */
  const finPts: P2[] = [
    [9.0, 0.55],
    ...qbez([9.0, 0.55], [10.0, 0.62], [10.55, 1.02], 8),
    [13.05, 3.3],
    [14.05, 3.3],
    [14.12, 3.08],
    [RUDDER.s - 0.02, 3.08],
    [RUDDER.s - 0.02, RUDDER.y0 - 0.02],
    [14.4, RUDDER.y0 - 0.02],
    [14.4, 0.55],
  ];
  const finTaper = (y: number) => 1 - 0.45 * THREE.MathUtils.clamp((y - 0.6) / 2.7, 0, 1);
  parts.push(prep(vPanel(finPts, 0.16, finTaper)));
  const rud = vPanel(
    [
      [RUDDER.s, RUDDER.y0],
      [14.36, RUDDER.y0],
      [14.12, RUDDER.y1],
      [RUDDER.s, RUDDER.y1],
    ],
    0.09,
    finTaper
  );
  rud.translate(0, 0, -zs(RUDDER.s));
  const rudder = prep(rud);

  /* drag-chute / ECM fairing at the fin root, extending past the nozzle */
  {
    const g = new THREE.CapsuleGeometry(0.15, 1.3, 6, 12);
    g.rotateX(Math.PI / 2);
    g.scale(1, 0.85, 1);
    g.translate(0, 0.68, zs(14.55));
    parts.push(prep(g));
  }

  /* ventral fins, canted outward */
  {
    const v = vPanel(
      [
        [12.0, 0],
        [13.4, 0],
        [13.45, -0.6],
        [12.9, -0.62],
      ],
      0.06
    );
    const m = new THREE.Matrix4().makeRotationZ(-0.28).setPosition(0.46, -0.45, 0);
    v.applyMatrix4(m);
    const vp = prep(v);
    parts.push(vp, mirrorX(vp));
  }

  /* wingtip launcher rails + underwing pylons */
  {
    const rail = new THREE.BoxGeometry(0.1, 0.12, 2.5);
    rail.translate(4.64, WING_Y, zs(11.2));
    const railP = prep(rail);
    parts.push(railP, mirrorX(railP));
    const pylon = new THREE.BoxGeometry(0.1, 0.32, 1.7);
    pylon.translate(3.3, WING_Y - 0.2, zs(11.0));
    const py = prep(pylon);
    parts.push(py, mirrorX(py));
  }

  /* pitot boom */
  {
    const g = new THREE.CylinderGeometry(0.012, 0.03, 0.9, 6);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.1, NOSE_Z + 0.4);
    darkParts.push(g.toNonIndexed());
  }

  const paintLoft = mergeGeometries(loftParts, false)!;
  const paintFlat = mergeGeometries(parts, false)!;

  /* canopy */
  const canopy = loft(canopySecs(), 36, 5, true);
  const canopyInner = loft(canopySecs(0.03), 36, 5, true);
  // canopy sill / rear bow (dark frame)
  const frameParts: THREE.BufferGeometry[] = [];
  for (const sgn of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let s = 3.0; s <= 7.4; s += 0.2) {
      const k = CANOPY_KEYS;
      let wc = k[0].wc;
      for (let i = 0; i < k.length - 1; i++)
        if (s >= k[i].s && s <= k[i + 1].s) wc = THREE.MathUtils.lerp(k[i].wc, k[i + 1].wc, (s - k[i].s) / (k[i + 1].s - k[i].s));
      const f = sectionAt(FUSELAGE, s);
      pts.push(new THREE.Vector3((sgn * wc) / 2, topAt(f, wc / 2) - 0.02, zs(s)));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.025, 5, false);
    frameParts.push(tube.toNonIndexed());
  }
  {
    // rear bow (arch across the canopy just behind the seat)
    const sb = 6.25;
    const secs = canopySecs();
    const c = sectionAt(secs, sb);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      pts.push(new THREE.Vector3((se(Math.cos(a), c.n) * c.w) / 2 * 1.01, c.yc + se(Math.sin(a), c.n) * c.ht * 1.01, zs(sb)));
    }
    frameParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.03, 5, false).toNonIndexed());
  }
  const canopyFrame = mergeGeometries(
    frameParts.map((g) => {
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      return g;
    }),
    false
  )!;

  /* intake mouth (dark recessed cap) */
  const mouthSec = INTAKE[0];
  const mouthShape = new THREE.Shape();
  for (let j = 0; j <= 48; j++) {
    const a = (j / 48) * Math.PI * 2;
    const x = (se(Math.cos(a), mouthSec.n) * (mouthSec.w - 0.1)) / 2;
    const y = mouthSec.yc + se(Math.sin(a), mouthSec.n) * (mouthSec.ht - 0.05);
    if (j === 0) mouthShape.moveTo(x, y);
    else mouthShape.lineTo(x, y);
  }
  const intakeMouth = new THREE.ShapeGeometry(mouthShape, 1);
  intakeMouth.translate(0, 0, zs(mouthSec.s) - 0.05);

  /* nozzle: 16 overlapping petals around a tapered can */
  const petals: THREE.BufferGeometry[] = [];
  const NP = 16;
  const len = NOZZLE.s1 - NOZZLE.s0;
  for (let i = 0; i < NP; i++) {
    const a = (i / NP) * Math.PI * 2;
    const w = ((2 * Math.PI * NOZZLE.r0) / NP) * 1.12;
    const g = new THREE.BoxGeometry(w, 0.035, len, 1, 1, 1);
    // taper: shrink the aft end
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) if (p.getZ(k) < 0) p.setX(k, p.getX(k) * (NOZZLE.r1 / NOZZLE.r0));
    const rMid = (NOZZLE.r0 + NOZZLE.r1) / 2;
    const tilt = Math.atan2(NOZZLE.r0 - NOZZLE.r1, len);
    const m = new THREE.Matrix4()
      .makeRotationZ(a - Math.PI / 2)
      .multiply(new THREE.Matrix4().makeTranslation(0, rMid, 0))
      .multiply(new THREE.Matrix4().makeRotationX(-tilt));
    g.applyMatrix4(m);
    g.translate(0, 0.02, zs(NOZZLE.s0 + len / 2));
    petals.push(g.toNonIndexed());
  }
  {
    // turbine section ring (titanium) between fuselage and petals
    const g = new THREE.CylinderGeometry(NOZZLE.r0 + 0.02, 0.52, 0.35, 24, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.02, zs(NOZZLE.s0 - 0.05));
    petals.push(g.toNonIndexed());
  }
  const nozzle = mergeGeometries(
    petals.map((g) => {
      g.computeVertexNormals();
      return g;
    }),
    false
  )!;
  const nozzleInner = new THREE.CylinderGeometry(NOZZLE.r1 - 0.02, NOZZLE.r0 - 0.03, len + 0.2, 20, 1, true);
  nozzleInner.rotateX(Math.PI / 2);
  nozzleInner.translate(0, 0.02, zs(NOZZLE.s0 + len / 2));

  /* missiles: AIM-9 on the wingtips, AIM-120 on the outer pylons */
  const mBody: THREE.BufferGeometry[] = [];
  const mWhite: THREE.BufferGeometry[] = [];
  const seekers: THREE.BufferGeometry[] = [];
  const missile = (x: number, y: number, sMid: number, len: number, r: number, aim9: boolean) => {
    const z = zs(sMid);
    const body = new THREE.CylinderGeometry(r, r, len * 0.86, 14, 1);
    body.rotateX(Math.PI / 2);
    body.translate(x, y, z - len * 0.07);
    mWhite.push(body.toNonIndexed());
    const nose = new THREE.ConeGeometry(r, len * 0.14, 14, 1);
    nose.rotateX(Math.PI / 2);
    nose.translate(x, y, z + len * 0.43);
    if (aim9) {
      const dome = new THREE.SphereGeometry(r * 0.98, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateX(Math.PI / 2);
      dome.translate(x, y, z + len * 0.36);
      seekers.push(dome.toNonIndexed());
    } else mWhite.push(nose.toNonIndexed());
    // cruciform fins: tail fins + forward canards
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const tail = new THREE.BoxGeometry(0.01, r * (aim9 ? 4.4 : 3.4), aim9 ? 0.3 : 0.26);
      tail.translate(0, r * (aim9 ? 2.2 : 1.7), 0);
      tail.rotateZ(a);
      tail.translate(x, y, z - len * 0.44);
      mBody.push(tail.toNonIndexed());
      const can = new THREE.BoxGeometry(0.01, r * (aim9 ? 3.4 : 2.6), aim9 ? 0.2 : 0.28);
      can.translate(0, r * (aim9 ? 1.7 : 1.3), 0);
      can.rotateZ(a);
      can.translate(x, y, z + len * (aim9 ? 0.3 : 0.05));
      mBody.push(can.toNonIndexed());
    }
    // yellow/brown bands are tiny; a dark band near the nose reads well
    const band = new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.08, 14, 1, true);
    band.rotateX(Math.PI / 2);
    band.translate(x, y, z + len * 0.28);
    mBody.push(band.toNonIndexed());
  };
  for (const sgn of [1, -1]) {
    missile(sgn * 4.74, WING_Y, 11.3, 2.87, 0.064, true);
    missile(sgn * 3.3, WING_Y - 0.48, 11.1, 3.66, 0.09, false);
  }
  const strip = (arr: THREE.BufferGeometry[]) =>
    mergeGeometries(
      arr.map((g) => {
        for (const k of Object.keys(g.attributes)) if (!["position", "normal"].includes(k)) g.deleteAttribute(k);
        return g;
      }),
      false
    )!;

  /* cockpit tub (so the canopy doesn't show an empty hole) + pilot */
  const tub = new THREE.BoxGeometry(0.72, 0.3, 3.2);
  tub.translate(0, 0.5, zs(5.1));
  const seat = new THREE.BoxGeometry(0.5, 0.75, 0.22);
  seat.rotateX(-0.52);
  seat.translate(0, 0.82, zs(5.72));
  const cockpitTub = strip([tub.toNonIndexed(), seat.toNonIndexed()]);
  const helmet = new THREE.SphereGeometry(0.14, 16, 12);
  helmet.scale(1, 1.08, 1.12);
  helmet.translate(0, 0.98, zs(5.35));
  const visor = new THREE.SphereGeometry(0.146, 16, 8, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.3, Math.PI * 0.3);
  visor.scale(1, 1.08, 1.12);
  visor.translate(0, 0.98, zs(5.35));

  _cache = {
    paintLoft,
    paintFlat,
    canopy,
    canopyInner,
    canopyFrame,
    dark: strip(darkParts),
    intakeMouth,
    flaperon,
    stab,
    rudder,
    nozzle,
    nozzleInner,
    missileBody: strip(mBody),
    missileWhite: strip(mWhite),
    seeker: strip(seekers),
    cockpitTub,
    helmet,
    visor,
  };
  return _cache;
}

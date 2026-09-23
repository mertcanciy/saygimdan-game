import * as THREE from "three";
import { makeSuitTextures, du, type Region } from "./suitTextures";

/**
 * Procedural web-slinger rig (~1.82 m), facing +Z, character's left = +X.
 *
 * root (placed at the centre of mass, carries world orientation)
 *  └ pelvis (pose bounce + flips)
 *     ├ spine → chest → neck → head
 *     │           ├ shoulder[L/R] → elbow → wrist (hand) → palm (web point)
 *     └ hip[L/R] → knee → ankle (foot)
 *
 * Joint rotation conventions (parent facing +Z):
 *  - limbs hang along -Y: rotation.x > 0 swings a limb backwards,
 *    so hip flexion / shoulder raise-forward / elbow bend are negative x,
 *    knee bend is positive x, ankle point is positive x.
 *  - abduction (limb out to the side) is rotation.z * side (side = +1 left, -1 right).
 *  - pelvis/spine/chest rotation.x > 0 leans forward.
 */

export const PELVIS_HEIGHT = 1.0;

export interface HeroRig {
  root: THREE.Group;
  pelvis: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  shoulder: [THREE.Group, THREE.Group];
  elbow: [THREE.Group, THREE.Group];
  wrist: [THREE.Group, THREE.Group];
  palm: [THREE.Object3D, THREE.Object3D];
  hip: [THREE.Group, THREE.Group];
  knee: [THREE.Group, THREE.Group];
  ankle: [THREE.Group, THREE.Group];
  dispose: () => void;
}

type Prof = [number, number][]; // [radius, y] bottom → top


/** Smooth closed lathe from a sparse profile (spline-resampled), with elliptic cross-section. */
function lathe(profile: Prof, sx = 1, sz = 1, segs = 22, samples = 26): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const g = new THREE.LatheGeometry(pts, segs);
  scaleWithNormals(g, sx, 1, sz);
  return g;
}

/** Non-uniform scale that keeps normals correct (inverse-transpose), no seam artefacts. */
function scaleWithNormals(g: THREE.BufferGeometry, sx: number, sy: number, sz: number) {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * sx, p.getY(i) * sy, p.getZ(i) * sz);
    const nx = n.getX(i) / sx;
    const ny = n.getY(i) / sy;
    const nz = n.getZ(i) / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  g.computeBoundingSphere();
}

function ellipsoid(rx: number, ry: number, rz: number, ws = 20, hs = 14) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  scaleWithNormals(g, rx, ry, rz);
  return g;
}

/* ---------- head with a mask-shaped (narrower chin) egg ---------- */
function headGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 28);
  // pole to the front so the web radiates from the face centre
  g.rotateX(Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(i, ...headWarp(x, y, z));
  }
  g.computeVertexNormals();
  // fix seam normals: recompute from analytic-ish direction is overkill; lathe seam is at the back
  return g;
}

/** unit-sphere point → mask surface (meters, relative to head pivot) */
function headWarp(x: number, y: number, z: number): [number, number, number] {
  let sx = 1;
  let sz = 1;
  if (y < 0) {
    const t = -y;
    sx = 1 - 0.3 * Math.pow(t, 1.4); // tapered jaw
    sz = 1 - 0.08 * t;
  }
  // flatter face plane, fuller back of the skull
  if (z > 0) sz *= 1 - 0.1 * z * z;
  return [x * sx * 0.095, y * 0.118, z * sz * 0.108];
}

/** Big white lens (with black rim) projected onto the head surface. */
function eyeGeometry(side: 1 | -1, grow: number, lift: number) {
  const s = new THREE.Shape();
  // normalized face coords (x outward, y up), unit = head radius
  s.moveTo(0.1, 0.02);
  s.bezierCurveTo(0.14, 0.2, 0.38, 0.38, 0.62, 0.3);
  s.bezierCurveTo(0.72, 0.26, 0.7, 0.06, 0.58, -0.04);
  s.bezierCurveTo(0.44, -0.14, 0.2, -0.12, 0.1, 0.02);
  const g = new THREE.ShapeGeometry(s, 14);
  // grow around the centroid for the rim
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const cx = 0.38;
  const cy = 0.1;
  for (let i = 0; i < p.count; i++) {
    let x = cx + (p.getX(i) - cx) * grow;
    const y = cy + (p.getY(i) - cy) * grow + 0.12;
    x *= side;
    const r2 = Math.min(0.97, x * x + y * y);
    const z = Math.sqrt(1 - r2);
    const [wx, wy, wz] = headWarp(x, y, z);
    const l = Math.hypot(wx, wy, wz);
    p.setXYZ(i, wx + (wx / l) * lift, wy + (wy / l) * lift, wz + (wz / l) * lift);
  }
  if (side < 0 && g.index) g.setIndex(Array.from(g.index.array).reverse()); // keep front faces outward
  g.computeVertexNormals();
  return g;
}

/* ---------- materials ---------- */

interface Mats {
  list: THREE.Material[];
  tex: THREE.Texture[];
}

function suitMat(mats: Mats, cols: number, rows: number, region: (u: number, v: number) => Region, size = 512) {
  const { map, bump } = makeSuitTextures({ cols, rows, region, size });
  const m = new THREE.MeshPhysicalMaterial({
    map,
    bumpMap: bump,
    bumpScale: 1.6,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color("#ff9a9a"),
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
  });
  mats.list.push(m);
  mats.tex.push(map, bump);
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number, name: string) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function buildHero(): HeroRig {
  const mats: Mats = { list: [], tex: [] };
  const geos: THREE.BufferGeometry[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => {
    geos.push(g);
    return g;
  };

  const allRed = () => 0 as Region;
  let thighMat: THREE.MeshPhysicalMaterial | null = null;
  const mThighPre = () => (thighMat ??= suitMat(mats, 12, 6, () => 1, 256));
  const mRed = suitMat(mats, 12, 10, allRed, 256);
  const mHead = suitMat(mats, 22, 9, allRed, 512);
  const mChest = suitMat(mats, 22, 8, (u, v) => {
    // blue side panels under the arms, tapering towards the armpit
    const w = v < 0.78 ? 0.05 + 0.07 * (1 - v) : 0;
    return du(u, 0.25) < w || du(u, 0.75) < w ? 1 : 0;
  });
  const mAbs = suitMat(mats, 22, 5, (u) => (du(u, 0.25) < 0.12 || du(u, 0.75) < 0.12 ? 1 : 0), 512);
  const mPelvis = suitMat(mats, 22, 5, (u, v) => {
    if (v > 0.8) return 0; // red belt line
    // red V on the front dipping towards the crotch
    const f = du(u, 0);
    if (v > 0.55 && f < (v - 0.55) * 0.5) return 0;
    return 1;
  }, 512);
  const mUpperArm = suitMat(mats, 10, 5, (u, v) => (v < 0.9 && du(u, 0.34) < 0.17 ? 1 : 0), 256);
  const mForearm = suitMat(mats, 10, 5, (u, v) => {
    const cuff = 0.5 + 0.08 * Math.cos(u * Math.PI * 2 * 3);
    return v > cuff && du(u, 0.34) < 0.15 ? 1 : 0;
  }, 256);
  const mThigh = mThighPre();
  const mShin = suitMat(mats, 12, 7, (u, v) => {
    const f = du(u, 0);
    const top = 0.56 + (f < 0.14 ? (1 - f / 0.14) * 0.2 : 0);
    return v < top ? 0 : 1;
  }, 256);
  const mLens = new THREE.MeshPhysicalMaterial({
    color: "#f4f6ff",
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    emissive: "#dfe6ff",
    emissiveIntensity: 0.25,
  });
  const mRim = new THREE.MeshStandardMaterial({
    color: "#08080c",
    roughness: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mSpider = new THREE.MeshStandardMaterial({ color: "#0a0a10", roughness: 0.5 });
  mats.list.push(mLens, mRim, mSpider);

  const root = new THREE.Group();
  root.name = "hero";
  const pelvis = joint(root, 0, 0, 0, "pelvis");

  /* pelvis */
  mesh(
    G(lathe([[0.0, -0.12], [0.07, -0.11], [0.138, -0.06], [0.15, 0.0], [0.138, 0.07], [0.122, 0.12], [0.0, 0.14]], 1, 0.72)),
    mPelvis,
    pelvis
  );

  /* spine / abdomen */
  const spine = joint(pelvis, 0, 0.1, 0, "spine");
  mesh(G(lathe([[0.0, -0.06], [0.122, -0.04], [0.116, 0.05], [0.126, 0.13], [0.0, 0.2]], 1, 0.68)), mAbs, spine);
  // glutes
  for (const s of [1, -1]) mesh(G(ellipsoid(0.075, 0.08, 0.06)), mThighPre(), pelvis, s * 0.065, -0.05, -0.055);

  /* chest */
  const chest = joint(spine, 0, 0.15, 0, "chest");
  mesh(
    G(
      lathe(
        [[0.0, -0.06], [0.126, -0.04], [0.145, 0.04], [0.174, 0.12], [0.196, 0.19], [0.19, 0.245], [0.14, 0.285], [0.07, 0.305], [0.0, 0.31]],
        1.02,
        0.64,
        26,
        30
      )
    ),
    mChest,
    chest
  );
  // pecs + lats + traps
  for (const s of [1, -1]) {
    const pec = mesh(G(ellipsoid(0.085, 0.068, 0.05)), mRed, chest, s * 0.07, 0.17, 0.072);
    pec.rotation.z = s * -0.25;
    mesh(G(ellipsoid(0.07, 0.11, 0.06)), mRed, chest, s * 0.13, 0.12, -0.04); // lat
    const trap = mesh(G(ellipsoid(0.1, 0.05, 0.07)), mRed, chest, s * 0.085, 0.265, -0.015);
    trap.rotation.z = s * -0.35;
  }
  // chest spider emblem
  {
    const body = mesh(G(ellipsoid(0.015, 0.036, 0.007)), mSpider, chest, 0, 0.185, 0.118);
    body.rotation.x = -0.25;
    const lg = G(new THREE.BoxGeometry(0.005, 0.065, 0.003));
    for (const s of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const leg = mesh(lg, mSpider, chest, s * 0.022, 0.2 - k * 0.012, 0.117);
        leg.rotation.z = s * (0.9 - k * 0.55);
        leg.rotation.x = -0.25;
        leg.castShadow = false;
      }
    }
  }

  /* neck + head */
  const neck = joint(chest, 0, 0.275, -0.005, "neck");
  mesh(G(lathe([[0.0, -0.03], [0.07, -0.02], [0.058, 0.05], [0.056, 0.1], [0.0, 0.12]])), mRed, neck);
  const head = joint(neck, 0, 0.1, 0.01, "head");
  const headOff = new THREE.Group();
  headOff.position.set(0, 0.08, 0.012);
  headOff.scale.setScalar(1.08);
  head.add(headOff);
  mesh(G(headGeometry()), mHead, headOff);
  for (const s of [1, -1] as const) {
    const rim = mesh(G(eyeGeometry(s, 1.22, 0.0025)), mRim, headOff);
    rim.castShadow = false;
    const lens = mesh(G(eyeGeometry(s, 1, 0.005)), mLens, headOff);
    lens.castShadow = false;
  }

  /* arms */
  const shoulder: THREE.Group[] = [];
  const elbow: THREE.Group[] = [];
  const wrist: THREE.Group[] = [];
  const palm: THREE.Object3D[] = [];
  const upperArmG = G(lathe([[0.0, -0.31], [0.04, -0.3], [0.046, -0.22], [0.056, -0.12], [0.056, -0.04], [0.05, 0.02], [0.0, 0.04]], 1, 0.9));
  const forearmG = G(lathe([[0.0, -0.27], [0.03, -0.26], [0.033, -0.2], [0.046, -0.09], [0.049, -0.04], [0.042, 0.01], [0.0, 0.03]], 1, 0.82));
  const deltG = G(ellipsoid(0.074, 0.088, 0.07));
  const palmG = G(ellipsoid(0.04, 0.052, 0.02));
  const fingerG = G(new THREE.CapsuleGeometry(0.0095, 0.05, 3, 8));
  const thumbG = G(new THREE.CapsuleGeometry(0.011, 0.035, 3, 8));
  for (const s of [1, -1]) {
    const sh = joint(chest, s * 0.19, 0.225, -0.01, s > 0 ? "shoulderL" : "shoulderR");
    mesh(deltG, mRed, sh, s * 0.012, -0.02, 0);
    const ua = mesh(upperArmG, mUpperArm, sh);
    if (s < 0) ua.rotation.y = Math.PI; // mirror blue panel to the outside
    const el = joint(sh, 0, -0.3, 0, s > 0 ? "elbowL" : "elbowR");
    const fa = mesh(forearmG, mForearm, el);
    if (s < 0) fa.rotation.y = Math.PI;
    const wr = joint(el, 0, -0.265, 0, s > 0 ? "wristL" : "wristR");
    const hand = new THREE.Group();
    hand.rotation.y = s * 0.0;
    wr.add(hand);
    const pm = mesh(palmG, mRed, hand, 0, -0.05, 0);
    pm.rotation.y = s * Math.PI * 0.5; // palm faces the body
    // fingers (slightly curled mitten)
    for (let f = 0; f < 4; f++) {
      const fi = mesh(fingerG, mRed, hand, 0, -0.12, (f - 1.5) * 0.019);
      fi.rotation.x = 0;
      fi.rotation.z = s * 0.25;
      fi.position.x = s * 0.008;
    }
    const th = mesh(thumbG, mRed, hand, s * -0.005, -0.06, 0.035);
    th.rotation.x = -0.7;
    const pt = new THREE.Object3D();
    pt.position.set(0, -0.09, 0);
    hand.add(pt);
    shoulder.push(sh);
    elbow.push(el);
    wrist.push(wr);
    palm.push(pt);
  }

  /* legs */
  const hip: THREE.Group[] = [];
  const knee: THREE.Group[] = [];
  const ankle: THREE.Group[] = [];
  const thighG = G(lathe([[0.0, -0.46], [0.047, -0.45], [0.052, -0.4], [0.068, -0.3], [0.082, -0.16], [0.09, -0.05], [0.082, 0.03], [0.0, 0.06]], 1, 0.95));
  const shinG = G(lathe([[0.0, -0.44], [0.03, -0.43], [0.032, -0.36], [0.046, -0.24], [0.057, -0.12], [0.052, -0.03], [0.045, 0.02], [0.0, 0.04]], 1, 0.92));
  const calfG = G(ellipsoid(0.042, 0.1, 0.04));
  const kneeG = G(ellipsoid(0.045, 0.05, 0.04));
  const footG = G(lathe([[0.0, -0.13], [0.03, -0.12], [0.045, -0.06], [0.05, 0.03], [0.042, 0.1], [0.0, 0.14]], 1, 0.7, 18, 18));
  for (const s of [1, -1]) {
    const hp = joint(pelvis, s * 0.092, -0.06, 0, s > 0 ? "hipL" : "hipR");
    mesh(thighG, mThigh, hp);
    const kn = joint(hp, 0, -0.44, 0, s > 0 ? "kneeL" : "kneeR");
    mesh(kneeG, mThigh, kn, 0, 0.0, 0.025);
    const sh = mesh(shinG, mShin, kn);
    if (s < 0) sh.rotation.y = Math.PI;
    mesh(calfG, mShin, kn, 0, -0.13, -0.03);
    const an = joint(kn, 0, -0.42, 0, s > 0 ? "ankleL" : "ankleR");
    // foot: lathe laid along +Z (toe forward), sole flat-ish
    const ft = mesh(footG, mRed, an, 0, -0.045, 0.05);
    ft.rotation.x = Math.PI / 2;
    ft.scale.set(1, 1, 0.85);
    hip.push(hp);
    knee.push(kn);
    ankle.push(an);
  }

  const dispose = () => {
    geos.forEach((g) => g.dispose());
    mats.list.forEach((m) => m.dispose());
    mats.tex.forEach((t) => t.dispose());
  };

  return {
    root,
    pelvis,
    spine,
    chest,
    neck,
    head,
    shoulder: shoulder as [THREE.Group, THREE.Group],
    elbow: elbow as [THREE.Group, THREE.Group],
    wrist: wrist as [THREE.Group, THREE.Group],
    palm: palm as [THREE.Object3D, THREE.Object3D],
    hip: hip as [THREE.Group, THREE.Group],
    knee: knee as [THREE.Group, THREE.Group],
    ankle: ankle as [THREE.Group, THREE.Group],
    dispose,
  };
}

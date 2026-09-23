// Seeded city layout generator + collision/raycast helpers.
//
// A block is a raised sidewalk slab. Inside it the buildable area is split
// into lots (BSP); every lot gets a building made of one or more stacked
// volumes (podium → shaft → setback tiers). Each volume is an axis-aligned
// box from y0 to h and is what the games collide / raycast against.

export const FACADE_STYLES = {
  glass: 0,
  office: 1,
  brick: 2,
  stucco: 3,
  panel: 4,
  stone: 5,
} as const;

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  /** top of the volume (absolute, meters) */
  h: number;
  /** bottom of the volume (absolute, meters). 0 for ground volumes. */
  y0: number;
  /** facade style (see FACADE_STYLES) */
  style: number;
  /** per-building seed (0..1) — shared by all volumes of one building */
  seed: number;
  /** legacy: 0..5 colour slot */
  colorIdx: number;
  /** 0 = low, 1 = mid, 2 = tower */
  kind: 0 | 1 | 2;
  /** only the top-most volume of a building carries roof props */
  top: boolean;
}

export interface Road {
  axis: "x" | "z";
  pos: number;
}

export interface RoofProp {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface CityData {
  buildings: Building[];
  /** decorative far skyline (render only, no collision) */
  skyline: Building[];
  size: number;
  roadWidth: number;
  sidewalk: number;
  blockSize: number;
  blocks: number;
  roads: Road[];
  blockCenters: { x: number; z: number }[];
  bounds: { min: number; max: number };
  plaza: { x: number; z: number; w: number; d: number } | null;
  parks: { x: number; z: number; w: number; d: number }[];
  trees: { x: number; z: number; s: number; r: number }[];
  lamps: { x: number; z: number; rotY: number }[];
  hvac: RoofProp[];
  tanks: RoofProp[];
  antennas: RoofProp[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CityOptions {
  blocks: number;
  blockSize: number;
  roadWidth: number;
  seed: number;
  maxHeight: number;
  /** Skip buildings inside the centered NxN middle blocks (drift arena). */
  plazaBlocks?: number;
  /** probability of a tower per lot (default 0.15) */
  towerChance?: number;
  /** add a ring of far-away buildings for the horizon (default true) */
  skyline?: boolean;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function splitLots(r: Rect, rand: () => number, maxLot: number, minLot: number, out: Rect[]) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (w <= maxLot && d <= maxLot) {
    out.push(r);
    return;
  }
  const alongX = w >= d;
  const len = alongX ? w : d;
  const t = 0.35 + rand() * 0.3;
  let cut = len * t;
  cut = Math.max(minLot, Math.min(len - minLot, cut));
  if (alongX) {
    splitLots({ ...r, x1: r.x0 + cut }, rand, maxLot, minLot, out);
    splitLots({ ...r, x0: r.x0 + cut }, rand, maxLot, minLot, out);
  } else {
    splitLots({ ...r, z1: r.z0 + cut }, rand, maxLot, minLot, out);
    splitLots({ ...r, z0: r.z0 + cut }, rand, maxLot, minLot, out);
  }
}

function pickStyle(kind: 0 | 1 | 2, rand: () => number): number {
  const r = rand();
  if (kind === 2) return r < 0.5 ? FACADE_STYLES.glass : r < 0.75 ? FACADE_STYLES.panel : r < 0.9 ? FACADE_STYLES.office : FACADE_STYLES.stone;
  if (kind === 1) return r < 0.35 ? FACADE_STYLES.office : r < 0.6 ? FACADE_STYLES.stucco : r < 0.8 ? FACADE_STYLES.stone : FACADE_STYLES.brick;
  return r < 0.45 ? FACADE_STYLES.stucco : r < 0.8 ? FACADE_STYLES.brick : FACADE_STYLES.stone;
}

/** Push one building (podium / shaft / setback tiers) for a footprint. */
function addBuilding(
  out: Building[],
  roof: { hvac: RoofProp[]; tanks: RoofProp[]; antennas: RoofProp[] },
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  kind: 0 | 1 | 2,
  style: number,
  rand: () => number
) {
  const seed = rand();
  const colorIdx = Math.floor(rand() * 6);
  const vols: { w: number; d: number; y0: number; h: number }[] = [];
  if (kind === 2) {
    // podium + shaft + 0..2 setbacks
    const podium = rand() < 0.55 ? 10 + Math.floor(rand() * 3) * 4 : 0;
    let y = 0;
    let cw = w;
    let cd = d;
    if (podium) {
      vols.push({ w: cw, d: cd, y0: 0, h: podium });
      y = podium;
      cw *= 0.72 + rand() * 0.14;
      cd *= 0.72 + rand() * 0.14;
    }
    const tiers = rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0;
    const shaftTop = tiers ? y + (h - y) * (0.62 + rand() * 0.12) : h;
    vols.push({ w: cw, d: cd, y0: y, h: shaftTop });
    y = shaftTop;
    for (let t = 0; t < tiers; t++) {
      cw *= 0.72 + rand() * 0.1;
      cd *= 0.72 + rand() * 0.1;
      const top = t === tiers - 1 ? h : y + (h - y) * 0.6;
      vols.push({ w: cw, d: cd, y0: y, h: top });
      y = top;
    }
  } else if (kind === 1 && rand() < 0.35) {
    const shaftTop = h * (0.78 + rand() * 0.1);
    vols.push({ w, d, y0: 0, h: shaftTop });
    vols.push({ w: w * 0.8, d: d * 0.8, y0: shaftTop, h });
  } else {
    vols.push({ w, d, y0: 0, h });
  }

  vols.forEach((v, i) => {
    out.push({
      x: cx,
      z: cz,
      w: v.w,
      d: v.d,
      y0: v.y0,
      h: v.h,
      style,
      seed,
      colorIdx,
      kind,
      top: i === vols.length - 1,
    });
  });

  // roof clutter on the top volume
  const t = vols[vols.length - 1];
  const nH = Math.floor(rand() * (kind === 0 ? 3 : 5));
  for (let i = 0; i < nH; i++) {
    const bw = 1.4 + rand() * 2.6;
    const bd = 1.2 + rand() * 2.2;
    const bh = 0.9 + rand() * 1.6;
    roof.hvac.push({
      x: cx + (rand() - 0.5) * Math.max(0, t.w - bw - 2),
      z: cz + (rand() - 0.5) * Math.max(0, t.d - bd - 2),
      y: t.h,
      w: bw,
      h: bh,
      d: bd,
    });
  }
  if (kind !== 2 && rand() < 0.4) {
    const r = 1.1 + rand() * 0.8;
    roof.tanks.push({
      x: cx + (rand() - 0.5) * Math.max(0, t.w - 4),
      z: cz + (rand() - 0.5) * Math.max(0, t.d - 4),
      y: t.h,
      w: r,
      h: 2.2 + rand() * 1.4,
      d: r,
    });
  }
  if (kind === 2 && rand() < 0.45) {
    roof.antennas.push({ x: cx, z: cz, y: t.h, w: 0.18, h: 8 + rand() * 18, d: 0.18 });
  }
}

export function generateCity(opts: CityOptions): CityData {
  const { blocks, blockSize, roadWidth, seed, maxHeight } = opts;
  const towerChance = opts.towerChance ?? 0.15;
  const rand = mulberry32(seed);
  const size = blocks * blockSize + (blocks + 1) * roadWidth;
  const half = size / 2;
  const sidewalk = 4;

  const roads: Road[] = [];
  for (let i = 0; i <= blocks; i++) {
    const pos = -half + roadWidth / 2 + i * (blockSize + roadWidth);
    roads.push({ axis: "x", pos });
    roads.push({ axis: "z", pos });
  }

  const pb = opts.plazaBlocks ?? 0;
  const cell = blockSize + roadWidth;
  const plazaHalf = pb > 0 ? (pb * blockSize + (pb - 1) * roadWidth) / 2 : 0;

  const buildings: Building[] = [];
  const blockCenters: { x: number; z: number }[] = [];
  const parks: CityData["parks"] = [];
  const trees: CityData["trees"] = [];
  const lamps: CityData["lamps"] = [];
  const roof = { hvac: [] as RoofProp[], tanks: [] as RoofProp[], antennas: [] as RoofProp[] };

  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const cx = -half + roadWidth + blockSize / 2 + bx * cell;
      const cz = -half + roadWidth + blockSize / 2 + bz * cell;
      if (pb > 0 && Math.abs(cx) < plazaHalf + 1 && Math.abs(cz) < plazaHalf + 1) continue;
      blockCenters.push({ x: cx, z: cz });

      const dist = Math.hypot(cx, cz) / half;
      const downtown = 1 - Math.min(1, dist);

      // street furniture along the four curbs
      const bh = blockSize / 2;
      const curb = bh - 1.3;
      for (let side = 0; side < 4; side++) {
        for (let t = -bh + 5; t <= bh - 5; t += 9 + rand() * 3) {
          const jitter = (rand() - 0.5) * 0.6;
          const along = t + jitter;
          const px = side < 2 ? cx + along : cx + (side === 2 ? curb : -curb);
          const pz = side < 2 ? cz + (side === 0 ? curb : -curb) : cz + along;
          if (rand() < 0.72) trees.push({ x: px, z: pz, s: 0.8 + rand() * 0.5, r: rand() * Math.PI * 2 });
        }
        // two lamps per side
        for (const f of [-0.28, 0.28]) {
          const along = f * blockSize;
          const lc = bh - 0.6;
          const px = side < 2 ? cx + along : cx + (side === 2 ? lc : -lc);
          const pz = side < 2 ? cz + (side === 0 ? lc : -lc) : cz + along;
          const rotY = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
          lamps.push({ x: px, z: pz, rotY });
        }
      }

      // occasional pocket park instead of buildings
      if (rand() < 0.06 + (1 - downtown) * 0.05) {
        const inner = blockSize - sidewalk * 2;
        parks.push({ x: cx, z: cz, w: inner, d: inner });
        const n = 10 + Math.floor(rand() * 8);
        for (let i = 0; i < n; i++) {
          trees.push({
            x: cx + (rand() - 0.5) * (inner - 4),
            z: cz + (rand() - 0.5) * (inner - 4),
            s: 0.9 + rand() * 0.8,
            r: rand() * Math.PI * 2,
          });
        }
        continue;
      }

      const inner = blockSize / 2 - sidewalk;
      const lots: Rect[] = [];
      splitLots(
        { x0: cx - inner, z0: cz - inner, x1: cx + inner, z1: cz + inner },
        rand,
        downtown > 0.55 ? 26 : 20,
        9,
        lots
      );

      for (const lot of lots) {
        const lw = lot.x1 - lot.x0;
        const ld = lot.z1 - lot.z0;
        const gap = 0.4 + rand() * 0.6;
        const w = lw - gap * 2;
        const d = ld - gap * 2;
        const lx = (lot.x0 + lot.x1) / 2;
        const lz = (lot.z0 + lot.z1) / 2;
        const r = rand();
        let h: number;
        let kind: 0 | 1 | 2;
        const big = Math.min(w, d) > 14;
        if (big && r < towerChance + downtown * 0.25) {
          h = 60 + rand() * (maxHeight - 60) * (0.45 + downtown * 0.55);
          kind = 2;
        } else if (r < 0.62) {
          h = 16 + rand() * (18 + downtown * 22);
          kind = 1;
        } else {
          h = 8 + rand() * 9;
          kind = 0;
        }
        // snap heights to whole storeys so floors line up with the roof
        h = Math.round(h / 3.4) * 3.4 + 1.2;
        addBuilding(buildings, roof, lx, lz, w, d, h, kind, pickStyle(kind, rand), rand);
      }
    }
  }

  // outskirts: a jittered grid of plain blocks around the playable grid, so the
  // city keeps going to the horizon instead of ending in an empty plain
  const skyline: Building[] = [];
  if (opts.skyline !== false) {
    const srand = mulberry32(seed * 7 + 3);
    const step = 34;
    const reach = half + 900;
    for (let gx = -reach; gx <= reach; gx += step) {
      for (let gz = -reach; gz <= reach; gz += step) {
        if (Math.abs(gx) < half + 30 && Math.abs(gz) < half + 30) continue;
        const edge = Math.max(Math.abs(gx), Math.abs(gz)) - half; // 30 … 900
        if (srand() < 0.12 + edge / 2400) continue; // thin out with distance
        const t = srand();
        const kind: 0 | 1 | 2 = t < 0.07 ? 2 : t < 0.45 ? 1 : 0;
        const h =
          kind === 2 ? 55 + srand() * maxHeight * 0.8 : kind === 1 ? 16 + srand() * 26 : 7 + srand() * 10;
        skyline.push({
          x: gx + (srand() - 0.5) * 6,
          z: gz + (srand() - 0.5) * 6,
          w: 16 + srand() * 12,
          d: 16 + srand() * 12,
          y0: 0,
          h: Math.round(h / 3.4) * 3.4 + 1.2,
          style: pickStyle(kind, srand),
          seed: srand(),
          colorIdx: 0,
          kind,
          top: true,
        });
      }
    }
  }

  const plaza = pb > 0 ? { x: 0, z: 0, w: plazaHalf * 2 + roadWidth, d: plazaHalf * 2 + roadWidth } : null;

  return {
    buildings,
    skyline,
    size,
    roadWidth,
    sidewalk,
    blockSize,
    blocks,
    roads,
    blockCenters,
    bounds: { min: -half, max: half },
    plaza,
    parks,
    trees,
    lamps,
    ...roof,
  };
}

/**
 * Horizontal AABB collision for a circle (px,pz,radius).
 * Returns the smallest push-out vector, or null.
 * `py` (optional): feet height — only volumes spanning that height collide.
 */
export function aabbCollide(
  px: number,
  pz: number,
  radius: number,
  buildings: Building[],
  py = 0
): { x: number; z: number; building: Building } | null {
  let best: { x: number; z: number; building: Building; depth: number } | null = null;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (py >= b.h || py + 1.6 < b.y0) continue;
    const hw = b.w / 2 + radius;
    const hd = b.d / 2 + radius;
    const dx = px - b.x;
    const dz = pz - b.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    const ox = hw - Math.abs(dx);
    const oz = hd - Math.abs(dz);
    let push: { x: number; z: number; depth: number };
    if (ox < oz) push = { x: Math.sign(dx || 1) * ox, z: 0, depth: ox };
    else push = { x: 0, z: Math.sign(dz || 1) * oz, depth: oz };
    if (!best || push.depth < best.depth) best = { ...push, building: b, depth: push.depth };
  }
  return best ? { x: best.x, z: best.z, building: best.building } : null;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Slab-method raycast against building AABBs (y from y0 to h). */
export function raycastBuildings(
  origin: Vec3Like,
  dir: Vec3Like,
  maxDist: number,
  buildings: Building[]
): { point: Vec3Like; building: Building; dist: number } | null {
  let bestT = maxDist;
  let bestB: Building | null = null;
  const invX = dir.x !== 0 ? 1 / dir.x : Infinity;
  const invY = dir.y !== 0 ? 1 / dir.y : Infinity;
  const invZ = dir.z !== 0 ? 1 / dir.z : Infinity;

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const minX = b.x - b.w / 2;
    const maxX = b.x + b.w / 2;
    const minZ = b.z - b.d / 2;
    const maxZ = b.z + b.d / 2;

    let tmin = (minX - origin.x) * invX;
    let tmax = (maxX - origin.x) * invX;
    if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
    let tymin = (b.y0 - origin.y) * invY;
    let tymax = (b.h - origin.y) * invY;
    if (tymin > tymax) [tymin, tymax] = [tymax, tymin];
    if (tmin > tymax || tymin > tmax) continue;
    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;
    let tzmin = (minZ - origin.z) * invZ;
    let tzmax = (maxZ - origin.z) * invZ;
    if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];
    if (tmin > tzmax || tzmin > tmax) continue;
    if (tzmin > tmin) tmin = tzmin;
    if (tzmax < tmax) tmax = tzmax;
    if (tmax < 0) continue;
    if (tmin < 0) tmin = 0;
    if (tmin < bestT) {
      bestT = tmin;
      bestB = b;
    }
  }

  if (!bestB) return null;
  return {
    point: {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    },
    building: bestB,
    dist: bestT,
  };
}

/** Highest walkable surface under (x,z): ground or rooftop (only roofs below/at py+tolerance). */
export function groundHeightAt(x: number, z: number, py: number, buildings: Building[]): number {
  let g = 0;
  for (const b of buildings) {
    if (
      x >= b.x - b.w / 2 &&
      x <= b.x + b.w / 2 &&
      z >= b.z - b.d / 2 &&
      z <= b.z + b.d / 2 &&
      py >= b.h - 0.6 &&
      b.h > g
    ) {
      g = b.h;
    }
  }
  return g;
}

/** Is (x,z) on a road (within roadWidth/2 of any road centerline)? */
export function isOnRoad(x: number, z: number, city: CityData): boolean {
  const hw = city.roadWidth / 2;
  for (const r of city.roads) {
    if (r.axis === "x" && Math.abs(z - r.pos) < hw) return true;
    if (r.axis === "z" && Math.abs(x - r.pos) < hw) return true;
  }
  return false;
}

/** Random point on a road (seeded). */
export function randomRoadPoint(
  rand: () => number,
  city: CityData,
  margin = 40
): { x: number; z: number; axis: "x" | "z" } {
  const r = city.roads[Math.floor(rand() * city.roads.length)];
  const t = city.bounds.min + margin + rand() * (city.size - margin * 2);
  return r.axis === "x" ? { x: t, z: r.pos, axis: "x" } : { x: r.pos, z: t, axis: "z" };
}

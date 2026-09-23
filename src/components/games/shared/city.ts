// Seeded city layout generator + collision/raycast helpers.

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  colorIdx: number;
}

export interface CityData {
  buildings: Building[];
  /** Total side length of the city square (meters), centered on origin. */
  size: number;
  roadWidth: number;
  blockSize: number;
  blocks: number;
  roads: { axis: "x" | "z"; pos: number }[];
  bounds: { min: number; max: number };
  plaza: { x: number; z: number; w: number; d: number } | null;
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
}

export function generateCity(opts: CityOptions): CityData {
  const { blocks, blockSize, roadWidth, seed, maxHeight } = opts;
  const rand = mulberry32(seed);
  const size = blocks * blockSize + (blocks + 1) * roadWidth;
  const half = size / 2;

  const roads: CityData["roads"] = [];
  for (let i = 0; i <= blocks; i++) {
    const pos = -half + roadWidth / 2 + i * (blockSize + roadWidth);
    roads.push({ axis: "x", pos });
    roads.push({ axis: "z", pos });
  }

  // centered plaza covering plazaBlocks x plazaBlocks blocks (interior only)
  const pb = opts.plazaBlocks ?? 0;
  const cell = blockSize + roadWidth;
  const plazaHalf = pb > 0 ? (pb * blockSize + (pb - 1) * roadWidth) / 2 : 0;

  const buildings: Building[] = [];
  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const cx = -half + roadWidth + blockSize / 2 + bx * cell;
      const cz = -half + roadWidth + blockSize / 2 + bz * cell;
      // inside plaza? (block center distance test, works for even pb)
      if (pb > 0 && Math.abs(cx) < plazaHalf + 1 && Math.abs(cz) < plazaHalf + 1)
        continue;

      // choose 1-4 sub-lots (2x2 grid inside the block)
      const n = 1 + Math.floor(rand() * 4);
      const subIdx = [0, 1, 2, 3];
      // shuffle
      for (let i = subIdx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [subIdx[i], subIdx[j]] = [subIdx[j], subIdx[i]];
      }
      for (let k = 0; k < n; k++) {
        const s = subIdx[k];
        const sx = (s % 2) - 0.5;
        const sz = Math.floor(s / 2) - 0.5;
        const lotW = blockSize / 2;
        const setback = 2 + rand() * 1.5;
        const w = Math.max(6, lotW - setback * 2 - rand() * 6);
        const d = Math.max(6, lotW - setback * 2 - rand() * 6);
        const h =
          rand() < 0.15 ? 60 + rand() * (maxHeight - 60) : 12 + rand() * 33;
        buildings.push({
          x: cx + sx * lotW + (rand() - 0.5) * 4,
          z: cz + sz * lotW + (rand() - 0.5) * 4,
          w,
          d,
          h,
          colorIdx: Math.floor(rand() * 5),
        });
      }
    }
  }

  const plaza =
    pb > 0
      ? { x: 0, z: 0, w: plazaHalf * 2 + roadWidth, d: plazaHalf * 2 + roadWidth }
      : null;

  return {
    buildings,
    size,
    roadWidth,
    blockSize,
    blocks,
    roads,
    bounds: { min: -half, max: half },
    plaza,
  };
}

/**
 * Horizontal AABB collision for a circle (px,pz,radius).
 * Returns the smallest push-out vector, or null.
 * `py` (optional): only collide with buildings taller than py.
 */
export function aabbCollide(
  px: number,
  pz: number,
  radius: number,
  buildings: Building[],
  py = 0
): { x: number; z: number; building: Building } | null {
  let best: { x: number; z: number; building: Building; depth: number } | null =
    null;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (py >= b.h) continue;
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
    if (!best || push.depth < best.depth)
      best = { ...push, building: b, depth: push.depth };
  }
  return best ? { x: best.x, z: best.z, building: best.building } : null;
}

/** Buildings whose center is within r of (x,z). */
export function findBuildingsInRadius(
  x: number,
  z: number,
  r: number,
  buildings: Building[]
): Building[] {
  const out: Building[] = [];
  for (const b of buildings) {
    const dx = b.x - x;
    const dz = b.z - z;
    if (dx * dx + dz * dz <= r * r) out.push(b);
  }
  return out;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Slab-method raycast against building AABBs (y from 0 to h). */
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
    let tymin = (0 - origin.y) * invY;
    let tymax = (b.h - origin.y) * invY;
    if (tymin > tymax) [tymin, tymax] = [tymax, tymin];
    if (tmin > tymax || tymin > tmax) continue;
    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tymax = tymax;
    let tzmin = (minZ - origin.z) * invZ;
    let tzmax = (maxZ - origin.z) * invZ;
    if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];
    if (tmin > tzmax || tzmin > tmax) continue;
    if (tzmin > tmin) tmin = tzmin;
    if (tzmax < tmax) tmax = tzmax;
    if (tmax < 0 || tmin < 0) continue;
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

/** Highest walkable surface under (x,z): ground or rooftop. */
export function groundHeightAt(
  x: number,
  z: number,
  py: number,
  buildings: Building[]
): number {
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

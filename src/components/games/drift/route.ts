// Street-drift circuit through the city grid (pure data, no rendering).
//
// The city is a 10×10 block grid (60 m blocks, 24 m roads, 84 m pitch) with the
// middle 2×2 blocks replaced by a paved plaza: the paddock / start-finish area.
// The lap is a closed loop of road segments between grid intersections; every
// road arm that leaves the route is closed with a barrier line, blocks are
// solid, so the player drives a closed-off night circuit.

export const CELL = 84;
export const ROAD_W = 24;
export const HALF_ROAD = ROAD_W / 2;
export const BLOCK = 60;
export const GRID_N = 10; // blocks per side
const MAX_I = GRID_N / 2; // road indices run -5 … 5
const ORIGIN = -(GRID_N * BLOCK + (GRID_N + 1) * ROAD_W) / 2 + ROAD_W; // min edge of block 0

/** Corner nodes of the lap in grid units (road index; world = index × 84). Loop. */
const ROUTE_IDX: [number, number][] = [
  [0, 0], // plaza corner (east → north)
  [0, 3],
  [2, 3],
  [2, 4],
  [4, 4],
  [4, 1],
  [3, 1],
  [3, -2],
  [1, -2],
  [1, -4],
  [-3, -4],
  [-3, 0],
];
/** road stretches (between two adjacent nodes) that get a barrier chicane */
const CHICANES: [number, number, number, number][] = [
  [4, 3, 4, 2],
  [-1, -4, -2, -4],
  [-3, -3, -3, -2],
];

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface BarrierLine {
  x: number;
  z: number;
  /** the line runs along world x (true) or z (false) */
  alongX: boolean;
  len: number;
  /** chevron board on this line: +1 = turn right, -1 = turn left (as seen by the approaching driver) */
  chevron?: number;
  /** direction the chevron board faces (towards the approaching driver) */
  faceX?: number;
  faceZ?: number;
}

export interface Gate {
  x: number;
  z: number;
  /** travel direction through the gate */
  dx: number;
  dz: number;
  half: number;
  /** -1 left, +1 right, 0 = start / finish */
  turn: number;
  /** the intersection this gate announces (corner gates) */
  cx: number;
  cz: number;
}

export interface Slot {
  x: number;
  z: number;
  rotY: number;
}

export interface Track {
  gates: Gate[];
  barriers: BarrierLine[];
  colliders: Box[];
  parked: Slot[];
  cones: { x: number; z: number }[];
  arrows: Slot[];
  /** closed centre-line polyline of the lap (world) */
  path: { x: number; z: number }[];
  length: number;
  start: { x: number; z: number; heading: number };
}

/** right-hand vector of a travel direction (the screen-right side when heading that way) */
export const rightOf = (dx: number, dz: number) => ({ x: -dz, z: dx });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (i: number, j: number) => `${i},${j}`;
const edgeKey = (a: [number, number], b: [number, number]) => `${key(a[0], a[1])}|${key(b[0], b[1])}`;
const inPlaza = (i: number, j: number) => Math.max(Math.abs(i), Math.abs(j)) <= 1;
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const START = { x: -60, z: 0, heading: Math.PI / 2 };
const START_GATE_X = -44;

export function buildTrack(seed = 5): Track {
  const rand = rng(seed);
  const nodes = new Map<string, [number, number]>();
  const edges = new Set<string>();
  // expand corner list into unit edges
  for (let k = 0; k < ROUTE_IDX.length; k++) {
    const a = ROUTE_IDX[k];
    const b = ROUTE_IDX[(k + 1) % ROUTE_IDX.length];
    const si = Math.sign(b[0] - a[0]);
    const sj = Math.sign(b[1] - a[1]);
    let cur: [number, number] = [a[0], a[1]];
    nodes.set(key(cur[0], cur[1]), cur);
    while (cur[0] !== b[0] || cur[1] !== b[1]) {
      const nx: [number, number] = [cur[0] + si, cur[1] + sj];
      edges.add(edgeKey(cur, nx));
      edges.add(edgeKey(nx, cur));
      nodes.set(key(nx[0], nx[1]), nx);
      cur = nx;
    }
  }

  const barriers: BarrierLine[] = [];
  const colliders: Box[] = [];
  const addBarrier = (l: BarrierLine) => {
    barriers.push(l);
    const hw = l.alongX ? l.len / 2 : 0.35;
    const hd = l.alongX ? 0.35 : l.len / 2;
    colliders.push({ minX: l.x - hw, minZ: l.z - hd, maxX: l.x + hw, maxZ: l.z + hd });
  };

  // corner info: incoming / outgoing directions
  const corners = ROUTE_IDX.map((c, k) => {
    const p = ROUTE_IDX[(k - 1 + ROUTE_IDX.length) % ROUTE_IDX.length];
    const n = ROUTE_IDX[(k + 1) % ROUTE_IDX.length];
    const din = [Math.sign(c[0] - p[0]), Math.sign(c[1] - p[1])];
    const dout = [Math.sign(n[0] - c[0]), Math.sign(n[1] - c[1])];
    const turn = Math.sign(din[0] * dout[1] - din[1] * dout[0]);
    return { i: c[0], j: c[1], din, dout, turn };
  });
  const cornerAt = new Map(corners.map((c) => [key(c.i, c.j), c]));

  // close every road arm that leaves the route (plaza nodes only close outward arms)
  const plazaEdge: [number, number][] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i !== 0 || j !== 0) plazaEdge.push([i, j]);
  const closeNodes = new Map(nodes);
  for (const n of plazaEdge) closeNodes.set(key(n[0], n[1]), n);
  for (const n of closeNodes.values()) {
    for (const d of DIRS) {
      const nb: [number, number] = [n[0] + d[0], n[1] + d[1]];
      if (Math.abs(nb[0]) > MAX_I || Math.abs(nb[1]) > MAX_I) continue;
      if (edges.has(edgeKey(n, nb))) continue;
      if (inPlaza(n[0], n[1]) && inPlaza(nb[0], nb[1])) continue;
      if (n[0] === 0 && n[1] === 0) continue;
      const x = n[0] * CELL + d[0] * 13.4;
      const z = n[1] * CELL + d[1] * 13.4;
      const line: BarrierLine = { x, z, alongX: d[0] === 0, len: ROAD_W + 1.2 };
      const c = cornerAt.get(key(n[0], n[1]));
      if (c && c.din[0] === d[0] && c.din[1] === d[1]) {
        line.chevron = c.turn;
        line.faceX = -d[0];
        line.faceZ = -d[1];
      }
      addBarrier(line);
    }
  }
  // plaza corner: a short barrier wall with chevrons on the outside of the turn
  addBarrier({ x: 17, z: 0, alongX: false, len: 22, chevron: 1, faceX: -1, faceZ: 0 });

  // chicanes: two barrier fingers from alternating curbs
  const chicaneMids: { x: number; z: number; ax: number; az: number }[] = [];
  const cones: { x: number; z: number }[] = [];
  for (const [i0, j0, i1, j1] of CHICANES) {
    const ax = Math.sign(i1 - i0);
    const az = Math.sign(j1 - j0);
    const mx = ((i0 + i1) / 2) * CELL;
    const mz = ((j0 + j1) / 2) * CELL;
    chicaneMids.push({ x: mx, z: mz, ax, az });
    const r = rightOf(ax, az);
    const FL = 12.5;
    for (const [s, side] of [
      [-13, 1],
      [13, -1],
    ] as const) {
      // finger from the curb on `side` (right = +1) reaching FL into the road
      const lat = side * (HALF_ROAD + 0.6 - FL / 2);
      const x = mx + ax * s + r.x * lat;
      const z = mz + az * s + r.z * lat;
      addBarrier({
        x,
        z,
        alongX: ax === 0,
        len: FL + 1.2,
        chevron: -side,
        faceX: -ax,
        faceZ: -az,
      });
      // cones at the finger tip
      const tip = side * (HALF_ROAD + 0.6 - FL - 1.2);
      for (let c = 0; c < 3; c++) {
        cones.push({ x: mx + ax * (s - 1.6 + c * 1.6) + r.x * tip, z: mz + az * (s - 1.6 + c * 1.6) + r.z * tip });
      }
    }
  }

  // gates: start/finish + one before every corner
  const gates: Gate[] = [{ x: START_GATE_X, z: 0, dx: 1, dz: 0, half: 14, turn: 0, cx: START_GATE_X, cz: 0 }];
  for (const c of corners) {
    const cx = c.i * CELL;
    const cz = c.j * CELL;
    const back = c.i === 0 && c.j === 0 ? 16 : 17;
    gates.push({
      x: cx - c.din[0] * back,
      z: cz - c.din[1] * back,
      dx: c.din[0],
      dz: c.din[1],
      half: HALF_ROAD + 0.5,
      turn: c.turn,
      cx,
      cz,
    });
    // apex cones on the inside of the turn
    const ix = cx + (-c.din[0] + c.dout[0]) * HALF_ROAD;
    const iz = cz + (-c.din[1] + c.dout[1]) * HALF_ROAD;
    cones.push({ x: ix + (c.din[0] - c.dout[0]) * 1.7, z: iz + (c.din[1] - c.dout[1]) * 1.7 });
    cones.push({ x: ix - c.din[0] * 3.5 - c.dout[0] * 0.9, z: iz - c.din[1] * 3.5 - c.dout[1] * 0.9 });
    cones.push({ x: ix + c.dout[0] * 3.5 + c.din[0] * 0.9, z: iz + c.dout[1] * 3.5 + c.din[1] * 0.9 });
    // a row of cones in front of the barrier on the outside of the turn
    if (!(c.i === 0 && c.j === 0)) {
      const r = rightOf(c.din[0], c.din[1]);
      for (let k = -2; k <= 2; k++) {
        cones.push({
          x: cx + c.din[0] * 11.8 + r.x * k * 4.2,
          z: cz + c.din[1] * 11.8 + r.z * k * 4.2,
        });
      }
    }
  }

  // centre-line path of the lap (starts at the start position)
  const path: { x: number; z: number }[] = [{ x: START.x, z: START.z }];
  for (const c of ROUTE_IDX) path.push({ x: c[0] * CELL, z: c[1] * CELL });
  path.push({ x: START.x, z: START.z });
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);

  // ground arrows along the route (not in intersections / chicanes)
  const arrows: Slot[] = [];
  const nearChicane = (x: number, z: number) => chicaneMids.some((m) => Math.hypot(x - m.x, z - m.z) < 24);
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    for (let s = 8; s < len - 4; s += 12) {
      const x = a.x + dx * s;
      const z = a.z + dz * s;
      // skip intersections (and the plaza, which has its own paint)
      const li = Math.abs(x / CELL - Math.round(x / CELL)) * CELL;
      const lj = Math.abs(z / CELL - Math.round(z / CELL)) * CELL;
      if (li < 20 && lj < 20) continue;
      if (Math.abs(x) < 90 && Math.abs(z) < 90) continue;
      if (nearChicane(x, z)) continue;
      arrows.push({ x, z, rotY: Math.atan2(dx, dz) });
    }
  }

  // parked cars along the curbs of the route streets
  const parked: Slot[] = [];
  for (const e of edges) {
    const [ka, kb] = e.split("|");
    if (ka > kb) continue; // each edge once
    const a = ka.split(",").map(Number);
    const b = kb.split(",").map(Number);
    if (inPlaza(a[0], a[1]) || inPlaza(b[0], b[1])) continue;
    const ax = b[0] - a[0];
    const az = b[1] - a[1];
    const x0 = a[0] * CELL;
    const z0 = a[1] * CELL;
    const r = rightOf(ax, az);
    const midX = x0 + (ax * CELL) / 2;
    const midZ = z0 + (az * CELL) / 2;
    if (chicaneMids.some((m) => Math.hypot(midX - m.x, midZ - m.z) < 1)) continue;
    for (let s = 23; s <= 61; s += 6.4) {
      for (const side of [-1, 1]) {
        if (rand() > 0.24) continue;
        const x = x0 + ax * s + r.x * side * (HALF_ROAD - 1.25);
        const z = z0 + az * s + r.z * side * (HALF_ROAD - 1.25);
        if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 12)) continue;
        const along = Math.atan2(ax, az) + (side > 0 ? 0 : Math.PI);
        parked.push({ x, z, rotY: along + (rand() - 0.5) * 0.04 });
      }
    }
  }

  return { gates, barriers, colliders, parked, cones, arrows, path, length, start: START };
}

/* ------------------------------------------------------------------ */
/* Collision                                                           */
/* ------------------------------------------------------------------ */

export interface Push {
  x: number;
  z: number;
  depth: number;
}

/** Circle vs axis-aligned box; writes the push-out into `out` if deeper than out.depth. */
export function circleBox(px: number, pz: number, r: number, b: Box, out: Push): boolean {
  const qx = Math.max(b.minX, Math.min(px, b.maxX));
  const qz = Math.max(b.minZ, Math.min(pz, b.maxZ));
  const dx = px - qx;
  const dz = pz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  let nx: number;
  let nz: number;
  let depth: number;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    nz = dz / d;
    depth = r - d;
  } else {
    // centre inside the box: leave through the nearest face
    const l = px - b.minX;
    const rr = b.maxX - px;
    const t = pz - b.minZ;
    const bt = b.maxZ - pz;
    const m = Math.min(l, rr, t, bt);
    nx = m === l ? -1 : m === rr ? 1 : 0;
    nz = m === t ? -1 : m === bt ? 1 : 0;
    if (nx !== 0) nz = 0;
    depth = m + r;
  }
  if (depth <= out.depth) return true;
  out.x = nx * depth;
  out.z = nz * depth;
  out.depth = depth;
  return true;
}

const _blk: Box = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

/** City blocks (sidewalk slabs) are solid; the plaza's 2×2 blocks are open. */
export function collideBlocks(px: number, pz: number, r: number, out: Push): void {
  const bi = Math.floor((px - ORIGIN) / CELL);
  const bj = Math.floor((pz - ORIGIN) / CELL);
  for (let i = bi - 1; i <= bi + 1; i++) {
    if (i < 0 || i >= GRID_N) continue;
    for (let j = bj - 1; j <= bj + 1; j++) {
      if (j < 0 || j >= GRID_N) continue;
      const minX = ORIGIN + i * CELL;
      const minZ = ORIGIN + j * CELL;
      const cx = minX + BLOCK / 2;
      const cz = minZ + BLOCK / 2;
      if (Math.abs(cx) < 73 && Math.abs(cz) < 73) continue; // plaza
      _blk.minX = minX;
      _blk.minZ = minZ;
      _blk.maxX = minX + BLOCK;
      _blk.maxZ = minZ + BLOCK;
      circleBox(px, pz, r, _blk, out);
    }
  }
}

/** Uniform grid over obstacle boxes so a query only tests nearby ones. */
export class BoxGrid {
  private cells = new Map<number, Box[]>();
  constructor(
    boxes: Box[],
    private size = 32
  ) {
    for (const b of boxes) {
      for (let i = Math.floor(b.minX / size); i <= Math.floor(b.maxX / size); i++)
        for (let j = Math.floor(b.minZ / size); j <= Math.floor(b.maxZ / size); j++) {
          const k = this.k(i, j);
          const l = this.cells.get(k);
          if (l) l.push(b);
          else this.cells.set(k, [b]);
        }
    }
  }
  private k(i: number, j: number) {
    return (i + 1000) * 4096 + (j + 1000);
  }
  collide(px: number, pz: number, r: number, out: Push): void {
    const s = this.size;
    for (let i = Math.floor((px - r) / s); i <= Math.floor((px + r) / s); i++)
      for (let j = Math.floor((pz - r) / s); j <= Math.floor((pz + r) / s); j++) {
        const l = this.cells.get(this.k(i, j));
        if (!l) continue;
        for (let n = 0; n < l.length; n++) circleBox(px, pz, r, l[n], out);
      }
  }
}

import type { Building } from "../shared/cityGen";

/**
 * Building faces as climbable walls. Every volume is an axis-aligned box, so a
 * face is described by the volume plus its outward normal (±X or ±Z). The
 * "u" coordinate runs along the face (world Z for ±X faces, world X for ±Z).
 */

export interface Face {
  b: Building;
  nx: number;
  nz: number;
}

/** world coordinate of the face plane along its normal axis */
export function facePlane(f: Face): number {
  return f.nx !== 0 ? f.b.x + (f.nx * f.b.w) / 2 : f.b.z + (f.nz * f.b.d) / 2;
}

/** half extent of the face along u */
export function faceHalf(f: Face): number {
  return f.nx !== 0 ? f.b.d / 2 : f.b.w / 2;
}

/** centre of the face along u */
export function faceCenterU(f: Face): number {
  return f.nx !== 0 ? f.b.z : f.b.x;
}

/** outward normal of the face of `b` nearest to (x, z) */
export function nearestFace(b: Building, x: number, z: number): { nx: number; nz: number } {
  const dx = x - b.x;
  const dz = z - b.z;
  const ox = b.w / 2 - Math.abs(dx);
  const oz = b.d / 2 - Math.abs(dz);
  // outside on one axis only → that axis; otherwise the smaller penetration
  if (Math.abs(dx) > b.w / 2 && Math.abs(dz) <= b.d / 2) return { nx: Math.sign(dx) || 1, nz: 0 };
  if (Math.abs(dz) > b.d / 2 && Math.abs(dx) <= b.w / 2) return { nx: 0, nz: Math.sign(dz) || 1 };
  return ox < oz ? { nx: Math.sign(dx) || 1, nz: 0 } : { nx: 0, nz: Math.sign(dz) || 1 };
}

/** volume containing the point (x, y, z) (with a little tolerance), or null */
export function volumeAt(x: number, y: number, z: number, buildings: Building[], pad = 0): Building | null {
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (y < b.y0 || y > b.h) continue;
    if (Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad) return b;
  }
  return null;
}

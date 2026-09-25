// Drift plaza surface: painted parking-lot / square markings on a canvas.
// World layout (plaza-local metres, x right, z towards the viewer):
//   paved square     |x| <= SQ_X, |z| <= SQ_Z (pavers, separate mesh)
//   granite border   1.2 m ring around it
//   parking rows     double rows north and south of the square
//   drift route      enters from the west along z = 0 (start / finish line
//                    at x = START_X), turns north at the centre and leaves
//                    along x = 0; the north stall rows leave a gap for it

import * as THREE from "three";
import { mulberry32 } from "../shared/cityGen";

export const SQ_X = 50;
export const SQ_Z = 38;
export const STALL_W = 2.6;
export const STALL_D = 5.5;
export const ROW_Z0 = SQ_Z + 8; // first stall row starts here
export const STALL_X0 = -61.1;
export const STALL_N = 48;
/** stalls with |x| below this are left out on the north rows (the route crosses there) */
export const ROUTE_GAP = 18;
export const START_X = -44;

export function makePlazaMarkings(P: number): THREE.CanvasTexture {
  const S = 2048;
  const ppm = S / (P * 2);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const X = (x: number) => (x + P) * ppm;
  const Z = (z: number) => (z + P) * ppm;
  const M = (m: number) => m * ppm;
  const white = "rgba(238,238,232,0.95)";
  const yellow = "rgba(236,190,50,0.95)";

  g.clearRect(0, 0, S, S);

  // granite border around the square (slightly lighter, visible joints)
  g.fillStyle = "rgba(150,148,142,0.95)";
  g.fillRect(X(-SQ_X - 1.2), Z(-SQ_Z - 1.2), M(SQ_X * 2 + 2.4), M(1.2));
  g.fillRect(X(-SQ_X - 1.2), Z(SQ_Z), M(SQ_X * 2 + 2.4), M(1.2));
  g.fillRect(X(-SQ_X - 1.2), Z(-SQ_Z), M(1.2), M(SQ_Z * 2));
  g.fillRect(X(SQ_X), Z(-SQ_Z), M(1.2), M(SQ_Z * 2));
  g.strokeStyle = "rgba(70,68,64,0.8)";
  g.lineWidth = 1;
  for (let x = -SQ_X - 1.2; x <= SQ_X + 1.2; x += 1.2) {
    for (const z of [-SQ_Z - 1.2, SQ_Z]) {
      g.beginPath();
      g.moveTo(X(x), Z(z));
      g.lineTo(X(x), Z(z + 1.2));
      g.stroke();
    }
  }

  // parking stalls: double rows north and south of the square
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.12, col = white) => {
    g.strokeStyle = col;
    g.lineWidth = M(w);
    g.beginPath();
    g.moveTo(X(x0), Z(z0));
    g.lineTo(X(x1), Z(z1));
    g.stroke();
  };
  for (const sgn of [1, -1]) {
    const zA = sgn * ROW_Z0;
    const zB = sgn * (ROW_Z0 + STALL_D);
    const zC = sgn * (ROW_Z0 + STALL_D * 2);
    const xEnd = STALL_X0 + STALL_N * STALL_W;
    if (sgn > 0) {
      line(STALL_X0, zB, -ROUTE_GAP, zB, 0.15);
      line(ROUTE_GAP, zB, xEnd, zB, 0.15);
    } else line(STALL_X0, zB, xEnd, zB, 0.15);
    for (let i = 0; i <= STALL_N; i++) {
      const x = STALL_X0 + i * STALL_W;
      if (sgn > 0 && Math.abs(x) < ROUTE_GAP) continue;
      line(x, zA, x, zC, 0.12);
    }
    // accessible bays
    for (const i of [22, 23, 24, 25]) {
      const x = STALL_X0 + i * STALL_W;
      g.fillStyle = "rgba(40,90,170,0.75)";
      g.fillRect(X(x + 0.1), Z(Math.min(zA, zB)) + M(0.1), M(STALL_W - 0.2), M(STALL_D - 0.2));
    }
  }

  const outer = ROW_Z0 + STALL_D * 2;
  const aisleZ = (outer + P) / 2;
  const aisleX = (SQ_X + 1.2 + P) / 2;

  // edge lines of the outer drive
  g.setLineDash([M(3), M(3)]);
  line(-P + 1, aisleZ, P - 1, aisleZ, 0.12);
  line(-P + 1, -aisleZ, P - 1, -aisleZ, 0.12);
  line(aisleX, -outer, aisleX, outer, 0.12);
  line(-aisleX, -outer, -aisleX, outer, 0.12);
  g.setLineDash([]);

  // zebra crossings from the square to the parking rows
  for (const sgn of [1, -1]) {
    for (const cx of [-30, 30]) {
      for (let k = 0; k < 6; k++) {
        const x = cx - 3 + k * 1.1;
        g.fillStyle = white;
        g.fillRect(X(x), Z(sgn > 0 ? SQ_Z + 1.4 : -ROW_Z0 + 0.2), M(0.55), M(ROW_Z0 - SQ_Z - 1.6));
      }
    }
  }

  // hatched no-parking triangles at the square corners
  for (const sx of [1, -1])
    for (const sz of [1, -1]) {
      g.save();
      g.beginPath();
      const x0 = sx * (SQ_X + 1.2);
      const z0 = sz * (SQ_Z + 1.2);
      g.moveTo(X(x0), Z(z0));
      g.lineTo(X(x0 + sx * 9), Z(z0));
      g.lineTo(X(x0), Z(z0 + sz * 5.5));
      g.closePath();
      g.strokeStyle = yellow;
      g.lineWidth = M(0.15);
      g.stroke();
      g.clip();
      g.strokeStyle = yellow;
      g.lineWidth = M(0.3);
      for (let t = -12; t < 12; t += 1.2) {
        g.beginPath();
        g.moveTo(X(x0 + t), Z(z0 - 8));
        g.lineTo(X(x0 + t + 10), Z(z0 + 8));
        g.stroke();
      }
      g.restore();
    }

  // route lane through the plaza: yellow edge lines + chevrons
  const yl = (x0: number, z0: number, x1: number, z1: number) => line(x0, z0, x1, z1, 0.25, yellow);
  yl(-P, -12, 12, -12);
  yl(12, -12, 12, P);
  yl(-P, 12, -12, 12);
  yl(-12, 12, -12, P);
  const chevron = (x: number, z: number, ang: number) => {
    g.save();
    g.translate(X(x), Z(z));
    g.rotate(ang);
    g.fillStyle = "rgba(236,190,50,0.8)";
    const s = M(1);
    g.beginPath();
    g.moveTo(0, -1.4 * s);
    g.lineTo(1.8 * s, 0.4 * s);
    g.lineTo(1.1 * s, 1.1 * s);
    g.lineTo(0, 0);
    g.lineTo(-1.1 * s, 1.1 * s);
    g.lineTo(-1.8 * s, 0.4 * s);
    g.closePath();
    g.fill();
    g.restore();
  };
  for (let x = -66; x <= -56; x += 10) chevron(x, 0, Math.PI / 2);
  for (let z = 24; z <= 66; z += 14) chevron(0, z, Math.PI);

  // start / finish: checkered band across the lane + a grid box behind it
  const sq = 0.7;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j * sq < 28; j++) {
      g.fillStyle = (i + j) % 2 ? "rgba(240,240,236,0.95)" : "rgba(20,20,22,0.95)";
      g.fillRect(X(START_X - sq + i * sq), Z(-14 + j * sq), M(sq), M(sq));
    }
  g.strokeStyle = white;
  g.lineWidth = M(0.15);
  g.strokeRect(X(START_X - 20), Z(-2), M(5.5), M(4));

  // painted name after the start line, readable when driving east
  g.save();
  g.translate(X(-28), Z(0));
  g.rotate(Math.PI / 2);
  g.fillStyle = "rgba(238,238,232,0.55)";
  g.font = `900 ${Math.round(M(3.6))}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("SAYGIMDAN", 0, 0);
  g.restore();

  // paint wear
  const img = g.getImageData(0, 0, S, S);
  const rand = mulberry32(99);
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] > 0) img.data[i] *= 0.6 + rand() * 0.4;
  }
  g.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

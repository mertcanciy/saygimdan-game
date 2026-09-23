// Canvas textures + merged geometries for streets and street furniture.
// Everything is generated once per page and cached.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./cityGen";

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Tileable asphalt, 8 m per tile. */
export function asphaltTexture(): THREE.CanvasTexture {
  return memo("asphalt", () => {
    const S = 512;
    const { c, g } = canvas(S, S);
    g.fillStyle = "#3a3b3d";
    g.fillRect(0, 0, S, S);
    const rand = mulberry32(11);
    // aggregate speckle
    for (let i = 0; i < 26000; i++) {
      const v = 40 + Math.floor(rand() * 40);
      g.fillStyle = `rgba(${v},${v},${v + 2},${0.35 + rand() * 0.4})`;
      const s = rand() < 0.9 ? 1 : 2;
      g.fillRect(rand() * S, rand() * S, s, s);
    }
    // soft patches (repairs / wear), drawn wrapped so the tile stays seamless
    for (let i = 0; i < 14; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 30 + rand() * 90;
      const dark = rand() < 0.5;
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S]) {
          const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          grad.addColorStop(0, dark ? "rgba(20,20,22,0.18)" : "rgba(120,120,118,0.10)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grad;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
    }
    // hairline cracks
    g.strokeStyle = "rgba(15,15,16,0.35)";
    g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      let x = rand() * S;
      let y = rand() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rand() - 0.5) * 30;
        y += (rand() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return finish(c);
  });
}

/**
 * Transparent road-marking overlay for one road segment between two
 * intersections. u runs along the road (length), v across it (width).
 */
export function roadMarkingTexture(length: number, width: number): THREE.CanvasTexture {
  return memo(`marks-${length}-${width}`, () => {
    const ppm = 24; // pixels per meter
    const W = Math.round(length * ppm);
    const H = Math.round(width * ppm);
    const { c, g } = canvas(W, H);
    g.clearRect(0, 0, W, H);
    const white = "rgba(236,236,230,0.92)";
    const yellow = "rgba(232,190,60,0.95)";
    const m = (v: number) => v * ppm;
    const mid = H / 2;
    const lanesPerDir = width >= 14 ? 2 : 1;
    const gutter = 0.7;
    const laneW = (width / 2 - gutter) / lanesPerDir;
    const cross = 3.2; // crosswalk depth
    const crossStart = 0.9;
    const stopAt = crossStart + cross + 0.6;
    const x0 = m(stopAt + 0.5);
    const x1 = W - m(stopAt + 0.5);

    // edge lines
    g.fillStyle = white;
    g.fillRect(x0, m(gutter) - m(0.075), x1 - x0, m(0.15));
    g.fillRect(x0, H - m(gutter) - m(0.075), x1 - x0, m(0.15));
    // double centre line
    g.fillStyle = yellow;
    g.fillRect(x0, mid - m(0.22), x1 - x0, m(0.12));
    g.fillRect(x0, mid + m(0.1), x1 - x0, m(0.12));
    // dashed lane dividers
    g.fillStyle = white;
    for (let l = 1; l < lanesPerDir; l++) {
      for (const sgn of [-1, 1]) {
        const y = mid + sgn * (l * laneW);
        for (let x = x0 + m(1); x < x1 - m(3); x += m(9)) g.fillRect(x, y - m(0.07), m(3), m(0.14));
      }
    }
    // zebra crossings + stop lines at both ends
    for (const end of [0, 1]) {
      const cx0 = end === 0 ? m(crossStart) : W - m(crossStart + cross);
      for (let y = m(gutter + 0.2); y < H - m(gutter + 0.2); y += m(1.0)) {
        g.fillRect(cx0, y, m(cross), m(0.5));
      }
      const sx = end === 0 ? m(stopAt) : W - m(stopAt) - m(0.4);
      // stop line on the lanes arriving at this end
      if (end === 0) g.fillRect(sx, mid + m(0.1), m(0.4), mid - m(gutter + 0.1));
      else g.fillRect(sx, m(gutter), m(0.4), mid - m(gutter + 0.1));
    }
    // wear: knock random pixels out so paint looks used
    const img = g.getImageData(0, 0, W, H);
    const rand = mulberry32(W + H);
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] > 0) img.data[i] *= 0.55 + rand() * 0.45;
    }
    g.putImageData(img, 0, 0);
    const t = finish(c, true, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Concrete paving slabs, 2 m per tile. */
export function pavingTexture(): THREE.CanvasTexture {
  return memo("paving", () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    const rand = mulberry32(23);
    const n = 4; // 4 slabs across = 0.5 m slabs
    const cs = S / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 150 + Math.floor(rand() * 26);
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        g.fillRect(i * cs, j * cs, cs, cs);
        for (let k = 0; k < 220; k++) {
          const q = v - 25 + Math.floor(rand() * 40);
          g.fillStyle = `rgba(${q},${q},${q - 4},0.5)`;
          g.fillRect(i * cs + rand() * cs, j * cs + rand() * cs, 1, 1);
        }
      }
    g.strokeStyle = "rgba(70,68,64,0.8)";
    g.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * cs, 0);
      g.lineTo(i * cs, S);
      g.moveTo(0, i * cs);
      g.lineTo(S, i * cs);
      g.stroke();
    }
    return finish(c);
  });
}

/** Grass for parks, 4 m per tile. */
export function grassTexture(): THREE.CanvasTexture {
  return memo("grass", () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    g.fillStyle = "#4b6b2e";
    g.fillRect(0, 0, S, S);
    const rand = mulberry32(31);
    for (let i = 0; i < 9000; i++) {
      const gr = 80 + Math.floor(rand() * 70);
      g.fillStyle = `rgba(${gr * 0.55},${gr},${gr * 0.35},0.6)`;
      g.fillRect(rand() * S, rand() * S, 1, 2 + rand() * 2);
    }
    return finish(c);
  });
}

function crownGeometry(clusters: number, detail: number, minR: number, spreadR: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  // leaf clusters scattered in a squashed ellipsoid, each noisily displaced so
  // the silhouette reads as foliage rather than a few smooth balls
  for (let i = 0; i < clusters; i++) {
    const a = rand() * Math.PI * 2;
    const u = rand() * 2 - 1;
    const rr = 0.35 + 0.65 * Math.cbrt(rand());
    const x = Math.cos(a) * Math.sqrt(1 - u * u) * 2.1 * rr;
    const z = Math.sin(a) * Math.sqrt(1 - u * u) * 2.1 * rr;
    const y = 4.9 + u * 1.7 * rr;
    const g = mergeVertices(new THREE.IcosahedronGeometry(minR + rand() * spreadR, detail));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const j = 0.7 + rand() * 0.6;
      p.setXYZ(k, p.getX(k) * j, p.getY(k) * j * 0.8, p.getZ(k) * j);
    }
    g.translate(x, y, z);
    parts.push(g);
  }
  const crown = mergeGeometries(parts)!;
  crown.computeVertexNormals();
  return crown;
}

/**
 * Tree in two levels of detail. Base at y=0, ~7 m tall.
 * `near`: ~30 leaf clusters + branches (~2.5k tris); `far`: 7 coarse clusters (~140 tris).
 */
export function treeGeometries(): {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
  trunkFar: THREE.BufferGeometry;
  crownFar: THREE.BufferGeometry;
} {
  return memo("tree", () => {
    const rand = mulberry32(5);
    const trunkCore = new THREE.CylinderGeometry(0.11, 0.19, 3.8, 7);
    trunkCore.translate(0, 1.9, 0);
    const branches: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const br = new THREE.CylinderGeometry(0.04, 0.08, 1.8, 5);
      br.translate(0, 0.9, 0);
      br.rotateZ(0.6 + rand() * 0.3);
      br.rotateY((i / 4) * Math.PI * 2 + rand());
      br.translate(0, 3.2, 0);
      branches.push(br);
    }
    const trunk = mergeGeometries([trunkCore, ...branches])!;
    const trunkFar = new THREE.CylinderGeometry(0.12, 0.2, 3.8, 5);
    trunkFar.translate(0, 1.9, 0);
    return {
      trunk,
      crown: crownGeometry(30, 1, 0.45, 0.4, 5),
      trunkFar,
      crownFar: crownGeometry(7, 0, 0.95, 0.4, 5),
    };
  });
}

/** Street lamp: pole + arm reaching +Z, head separate so it can glow. */
export function lampGeometries(): { pole: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  return memo("lamp", () => {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 7.6, 8);
    pole.translate(0, 3.8, 0);
    const base = new THREE.CylinderGeometry(0.18, 0.2, 0.6, 8);
    base.translate(0, 0.3, 0);
    const arm = new THREE.CylinderGeometry(0.045, 0.045, 1.9, 6);
    arm.rotateX(Math.PI / 2);
    arm.translate(0, 7.45, 0.9);
    const housing = new THREE.BoxGeometry(0.34, 0.14, 0.75);
    housing.translate(0, 7.45, 1.95);
    const merged = mergeGeometries([pole, base, arm, housing])!;
    const head = new THREE.BoxGeometry(0.26, 0.04, 0.6);
    head.translate(0, 7.37, 1.95);
    return { pole: merged, head };
  });
}

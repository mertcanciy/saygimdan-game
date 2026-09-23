import * as THREE from "three";

/**
 * Procedural suit textures (canvas-generated, no downloads).
 *
 * Every body part is a lathe / sphere mesh, so UVs are cylindrical:
 *   u = angle around the limb axis (0 = front / +Z, 0.25 = +X, 0.5 = back)
 *   v = along the axis (0 = bottom, 1 = top)
 * Meridians + scalloped rings in UV space therefore read as the classic
 * radial web pattern on the finished model.
 */

export type Region = 0 | 1; // 0 = red, 1 = blue

export interface SuitTexOpts {
  size?: number;
  /** number of vertical web lines around the circumference */
  cols: number;
  /** number of scalloped rings along the length */
  rows: number;
  /** which colour a (u,v) pixel gets */
  region: (u: number, v: number) => Region;
  /** 0..1 amount of downward sag of the scallops (in row units) */
  sag?: number;
}

const RED: [number, number, number] = [178, 18, 30];
const BLUE: [number, number, number] = [22, 40, 120];

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface SuitTextures {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export function makeSuitTextures(opts: SuitTexOpts): SuitTextures {
  const size = opts.size ?? 512;
  const sag = opts.sag ?? 0.35;

  // 1) web lines drawn on their own canvas (white on black) -> line mask
  const lc = document.createElement("canvas");
  lc.width = lc.height = size;
  const lg = lc.getContext("2d")!;
  lg.fillStyle = "#000";
  lg.fillRect(0, 0, size, size);
  lg.strokeStyle = "#fff";
  lg.lineCap = "round";
  lg.lineWidth = Math.max(1.4, size / 300);
  const cw = size / opts.cols;
  const rh = size / opts.rows;
  // meridians (x wraps, so draw col 0 at both edges)
  for (let i = 0; i <= opts.cols; i++) {
    const x = i * cw;
    lg.beginPath();
    lg.moveTo(x, 0);
    lg.lineTo(x, size);
    lg.stroke();
  }
  // scallops: canvas y grows down, texture v grows up (flipY) → sag "down" in v
  for (let j = 0; j <= opts.rows; j++) {
    const y = size - j * rh;
    lg.beginPath();
    for (let i = 0; i < opts.cols; i++) {
      const x0 = i * cw;
      const x1 = x0 + cw;
      lg.moveTo(x0, y);
      lg.quadraticCurveTo((x0 + x1) / 2, y + rh * sag, x1, y);
    }
    lg.stroke();
  }
  const lines = lg.getImageData(0, 0, size, size).data;

  // 2) compose colour: red/blue regions, web lines only over red, dark seams
  const cc = document.createElement("canvas");
  cc.width = cc.height = size;
  const cg = cc.getContext("2d")!;
  const img = cg.createImageData(size, size);
  const d = img.data;
  const bc = document.createElement("canvas");
  bc.width = bc.height = size;
  const bg = bc.getContext("2d")!;
  const bimg = bg.createImageData(size, size);
  const bd = bimg.data;

  const reg = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) reg[y * size + x] = opts.region((x + 0.5) / size, v);
  }
  const seam = Math.max(2, Math.round(size / 180));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = reg[i];
      // seam where the region changes nearby
      const xr = (x + seam) % size;
      const xl = (x - seam + size) % size;
      const yd = Math.min(size - 1, y + seam);
      const yu = Math.max(0, y - seam);
      const edge =
        reg[y * size + xr] !== r || reg[y * size + xl] !== r || reg[yd * size + x] !== r || reg[yu * size + x] !== r;
      const n = hash(x, y) * 0.08 - 0.04; // fabric grain
      let cr: number, cgc: number, cb: number;
      if (r === 0) {
        cr = RED[0];
        cgc = RED[1];
        cb = RED[2];
      } else {
        cr = BLUE[0];
        cgc = BLUE[1];
        cb = BLUE[2];
      }
      // fine knit (diagonal micro-texture)
      const knit = ((x + y) & 3) === 0 ? -0.05 : 0;
      let k = 1 + n + knit;
      const la = r === 0 ? lines[i * 4] / 255 : 0;
      let bump = 0.5 + n * 0.5;
      if (la > 0) {
        k *= 1 - la * 0.82;
        bump += la * 0.5;
      }
      if (edge) {
        k *= 0.35;
        bump += 0.25;
      }
      d[i * 4] = Math.max(0, Math.min(255, cr * k));
      d[i * 4 + 1] = Math.max(0, Math.min(255, cgc * k));
      d[i * 4 + 2] = Math.max(0, Math.min(255, cb * k));
      d[i * 4 + 3] = 255;
      const b8 = Math.max(0, Math.min(255, bump * 255));
      bd[i * 4] = bd[i * 4 + 1] = bd[i * 4 + 2] = b8;
      bd[i * 4 + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  bg.putImageData(bimg, 0, 0);

  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = THREE.RepeatWrapping;
  bump.anisotropy = 8;
  return { map, bump };
}

/* ---------- region helpers (u: 0 front, .25 = +X side, .5 back) ---------- */

/** distance (0..0.5) of u from a target angle, wrapping */
export function du(u: number, target: number) {
  const x = Math.abs(u - target) % 1;
  return Math.min(x, 1 - x);
}

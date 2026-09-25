// Geometry + canvas textures for the street-drift event dressing: plastic
// barrier lines, chevron boards, gates, traffic cones, route arrows.
// Everything static is merged into a handful of meshes (one draw call per
// material) so the whole event layout costs ~10 draw calls.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BarrierLine, Gate } from "./route";

const PIECE = 2; // barrier piece pitch (m)

/** Water-filled plastic road barrier, 1.9 m long along +x, 0.85 m tall. */
function barrierPiece(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.3, 0);
  sh.lineTo(0.3, 0);
  sh.lineTo(0.27, 0.12);
  sh.lineTo(0.2, 0.2);
  sh.lineTo(0.16, 0.78);
  sh.lineTo(0.1, 0.85);
  sh.lineTo(-0.1, 0.85);
  sh.lineTo(-0.16, 0.78);
  sh.lineTo(-0.2, 0.2);
  sh.lineTo(-0.27, 0.12);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: PIECE - 0.1, bevelEnabled: false });
  g.translate(0, 0, -(PIECE - 0.1) / 2);
  g.rotateY(Math.PI / 2); // length along x
  g.deleteAttribute("uv");
  return g.toNonIndexed();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rotY: number, sx = 1, sy = 1, sz = 1) {
  const c = g.clone();
  _q.setFromAxisAngle(_up, rotY);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  c.applyMatrix4(_m);
  return c;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (!list.length) return new THREE.BufferGeometry();
  const g = mergeGeometries(list, false)!;
  for (const l of list) l.dispose();
  g.computeBoundingSphere();
  return g;
}

export interface BarrierMeshes {
  red: THREE.BufferGeometry;
  white: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
  boards: THREE.BufferGeometry;
  posts: THREE.BufferGeometry;
}

/** Alternating red / white barrier pieces for every line + amber lamps + chevron boards. */
export function buildBarriers(lines: BarrierLine[]): BarrierMeshes {
  const piece = barrierPiece();
  const lampG = new THREE.BoxGeometry(0.16, 0.16, 0.16).toNonIndexed();
  lampG.deleteAttribute("uv");
  const board = new THREE.PlaneGeometry(3.6, 1.0);
  const post = new THREE.BoxGeometry(0.1, 2.3, 0.1).toNonIndexed();
  post.deleteAttribute("uv");
  const red: THREE.BufferGeometry[] = [];
  const white: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const boards: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  for (const l of lines) {
    const n = Math.max(1, Math.round(l.len / PIECE));
    const rotY = l.alongX ? 0 : Math.PI / 2;
    for (let k = 0; k < n; k++) {
      const t = (k - (n - 1) / 2) * PIECE;
      const x = l.alongX ? l.x + t : l.x;
      const z = l.alongX ? l.z : l.z + t;
      (k % 2 === 0 ? red : white).push(placed(piece, x, 0, z, rotY));
      if (k % 3 === 1) lamps.push(placed(lampG, x, 0.95, z, rotY));
    }
    if (l.chevron) {
      // board on two posts, facing the approaching driver; chevrons point the turn
      const fx = l.faceX ?? 0;
      const fz = l.faceZ ?? 0;
      const face = Math.atan2(fx, fz);
      const bx = l.x + fx * 0.05;
      const bz = l.z + fz * 0.05;
      const b = placed(board, bx, 1.75, bz, face);
      if (l.chevron < 0) {
        const uv = b.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      }
      boards.push(b);
      const rx = Math.cos(face);
      const rz = -Math.sin(face);
      for (const s of [-1.3, 1.3]) posts.push(placed(post, bx - fx * 0.08 + rx * s, 1.15, bz - fz * 0.08 + rz * s, face));
    }
  }
  const out = { red: merge(red), white: merge(white), lamps: merge(lamps), boards: merge(boards), posts: merge(posts) };
  piece.dispose();
  lampG.dispose();
  board.dispose();
  post.dispose();
  return out;
}

/** Red board with white chevrons pointing right (UV-flipped for left turns). */
export function chevronBoardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 144;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d4201a";
  g.fillRect(0, 0, 512, 144);
  g.fillStyle = "#ffffff";
  for (let i = 0; i < 4; i++) {
    const x0 = 44 + i * 112;
    g.beginPath();
    g.moveTo(x0, 16);
    g.lineTo(x0 + 34, 16);
    g.lineTo(x0 + 84, 72);
    g.lineTo(x0 + 34, 128);
    g.lineTo(x0, 128);
    g.lineTo(x0 + 50, 72);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = "#ffffff";
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- gates ---------------- */

export const GATE_H = 6.6;

export interface GateMeshes {
  truss: THREE.BufferGeometry;
  /** LED strips: per-gate vertex colour (for highlighting), vertex ranges per gate */
  leds: THREE.BufferGeometry;
  ledRanges: [number, number][];
  panels: THREE.BufferGeometry;
  panelRanges: [number, number][];
}

/**
 * Gate = two truss posts on the curbs, a beam across the road and a hanging
 * panel with the turn arrow (atlas: left | right | finish) facing the driver.
 */
export function buildGates(gates: Gate[]): GateMeshes {
  const post = new THREE.BoxGeometry(0.55, GATE_H, 0.55).toNonIndexed();
  const foot = new THREE.BoxGeometry(1.2, 0.5, 1.2).toNonIndexed();
  const truss: THREE.BufferGeometry[] = [];
  const leds: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  const ledRanges: [number, number][] = [];
  const panelRanges: [number, number][] = [];
  let ledV = 0;
  let panV = 0;
  for (const g of gates) {
    const face = Math.atan2(-g.dx, -g.dz); // panel faces the approaching car
    const rx = -g.dz; // right of travel
    const rz = g.dx;
    const w = g.half * 2 + 1.6;
    for (const s of [-1, 1]) {
      const px = g.x + rx * s * (g.half + 0.8);
      const pz = g.z + rz * s * (g.half + 0.8);
      truss.push(placed(post, px, GATE_H / 2, pz, face));
      truss.push(placed(foot, px, 0.25, pz, face));
    }
    const beam = new THREE.BoxGeometry(w, 0.7, 0.7).toNonIndexed();
    truss.push(placed(beam, g.x, GATE_H + 0.35, g.z, face));
    beam.dispose();
    // LED strip under the beam and up both posts (front side)
    const strip = new THREE.BoxGeometry(w - 1.2, 0.12, 0.08).toNonIndexed();
    const l0 = ledV;
    const partsL: THREE.BufferGeometry[] = [placed(strip, g.x - g.dx * 0.36, GATE_H - 0.02, g.z - g.dz * 0.36, face)];
    strip.dispose();
    const vstrip = new THREE.BoxGeometry(0.1, GATE_H - 0.8, 0.1).toNonIndexed();
    for (const s of [-1, 1]) {
      partsL.push(
        placed(vstrip, g.x + rx * s * (g.half + 0.8) - g.dx * 0.3, GATE_H / 2 + 0.2, g.z + rz * s * (g.half + 0.8) - g.dz * 0.3, face)
      );
    }
    vstrip.dispose();
    for (const p of partsL) {
      p.deleteAttribute("uv");
      ledV += p.getAttribute("position").count;
      leds.push(p);
    }
    ledRanges.push([l0, ledV]);
    // arrow panel (two faces so it also reads in the mirror / from behind)
    const cell = g.turn === 0 ? 2 : g.turn < 0 ? 0 : 1;
    const pw = g.turn === 0 ? 9 : 4.6;
    const pan = new THREE.PlaneGeometry(pw, 2.3);
    const uv = pan.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 3);
    const p0 = panV;
    const front = placed(pan.toNonIndexed(), g.x - g.dx * 0.4, GATE_H - 1.35, g.z - g.dz * 0.4, face);
    panels.push(front);
    panV += front.getAttribute("position").count;
    panelRanges.push([p0, panV]);
    pan.dispose();
  }
  for (const t of truss) t.deleteAttribute("uv");
  const out: GateMeshes = {
    truss: merge(truss),
    leds: merge(leds),
    ledRanges,
    panels: merge(panels),
    panelRanges,
  };
  // per-vertex colours for highlighting
  out.leds.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ledV * 3).fill(0.3), 3));
  out.panels.setAttribute("color", new THREE.BufferAttribute(new Float32Array(panV * 3).fill(0.5), 3));
  post.dispose();
  foot.dispose();
  return out;
}

/** Panel atlas: [left arrow | right arrow | START / FINISH checker]. */
export function gatePanelTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W * 3;
  c.height = H;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 2; k++) {
    const x0 = k * W;
    g.fillStyle = "#101014";
    g.fillRect(x0, 0, W, H);
    g.fillStyle = "#ffd400";
    g.fillRect(x0 + 4, 4, W - 8, 8);
    g.fillRect(x0 + 4, H - 12, W - 8, 8);
    // curved turn arrow
    g.save();
    g.translate(x0 + W / 2, H / 2 + 6);
    if (k === 0) g.scale(-1, 1);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 18;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-54, 40);
    g.lineTo(-54, 6);
    g.quadraticCurveTo(-54, -24, -20, -24);
    g.lineTo(26, -24);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(62, -24);
    g.lineTo(22, -52);
    g.lineTo(22, 4);
    g.closePath();
    g.fill();
    g.restore();
  }
  // start / finish
  const x0 = W * 2;
  const sq = 16;
  for (let i = 0; i < W / sq; i++)
    for (let j = 0; j < H / sq; j++) {
      g.fillStyle = (i + j) % 2 ? "#f4f4f0" : "#101014";
      g.fillRect(x0 + i * sq, j * sq, sq, sq);
    }
  g.fillStyle = "rgba(16,16,20,0.92)";
  g.fillRect(x0 + 18, 30, W - 36, 68);
  g.fillStyle = "#ffd400";
  g.font = "900 40px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("START", x0 + W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft band of light on the ground under the next gate (bright in the middle). */
export function curtainTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "rgba(255,212,0,0)");
  grad.addColorStop(0.5, "rgba(255,212,0,0.7)");
  grad.addColorStop(1, "rgba(255,212,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- cones ---------------- */

/** Traffic cone (orange with a white reflective band) with a square foot; vertex coloured. */
export function coneGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.035, 0.16, 0.66, 12, 6, true).toNonIndexed();
  body.translate(0, 0.37, 0);
  const foot = new THREE.BoxGeometry(0.4, 0.04, 0.4).toNonIndexed();
  foot.translate(0, 0.02, 0);
  const col = (g: THREE.BufferGeometry, f: (y: number) => [number, number, number]) => {
    const p = g.getAttribute("position");
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) c.set(f(p.getY(i)), i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.deleteAttribute("uv");
  };
  col(body, (y) => (y > 0.38 && y < 0.53 ? [0.95, 0.95, 0.92] : [1, 0.32, 0.04]));
  col(foot, () => [0.9, 0.26, 0.03]);
  const g = mergeGeometries([body, foot], false)!;
  body.dispose();
  foot.dispose();
  return g;
}

/* ---------------- route arrows (ground decals) ---------------- */

export function routeArrowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "rgba(255,212,0,0.9)";
  // two stacked chevrons pointing "up" (= +v = travel direction)
  for (const y0 of [20, 64]) {
    g.beginPath();
    g.moveTo(64, y0);
    g.lineTo(112, y0 + 34);
    g.lineTo(96, y0 + 44);
    g.lineTo(64, y0 + 20);
    g.lineTo(32, y0 + 44);
    g.lineTo(16, y0 + 34);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Canvas-generated textures for the F-16: panel lines, national markings,
// glow sprites. Everything is created lazily once and cached.

import * as THREE from "three";
import { mulberry32 } from "../shared/cityGen";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Engraved panel line + rivet pattern drawn on a light base (multiplied onto vertex colours). */
function drawPanels(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  pxPerM: [number, number],
  frames: number[],
  stringers: number[],
  seed: number
) {
  const rand = mulberry32(seed);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  // subtle panel-to-panel tone variation (repaints, weathering)
  for (let i = 0; i < frames.length - 1; i++) {
    for (let j = 0; j < stringers.length - 1; j++) {
      const v = 238 + Math.floor(rand() * 17);
      g.fillStyle = `rgb(${v},${v},${v + 1})`;
      const x0 = frames[i] * pxPerM[0];
      const x1 = frames[i + 1] * pxPerM[0];
      const y0 = stringers[j] * h;
      const y1 = stringers[j + 1] * h;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  // soft grime streaks along the flow (u axis)
  for (let i = 0; i < 90; i++) {
    const y = rand() * h;
    const x = rand() * w;
    const len = 30 + rand() * 180;
    const grad = g.createLinearGradient(x, 0, x + len, 0);
    grad.addColorStop(0, "rgba(90,95,100,0)");
    grad.addColorStop(0.3, `rgba(90,95,100,${0.04 + rand() * 0.05})`);
    grad.addColorStop(1, "rgba(90,95,100,0)");
    g.fillStyle = grad;
    g.fillRect(x, y, len, 1 + rand() * 3);
  }
  g.strokeStyle = "rgba(40,44,50,0.34)";
  g.lineWidth = 1.4;
  for (const f of frames) {
    const x = f * pxPerM[0];
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (const s of stringers) {
    const y = s * h;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // a few access hatches
  g.lineWidth = 1.1;
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const ww = 14 + rand() * 40;
    const hh = 10 + rand() * 26;
    g.strokeRect(x, y, ww, hh);
  }
  // rivet rows next to the frames
  g.fillStyle = "rgba(50,55,60,0.22)";
  for (const f of frames) {
    const x = f * pxPerM[0] + 4;
    for (let y = 2; y < h; y += 7) g.fillRect(x, y, 1.2, 1.2);
  }
}

let _fuselagePanels: THREE.CanvasTexture | null = null;
/** Panel texture for the lofted fuselage: u = station (0..16 m), v = around. */
export function fuselagePanelTexture() {
  if (_fuselagePanels) return _fuselagePanels;
  const W = 2048;
  const H = 512;
  const { c, g } = canvas(W, H);
  const frames = [0, 2.2, 3.0, 4.3, 5.4, 6.6, 7.4, 8.3, 9.4, 10.3, 11.1, 12.2, 13.1, 14.0, 14.5, 16];
  const stringers = [0, 0.14, 0.27, 0.36, 0.5, 0.64, 0.73, 0.86, 1];
  drawPanels(g, W, H, [W / 16, H], frames, stringers, 42);
  _fuselagePanels = finish(c);
  return _fuselagePanels;
}

let _wingPanels: THREE.CanvasTexture | null = null;
/** Tiled panel texture for flat surfaces; UVs are in metres, 1 tile = 4 m. */
export function wingPanelTexture() {
  if (_wingPanels) return _wingPanels;
  const S = 1024;
  const { c, g } = canvas(S, S);
  const frames = [0, 0.55, 1.3, 1.9, 2.6, 3.4, 4];
  const stringers = [0, 0.12, 0.3, 0.46, 0.6, 0.78, 0.9, 1];
  drawPanels(g, S, S, [S / 4, S], frames, stringers, 7);
  _wingPanels = finish(c, true, true);
  _wingPanels.repeat.set(0.25, 0.25);
  return _wingPanels;
}

let _roundel: THREE.CanvasTexture | null = null;
/** Turkish Air Force roundel: red / white / red. */
export function roundelTexture() {
  if (_roundel) return _roundel;
  const { c, g } = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  const ring = (r: number, col: string) => {
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
  };
  ring(124, "#d0202c");
  ring(84, "#f4f4f2");
  ring(44, "#d0202c");
  _roundel = finish(c);
  return _roundel;
}

/** Five-pointed star path. */
function star(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, rot: number) {
  const r = R * 0.382;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

let _flag: THREE.CanvasTexture | null = null;
/** Turkish flag (fin flash) + tail number. Hoist on the left. */
export function flagTexture() {
  if (_flag) return _flag;
  const W = 512;
  const H = 400;
  const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const fh = 300; // flag height (ratio 2:3)
  const fw = fh * 1.5;
  const x0 = (W - fw) / 2;
  g.fillStyle = "#d0202c";
  g.fillRect(x0, 0, fw, fh);
  // official construction (G = flag height)
  const G = fh;
  const cx = x0 + G / 2;
  const cy = fh / 2;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(cx, cy, G / 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#d0202c";
  g.beginPath();
  g.arc(cx + G * 0.0625, cy, G * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  star(g, cx + G * (0.0625 + 0.2 + 0.0333 + 0.125), cy, G * 0.125, Math.PI);
  // tail number under the flag
  g.fillStyle = "rgba(30,32,36,0.9)";
  g.font = "bold 64px 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("91-0011", W / 2, fh + 56);
  _flag = finish(c);
  return _flag;
}

let _glow: THREE.CanvasTexture | null = null;
export function glowTexture() {
  if (_glow) return _glow;
  const { c, g } = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.15, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.15)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glow = finish(c);
  return _glow;
}

/** Static multi-function display face (radar / SMS page look). */
export function mfdTexture(kind: "radar" | "sms") {
  const { c, g } = canvas(256, 256);
  g.fillStyle = "#06120c";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#3dff8a";
  g.fillStyle = "#3dff8a";
  g.lineWidth = 2;
  g.font = "bold 16px monospace";
  if (kind === "radar") {
    for (let r = 50; r <= 200; r += 50) {
      g.beginPath();
      g.arc(128, 236, r, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(128, 236);
    g.lineTo(128 - 150, 236 - 110);
    g.moveTo(128, 236);
    g.lineTo(128 + 150, 236 - 110);
    g.stroke();
    g.fillRect(150, 110, 10, 6);
    g.fillRect(96, 70, 10, 6);
    g.fillText("CRM  RWS", 14, 22);
    g.fillText("20", 220, 22);
  } else {
    g.fillText("SMS  A-A", 14, 22);
    g.strokeRect(60, 70, 136, 120);
    g.fillText("1 9L", 22, 120);
    g.fillText("9 9L", 190, 120);
    g.fillText("2 120", 22, 170);
    g.fillText("8 120", 176, 170);
    g.fillText("GUN 510", 88, 230);
  }
  // bezel buttons
  g.fillStyle = "#1c2420";
  for (let i = 0; i < 5; i++) {
    g.fillRect(4, 40 + i * 40, 6, 18);
    g.fillRect(246, 40 + i * 40, 6, 18);
  }
  return finish(c);
}

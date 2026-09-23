// Shared car materials (created once per page).

import * as THREE from "three";
import type { Slot } from "./carGeometry";

let shared: Record<Slot, THREE.Material> | null = null;

/** Clearcoat car paint. */
export function makePaint(color: THREE.ColorRepresentation = "#ffffff"): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.25,
  });
}

/** Materials per slot. `paint` is white so instance colours tint it. */
export function carMaterials(): Record<Slot, THREE.Material> {
  if (shared) return shared;
  shared = {
    paint: makePaint("#ffffff"),
    panel: new THREE.MeshStandardMaterial({ color: "#d9dbd8", roughness: 0.55, metalness: 0.15 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: "#141b26",
      metalness: 0.4,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.8,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    trim: new THREE.MeshStandardMaterial({ color: "#0d0e10", roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: "#dfe3e8", roughness: 0.12, metalness: 1, envMapIntensity: 1.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: "#161618", roughness: 0.86, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: "#c9ced6", roughness: 0.3, metalness: 0.7, envMapIntensity: 1.4 }),
    head: new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: "#eef4ff",
      emissiveIntensity: 3.2,
      roughness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    tail: new THREE.MeshStandardMaterial({
      color: "#300406",
      emissive: "#ff0808",
      emissiveIntensity: 1.6,
      roughness: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    amber: new THREE.MeshStandardMaterial({
      color: "#402000",
      emissive: "#ffae3a",
      emissiveIntensity: 3,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  };
  return shared;
}

let unlit: Record<Slot, THREE.Material> | null = null;
/** Same set with head / tail / marker lights switched off (parked cars). */
export function carMaterialsUnlit(): Record<Slot, THREE.Material> {
  if (unlit) return unlit;
  const m = carMaterials();
  const off = (src: THREE.Material, color: string) => {
    const c = (src as THREE.MeshStandardMaterial).clone();
    c.emissiveIntensity = 0;
    c.color.set(color);
    c.metalness = 0.6;
    c.roughness = 0.08;
    return c;
  };
  unlit = { ...m, head: off(m.head, "#c9ced6"), tail: off(m.tail, "#6a0a0e"), amber: off(m.amber, "#8a5a10") };
  return unlit;
}

/** Plausible traffic paint colours (mostly greys / whites like real roads). */
export const TRAFFIC_PAINTS = [
  "#e9eaec",
  "#f4f4f2",
  "#1b1c1f",
  "#26282c",
  "#8e949b",
  "#5b6068",
  "#b8bcc2",
  "#7d1d22",
  "#1f3a6b",
  "#2f5d8c",
  "#b0331f",
  "#314a3a",
  "#c7a567",
  "#5a3d2b",
  "#d6d0c4",
];

/** Soft radial flare texture (white core, soft falloff). */
let flareTex: THREE.CanvasTexture | null = null;
export function flareTexture(): THREE.CanvasTexture {
  if (flareTex) return flareTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.28)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // faint horizontal streak (anamorphic)
  const s = g.createLinearGradient(0, 0, 128, 0);
  s.addColorStop(0, "rgba(255,255,255,0)");
  s.addColorStop(0.5, "rgba(255,255,255,0.35)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = s;
  g.fillRect(0, 62, 128, 4);
  flareTex = new THREE.CanvasTexture(c);
  flareTex.colorSpace = THREE.SRGBColorSpace;
  return flareTex;
}

/** Headlight beam on the road: soft cone, bright near the car. u across, v along. */
let beamTex: THREE.CanvasTexture | null = null;
export function beamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const W = 128;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = at the car, 1 = far
    const spread = 0.18 + v * 0.82;
    const fall = Math.pow(1 - v, 1.6) * Math.min(1, v * 8);
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1;
      const across = Math.max(0, 1 - Math.pow(Math.abs(u) / spread, 2));
      const a = across * fall;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}

"use client";

import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { zs } from "./jetGeometry";
import { mfdTexture } from "./textures";

/** Pilot eye point in jet-local coordinates. */
export const EYE = new THREE.Vector3(0, 0.98, zs(5.25));

/** Flight data the HUD draws (written by the game every frame). */
export interface HudData {
  pitch: number; // deg, nose up +
  roll: number; // rad, right wing down +
  heading: number; // deg 0..360
  speed: number; // km/h
  alt: number; // m
  g: number;
  throttle: number;
  ab: boolean;
  mach: number;
  /** direction to next ring in HUD degrees (x right, y up), or NaN */
  cueX: number;
  cueY: number;
}

export function makeHudData(): HudData {
  return { pitch: 0, roll: 0, heading: 0, speed: 0, alt: 0, g: 1, throttle: 0, ab: false, mach: 0, cueX: NaN, cueY: NaN };
}

const HUD_W = 0.3; // combiner width (m)
const HUD_H = 0.27;
const HUD_S = 4.75; // station of the combiner
const HUD_DIST = Math.abs(zs(HUD_S) - EYE.z);
const PX = 512;
/** pixels per degree on the HUD canvas (conformal with the outside world) */
const PPD = PX / (2 * THREE.MathUtils.radToDeg(Math.atan(HUD_W / 2 / HUD_DIST)));
const GREEN = "#6dff9c";

function drawHud(g: CanvasRenderingContext2D, d: HudData) {
  g.fillStyle = "#000";
  g.fillRect(0, 0, PX, PX);
  g.strokeStyle = GREEN;
  g.fillStyle = GREEN;
  g.lineWidth = 4;
  g.lineCap = "round";
  g.font = "bold 27px 'Menlo', 'Consolas', monospace";
  g.textBaseline = "middle";
  const cx = PX / 2;
  const cy = PX / 2;

  // ---- pitch ladder (rotated with roll) ----
  g.save();
  g.beginPath();
  g.rect(40, 70, PX - 80, PX - 150);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-d.roll);
  const base = d.pitch * PPD;
  for (let p = -90; p <= 90; p += 5) {
    const y = base - p * PPD;
    if (Math.abs(y) > PX) continue;
    if (p === 0) {
      g.beginPath();
      g.moveTo(-230, y);
      g.lineTo(-40, y);
      g.moveTo(40, y);
      g.lineTo(230, y);
      g.stroke();
      continue;
    }
    const w = 95;
    const gap = 38;
    g.beginPath();
    if (p > 0) {
      g.setLineDash([]);
      g.moveTo(-gap - w, y + 10);
      g.lineTo(-gap - w, y);
      g.lineTo(-gap, y);
      g.moveTo(gap, y);
      g.lineTo(gap + w, y);
      g.lineTo(gap + w, y + 10);
    } else {
      g.setLineDash([12, 9]);
      g.moveTo(-gap - w, y - 10);
      g.lineTo(-gap - w, y);
      g.lineTo(-gap, y);
      g.moveTo(gap, y);
      g.lineTo(gap + w, y);
      g.lineTo(gap + w, y - 10);
    }
    g.stroke();
    g.setLineDash([]);
    g.textAlign = "right";
    g.fillText(String(Math.abs(p)), -gap - w - 8, y);
    g.textAlign = "left";
    g.fillText(String(Math.abs(p)), gap + w + 8, y);
  }
  g.restore();

  // ---- flight path marker (slightly below boresight with AoA) ----
  const aoa = 1.5 + Math.max(0, d.g - 1) * 0.9;
  const fy = cy + aoa * PPD;
  g.beginPath();
  g.arc(cx, fy, 11, 0, Math.PI * 2);
  g.moveTo(cx - 11, fy);
  g.lineTo(cx - 30, fy);
  g.moveTo(cx + 11, fy);
  g.lineTo(cx + 30, fy);
  g.moveTo(cx, fy - 11);
  g.lineTo(cx, fy - 22);
  g.stroke();
  // gun cross / boresight
  g.beginPath();
  g.moveTo(cx - 9, cy - 40);
  g.lineTo(cx + 9, cy - 40);
  g.moveTo(cx, cy - 49);
  g.lineTo(cx, cy - 31);
  g.stroke();

  // ---- heading tape ----
  g.save();
  g.beginPath();
  g.rect(130, 8, PX - 260, 60);
  g.clip();
  const hd = d.heading;
  for (let k = -30; k <= 30; k += 5) {
    const hh = Math.round(hd / 5) * 5 + k;
    const x = cx + (hh - hd) * 6;
    const major = ((hh % 10) + 10) % 10 === 0;
    g.beginPath();
    g.moveTo(x, 50);
    g.lineTo(x, major ? 38 : 44);
    g.stroke();
    if (major) {
      const lbl = String(((((hh / 10) % 36) + 36) % 36) | 0).padStart(2, "0");
      g.textAlign = "center";
      g.fillText(lbl, x, 22);
    }
  }
  g.restore();
  g.beginPath();
  g.moveTo(cx, 56);
  g.lineTo(cx - 7, 66);
  g.lineTo(cx + 7, 66);
  g.closePath();
  g.stroke();

  // ---- speed / altitude boxes ----
  g.textAlign = "center";
  g.strokeRect(22, cy - 18, 84, 36);
  g.fillText(String(Math.round(d.speed / 1.852)), 64, cy);
  g.strokeRect(PX - 112, cy - 18, 96, 36);
  g.fillText(String(Math.round(d.alt * 3.281)), PX - 64, cy);
  g.font = "bold 24px 'Menlo', 'Consolas', monospace";
  g.textAlign = "left";
  g.fillText("C", 24, cy - 34);
  g.fillText(`${d.g.toFixed(1)}`, 24, 92);
  g.fillText(`${d.mach.toFixed(2)}`, 24, PX - 96);
  g.fillText(d.ab ? "AB" : `${Math.round(d.throttle * 100)}%`, 24, PX - 70);
  g.textAlign = "right";
  g.fillText("R", PX - 22, cy - 34);
  g.fillText("ARM", PX - 22, PX - 96);
  g.fillText("SRM", PX - 22, PX - 70);

  // ---- next ring cue ----
  if (!Number.isNaN(d.cueX)) {
    let x = cx + d.cueX * PPD;
    let y = cy - d.cueY * PPD;
    const inside = x > 60 && x < PX - 60 && y > 80 && y < PX - 80;
    if (inside) {
      g.beginPath();
      g.moveTo(x, y - 14);
      g.lineTo(x + 14, y);
      g.lineTo(x, y + 14);
      g.lineTo(x - 14, y);
      g.closePath();
      g.stroke();
    } else {
      // arrow on the edge pointing to the ring
      const a = Math.atan2(y - cy, x - cx);
      x = cx + Math.cos(a) * 150;
      y = cy + Math.sin(a) * 150;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(14, 0);
      g.lineTo(-8, -9);
      g.lineTo(-8, 9);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}

/**
 * F-16 cockpit as seen from the pilot's eye: glareshield, HUD with
 * conformal symbology on the combiner glass, MFDs.
 * Rendered as a child of the jet group; only visible in cockpit mode.
 */
export default function Cockpit({ data, active }: { data: RefObject<HudData>; active: RefObject<{ cockpit: boolean }> }) {
  const group = useRef<THREE.Group>(null);
  const hud = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = PX;
    c.height = PX;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { c, g: c.getContext("2d")!, tex };
  }, []);
  const mats = useMemo(
    () => ({
      hud: new THREE.MeshBasicMaterial({
        map: hud.tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        color: new THREE.Color(1.7, 1.7, 1.7),
        fog: false,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: "#9fe0c0",
        transparent: true,
        opacity: 0.05,
        roughness: 0.05,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      coaming: new THREE.MeshStandardMaterial({ color: "#26292d", roughness: 0.92, metalness: 0 }),
      panel: new THREE.MeshStandardMaterial({ color: "#2b3036", roughness: 0.8, metalness: 0.1 }),
      frame: new THREE.MeshStandardMaterial({ color: "#1b1d20", roughness: 0.7, metalness: 0.2 }),
      mfdL: new THREE.MeshBasicMaterial({ map: mfdTexture("radar"), toneMapped: false, color: new THREE.Color(1.2, 1.2, 1.2) }),
      mfdR: new THREE.MeshBasicMaterial({ map: mfdTexture("sms"), toneMapped: false, color: new THREE.Color(1.2, 1.2, 1.2) }),
      key: new THREE.MeshStandardMaterial({ color: "#8a8f94", roughness: 0.5, metalness: 0.2, emissive: "#3dff8a", emissiveIntensity: 0.15 }),
    }),
    [hud]
  );
  const acc = useRef(1);
  const hudRef = useRef(hud);

  useFrame((_, dt) => {
    const visible = !!active.current?.cockpit;
    if (group.current) group.current.visible = visible;
    if (!visible || !data.current) return;
    acc.current += dt;
    if (acc.current < 1 / 30) return;
    acc.current = 0;
    drawHud(hudRef.current.g, data.current);
    hudRef.current.tex.needsUpdate = true;
  });

  const hz = zs(HUD_S);
  const hoodTop = 0.765;
  return (
    <group ref={group} visible={false}>
      {/* HUD symbology projected on the combiner */}
      <mesh position={[0, EYE.y, hz]} rotation={[0, Math.PI, 0]} material={mats.hud} renderOrder={20}>
        <planeGeometry args={[HUD_W, HUD_W]} />
      </mesh>
      {/* combiner glass, slightly reclined, with a thin frame */}
      <group position={[0, EYE.y - 0.03, hz - 0.015]} rotation={[0.12, 0, 0]}>
        <mesh rotation={[0, Math.PI, 0]} material={mats.glass} renderOrder={19}>
          <planeGeometry args={[HUD_W * 0.92, HUD_H * 0.85]} />
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={s} position={[s * HUD_W * 0.465, -HUD_H * 0.1, 0]} material={mats.frame}>
            <boxGeometry args={[0.006, HUD_H * 0.65, 0.01]} />
          </mesh>
        ))}
      </group>
      {/* HUD housing on top of the glareshield */}
      <RoundedBox args={[0.17, 0.05, 0.14]} radius={0.012} position={[0, hoodTop + 0.01, hz - 0.07]} material={mats.coaming} />
      {/* glareshield coaming */}
      <RoundedBox args={[0.84, 0.07, 0.36]} radius={0.03} position={[0, hoodTop - 0.035, zs(4.92)]} material={mats.coaming} />
      {/* instrument panel with MFDs + up-front controls */}
      <group position={[0, 0.6, zs(4.98)]} rotation={[0.25, 0, 0]}>
        <mesh material={mats.panel}>
          <boxGeometry args={[0.8, 0.3, 0.04]} />
        </mesh>
        <mesh position={[0.24, -0.01, -0.022]} rotation={[0, Math.PI, 0]} material={mats.mfdR}>
          <planeGeometry args={[0.16, 0.16]} />
        </mesh>
        <mesh position={[-0.24, -0.01, -0.022]} rotation={[0, Math.PI, 0]} material={mats.mfdL}>
          <planeGeometry args={[0.16, 0.16]} />
        </mesh>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[(i % 4) * 0.035 - 0.052, 0.07 - Math.floor(i / 4) * 0.035, -0.026]} material={mats.key}>
            <boxGeometry args={[0.024, 0.022, 0.012]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

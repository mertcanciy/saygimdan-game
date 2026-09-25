"use client";

// Street-drift event dressing: barrier lines closing off side streets,
// chevron boards on the outside of corners, checkpoint gates (the next one
// lights up), yellow route arrows on the asphalt and knock-over cones.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Track } from "./route";
import {
  buildBarriers,
  buildGates,
  chevronBoardTexture,
  coneGeometry,
  curtainTexture,
  gatePanelTexture,
  routeArrowTexture,
} from "./props";

export interface CarProbe {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
}

const _o = new THREE.Object3D();

interface ConeState {
  p: Float32Array;
  v: Float32Array;
  /** 0 upright … PI/2 lying */
  tilt: Float32Array;
  /** yaw of the fall direction */
  axis: Float32Array;
  spin: Float32Array;
  active: Uint8Array;
  moved: boolean;
  reset: number;
}

function makeConeState(n: number): ConeState {
  return {
    p: new Float32Array(n * 3),
    v: new Float32Array(n * 3),
    tilt: new Float32Array(n),
    axis: new Float32Array(n),
    spin: new Float32Array(n),
    active: new Uint8Array(n),
    moved: true,
    reset: -1,
  };
}
const _c = new THREE.Color();

export default function TrackProps({
  track,
  nextGate,
  car,
  resetCones,
}: {
  track: Track;
  /** index of the gate to drive through next */
  nextGate: React.RefObject<number>;
  car: React.RefObject<CarProbe>;
  /** bump to stand knocked cones back up */
  resetCones: React.RefObject<number>;
}) {
  /* ---------- static geometry ---------- */
  const barrier = useMemo(() => buildBarriers(track.barriers), [track]);
  const gates = useMemo(() => buildGates(track.gates), [track]);
  const mats = useMemo(() => {
    const chevron = chevronBoardTexture();
    const panel = gatePanelTexture();
    const curtain = curtainTexture();
    const arrow = routeArrowTexture();
    return {
      textures: [chevron, panel, curtain, arrow],
      red: new THREE.MeshStandardMaterial({ color: "#d42a1e", roughness: 0.55, emissive: "#ff2a1a", emissiveIntensity: 0.12 }),
      white: new THREE.MeshStandardMaterial({ color: "#eeeeea", roughness: 0.55, emissive: "#ffffff", emissiveIntensity: 0.06 }),
      lamp: new THREE.MeshBasicMaterial({ color: "#ffae00", toneMapped: false }),
      board: new THREE.MeshBasicMaterial({ map: chevron, color: "#d8d8d8" }),
      post: new THREE.MeshStandardMaterial({ color: "#3b3e42", roughness: 0.5, metalness: 0.6 }),
      truss: new THREE.MeshStandardMaterial({ color: "#2a2d33", roughness: 0.45, metalness: 0.75 }),
      led: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      panel: new THREE.MeshBasicMaterial({ map: panel, vertexColors: true, toneMapped: false, side: THREE.DoubleSide }),
      curtain: new THREE.MeshBasicMaterial({
        map: curtain,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
      arrow: new THREE.MeshBasicMaterial({
        map: arrow,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      cone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: "#ff5a14", emissiveIntensity: 0.18 }),
    };
  }, []);
  const arrowGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(2.6, 2.6);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  // glowing band on the asphalt under the next gate
  const curtainGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 3);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const coneGeo = useMemo(() => coneGeometry(), []);

  useEffect(
    () => () => {
      for (const g of Object.values(barrier)) g.dispose();
      gates.truss.dispose();
      gates.leds.dispose();
      gates.panels.dispose();
      arrowGeo.dispose();
      curtainGeo.dispose();
      coneGeo.dispose();
      for (const t of mats.textures) t.dispose();
      for (const m of Object.values(mats)) if (m instanceof THREE.Material) m.dispose();
    },
    [barrier, gates, mats, arrowGeo, curtainGeo, coneGeo]
  );

  /* ---------- route arrows (instanced, static) ---------- */
  const arrowRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const im = arrowRef.current;
    if (!im) return;
    track.arrows.forEach((a, i) => {
      _o.position.set(a.x, 0.06, a.z);
      _o.rotation.set(0, a.rotY + Math.PI, 0);
      _o.updateMatrix();
      im.setMatrixAt(i, _o.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [track]);

  /* ---------- cones: knocked by the car, tumble and slide ---------- */
  const coneRef = useRef<THREE.InstancedMesh>(null);
  const coneState = useRef<ConeState | null>(null);

  const curtainRef = useRef<THREE.Mesh>(null);
  const shown = useRef(-1);
  const blink = useRef(0);

  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 1 / 30);
    const t = clock.elapsedTime;

    // ---- gate highlight ----
    const ng = nextGate.current;
    const leds = gates.leds.getAttribute("color") as THREE.BufferAttribute;
    const pans = gates.panels.getAttribute("color") as THREE.BufferAttribute;
    if (ng !== shown.current) {
      const paint = (i: number, on: boolean) => {
        if (i < 0 || i >= track.gates.length) return;
        const [l0, l1] = gates.ledRanges[i];
        _c.setRGB(0.22, 0.24, 0.3);
        for (let v = l0; v < l1; v++) leds.setXYZ(v, _c.r, _c.g, _c.b);
        const [p0, p1] = gates.panelRanges[i];
        const k = on ? 0.95 : 0.4;
        for (let v = p0; v < p1; v++) pans.setXYZ(v, k, k, k);
      };
      paint(shown.current, false);
      paint(ng, true);
      shown.current = ng;
      pans.needsUpdate = true;
      leds.needsUpdate = true;
      const g = track.gates[ng];
      const cm = curtainRef.current;
      if (g && cm) {
        cm.position.set(g.x, 0.075, g.z);
        cm.rotation.set(0, Math.atan2(g.dx, g.dz), 0);
        cm.scale.set(g.half * 2 + 1.2, 1, 1);
      }
    }
    if (ng >= 0 && ng < track.gates.length) {
      // pulse the active gate's LEDs
      const k = 2.2 + Math.sin(t * 6) * 0.9;
      const [l0, l1] = gates.ledRanges[ng];
      for (let v = l0; v < l1; v++) leds.setXYZ(v, k, k * 0.83, 0);
      leds.needsUpdate = true;
    }

    // ---- barrier lamps blink ----
    blink.current += dt;
    const on = blink.current % 1 < 0.5;
    mats.lamp.color.set(on ? "#ffb000" : "#3a2200");

    // ---- cones ----
    const im = coneRef.current;
    const cp = car.current;
    if (!im || !cp) return;
    let cones = coneState.current;
    if (!cones || cones.p.length !== track.cones.length * 3) cones = coneState.current = makeConeState(track.cones.length);
    const P = cones.p;
    const V = cones.v;
    const n = track.cones.length;
    if (cones.reset !== resetCones.current) {
      cones.reset = resetCones.current;
      for (let i = 0; i < n; i++) {
        // leave the ones right next to the car where they are
        if (cones.active[i] && Math.hypot(P[i * 3] - cp.pos.x, P[i * 3 + 2] - cp.pos.z) < 30) continue;
        P[i * 3] = track.cones[i].x;
        P[i * 3 + 1] = 0;
        P[i * 3 + 2] = track.cones[i].z;
        V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
        cones.tilt[i] = 0;
        cones.active[i] = 0;
        cones.spin[i] = ((i * 2.399) % 6.283) - Math.PI;
      }
      cones.moved = true;
    }
    const sh = Math.sin(cp.heading);
    const ch = Math.cos(cp.heading);
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - cp.pos.x;
      const dz = P[i * 3 + 2] - cp.pos.z;
      if (dx * dx + dz * dz < 9 && P[i * 3 + 1] < 0.5) {
        // car-local coordinates: inside the body rectangle → knock it
        const lz = dx * sh + dz * ch;
        const lx = dx * ch - dz * sh;
        if (Math.abs(lx) < 1.15 && Math.abs(lz) < 2.35) {
          const sp = Math.hypot(cp.vel.x, cp.vel.z);
          if (sp > 1) {
            const inv = 1 / Math.max(0.3, Math.hypot(dx, dz));
            V[i * 3] = cp.vel.x * 1.1 + dx * inv * (2 + sp * 0.15);
            V[i * 3 + 2] = cp.vel.z * 1.1 + dz * inv * (2 + sp * 0.15);
            V[i * 3 + 1] = 1.5 + Math.min(5, sp * 0.18);
            cones.axis[i] = Math.atan2(V[i * 3], V[i * 3 + 2]);
            cones.spin[i] = (Math.random() - 0.5) * 12;
            cones.active[i] = 1;
            // push it outside the body so it isn't hit every frame
            P[i * 3] += cp.vel.x * dt * 1.5;
            P[i * 3 + 2] += cp.vel.z * dt * 1.5;
          }
        }
      }
      if (!cones.active[i]) continue;
      const vx = V[i * 3];
      const vz = V[i * 3 + 2];
      V[i * 3 + 1] -= 18 * dt;
      P[i * 3] += vx * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += vz * dt;
      cones.tilt[i] = Math.min(Math.PI / 2, cones.tilt[i] + dt * 7);
      if (P[i * 3 + 1] <= 0) {
        P[i * 3 + 1] = 0;
        V[i * 3 + 1] = Math.abs(V[i * 3 + 1]) > 2 ? -V[i * 3 + 1] * 0.3 : 0;
        const f = Math.exp(-3.5 * dt);
        V[i * 3] *= f;
        V[i * 3 + 2] *= f;
        cones.spin[i] *= f;
        if (Math.hypot(V[i * 3], V[i * 3 + 2]) < 0.05 && V[i * 3 + 1] === 0) cones.active[i] = 0;
      }
      cones.axis[i] += cones.spin[i] * dt;
      cones.moved = true;
    }
    if (cones.moved) {
      cones.moved = false;
      for (let i = 0; i < n; i++) {
        const tl = cones.tilt[i];
        _o.position.set(P[i * 3], P[i * 3 + 1] + Math.sin(tl) * 0.16, P[i * 3 + 2]);
        // yaw towards the fall direction, then tip over around the local x axis
        _o.rotation.set(tl, cones.axis[i], 0, "YXZ");
        _o.updateMatrix();
        im.setMatrixAt(i, _o.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <mesh geometry={barrier.red} material={mats.red} receiveShadow />
      <mesh geometry={barrier.white} material={mats.white} receiveShadow />
      <mesh geometry={barrier.lamps} material={mats.lamp} />
      <mesh geometry={barrier.boards} material={mats.board} />
      <mesh geometry={barrier.posts} material={mats.post} />

      <mesh geometry={gates.truss} material={mats.truss} />
      <mesh geometry={gates.leds} material={mats.led} />
      <mesh geometry={gates.panels} material={mats.panel} />
      <mesh ref={curtainRef} geometry={curtainGeo} material={mats.curtain} renderOrder={4} />

      <instancedMesh
        ref={arrowRef}
        args={[arrowGeo, mats.arrow, Math.max(1, track.arrows.length)]}
        renderOrder={1}
      />
      <instancedMesh ref={coneRef} args={[coneGeo, mats.cone, Math.max(1, track.cones.length)]} frustumCulled={false} />
    </group>
  );
}

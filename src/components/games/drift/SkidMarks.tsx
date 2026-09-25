"use client";

// Tyre marks: a ring buffer of quads with per-vertex alpha, laid on top of
// every ground layer (road paint 0.02, plaza paint 0.05, route arrows 0.06).

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

const SKID_N = 5000;
const SKID_Y = 0.07;

export interface SkidEmit {
  active: boolean;
  pts: THREE.Vector3[];
  strength: number;
}

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();

function makeSkidGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 4), 4));
  const idx = new Uint32Array(SKID_N * 6);
  for (let i = 0; i < SKID_N; i++) {
    const o = i * 4;
    const io = i * 6;
    idx[io] = o;
    idx[io + 1] = o + 2;
    idx[io + 2] = o + 1;
    idx[io + 3] = o;
    idx[io + 4] = o + 3;
    idx[io + 5] = o + 2;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export default function SkidMarks({ emitRef }: { emitRef: React.RefObject<SkidEmit> }) {
  const geo = useMemo(() => makeSkidGeo(), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
      }),
    []
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat]
  );
  const st = useRef({ cursor: 0, last: [new THREE.Vector3(), new THREE.Vector3()], lastA: [0, 0], has: false });

  useFrame(() => {
    const e = emitRef.current;
    const s = st.current;
    if (!e.active) {
      s.has = false;
      return;
    }
    if (!s.has) {
      s.last[0].copy(e.pts[0]);
      s.last[1].copy(e.pts[1]);
      s.lastA[0] = s.lastA[1] = 0;
      s.has = true;
      return;
    }
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;
    const a = posAttr.array as Float32Array;
    const c = colAttr.array as Float32Array;
    let wrote = false;
    for (let k = 0; k < 2; k++) {
      const prev = s.last[k];
      const cur = e.pts[k];
      _d.copy(cur).sub(prev);
      if (_d.lengthSq() < 0.09) continue; // a quad every ~30 cm
      const i = s.cursor % SKID_N;
      const o = i * 12;
      _r.set(-_d.z, 0, _d.x).normalize().multiplyScalar(0.13);
      a[o] = prev.x - _r.x; a[o + 1] = SKID_Y; a[o + 2] = prev.z - _r.z;
      a[o + 3] = cur.x - _r.x; a[o + 4] = SKID_Y; a[o + 5] = cur.z - _r.z;
      a[o + 6] = cur.x + _r.x; a[o + 7] = SKID_Y; a[o + 8] = cur.z + _r.z;
      a[o + 9] = prev.x + _r.x; a[o + 10] = SKID_Y; a[o + 11] = prev.z + _r.z;
      const a0 = s.lastA[k];
      const a1 = e.strength;
      const co = i * 16;
      for (let v = 0; v < 4; v++) {
        c[co + v * 4] = 0.035;
        c[co + v * 4 + 1] = 0.034;
        c[co + v * 4 + 2] = 0.036;
        c[co + v * 4 + 3] = v === 0 || v === 3 ? a0 : a1;
      }
      posAttr.addUpdateRange(o, 12);
      colAttr.addUpdateRange(co, 16);
      s.cursor++;
      prev.copy(cur);
      s.lastA[k] = a1;
      wrote = true;
    }
    if (wrote) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geo.setDrawRange(0, Math.min(s.cursor, SKID_N) * 6);
    }
  });

  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

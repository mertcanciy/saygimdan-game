"use client";

// The paddock: paved square with painted markings (start / finish, route lane,
// parking stalls) and four flood-light masts. Layers are separated by ≥ 2.5 cm
// (asphalt 0 → pavers 0.025 → paint 0.05) so nothing z-fights, and the masts
// are merged into three draw calls; their light is faked with emissive lamp
// faces + additive glow pools on the ground instead of real spot lights.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeGlowTexture } from "../shared/City";
import { pavingTexture } from "../shared/streetAssets";
import { makePlazaMarkings, SQ_X, SQ_Z } from "../cars/plaza";

export const MASTS: [number, number][] = [
  [SQ_X + 0.6, SQ_Z + 0.6],
  [-SQ_X - 0.6, SQ_Z + 0.6],
  [SQ_X + 0.6, -SQ_Z - 0.6],
  [-SQ_X - 0.6, -SQ_Z - 0.6],
];
export const MAST_H = 17;

function strip(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  return n;
}

function buildMasts() {
  const metal: THREE.BufferGeometry[] = [];
  const concrete: THREE.BufferGeometry[] = [];
  const faces: THREE.BufferGeometry[] = [];
  const glows: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, parent: THREE.Matrix4) => {
    o.updateMatrix();
    const m = new THREE.Matrix4().multiplyMatrices(parent, o.matrix);
    list.push(g.applyMatrix4(m));
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
  };
  for (const [x, z] of MASTS) {
    const ang = Math.atan2(-x, -z);
    const base = new THREE.Matrix4().makeTranslation(x, 0, z);
    o.position.set(0, 0.4, 0);
    put(concrete, strip(new THREE.CylinderGeometry(0.45, 0.5, 0.8, 12)), base);
    o.position.set(0, MAST_H / 2, 0);
    put(metal, strip(new THREE.CylinderGeometry(0.12, 0.24, MAST_H, 10)), base);
    const head = new THREE.Matrix4().makeTranslation(x, MAST_H, z).multiply(new THREE.Matrix4().makeRotationY(ang));
    put(metal, strip(new THREE.BoxGeometry(3.4, 0.14, 0.14)), head);
    for (const lx of [-1.25, -0.42, 0.42, 1.25]) {
      const lamp = head
        .clone()
        .multiply(new THREE.Matrix4().makeTranslation(lx, -0.2, 0.25))
        .multiply(new THREE.Matrix4().makeRotationX(0.55));
      put(metal, strip(new THREE.BoxGeometry(0.7, 0.14, 0.5)), lamp);
      o.position.set(0, -0.075, 0);
      o.rotation.set(Math.PI / 2, 0, 0);
      put(faces, strip(new THREE.PlaneGeometry(0.6, 0.42)), lamp);
    }
    const gp = new THREE.PlaneGeometry(46, 46);
    gp.rotateX(-Math.PI / 2);
    gp.translate(x * 0.75, 0.085, z * 0.75);
    glows.push(gp);
  }
  const m = (l: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(l, false)!;
    for (const x of l) x.dispose();
    return g;
  };
  return { metal: m(metal), concrete: m(concrete), faces: m(faces), glows: m(glows) };
}

export default function Plaza({ half }: { half: number }) {
  const res = useMemo(() => {
    const markTex = makePlazaMarkings(half);
    const pave = pavingTexture().clone();
    pave.repeat.set(SQ_X, SQ_Z);
    pave.needsUpdate = true;
    const glow = makeGlowTexture("rgba(255,236,205,0.95)");
    const masts = buildMasts();
    return {
      masts,
      textures: [markTex, pave, glow],
      paveGeo: new THREE.PlaneGeometry(SQ_X * 2, SQ_Z * 2),
      markGeo: new THREE.PlaneGeometry(half * 2, half * 2),
      paveMat: new THREE.MeshStandardMaterial({ map: pave, color: "#9c9a95", roughness: 0.82 }),
      markMat: new THREE.MeshStandardMaterial({
        map: markTex,
        transparent: true,
        depthWrite: false,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      metalMat: new THREE.MeshStandardMaterial({ color: "#4b4f55", metalness: 0.7, roughness: 0.45 }),
      concreteMat: new THREE.MeshStandardMaterial({ color: "#8d8b86", roughness: 0.9 }),
      faceMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.7, 5.2), side: THREE.DoubleSide, toneMapped: false }),
      glowMat: new THREE.MeshBasicMaterial({
        map: glow,
        color: "#ffe2b8",
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    };
  }, [half]);

  useEffect(
    () => () => {
      for (const g of Object.values(res.masts)) g.dispose();
      res.paveGeo.dispose();
      res.markGeo.dispose();
      for (const t of res.textures) t.dispose();
      for (const m of [res.paveMat, res.markMat, res.metalMat, res.concreteMat, res.faceMat, res.glowMat]) m.dispose();
    },
    [res]
  );

  return (
    <group>
      <mesh geometry={res.paveGeo} material={res.paveMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow />
      <mesh geometry={res.markGeo} material={res.markMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={1} />
      <mesh geometry={res.masts.metal} material={res.metalMat} />
      <mesh geometry={res.masts.concrete} material={res.concreteMat} />
      <mesh geometry={res.masts.faces} material={res.faceMat} />
      <mesh geometry={res.masts.glows} material={res.glowMat} renderOrder={2} />
    </group>
  );
}

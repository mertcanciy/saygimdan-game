"use client";

import { useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

export interface RingData {
  x: number;
  y: number;
  z: number;
  /** rotation around Y (ring plane normal direction) */
  rotY: number;
  /** if true, ring lies flat (horizontal) */
  flat?: boolean;
  collected: boolean;
}

const _obj = new THREE.Object3D();
const _col = new THREE.Color();

/**
 * Instanced glowing collectible rings. Game logic owns the ring array in a
 * ref and flips `collected`; rings pop and shrink away, uncollected rings pulse.
 */
export default function Rings({
  rings,
  count,
  radius = 4,
  tube = 0.35,
  color = "#38bdf8",
  pulse = true,
}: {
  rings: RefObject<RingData[]>;
  count: number;
  radius?: number;
  tube?: number;
  color?: string;
  pulse?: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const inner = useRef<THREE.InstancedMesh>(null);
  const pop = useRef<Float32Array | null>(null);
  const colored = useRef(false);

  useFrame((_, dt) => {
    const im = mesh.current;
    const inn = inner.current;
    if (!im || !inn) return;
    if (!pop.current || pop.current.length !== count) pop.current = new Float32Array(count);
    if (!colored.current) {
      _col.set(color).multiplyScalar(2.2);
      for (let i = 0; i < count; i++) im.setColorAt(i, _col);
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      colored.current = true;
    }
    const list = rings.current;
    const t = pop.current;
    const now = performance.now() * 0.001;
    for (let i = 0; i < count; i++) {
      const r = list[i];
      let s = r ? 1 : 0;
      if (r && r.collected) {
        t[i] += dt;
        s = Math.max(0, 1 + t[i] * 2.5 - t[i] * t[i] * 6);
        if (t[i] > 0.8) s = 0;
      } else if (r) {
        t[i] = 0;
        if (pulse) s = 1 + Math.sin(now * 3 + i) * 0.06;
      }
      if (!r) {
        _obj.position.set(0, -100, 0);
        _obj.scale.setScalar(0.001);
        _obj.updateMatrix();
        im.setMatrixAt(i, _obj.matrix);
        inn.setMatrixAt(i, _obj.matrix);
        continue;
      }
      _obj.position.set(r.x, r.y, r.z);
      _obj.rotation.set(r.flat ? Math.PI / 2 : 0, r.rotY, 0);
      _obj.scale.setScalar(s * radius);
      _obj.updateMatrix();
      im.setMatrixAt(i, _obj.matrix);
      _obj.scale.setScalar(s * radius * 0.92);
      _obj.updateMatrix();
      inn.setMatrixAt(i, _obj.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    inn.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, count)]} frustumCulled={false}>
        <torusGeometry args={[1, tube / radius, 10, 36]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      {/* soft inner disc */}
      <instancedMesh ref={inner} args={[undefined, undefined, Math.max(1, count)]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

/** Distance test: is point within `radius` of the ring plane center (disc test)? */
export function ringHit(r: RingData, x: number, y: number, z: number, radius: number, thickness = 3): boolean {
  const dx = x - r.x;
  const dy = y - r.y;
  const dz = z - r.z;
  if (r.flat) {
    return Math.abs(dy) < thickness && dx * dx + dz * dz < radius * radius;
  }
  // ring normal = (sin rotY, 0, cos rotY)
  const nx = Math.sin(r.rotY);
  const nz = Math.cos(r.rotY);
  const along = dx * nx + dz * nz;
  if (Math.abs(along) > thickness) return false;
  const px = dx - along * nx;
  const pz = dz - along * nz;
  return px * px + dy * dy + pz * pz < radius * radius;
}

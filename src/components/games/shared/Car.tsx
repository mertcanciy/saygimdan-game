"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import * as THREE from "three";

export interface CarHandle {
  group: THREE.Group | null;
  /** Steerable front wheel groups (rotate around Y for steering). */
  frontAxle: (THREE.Group | null)[];
  /** All wheel meshes (rotate around X for rolling). */
  wheels: (THREE.Mesh | null)[];
  /** Taillight material — boost emissiveIntensity while braking. */
  tailMat: THREE.MeshStandardMaterial | null;
}

/** Low-poly night-city car built from primitives. Faces +Z. */
const Car = forwardRef<CarHandle, { color?: string; glow?: string }>(
  function Car({ color = "#d81b60", glow = "#a855f7" }, ref) {
    const group = useRef<THREE.Group>(null);
    const fl = useRef<THREE.Group>(null);
    const fr = useRef<THREE.Group>(null);
    const wFL = useRef<THREE.Mesh>(null);
    const wFR = useRef<THREE.Mesh>(null);
    const wRL = useRef<THREE.Mesh>(null);
    const wRR = useRef<THREE.Mesh>(null);
    const tail = useRef<THREE.MeshStandardMaterial>(null);

    useImperativeHandle(ref, () => ({
      group: group.current,
      frontAxle: [fl.current, fr.current],
      wheels: [wFL.current, wFR.current, wRL.current, wRR.current],
      tailMat: tail.current,
    }));

    return (
      <group ref={group}>
        {/* body */}
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[1.9, 0.6, 4.4]} />
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.4} />
        </mesh>
        {/* cabin */}
        <mesh position={[0, 1.05, -0.3]}>
          <boxGeometry args={[1.6, 0.5, 2.2]} />
          <meshStandardMaterial color="#0c0e18" roughness={0.2} metalness={0.6} />
        </mesh>
        {/* headlights */}
        {[-0.6, 0.6].map((x) => (
          <mesh key={`hl${x}`} position={[x, 0.55, 2.21]}>
            <boxGeometry args={[0.35, 0.18, 0.05]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#e8f4ff"
              emissiveIntensity={4}
            />
          </mesh>
        ))}
        {/* fake headlight cones */}
        {[-0.6, 0.6].map((x) => (
          <mesh
            key={`hc${x}`}
            position={[x, 0.1, 6]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[1.2, 8]} />
            <meshBasicMaterial
              color="#9fdcff"
              transparent
              opacity={0.06}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
        {/* taillights */}
        <mesh position={[0, 0.6, -2.21]}>
          <boxGeometry args={[1.7, 0.15, 0.05]} />
          <meshStandardMaterial
            ref={tail}
            color="#ff2020"
            emissive="#ff2020"
            emissiveIntensity={1.5}
          />
        </mesh>
        {/* neon underglow */}
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.6, 5.2]} />
          <meshBasicMaterial
            color={glow}
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* wheels */}
        {[
          { axle: fl, wheel: wFL, x: -0.95, z: 1.45 },
          { axle: fr, wheel: wFR, x: 0.95, z: 1.45 },
          { axle: null, wheel: wRL, x: -0.95, z: -1.45 },
          { axle: null, wheel: wRR, x: 0.95, z: -1.45 },
        ].map((w, i) => {
          const wheelMesh = (
            <mesh ref={w.wheel} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.33, 0.33, 0.28, 12]} />
              <meshStandardMaterial color="#0a0a0e" roughness={0.9} />
            </mesh>
          );
          return w.axle ? (
            <group key={i} ref={w.axle} position={[w.x, 0.33, w.z]}>
              {wheelMesh}
            </group>
          ) : (
            <group key={i} position={[w.x, 0.33, w.z]}>
              {wheelMesh}
            </group>
          );
        })}
      </group>
    );
  }
);

export default Car;

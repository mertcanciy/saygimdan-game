"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildCar, mirrorX, wheelGeometries, SLOTS, type CarType, type Slot } from "../cars/carGeometry";
import { beamTexture, carMaterials, makePaint } from "../cars/carMaterials";
import { makeGlowTexture } from "./City";

export interface CarHandle {
  group: THREE.Group | null;
  /** Steerable front wheel groups (rotate around Y for steering). */
  frontAxle: (THREE.Group | null)[];
  /** Spinning wheel objects, order FL, FR, RL, RR (rotate around X for rolling). */
  wheels: (THREE.Object3D | null)[];
  /** Taillight material — boost emissiveIntensity while braking. */
  tailMat: THREE.MeshStandardMaterial | null;
  /** Body group (for roll / pitch without moving wheels). Pivot at 0.5 m. */
  body: THREE.Group | null;
}

const BODY_PIVOT = 0.5;

let discMat: THREE.MeshStandardMaterial | null = null;
let caliperMat: THREE.MeshStandardMaterial | null = null;
function brakeMats() {
  discMat ??= new THREE.MeshStandardMaterial({ color: "#77797d", metalness: 0.85, roughness: 0.42 });
  caliperMat ??= new THREE.MeshStandardMaterial({ color: "#c81d25", metalness: 0.3, roughness: 0.4 });
  return { discMat, caliperMat };
}

/**
 * Detailed procedural car (hero / player car). Faces +Z, ground at y = 0.
 * Body from extruded + deformed side profiles, clearcoat paint, tinted glass,
 * multi-spoke rims with brake discs, emissive head / tail lights.
 */
const Car = forwardRef<
  CarHandle,
  {
    color?: string;
    glow?: string;
    /** real spot light + beam on the road */
    headlights?: boolean;
    underglow?: boolean;
    type?: CarType;
    castShadow?: boolean;
  }
>(function Car(
  { color = "#d81b60", glow = "#a855f7", headlights = true, underglow = true, type = "sport", castShadow = true },
  ref
) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const fl = useRef<THREE.Group>(null);
  const fr = useRef<THREE.Group>(null);
  const wFL = useRef<THREE.Group>(null);
  const wFR = useRef<THREE.Group>(null);
  const wRL = useRef<THREE.Group>(null);
  const wRR = useRef<THREE.Group>(null);

  const geo = useMemo(() => buildCar(type, 1), [type]);
  const mats = carMaterials();
  const paint = useMemo(() => makePaint(color), [color]);
  const tail = useMemo(() => (mats.tail as THREE.MeshStandardMaterial).clone(), [mats]);
  const wheel = useMemo(() => {
    const w = wheelGeometries(geo.spec.R, geo.spec.tireW, 1, type === "sport" ? 10 : 6);
    return {
      right: w,
      left: {
        tire: mirrorX(w.tire),
        rim: mirrorX(w.rim),
        barrel: mirrorX(w.barrel),
        disc: mirrorX(w.disc),
        caliper: mirrorX(w.caliper),
      },
    };
  }, [geo, type]);
  const { discMat: dMat, caliperMat: cMat } = brakeMats();
  const spotTarget = useMemo(() => new THREE.Object3D(), []);
  const beamTex = useMemo(() => (headlights ? beamTexture() : null), [headlights]);
  const glowTex = useMemo(() => (underglow ? makeGlowTexture() : null), [underglow]);

  useImperativeHandle(ref, () => ({
    group: group.current,
    body: body.current,
    frontAxle: [fl.current, fr.current],
    wheels: [wFL.current, wFR.current, wRL.current, wRR.current],
    tailMat: tail,
  }));

  const matFor = (slot: Slot): THREE.Material => (slot === "paint" ? paint : slot === "tail" ? tail : mats[slot]);
  const spec = geo.spec;
  const frontZ = spec.L / 2;

  // wheel order: FL, FR, RL, RR
  const wheelDefs = [
    { x: -spec.track, z: spec.axles[0], axle: fl, spin: wFL, left: true },
    { x: spec.track, z: spec.axles[0], axle: fr, spin: wFR, left: false },
    { x: -spec.track, z: spec.axles[1], axle: null, spin: wRL, left: true },
    { x: spec.track, z: spec.axles[1], axle: null, spin: wRR, left: false },
  ];

  return (
    <group ref={group}>
      <group ref={body} position={[0, BODY_PIVOT, 0]}>
        <group position={[0, -BODY_PIVOT, 0]}>
          {SLOTS.map((slot) =>
            geo.body[slot] ? (
              <mesh
                key={slot}
                geometry={geo.body[slot]}
                material={matFor(slot)}
                castShadow={castShadow && (slot === "paint" || slot === "trim")}
                receiveShadow={slot === "paint"}
              />
            ) : null
          )}
          {headlights && (
            <>
              <spotLight
                position={[0, 0.65, frontZ - 0.1]}
                target={spotTarget}
                color="#e6eeff"
                intensity={260}
                distance={75}
                angle={0.52}
                penumbra={0.75}
                decay={1.4}
              />
              <primitive object={spotTarget} position={[0, 0, frontZ + 22]} />
              {/* soft beam glow on the road just ahead */}
              <mesh position={[0, 0.03, frontZ + 7.5]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[7, 14]} />
                <meshBasicMaterial
                  map={beamTex}
                  color="#bcd2ff"
                  transparent
                  opacity={0.16}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
            </>
          )}
          {underglow && (
            <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[3.6, 6.4]} />
              <meshBasicMaterial
                map={glowTex}
                color={glow}
                transparent
                opacity={0.5}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          )}
          {underglow && <pointLight position={[0, 0.25, 0]} color={glow} intensity={6} distance={6} decay={1.6} />}
        </group>
      </group>

      {wheelDefs.map((w, i) => {
        const g = w.left ? wheel.left : wheel.right;
        const spin = (
          <group ref={w.spin}>
            <mesh geometry={g.tire} material={mats.rubber} castShadow={castShadow} />
            <mesh geometry={g.rim} material={mats.rim} />
            <mesh geometry={g.barrel} material={mats.trim} />
            <mesh geometry={g.disc} material={dMat} />
          </group>
        );
        return (
          <group key={i} ref={w.axle ?? undefined} position={[w.x, spec.R, w.z]}>
            {spin}
            <mesh geometry={g.caliper} material={cMat} />
          </group>
        );
      })}
    </group>
  );
});

export default Car;

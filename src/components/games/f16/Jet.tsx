"use client";

import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  buildJetGeometries,
  zs,
  FLAPERON,
  STAB,
  RUDDER,
  WING_Y,
  NOZZLE,
} from "./jetGeometry";
import { fuselagePanelTexture, wingPanelTexture, roundelTexture, flagTexture, glowTexture } from "./textures";
import { makeFlameGeometry, makeFlameMaterial } from "./flame";

/** Written by the game every frame; read by the jet to animate itself. */
export interface JetControls {
  roll: number; // -1..1 (right +)
  pitch: number; // -1..1 (nose up +)
  yaw: number; // -1..1 (right +)
  throttle: number; // 0..1
  ab: number; // 0..1 afterburner (smoothed)
  cockpit: boolean;
}

export function makeJetControls(): JetControls {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0.6, ab: 0, cockpit: false };
}

function useJetMaterials() {
  return useMemo(() => {
    const fus = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: fuselagePanelTexture(),
      roughness: 0.58,
      metalness: 0.28,
      envMapIntensity: 0.9,
    });
    const flat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: wingPanelTexture(),
      roughness: 0.6,
      metalness: 0.26,
      envMapIntensity: 0.9,
    });
    const canopy = new THREE.MeshPhysicalMaterial({
      color: "#7a6a42",
      metalness: 0.65,
      roughness: 0.05,
      transparent: true,
      opacity: 0.78,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.2,
      iridescence: 0.35,
      iridescenceIOR: 1.6,
    });
    const canopyInside = new THREE.MeshBasicMaterial({
      color: "#fff3cf",
      transparent: true,
      opacity: 0.05,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const dark = new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.55, metalness: 0.4 });
    const tub = new THREE.MeshStandardMaterial({ color: "#16181b", roughness: 0.9, metalness: 0 });
    const mouth = new THREE.MeshStandardMaterial({ color: "#050506", roughness: 1, metalness: 0 });
    const nozzle = new THREE.MeshStandardMaterial({ color: "#7b746b", roughness: 0.38, metalness: 0.92, envMapIntensity: 1.2 });
    const nozzleIn = new THREE.MeshStandardMaterial({ color: "#1b1917", roughness: 0.7, metalness: 0.6, side: THREE.BackSide });
    const white = new THREE.MeshStandardMaterial({ color: "#e4e4df", roughness: 0.45, metalness: 0.1 });
    const mgrey = new THREE.MeshStandardMaterial({ color: "#8f9599", roughness: 0.5, metalness: 0.3 });
    const seeker = new THREE.MeshStandardMaterial({ color: "#1c2a33", roughness: 0.05, metalness: 0.9 });
    const helmet = new THREE.MeshStandardMaterial({ color: "#d8d5cb", roughness: 0.45, metalness: 0.05 });
    const visor = new THREE.MeshStandardMaterial({ color: "#8a6a20", roughness: 0.08, metalness: 1 });
    const decal = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.4,
        roughness: 0.6,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
    const roundel = decal(roundelTexture());
    const flag = decal(flagTexture());
    const glowTex = glowTexture();
    const glow = (c: string) =>
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(c).multiplyScalar(3),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
      });
    const bulb = (c: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(6), toneMapped: false });
    const nozzleGlow = new THREE.MeshBasicMaterial({ color: "#ff7a2a", toneMapped: false });
    return {
      fus,
      flat,
      canopy,
      canopyInside,
      dark,
      tub,
      mouth,
      nozzle,
      nozzleIn,
      white,
      mgrey,
      seeker,
      helmet,
      visor,
      roundel,
      flag,
      glowRed: glow("#ff2a1a"),
      glowGreen: glow("#20ff60"),
      glowWhite: glow("#ffffff"),
      abGlow: new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(4, 1.9, 0.6),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
      }),
      bulbRed: bulb("#ff2a1a"),
      bulbGreen: bulb("#20ff60"),
      bulbWhite: bulb("#ffffff"),
      nozzleGlow,
      flameCore: makeFlameMaterial("#cfdcff", "#ff9a48", 0, 1.3),
      flameMid: makeFlameMaterial("#ffc060", "#ff5a12", 5.5, 1.5),
      flameOuter: makeFlameMaterial("#ff8a30", "#c8300a", 0, 2.4),
    };
  }, []);
}

const NOZ_DRY = new THREE.Color("#ff4a12");
const NOZ_AB = new THREE.Color("#ffc27a");

/**
 * Procedural F-16. Local +Z = nose. `controls` drives control surfaces,
 * afterburner and cockpit visibility.
 */
export default function Jet({
  group,
  controls,
}: {
  group?: RefObject<THREE.Group | null>;
  controls: RefObject<JetControls>;
}) {
  const geo = useMemo(() => buildJetGeometries(), []);
  const m = useJetMaterials();
  const mRef = useRef(m);
  const flameGeo = useMemo(
    () => ({
      core: makeFlameGeometry(0.3, 0.05),
      mid: makeFlameGeometry(0.4, 0.12),
      outer: makeFlameGeometry(0.46, 0.2),
    }),
    []
  );
  const nozzleDisc = useMemo(() => new THREE.CircleGeometry(NOZZLE.r1 - 0.03, 24), []);
  const decalPlane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const bulbGeo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 6), []);

  const flapL = useRef<THREE.Group>(null);
  const flapR = useRef<THREE.Group>(null);
  const stabL = useRef<THREE.Group>(null);
  const stabR = useRef<THREE.Group>(null);
  const rudder = useRef<THREE.Group>(null);
  const flames = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const mid = useRef<THREE.Mesh>(null);
  const outer = useRef<THREE.Mesh>(null);
  const strobe = useRef<THREE.Sprite>(null);
  const abGlow = useRef<THREE.Sprite>(null);
  const pilot = useRef<THREE.Group>(null);
  const canopyRef = useRef<THREE.Mesh>(null);
  const tubRef = useRef<THREE.Mesh>(null);
  const sm = useRef({ roll: 0, pitch: 0, yaw: 0 });

  useFrame(({ clock }, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const m = mRef.current;
    const dt = Math.min(rawDt, 1 / 20);
    const t = clock.elapsedTime;
    const s = sm.current;
    // actuators have finite rate
    const k = Math.min(1, dt * 14);
    s.roll += (c.roll - s.roll) * k;
    s.pitch += (c.pitch - s.pitch) * k;
    s.yaw += (c.yaw - s.yaw) * k;
    // flaperons: roll right -> port (x+) TE down, starboard TE up
    if (flapL.current) flapL.current.rotation.x = -s.roll * 0.32 - 0.04;
    if (flapR.current) flapR.current.rotation.x = s.roll * 0.32 - 0.04;
    // all-moving stabs: pitch + differential roll
    if (stabL.current) stabL.current.rotation.x = s.pitch * 0.3 - s.roll * 0.14;
    if (stabR.current) stabR.current.rotation.x = s.pitch * 0.3 + s.roll * 0.14;
    if (rudder.current) rudder.current.rotation.y = s.yaw * 0.4;

    // afterburner plume
    const ab = c.ab;
    const dry = c.throttle;
    const fl = 0.9 + Math.random() * 0.2;
    m.flameCore.uniforms.uTime.value = t;
    m.flameMid.uniforms.uTime.value = t;
    m.flameOuter.uniforms.uTime.value = t;
    m.flameCore.uniforms.uPower.value = 0.1 + dry * 0.25 + ab * 0.5;
    m.flameMid.uniforms.uPower.value = ab * 1.9;
    m.flameOuter.uniforms.uPower.value = 0.03 + dry * 0.06 + ab * 0.7;
    if (core.current) core.current.scale.set(1, 1, (0.6 + dry * 0.5 + ab * 1.3) * fl);
    if (mid.current) mid.current.scale.set(1, 1, (0.5 + ab * 5.2) * fl);
    if (outer.current) outer.current.scale.set(1 + ab * 0.2, 1 + ab * 0.2, (1.0 + dry * 0.8 + ab * 6.0) * fl);
    if (flames.current) flames.current.visible = ab > 0.01 || dry > 0.05;
    // nozzle interior glow: dull red at mil power, white-hot with AB
    m.nozzleGlow.color.copy(NOZ_DRY).lerp(NOZ_AB, ab).multiplyScalar(0.05 + dry * 0.16 + ab * 4 * fl);
    if (abGlow.current) {
      abGlow.current.visible = ab > 0.02;
      abGlow.current.scale.setScalar((1.0 + ab * 1.7) * fl);
      m.abGlow.opacity = ab * 0.75;
    }

    // anti-collision strobe on the fin
    if (strobe.current) {
      const ph = t % 1.3;
      const on = ph < 0.06 || (ph > 0.16 && ph < 0.21);
      strobe.current.visible = on;
    }
    if (pilot.current) pilot.current.visible = !c.cockpit;
    if (canopyRef.current) canopyRef.current.visible = !c.cockpit;
    if (tubRef.current) tubRef.current.visible = !c.cockpit;
  });

  const shadow = { castShadow: true, receiveShadow: true };
  const railFrontZ = zs(9.9);

  return (
    <group ref={group}>
      {/* airframe */}
      <mesh geometry={geo.paintLoft} material={m.fus} {...shadow} />
      <mesh geometry={geo.paintFlat} material={m.flat} {...shadow} />
      <mesh geometry={geo.dark} material={m.dark} castShadow />
      <mesh geometry={geo.intakeMouth} material={m.mouth} />
      <mesh geometry={geo.canopyFrame} material={m.dark} castShadow />
      <mesh ref={tubRef} geometry={geo.cockpitTub} material={m.tub} />
      <mesh ref={canopyRef} geometry={geo.canopy} material={m.canopy} renderOrder={2} />
      <mesh geometry={geo.canopyInner} material={m.canopyInside} renderOrder={3} />
      <group ref={pilot}>
        <mesh geometry={geo.helmet} material={m.helmet} castShadow />
        <mesh geometry={geo.visor} material={m.visor} />
      </group>

      {/* moving surfaces */}
      <group ref={flapL} position={[0, WING_Y, zs(FLAPERON.s0)]}>
        <mesh geometry={geo.flaperon} material={m.flat} {...shadow} />
      </group>
      <group scale={[-1, 1, 1]}>
        <group ref={flapR} position={[0, WING_Y, zs(FLAPERON.s0)]}>
          <mesh geometry={geo.flaperon} material={m.flat} {...shadow} />
        </group>
      </group>
      <group position={[STAB.x, STAB.y, zs(STAB.s)]} rotation={[0, 0, -STAB.anhedral]}>
        <group ref={stabL}>
          <mesh geometry={geo.stab} material={m.flat} {...shadow} />
        </group>
      </group>
      <group scale={[-1, 1, 1]}>
        <group position={[STAB.x, STAB.y, zs(STAB.s)]} rotation={[0, 0, -STAB.anhedral]}>
          <group ref={stabR}>
            <mesh geometry={geo.stab} material={m.flat} {...shadow} />
          </group>
        </group>
      </group>
      <group ref={rudder} position={[0, 0, zs(RUDDER.s)]}>
        <mesh geometry={geo.rudder} material={m.flat} {...shadow} />
      </group>

      {/* engine */}
      <mesh geometry={geo.nozzle} material={m.nozzle} castShadow />
      <mesh geometry={geo.nozzleInner} material={m.nozzleIn} />
      <mesh geometry={nozzleDisc} material={m.nozzleGlow} position={[0, 0.02, zs(NOZZLE.s1 - 0.55)]} rotation={[0, Math.PI, 0]} />
      <group ref={flames} position={[0, 0.02, zs(NOZZLE.s1) + 0.05]}>
        <mesh ref={outer} geometry={flameGeo.outer} material={m.flameOuter} renderOrder={5} />
        <mesh ref={mid} geometry={flameGeo.mid} material={m.flameMid} renderOrder={6} />
        <mesh ref={core} geometry={flameGeo.core} material={m.flameCore} renderOrder={7} />
        <sprite ref={abGlow} material={m.abGlow} position={[0, 0, -0.5]} renderOrder={8} />
      </group>

      {/* stores */}
      <mesh geometry={geo.missileWhite} material={m.white} castShadow />
      <mesh geometry={geo.missileBody} material={m.mgrey} castShadow />
      <mesh geometry={geo.seeker} material={m.seeker} />

      {/* markings */}
      {[1, -1].map((sg) => (
        <group key={`mk${sg}`}>
          <mesh geometry={decalPlane} material={m.roundel} position={[sg * 3.05, WING_Y + 0.07, zs(10.75)]} rotation={[-Math.PI / 2, 0, 0]} scale={0.95} />
          <mesh geometry={decalPlane} material={m.roundel} position={[sg * 3.05, WING_Y - 0.07, zs(10.75)]} rotation={[Math.PI / 2, 0, 0]} scale={0.95} />
          <mesh geometry={decalPlane} material={m.roundel} position={[sg * 0.575, -0.66, zs(6.6)]} rotation={[0, (sg * Math.PI) / 2, 0]} scale={0.5} />
          <mesh
            geometry={decalPlane}
            material={m.flag}
            position={[sg * 0.075, 1.85, zs(12.6)]}
            rotation={[0, (sg * Math.PI) / 2, 0]}
            scale={[sg * 0.9, 0.7, 1]}
          />
        </group>
      ))}

      {/* navigation lights: red port / green starboard wingtips, white tail */}
      <mesh geometry={bulbGeo} material={m.bulbRed} position={[4.64, WING_Y, railFrontZ]} />
      <sprite material={m.glowRed} position={[4.66, WING_Y, railFrontZ + 0.05]} scale={1.1} />
      <mesh geometry={bulbGeo} material={m.bulbGreen} position={[-4.64, WING_Y, railFrontZ]} />
      <sprite material={m.glowGreen} position={[-4.66, WING_Y, railFrontZ + 0.05]} scale={1.1} />
      <mesh geometry={bulbGeo} material={m.bulbWhite} position={[0, 3.1, zs(14.1)]} />
      <sprite ref={strobe} material={m.glowWhite} position={[0, 3.36, zs(13.3)]} scale={2} />
    </group>
  );
}

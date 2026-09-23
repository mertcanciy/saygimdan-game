"use client";

// Atmosphere for every game: sky, sun/moon light with camera-following
// shadows, image-based lighting (so glass actually reflects the sky), fog,
// and the post-processing stack (AO, bloom, filmic tone mapping).

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Sky, Stars, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping, Vignette, N8AO, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

export type WorldPreset = "day" | "golden" | "night";

interface PresetDef {
  /** sun (or moon) direction, pointing from the scene towards the light */
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  fog: string;
  fogDensity: number;
  night: number;
  exposure: number;
  bloom: { threshold: number; intensity: number };
  sky: { turbidity: number; rayleigh: number; mie: number; mieG: number } | null;
}

export const PRESETS: Record<WorldPreset, PresetDef> = {
  day: {
    sun: [0.5, 0.52, 0.42],
    sunColor: "#fff1dc",
    sunIntensity: 4.2,
    hemiSky: "#cfe3ff",
    hemiGround: "#6d6558",
    hemiIntensity: 0.25,
    envIntensity: 0.55,
    fog: "#b7c9dc",
    fogDensity: 0.00065,
    night: 0,
    exposure: 1.0,
    bloom: { threshold: 1.1, intensity: 0.35 },
    sky: { turbidity: 3.2, rayleigh: 1.6, mie: 0.003, mieG: 0.8 },
  },
  golden: {
    sun: [-0.62, 0.12, -0.55],
    sunColor: "#ffb36b",
    sunIntensity: 3.4,
    hemiSky: "#ffc9a3",
    hemiGround: "#4a3b36",
    hemiIntensity: 0.5,
    envIntensity: 0.8,
    fog: "#e6bfa0",
    fogDensity: 0.00055,
    night: 0.3,
    exposure: 1.05,
    bloom: { threshold: 0.95, intensity: 0.55 },
    sky: { turbidity: 8, rayleigh: 2.6, mie: 0.006, mieG: 0.88 },
  },
  night: {
    sun: [-0.4, 0.55, -0.6],
    sunColor: "#9fb4ff",
    sunIntensity: 0.35,
    hemiSky: "#2a3868",
    hemiGround: "#0e0f16",
    hemiIntensity: 0.35,
    envIntensity: 0.55,
    fog: "#0c1224",
    fogDensity: 0.0016,
    night: 1,
    exposure: 1.0,
    bloom: { threshold: 0.8, intensity: 1.0 },
    sky: null,
  },
};

const _sun = new THREE.Vector3();
const _focus = new THREE.Vector3();

/** Gradient night sky dome (drei's Sky is daylight-only). */
function NightSky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w; // pin to the far plane
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.1, 1.0);
            vec3 horizon = vec3(0.11, 0.12, 0.22);
            vec3 glow = vec3(0.30, 0.20, 0.26);
            vec3 zenith = vec3(0.012, 0.018, 0.05);
            vec3 c = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
            c += glow * exp(-max(h, 0.0) * 14.0) * 0.6;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    []
  );
  return (
    <mesh material={mat} scale={100} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

function Moon({ dir }: { dir: THREE.Vector3 }) {
  const p = dir.clone().multiplyScalar(2000);
  return (
    <group position={p}>
      <mesh>
        <sphereGeometry args={[46, 32, 16]} />
        <meshBasicMaterial color="#f4f1e6" fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Sky + lights + environment + fog. Place once per scene.
 * `focus` (optional): world point the shadow frustum should follow
 * (defaults to the camera position).
 */
export function WorldAtmosphere({
  preset,
  focus,
  shadowSize = 140,
}: {
  preset: WorldPreset;
  focus?: React.RefObject<THREE.Vector3 | null>;
  shadowSize?: number;
}) {
  const p = PRESETS[preset];
  const sunDir = useMemo(() => new THREE.Vector3(...p.sun).normalize(), [p]);
  const light = useRef<THREE.DirectionalLight>(null);
  const skyGroup = useRef<THREE.Group>(null);
  const get = useThree((s) => s.get);

  useEffect(() => {
    const { scene, gl } = get();
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    scene.environmentIntensity = p.envIntensity;
    gl.toneMappingExposure = p.exposure;
    return () => {
      scene.fog = null;
    };
  }, [get, p]);

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const { scene } = get();
    scene.add(l.target);
    l.shadow.camera.updateProjectionMatrix();
    return () => {
      scene.remove(l.target);
    };
  }, [get]);

  useFrame(({ camera }) => {
    // night dome, stars and moon travel with the camera (they are "at infinity")
    skyGroup.current?.position.copy(camera.position);
    const l = light.current;
    if (!l) return;
    if (focus?.current) _focus.copy(focus.current);
    else _focus.copy(camera.position);
    // snap to shadow texels to avoid shimmering while moving
    const texel = (shadowSize * 2) / 2048;
    _focus.x = Math.round(_focus.x / texel) * texel;
    _focus.z = Math.round(_focus.z / texel) * texel;
    _focus.y = Math.max(0, Math.round(_focus.y / texel) * texel);
    _sun.copy(sunDir).multiplyScalar(500).add(_focus);
    l.position.copy(_sun);
    l.target.position.copy(_focus);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      {p.sky ? (
        <Sky
          distance={4500}
          sunPosition={sunDir.toArray() as [number, number, number]}
          turbidity={p.sky.turbidity}
          rayleigh={p.sky.rayleigh}
          mieCoefficient={p.sky.mie}
          mieDirectionalG={p.sky.mieG}
        />
      ) : (
        <group ref={skyGroup}>
          <NightSky />
          <Stars radius={1500} depth={200} count={3500} factor={9} fade speed={0.2} />
          <Moon dir={sunDir} />
        </group>
      )}

      <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemiIntensity]} />
      <directionalLight
        ref={light}
        color={p.sunColor}
        intensity={p.sunIntensity}
        castShadow={preset !== "night"}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.06}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-camera-near={10}
        shadow-camera-far={1200}
      />

      {/* image-based lighting: the sky plus a stand-in skyline so glass reflects "a city" */}
      <Environment resolution={256} frames={1}>
        {p.sky ? (
          <Sky
            distance={4500}
            sunPosition={sunDir.toArray() as [number, number, number]}
            turbidity={p.sky.turbidity}
            rayleigh={p.sky.rayleigh}
            mieCoefficient={p.sky.mie}
            mieDirectionalG={p.sky.mieG}
          />
        ) : (
          <NightSky />
        )}
        <mesh position={[0, -60, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial color={preset === "night" ? "#07080c" : "#4d4f52"} />
        </mesh>
        <EnvSkyline night={preset === "night"} />
        {preset === "night" && (
          <>
            <Lightformer form="rect" intensity={2} color="#ffcf8a" position={[40, 8, 30]} scale={[30, 6, 1]} />
            <Lightformer form="rect" intensity={1.4} color="#8ab4ff" position={[-50, 14, -20]} scale={[20, 10, 1]} />
          </>
        )}
      </Environment>
    </>
  );
}

/** Dark building silhouettes rendered only into the environment map. */
function EnvSkyline({ night }: { night: boolean }) {
  const boxes = useMemo(() => {
    const out: { x: number; z: number; w: number; h: number; ry: number }[] = [];
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r() * 0.1;
      const d = 90 + r() * 60;
      out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: 14 + r() * 20, h: 10 + r() * 70, ry: -a });
    }
    return out;
  }, []);
  return (
    <group position={[0, -40, 0]}>
      {boxes.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]} rotation={[0, b.ry, 0]}>
          <boxGeometry args={[b.w, b.h, b.w]} />
          <meshBasicMaterial color={night ? "#0b0d14" : i % 3 === 0 ? "#6d7680" : "#8b8f94"} />
        </mesh>
      ))}
    </group>
  );
}

/** Post-processing stack. Keep it last inside the Canvas. */
export function WorldEffects({ preset, ao = true }: { preset: WorldPreset; ao?: boolean }) {
  const p = PRESETS[preset];
  return (
    <EffectComposer multisampling={0}>
      {ao ? (
        <N8AO aoRadius={4} distanceFalloff={1.2} intensity={preset === "night" ? 1.4 : 2.2} halfRes quality="performance" />
      ) : (
        <></>
      )}
      <Bloom luminanceThreshold={p.bloom.threshold} intensity={p.bloom.intensity} mipmapBlur radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette eskil={false} offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}

/** Canvas props every game should use for a photographic look. */
export const CANVAS_GL = {
  antialias: false,
  powerPreference: "high-performance" as const,
  stencil: false,
};

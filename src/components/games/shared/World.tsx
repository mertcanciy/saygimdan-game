"use client";

// Atmosphere for every game: sky, sun/moon light with camera-following
// shadows, image-based lighting (so glass actually reflects the sky), fog,
// and the post-processing stack (AO, bloom, filmic tone mapping).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Sky, Stars, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping, Vignette, N8AO, SMAA } from "@react-three/postprocessing";
import { SMAAPreset, ToneMappingMode, type EffectComposer as PPEffectComposer } from "postprocessing";
import { getDisplayHz, isTabletScreen, isTouchDevice } from "./input";

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
  const mobile = useMemo(() => isTouchDevice(), []);
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
    const texel = (shadowSize * 2) / (mobile ? 1024 : 2048);
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
        shadow-mapSize={mobile ? [1024, 1024] : [2048, 2048]}
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

/**
 * Post-processing stack + adaptive quality. Keep it last inside the Canvas.
 *
 * Changing the render resolution reallocates the canvas and every
 * post-processing target — a visible freeze of a few hundred ms. So quality
 * only ever steps DOWN, and only when the frame rate stays low: the monitor
 * starts after the scene has warmed up, averages over a couple of seconds,
 * jumps straight to the level the measured frame rate calls for (one hitch,
 * not four), stops for good if a step didn't help (a 30 Hz low-power cap or a
 * CPU-bound device gains nothing from fewer pixels) and never steps back up.
 * It already runs behind the start sheet, where a resolution change is
 * invisible. Ambient occlusion is decided once at start (on for desktops, off
 * for phones) and dropped for good only if the frame rate is still bad at a
 * lower resolution.
 */
const DPR_STEPS = [1.5, 1.25, 1, 0.85];

/**
 * Most pixels a frame may have. Big hi-DPI screens (5K, 4K at 150 %) would
 * otherwise render 8–9 MP, where the post-processing chain is limited by
 * memory bandwidth (≈30 fps on an M3). Never trims below the CSS resolution.
 */
const PIXEL_BUDGET = 4.2e6;

/**
 * Phones and tablets: quality levels as pixels per frame. A landscape phone
 * is only ~0.33 MP in CSS pixels, so rendering at DPR 1 (the old fixed
 * setting) looked like a low-res video on a 3× screen. Level 0 is ≈ DPR 1.8
 * there; weaker GPUs step down (straight to the right level) as far as the
 * old DPR 0.85. Tablets have more screen and stronger GPUs: × TABLET_SCALE.
 */
const TOUCH_BUDGETS = [1.1e6, 0.82e6, 0.6e6, 0.45e6, 0.33e6, 0.25e6];
const TABLET_SCALE = 1.7;
const TOUCH_MAX_DPR = 2;

const touchBudget = (level: number) => TOUCH_BUDGETS[level] * (isTabletScreen() ? TABLET_SCALE : 1);
const levelCount = () => (isTouchDevice() ? TOUCH_BUDGETS.length : DPR_STEPS.length);

function dprFor(level: number, cssPixels: number) {
  const css = Math.max(1, cssPixels);
  if (isTouchDevice()) {
    const max = Math.min(window.devicePixelRatio || 1, TOUCH_MAX_DPR);
    return Math.min(max, Math.max(0.75, Math.sqrt(touchBudget(level) / css)));
  }
  const budget = Math.max(1, Math.sqrt(PIXEL_BUDGET / css));
  return Math.min(window.devicePixelRatio, DPR_STEPS[level], budget);
}

/** Level a device settled on this session; the next game starts there instead of re-learning it. */
let learnedLevel = 0;
const startLevel = () => learnedLevel;

/*
 * The render DPR lives here and reaches the renderer through the Canvas `dpr`
 * prop. It can't be set with `useThree().setDpr` alone: <Canvas> re-applies its
 * `dpr` prop on every render (the games re-render with each HUD update), which
 * silently put every phone back at 1.5 and undid every quality step.
 */
let canvasDpr: number | null = null;
const dprListeners = new Set<() => void>();

function setCanvasDpr(v: number) {
  if (v === canvasDpr) return;
  canvasDpr = v;
  dprListeners.forEach((l) => l());
}

function subscribeDpr(l: () => void) {
  dprListeners.add(l);
  return () => {
    dprListeners.delete(l);
  };
}

function readDpr() {
  return (canvasDpr ??= dprFor(startLevel(), window.innerWidth * window.innerHeight));
}

/** Pass as `<Canvas dpr={…}>` in every game (WorldEffects adapts it). */
export function useCanvasDpr(): number {
  return useSyncExternalStore(subscribeDpr, readDpr, () => 1);
}

/**
 * N8AO switches itself to "transparency aware" mode as soon as the scene holds
 * any transparent material (every game does: particles, glow pools, glass).
 * That mode re-renders the whole scene twice more per frame at full
 * resolution (re-rendering the sun's shadow map each time) and walks the scene
 * graph six times, allocating a Map every frame — it was most of the AO cost.
 * AO from the opaque depth buffer alone looks the same here.
 */
function opaqueOnlyAO(pass: { autoDetectTransparency: boolean; configuration: { transparencyAware: boolean } } | null) {
  if (!pass) return;
  pass.autoDetectTransparency = false;
  pass.configuration.transparencyAware = false;
}

const _hidden: THREE.Object3D[] = [];

/** Run `fn` with every hidden object (except lights) temporarily visible. */
function withHiddenShown<T>(scene: THREE.Scene, fn: () => T): T {
  scene.traverse((o) => {
    // lights stay as they are: another light count means other shaders
    if (o.visible || (o as THREE.Light).isLight) return;
    o.visible = true;
    _hidden.push(o);
  });
  try {
    return fn();
  } finally {
    for (const o of _hidden) o.visible = false;
    _hidden.length = 0;
  }
}

/**
 * Shader + GPU pipeline warm-up for everything in the scene, including objects
 * that only appear later (afterburner glow, cockpit, explosion, sparks…).
 * Otherwise each of those compiles its shader the first time it shows up —
 * a 50–100 ms freeze mid-game. Runs only while the start sheet is up.
 *
 * 1. compile every material for the composer's HDR target (the scene is drawn
 *    into that, linear and un-tonemapped — a different shader variant than the
 *    screen), in parallel where the browser supports it;
 * 2. then draw the scene into that target a couple of times with hidden
 *    objects made visible: some GPUs (Metal) only build the pipeline on the
 *    first real draw. The composer clears and redraws the target right after.
 *
 * Once the game has started it does nothing: the extra draws would themselves
 * be the kind of mid-game hitch this is meant to avoid.
 */
function useWarmUp(composer: React.RefObject<PPEffectComposer | null>, started: boolean) {
  const get = useThree((s) => s.get);
  const prime = useRef(0);
  const startedRef = useRef(started);
  useEffect(() => {
    startedRef.current = started;
    if (started) prime.current = 0;
  }, [started]);
  useEffect(() => {
    let alive = true;
    const run = () => {
      const c = composer.current;
      if (!alive || !c || startedRef.current) return;
      const { gl, scene, camera } = get();
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(c.inputBuffer);
      const ready = withHiddenShown(scene, () => gl.compileAsync(scene, camera));
      gl.setRenderTarget(prev);
      ready.then(() => alive && !startedRef.current && (prime.current = 2)).catch(() => {});
    };
    // once the environment map exists, and again after late loads (models)
    const timers = [setTimeout(run, 500), setTimeout(run, 2500)];
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [get, composer]);
  // after the game logic (priority 0), before the composer (priority 1)
  useFrame(({ gl, scene, camera }) => {
    const c = composer.current;
    if (prime.current <= 0 || !c || startedRef.current) return;
    prime.current--;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(c.inputBuffer);
    gl.clear();
    withHiddenShown(scene, () => gl.render(scene, camera));
    gl.setRenderTarget(prev);
  }, 0.9);
}

/** Frame-rate watch behind the adaptive quality (seconds). */
const MONITOR = {
  /** shader compilation and asset uploads make the first seconds look slow (phones start sooner: the start sheet hides a change) */
  warmupTouch: 3,
  warmupDesktop: 6,
  window: 1.6,
};

/**
 * Calls `onSlow(fps / target)` when two measuring windows in a row come in
 * under the target frame rate; `onSlow` returns false when there is nothing
 * left to drop. Stops for good once a step bought less than 10 %.
 */
function useFrameRateGuard(touch: boolean, onSlow: (ratio: number) => boolean) {
  const st = useRef({ age: 0, t: 0, n: 0, slow: 0, slowFps: 0, lastFps: 0, settle: 0, done: false });
  useFrame((_, dt) => {
    const m = st.current;
    if (m.done) return;
    m.age += dt;
    if (dt > 0.25) {
      // tab switch, a reallocation, a long task: restart the window
      m.t = m.n = 0;
      return;
    }
    if (m.age < (touch ? MONITOR.warmupTouch : MONITOR.warmupDesktop)) return;
    m.t += dt;
    m.n++;
    if (m.t < MONITOR.window) return;
    const fps = m.n / m.t;
    m.t = m.n = 0;
    if (m.settle > 0) {
      m.settle--;
      return;
    }
    // measured before the scene loaded (see measureDisplayHz): a 30 Hz low-power cap isn't a slow GPU
    const hz = getDisplayHz();
    const target = hz > 90 ? 55 : hz >= 60 ? (touch ? 45 : 42) : 25;
    if (fps >= target) {
      m.slow = 0;
      return;
    }
    // one slow window can be a hiccup (a late shader, a model upload): wait for a second
    if (++m.slow < 2) {
      m.slowFps = fps;
      return;
    }
    const avg = (fps + m.slowFps) / 2;
    m.slow = 0;
    if (m.lastFps && avg < m.lastFps * 1.1) {
      m.done = true;
      return;
    }
    m.lastFps = avg;
    m.settle = 1;
    if (!onSlow(avg / target)) m.done = true;
  });
}

/**
 * Dev-only: `?gpuload=12` makes every frame cost 12 ms per million rendered
 * pixels (busy wait), i.e. a fill-rate-bound phone GPU, to exercise the
 * adaptive quality on a fast machine.
 */
function useFakeGpuLoad() {
  const msPerMp = useMemo(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return 0;
    return Number(new URLSearchParams(window.location.search).get("gpuload")) || 0;
  }, []);
  useFrame(({ gl }) => {
    if (!msPerMp) return;
    const c = gl.domElement;
    const end = performance.now() + ((c.width * c.height) / 1e6) * msPerMp;
    while (performance.now() < end);
  });
}

export function WorldEffects({ preset, ao = true, started = false }: { preset: WorldPreset; ao?: boolean; started?: boolean }) {
  const p = PRESETS[preset];
  const composer = useRef<PPEffectComposer>(null);
  useWarmUp(composer, started);
  useFakeGpuLoad();
  const cssPixels = useThree((s) => s.size.width * s.size.height);
  const touch = useMemo(() => isTouchDevice(), []);
  const [level, setLevel] = useState(startLevel);
  const levelRef = useRef(level);
  const [aoOn, setAoOn] = useState(() => ao && !touch);
  const aoRef = useRef(aoOn);
  const drops = useRef(0);
  // re-evaluated on resize / fullscreen too (the budget depends on the canvas
  // size); R3F only reallocates when the resulting DPR actually changes
  useEffect(() => {
    setCanvasDpr(dprFor(level, cssPixels));
  }, [level, cssPixels]);
  useFrameRateGuard(touch, (ratio) => {
    const last = levelCount() - 1;
    const step = (next: number) => {
      levelRef.current = learnedLevel = next;
      setLevel(next);
      return true;
    };
    if (touch) {
      if (levelRef.current >= last) return false;
      // straight to the level whose pixel count fits the measured frame rate
      const want = touchBudget(levelRef.current) * ratio * 0.9;
      let next = levelRef.current + 1;
      while (next < last && touchBudget(next) > want) next++;
      return step(next);
    }
    // desktop: first drop lower resolution; second AO off; then resolution again
    drops.current++;
    if (drops.current === 2 && aoRef.current) {
      aoRef.current = false;
      setAoOn(false);
      return true;
    }
    if (levelRef.current >= last) {
      if (!aoRef.current) return false;
      aoRef.current = false;
      setAoOn(false);
      return true;
    }
    return step(levelRef.current + 1);
  });
  return (
    <>
      <EffectComposer ref={composer} multisampling={0}>
        {aoOn ? (
          <N8AO
            ref={opaqueOnlyAO}
            aoRadius={4}
            distanceFalloff={1.2}
            intensity={preset === "night" ? 1.4 : 2.2}
            halfRes
            quality="performance"
          />
        ) : (
          <></>
        )}
        {/* phones: a shorter bloom chain and the light SMAA preset (fewer full-screen passes, so more pixels fit) */}
        <Bloom luminanceThreshold={p.bloom.threshold} intensity={p.bloom.intensity} mipmapBlur radius={0.7} levels={touch ? 6 : 8} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA preset={touch ? SMAAPreset.LOW : SMAAPreset.MEDIUM} />
        <Vignette eskil={false} offset={0.3} darkness={0.45} />
      </EffectComposer>
    </>
  );
}

/** Canvas props every game should use for a photographic look. */
export const CANVAS_GL = {
  antialias: false,
  powerPreference: "high-performance" as const,
  stencil: false,
};

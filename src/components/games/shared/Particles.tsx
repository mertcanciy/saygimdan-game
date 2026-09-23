"use client";

import { forwardRef, useImperativeHandle, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * GPU-friendly soft particle system (THREE.Points + custom shader).
 * Use the imperative `emit()` handle to spawn puffs. Per-particle size,
 * color, alpha fade, drag and gravity. Good for smoke, sparks, exhaust.
 */
export interface ParticleHandle {
  emit: (
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    opts?: { life?: number; size?: number; color?: THREE.Color | string; grow?: number }
  ) => void;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // perspective size, clamped so huge close-up puffs stay within GPU limits
    gl_PointSize = clamp(aSize * (300.0 / max(0.1, -mv.z)), 0.0, 512.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    // procedural soft round sprite: never a hard-edged square, no texture needed
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 >= 1.0) discard;
    float soft = exp(-r2 * 2.6) * (1.0 - r2);
    float a = soft * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

const _c = new THREE.Color();

const Particles = forwardRef<
  ParticleHandle,
  {
    count?: number;
    gravity?: number;
    drag?: number;
    blending?: THREE.Blending;
    /** default life seconds */
    life?: number;
    depthWrite?: boolean;
    /** global alpha multiplier */
    opacity?: number;
  }
>(function Particles(
  { count = 600, gravity = 0, drag = 1.2, blending = THREE.NormalBlending, life = 1.2, depthWrite = false, opacity = 1 },
  ref
) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: opacity } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite,
        blending,
      }),
    [blending, depthWrite, opacity]
  );
  const state = useMemo(
    () => ({
      vel: new Float32Array(count * 3),
      life: new Float32Array(count),
      maxLife: new Float32Array(count),
      size0: new Float32Array(count),
      grow: new Float32Array(count),
      cursor: 0,
    }),
    [count]
  );

  useImperativeHandle(ref, () => ({
    emit(pos, vel, opts) {
      const i = state.cursor;
      state.cursor = (i + 1) % count;
      const pa = geo.getAttribute("position") as THREE.BufferAttribute;
      const ca = geo.getAttribute("aColor") as THREE.BufferAttribute;
      pa.setXYZ(i, pos.x, pos.y, pos.z);
      state.vel[i * 3] = vel.x;
      state.vel[i * 3 + 1] = vel.y;
      state.vel[i * 3 + 2] = vel.z;
      const l = opts?.life ?? life;
      state.life[i] = l;
      state.maxLife[i] = l;
      state.size0[i] = opts?.size ?? 1;
      state.grow[i] = opts?.grow ?? 1.5;
      const col = opts?.color ? _c.set(opts.color as THREE.ColorRepresentation) : _c.set("#ffffff");
      ca.setXYZ(i, col.r, col.g, col.b);
      pa.needsUpdate = true;
      ca.needsUpdate = true;
    },
  }));

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const pa = geo.getAttribute("position") as THREE.BufferAttribute;
    const sa = geo.getAttribute("aSize") as THREE.BufferAttribute;
    const aa = geo.getAttribute("aAlpha") as THREE.BufferAttribute;
    const p = pa.array as Float32Array;
    const dragF = Math.exp(-drag * dt);
    for (let i = 0; i < count; i++) {
      if (state.life[i] <= 0) {
        aa.setX(i, 0);
        continue;
      }
      state.life[i] -= dt;
      const t = 1 - state.life[i] / state.maxLife[i];
      state.vel[i * 3] *= dragF;
      state.vel[i * 3 + 1] = state.vel[i * 3 + 1] * dragF + gravity * dt;
      state.vel[i * 3 + 2] *= dragF;
      p[i * 3] += state.vel[i * 3] * dt;
      p[i * 3 + 1] += state.vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += state.vel[i * 3 + 2] * dt;
      sa.setX(i, state.size0[i] * (1 + t * state.grow[i]));
      // fade in fast, out slow
      const a = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      aa.setX(i, Math.max(0, a));
    }
    pa.needsUpdate = true;
    sa.needsUpdate = true;
    aa.needsUpdate = true;
  });

  return <points geometry={geo} material={mat} frustumCulled={false} />;
});

export default Particles;

"use client";

// Soft tyre smoke: instanced camera-facing quads with a baked fBm puff
// texture, per-puff rotation / growth / fade, soft fade where puffs meet the
// ground, and a simple lighting term so smoke picks up the night colours
// instead of reading as flat grey (or black) blobs.

import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

export interface SmokeHandle {
  emit: (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, alpha?: number) => void;
}

function puffTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(S, S);
  // value noise fBm
  const grid = 16;
  const rnd: number[] = [];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < grid * grid; i++) rnd.push(r());
  const vn = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = (t: number) => t * t * (3 - 2 * t);
    const at = (a: number, b: number) => rnd[(((a % grid) + grid) % grid) + (((b % grid) + grid) % grid) * grid];
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const cc = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (cc - a) * s(yf) + (a - b - cc + d) * s(xf) * s(yf);
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let n = 0;
      let amp = 0.5;
      let f = 4;
      for (let o = 0; o < 4; o++) {
        n += vn(u * f, v * f) * amp;
        amp *= 0.5;
        f *= 2;
      }
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const fall = Math.max(0, 1 - d);
      const a = Math.pow(fall, 1.4) * THREE.MathUtils.clamp((n - 0.28) * 1.9, 0, 1);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const VERT = /* glsl */ `
  attribute vec4 aPS;     // xyz = position, w = size
  attribute vec2 aAR;     // alpha, rotation
  varying vec2 vUv;
  varying float vAlpha;
  varying float vWorldY;
  varying float vFog;
  void main() {
    vUv = uv;
    vAlpha = aAR.x;
    float c = cos(aAR.y);
    float s = sin(aAR.y);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aPS.w;
    vec4 mv = viewMatrix * vec4(aPS.xyz, 1.0);
    mv.xy += corner;
    // approximate world y of this corner (camera is roughly level)
    vWorldY = aPS.y + corner.y;
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uVeil;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vWorldY;
  varying float vFog;
  void main() {
    float t = texture2D(uMap, vUv).a;
    float a = t * vAlpha * smoothstep(0.0, 0.45, vWorldY);
    if (a < 0.004) discard;
    // denser parts self-shadow a little; thin edges catch light
    vec3 col = uColor * mix(0.78, 1.08, 1.0 - t);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
    col = mix(col, uFogColor, f);
    // premultiplied, mostly-emissive smoke: it lightens what is behind it and
    // only veils it a little, so it never reads as dark blobs on lit asphalt
    gl_FragColor = vec4(col * a, a * uVeil);
  }
`;

const TireSmoke = forwardRef<
  SmokeHandle,
  { count?: number; color?: string; fogColor?: string; fogDensity?: number; drag?: number; lift?: number }
>(function TireSmoke({ count = 700, color = "#b9bcc6", fogColor = "#0c1224", fogDensity = 0.0016, drag = 1.4, lift = 0.9 }, ref) {
  const data = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    geo.setAttribute("uv", quad.getAttribute("uv"));
    const ps = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const ar = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    ps.setUsage(THREE.DynamicDrawUsage);
    ar.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPS", ps);
    geo.setAttribute("aAR", ar);
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: puffTexture() },
        uColor: { value: new THREE.Color(color) },
        uFogColor: { value: new THREE.Color(fogColor) },
        uFogDensity: { value: fogDensity },
        uVeil: { value: 0.45 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    return {
      geo,
      mat,
      ps,
      ar,
      vel: new Float32Array(count * 3),
      life: new Float32Array(count),
      max: new Float32Array(count),
      size0: new Float32Array(count),
      a0: new Float32Array(count),
      spin: new Float32Array(count),
      cursor: 0,
    };
  }, [count, color, fogColor, fogDensity]);

  useEffect(
    () => () => {
      data.geo.dispose();
      data.mat.dispose();
      (data.mat.uniforms.uMap.value as THREE.Texture).dispose();
    },
    [data]
  );

  useImperativeHandle(ref, () => ({
    emit(x, y, z, vx, vy, vz, size, life, alpha = 0.5) {
      const i = data.cursor;
      data.cursor = (i + 1) % count;
      const p = data.ps.array as Float32Array;
      p[i * 4] = x;
      p[i * 4 + 1] = y;
      p[i * 4 + 2] = z;
      p[i * 4 + 3] = size;
      data.vel[i * 3] = vx;
      data.vel[i * 3 + 1] = vy;
      data.vel[i * 3 + 2] = vz;
      data.life[i] = life;
      data.max[i] = life;
      data.size0[i] = size;
      data.a0[i] = alpha;
      data.spin[i] = (Math.random() - 0.5) * 1.2;
      (data.ar.array as Float32Array)[i * 2 + 1] = Math.random() * Math.PI * 2;
    },
  }));

  useFrame((_, raw) => {
    const dt = Math.min(raw, 1 / 30);
    const p = data.ps.array as Float32Array;
    const ar = data.ar.array as Float32Array;
    const k = Math.exp(-drag * dt);
    for (let i = 0; i < count; i++) {
      if (data.life[i] <= 0) {
        ar[i * 2] = 0;
        continue;
      }
      data.life[i] -= dt;
      const t = 1 - Math.max(0, data.life[i]) / data.max[i];
      data.vel[i * 3] *= k;
      data.vel[i * 3 + 1] = data.vel[i * 3 + 1] * k + lift * dt;
      data.vel[i * 3 + 2] *= k;
      p[i * 4] += data.vel[i * 3] * dt;
      p[i * 4 + 1] += data.vel[i * 3 + 1] * dt;
      p[i * 4 + 2] += data.vel[i * 3 + 2] * dt;
      // grows fast at first, then slowly billows
      p[i * 4 + 3] = data.size0[i] * (1 + 3.2 * Math.sqrt(t));
      ar[i * 2] = data.a0[i] * Math.min(1, t * 7) * Math.pow(1 - t, 1.5);
      ar[i * 2 + 1] += data.spin[i] * dt;
    }
    data.ps.needsUpdate = true;
    data.ar.needsUpdate = true;
  });

  return <mesh geometry={data.geo} material={data.mat} frustumCulled={false} renderOrder={5} />;
});

export default TireSmoke;

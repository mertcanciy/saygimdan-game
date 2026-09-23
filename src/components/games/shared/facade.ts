// Procedural building facade material.
//
// Every building volume is one instance of a unit box. Windows, mullions,
// floor slabs, storefronts and roof gravel are computed in world space in the
// fragment shader, so a 3 m storey is 3 m on every building regardless of the
// box scale (no stretched textures). Glass gets per-pane roughness and normal
// jitter so curtain walls break up the environment reflection like real glass.
//
// Per-instance attributes:
//   aBox    = (centerX, centerZ, width, depth)
//   aParams = (style, seed, y0, 0 | 1 = has storefront | 2 = solid wall)

import * as THREE from "three";

export interface FacadeUniforms {
  uNight: { value: number };
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aBox;
attribute vec4 aParams;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec4 vFBox;
varying vec4 vFParams;
`;

const VERT_BODY = /* glsl */ `
{
  vec4 fw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fw = instanceMatrix * fw;
  #endif
  fw = modelMatrix * fw;
  vFWorld = fw.xyz;
  vFNormal = normal;
  vFBox = aBox;
  vFParams = aParams;
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uNight;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec4 vFBox;
varying vec4 vFParams;

float fHash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float fNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fHash(vec3(i, 1.0));
  float b = fHash(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = fHash(vec3(i + vec2(0.0, 1.0), 1.0));
  float d = fHash(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// anti-aliased pulse: 1 inside [a,b], 0 outside, filtered by w
float fBand(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}

vec3 fAlbedo; float fRough; float fMetal; vec3 fEmit; vec3 fNJit;
`;

// Computes fAlbedo/fRough/fMetal/fEmit/fNJit. Runs right after color_fragment.
const FRAG_FACADE = /* glsl */ `
{
  float style = floor(vFParams.x + 0.5);
  float seed = vFParams.y;
  float y0 = vFParams.z;
  float hasShop = vFParams.w;
  vec3 N = normalize(vFNormal);
  float seedHue = fHash(vec3(seed * 91.0, 3.1, 7.7));

  // ---- palette per style -------------------------------------------------
  vec3 wall; vec3 frame; vec3 glass; float bay; float storey;
  float winW; float winB; float winT; float wallRough; float glassMetal;
  float ribbon = 0.0; float fins = 0.0; float brick = 0.0;
  if (style < 0.5) {            // glass curtain wall
    wall = vec3(0.16, 0.19, 0.22); frame = vec3(0.22, 0.24, 0.27);
    glass = mix(vec3(0.30, 0.42, 0.50), vec3(0.36, 0.44, 0.42), seedHue);
    bay = 1.55; storey = 3.9; winW = 0.94; winB = 0.2; winT = 0.97; wallRough = 0.45; glassMetal = 0.85;
  } else if (style < 1.5) {     // office, ribbon windows
    wall = mix(vec3(0.72, 0.70, 0.66), vec3(0.62, 0.64, 0.66), seedHue); frame = vec3(0.25, 0.26, 0.28);
    glass = vec3(0.22, 0.28, 0.32);
    bay = 3.0; storey = 3.7; winW = 0.96; winB = 0.34; winT = 0.86; wallRough = 0.85; glassMetal = 0.7; ribbon = 1.0;
  } else if (style < 2.5) {     // brick walk-up
    wall = mix(vec3(0.46, 0.22, 0.16), vec3(0.55, 0.36, 0.26), seedHue); frame = vec3(0.86, 0.84, 0.80);
    glass = vec3(0.10, 0.12, 0.14);
    bay = 3.2; storey = 3.2; winW = 0.46; winB = 0.24; winT = 0.8; wallRough = 0.92; glassMetal = 0.3; brick = 1.0;
  } else if (style < 3.5) {     // plaster apartment (warm pastels)
    vec3 a = vec3(0.86, 0.80, 0.68); vec3 b = vec3(0.84, 0.66, 0.54); vec3 c = vec3(0.72, 0.76, 0.76); vec3 d = vec3(0.90, 0.87, 0.80);
    wall = seedHue < 0.25 ? a : seedHue < 0.5 ? b : seedHue < 0.75 ? c : d;
    frame = vec3(0.93, 0.92, 0.90); glass = vec3(0.12, 0.14, 0.16);
    bay = 3.4; storey = 3.1; winW = 0.5; winB = 0.28; winT = 0.82; wallRough = 0.9; glassMetal = 0.3;
  } else if (style < 4.5) {     // dark metal panel + vertical fins
    wall = vec3(0.10, 0.105, 0.11); frame = vec3(0.14, 0.145, 0.15);
    glass = vec3(0.16, 0.19, 0.21);
    bay = 1.3; storey = 4.1; winW = 0.8; winB = 0.12; winT = 0.95; wallRough = 0.4; glassMetal = 0.8; fins = 1.0;
  } else {                      // limestone, punched grid
    wall = mix(vec3(0.80, 0.77, 0.70), vec3(0.74, 0.73, 0.70), seedHue); frame = vec3(0.30, 0.30, 0.30);
    glass = vec3(0.14, 0.18, 0.21);
    bay = 2.4; storey = 3.6; winW = 0.58; winB = 0.25; winT = 0.85; wallRough = 0.8; glassMetal = 0.55;
  }

  fNJit = vec3(0.0);
  fEmit = vec3(0.0);

  if (N.y > 0.5) {
    // ---- roof: gravel / membrane with a parapet rim ---------------------
    vec2 rp = vFWorld.xz;
    float edge = min(vFBox.z * 0.5 - abs(rp.x - vFBox.x), vFBox.w * 0.5 - abs(rp.y - vFBox.y));
    float n = fNoise(rp * 1.7) * 0.5 + fNoise(rp * 7.0) * 0.5;
    vec3 roofC = mix(vec3(0.36, 0.36, 0.35), vec3(0.46, 0.45, 0.43), n);
    if (style > 3.5 && style < 4.5) roofC *= 0.55;
    float rim = 1.0 - smoothstep(0.35, 0.45, edge);
    fAlbedo = mix(roofC, wall * 0.9, rim);
    fRough = 0.95; fMetal = 0.0;
  } else if (N.y < -0.5) {
    fAlbedo = wall * 0.3; fRough = 1.0; fMetal = 0.0;
  } else if (hasShop > 1.5) {
    // ---- solid parapet / cornice -----------------------------------------
    fAlbedo = (style < 0.5 || style > 3.5 && style < 4.5) ? frame : wall * 0.93;
    fRough = wallRough; fMetal = 0.0;
  } else {
    // ---- facade -----------------------------------------------------------
    bool xFace = abs(N.x) > 0.5;
    float faceLen = xFace ? vFBox.w : vFBox.z;
    float faceC = xFace ? vFBox.y : vFBox.x;
    float along = (xFace ? vFWorld.z : vFWorld.x) - (faceC - faceLen * 0.5);
    float faceId = xFace ? (N.x > 0.0 ? 1.0 : 2.0) : (N.z > 0.0 ? 3.0 : 4.0);

    float shopH = hasShop > 0.5 ? 4.6 : 0.0;
    float y = vFWorld.y - y0 - shopH;
    float nb = max(1.0, floor(faceLen / bay));
    float bw = faceLen / nb;
    float cx = along / bw;
    float cy = y / storey;
    float ci = floor(cx);
    float ri = floor(cy);
    float fx = fract(cx);
    float fy = fract(cy);
    float wx = fwidth(cx) * 1.2 + 1e-4;
    float wy = fwidth(cy) * 1.2 + 1e-4;
    float far = smoothstep(0.12, 0.45, max(wx, wy));

    float cell = fHash(vec3(ci + faceId * 131.0, ri, seed * 977.0));
    float cell2 = fHash(vec3(ri * 1.7, ci + seed * 311.0, faceId));

    // window mask
    float mx = ribbon > 0.5 ? 1.0 - fBand(fx, -0.02, 0.02, wx) - fBand(fx, 0.98, 1.02, wx)
                            : fBand(fx, 0.5 - winW * 0.5, 0.5 + winW * 0.5, wx);
    float my = fBand(fy, winB, winT, wy);
    float win = clamp(mx * my, 0.0, 1.0);
    float avgWin = (ribbon > 0.5 ? 0.96 : winW) * (winT - winB);
    win = mix(win, avgWin, far);

    // corner piers and a parapet band on top
    float edgeDist = min(along, faceLen - along);
    float pier = 1.0 - smoothstep(0.25, 0.25 + wx * bw, edgeDist);
    win *= (1.0 - pier);
    win *= step(0.0, y);

    // wall surface detail
    vec3 wallC = wall * (0.92 + 0.12 * fNoise(vec2(along, vFWorld.y) * 0.35));
    if (brick > 0.5) {
      float by = vFWorld.y / 0.075;
      float bx = along / 0.23 + 0.5 * mod(floor(by), 2.0);
      float mortar = max(fBand(fract(by), -0.1, 0.1, fwidth(by)), fBand(fract(bx), -0.05, 0.05, fwidth(bx)));
      mortar = mix(mortar, 0.18, smoothstep(0.3, 0.8, fwidth(by)));
      wallC = mix(wallC * (0.85 + 0.3 * fHash(vec3(floor(bx), floor(by), seed))), vec3(0.62, 0.6, 0.56), mortar * 0.8);
    }
    // floor slab lines on glass styles
    float slab = (style < 0.5 || style > 3.5 && style < 4.5) ? fBand(fy, -0.03, 0.03, wy) : 0.0;
    // vertical fins
    float fin = fins > 0.5 ? fBand(fx, -0.05, 0.05, wx) : 0.0;

    // glass: per-pane tint + interior blinds
    float blinds = step(0.72, cell) * (style > 1.5 && style < 3.5 ? 1.0 : 0.35);
    vec3 glassC = glass * (0.8 + 0.4 * cell2);
    glassC = mix(glassC, vec3(0.55, 0.53, 0.5), blinds * 0.55);
    float glassR = mix(0.04 + 0.08 * cell2, 0.6, blinds * 0.5);

    // window frame ring around each pane (non-curtain styles)
    float ring = 0.0;
    if (style > 0.5 && fins < 0.5 && ribbon < 0.5) {
      float inX = fBand(fx, 0.5 - winW * 0.5 + 0.03, 0.5 + winW * 0.5 - 0.03, wx);
      float inY = fBand(fy, winB + 0.04, winT - 0.04, wy);
      ring = win * (1.0 - inX * inY) * (1.0 - far);
      // sill
      float sill = fBand(fy, winB - 0.05, winB, wy) * fBand(fx, 0.5 - winW * 0.55, 0.5 + winW * 0.55, wx);
      wallC = mix(wallC, frame, sill * (1.0 - far) * 0.8);
    }

    fAlbedo = mix(wallC, glassC, win);
    fAlbedo = mix(fAlbedo, frame, max(ring, max(slab, fin) * (1.0 - pier)));
    fRough = mix(wallRough, glassR, win * (1.0 - ring));
    fMetal = mix(0.0, glassMetal, win * (1.0 - ring));

    // pane-level normal jitter so reflections break up like real glass
    fNJit = (vec3(cell - 0.5, cell2 - 0.5, fHash(vec3(ci, ri, 7.0)) - 0.5)) * 0.06 * win * (1.0 - far);

    // storefront
    float gy = vFWorld.y - y0;
    if (hasShop > 0.5 && gy < shopH) {
      float shopBay = fBand(fract(along / 4.2), 0.06, 0.94, fwidth(along / 4.2));
      float shopGlass = shopBay * fBand(gy, 0.35, 3.3, fwidth(gy)) * (1.0 - pier);
      float sign = fBand(gy, 3.55, 4.35, fwidth(gy)) * (1.0 - pier);
      float sh = fHash(vec3(floor(along / 4.2), faceId, seed * 51.0));
      vec3 signC = sh < 0.33 ? vec3(0.62, 0.12, 0.10) : sh < 0.66 ? vec3(0.10, 0.22, 0.38) : vec3(0.12, 0.12, 0.12);
      vec3 base = mix(vec3(0.20, 0.20, 0.21), wallC * 0.8, 0.4);
      fAlbedo = mix(base, vec3(0.08, 0.09, 0.1), shopGlass);
      fAlbedo = mix(fAlbedo, signC, sign);
      fRough = mix(0.7, 0.05, shopGlass);
      fMetal = mix(0.0, 0.6, shopGlass);
      fEmit += vec3(1.0, 0.82, 0.6) * shopGlass * (0.03 + 0.7 * uNight * step(0.45, sh)) * (0.4 + sh);
      fEmit += signC * 1.6 * sign * uNight;
      fNJit = vec3(0.0);
    }

    // lit interiors at night (and a few during the day)
    float litChance = style < 0.5 || style > 3.5 && style < 4.5 ? 0.42 : 0.3;
    float lit = step(1.0 - litChance, fHash(vec3(ci * 0.37 + faceId, ri * 1.31, seed * 13.0)));
    vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(1.0, 0.9, 0.75), cell2);
    vec3 cool = vec3(0.78, 0.88, 1.0);
    vec3 litC = (style < 1.5 || style > 3.5 && style < 4.5) ? mix(cool, warm, step(0.7, cell)) : warm;
    float litAmt = lit * win * (1.0 - ring) * step(0.0, y);
    litAmt = mix(litAmt, litChance * avgWin, far);
    fEmit += litC * litAmt * uNight * (0.45 + 0.75 * cell2 * cell2);
    fAlbedo = mix(fAlbedo, fAlbedo * 0.5, lit * win * uNight);

    // grounding: darker near the street, like ambient occlusion
    float ao = mix(0.55, 1.0, smoothstep(0.0, 5.0, vFWorld.y));
    fAlbedo *= ao;
  }
}
diffuseColor.rgb = fAlbedo;
`;

let cached: { material: THREE.MeshStandardMaterial; uniforms: FacadeUniforms } | null = null;

/** Shared facade material. `night` (0..1) drives lit windows / storefronts. */
export function getFacadeMaterial(): { material: THREE.MeshStandardMaterial; uniforms: FacadeUniforms } {
  if (cached) return cached;
  const uniforms: FacadeUniforms = { uNight: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_FACADE}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = fRough;`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * fNJit);`
      )
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmit;`);
  };
  material.customProgramCacheKey = () => "facade-v1";
  cached = { material, uniforms };
  return cached;
}

/** Fill the per-instance attributes for a list of volumes. */
export function makeFacadeAttributes(
  list: { x: number; z: number; w: number; d: number; y0: number; style: number; seed: number; solid?: boolean }[]
): { aBox: THREE.InstancedBufferAttribute; aParams: THREE.InstancedBufferAttribute } {
  const box = new Float32Array(list.length * 4);
  const params = new Float32Array(list.length * 4);
  list.forEach((b, i) => {
    box.set([b.x, b.z, b.w, b.d], i * 4);
    params.set([b.style, b.seed, b.y0, b.solid ? 2 : b.y0 < 0.01 ? 1 : 0], i * 4);
  });
  return {
    aBox: new THREE.InstancedBufferAttribute(box, 4),
    aParams: new THREE.InstancedBufferAttribute(params, 4),
  };
}

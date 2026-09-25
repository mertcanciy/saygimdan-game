import * as THREE from "three";

/**
 * Procedural Spider-suit material for the skinned hero.
 *
 * Everything (red/blue panels, black web lines, chest spider, big white eye
 * lenses) is computed per-fragment from the vertex's *bind-pose* position
 * (`aRest`, model space: metres, feet at y=0, facing +Z, T-pose with arms
 * along ±X). Because it is evaluated in rest space the pattern sticks to the
 * body when it animates, needs no texture download and stays sharp up close
 * (lines are antialiased with screen-space derivatives).
 *
 * Landmarks (rest pose): head bone 1.60, neck 1.52, shoulders |x|≈0.21 at
 * y≈1.455, wrists |x|≈0.71, hips 0.95, knees 0.54, ankles 0.09.
 */

const VERT_DECL = /* glsl */ `
attribute vec3 aRest;
varying vec3 vRest;
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vRest;
float gLens;
float gLine;


// antialiased periodic line: coordinate s in cells, cell size in metres, half width in metres
float gridLine(float s, float cell, float hw) {
  float d = abs(fract(s + 0.5) - 0.5) * cell;
  float aa = max(fwidth(d), 1e-5);
  return 1.0 - smoothstep(hw - aa, hw + aa, d);
}

// web: 'ang' around a pole (radians), 'rad' = distance from pole along the surface (m)
// spokes every 2π/N; rings every 'ring' metres, scalloped towards the pole between spokes
float webPattern(float ang, float rad, float circ, float N, float ring, float hw) {
  float u = ang * N / (2.0 * PI);
  float fu = fract(u);
  float sag = 1.0 - (2.0 * fu - 1.0) * (2.0 * fu - 1.0);
  float v = rad / ring + 0.38 * sag;
  float cell = max(circ / N, 1e-4);
  // fade spokes where they converge (pole) so they don't merge into a blob
  float spokes = gridLine(u, cell, hw) * smoothstep(hw * 3.0, hw * 7.0, cell);
  float rings = gridLine(v, ring, hw);
  return max(spokes, rings);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdEllipse(vec2 p, vec2 r) {
  // cheap approximation, good enough for small shapes
  float k = length(p / r);
  return (k - 1.0) * min(r.x, r.y);
}

// returns vec3(region, line, lens): region 0 = red, 1 = blue
vec3 suit(vec3 p) {
  float ax = abs(p.x);
  float region = 0.0;
  float line = 0.0;
  float lens = 0.0;
  float hw = 0.0016; // web line half width (m)

  if (p.y > 1.515 && ax < 0.16) {
    // ---- head + neck: web radiating from between the eyes
    vec3 c = vec3(0.0, 1.675, -0.01);
    vec3 d = p - c;
    vec3 n = normalize(d);
    float th = acos(clamp(n.z, -1.0, 1.0));
    float ang = atan(n.y, n.x);
    line = webPattern(ang, th * 0.1, 2.0 * PI * 0.1 * sin(th), 18.0, 0.021, hw * 0.85);

    // eyes: big white lenses with a thick black rim, outer corner lifted
    if (p.z > 0.02) {
      vec2 e = vec2(ax - 0.036, p.y - 1.694);
      float ca = cos(0.42), sa = sin(0.42);
      e = vec2(ca * e.x + sa * e.y, -sa * e.x + ca * e.y);
      // teardrop: narrower towards the nose
      e.y *= 1.0 + 0.9 * clamp(-e.x / 0.03, 0.0, 1.0) * 0.45;
      float sd = sdEllipse(e, vec2(0.029, 0.0175));
      float aa = max(fwidth(sd), 1e-5);
      float rim = 1.0 - smoothstep(0.0045 - aa, 0.0045 + aa, sd);
      float inner = 1.0 - smoothstep(-aa, aa, sd);
      line = max(line * (1.0 - rim), rim);
      lens = inner;
    }
  } else if (ax > 0.185 && p.y > 1.31) {
    // ---- arms (T-pose along ±X)
    float dy = p.y - 1.455;
    float dz = p.z + 0.065;
    float ang = atan(dy, dz); // 0 = front, +π/2 = top
    float t = smoothstep(0.2, 0.66, ax);
    float glove = step(0.655 + 0.012 * cos(ang * 3.0), ax);
    // blue runs under the arm from the armpit to the glove, narrowing
    float under = abs(ang + PI * 0.5 + 0.25);
    float wBlue = mix(1.05, 0.45, t);
    region = (glove < 0.5 && under < wBlue) ? 1.0 : 0.0;
    // shoulder cap stays red
    if (ax < 0.25 && dy > -0.02) region = 0.0;
    float r = mix(0.058, 0.035, t);
    line = webPattern(ang, ax, 2.0 * PI * r, 12.0, 0.045, hw);
  } else if (p.y > 0.985 - 0.11 * smoothstep(0.1, 0.0, ax) * step(0.0, p.z) ) {
    // ---- torso (with a red V dipping to the crotch at the front)
    float phi = atan(p.x, p.z + 0.02); // 0 front, ±π/2 sides
    float side = abs(abs(phi) - PI * 0.5);
    float yy = smoothstep(1.0, 1.43, p.y);
    float w = mix(0.62, 0.16, yy);
    region = (side < w && p.y < 1.44 && p.y > 0.95) ? 1.0 : 0.0;
    vec3 c = vec3(0.0, 1.29, -0.02);
    vec3 d = p - c;
    vec3 n = normalize(d);
    float pole = p.z >= -0.02 ? 1.0 : -1.0;
    float th = acos(clamp(n.z * pole, -1.0, 1.0));
    float ang = atan(n.y, n.x * pole);
    line = webPattern(ang, th * 0.2, 2.0 * PI * 0.2 * sin(th), 22.0, 0.042, hw);
    // chest spider
    if (p.z > 0.05 && ax < 0.09 && abs(p.y - 1.33) < 0.08) {
      vec2 q = vec2(ax, p.y - 1.33);
      float sp = min(sdEllipse(q - vec2(0.0, -0.012), vec2(0.011, 0.024)), sdEllipse(q - vec2(0.0, 0.021), vec2(0.008, 0.009)));
      float lg = 1e3;
      lg = min(lg, min(sdSeg(q, vec2(0.004, 0.02), vec2(0.03, 0.045)), sdSeg(vec2(0.03, 0.045), q, vec2(0.04, 0.07))));
      lg = min(lg, min(sdSeg(q, vec2(0.005, 0.012), vec2(0.038, 0.02)), sdSeg(q, vec2(0.038, 0.02), vec2(0.056, 0.04))));
      lg = min(lg, min(sdSeg(q, vec2(0.005, 0.0), vec2(0.036, -0.012)), sdSeg(q, vec2(0.036, -0.012), vec2(0.052, -0.04))));
      lg = min(lg, min(sdSeg(q, vec2(0.004, -0.01), vec2(0.026, -0.035)), sdSeg(q, vec2(0.026, -0.035), vec2(0.03, -0.068))));
      float s = min(sp, lg - 0.0026);
      float aa = max(fwidth(s), 1e-5);
      float spider = 1.0 - smoothstep(-aa, aa, s);
      line = max(line, spider);
    }
    if (region > 0.5) line = 0.0;
  } else {
    // ---- hips + legs blue, boots red with a V at the front
    float lx = ax - 0.114;
    float lz = p.z + 0.01;
    float ang = atan(lx, lz);
    float front = smoothstep(0.9, 0.0, abs(ang));
    float boot = step(p.y, 0.43 + 0.09 * front);
    region = 1.0 - boot;
    float r = mix(0.045, 0.06, smoothstep(0.1, 0.4, p.y));
    line = boot * webPattern(ang, p.y, 2.0 * PI * r, 12.0, 0.05, hw);
  }
  // no web over blue panels; dark seam where red meets blue is added by region AA
  if (region > 0.5) line = 0.0;
  return vec3(region, line, lens);
}
`;

export function makeSuitMaterial(normalMap: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    roughness: 0.55,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#ffc4c4"),
    clearcoat: 0.08,
    clearcoatRoughness: 0.6,
    normalMap: normalMap ?? null,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvRest = aRest;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_DECL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec3 sv = suit(vRest);
        gLens = sv.z;
        gLine = sv.y;
        vec3 cRed = vec3(0.50, 0.012, 0.022);
        vec3 cBlue = vec3(0.018, 0.035, 0.20);
        vec3 base = mix(cRed, cBlue, sv.x);
        // fine knit
        float knit = 0.93 + 0.07 * sin(vRest.x * 1400.0 + vRest.y * 900.0) * sin(vRest.z * 1300.0 - vRest.y * 700.0);
        base *= knit;
        base = mix(base, vec3(0.012, 0.012, 0.016), sv.y);
        base = mix(base, vec3(0.86, 0.9, 0.96), gLens);
        diffuseColor.rgb = base;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor, 0.72, gLine), 0.12, gLens);`
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.30, 0.32, 0.36) * gLens;`
      );
  };
  m.customProgramCacheKey = () => "spider-suit-v1";
  return m;
}

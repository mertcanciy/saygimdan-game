import * as THREE from "three";

/**
 * Additive afterburner plume layer. Drawn on an open cylinder whose base sits
 * at the nozzle exit and which extends toward -Z (uv.y: 0 = nozzle, 1 = tip).
 * Soft edges come from the view-angle term, shock diamonds from a cosine
 * along the length.
 */
export function makeFlameMaterial(colA: string, colB: string, diamonds: number, soft = 1.6) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uColA: { value: new THREE.Color(colA) },
      uColB: { value: new THREE.Color(colB) },
      uDiamonds: { value: diamonds },
      uSoft: { value: soft },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform float uDiamonds;
      uniform float uSoft;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float v = vUv.y;
        float rim = 0.16 + 0.84 * pow(abs(dot(normalize(vN), normalize(vV))), uSoft);
        float along = pow(clamp(1.0 - v, 0.0, 1.0), 1.3) * smoothstep(0.0, 0.06, v + 0.02);
        float d = 1.0;
        if (uDiamonds > 0.0) {
          float ph = v * uDiamonds;
          d = 0.45 + 0.9 * pow(0.5 + 0.5 * cos(ph * 6.28318), 3.0) * (1.0 - v * 0.8);
        }
        float flick = 0.82 + 0.18 * sin(uTime * 71.0 + v * 23.0 + vUv.x * 12.0) * sin(uTime * 37.0 - v * 9.0);
        float a = rim * along * d * flick * uPower;
        vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.8, v));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}

/** Open cone from the nozzle (z = 0) toward -Z, unit length. */
export function makeFlameGeometry(r0: number, r1: number) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 24, 12, true);
  g.translate(0, 0.5, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

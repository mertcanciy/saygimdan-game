import * as THREE from "three";

const VERT = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // fade out right in front of the camera so the trail never smears the view
    vAlpha = aAlpha * smoothstep(3.0, 14.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    float edge = sin(vUv.x * 3.14159);
    edge = edge * edge;
    float a = vAlpha * edge * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Camera-facing ribbon trail (wingtip vortices, LERX vapour).
 * Ring buffer of samples; the strip is rebuilt every frame without allocations.
 */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly pts: Float32Array;
  private readonly inten: Float32Array;
  private readonly age: Float32Array;
  private head = 0;
  private count = 0;
  private readonly pos: THREE.BufferAttribute;
  private readonly alpha: THREE.BufferAttribute;

  constructor(
    n: number,
    private readonly life: number,
    private readonly w0: number,
    private readonly spread: number,
    color: string,
    opacity: number
  ) {
    this.n = n;
    this.pts = new Float32Array(n * 3);
    this.inten = new Float32Array(n);
    this.age = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.BufferAttribute(new Float32Array(n * 2), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 4] = 0;
      uv[i * 4 + 1] = i / (n - 1);
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = i / (n - 1);
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute("position", this.pos);
    g.setAttribute("aAlpha", this.alpha);
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    g.setDrawRange(0, 0);
  }

  clear() {
    this.count = 0;
    this.head = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** Add a sample at `p` with emission strength 0..1. */
  push(p: THREE.Vector3, intensity: number) {
    const i = this.head;
    this.pts[i * 3] = p.x;
    this.pts[i * 3 + 1] = p.y;
    this.pts[i * 3 + 2] = p.z;
    this.inten[i] = intensity;
    this.age[i] = 0;
    this.head = (i + 1) % this.n;
    this.count = Math.min(this.n, this.count + 1);
  }

  /** Age samples and rebuild the camera-facing strip. */
  update(dt: number, cam: THREE.Vector3) {
    const n = this.n;
    const P = this.pts;
    const pos = this.pos.array as Float32Array;
    const al = this.alpha.array as Float32Array;
    let any = false;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - 1 - k + n * 2) % n;
      this.age[i] += dt;
      const a = this.age[i];
      // tangent from neighbours
      const iPrev = (this.head - 1 - Math.max(0, k - 1) + n * 2) % n;
      const iNext = (this.head - 1 - Math.min(this.count - 1, k + 1) + n * 2) % n;
      _t.set(P[iPrev * 3] - P[iNext * 3], P[iPrev * 3 + 1] - P[iNext * 3 + 1], P[iPrev * 3 + 2] - P[iNext * 3 + 2]);
      _v.set(P[i * 3] - cam.x, P[i * 3 + 1] - cam.y, P[i * 3 + 2] - cam.z);
      _s.crossVectors(_t, _v);
      const l = _s.length();
      if (l > 1e-6) _s.multiplyScalar(1 / l);
      else _s.set(0, 1, 0);
      const w = (this.w0 + a * this.spread) * 0.5;
      pos[k * 6] = P[i * 3] + _s.x * w;
      pos[k * 6 + 1] = P[i * 3 + 1] + _s.y * w;
      pos[k * 6 + 2] = P[i * 3 + 2] + _s.z * w;
      pos[k * 6 + 3] = P[i * 3] - _s.x * w;
      pos[k * 6 + 4] = P[i * 3 + 1] - _s.y * w;
      pos[k * 6 + 5] = P[i * 3 + 2] - _s.z * w;
      const life = Math.max(0, 1 - a / this.life);
      const fadeIn = Math.min(1, k / 3);
      const alpha = this.inten[i] * life * life * fadeIn;
      if (alpha > 0.003) any = true;
      al[k * 2] = alpha;
      al[k * 2 + 1] = alpha;
    }
    this.pos.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.mesh.visible = any;
    this.mesh.geometry.setDrawRange(0, Math.max(0, this.count - 1) * 6);
  }
}

import * as THREE from "three";

/**
 * Thin camera-facing ribbon that draws a web strand between the hand and the
 * anchor, with a slack sag that tightens under tension and a "shoot-out"
 * extension when fired. Fixed-size buffers, no per-frame allocation.
 */
const SEG = 16;

const _a = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _prev = new THREE.Vector3();

export class WebRibbon {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private pts: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor() {
    const n = SEG + 1;
    this.pos = new Float32Array(n * 2 * 3);
    this.pts = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uv[i * 4] = 0;
      uv[i * 4 + 1] = i / SEG;
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = i / SEG;
      if (i < SEG) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color("#f3f6ff") } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float x = abs(vUv.x - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.35, 1.0, x);
          // faint fibre twist along the strand
          float fibre = 0.85 + 0.15 * sin(vUv.y * 900.0 + vUv.x * 6.0);
          gl_FragColor = vec4(uColor * fibre, core * 0.92);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * @param hand   start (hand)
   * @param anchor end (building)
   * @param extend 0..1 how far the strand has shot out
   * @param slack  0 = taut, 1 = loose
   */
  update(hand: THREE.Vector3, anchor: THREE.Vector3, cam: THREE.Vector3, extend: number, slack: number, time: number) {
    const n = SEG + 1;
    _a.copy(anchor).sub(hand);
    const len = _a.length() * extend;
    const sag = len * (0.012 + 0.09 * slack);
    const wob = slack * 0.25;
    for (let i = 0; i < n; i++) {
      const t = i / SEG;
      _p.copy(hand).addScaledVector(_a, t * extend);
      const bell = 4 * t * (1 - t);
      _p.y -= sag * bell;
      if (wob > 0) {
        _p.x += Math.sin(time * 23 + t * 9) * wob * bell;
        _p.z += Math.cos(time * 19 + t * 7) * wob * bell;
      }
      this.pts[i * 3] = _p.x;
      this.pts[i * 3 + 1] = _p.y;
      this.pts[i * 3 + 2] = _p.z;
    }
    for (let i = 0; i < n; i++) {
      _p.fromArray(this.pts, i * 3);
      // tangent
      const j0 = Math.max(0, i - 1);
      const j1 = Math.min(SEG, i + 1);
      _prev.fromArray(this.pts, j0 * 3);
      _t.fromArray(this.pts, j1 * 3).sub(_prev).normalize();
      _v.copy(cam).sub(_p);
      const dist = _v.length();
      _s.crossVectors(_t, _v).normalize();
      // keep ~1.3 px on screen far away, 2.5 cm up close
      const w = Math.max(0.022, dist * 0.0022);
      this.pos[i * 6] = _p.x - _s.x * w;
      this.pos[i * 6 + 1] = _p.y - _s.y * w;
      this.pos[i * 6 + 2] = _p.z - _s.z * w;
      this.pos[i * 6 + 3] = _p.x + _s.x * w;
      this.pos[i * 6 + 4] = _p.y + _s.y * w;
      this.pos[i * 6 + 5] = _p.z + _s.z * w;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

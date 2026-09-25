import * as THREE from "three";

/**
 * Small web "splats" left on the wall where a strand sticks. A fixed pool of
 * quads (reused round-robin) with a procedural canvas texture; each fades out
 * after a few seconds. Only the live ones are visible, so it costs a draw
 * call or two in practice.
 */
const POOL = 8;
const LIFE = 7;

function splatTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineCap = "round";
  const spokes = 11;
  const ang: number[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < spokes; i++) ang.push((i / spokes) * Math.PI * 2 + (rnd() - 0.5) * 0.35);
  // spokes
  g.lineWidth = 2.4;
  for (const a of ang) {
    const r = 44 + rnd() * 16;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    g.stroke();
  }
  // sagging rings between the spokes
  g.lineWidth = 1.5;
  for (let ring = 1; ring <= 4; ring++) {
    const r = ring * 11 + 2;
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a0 = ang[i % spokes];
      const a1 = ang[(i + 1) % spokes] + (i + 1 >= spokes ? Math.PI * 2 : 0);
      const x0 = Math.cos(a0) * r;
      const y0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r;
      const y1 = Math.sin(a1) * r;
      const am = (a0 + a1) / 2;
      const rm = r * 0.8;
      if (i === 0) g.moveTo(x0, y0);
      g.quadraticCurveTo(Math.cos(am) * rm, Math.sin(am) * rm, x1, y1);
    }
    g.stroke();
  }
  // dense blob in the middle
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 12);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 12, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

export class WebSplats {
  group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private age = new Float32Array(POOL).fill(LIFE);
  private next = 0;
  private geo = new THREE.PlaneGeometry(1, 1);
  private tex = splatTexture();

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(
        this.geo,
        new THREE.MeshStandardMaterial({
          map: this.tex,
          transparent: true,
          depthWrite: false,
          roughness: 0.8,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      m.visible = false;
      m.renderOrder = 1;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  /** stick a splat at `p` on a surface with outward normal (nx, ny, nz) */
  add(p: THREE.Vector3, nx: number, ny: number, nz: number, size = 1.3) {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    const m = this.meshes[i];
    _n.set(nx, ny, nz).normalize();
    m.position.copy(p).addScaledVector(_n, 0.03);
    m.quaternion.setFromUnitVectors(_z, _n);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size * (0.85 + Math.random() * 0.3));
    m.visible = true;
    this.age[i] = 0;
    (m.material as THREE.MeshStandardMaterial).opacity = 1;
  }

  /** draw every splat once, fully transparent (primes the GPU pipeline) */
  prime(on: boolean) {
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] < LIFE) continue;
      const m = this.meshes[i];
      m.visible = on;
      (m.material as THREE.MeshStandardMaterial).opacity = 0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      const m = this.meshes[i];
      const a = this.age[i];
      // pop in, hold, fade
      const s = Math.min(1, a / 0.08);
      (m.material as THREE.MeshStandardMaterial).opacity = s * (1 - Math.max(0, (a - LIFE + 1.5) / 1.5));
      if (a >= LIFE) m.visible = false;
    }
  }

  dispose() {
    this.geo.dispose();
    this.tex.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

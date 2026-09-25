"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Building, CityData } from "./cityGen";
import { getFacadeMaterial, makeFacadeAttributes } from "./facade";
import {
  asphaltTexture,
  grassTexture,
  lampGeometries,
  pavingTexture,
  roadMarkingTexture,
  treeGeometries,
} from "./streetAssets";

/** Soft radial glow (light pools, halos). */
export function makeGlowTexture(inner = "rgba(255,255,255,0.9)", outer = "rgba(255,255,255,0)"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

type Setter<T> = (item: T, o: THREE.Object3D, i: number) => void;

/** Write instance matrices for `list` into an InstancedMesh ref. */
function useInstanceLayout<T>(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  list: T[],
  set: Setter<T>,
  color?: (item: T, c: THREE.Color, i: number) => void
) {
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    list.forEach((item, i) => {
      tmp.position.set(0, 0, 0);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      set(item, tmp, i);
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
      if (color) {
        color(item, tmpColor, i);
        im.setColorAt(i, tmpColor);
      }
    });
    im.count = list.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
}

interface Volume {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  style: number;
  seed: number;
  solid?: boolean;
}

function parapetsFor(b: Building): Volume[] {
  const t = 0.35;
  const ph = 1.1;
  const base = { y0: b.h, h: b.h + ph, style: b.style, seed: b.seed, solid: true };
  return [
    { ...base, x: b.x, z: b.z + b.d / 2 - t / 2, w: b.w, d: t },
    { ...base, x: b.x, z: b.z - b.d / 2 + t / 2, w: b.w, d: t },
    { ...base, x: b.x + b.w / 2 - t / 2, z: b.z, w: t, d: b.d - t * 2 },
    { ...base, x: b.x - b.w / 2 + t / 2, z: b.z, w: t, d: b.d - t * 2 },
  ];
}

export default function City({
  city,
  night = 0,
}: {
  city: CityData;
  /** 0 = day … 1 = night: lit windows, glowing lamps and storefronts */
  night?: number;
  /** @deprecated kept for older call sites */
  lampSpacing?: number;
  /** @deprecated kept for older call sites */
  billboards?: number;
}) {
  const facade = getFacadeMaterial();
  facade.uniforms.uNight.value = night;

  // ---------- buildings (+ skyline + parapets) in a single instanced draw ----------
  const volumes = useMemo<Volume[]>(() => {
    const out: Volume[] = [...city.buildings, ...city.skyline];
    for (const b of city.buildings) if (b.top && b.w > 6) out.push(...parapetsFor(b));
    return out;
  }, [city]);

  const buildingGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const { aBox, aParams } = makeFacadeAttributes(volumes);
    g.setAttribute("aBox", aBox);
    g.setAttribute("aParams", aParams);
    return g;
  }, [volumes]);

  const buildingRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(buildingRef, volumes, (b, o) => {
    o.position.set(b.x, (b.y0 + b.h) / 2, b.z);
    o.scale.set(b.w, b.h - b.y0, b.d);
  });

  // ---------- ground + road markings ----------
  const groundMat = useMemo(() => {
    const t = asphaltTexture().clone();
    const s = city.size + 4;
    t.repeat.set(s / 8, s / 8);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.93, metalness: 0, color: "#ffffff" });
  }, [city.size]);

  const segments = useMemo(() => {
    const out: { x: number; z: number; rotY: number }[] = [];
    const half = city.size / 2;
    const cell = city.blockSize + city.roadWidth;
    const pz = city.plaza;
    for (const r of city.roads) {
      for (let i = 0; i < city.blocks; i++) {
        const c = -half + city.roadWidth + city.blockSize / 2 + i * cell;
        const x = r.axis === "x" ? c : r.pos;
        const z = r.axis === "x" ? r.pos : c;
        if (pz && Math.abs(x - pz.x) < pz.w / 2 && Math.abs(z - pz.z) < pz.d / 2) continue;
        out.push({ x, z, rotY: r.axis === "x" ? 0 : Math.PI / 2 });
      }
    }
    return out;
  }, [city]);
  const markMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: roadMarkingTexture(city.blockSize, city.roadWidth),
        transparent: true,
        roughness: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [city.blockSize, city.roadWidth]
  );
  const markRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(markRef, segments, (s, o) => {
    o.position.set(s.x, 0.02, s.z);
    o.rotation.set(-Math.PI / 2, 0, s.rotY);
  });

  // outskirts: four bands that butt up against the street grid's ground plane
  // (same height, no overlap — overlapping coplanar planes z-fight/flicker)
  const outskirts = useMemo(() => {
    const half = city.size / 2 + 2;
    const far = 6000;
    const w = far * 2;
    const band = far - half;
    return [
      { x: 0, z: -(half + band / 2), w, d: band },
      { x: 0, z: half + band / 2, w, d: band },
      { x: -(half + band / 2), z: 0, w: band, d: half * 2 },
      { x: half + band / 2, z: 0, w: band, d: half * 2 },
    ];
  }, [city.size]);
  // plain colour: a finely repeated texture this far out only shimmers
  const outskirtMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7d7b76", roughness: 0.97 }), []);

  // ---------- sidewalks / parks ----------
  // one box per block: concrete curb sides with the paving on its top face
  // (a separate paving plane 2 mm above the box top used to z-fight)
  const curbRef = useRef<THREE.InstancedMesh>(null);
  const parkRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(curbRef, city.blockCenters, (c, o) => {
    o.position.set(c.x, 0.09, c.z);
    o.scale.set(city.blockSize, 0.18, city.blockSize);
  });
  // parks are raised 12 cm planters with a grass top
  useInstanceLayout(parkRef, city.parks, (p, o) => {
    o.position.set(p.x, 0.24, p.z);
    o.scale.set(p.w, 0.12, p.d);
  });
  const curbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a3a19b", roughness: 0.9 }), []);
  const planterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8d8a83", roughness: 0.92 }), []);
  const paveMat = useMemo(() => {
    const t = pavingTexture().clone();
    t.repeat.set(city.blockSize / 2, city.blockSize / 2);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  }, [city.blockSize]);
  // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
  const blockMats = useMemo(() => [curbMat, curbMat, paveMat, curbMat, curbMat, curbMat], [curbMat, paveMat]);
  const grassMat = useMemo(() => {
    const t = grassTexture().clone();
    t.repeat.set(city.blockSize / 4, city.blockSize / 4);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
  }, [city.blockSize]);
  const parkMats = useMemo(() => [planterMat, planterMat, grassMat, planterMat, planterMat, planterMat], [planterMat, grassMat]);

  // ---------- lamps ----------
  const lamp = lampGeometries();
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const lampSet: Setter<CityData["lamps"][number]> = (l, o) => {
    o.position.set(l.x, 0.18, l.z);
    o.rotation.set(0, l.rotY, 0);
  };
  useInstanceLayout(poleRef, city.lamps, lampSet);
  useInstanceLayout(headRef, city.lamps, lampSet);
  useInstanceLayout(poolRef, city.lamps, (l, o) => {
    o.position.set(l.x + Math.sin(l.rotY) * 2.4, 0.03, l.z + Math.cos(l.rotY) * 2.4);
    o.rotation.set(-Math.PI / 2, 0, 0);
    o.scale.set(13, 13, 1);
  });
  const glowTex = useMemo(() => makeGlowTexture("rgba(255,214,160,0.9)"), []);

  // ---------- roof clutter ----------
  const hvacRef = useRef<THREE.InstancedMesh>(null);
  const tankRef = useRef<THREE.InstancedMesh>(null);
  const antRef = useRef<THREE.InstancedMesh>(null);
  const tipRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(
    hvacRef,
    city.hvac,
    (p, o) => {
      o.position.set(p.x, p.y + p.h / 2, p.z);
      o.scale.set(p.w, p.h, p.d);
    },
    (p, c) => {
      const k = ((p.x * 13.1 + p.z * 7.7) % 1 + 1) % 1;
      c.setRGB(0.55 + k * 0.2, 0.56 + k * 0.2, 0.57 + k * 0.2);
    }
  );
  useInstanceLayout(tankRef, city.tanks, (p, o) => {
    o.position.set(p.x, p.y + p.h / 2 + 0.6, p.z);
    o.scale.set(p.w, p.h, p.d);
  });
  useInstanceLayout(antRef, city.antennas, (p, o) => {
    o.position.set(p.x, p.y + p.h / 2, p.z);
    o.scale.set(1, p.h, 1);
  });
  useInstanceLayout(tipRef, city.antennas, (p, o) => {
    o.position.set(p.x, p.y + p.h + 0.2, p.z);
  });

  const n = (len: number) => Math.max(1, len);
  const lampOn = night > 0.5;

  return (
    <group>
      {/* ground: asphalt over the street grid only; the outskirts bands continue it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow material={groundMat}>
        <planeGeometry args={[city.size + 4, city.size + 4]} />
      </mesh>

      {outskirts.map((o, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[o.x, 0, o.z]} material={outskirtMat} receiveShadow>
          <planeGeometry args={[o.w, o.d]} />
        </mesh>
      ))}

      <instancedMesh ref={markRef} args={[undefined, undefined, n(segments.length)]} material={markMat} receiveShadow>
        <planeGeometry args={[city.blockSize, city.roadWidth]} />
      </instancedMesh>

      {/* sidewalks: one box per block, paving on top */}
      <instancedMesh ref={curbRef} args={[undefined, undefined, n(city.blockCenters.length)]} material={blockMats} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={parkRef} args={[undefined, undefined, n(city.parks.length)]} material={parkMats} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>

      {/* buildings */}
      <instancedMesh
        ref={buildingRef}
        args={[buildingGeo, facade.material, volumes.length]}
        castShadow
        receiveShadow
      />

      {/* roof clutter */}
      <instancedMesh ref={hvacRef} args={[undefined, undefined, n(city.hvac.length)]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.55} metalness={0.4} />
      </instancedMesh>
      <instancedMesh ref={tankRef} args={[undefined, undefined, n(city.tanks.length)]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color="#6b5a48" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={antRef} args={[undefined, undefined, n(city.antennas.length)]} castShadow>
        <cylinderGeometry args={[0.09, 0.16, 1, 6]} />
        <meshStandardMaterial color="#7a7c80" roughness={0.4} metalness={0.8} />
      </instancedMesh>
      <instancedMesh ref={tipRef} args={[undefined, undefined, n(city.antennas.length)]}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color="#ff3b30" emissive="#ff2a1f" emissiveIntensity={1.5 + night * 6} />
      </instancedMesh>

      <Trees trees={city.trees} />
      <BoundaryWall city={city} night={night} />

      {/* street lamps */}
      <instancedMesh ref={poleRef} args={[lamp.pole, undefined, n(city.lamps.length)]} castShadow>
        <meshStandardMaterial color="#3b3e42" roughness={0.45} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[lamp.head, undefined, n(city.lamps.length)]}>
        <meshStandardMaterial
          color={lampOn ? "#fff1d6" : "#d9d9d4"}
          emissive="#ffd9a0"
          emissiveIntensity={lampOn ? 9 * night : 0}
          toneMapped={!lampOn}
        />
      </instancedMesh>
      <instancedMesh ref={poolRef} args={[undefined, undefined, n(city.lamps.length)]} visible={lampOn}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          opacity={0.32 * night}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

const TREE_NEAR = 150; // metres: detailed crowns inside, coarse ones beyond
const TREE_REFRESH = 0.25; // seconds between LOD re-sorts

/**
 * Street trees with two levels of detail. Every tree's matrix/colour is built
 * once; a few times a second trees are re-sorted into a "near" (detailed) and a
 * "far" (coarse) instanced mesh by distance to the camera.
 *
 * Shadows come from an invisible proxy: the coarse crown (≈140 triangles
 * instead of ≈2400), only for the near trees (the shadow map only covers the
 * area around the player anyway). The detailed crowns were most of the
 * shadow pass's triangles.
 */
function Trees({ trees }: { trees: CityData["trees"] }) {
  const geo = treeGeometries();
  const nearTrunk = useRef<THREE.InstancedMesh>(null);
  const nearCrown = useRef<THREE.InstancedMesh>(null);
  const farTrunk = useRef<THREE.InstancedMesh>(null);
  const farCrown = useRef<THREE.InstancedMesh>(null);
  const shadowCrown = useRef<THREE.InstancedMesh>(null);
  const clock = useRef({ t: TREE_REFRESH, x: 1e9, z: 1e9 });

  const data = useMemo(() => {
    const trunk = new Float32Array(trees.length * 16);
    const crown = new Float32Array(trees.length * 16);
    const shadow = new Float32Array(trees.length * 16);
    const color = new Float32Array(trees.length * 3);
    trees.forEach((t, i) => {
      tmp.position.set(t.x, 0.18, t.z);
      tmp.rotation.set(0, t.r, 0);
      tmp.scale.setScalar(t.s);
      tmp.updateMatrix();
      tmp.matrix.toArray(trunk, i * 16);
      tmp.scale.set(t.s, t.s * (0.9 + (t.r % 0.3)), t.s);
      tmp.updateMatrix();
      tmp.matrix.toArray(crown, i * 16);
      // shadow proxy: slightly inside the detailed crown so it never darkens its lit side
      tmp.scale.multiplyScalar(0.88);
      tmp.updateMatrix();
      tmp.matrix.toArray(shadow, i * 16);
      const k = (t.r * 7.13) % 1;
      color.set([0.22 + k * 0.12, 0.36 + k * 0.12, 0.14 + k * 0.05], i * 3);
    });
    return { trunk, crown, shadow, color };
  }, [trees]);

  useFrame(({ camera }, dt) => {
    const c = clock.current;
    c.t += dt;
    const moved = Math.abs(camera.position.x - c.x) + Math.abs(camera.position.z - c.z);
    if (c.t < TREE_REFRESH || moved < 4) return;
    c.t = 0;
    c.x = camera.position.x;
    c.z = camera.position.z;
    const nt = nearTrunk.current;
    const nc = nearCrown.current;
    const ft = farTrunk.current;
    const fc = farCrown.current;
    const sc = shadowCrown.current;
    if (!nt || !nc || !ft || !fc || !sc) return;
    const near2 = TREE_NEAR * TREE_NEAR;
    let n = 0;
    let f = 0;
    for (let i = 0; i < trees.length; i++) {
      const dx = trees[i].x - c.x;
      const dz = trees[i].z - c.z;
      const isNear = dx * dx + dz * dz < near2;
      const j = isNear ? n++ : f++;
      const t = isNear ? nt : ft;
      const cr = isNear ? nc : fc;
      (t.instanceMatrix.array as Float32Array).set(data.trunk.subarray(i * 16, i * 16 + 16), j * 16);
      (cr.instanceMatrix.array as Float32Array).set(data.crown.subarray(i * 16, i * 16 + 16), j * 16);
      (cr.instanceColor!.array as Float32Array).set(data.color.subarray(i * 3, i * 3 + 3), j * 3);
      if (isNear) (sc.instanceMatrix.array as Float32Array).set(data.shadow.subarray(i * 16, i * 16 + 16), j * 16);
    }
    nt.count = nc.count = sc.count = n;
    ft.count = fc.count = f;
    for (const m of [nt, nc, ft, fc, sc]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  });

  // instanceColor has to exist before the first sort writes into it
  useLayoutEffect(() => {
    for (const m of [nearCrown.current, farCrown.current]) {
      if (m && !m.instanceColor) m.setColorAt(0, tmpColor.setRGB(0.3, 0.42, 0.18));
      if (m) m.count = 0;
    }
    if (nearTrunk.current) nearTrunk.current.count = 0;
    if (shadowCrown.current) shadowCrown.current.count = 0;
    if (farTrunk.current) farTrunk.current.count = 0;
    clock.current.x = 1e9;
  }, [data]);

  const cap = Math.max(1, trees.length);
  return (
    <>
      <instancedMesh ref={nearTrunk} args={[geo.trunk, undefined, cap]} castShadow>
        <meshStandardMaterial color="#4a3a2c" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={nearCrown} args={[geo.crown, undefined, cap]} receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={farTrunk} args={[geo.trunkFar, undefined, cap]}>
        <meshStandardMaterial color="#4a3a2c" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={farCrown} args={[geo.crownFar, undefined, cap]}>
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
      {/* shadow-only: writes nothing to the screen, only to the shadow map */}
      <instancedMesh ref={shadowCrown} args={[geo.crownFar, undefined, cap]} castShadow>
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Play-area boundary: red/white jersey barriers, a chain-link fence    */
/* above them and hazard chevron boards, all along ±bounds.max.         */
/* ------------------------------------------------------------------ */

const SEG = 4; // barrier segment length (m)

function jerseyGeometry(): THREE.BufferGeometry {
  // classic New-Jersey profile, 0.6 m wide at the foot, 0.9 m tall
  const sh = new THREE.Shape();
  sh.moveTo(-0.3, 0);
  sh.lineTo(0.3, 0);
  sh.lineTo(0.26, 0.08);
  sh.lineTo(0.12, 0.3);
  sh.lineTo(0.1, 0.9);
  sh.lineTo(-0.1, 0.9);
  sh.lineTo(-0.12, 0.3);
  sh.lineTo(-0.26, 0.08);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: SEG - 0.06, bevelEnabled: false });
  g.translate(0, 0, -(SEG - 0.06) / 2);
  g.computeVertexNormals();
  return g;
}

function fenceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(200,205,210,0.95)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffd400";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#0a0a0a";
  for (let i = -1; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 52, 0);
    g.lineTo(i * 52 + 26, 0);
    g.lineTo(i * 52 + 52, 64);
    g.lineTo(i * 52 + 26, 128);
    g.lineTo(i * 52, 128);
    g.lineTo(i * 52 + 26, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function BoundaryWall({ city, night }: { city: CityData; night: number }) {
  const m = city.bounds.max;
  const inner = m - 0.4; // barrier centre line (its inner face is ~0.8 m inside the edge)

  const barriers = useMemo(() => {
    const out: { x: number; z: number; rotY: number; i: number }[] = [];
    const n = Math.floor((2 * m) / SEG);
    const start = -m + (2 * m - n * SEG) / 2 + SEG / 2;
    for (let k = 0; k < n; k++) {
      const t = start + k * SEG;
      out.push({ x: t, z: inner, rotY: Math.PI / 2, i: k });
      out.push({ x: t, z: -inner, rotY: Math.PI / 2, i: k + 1 });
      out.push({ x: inner, z: t, rotY: 0, i: k });
      out.push({ x: -inner, z: t, rotY: 0, i: k + 1 });
    }
    return out;
  }, [m, inner]);

  const signs = useMemo(() => {
    const out: { x: number; z: number; rotY: number }[] = [];
    const step = 22;
    for (let t = -m + 11; t < m - 5; t += step) {
      out.push({ x: t, z: inner - 0.05, rotY: Math.PI }); // faces -z (inwards)
      out.push({ x: t, z: -inner + 0.05, rotY: 0 });
      out.push({ x: inner - 0.05, z: t, rotY: -Math.PI / 2 });
      out.push({ x: -inner + 0.05, z: t, rotY: Math.PI / 2 });
    }
    return out;
  }, [m, inner]);

  const barrierGeo = useMemo(() => jerseyGeometry(), []);
  const barrierRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(
    barrierRef,
    barriers,
    (b, o) => {
      o.position.set(b.x, 0, b.z);
      o.rotation.set(0, b.rotY, 0);
    },
    (b, c) => (b.i % 2 === 0 ? c.set("#c8322a") : c.set("#e9e7e2"))
  );

  const signRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(signRef, signs, (sg, o) => {
    o.position.set(sg.x, 1.55, sg.z);
    o.rotation.set(0, sg.rotY, 0);
  });
  const postRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(postRef, signs, (sg, o) => {
    o.position.set(sg.x - Math.sin(sg.rotY) * 0.08, 1.0, sg.z - Math.cos(sg.rotY) * 0.08);
  });

  const mats = useMemo(() => {
    const fence = fenceTexture();
    fence.repeat.set((2 * m) / 1.2, 3 / 1.2);
    return {
      // a little self-illumination at night so the edge still reads in the dark
      barrier: new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.75,
        emissive: new THREE.Color().setScalar(night * 0.05),
      }),
      fence: new THREE.MeshStandardMaterial({
        map: fence,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.6,
      }),
      rail: new THREE.MeshStandardMaterial({ color: "#8b9096", roughness: 0.4, metalness: 0.8 }),
      sign: new THREE.MeshStandardMaterial({
        map: chevronTexture(),
        emissive: "#ffd400",
        emissiveIntensity: 0.12 + night * 0.35,
        roughness: 0.5,
      }),
      post: new THREE.MeshStandardMaterial({ color: "#3b3e42", roughness: 0.5, metalness: 0.6 }),
    };
  }, [m, night]);

  const sides = useMemo(
    () => [
      { x: 0, z: inner, rotY: 0 },
      { x: 0, z: -inner, rotY: 0 },
      { x: inner, z: 0, rotY: Math.PI / 2 },
      { x: -inner, z: 0, rotY: Math.PI / 2 },
    ],
    [inner]
  );

  return (
    <group>
      <instancedMesh ref={barrierRef} args={[barrierGeo, mats.barrier, barriers.length]} castShadow receiveShadow />
      {/* chain-link fence + top rail above the barriers */}
      {sides.map((sd, i) => (
        <group key={i} position={[sd.x, 0, sd.z]} rotation={[0, sd.rotY, 0]}>
          <mesh position={[0, 2.4, 0]} material={mats.fence}>
            <planeGeometry args={[2 * m, 3]} />
          </mesh>
          <mesh position={[0, 3.9, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.rail}>
            <cylinderGeometry args={[0.04, 0.04, 2 * m, 6]} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={signRef} args={[undefined, mats.sign, Math.max(1, signs.length)]}>
        <planeGeometry args={[1.6, 0.8]} />
      </instancedMesh>
      <instancedMesh ref={postRef} args={[undefined, mats.post, Math.max(1, signs.length)]}>
        <boxGeometry args={[0.08, 2.0, 0.08]} />
      </instancedMesh>
    </group>
  );
}

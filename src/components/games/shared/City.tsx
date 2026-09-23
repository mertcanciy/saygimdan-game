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
    const s = city.size + 12000;
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
    o.position.set(s.x, 0.015, s.z);
    o.rotation.set(-Math.PI / 2, 0, s.rotY);
  });

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
  const outskirtMat = useMemo(() => {
    const t = pavingTexture().clone();
    t.repeat.set(1500, 1500);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: "#b9b6ae", roughness: 0.95 });
  }, []);

  // ---------- sidewalks / parks ----------
  const curbRef = useRef<THREE.InstancedMesh>(null);
  const paveRef = useRef<THREE.InstancedMesh>(null);
  const parkRef = useRef<THREE.InstancedMesh>(null);
  useInstanceLayout(curbRef, city.blockCenters, (c, o) => {
    o.position.set(c.x, 0.09, c.z);
    o.scale.set(city.blockSize, 0.18, city.blockSize);
  });
  useInstanceLayout(paveRef, city.blockCenters, (c, o) => {
    o.position.set(c.x, 0.182, c.z);
    o.rotation.set(-Math.PI / 2, 0, 0);
    o.scale.set(city.blockSize - 0.5, city.blockSize - 0.5, 1);
  });
  useInstanceLayout(parkRef, city.parks, (p, o) => {
    o.position.set(p.x, 0.19, p.z);
    o.rotation.set(-Math.PI / 2, 0, 0);
    o.scale.set(p.w, p.d, 1);
  });
  const paveMat = useMemo(() => {
    const t = pavingTexture().clone();
    t.repeat.set(city.blockSize / 2, city.blockSize / 2);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  }, [city.blockSize]);
  const grassMat = useMemo(() => {
    const t = grassTexture().clone();
    t.repeat.set(city.blockSize / 4, city.blockSize / 4);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
  }, [city.blockSize]);

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
      {/* ground (asphalt everywhere; sidewalks sit on top) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow material={groundMat}>
        <planeGeometry args={[city.size + 12000, city.size + 12000]} />
      </mesh>

      {/* outskirts: paved ground around the street grid so the skyline doesn't stand in a parking lot */}
      {outskirts.map((o, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[o.x, 0.012, o.z]} material={outskirtMat} receiveShadow>
          <planeGeometry args={[o.w, o.d]} />
        </mesh>
      ))}

      <instancedMesh ref={markRef} args={[undefined, undefined, n(segments.length)]} material={markMat} receiveShadow>
        <planeGeometry args={[city.blockSize, city.roadWidth]} />
      </instancedMesh>

      {/* sidewalks: curb slab + paving top */}
      <instancedMesh ref={curbRef} args={[undefined, undefined, n(city.blockCenters.length)]} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#a3a19b" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={paveRef} args={[undefined, undefined, n(city.blockCenters.length)]} material={paveMat} receiveShadow>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
      <instancedMesh ref={parkRef} args={[undefined, undefined, n(city.parks.length)]} material={grassMat} receiveShadow>
        <planeGeometry args={[1, 1]} />
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
 */
function Trees({ trees }: { trees: CityData["trees"] }) {
  const geo = treeGeometries();
  const nearTrunk = useRef<THREE.InstancedMesh>(null);
  const nearCrown = useRef<THREE.InstancedMesh>(null);
  const farTrunk = useRef<THREE.InstancedMesh>(null);
  const farCrown = useRef<THREE.InstancedMesh>(null);
  const clock = useRef({ t: TREE_REFRESH, x: 1e9, z: 1e9 });

  const data = useMemo(() => {
    const trunk = new Float32Array(trees.length * 16);
    const crown = new Float32Array(trees.length * 16);
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
      const k = (t.r * 7.13) % 1;
      color.set([0.22 + k * 0.12, 0.36 + k * 0.12, 0.14 + k * 0.05], i * 3);
    });
    return { trunk, crown, color };
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
    if (!nt || !nc || !ft || !fc) return;
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
    }
    nt.count = nc.count = n;
    ft.count = fc.count = f;
    for (const m of [nt, nc, ft, fc]) {
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
    if (farTrunk.current) farTrunk.current.count = 0;
    clock.current.x = 1e9;
  }, [data]);

  const cap = Math.max(1, trees.length);
  return (
    <>
      <instancedMesh ref={nearTrunk} args={[geo.trunk, undefined, cap]} castShadow>
        <meshStandardMaterial color="#4a3a2c" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={nearCrown} args={[geo.crown, undefined, cap]} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={farTrunk} args={[geo.trunkFar, undefined, cap]}>
        <meshStandardMaterial color="#4a3a2c" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={farCrown} args={[geo.crownFar, undefined, cap]} castShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
    </>
  );
}

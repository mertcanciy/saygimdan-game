"use client";

// Instanced traffic: one InstancedMesh per (body type × material slot),
// plus camera-facing light flares (directional: headlights only glow towards
// the viewer when the car faces them) and headlight beams on the road.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { buildCar, SLOTS, type CarGeometry, type CarType, type Slot } from "./carGeometry";
import { beamTexture, carMaterials, carMaterialsUnlit, flareTexture } from "./carMaterials";

export interface FleetCar {
  type: CarType;
  color: THREE.Color;
  x: number;
  y: number;
  z: number;
  rotY: number;
  visible: boolean;
  /** 0..1 extra taillight brightness (braking) */
  brake?: number;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

const FLARE_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 toCam = normalize(cameraPosition - position);
    float facing = dot(aDir, toCam);
    vA = smoothstep(-0.1, 0.55, facing) * exp(-(-mv.z) * 0.0025);
    vColor = aColor;
    gl_PointSize = aSize * uScale / max(0.5, -mv.z) * (0.6 + 0.4 * max(facing, 0.0));
    gl_Position = projectionMatrix * mv;
  }
`;
const FLARE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vA;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

interface TypeGroup {
  type: CarType;
  geo: CarGeometry;
  idx: number[];
  slots: Slot[];
}

export default function TrafficFleet({
  cars,
  flares = true,
  beams = true,
  shadows = false,
  lights = true,
}: {
  cars: FleetCar[];
  flares?: boolean;
  beams?: boolean;
  shadows?: boolean;
  /** false: parked cars (head / tail lights off) */
  lights?: boolean;
}) {
  const mats = lights ? carMaterials() : carMaterialsUnlit();
  const { size, viewport } = useThree();

  const groups = useMemo<TypeGroup[]>(() => {
    const map = new Map<CarType, number[]>();
    cars.forEach((c, i) => {
      const l = map.get(c.type) ?? [];
      l.push(i);
      map.set(c.type, l);
    });
    return [...map.entries()].map(([type, idx]) => {
      const geo = buildCar(type, 0);
      return { type, geo, idx, slots: SLOTS.filter((s) => geo.full[s]) };
    });
  }, [cars]);

  const meshRefs = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const carGeo = useMemo(() => cars.map((c) => buildCar(c.type, 0)), [cars]);
  const slotKeys = useMemo(() => groups.map((g) => g.slots.map((slot) => `${g.type}-${slot}`)), [groups]);

  // ---- flares ----
  const flareData = useMemo(() => {
    let n = 0;
    for (const c of cars) {
      const g = buildCar(c.type, 0);
      n += g.headLights.length + g.tailLights.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aDir", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: flareTexture() }, uScale: { value: 500 } },
      vertexShader: FLARE_VERT,
      fragmentShader: FLARE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo, mat, n };
  }, [cars]);

  // ---- beams ----
  const beamMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: beamTexture(),
        color: "#9fb4d8",
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );
  const tailPoolMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: beamTexture(),
        color: "#ff2a1a",
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );
  const beamGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const beamRef = useRef<THREE.InstancedMesh>(null);
  const tailRef = useRef<THREE.InstancedMesh>(null);
  const uScale = useRef<{ value: number } | null>(null);
  useEffect(() => {
    uScale.current = flareData.mat.uniforms.uScale as { value: number };
  }, [flareData]);

  useFrame(({ camera }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const dpr = size.width > 0 ? viewport.dpr : 1;
    if (uScale.current) uScale.current.value = (size.height * dpr * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const keys = slotKeys[gi];
      const n = g.idx.length;
      for (let k = 0; k < n; k++) {
        const c = cars[g.idx[k]];
        if (c.visible) {
          _q.setFromAxisAngle(_up, c.rotY);
          _m.compose(_p.set(c.x, c.y, c.z), _q, _s);
        } else _m.copy(_zero);
        for (let si = 0; si < keys.length; si++) {
          const im = meshRefs.current.get(keys[si]);
          if (!im) continue;
          im.setMatrixAt(k, _m);
          if (g.slots[si] === "paint") im.setColorAt(k, c.color);
        }
      }
      for (let si = 0; si < keys.length; si++) {
        const im = meshRefs.current.get(keys[si]);
        if (!im) continue;
        im.instanceMatrix.needsUpdate = true;
        if (g.slots[si] === "paint" && im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    // flares + beams
    const pa = flareData.geo.getAttribute("position") as THREE.BufferAttribute;
    const da = flareData.geo.getAttribute("aDir") as THREE.BufferAttribute;
    const ca = flareData.geo.getAttribute("aColor") as THREE.BufferAttribute;
    const sa = flareData.geo.getAttribute("aSize") as THREE.BufferAttribute;
    let f = 0;
    const bm = beamRef.current;
    const tm = tailRef.current;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const geo = carGeo[i];
      const s = Math.sin(c.rotY);
      const co = Math.cos(c.rotY);
      const brake = c.brake ?? 0;
      for (const hl of geo.headLights) {
        const lx = hl.x;
        const lz = hl.z + 0.12;
        pa.setXYZ(f, c.x + co * lx + s * lz, c.y + hl.y, c.z - s * lx + co * lz);
        da.setXYZ(f, s, 0, co);
        ca.setXYZ(f, c.visible ? 1.0 : 0, c.visible ? 0.96 : 0, c.visible ? 0.9 : 0);
        sa.setX(f, geo.spec.W > 2.2 ? 1.5 : 1.25);
        f++;
      }
      for (const tl of geo.tailLights) {
        const lx = tl.x;
        const lz = tl.z - 0.12;
        pa.setXYZ(f, c.x + co * lx + s * lz, c.y + tl.y, c.z - s * lx + co * lz);
        da.setXYZ(f, -s, 0, -co);
        const k = c.visible ? 0.55 + brake * 0.9 : 0;
        ca.setXYZ(f, k, k * 0.06, k * 0.04);
        sa.setX(f, 0.9 + brake * 0.5);
        f++;
      }
      if (bm) {
        if (c.visible) {
          const len = 16;
          const wid = geo.spec.W * 3.2;
          const off = geo.spec.L / 2 + len / 2 - 0.3;
          _q.setFromAxisAngle(_up, c.rotY);
          _v.set(s * off, 0, co * off);
          _m2.compose(_p.set(c.x + _v.x, 0.05, c.z + _v.z), _q, _s.set(wid, 1, len));
          _s.set(1, 1, 1);
          bm.setMatrixAt(i, _m2);
        } else bm.setMatrixAt(i, _zero);
      }
      if (tm) {
        if (c.visible) {
          const len = 4.5;
          const off = -(geo.spec.L / 2 + len / 2 - 0.2);
          _q.setFromAxisAngle(_up, c.rotY + Math.PI);
          _v.set(s * off, 0, co * off);
          _m2.compose(_p.set(c.x + _v.x, 0.05, c.z + _v.z), _q, _s.set(geo.spec.W * 1.6, 1, len));
          _s.set(1, 1, 1);
          tm.setMatrixAt(i, _m2);
        } else tm.setMatrixAt(i, _zero);
      }
    }
    pa.needsUpdate = da.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
    if (bm) bm.instanceMatrix.needsUpdate = true;
    if (tm) tm.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {groups.map((g) =>
        g.slots.map((slot) => (
          <instancedMesh
            key={`${g.type}-${slot}`}
            ref={(im) => {
              if (im) meshRefs.current.set(`${g.type}-${slot}`, im);
              else meshRefs.current.delete(`${g.type}-${slot}`);
            }}
            args={[g.geo.full[slot], mats[slot], g.idx.length]}
            frustumCulled={false}
            castShadow={shadows && (slot === "paint" || slot === "panel")}
            receiveShadow={false}
          />
        ))
      )}
      {beams && (
        <>
          <instancedMesh ref={beamRef} args={[beamGeo, beamMat, cars.length]} frustumCulled={false} renderOrder={2} />
          <instancedMesh ref={tailRef} args={[beamGeo, tailPoolMat, cars.length]} frustumCulled={false} renderOrder={2} />
        </>
      )}
      {flares && <points geometry={flareData.geo} material={flareData.mat} frustumCulled={false} renderOrder={3} />}
    </group>
  );
}

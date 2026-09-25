"use client";

// Instanced traffic: one InstancedMesh per (body type × material slot),
// plus camera-facing light flares (directional: headlights only glow towards
// the viewer when the car faces them) and headlight beams on the road.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
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
  /** turn signal: +1 = car's right, -1 = car's left, 0 / undefined = off */
  blink?: number;
  /** 0..1 headlight flash (high beams) */
  flash?: number;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _size = new THREE.Vector2();

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
  dynamic = true,
}: {
  cars: FleetCar[];
  flares?: boolean;
  beams?: boolean;
  shadows?: boolean;
  /** false: parked cars (head / tail lights off) */
  lights?: boolean;
  /** false: cars never move — instance matrices are uploaded once, not per frame */
  dynamic?: boolean;
}) {
  const mats = lights ? carMaterials() : carMaterialsUnlit();

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
      n += g.headLights.length + g.tailLights.length + 2; // + front / rear turn signal
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

  // flare size depends on the target being drawn (main view or the small
  // rear-view mirror), so it is set right before each draw of the points
  const onFlaresRender = useMemo(
    () => (renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera) => {
      const u = uScale.current;
      if (!u) return;
      const rt = renderer.getRenderTarget();
      const h = rt ? rt.height : renderer.getDrawingBufferSize(_size).y;
      // projectionMatrix[5] = 1 / tan(fov / 2)
      u.value = h * 0.5 * camera.projectionMatrix.elements[5];
    },
    []
  );

  const writeMatrices = useCallback(() => {
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
  }, [groups, slotKeys, cars]);

  useLayoutEffect(() => {
    if (!dynamic) writeMatrices();
  }, [dynamic, writeMatrices]);

  useFrame(({ clock }) => {
    if (dynamic) writeMatrices();

    const bm = beamRef.current;
    const tm = tailRef.current;
    if (!flares && !bm && !tm) return;

    const tBlink = clock.elapsedTime * 1.6;
    const pa = flareData.geo.getAttribute("position") as THREE.BufferAttribute;
    const da = flareData.geo.getAttribute("aDir") as THREE.BufferAttribute;
    const ca = flareData.geo.getAttribute("aColor") as THREE.BufferAttribute;
    const sa = flareData.geo.getAttribute("aSize") as THREE.BufferAttribute;
    let f = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const geo = carGeo[i];
      const s = Math.sin(c.rotY);
      const co = Math.cos(c.rotY);
      const brake = c.brake ?? 0;
      const fl = c.flash ?? 0;
      const hk = c.visible ? 1 + fl * 1.6 : 0;
      if (flares) {
        for (const hl of geo.headLights) {
          const lx = hl.x;
          const lz = hl.z + 0.12;
          pa.setXYZ(f, c.x + co * lx + s * lz, c.y + hl.y, c.z - s * lx + co * lz);
          da.setXYZ(f, s, 0, co);
          ca.setXYZ(f, hk, hk * 0.96, hk * 0.9);
          sa.setX(f, (geo.spec.W > 2.2 ? 1.5 : 1.25) * (1 + fl * 0.8));
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
        // turn signals: next to the outermost head / tail lamp on the signalled
        // side (car's right = local -X), slightly outboard and above it
        {
          const b = c.blink ?? 0;
          const on = c.visible && b !== 0 && (tBlink + i * 0.37) % 1 < 0.55;
          const k = on ? 2.4 : 0;
          const side = b === 0 ? 1 : -b;
          for (let pass = 0; pass < 2; pass++) {
            const lamps = pass === 0 ? geo.headLights : geo.tailLights;
            let lx = side * (geo.spec.W / 2 - 0.1);
            let ly = pass === 0 ? 0.7 : 0.85;
            let lz = pass === 0 ? geo.spec.L / 2 : -geo.spec.L / 2;
            let best = -1;
            for (const lp of lamps) {
              if (lp.x * side > 0 && Math.abs(lp.x) > best) {
                best = Math.abs(lp.x);
                lx = lp.x;
                ly = lp.y;
                lz = lp.z;
              }
            }
            lx += side * 0.06;
            ly += pass === 0 ? 0.02 : -0.02;
            lz += pass === 0 ? 0.16 : -0.16;
            pa.setXYZ(f, c.x + co * lx + s * lz, c.y + ly, c.z - s * lx + co * lz);
            if (pass === 0) da.setXYZ(f, s, 0, co);
            else da.setXYZ(f, -s, 0, -co);
            ca.setXYZ(f, k * 1.25, k * 0.42, 0);
            sa.setX(f, 1.5);
            f++;
          }
        }
      }
      if (bm) {
        if (c.visible) {
          const len = 16 + fl * 10;
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
    if (flares) pa.needsUpdate = da.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
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
      {flares && (
        <points geometry={flareData.geo} material={flareData.mat} frustumCulled={false} renderOrder={3} onBeforeRender={onFlaresRender} />
      )}
    </group>
  );
}

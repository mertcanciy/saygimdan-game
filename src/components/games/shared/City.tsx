"use client";

import { useMemo, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { Stars } from "@react-three/drei";
import { mulberry32, type CityData } from "./city";

const PALETTE = ["#1b2138", "#232946", "#2a2038", "#1a2530", "#241d33"];

export function makeFacadeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14182a";
  g.fillRect(0, 0, 64, 128);
  const rand = mulberry32(99);
  for (let y = 6; y < 122; y += 10) {
    for (let x = 5; x < 60; x += 9) {
      const lit = rand();
      if (lit < 0.32) {
        g.fillStyle = rand() < 0.7 ? "#ffd9a0" : "#9fdcff";
      } else {
        g.fillStyle = "#0a0d18";
      }
      g.fillRect(x, y, 5, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101018";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#3a3a48";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(6, 0);
  g.lineTo(6, 64);
  g.moveTo(58, 0);
  g.lineTo(58, 64);
  g.stroke();
  g.strokeStyle = "#8a8a55";
  g.setLineDash([10, 12]);
  g.beginPath();
  g.moveTo(32, 0);
  g.lineTo(32, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

export default function City({ city }: { city: CityData }) {
  const buildingsRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const neonRef = useRef<THREE.InstancedMesh>(null);

  const facadeTex = useMemo(() => makeFacadeTexture(), []);
  const roadTex = useMemo(() => {
    const t = makeRoadTexture();
    // tile the asphalt strip along the road length
    t.repeat.set(city.size / 16, 1);
    return t;
  }, [city.size]);

  const lampPositions = useMemo(() => {
    const pts: { x: number; z: number }[] = [];
    const half = city.size / 2;
    for (const r of city.roads) {
      for (let t = -half + 12; t < half - 12; t += 25) {
        const side = ((Math.round(t / 25) % 2) * 2 - 1) * (city.roadWidth / 2 - 1);
        if (r.axis === "x") pts.push({ x: t, z: r.pos + side });
        else pts.push({ x: r.pos + side, z: t });
      }
    }
    return pts;
  }, [city]);

  const neonAccents = useMemo(() => {
    const rand = mulberry32(city.size | 0);
    const out: {
      x: number;
      y: number;
      z: number;
      len: number;
      alongZ: boolean;
      pink: boolean;
    }[] = [];
    const bs = city.buildings;
    for (let i = 0; i < 20 && bs.length > 0; i++) {
      const b = bs[Math.floor(rand() * bs.length)];
      const side = rand() < 0.5 ? 1 : -1;
      const alongZ = rand() < 0.5;
      out.push({
        x: b.x + (alongZ ? side * (b.w / 2 + 0.06) : 0),
        z: b.z + (alongZ ? 0 : side * (b.d / 2 + 0.06)),
        y: 8 + rand() * 12,
        len: (alongZ ? b.d : b.w) * 0.6,
        alongZ,
        pink: rand() < 0.5,
      });
    }
    return out;
  }, [city]);

  useLayoutEffect(() => {
    const im = buildingsRef.current;
    if (!im) return;
    city.buildings.forEach((b, i) => {
      tmpObj.position.set(b.x, b.h / 2, b.z);
      tmpObj.scale.set(b.w, b.h, b.d);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.updateMatrix();
      im.setMatrixAt(i, tmpObj.matrix);
      im.setColorAt(i, tmpColor.set(PALETTE[b.colorIdx % PALETTE.length]));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    const lm = lampRef.current;
    const pm = poleRef.current;
    if (lm && pm) {
      lampPositions.forEach((p, i) => {
        tmpObj.position.set(p.x, 5, p.z);
        tmpObj.scale.set(0.35, 0.35, 0.35);
        tmpObj.updateMatrix();
        lm.setMatrixAt(i, tmpObj.matrix);
        tmpObj.position.set(p.x, 2.5, p.z);
        tmpObj.scale.set(0.12, 5, 0.12);
        tmpObj.updateMatrix();
        pm.setMatrixAt(i, tmpObj.matrix);
      });
      lm.instanceMatrix.needsUpdate = true;
      pm.instanceMatrix.needsUpdate = true;
    }

    const nm = neonRef.current;
    if (nm) {
      neonAccents.forEach((n, i) => {
        tmpObj.position.set(n.x, n.y, n.z);
        // strip runs along the wall face
        if (n.alongZ) tmpObj.scale.set(0.12, 0.18, n.len);
        else tmpObj.scale.set(n.len, 0.18, 0.12);
        tmpObj.updateMatrix();
        nm.setMatrixAt(i, tmpObj.matrix);
        nm.setColorAt(i, tmpColor.set(n.pink ? "#ff2d95" : "#2de2ff"));
      });
      nm.instanceMatrix.needsUpdate = true;
      if (nm.instanceColor) nm.instanceColor.needsUpdate = true;
    }
  }, [city, lampPositions, neonAccents]);

  const roadSegments = useMemo(() => {
    return city.roads.map((r, i) => {
      const len = city.size;
      return (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, r.axis === "x" ? 0 : Math.PI / 2]}
          position={
            r.axis === "x" ? [0, 0.02, r.pos] : [r.pos, 0.02, 0]
          }
        >
          <planeGeometry args={[len, city.roadWidth]} />
          <meshBasicMaterial
            map={roadTex}
            color="#888888"
          />
        </mesh>
      );
    });
  }, [city, roadTex]);

  return (
    <group>
      <color attach="background" args={["#070714"]} />
      <fog attach="fog" args={["#070714", 150, 700]} />
      <Stars radius={600} depth={50} count={3000} factor={4} fade />

      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#4455aa", "#221133", 0.8]} />
      <directionalLight position={[200, 300, 100]} intensity={0.5} color="#8899ff" />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[city.size + 500, city.size + 500]} />
        <meshStandardMaterial color="#0b0b14" roughness={1} />
      </mesh>

      {roadSegments}

      {/* buildings */}
      <instancedMesh
        ref={buildingsRef}
        args={[undefined, undefined, city.buildings.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          emissiveMap={facadeTex}
          emissive="#ffffff"
          emissiveIntensity={0.9}
          roughness={0.8}
        />
      </instancedMesh>

      {/* street lamps */}
      <instancedMesh
        ref={lampRef}
        args={[undefined, undefined, lampPositions.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial
          color="#ffd28a"
          emissive="#ffd28a"
          emissiveIntensity={3}
        />
      </instancedMesh>
      <instancedMesh
        ref={poleRef}
        args={[undefined, undefined, lampPositions.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#11121a" />
      </instancedMesh>

      {/* neon accents */}
      <instancedMesh
        ref={neonRef}
        args={[undefined, undefined, neonAccents.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial emissiveIntensity={2.4} color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

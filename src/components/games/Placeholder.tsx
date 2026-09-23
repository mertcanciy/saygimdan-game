"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Mesh } from "three";

function RotatingBox({ color, active }: { color: string; active: boolean }) {
  const mesh = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (mesh.current && active) {
      mesh.current.rotation.x += delta * 0.6;
      mesh.current.rotation.y += delta * 0.9;
    }
  });
  return (
    <mesh ref={mesh}>
      <boxGeometry args={[1.6, 1.6, 1.6]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
    </mesh>
  );
}

export default function Placeholder({
  started,
  title,
  color,
}: {
  started: boolean;
  title: string;
  color: string;
}) {
  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 70, near: 0.1, far: 1500, position: [0, 0, 5] }}
        style={{
          background: "radial-gradient(circle at 50% 40%, #141428, #05060f)",
        }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={40} />
        <RotatingBox color={color} active={started} />
      </Canvas>
      <div className="absolute inset-x-0 top-2/3 flex justify-center pointer-events-none">
        <span className="text-white/70 text-sm tracking-widest select-none">
          {title} — yakında
        </span>
      </div>
    </div>
  );
}

"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
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
    <Canvas
      className="absolute inset-0"
      camera={{ position: [0, 0, 5], fov: 55 }}
      style={{ background: "radial-gradient(circle at 50% 40%, #141428, #05060f)" }}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 5, 5]} intensity={40} />
      <RotatingBox color={color} active={started} />
      <Html center>
        <span className="mt-40 block text-white/70 text-sm tracking-widest select-none">
          {title} — yakında
        </span>
      </Html>
    </Canvas>
  );
}

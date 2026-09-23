"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { RefObject } from "react";

export interface PointerLook {
  yaw: RefObject<number>;
  pitch: RefObject<number>;
  locked: boolean;
  /** true while the left mouse button is held */
  mouseDown: RefObject<boolean>;
  /** normalized mouse position relative to canvas center, -1..1 (works without lock) */
  stick: RefObject<{ x: number; y: number }>;
}

/**
 * Pointer-lock look controls. Click the canvas to lock; mouse movement
 * updates yaw/pitch refs (no re-renders). Also tracks a "virtual stick"
 * (mouse position relative to center) that works without pointer lock.
 * Must be used inside <Canvas>.
 */
export function usePointerLook(
  sensitivity = 0.002,
  pitchClamp = 1.2,
  enableLock = true
): PointerLook {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const pitch = useRef(-0.15);
  const mouseDown = useRef(false);
  const stick = useRef({ x: 0, y: 0 });
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      if (enableLock && document.pointerLockElement !== el) {
        el.requestPointerLock?.();
      }
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) {
        yaw.current -= e.movementX * sensitivity;
        pitch.current = Math.max(
          -pitchClamp,
          Math.min(pitchClamp, pitch.current - e.movementY * sensitivity)
        );
      }
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      stick.current.x = Math.max(-1, Math.min(1, nx));
      stick.current.y = Math.max(-1, Math.min(1, ny));
    };
    const onDown = (e: MouseEvent) => {
      if (e.button === 0) mouseDown.current = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) mouseDown.current = false;
    };
    const onLockChange = () => {
      setLocked(document.pointerLockElement === el);
    };
    el.addEventListener("click", onClick);
    window.addEventListener("mousemove", onMove);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      el.removeEventListener("click", onClick);
      window.removeEventListener("mousemove", onMove);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl, sensitivity, pitchClamp, enableLock]);

  return { yaw, pitch, locked, mouseDown, stick };
}

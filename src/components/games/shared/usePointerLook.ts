"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { MutableRefObject } from "react";

export interface PointerLook {
  yaw: MutableRefObject<number>;
  pitch: MutableRefObject<number>;
  locked: boolean;
}

/**
 * Pointer-lock look controls. Click the canvas to lock; mouse movement
 * updates yaw/pitch refs (no re-renders). Must be used inside <Canvas>.
 */
export function usePointerLook(
  sensitivity = 0.002,
  pitchClamp = 1.2
): PointerLook {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const pitch = useRef(-0.15);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      if (document.pointerLockElement !== el) el.requestPointerLock();
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      yaw.current -= e.movementX * sensitivity;
      pitch.current = Math.max(
        -pitchClamp,
        Math.min(pitchClamp, pitch.current - e.movementY * sensitivity)
      );
    };
    const onLockChange = () => {
      setLocked(document.pointerLockElement === el);
    };
    el.addEventListener("click", onClick);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      el.removeEventListener("click", onClick);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, [gl, sensitivity, pitchClamp]);

  return { yaw, pitch, locked };
}

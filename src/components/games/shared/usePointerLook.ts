"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import { isTouchDevice } from "./input";

export interface PointerLook {
  yaw: RefObject<number>;
  pitch: RefObject<number>;
  locked: boolean;
  /** true while the left mouse button is held */
  mouseDown: RefObject<boolean>;
  /** true while the right mouse button is held */
  rightDown: RefObject<boolean>;
  /** normalized mouse position relative to canvas center, -1..1 (works without lock) */
  stick: RefObject<{ x: number; y: number }>;
  /** performance.now() of the last manual look input (mouse-look or touch drag) */
  lastLook: RefObject<number>;
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
  const rightDown = useRef(false);
  const stick = useRef({ x: 0, y: 0 });
  const lastLook = useRef(-1e9);
  // on touch screens dragging the canvas is the "mouse": treat it as always captured
  const [locked, setLocked] = useState(() => isTouchDevice());

  useEffect(() => {
    const el = gl.domElement;
    const touch = isTouchDevice();
    // touch drag = mouse look (one finger that started on the canvas)
    let dragId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const TOUCH_GAIN = 2.2;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return; // buttons: see onMouseDown (pointer events don't report chords)
      if (dragId !== null) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dx !== 0 || dy !== 0) lastLook.current = performance.now();
      yaw.current -= dx * sensitivity * TOUCH_GAIN;
      pitch.current = Math.max(-pitchClamp, Math.min(pitchClamp, pitch.current - dy * sensitivity * TOUCH_GAIN));
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (e.pointerId === dragId) dragId = null;
    };
    const onClick = () => {
      if (touch) return;
      if (enableLock && document.pointerLockElement !== el) {
        el.requestPointerLock?.();
      }
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === el) {
        lastLook.current = performance.now();
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
    const onLockChange = () => {
      if (!touch) setLocked(document.pointerLockElement === el);
    };
    const onContext = (e: Event) => e.preventDefault();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) mouseDown.current = true;
      if (e.button === 2) rightDown.current = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseDown.current = false;
      if (e.button === 2) rightDown.current = false;
    };
    const onBlur = () => {
      mouseDown.current = false;
      rightDown.current = false;
    };
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    el.addEventListener("contextmenu", onContext);
    el.addEventListener("click", onClick);
    window.addEventListener("mousemove", onMove);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      el.removeEventListener("contextmenu", onContext);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("click", onClick);
      window.removeEventListener("mousemove", onMove);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl, sensitivity, pitchClamp, enableLock]);

  return { yaw, pitch, locked, mouseDown, rightDown, stick, lastLook };
}

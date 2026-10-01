"use client";

// Floating analog stick. The first touch anywhere in the left zone is the
// stick's centre, and it stays the centre for the whole touch: the output is
// simply "how far the thumb is from where it landed" (clamped at the rim), so
// landing reads zero and coming back to that spot reads zero again. Publishes
// the analog vector in `virtualStick` and, optionally, W/A/S/D past a deadzone
// for games that only read keys.

import { useEffect, useRef, useState } from "react";
import { pressVirtual, releaseVirtual, virtualStick } from "../input";
import { EDGE_BOTTOM, EDGE_LEFT, NO_TAP_HIGHLIGHT, ZONE_TOP, buzz } from "./kit";

const KEY_DZ = 0.3;
/** full deflection, as a share of the stick's drawn size */
const RADIUS = 0.4;
/**
 * When the rim lights up: "axis" = one axis past 0.88 (F-16: loop / hard turn /
 * steep dive), "radius" = pushed all the way out in any direction, "none" = never
 * (Ağ Sallan: the rim used to mean sprint, which made every full push a sprint).
 */
const RIM = { axis: 0.88, radius: 0.97 };

export default function Stick({
  keys = true,
  label = "Hareket: sol başparmağını sürükle",
  rimMode = "none",
}: {
  keys?: boolean;
  label?: string;
  rimMode?: "axis" | "radius" | "none";
}) {
  const zone = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const atRim = useRef(false);
  /** where the thumb landed (client px) */
  const origin = useRef({ x: 0, y: 0 });
  const radius = useRef(56);
  const [active, setActive] = useState(false);

  const setKeys = (x: number, y: number) => {
    if (!keys) return;
    const set = (code: string, on: boolean) => (on ? pressVirtual(code) : releaseVirtual(code));
    set("KeyW", y > KEY_DZ);
    set("KeyS", y < -KEY_DZ);
    set("KeyA", x < -KEY_DZ);
    set("KeyD", x > KEY_DZ);
  };

  const update = (clientX: number, clientY: number) => {
    const R = radius.current;
    const dx = clientX - origin.current.x;
    const dy = clientY - origin.current.y;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / R);
    const nx = d > 0 ? (dx / d) * m : 0;
    const ny = d > 0 ? (-dy / d) * m : 0;
    virtualStick.x = nx;
    virtualStick.y = ny;
    virtualStick.active = true;
    setKeys(nx, ny);
    const k = knobEl.current;
    if (k) k.style.transform = `translate(-50%, -50%) translate3d(${nx * R}px, ${-ny * R}px, 0)`;
    const rim = rimMode === "axis" ? Math.max(Math.abs(nx), Math.abs(ny)) > RIM.axis : rimMode === "radius" && m >= RIM.radius;
    if (rim !== atRim.current) {
      atRim.current = rim;
      if (rim) buzz(12);
      baseEl.current?.classList.toggle("stick-rim", rim);
    }
  };

  const end = (e?: React.PointerEvent) => {
    if (e && pointer.current !== e.pointerId) return;
    pointer.current = null;
    virtualStick.x = 0;
    virtualStick.y = 0;
    virtualStick.active = false;
    setKeys(0, 0);
    setActive(false);
    atRim.current = false;
    baseEl.current?.classList.remove("stick-rim");
    const k = knobEl.current;
    if (k) k.style.transform = "translate(-50%, -50%)";
  };

  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={zone}
      role="application"
      aria-label={label}
      data-keep-clear
      className={`pointer-events-auto absolute bottom-0 left-0 w-[42%] touch-none select-none ${NO_TAP_HIGHLIGHT}`}
      style={{ top: ZONE_TOP }}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        pointer.current = e.pointerId;
        const size = rest.current?.getBoundingClientRect().width || 140;
        radius.current = size * RADIUS;
        origin.current = { x: e.clientX, y: e.clientY };
        // the base is drawn under the thumb (it may hang off the screen edge; the centre never moves)
        const z = e.currentTarget.getBoundingClientRect();
        const b = baseEl.current;
        if (b) b.style.transform = `translate3d(${e.clientX - z.left}px, ${e.clientY - z.top}px, 0) translate(-50%, -50%)`;
        setActive(true);
        buzz();
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointer.current === e.pointerId) update(e.clientX, e.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* resting hint at the default spot */}
      <div
        ref={rest}
        aria-hidden
        className={`absolute rounded-full transition-opacity duration-200 ${active ? "opacity-0" : "opacity-100"}`}
        style={{
          width: "var(--tc-stick)",
          height: "var(--tc-stick)",
          left: EDGE_LEFT,
          bottom: EDGE_BOTTOM,
          background:
            "radial-gradient(circle, transparent 0 60%, rgba(255,255,255,0.5) 60.5% 62%, rgba(14,14,16,0.34) 62.5% 97%, rgba(255,255,255,0.55) 97.5% 100%)",
        }}
      >
        <div className="absolute left-1/2 top-1/2 size-[40%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)] ring-1 ring-white" />
      </div>

      {/* live stick */}
      <div
        ref={baseEl}
        aria-hidden
        className={`absolute left-0 top-0 rounded-full transition-opacity duration-100 ${active ? "opacity-100" : "opacity-0"}`}
        style={{
          width: "var(--tc-stick)",
          height: "var(--tc-stick)",
          background:
            "radial-gradient(circle, rgba(14,14,16,0.18) 0 60%, rgba(255,255,255,0.5) 60.5% 62%, rgba(14,14,16,0.4) 62.5% 97%, rgba(255,255,255,0.7) 97.5% 100%)",
        }}
      >
        <div
          ref={knobEl}
          className="absolute left-1/2 top-1/2 size-[42%] rounded-full bg-white/95 shadow-[0_6px_18px_rgba(0,0,0,0.35)] ring-[3px] ring-red/80"
          style={{ transform: "translate(-50%, -50%)" }}
        />
      </div>
    </div>
  );
}

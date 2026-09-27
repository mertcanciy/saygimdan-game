"use client";

// On-screen steering wheel for the car games. Put a thumb down anywhere in the
// left zone (on the wheel or beside it) and slide sideways: the steering is
// how far the thumb has moved left / right from where it landed, the same
// wherever you grabbed, and a quick ~¾-wheel flick reaches full lock. The
// wheel turns with it (same angle as the car's own wheel in Makas) and
// springs back to straight on release. Publishes `virtualSteer`.
// The hub is a separate button (the horn), styled as a record label.

import { useEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";
import { virtualSteer } from "../input";
import { EDGE_BOTTOM, EDGE_LEFT, NO_TAP_HIGHLIGHT, ZONE_TOP, buzz, usePress } from "./kit";

/** drawn rotation at full lock (rad): matches the Makas cockpit wheel (cars/Cockpit.tsx) */
export const WHEEL_MAX_ROT = 1.6;
/** sideways travel for full lock, in wheel radii (~75 px on a phone) */
const TRAVEL_R = 0.95;
/** travel (share of full) that reads as straight: a resting thumb doesn't wobble the car */
const DEADZONE = 0.04;

export default function SteeringWheel({ horn }: { horn?: string }) {
  const wheel = useRef<HTMLDivElement>(null);
  const g = useRef({ id: -1, x0: 0, travel: 75, value: 0 });
  const [active, setActive] = useState(false);

  const publish = (clientX: number) => {
    const s = g.current;
    const u = Math.max(-1, Math.min(1, (clientX - s.x0) / s.travel));
    const m = Math.max(0, Math.abs(u) - DEADZONE) / (1 - DEADZONE);
    const was = Math.abs(s.value) >= 1;
    s.value = Math.sign(u) * m;
    if (!was && Math.abs(s.value) >= 1) buzz(6); // full lock
    virtualSteer.value = s.value;
    virtualSteer.active = true;
    const w = wheel.current;
    if (w) w.style.transform = `rotate(${s.value * WHEEL_MAX_ROT}rad)`;
  };

  const end = (e?: React.PointerEvent) => {
    const s = g.current;
    if (e && e.pointerId !== s.id) return;
    s.id = -1;
    s.value = 0;
    virtualSteer.value = 0;
    virtualSteer.active = false;
    setActive(false);
    const w = wheel.current;
    if (w) {
      w.style.transition = "transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.15)";
      w.style.transform = "rotate(0rad)";
    }
  };

  useEffect(() => () => end(), []);

  return (
    <div
      role="application"
      aria-label="Direksiyon: dokun, sağa sola kaydır"
      className={`pointer-events-auto absolute bottom-0 left-0 w-[46%] touch-none select-none ${NO_TAP_HIGHLIGHT}`}
      style={{ top: ZONE_TOP }}
      onPointerDown={(e) => {
        const s = g.current;
        if (s.id !== -1 || !wheel.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        s.id = e.pointerId;
        s.x0 = e.clientX;
        s.travel = (wheel.current.getBoundingClientRect().width / 2) * TRAVEL_R;
        wheel.current.style.transition = "none";
        setActive(true);
        buzz();
        publish(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === g.current.id) publish(e.clientX);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        data-wheel
        className="absolute"
        style={{ left: EDGE_LEFT, bottom: EDGE_BOTTOM, width: "var(--tc-wheel)", height: "var(--tc-wheel)" }}
      >
        <div ref={wheel} aria-hidden className="absolute inset-0 will-change-transform">
          {/* rim */}
          <div
            className={`absolute inset-0 rounded-full transition-[box-shadow] duration-100 ${
              active ? "shadow-[0_0_0_3px_rgba(220,30,42,0.35),0_10px_30px_-12px_rgba(0,0,0,0.7)]" : "shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]"
            }`}
            style={{
              background:
                "radial-gradient(circle, transparent 0 58%, rgba(255,255,255,0.55) 58.6% 60%, rgba(14,14,16,0.62) 60.6% 96%, rgba(255,255,255,0.6) 96.6% 100%)",
            }}
          />
          {/* spokes: left, right, down */}
          <div className="absolute left-[6%] right-[6%] top-1/2 h-[9%] -translate-y-1/2 rounded-full bg-[#0e0e10]/55 ring-1 ring-white/25" />
          <div className="absolute bottom-[6%] left-1/2 top-1/2 w-[9%] -translate-x-1/2 rounded-full bg-[#0e0e10]/55 ring-1 ring-white/25" />
          {/* 12 o'clock stripe, like a racing wheel */}
          <div className="absolute left-1/2 top-[1.5%] h-[12%] w-[7%] -translate-x-1/2 rounded-full bg-red shadow-[0_0_10px_rgba(220,30,42,0.6)]" />
        </div>
        {horn ? <Hub code={horn} /> : <div aria-hidden className="absolute inset-[34%] rounded-full bg-[#0e0e10]/60 ring-1 ring-white/35" />}
      </div>
    </div>
  );
}

/** The horn: a record label in the middle of the wheel (grooves, red label). */
function Hub({ code }: { code: string }) {
  const { down, handlers } = usePress({ code, label: "Korna" });
  return (
    <button
      type="button"
      aria-label="Korna"
      {...handlers}
      className={`absolute inset-[30%] grid touch-none place-items-center rounded-full transition-transform duration-75 ${NO_TAP_HIGHLIGHT} ${down ? "scale-90" : ""}`}
      style={{
        background: "radial-gradient(circle, var(--red) 0 52%, #0a0a0a 53% 56%, transparent 57%), repeating-radial-gradient(circle, #0a0a0a 0 1.4px, #26262a 1.4px 2.6px)",
        boxShadow: down ? "0 0 0 3px rgba(255,255,255,0.8), 0 0 22px rgba(220,30,42,0.8)" : "0 0 0 1.5px rgba(255,255,255,0.55)",
      }}
    >
      <Megaphone aria-hidden className="size-[28%] min-h-4 min-w-4 text-white" strokeWidth={2.5} />
    </button>
  );
}

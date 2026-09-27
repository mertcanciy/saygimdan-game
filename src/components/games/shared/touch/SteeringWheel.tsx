"use client";

// On-screen steering wheel for the car games. Grab it anywhere (rim or the
// empty space around it) and turn: on the rim the wheel follows the thumb's
// angle like a real one; near the hub or away from the wheel a sideways slide
// turns it instead (angles get twitchy close to the centre). Springs back to
// straight on release. Publishes an analog value in `virtualSteer`.
// The hub is a separate button (the horn), styled as a record label.

import { useEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";
import { virtualSteer } from "../input";
import { EDGE_BOTTOM, EDGE_LEFT, NO_TAP_HIGHLIGHT, ZONE_TOP, buzz, usePress } from "./kit";

/** wheel rotation for full lock (rad): ~100°, a comfortable thumb arc */
const MAX_ROT = 1.75;
/** full-lock travel for a sideways slide, in wheel radii */
const SLIDE_R = 1.15;
const DEADZONE = 0.04;

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export default function SteeringWheel({ horn }: { horn?: string }) {
  const wheel = useRef<HTMLDivElement>(null);
  const g = useRef({ id: -1, cx: 0, cy: 0, r: 1, lastA: 0, lastX: 0, rot: 0 });
  const [active, setActive] = useState(false);

  const publish = () => {
    const s = g.current;
    const u = s.rot / MAX_ROT;
    const m = Math.max(0, Math.abs(u) - DEADZONE) / (1 - DEADZONE);
    virtualSteer.value = Math.sign(u) * m;
    virtualSteer.active = true;
    const w = wheel.current;
    if (w) w.style.transform = `rotate(${s.rot}rad)`;
  };

  const end = (e?: React.PointerEvent) => {
    const s = g.current;
    if (e && e.pointerId !== s.id) return;
    s.id = -1;
    s.rot = 0;
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
      aria-label="Direksiyon: tut ve çevir"
      className={`pointer-events-auto absolute bottom-0 left-0 w-[46%] touch-none select-none ${NO_TAP_HIGHLIGHT}`}
      style={{ top: ZONE_TOP }}
      onPointerDown={(e) => {
        const s = g.current;
        if (s.id !== -1 || !wheel.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = wheel.current.getBoundingClientRect();
        s.id = e.pointerId;
        s.cx = r.left + r.width / 2;
        s.cy = r.top + r.height / 2;
        s.r = r.width / 2;
        s.lastA = Math.atan2(e.clientY - s.cy, e.clientX - s.cx);
        s.lastX = e.clientX;
        wheel.current.style.transition = "none";
        setActive(true);
        buzz();
        publish();
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (e.pointerId !== s.id) return;
        const dx = e.clientX - s.cx;
        const dy = e.clientY - s.cy;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const onRim = d > s.r * 0.3 && d < s.r * 1.45;
        const delta = onRim ? wrap(a - s.lastA) : ((e.clientX - s.lastX) / (s.r * SLIDE_R)) * MAX_ROT;
        s.lastA = a;
        s.lastX = e.clientX;
        const was = Math.abs(s.rot) >= MAX_ROT;
        s.rot = Math.max(-MAX_ROT, Math.min(MAX_ROT, s.rot + delta));
        if (!was && Math.abs(s.rot) >= MAX_ROT) buzz(6); // full lock
        publish();
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

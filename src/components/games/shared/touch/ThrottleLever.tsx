"use client";

// Throttle lever for the F-16: drag the grip up / down anywhere on the track
// (relative drag, so a touch never makes it jump) and let go — it stays where
// you left it, like the real thing. The top of the track is the afterburner
// detent. Publishes `virtualThrottle` (the game reads it instead of W/S).

import { useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { virtualThrottle } from "../input";
import { EDGE_BOTTOM, EDGE_RIGHT, NO_TAP_HIGHLIGHT, buzz } from "./kit";

/** lever position where full dry thrust is reached; above it is the afterburner detent */
const MIL = 0.84;
const AB_ON = 0.9;
const AB_OFF = 0.86;

export default function ThrottleLever({ initial = 0.65 }: { initial?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const g = useRef({ id: -1, y0: 0, v0: 0, v: initial * MIL, ab: false });
  const [shown, setShown] = useState({ v: initial * MIL, ab: false, active: false });

  const publish = (active: boolean) => {
    const s = g.current;
    const wasAb = s.ab;
    s.ab = s.ab ? s.v >= AB_OFF : s.v >= AB_ON;
    if (s.ab !== wasAb) buzz(s.ab ? 14 : 6);
    virtualThrottle.value = Math.min(1, s.v / MIL);
    virtualThrottle.ab = s.ab;
    setShown((p) => (Math.abs(p.v - s.v) < 0.005 && p.ab === s.ab && p.active === active ? p : { v: s.v, ab: s.ab, active }));
  };

  useEffect(() => {
    publish(false);
    return () => {
      virtualThrottle.value = null;
      virtualThrottle.ab = false;
    };
  }, []);

  const end = (e: React.PointerEvent) => {
    if (e.pointerId !== g.current.id) return;
    g.current.id = -1;
    publish(false);
  };

  const pct = Math.round(Math.min(1, shown.v / MIL) * 100);
  // grip travel: the grip is --tc-lever-w * 0.62 tall
  const gripH = "calc(var(--tc-lever-w) * 0.62)";

  return (
    <div
      role="slider"
      aria-label="Gaz kolu"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={shown.ab ? "Afterburner" : `%${pct}`}
      className={`pointer-events-auto absolute touch-none select-none ${NO_TAP_HIGHLIGHT}`}
      style={{ right: EDGE_RIGHT, bottom: EDGE_BOTTOM, width: "var(--tc-lever-w)", height: "var(--tc-lever-h)" }}
      onPointerDown={(e) => {
        const s = g.current;
        if (s.id !== -1) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        s.id = e.pointerId;
        s.y0 = e.clientY;
        s.v0 = s.v;
        buzz();
        publish(true);
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (e.pointerId !== s.id || !track.current) return;
        const r = track.current.getBoundingClientRect();
        const travel = Math.max(40, r.height * 0.78);
        s.v = Math.max(0, Math.min(1, s.v0 + (s.y0 - e.clientY) / travel));
        publish(true);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={track}
        aria-hidden
        className={`absolute inset-0 overflow-hidden rounded-[18px] bg-[#0e0e10]/45 ring-[1.5px] transition-shadow duration-100 ${
          shown.active ? "ring-white/80 shadow-[0_0_0_3px_rgba(220,30,42,0.3)]" : "ring-white/55"
        }`}
      >
        {/* afterburner detent */}
        <div
          className={`absolute inset-x-0 top-0 grid place-items-center border-b border-dashed border-white/50 transition-colors ${
            shown.ab ? "bg-red/85" : "bg-red/25"
          }`}
          style={{ height: `${(1 - AB_ON) * 100 + 4}%` }}
        >
          <Flame className="size-4 text-white" strokeWidth={2.5} />
        </div>
        {/* level */}
        <div
          className="absolute inset-x-0 bottom-0 bg-white/18"
          style={{ height: `calc(${gripH} / 2 + (100% - ${gripH}) * ${shown.v})` }}
        />
        {/* ticks */}
        {[0.25, 0.5, 0.75].map((t) => (
          <span
            key={t}
            className="absolute left-[10%] h-[2px] w-[18%] rounded-full bg-white/45"
            style={{ bottom: `calc(${gripH} / 2 + (100% - ${gripH}) * ${t * MIL})` }}
          />
        ))}
      </div>
      {/* grip */}
      <div
        aria-hidden
        className={`absolute inset-x-[7%] flex flex-col items-center justify-center rounded-[12px] text-[12px] font-bold tabular-nums leading-none shadow-[0_8px_18px_-8px_rgba(0,0,0,0.6)] transition-colors ${
          shown.ab ? "bg-red text-white" : shown.active ? "bg-white text-[#0a0a0a] ring-[3px] ring-red/40" : "bg-white/92 text-[#0a0a0a]"
        }`}
        style={{ height: gripH, bottom: `calc((100% - ${gripH}) * ${shown.v})` }}
      >
        <span className="mb-1 flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-[10px] w-[2px] rounded-full ${shown.ab ? "bg-white/60" : "bg-[#0a0a0a]/30"}`} />
          ))}
        </span>
        {shown.ab ? "AB" : `${pct}%`}
      </div>
    </div>
  );
}

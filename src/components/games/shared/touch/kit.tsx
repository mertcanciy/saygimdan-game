"use client";

// Building blocks for the on-screen controls: sizes, the button faces and a
// button cluster that follows the thumb (slide from Gas onto Nitro without
// lifting, the way console-style mobile games work).

import { useEffect, useRef, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import { emitVirtualLook, pressVirtual, releaseVirtual } from "../input";

/** lucide icons, or any SVG component with the same props */
export type Icon = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

export interface Btn {
  code: string;
  label: string;
  icon?: Icon;
  /** accessible name when the label is short / a glyph */
  aria?: string;
  /** tap-style (short press) rather than hold, e.g. camera toggle */
  tap?: boolean;
}

/*
 * Sizes follow the short side of the screen (vmin): a landscape phone
 * (≈390 px tall) gets ~82 px primary buttons and a ~160 px wheel, a tablet
 * the upper clamp. Everything else is derived from these.
 */
export const SIZE_VARS = {
  "--tc-a": "clamp(72px, 21vmin, 104px)",
  "--tc-b": "clamp(54px, 15vmin, 76px)",
  "--tc-c": "clamp(50px, 13.5vmin, 64px)",
  "--tc-pw": "clamp(66px, 19vmin, 92px)",
  "--tc-gas-h": "calc(var(--tc-pw) * 1.5)",
  "--tc-brake-h": "calc(var(--tc-pw) * 1.12)",
  "--tc-wheel": "clamp(136px, 41vmin, 206px)",
  "--tc-stick": "clamp(124px, 37vmin, 176px)",
  "--tc-lever-h": "clamp(168px, 52vmin, 262px)",
  "--tc-lever-w": "clamp(62px, 17vmin, 84px)",
  "--tc-gap": "clamp(10px, 3vmin, 16px)",
  "--tc-edge-x": "clamp(16px, 3.2vw, 32px)",
  "--tc-edge-y": "clamp(14px, 4.5vmin, 28px)",
} as CSSProperties;

export const EDGE_LEFT = "max(var(--tc-edge-x), env(safe-area-inset-left))";
export const EDGE_RIGHT = "max(var(--tc-edge-x), env(safe-area-inset-right))";
export const EDGE_BOTTOM = "max(var(--tc-edge-y), env(safe-area-inset-bottom))";
/** below the top bar (back button, chips): thumb zones start here */
export const ZONE_TOP = "clamp(6.5rem, 30vmin, 9rem)";

export function buzz(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // some browsers throw when vibration is blocked
  }
}

export const NO_TAP_HIGHLIGHT = "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]";

/* ------------------------------------------------------------------ */

export type Tone = "primary" | "secondary";

/**
 * The look of a button. Round pads for actions, tall ribbed pads for pedals.
 * Primary = paper white with ink glyph; secondary = dark glass; pressed = the
 * site's record-label red.
 */
export function Face({
  btn,
  shape,
  tone,
  down,
  className = "",
  style,
}: {
  btn: Btn;
  shape: "round" | "pedal";
  tone: Tone;
  down: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = btn.icon;
  const primary = tone === "primary";
  const skin = down
    ? "bg-red text-white ring-[3px] ring-red/35 shadow-[0_0_24px_-4px_rgba(220,30,42,0.7)]"
    : primary
      ? "bg-white/88 text-[#0a0a0a] ring-1 ring-white shadow-[0_10px_24px_-10px_rgba(0,0,0,0.55)]"
      : "bg-[#0e0e10]/45 text-white ring-[1.5px] ring-white/55 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.6)]";
  return (
    <div
      aria-hidden
      className={`@container absolute flex flex-col items-center justify-center gap-[3px] font-semibold leading-none tracking-[-0.01em] transition-[transform,background-color,box-shadow] duration-75 ${skin} ${
        shape === "round" ? "rounded-full" : "rounded-[16px] justify-start pt-[14%]"
      } ${down ? (shape === "pedal" ? "[transform:perspective(300px)_rotateX(14deg)_scale(0.97)]" : "scale-[0.94]") : ""} ${className}`}
      style={style}
    >
      {Icon && <Icon aria-hidden strokeWidth={2.4} className="size-[clamp(18px,36cqw,34px)] shrink-0" />}
      {/* sized by the button's own width (container units), so small and big pads both fit their label */}
      <span className="whitespace-nowrap text-[clamp(9.5px,18cqw,14px)]">{btn.label}</span>
      {shape === "pedal" && (
        // rubber ribs
        <span aria-hidden className="absolute inset-x-[18%] bottom-[12%] top-[52%] flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-[2px] rounded-full ${down ? "bg-white/45" : primary ? "bg-[#0a0a0a]/18" : "bg-white/22"}`} />
          ))}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface PadItem {
  btn: Btn;
  shape: "round" | "pedal";
  tone?: Tone;
  /** CSS lengths (use the --tc-* vars) */
  w: string;
  h: string;
  right: string;
  bottom: string;
  /** a thumb resting on the seam between this button and a `chord` button presses both */
  chord?: string | string[];
  /** a drag that starts on this button pans the camera (and never slides off it) */
  look?: boolean;
}

/** how far outside a button a touch still counts as that button (px) */
const SLOP = 16;
/** both halves of a chord must be at least this close (px) */
const CHORD = 14;
/** look-drags start after this much travel (px), so a plain hold doesn't nudge the camera */
const LOOK_START = 6;

function distToRect(r: DOMRect, x: number, y: number) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

interface Ptr {
  idx: number[];
  /** index of a look button this pointer is locked to, or -1 */
  lock: number;
  x: number;
  y: number;
  looking: boolean;
}

/**
 * A group of buttons sharing one touch surface. Each finger presses whatever
 * button is under it and can slide to another without lifting; gaps between
 * buttons snap to the nearest one. Multi-touch: every finger is tracked.
 */
export function Cluster({
  items,
  width,
  height,
  right = EDGE_RIGHT,
  className = "",
}: {
  items: PadItem[];
  width: string;
  height: string;
  /** distance from the right edge (default: the safe edge) */
  right?: string;
  className?: string;
}) {
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const rects = useRef<DOMRect[]>([]);
  const ptrs = useRef(new Map<number, Ptr>());
  const held = useRef(new Set<string>());
  const [mask, setMask] = useState(0);
  const maskRef = useRef(0);

  const releaseAll = () => {
    held.current.forEach((c) => releaseVirtual(c));
    held.current.clear();
    ptrs.current.clear();
  };
  useEffect(() => releaseAll, []);

  const measure = () => {
    rects.current = els.current.map((e) => e?.getBoundingClientRect() ?? new DOMRect());
  };

  const hit = (x: number, y: number): number[] => {
    const d = rects.current.map((r) => distToRect(r, x, y));
    let best = -1;
    for (let i = 0; i < d.length; i++) if (best < 0 || d[i] < d[best]) best = i;
    if (best < 0 || d[best] > SLOP) return [];
    const out = [best];
    const c = items[best].chord;
    for (const code of typeof c === "string" ? [c] : (c ?? [])) {
      const j = items.findIndex((it) => it.btn.code === code);
      if (j >= 0 && d[j] <= Math.min(CHORD, d[best] + 10)) out.push(j);
    }
    return out;
  };

  const sync = () => {
    const want = new Set<string>();
    let m = 0;
    ptrs.current.forEach((p) =>
      p.idx.forEach((i) => {
        want.add(items[i].btn.code);
        m |= 1 << i;
      })
    );
    held.current.forEach((c) => {
      if (!want.has(c)) releaseVirtual(c);
    });
    let fresh = false;
    want.forEach((c) => {
      if (!held.current.has(c)) {
        pressVirtual(c);
        fresh = true;
      }
    });
    if (fresh) buzz();
    held.current = want;
    if (m !== maskRef.current) {
      maskRef.current = m;
      setMask(m);
    }
  };

  return (
    <div
      className={`pointer-events-auto absolute touch-none select-none ${NO_TAP_HIGHLIGHT} ${className}`}
      style={{ right, bottom: EDGE_BOTTOM, width, height }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        measure();
        const idx = hit(e.clientX, e.clientY);
        e.currentTarget.setPointerCapture(e.pointerId);
        const lock = idx.length === 1 && items[idx[0]].look ? idx[0] : -1;
        ptrs.current.set(e.pointerId, { idx, lock, x: e.clientX, y: e.clientY, looking: false });
        sync();
      }}
      onPointerMove={(e) => {
        const p = ptrs.current.get(e.pointerId);
        if (!p) return;
        if (p.lock >= 0) {
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (!p.looking && Math.hypot(dx, dy) < LOOK_START) return;
          p.looking = true;
          p.x = e.clientX;
          p.y = e.clientY;
          emitVirtualLook(dx, dy);
          return;
        }
        const idx = hit(e.clientX, e.clientY);
        if (idx.length !== p.idx.length || idx.some((v, i) => v !== p.idx[i])) {
          p.idx = idx;
          sync();
        }
      }}
      onPointerUp={(e) => {
        ptrs.current.delete(e.pointerId);
        sync();
      }}
      onPointerCancel={(e) => {
        ptrs.current.delete(e.pointerId);
        sync();
      }}
      onLostPointerCapture={(e) => {
        if (!ptrs.current.delete(e.pointerId)) return;
        sync();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div
          key={it.btn.code}
          ref={(el) => {
            els.current[i] = el;
          }}
          role="button"
          aria-label={it.btn.aria ?? it.btn.label}
          aria-pressed={(mask & (1 << i)) !== 0}
          className="absolute"
          style={{ right: it.right, bottom: it.bottom, width: it.w, height: it.h }}
        >
          <Face btn={it.btn} shape={it.shape} tone={it.tone ?? "secondary"} down={(mask & (1 << i)) !== 0} className="inset-0" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Press/release for a standalone button (top chips, the horn on the wheel). */
export function usePress(btn: Btn) {
  const [down, setDown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      releaseVirtual(btn.code);
    },
    [btn.code]
  );
  const press = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDown(true);
    buzz();
    pressVirtual(btn.code);
    if (btn.tap) {
      // tap buttons: hold the key for a few frames so edge detection sees it
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => releaseVirtual(btn.code), 90);
    }
  };
  const release = () => {
    setDown(false);
    if (!btn.tap) releaseVirtual(btn.code);
  };
  return {
    down,
    handlers: {
      onPointerDown: press,
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

/** Small chip along the top edge (camera, reset…). */
export function Chip({ btn }: { btn: Btn }) {
  const { down, handlers } = usePress(btn);
  const Icon = btn.icon;
  return (
    <button
      type="button"
      aria-label={btn.aria ?? btn.label}
      {...handlers}
      className={`pointer-events-auto inline-flex h-10 touch-none select-none items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-[transform,background-color] duration-75 short:h-9 short:px-3 short:text-[12.5px] narrow:size-10 narrow:px-0 ${NO_TAP_HIGHLIGHT} ${
        down ? "scale-95 bg-red text-white" : "bg-white/90 text-[#0a0a0a] ring-1 ring-white/70"
      }`}
    >
      {Icon && <Icon aria-hidden className="size-4" strokeWidth={2.4} />}
      {/* portrait: icon-only column, the top band is taken by the HUD */}
      <span className={Icon ? "narrow:hidden" : undefined}>{btn.label}</span>
    </button>
  );
}

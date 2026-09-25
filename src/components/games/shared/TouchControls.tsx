"use client";

// On-screen controls for phones and tablets. Buttons and the joystick press
// the same KeyboardEvent.code values the games read from the keyboard (see
// ./input.ts), so the game code itself doesn't know touch exists. The stick
// also publishes an analog vector (virtualStick) for games that want it.
// Dragging anywhere else on the canvas is the "mouse" (look / aim).
//
// Sizes follow the viewport height (clamp + dvh) so a landscape phone gets
// compact thumb pads and a tablet gets roomier ones.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  CircleParking,
  Flame,
  Footprints,
  Lightbulb,
  Megaphone,
  Minus,
  Plus,
  Rotate3d,
  RotateCcw,
  SwitchCamera,
  Zap,
} from "lucide-react";
import type { GameSlug } from "@/lib/games";
import { pressVirtual, releaseAllVirtual, releaseVirtual, virtualStick } from "./input";

interface Btn {
  code: string;
  label: string;
  icon?: LucideIcon;
  /** big primary button */
  big?: boolean;
  /** tap-style (short press) rather than hold, e.g. camera toggle */
  tap?: boolean;
  /** accessible name when the label is just a glyph */
  aria?: string;
  /** hide the text label (icon-only button, e.g. steering arrows) */
  iconOnly?: boolean;
}

interface Layout {
  /** left thumb: a floating analog stick, or a pair of steering buttons (+ optional extras above) */
  left: { kind: "stick" } | { kind: "steer"; codes: [string, string]; aria: [string, string]; small?: boolean; extra?: Btn[] };
  /** right thumb: [primary, ...secondaries]; the primary sits in the corner, the rest arc around it */
  right: Btn[];
  /** small chips along the top edge */
  top?: Btn[];
}

const LAYOUTS: Record<GameSlug, Layout> = {
  spiderman: {
    left: { kind: "stick" },
    right: [
      { code: "Space", label: "Ağ", big: true },
      { code: "KeyQ", label: "Zip", icon: Zap },
      { code: "ShiftLeft", label: "Koş", icon: Footprints },
    ],
    top: [{ code: "KeyR", label: "Başa dön", icon: RotateCcw, tap: true }],
  },
  drift: {
    left: { kind: "steer", codes: ["KeyA", "KeyD"], aria: ["Sola", "Sağa"] },
    right: [
      { code: "KeyW", label: "Gaz", icon: ChevronsUp, big: true },
      { code: "Space", label: "El freni", icon: CircleParking },
      { code: "KeyS", label: "Fren" },
    ],
    top: [
      { code: "KeyC", label: "Kamera", icon: SwitchCamera, tap: true },
      { code: "KeyR", label: "Son kapı", icon: RotateCcw, tap: true },
    ],
  },
  f16: {
    left: {
      kind: "steer",
      codes: ["KeyA", "KeyD"],
      aria: ["Dümen sola", "Dümen sağa"],
      small: true,
      extra: [{ code: "Space", label: "Tonoz", icon: Rotate3d, tap: true }],
    },
    right: [
      { code: "KeyW", label: "Gaz", icon: Plus, big: true },
      { code: "ShiftLeft", label: "AB", icon: Flame },
      { code: "KeyS", label: "Gaz", icon: Minus, aria: "Gaz azalt" },
    ],
    top: [
      { code: "KeyC", label: "Kokpit", icon: SwitchCamera, tap: true },
      { code: "KeyR", label: "Sıfırla", icon: RotateCcw, tap: true },
    ],
  },
  traffic: {
    left: { kind: "steer", codes: ["KeyA", "KeyD"], aria: ["Sol şerit", "Sağ şerit"] },
    right: [
      { code: "KeyW", label: "Gaz", icon: ChevronsUp, big: true },
      { code: "ShiftLeft", label: "Nitro", icon: Flame },
      { code: "KeyS", label: "Fren" },
    ],
    top: [
      { code: "KeyF", label: "Selektör", icon: Lightbulb },
      { code: "KeyH", label: "Korna", icon: Megaphone },
    ],
  },
};

/** Help lines shown on the start sheet when playing by touch. */
export const TOUCH_HELP: Record<GameSlug, string[]> = {
  spiderman: [
    "Sol başparmak: koş, duvara doğru it: tırman",
    "Ağ: basılı tut sallan, bırak uç",
    "Zip: ileriye ağ fırlat, hızla çekil",
    "Koş: yerde depar, duvarda koşarak tırman, havada dalış",
    "Sağda sürükle: kamera",
  ],
  drift: ["Sol tuşlar: direksiyon", "Hızlıyken el frenine dokun: drift", "Gazı bırak: araç toparlar"],
  f16: ["Ekranı sürükle: nişan al, uçak oraya döner", "Sağda gaz ve afterburner (AB)", "Solda dümen ve tonoz"],
  traffic: ["Sol tuşlar: şerit değiştir", "Sağda gaz, fren, nitro", "Üstte selektör ve korna"],
};

/* ------------------------------------------------------------------ */

// sizes scale with the viewport height; everything else is derived from these
const SIZE_VARS = {
  "--tc-big": "clamp(56px, min(15dvh, 19vw), 80px)",
  "--tc-sec": "clamp(42px, min(11dvh, 14vw), 58px)",
  "--tc-stick": "clamp(96px, min(28dvh, 34vw), 136px)",
  "--tc-gap": "clamp(8px, 2.4dvh, 14px)",
  "--tc-edge-x": "clamp(14px, 3vw, 28px)",
  "--tc-edge-y": "clamp(12px, 4dvh, 24px)",
} as CSSProperties;

const EDGE_LEFT = "max(var(--tc-edge-x), env(safe-area-inset-left))";
const EDGE_RIGHT = "max(var(--tc-edge-x), env(safe-area-inset-right))";
const EDGE_BOTTOM = "max(var(--tc-edge-y), env(safe-area-inset-bottom))";

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // some browsers throw when vibration is blocked
  }
}

/** Shared press/release logic for hold and tap buttons. */
function usePress(btn: Btn) {
  const [down, setDown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
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

type PadSize = "big" | "sec";

/** Round thumb pad: glassy disc, icon + short label, red when pressed. */
function Pad({ btn, size, style, className = "" }: { btn: Btn; size: PadSize; style?: CSSProperties; className?: string }) {
  const { down, handlers } = usePress(btn);
  const Icon = btn.icon;
  const big = size === "big";
  return (
    <button
      type="button"
      aria-label={btn.aria ?? btn.label}
      {...handlers}
      style={{ width: `var(--tc-${size})`, height: `var(--tc-${size})`, ...style }}
      className={`pointer-events-auto flex touch-none select-none flex-col items-center justify-center gap-[2px] rounded-full font-semibold leading-none tracking-[-0.01em] backdrop-blur-md transition-[transform,background-color,box-shadow] duration-75 [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
        down
          ? "scale-90 bg-red text-white shadow-[0_0_0_4px_rgba(227,10,23,0.3)]"
          : big
            ? "bg-white/75 text-[#0a0a0a] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.45)] ring-1 ring-white/70"
            : "bg-[#0a0a0a]/35 text-white shadow-[0_6px_18px_-10px_rgba(0,0,0,0.5)] ring-1 ring-white/45"
      } ${className}`}
    >
      {Icon && (
        <Icon
          aria-hidden
          strokeWidth={2.4}
          style={{ width: `calc(var(--tc-${size}) * ${btn.iconOnly ? 0.42 : 0.3})`, height: `calc(var(--tc-${size}) * ${btn.iconOnly ? 0.42 : 0.3})` }}
        />
      )}
      {!btn.iconOnly && (
        <span
          className="whitespace-nowrap"
          style={{ fontSize: big && !Icon ? "calc(var(--tc-big) * 0.26)" : `max(10px, calc(var(--tc-${size}) * 0.2))` }}
        >
          {btn.label}
        </span>
      )}
    </button>
  );
}

/** Small chip along the top edge (camera, reset, horn…). */
function Chip({ btn }: { btn: Btn }) {
  const { down, handlers } = usePress(btn);
  const Icon = btn.icon;
  return (
    <button
      type="button"
      aria-label={btn.aria ?? btn.label}
      {...handlers}
      className={`pointer-events-auto inline-flex h-[clamp(34px,9.5dvh,40px)] touch-none select-none items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] narrow:size-10 narrow:px-0 font-semibold backdrop-blur-md transition-[transform,background-color] duration-75 [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
        down ? "scale-95 bg-red text-white" : "bg-white/80 text-[#0a0a0a] ring-1 ring-white/70"
      }`}
    >
      {Icon && <Icon aria-hidden className="size-3.5 narrow:size-4" strokeWidth={2.4} />}
      {/* portrait: icon-only column, the top band is taken by the HUD */}
      <span className={Icon ? "narrow:hidden" : undefined}>{btn.label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Floating analog stick. A touch that starts anywhere in the left zone spawns
 * the base under the thumb; dragging moves the knob (the base follows if the
 * thumb runs past the rim). Presses W/A/S/D past a deadzone and publishes the
 * analog vector in `virtualStick`.
 */
function FloatingStick() {
  const zone = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const radius = useRef(50);
  const [active, setActive] = useState(false);

  const DZ = 0.3;
  const setKeys = (x: number, y: number) => {
    const set = (code: string, on: boolean) => (on ? pressVirtual(code) : releaseVirtual(code));
    set("KeyW", y > DZ);
    set("KeyS", y < -DZ);
    set("KeyA", x < -DZ);
    set("KeyD", x > DZ);
  };

  const place = () => {
    const b = baseEl.current;
    if (b) b.style.transform = `translate3d(${center.current.x}px, ${center.current.y}px, 0) translate(-50%, -50%)`;
  };

  const update = (clientX: number, clientY: number) => {
    const z = zone.current;
    if (!z) return;
    const r = z.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const R = radius.current;
    let dx = px - center.current.x;
    let dy = py - center.current.y;
    let d = Math.hypot(dx, dy);
    // thumb ran past the rim: drag the base along so the stick never "sticks" at the edge
    const follow = R * 1.15;
    if (d > follow) {
      const k = (d - follow) / d;
      center.current.x += dx * k;
      center.current.y += dy * k;
      place();
      dx = px - center.current.x;
      dy = py - center.current.y;
      d = Math.hypot(dx, dy);
    }
    const m = Math.min(1, d / R);
    const nx = d > 0 ? (dx / d) * m : 0;
    const ny = d > 0 ? (-dy / d) * m : 0;
    virtualStick.x = nx;
    virtualStick.y = ny;
    virtualStick.active = true;
    setKeys(nx, ny);
    const k = knobEl.current;
    if (k) k.style.transform = `translate(-50%, -50%) translate3d(${nx * R}px, ${-ny * R}px, 0)`;
  };

  const end = (e?: React.PointerEvent) => {
    if (e && pointer.current !== e.pointerId) return;
    pointer.current = null;
    virtualStick.x = 0;
    virtualStick.y = 0;
    virtualStick.active = false;
    setKeys(0, 0);
    setActive(false);
    const k = knobEl.current;
    if (k) k.style.transform = "translate(-50%, -50%)";
  };

  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={zone}
      role="application"
      aria-label="Hareket: sol başparmağını sürükle"
      className="pointer-events-auto absolute bottom-0 left-0 top-[clamp(5.5rem,24dvh,8rem)] w-[40%] touch-none select-none [-webkit-tap-highlight-color:transparent]"
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        pointer.current = e.pointerId;
        const z = e.currentTarget.getBoundingClientRect();
        const size = rest.current?.getBoundingClientRect().width || 120;
        radius.current = size * 0.36;
        // spawn under the thumb, but keep the whole base on screen
        const half = size / 2 + 4;
        center.current = {
          x: Math.max(half, Math.min(z.width - half * 0.6, e.clientX - z.left)),
          y: Math.max(half * 0.6, Math.min(z.height - half, e.clientY - z.top)),
        };
        place();
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
        className={`absolute rounded-full ring-1 ring-white/45 transition-opacity duration-200 ${active ? "opacity-0" : "opacity-100"}`}
        style={{
          width: "var(--tc-stick)",
          height: "var(--tc-stick)",
          left: EDGE_LEFT,
          bottom: EDGE_BOTTOM,
          background: "radial-gradient(circle, rgba(255,255,255,0.18) 0 34%, rgba(10,10,10,0.14) 35% 100%)",
        }}
      >
        <div className="absolute left-1/2 top-1/2 size-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 ring-1 ring-white/60" />
      </div>

      {/* live stick */}
      <div
        ref={baseEl}
        aria-hidden
        className={`absolute left-0 top-0 rounded-full bg-[#0a0a0a]/20 ring-1 ring-white/60 backdrop-blur-sm transition-opacity duration-100 ${active ? "opacity-100" : "opacity-0"}`}
        style={{ width: "var(--tc-stick)", height: "var(--tc-stick)" }}
      >
        <div
          ref={knobEl}
          className="absolute left-1/2 top-1/2 size-[42%] rounded-full bg-white/90 shadow-[0_4px_14px_rgba(0,0,0,0.3)]"
          style={{ transform: "translate(-50%, -50%)" }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

// secondary buttons sit on an arc around the primary (angles: 180° = left, 90° = up)
const ARC: Record<number, number[]> = {
  1: [150],
  2: [172, 98],
  3: [180, 135, 90],
};

function RightCluster({ buttons }: { buttons: Btn[] }) {
  const [primary, ...rest] = buttons;
  const angles = ARC[rest.length] ?? ARC[3];
  return (
    <div
      className="absolute"
      style={{
        right: EDGE_RIGHT,
        bottom: EDGE_BOTTOM,
        width: "var(--tc-big)",
        height: "var(--tc-big)",
        ["--tc-r" as string]: "calc(var(--tc-big) / 2 + var(--tc-sec) / 2 + var(--tc-gap))",
      }}
    >
      <Pad btn={primary} size="big" className="absolute inset-0" />
      {rest.map((b, i) => {
        const a = ((angles[i] ?? 135) * Math.PI) / 180;
        const cos = Math.cos(a).toFixed(4);
        const sin = Math.sin(a).toFixed(4);
        return (
          <Pad
            key={b.code}
            btn={b}
            size="sec"
            className="absolute"
            style={{
              right: `calc(var(--tc-big) / 2 - var(--tc-sec) / 2 - ${cos} * var(--tc-r))`,
              bottom: `calc(var(--tc-big) / 2 - var(--tc-sec) / 2 + ${sin} * var(--tc-r))`,
            }}
          />
        );
      })}
    </div>
  );
}

function SteerCluster({ layout }: { layout: Extract<Layout["left"], { kind: "steer" }> }) {
  const size: PadSize = layout.small ? "sec" : "big";
  return (
    <div
      className="absolute flex flex-col items-start"
      style={{ left: EDGE_LEFT, bottom: EDGE_BOTTOM, gap: "var(--tc-gap)" }}
    >
      {layout.extra && (
        <div className="flex" style={{ gap: "var(--tc-gap)" }}>
          {layout.extra.map((b) => (
            <Pad key={b.code} btn={b} size="sec" />
          ))}
        </div>
      )}
      <div className="flex" style={{ gap: "var(--tc-gap)" }}>
        <Pad btn={{ code: layout.codes[0], label: "", aria: layout.aria[0], icon: ChevronLeft, iconOnly: true }} size={size} />
        <Pad btn={{ code: layout.codes[1], label: "", aria: layout.aria[1], icon: ChevronRight, iconOnly: true }} size={size} />
      </div>
    </div>
  );
}

export default function TouchControls({ slug }: { slug: GameSlug }) {
  const layout = LAYOUTS[slug];
  useEffect(() => () => releaseAllVirtual(), []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none" style={SIZE_VARS}>
      {/* left thumb */}
      {layout.left.kind === "stick" && <FloatingStick />}
      {layout.left.kind === "steer" && <SteerCluster layout={layout.left} />}

      {/* right thumb */}
      <RightCluster buttons={layout.right} />

      {/* top chips (below the back button; an icon column in portrait) */}
      {layout.top && (
        <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[4.25rem] flex gap-2 short:left-[max(0.75rem,env(safe-area-inset-left))] short:top-[3.25rem] narrow:top-[3.5rem] narrow:flex-col">
          {layout.top.map((b) => (
            <Chip key={b.code} btn={b} />
          ))}
        </div>
      )}
    </div>
  );
}

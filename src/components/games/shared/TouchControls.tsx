"use client";

// On-screen controls for phones and tablets. Buttons and the joystick press
// the same KeyboardEvent.code values the games read from the keyboard (see
// ./input.ts), so the game code itself doesn't know touch exists. Dragging
// anywhere else on the canvas is the "mouse" (look / aim).

import { useEffect, useRef, useState } from "react";
import type { GameSlug } from "@/lib/games";
import { pressVirtual, releaseAllVirtual, releaseVirtual } from "./input";

interface Btn {
  code: string;
  label: string;
  /** big primary button */
  big?: boolean;
  /** tap-style (short press) rather than hold, e.g. camera toggle */
  tap?: boolean;
  /** accessible name when the label is just a glyph */
  aria?: string;
}

interface Layout {
  /** left thumb: a WASD joystick or a pair of steering buttons */
  left: { kind: "stick" } | { kind: "steer"; codes: [string, string] } | { kind: "buttons"; buttons: Btn[] };
  right: Btn[];
  /** small buttons along the top edge */
  top?: Btn[];
}

const LAYOUTS: Record<GameSlug, Layout> = {
  spiderman: {
    left: { kind: "stick" },
    right: [
      { code: "ShiftLeft", label: "Dalış" },
      { code: "Space", label: "Ağ", big: true },
    ],
    top: [{ code: "KeyR", label: "Başa dön", tap: true }],
  },
  drift: {
    left: { kind: "steer", codes: ["KeyA", "KeyD"] },
    right: [
      { code: "KeyS", label: "Fren" },
      { code: "Space", label: "El freni" },
      { code: "KeyW", label: "Gaz", big: true },
    ],
    top: [
      { code: "KeyC", label: "Kamera", tap: true },
      { code: "KeyR", label: "Sıfırla", tap: true },
    ],
  },
  f16: {
    left: {
      kind: "buttons",
      buttons: [
        { code: "KeyA", label: "◀", aria: "Dümen sola" },
        { code: "KeyD", label: "▶", aria: "Dümen sağa" },
        { code: "Space", label: "Tonoz", tap: true },
      ],
    },
    right: [
      { code: "KeyS", label: "Gaz −" },
      { code: "ShiftLeft", label: "AB" },
      { code: "KeyW", label: "Gaz +", big: true },
    ],
    top: [
      { code: "KeyC", label: "Kokpit", tap: true },
      { code: "KeyR", label: "Sıfırla", tap: true },
    ],
  },
  traffic: {
    left: { kind: "steer", codes: ["KeyA", "KeyD"] },
    right: [
      { code: "KeyS", label: "Fren" },
      { code: "ShiftLeft", label: "Nitro" },
      { code: "KeyW", label: "Gaz", big: true },
    ],
    top: [
      { code: "KeyF", label: "Selektör" },
      { code: "KeyH", label: "Korna" },
    ],
  },
};

/** Help lines shown on the start sheet when playing by touch. */
export const TOUCH_HELP: Record<GameSlug, string[]> = {
  spiderman: ["Sol joystick: koş / havada yönlen", "Ağ: basılı tut, sallan; bırak, uç", "Ekranı sürükle: etrafa bak"],
  drift: ["Sol tuşlar: direksiyon", "Gaz, fren, el freni sağda", "El freniyle gir, gazla tut"],
  f16: ["Ekranı sürükle: nişan al, uçak oraya döner", "Sağda gaz ve afterburner", "Solda dümen (◀ ▶) ve tonoz"],
  traffic: ["Sol tuşlar: şerit değiştir", "Sağda gaz, fren, nitro", "Üstte selektör ve korna"],
};

function Pad({ btn, className = "" }: { btn: Btn; className?: string }) {
  const [down, setDown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDown(true);
    pressVirtual(btn.code);
    if (btn.tap) {
      // tap buttons: hold the key for a couple of frames so edge detection sees it
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => releaseVirtual(btn.code), 90);
    }
  };
  const release = () => {
    setDown(false);
    if (!btn.tap) releaseVirtual(btn.code);
  };
  return (
    <button
      type="button"
      aria-label={btn.aria ?? btn.label}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto grid select-none place-items-center rounded-full font-semibold tracking-[-0.01em] backdrop-blur transition-transform duration-75 [-webkit-touch-callout:none] ${
        btn.big ? "size-[84px] text-[15px] short:size-[72px]" : "size-[60px] text-[12.5px] short:size-[52px]"
      } ${down ? "scale-95 bg-[#ffd400] text-[#0a0a0a]" : "bg-white/80 text-[#0a0a0a]"} ${className}`}
    >
      {btn.label}
    </button>
  );
}

function TopPad({ btn }: { btn: Btn }) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDown(true);
        pressVirtual(btn.code);
        if (btn.tap) setTimeout(() => releaseVirtual(btn.code), 90);
      }}
      onPointerUp={() => {
        setDown(false);
        if (!btn.tap) releaseVirtual(btn.code);
      }}
      onPointerCancel={() => {
        setDown(false);
        if (!btn.tap) releaseVirtual(btn.code);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto h-9 select-none rounded-full px-3.5 text-[13px] font-semibold backdrop-blur ${
        down ? "bg-[#ffd400] text-[#0a0a0a]" : "bg-white/80 text-[#0a0a0a]"
      }`}
    >
      {btn.label}
    </button>
  );
}

/** Virtual thumb-stick that presses W/A/S/D. */
function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const apply = (x: number, y: number) => {
    const dz = 0.32;
    const set = (code: string, on: boolean) => (on ? pressVirtual(code) : releaseVirtual(code));
    set("KeyW", y < -dz);
    set("KeyS", y > dz);
    set("KeyA", x < -dz);
    set("KeyD", x > dz);
  };
  const update = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - (r.left + R)) / R;
    let y = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    setKnob({ x, y });
    apply(x, y);
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    apply(0, 0);
  };
  return (
    <div
      ref={base}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = e.pointerId;
        update(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      className="pointer-events-auto relative size-[132px] rounded-full bg-white/25 ring-1 ring-white/60 backdrop-blur short:size-[116px]"
      aria-label="Hareket"
      role="application"
    >
      <div
        className="absolute left-1/2 top-1/2 size-[56px] rounded-full bg-white/90 shadow-[0_4px_14px_rgba(0,0,0,0.25)]"
        style={{ transform: `translate(calc(-50% + ${knob.x * 38}px), calc(-50% + ${knob.y * 38}px))` }}
      />
    </div>
  );
}

export default function TouchControls({ slug }: { slug: GameSlug }) {
  const layout = LAYOUTS[slug];
  useEffect(() => () => releaseAllVirtual(), []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* top row (below the back button) */}
      {layout.top && (
        <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[4.25rem] flex gap-2 short:top-14">
          {layout.top.map((b) => (
            <TopPad key={b.code} btn={b} />
          ))}
        </div>
      )}

      {/* left thumb */}
      <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1.25rem,env(safe-area-inset-left))] flex items-end gap-3">
        {layout.left.kind === "stick" && <Stick />}
        {layout.left.kind === "steer" && (
          <>
            <Pad btn={{ code: layout.left.codes[0], label: "◀", aria: "Sola", big: true }} className="text-[22px]" />
            <Pad btn={{ code: layout.left.codes[1], label: "▶", aria: "Sağa", big: true }} className="text-[22px]" />
          </>
        )}
        {layout.left.kind === "buttons" && layout.left.buttons.map((b) => <Pad key={b.code} btn={b} />)}
      </div>

      {/* right thumb */}
      <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] flex items-end gap-3">
        {layout.right.map((b) => (
          <Pad key={b.code} btn={b} />
        ))}
      </div>
    </div>
  );
}

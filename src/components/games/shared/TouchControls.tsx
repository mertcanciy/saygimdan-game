"use client";

// On-screen controls for phones and tablets, one layout per game. Buttons
// press the same KeyboardEvent.code values the games read from the keyboard
// (see ./input.ts), so most game code doesn't know touch exists; the analog
// controls (stick, steering wheel, throttle lever) also publish their value
// for games that want it. Dragging elsewhere on the canvas is the "mouse".
//
// Primitives live in ./touch: the button kit (sizes, faces, slide-across
// clusters), the steering wheel, the floating stick and the throttle lever.

import { useEffect } from "react";
import { ChevronsDown, ChevronsUp, CircleParking, Flame, Footprints, Lightbulb, Megaphone, Rotate3d, RotateCcw, SwitchCamera, Zap } from "lucide-react";
import type { GameSlug } from "@/lib/games";
import { releaseAllVirtual, virtualKeys, virtualSteer, virtualStick, virtualThrottle } from "./input";
import { useTouchPrefs } from "./touchPrefs";
import { Chip, Cluster, EDGE_RIGHT, SIZE_VARS, type Btn, type PadItem } from "./touch/kit";
import SteeringWheel from "./touch/SteeringWheel";
import Stick from "./touch/Stick";
import ThrottleLever from "./touch/ThrottleLever";

interface Layout {
  /** left thumb */
  left: { kind: "stick"; keys: boolean; label?: string; rim?: "axis" | "radius" | "none" } | { kind: "wheel" };
  /** right thumb: a slide-across cluster anchored bottom-right */
  right: { items: PadItem[]; width: string; height: string; right?: string };
  /** F-16: throttle lever on the right edge */
  lever?: boolean;
  /** small chips along the top edge */
  top?: Btn[];
  /** Drift: "Oto gaz" switch (touchPrefs.driftAutoGas); on = DRIFT_AUTO_GAS cluster */
  autoGasToggle?: boolean;
}

const A = "var(--tc-a)";
const B = "var(--tc-b)";
const C = "var(--tc-c)";
const PW = "var(--tc-pw)";
const GAS_H = "var(--tc-gas-h)";
const BRAKE_H = "var(--tc-brake-h)";
const GAP = "var(--tc-gap)";
const centerIn = (outer: string, inner: string) => `calc((${outer} - ${inner}) / 2)`;

/** A round button stacked above a pedal. */
interface Extra {
  btn: Btn;
  size: string;
  tone?: PadItem["tone"];
}

/**
 * Car pedal box: gas in the corner, brake beside it, round buttons stacked
 * above each. The lowest button of each stack sits on a seam with the gas
 * pedal, so the thumb can hold both (gas + nitro, gas + horn / handbrake).
 */
function pedals(brake: Btn, overGas: Extra[], overBrake: Extra[]): Layout["right"] {
  const GAS = "KeyW";
  const items: PadItem[] = [
    {
      btn: { code: GAS, label: "Gaz", icon: ChevronsUp },
      shape: "pedal",
      tone: "primary",
      w: PW,
      h: GAS_H,
      right: "0px",
      bottom: "0px",
      chord: [overGas[0], overBrake[0]].filter((e): e is Extra => !!e).map((e) => e.btn.code),
    },
    { btn: brake, shape: "pedal", w: PW, h: BRAKE_H, right: `calc(${PW} + ${GAP})`, bottom: "0px" },
  ];
  const stack = (extras: Extra[], column: string, pedalH: string) => {
    let bottom = `(${pedalH} + ${GAP})`;
    extras.forEach((e, i) => {
      items.push({
        btn: e.btn,
        shape: "round",
        tone: e.tone,
        w: e.size,
        h: e.size,
        right: `calc(${column} + ${centerIn(PW, e.size)})`,
        bottom: `calc${bottom}`,
        chord: i === 0 ? GAS : undefined,
      });
      bottom = `(${bottom} + ${e.size} + ${GAP})`;
    });
    return `calc(${bottom} - ${GAP})`;
  };
  const tops = [stack(overGas, "0px", GAS_H), stack(overBrake, `(${PW} + ${GAP})`, BRAKE_H)];
  return { items, width: `calc(${PW} * 2 + ${GAP})`, height: `max(${tops[0]}, ${tops[1]})` };
}

const BRAKE: Btn = { code: "KeyS", label: "Fren", icon: ChevronsDown };
const HANDBRAKE: Btn = { code: "Space", label: "El freni", icon: CircleParking };

/** A web, for the web button (lucide has none). */
function WebGlyph({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  const rings = [3.2, 6.2, 9.4];
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + Math.PI / 8);
  const pt = (r: number, a: number) => `${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {spokes.map((a) => (
        <line key={a} x1="12" y1="12" x2={12 + Math.cos(a) * 11} y2={12 + Math.sin(a) * 11} />
      ))}
      {rings.map((r) => (
        <polygon key={r} points={spokes.map((a) => pt(r, a)).join(" ")} />
      ))}
    </svg>
  );
}

/** Spider-Man: big web button in the corner, secondaries on an arc around it. */
function arc(primary: PadItem, rest: { btn: Btn; deg: number }[]): Layout["right"] {
  const r = `(${A} / 2 + ${B} / 2 + ${GAP})`;
  const items: PadItem[] = [primary];
  for (const { btn, deg } of rest) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a).toFixed(4);
    const sin = Math.sin(a).toFixed(4);
    items.push({
      btn,
      shape: "round",
      w: B,
      h: B,
      right: `calc(${A} / 2 - ${B} / 2 - ${cos} * ${r})`,
      bottom: `calc(${A} / 2 - ${B} / 2 + ${sin} * ${r})`,
    });
  }
  return { items, width: `calc(${A} + ${GAP} + ${B})`, height: `calc(${A} / 2 + ${r} + ${B} / 2)` };
}

const LAYOUTS: Record<GameSlug, Layout> = {
  spiderman: {
    left: { kind: "stick", keys: true },
    right: arc({ btn: { code: "Space", label: "Ağ", icon: WebGlyph, aria: "Ağ at (basılı tut, kaydırınca kamera)" }, shape: "round", tone: "primary", w: A, h: A, right: "0px", bottom: "0px", look: true }, [
      { btn: { code: "KeyQ", label: "Zip", icon: Zap }, deg: 180 },
      { btn: { code: "ShiftLeft", label: "Koş", icon: Footprints }, deg: 100 },
    ]),
    top: [{ code: "KeyR", label: "Başa dön", icon: RotateCcw, tap: true }],
  },
  drift: {
    left: { kind: "wheel" },
    right: pedals(BRAKE, [], [{ btn: HANDBRAKE, size: A }]),
    top: [
      { code: "KeyC", label: "Kamera", icon: SwitchCamera, tap: true },
      { code: "KeyR", label: "Son kapı", icon: RotateCcw, tap: true },
    ],
    autoGasToggle: true,
  },
  f16: {
    left: { kind: "stick", keys: false, label: "Uçuş: sol başparmağını sürükle", rim: "axis" },
    lever: true,
    right: {
      items: [{ btn: { code: "Space", label: "Tonoz", icon: Rotate3d }, shape: "round", w: B, h: B, right: "0px", bottom: "0px" }],
      width: B,
      height: B,
      right: `calc(${EDGE_RIGHT} + var(--tc-lever-w) + ${GAP} * 1.4)`,
    },
    top: [
      { code: "KeyC", label: "Kokpit", icon: SwitchCamera, tap: true },
      { code: "KeyR", label: "Sıfırla", icon: RotateCcw, tap: true },
    ],
  },
  traffic: {
    left: { kind: "wheel" },
    // the horn used to be the wheel's hub: the steering thumb can't honk and steer at once
    right: pedals(
      BRAKE,
      [{ btn: { code: "ShiftLeft", label: "Nitro", icon: Flame }, size: B }],
      [
        { btn: { code: "KeyH", label: "Korna", icon: Megaphone }, size: B },
        { btn: { code: "KeyF", label: "Selektör", icon: Lightbulb }, size: C },
      ]
    ),
  },
};

/** Drift with automatic gas: the handbrake takes the gas pedal's corner, the brake stays beside it. */
const DRIFT_AUTO_GAS: Layout["right"] = {
  items: [
    { btn: HANDBRAKE, shape: "round", tone: "primary", w: A, h: A, right: "0px", bottom: "0px" },
    { btn: BRAKE, shape: "pedal", w: PW, h: BRAKE_H, right: `calc(${A} + ${GAP})`, bottom: "0px" },
  ],
  width: `calc(${A} + ${GAP} + ${PW})`,
  height: `max(${A}, ${BRAKE_H})`,
};

/** Help lines shown on the start sheet when playing by touch. */
export const TOUCH_HELP: Record<GameSlug, string[]> = {
  spiderman: [
    "Sol başparmak: koş; binaya doğru it: tırman",
    "Ağ: basılı tut sallan, bırak uç",
    "Havadayken sol başparmağı yana it: dönersin; Ağ basılıyken kaydırırsan kamera döner",
    "Zip: baktığın yere ağ fırlat, hızla çekil",
    "Koş: yerde depar, duvarda koşarak tırman, havada dalış",
  ],
  drift: [
    "Direksiyona dokun, parmağını sağa sola kaydır",
    "Gaz otomatik; üstteki Oto gaz'ı kapatırsan gaz pedalı gelir",
    "Hızlıyken el frenine dokun ve direksiyonu kır: drift. Düzelmek için ters direksiyon ya da fren",
  ],
  f16: [
    "Sol başparmak: yana it uçak yatıp döner, yukarı / aşağı it tırmanır / alçalır; bırakınca düzelir",
    "Çubuğu sonuna kadar it (halka kırmızı yanar): yukarı = takla atar, yana = sert dönüş",
    "Sağdaki kol gaz; en üste itersen afterburner. Tonoz: yana takla",
  ],
  traffic: [
    "Direksiyona dokun, parmağını sağa sola kaydır",
    "Sağda gaz ve fren; gazdan nitroya parmağını kaydırabilirsin",
    "Korna ya da selektör: öndeki araç yol verir. Gazla korna arasına basarsan ikisi birden",
  ],
};

export default function TouchControls({ slug }: { slug: GameSlug }) {
  const layout = LAYOUTS[slug];
  const autoGas = useTouchPrefs((s) => s.driftAutoGas);
  const setAutoGas = useTouchPrefs((s) => s.setDriftAutoGas);
  const right = layout.autoGasToggle && autoGas ? DRIFT_AUTO_GAS : layout.right;
  useEffect(() => {
    // dev-only handle for headless touch tests
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __touch?: unknown }).__touch = { keys: virtualKeys, steer: virtualSteer, stick: virtualStick, throttle: virtualThrottle };
    }
    return () => releaseAllVirtual();
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none" style={SIZE_VARS}>
      {/* left thumb */}
      {layout.left.kind === "stick" && <Stick keys={layout.left.keys} label={layout.left.label} rimMode={layout.left.rim} />}
      {layout.left.kind === "wheel" && <SteeringWheel />}

      {/* right thumb (a new cluster when the layout switches, so nothing stays pressed) */}
      {layout.lever && <ThrottleLever />}
      <Cluster key={right === DRIFT_AUTO_GAS ? "auto" : "manual"} items={right.items} width={right.width} height={right.height} right={right.right} />

      {/* top chips (below the back button; an icon column in portrait) */}
      {layout.top && (
        <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[4.25rem] flex gap-2 short:left-[max(0.75rem,env(safe-area-inset-left))] short:top-[3.25rem] narrow:top-[3.5rem] narrow:flex-col">
          {layout.top.map((b) => (
            <Chip key={b.code} btn={b} />
          ))}
          {layout.autoGasToggle && (
            <button
              type="button"
              aria-pressed={autoGas}
              aria-label="Otomatik gaz"
              onClick={() => setAutoGas(!autoGas)}
              className="pointer-events-auto inline-flex h-10 touch-manipulation select-none items-center gap-2 rounded-full bg-white/90 pl-2 pr-3.5 text-[13px] font-semibold text-[#0a0a0a] ring-1 ring-white/70 short:h-9 short:text-[12.5px] narrow:px-2"
            >
              {/* a small switch: the state reads at a glance */}
              <span aria-hidden className={`relative h-5 w-8 rounded-full transition-colors ${autoGas ? "bg-red" : "bg-[#0a0a0a]/25"}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${autoGas ? "left-3.5" : "left-0.5"}`} />
              </span>
              <span className="narrow:hidden">Oto gaz</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

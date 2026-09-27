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
import { ChevronsDown, ChevronsUp, CircleParking, Flame, Footprints, Lightbulb, Rotate3d, RotateCcw, SwitchCamera, Zap } from "lucide-react";
import type { GameSlug } from "@/lib/games";
import { releaseAllVirtual, virtualKeys, virtualSteer, virtualStick, virtualThrottle } from "./input";
import { Chip, Cluster, EDGE_RIGHT, SIZE_VARS, type Btn, type PadItem } from "./touch/kit";
import SteeringWheel from "./touch/SteeringWheel";
import Stick from "./touch/Stick";
import ThrottleLever from "./touch/ThrottleLever";

interface Layout {
  /** left thumb */
  left: { kind: "stick"; keys: boolean; label?: string } | { kind: "wheel"; horn?: string };
  /** right thumb: a slide-across cluster anchored bottom-right */
  right: { items: PadItem[]; width: string; height: string; right?: string };
  /** F-16: throttle lever on the right edge */
  lever?: boolean;
  /** small chips along the top edge */
  top?: Btn[];
}

const A = "var(--tc-a)";
const B = "var(--tc-b)";
const C = "var(--tc-c)";
const PW = "var(--tc-pw)";
const GAS_H = "var(--tc-gas-h)";
const BRAKE_H = "var(--tc-brake-h)";
const GAP = "var(--tc-gap)";
const centerIn = (outer: string, inner: string) => `calc((${outer} - ${inner}) / 2)`;

/** Car pedal box: gas in the corner, brake beside it, round extras above each. */
function pedals(brake: Btn, overGas: PadItem | null, overBrake: PadItem | null): Layout["right"] {
  const items: PadItem[] = [
    {
      btn: { code: "KeyW", label: "Gaz", icon: ChevronsUp },
      shape: "pedal",
      tone: "primary",
      w: PW,
      h: GAS_H,
      right: "0px",
      bottom: "0px",
      chord: overGas?.btn.code ?? overBrake?.btn.code,
    },
    { btn: brake, shape: "pedal", w: PW, h: BRAKE_H, right: `calc(${PW} + ${GAP})`, bottom: "0px" },
  ];
  if (overGas) items.push(overGas);
  if (overBrake) items.push(overBrake);
  const tops = [overGas ? `calc(${GAS_H} + ${GAP} + ${overGas.h})` : GAS_H, overBrake ? `calc(${BRAKE_H} + ${GAP} + ${overBrake.h})` : BRAKE_H];
  return { items, width: `calc(${PW} * 2 + ${GAP})`, height: `max(${tops[0]}, ${tops[1]})` };
}

const BRAKE: Btn = { code: "KeyS", label: "Fren", icon: ChevronsDown };

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
    right: pedals(BRAKE, null, {
      btn: { code: "Space", label: "El freni", icon: CircleParking },
      shape: "round",
      w: A,
      h: A,
      right: `calc(${PW} + ${GAP} + ${centerIn(PW, A)})`,
      bottom: `calc(${BRAKE_H} + ${GAP})`,
      chord: "KeyW",
    }),
    top: [
      { code: "KeyC", label: "Kamera", icon: SwitchCamera, tap: true },
      { code: "KeyR", label: "Son kapı", icon: RotateCcw, tap: true },
    ],
  },
  f16: {
    left: { kind: "stick", keys: false, label: "Uçuş: sol başparmağını sürükle" },
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
    left: { kind: "wheel", horn: "KeyH" },
    right: pedals(
      BRAKE,
      { btn: { code: "ShiftLeft", label: "Nitro", icon: Flame }, shape: "round", w: B, h: B, right: centerIn(PW, B), bottom: `calc(${GAS_H} + ${GAP})`, chord: "KeyW" },
      {
        btn: { code: "KeyF", label: "Selektör", icon: Lightbulb },
        shape: "round",
        w: C,
        h: C,
        right: `calc(${PW} + ${GAP} + ${centerIn(PW, C)})`,
        bottom: `calc(${BRAKE_H} + ${GAP})`,
      }
    ),
  },
};

/** Help lines shown on the start sheet when playing by touch. */
export const TOUCH_HELP: Record<GameSlug, string[]> = {
  spiderman: [
    "Sol başparmak: koş; binaya doğru it: tırman",
    "Ağ: basılı tut sallan, bırak uç",
    "Havadayken sol başparmakla sağa sola dön; Ağ basılıyken kaydırırsan kamera döner",
    "Zip: baktığın yere ağ fırlat, hızla çekil",
    "Koş: yerde depar, duvarda koşarak tırman, havada dalış",
  ],
  drift: [
    "Direksiyonu tut ve çevir",
    "Sağda gaz ve fren; parmağını kaldırmadan pedaldan pedala kaydır",
    "Hızlıyken el frenine dokun: drift. Gazı bırak: araç toparlar",
  ],
  f16: [
    "Sol başparmak: uçak o yöne döner, bırakınca düzlüğe çıkar",
    "Sağdaki kol gaz; en üste itersen afterburner",
    "Tonoz: yana takla",
  ],
  traffic: [
    "Direksiyonu tut ve çevir; ortasına bas: korna",
    "Sağda gaz ve fren; gazdan nitroya parmağını kaydırabilirsin",
    "Selektör yap: öndeki araç yol verir",
  ],
};

export default function TouchControls({ slug }: { slug: GameSlug }) {
  const layout = LAYOUTS[slug];
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
      {layout.left.kind === "stick" && <Stick keys={layout.left.keys} label={layout.left.label} />}
      {layout.left.kind === "wheel" && <SteeringWheel horn={layout.left.horn} />}

      {/* right thumb */}
      {layout.lever && <ThrottleLever />}
      <Cluster items={layout.right.items} width={layout.right.width} height={layout.right.height} right={layout.right.right} />

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

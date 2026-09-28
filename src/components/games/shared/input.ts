// Shared input state that isn't tied to a DOM keyboard: the on-screen touch
// controls press "virtual keys" (same KeyboardEvent.code names the games
// already read), so every game gets touch support without special cases.
// Analog controls (stick, steering wheel, throttle lever) also publish their
// value here for games that want more than on/off.

/** Codes currently held by on-screen buttons / the joystick. */
export const virtualKeys = new Set<string>();

/** Analog left stick from the touch controls: x right +, y forward/up +, magnitude 0..1. active=false when not touched. */
export const virtualStick = { x: 0, y: 0, active: false };

/** On-screen steering wheel: value -1 (full left) .. 1 (full right). active=false when not held. */
export const virtualSteer = { value: 0, active: false };

/**
 * On-screen throttle lever (F-16): value 0..1 while the lever is on screen,
 * null otherwise (keyboard throttle). ab = pushed into the afterburner detent.
 */
export const virtualThrottle: { value: number | null; ab: boolean } = { value: null, ab: false };

export function pressVirtual(code: string) {
  virtualKeys.add(code);
}

export function releaseVirtual(code: string) {
  virtualKeys.delete(code);
}

export function releaseAllVirtual() {
  virtualKeys.clear();
  virtualStick.x = 0;
  virtualStick.y = 0;
  virtualStick.active = false;
  virtualSteer.value = 0;
  virtualSteer.active = false;
}

/* ---- camera drags that start on a button (e.g. hold "Ağ" and slide to look) ---- */

type LookListener = (dx: number, dy: number) => void;
const lookListeners = new Set<LookListener>();

/** Subscribe to look drags coming from the touch controls (pixels). */
export function onVirtualLook(fn: LookListener) {
  lookListeners.add(fn);
  return () => {
    lookListeners.delete(fn);
  };
}

export function emitVirtualLook(dx: number, dy: number) {
  lookListeners.forEach((fn) => fn(dx, dy));
}

/* ---- touch mode ---- */

const TOUCH_OVERRIDE_KEY = "saygimdan-touch";

/**
 * Forced touch mode for testing: `?touch=1` turns the touch UI on, `?touch=0`
 * turns it off; the choice is remembered for the tab (sessionStorage).
 */
function touchOverride(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search).get("touch");
    if (q === "1" || q === "0") {
      sessionStorage.setItem(TOUCH_OVERRIDE_KEY, q);
      return q === "1";
    }
    const saved = sessionStorage.getItem(TOUCH_OVERRIDE_KEY);
    if (saved === "1" || saved === "0") return saved === "1";
  } catch {
    // storage blocked (private mode): fall back to detection
  }
  return null;
}

/** True on phones / tablets (coarse primary pointer, no hover), or when forced with `?touch=1`. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const forced = touchOverride();
  if (forced !== null) return forced;
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}

/** Tablet-sized touch screen (shorter side ≥ 700 CSS px): roomier controls, more pixels to fill. */
export function isTabletScreen(): boolean {
  if (typeof window === "undefined") return false;
  return Math.min(window.screen.width, window.screen.height) >= 700;
}

/* ---- display refresh rate ---- */

let displayHz = 60;
let displayHzPromise: Promise<void> | null = null;

/**
 * Measure the display's refresh rate from a bare requestAnimationFrame loop.
 * The game shell waits for this before mounting the scene; later, a slow GPU
 * and a 30 Hz low-power cap look the same.
 */
export function measureDisplayHz(): Promise<void> {
  if (typeof window === "undefined") return (displayHzPromise ??= Promise.resolve());
  displayHzPromise ??= new Promise<void>((resolve) => {
    const dts: number[] = [];
    let last = 0;
    let settled = false;
    const timeout = window.setTimeout(finish, 1500);
    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    }
    const tick = (t: number) => {
      if (settled) return;
      if (last) dts.push(t - last);
      last = t;
      if (dts.length < 45) {
        requestAnimationFrame(tick);
        return;
      }
      dts.sort((a, b) => a - b);
      const ms = dts[Math.floor(dts.length * 0.2)];
      displayHz = ms < 9.5 ? 120 : ms < 12.5 ? 90 : ms < 22 ? 60 : 30;
      finish();
    };
    requestAnimationFrame(tick);
  });
  return displayHzPromise;
}

/** Display refresh rate (Hz): 60 until measured. */
export function getDisplayHz() {
  return displayHz;
}

/* ---- Web Audio unlock ---- */

const audioContexts = new Set<AudioContext>();
let unlockBound = false;

function resumeAll() {
  audioContexts.forEach((c) => {
    if (c.state === "suspended") void c.resume().catch(() => {});
  });
}

/**
 * iOS Safari only lets an AudioContext start inside a user gesture. Contexts
 * created later (after the start button) stay "suspended" and a resume() from
 * the game loop is ignored, so resume them on the next tap / key instead.
 */
export function keepAudioContextUnlocked(ctx: AudioContext) {
  audioContexts.add(ctx);
  if (!unlockBound && typeof window !== "undefined") {
    unlockBound = true;
    for (const ev of ["pointerdown", "pointerup", "touchend", "keydown"]) window.addEventListener(ev, resumeAll, { capture: true, passive: true });
  }
  return () => {
    audioContexts.delete(ctx);
  };
}

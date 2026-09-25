// Shared input state that isn't tied to a DOM keyboard: the on-screen touch
// controls press "virtual keys" (same KeyboardEvent.code names the games
// already read), so every game gets touch support without special cases.

/** Codes currently held by on-screen buttons / the joystick. */
export const virtualKeys = new Set<string>();

/** Analog left stick from the touch controls: x right +, y forward/up +, magnitude 0..1. active=false when not touched. */
export const virtualStick = { x: 0, y: 0, active: false };

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
}

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

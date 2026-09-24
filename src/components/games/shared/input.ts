// Shared input state that isn't tied to a DOM keyboard: the on-screen touch
// controls press "virtual keys" (same KeyboardEvent.code names the games
// already read), so every game gets touch support without special cases.

/** Codes currently held by on-screen buttons / the joystick. */
export const virtualKeys = new Set<string>();

export function pressVirtual(code: string) {
  virtualKeys.add(code);
}

export function releaseVirtual(code: string) {
  virtualKeys.delete(code);
}

export function releaseAllVirtual() {
  virtualKeys.clear();
}

/** True on phones / tablets (coarse primary pointer, no hover). */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}

"use client";

import { useSyncExternalStore } from "react";
import { isTouchDevice } from "./input";

const noop = () => () => {};

/** True on touch-first devices (stable for the session). */
export function useIsTouch(): boolean {
  return useSyncExternalStore(noop, isTouchDevice, () => false);
}

function subscribeOrientation(cb: () => void) {
  const mq = window.matchMedia("(orientation: portrait)");
  mq.addEventListener("change", cb);
  window.addEventListener("resize", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("resize", cb);
  };
}

/** True while the viewport is taller than it is wide. */
export function useIsPortrait(): boolean {
  return useSyncExternalStore(
    subscribeOrientation,
    () => window.matchMedia("(orientation: portrait)").matches,
    () => false
  );
}

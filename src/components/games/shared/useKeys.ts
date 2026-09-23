"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const PREVENT = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** Set of currently-pressed KeyboardEvent.code values in a ref (no re-renders). */
export function useKeys(): RefObject<Set<string>> {
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  return keys;
}

/** Edge-detect helper: returns true only on the frame a key goes down. */
export function makeEdge() {
  const prev = new Set<string>();
  return (keys: Set<string>, code: string) => {
    const now = keys.has(code);
    const was = prev.has(code);
    if (now) prev.add(code);
    else prev.delete(code);
    return now && !was;
  };
}

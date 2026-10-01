"use client";

// Where the (movable) song player sits. Pure helpers + a tiny store; the
// dragging itself lives in SongDock.tsx.
//
// Two positions: the visitor's *preferred* one (saved per page kind and screen
// layout, as fractions of the free room so it survives resizes and rotations)
// and the *shown* one: the closest spot to the preference that doesn't cover
// anything marked `data-keep-clear` (touch controls, the back button row, the
// start sheet, the site nav…). Controls appearing / changing (Drift's auto-gas
// switch, the start sheet, a rotation) just move the shown spot; the
// preference stays.

import { create } from "zustand";

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Saved preference: 0..1 across the free room (0 = left / top edge, 1 = right / bottom edge). */
export interface Pref {
  fx: number;
  fy: number;
}

/** space kept between the player and the screen edge / a keep-clear area */
export const EDGE = 8;
const CLEAR = 6;
/** a drop this close to an edge sticks to it */
export const SNAP = 28;

export type ScreenKind = "wide" | "short" | "narrow";

/** the same split as the CSS variants (globals.css: short / narrow / wide) */
export function screenKind(w: number, h: number): ScreenKind {
  if (h <= 520) return "short";
  if (w <= 480) return "narrow";
  return "wide";
}

const STORE_KEY = "saygimdan-song-pos";

function readAll(): Record<string, Pref> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function loadPref(key: string): Pref | null {
  const p = readAll()[key];
  if (!p || !Number.isFinite(p.fx) || !Number.isFinite(p.fy)) return null;
  return { fx: clamp01(p.fx), fy: clamp01(p.fy) };
}

export function savePref(key: string, pref: Pref | null) {
  try {
    const all = readAll();
    if (pref) all[key] = pref;
    else delete all[key];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode: just this visit */
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Safe-area insets (notch / home bar), read once per call from a probe element. */
export function safeInsets(): Box {
  const p = document.createElement("div");
  p.style.cssText =
    "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const out = { l: parseFloat(cs.paddingLeft) || 0, t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  p.remove();
  return out;
}

/** The room the player's top-left corner can move in (keeps the whole dock on screen). */
export function room(w: number, h: number, size: { w: number; h: number }, safe: Box) {
  const x0 = EDGE + safe.l;
  const y0 = EDGE + safe.t;
  const x1 = Math.max(x0, w - EDGE - safe.r - size.w);
  const y1 = Math.max(y0, h - EDGE - safe.b - size.h);
  return { x0, y0, x1, y1 };
}

export function prefToPos(pref: Pref, rm: ReturnType<typeof room>) {
  return { x: rm.x0 + pref.fx * (rm.x1 - rm.x0), y: rm.y0 + pref.fy * (rm.y1 - rm.y0) };
}

export function posToPref(p: { x: number; y: number }, rm: ReturnType<typeof room>): Pref {
  const fx = rm.x1 > rm.x0 ? (p.x - rm.x0) / (rm.x1 - rm.x0) : 0;
  const fy = rm.y1 > rm.y0 ? (p.y - rm.y0) / (rm.y1 - rm.y0) : 0;
  return { fx: clamp01(fx), fy: clamp01(fy) };
}

/** Clamp into the room; within SNAP of an edge, stick to it. */
export function clampSnap(p: { x: number; y: number }, rm: ReturnType<typeof room>, snap: boolean) {
  let x = Math.min(rm.x1, Math.max(rm.x0, p.x));
  let y = Math.min(rm.y1, Math.max(rm.y0, p.y));
  if (snap) {
    if (x - rm.x0 < SNAP) x = rm.x0;
    else if (rm.x1 - x < SNAP) x = rm.x1;
    if (y - rm.y0 < SNAP) y = rm.y0;
    else if (rm.y1 - y < SNAP) y = rm.y1;
  }
  return { x, y };
}

/** Everything the player must not cover right now (visible `data-keep-clear` elements). */
export function keepClearBoxes(exclude: Element | null): Box[] {
  const out: Box[] = [];
  document.querySelectorAll("[data-keep-clear]").forEach((el) => {
    if (exclude?.contains(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  });
  return out;
}

function overlapArea(a: Box, b: Box) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The dock's real footprint: its `data-part` children (the player card, the
 * button column), relative to the dock's top-left. The empty corner next to a
 * short button column covers nothing, so it may sit over a control.
 */
export function partsOf(el: HTMLElement): Box[] {
  const r = el.getBoundingClientRect();
  const out: Box[] = [];
  el.querySelectorAll(":scope > [data-part]").forEach((c) => {
    const q = c.getBoundingClientRect();
    if (q.width < 1 || q.height < 1) return;
    out.push({ l: q.left - r.left, t: q.top - r.top, r: q.right - r.left, b: q.bottom - r.top });
  });
  return out.length ? out : [{ l: 0, t: 0, r: r.width, b: r.height }];
}

/** How much of the (gap-padded) parts at (x, y) lies over keep-clear boxes. */
function cover(x: number, y: number, parts: Box[], boxes: Box[]) {
  let c = 0;
  for (const p of parts) {
    const g = { l: x + p.l - CLEAR, t: y + p.t - CLEAR, r: x + p.r + CLEAR, b: y + p.b + CLEAR };
    for (const b of boxes) c += overlapArea(g, b);
  }
  return c;
}

/**
 * The spot closest to `want` where no part of the dock covers a keep-clear box
 * (with a small gap). If there is none (a tiny screen), the spot covering the least.
 */
export function resolve(want: { x: number; y: number }, parts: Box[], rm: ReturnType<typeof room>, boxes: Box[]): { x: number; y: number } {
  if (cover(want.x, want.y, parts, boxes) === 0) return want;
  // candidates: a grid over the room plus its edges and the spots that put a
  // part flush against a box (so the answer can sit right next to a control)
  const xs = new Set<number>([rm.x0, rm.x1, want.x]);
  const ys = new Set<number>([rm.y0, rm.y1, want.y]);
  const STEP = 8;
  for (let x = rm.x0; x <= rm.x1; x += STEP) xs.add(x);
  for (let y = rm.y0; y <= rm.y1; y += STEP) ys.add(y);
  for (const b of boxes)
    for (const p of parts) {
      xs.add(b.l - CLEAR - p.r);
      xs.add(b.r + CLEAR - p.l);
      ys.add(b.t - CLEAR - p.b);
      ys.add(b.b + CLEAR - p.t);
    }
  const inX = [...xs].filter((x) => x >= rm.x0 - 0.5 && x <= rm.x1 + 0.5);
  const inY = [...ys].filter((y) => y >= rm.y0 - 0.5 && y <= rm.y1 + 0.5);
  let best = want;
  let bestScore = Infinity;
  for (const x of inX)
    for (const y of inY) {
      // covering anything costs far more than any distance on screen
      const score = cover(x, y, parts, boxes) * 1e4 + Math.hypot(x - want.x, y - want.y);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  return best;
}

/**
 * Where the score tile goes while the player is up: its own corner if that's
 * free, else the first free spot of: left of the player, under it, left of it
 * lower down. Free = on screen, clear of the player and of every keep-clear box.
 * Returns null for "its own corner".
 */
export function placeScore(tile: { w: number; h: number }, corner: { right: number; top: number }, w: number, h: number, parts: Box[], boxes: Box[]): { right: number; top: number } | null {
  const rect = (right: number, top: number): Box => ({ l: w - right - tile.w, t: top, r: w - right, b: top + tile.h });
  const free = (q: Box) =>
    q.l >= 0 && q.t >= 0 && q.r <= w && q.b <= h && ![...parts, ...boxes].some((b) => overlapArea({ l: q.l - 4, t: q.t - 4, r: q.r + 4, b: q.b + 4 }, b) > 0);
  if (free(rect(corner.right, corner.top))) return null;
  const pl = Math.min(...parts.map((p) => p.l));
  const pt = Math.min(...parts.map((p) => p.t));
  const pb = Math.max(...parts.map((p) => p.b));
  const tries = [
    { right: w - pl + 8, top: corner.top },
    { right: corner.right, top: pb + 8 },
    { right: w - pl + 8, top: pt },
    { right: w - pl + 8, top: pb - tile.h },
  ];
  for (const c of tries) if (free(rect(c.right, c.top))) return c;
  return null;
}

/** The shown player's box while it's up (the HUD text reads it to step aside) and where the score goes. */
export const useSongDockBox = create<{ box: Box | null; inGame: boolean; score: { right: number; top: number } | null }>(() => ({
  box: null,
  inGame: false,
  score: null,
}));

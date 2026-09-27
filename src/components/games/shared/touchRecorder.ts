"use client";

// Touch recorder for real-device testing (`?rec=1` on a game page). Records
// every touch pointer event (with the coalesced in-between samples) while
// playing, so a session on a real phone can be replayed exactly in a headless
// browser: the thumb's real jitter, speed and contact timing. Keeps the last
// ~90 s. Nothing is sent anywhere; the player shares the file themselves.

const MAX_SAMPLES = 60000;
/** per sample: t (ms since start), type (0 down, 1 move, 2 up, 3 cancel), pointer id, x, y (CSS px × 10) */
const FIELDS = 5;

interface Recording {
  game: string;
  started: number;
  data: number[];
}

let rec: Recording | null = null;
let bound = false;

export function recordingRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("rec") === "1";
}

function push(type: number, e: PointerEvent) {
  if (!rec || e.pointerType !== "touch") return;
  const t = Math.round(e.timeStamp - rec.started);
  rec.data.push(t, type, e.pointerId, Math.round(e.clientX * 10), Math.round(e.clientY * 10));
  if (rec.data.length > MAX_SAMPLES * FIELDS) rec.data.splice(0, rec.data.length - MAX_SAMPLES * FIELDS);
}

const onDown = (e: PointerEvent) => push(0, e);
const onMove = (e: PointerEvent) => {
  const list = e.getCoalescedEvents?.();
  if (list && list.length) list.forEach((c) => push(1, c));
  else push(1, e);
};
const onUp = (e: PointerEvent) => push(2, e);
const onCancel = (e: PointerEvent) => push(3, e);

/** Start (or restart) recording for `game`. */
export function startTouchRecording(game: string) {
  rec = { game, started: performance.now(), data: [] };
  if (bound) return;
  bound = true;
  const o = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", onDown, o);
  window.addEventListener("pointermove", onMove, o);
  window.addEventListener("pointerup", onUp, o);
  window.addEventListener("pointercancel", onCancel, o);
}

export function touchRecordingSize(): number {
  return rec ? rec.data.length / FIELDS : 0;
}

/** Hand the recording over: the share sheet (AirDrop, Messages…) where available, else a download. */
export async function shareTouchRecording() {
  if (!rec) return;
  const body = JSON.stringify({
    v: 1,
    game: rec.game,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    ua: navigator.userAgent,
    at: new Date().toISOString(),
    fields: ["t", "type", "id", "x10", "y10"],
    data: rec.data,
  });
  const name = `saygimdan-${rec.game}-${Date.now()}.json`;
  const file = new File([body], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch {
    // share sheet dismissed / not allowed: fall back to a download
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { GripVertical, Play, X } from "lucide-react";
import { music, useMusicStore } from "@/lib/musicEngine";
import { useLoginDialog } from "@/lib/store";
import { MUSIC } from "@/lib/music";
import { useIsTouch } from "@/components/games/shared/useDevice";
import {
  type Box,
  type Pref,
  clampSnap,
  keepClearBoxes,
  loadPref,
  partsOf,
  placeScore,
  posToPref,
  prefToPos,
  resolve,
  room,
  safeInsets,
  savePref,
  screenKind,
  useSongDockBox,
} from "./songDockLayout";

/** Which game the open player is in (globals.css keys the per-game default gap off it). */
function markGame(slug: string) {
  document.documentElement.dataset.songOpen = slug;
}

/** Shown spot over the default classes (inline wins), or back to the classes. */
function setPos(el: HTMLElement, p: { x: number; y: number } | null) {
  const st = el.style;
  if (p) {
    st.left = `${p.x}px`;
    st.top = `${p.y}px`;
    st.right = "auto";
    st.bottom = "auto";
    st.transform = "none";
  } else {
    st.left = st.top = st.right = st.bottom = st.transform = "";
  }
}

/**
 * The song, always within reach. Mounted once in the root layout so it keeps
 * playing while you move from the landing page to the games and back.
 *
 * Closed: a small button. Open: the YouTube player itself, on screen, with
 * YouTube's own controls (the song only ever plays while it's open; closing it
 * pauses). The player box below stays mounted for the whole visit — the
 * iframe lives in it (lib/musicEngine.ts) and moving it in the DOM would reload
 * it — so only classes / the fixed position change.
 *
 * Movable: drag it by its handle (the header; on a phone in a game, the grip
 * beside it). Where it's dropped is remembered per page kind and screen layout
 * (songDockLayout.ts); it never covers touch controls or anything else marked
 * `data-keep-clear` (shown while dragging). Double-tap the handle: back to the
 * default spot. Arrow keys on the grip move it too.
 */
export default function SongDock() {
  const { playing, pending, mode, blocked, open, held, start, close } = useMusicStore();
  const pathname = usePathname();
  const touch = useIsTouch();
  const inGame = pathname.startsWith("/play");
  const slug = inGame ? (pathname.split("/")[2] ?? "") : "";
  // phones in a game: every pixel counts, so just the player (YouTube shows the
  // title in it); close / move buttons sit beside it, the status hangs below it
  const compact = touch && inGame;
  const bare = compact;

  const dock = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    music.attach(box.current);
    return () => music.attach(null);
  }, []);

  // Build the player before anyone presses play, so the press itself can start
  // it synchronously. Game pages: right away. Elsewhere: on the first
  // interaction (no YouTube download for visitors who only look).
  useEffect(() => {
    if (inGame) {
      void music.prepare();
      return;
    }
    const go = () => void music.prepare();
    const evs = ["pointerdown", "keydown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, go));
  }, [inGame]);

  // the sign-in sheet covers the player: no playing underneath it
  const loginOpen = useLoginDialog((s) => s.open);
  useEffect(() => music.hold("login", loginOpen), [loginOpen]);

  /* ---------------- position ---------------- */

  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  const kind = screenKind(vp.w, vp.h);
  const key = `${inGame ? slug : "site"}:${kind}${bare ? ":bare" : ""}`;
  const up = open && !held;

  // the visitor's preferred spot (per key). Where it's shown is written straight
  // onto the element (left / top over the default classes): it follows layout
  // measurements, not React state.
  const [pref, setPref] = useState<Pref | null>(null);
  const [prefKey, setPrefKey] = useState("");
  if (vp.w > 0 && prefKey !== key) {
    setPrefKey(key);
    setPref(loadPref(key));
  }
  const [, setTick] = useState(0);
  const dragging = useRef(false);
  const dragState = useRef<{ id: number; dx: number; dy: number; x0: number; y0: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const [drag, setDrag] = useState<{ boxes: Box[] } | null>(null);
  const [settle, setSettle] = useState(false);
  // put away mid-drag (the pause sheet, the sign-in sheet): the drag is over (layout() drops the pointer)
  if (!up && drag) setDrag(null);

  // controls come and go (the start sheet, Drift's auto-gas switch…): re-check now and then
  useEffect(() => {
    if (!up) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 700);
    return () => window.clearInterval(id);
  }, [up]);

  /** Where it's shown: the closest spot to the preference (or the default) that covers no control. */
  const layout = () => {
    const el = dock.current;
    const html = document.documentElement;
    if (!el || !up || window.innerWidth === 0) {
      if (el) {
        // closed / put away (sign-in sheet, paused phone game): back to the default
        // spot for the small button, and any drag in progress is over
        setPos(el, null);
        if (dragState.current) {
          dragState.current = null;
          dragging.current = false;
          if (box.current) box.current.style.pointerEvents = "";
        }
      }
      unpublish();
      return;
    }
    if (dragging.current) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // the game's own default gap (--song-gap) keys off data-song-open: set it before measuring
    if (inGame) markGame(slug);
    let r = el.getBoundingClientRect();
    const size = { w: r.width, h: r.height };
    if (size.w < 1) return;
    const rm = room(w, h, size, safeInsets());
    let want: { x: number; y: number };
    if (pref) want = prefToPos(pref, rm);
    else {
      // the default spot: what the classes give
      setPos(el, null);
      r = el.getBoundingClientRect();
      want = { x: r.left, y: r.top };
    }
    const best = resolve(want, partsOf(el), rm, keepClearBoxes(el));
    const atDefault = !pref && Math.abs(best.x - want.x) < 0.5 && Math.abs(best.y - want.y) < 0.5;
    setPos(el, atDefault ? null : best);
    publish(el, html, w, h);
  };

  /** Tell the HUD where it is, and turn the phone's buttons / status towards the screen centre. */
  const published = useRef("");
  const publish = (el: HTMLDivElement, html: HTMLElement, w: number, h: number) => {
    const r = el.getBoundingClientRect();
    const b: Box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    const cx = (b.l + b.r) / 2;
    el.dataset.btn = cx > w / 2 ? "left" : "right";
    if (b.b > h - 56) el.dataset.above = "";
    else delete el.dataset.above;
    // the score tile (HudStack): its corner, or the first free spot next to the player
    let score: { right: number; top: number } | null = null;
    const tile = inGame ? document.querySelector("[data-hud-tile]") : null;
    if (tile) {
      const tr = tile.getBoundingClientRect();
      const phone = kind !== "wide";
      const corner = { right: phone ? 12 : 16, top: phone ? 10 : 16 };
      const parts = partsOf(el).map((p) => ({ l: p.l + b.l, t: p.t + b.t, r: p.r + b.l, b: p.b + b.t }));
      score = placeScore({ w: tr.width, h: tr.height }, corner, w, h, parts, keepClearBoxes(el));
    }
    const s = `${inGame}:${Math.round(b.l)}:${Math.round(b.t)}:${Math.round(b.r)}:${Math.round(b.b)}:${w}:${h}:${kind}:${score?.right}:${score?.top}`;
    if (s === published.current) return;
    published.current = s;
    useSongDockBox.setState({ box: b, inGame, score });
    if (!inGame) {
      delete html.dataset.songOpen;
      delete html.dataset.songSide;
      return;
    }
    html.dataset.songOpen = slug;
    html.dataset.songKind = kind;
    // centred HUD text: away from the player's side (portrait, player up top: below it)
    if (kind === "narrow" && b.b < h * 0.45) {
      html.dataset.songSide = "top";
      html.style.setProperty("--song-pad", `${Math.round(b.b + 12)}px`);
    } else if (cx > w / 2) {
      html.dataset.songSide = "right";
      html.style.setProperty("--song-pad", `${Math.round(w - b.l + 12)}px`);
    } else {
      html.dataset.songSide = "left";
      html.style.setProperty("--song-pad", `${Math.round(b.r + 12)}px`);
    }
  };
  const unpublish = () => {
    if (!published.current) return;
    published.current = "";
    const html = document.documentElement;
    useSongDockBox.setState({ box: null, inGame: false, score: null });
    delete html.dataset.songOpen;
    delete html.dataset.songSide;
    delete html.dataset.songKind;
  };

  useLayoutEffect(layout);
  useEffect(() => unpublish, []);

  /* ---------------- dragging ---------------- */


  const currentRoom = () => {
    const el = dock.current!;
    const r = el.getBoundingClientRect();
    return { r, rm: room(window.innerWidth, window.innerHeight, { w: r.width, h: r.height }, safeInsets()) };
  };

  /** Drop at `p`: stick to edges, step off any control, remember it. */
  const place = (p: { x: number; y: number }, snap: boolean) => {
    const el = dock.current;
    if (!el) return;
    const { rm } = currentRoom();
    const want = clampSnap(p, rm, snap);
    const best = resolve(want, partsOf(el), rm, keepClearBoxes(el));
    const pr = posToPref(best, rm);
    savePref(key, pr);
    setPref(pr);
    setSettle(true);
    window.setTimeout(() => setSettle(false), 220);
    setPos(el, best);
    publish(el, document.documentElement, window.innerWidth, window.innerHeight);
  };

  const resetPlace = () => {
    savePref(key, null);
    setPref(null);
    setSettle(true);
    window.setTimeout(() => setSettle(false), 220);
  };

  const onHandleDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || e.button !== 0 || dragState.current) return;
    if ((e.target as Element).closest("[data-no-drag]")) return;
    const el = dock.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    dragState.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d || e.pointerId !== d.id) return;
    // the games listen on window (F-16's mouse aim): this move is ours
    e.stopPropagation();
    const el = dock.current;
    if (!el) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      d.moved = true;
      dragging.current = true;
      // the iframe would swallow the pointer as it passes over it
      if (box.current) box.current.style.pointerEvents = "none";
      const r = el.getBoundingClientRect();
      setPos(el, { x: r.left, y: r.top });
      setDrag({ boxes: keepClearBoxes(el) });
    }
    const { rm } = currentRoom();
    const p = clampSnap({ x: e.clientX - d.dx, y: e.clientY - d.dy }, rm, false);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d || e.pointerId !== d.id) return;
    e.stopPropagation();
    dragState.current = null;
    if (box.current) box.current.style.pointerEvents = "";
    if (!d.moved) {
      // a tap: two in a row put it back where it started
      const now = performance.now();
      if (e.type === "pointerup" && now - lastTap.current < 350) {
        lastTap.current = 0;
        resetPlace();
      } else lastTap.current = now;
      return;
    }
    dragging.current = false;
    setDrag(null);
    const el = dock.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    place({ x: r.left, y: r.top }, true);
  };

  const onHandleKey = (e: React.KeyboardEvent) => {
    const el = dock.current;
    if (!el) return;
    const step = e.shiftKey ? 64 : 16;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (e.key === "Home" || e.key === "0") {
      e.preventDefault();
      resetPlace();
      return;
    }
    if (!dx && !dy) return;
    e.preventDefault();
    e.stopPropagation(); // not a game key
    const r = el.getBoundingClientRect();
    place({ x: r.left + dx, y: r.top + dy }, false);
  };

  const handleProps = {
    onPointerDown: onHandleDown,
    onPointerMove: onHandleMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onMouseMove: (e: React.MouseEvent) => {
      if (dragState.current) e.stopPropagation();
    },
  };

  if (mode === "missing") return null;

  const status =
    mode === "error"
      ? "Oynatıcı yüklenemedi."
      : blocked
        ? "Başlatmak için oynatıcıdaki ▶ düğmesine dokun."
        : mode === "loading" || mode === "idle"
          ? "YouTube oynatıcısı yükleniyor…"
          : playing
            ? null
            : pending
              ? "Başlatılıyor…"
              : "Durdu. Oynatıcıdan devam edebilirsin.";

  // Default spots. In a game the open player takes the stats' place at the top
  // (the HUD shrinks to the score: GameHud → HudStack), clear of the thumbs:
  //   wide screens: top-right corner, the score tile moves to its left;
  //   landscape phones: top, just left of the right-hand buttons (--song-gap per game, globals.css);
  //   portrait phones: top-right, under the score tile.
  const placement =
    inGame && open
      ? "top-4 right-4 short:top-[max(0.625rem,env(safe-area-inset-top))] short:right-[calc(max(0.75rem,env(safe-area-inset-right))+var(--song-gap))] narrow:top-[calc(max(0.625rem,env(safe-area-inset-top))+3rem)] narrow:right-[max(0.5rem,env(safe-area-inset-right))]"
      : compact
        ? // portrait with the thumb controls up (PlayShell sets data-touch-controls): the bottom
          // edge is all thumbs, so park it on the right above the right-hand controls
          "bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 items-center [[data-touch-controls]_&]:narrow:bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+15.5rem)] [[data-touch-controls]_&]:narrow:left-auto [[data-touch-controls]_&]:narrow:right-[max(1rem,env(safe-area-inset-right))] [[data-touch-controls]_&]:narrow:translate-x-0 [[data-touch-controls]_&]:narrow:items-end"
        : "bottom-4 right-4 narrow:bottom-3 narrow:right-3";

  const sideBtn =
    "grid size-9 place-items-center rounded-full border border-line bg-paper/95 text-ink shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)]";
  const closeBtn = (
    <button
      type="button"
      data-no-drag
      onClick={close}
      aria-label="Oynatıcıyı kapat (şarkı durur)"
      title="Kapat (şarkı durur)"
      className={bare ? sideBtn : "grid size-8 shrink-0 place-items-center rounded-full hover:bg-soft phone:size-7"}
    >
      <X className="size-4" />
    </button>
  );
  const grip = (
    <button
      type="button"
      {...handleProps}
      onKeyDown={onHandleKey}
      aria-label="Oynatıcıyı taşı (sürükle; ok tuşları; çift dokunuş: eski yerine)"
      title="Sürükleyip taşı · çift dokun: eski yerine"
      className={
        bare
          ? `${sideBtn} cursor-grab touch-none select-none active:cursor-grabbing`
          : "grid size-8 shrink-0 cursor-grab touch-none select-none place-items-center rounded-full text-muted-ink hover:bg-soft active:cursor-grabbing phone:size-7"
      }
    >
      <GripVertical className="size-4" />
    </button>
  );
  const statusTone = blocked || mode === "error" ? "font-semibold text-red" : "text-muted-ink";
  const statusBody = status && (
    <>
      {status}
      {mode === "error" && (
        <button type="button" data-no-drag onClick={start} className="ml-1 underline underline-offset-2">
          Tekrar dene
        </button>
      )}
    </>
  );

  return (
    <>
      {/* while dragging: what it will step off */}
      {drag?.boxes.map((b, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none fixed z-[44] rounded-xl border-2 border-dashed border-red/70 bg-red/10"
          style={{ left: b.l, top: b.t, width: b.r - b.l, height: b.b - b.t }}
        />
      ))}
      <div
        ref={dock}
        // data-btn (which side the phone's buttons go) / data-above (status above): set by layout()
        className={`group/dock fixed z-[45] flex ${
          bare && open
            ? // buttons beside the player; portrait has no room beside it: under it
              "flex-row items-start gap-2 data-[btn=right]:flex-row-reverse narrow:flex-col-reverse narrow:items-end narrow:data-[btn=right]:flex-col-reverse narrow:data-[btn=right]:items-start"
            : "flex-col items-end"
        } ${placement} ${held ? "pointer-events-none invisible" : ""} ${settle ? "transition-[left,top] duration-200 ease-out" : ""}`}
        role="region"
        aria-label="Şarkı çalar"
      >
        {bare && open && (
          <div data-part className="flex flex-col gap-2 narrow:flex-row">
            {closeBtn}
            {grip}
          </div>
        )}
        {/* the player card (kept in the DOM while closed: invisible and paused) */}
        <div
          data-part
          aria-hidden={!open}
          className={`overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-[0_14px_40px_-16px_rgba(0,0,0,0.4)] ${
            open ? "" : "pointer-events-none invisible absolute bottom-0 right-0"
          }`}
        >
          {!bare && (
            <div
              {...handleProps}
              className={`flex cursor-grab touch-none select-none items-center gap-1 py-1.5 pl-1 pr-1.5 active:cursor-grabbing phone:py-1 ${drag ? "cursor-grabbing" : ""}`}
            >
              {grip}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-semibold tracking-[-0.01em]">
                  {MUSIC.artist}, {MUSIC.title}
                </div>
                <div className="truncate text-[11px] text-muted-ink phone:hidden">Resmi video, YouTube&apos;dan · sürükleyip taşı</div>
              </div>
              {closeBtn}
            </div>
          )}
          {/* YouTube asks for at least 200×200: 16:9 on wide screens, a square on phones */}
          <div ref={box} className="h-[200px] w-[356px] bg-ink phone:w-[200px]" />
          {!bare && statusBody && <div className={`max-w-[356px] px-3 py-1.5 text-[11.5px] leading-snug phone:max-w-[200px] ${statusTone}`}>{statusBody}</div>}
        </div>
        {bare && open && statusBody && (
          <div
            className={`absolute w-max max-w-[200px] rounded-xl bg-paper/95 px-2.5 py-1.5 text-[11.5px] leading-snug shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)] ${statusTone} ${
              "top-full mt-2 group-data-[above]/dock:top-auto group-data-[above]/dock:bottom-full group-data-[above]/dock:mt-0 group-data-[above]/dock:mb-2"
            } right-0 group-data-[btn=right]/dock:right-auto group-data-[btn=right]/dock:left-0`}
          >
            {statusBody}
          </div>
        )}

        {!open && (
          <button
            type="button"
            onClick={start}
            aria-label={`Şarkıyı aç: ${MUSIC.artist}, ${MUSIC.title}`}
            className={`flex items-center rounded-full border border-line text-ink ${
              // over a live game canvas a backdrop blur is recomputed every frame: skip it there
              inGame ? "bg-paper/95" : "bg-paper/95 backdrop-blur"
            } ${
              compact
                ? "gap-0 p-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)]"
                : "gap-3 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] narrow:gap-2.5 narrow:pr-3.5"
            }`}
          >
            <span className={`grid shrink-0 place-items-center rounded-full bg-red text-paper ${compact ? "size-11" : "size-10"}`}>
              <Play className="size-4 translate-x-px fill-current" />
            </span>
            <span className={`min-w-0 text-left leading-tight ${compact ? "hidden" : ""}`}>
              <span className="block whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em]">
                {MUSIC.artist}, {MUSIC.title}
              </span>
              <span className={`block whitespace-nowrap text-[11.5px] ${mode === "error" ? "font-semibold text-red" : "text-muted-ink"}`}>
                {mode === "error" ? "Yüklenemedi, tekrar dene" : "YouTube'da çal"}
              </span>
            </span>
          </button>
        )}
      </div>
    </>
  );
}

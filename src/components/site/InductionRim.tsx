"use client";

import { useEffect, useRef } from "react";

/*
 * "Induction" rim for the red buttons: a few thin strands of current run along
 * the button's edge and crackle at two drifting hot spots (top and bottom).
 * Pointing at the button pulls a hot spot under the cursor and lights the
 * whole rim; pressing sends a burst. Plain Canvas 2D (no WebGL): ~200 points
 * a frame, drawn only while the button is on screen, still with reduced motion.
 */
const PAD = 14; // room for the glow outside the button
const STEP = 3; // px between samples along the edge
const STRANDS = [
  { freq: 0.045, speed: 1.9, seed: 1.3, width: 1.1, alpha: 0.95 },
  { freq: 0.07, speed: -2.6, seed: 7.9, width: 0.9, alpha: 0.7 },
  { freq: 0.03, speed: 1.2, seed: 4.1, width: 1.4, alpha: 0.55 },
  { freq: 0.11, speed: 3.4, seed: 11.7, width: 0.7, alpha: 0.5 },
];

// smooth 1D value noise in [-1, 1]
function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
function noise(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

interface Edge {
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  n: number;
  len: number;
}

/** Points + outward normals around a rounded rect, every STEP px. */
function sampleEdge(w: number, h: number, r: number): Edge {
  r = Math.min(r, w / 2, h / 2);
  const straightW = w - 2 * r;
  const straightH = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const len = 2 * straightW + 2 * straightH + 4 * arc;
  const n = Math.max(24, Math.round(len / STEP));
  const e: Edge = { x: new Float32Array(n + 1), y: new Float32Array(n + 1), nx: new Float32Array(n + 1), ny: new Float32Array(n + 1), n, len };
  // segments clockwise from the top-left corner's end: top, TR arc, right, BR arc, bottom, BL arc, left, TL arc
  const segs: [number, (t: number) => [number, number, number, number]][] = [
    [straightW, (t) => [r + t * straightW, 0, 0, -1]],
    [arc, (t) => corner(w - r, r, -Math.PI / 2 + t * (Math.PI / 2))],
    [straightH, (t) => [w, r + t * straightH, 1, 0]],
    [arc, (t) => corner(w - r, h - r, t * (Math.PI / 2))],
    [straightW, (t) => [w - r - t * straightW, h, 0, 1]],
    [arc, (t) => corner(r, h - r, Math.PI / 2 + t * (Math.PI / 2))],
    [straightH, (t) => [0, h - r - t * straightH, -1, 0]],
    [arc, (t) => corner(r, r, Math.PI + t * (Math.PI / 2))],
  ];
  function corner(cx: number, cy: number, a: number): [number, number, number, number] {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [cx + c * r, cy + s * r, c, s];
  }
  for (let i = 0; i <= n; i++) {
    let d = (i / n) * len;
    for (let k = 0; k < segs.length; k++) {
      const [sl, f] = segs[k];
      if (d <= sl || k === segs.length - 1) {
        const [px, py, qx, qy] = f(sl > 0 ? Math.min(1, d / sl) : 0);
        e.x[i] = px;
        e.y[i] = py;
        e.nx[i] = qx;
        e.ny[i] = qy;
        break;
      }
      d -= sl;
    }
  }
  return e;
}

export default function InductionRim({ radius = 8 }: { radius?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let edge: Edge | null = null;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let t = Math.random() * 100;
    // 0..1: hover lights the rim, a press adds a burst that fades
    let hover = 0;
    let hoverTarget = 0;
    let burst = 0;
    let cursor = -1; // edge position (0..1) under the pointer, -1: none

    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round((w + PAD * 2) * dpr);
      canvas.height = Math.round((h + PAD * 2) * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      edge = sampleEdge(w, h, radius);
      draw();
    };

    const nearestEdge = (px: number, py: number) => {
      if (!edge) return -1;
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < edge.n; i += 2) {
        const d = (edge.x[i] - px) ** 2 + (edge.y[i] - py) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best / edge.n;
    };

    // hot spots along the edge (0..1): top and bottom centre (half a lap apart), drifting; + the cursor
    const heat = (s: number) => {
      const top = (w / 2 - radius) / (edge?.len ?? 1) + Math.sin(t * 0.37) * 0.06;
      const spots = [top, top + 0.5 + Math.sin(t * 0.29 + 2) * 0.06];
      let v = 0;
      for (let k = 0; k < 2; k++) {
        let d = Math.abs(s - spots[k]);
        d = Math.min(d, 1 - d);
        v += Math.exp(-((d / 0.06) ** 2));
      }
      if (cursor >= 0) {
        let d = Math.abs(s - cursor);
        d = Math.min(d, 1 - d);
        v += hover * 1.6 * Math.exp(-((d / 0.08) ** 2));
      }
      return v;
    };

    function draw() {
      if (!edge) return;
      ctx!.clearRect(0, 0, w + PAD * 2, h + PAD * 2);
      ctx!.save();
      ctx!.translate(PAD, PAD);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.lineJoin = "round";
      const energy = 0.35 + hover * 0.65 + burst;

      // soft red halo along the whole rim (brighter when pointed at)
      // the site's red (--red #dc1e2a), a shade brighter where the current is strong
      ctx!.shadowColor = "rgba(220, 30, 42, 0.85)";
      ctx!.shadowBlur = 10 + 10 * energy;
      ctx!.strokeStyle = `rgba(220, 30, 42, ${0.3 + 0.35 * energy})`;
      ctx!.lineWidth = 1.6;
      ctx!.beginPath();
      for (let i = 0; i <= edge.n; i++) (i ? ctx!.lineTo : ctx!.moveTo).call(ctx, edge.x[i], edge.y[i]);
      ctx!.closePath();
      ctx!.stroke();

      // the strands: displaced along the normal, most where the rim is hot
      ctx!.shadowBlur = 6 + 6 * energy;
      for (const st of STRANDS) {
        ctx!.beginPath();
        for (let i = 0; i <= edge.n; i++) {
          const s = i / edge.n;
          const d = s * edge.len;
          const amp = 0.5 + (heat(s) * 4.5 + burst * 3) * (0.6 + 0.4 * energy);
          const off =
            amp * (noise(d * st.freq + t * st.speed + st.seed * 10) * 0.75 + noise(d * st.freq * 3.1 - t * st.speed * 1.7 + st.seed) * 0.35);
          const x = edge.x[i] + edge.nx[i] * off;
          const y = edge.y[i] + edge.ny[i] * off;
          if (i) ctx!.lineTo(x, y);
          else ctx!.moveTo(x, y);
        }
        ctx!.closePath();
        ctx!.lineWidth = st.width;
        ctx!.strokeStyle = `rgba(${220 + 20 * energy}, ${30 + 30 * energy}, ${42 + 28 * energy}, ${st.alpha * Math.min(1, 0.55 + energy)})`;
        ctx!.stroke();
      }
      ctx!.restore();
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      hover += (hoverTarget - hover) * Math.min(1, dt * 7);
      burst *= Math.exp(-dt * 3.2);
      draw();
      raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0;
    };
    const start = () => {
      if (reduced || raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onEnter = (e: PointerEvent) => {
      hoverTarget = 1;
      cursor = nearestEdge(...local(e));
    };
    const onMove = (e: PointerEvent) => {
      cursor = nearestEdge(...local(e));
    };
    const onLeave = () => {
      hoverTarget = 0;
    };
    const onDown = () => {
      burst = 1;
      if (reduced) draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      start();
    });
    io.observe(host);
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointerdown", onDown);
    resize();
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
    };
  }, [radius]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ inset: -PAD, width: `calc(100% + ${PAD * 2}px)`, height: `calc(100% + ${PAD * 2}px)` }}
    />
  );
}

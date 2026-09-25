"use client";

import { useEffect, useRef } from "react";

/**
 * The landing's vinyl: always turning slowly, spinning up like a turntable
 * while the song plays, and shedding fine red dust from its rim. Rotation and
 * dust share one rAF loop; speed changes are eased so nothing ever jumps.
 * The dust canvas sits between the disc and the sleeve and reaches past the
 * record so grains can drift out. Off-screen / background tab: paused.
 * Reduced motion: a still disc, no dust.
 */

const IDLE = (Math.PI * 2) / 14; // rad/s
const PLAY = (Math.PI * 2) / 2.2;
const MAX = 220;

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  deep: boolean;
}

/** soft round sprite, drawn once */
function sprite(rgb: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.35, `rgba(${rgb},0.55)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return c;
}

export default function RecordVinyl({ playing }: { playing: boolean }) {
  const disc = useRef<HTMLDivElement>(null);
  const dust = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const d = disc.current;
    const cv = dust.current;
    if (!d || !cv) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const red = sprite("220,30,42");
    const deep = sprite("150,10,22");
    const grains: Grain[] = [];
    let angle = 0;
    let omega = IDLE;
    let debt = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };
    resize();

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // turntable: ease towards the target speed (≈1 s to spin up, longer to wind down)
      const target = playingRef.current ? PLAY : IDLE;
      omega += (target - omega) * (1 - Math.exp(-(target > omega ? 1.6 : 0.8) * dt));
      angle = (angle + omega * dt) % (Math.PI * 2);
      d.style.transform = `rotate(${angle}rad)`;

      // disc geometry in the dust canvas' space
      const dr = d.getBoundingClientRect();
      const cr = cv.getBoundingClientRect();
      const cx = dr.left + dr.width / 2 - cr.left;
      const cy = dr.top + dr.height / 2 - cr.top;
      const R = dr.width / 2;

      // emit from the rim that sticks out of the sleeve (right-hand side)
      const k = (omega - IDLE) / (PLAY - IDLE);
      debt += dt * (10 + 55 * k);
      while (debt >= 1 && grains.length < MAX) {
        debt -= 1;
        const a = (Math.random() - 0.5) * Math.PI * 1.1; // −100°..100° around +x
        const rr = R * (0.94 + Math.random() * 0.08);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // outward drift plus a tangential flick in the spin direction (clockwise on screen)
        const out = 8 + Math.random() * 22 + 30 * k;
        const tan = omega * R * (0.08 + Math.random() * 0.12);
        grains.push({
          x: cx + ca * rr,
          y: cy + sa * rr,
          vx: ca * out - sa * tan,
          vy: sa * out + ca * tan - 4,
          age: 0,
          life: 2.2 + Math.random() * 2.6,
          size: 1.2 + Math.random() * (2.2 + 1.5 * k),
          deep: Math.random() < 0.3,
        });
      }
      if (debt > 1) debt = 1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (let i = grains.length - 1; i >= 0; i--) {
        const g = grains[i];
        g.age += dt;
        if (g.age >= g.life) {
          grains[i] = grains[grains.length - 1];
          grains.pop();
          continue;
        }
        // air: slow down, drift up a touch, a lazy sideways wander
        const drag = Math.exp(-0.9 * dt);
        g.vx = g.vx * drag + Math.sin((g.age + i) * 1.7) * 3 * dt;
        g.vy = g.vy * drag - 5 * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        const t = g.age / g.life;
        const alpha = Math.min(1, t * 6) * (1 - t) * (1 - t) * 0.85;
        const s = g.size * (1 + t * 0.8) * 3;
        ctx.globalAlpha = alpha;
        ctx.drawImage(g.deep ? deep : red, g.x - s / 2, g.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kick();

    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    });
    io.observe(cv);
    const onVis = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <div className="record-vinyl" aria-hidden>
        <div ref={disc} className="record-disc" />
      </div>
      {/* dust: in front of the disc, behind the sleeve, spilling past the record */}
      <canvas ref={dust} aria-hidden className="pointer-events-none absolute -inset-[18%] h-[136%] w-[136%]" />
    </>
  );
}

"use client";

import { cn } from "@/lib/utils";

/*
 * In-game HUD in the site's paper/ink language: white tiles, ink numbers,
 * the yellow highlighter for moments worth shouting about.
 * `accent` is the game's colour and is used only as a small marker.
 */

/** Stat tile (top-right). */
export function HudStat({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: string;
  sub?: string;
}) {
  return (
    <div className="min-w-[8.5rem] rounded-2xl bg-white/92 px-4 py-2.5 text-[#0a0a0a] shadow-[0_8px_24px_-14px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="flex items-center gap-1.5 text-[12px] text-[#6e6e6e]">
        <span className="size-1.5 rounded-full" style={{ background: accent }} aria-hidden />
        {label}
      </div>
      <div className="text-[26px] font-bold leading-[1.1] tracking-[-0.035em] tabular-nums">{value}</div>
      {sub && <div className="text-[12px] font-medium text-[#0a0a0a]">{sub}</div>}
    </div>
  );
}

/** Centered pill hint (e.g. "click to look around"). */
export function HudCenter({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 top-5 flex justify-center px-40", className)}>
      <span className="rounded-full bg-[#0a0a0a]/80 px-4 py-2 text-[13px] font-medium text-white backdrop-blur text-center">
        {text}
      </span>
    </div>
  );
}

/** Small hint near the bottom. */
export function HudHint({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4">
      <span className="rounded-full bg-white/90 px-4 py-2 text-[13px] text-[#0a0a0a] backdrop-blur">{text}</span>
    </div>
  );
}

/** Big banner (DRIFT!, Makas!, +100): ink type on the yellow highlighter. */
export function HudBanner({
  text,
  sub,
  keyId,
  className,
}: {
  text: string;
  /** kept for API compatibility; banners use the site highlighter */
  accent?: string;
  sub?: string;
  keyId?: string | number;
  className?: string;
}) {
  return (
    <div
      key={keyId}
      className={cn("pointer-events-none absolute inset-x-0 top-[20%] flex flex-col items-center animate-pop", className)}
    >
      <span className="bg-[#ffd400] px-3 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[1.05] tracking-[-0.05em] text-[#0a0a0a]">
        {text}
      </span>
      {sub && (
        <span className="mt-2 rounded-full bg-white/92 px-3 py-1 text-[14px] font-semibold text-[#0a0a0a]">{sub}</span>
      )}
    </div>
  );
}

/** Full-screen result / crash card. */
export function HudModal({
  title,
  lines,
  hint,
  tone = "neutral",
}: {
  title: string;
  /** kept for API compatibility */
  accent?: string;
  lines?: string[];
  hint?: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center",
        tone === "danger" ? "bg-[#d92d20]/15" : "bg-white/10"
      )}
    >
      <div className="rounded-[24px] bg-white px-9 py-7 text-center text-[#0a0a0a] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] animate-pop">
        <div className="text-[40px] font-extrabold leading-none tracking-[-0.05em]">{title}</div>
        {lines?.map((l) => (
          <div key={l} className="mt-2 text-[15px] text-[#6e6e6e]">
            {l}
          </div>
        ))}
        {hint && (
          <div className="mt-4 inline-block rounded-full bg-[#ffd400] px-3.5 py-1.5 text-[13px] font-semibold">{hint}</div>
        )}
      </div>
    </div>
  );
}

/** Progress-style bar (throttle, nitro). */
export function HudBar({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="min-w-[8.5rem] rounded-2xl bg-white/92 px-4 py-2.5 text-[#0a0a0a] shadow-[0_8px_24px_-14px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="flex justify-between text-[12px] text-[#6e6e6e]">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#ececea]">
        <div
          className="h-full rounded-full transition-[width] duration-100"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: accent }}
        />
      </div>
    </div>
  );
}

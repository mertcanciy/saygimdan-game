"use client";

export function HudStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-widest text-white/50">
        {label}
      </div>
      <div
        className="text-2xl font-extrabold tabular-nums leading-tight"
        style={{ color: accent, textShadow: `0 0 14px ${accent}aa` }}
      >
        {value}
      </div>
    </div>
  );
}

export function HudCenter({ text }: { text: string }) {
  return (
    <div className="absolute inset-x-0 top-1/3 flex justify-center pointer-events-none">
      <span className="text-white/80 text-lg bg-black/40 backdrop-blur rounded-xl px-6 py-3 border border-white/10">
        {text}
      </span>
    </div>
  );
}

export function HudHint({ text }: { text: string }) {
  return (
    <div className="absolute bottom-20 inset-x-0 flex justify-center pointer-events-none">
      <span className="text-white/50 text-xs bg-black/40 rounded-lg px-4 py-2">
        {text}
      </span>
    </div>
  );
}

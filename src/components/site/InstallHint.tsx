"use client";

// "Add to home screen" hint for iPhone / iPad. Android's browsers offer the
// install themselves (the web app manifest is enough); iOS never does, and the
// only way in is Share → Add to Home Screen, which few people know about.
// Shown in the browser only (not in the installed app), until dismissed.

import { useState, useSyncExternalStore } from "react";
import { Share, X } from "lucide-react";

const KEY = "saygimdan-install-hint";
const noop = () => () => {};

function shouldShow(): boolean {
  const ua = navigator.userAgent;
  // (iPadOS reports itself as a Mac; the touch points give it away)
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(KEY) === "1";
  } catch {
    // storage blocked: show it
  }
  return ios && !installed && !dismissed;
}

export default function InstallHint({ className = "" }: { className?: string }) {
  const available = useSyncExternalStore(noop, shouldShow, () => false);
  const [closed, setClosed] = useState(false);
  if (!available || closed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: hidden for this visit only
    }
    setClosed(true);
  };

  return (
    <aside
      aria-label="Ana ekrana ekle"
      className={`relative flex max-w-[34rem] items-start gap-4 rounded-2xl border border-line bg-paper py-4 pl-4 pr-12 animate-fade-up ${className}`}
    >
      {/* the app's icon: the record */}
      <span
        aria-hidden
        className="mt-0.5 size-11 shrink-0 rounded-[11px] bg-paper shadow-[0_0_0_1px_var(--line)] [background-image:radial-gradient(circle,#fff_0_4%,var(--red)_5%_15%,#000_16%_42%,transparent_43%)]"
      />
      <div className="text-[15px] leading-[1.45]">
        <p className="font-semibold text-ink">Ana ekrana ekle, tam ekran oyna.</p>
        <p className="mt-1 text-muted-ink">
          <Share aria-label="Paylaş" className="mb-1 inline size-4 text-ink" /> düğmesine dokun, sonra &ldquo;Ana Ekrana Ekle&rdquo;. İlk açışta
          adını bir kez daha yazman gerekir.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Kapat"
        className="absolute right-2 top-2 grid size-10 place-items-center rounded-full text-muted-ink hover:bg-soft hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}

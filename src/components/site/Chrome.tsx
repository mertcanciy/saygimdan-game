"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-baseline gap-[2px] text-[22px] font-extrabold tracking-[-0.05em] ${className}`}>
      saygımdan
      <span aria-hidden className="inline-block size-[0.3em] rounded-full bg-yellow" />
    </Link>
  );
}

/** Black pill with the yellow arrow disc. Renders a Link when `href` is set. */
export function Pill({
  children,
  href,
  onClick,
  type = "button",
  small,
  disabled,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  small?: boolean;
  disabled?: boolean;
}) {
  const cls = `pill ${small ? "pill-sm" : ""}`;
  const inner = (
    <>
      <span>{children}</span>
      <span className="disc" aria-hidden>
        <ArrowRight className={small ? "size-4" : "size-[18px]"} strokeWidth={2.2} />
      </span>
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

export function SiteNav({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 h-[var(--nav-h)] border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between gap-6 px-5 sm:px-10">
        <Wordmark />
        <nav className="flex items-center gap-2 sm:gap-8 text-[15px] text-muted-ink">{children}</nav>
      </div>
    </header>
  );
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {keys.map((k) => (
        <kbd key={k} className="key">
          {k}
        </kbd>
      ))}
    </span>
  );
}

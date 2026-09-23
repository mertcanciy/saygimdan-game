import type { GameSlug } from "@/lib/games";

/** In-game screenshot for a game (public/covers/<slug>.jpg), captured from the real scenes. */
export default function GameShot({
  slug,
  alt,
  className = "",
  priority,
}: {
  slug: GameSlug;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static screenshots, sized by CSS
    <img
      src={`/covers/${slug}.jpg`}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`block h-full w-full object-cover bg-soft ${className}`}
    />
  );
}

import type { Viewport } from "next";
import { notFound } from "next/navigation";
import { getGame } from "@/lib/games";
import PlayShell from "@/components/PlayShell";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();
  return <PlayShell game={game} />;
}

export function generateStaticParams() {
  return [
    { slug: "spiderman" },
    { slug: "drift" },
    { slug: "f16" },
    { slug: "traffic" },
  ];
}

// games are touch-driven on phones: no pinch-zoom, draw under the notch
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

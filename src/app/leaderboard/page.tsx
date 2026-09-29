import type { Metadata } from "next";
import { Suspense } from "react";
import LeaderboardView from "./LeaderboardView";

export const metadata: Metadata = {
  title: "Liderlik Tablosu · Saygımdan",
  description: "Saygımdan oyunlarının genel ve oyun bazında liderlik tablosu.",
};

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <LeaderboardView />
    </Suspense>
  );
}

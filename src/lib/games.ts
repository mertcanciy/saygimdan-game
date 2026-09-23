export type GameSlug = "spiderman" | "drift" | "f16" | "traffic";

export interface GameInfo {
  slug: GameSlug;
  title: string;
  subtitle: string;
  description: string;
  controls: string[];
  accent: string;
}

export const GAMES: GameInfo[] = [
  {
    slug: "spiderman",
    title: "Ağ Sallan",
    subtitle: "Şehirde ağ atarak süzül",
    description:
      "Neon gökdelenlerin arasında ağ at, sark, bırak ve tekrar yakala. Saygımdan çalarken şehir senin oyun alanın.",
    controls: [
      "Fare sol tık (basılı): ağ at ve sallan",
      "Bırak: uç",
      "WASD: yerde koş",
      "Space: zıpla",
    ],
    accent: "#e23636",
  },
  {
    slug: "drift",
    title: "Drift",
    subtitle: "Gece şehrinde drift yap",
    description:
      "El frenine asıl, aracı yatır, neon ışıkların altında lastikleri yak. Puanların en yüksek drift zincirine göre hesaplanır.",
    controls: [
      "W/S: gaz/fren",
      "A/D: direksiyon",
      "Space: el freni (drift)",
      "C: kamera",
    ],
    accent: "#a855f7",
  },
  {
    slug: "f16",
    title: "F-16",
    subtitle: "Şehrin üzerinde alçak uçuş",
    description:
      "Binaların arasından süzül, köprü altından geç, afterburner'ı aç. Dikkat: gökdelenler affetmez.",
    controls: [
      "Fare veya ok tuşları: pitch/roll",
      "A/D: yaw",
      "W/S: gaz",
      "C: kamera",
    ],
    accent: "#38bdf8",
  },
  {
    slug: "traffic",
    title: "Makas",
    subtitle: "Trafikte first-person makas at",
    description:
      "Gece trafiğinde first-person şerit değiştir, arabaların arasından makas at. Ne kadar yakın, o kadar puan.",
    controls: [
      "A/D veya ←/→: şerit değiştir",
      "W/↑: gaz",
      "S/↓: fren",
    ],
    accent: "#f59e0b",
  },
];

export function getGame(slug: string): GameInfo | undefined {
  return GAMES.find((g) => g.slug === slug);
}

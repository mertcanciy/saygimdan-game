export type GameSlug = "spiderman" | "drift" | "f16" | "traffic";

export interface GameInfo {
  slug: GameSlug;
  title: string;
  subtitle: string;
  description: string;
  goal: string;
  controls: { keys: string[]; label: string }[];
  accent: string;
  /** soft tint used on the light UI (card glow, badges) */
  tint: string;
}

export const GAMES: GameInfo[] = [
  {
    slug: "spiderman",
    title: "Ağ Sallan",
    subtitle: "Gökdelenlerin arasında ağ atarak sallan",
    description:
      "Gökdelenlerin arasında ağ at, sark, bırak ve tekrar yakala. Şehre dağılmış ışık halkalarını topla, hızını koru.",
    goal: "Sokakların üstündeki halkalardan geç. Yere değmeden ne kadar uzun sallanırsan kombo o kadar büyür.",
    controls: [
      { keys: ["Sol Tık", "Space"], label: "basılı: ağ at ve sallan" },
      { keys: ["Bırak"], label: "ağı kes, uç" },
      { keys: ["W", "A", "S", "D"], label: "yerde koş / havada yönlen" },
      { keys: ["Shift"], label: "havada dalış (hız)" },
      { keys: ["R"], label: "başa dön" },
    ],
    accent: "#e11d48",
    tint: "#ffe4e6",
  },
  {
    slug: "drift",
    title: "Drift",
    subtitle: "Gece şehrinde sokak drifti",
    description:
      "Şehrin kapatılmış sokaklarında gece drift etkinliği. Hızlan, virajdan önce el frenine dokun, A/D ile açıyı tut, kavşakları yan yan dön. Drift zinciri uzadıkça çarpan büyür.",
    goal: "Sarı ışıklı kapılardan sırayla geç, virajları drift ederek dön ve köşe bonusu topla. En iyi tur süreni geliştir; sert çarparsan zincir kopar.",
    controls: [
      { keys: ["W", "S"], label: "gaz / fren-geri" },
      { keys: ["A", "D"], label: "direksiyon, driftte açıyı ayarlar" },
      { keys: ["Space"], label: "el freni: hızlıyken dokun, drifte gir" },
      { keys: ["C"], label: "kamera" },
      { keys: ["R"], label: "son kapıya dön" },
    ],
    accent: "#9333ea",
    tint: "#f3e8ff",
  },
  {
    slug: "f16",
    title: "F-16",
    subtitle: "Gün batımında çatıların üstünden alçak uçuş",
    description:
      "Binaların arasından süzül, afterburner'ı aç, takla at. Gökyüzündeki halkaların içinden geçerek puan topla. Gökdelenler affetmez.",
    goal: "Halkalardan geç, alçaktan uçtukça puan katlanır. Binaya çarparsan baştan.",
    controls: [
      { keys: ["Fare"], label: "nişan al, uçak oraya döner (önce ekrana tıkla)" },
      { keys: ["↑", "↓", "←", "→"], label: "doğrudan kumanda" },
      { keys: ["A", "D"], label: "dümen" },
      { keys: ["W", "S"], label: "gaz" },
      { keys: ["Shift"], label: "afterburner" },
      { keys: ["Space"], label: "tonoz" },
      { keys: ["C"], label: "kokpit" },
    ],
    accent: "#0284c7",
    tint: "#e0f2fe",
  },
  {
    slug: "traffic",
    title: "Makas",
    subtitle: "Gece otobanında direksiyon başında makas",
    description:
      "Gece otobanında şerit değiştir, arabaların arasından makas at. Yakın geçiş bonusu, kombo çarpanı; çarparsan hız ve kombo gider.",
    goal: "Arabaların dibinden geç, komboyu kaybetmeden mesafe yap.",
    controls: [
      { keys: ["A", "D"], label: "şerit değiştir" },
      { keys: ["W"], label: "gaz" },
      { keys: ["S"], label: "fren" },
      { keys: ["Shift"], label: "nitro" },
      { keys: ["F"], label: "selektör: öndeki araç yol verir" },
      { keys: ["H"], label: "korna" },
    ],
    accent: "#d97706",
    tint: "#fef3c7",
  },
];

export function getGame(slug: string): GameInfo | undefined {
  return GAMES.find((g) => g.slug === slug);
}

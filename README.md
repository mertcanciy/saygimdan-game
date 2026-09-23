# Saygımdan

Bengü'nün **Saygımdan** şarkısını sonsuz loop'ta dinlerken kafa dağıtmalık, open‑map tarzı 4 mini oyun.

## Akış

1. **Açılış** (`/`): büyük başlık, dört oyunu scroll ile gezdiren sabit bölüm ve isim + e‑posta ile giriş (Zustand, sadece `localStorage`).
2. **Oyunlar** (`/games`): gerçek oyun kareleriyle liste (`public/covers/*.jpg`).
3. **Oyun** (`/play/[slug]`): "Başlat" ile oyun ve şarkı başlar.

Şarkı çalar (`SongDock`) kök layout'ta durur; açılışta başlatırsan oyunlar arasında gezerken kesilmez.

## Oyunlar

| Oyun | Sahne | Ne var |
| --- | --- | --- |
| **Ağ Sallan** | Gündüz | Prosedürel iskeletli Spider‑Man (ağ desenli kostüm dokusu, koşu / sallanma / takla / iniş animasyonları), momentum koruyan sarkaç fiziği, akıllı ağ çapası seçimi. |
| **Drift** | Gece | Clearcoat boyalı prosedürel spor araba, ağırlık transferi ve gövde yalpası, yumuşak lastik dumanı, park yerleri ve 80 park halindeki araçla gerçek bir meydan. |
| **F‑16** | Gün batımı | Gerçek ölçekli F‑16 (hareketli kumanda yüzeyleri, afterburner, THK rozetleri), kokpit HUD'u, binaya çarpınca patlama, yüksek G'de kanat ucu izleri. |
| **Makas** | Gece | 2×3 şeritli otoyol, bariyerler, üst geçit tabelaları, instanced trafik (7 araç tipi), gerçekçi araç içi kokpit. |

## Ortak dünya (`src/components/games/shared/`)

- `cityGen.ts`: tohumlu şehir üretimi. Bloklar parsellere bölünür; binalar podyum, gövde ve kademeli üst katlardan oluşur. Çarpışma ve raycast yardımcıları.
- `facade.ts`: dünya koordinatlarında çalışan cephe shader'ı. Pencereler, doğramalar, kat döşemeleri, vitrinler ve çatı her binada gerçek ölçüde; cam panellerde yansıma kırılması, geceleri rastgele yanan pencereler.
- `City.tsx`: bina, yol çizgileri, yaya geçitleri, kaldırımlar, ağaçlar, sokak lambaları, çatı ekipmanları; hepsi instancing ile.
- `World.tsx`: `day` / `golden` / `night` ön ayarları: gökyüzü, kamerayı takip eden gölgeler, ortam yansımaları, sis ve post‑processing (N8AO, bloom, ACES, SMAA).

## Teknik

- Next.js 16 (App Router), React 19, TypeScript, Tailwind v4
- three, @react-three/fiber, drei, @react-three/postprocessing
- Zustand (persist)
- Yazı tipleri: Schibsted Grotesk, JetBrains Mono (sadece tuş kapakları)

## Geliştirme

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

Müzik için `public/audio/saygimdan.mp3` koyarsan doğrudan `<audio>` kullanılır; yoksa YouTube embed'e düşer (`NEXT_PUBLIC_YOUTUBE_ID` ile video değiştirilebilir).

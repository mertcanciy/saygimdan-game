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
| **Ağ Sallan** | Gündüz | Mocap + prosedürel katmanlı Spider‑Man (ağ desenli kostüm, "thwip" el pozu), momentum koruyan sarkaç fiziği, duvara tırmanma / duvarda koşma, zip + fırlama, çatıya atlama, ağ izleri. |
| **Drift** | Gece | Clearcoat boyalı prosedürel spor araba, ağırlık transferi ve gövde yalpası, yumuşak lastik dumanı, park yerleri ve 80 park halindeki araçla gerçek bir meydan. |
| **F‑16** | Gün batımı | Gerçek ölçekli F‑16 (hareketli kumanda yüzeyleri, afterburner, THK rozetleri), kokpit HUD'u, binaya çarpınca patlama, yüksek G'de kanat ucu izleri. |
| **Makas** | Gece | 2×3 şeritli otoyol, bariyerler, üst geçit tabelaları, instanced trafik (7 araç tipi), gerçekçi araç içi kokpit. |

## Ağ Sallan: hareket seti

| Hareket | Klavye / fare | Dokunmatik |
| --- | --- | --- |
| Ağ at, sallan; bırakınca uç | Space / sol tık (basılı) | Ağ (basılıyken kaydır: kamera) |
| Havada sağa sola dön | fare | Sol joystick |
| Zip: baktığın kenara ağ fırlat, hızla çekil; basılı tutarsan kenardan fırlarsın | Q / sağ tık | Zip |
| Duvara tırman (binaya doğru koş / havada çarp) | W A S D | Sol joystick |
| Duvarda koş, yerde depar, havada dalış | Shift | Koş (yerde: joystick'i sonuna kadar it) |
| Duvardan sıçra | Space (duvardayken) | Ağ |

- Tırmanma: `spiderman/wall.ts` bina hacimlerinin yüzlerini duvar olarak tanımlar. Köşeden yan yüze dönülür, bitişik binaya geçilir, üst kenarda çatıya atlanır; podyumlu kulelerde gövdenin tabanında podyum çatısına inilir.
- Ağ ipi fırlatıldıktan sonra hedefe varınca (≈240 m/s) gerer; yapıştığı yerde birkaç saniyelik ağ izi kalır (`spiderman/webSplat.ts`).
- Animasyon (`spiderman/heroAnim.ts`): mocap klipler + prosedürel katmanlar (duvarda sürünme yürüyüşü, duvarda koşu, zip, burgu/takla, thwip parmakları).
- Performans: 3D sahne HUD güncellemelerinde yeniden render edilmez (dört oyunda da); tüm shader'lar, gizli efektler dahil, oyun başında post‑processing hedefi için derlenip bir kez görünmez çizilir, böylece ilk sallanmada takılma olmaz.
- Test için dokunmatik modu zorlamak: `?touch=1` (kapatmak: `?touch=0`).

## Telefonda

- **Kontroller** (`shared/TouchControls.tsx`, `shared/touch/`): Drift ve Makas'ta solda tutup çevrilen direksiyon (Makas'ta ortası korna), sağda gaz / fren pedalları; Ağ Sallan ve F‑16'da solda yüzen joystick; F‑16'da sağda gaz kolu (en üst: afterburner). Sağ taraftaki butonlarda parmak kaldırmadan butondan butona kayılır, iki butonun arasına basınca ikisi birden basılır (Gaz + El freni, Gaz + Nitro).
- **Görüntü**: çözünürlük piksel bütçesiyle (telefonda ≈ DPR 1.8'den başlar), yavaş cihazda ölçülen fps'e göre tek adımda iner.
- **Şarkı**: Başlat'a dokunulduğu anda başlar (oynatıcı önceden hazırlanır); tarayıcı yine izin vermezse şarkı butonu "Şarkı için dokun" der.

## Ortak dünya (`src/components/games/shared/`)

- `cityGen.ts`: tohumlu şehir üretimi. Bloklar parsellere bölünür; binalar podyum, gövde ve kademeli üst katlardan oluşur. Çarpışma ve raycast yardımcıları.
- `facade.ts`: dünya koordinatlarında çalışan cephe shader'ı. Pencereler, doğramalar, kat döşemeleri, vitrinler ve çatı her binada gerçek ölçüde; cam panellerde yansıma kırılması, geceleri rastgele yanan pencereler.
- `City.tsx`: bina, yol çizgileri, yaya geçitleri, kaldırımlar, ağaçlar, sokak lambaları, çatı ekipmanları; hepsi instancing ile.
- `World.tsx`: `day` / `golden` / `night` ön ayarları: gökyüzü, kamerayı takip eden gölgeler, ortam yansımaları, sis ve post‑processing (N8AO, bloom, ACES, SMAA).
  - Başlat ekranı açıkken tüm shader'lar (gizli objeler dahil: afterburner, kokpit, patlama…) composer hedefi için derlenip bir kez çizilir; oyun içinde ilk kullanımda takılma olmaz.
  - N8AO'nun "transparency aware" modu kapalı (her kare sahneyi 2 kez daha render ediyordu); çözünürlük ~4.2 MP ile sınırlı.

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

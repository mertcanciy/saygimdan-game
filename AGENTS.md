<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Proje: Saygımdan

Şarkı çalarken oynanan 4 tarayıcı oyunu. Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, three + @react-three/fiber + drei + @react-three/postprocessing, Zustand. Backend yok (kullanıcı `localStorage`'da).

## Komutlar
- `npm run dev` · `npm run build` · `npm run lint` (test altyapısı yok; doğrulama = lint + build + tarayıcıda deneme)
- Deploy: Vercel, otomatik değil → `vercel --prod` (temiz `main` üzerinden)

## Dosya yapısı
```
src/app/
  layout.tsx              kök layout: SongDock (şarkı), Vercel Analytics
  page.tsx                açılış + giriş (isim/e-posta)
  games/page.tsx          oyun listesi
  play/[slug]/page.tsx    oyun sayfası (generateStaticParams, oyun viewport'u)
  manifest.ts             PWA: ad, /games açılışı, tam ekran, ikonlar (public/icons/); apple-icon.png, favicon.ico = plak
src/lib/
  games.ts                oyun kaydı: GameSlug, başlık, açıklama, kontroller, renk
  store.ts                Zustand: kullanıcı (persist); useMusicStore'u musicEngine'den verir
  musicEngine.ts          şarkı çalar (React dışında tekil): mp3 ya da gizli YouTube, useMusicStore
  music.ts                mp3 yolu / YouTube id
src/components/
  PlayShell.tsx           oyun kabuğu: Başlat ekranı, geri/tam ekran, dokunmatik/klavye yardım
  SongDock.tsx            şarkı çaların kumandası (UI); oynatıcıyı önceden hazırlar
  site/                   site UI (Chrome, plak, kapak görselleri, InstallHint: iPhone'a "Ana ekrana ekle" ipucu)
  games/
    index.ts              slug → oyun bileşeni (dynamic, ssr:false)
    Spiderman.tsx Drift.tsx F16.tsx Traffic.tsx   her oyun tek dosya: sahne + fizik + HUD
    shared/               tüm oyunların ortak parçaları
      World.tsx           gökyüzü/ışık/gölge/sis + post-processing, adaptif DPR, shader ısıtma
      City.tsx cityGen.ts facade.ts streetAssets.ts   tohumlu şehir, bina shader'ı, sokak objeleri
      GameHud.tsx         HUD bileşenleri
      TouchControls.tsx   oyun başına dokunmatik düzen (LAYOUTS, TOUCH_HELP)
      touch/              dokunmatik parçalar: kit.tsx (boyutlar, buton yüzleri, parmağı takip eden
                          Cluster), SteeringWheel.tsx, Stick.tsx, ThrottleLever.tsx
      touchPrefs.ts       dokunmatik tercihler (Drift otomatik gaz), cihazda saklanır
      touchRecorder.ts    ?rec=1 gerçek cihaz dokunuş kaydı (tekrar oynatmak için)
      input.ts useKeys.ts usePointerLook.ts useDevice.ts   klavye + sanal tuşlar/analog girdiler, fare, cihaz
      Particles.tsx Rings.tsx Car.tsx
    spiderman/ drift/ f16/ cars/   oyuna özel modüller (cars/ = Drift + Makas ortak araçlar)
public/models/ (spiderman.glb) · public/covers/<slug>.jpg (oyun kapakları)
```

## Bir oyun nasıl kurulu
- `Oyun({ started })` → `<Canvas dpr={useCanvasDpr()} gl={CANVAS_GL}>` + HUD. Sahne `useMemo` ile sarılı; HUD state'i (≈10 Hz) sahneyi yeniden render etmez.
- Sahne: `<WorldAtmosphere preset>` + içerik + en sonda `<WorldEffects preset started={started} />`.
- Oyun durumu `useRef` içinde, `useFrame`'de sabit adımlı fizik (1/120 s) + render interpolasyonu. Frame içinde allocation yok (modül seviyesi scratch vektörler).
- Girdi: `useKeys()` (klavye + dokunmatik sanal tuşlar aynı `KeyboardEvent.code` adlarıyla). Analog dokunmatik girdiler `input.ts`'te: `virtualStick` (sol çubuk), `virtualSteer` (direksiyon, sağ +), `virtualThrottle` (F-16 gaz kolu; `null` = klavye). `active` iken oyun bunları tuşlara tercih eder.

## Dokunmatik kontroller
- Boyutlar ekranın kısa kenarına göre (`vmin`, `touch/kit.tsx` → `SIZE_VARS`); yatay telefonda ana buton ≈82 px, direksiyon ≈160 px.
- Sağ taraftaki butonlar bir `Cluster`: parmak kaldırmadan butondan butona kayılır (Gaz → Nitro), `chord` iki butonun arasına basınca ikisini birden basar (Gaz + El freni), `look` butondan başlayan sürükleme kamerayı çevirir (Ağ).
- Joystick ve direksiyon **ilk temas noktasını** referans alır ve dokunuş boyunca değiştirmez: çıktı = parmağın ilk değdiği yerden uzaklığı (joystick kenarda kırpılır, merkez kaymaz; direksiyon sadece yatay kaymaya bakar, ~75 px = tam kilit). Açıya ya da ekran kenarına göre hesaplama geri getirme; telefonda "saçmalıyor" diye geri döndü.
- F-16 dokunmatikte sol çubukla uçar (`TOUCH_FLY`): yana = yatış açısı, yukarı/aşağı = tırmanış açısı, tutulur; bırakınca düz uçuş. Çubuğun ucu (eksen başına > 0.88, halka kırmızı yanar) sert manevra: yukarı = sürekli çekiş (loop), yana = 84° yatış + çekiş (sert dönüş), aşağı = dik dalış.
- Ağ Sallan'da havadayken sol çubuk döndürür, kamera arkadan takip eder (`TOUCH`): serbest uçuşta hız vektörü döner; ağdayken yanal çekiş kuvveti (ip olduğu yerde kalır; ip ucunu kaydırma), çapa arkada kalınca yeni ağ dönüşün iç tarafına (bekleme süreli).
- Makas: korna sağ grupta (frenin üstünde), gazla arasına basınca ikisi birden; direksiyon göbeği sadece süs (korna orada olunca direksiyonu çeviren başparmak korna çalamıyordu).
- Drift dokunmatikte varsayılan **otomatik gaz** (`touchPrefs.ts`, üstteki "Oto gaz" düğmesi, cihazda hatırlanır): sağda el freni + fren. Kapatınca pedallar gelir.
- Duraklatma (dokunmatik): oynarken aynı URL'ye bir geçmiş kaydı eklenir; iOS kenar kaydırması / Android geri hareketi oyundan çıkarmaz, duraklatma ekranını açar (ikinci geri gerçekten çıkar). Uygulama arka plana gidince de duraklar. `PlayShell.tsx` → `phase`.
- His testleri (`/tmp/sgmobile/t-feel.mjs` tipi): "girdi geliyor mu" yetmez; parmak X px oynayınca çıktı ne kadar, hızlı savuruşta tam kilide varıyor mu, ilk temas sıfır mı, dönüş hızı °/s kaç, bunları ölç.

## Şarkı
- Tarayıcılar sesi sadece dokunuşun içinde başlatır: çalmayı tıklama işleyicisinden **senkron** çağır (`music.play()` / `music.playUnlessPaused()`, ya da `useMusicStore().start`). Araya `await`, efekt ya da `setTimeout` girmesin.
- Oynatıcı önceden hazırlanır (`music.prepare()`: oyun sayfasında hemen, diğer sayfalarda ilk etkileşimde). Tarayıcı yine reddederse `blocked` olur; dock "Şarkı için dokun" der ve görünmez YouTube oynatıcısı dock'un çal butonunun üstüne yerleşir (dokunuş doğrudan YouTube'a gider).
- Web Audio (korna) için `keepAudioContextUnlocked(ctx)`: iOS'ta sonraki dokunuşta context'i açar.

## Yeni oyun eklerken dokunulacak yerler
`lib/games.ts` (GameSlug + kayıt) · `components/games/index.ts` · `app/play/[slug]/page.tsx` (generateStaticParams) · `shared/TouchControls.tsx` (LAYOUTS, TOUCH_HELP) · `public/covers/<slug>.jpg`

## Performans kuralları (ölçülerek bulundu)
- DPR'ı sadece `useCanvasDpr`/`WorldEffects` yönetir; Canvas'a sabit `dpr` verme (her render'da adaptif ayarı ezer).
- Mobilde çözünürlük piksel bütçesiyle (`TOUCH_BUDGETS`, 1.1 MP'den başlar ≈ telefonda DPR 1.8; tablet ×1.7). Sabit DPR 1 telefonda "düşük çözünürlüklü video" gibi görünüyordu. Yavaş cihaz ölçülen fps'e göre tek adımda doğru seviyeye iner (çoğu zaman Başlat ekranı açıkken), adım işe yaramazsa (30 Hz pil tasarrufu, CPU sınırı) durur, asla yukarı çıkmaz. Ekran tazeleme hızı sahne yüklenmeden ölçülür (`measureDisplayHz`).
- Mobilde bloom zinciri kısa (`levels 6`), SMAA `LOW`: daha az tam ekran geçiş = daha çok piksel.
- Oyun ekranında (canvas üstünde) `backdrop-blur` kullanma.
- N8AO'nun transparency-aware modunu açma (sahneyi 2 kez fazladan çizer).
- Gizli başlayan efektler shader ısıtmasına otomatik girer (`World.tsx` → `useWarmUp`); ayrıca bir şey gerekmez.
- Sık değişen instanced buffer'larda sadece değişen aralığı yükle (`addUpdateRange`).

## PWA
- Yüklenebilir uygulama: `app/manifest.ts` + ikonlar yeterli (service worker yok, offline yok; şarkı zaten internet istiyor). Kurulumu test etmek HTTPS ister (yerel `http://192.168…` adresinde telefon "Ana ekrana ekle"yi tam desteklemez) → Vercel önizleme.
- iPhone'da ana ekrandan açılan uygulama Safari'nin localStorage'ını görmez: kullanıcı ilk açışta adını tekrar girer.
- Yüklü uygulama tam ekran çalışırken (`display-mode: fullscreen`) oyundaki tam ekran düğmesi gizlenir.

## Mobil / test
- `?touch=1` / `?touch=0`: dokunmatik arayüzü zorla. Drift/Makas'ta `?cam=` debug kameraları.
- Tam ekran + yatay kilit `PlayShell.tsx`'te (iOS kilidi desteklemez → "yan çevir" ekranı).
- Headless test (sadece dev): `window.__touch` (sanal tuşlar + analog girdiler), `__traffic`, `__drift`, `__f16`, `__spider` (oyun durumu), `__music()` (şarkı durumu). Çoklu dokunuş için CDP `Input.dispatchTouchEvent` (parmağı kaldırmak: o noktayla `touchEnd`). `?gpuload=12`: her kareye milyon piksel başına 12 ms yük ekler (yavaş telefon GPU'su taklidi, adaptif kaliteyi denemek için).
- Mobil autoplay'i denemek için Chrome'u `--autoplay-policy=user-gesture-required` ile aç.
- Gerçek cihaz kaydı: oyun sayfasına `?rec=1` ekle → oyna → üstteki "● Kayıt" (ya da geri kaydır) → "Dokunuş kaydını paylaş" (paylaşım menüsü / indirme). Dosya gerçek parmak hareketlerini (koalesce örnekler dahil, son ~90 s) içerir; headless Chrome'da aynı viewport ile tekrar oynatılabilir (CDP touch). Hiçbir yere gönderilmez. `shared/touchRecorder.ts`.
- His testlerinde parmakları insanlaştır: hedeften birkaç px sapan temas, eğri ve yumuşak yol, ~120 Hz örnek, örnek başına ~1 px titreme. Sadece kusursuz sentetik dokunuşla geçen test yetmez.

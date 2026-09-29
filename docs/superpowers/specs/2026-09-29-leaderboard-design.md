# Giriş + Liderlik Tablosu (tasarım)

## Hedef
- E-posta toplamayı bırak. Giriş, "Oyna"ya basınca açılan bir pencerede: **kullanıcı adı + şifre** ya da **Google / Mail ile giriş** (Firebase Auth).
- Her oyundan çıkınca o oturumda kazanılan puan oyuncunun o oyundaki toplamına **eklenir**. Oyun tablosu = oyun toplamı, genel tablo = dört oyunun toplamı.
- Liderlik tablosu: navigasyonda + ana sayfanın altında + `/liderlik` sayfası (Genel / oyun sekmeleri) + her oyunun Başlat ekranında o oyunun ilk 5'i.

## Kimlik
- **Kullanıcı adı + şifre:** pencerede tek form. Ad yazılırken `GET /api/users?name=` adın kayıtlı olup olmadığını söyler: boşsa "Hesap aç ve oyna" (`POST /api/users {name, password}`), kayıtlıysa "Giriş yap" (`POST /api/login`). Şifre scrypt + tuz ile saklanır; aynı ada 15 dk'da 10 yanlış denemede kilit.
  - İlk sürümdeki şifresiz "misafir" adları çıkış yapınca sahipsiz kalıyordu (kullanıcı geri dönemedi) → kaldırıldı.
- **Firebase (Google ya da mail linki):** istemci Firebase ile girer, ID token'ı `POST /api/auth/firebase`'e yollar; sunucu `jose` + Google JWKS ile doğrular. Hesap bağlıysa giriş, değilse `needsName` → pencere ad ister (`POST /api/users {name, idToken}`). Bu hesapların şifresi yoktur; adla şifre girişi "Google/mail ile açılmış" der.
- Her girişte cihaza yeni bir token verilir (`Authorization: Bearer`), sunucuda SHA-256'sı tutulur.
- Kullanıcı adı: 2–16 karakter, harf/rakam/boşluk/`_.-`; benzersizlik anahtarı tr-TR küçük harf + `ı→i` (I/ı/İ/i aynı sayılır).
- Mail linki başka yerde açılırsa (PWA ↔ Safari, bilgisayar ↔ telefon) `auth/handoff` ile isteyen taraf da giriş yapar.

## Puan akışı
- `lib/sessionScore.ts`: oyun HUD skorunu verir (`trackScore(n)`). Skor düşerse (F-16 çarpışma, R) yeni tur sayılır; kazanılan puan = pozitif artışların toplamı.
- `PlayShell` gönderilmemiş puanı şu anlarda gönderir: duraklatma, sekme gizlenince, sayfadan çıkarken (`pagehide`, `sendBeacon`), oyundan çıkınca (unmount). Sunucu artırımlı toplar, sonuç "çıkışta toplam" ile aynıdır ama telefon sekmeyi öldürse de puan kaybolmaz.
- `POST /api/scores {game, points, seconds}`: sunucu `points ≤ oyunHızı × seconds + tampon` ve `seconds ≤ son gönderimden beri geçen süre + tolerans` kontrol eder, fazlasını kırpar (basit hile freni; oyunlar istemcide, tam koruma yok).

## Veri (Upstash Redis, Vercel Marketplace, fra1)
| anahtar | tip | içerik |
|---|---|---|
| `user:{id}` | hash | name, createdAt, via (`password`/`google`/`mail`), pw (scrypt) ya da fb (Firebase uid) |
| `name:{küçükharf}` | string | id (SET NX ile ayırma) |
| `tok:{sha256}` | string | id |
| `fb:{uid}` | string | id |
| `lb:{slug}` | zset | id → oyun toplamı |
| `lb:all` | zset | id → genel toplam |
| `last:{id}:{slug}` | string | son gönderim zamanı (ms) |
| `fail:{ad}` | string | son 15 dk'daki yanlış şifre sayısı |
| `handoff:{nonce}` | string | mail linki devri için token (15 dk) |

`GET /api/leaderboard?game=all|<slug>&limit=N` → ilk N (ad + puan) + token varsa `me {rank, score}`. CDN'de 10 sn önbellek (me olmadan).

## Arayüz
- `LoginDialog` (site/): ad + şifre formu; "ya da" altında "Google ile devam et", "Mail ile giriş yap" (mail → "Linki gönderdik"). Mail linki `/?giris=mail`e döner, pencere linki tamamlar.
- Firebase SDK sadece Google/Mail tıklanınca dinamik yüklenir (ana paket büyümez).
- `SiteNav`: "Liderlik" linki; girişliyken ad → hesap menüsü (sıralamam / çıkış).
- `Leaderboard` bileşeni: sekmeler, sıra, ad, puan, "sen" satırı, yükleniyor iskeleti; ana sayfa altı + `/liderlik` + Başlat ekranı (kompakt).

## Test
Test altyapısı yok: lint + build + localhost:3001'de tarayıcıda uçtan uca (hesap aç → oyna → çık → tabloda gör; çıkış yapıp aynı adla şifreyle geri gir; yanlış şifre, kilit; Firebase girişi Firebase config gelince).

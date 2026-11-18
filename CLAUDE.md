# FootballCenter — loyiha qoidalari

Telegram bot + Mini App. **Asosiy texnik topshiriq: [docs/SPEC.md](docs/SPEC.md)** — har qanday o'zgarishdan oldin tegishli bo'limini o'qing. SPEC'dan chetga chiqmang, o'zingizdan funksiya qo'shmang yoki qisqartirmang. SPEC'da aniq bo'lmagan yoki ziddiyatli joy bo'lsa — taxmin qilmang, PR izohida savol sifatida yozing.

## Texnologiyalar va hosting

- Node.js 20+, Express 5, grammY, PostgreSQL (`pg`), frontend — build'siz HTML/CSS/JS.
- Hosting: **Railway** (servis + Railway PostgreSQL). Yig'ish — `Dockerfile` (`railway.json`).
- Bot Railway'da **webhook** rejimida: `WEBHOOK_URL` + `/telegram/webhook`. `WEBHOOK_URL` bo'sh bo'lsa (lokal) — long polling.
- Mini App — `/app`, web admin paneli — `/admin`, API — `/api`, sog'liq tekshiruvi — `/healthz`.

## Qat'iy qoidalar

1. **Repo PUBLIC.** Token, parol, kalit, `DATABASE_URL` hech qachon kodga, testga yoki hujjatga yozilmaydi — faqat environment variable (`src/config.js`). Yangi o'zgaruvchi qo'shilsa — `.env.example` ga qiymatsiz qo'shing. `.env` git'ga tushmaydi.
2. **Har bir bot xabari mos emoji bilan boshlanadi** (SPEC 20.1). Test: `test/unit.test.js`.
3. **Barcha bot matnlari 4 tilda**: `src/i18n/locales/{uz,uz_cyrl,ru,en}.json`. Yangi kalitni `uz.json`, `ru.json`, `en.json` ga qo'shing, so'ng `npm run i18n:cyrl` — `uz_cyrl.json` ga transliteratsiya qo'shiladi (mavjud tarjimalarga tegmaydi). Koddagi matnlar faqat `t(lang, 'kalit')` orqali.
4. **Admin sozlaydigan qiymatlar kodga qattiq yozilmaydi** (SPEC 20.3) — `settings` jadvali; boshlang'ich qiymatlar `src/services/settings.js` → `DEFAULTS` va ishga tushishda seed qilinadi.
5. **Pul amallari** faqat admin tasdiqlagandan keyin balansga ta'sir qiladi (SPEC 20.4).
6. **Vaqt zonasi — Asia/Tashkent** (SPEC 20.5): `src/services/time.js` yordamchilari; hafta — seshanba 12:00 dan keyingi seshanba 11:59 gacha.
7. **Baza o'zgarishi faqat yangi migratsiya orqali**: `src/db/migrations/NNN_nom.sql` (keyingi raqam). Bajarilgan migratsiyani tahrirlamang. Server ishga tushganda avtomatik bajariladi.
8. Har bir o'zgarish testlar bilan: `npm test` (lokal PostgreSQL kerak, `TEST_DATABASE_URL`; test bazasi har safar tozalanadi).

## Tuzilma

```
docs/SPEC.md            texnik topshiriq
src/index.js            ishga tushirish: migratsiya → web server → bot (webhook/polling) → fon vazifalari
src/config.js           environment variable'lar
src/db/                 pool, migrate.js, migrations/
src/i18n/               t(), JSON tillar, translit.js (lotin → kirill)
src/services/           biznes mantiq (users, settings, promo, referral, bonus, premium, donations, ai, football, manager, quiz, leaderboard, notify, time)
src/bot/                grammY: index.js, ui.js, state.js, handlers/
src/web/                Express: server.js, api.js (Mini App), admin.js (web admin), auth.js (initData)
src/jobs/scheduler.js   fon vazifalari
public/app/             Mini App
public/admin/           web admin paneli
test/                   avtomatik testlar
```

## Yuklama va API'dan himoya (o'zgartirishda saqlang)

- **Futbol API — API-Football v3** (`src/services/football.js`, header `x-apisports-key`): xotira + PostgreSQL (`api_cache`) keshi, ma'lumot turiga qarab TTL (tugagan o'yin — qayta so'ralmaydi, jonli — 30–60 s), eskirgan keshni darhol berib orqada bitta so'rov bilan yangilash, bir xil so'rovlarni birlashtirish, daqiqalik limit navbati (foydalanuvchi so'rovi 15 s dan ortiq kutmaydi), kunlik limit nazorati (oxirgi 10 so'rov fon vazifalariga zaxira), tarif rad javoblari ham keshlanadi. Bir kunning barcha o'yinlari — bitta so'rov (`/fixtures?date=`). Yangi API chaqiruvi faqat `request()` orqali; tashqariga faqat normalize qilingan ma'lumot chiqadi.
- **Reyting** (`src/services/leaderboard.js`): 30 s umumiy kesh. G'olibni aniqlash (fon vazifasi) — keshsiz `computeRanking`.
- **Spam**: bot — foydalanuvchiga 3 s da 8 ta yangilanish; Mini App API — daqiqasiga 120 so'rov (`src/services/ratelimit.js`).
- **Telegram**: `@grammyjs/auto-retry` (429 da kutib qayta yuboradi), webhook `max_connections: 40`.
- Foydalanuvchi qatori o'zgarmasa bazaga qayta yozilmaydi (`users.upsertFromTelegram`).

## O'yinlar tartibi

1. **⭐ Asosiy ligalar** — admin belgilaydi (`settings.featured_leagues`, web admin → "⭐ Asosiy ligalar").
2. **🔥 Ommabop ligalar** — avtomatik (`src/services/popularity.js`): oxirgi N kunda eng ko'p noyob foydalanuvchi qiziqqan ligalar. Bazada faqat `(liga, kun, foydalanuvchilar soni)` saqlanadi, kimligi saqlanmaydi; sozlamalar — `popular_leagues_*`.
3. Qolganlari — davlat, liga, vaqt bo'yicha; o'yin ko'p bo'lsa Mini App'da yig'ilgan holda.

## 🪪 Muxlislik kartasi (SPEC'dan tashqari, egasi talabi bilan)

- **Faqat Premium.** Premiumi yo'qlar profilda xira, qulflangan namunani (`/card/sample-<til>.png`) va "💎 Premium bilan oching" tugmasini ko'radi. Premium tugasa karta yashiriladi, ma'lumot saqlanadi.
- **O'zbekiston ID kartasi uslubida, ikki tomonli** (Mini App'da bosilsa aylanadi). Bayroq o'rnida klub logotipi, karta klub rangida (rasmiy rang ro'yxati `settings.fan_card_team_colors` — mashhur klublar oldindan kiritilgan, web admin → "🎨 Klub ranglari"; ro'yxatda bo'lmasa rang logotipdan aniqlanadi, `team_colors`): sarlavha tasmasi — klubning asosiy rangi, ostida ikkinchi rang chizig'i, fon — asosiy rangning och tusi. Premium belgisi — tagligi bilan oltin to'p (ikkala tomonda).
  - Old: "[Klub] klubi muxlislik kartasi", rasm, familiya, ism, GOAT (otasining ismi o'rnida), yosh (tug'ilgan yildan hisoblanadi), jins, sevimli futbolchi (fuqarolik o'rnida), muxlislik boshlangan yil, klub, karta raqami = klubning nechanchi muxlisi. Imzo yo'q. Klubning birinchi N muxlisi — "★ Birinchi N muxlis ★".
  - Orqa: hudud, muxlis raqami, points (Mini Manager + Quiz), faollashtirilgan sana, berilgan joyi — FootballCenter, klub reytingi (shu klub muxlislari orasida points bo'yicha; 1–3-o'rin medal bilan), xira kichik rasm, bot havolasining Code 128 shtrix-kodi (`src/services/barcode.js`).
  - Yozuvlar foydalanuvchi tilida (`card_*` kalitlari).
- **Faollashtirish**: ogohlantirish → savollar birma-bir (rasm, familiya, ism, tug'ilgan yil, jins, klub, shu klubdan sevimli futbolchi, GOAT, muxlislik yili, hudud) — hammasi majburiy. Rasm brauzerda 3:4, 600×800 JPEG qilib kichraytiriladi.
- Keyin faqat **GOAT va sevimli futbolchi** o'zgaradi. **Klubni almashtirish pullik** (`fan_card_club_change_price`, balansdan yechiladi, `fan_card_club_changes` jurnali); yangi klubda raqam navbat oxiridan (`fan_team_counters`, raqam qayta berilmaydi).
- **Admin** (bot: foydalanuvchi → 🪪; web: "🪪 Muxlislik kartalari"): nomaqbul rasmni o'chiradi (foydalanuvchiga xabar, u yangi rasm yuklaydi), xato ma'lumotni tuzatadi; narx, N va GOAT takliflari — sozlamalar.
- Rasmlar serverda chiziladi (`@resvg/resvg-js`, Dockerfile'da `font-inter`/`font-dejavu`, `public/app/fonts/Oswald-Bold.ttf`): `/card/<tgId>-<imzo>-{front|back|story}.png`, xotira keshi bilan. Ma'lumot — `fan_cards` jadvali (005-migratsiya); 004 dagi eski `users.fav_*`/`fan_*` ustunlari 006-migratsiyada o'chirilgan.

## 🧠 Quiz savollari

- **4 tilli savollar banki**: `src/data/quiz-bank/qNN.json` (1000+ savol) + `dict.json` (davlat nomlari 3 tilda). Format va qoidalar — `src/services/quizBank.js`. Kirill matni o'zbek lotindan transliteratsiya qilinadi, umumiy nomlar (futbolchi, klub) lotinda qoladi. Server ishga tushganda (`migrate`) bazaga bir marta qo'shiladi (`source = 'bank'`, `quiz_questions.i18n`).
- Savol foydalanuvchi tilida ko'rsatiladi (`quiz.publicQuestion`). Navbat: admin qo'shgani → bank (tasodifiy) → bank tugasa eng eskisi nusxa bo'lib qayta chiqadi (`bank_repeat`).
- Inglizcha Open Trivia DB avtomatik ishlatilmaydi (`settings.quiz_api_enabled = false`).
- Yangi savol qo'shilganda: faktlar aniq, 4 variant har xil, to'g'ri javob — birinchi; `test/quizbank.test.js` tekshiradi.

## Egasi talabi bilan SPEC'dan farqlar

- 💎 Tarif bo'limida **"📊 Taqqoslash" yo'q** (SPEC 3-bo'limdagi tugma va admin tahrirlaydigan taqqoslash matni olib tashlangan, 008-migratsiya).
- 🎮 **Mini Manager — faqat Premium** (SPEC'da hamma uchun): API `requirePremium`, Mini App'da yopiq bo'lim, profilda yopiq blok. Oldin berilgan taxminlar va ballar saqlanadi.
- Mini App'dagi "💎 Premium sotib olish" tugmalari botni `?start=premium` bilan ochadi — Premium sahifasi darhol chiqadi.

## Bosqichlar

Holat: ✅ — tugagan va tekshirilgan; 🧪 — kod yozilgan va avtomatik testlardan o'tgan, lekin haqiqiy Telegram/API bilan hali sinalmagan; ⬜ — boshlanmagan.

| # | Bosqich | SPEC | Holat |
|---|---|---|---|
| 1 | Skelet: tuzilma, Railway + webhook, migratsiya + seed, 4 tilli lokalizatsiya, /start, majburiy obuna, til tanlash, asosiy menyu, Mini App `/app` | 0, 1, 18, 20 | ✅ |
| 2 | Balans: to'ldirish, promokod, referral (+ League), bonus | 2 | 🧪 |
| 3 | Profil, tarif, donat, sozlamalar, qoidalar, yordam | 3–9 | 🧪 |
| 4 | Bot admin panel | 16 | 🧪 |
| 5 | Web App + Home (o'yinlar, musobaqalar, banner) | 11, 12, 15 | 🧪 |
| 6 | Mini Manager | 13 | 🧪 |
| 7 | Football Quiz | 14 | 🧪 |
| 8 | Web admin panel | 17 | 🧪 |
| 9 | AI yordamchi | 10 | 🧪 |

2–9-bosqichlar kodi oldingi ishda yozilgan. Har bir bosqich haqiqiy bot tokeni, API-Football va Claude API kalitlari bilan Railway'da tekshirilgach ✅ ga o'tkaziladi.

### Ma'lum cheklovlar (keyingi ishlar)

- API-Football bepul tarifi: kuniga 100 so'rov va joriy mavsum bo'lmasligi mumkin (mustaqil manbalarga ko'ra) — real ishlash uchun pullik tarif kerak bo'lishi mumkin. API javob formatlari soxta ma'lumot bilan sinalgan, haqiqiy API bilan tekshirilishi kerak.
- Quiz: 1000+ savollik 4 tilli bank oxirigacha ishlatilgach, savollar takrorlanadi (eng eskisidan, 30 kundan keyin). Yangi savollarni AI (`ANTHROPIC_API_KEY`) orqali tarjima qilish — keyingi ish. Admin qo'lda qo'shgan savol hozircha bitta tilda.
- Web admin paneli faqat o'zbek (lotin) tilida.

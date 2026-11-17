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

2–9-bosqichlar kodi oldingi ishda yozilgan. Har bir bosqich haqiqiy bot tokeni, football-data.org va Claude API kalitlari bilan Railway'da tekshirilgach ✅ ga o'tkaziladi.

### Ma'lum cheklovlar (keyingi ishlar)

- football-data.org bepul tarifida gol/karta/tarkib tafsilotlari yo'q — Mini Manager'ning bu ballari faqat API bersa hisoblanadi.
- Quiz savollari standart manbasi (Open Trivia DB) ingliz tilida.
- Web admin paneli faqat o'zbek (lotin) tilida.
- Reyting va profil so'rovlari keshlanmagan — ko'p foydalanuvchida sekin (1000+ bir vaqtdagi foydalanuvchi uchun kesh qo'shish kerak).

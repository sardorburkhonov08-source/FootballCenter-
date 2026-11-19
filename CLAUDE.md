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

## 🎯 Hisobni top (SPEC'dan tashqari, egasi talabi bilan)

- `src/services/scorePredict.js`, 012-migratsiya (`score_games`, `score_predictions`, `users.points_score`), Mini App → Games → **Hisobni top**. **Faqat Premium.**
- Admin web admin'da ("🎯 Hisobni top") API'dagi kelgusi o'yinlardan bir nechtasini belgilaydi (kuniga 5—10 tasi qulay); boshlangan o'yinni belgilab bo'lmaydi, hisoblangan o'yin o'chirilmaydi.
- Foydalanuvchi aniq hisobni (0—20) o'yin boshlanguncha kiritadi/o'zgartiradi; boshlangach qulflanadi.
- Ball: aniq hisob — `settings.score_exact_points` (5), faqat natija (g'alaba/durang/mag'lubiyat) — `score_outcome_points` (2); web admin'da o'zgaradi.
- **Ballar umumiy points'ga qo'shiladi**: points = Mini Manager + Quiz + Hisobni top + Duel + Penalty + Crossbar/Keepy-uppy (`users.totalPoints`) — profil, muxlislik kartasi, community haftalik reytingi. O'z haftalik/oylik reytingi bor (`leaderboard` kind `score`); sovrin va g'olib xabari yo'q, o'yin bo'yicha bildirishnoma yuborilmaydi (kuniga ko'p o'yin — spam bo'lmasin).
- API yuklamasi: natijalar kun bo'yicha **bitta** `/fixtures?date=` so'rovida olinadi (kesh); kun ro'yxatida bo'lmagan yoki qoldirilgan o'yin alohida tekshiriladi va boshqa kunga ko'chirilgan bo'lsa qayta ochiladi.

## ⚔️ Duel o'yinlari (SPEC'dan tashqari, egasi talabi bilan)

- `src/services/duels.js`, 015-migratsiya (`duels`, `duel_answers`, `duel_results`, `users.points_duel`), Mini App → Games → **Duel**. **Faqat Premium.**
- Ikki tur: 🧠 **Quiz duel** (quiz bankidan 5 savol, avval e'lon qilinganlari; 15 s) va 🕵️ **Futbolchini top** (`src/data/players.json` — 110+ futbolchi: davlat, pozitsiya, tug'ilgan yil, asosiy klublar; 4 variant, imkon qadar bir pozitsiyadan; 20 s).
- **Navbatma-navbat**: ikkalasi bir xil 5 raundni o'z vaqtida o'ynaydi, duel 24 soat amal qiladi. Vaqt serverda o'lchanadi. Ko'proq to'g'ri — g'olib, teng bo'lsa kamroq vaqt sarflagan.
- **Raqib**: 🎲 tasodifiy (kutayotgan duelga qo'shiladi, bo'lmasa yangisi ochiladi) yoki 🤝 do'st — havola `t.me/<bot>?start=duel_<kod>`: bot taklif xabarini Mini App tugmasi bilan yuboradi (`/app/?duel=<kod>`), yangi foydalanuvchi chaqirgan odamning referrali bo'ladi. Bir vaqtda 5 tagacha tugamagan duel.
- **Points**: g'alaba `duel_win_points` (10), durang `duel_draw_points` (3), kuniga `duel_daily_limit` (10) ta duel hisoblanadi (bot admin → 🎮 O'yinlar sozlamalari). Umumiy points'ga qo'shiladi (`users.totalPoints`), haftalik/oylik reyting (`leaderboard` kind `duel`), community reytingiga ham kiradi. Natija ikkala o'yinchiga botda xabar.
- Fon vazifasi (`duels.tick`, har daqiqa): vaqti o'tgan raund — xato; muddati tugagan kutayotgan duel — bekor; faol duel — o'ynalgani bo'yicha hisoblanadi.

## 🥅 Penalty (sinov, egasi talabi bilan)

- `src/services/penalty.js`, 016-migratsiya (`penalty_games`, `users.points_penalty`), Mini App → Games → **Penalty**. **Faqat Premium.**
- Botga qarshi seriya: navbat bilan siz urasiz (chap/o'rta/o'ng; bot-darvozabon tasodifiy sakraydi) va darvozabon bo'lasiz (bot tasodifiy uradi). 5 tadan zarba, natija aniq bo'lsa erta tugaydi; teng bo'lsa sudden death (5 juftgacha), so'ng durang. Botning tanlovi serverda (`crypto.randomInt`).
- Points: g'alaba `penalty_win_points` (3), durang `penalty_draw_points` (1); kuniga `penalty_daily_games` (3) o'yin (bot admin → 🎮 O'yinlar sozlamalari). Umumiy points'ga qo'shiladi, o'z reytingi bor (`leaderboard` kind `penalty`).
- **Points ustunlari bitta joyda**: `users.POINT_COLUMNS` / `totalPoints` / `totalPointsSql` — yangi o'yin ustuni shu ro'yxatga qo'shiladi (karta, yutuq, admin, eksport shundan oladi); community haftalik reytingi — `community.weekPoints` dagi turlar ro'yxati.

## 💥 Crossbar challenge va ⚽ Keepy-uppy (egasi talabi bilan)

- `src/services/arcade.js`, 017-migratsiya (`arcade_games`, `users.points_arcade`), Mini App → Games. **Faqat Premium.** Taymingli o'yinlar, botning natijasini yengish kerak (kattaroq — g'alaba, teng — durang).
- **Crossbar**: 5 urinish; indikator 0—100 tebranadi (`pos = 50 − 50·cos(2πt/T)`, T har urinishda 1,1—1,8 s), crossbar — 75. Aniq (±2,5) — 3, ±6 — 2, ±12 — 1 ball. Bot: 6—10.
- **Keepy-uppy**: to'p oyoqqa `t` ms da tushadi, ±`w` ms ichida bosish kerak; har safar tezlashadi (t 1300 → 420 ms, w 240 → 70 ms, ±10% tasodif). Natija — ketma-ket to'g'ri bosishlar. Bot: 8—16.
- O'yin brauzerda o'ynaladi: server parametrlarni beradi, o'yinchi oxirida bosish vaqtlarini (`taps`, ms) yuboradi, natija serverda shu formulalar bilan qayta hisoblanadi; har o'yin bir marta yakunlanadi.
- Points: g'alaba `arcade_win_points` (3), durang `arcade_draw_points` (1); har tur uchun kuniga `arcade_daily_games` (3) o'yin (bot admin → 🎮 O'yinlar sozlamalari). Umumiy points'ga qo'shiladi, har birining o'z reytingi (`leaderboard` kind `crossbar` / `keepy`).

## 🏅 Yutuqlar va 📤 natija kartasi (SPEC'dan tashqari, egasi talabi bilan)

- **Yutuqlar** — `src/services/achievements.js` (ro'yxat kodda, `LIST`), 013-migratsiya `user_achievements`. 13 ta: quiz (1 va 50 to'g'ri javob), Hisobni top (1 va 10 aniq hisob), Mini Manager (birinchi hisoblangan taxmin, bir o'yinda 100+), reyting chempioni, muxlislik kartasi, klubning birinchi N muxlisi, haftaning fan klubi a'zosi, 5 faol referral, Premium sovg'a, 1000 points.
- Mavjud ma'lumotdan **bitta so'rov** bilan aniqlanadi (`check`): voqealardan keyin orqa fonda (`checkLater` — quiz javobi, o'yin hisoblanishi, karta, referral, sovg'a, reyting g'olibi) va profil ochilganda. Har bir yangi yutuq bir marta yoziladi va botda `ach_unlocked` xabari keladi. "Haftaning fan klubi a'zosi" — `community.finalizeWeek` da g'olib a'zolariga (`award`).
- Ko'rinishi: Mini App → Profil → 🏅 Yutuqlar (olinganlari sana bilan, qolganlari xira); muxlislik kartasi orqa tomonida "Yutuqlar N / 13". Nomlar — `ach_<id>`, `ach_<id>_desc` (4 tilda).
- **📤 Natija kartasi** — `src/services/shareCard.js`: 1080×1920 PNG (umumiy points, 3 o'yindagi haftalik points va o'rin, yutuqlar, referral havolaning shtrix-kodi). Imzolangan manzil `/share/<tgId>-<imzo>.png`, xotira keshi; `GET /api/share`. Mini App → Profil → "📸 Stories" (`shareToStory`, matnda referral havola) va "⬇️ Saqlash". Matnlar — `share_*`.

## 👥 Fan community (SPEC'dan tashqari, egasi talabi bilan)

- `src/services/community.js`, 010-migratsiya (`communities`, `community_members`, `community_bans`, `community_posts`, `community_weekly_winners`), Mini App → **Community** bo'limi.
- **Ochish**: Premium + muxlislik kartasi; klub — kartadagi klub; foydalanuvchi nom (3—40) va tavsif kiritadi → adminga so'rov (bot: `cm:ok/cm:no` tugmalari, web admin: "👥 Fan community"). Klubning birinchi community'si bepul, keyingilari `settings.community_extra_price` (standart 1 000 000) — **pul admin tasdiqlaganda** egasining balansidan yechiladi; yetmasa so'rov kutishda qoladi.
- **A'zolik**: faqat kartasi shu klubniki bo'lganlar; har kim bitta community'da. Kartada klub almashtirilsa a'zo chiqariladi; egasi klubni almashtira olmaydi.
- **Egasi**: post yozadi/o'chiradi ("e'lon" emas — "post"), a'zoni chiqaradi (qayta qo'shila olmaydi), nom/tavsifni tahrirlaydi; o'zi chiqa olmaydi. **Admin** community'ni yopadi (a'zolar chiqariladi).
- **Post reaksiyalari** 👍 ⚽ 🔥 (`community_post_reactions`, 011-migratsiya): faqat a'zolar (egasi ham), har kim postga bitta reaksiya — boshqasini bossa almashadi, o'shani qayta bossa olib tashlanadi.
- Community sahifasi klub logotipi va ranglarida (`fancard.clubColors`); statistika a'zolarning muxlislik kartalaridan (yosh, jins, hudud, GOAT, sevimli futbolchi, muxlislik yili).
- **📈 Daraja (Lv 1—7: Yangi, Bronza, Kumush, Oltin, Platina, Olmos, Afsona)** — faqat belgi va nom. XP = a'zolarning community'da to'plagan jami points: tugagan haftalar `communities.xp` ga qo'shiladi (`finalizeWeek` → `addWeekXp`, `community_xp_weeks` bilan bir marta), joriy hafta points'i jonli qo'shib ko'rsatiladi. Chegaralar — `settings.community_level_xp` (web admin → "👥 Fan community" → Darajalar). 014-migratsiya.
- **⚔️ Haftalik derbi** — hafta boshida (seshanba 12:00, `ensureDerbies`) o'tgan hafta reytingidagi qo'shnilar juftlanadi (1–2, 3–4, ...; toq qolgani derbisiz). Hafta tugagach (`resolveDerbies`) ko'proq points to'plagan g'olib; teng — durang. G'olib keyingi derbi natijasigacha **👑 toj** bilan ko'rsatiladi; xabar yuborilmaydi (egasi talabi). `community_derbies`, `community_derby_weeks`.
- **Haftalik fan reytingi** — a'zolarning hafta (seshanba 12:00 dan) davomidagi points yig'indisi (Mini Manager + Quiz). Hafta tugagach (`finalizePeriods`) g'olib bir marta yoziladi, `wins + 1`, **hamma foydalanuvchiga** xabar ketadi; g'olib keyingi hafta 🏆 belgisi bilan ko'rsatiladi, jami g'alabalar — 🏆×N.

## Egasi talabi bilan SPEC'dan farqlar

- 💎 Tarif bo'limida **"📊 Taqqoslash" yo'q** (SPEC 3-bo'limdagi tugma va admin tahrirlaydigan taqqoslash matni olib tashlangan, 008-migratsiya).
- 🎮 Mini App pastki menyusida **"Manager" o'rniga "Games"** bo'limi: o'yinlar ro'yxati (`GAMES`, `public/app/app.js`): Mini Manager, Football Quiz (Quiz alohida menyu bo'limi emas), Duel, Penalty, Crossbar challenge, Keepy-uppy va Hisobni top; yangi o'yinlar shu ro'yxatga qo'shiladi. Pastki menyu: Home, Games, Community, Profil.
- 🎮 **Mini Manager — faqat Premium** (SPEC'da hamma uchun): API `requirePremium`, Mini App'da yopiq bo'lim, profilda yopiq blok. Oldin berilgan taxminlar va ballar saqlanadi.
- 🎁 **Yangi foydalanuvchiga bepul Premium** (standart 3 kun, `settings.welcome_premium_days`, 0 — o'chiq; bot admin → 💎 Tarif sozlamalari): bot yoki Mini App orqali birinchi kirganda bir marta beriladi (`users.welcomePremium`, `premium_purchases.source = 'welcome'`), til tanlagach botda xabar. Testlarda standart 0 (`test/helpers.js`).
- 💎 **Ikki tarif: 7 kunlik (standart 10 000 so'm) va 30 kunlik (30 000 so'm)** — `premium_week_price/premium_week_days`, `premium_price/premium_days` (bot admin → 💎 Tarif sozlamalari); `premium.plans()`, tugmalar `tf:buy:week|month`.
- 🎁 **Do'stga Premium sovg'a qilish** (bot → 💎 Premium → 🎁): tarif → do'stning @username yoki ID → tasdiqlash; pul sovg'a qiluvchining balansidan yechiladi, do'st Premium oladi va xabar keladi (`premium.gift`, `premium_purchases.source = 'gift'`, `from_user_id`). Do'stning referrali ham faollashadi.
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

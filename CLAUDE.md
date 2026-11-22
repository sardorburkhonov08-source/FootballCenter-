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
  - Old (qatorlar tartibi): "[Klub] klubi muxlislik kartasi" sarlavhasi; rasm; familiya → ism → GOAT (otasining ismi o'rnida) — har biri to'liq qatorda; yosh (tug'ilgan yildan) · jins · muxlislik boshlangan yil — bitta qatorda; sevimli futbolchi (fuqarolik o'rnida) — to'liq qatorda; klub · karta raqami (= klubning nechanchi muxlisi). Imzo yo'q. Klubning birinchi N muxlisi — rasm ostida "★ Birinchi N muxlis ★".
  - Orqa: chap ustun — hujjat ma'lumotlari (hudud, muxlis raqami, faollashtirilgan sana, berilgan joyi — FootballCenter); o'rta ustun — statistika (umumiy points, yutuqlar N / 13, klub reytingi — shu klub muxlislari orasida points bo'yicha, 1–3-o'rin medal bilan, ostida "N nafar muxlis orasida"); o'ngda — xira kichik rasm va ostida oltin to'p; pastda bot havolasining Code 128 shtrix-kodi (`src/services/barcode.js`). Dizayn o'zgarsa `DESIGN` oshiriladi (eski rasmlar keshdan chiqadi).
  - Yozuvlar foydalanuvchi tilida (`card_*` kalitlari).
- **Faollashtirish**: ogohlantirish → savollar birma-bir (rasm, familiya, ism, tug'ilgan yil, jins, klub, shu klubdan sevimli futbolchi, GOAT, muxlislik yili, hudud) — hammasi majburiy. Rasm brauzerda 3:4, 600×800 JPEG qilib kichraytiriladi.
- Keyin faqat **GOAT va sevimli futbolchi** o'zgaradi. **Klubni almashtirish pullik** (`fan_card_club_change_price`, balansdan yechiladi, `fan_card_club_changes` jurnali); yangi klubda raqam navbat oxiridan (`fan_team_counters`, raqam qayta berilmaydi).
- **Admin** (bot: foydalanuvchi → 🪪; web: "🪪 Muxlislik kartalari"): nomaqbul rasmni o'chiradi (foydalanuvchiga xabar, u yangi rasm yuklaydi), xato ma'lumotni tuzatadi; narx, N va GOAT takliflari — sozlamalar.
- Rasmlar serverda chiziladi (`@resvg/resvg-js`, Dockerfile'da `font-inter`/`font-dejavu`, `public/app/fonts/Oswald-Bold.ttf`): `/card/<tgId>-<imzo>-{front|back|story}.png`, xotira keshi bilan. Ma'lumot — `fan_cards` jadvali (005-migratsiya); 004 dagi eski `users.fav_*`/`fan_*` ustunlari 006-migratsiyada o'chirilgan.

## 🧠 Quiz savollari

- **4 tilli savollar banki**: `src/data/quiz-bank/qNN.json` (~2000 savol: q01—q11 qo'lda yozilgan, q12—q21 — `scripts/gen-quiz-extra.js` aniq ma'lumot jadvallaridan yaratadi: liga chempionlari mavsumlar bo'yicha, Chempionlar ligasi / UEFA Kubogi / Yevropa ligasi g'oliblari, Oltin to'p, futbolchilarning davlati / tug'ilgan yili / pozitsiyasi / klubi, klubning davlati va shahri, stadionlar, murabbiylar millati; o'zbekcha matnda `⟦Nom⟧` — kirillchada lotincha qoladigan nom) + `dict.json` (davlat nomlari 3 tilda). Format va qoidalar — `src/services/quizBank.js`. Kirill matni o'zbek lotindan transliteratsiya qilinadi, umumiy nomlar (futbolchi, klub) lotinda qoladi. Server ishga tushganda (`migrate`) bazaga bir marta qo'shiladi (`source = 'bank'`, `quiz_questions.i18n`).
- Savol foydalanuvchi tilida ko'rsatiladi (`quiz.publicQuestion`). Navbat: admin qo'shgani → bank (tasodifiy) → bank tugasa eng eskisi nusxa bo'lib qayta chiqadi (`bank_repeat`).
- Inglizcha Open Trivia DB avtomatik ishlatilmaydi (`settings.quiz_api_enabled = false`).
- 🧠 **Har soatlik "Yangi Quiz savoli" xabari yo'q** (egasi talabi) — o'rniga kuniga 1 marta ☀️ kunlik dayjest (pastda).
- Yangi savol qo'shilganda: faktlar aniq, 4 variant har xil, to'g'ri javob — birinchi; `test/quizbank.test.js` tekshiradi.

## 🎯 Hisobni top (SPEC'dan tashqari, egasi talabi bilan)

- `src/services/scorePredict.js`, 012-migratsiya (`score_games`, `score_predictions`, `users.points_score`), Mini App → Games → **Hisobni top**. **Faqat Premium.**
- Admin web admin'da ("🎯 Hisobni top") API'dagi kelgusi o'yinlardan bir nechtasini belgilaydi (kuniga 5—10 tasi qulay); boshlangan o'yinni belgilab bo'lmaydi, hisoblangan o'yin o'chirilmaydi.
- Foydalanuvchi aniq hisobni (0—20) o'yin boshlanguncha kiritadi/o'zgartiradi; boshlangach qulflanadi.
- Ball: aniq hisob — `settings.score_exact_points` (5), faqat natija (g'alaba/durang/mag'lubiyat) — `score_outcome_points` (2); web admin'da o'zgaradi.
- **Ballar umumiy points'ga qo'shiladi**: points = Mini Manager + Quiz + Hisobni top + Duel + Penalty + Crossbar/Keepy-uppy + Vazifalar + "Kim yutadi?" (`users.totalPoints`) — profil, muxlislik kartasi, community haftalik reytingi. O'z haftalik/oylik reytingi bor (`leaderboard` kind `score`); sovrin va g'olib xabari yo'q, o'yin bo'yicha bildirishnoma yuborilmaydi (kuniga ko'p o'yin — spam bo'lmasin).
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

- `src/services/arcade.js`, 017-migratsiya (`arcade_games`, `users.points_arcade`), Mini App → Games. **Faqat Premium.** Taymingli o'yinlar: 🤖 botning natijasini yengish (kattaroq — g'alaba, teng — durang) yoki raqib bilan bellashuv.
- **Crossbar**: 5 urinish; indikator 0—100 tebranadi (`pos = 50 − 50·cos(2πt/T)`, T har urinishda 1,1—1,8 s), crossbar — 75. Aniq (±2,5) — 3, ±6 — 2, ±12 — 1 ball. Bot: 6—10.
- **Keepy-uppy**: to'p maydon bo'ylab uchadi va har safar boshqa joyga (`x`, 12—88%, oldingisidan kamida 15% uzoqda) tushadi; yerga tegish paytida (`t` ms, ±`w` ms) to'pning ustiga (±16%) bosish kerak (`taps: [{ ms, x }]`). Har safar tezlashadi (t 1300 → 420 ms, w 240 → 70 ms, ±10% tasodif). Natija — ketma-ket to'g'ri bosishlar. Bot: 8—16.
- **Raqib bilan** (018-migratsiya `arcade_matches`, `arcade_games.match_id`): 🎲 tasodifiy yoki 🤝 do'st (havola `t.me/<bot>?start=ag_<kod>` → bot taklif xabari, Mini App `/app/?ag=<kod>`; yangi foydalanuvchi referral bo'ladi). Ikkalasi bir xil parametrlarda (match.params) bir martadan o'ynaydi, 24 soat; ko'proq ball — g'olib. Points: `arcade_pvp_win_points` (5), `arcade_pvp_draw_points` (2), kuniga `arcade_pvp_daily_limit` (10) ta match points beradi; botga qarshi limitga kirmaydi. Natija ikkalasiga botda. Fon vazifasi `arcade.tick`: muddati tugagan kutayotgan — bekor, faol — o'ynagani yutadi (o'ynamagan — 0).
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
- **Haftalik fan reytingi** — a'zolarning hafta (seshanba 12:00 dan) davomidagi points yig'indisi (hamma o'yinlar; bu community'ning o'z reytingi, foydalanuvchilar umumiy reytingi va g'oliblaridan alohida). Hafta tugagach (`finalizePeriods`) g'olib bir marta yoziladi, `wins + 1`, **hamma foydalanuvchiga** xabar ketadi; g'olib keyingi hafta 🏆 belgisi bilan ko'rsatiladi, jami g'alabalar — 🏆×N.

## ✨ UI/UX (egasi talabi bilan)

- **☀️ Kunlik dayjest** — kuniga 1 ta xabar (`scheduler.dailyDigest`, `daily_notify_log`, 019-migratsiya): `settings.digest_hour` (standart 12, Toshkent) dan keyingi birinchi Quiz savolida. Bugungi vazifalar, ketma-ket kunlar, navbati kelgan duel/bellashuvlar, taxmin kutayotgan Hisobni top o'yinlari, Quiz, tayyor bonus + "🎮 O'ynash" tugmasi. Faqat Premium, bildirishnoma turi `quiz_new` ("☀️ Kunlik xabar").
- **⚽ Bonus animatsiyasi** — 🎁 Bonus bosilganda Telegram ⚽ (sendDice) uriladi; gol (3—5) bo'lsa bonus × `settings.bonus_goal_multiplier` (standart 2; 1 — o'chiq). `DICE_WAIT_MS` (testlarda 0).
- **🎉 Bayram animatsiyasi** — g'alaba (duel, bellashuv) va yutuq/yangi darajada bitta emojili xabar (`notify.celebrate`).
- **Chat tozalanmaydi** (egasi talabi) — foydalanuvchi va botning xabarlari o'chirilmaydi; `ui.show` callback'da xabarni tahrirlaydi, aks holda yangi xabar yuboradi.
- **✅ Kunlik vazifalar** (`src/services/quests.js`, 020-migratsiya `user_quest_days`, `users.points_quest`; Premium) — har kuni 3 ta (har guruhdan bittadan, foydalanuvchi va kun bo'yicha barqaror tanlov; Hisobni top — ochiq o'yin bo'lsa, reaksiya — community'da bo'lsa). Bajarilganligi mavjud jadvallardan hisoblanadi. Mukofot: `quest_reward_points` (5) + ketma-ket kunlar × `quest_streak_bonus` (1), ko'pi bilan `quest_streak_max` (7) kun. Points umumiy points'ga (`leaderboard` kind `quest`).
- **📈 Shaxsiy daraja** (`src/services/levels.js`, `users.level`) — umumiy points bo'yicha Lv 1—13 (`settings.user_level_xp`), unvonlar `ulv_1..7` (har 2 darajaga bittasi). Yangi darajada botda 🎉 tabrik (`achievements.check` orqali; birinchi marta — xabarsiz).
- **Mini App**: Home va Games tepasida "Bugun" kartasi (`GET /api/today`: salom, daraja va progress, vazifalar; Home'da ixcham), profilda daraja belgisi, 🎉 konfetti (g'alaba, mukofot, yangi daraja), raqamlar sanab chiqadi, SVG pastki menyu ikonkalari, o'yin kartochkalarida rangli gradient ikonkalar.
- **🖼 Rasmli bosh menyu** (`src/services/menuCard.js`, `ui.showMenu` → `ui.showPhoto`): 1200×630 shaxsiy karta (salom, daraja va progress, points, haftalik o'rin, ketma-ket kunlar, vazifalar, tarif), caption — `menu_title`, tugmalar o'sha. `settings.menu_image_enabled` (bot admin → 🎮 O'yinlar sozlamalari; testlarda o'chiq). Matnlar `mc_*`.
- **🏆 Podium** — reytinglarda TOP-3 shohsupada, Telegram profil rasmlari bilan (`users.photo_url` — Mini App initData'dan, faqat `https://t.me/`, 022-migratsiya; `leaderboard.board` → `photo`).
- **🏆 Botdagi reyting** (`src/services/topCard.js`, **Profil → "🏆 Reyting"** — bosh menyuda emas, egasi talabi; `m:top[:daily|weekly|monthly]`, orqaga — Profilga): umumiy reyting TOP-3 shohsupa rasmida (1200×630, Telegram profil rasmlari — Bot API `getUserProfilePhotos`, 12 soat xotira keshi; rasm yo'q bo'lsa bosh harf), caption'da 4—10-o'rinlar va o'z o'rningiz; davr almashsa rasmli xabar tahrirlanadi (`editMessageMedia`). Matnlar `top_*`, rasm yozuvlari `tc_*`.
- **✨ Xabar effektlari** (`notify.EFFECTS`, `notify.effect`, `ui.replyFx`): Premium faollashganda / sovg'a Premium (🎉), do'st sovg'asi (❤️), bonus goli va g'alaba (🔥), yutuq va yangi daraja (🎉), haftalik g'olib (🎉). Effekt rad etilsa xabar effektsiz qayta yuboriladi.
- **⭐ Sevimli jamoa** (025-migratsiya `users.favorite_team`, `fav_match_state`; `POST /api/favorite-team`, `/api/me` → `favoriteTeam`): Home'da sana ostida jamoa bloki (bugungi o'yini, bo'lmasa keyingi/oxirgi — `/teams/:id/matches`), tanlanmagan bo'lsa yopiladigan taklif; Profil → "⭐ Sevimli jamoa" (muxlislik kartasidagi klub bir bosishda). Gol va yakun xabari botda (`src/services/favTeam.js`, `fav_team` vazifasi, bildirishnoma turi `fav_team` — hamma uchun, o'chirish mumkin; effekt bilan). API: kunlik `/fixtures?date=` faqat sevimli jamoa o'yini oynasida (boshlanishidan 5 daqiqa oldin — 3 soat keyin) `fav_team_check_seconds` (120) da yangilanadi; birinchi ko'rishda eski gollar uchun xabar yo'q. Sozlamalar: `fav_team_notify`, `fav_team_check_seconds`.
- **O'yin kartochkasi** — o'ng tomon ixcham: boshlanmagan — vaqt va 🔔, jonli — daqiqali "Live" belgisi, tugagan — "TUGAGAN" yozuvi. **Profil tartibi**: profil boshi → sevimli jamoa → balans/tarif → muxlislik kartasi → o'yinlar statistikasi (bitta jadval: har o'yin — hafta / oy / jami, o'rin bilan; Premiumsizga 🔒 qator) → yutuqlar (olinganlari + navbatdagi 3 tasi, qolgani "Yana N ta" ortida, progress chizig'i) → natija kartasi → ovozlar. **Logotip yo'q yoki yuklanmasa** — nomning bosh harfi rangli doirada (`crestPh`).
- **👤 Profil boshi** — profil rasmi atrofida daraja halqasi (SVG), points, haftalik o'rin (umumiy), ketma-ket kunlar; 🔊 o'yin ovozlari tugmasi.
- **⚽ O'yin kartochkalari** — kattaroq logotiplar, jonli o'yinda daqiqa chizig'i, gol bo'lsa hisob yonadi (`S.scores`). **O'yin sahifasi** sarlavhasi ikkala klubning rasmiy ranglarida (`/api/matches/:id` → `colors`, `fancard.clubColors`).
- **✨ Silliq o'tishlar** — sahifa oldinga/orqaga surilib ochiladi, yuklanishda shimmer. **📭 Bo'sh holatlar** — futbol personaji (SVG).
- **🎨 Sevimli klub rangi** — muxlislik kartasi bo'lsa Mini App aksenti (`--accent`, `--grad`) klub rangida (`/api/today` → `club`, qorong'i/yorug' mavzuga mos kontrast). Bu foydalanuvchining o'z klubi rangi bo'lgani uchun ko'k ham bo'lishi mumkin (egasi tasdiqlagan).
- **🔊 O'yin ovozlari** — WebAudio bilan sintez (fayl yo'q): zarba, gol, qaytarish, hushtak, g'alaba; Profil → 🔊 dan o'chiriladi (`localStorage fc_sound`).
- **SPEC 19 dan farq**: gradientlar ishlatiladi va Telegram **yorug' mavzusiga** moslashadi (`tg.colorScheme`, `:root[data-theme="light"]`); ko'k rang ishlatilmaydi.

## 🏆 Umumiy reyting va g'oliblar (egasi talabi bilan)

- Har o'yinning points'i o'zida alohida hisoblanadi va o'z reytingi bor (o'yin ichida). Bundan tashqari **umumiy points** — hamma o'yinlar yig'indisi (`leaderboard` kind `overall` = `GAME_KINDS`: manager, quiz, score, duel, penalty, crossbar, keepy, quest, poll). Faqat foydalanuvchining o'zi to'plagani — **fan community bunga kirmaydi**.
- Mini App → Games, o'yinlar ro'yxatidan **pastda** "🏆 Umumiy reyting": **Bugun / Haftalik / Oylik** (`period` `daily|weekly|monthly`), 5 qator + "Hammasi"; Premiumsizga ham ko'rinadi.
- **Kunlik g'olib yo'q.** Haftalik va oylik g'oliblar **faqat umumiy reyting** bo'yicha aniqlanadi (`finalizePeriods`, `period_winners.kind = 'overall'`); har o'yin bo'yicha alohida g'olib aniqlanmaydi (SPEC 13.5 / 14 dagi bo'lim g'oliblari o'rniga). Sovrinlar — `prizes.kind = 'overall'` (021-migratsiya; web admin → "🏆 Sovrinlar"), Games'da umumiy reyting ustida ko'rsatiladi; Mini Manager va Quiz ichidagi sovrin bloklari olib tashlangan.

## 👥 Guruhlar, 🔎 inline rejim, 🗳 "Kim yutadi?" (egasi talabi bilan)

- **Guruhlarda bot** (`src/services/groups.js`, `src/bot/handlers/groups.js`, 024-migratsiya `group_chats`, `group_quiz`, `group_quiz_answers`, `group_weekly_winners`). Guruh yangilanishlari shaxsiy handlerlarga tushmaydi — faqat `groups.handle`. Bot qo'shilganda salom; har kuni `group_quiz_hour` (19, Toshkent) dan keyin bank savoli (4 tugma, tartib aralash; `groups_quiz` vazifasi), birinchi javob hisoblanadi, 24 soat amal qiladi. `/quiz`, `/top` (hafta reytingi: to'g'ri javoblar, teng — tezroq), `/lang` (faqat guruh adminlari). Hafta tugagach (`groups_week`) har guruhda 👑 chempion e'loni, bir marta. Guruh ballari **umumiy points'ga qo'shilmaydi**. Faqat guruhda javob bergan odam — `users.group_only` (sovg'a Premium va referral botga birinchi kirganda beriladi, xabar tarqatishga kirmaydi). Sozlamalar: `group_quiz_enabled`, `group_quiz_hour` (bot admin → 🎮 O'yinlar sozlamalari).
- **🔎 Inline rejim** (`src/bot/handlers/inline.js`; BotFather → /setinline yoqilishi kerak): ⚔️ Quiz duelga chaqiruv (faqat Premium; havola `?start=dch_<userId>` — chaqiruvchining ochiq taklifi yoki yangi invite duel, yangi foydalanuvchi referral bo'ladi), 🎮 botga taklif (`ref_invite` matni), bugungi o'yinlar hisobi (bitta `/fixtures?date=` kesh so'rovi, 4 s kutadi; jonli → asosiy ligalar; qidiruv — jamoa/liga nomi).
- **🗳 "Kim yutadi?" — SINOV** (`src/services/poll.js`, `poll_votes`, `users.points_poll`; `poll_enabled`, `poll_points` (2)): kunning o'yini — "🎯 Hisobni top" ga belgilangan bugungi eng kechki o'yin; kunlik dayjestdan keyin alohida xabar (3 tugma), ovoz bir marta, keyin foizlar; o'yin tugagach (`poll_score`) to'g'ri taxminga points (umumiy points, `leaderboard` kind `poll`). Olib tashlash kerak bo'lsa: poll.js, `pl:` handler (sections.js), scheduler (`poll_score`, dayjest), `POINT_COLUMNS`/`GAME_KINDS`/community ro'yxatidagi `poll`.
- Webhook `allowed_updates`: `message`, `callback_query`, `inline_query`, `pre_checkout_query`, `my_chat_member` (`src/index.js`).

## 📣 Kanal, 🎯 xabar tarqatish, 👋 tanishtiruv, 👥 do'stlar ligasi, ⚽ jonli sahifa, 🏁 natija ekrani, 📳 tebranish (SINOV, egasi talabi bilan)

- **📣 Kanalga avtomatik post** (`src/services/channel.js`; bot admin → "📣 Kanalga avtopost"): `channel_post_id` (@kanal yoki -100..., bo'sh — o'chiq; bot kanalda admin bo'lishi kerak), `channel_lang`. Har kuni `channel_daily_hour` (9, Toshkent) dan keyin **kechagi natijalar** rasmi (1080×1350: asosiy ligalar birinchi, ko'pi bilan 12 o'yin; kechagi `/fixtures?date=` — bitta keshli so'rov), kuniga bir marta (`daily_notify_log` `channel_results`; xato bo'lsa belgi olib tashlanadi va 🚨 adminga). Hafta/oy g'olibi aniqlanganda (`finalizePeriods`) **g'olib kartasi**: profil rasmi (`topCard.avatar`), points, faol umumiy sovrin matni. `channel_daily_enabled`, `channel_winner_enabled`. Matnlar `ch_*`.
- **🎯 Maqsadli xabar tarqatish** (`src/services/broadcast.js`, bot admin → 📢 Xabar yuborish): xabar yuborilgach auditoriya tanlanadi — hammaga, 💎 Premium, 🆓 oddiy, 😴 7+ kun kirmaganlar, ⚽ klub muxlislari (muxlislik kartasidagi klub), 📍 hudud (kartadagi hudud); soni ko'rsatiladi. «Bot yangiliklari»ni o'chirganlar va `group_only` ga yuborilmaydi.
- **⏰ Rejalashtirilgan xabar** (027-migratsiya `scheduled_broadcasts`): "⏰ Vaqtini belgilash" → `DD.MM.YYYY HH:MM` (Toshkent, kelajakda); `scheduled_broadcasts` vazifasi (har daqiqa) vaqti kelganini bir marta yuboradi (`FOR UPDATE SKIP LOCKED`), adminga hisobot; "⏰ Rejalashtirilgan (N)" ro'yxati va bekor qilish.
- **👋 Tanishtiruv** (`settings.onboarding_enabled`, bot admin → 🎮 O'yinlar sozlamalari; testlarda standart o'chiq): yangi foydalanuvchi birinchi marta til tanlagach 3 qadam (`ob_1..3`: nima bor → o'yinlar va points → karta/community/referral), "Keyingi ▶️ / ⏭ O'tkazib yuborish", oxirida "🎮 O'yinlarni ochish" va "🚀 Boshlash" → bosh menyu.

- **👥 Do'stlar ligasi** (`src/services/leagues.js`, 028-migratsiya `friend_leagues`, `friend_league_members`; Mini App → Games → "👥 Do'stlar ligasi" — hamma uchun): liga ochish (nom 3—30), havola `t.me/<bot>?start=lg_<kod>` → bot taklif xabari (`lg_invite_msg`, Mini App `/app/?lg=<kod>`; yangi foydalanuvchi egasining referrali). Reyting — a'zolarning **umumiy points**i (hafta / oy / jami; alohida points yo'q), 0 points'lilar ham ko'rinadi. Egasi a'zoni chiqaradi; egasi chiqsa liga eng eski a'zoga o'tadi, a'zo qolmasa o'chadi. Sozlamalar: `leagues_enabled`, `leagues_max_members` (50), `leagues_max_per_user` (10). API: `/api/leagues*`.
- **⚽ Jonli o'yin sahifasi** (Mini App, `renderMatchDetail`): o'yin jonli bo'lsa (yoki 15 daqiqada boshlansa) har 30 soniyada `/api/matches/:id` (server keshi 30 s) — sahifa qayta ochilmaydi, tanlangan tab saqlanadi; gol bo'lsa sarlavha yonadi, toast "⚽ GOL!", konfetti, ovoz va tebranish; boshlanish/tugashda hushtak. Sahifa yopilsa yoki yashirin bo'lsa so'rov yuborilmaydi.
- **🏁 Natija ekrani** (`resultSheet`): penalti, Crossbar/Keepy-uppy (botga qarshi) va duel tugaganda pastdan chiqadi — natija, katta "+N points" (sanab chiqadi), haftalik umumiy o'rin o'zgarishi (`GET /api/me/place?fresh=1` — reyting keshi 3 s dan eski bo'lsa yangilanadi; o'yin ochilganda `capturePlace`), "🔁 Yana o'ynash", "🤝 Do'stni chaqirish" (referral havola), "Yopish".
- **📳 Tebranish** (`haptic`): har tugma bosilganda yengil zarba, o'yin ovozlari bilan birga (zarba, gol, qaytarish, g'alaba, mag'lubiyat, hushtak), to'g'ri/noto'g'ri javob. Ketma-ket 60 ms ichida takrorlanmaydi. Profil → "📳 Tebranish" dan o'chiriladi (`localStorage fc_haptic`).

## Egasi talabi bilan SPEC'dan farqlar

- 💎 Tarif bo'limida **"📊 Taqqoslash" yo'q** (SPEC 3-bo'limdagi tugma va admin tahrirlaydigan taqqoslash matni olib tashlangan, 008-migratsiya).
- 🎮 Mini App pastki menyusida **"Manager" o'rniga "Games"** bo'limi: o'yinlar ro'yxati (`GAMES`, `public/app/app.js`): Mini Manager, Football Quiz (Quiz alohida menyu bo'limi emas), Duel, Penalty, Crossbar challenge, Keepy-uppy, Hisobni top va 👥 Do'stlar ligasi; yangi o'yinlar shu ro'yxatga qo'shiladi. Pastki menyu: Home, Games, Community, Profil.
- 🎮 **Mini Manager — faqat Premium** (SPEC'da hamma uchun): API `requirePremium`, Mini App'da yopiq bo'lim, profilda yopiq blok. Oldin berilgan taxminlar va ballar saqlanadi.
- 🎁 **Yangi foydalanuvchiga bepul Premium** (standart 3 kun, `settings.welcome_premium_days`, 0 — o'chiq; bot admin → 💎 Tarif sozlamalari): bot yoki Mini App orqali birinchi kirganda bir marta beriladi (`users.welcomePremium`, `premium_purchases.source = 'welcome'`), til tanlagach botda xabar. Testlarda standart 0 (`test/helpers.js`).
- 💎 **Ikki tarif: 7 kunlik (standart 10 000 so'm) va 30 kunlik (30 000 so'm)** — `premium_week_price/premium_week_days`, `premium_price/premium_days` (bot admin → 💎 Tarif sozlamalari); `premium.plans()`, tugmalar `tf:buy:week|month`.
- 🎁 **Do'stga Premium sovg'a qilish** (bot → 💎 Premium → 🎁): tarif → do'stning @username yoki ID → tasdiqlash; pul sovg'a qiluvchining balansidan yechiladi, do'st Premium oladi va xabar keladi (`premium.gift`, `premium_purchases.source = 'gift'`, `from_user_id`). Do'stning referrali ham faollashadi.
- 📤 **Referral havolasini bir bosishda yuborish** (bot → Balans → Referral → 🔗 Havola → "📤 Do'stlarga yuborish"): Telegram ulashish oynasi (`t.me/share/url`) havola va chorlovchi taklif matni bilan ochiladi. Matn — admin tahrirlaydi (bot admin → 👥 Referral sozlamalari → ✏️ Taklif matni, `texts.ref_invite`, 4 tilda), bo'lmasa `ref_invite_default`.
- ⭐ **Telegram Stars bilan Premium** (SPEC 20.4 dan farq — Telegram to'lovni o'zi tasdiqlaydi, Premium `successful_payment` kelganda darhol beriladi): narx — `premium_week_stars` / `premium_month_stars` (yulduz, 0 — tugma yo'q; bot admin → 💎 Tarif sozlamalari), muddat — oddiy tariflarniki. Hisob-faktura `XTR`, payload `prem:<plan>:<userId>:<narx>`; `pre_checkout_query` da foydalanuvchi va joriy narx tekshiriladi; to'lov `star_payments` ga yoziladi (023-migratsiya, `charge_id` UNIQUE — qayta kelsa Premium ikki marta berilmaydi), `premium_purchases.source = 'stars'`.
- 🚨 **Adminlarga xato xabarlari** (`src/services/alerts.js`): bot handler xatosi (eng birinchi middleware'da ushlanadi — webhook rejimida ham), fon vazifasi xatosi, Express 500, API-Football kunlik limiti tugashi yoki kaliti rad etilishi, sekin baza (`db_health` vazifasi, `SELECT 1` > `alerts_db_slow_ms`). Bir xil xabar `alerts_repeat_minutes` (30) da bir marta; `alerts_enabled` (bot admin → 🛠 Texnik ishlar va 🚨 xabarlar). Baza ishlamasa ham `ADMIN_IDS` ga yuboriladi.
- 📈 **Web admin → Grafiklar** (`GET /api/admin/stats/charts?days=7|30|90`): DAU (`daily_active`, bot va Mini App'dan kuniga bir marta — `src/services/activity.js`), yangi foydalanuvchilar, D1/D7 retention, Premium manba bo'yicha, o'yinlar bo'yicha kunlik o'ynashlar, Stars tushumi. SVG grafiklar kutubxonasiz, hover tooltip bilan.
- 💎 **Premium tarifini o'chirish** (`settings.premium_enabled`, bot admin → 💎 Tarif sozlamalari → 🔁 Premium tarifi; egasi talabi): o'chirilsa **hamma funksiyalar hammaga bepul** — `users.isPremium` hammaga `true` (`users.premiumFree()`, sozlama `settings.peek` bilan sinxron o'qiladi), Mini App'da qulflar yo'q, profil/menyuda "🎉 Hammasi bepul". **Sotuv va bepul Premium yo'llari ham to'xtaydi**: balansdan sotib olish, Stars, do'stga sovg'a (`premium_off_info`), Premium promokodlar (`promo_premium_off`), yangi foydalanuvchiga sovg'a Premium, Referral League Premium sovrini; tugash eslatmasi yuborilmaydi; dayjest va bonus eslatmasi hamma uchun. Qayta yoqilsa — oldingi holat (har kimning o'z `premium_expires_at` i).
- 🖼 **Banner — istalgan format va o'z o'lchamida** (egasi talabi): web admin (`prepareMedia`, `public/admin/admin.js`) faylni brauzerda tekshiradi — JPEG/PNG/WEBP/AVIF/GIF o'zgarishsiz, boshqa rasmlar (HEIC, BMP, TIFF, SVG...) canvas orqali WebP/JPEG ga aylantiriladi; video MP4/WEBM/MOV/M4V/OGV; Lottie JSON. O'lcham (`width`/`height`, 026-migratsiya; Lottie'da JSON `w`/`h`) saqlanadi. Mini App'da banner shu nisbatda ko'rinadi (`object-fit: contain`, qirqilmaydi), slayd almashganda balandlik silliq o'zgaradi; ekranning 70% idan baland bo'lmaydi — bo'sh joyni rasmning xira nusxasi to'ldiradi. SVG/HTML serverga to'g'ridan-to'g'ri qabul qilinmaydi (xavfsizlik). Sovrin rasmlari ham shu yo'l bilan yuklanadi.
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

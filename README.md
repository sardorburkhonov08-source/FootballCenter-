# ⚽ FootballCenter

Telegram bot + Web App (Mini App). Texnik topshiriq bo'yicha to'liq loyiha:

- 🤖 **Bot**: majburiy obuna, 4 tilda til tanlash, 💰 Balans (karta orqali to'ldirish + chek, 🎫 promokod, 👥 referral va Referral League, 🎁 bonus), 👤 Profil, ❤️ Donat (kanalga e'lon bilan), 📜 Qoidalar, 💎 Tarif, ⚙️ Sozlamalar (til, bildirishnomalar), 🆘 Yordam, 🤖 AI Yordamchi.
- 🔒 **Bot admin paneli**: majburiy obuna, kartalar, to'lov/donat tasdiqlash, promokodlar, referral/bonus/donat/tarif sozlamalari, qoidalar va FAQ, murojaatlar, adminlar, foydalanuvchi qidirish/bloklash, texnik ishlar, statistika, CSV eksport, broadcast.
- 📱 **Web App**: 🏠 Home (o'yinlar, musobaqalar), 🎮 Mini Manager, 🧠 Football Quiz (Premium), 👤 Profil; reklama banneri; Oddiy tarif uchun qulflangan qismlar.
- 🌐 **Web admin paneli** (`/admin/`): bannerlar, Mini Manager o'yinlari, sovrinlar, Quiz savollari, taktikalar, statistika.

Barcha vaqt hisoblari **Asia/Tashkent** zonasida. Narxlar, limitlar va matnlar kodda qattiq yozilmagan — admin panel orqali o'zgartiriladi.

## Texnologiyalar

Node.js 20+, Express, [grammY](https://grammy.dev), PostgreSQL, football-data.org v4, Claude API (`@anthropic-ai/sdk`). Frontend — oddiy HTML/CSS/JS, build kerak emas.

## Ishga tushirish

👉 **Birinchi marta o'rnatyapsizmi? [QOLLANMA.md](QOLLANMA.md) — token olishdan botni ishga tushirishgacha qadamma-qadam.**

Loyiha hech qanday platformaga bog'liq emas: istalgan Linux server (VPS) yoki kompyuterda ishlaydi. Telegram Web App faqat **HTTPS** manzil bilan ochiladi, shuning uchun serverga domen yo'naltirilgan bo'lishi kerak.

### ⚡ Eng oson yo'l: `setup.sh`

Toza Ubuntu serverda (22.04 yoki 24.04) shu buyruqlarni bering. Skript Docker'ni o'rnatadi, parollarni o'zi yaratadi, `.env` ni yozadi va botni ishga tushiradi. Sizdan faqat bot tokeni, Telegram ID va domen so'raladi.

```bash
git clone https://github.com/sardorburkhonov08-source/FootballCenter-.git
```

```bash
cd FootballCenter- && sudo bash setup.sh
```

Keyinroq yangi versiyaga o'tish:

```bash
sudo bash setup.sh update
```

Holat va loglarni ko'rish:

```bash
sudo bash setup.sh status
```

**Bepul domen:** [duckdns.org](https://www.duckdns.org) da ro'yxatdan o'ting, subdomen yarating (masalan `footballcenter`) va **current ip** maydoniga serveringiz IP manzilini yozib, **update ip** bosing. Domen `footballcenter.duckdns.org` bo'ladi — HTTPS sertifikati avtomatik olinadi.

### 1-usul: Docker Compose (tavsiya etiladi)

Ilova, PostgreSQL va (ixtiyoriy) avtomatik HTTPS bitta buyruq bilan ko'tariladi. Serverda faqat Docker kerak.

```bash
git clone https://github.com/sardorburkhonov08-source/FootballCenter-.git
cd FootballCenter-
cp .env.example .env
```

`.env` faylida kamida quyidagilarni to'ldiring: `BOT_TOKEN`, `OWNER_IDS`, `POSTGRES_PASSWORD`, `DOMAIN`, `WEBAPP_URL` (`https://` + `DOMAIN`), `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `SESSION_SECRET`.

Domen DNS'i serverga yo'naltirilgan bo'lsa — HTTPS sertifikati (Let's Encrypt) Caddy orqali avtomatik olinadi:

```bash
docker compose --profile https up -d --build
```

O'zingizda nginx yoki boshqa HTTPS proksi bo'lsa, Caddy'siz ishga tushiring va proksini `localhost:3000` ga yo'naltiring:

```bash
docker compose up -d --build
```

Foydali buyruqlar:

```bash
docker compose logs -f app
```

```bash
docker compose down
```

Baza (`pgdata`) va yuklangan fayllar (`uploads`) Docker volume'larida saqlanadi — konteyner qayta yaratilsa ham yo'qolmaydi.

### 2-usul: Docker'siz

Node.js 20+ va PostgreSQL 14+ o'rnatilgan bo'lishi kerak.

```bash
npm ci --omit=dev
cp .env.example .env
npm start
```

`.env` da `DATABASE_URL` ni o'z bazangizga yo'naltiring. Doimiy ishlashi uchun systemd, pm2 yoki shunga o'xshash vosita bilan ishga tushiring va oldiga HTTPS proksi (nginx/Caddy) qo'ying.

Server ishga tushganda baza jadvallari avtomatik yaratiladi (`src/db/schema.sql`).

### Telegram sozlamalari

1. BotFather'da: `/mybots` → bot → **Bot Settings → Menu Button** → `WEBAPP_URL` manzili. Bot o'zi ham ishga tushganda menyu tugmasini shu manzilga sozlaydi.
2. Majburiy obuna va donat kanali uchun botni o'sha kanallarga **admin** qilib qo'shing.
3. Bot standart holatda long polling rejimida ishlaydi (qo'shimcha sozlash shart emas). Webhook kerak bo'lsa: `USE_WEBHOOK=true` — manzil avtomatik `WEBAPP_URL/tg-webhook` bo'ladi.

### Muhim eslatmalar

- **football-data.org bepul tarifi** o'yinlar, jadval, natijalar, taqvim va to'purarlarni beradi, lekin gollar/kartalar/tarkib tafsilotlari faqat pullik tariflarda bor. Ma'lumot kelmasa, o'yin sahifasidagi tegishli tab ko'rinmaydi. Mini Manager'da bu ma'lumotlarga bog'liq ballar (gol urgan, assist, kartalar, tarkib) faqat API ularni bersa hisoblanadi; g'olib va aniq hisob har doim hisoblanadi.
- **Quiz savollari** standart holatda Open Trivia DB'dan (ingliz tilida, futbolga oid savollar filtrlanadi) olinadi. Web admin panelidan savollarni qo'lda ham qo'shish mumkin — ular navbatda birinchi chiqadi.
- **AI Yordamchi** limiti — oxirgi 24 soat ichidagi so'rovlar (sirpanuvchi oyna). Mavzudan tashqari savollar limitdan kamaytirmaydi.
- **Bonus**: Oddiy — oxirgi bonusdan 24 soat o'tgach, Premium — 12 soat o'tgach (kuniga necha marta — admin sozlamasi).
- **Hafta**: seshanba 12:00 — keyingi seshanba 11:59. Haftalik/oylik g'oliblar davr tugagach 3 soat ichida aniqlanadi (kechikkan natijalar uchun) va web admin statistikasida ko'rinadi.
- **O'zbek (kirill)** matnlari lotin matndan avtomatik transliteratsiya qilinadi (`src/i18n/translit.js`); aniq tarjima kerak bo'lsa `src/i18n/locales/uz_cyrl.js` dagi `OVERRIDES` ga qo'shing.

## Testlar

```bash
TEST_DATABASE_URL=postgres://... npm test
```

Testlar bo'sh test bazasini har safar qayta yaratadi — asosiy bazani bermang. Telegram, football-data va Quiz API'lari soxta javoblar bilan almashtiriladi.

## Tuzilma

```
src/
  index.js              ishga tushirish (migratsiya, bot, web, fon vazifalari)
  config.js             .env sozlamalari
  db/                   PostgreSQL ulanish va sxema
  i18n/                 4 tilli matnlar va transliteratsiya
  services/             biznes mantiq (promo, referral, bonus, manager, quiz, ...)
  bot/                  Telegram bot: handlers/ (start, balance, donate, sections, admin)
  web/                  Express: Web App API, admin API, initData tekshiruvi
  jobs/scheduler.js     fon vazifalari
public/                 Web App va web admin paneli
test/                   avtomatik testlar
Dockerfile, docker-compose.yml, Caddyfile   mustaqil ishga tushirish
```

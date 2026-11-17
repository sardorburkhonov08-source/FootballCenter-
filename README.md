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

```bash
npm install
cp .env.example .env   # qiymatlarni to'ldiring
npm start
```

Server ishga tushganda baza jadvallari avtomatik yaratiladi (`src/db/schema.sql`).

### Replit'da

1. Repo'ni Replit'ga import qiling (`.replit` fayli tayyor).
2. **Secrets** bo'limiga `.env.example`dagi o'zgaruvchilarni qo'shing. PostgreSQL uchun Replit Database (`DATABASE_URL` avtomatik beriladi) yoki Neon/Supabase.
3. **Deploy** qiling (Reserved VM tavsiya etiladi — bot va fon vazifalari doimiy ishlashi kerak). Deploy manzilini `WEBAPP_URL` ga yozing.
4. BotFather'da: `/mybots` → bot → **Bot Settings → Menu Button** → `WEBAPP_URL` manzili. Bot o'zi ham ishga tushganda menyu tugmasini shu manzilga sozlaydi.
5. Majburiy obuna va donat kanali uchun botni o'sha kanallarga **admin** qilib qo'shing.

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
```

# ⚽ FootballCenter

Telegram bot + Mini App (Web App). Texnik topshiriq: [docs/SPEC.md](docs/SPEC.md). Ishlab chiquvchilar uchun qoidalar va bosqichlar: [CLAUDE.md](CLAUDE.md).

Texnologiyalar: Node.js, Express, grammY, PostgreSQL. Hosting: **Railway**.

---

## 🚂 Railway'ga joylash — qadam-baqadam

Kerak bo'ladi: GitHub akkaunt (shu repo), Telegram, bank kartasi (Railway bepul sinov kreditidan keyin pullik — narxlarni [railway.com/pricing](https://railway.com/pricing) da ko'ring). Taxminan 20 daqiqa.

> ⚠️ **Repo public.** Token, parol va kalitlarni hech qachon kodga, GitHub'ga yoki chatga yozmang — faqat Railway'ning **Variables** bo'limiga.

### 1. Bot tokeni va Telegram ID

1. Telegram'da **@BotFather** → `/newbot` → bot nomi → username (oxiri `bot` bilan tugaydi).
2. BotFather bergan **token**ni (`123456789:AAH...`) saqlab qo'ying.
3. **@userinfobot** ga `/start` yozing — u yuborgan **Id** raqami sizning Telegram ID'ingiz.

### 2. Railway'da loyiha yaratish va GitHub repo'ni ulash

1. [railway.com](https://railway.com) → **Login** → **GitHub** orqali kiring.
2. **New Project** → **Deploy from GitHub repo**.
3. Ro'yxatdan **FootballCenter-** repo'sini tanlang. (Ro'yxatda bo'lmasa: **Configure GitHub App** → repo'ga ruxsat bering.)
4. Railway servisni yaratadi va birinchi yig'ishni boshlaydi. Hozircha xato bilan to'xtashi normal — o'zgaruvchilar hali kiritilmagan.

### 3. PostgreSQL qo'shish

1. Loyiha oynasida **+ Create** (yoki **New**) → **Database** → **Add PostgreSQL**.
2. Bir necha soniyada **Postgres** servisi paydo bo'ladi. Uni sozlash shart emas.

### 4. Domen olish

1. Bot servisini (FootballCenter-) bosing → **Settings** → **Networking** → **Generate Domain**.
2. Port so'ralsa — deploy logidagi `🌐 Web server: http://localhost:XXXX` qatoridagi raqamni yozing (ilova Railway bergan `PORT` ni o'zi o'qiydi).
3. `https://footballcenter-production-xxxx.up.railway.app` ko'rinishidagi manzil chiqadi — nusxalab oling. Bu sizning **WEBHOOK_URL**'ingiz.

### 5. Environment variable'larni kiritish

Bot servisi → **Variables** → **+ New Variable** (yoki **Raw Editor**) va quyidagilarni qo'shing:

| Nomi | Qiymati |
|---|---|
| `BOT_TOKEN` | 1-qadamdagi token |
| `ADMIN_IDS` | 1-qadamdagi Telegram ID (bir nechta bo'lsa vergul bilan) |
| `WEBHOOK_URL` | 4-qadamdagi manzil, oxirida `/` siz |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — aynan shunday yozing, Railway o'zi bazaga ulaydi |

Ixtiyoriy (keyinroq qo'shsa ham bo'ladi):

| Nomi | Nima uchun |
|---|---|
| `FOOTBALL_API_KEY` | O'yinlar va musobaqalar — [football-data.org](https://www.football-data.org/client/register) da bepul ro'yxatdan o'tib olinadi |
| `ANTHROPIC_API_KEY` | 🤖 AI Yordamchi — [console.anthropic.com](https://console.anthropic.com) (pullik) |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | Web admin paneliga (`/admin`) brauzerdan kirish uchun. Telegram orqali admin login'siz kiradi |

Saqlagach Railway servisni avtomatik qayta yig'adi va ishga tushiradi.

### 6. Fayllar uchun Volume (bannerlar, sovrin rasmlari)

Railway'da serverning disk xotirasi har deploy'da tozalanadi. Admin yuklagan rasmlar yo'qolmasligi uchun:

1. Loyiha oynasida **+ Create** → **Volume** (yoki servis ustida o'ng tugma → **Attach Volume**) → bot servisini tanlang.
2. **Mount path**: `/app/uploads`.

### 7. Ishlayotganini tekshirish

1. Bot servisi → **Deployments** → oxirgi deploy → **View Logs**. Quyidagilar ko'rinishi kerak:
   ```
   ✅ Ma'lumotlar bazasi tayyor
   🌐 Web server: ...
   🤖 Bot webhook rejimida: @sizning_bot
   ```
2. Brauzerda `WEBHOOK_URL/healthz` → `{"ok":true}`.
3. Telegram'da botga `/start` → til tanlash chiqadi → asosiy menyu.

**Webhook alohida o'rnatilmaydi** — bot har ishga tushganda uni `WEBHOOK_URL/telegram/webhook` ga o'zi o'rnatadi.

### 8. BotFather sozlamalari

Bot ishga tushganda menyu tugmasini Mini App'ga (`WEBHOOK_URL/app`) o'zi sozlaydi. Qo'lda ham qilish mumkin:

1. @BotFather → `/mybots` → botingiz → **Bot Settings** → **Menu Button** → URL: `WEBHOOK_URL/app` (masalan `https://...up.railway.app/app`).
2. Ixtiyoriy: **Edit Bot** → **Edit Description / About / Botpic** — bot tavsifi va rasmi.
3. Majburiy obuna va donat kanali uchun botni o'sha kanallarga **admin** qilib qo'shing.

### Muammo bo'lsa

| Belgi | Sabab |
|---|---|
| Logda `BOT_TOKEN noto'g'ri` | Token xato nusxalangan — BotFather'dan qayta oling |
| Logda `DATABASE_URL sozlanmagan` | 5-qadamdagi `DATABASE_URL` qo'shilmagan |
| Bot javob bermaydi, log toza | `WEBHOOK_URL` domen bilan bir xil emas yoki oxirida `/` bor |
| Mini App "Telegram orqali oching" deydi | Sahifa brauzerda ochilgan — bot ichidagi tugma orqali oching |

---

## 💻 Lokal ishlab chiqish

```bash
npm install
cp .env.example .env
npm start
```

`.env` da `BOT_TOKEN`, `DATABASE_URL` (lokal PostgreSQL), `ADMIN_IDS` ni to'ldiring. `WEBHOOK_URL` bo'sh bo'lsa, bot long polling rejimida ishlaydi — domen kerak emas (lekin Mini App HTTPS'siz Telegram'da ochilmaydi).

Migratsiyalar server ishga tushganda avtomatik bajariladi (`src/db/migrations`); qo'lda: `npm run migrate`.

Testlar (alohida, bo'sh test bazasi kerak — u har safar tozalanadi):

```bash
TEST_DATABASE_URL=postgres://... npm test
```

# 📘 FootballCenter'ni ishga tushirish — qadamma-qadam

Umumiy vaqt: taxminan 30–40 daqiqa. Narx: server oyiga taxminan **€6**, domen **bepul**.

Sizdan kerak bo'ladigan narsalar: Telegram, bank kartasi (Visa/Mastercard — xorijiy to'lov uchun), kompyuter yoki telefon.

---

## 1-qadam. Bot tokenini olish (2 daqiqa)

1. Telegram'da **@BotFather** ni oching va **Start** bosing.
2. `/newbot` yuboring.
3. Bot nomini yozing, masalan: `FootballCenter`.
4. Username yozing — oxiri `bot` bilan tugashi shart, masalan: `footballcenter_uz_bot`.
5. BotFather `123456789:AAH...` ko'rinishidagi **token** beradi. Uni nusxalab, xavfsiz joyga saqlang.

> ⚠️ Tokenni hech kimga (jumladan chatga) yubormang. Kim bilsa, botingizni boshqara oladi. Agar tasodifan ko'rsatib qo'ysangiz: @BotFather → `/mybots` → bot → **API Token** → **Revoke** — yangi token beriladi.

## 2-qadam. Telegram ID'ingizni bilish (1 daqiqa)

1. Telegram'da **@userinfobot** ni oching va **Start** bosing.
2. U yuborgan `Id: 123456789` raqamini saqlang — bu sizni botda **ega (admin)** qiladi.

## 3-qadam. Server ochish — Hetzner (10 daqiqa, ~€6/oy)

1. [hetzner.com/cloud](https://www.hetzner.com/cloud) → **Sign up**. Email, ism, manzil va kartani kiriting. Ba'zan pasport rasmini so'rashi mumkin — bu oddiy tekshiruv.
2. Kirgach: **Projects → New project** (nomi: `footballcenter`) → loyihani oching.
3. **Add Server** bosing va tanlang:
   - **Location**: `Helsinki` yoki `Nuremberg`
   - **Image**: `Ubuntu 24.04`
   - **Type**: `Shared vCPU` → **x86** → eng arzoni (**CX23**, 2 vCPU, 4 GB RAM)
   - **Networking**: `Public IPv4` yoqilgan bo'lsin
   - **SSH keys**: hech narsa qo'shmasangiz ham bo'ladi — root paroli emailga keladi
   - **Name**: `footballcenter`
4. **Create & Buy now** bosing.
5. Server ro'yxatida **IP manzil** chiqadi (masalan `65.21.10.20`) — saqlang. Root paroli emailingizga keladi.

> 💡 Narx: Hetzner narxlarni vaqti-vaqti bilan o'zgartiradi, buyurtma sahifasida joriy narx ko'rsatiladi. Bepul muqobil — Oracle Cloud "Always Free", lekin u yerda server ko'pincha "out of capacity" bo'ladi va limitdan oshsa o'chirib yuboriladi; doimiy bot uchun tavsiya etmayman.

## 4-qadam. Bepul domen — DuckDNS (3 daqiqa)

Telegram Web App faqat HTTPS manzil bilan ochiladi, buning uchun domen kerak.

1. [duckdns.org](https://www.duckdns.org) → Google yoki GitHub orqali kiring.
2. **sub domain** maydoniga nom yozing (masalan `footballcenter`) → **add domain**.
3. Yangi qatorda **current ip** maydoniga **3-qadamdagi server IP'sini** yozing → **update ip**.
4. Domeningiz: `footballcenter.duckdns.org` — saqlang.

## 5-qadam. Serverga ulanish (2 daqiqa)

**Kompyuterdan (Windows / Mac / Linux):** terminal (Windows'da **PowerShell**) oching va yozing (IP o'rniga o'zingiznikini):

```bash
ssh root@65.21.10.20
```

`yes` deb javob bering, keyin emaildagi root parolini kiriting (yozganda ko'rinmaydi — bu normal). Birinchi kirishda parolni almashtirishni so'raydi: eski parolni, keyin ikki marta yangisini kiriting.

**Telefondan:** **Termius** ilovasini o'rnating → **New Host** → IP, username `root`, parol → **Connect**.

## 6-qadam. Botni o'rnatish (5 daqiqa)

Serverda ketma-ket yozing:

```bash
git clone https://github.com/sardorburkhonov08-source/FootballCenter-.git
```

```bash
cd FootballCenter- && bash setup.sh
```

Skript so'raydi:
- **bot tokeni** — 1-qadamdagi token (serverga yozasiz, chatga emas)
- **Telegram ID** — 2-qadamdagi raqam
- **domen** — 4-qadamdagi `footballcenter.duckdns.org`
- **admin login** — Enter bossangiz `admin`
- **API kalitlari** — hozircha Enter bosib o'tkazib yuboring

Oxirida 🎉 **Tayyor!** va web admin paroli chiqadi — uni saqlang.

## 7-qadam. Tekshirish

1. Telegram'da botingizga `/start` yozing → til tanlash chiqishi kerak.
2. Menyuda **⚽ FootballCenter** tugmasini bosing → Web App ochiladi.
3. Menyuda **🔒 Admin Panel** bor — siz egasiz.
4. Admin paneldan **💳 To'lov kartalari** bo'limida kartangizni kiriting.

## Keyinchalik

- **Futbol ma'lumotlari:** [football-data.org](https://www.football-data.org/client/register) da bepul ro'yxatdan o'ting, emailga kelgan kalitni serverdagi `.env` fayliga `FOOTBALL_API_KEY=...` qilib yozing va `bash setup.sh update` bering.
- **AI Yordamchi:** [console.anthropic.com](https://console.anthropic.com) dan API kalit oling (pullik, foydalanishga qarab), `.env` ga `ANTHROPIC_API_KEY=...` yozing va `bash setup.sh update`.
- **Yangi versiyaga o'tish:** `cd FootballCenter- && bash setup.sh update`
- **Holatni ko'rish:** `bash setup.sh status`
- **Majburiy obuna / donat kanali:** botni kanalga **admin** qilib qo'shing, keyin bot ichidagi Admin Panel'dan kanalni ulang.

## Muammo bo'lsa

`bash setup.sh status` buyrug'i chiqargan oxirgi qatorlarni yuboring (tokenni emas — u loglarda ko'rinmaydi).

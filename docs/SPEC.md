# FootballCenter — To'liq texnik topshiriq (Replit uchun)

Bu hujjat — Telegram bot + Web App (Mini App) ko'rinishidagi "FootballCenter" loyihasini noldan qurish uchun to'liq, aniq va xatosiz texnik topshiriq. Har bir bo'lim, tugma, xabar matni va qoida shu yerda batafsil yozilgan. Kodni yozayotganda shu hujjatdagi mantiqdan chetga chiqmang, hech narsani o'zingizdan o'ylab qo'shmang yoki kamaytirmang.

---

## 0. Texnologiyalar

- **Backend:** Node.js + Express.js
- **Telegram bot kutubxonasi:** `node-telegram-bot-api` (yoki `grammY`)
- **Ma'lumotlar bazasi:** PostgreSQL (Replit'da "Replit Database" yoki tashqi Postgres, masalan Neon/Supabase bepul tarifi)
- **Web App frontend:** oddiy HTML/CSS/JS yoki React — bitta Express server orqali xizmat qiladi
- **Web App admin paneli:** alohida route (masalan `/admin`), login+parol yoki Telegram avtorizatsiyasi bilan himoyalangan
- **Football ma'lumotlari:** tashqi Football API (masalan football-data.org) — API kaliti keyinroq `.env`ga qo'shiladi, hozircha `FOOTBALL_API_KEY` o'zgaruvchisi bo'sh qoldiriladi va barcha API chaqiruvlar shu o'zgaruvchi orqali ishlaydi
- **Fayllar/rasmlar saqlash:** chek rasmlari, banner media, sovrin media — server fayl tizimida yoki bulutli saqlash (masalan Cloudinary bepul tarifi)

---

## 1. BOT — Foydalanuvchi oqimi

### 1.1. Majburiy obuna
- `/start` bosilganda, agar admin panelda "Majburiy obuna: ON" bo'lsa, bot foydalanuvchidan ko'rsatilgan kanal(lar)ga a'zo bo'lishni so'raydi.
- Xabarda kanal(lar)ga havola va "✅ Tasdiqlash" tugmasi bo'ladi.
- "✅ Tasdiqlash" bosilganda, bot Telegram API orqali (`getChatMember`) foydalanuvchining shu kanal(lar)ga a'zoligini tekshiradi.
- A'zo bo'lmasa → xabar qayta chiqadi, "✅ Tasdiqlash" tugmasi qayta bosiladi (obuna bo'lguncha davom etadi).
- A'zo bo'lsa → keyingi bosqichga (til tanlash) o'tadi.
- Agar admin panelda "Majburiy obuna: OFF" bo'lsa, bu bosqich butunlay o'tkazib yuboriladi.

### 1.2. Til tanlash
- Faqat foydalanuvchining **birinchi** `/start` bosishida ko'rsatiladi. Keyingi safarlarda bu bosqich takrorlanmaydi — tanlangan til bazada saqlanadi (`users.language` maydoni).
- Xabar matni — 4 tilda ketma-ket, bitta xabarda:

```
O'zingizga qulay tilni tanlang 🇺🇿

Ўзингизга қулай тилни танланг 🇺🇿

Выбери язык, который тебе нравится 🇷🇺

Choose the language you like 🇺🇸
```

- Pastda 4 ta tugma: 🇺🇿 O'zbek (lotin), 🇺🇿 Ўзбек (кирил), 🇷🇺 Русский, 🇺🇸 English.
- Tanlangan til shu foydalanuvchi uchun bazaga yoziladi va botning **barcha keyingi matnlari** shu tilda ko'rsatiladi. Har bir bot matni 4 tilda tarjima qilib saqlanadi (masalan JSON lokalizatsiya fayllari yoki bazada `translations` jadvali orqali).
- **Qoida:** botdan chiqadigan har qanday javob yoki xabar mos emoji bilan boshlanadi/ajratiladi (masalan 💰, ✅, ❌, ⚠️ va h.k.) — bu butun loyiha davomida qat'iy amal qiladi.

### 1.3. Asosiy menyu
Til tanlangandan keyin (yoki keyingi barcha `/start` bosishlarda, agar til allaqachon tanlangan bo'lsa) quyidagi menyu chiqadi — reply keyboard yoki inline keyboard shaklida, 2 ustunli:

```
💰 Balans          👤 Profil
❤️ Donat           📜 Qoidalar
💎 Tarif           ⚙️ Sozlamalar
🆘 Yordam          🤖 AI Yordamchi
⚽ FootballCenter   (to'liq qatorda, web_app turidagi tugma)
```

Agar foydalanuvchi **admin yoki ega** bo'lsa, qo'shimcha qator chiqadi:
```
🔒 Admin Panel
```
Bu tugma oddiy foydalanuvchilarga umuman ko'rinmaydi.

`⚽ FootballCenter` tugmasi — oddiy callback emas, Telegram'ning `web_app` turidagi tugmasi bo'lib, bosilganda Mini App (Web App)ni ochadi.

---

## 2. BOT — 💰 Balans bo'limi

Bosilganda:
```
💰 Balans
Joriy balans: {balans} so'm

[➕ Balans to'ldirish] [🎫 Promokod]
[👥 Referral]          [🎁 Bonus]
[🔙 Orqaga]
```

### 2.1. ➕ Balans to'ldirish — to'liq oqim
1. **Karta turi tanlanadi:** Humo, Uzcard, Visa, Mastercard (4 ta tugma)
2. Tanlangan turga mos, admin panelda oldindan kiritilgan **karta raqami** va **karta egasi F.I.Sh.** chiqadi. Karta raqamiga bosilganda avtomatik nusxalanadi (Telegram'da bu — matnni `monospace`/`code` formatida yuborish, bosilganda mobil qurilmada avtomatik nusxalash imkoniyati beradi).
3. Bot ogohlantiradi: to'lov chekini (skrinshot/rasm) tashlash kerakligi haqida.
4. Foydalanuvchi **summani** kiritadi (matn ko'rinishida, faqat raqam qabul qilinadi, validatsiya qilinsin).
5. Bot **chek rasmini** so'raydi. Foydalanuvchi rasm yuboradi.
6. Bu barcha ma'lumot (summa, chek rasmi, karta turi, foydalanuvchi) **avtomatik adminga** yuboriladi, ✅ Tasdiqlash / ❌ Rad etish tugmalari bilan.
7. **Admin tasdiqlasa** → foydalanuvchiga "✅ To'lovingiz tasdiqlandi, balansingizga {summa} so'm qo'shildi" xabari boradi, balans yangilanadi.
8. **Admin rad etsa** → admin sababni matn ko'rinishida yozadi → foydalanuvchiga "❌ To'lovingiz rad etildi. Sabab: {sabab}" xabari boradi.

### 2.2. 🎫 Promokod — to'liq tizim

**Admin panelda promo-kod yaratish maydonlari:**
- Kod (matn, masalan `FOOTBALL2026`)
- Bonus turi: **Premium** / **Balans** (pul) — faqat shu 2 turdan biri
- Qiymat (Premium uchun — necha kun, Balans uchun — necha so'm)
- Umumiy foydalanish limiti (masalan 1000 ta)
- 1 foydalanuvchi uchun limit: har doim 1 marta (qattiq qoida)
- Boshlanish sanasi, tugash sanasi
- Status: Faol / Nofaol

**Foydalanuvchi tomonida:**
1. "🎫 Promokod" bosiladi → bot: "🎁 Promo-kodingizni kiriting:"
2. Foydalanuvchi kodni yozadi
3. Server ketma-ket tekshiradi:
   - Kod mavjudmi? → yo'q bo'lsa: `❌ Bunday kod topilmadi`
   - Muddati o'tmaganmi? → o'tgan bo'lsa: `⏰ Bu kodning muddati o'tgan`
   - Faolmi? → nofaol bo'lsa: `🚫 Bu kod hali faol emas / to'xtatilgan`
   - Umumiy limit tugamaganmi? → tugagan bo'lsa: `📛 Limit tugagan`
   - Bu foydalanuvchi avval ishlatganmi? → ishlatgan bo'lsa: `⚠️ Siz bu kodni allaqachon ishlatgansiz`
   - Hammasi to'g'ri bo'lsa → bonus beriladi:
```
✅ Promo-kod muvaffaqiyatli faollashtirildi!
🎁 Sizga 30 kun Premium berildi.
📅 Amal qilish muddati: 22.10.2026 gacha.
```
(yoki balans turi bo'lsa: "🎁 Sizga {summa} so'm balansga qo'shildi.")

**Ma'lumotlar bazasi tuzilishi:**
```
promo_codes: id, code, type (premium|balance), value, max_uses, used_count, starts_at, expires_at, status
promo_code_uses: id, promo_code_id, user_id, used_at
```
Har bir foydalanish `promo_code_uses` jadvaliga yoziladi — shu orqali bitta foydalanuvchi bitta kodni qayta ishlata olmasligi ta'minlanadi.

### 2.3. 👥 Referral — to'liq tizim

Har bir foydalanuvchiga avtomatik shaxsiy havola beriladi: `t.me/{bot_username}?start=ref_{unique_code}`

**👥 REFERRAL bo'limi ichida:**
```
🔗 Mening havolam
📊 Statistika
💰 Balans (referraldan kelgan)
❓ Qanday ishlaydi?
```

**Muhim qoida — "faol referral" ta'rifi (soxta akkauntlardan himoya):**
Yangi foydalanuvchi shunchaki `/start ref_XXX` bossa, bonus **berilmaydi**. Referral faqat quyidagi shartlardan **biri** bajarilganda "faol" hisoblanadi:
- taklif qilingan foydalanuvchi Web App'ga kamida 1 marta kirib chiqsa, **YOKI**
- Premium sotib olsa

Shu shart bajarilgandagina taklif qiluvchining balansiga bonus tushadi.

**Admin panel sozlamalari:**
- Referral tizimi: ON/OFF
- 1 ta faol referral uchun miqdor — **Oddiy** va **Premium** foydalanuvchilar uchun **alohida-alohida** kiritiladi (masalan Oddiy: 1000 so'm, Premium: 1500 so'm)
- Soxta referral himoyasi: ON/OFF

**🏆 Referral League:**
- Oylik leaderboard, eng ko'p faol referral taklif qilgan foydalanuvchilar reytingi
- **1-o'rin** — avtomatik 1 oylik Premium tekin beriladi

### 2.4. 🎁 Bonus — to'liq tizim
- Bosilganda bot **random miqdorda pul** beradi, avtomatik balansga qo'shiladi
- Admin panelda **min-max oraliq** belgilanadi:
  - **Oddiy tarif uchun** — alohida min-max, **kuniga 1 marta**
  - **Premium tarif uchun** — alohida min-max, **kuniga 2 marta (har 12 soatda 1 marta)**
- Limit tugagan holatda bot: "⏳ Keyingi bonusingiz {vaqt}dan keyin" kabi xabar beradi

---

## 3. BOT — 👤 Profil bo'limi

To'liq **read-only** (faqat ko'rish uchun), faqat **[🔙 Orqaga]** tugmasi bor. Foydalanuvchi hech qanday maydonni bu yerdan tahrirlay olmaydi.

```
🧑 Ism: {Telegram'dan avtomatik}
📛 Username: {Telegram'dan avtomatik}
🆔 Telegram ID: {Telegram'dan avtomatik}
🌐 Til: {bazadan}

💰 Balans: {balans} so'm
⭐ Points: {Mini Manager'dan hisoblangan umumiy ball}
⭐ Ball: {Football Quiz'dan hisoblangan umumiy ball}
💎 Tarif: {Oddiy | Premium (necha kun qoldi)}
📅 Ro'yxatdan o'tgan: {sana}

👥 Referrallar: {faol referrallar soni}

[🔙 Orqaga]
```

---

## 4. BOT — ❤️ Donat bo'limi

To'liq oqim, qadam-baqadam:

1. `❤️ Donat` bosiladi
2. **Karta turi tanlanadi:** Humo / Uzcard / Visa / Mastercard
3. Tanlangan turga mos **karta raqami + F.I.Sh.** chiqadi (Balans to'ldirishdagi kabi kartalar, ammo alohida admin sozlamasi bo'lishi mumkin)
4. Foydalanuvchi **summani** kiritadi
5. **[Tasdiqlash]** bosiladi
6. Bot **chek (rasm)** so'raydi, foydalanuvchi yuboradi
7. Bot izoh yozishni taklif qiladi: **[✍️ Izoh yozish]** yoki **[➡️ O'tkazib yuborish]**. Izoh yozilsa — **maksimum 200 belgi**, validatsiya qilinsin.
8. **[Tasdiqlash]** bosilgach, bot barcha ma'lumotni (summa, chek, izoh, foydalanuvchi) **avtomatik adminga** yuboradi, ✅/❌ tugmalari bilan.
9. **Admin rad etsa** → sababni yozadi → foydalanuvchiga sabab bilan xabar boradi: "❌ Donat rad etildi. Sabab: {sabab}"
10. **Admin tasdiqlasa** → summaga va donat tarixiga qarab quyidagi xabarlardan biri avtomatik yuboriladi:

**Birinchi marta, ≤50 000 so'm:**
```
💚 {ism}, rahmat! Sizning hissangiz biz uchun juda qadrli.
Har bir yordam katta o'zgarishga olib keladi.
⚽ FootballCenter yanada yaxshi bo'ladi!
```

**Birinchi marta, >50 000 so'm:**
```
👑 {ism}, siz FootballCenterning faxriy donorisiz!
Bunday qo'llab-quvvatlash biz uchun katta mas'uliyat.
Sizning ismingiz "Top donorlar" ro'yxatida abadiy qoladi.
Chin dildan rahmat!🩵
```

**2-marta va undan keyingi har bir donat (miqdoridan qat'i nazar):**
```
💎 {ism}, siz yana biz bilan!
Sizning sadoqatingiz va doimiy qo'llab-quvvatlashingiz biz uchun bebaho.
Siz haqiqiy FootballCenter oilasining bir qismisiz.
Katta rahmat!❤️
```

11. Shundan so'ng, bot foydalanuvchidan **ruxsat so'raydi** (kanalga e'lon qilish uchun):
```
💚 {ism}, donat uchun katta rahmat!
Sizning hissangiz FootballCenter uchun juda muhim.
Ismingizni kanalimizda e'lon qilaylikmi?

[✅ Ha, e'lon qiling]  [🔒 Anonim qolsin]
```
- **Belgilangan vaqt ichida javob bo'lmasa** → avtomatik "Anonim" deb hisoblanadi.
- Har ikki holatda ham (Ha yoki Anonim) — kanalga **albatta** post ketadi, farqi faqat ism ko'rsatilishi yoki "Anonim" deb yozilishida.

12. Admin panelda oldindan ulangan **maxsus donat kanaliga** avtomatik quyidagi formatda post yuboriladi:
```
❤️ Faxriy donor!🩵

👤 Foydalanuvchi: {ism yoki "Anonim"}
💰 Donat miqdori: {summa} so'm
💬 Izoh: {izoh, agar yozilgan bo'lsa}

Bunday qo'llab-quvvatlash biz uchun katta mas'uliyat. Albatta, FootballCenter jamoasi sizga o'zining minnatdorchiligini bildiradi❤️ Chin dildan rahmat! 👑
```

---

## 5. BOT — 📜 Qoidalar bo'limi

```
📜 Qoidalar

[📋 Umumiy qoidalar]
[👤 Foydalanuvchi qoidalari]
[💎 Premium va to'lov]
[🎁 Bonus va referral]
[🤖 AI qoidalari]
[🔒 Maxfiylik]
[🚫 Bloklash]
[©️ Mualliflik huquqi]

[🔙 Orqaga]
```
Har bir tugma bosilganda chiqadigan matn — **admin panel orqali** admin tomonidan keyinroq kiritiladi/tahrirlanadi. Kod darajasida bu — bazadagi `rules` jadvalidan (`key`, `text_uz`, `text_uz_cyrl`, `text_ru`, `text_en`) matnni o'qib chiqarish bo'lishi kerak, hozircha bo'sh/placeholder holatda.

---

## 6. BOT — 💎 Tarif bo'limi

1. `💎 Tarif` bosilganda:
```
💎 Tarif
Hozirgi tarif: {🆓 Oddiy | 💎 Premium}

[🆓 Oddiy (bepul)]
[💎 Premium (Tanlash)]
[📊 Taqqoslash]
[🔙 Orqaga]
```

2. **🆓 Oddiy bosilsa:** "Siz Oddiy tarifdasiz ✅" kabi xabar chiqadi.

3. **💎 Premium bosilsa:** 1 oylik Premium narxi (admin panelda belgilanadigan qiymat) va tavsifi ko'rsatiladi, **[Faollashtirish]** tugmasi bilan.

4. **[Faollashtirish] bosilganda:**
   - Balansda yetarli mablag' bo'lsa → avtomatik yechiladi → 1 oylik Premium faollashadi → "✅ Premium faollashtirildi! Balansdan {summa} so'm yechildi. Amal qilish muddati: {sana}gacha"
   - Balansda yetmasa → "😔 Kechirasiz, balansingizda mablag' yetarli emas. Hisobingizni to'ldiring."

5. **📊 Taqqoslash bosilganda:** Oddiy va Premium farqlarini ko'rsatuvchi matn (7-bo'limdagi jadval asosida), **admin panelda tahrirlanadigan** matn sifatida saqlanadi.

---

## 7. Oddiy vs Premium — to'liq farqlar jadvali

| Bo'lim | Oddiy | Premium |
|---|---|---|
| 🤖 AI Yordamchi (kunlik so'rov) | 1 ta | 10 ta |
| 🎁 Bonus (kunlik chastota) | 1 marta | 2 marta (12 soatda) |
| 🧠 Football Quiz | ❌ Butunlay yopiq | ✅ To'liq ishlaydi |
| 🔔 Bildirishnomalar | Faqat "Bot yangiliklari" + "Balans/to'lov" | Barchasi yoqish/o'chirish mumkin |
| ⚽ Home — o'yinlar ro'yxati (jadval, yakuniy hisob) | ✅ Ko'radi | ✅ Ko'radi |
| ⚽ Home — batafsil (statistika, tarkib, eventlar) | ❌ Yopiq | ✅ To'liq |
| 🏆 Musobaqalar — Turnir jadvali | ✅ Ko'radi | ✅ Ko'radi |
| 🏆 Musobaqalar — Natijalar/Taqvim/Top o'yinchilar | ❌ Yopiq | ✅ To'liq |
| 👥 Referral bonus miqdori | Admin belgilagan (pastroq) | Admin belgilagan (yuqoriroq), alohida sozlanadi |
| 🎫 Promokod | Barcha kodlarni ishlatadi | Ba'zi kodlar faqat Premium uchun bo'lishi mumkin (admin belgilaydi) |
| 🎮 Mini Manager | Farqi yo'q | Farqi yo'q |

Har bir cheklov qiymati (masalan "1 ta", "10 ta", min-max summalar) **admin panelda o'zgartiriladigan** qilib qurilishi shart — kod ichida qattiq (hardcode) yozilmasin.

---

## 8. BOT — ⚙️ Sozlamalar bo'limi

```
⚙️ Sozlamalar

[🌐 Tilni o'zgartirish]
[🔔 Bildirishnomalar]
[🔙 Orqaga]
```

### 8.1. 🌐 Tilni o'zgartirish
Bosilganda — xuddi boshlang'ich til tanlashdagi kabi, 4 tilli xabar va 4 tugma qayta chiqadi.

### 8.2. 🔔 Bildirishnomalar
Har biri alohida ON/OFF tugma (masalan ✅/❌ prefiksi bilan, bosilganda holati almashadi):

| Bildirishnoma | Oddiy | Premium |
|---|---|---|
| 📢 Bot yangiliklari | ✅ Doimiy yoqilgan (o'chirib bo'lmaydi) | Yoqish/o'chirish mumkin |
| ⏰ Premium tugash eslatmasi (3 kun qolganda) | 🔒 Qulflangan — bosilsa "Premium sotib oling" chiqadi | Yoqish/o'chirish mumkin |
| ⚽ O'yin boshlanishidan 15 daqiqa oldin (Web App'da yoqilgan bo'lishi shart) | 🔒 Qulflangan | Yoqish/o'chirish mumkin |
| 🎮 Mini Manager natijasi e'lon qilingani | 🔒 Qulflangan | Yoqish/o'chirish mumkin |
| 🏆 Haftalik/oylik reyting yakunlandi | 🔒 Qulflangan | Yoqish/o'chirish mumkin |
| 🧠 Quiz — yangi savol chiqdi | 🔒 Qulflangan (Quiz o'zi Premium-only) | Yoqish/o'chirish mumkin |
| 💰 Balans/to'lov holati (tasdiq/rad) | ✅ Doimiy yoqilgan | ✅ Doimiy yoqilgan |
| 🎁 Bonus tayyor bo'ldi | 🔒 Qulflangan | Yoqish/o'chirish mumkin |

Oddiy foydalanuvchi qulflangan bandga bossa: "💎 Bu bildirishnoma faqat Premium foydalanuvchilar uchun. Premium sotib oling."

---

## 9. BOT — 🆘 Yordam bo'limi

```
🆘 Yordam

[✍️ Muammoni yozish]
[❓ Ko'p so'raladigan savollar]
[🔙 Orqaga]
```

### 9.1. ✍️ Muammoni yozish
- Foydalanuvchi matn yozadi → bot avtomatik **adminga** yuboradi
- Admin javob yozganda, foydalanuvchiga quyidagicha xabar boradi:
```
✅ Muammongizga javob berildi:
{admin javobi}

Muammo haqida ogohlantirganingiz uchun rahmat!
```

### 9.2. ❓ Ko'p so'raladigan savollar
Savol-javoblar ro'yxati **admin panel orqali** kiritiladi (Qoidalar bo'limi kabi, bazada saqlanadi).

---

## 10. BOT — 🤖 AI Yordamchi bo'limi

```
🤖 AI Yordamchi

Men sizga quyidagi mavzularda yordam bera olaman:
✅ Botdan foydalanish
✅ Futbol haqida umumiy savollar
❌ Boshqa mavzular

📊 Kunlik qolgan so'rov: {son} ta

[✍️ Savol yozish]
[🔙 Orqaga]
```

- Ishlash tamoili: tashqi **AI API** orqali (masalan Claude yoki OpenAI API), tizim promptida faqat "bot va futbol" mavzusiga cheklanadi.
- **Limitlar:** Oddiy — kuniga 1 so'rov, Premium — kuniga 10 so'rov. Limit har **24 soatda** (foydalanuvchining oxirgi so'rovidan boshlab yoki kunlik 00:00'dan — loyihada aniq belgilab qo'ying, tavsiya: oxirgi so'rovdan 24 soat) yangilanadi.
- **Limit tugaganda:**
  - Oddiy: "💎 Kunlik limitingiz tugadi. Ko'proq so'rov yuborish uchun Premium sotib oling"
  - Premium: "⏳ Bugungi limitingiz tugadi, ertaga qayta urinib ko'ring"
- **Ruxsat etilmagan mavzuda savol berilsa:** bot doimiy bir xil ogohlantirish qaytaradi: "⚠️ Men faqat bot va futbol bo'yicha yordam bera olaman." Bu ogohlantirish javoblari **kunlik limitdan kamaytirmaydi** — faqat mavzuga mos (botga yoki futbolga oid) savollar limitni kamaytiradi.

---

## 11. WEB APP — Umumiy tuzilma

Web App 4 ta asosiy bo'limdan iborat (pastda doimiy navigatsiya bar bilan): **🏠 Home**, **🎮 Mini Manager**, **🧠 Football Quiz**, **👤 Profil**.

### 11.1. 🎬 Reklama banneri
- **Barcha 4 bo'limning tepasida** doimiy joylashadi
- Format: video, animatsiya (GIF/Lottie) yoki rasm
- Video bo'lsa — ovoz yoqish/o'chirish tugmasi (default ovozsiz)
- **Bir vaqtning o'zida bir nechta reklama** bo'lishi mumkin — admin belgilagan vaqt oralig'ida avtomatik almashib turadi (karusel)
- Har bir bannerga **havola** biriktirilishi mumkin (ixtiyoriy, admin panel orqali) — havola **matn sifatida ko'rinmaydi**, banner ustiga bosilganda avtomatik o'sha havolaga o'tadi
- Banner **veb-based admin panel** orqali yuklanadi/boshqariladi

### 11.2. Oddiy vs Premium — Web App'da qulflangan qismlar ko'rinishi
Oddiy foydalanuvchi uchun yopiq bo'limlar **xiraroq (dimmed) va qulf belgisi bilan** ko'rsatiladi; bosilganda "💎 Bu qism faqat Premium foydalanuvchilar uchun" degan modal/xabar chiqadi, Premium sotib olish tugmasi bilan.

---

## 12. WEB APP — 🏠 Home bo'limi

### 12.1. ⚽ O'yinlar (kichik bo'lim)
- Tepada **sana chiziqchasi**: chapga-o'ngga suriladi (masalan "Kecha | Bugun | Ertaga | 25 Sen ..."), tanlangan kun belgilangan. API qancha vaqtgacha o'yin ma'lumoti bersa, o'shancha oldinga/orqaga siljitish mumkin.
- Har bir **o'yin kartasi** ko'rsatadi:
  - Ikkala jamoa nomi + logotipi
  - Hisob (agar o'yin boshlangan/tugagan bo'lsa)
  - O'yin vaqti (agar hali boshlanmagan bo'lsa)
  - Liga/turnir nomi
  - Holat: 🔴 Live / ⏳ Hali boshlanmagan / ✅ Tugagan
- **Oddiy tarif:** faqat shu ro'yxat va yakuniy hisobni ko'radi.
- Kartaga bosilganda **batafsil sahifa** ochiladi, ichida tablar (API qaysi ma'lumotni bersa, o'sha tab avtomatik shakllanadi): masalan "📊 Statistika | 👥 Tarkib | ⚡ Eventlar".
- **Premium:** batafsil sahifaga to'liq kirish huquqi.
- **Oddiy:** batafsil sahifa qulflangan.
- Ko'rsatiladigan ligalar — API qaysi ligalarni bersa, **hammasi** ko'rsatiladi, cheklov yo'q.

### 12.2. 🏆 Musobaqalar (kichik bo'lim)
- Bosilganda ikki qism ko'rinadi:
  1. **🌍 Xalqaro turnirlar** — masalan Chempionlar Ligasi, Yevropa Ligasi, Konferensiya Ligasi va davlatlar o'rtasidagi boshqa turnirlar (API qaysi turnirlarni bersa)
  2. **🗺️ Davlatlar** — **alifbo tartibida**, to'liq ro'yxat (qidiruvsiz)
- Davlat tanlansa (masalan O'zbekiston) → o'sha davlat uchun API'da mavjud musobaqalar chiqadi (Superliga, Pro Liga, Kubok va h.k. — API qaysini bersa)
- Musobaqa tanlansa (masalan Superliga) → ichida tablar:
  - 📋 Turnir jadvali
  - ⚽ Natijalar
  - 📅 Taqvim
  - 🥇 Top o'yinchilar (gol urganlar, TOP 10)
  - 🎯 Assistentlar (TOP 10)
- **Oddiy tarif:** faqat **📋 Turnir jadvali** ochiq.
- **Premium:** barcha tablar ochiq.
- Hammasi to'liq **API'ga bog'liq** — API qaysi ma'lumotni bersa, o'sha avtomatik ko'rsatiladi.

### 12.3. 📰 Yangiliklar (kichik bo'lim)
- **Hozircha OFF** (o'chirilgan). Kod tuzilmasida joyi qoldirilsin, lekin faollashtirilmasin — kelajakda yoqish oson bo'lishi uchun.

---

## 13. WEB APP — 🎮 Mini Manager bo'limi

**Muhim: bu bo'lim Oddiy va Premium foydalanuvchilar uchun bir xil ishlaydi, farqi yo'q.**

### 13.1. Murabbiy ismi
- Foydalanuvchi Mini Manager'ga birinchi marta kirganda, murabbiy ismi so'raladi va bazaga saqlanadi.
- Foydalanuvchi istalgan vaqt murabbiy ismini o'zgartirishi mumkin.

### 13.2. O'yin belgilash (admin tomonidan)
- Admin istalgan vaqtda, veb-admin panel orqali, API'dagi tayyor o'yinlar ro'yxatidan **bitta match**ni Mini Manager uchun faol o'yin qilib belgilaydi.
- Haftada bir nechta match belgilanishi mumkin.
- **Hafta hisobi:** Seshanba 12:00 dan keyingi Seshanba 11:59 gacha.

### 13.3. Foydalanuvchi ishtiroki
1. Admin belgilagan faol o'yin ustiga bosib kiradi.
2. Har ikki jamoa uchun alohida **taktika/sxema** tanlaydi. Barcha futboldagi taktikalar ro'yxati doim ochiq (masalan 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 3-4-3, 5-3-2, va h.k. — to'liq ro'yxat admin panelda boshqariladi, kengaytirilishi mumkin).
3. Tanlangan taktikaga mos **faqat asosiy tarkib** tanlanadi (zaxira yo'q). Futbolchilar ro'yxati — API'dagi shu ikkala klubning **haqiqiy, joriy tarkibidagi** o'yinchilari.
4. Har ikki klub uchun alohida (barchasi **ixtiyoriy**, "bo'lmaydi" deb ham belgilash mumkin):
   - 1 ta gol uruvchi futbolchi
   - 1 ta assist beruvchi futbolchi
   - 1 ta qizil karta oluvchi futbolchi
   - 1 ta sariq karta oluvchi futbolchi
5. Aniq hisobni taxmin qiladi.
6. G'olibni taxmin qiladi.
7. **[Saqlash]** — istalgan vaqt tahrirlash mumkin, ammo **o'yin real hayotda boshlangandan keyin taxmin qulflanadi** (tahrirlab bo'lmaydi).

### 13.4. Avtomatik hisoblash va ball tizimi
O'yin tugagach, bot API orqali natijani oladi va avtomatik hisoblaydi:

| Taxmin turi | Ball |
|---|---|
| 🏆 G'olibni to'g'ri topish | 10 ball |
| 🎯 Aniq hisobni to'g'ri topish (g'olib ball ustiga qo'shiladi) | 30 ball |
| ⚽ Gol urguvchini to'g'ri topish (har klub uchun alohida) | 15 ball |
| 🅰️ Assist beruvchini to'g'ri topish (har klub uchun) | 10 ball |
| 🟥 Qizil karta oluvchini to'g'ri topish (har klub uchun) | 10 ball |
| 🟨 Sariq karta oluvchini to'g'ri topish (har klub uchun) | 5 ball |
| 👥 Boshlang'ich tarkibdan haqiqatda o'ynagan har bir futbolchi (har klub, maks 11 tagacha) | 2 ball/futbolchi |

- "Bo'lmaydi" deb belgilangan bashorat, agar chindan ham bo'lmasa — **to'g'ri deb hisoblanadi** va mos ball beriladi.
- Haftada nechta o'yin bo'lsa, hammasi shu tarzda hisoblanadi va haftalik jamlanadi.

### 13.5. Leaderboard va sovrinlar
- Haftalik va oylik leaderboard avtomatik shakllanadi.
- Botda faqat **TOP 30** ko'rinadi; 30-o'rindan pastdagilarga faqat o'zining aniq o'rni ko'rsatiladi.
- **Faqat TOP 1** sovrin oladi (haftalik va oylik alohida-alohida).
- Sovrin — **matn + media** (rasm/video/animatsiya), admin veb-panel orqali qo'lda kiritadi, doimiy qat'iy qoida emas — har safar o'zgarishi mumkin.
- Sovrinlar bloki Web App'da kichik (reklama bannerdan kichikroq), agar bir nechta bo'lsa 15 soniyada avtomatik almashadi.

---

## 14. WEB APP — 🧠 Football Quiz bo'limi

**Muhim: bu bo'lim FAQAT Premium foydalanuvchilar uchun ishlaydi.** Oddiy foydalanuvchi kirishga urinsa: "💎 Bu bo'lim faqat Premium foydalanuvchilar uchun. Premium sotib oling" xabari va Premium sotib olish tugmasi chiqadi.

### 14.1. Savol mexanikasi
- Har **1 soatda 1 ta** yangi savol chiqadi, savollar bazasi **API orqali** avtomatik keladi.
- Har savol **4 variantli** (A/B/C/D).
- Javob berish uchun **15 soniya** vaqt beriladi (ekranda vaqt ko'rsatkichi/taymer bo'lishi kerak).

### 14.2. Ball tizimi
- **5 soniya ichida** to'g'ri javob → **2 ball**
- **5–15 soniya oralig'ida** to'g'ri javob → **1 ball**
- Noto'g'ri javob yoki 15 soniyada javob berilmasa → **0 ball**

### 14.3. Leaderboard va sovrinlar
- Hafta hisobi Mini Manager bilan bir xil: Seshanba 12:00 – Seshanba 11:59.
- Avtomatik haftalik va oylik leaderboard.
- **Faqat TOP 1** sovrin oladi (haftalik va oylik alohida) — matn + media, admin veb-panel orqali kiritadi.

---

## 15. WEB APP — 👤 Profil bo'limi

Botdagi Profil bilan asosan bir xil (read-only, Telegram'dan avtomatik: ism, username, ID), **qo'shimcha:**
- Mini Manager'da to'plangan ball/statistika (joriy hafta/oy, umumiy reyting o'rni)
- Football Quiz'da to'plangan ball/statistika (joriy hafta/oy, umumiy reyting o'rni)

---

## 16. BOT ADMIN PANEL (Telegram ichida, faqat admin/egaga ko'rinadi)

Asosiy menyuda qo'shimcha `🔒 Admin Panel` tugmasi orqali kiriladi. **Ega va admin — bir xil, to'liq huquqqa ega**, farq yo'q.

```
🔒 Admin Panel

[🔔 Majburiy obuna]       [💳 To'lov kartalari]
[✅ To'lov tasdiqlash]     [🎫 Promokodlar]
[👥 Referral sozlamalari]  [🎁 Bonus sozlamalari]
[❤️ Donat sozlamalari]     [📜 Qoidalar tahriri]
[💎 Tarif sozlamalari]     [🆘 Murojaatlar]
[❓ FAQ tahriri]           [👤 Adminlar]
[🔍 Foydalanuvchi qidirish/bloklash]
[🛠 Texnik ishlar (bot yopish)]
[📊 Statistika]            [📥 Foydalanuvchilar eksporti]
[📢 Xabar yuborish (Broadcast)]
```

Har bir band shu hujjatning tegishli bo'limida tasvirlangan sozlamalarni boshqaradi (masalan "💳 To'lov kartalari" — Balans to'ldirish va Donat uchun karta raqamlarini kiritish/tahrirlash; "🎫 Promokodlar" — 2.2-bo'limdagi maydonlar bilan yangi kod yaratish, va h.k.)

- **🛠 Texnik ishlar (bot yopish):** yoqilganda, oddiy foydalanuvchilar botga murojaat qilganda "🛠 Bot texnik ishlar tufayli vaqtincha ishlamayapti" degan xabar oladi, admin/ega esa bot bilan ishlashda davom etadi.
- **🔍 Foydalanuvchi qidirish/bloklash:** admin Telegram ID yoki username bo'yicha qidiradi, foydalanuvchi profilini ko'radi, xohlasa bloklaydi (bloklangan foydalanuvchi botdan foydalana olmaydi).
- **📊 Statistika:** jami foydalanuvchilar soni, bugungi yangi foydalanuvchilar, Premium sotib olganlar soni va h.k. (kengaytirilishi mumkin).
- **📥 Foydalanuvchilar eksporti:** barcha foydalanuvchilar ro'yxatini CSV/Excel fayl shaklida yuklab olish.

---

## 17. WEB APP ADMIN PANEL (veb-based, faqat admin/egaga ko'rinadi)

### 17.1. Kirish tizimi
- Agar admin Web App'ni **Telegram orqali** ochsa va uning Telegram ID'si admin/ega ro'yxatida bo'lsa → admin panel **avtomatik** ko'rinadi (qo'shimcha login shart emas).
- Agar admin **oddiy brauzerdan** (kompyuterdan, Telegram tashqarisida) kirmoqchi bo'lsa → **login + parol** orqali kirish imkoniyati ham bo'ladi.

### 17.2. Bo'limlar
```
🔒 Web App Admin Panel

[🎬 Banner boshqaruvi]
[🎮 Mini Manager — o'yin belgilash]
[🏆 Mini Manager — sovrin (haftalik/oylik)]
[🏆 Quiz — sovrin (haftalik/oylik)]
[📊 Statistika]
```

- **🎬 Banner boshqaruvi:** video/animatsiya/rasm yuklash, ko'rinish davomiyligi (soniya), havola (ixtiyoriy, yashirin) qo'shish/o'chirish, bir nechtasini boshqarish.
- **🎮 Mini Manager — o'yin belgilash:** API'dagi tayyor o'yinlar ro'yxatidan bitta matchni tanlash (13.2-bo'lim).
- **🏆 Sovrin bo'limlari:** matn + media (rasm/video/animatsiya) kiritish, haftalik va oylik uchun alohida.
- **📊 Statistika:**
  - Web App kunlik tashrif soni
  - Mini Manager qatnashchilar soni
  - Quiz javob berganlar soni
  - Premium foydalanuvchilar soni (jami + kunlik yangi)
  - TOP faol foydalanuvchilar (Mini Manager + Quiz bo'yicha)

---

## 18. Ma'lumotlar bazasi — asosiy jadvallar (taxminiy tuzilma)

```
users: id, telegram_id, username, first_name, language, balance, points_manager, points_quiz,
       tariff (free|premium), premium_expires_at, registered_at, is_blocked, is_admin

promo_codes: id, code, type, value, max_uses, used_count, starts_at, expires_at, status
promo_code_uses: id, promo_code_id, user_id, used_at

referrals: id, referrer_id, referred_id, is_active, activated_at

donations: id, user_id, amount, card_type, receipt_image, comment, status (pending|approved|rejected),
           reject_reason, is_anonymous, announced_in_channel, created_at

balance_topups: id, user_id, amount, card_type, receipt_image, status, reject_reason, created_at

bonuses_log: id, user_id, amount, claimed_at

mini_manager_games: id, api_match_id, week_start, week_end, status (upcoming|locked|finished)
mini_manager_predictions: id, user_id, game_id, coach_name, tactic_home, tactic_away, lineup_home,
                          lineup_away, scorer_home, scorer_away, assist_home, assist_away,
                          red_card_home, red_card_away, yellow_card_home, yellow_card_away,
                          predicted_score_home, predicted_score_away, predicted_winner,
                          points_earned, is_locked

quiz_questions: id, question, option_a, option_b, option_c, option_d, correct_option
quiz_answers: id, user_id, question_id, selected_option, response_time_seconds, points_earned, answered_at

support_tickets: id, user_id, message, admin_reply, status (pending|answered), created_at

settings: key, value   -- (majburiy obuna ON/OFF, tariflar narxi, limitlar va h.k. shu yerda saqlanadi)
```

---

## 19. Dizayn tizimi (Web App UI)

- **Fon:** #0c1712 (qora-yashil, chuqur)
- **Karta yuzasi:** #16241d
- **Ikkinchi darajali yuza:** #1e3226
- **Chegara:** #2a3f31
- **Asosiy aksent (yashil):** #2ecc71 — faol holat, live, CTA, tanlangan tab
- **Ikkinchi aksent (sariq):** #f2c94c — sovrin, ball, reyting
- **Matn:** #f3f7f4 (asosiy), #7d9284 (ikkinchi darajali)
- **Shrift:** Inter (400/500/600/700/800 og'irliklar)
- **Kartalar:** border-radius 16px, gradientsiz, tekis ranglar
- **Navigatsiya:** pastda doimiy 4 tabli bar (Home / Manager / Quiz / Profil), faol tab yashil rangda
- **Qulflangan (Oddiy tarif) elementlar:** xiralashtirilgan (opacity ~0.4) + qulf ikonkasi

Ushbu dizayn ko'k rang va gradientlardan qochadi (bet-ilovalarga o'xshab ketmasligi uchun maxsus tanlangan) — barcha yangi ekranlar/komponentlar shu tizimga mos qurilishi shart.

---

## 20. Umumiy qoidalar (har doim amal qiladi)

1. Botning **har bir** javobi/xabari mos emoji bilan boshlanadi.
2. Barcha matnlar **4 tilda** (O'zbek lotin, O'zbek kirill, Rus, Ingliz) tayyorlanadi va foydalanuvchining saqlangan tiliga qarab ko'rsatiladi.
3. Barcha admin tomonidan sozlanadigan qiymatlar (narxlar, limitlar, min-max summalar, matnlar) kodda qattiq yozilmaydi — bazadan/admin paneldan o'qiladi.
4. Pul va to'lovga oid har qanday amal (balans to'ldirish, donat) — chek tasdiqlanmaguncha balans/status o'zgarmaydi, faqat admin tasdiqlagandan keyin.
5. Barcha vaqt-asosli hisoblar (hafta, limit, bonus) — bitta aniq vaqt zonasida (masalan Asia/Tashkent) ishlaydi, kodda shu aniq belgilansin.

---

Shu hujjat — loyihaning to'liq va yakuniy texnik topshirig'i. Kodni yozishda har bir bandni ketma-ket amalga oshiring, hech qaysi qoidani o'zgartirmang yoki soddalashtirmang.

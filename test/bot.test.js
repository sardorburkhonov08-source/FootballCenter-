const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');

const OWNER = 1000;
const U = 2001;
let h;

test.before(async () => {
  await resetDb();
  h = createTestBot();
  await settings.set('cards_topup', { humo: { number: '8600123412341234', holder: 'Ali Valiyev' } });
  await settings.set('donation_channel_id', '@fc_donations');
});
test.after(async () => { await db.pool.end(); });

async function user(id) { return db.one('SELECT * FROM users WHERE telegram_id = $1', [id]); }

test('/start: til tanlash faqat birinchi marta, keyin menyu', async () => {
  await h.text(OWNER, '/start');
  await h.click(OWNER, 'lang:uz');
  h.clear();
  await h.text(U, '/start');
  assert.match(h.lastText(U), /O'zingizga qulay tilni tanlang 🇺🇿[\s\S]*Choose the language you like 🇺🇸/);
  assert.deepStrictEqual(h.buttons().map((b) => b.callback_data), ['lang:uz', 'lang:uz_cyrl', 'lang:ru', 'lang:en']);
  await h.click(U, 'lang:ru');
  assert.strictEqual((await user(U)).language, 'ru');
  assert.match(h.lastText(U), /^🏠 Главное меню/);
  const btns = h.buttons();
  assert.ok(btns.some((b) => b.web_app && b.web_app.url === 'https://fc.example.com/app/'), 'web_app tugmasi');
  assert.ok(!btns.some((b) => b.callback_data === 'm:admin'), "oddiy foydalanuvchida admin tugmasi yo'q");
  h.clear();
  await h.text(U, '/start');
  assert.match(h.lastText(U), /^🏠 Главное меню/);
  await h.click(U, 'lang:uz');
});

test('admin (ega) menyusida 🔒 Admin Panel bor', async () => {
  h.clear();
  await h.text(OWNER, '/start');
  assert.ok(h.buttons().some((b) => b.callback_data === 'm:admin'));
  await h.click(OWNER, 'm:admin');
  assert.match(h.lastText(OWNER), /^🔒 Admin Panel/);
  await h.click(U, 'm:admin');
  assert.doesNotMatch(h.lastText(U) || '', /Admin Panel\n/);
});

test("majburiy obuna: a'zo bo'lmaguncha o'tkazilmaydi", async () => {
  await settings.set('force_sub_enabled', true);
  await settings.set('force_sub_channels', [{ chat_id: '@fc_channel', title: 'FC Channel', url: 'https://t.me/fc_channel' }]);
  let status = 'left';
  h.overrides.getChatMember = () => ({ status, user: { id: U } });
  h.clear();
  await h.text(U, '/start');
  assert.match(h.lastText(U), /^📢/);
  assert.ok(h.buttons().some((b) => b.url === 'https://t.me/fc_channel'));
  await h.click(U, 'sub:check');
  assert.match(h.lastText(U), /^❌ Siz hali barcha kanallarga/);
  status = 'member';
  await h.click(U, 'sub:check');
  assert.match(h.lastText(U), /^🏠 Asosiy menyu/);
  delete h.overrides.getChatMember;
  await settings.set('force_sub_enabled', false);
});

test("balans to'ldirish: summa -> chek -> admin tasdiqlaydi", async () => {
  h.clear();
  await h.click(U, 'm:balance');
  assert.match(h.lastText(U), /^💰 Balans\nJoriy balans: 0 so'm/);
  await h.click(U, 'bal:topup');
  await h.click(U, 'tp:card:visa');
  assert.match(h.alerts().pop(), /mavjud emas/);
  await h.click(U, 'tp:card:humo');
  assert.match(h.lastText(U), /<code>8600 1234 1234 1234<\/code>[\s\S]*Ali Valiyev/);
  await h.text(U, '50 ming');
  assert.match(h.lastText(U), /^⚠️ Iltimos, summani faqat raqam/);
  await h.text(U, '50 000');
  assert.match(h.lastText(U), /^🧾/);
  await h.text(U, 'rasm emas');
  assert.match(h.lastText(U), /^⚠️ Iltimos, chekni rasm/);
  h.clear();
  await h.photo(U);
  assert.match(h.lastText(U), /^⏳ To'lovingiz adminga yuborildi/);
  const toAdmin = h.calls.find((c) => c.method === 'sendPhoto' && c.payload.chat_id === OWNER);
  assert.ok(toAdmin, 'admin chek rasmini oldi');
  assert.strictEqual(toAdmin.payload.photo, `receipt_${U}`);
  const approve = toAdmin.payload.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(approve, /^adm:tp:ok:\d+$/);
  assert.strictEqual(Number((await user(U)).balance), 0, 'tasdiqlanmaguncha balans o\'zgarmaydi');

  // Oddiy foydalanuvchi admin tugmasini bosa olmaydi
  await h.click(U, approve, { caption: 'x' });
  assert.strictEqual(Number((await user(U)).balance), 0);

  h.clear();
  await h.click(OWNER, approve, { caption: 'cap' });
  assert.strictEqual(Number((await user(U)).balance), 50000);
  assert.match(h.lastText(U), /^✅ To'lovingiz tasdiqlandi, balansingizga 50 000 so'm qo'shildi/);
  await h.click(OWNER, approve, { caption: 'cap' });
  assert.match(h.alerts().pop(), /allaqachon/);
  assert.strictEqual(Number((await user(U)).balance), 50000, 'ikki marta qo\'shilmaydi');
});

test("to'lovni rad etish sabab bilan", async () => {
  await h.click(U, 'tp:card:humo');
  await h.text(U, '1000');
  h.clear();
  await h.photo(U);
  const reject = h.calls.find((c) => c.method === 'sendPhoto').payload.reply_markup.inline_keyboard[0][1].callback_data;
  await h.click(OWNER, reject, { caption: 'cap' });
  await h.text(OWNER, 'Chek noaniq');
  assert.match(h.lastText(U), /^❌ To'lovingiz rad etildi\. Sabab: Chek noaniq/);
  assert.strictEqual(Number((await user(U)).balance), 50000);
});

test('promokod: barcha tekshiruvlar va bonus', async () => {
  const promo = require('../src/services/promo');
  const now = Date.now();
  await promo.create({ code: 'FOOTBALL2026', type: 'premium', value: 30, maxUses: 1, startsAt: new Date(now - 1000), expiresAt: new Date(now + 86400000) });
  await promo.create({ code: 'OLD', type: 'balance', value: 100, maxUses: 5, startsAt: new Date(now - 2e8), expiresAt: new Date(now - 1e8) });
  await promo.create({ code: 'SOON', type: 'balance', value: 100, maxUses: 5, startsAt: new Date(now + 1e8), expiresAt: new Date(now + 2e8) });
  await promo.create({ code: 'CASH', type: 'balance', value: 700, maxUses: 5, startsAt: new Date(now - 1000), expiresAt: new Date(now + 1e8) });
  const tryCode = async (uid, code) => { await h.click(uid, 'bal:promo'); await h.text(uid, code); return h.lastText(uid); };
  assert.strictEqual(await tryCode(U, 'NOPE'), '❌ Bunday kod topilmadi');
  assert.strictEqual(await tryCode(U, 'OLD'), "⏰ Bu kodning muddati o'tgan");
  assert.strictEqual(await tryCode(U, 'SOON'), '🚫 Bu kod hali faol emas / to\'xtatilgan');
  assert.match(await tryCode(U, 'football2026'), /^✅ Promo-kod muvaffaqiyatli faollashtirildi!\n🎁 Sizga 30 kun Premium berildi\.\n📅 Amal qilish muddati: \d\d\.\d\d\.\d{4} gacha\./);
  assert.strictEqual(await tryCode(U, 'FOOTBALL2026'), '📛 Limit tugagan');
  assert.match(await tryCode(U, 'CASH'), /700 so'm balansga qo'shildi/);
  assert.strictEqual(await tryCode(U, 'CASH'), '⚠️ Siz bu kodni allaqachon ishlatgansiz');
  const u = await user(U);
  assert.ok(new Date(u.premium_expires_at) > new Date(Date.now() + 29 * 86400000));
  assert.strictEqual(Number(u.balance), 50700);
});

test('bonus: Premium — 12 soatda 1 marta, keyingisi vaqti ko\'rsatiladi', async () => {
  await h.click(U, 'bal:bonus');
  const first = h.lastText(U);
  const m = first.match(/^🎁 Tabriklaymiz! Sizga (\d+) so'm bonus berildi/);
  assert.ok(m, first);
  assert.ok(Number(m[1]) >= 300 && Number(m[1]) <= 1000, 'Premium oralig\'i');
  await h.click(U, 'bal:bonus');
  assert.match(h.lastText(U), /^⏳ Keyingi bonusingiz 1[12] soat \d+ daqiqadan keyin/);
});

test("premium sotib olish: mablag' yetmasa va yetsa", async () => {
  const P = 2002;
  await h.text(P, '/start');
  await h.click(P, 'lang:uz');
  await h.click(P, 'tf:buy');
  assert.strictEqual(h.lastText(P), "😔 Kechirasiz, balansingizda mablag' yetarli emas. Hisobingizni to'ldiring.");
  await db.query('UPDATE users SET balance = 40000 WHERE telegram_id = $1', [P]);
  await h.click(P, 'tf:buy');
  assert.match(h.lastText(P), /^✅ Premium faollashtirildi! Balansdan 30 000 so'm yechildi\. Amal qilish muddati: \d\d\.\d\d\.\d{4}gacha/);
  assert.strictEqual(Number((await user(P)).balance), 10000);
});

test("bildirishnomalar: Oddiy uchun qulflangan, Premium o'zgartira oladi", async () => {
  const F = 2003;
  await h.text(F, '/start');
  await h.click(F, 'lang:en');
  await h.click(F, 'nt:quiz_new');
  assert.strictEqual(h.alerts().pop(), '💎 This notification is for Premium users only. Get Premium.');
  await h.click(F, 'nt:news');
  assert.match(h.alerts().pop(), /always on/);
  await h.click(U, 'nt:quiz_new');
  assert.strictEqual((await user(U)).notify.quiz_new, false);
  await h.click(U, 'nt:payment');
  assert.match(h.alerts().pop(), /doimiy yoqilgan/);
});

test("donat: to'liq oqim, birinchi donat, e'lon qilish", async () => {
  const D = 2004;
  await h.text(D, '/start');
  await h.click(D, 'lang:uz');
  await h.click(D, 'm:donate');
  await h.click(D, 'dn:card:humo');
  assert.match(h.lastText(D), /8600 1234 1234 1234/, 'donat kartasi yo\'q bo\'lsa balans kartasi');
  await h.text(D, '60000');
  assert.match(h.lastText(D), /^💵 Donat summasi: 60 000 so'm/);
  await h.click(D, 'dn:amt_ok');
  await h.photo(D);
  assert.match(h.lastText(D), /^💬 Izoh yozishni/);
  await h.click(D, 'dn:cmt');
  await h.text(D, 'x'.repeat(201));
  assert.match(h.lastText(D), /201\/200/);
  await h.text(D, 'Omad! <b>');
  assert.match(h.lastText(D), /💬 Izoh: Omad! &lt;b&gt;/);
  h.clear();
  await h.click(D, 'dn:send');
  const toAdmin = h.calls.find((c) => c.method === 'sendPhoto' && c.payload.chat_id === OWNER);
  assert.ok(toAdmin);
  h.clear();
  await h.click(OWNER, toAdmin.payload.reply_markup.inline_keyboard[0][0].callback_data, { caption: 'c' });
  const msgs = h.texts(D);
  assert.match(msgs[0], /^👑 User2004, siz FootballCenterning faxriy donorisiz!/);
  assert.match(msgs[1], /^💚 User2004, donat uchun katta rahmat!/);
  const ann = h.buttons().find((b) => b.callback_data.startsWith('dn:ann:yes'));
  h.clear();
  await h.click(D, ann.callback_data);
  const post = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === '@fc_donations');
  assert.ok(post, 'kanalga post');
  assert.match(post.payload.text, /^❤️ Faxriy donor!🩵\n\n👤 Foydalanuvchi: User2004\n💰 Donat miqdori: 60 000 so'm\n💬 Izoh: Omad! &lt;b&gt;/);
  await h.click(D, ann.callback_data.replace('yes', 'anon'));
  assert.strictEqual(h.calls.filter((c) => c.payload.chat_id === '@fc_donations').length, 1, 'faqat bir marta');

  // Ikkinchi donat -> "siz yana biz bilan", javobsiz qolsa avtomatik anonim
  await h.click(D, 'dn:card:humo');
  await h.text(D, '1000');
  await h.click(D, 'dn:amt_ok');
  await h.photo(D);
  await h.click(D, 'dn:skip');
  h.clear();
  await h.click(D, 'dn:send');
  const second = h.calls.find((c) => c.method === 'sendPhoto' && c.payload.chat_id === OWNER).payload.reply_markup.inline_keyboard[0][0].callback_data;
  h.clear();
  await h.click(OWNER, second, { caption: 'c' });
  assert.match(h.texts(D)[0], /^💎 User2004, siz yana biz bilan!/);
  await db.query("UPDATE donations SET announce_deadline = now() - interval '1 minute' WHERE is_anonymous IS NULL");
  h.clear();
  await require('../src/services/donations').processExpired(h.bot.api);
  const anonPost = h.calls.find((c) => c.payload.chat_id === '@fc_donations');
  assert.match(anonPost.payload.text, /👤 Foydalanuvchi: Anonim/);
  assert.doesNotMatch(anonPost.payload.text, /Izoh/);
  assert.match(h.lastText(D), /^⏰ Javob muddati tugagan/);
});

test("yordam: murojaat adminga, admin javobi foydalanuvchiga", async () => {
  await h.click(U, 'hp:write');
  h.clear();
  await h.text(U, 'Bonus ishlamayapti');
  const adminMsg = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === OWNER);
  assert.match(adminMsg.payload.text, /Bonus ishlamayapti/);
  await h.click(OWNER, adminMsg.payload.reply_markup.inline_keyboard[0][0].callback_data);
  await h.text(OWNER, 'Tuzatildi');
  assert.strictEqual(h.lastText(U), "✅ Muammongizga javob berildi:\nTuzatildi\n\nMuammo haqida ogohlantirganingiz uchun rahmat!");
});

test('AI: kalit yo\'q bo\'lsa — xato emas, "ishlamayapti"; limit hisoblanmaydi', async () => {
  await h.click(U, 'm:ai');
  assert.match(h.lastText(U), /📊 Kunlik qolgan so'rov: 10 ta/);
  await h.click(U, 'ai:ask');
  await h.text(U, 'Offsayd nima?');
  assert.match(h.lastText(U), /^⚠️ AI yordamchi hozircha ishlamayapti/);
});

test('admin: sozlama o\'zgartirish, promokod yaratish, texnik ishlar, bloklash', async () => {
  await h.click(OWNER, 'a:bonus');
  await h.click(OWNER, 'as:bonus:bonus_free_min');
  await h.text(OWNER, '9999');
  assert.strictEqual(h.lastText(OWNER), "⚠️ Minimum maksimumdan katta bo'lmasligi kerak.");
  await h.text(OWNER, '200');
  assert.strictEqual(await settings.get('bonus_free_min'), 200);

  await h.click(OWNER, 'pc:new');
  await h.text(OWNER, 'VIP1');
  await h.click(OWNER, 'pc:type:balance');
  await h.text(OWNER, '5000');
  await h.text(OWNER, '10');
  await h.text(OWNER, '01.01.2026');
  await h.text(OWNER, '31.12.2025');
  assert.match(h.lastText(OWNER), /Tugash sanasi/);
  await h.text(OWNER, '31.12.2030');
  await h.click(OWNER, 'pc:po:1');
  const p = await db.one("SELECT * FROM promo_codes WHERE code = 'VIP1'");
  assert.strictEqual(p.premium_only, true);
  assert.strictEqual(p.value, 5000);
  const F = 2003;
  await h.click(F, 'bal:promo');
  await h.text(F, 'vip1');
  assert.strictEqual(h.lastText(F), '💎 This code is for Premium users only');

  await h.click(OWNER, 'as:maintenance:maintenance_mode');
  await h.text(F, 'hello');
  assert.strictEqual(h.lastText(F), '🛠 The bot is temporarily unavailable due to maintenance');
  await h.click(OWNER, 'as:maintenance:maintenance_mode');

  await h.click(OWNER, 'a:users');
  await h.text(OWNER, '@user2003');
  assert.match(h.lastText(OWNER), /🆔 <code>2003<\/code>/);
  await h.click(OWNER, 'us:b:2003');
  await h.text(F, 'hello');
  assert.strictEqual(h.lastText(F), '🚫 You are blocked and cannot use the bot.');
  await h.click(OWNER, 'us:u:2003');
});

test('admin: qoida matni, FAQ (kirill avtomatik), eksport, broadcast', async () => {
  await h.click(OWNER, 'ar:rules:general:uz');
  await h.text(OWNER, 'Hurmat bilan muomala qiling.');
  await h.click(U, 'rule:general');
  assert.strictEqual(h.lastText(U), '📋 Umumiy qoidalar\n\nHurmat bilan muomala qiling.');
  await h.click(U, 'rule:privacy');
  assert.match(h.lastText(U), /hali kiritilmagan/);

  await h.click(OWNER, 'fq:add');
  await h.text(OWNER, "Bonus qanday olinadi?");
  await h.click(OWNER, 'fq:skip');
  await h.text(OWNER, 'Как получить бонус?');
  await h.click(OWNER, 'fq:skip');
  await h.text(OWNER, "Balans bo'limida");
  await h.click(OWNER, 'fq:skip');
  await h.click(OWNER, 'fq:skip');
  await h.click(OWNER, 'fq:skip');
  const f = await db.one('SELECT * FROM faq');
  assert.strictEqual(f.q_uz_cyrl, 'Бонус қандай олинади?');
  assert.strictEqual(f.q_ru, 'Как получить бонус?');
  await h.click(2003, 'hp:faq');
  assert.match(h.lastText(2003), /<b>1\. Bonus qanday olinadi\?<\/b>\nBalans bo'limida/);

  h.clear();
  await h.click(OWNER, 'a:export');
  const doc = h.calls.find((c) => c.method === 'sendDocument');
  assert.ok(doc, 'CSV yuborildi');

  await h.click(U, 'nt:news');
  assert.strictEqual((await user(U)).notify.news, false);
  await h.click(OWNER, 'a:broadcast');
  await h.text(OWNER, '📢 Yangilik!');
  assert.match(h.lastText(OWNER), /^📢 Shu xabar \d+ ta foydalanuvchiga/);
  h.clear();
  await h.click(OWNER, 'bc:go');
  await new Promise((r) => setTimeout(r, 600));
  const copies = h.calls.filter((c) => c.method === 'copyMessage').map((c) => c.payload.chat_id);
  assert.ok(copies.includes(2003));
  assert.ok(!copies.includes(U), "yangiliklarni o'chirgan Premium'ga yuborilmaydi");
});

// 💎 Premium tarifini admin o'chirsa: hamma funksiyalar bepul, sotuv va bepul Premium berish to'xtaydi
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const users = require('../src/services/users');
const premium = require('../src/services/premium');
const promo = require('../src/services/promo');

let h;
let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `P${id}` }, process.env.BOT_TOKEN)}` });
const call = async (path, id) => { const r = await fetch(`${base}/api${path}`, { headers: auth(id) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [1000, 9301]) { await h.text(tg, '/start'); await h.click(tg, 'lang:uz'); }
  await db.query('UPDATE users SET balance = 100000 WHERE telegram_id = 9301');
});
test.after(async () => { server.close(); await db.pool.end(); });

test("standart holat: Premium yoqilgan, oddiy foydalanuvchi qulflangan", async () => {
  assert.strictEqual(users.isPremium(await user(9301)), false);
  assert.strictEqual((await call('/penalty', 9301)).status, 402);
});

test("admin o'chiradi → hammasi bepul; sotuv, Stars, sovg'a, promokod va sovg'a Premium to'xtaydi; qayta yoqiladi", async () => {
  // Bot admin → 💎 Tarif sozlamalari → 🔁 Premium tarifi
  await h.click(1000, 'a:tariff');
  assert.ok(h.buttons().some((b) => b.callback_data === 'as:tariff:premium_enabled'));
  await h.click(1000, 'as:tariff:premium_enabled');
  assert.strictEqual(await settings.get('premium_enabled'), false);

  const u = await user(9301);
  assert.strictEqual(users.isPremium(u), true, 'hamma Premium funksiyalari ochiq');
  const me = (await call('/me', 9301)).body.user;
  assert.deepStrictEqual([me.premium, me.premiumFree], [true, true]);
  assert.strictEqual((await call('/penalty', 9301)).status, 200);

  // Bot: tarif bo'limi — "hammasi bepul", sotib olish yo'q, balans o'zgarmaydi
  h.clear();
  await h.click(9301, 'm:tariff');
  assert.ok(h.lastText(9301).startsWith('🎉 <b>Hozir barcha funksiyalar bepul!</b>'));
  await h.click(9301, 'tf:buy:week');
  assert.ok(h.lastText(9301).startsWith('🎉'));
  assert.strictEqual(Number((await user(9301)).balance), 100000);
  assert.deepStrictEqual(await premium.starPlans(), {});
  assert.strictEqual((await premium.gift(u, (await user(1000)).id, 'week')).reason, 'off');
  await h.click(9301, 'm:profile');
  assert.ok(h.lastText(9301).includes('🎉 Hammasi bepul'));

  // Premium promokod ishlamaydi
  await promo.create({ code: 'FREEPREM', type: 'premium', value: 7, maxUses: 5, startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86400000) });
  assert.strictEqual((await promo.redeem(u, 'FREEPREM')).key, 'promo_premium_off');

  // Yangi foydalanuvchiga sovg'a Premium berilmaydi
  await settings.set('welcome_premium_days', 3);
  await h.text(9302, '/start');
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM premium_purchases WHERE source = 'welcome'")).n, 0);
  await settings.set('welcome_premium_days', 0);

  // Qayta yoqiladi — oddiy holat qaytadi
  await h.click(1000, 'as:tariff:premium_enabled');
  assert.strictEqual(await settings.get('premium_enabled'), true);
  assert.strictEqual(users.isPremium(await user(9301)), false);
  assert.strictEqual((await call('/penalty', 9301)).status, 402);
});

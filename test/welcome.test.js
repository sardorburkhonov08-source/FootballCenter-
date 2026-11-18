// 🎁 Yangi foydalanuvchiga sovg'a Premium
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');

let h;
let server;
let base;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);
const daysLeft = (u) => (new Date(u.premium_expires_at).getTime() - Date.now()) / 86400000;

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test("botga yangi kirgan foydalanuvchi 3 kunlik Premium oladi va til tanlagach xabar keladi", async () => {
  await settings.set('welcome_premium_days', 3);
  await h.text(8801, '/start');
  const u = await user(8801);
  assert.ok(daysLeft(u) > 2.9 && daysLeft(u) <= 3, `qolgan kun: ${daysLeft(u)}`);
  assert.strictEqual(u.tariff, 'premium');
  const log = await db.one("SELECT * FROM premium_purchases WHERE user_id = $1 AND source = 'welcome'", [u.id]);
  assert.deepStrictEqual([log.days, Number(log.amount)], [3, 0]);
  h.clear();
  await h.click(8801, 'lang:uz');
  assert.ok(h.texts(8801).some((x) => /^🎁 Xush kelibsiz! Sizga <b>3 kunlik Premium<\/b> sovg'a qilindi/.test(x)));
  // Til qayta almashtirilsa — xabar takrorlanmaydi, Premium qayta berilmaydi
  h.clear();
  await h.click(8801, 'lang:ru');
  assert.ok(!h.texts(8801).some((x) => x.startsWith('🎁')));
  await h.text(8801, '/start');
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM premium_purchases WHERE user_id = $1", [u.id])).n, 1);
});

test("Mini App orqali birinchi kirganda ham beriladi; 0 kun — o'chiq", async () => {
  const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'Ali' }, process.env.BOT_TOKEN)}` });
  await fetch(`${base}/api/me`, { headers: auth(8802) });
  assert.ok(daysLeft(await user(8802)) > 2.9);
  await settings.set('welcome_premium_days', 0);
  await h.text(8803, '/start');
  assert.strictEqual((await user(8803)).premium_expires_at, null);
});

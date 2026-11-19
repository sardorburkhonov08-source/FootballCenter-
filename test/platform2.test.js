// ⭐ Telegram Stars bilan Premium, 🚨 adminlarga xato xabarlari, 📈 web admin grafiklari (DAU, retention)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const alerts = require('../src/services/alerts');
const activity = require('../src/services/activity');

let h;
let server;
let base;
let upd = 9000;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);
const from = (id) => ({ id, is_bot: false, first_name: `User${id}`, username: `user${id}`, language_code: 'uz' });

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

async function preCheckout(tg, payload, total) {
  await h.bot.handleUpdate({ update_id: upd++, pre_checkout_query: { id: `pc${upd}`, from: from(tg), currency: 'XTR', total_amount: total, invoice_payload: payload } });
  return h.calls.filter((c) => c.method === 'answerPreCheckoutQuery').pop().payload;
}
async function paid(tg, payload, total, charge) {
  await h.bot.handleUpdate({ update_id: upd++, message: { message_id: upd, date: Math.floor(Date.now() / 1000), chat: { id: tg, type: 'private' }, from: from(tg),
    successful_payment: { currency: 'XTR', total_amount: total, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' } } });
}

test("⭐ Stars: narx 0 bo'lsa tugma yo'q; admin narx qo'ysa — hisob-faktura, tekshiruv, Premium bir marta", async () => {
  await h.text(7101, '/start');
  await h.click(7101, 'lang:uz');
  h.clear();
  await h.click(7101, 'tf:premium');
  assert.ok(!h.buttons().some((b) => (b.callback_data || '').startsWith('tf:stars')));

  await settings.set('premium_week_stars', 150);
  await settings.set('premium_month_stars', 400);
  h.clear();
  await h.click(7101, 'tf:premium');
  const btns = h.buttons().filter((b) => (b.callback_data || '').startsWith('tf:stars'));
  assert.deepStrictEqual(btns.map((b) => b.text), ['⭐ 7 kun — 150 Stars', '⭐ 30 kun — 400 Stars']);

  h.clear();
  await h.click(7101, 'tf:stars:week');
  const inv = h.calls.find((c) => c.method === 'sendInvoice').payload;
  assert.strictEqual(inv.currency, 'XTR');
  assert.deepStrictEqual(inv.prices.map((p) => p.amount), [150]);
  const u = await user(7101);
  assert.strictEqual(inv.payload, `prem:week:${u.id}:150`);

  // Boshqa foydalanuvchi yoki boshqa summa — rad etiladi
  assert.strictEqual((await preCheckout(7102, inv.payload, 150)).ok, false);
  assert.strictEqual((await preCheckout(7101, inv.payload, 100)).ok, false);
  assert.strictEqual((await preCheckout(7101, inv.payload, 150)).ok, true);
  // Narx o'zgarsa eski hisob-faktura rad etiladi
  await settings.set('premium_week_stars', 200);
  assert.strictEqual((await preCheckout(7101, inv.payload, 150)).ok, false);
  await settings.set('premium_week_stars', 150);

  h.clear();
  await paid(7101, inv.payload, 150, 'ch_1');
  const after = await user(7101);
  const left = (new Date(after.premium_expires_at) - Date.now()) / 86400000;
  assert.ok(left > 6.9 && left <= 7, `qolgan kun: ${left}`);
  assert.ok(/^✅ Premium faollashtirildi! 150 ⭐/.test(h.lastText(7101)));
  // Telegram bir to'lovni qayta yuborsa — ikkinchi marta berilmaydi
  await paid(7101, inv.payload, 150, 'ch_1');
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM premium_purchases WHERE user_id = $1 AND source = 'stars'", [u.id])).n, 1);
  assert.strictEqual((await db.one('SELECT stars FROM star_payments WHERE charge_id = $1', ['ch_1'])).stars, 150);
});

test("🚨 xato xabari adminga bir marta (takror oralig'ida), o'chirilsa yuborilmaydi", async () => {
  await h.text(1000, '/start');
  await h.click(1000, 'lang:uz');
  alerts.reset();
  h.clear();
  assert.strictEqual(await alerts.report('job:quiz', 'boom <x>'), true);
  const msg = h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 1000).pop().payload.text;
  assert.ok(msg.startsWith('🚨 <b>Fon vazifasida xatolik</b>'), msg);
  assert.ok(msg.includes('boom &lt;x&gt;'));
  assert.strictEqual(await alerts.report('job:quiz', 'boom again'), false);
  assert.strictEqual(await alerts.report('db_slow', 'slow'), true);
  await settings.set('alerts_enabled', false);
  assert.strictEqual(await alerts.report('web', 'x'), false);
  await settings.set('alerts_enabled', true);

  // Bot handlerida xato — adminga xabar
  alerts.reset();
  h.overrides.editMessageText = () => { throw new Error('kutilmagan xato'); };
  h.overrides.sendMessage = (p) => { if (p.chat_id === 7101) throw new Error('kutilmagan xato'); return { message_id: 1, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text }; };
  h.clear();
  await h.click(7101, 'm:rules');
  delete h.overrides.editMessageText;
  delete h.overrides.sendMessage;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(h.texts(1000).some((x) => x.startsWith('🚨 <b>Botda xatolik</b>')), JSON.stringify(h.texts(1000)));

  // Sekin baza: chegaradan sekin — xabar (testda chegara manfiy)
  alerts.reset();
  await settings.set('alerts_db_slow_ms', -1);
  h.clear();
  await alerts.checkDb();
  assert.ok(h.texts(1000).some((x) => x.startsWith('🚨 <b>Baza sekin ishlayapti</b>')));
  await settings.set('alerts_db_slow_ms', 2000);
});

test('📈 grafiklar: DAU, yangi foydalanuvchilar, D1 retention, Premium manbalari', async () => {
  activity.reset();
  await db.query('DELETE FROM daily_active');
  await h.text(7101, '/menu');
  await new Promise((r) => setTimeout(r, 50));
  const u = await user(7101);
  assert.ok(await db.one('SELECT 1 FROM daily_active WHERE user_id = $1', [u.id]));
  // Kecha ro'yxatdan o'tgan va bugun qaytgan foydalanuvchi — D1 100%
  await h.text(7103, '/start');
  const v = await user(7103);
  await db.query("UPDATE users SET registered_at = now() - interval '1 day' WHERE id = $1", [v.id]);
  activity.reset();
  await h.text(7103, '/menu');
  await new Promise((r) => setTimeout(r, 50));

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'secret' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const res = await fetch(`${base}/api/admin/stats/charts?days=7`, { headers: { Cookie: cookie } });
  assert.strictEqual(res.status, 200);
  const c = await res.json();
  assert.strictEqual(c.dates.length, 7);
  assert.ok(c.dau[6] >= 2, `DAU: ${c.dau}`);
  assert.ok(c.newUsers[5] >= 1);
  assert.strictEqual(c.retention[5].d1, 100);
  assert.strictEqual(c.retention[6].d1, null);
  assert.strictEqual(c.premium.stars[6], 1);
  assert.deepStrictEqual(c.stars, { stars: 150, payments: 1 });
  assert.deepStrictEqual(Object.keys(c.plays), ['manager', 'quiz', 'score', 'duel', 'penalty', 'crossbar', 'keepy', 'quest']);
});

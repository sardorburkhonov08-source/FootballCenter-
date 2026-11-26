// ⭐ Admin points qo'shadi / olib tashlaydi; 🏆 g'olib lichkasi adminga
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot } = require('./helpers');
const users = require('../src/services/users');
const leaderboard = require('../src/services/leaderboard');
const pointsAdmin = require('../src/services/pointsAdmin');

let h;
let server;
let base;
const ADMIN = 1000;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  h = createTestBot();
  for (const tg of [ADMIN, 9701, 9702]) { await h.text(tg, '/start'); await h.click(tg, 'lang:uz'); }
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test("⭐ bot admin: foydalanuvchi kartasidan points qo'shish va olib tashlash (0 dan pastga tushmaydi), foydalanuvchiga xabar", async () => {
  await h.click(ADMIN, 'a:users');
  await h.text(ADMIN, '9701');
  assert.ok(h.lastText(ADMIN).includes('⭐ Points: 0'), h.lastText(ADMIN));
  assert.ok(h.buttons().some((b) => b.callback_data === 'pt:add:9701'));
  assert.ok(h.buttons().some((b) => b.url === 'https://t.me/user9701'), 'lichka tugmasi');

  await h.click(ADMIN, 'pt:add:9701');
  await h.text(ADMIN, 'abc');
  assert.ok(h.lastText(ADMIN).startsWith('⚠️'));
  h.clear();
  await h.text(ADMIN, "50 Turnir g'olibi");
  assert.ok(h.texts(ADMIN).some((x) => x.startsWith('✅ User9701: +50 points')), h.texts(ADMIN).join('\n'));
  const msg = h.texts(9701).find((x) => x.startsWith('⭐ Admin sizga'));
  assert.ok(msg && msg.includes("Turnir g'olibi") && msg.includes('+50 points'), msg);
  let u = await user(9701);
  assert.deepStrictEqual([u.points_admin, users.totalPoints(u)], [50, 50]);

  await h.click(ADMIN, 'pt:sub:9701');
  h.clear();
  await h.text(ADMIN, '80');
  assert.ok(h.texts(ADMIN).some((x) => x.startsWith('✅ User9701: -50 points')), 'faqat bor points olinadi');
  assert.ok(h.texts(9701).some((x) => x.startsWith('⚠️ Admin hisobingizdan <b>50 points</b>')));
  u = await user(9701);
  assert.strictEqual(users.totalPoints(u), 0);
  await h.click(ADMIN, 'pt:sub:9701');
  await h.text(ADMIN, '5');
  assert.ok(h.texts(ADMIN).some((x) => x.startsWith("⚠️ Foydalanuvchida olib tashlanadigan points yo'q")));
  const log = await db.many('SELECT amount, reason FROM point_adjustments ORDER BY id');
  assert.deepStrictEqual(log.map((x) => [x.amount, x.reason]), [[50, "Turnir g'olibi"], [-50, null]]);
});

test("⭐ tuzatish umumiy reytingga qo'shiladi; oddiy foydalanuvchi web admin API'siga kira olmaydi", async () => {
  const b = await user(9702);
  await pointsAdmin.adjust(b.id, 30, null, 'Bonus');
  const r = await leaderboard.computeRanking('overall', leaderboard.range('weekly'));
  assert.deepStrictEqual(r.map((x) => [Number(x.telegram_id), x.points]), [[9702, 30]], '9701 (0) ro\'yxatda yo\'q');
  await assert.rejects(pointsAdmin.adjust(b.id, 0), (e) => e instanceof pointsAdmin.PointsError);
  await assert.rejects(pointsAdmin.adjust(b.id, 100001), (e) => e instanceof pointsAdmin.PointsError);

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'secret' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (body, c = cookie) => fetch(`${base}/api/admin/points`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) });
  assert.strictEqual((await post({ user: '@user9702', amount: 5 }, null)).status, 401);
  const ok = await (await post({ user: '@user9702', amount: 5, reason: 'Web' })).json();
  assert.deepStrictEqual([ok.amount, ok.total], [5, 35]);
  assert.strictEqual((await post({ user: '9999999', amount: 5 })).status, 404);
  assert.strictEqual((await (await post({ user: '9702', amount: 'x' })).json()).error, 'bad_amount');
  const info = await (await fetch(`${base}/api/admin/points/user?q=9702`, { headers: { Cookie: cookie } })).json();
  assert.deepStrictEqual([info.total, info.adminPoints, info.history.length], [35, 35, 2]);
});

test("🏆 hafta g'olibi aniqlanganda adminga lichka havolasi bilan xabar (username yo'q bo'lsa — tg://user)", async () => {
  await db.query("UPDATE users SET username = NULL WHERE telegram_id = 9702");
  await db.query("INSERT INTO prizes (kind, period, text) VALUES ('overall', 'weekly', 'Istalgan jamoa formasi')");
  const jobs = require('../src/jobs/scheduler');
  const { weekRange, HOUR } = require('../src/services/time');
  h.clear();
  await jobs.finalizePeriods(new Date(weekRange().end.getTime() + 4 * HOUR));
  const m = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === ADMIN && String(c.payload.text).startsWith('🏆 <b>Umumiy reyting'));
  assert.ok(m, 'adminga xabar');
  assert.ok(m.payload.text.includes('<a href="tg://user?id=9702">User9702</a>'), m.payload.text);
  assert.ok(m.payload.text.includes('Istalgan jamoa formasi') && m.payload.text.includes('35 points'));
  assert.strictEqual(m.payload.reply_markup.inline_keyboard[0][0].url, 'tg://user?id=9702');
});

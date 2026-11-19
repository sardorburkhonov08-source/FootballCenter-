// ✨ Dizayn: profil rasmi (podium), profil boshi, rasmli bosh menyu, o'yin sahifasi ranglari
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const menuCard = require('../src/services/menuCard');

let h;
let server;
let base;
const auth = (id, extra = {}) => ({ Authorization: `tma ${signInitData({ id, first_name: `D${id}`, ...extra }, process.env.BOT_TOKEN)}` });
const call = async (path, id, extra) => { const r = await fetch(`${base}${path}`, { headers: auth(id, extra) }); return { status: r.status, body: await r.json().catch(() => null) }; };

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test("Telegram profil rasmi saqlanadi (faqat https://t.me/) va reyting podiumida beriladi", async () => {
  await call('/api/me', 7801, { photo_url: 'https://t.me/i/userpic/320/abc.jpg' });
  await call('/api/me', 7802, { photo_url: 'javascript:alert(1)' });
  const [a, b] = await Promise.all([7801, 7802].map((tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg])));
  assert.deepStrictEqual([a.photo_url, b.photo_url], ['https://t.me/i/userpic/320/abc.jpg', null]);
  // Rasm keyingi kirishda kelmasa — eskisi saqlanadi
  await call('/api/me', 7801);
  assert.strictEqual((await db.one('SELECT photo_url FROM users WHERE telegram_id = 7801')).photo_url, 'https://t.me/i/userpic/320/abc.jpg');
  await db.query("INSERT INTO penalty_games (user_id, status, result, points, finished_at) VALUES ($1, 'finished', 'win', 3, now()), ($2, 'finished', 'win', 1, now())", [a.id, b.id]);
  await db.query('UPDATE users SET points_penalty = 3 WHERE id = $1', [a.id]);
  const lb = (await call('/api/leaderboard/overall/daily', 7802)).body;
  assert.deepStrictEqual(lb.top.map((r) => [r.points, r.photo]), [[3, 'https://t.me/i/userpic/320/abc.jpg'], [1, null]]);
  assert.strictEqual((await call('/api/me', 7801)).body.user.photoUrl, 'https://t.me/i/userpic/320/abc.jpg');
  const prof = (await call('/api/profile', 7801)).body;
  assert.deepStrictEqual([prof.overall.points, prof.overall.weekPlace, prof.overall.streak], [3, 1, 0]);
});

test("🖼 bosh menyu — shaxsiy karta-rasm (sendPhoto) va menyu tugmalari; chatdagi xabarlar o'chirilmaydi", async () => {
  await settings.set('menu_image_enabled', true);
  await h.text(7803, '/start');
  await h.click(7803, 'lang:uz');
  h.clear();
  await h.click(7803, 'm:menu');
  const photo = h.calls.find((c) => c.method === 'sendPhoto');
  assert.ok(photo, 'rasm yuborildi');
  assert.match(photo.payload.caption, /^🏠 Asosiy menyu/);
  assert.ok(photo.payload.reply_markup.inline_keyboard.length > 2);
  assert.ok(!h.calls.some((c) => c.method === 'deleteMessage'), 'chatdagi xabarlar o\'chirilmaydi');
  const u = await db.one('SELECT * FROM users WHERE telegram_id = 7803');
  const png = await menuCard.renderPng(u);
  assert.strictEqual(png.subarray(1, 4).toString(), 'PNG');
  const svg = menuCard.svg({ ...(await menuCard.viewModel(u)), name: 'Sardor' });
  assert.ok(svg.includes('LV 1 · HAVASKOR') && svg.includes('ODDIY TARIF'));
  await settings.set('menu_image_enabled', false);
  h.clear();
  await h.click(7803, 'm:menu');
  assert.ok(!h.calls.some((c) => c.method === 'sendPhoto'), 'o\'chirilsa — matnli menyu');
});

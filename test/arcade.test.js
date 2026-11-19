// 🥅 Crossbar challenge va ⚽ Keepy-uppy
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const arcade = require('../src/services/arcade');
const leaderboard = require('../src/services/leaderboard');
const users = require('../src/services/users');

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `A${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(id), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const U = 7401;
const FREE = 7402;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [U, FREE]) await call('/api/me', tg);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days' WHERE telegram_id = $1", [U]);
});
test.after(async () => { server.close(); await db.pool.end(); });

/** Crossbar: davr ichida pos = 75 bo'ladigan vaqt (pos = 50 − 50·cos(2πt/T) → t = T·acos(−0.5)/(2π)) */
const perfectMs = (period) => Math.round((period * Math.acos(-0.5)) / (2 * Math.PI));

test('crossbar formulasi: aniq — 3, yaqin — 2/1, uzoq va noto\'g\'ri vaqt — 0', () => {
  assert.strictEqual(arcade.crossbarPoints(75), 3);
  assert.strictEqual(arcade.crossbarPoints(80), 2);
  assert.strictEqual(arcade.crossbarPoints(65), 1);
  assert.strictEqual(arcade.crossbarPoints(40), 0);
  assert.ok(Math.abs(arcade.crossbarPos(perfectMs(1500), 1500) - 75) < 0.5);
  const params = { attempts: [{ period: 1500 }, { period: 1200 }, { period: 1700 }, { period: 1300 }, { period: 1600 }] };
  const taps = [perfectMs(1500), perfectMs(1200), 50, null, 99999];
  const r = arcade.crossbarScore(params, taps);
  assert.deepStrictEqual([r.score, r.detail.shots.map((s) => s.points)], [6, [3, 3, 0, 0, 0]]);
});

test("keepy formulasi: ketma-ket to'g'ri bosishlar soni, birinchi xatoda to'xtaydi", () => {
  const params = { falls: [{ t: 1000, w: 200 }, { t: 900, w: 150 }, { t: 800, w: 100 }, { t: 700, w: 90 }] };
  assert.strictEqual(arcade.keepyScore(params, [1000, 1000, 750, 700]).score, 4);
  assert.strictEqual(arcade.keepyScore(params, [1000, 1000, 600, 700]).score, 2);
  assert.strictEqual(arcade.keepyScore(params, [null]).score, 0);
  const p = arcade.newParams('keepy');
  assert.strictEqual(p.falls.length, 80);
  assert.ok(p.falls.every((f, i) => f.t >= 370 && f.w >= 70 && (i === 0 || f.w <= p.falls[i - 1].w)), 'tezlashadi, oyna torayadi');
});

test("faqat Premium; o'yin: boshlash, natija serverda hisoblanadi, points, bir marta", async () => {
  assert.strictEqual((await call('/api/arcade/crossbar', FREE)).status, 402);
  assert.strictEqual((await call('/api/arcade/golf', U)).status, 400);
  assert.strictEqual((await call('/api/arcade/crossbar/finish', U, { method: 'POST', body: { taps: [] } })).body.error, 'no_game');
  const g = (await call('/api/arcade/crossbar/start', U, { method: 'POST' })).body;
  assert.deepStrictEqual([g.status, g.params.attempts.length, g.botScore >= 6 && g.botScore <= 10], ['active', 5, true]);
  assert.strictEqual((await call('/api/arcade/crossbar/start', U, { method: 'POST' })).body.id, g.id, 'faol o\'yin qaytadi');
  // Hammasi aniq: 15 ball > bot
  const taps = g.params.attempts.map((a) => perfectMs(a.period));
  const f = (await call('/api/arcade/crossbar/finish', U, { method: 'POST', body: { taps } })).body;
  assert.deepStrictEqual([f.status, f.score, f.result, f.points], ['finished', 15, 'win', 3]);
  assert.strictEqual((await call('/api/arcade/crossbar/finish', U, { method: 'POST', body: { taps } })).body.error, 'no_game', 'qayta yuborib bo\'lmaydi');
  assert.strictEqual((await user(U)).points_arcade, 3);

  // Keepy: bot rekordiga teng — durang
  const k = (await call('/api/arcade/keepy/start', U, { method: 'POST' })).body;
  const kt = k.params.falls.slice(0, k.botScore).map((x) => x.t);
  const kf = (await call('/api/arcade/keepy/finish', U, { method: 'POST', body: { taps: [...kt, null] } })).body;
  assert.deepStrictEqual([kf.score, kf.result, kf.points], [k.botScore, 'draw', 1]);
  assert.strictEqual(users.totalPoints(await user(U)), 4);
});

test("kunlik limit (har tur uchun alohida), statistika va reyting", async () => {
  await settings.set('arcade_daily_games', 1);
  assert.strictEqual((await call('/api/arcade/crossbar/start', U, { method: 'POST' })).body.error, 'daily_limit');
  const st = (await call('/api/arcade/crossbar', U)).body;
  assert.deepStrictEqual([st.left, st.stats.played, st.stats.wins, st.stats.best], [0, 1, 1, 15]);
  await settings.set('arcade_daily_games', 3);
  assert.strictEqual((await call('/api/arcade/keepy/finish', U, { method: 'POST', body: { taps: 'x' } })).status, 400);
  leaderboard.clearRankingCache();
  const cb = (await call('/api/leaderboard/crossbar/weekly', U)).body;
  const ku = (await call('/api/leaderboard/keepy/weekly', U)).body;
  assert.deepStrictEqual([cb.top[0].points, ku.top[0].points], [3, 1]);
});

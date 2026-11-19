// 💥 Crossbar challenge va ⚽ Keepy-uppy
process.env.BOT_USERNAME = 'fc_test_bot';
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, settings, createTestBot } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const arcade = require('../src/services/arcade');
const leaderboard = require('../src/services/leaderboard');
const users = require('../src/services/users');

let server;
let base;
let h;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `A${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(id), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const U = 7401;
const FREE = 7402;
const B = 7403;
const C = 7404;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [U, FREE, B, C]) await call('/api/me', tg);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days', language = 'uz' WHERE telegram_id = ANY($1)", [[U, B, C]]);
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
  const kt = k.params.falls.slice(0, k.botScore).map((x) => ({ ms: x.t, x: x.x }));
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

test("keepy: to'p maydon bo'ylab har xil joyga tushadi; to'pdan uzoqqa bosish — xato", () => {
  const p = arcade.newParams('keepy');
  assert.ok(p.falls.every((f) => f.x >= 12 && f.x <= 88), 'maydon ichida');
  assert.ok(p.falls.every((f, i) => i === 0 || Math.abs(f.x - p.falls[i - 1].x) >= 15), 'har safar boshqa joyga');
  const params = { falls: [{ t: 1000, w: 200, x: 30 }, { t: 900, w: 150, x: 70 }] };
  assert.strictEqual(arcade.keepyScore(params, [{ ms: 1000, x: 35 }, { ms: 900, x: 72 }]).score, 2);
  assert.strictEqual(arcade.keepyScore(params, [{ ms: 1000, x: 35 }, { ms: 900, x: 30 }]).score, 1, 'to\'pdan uzoqqa bosildi');
  assert.strictEqual(arcade.keepyScore(params, [1000]).score, 0, 'joyi bo\'lmasa — hisoblanmaydi');
});

test("🎲 tasodifiy raqib: bir xil parametrlar, ikkalasi o'ynagach g'olib, points va botda xabar", async () => {
  const a = (await call('/api/arcade/crossbar/match', B, { method: 'POST', body: { mode: 'random' } })).body;
  assert.deepStrictEqual([a.state, a.opponent, a.link], ['your_turn', null, null]);
  const b = (await call('/api/arcade/crossbar/match', C, { method: 'POST', body: { mode: 'random' } })).body;
  assert.strictEqual(b.id, a.id, 'C kutayotgan bellashuvga qo\'shildi');
  const gb = (await call(`/api/arcade/match/${a.id}/start`, B, { method: 'POST' })).body;
  const gc = (await call(`/api/arcade/match/${a.id}/start`, C, { method: 'POST' })).body;
  assert.deepStrictEqual(gb.params, gc.params, 'bir xil sharoit');
  const perfect = gb.params.attempts.map((x) => perfectMs(x.period));
  const s1 = (await call(`/api/arcade/match/${a.id}/finish`, B, { method: 'POST', body: { taps: perfect } })).body;
  assert.deepStrictEqual([s1.state, s1.my, s1.their], ['opponent_turn', 15, null], 'raqib natijasi hali ko\'rinmaydi');
  assert.strictEqual((await call(`/api/arcade/match/${a.id}/start`, B, { method: 'POST' })).body.error, 'already_played');
  h.clear();
  const s2 = (await call(`/api/arcade/match/${a.id}/finish`, C, { method: 'POST', body: { taps: [perfect[0], 50, 50, 50, 50] } })).body;
  assert.deepStrictEqual([s2.state, s2.my, s2.their, s2.result], ['finished', 3, 15, { result: 'loss', points: 0 }]);
  const sb = (await call(`/api/arcade/match/${a.id}`, B)).body;
  assert.deepStrictEqual(sb.result, { result: 'win', points: 5 });
  assert.strictEqual((await user(B)).points_arcade, 5);
  assert.match(h.lastText(B), /^⚔️ Crossbar challenge: siz <b>A7404<\/b> ni 15:3 hisobida yutdingiz! 🏆 \+5 points/);
  const list = (await call('/api/arcade/crossbar/matches', C)).body;
  assert.deepStrictEqual([list.length, list[0].state], [1, 'finished']);
  // Botga qarshi kunlik limitga ta'sir qilmaydi
  assert.strictEqual((await call('/api/arcade/crossbar', B)).body.left, 3);
});

test("🤝 do'st havolasi: botda taklif, qabul qilish; muddat tugasa o'ynagani yutadi", async () => {
  const a = (await call('/api/arcade/keepy/match', B, { method: 'POST', body: { mode: 'invite' } })).body;
  assert.match(a.link, /^https:\/\/t\.me\/fc_test_bot\?start=ag_[A-Za-z0-9_-]{8}$/);
  const code = a.link.split('ag_')[1];
  h.clear();
  await h.text(7499, `/start ag_${code}`);
  const msg = h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 7499).map((c) => c.payload).find((p) => p.text.startsWith('🎮'));
  assert.match(msg.text, /<b>A7403<\/b> sizni «Keepy-uppy» o'yinida bellashuvga chaqirdi/);
  assert.ok(msg.reply_markup.inline_keyboard[0][0].web_app.url.endsWith(`/app/?ag=${code}`));
  assert.strictEqual((await call(`/api/arcade/invite/${code}/join`, B, { method: 'POST' })).body.error, 'own_match');
  assert.deepStrictEqual((await call(`/api/arcade/invite/${code}`, C)).body.available, true);
  assert.strictEqual((await call(`/api/arcade/invite/${code}/join`, C, { method: 'POST' })).body.state, 'your_turn');
  const g = (await call(`/api/arcade/match/${a.id}/start`, B, { method: 'POST' })).body;
  const taps = g.params.falls.slice(0, 4).map((f) => ({ ms: f.t, x: f.x }));
  await call(`/api/arcade/match/${a.id}/finish`, B, { method: 'POST', body: { taps } });
  await db.query("UPDATE arcade_matches SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.id]);
  const r = await arcade.tick();
  assert.strictEqual(r.finished, 1);
  const m = await db.one('SELECT * FROM arcade_matches WHERE id = $1', [a.id]);
  assert.deepStrictEqual([m.status, m.winner_id], ['finished', (await user(B)).id]);
  const cRes = await db.one('SELECT * FROM arcade_games WHERE match_id = $1 AND user_id = $2', [a.id, (await user(C)).id]);
  assert.deepStrictEqual([cRes.score, cRes.result], [0, 'loss']);
});

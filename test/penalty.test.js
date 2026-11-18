// 🥅 Penalty (sinov)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const penalty = require('../src/services/penalty');
const leaderboard = require('../src/services/leaderboard');

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `P${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(id), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const U = 7301;
const U2 = 7302;
const FREE = 7303;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [U, U2, FREE]) await call('/api/me', tg);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days' WHERE telegram_id = ANY($1)", [[U, U2]]);
});
test.after(async () => { server.close(); await db.pool.end(); });

const K = (by, goal) => ({ by, goal });
test('seriya qoidalari: navbat, erta tugash, sudden death', () => {
  assert.deepStrictEqual(penalty.evaluate([]), { over: false, ug: 0, bg: 0, next: 'user' });
  assert.strictEqual(penalty.evaluate([K('user', true)]).next, 'bot');
  // 3:0 va botda 2 ta zarba qoldi — yetib bo'lmaydi
  const early = [K('user', true), K('bot', false), K('user', true), K('bot', false), K('user', true), K('bot', false)];
  assert.deepStrictEqual(penalty.evaluate(early), { over: true, ug: 3, bg: 0 });
  // 5:5 — sudden death
  const tie = Array.from({ length: 10 }, (_, i) => K(i % 2 ? 'bot' : 'user', true));
  assert.deepStrictEqual(penalty.evaluate(tie), { over: false, ug: 5, bg: 5, next: 'user', sudden: true });
  assert.strictEqual(penalty.evaluate([...tie, K('user', true)]).next, 'bot');
  assert.deepStrictEqual(penalty.evaluate([...tie, K('user', true), K('bot', false)]), { over: true, ug: 6, bg: 5 });
  // 5 juftdan keyin ham teng — durang
  const long = Array.from({ length: 20 }, (_, i) => K(i % 2 ? 'bot' : 'user', true));
  assert.deepStrictEqual(penalty.evaluate(long), { over: true, ug: 10, bg: 10 });
});

test("faqat Premium; o'yin: zarba va qaytarish, g'alaba uchun points", async () => {
  assert.strictEqual((await call('/api/penalty', FREE)).status, 402);
  assert.strictEqual((await call('/api/penalty/kick', U, { method: 'POST', body: { dir: 'left' } })).body.error, 'no_game');
  const g = await call('/api/penalty/start', U, { method: 'POST' });
  assert.deepStrictEqual([g.body.status, g.body.next, g.body.kicks.length], ['active', 'user', 0]);
  assert.strictEqual((await call('/api/penalty/start', U, { method: 'POST' })).body.id, g.body.id, 'faol o\'yin qaytadi');
  assert.strictEqual((await call('/api/penalty/kick', U, { method: 'POST', body: { dir: 'up' } })).status, 400);
  const k = (await call('/api/penalty/kick', U, { method: 'POST', body: { dir: 'right' } })).body;
  assert.deepStrictEqual([k.kick.by, k.kick.shot, k.kick.goal === (k.kick.dive !== 'right'), k.game.next], ['user', 'right', true, 'bot']);
  await db.query('DELETE FROM penalty_games');

  // Darvozabon doim chapga sakraydi, bot doim chapga uradi: siz o'ngga urasiz (gol), chapga sakraysiz (qaytarasiz)
  const u = await user(U2);
  await penalty.start(u);
  const left = { random: () => 'left' };
  let r;
  for (const dir of ['right', 'left', 'right', 'left', 'right', 'left']) r = await penalty.kick(u, dir, left);
  assert.deepStrictEqual([r.game.status, r.game.result, r.game.userGoals, r.game.botGoals, r.game.points], ['finished', 'win', 3, 0, 3]);
  assert.strictEqual((await user(U2)).points_penalty, 3);
  await assert.rejects(penalty.kick(u, 'left', left), /no_game/);
});

test("teng seriya — sudden death, oxiri durang; kunlik limit; reyting", async () => {
  const u = await user(U2);
  await penalty.start(u);
  // Hamma zarba gol: siz o'ngga urasiz (darvozabon chapga), bot chapga uradi (siz o'ngga sakraysiz)
  let r;
  for (let i = 0; i < 20; i += 1) r = await penalty.kick(u, 'right', { random: () => 'left' });
  assert.deepStrictEqual([r.game.status, r.game.result, r.game.userGoals, r.game.botGoals, r.game.points], ['finished', 'draw', 10, 10, 1]);
  assert.strictEqual((await user(U2)).points_penalty, 4);
  // Bugun 2 ta o'yin — limit 2 bo'lsa uchinchisi yo'q
  await settings.set('penalty_daily_games', 2);
  assert.strictEqual((await call('/api/penalty/start', U2, { method: 'POST' })).body.error, 'daily_limit');
  const st = (await call('/api/penalty', U2)).body;
  assert.deepStrictEqual([st.left, st.stats.played, st.stats.wins, st.stats.best], [0, 2, 1, 10]);
  await settings.set('penalty_daily_games', 3);
  leaderboard.clearRankingCache();
  const lb = (await call('/api/leaderboard/penalty/weekly', U2)).body;
  assert.deepStrictEqual([lb.top[0].points, lb.me.place], [4, 1]);
  // Umumiy points'ga qo'shiladi
  assert.strictEqual(require('../src/services/users').totalPoints(await user(U2)), 4);
});

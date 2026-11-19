// 🏆 Umumiy reyting: hamma o'yinlar points'i yig'indisi; bugun / hafta / oy; g'oliblar shu bo'yicha
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const leaderboard = require('../src/services/leaderboard');

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `O${id}` }, process.env.BOT_TOKEN)}` });
const call = async (path, id) => { const r = await fetch(`${base}${path}`, { headers: auth(id) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;

test.before(async () => {
  await resetDb();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [7701, 7702, 7703]) await call('/api/me', tg);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("umumiy reyting har o'yin points'ini qo'shadi; har o'yinning o'z reytingi alohida qoladi", async () => {
  const [a, b] = [await uid(7701), await uid(7702)];
  const q = await db.one('SELECT id FROM quiz_questions LIMIT 1');
  // A: Quiz 2 + Penalty 3 = 5; B: Penalty 3 + kunlik vazifa 5 = 8
  await db.query("INSERT INTO quiz_answers (user_id, question_id, selected_option, points_earned, answered_at) VALUES ($1, $2, 'A', 2, now())", [a, q.id]);
  await db.query("INSERT INTO penalty_games (user_id, status, result, points, finished_at) VALUES ($1, 'finished', 'win', 3, now()), ($2, 'finished', 'win', 3, now())", [a, b]);
  await db.query("INSERT INTO user_quest_days (user_id, day, quests, reward, streak, claimed_at) VALUES ($1, CURRENT_DATE, '[]', 5, 1, now())", [b]);
  const r = await leaderboard.computeRanking('overall', leaderboard.range('daily'));
  assert.deepStrictEqual(r.map((x) => [x.id, x.points]), [[b, 8], [a, 5]]);
  const quizOnly = await leaderboard.computeRanking('quiz', leaderboard.range('weekly'));
  assert.deepStrictEqual(quizOnly.map((x) => [x.id, x.points]), [[a, 2]], 'Quiz reytingi alohida');
  // API: bugun / hafta / oy; Premiumsiz ham ko'radi
  for (const p of ['daily', 'weekly', 'monthly']) {
    const d = (await call(`/api/leaderboard/overall/${p}`, 7703)).body;
    assert.deepStrictEqual(d.top.map((x) => x.points), [8, 5], p);
  }
  const me = (await call('/api/leaderboard/overall/daily', 7701)).body.me;
  assert.deepStrictEqual([me.place, me.points], [2, 5]);
  assert.strictEqual((await call('/api/leaderboard/overall/yearly', 7701)).status, 404);
});

test("haftalik g'olib umumiy reyting bo'yicha aniqlanadi; sovrinlar 'overall' uchun", async () => {
  const jobs = require('../src/jobs/scheduler');
  const { weekRange, HOUR } = require('../src/services/time');
  await jobs.finalizePeriods(new Date(weekRange().end.getTime() + 4 * HOUR));
  const w = await db.one("SELECT * FROM period_winners WHERE period = 'weekly'");
  assert.deepStrictEqual([w.kind, w.user_id, w.points], ['overall', await uid(7702), 8]);
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM period_winners WHERE kind IN ('manager', 'quiz')")).n, 0);
  await db.query("INSERT INTO prizes (kind, period, text) VALUES ('overall', 'weekly', 'Futbolka')");
  assert.strictEqual((await call('/api/prizes?kind=overall', 7701)).body[0].text, 'Futbolka');
});

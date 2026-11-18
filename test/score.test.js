// 🎯 Hisobni top
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const scorePredict = require('../src/services/scorePredict');
const community = require('../src/services/community');
const leaderboard = require('../src/services/leaderboard');
const { weekRange } = require('../src/services/time');

const KICK = Date.now() + 3 * 3600 * 1000;
const PL = { id: 39, name: 'Premier League', country: 'England', logo: 'pl.png', flag: 'gb.svg', season: 2026, round: 'R1' };
// API'dagi o'yinlar holati (testda o'zgartiriladi)
const M = {
  701: { short: 'NS', ts: KICK, home: null, away: null, teams: [[1, 'Arsenal'], [2, 'Chelsea']] },
  702: { short: 'NS', ts: KICK + 3600000, home: null, away: null, teams: [[3, 'Liverpool'], [4, 'Everton']] },
  703: { short: 'NS', ts: KICK + 7200000, home: null, away: null, teams: [[5, 'Leeds'], [6, 'Burnley']] },
};
const fx = (id) => {
  const m = M[id];
  return {
    fixture: { id, date: new Date(m.ts).toISOString(), timestamp: Math.floor(m.ts / 1000), status: { short: m.short, elapsed: null } },
    league: PL,
    teams: { home: { id: m.teams[0][0], name: m.teams[0][1], logo: 'h.png' }, away: { id: m.teams[1][0], name: m.teams[1][1], logo: 'a.png' } },
    goals: { home: m.home, away: m.away },
  };
};
const requests = [];
football.setFetch(async (url) => {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams);
  requests.push(u.pathname + u.search);
  let response = [];
  if (u.pathname === '/fixtures' && q.id) response = M[q.id] ? [fx(Number(q.id))] : [];
  else if (u.pathname === '/fixtures' && q.date) response = Object.keys(M).map(Number).filter((id) => M[id].day === q.date || !M[id].day).map(fx);
  return { ok: true, status: 200, headers: new Map([['x-ratelimit-requests-remaining', '90']]), json: async () => ({ errors: [], response }) };
});

let server;
let base;
let cookie;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `S${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, { id, method = 'GET', body, admin } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(id ? auth(id) : {}), ...(admin ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P1 = 6101;
const P2 = 6102;
const P3 = 6103;
const FREE = 6104;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'secret' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
  for (const tg of [P1, P2, P3, FREE]) await call('/api/me', { id: tg });
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days' WHERE telegram_id = ANY($1)", [[P1, P2, P3]]);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("admin bir nechta o'yin belgilaydi, ball sozlamasi; boshlangan o'yin belgilanmaydi", async () => {
  for (const id of [701, 702, 703]) assert.strictEqual((await call('/api/admin/score/games', { method: 'POST', admin: true, body: { apiMatchId: id } })).status, 200);
  const list = await call('/api/admin/score/games', { admin: true });
  assert.deepStrictEqual(list.body.map((g) => g.home_team_name).sort(), ['Arsenal', 'Leeds', 'Liverpool']);
  assert.strictEqual((await call('/api/admin/score/settings', { admin: true })).body.exact, 5);
  assert.strictEqual((await call('/api/admin/score/settings', { method: 'PUT', admin: true, body: { exact: 2, outcome: 5 } })).status, 400);
  M[704] = { short: '1H', ts: Date.now() - 600000, home: 0, away: 0, teams: [[7, 'A'], [8, 'B']] };
  assert.strictEqual((await call('/api/admin/score/games', { method: 'POST', admin: true, body: { apiMatchId: 704 } })).body.error, 'match_not_scheduled');
  delete M[704];
  assert.strictEqual((await call('/api/score/games', {})).status, 401);
});

test("faqat Premium; taxmin saqlanadi va o'zgartiriladi, noto'g'ri hisob rad etiladi", async () => {
  assert.strictEqual((await call('/api/score/games', { id: FREE })).status, 402);
  assert.strictEqual((await call('/api/leaderboard/score/weekly', { id: FREE })).status, 402);
  const d = await call('/api/score/games', { id: P1 });
  assert.deepStrictEqual(d.body.rules, { exact: 5, outcome: 2 });
  assert.strictEqual(d.body.games.length, 3);
  const [g1, g2, g3] = d.body.games;
  assert.strictEqual(g1.home.name, 'Arsenal', 'eng yaqin o\'yin birinchi');
  const save = (tg, g, home, away) => call(`/api/score/games/${g.id}`, { id: tg, method: 'POST', body: { home, away } });
  assert.strictEqual((await save(P1, g1, -1, 0)).body.error, 'bad_score');
  assert.strictEqual((await save(P1, g1, 21, 0)).body.error, 'bad_score');
  assert.strictEqual((await save(P1, g1, 1.5, 0)).body.error, 'bad_score');
  assert.strictEqual((await save(P1, { id: 99999 }, 1, 0)).status, 404);
  assert.deepStrictEqual((await save(P1, g1, 1, 1)).body.prediction, { home: 1, away: 1, points: null });
  assert.deepStrictEqual((await save(P1, g1, 2, 1)).body.prediction, { home: 2, away: 1, points: null });
  await save(P2, g1, 3, 0); // natija to'g'ri, hisob emas
  await save(P3, g1, 0, 0); // xato
  await save(P1, g2, 0, 0);
  await save(P2, g2, 1, 1); // durang — natija to'g'ri
  await save(P1, g3, 1, 0);
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM score_predictions')).n, 6);
});

test("o'yin boshlangach qulflanadi; tugagach ball bir marta beriladi — kun uchun bitta API so'rovi", async () => {
  await db.query("UPDATE score_games SET kickoff_at = now() - interval '3 hours' WHERE api_match_id IN (701, 702)");
  assert.strictEqual(await scorePredict.lockStarted(), 2);
  const g1 = await db.one('SELECT * FROM score_games WHERE api_match_id = 701');
  assert.strictEqual((await call(`/api/score/games/${g1.id}`, { id: P1, method: 'POST', body: { home: 5, away: 5 } })).body.error, 'locked');

  Object.assign(M[701], { short: 'FT', home: 2, away: 1 });
  Object.assign(M[702], { short: 'FT', home: 2, away: 2 });
  await football.clearCache();
  requests.length = 0;
  assert.strictEqual(await scorePredict.scoreFinished(), 2);
  assert.strictEqual(requests.filter((r) => r.startsWith('/fixtures')).length, 1, `so'rovlar: ${requests.join(', ')}`);
  const pts = async (tg) => (await user(tg)).points_score;
  // P1: 701 aniq (5) + 702 natija durang (2) = 7; P2: 701 natija (2) + 702 natija (2) = 4; P3: 0
  assert.deepStrictEqual([await pts(P1), await pts(P2), await pts(P3)], [7, 4, 0]);
  assert.strictEqual(await scorePredict.scoreFinished(), 0, 'qayta hisoblanmaydi');
  assert.strictEqual(await pts(P1), 7);

  const d = await call('/api/score/games', { id: P1 });
  const fin = d.body.games.find((g) => g.home.name === 'Arsenal');
  assert.deepStrictEqual([fin.status, fin.result, fin.prediction.points], ['finished', { home: 2, away: 1 }, 5]);
  assert.strictEqual(d.body.games[d.body.games.length - 1].status, 'finished', 'tugaganlar oxirida');

  leaderboard.clearRankingCache();
  const lb = await call('/api/leaderboard/score/weekly', { id: P2 });
  assert.deepStrictEqual(lb.body.top.map((r) => r.points), [7, 4]);
  assert.strictEqual(lb.body.me.place, 2);
  const prof = await call('/api/profile', { id: P1 });
  assert.deepStrictEqual([prof.body.score.total, prof.body.score.predictions, prof.body.score.hits], [7, 3, 2]);
  assert.strictEqual((await call('/api/profile', { id: FREE })).body.score, null);
  // Hisoblangan o'yinni admin o'chira olmaydi
  assert.strictEqual((await call(`/api/admin/score/games/${g1.id}`, { method: 'DELETE', admin: true })).body.error, 'already_finished');
});

test("ballar umumiy points'ga va community haftalik reytingiga qo'shiladi", async () => {
  const pts = await community.weekPoints(weekRange(), true);
  assert.strictEqual(pts.get((await user(P1)).id), 7);
  const { totalPoints } = require('../src/services/users');
  await db.query('UPDATE users SET points_manager = 10, points_quiz = 3 WHERE telegram_id = $1', [P1]);
  assert.strictEqual(totalPoints(await user(P1)), 20);
});

test("boshqa kunga qoldirilgan o'yin qayta ochiladi; admin kutilayotgan o'yinni o'chiradi", async () => {
  const g3 = await db.one('SELECT * FROM score_games WHERE api_match_id = 703');
  await db.query("UPDATE score_games SET kickoff_at = now() - interval '3 hours' WHERE id = $1", [g3.id]);
  await scorePredict.lockStarted();
  Object.assign(M[703], { short: 'PST', ts: Date.now() + 2 * 86400000 });
  await football.clearCache();
  assert.strictEqual(await scorePredict.scoreFinished(), 0);
  const again = await db.one('SELECT * FROM score_games WHERE id = $1', [g3.id]);
  assert.strictEqual(again.status, 'upcoming');
  assert.ok(new Date(again.kickoff_at) > new Date(Date.now() + 86400000));
  assert.strictEqual((await call(`/api/score/games/${g3.id}`, { id: P1, method: 'POST', body: { home: 3, away: 3 } })).status, 200);
  await settings.set('score_exact_points', 5);
  assert.strictEqual((await call(`/api/admin/score/games/${g3.id}`, { method: 'DELETE', admin: true })).status, 200);
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM score_predictions WHERE game_id = $1', [g3.id])).n, 0);
});

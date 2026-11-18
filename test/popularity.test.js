// 🔥 Avtomatik ommabop ligalar
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const popularity = require('../src/services/popularity');

const league = (id, name, country, code) => ({ league: { id, name, type: 'League' }, country: { name: country, code }, seasons: [{ year: 2026, current: true }] });
const fx = (id, leagueId, name, country) => ({ fixture: { id, timestamp: Math.floor(Date.now() / 1000) + 7200, status: { short: 'NS' } }, league: { id: leagueId, name, country }, teams: { home: { id: id * 10, name: 'A' }, away: { id: id * 10 + 1, name: 'B' } }, goals: {}, score: {} });

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `P${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, opts = {}) {
  const res = await fetch(`${base}${path}`, { method: opts.method || 'GET', headers: { ...auth(id), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.before(async () => {
  await resetDb();
  football.setFetch(async (url) => {
    const u = new URL(url);
    let response = [];
    if (u.pathname === '/fixtures') response = [fx(1, 500, 'A-League', 'Australia'), fx(2, 369, 'Super League', 'Uzbekistan'), fx(3, 39, 'Premier League', 'England'), fx(4, 400, 'Bundesliga', 'Austria')];
    if (u.pathname === '/leagues') response = [league(500, 'A-League', 'Australia', 'AU'), league(369, 'Super League', 'Uzbekistan', 'UZ'), league(39, 'Premier League', 'England', 'GB'), league(400, 'Bundesliga', 'Austria', 'AT')];
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response }) };
  });
  await settings.set('featured_leagues', [39]);
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test("bir foydalanuvchi bir ligani kuniga bir marta hisoblanadi, kimligi saqlanmaydi", async () => {
  popularity.resetSeen();
  assert.strictEqual(await popularity.record(1, 369), true);
  assert.strictEqual(await popularity.record(1, 369), false, 'takror hisoblanmaydi');
  await popularity.record(2, 369);
  await popularity.record(1, 500);
  assert.strictEqual(await popularity.record(3, 'abc'), false);
  const rows = await db.many('SELECT * FROM league_popularity ORDER BY league_id');
  assert.deepStrictEqual(rows.map((r) => [r.league_id, r.users]), [[369, 2], [500, 1]]);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['day', 'league_id', 'users'], 'foydalanuvchi ID saqlanmaydi');
});

test("chegara: kamida N foydalanuvchi; limit va o'chirish sozlamalari ishlaydi", async () => {
  await settings.set('popular_leagues_min_users', 2);
  popularity.clearCache();
  assert.deepStrictEqual(await popularity.popularIds(), [369]);
  await settings.set('popular_leagues_min_users', 1);
  popularity.clearCache();
  assert.deepStrictEqual(await popularity.popularIds(), [369, 500]);
  await settings.set('popular_leagues_limit', 1);
  popularity.clearCache();
  assert.deepStrictEqual(await popularity.popularIds(), [369]);
  await settings.set('popular_leagues_enabled', false);
  popularity.clearCache();
  assert.deepStrictEqual(await popularity.popularIds(), []);
  await settings.set('popular_leagues_enabled', true);
  await settings.set('popular_leagues_limit', 10);
  await db.query("UPDATE league_popularity SET day = day - 30 WHERE league_id = 500");
  popularity.clearCache();
  assert.deepStrictEqual(await popularity.popularIds(), [369], 'eski kunlar hisobga olinmaydi');
});

test("tartib: asosiy → ommabop → qolganlari; Mini App qiziqishni yozadi", async () => {
  popularity.clearCache();
  const r = await call('/api/matches?date=2026-11-18', 7001);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.matches.map((m) => m.competition.id), [39, 369, 500, 400]);
  assert.deepStrictEqual(r.body.matches.map((m) => [m.featured, m.popular]), [[true, false], [false, true], [false, false], [false, false]]);

  const before = (await db.one('SELECT users FROM league_popularity WHERE league_id = 400 AND day = (now() AT TIME ZONE \'Asia/Tashkent\')::date')) || { users: 0 };
  assert.strictEqual((await call('/api/stats/league/400', 7001, { method: 'POST' })).status, 200);
  await call('/api/stats/league/400', 7001, { method: 'POST' });
  await new Promise((res) => setTimeout(res, 50));
  const after = await db.one('SELECT users FROM league_popularity WHERE league_id = 400 AND day = (now() AT TIME ZONE \'Asia/Tashkent\')::date');
  assert.strictEqual(after.users, before.users + 1);

  const comps = await call('/api/competitions', 7001);
  assert.deepStrictEqual(comps.body.featured.map((c) => c.id), [39]);
  assert.deepStrictEqual(comps.body.popular.map((c) => c.id), [369]);
});

test("web admin: ommaboplik sozlamalari va statistika", async () => {
  await call('/api/me', 1000);
  const d = await call('/api/admin/featured-leagues', 1000);
  assert.strictEqual(d.body.popular.enabled, true);
  assert.ok(d.body.popular.stats.some((x) => x.league_id === 369));
  assert.strictEqual((await call('/api/admin/popular-settings', 1000, { method: 'PUT', body: { enabled: true, days: 0, limit: 5, minUsers: 1 } })).status, 400);
  const ok = await call('/api/admin/popular-settings', 1000, { method: 'PUT', body: { enabled: true, days: 7, limit: 5, minUsers: 1 } });
  assert.deepStrictEqual(ok.body, { enabled: true, days: 7, limit: 5, minUsers: 1 });
  assert.strictEqual(await settings.get('popular_leagues_days'), 7);
  assert.strictEqual((await call('/api/admin/popular-settings', 7001, { method: 'PUT', body: { enabled: false, days: 7, limit: 5, minUsers: 1 } })).status, 403);
});

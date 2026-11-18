// 🔍 Qidiruv: jamoalar va jamoa o'yinlari
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');

const requests = [];
const fx = (id, short, offsetH) => ({ fixture: { id, timestamp: Math.floor(Date.now() / 1000) + offsetH * 3600, status: { short } }, league: { id: 39, name: 'Premier League', country: 'England' }, teams: { home: { id: 42, name: 'Arsenal' }, away: { id: id, name: `Rival ${id}` } }, goals: { home: short === 'FT' ? 2 : null, away: short === 'FT' ? 1 : null }, score: {} });

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'S' }, process.env.BOT_TOKEN)}` });
const call = async (path) => { const r = await fetch(`${base}${path}`, { headers: auth(8001) }); return { status: r.status, body: await r.json() }; };

test.before(async () => {
  await resetDb();
  football.setFetch(async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    requests.push(u.pathname + u.search);
    let response = [];
    if (u.pathname === '/teams') response = [{ team: { id: 42, name: 'Arsenal', country: 'England', logo: 'a.png', national: false } }, { team: { id: 43, name: 'Arsenal Tula', country: 'Russia' } }];
    if (u.pathname === '/fixtures' && q.next) response = [fx(2, 'NS', 48), fx(1, 'NS', 24)];
    if (u.pathname === '/fixtures' && q.last) response = [fx(3, 'FT', -48), fx(4, 'FT', -24)];
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response }) };
  });
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test("so'rov matni normallashtiriladi (kesh bir xil so'rovlar uchun bitta)", () => {
  assert.strictEqual(football.normalizeQuery('  ARSENAL!! '), 'arsenal');
  assert.strictEqual(football.normalizeQuery('Atlético  Madrid'), 'atletico madrid');
  assert.strictEqual(football.normalizeQuery('<script>'), 'script');
});

test("jamoa qidiruvi: 3 harfdan kam bo'lsa API'ga so'rov ketmaydi; bir xil qidiruv keshdan", async () => {
  requests.length = 0;
  assert.deepStrictEqual(await football.searchTeams('ar'), []);
  assert.strictEqual(requests.length, 0);
  const r1 = await football.searchTeams('Arsenal');
  const r2 = await football.searchTeams('  arsenal ');
  assert.strictEqual(requests.length, 1, 'ikkinchi qidiruv keshdan');
  assert.deepStrictEqual(r1, r2);
  assert.deepStrictEqual(r1[0], { id: 42, name: 'Arsenal', logo: 'a.png', country: 'England', national: false });
});

test('API: jamoa qidiruvi va jamoa o\'yinlari (keyingilar — vaqt bo\'yicha, oxirgilar — teskari)', async () => {
  const s = await call('/api/search/teams?q=Arsenal');
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.body.teams.length, 2);
  const m = await call('/api/teams/42/matches');
  assert.strictEqual(m.status, 200);
  assert.deepStrictEqual(m.body.next.map((x) => x.id), [1, 2]);
  assert.deepStrictEqual(m.body.last.map((x) => x.id), [4, 3]);
  assert.strictEqual(m.body.last[0].state, 'finished');
  const bad = await call('/api/teams/abc/matches');
  assert.deepStrictEqual(bad.body, { next: [], last: [] });
  assert.strictEqual((await fetch(`${base}/api/search/teams?q=Arsenal`)).status, 401, 'Telegram foydalanuvchisi talab qilinadi');
});

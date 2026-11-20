// ⭐ Sevimli jamoa: tanlash (Mini App API), gol va yakun haqida botda xabar, API yuklamasi
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const favTeam = require('../src/services/favTeam');

let h;
let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `F${id}` }, process.env.BOT_TOKEN)}`, 'Content-Type': 'application/json' });
const call = async (path, id, body) => {
  const r = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: auth(id), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// Soxta API: bitta o'yin (Arsenal 42 — Chelsea 49), holati test davomida o'zgaradi
const M = { short: 'NS', gh: null, ga: null, elapsed: null, kickoff: Date.now() + 2 * 3600000 };
const requests = [];
football.setFetch(async (url) => {
  const u = new URL(url);
  requests.push(u.pathname + u.search);
  let response = [];
  if (u.pathname === '/teams') response = [{ team: { id: Number(u.searchParams.get('id')), name: u.searchParams.get('id') === '42' ? 'Arsenal' : 'Chelsea', logo: 'https://media.example/42.png', country: 'England' } }];
  if (u.pathname === '/fixtures' && u.searchParams.get('date')) {
    response = [{
      fixture: { id: 7001, timestamp: Math.floor(M.kickoff / 1000), status: { short: M.short, elapsed: M.elapsed } },
      league: { id: 39, name: 'Premier League', country: 'England', season: 2026 },
      teams: { home: { id: 42, name: 'Arsenal', logo: null }, away: { id: 49, name: 'Chelsea', logo: null } },
      goals: { home: M.gh, away: M.ga },
    }];
  }
  return { ok: true, status: 200, headers: new Map([['x-ratelimit-requests-remaining', '90']]), json: async () => ({ errors: [], response }) };
});

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [9101, 9102, 9103]) { await h.text(tg, '/start'); await h.click(tg, 'lang:uz'); }
});
test.after(async () => { server.close(); await db.pool.end(); });

test('⭐ Mini App: jamoa tanlash, /me da ko\'rinadi, olib tashlash', async () => {
  const r = await call('/favorite-team', 9101, { teamId: 42 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.favoriteTeam, { id: 42, name: 'Arsenal', logo: 'https://media.example/42.png' });
  assert.strictEqual((await call('/me', 9101)).body.user.favoriteTeam.name, 'Arsenal');
  assert.strictEqual((await call('/favorite-team', 9101, { teamId: 'abc' })).status, 400);
  await call('/favorite-team', 9103, { teamId: 42 });
  assert.strictEqual((await call('/favorite-team', 9103, { teamId: null })).body.favoriteTeam, null);
  await call('/favorite-team', 9102, { teamId: 49 });
});

test("⭐ gol va yakun: muxlislarga xabar (o'z jamoasi / raqib), bir marta; o'yin yo'q paytda API so'ralmaydi", async () => {
  favTeam.reset();
  // O'yin hali uzoq — kesh paydo bo'lgach API qayta so'ralmaydi
  await favTeam.tick(Date.now(), { force: true });
  requests.length = 0;
  await favTeam.tick(Date.now(), { force: true });
  assert.strictEqual(requests.length, 0, 'oyna tashqarisida API so\'ralmadi');

  // O'yin boshlandi: birinchi ko'rish — xabarsiz
  await football.clearCache();
  Object.assign(M, { short: '1H', gh: 0, ga: 0, elapsed: 5, kickoff: Date.now() - 5 * 60000 });
  await favTeam.tick(Date.now(), { force: true });
  h.clear();
  // Arsenal gol urdi
  await football.clearCache();
  Object.assign(M, { gh: 1, elapsed: 23 });
  assert.strictEqual(await favTeam.tick(Date.now(), { force: true }), 1);
  const arsenalFan = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === 9101).payload;
  assert.ok(arsenalFan.text.startsWith('⚽ <b>GOOOL! Arsenal!</b> · 23'), arsenalFan.text);
  assert.ok(arsenalFan.text.includes('Arsenal <b>1–0</b> Chelsea'));
  assert.ok(arsenalFan.message_effect_id, '🔥 effekt');
  assert.ok(h.texts(9102)[0].startsWith('😬 <b>Arsenal gol urdi</b>'));
  assert.strictEqual(h.texts(9103).length, 0, 'jamoasi olib tashlangan — xabar yo\'q');
  // Hisob o'zgarmasa — takror xabar yo'q
  h.clear();
  assert.strictEqual(await favTeam.tick(Date.now(), { force: true }), 0);

  // O'yin tugadi 1—1 (Chelsea goli + yakun)
  await football.clearCache();
  Object.assign(M, { short: 'FT', ga: 1, elapsed: 90 });
  h.clear();
  assert.strictEqual(await favTeam.tick(Date.now(), { force: true }), 2);
  assert.ok(h.texts(9101).some((x) => x.startsWith('😬 <b>Chelsea gol urdi</b>')));
  assert.ok(h.texts(9101).some((x) => x.startsWith('🤝 <b>Durang</b>')));
  assert.ok(h.texts(9102).some((x) => x.startsWith('⚽ <b>GOOOL! Chelsea!</b>')));
  h.clear();
  await football.clearCache();
  assert.strictEqual(await favTeam.tick(Date.now(), { force: true }), 0, 'yakun bir marta');
});

test('⭐ bildirishnomani o\'chirgan muxlisga xabar kelmaydi', async () => {
  await h.click(9101, 'm:settings');
  await h.click(9101, 'nt:fav_team');
  const u = await db.one('SELECT notify FROM users WHERE telegram_id = 9101');
  assert.strictEqual(u.notify.fav_team, false);
  const notify = require('../src/services/notify');
  assert.strictEqual(notify.isEnabled(await db.one('SELECT * FROM users WHERE telegram_id = 9101'), 'fav_team'), false);
  assert.strictEqual(notify.isEnabled(await db.one('SELECT * FROM users WHERE telegram_id = 9102'), 'fav_team'), true);
});

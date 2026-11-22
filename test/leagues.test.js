// 👥 Do'stlar ligasi (sinov) va 🏁 natija ekrani uchun /api/me/place
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const leaderboard = require('../src/services/leaderboard');

let h;
let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `L${id}` }, process.env.BOT_TOKEN)}`, 'Content-Type': 'application/json' });
const call = async (path, id, body) => {
  const r = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: auth(id), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [9701, 9702, 9703, 9704]) await call('/me', tg);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("👥 liga: ochish, havola bo'yicha qo'shilish, reyting (umumiy points), chiqarish, chiqish", async () => {
  assert.strictEqual((await call('/leagues', 9701, { name: 'ab' })).body.error, 'bad_name');
  const created = await call('/leagues', 9701, { name: 'Universitet do\'stlari' });
  assert.strictEqual(created.status, 200);
  const id = created.body.id;
  const lg = await db.one('SELECT * FROM friend_leagues WHERE id = $1', [id]);

  // Taklif oldidan ko'rish va qo'shilish
  const pv = (await call(`/leagues/invite/${lg.code}`, 9702)).body;
  assert.deepStrictEqual([pv.name, pv.members, pv.mine], ["Universitet do'stlari", 1, false]);
  assert.strictEqual((await call('/leagues/join', 9702, { code: lg.code })).body.id, id);
  await call('/leagues/join', 9703, { code: lg.code });
  assert.strictEqual((await call('/leagues/join', 9703, { code: 'nope' })).status, 404);
  // A'zo bo'lmagan ko'ra olmaydi
  assert.strictEqual((await call(`/leagues/${id}`, 9704)).body.error, 'not_member');

  // Points: 9702 — 6 (penalty), 9703 — 3; 9701 — 0
  const [b, c] = [await uid(9702), await uid(9703)];
  await db.query("INSERT INTO penalty_games (user_id, status, result, points, finished_at) VALUES ($1, 'finished', 'win', 6, now()), ($2, 'finished', 'win', 3, now())", [b, c]);
  leaderboard.clearRankingCache();
  const d = (await call(`/leagues/${id}?period=weekly`, 9701)).body;
  assert.deepStrictEqual(d.standings.map((x) => [x.name, x.points, x.place]), [['L9702', 6, 1], ['L9703', 3, 2], ['L9701', 0, 3]]);
  assert.strictEqual(d.owner, true);
  assert.ok(d.link === null || d.link.includes(`lg_${lg.code}`));
  const list = (await call('/leagues', 9703)).body.leagues;
  assert.deepStrictEqual([list[0].members, list[0].place, list[0].leader], [3, 2, 'L9702']);

  // Faqat egasi chiqaradi
  assert.strictEqual((await call(`/leagues/${id}/kick`, 9702, { tgId: 9703 })).body.error, 'not_owner');
  await call(`/leagues/${id}/kick`, 9701, { tgId: 9703 });
  assert.strictEqual((await call(`/leagues/${id}`, 9703)).body.error, 'not_member');
  // Egasi chiqsa — liga keyingi a'zoga o'tadi
  await call(`/leagues/${id}/leave`, 9701, {});
  assert.strictEqual(Number((await db.one('SELECT owner_id FROM friend_leagues WHERE id = $1', [id])).owner_id), b);
  await call(`/leagues/${id}/leave`, 9702, {});
  assert.strictEqual(await db.one('SELECT 1 FROM friend_leagues WHERE id = $1', [id]), null, "a'zo qolmasa — o'chiriladi");
});

test("👥 cheklovlar: a'zolar soni, ligalar soni, o'chirilgan rejim; bot taklifi", async () => {
  await settings.set('leagues_max_members', 2);
  const id = (await call('/leagues', 9704, { name: 'Kichik liga' })).body.id;
  const { code } = await db.one('SELECT code FROM friend_leagues WHERE id = $1', [id]);
  await call('/leagues/join', 9701, { code });
  assert.strictEqual((await call('/leagues/join', 9702, { code })).body.error, 'full');
  await settings.set('leagues_max_members', 50);
  await settings.set('leagues_max_per_user', 1);
  assert.strictEqual((await call('/leagues', 9701, { name: 'Yana bir' })).body.error, 'too_many');
  await settings.set('leagues_max_per_user', 10);

  // Bot: t.me/<bot>?start=lg_<kod> → taklif xabari Mini App tugmasi bilan
  h.clear();
  await h.text(9705, `/start lg_${code}`);
  const msg = h.texts(9705).find((x) => x.startsWith('👥'));
  assert.ok(msg && msg.includes('Kichik liga'), JSON.stringify(h.texts(9705)));

  await settings.set('leagues_enabled', false);
  assert.strictEqual((await call('/leagues', 9702)).body.enabled, false);
  assert.strictEqual((await call('/leagues', 9702, { name: 'Taqiqlangan' })).body.error, 'disabled');
  await settings.set('leagues_enabled', true);
});

test("🏁 /api/me/place: haftalik umumiy o'rin va points", async () => {
  leaderboard.clearRankingCache();
  const p = (await call('/me/place?fresh=1', 9702)).body;
  assert.deepStrictEqual([p.place, p.points], [1, 6]);
  const none = (await call('/me/place', 9704)).body;
  assert.strictEqual(none.place, null);
});

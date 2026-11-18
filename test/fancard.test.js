// 🪪 Muxlislik kartasi
const test = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { db, resetDb } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const fancard = require('../src/services/fancard');

/** Sun'iy logotip: oq fon, katta qizil doira va kichik ko'k qism */
function logoPng() {
  const png = new PNG({ width: 60, height: 60 });
  for (let y = 0; y < 60; y += 1) for (let x = 0; x < 60; x += 1) {
    const i = (y * 60 + x) * 4;
    let c = [255, 255, 255, 255];
    if ((x - 30) ** 2 + (y - 30) ** 2 < 600) c = [200, 16, 46, 255];
    if (x > 50 && y > 50) c = [20, 40, 160, 255];
    if (x < 3) c = [0, 0, 0, 0];
    png.data.set(c, i);
  }
  return PNG.sync.write(png);
}

let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'Sardor' }, process.env.BOT_TOKEN)}` });
async function call(path, id, opts = {}) {
  const res = await fetch(`${base}${path}`, { method: opts.method || 'GET', headers: { ...auth(id), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.before(async () => {
  await resetDb();
  football.setFetch(async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    let response = [];
    if (u.pathname === '/teams' && q.id === '50') response = [{ team: { id: 50, name: 'Red City', logo: 'https://media.example/50.png', country: 'England' } }];
    if (u.pathname === '/players/squads') response = [{ players: [{ id: 1, name: 'Foden', position: 'Midfielder' }] }];
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response }) };
  });
  fancard.setFetch(async () => ({ ok: true, arrayBuffer: async () => logoPng() }));
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test('logotipdan klub ranglari: oq fon va shaffof joylar hisobga olinmaydi', () => {
  const c = fancard.dominantColors(logoPng());
  assert.strictEqual(c.primary, '#c8102e');
  assert.strictEqual(c.secondary, '#1428a0');
  assert.strictEqual(fancard.textOn('#c8102e'), '#f3f7f4');
  assert.strictEqual(fancard.textOn('#ffe14d'), '#0c1712');
});

test("Oddiy karta: yashil uslub, logotip yo'q; noto'g'ri qiymatlar rad etiladi", async () => {
  await call('/api/me', 9001);
  const empty = await call('/api/fan-card', 9001);
  assert.strictEqual(empty.status, 200);
  assert.strictEqual(empty.body.card.filled, 0);
  assert.strictEqual(empty.body.card.regions.length, 15);
  for (const bad of [{ region: 'mars' }, { since: 2999 }, { since: 1800 }, { player: 'x'.repeat(41) }, { teamId: 'abc' }]) {
    assert.strictEqual((await call('/api/fan-card', 9001, { method: 'PUT', body: bad })).status, 400, JSON.stringify(bad));
  }
  const r = await call('/api/fan-card', 9001, { method: 'PUT', body: { teamId: 50, player: '  Foden <b> ', region: 'tashkent_city', since: 2016 } });
  assert.strictEqual(r.status, 200);
  const c = r.body.card;
  assert.deepStrictEqual({ team: c.team, player: c.player, region: c.region.name, since: c.since, filled: c.filled },
    { team: { id: 50, name: 'Red City', logo: null }, player: 'Foden b', region: 'Toshkent shahri', since: 2016, filled: 4 });
  assert.strictEqual(c.style.kind, 'standard');
  assert.strictEqual(c.style.bg, '#16241d');
  assert.ok(r.body.imageUrl.startsWith('https://fc.example.com/card/9001-'));
  const squad = await call('/api/teams/50/squad', 9001);
  assert.deepStrictEqual(squad.body.players, ['Foden']);
});

test('Premium karta: klub logotipi va logotipdan olingan klub rangi', async () => {
  await call('/api/me', 9002);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '30 days' WHERE telegram_id = 9002");
  const r = await call('/api/fan-card', 9002, { method: 'PUT', body: { teamId: 50, region: 'tashkent_city' } });
  const c = r.body.card;
  assert.strictEqual(c.premium, true);
  assert.strictEqual(c.team.logo, 'https://media.example/50.png');
  assert.deepStrictEqual(c.style, { kind: 'club', bg: '#c8102e', accent: '#1428a0', text: '#f3f7f4' });
  assert.deepStrictEqual(c.stats, { total: 2, sameTeam: 2, sameRegion: 2 }, 'statistika');
});

test('Stories rasmi: imzolangan manzil, PNG 1080×1920; soxta imzo — 404', async () => {
  const good = fancard.imagePath(9002);
  const res = await fetch(`${base}${good}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  const img = PNG.sync.read(buf);
  assert.deepStrictEqual([img.width, img.height], [1080, 1920]);
  assert.strictEqual((await fetch(`${base}/card/9002-${'0'.repeat(20)}.png`)).status, 404);
  assert.strictEqual((await fetch(`${base}/card/9003-${good.split('-')[1]}`)).status, 404, 'boshqa foydalanuvchi uchun imzo ishlamaydi');
  const svg = fancard.cardSvg(await fancard.getCard({ id: (await db.one('SELECT id FROM users WHERE telegram_id = 9002')).id }, 'ru'), 'ru', { botUsername: 'fc_bot' });
  assert.match(svg, /КАРТА БОЛЕЛЬЩИКА/);
  assert.match(svg, /@fc_bot/);
  assert.doesNotMatch(svg, /<b>/, 'matn escape qilingan');
});

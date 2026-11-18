// 👥 Fan community'lar
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const fancard = require('../src/services/fancard');
const community = require('../src/services/community');
const leaderboard = require('../src/services/leaderboard');
const { weekRange, prevRange } = require('../src/services/time');

const OWNER = 1000; // ADMIN_IDS
const A = 7101; // Red City, birinchi community egasi
const B = 7102; // Red City, ikkinchi community egasi (pullik)
const M1 = 7103; // Red City a'zosi
const M2 = 7104; // Red City a'zosi
const X = 7105; // Blue klubi muxlisi
const F = 7106; // Premiumsiz

let server;
let base;
let h;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `U${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, opts = {}) {
  const res = await fetch(`${base}${path}`, { method: opts.method || 'GET', headers: { ...auth(id), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;
async function fan(tg, teamId, teamName, { birth = 2000, gender = 'male', region = 'tashkent_city', goat = 'Lionel Messi', player = 'Foden' } = {}) {
  await call('/api/me', tg);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '30 days' WHERE telegram_id = $1", [tg]);
  const id = await uid(tg);
  await db.query('INSERT INTO fan_team_counters (team_id, last_number) VALUES ($1, 1) ON CONFLICT (team_id) DO UPDATE SET last_number = fan_team_counters.last_number + 1', [teamId]);
  const n = (await db.one('SELECT last_number FROM fan_team_counters WHERE team_id = $1', [teamId])).last_number;
  await db.query(
    `INSERT INTO fan_cards (user_id, team_id, team_name, fan_number, last_name, first_name, birth_year, gender, goat, fav_player, region, fan_since)
     VALUES ($1,$2,$3,$4,'Aliyev','Aziz',$5,$6,$7,$8,$9,2015)`,
    [id, teamId, teamName, n, birth, gender, goat, player, region],
  );
  return id;
}
async function quizPoints(tg, points, at) {
  const q = await db.one("SELECT id FROM quiz_questions WHERE source = 'bank' ORDER BY id OFFSET $1 LIMIT 1", [Math.floor(Math.random() * 900)]);
  await db.query(
    `INSERT INTO quiz_answers (user_id, question_id, started_at, answered_at, points_earned, response_time_seconds, selected_option)
     VALUES ($1,$2,$3,$3,$4,3,'A') ON CONFLICT DO NOTHING`, [await uid(tg), q.id, at, points],
  );
  leaderboard.clearRankingCache();
}

test.before(async () => {
  await resetDb();
  h = createTestBot();
  football.setFetch(async (url) => {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    const response = id === '60' ? [{ team: { id: 60, name: 'Blue United', logo: null } }] : [{ team: { id: 50, name: 'Red City', logo: null } }];
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response }) };
  });
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('/api/me', OWNER);
  for (const [tg, team, name, opts] of [[A, 50, 'Red City', { birth: 1990 }], [B, 50, 'Red City', {}], [M1, 50, 'Red City', { gender: 'female', region: 'samarkand' }], [M2, 50, 'Red City', {}], [X, 60, 'Blue United', {}]]) {
    await fan(tg, team, name, opts);
  }
  await call('/api/me', F);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("ochish so'rovi: Premium va karta kerak, nom tekshiriladi; klubning birinchisi bepul", async () => {
  assert.strictEqual((await call('/api/community', F, { method: 'POST', body: { name: 'Free fans' } })).status, 402);
  const short = await call('/api/community', A, { method: 'POST', body: { name: 'ab' } });
  assert.deepStrictEqual([short.status, short.body.error], [400, 'bad_name']);
  const ov0 = await call('/api/community', A);
  assert.deepStrictEqual([ov0.body.card.teamName, ov0.body.createPrice, ov0.body.my, ov0.body.standings], ['Red City', 0, null, []]);
  h.clear();
  const r = await call('/api/community', A, { method: 'POST', body: { name: '  Red  Army ', description: 'Eng sodiq muxlislar' } });
  assert.deepStrictEqual([r.status, r.body.price], [200, 0]);
  await new Promise((res) => setTimeout(res, 50));
  const adminMsg = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === OWNER);
  assert.match(adminMsg.payload.text, /^👥 <b>Yangi fan community so'rovi #\d+<\/b>[\s\S]*Red City[\s\S]*Red Army/);
  assert.deepStrictEqual(adminMsg.payload.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`cm:ok:${r.body.id}`, `cm:no:${r.body.id}`]);
  assert.strictEqual((await call('/api/community', A, { method: 'POST', body: { name: 'Ikkinchi' } })).body.error, 'already_pending');
  const pend = await call('/api/community', A);
  assert.strictEqual(pend.body.pending.name, 'Red Army');
});

test("admin botda tasdiqlaydi: community ochiladi, egasi a'zo, xabar oladi", async () => {
  const req = await db.one("SELECT * FROM communities WHERE name = 'Red Army'");
  h.clear();
  await h.text(OWNER, '/start');
  await h.click(OWNER, 'lang:uz').catch(() => {});
  h.clear();
  await h.click(OWNER, `cm:ok:${req.id}`);
  const c = await db.one('SELECT * FROM communities WHERE id = $1', [req.id]);
  assert.deepStrictEqual([c.status, Number(c.price)], ['active', 0]);
  assert.strictEqual((await db.one('SELECT role FROM community_members WHERE user_id = $1', [await uid(A)])).role, 'owner');
  assert.match(h.lastText(A), /^🎉 «Red Army» fan community'ngiz ochildi!/);
  await h.click(OWNER, `cm:ok:${req.id}`);
  assert.ok(h.alerts().some((x) => /allaqachon/.test(x)), 'qayta tasdiqlab bo\'lmaydi');
});

test("klubning keyingi community'si pullik: pul tasdiqlanganda yechiladi, balans yetmasa — kutishda", async () => {
  await settings.set('community_extra_price', 1000000);
  const ov = await call('/api/community', B);
  assert.strictEqual(ov.body.createPrice, 1000000);
  const r = await call('/api/community', B, { method: 'POST', body: { name: 'Cityzens' } });
  assert.strictEqual(r.body.price, 1000000);
  h.clear();
  await h.click(OWNER, `cm:ok:${r.body.id}`);
  assert.ok(h.alerts().some((x) => /mablag' yetarli emas/.test(x)));
  assert.strictEqual((await db.one('SELECT status FROM communities WHERE id = $1', [r.body.id])).status, 'pending');
  // Web admin orqali, balans to'ldirilgach
  await db.query('UPDATE users SET balance = 1200000 WHERE telegram_id = $1', [B]);
  assert.strictEqual((await call(`/api/admin/communities/${r.body.id}/approve`, OWNER, { method: 'POST' })).status, 200);
  assert.strictEqual(Number((await db.one('SELECT balance FROM users WHERE telegram_id = $1', [B])).balance), 200000);
  assert.match(h.lastText(B), /Balansingizdan 1 000 000 so'm yechildi/);
  const list = await call('/api/admin/communities', OWNER);
  assert.strictEqual(list.body.communities.filter((c) => c.status === 'active').length, 2);
  assert.strictEqual((await call('/api/admin/communities', A)).status, 403);
});

test("a'zolik: faqat shu klub muxlislari, har kim bitta community'da", async () => {
  const red = await db.one("SELECT id FROM communities WHERE name = 'Red Army'");
  const city = await db.one("SELECT id FROM communities WHERE name = 'Cityzens'");
  assert.strictEqual((await call(`/api/community/${red.id}/join`, X, { method: 'POST' })).body.error, 'wrong_club');
  assert.strictEqual((await call(`/api/community/${red.id}/join`, F, { method: 'POST' })).status, 402);
  assert.strictEqual((await call(`/api/community/${red.id}/join`, M1, { method: 'POST' })).status, 200);
  assert.strictEqual((await call(`/api/community/${city.id}/join`, M1, { method: 'POST' })).body.error, 'already_member');
  assert.strictEqual((await call(`/api/community/${red.id}/join`, M2, { method: 'POST' })).status, 200);
  assert.strictEqual((await call('/api/community', M2, { method: 'POST', body: { name: 'Yangi' } })).body.error, 'already_member');
  const ov = await call('/api/community', M1);
  assert.deepStrictEqual(ov.body.my, { id: red.id, role: 'member' });
});

test("egasi: post, tahrirlash, a'zoni chiqarish (qayta qo'shila olmaydi); a'zo chiqib ketadi, egasi chiqa olmaydi", async () => {
  const red = await db.one("SELECT id FROM communities WHERE name = 'Red Army'");
  assert.strictEqual((await call(`/api/community/${red.id}/posts`, M1, { method: 'POST', body: { text: 'Salom' } })).status, 403);
  const post = await call(`/api/community/${red.id}/posts`, A, { method: 'POST', body: { text: 'Shanba kuni hammamiz Mini Manager o\'ynaymiz!' } });
  assert.strictEqual(post.status, 200);
  assert.strictEqual((await call(`/api/community/${red.id}`, A, { method: 'PATCH', body: { name: 'Red Army UZ', description: 'Yangi tavsif' } })).status, 200);
  assert.strictEqual((await call(`/api/community/${red.id}`, M1, { method: 'PATCH', body: { name: 'Hack' } })).status, 403);
  const page = await call(`/api/community/${red.id}`, M1);
  assert.deepStrictEqual([page.body.name, page.body.isMember, page.body.isOwner, page.body.posts.length, page.body.members, page.body.memberList.length], ['Red Army UZ', true, false, 1, 3, 3]);
  // Statistika — muxlislik kartalaridan
  assert.deepStrictEqual([page.body.stats.members, page.body.stats.male, page.body.stats.female], [3, 2, 1]);
  assert.ok(page.body.stats.regions.some((r) => r.name === 'Samarqand viloyati'));
  assert.deepStrictEqual(page.body.stats.goats[0], { name: 'Lionel Messi', n: 3 });
  // Reaksiyalar: a'zo bitta reaksiya qo'yadi, almashtiradi, qayta bossa olib tashlanadi; a'zo bo'lmagan qo'ya olmaydi
  const react = (id, reaction) => call(`/api/community/posts/${post.body.id}/react`, id, { method: 'POST', body: { reaction } });
  assert.deepStrictEqual(page.body.posts[0].reactions, { like: 0, ball: 0, fire: 0 });
  assert.deepStrictEqual((await react(M1, 'fire')).body.reactions, { like: 0, ball: 0, fire: 1 });
  let r = await react(M2, 'fire');
  assert.deepStrictEqual([r.body.reactions.fire, r.body.myReaction], [2, 'fire']);
  r = await react(M2, 'like');
  assert.deepStrictEqual([r.body.reactions, r.body.myReaction], [{ like: 1, ball: 0, fire: 1 }, 'like']);
  r = await react(M2, 'like');
  assert.deepStrictEqual([r.body.reactions, r.body.myReaction], [{ like: 0, ball: 0, fire: 1 }, null]);
  assert.strictEqual((await react(A, 'ball')).status, 200, 'egasi ham reaksiya qo\'yadi');
  assert.strictEqual((await react(X, 'like')).body.error, 'not_member');
  assert.strictEqual((await react(M1, 'heart')).body.error, 'bad_reaction');
  const again = await call(`/api/community/${red.id}`, M1);
  assert.deepStrictEqual([again.body.posts[0].reactions, again.body.posts[0].myReaction], [{ like: 0, ball: 1, fire: 1 }, 'fire']);
  h.clear();
  assert.strictEqual((await call(`/api/community/${red.id}/kick`, A, { method: 'POST', body: { userId: await uid(M2) } })).status, 200);
  await new Promise((res) => setTimeout(res, 50));
  assert.match(h.lastText(M2), /^🚫 Siz «Red Army UZ» fan community'sidan chiqarildingiz/);
  assert.strictEqual((await call(`/api/community/${red.id}/join`, M2, { method: 'POST' })).body.error, 'banned');
  assert.strictEqual((await call('/api/community/leave', A, { method: 'POST' })).body.error, 'owner_cannot_leave');
  assert.strictEqual((await call(`/api/community/posts/${post.body.id}`, A, { method: 'DELETE' })).status, 200);
});

test("haftalik reyting: a'zolar points yig'indisi; hafta tugagach g'olib bir marta yoziladi va hammaga xabar", async () => {
  const red = await db.one("SELECT id FROM communities WHERE name = 'Red Army UZ'");
  const city = await db.one("SELECT id FROM communities WHERE name = 'Cityzens'");
  const now = new Date();
  await quizPoints(A, 2, now);
  await quizPoints(M1, 1, now);
  await quizPoints(B, 2, now);
  const ov = await call('/api/community', A);
  const byId = Object.fromEntries(ov.body.standings.map((c) => [c.id, c]));
  assert.deepStrictEqual([byId[red.id].points, byId[red.id].place, byId[city.id].points], [3, 1, 2]);
  assert.ok(byId[red.id].colors.primary.startsWith('#'), 'klub rangi');

  // O'tgan hafta: Cityzens ko'proq to'plagan
  const prev = prevRange('weekly', now);
  const mid = new Date(prev.start.getTime() + 2 * 86400000);
  await quizPoints(B, 2, mid);
  await quizPoints(M1, 1, mid);
  h.clear();
  const win = await community.finalizeWeek(now);
  assert.strictEqual(win.community.id, city.id);
  assert.strictEqual(win.points, 2);
  assert.strictEqual((await db.one('SELECT wins FROM communities WHERE id = $1', [city.id])).wins, 1);
  assert.strictEqual(await community.finalizeWeek(now), null, 'bir hafta — bir marta');
  await community.announceWinner(win);
  const texts = h.calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text);
  assert.ok(texts.length >= 6, 'hamma foydalanuvchiga');
  assert.ok(texts.every((tx) => /^🏆 Haftaning fan klubi — Red City muxlislari «Cityzens»!/.test(tx)));
  const after = await call('/api/community', X);
  assert.strictEqual(after.body.champion.id, city.id);
  assert.strictEqual(after.body.standings.find((c) => c.id === city.id).wins, 1);
  assert.ok(weekRange(now).start > prev.start);
});

test("kartada klub almashtirilsa — a'zo community'dan chiqadi; egasi klubni almashtira olmaydi", async () => {
  await db.query('UPDATE users SET balance = 100000 WHERE telegram_id IN ($1, $2)', [M1, A]);
  const r = await call('/api/fan-card/club', M1, { method: 'POST', body: { teamId: 60 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(await db.one('SELECT 1 FROM community_members WHERE user_id = $1', [await uid(M1)]), null);
  const o = await call('/api/fan-card/club', A, { method: 'POST', body: { teamId: 60 } });
  assert.deepStrictEqual([o.status, o.body.error], [400, 'community_owner']);
  await fancard.cardRow(await uid(A));
});

test("admin rad etadi (sabab bilan) va yopadi; narx sozlamasi", async () => {
  const req = await call('/api/community', X, { method: 'POST', body: { name: 'Blue Wave' } });
  h.clear();
  await h.click(OWNER, `cm:no:${req.body.id}`);
  assert.match(h.lastText(OWNER), /rad etish sababini yozing/);
  await h.text(OWNER, 'Nom qoidalarga mos emas');
  assert.match(h.lastText(X), /^❌ «Blue Wave» fan community so'rovingiz rad etildi\.\nSabab: Nom qoidalarga mos emas/);
  assert.strictEqual((await db.one('SELECT status FROM communities WHERE id = $1', [req.body.id])).status, 'rejected');

  const city = await db.one("SELECT id FROM communities WHERE name = 'Cityzens'");
  h.clear();
  assert.strictEqual((await call(`/api/admin/communities/${city.id}/close`, OWNER, { method: 'POST' })).status, 200);
  assert.match(h.lastText(B), /^🔒 «Cityzens» fan community admin tomonidan yopildi/);
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM community_members WHERE community_id = $1', [city.id])).n, 0);
  assert.strictEqual((await call(`/api/community/${city.id}`, B)).status, 404);
  assert.strictEqual((await call('/api/admin/community-settings', OWNER, { method: 'PUT', body: { price: -5 } })).status, 400);
  assert.deepStrictEqual((await call('/api/admin/community-settings', OWNER, { method: 'PUT', body: { price: 750000 } })).body, { price: 750000 });
});

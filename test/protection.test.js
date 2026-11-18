// Ortiqcha so'rovlar va yuklamadan himoya
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const football = require('../src/services/football');
const config = require('../src/config');

let calls = 0;
let status = 'NS';
const fx = (short, ms) => ({ fixture: { id: 1, timestamp: Math.floor((Date.now() + ms) / 1000), status: { short } }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: {} });
const envelope = (response, headers = []) => ({ ok: true, status: 200, headers: new Map(headers), json: async () => ({ errors: [], response }) });
let respond = () => envelope([fx(status, 3600e3)]);

test.before(async () => {
  await resetDb();
  football.setFetch(async () => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return respond(); });
});
test.after(async () => { await db.pool.end(); });

test("bir vaqtdagi 50 ta bir xil so'rov — API'ga 1 ta so'rov", async () => {
  await football.clearCache();
  calls = 0;
  const results = await Promise.all(Array.from({ length: 50 }, () => football.rawMatch(1)));
  assert.strictEqual(calls, 1);
  assert.ok(results.every((r) => r.fixture.id === 1));
});

test("kesh bazada saqlanadi: xotira tozalansa (restart/deploy) ham API'ga so'rov ketmaydi", async () => {
  calls = 0;
  const row = await db.one("SELECT key, expires_at FROM api_cache WHERE key = '/fixtures?id=1'");
  assert.ok(row, 'bazada kesh bor');
  // Xotirani tozalash = yangi server nusxasi
  delete require.cache[require.resolve('../src/services/football')];
  const fresh = require('../src/services/football');
  fresh.setFetch(async () => { calls += 1; return respond(); });
  await fresh.rawMatch(1);
  assert.strictEqual(calls, 0);
});

test("eskirgan kesh: darhol eski javob qaytadi, orqada bitta yangilash so'rovi", async () => {
  await db.query("UPDATE api_cache SET expires_at = now() - interval '1 minute'");
  await football.clearCache().catch(() => {});
  await football.rawMatch(1); // bo'sh kesh -> to'g'ridan-to'g'ri
  await db.query("UPDATE api_cache SET expires_at = now() - interval '1 minute'");
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  calls = 0;
  status = '1H';
  f.setFetch(async () => { calls += 1; await new Promise((r) => setTimeout(r, 50)); return respond(); });
  const t0 = Date.now();
  const stale = await Promise.all(Array.from({ length: 20 }, () => f.rawMatch(1)));
  assert.ok(Date.now() - t0 < 50, 'foydalanuvchi API javobini kutmadi');
  assert.ok(stale.every((r) => r.fixture.status.short === 'NS'), 'eski ma\'lumot berildi');
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(calls, 1, 'faqat bitta yangilash so\'rovi');
  assert.strictEqual((await f.rawMatch(1)).fixture.status.short, '1H', 'kesh yangilandi');
  status = 'NS';
});

test("yangilanish vaqti ma'lumot turiga qarab", () => {
  const now = Date.now();
  assert.strictEqual(football.ttlForMatch(fx('2H', -1e6)), 30);
  assert.strictEqual(football.ttlForMatch(fx('FT', -1e7)), 6 * 3600);
  assert.strictEqual(football.ttlForMatch(fx('NS', 30 * 3600e3)), 6 * 3600);
  assert.strictEqual(football.ttlForMatchList([fx('FT', -1e7)], now - 1000), 24 * 3600, "o'tgan kun — 1 kun");
  assert.strictEqual(football.ttlForMatchList([fx('1H', -1e6), fx('NS', 3e6)]), 60, 'jonli — 1 daqiqa');
  const nextIn20min = football.ttlForMatchList([fx('NS', 20 * 60e3)]);
  assert.ok(nextIn20min > 19 * 60 && nextIn20min <= 20 * 60, "keyingi o'yingacha");
});

test("kunlik limit: oxirgi so'rovlar fon vazifalari uchun saqlanadi", async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  await f.clearCache();
  f.setFetch(async () => envelope([fx('NS', 3600e3)], [['x-ratelimit-requests-remaining', '5']]));
  await f.rawMatch(101); // API: bugun 5 ta so'rov qoldi
  await assert.rejects(f.rawMatch(102), (e) => e.reason === 'limit', 'foydalanuvchi so\'rovi yuborilmaydi');
  assert.ok(await f.rawMatch(103, { background: true }), 'fon vazifasi zaxiradan foydalanadi');
});

test("tarifda yo'q ma'lumot (joriy mavsum) — rad javobi keshlanadi, qayta so'ralmaydi", async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  await f.clearCache();
  let n = 0;
  f.setFetch(async () => { n += 1; return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: { plan: 'Free plans do not have access to this season' }, response: [] }) }; });
  await assert.rejects(f.matchesByDate('2026-11-17'), (e) => e.reason === 'plan');
  await assert.rejects(f.matchesByDate('2026-11-17'), (e) => e.reason === 'plan');
  assert.strictEqual(n, 1);
});

test("kunlik limit tugadi (errors.requests) — ertagacha so'rov yuborilmaydi", async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  await f.clearCache();
  let n = 0;
  f.setFetch(async () => { n += 1; return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: { requests: 'You have reached the request limit for the day' }, response: [] }) }; });
  await assert.rejects(f.rawMatch(201), (e) => e.reason === 'limit');
  await assert.rejects(f.rawMatch(202), f.FootballUnavailable);
  assert.strictEqual(n, 1);
});

test("API 'limit tugadi' desa — foydalanuvchi navbatda osilib qolmaydi", async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  await f.clearCache();
  f.setFetch(async () => ({ ok: false, status: 429, headers: new Map(), json: async () => ({}) }));
  await assert.rejects(f.rawMatch(77), f.FootballUnavailable);
  f.setFetch(async () => respond());
  const t0 = Date.now();
  await assert.rejects(f.rawMatch(78), f.FootballUnavailable);
  assert.ok(Date.now() - t0 < 1000, 'darhol rad etildi');
});

test('reyting 30 soniya keshlanadi (bitta hisob-kitob)', async () => {
  const leaderboard = require('../src/services/leaderboard');
  const q = await db.one("INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, published_at) VALUES ('q','a','b','c','d','A', now()) RETURNING id");
  const u = await db.one("INSERT INTO users (telegram_id, first_name, ref_code) VALUES (1, 'A', 'x1') RETURNING id");
  await db.query("INSERT INTO quiz_answers (user_id, question_id, selected_option, points_earned, response_time_seconds, answered_at) VALUES ($1, $2, 'A', 2, 3, now())", [u.id, q.id]);
  const b1 = await leaderboard.board('quiz', 'weekly', u.id);
  assert.strictEqual(b1.top[0].points, 2);
  await db.query('UPDATE quiz_answers SET points_earned = 5');
  assert.strictEqual((await leaderboard.board('quiz', 'weekly', u.id)).top[0].points, 2, 'keshdan');
  leaderboard.clearRankingCache();
  assert.strictEqual((await leaderboard.board('quiz', 'weekly', u.id)).top[0].points, 5);
});

test('spam himoyasi: oynadagi limitdan oshganlari rad etiladi, ogohlantirish bir marta', () => {
  delete require.cache[require.resolve('../src/services/ratelimit')];
  config.rateLimitOff = false;
  try {
    const { createLimiter } = require('../src/services/ratelimit');
    const l = createLimiter({ max: 3, windowMs: 1000 });
    const r = Array.from({ length: 6 }, () => l.hit(42));
    assert.deepStrictEqual(r.map((x) => x.allowed), [true, true, true, false, false, false]);
    assert.deepStrictEqual(r.map((x) => x.warn), [false, false, false, true, false, false]);
    assert.strictEqual(l.hit(43).allowed, true, 'boshqa foydalanuvchiga ta\'sir qilmaydi');
  } finally { config.rateLimitOff = true; }
});

test("foydalanuvchi ma'lumoti o'zgarmasa bazaga qayta yozilmaydi", async () => {
  const users = require('../src/services/users');
  const from = { id: 9001, first_name: 'Z' };
  const a = (await users.upsertFromTelegram(from)).user;
  const b = (await users.upsertFromTelegram(from)).user;
  assert.strictEqual(new Date(a.last_seen_at).getTime(), new Date(b.last_seen_at).getTime());
  const c = (await users.upsertFromTelegram({ ...from, first_name: 'Zz' })).user;
  assert.strictEqual(c.first_name, 'Zz', "ism o'zgarsa yangilanadi");
});

test('API-Football /status tashxisi: tarif va bugungi so\'rovlar, shaxsiy ma\'lumotsiz', async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  f.setFetch(async (url) => {
    assert.match(url, /\/status$/);
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response: { account: { firstname: 'X', email: 'x@example.com' }, subscription: { plan: 'Free', active: true }, requests: { current: 7, limit_day: 100 } } }) };
  });
  const s = await f.checkStatus();
  assert.deepStrictEqual({ ok: s.ok, plan: s.plan, requestsToday: s.requestsToday, limitDay: s.limitDay }, { ok: true, plan: 'Free', requestsToday: 7, limitDay: 100 });
  assert.ok(!JSON.stringify(s).includes('example.com'));
  f.setFetch(async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ errors: { token: 'Error/Missing application key.' }, response: [] }) }));
  assert.strictEqual((await f.checkStatus()).reason, 'token');
});

test("bir necha kunlik o'yinlar: tarifda yo'q kun o'tkazib yuboriladi, qolganlari qaytadi", async () => {
  const fb = require('../src/services/football');
  await fb.clearCache();
  fb.setFetch(async (url) => {
    const date = new URL(url).searchParams.get('date');
    if (date > '2030-01-02') return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: { plan: 'Free plans do not have access to this date' }, response: [] }) };
    return envelope([{ ...fx('NS', 3600e3), fixture: { id: Number(date.slice(-2)), date: `${date}T18:00:00+00:00`, timestamp: Math.floor(Date.parse(`${date}T18:00:00Z`) / 1000), status: { short: 'NS' } } }]);
  });
  const r = await fb.matchesRange('2030-01-01', '2030-01-04');
  assert.deepStrictEqual(r.matches.map((m) => m.id), [1, 2]);
  assert.deepStrictEqual(r.skipped, [{ date: '2030-01-03', reason: 'plan' }, { date: '2030-01-04', reason: 'plan' }]);
  await assert.rejects(() => fb.matchesRange('2030-02-01', '2030-02-02'), (e) => e.reason === 'plan', "hamma kun olinmasa — xato");
});

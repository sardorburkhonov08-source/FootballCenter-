// Ortiqcha so'rovlar va yuklamadan himoya
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const football = require('../src/services/football');
const config = require('../src/config');

let calls = 0;
let status = 'TIMED';
let respond = () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ id: 1, status, utcDate: new Date(Date.now() + 3600e3).toISOString(), homeTeam: { id: 1 }, awayTeam: { id: 2 } }) });

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
  assert.ok(results.every((r) => r.id === 1));
});

test("kesh bazada saqlanadi: xotira tozalansa (restart/deploy) ham API'ga so'rov ketmaydi", async () => {
  calls = 0;
  const row = await db.one("SELECT key, expires_at FROM api_cache WHERE key = '/matches/1'");
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
  status = 'IN_PLAY';
  f.setFetch(async () => { calls += 1; await new Promise((r) => setTimeout(r, 50)); return respond(); });
  const t0 = Date.now();
  const stale = await Promise.all(Array.from({ length: 20 }, () => f.rawMatch(1)));
  assert.ok(Date.now() - t0 < 50, 'foydalanuvchi API javobini kutmadi');
  assert.ok(stale.every((r) => r.status === 'TIMED'), 'eski ma\'lumot berildi');
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(calls, 1, 'faqat bitta yangilash so\'rovi');
  assert.strictEqual((await f.rawMatch(1)).status, 'IN_PLAY', 'kesh yangilandi');
  status = 'TIMED';
});

test("yangilanish vaqti ma'lumot turiga qarab", () => {
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  assert.strictEqual(football.ttlForMatch({ status: 'IN_PLAY', utcDate: iso(-1e6) }), 30);
  assert.strictEqual(football.ttlForMatch({ status: 'FINISHED', utcDate: iso(-1e7) }), 6 * 3600);
  assert.strictEqual(football.ttlForMatch({ status: 'TIMED', utcDate: iso(30 * 3600e3) }), 6 * 3600);
  assert.strictEqual(football.ttlForMatchList([{ status: 'FINISHED', utcDate: iso(-1e7) }], now - 1000), 24 * 3600, "o'tgan kun — 1 kun");
  assert.strictEqual(football.ttlForMatchList([{ status: 'IN_PLAY', utcDate: iso(-1e6) }, { status: 'TIMED', utcDate: iso(3e6) }]), 60, 'jonli — 1 daqiqa');
  const nextIn20min = football.ttlForMatchList([{ status: 'TIMED', utcDate: iso(20 * 60e3) }]);
  assert.ok(nextIn20min > 19 * 60 && nextIn20min <= 20 * 60, "keyingi o'yingacha");
});

test("API 'limit tugadi' desa — foydalanuvchi navbatda osilib qolmaydi", async () => {
  delete require.cache[require.resolve('../src/services/football')];
  const f = require('../src/services/football');
  await f.clearCache();
  f.setFetch(async () => ({ ok: false, status: 429, headers: new Map([['x-requestcounter-reset', '50']]), json: async () => ({}) }));
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

// ⚔️ Duel o'yinlari
process.env.BOT_USERNAME = 'fc_test_bot';
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const duels = require('../src/services/duels');
const leaderboard = require('../src/services/leaderboard');

let h;
let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: `D${id}` }, process.env.BOT_TOKEN)}` });
async function call(path, id, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(id), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const A = 7201;
const B = 7202;
const C = 7203;
const E = 7204;
const FREE = 7205;
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

/** Raund uchun to'g'ri javob kaliti (testda bazadan) */
async function correctKey(duelId, round) {
  const d = await db.one('SELECT * FROM duels WHERE id = $1', [duelId]);
  const r = d.rounds[round];
  if (d.kind === 'quiz') return (await db.one('SELECT correct_option FROM quiz_questions WHERE id = $1', [r.q])).correct_option;
  return String(r.opts.indexOf(r.p));
}
/** Barcha raundlarni o'ynash: rightCount tasi to'g'ri */
async function play(tg, duelId, rightCount) {
  let last;
  for (let i = 0; i < duels.ROUNDS; i += 1) {
    const r = (await call(`/api/duels/${duelId}/next`, tg, { method: 'POST' })).body;
    assert.strictEqual(r.round, i);
    const ok = await correctKey(duelId, i);
    const key = i < rightCount ? ok : r.options.map((o) => o.key).find((k) => k !== ok);
    last = (await call(`/api/duels/${duelId}/answer`, tg, { method: 'POST', body: { round: i, key } })).body;
    assert.strictEqual(last.correct, i < rightCount);
  }
  return last;
}

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const tg of [A, B, C, E, FREE]) await call('/api/me', tg);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days', language = 'uz' WHERE telegram_id = ANY($1)", [[A, B, C, E]]);
  // Quiz duel uchun e'lon qilingan savollar
  await db.query("UPDATE quiz_questions SET published_at = now() - interval '1 day' WHERE id IN (SELECT id FROM quiz_questions WHERE source = 'bank' LIMIT 20)");
});
test.after(async () => { server.close(); await db.pool.end(); });

test("faqat Premium; tasodifiy raqib: kutayotgan duelga qo'shiladi, ikkalasi o'ynagach natija va points", async () => {
  assert.strictEqual((await call('/api/duels', FREE)).status, 402);
  const a = await call('/api/duels', A, { method: 'POST', body: { kind: 'quiz', mode: 'random' } });
  assert.deepStrictEqual([a.body.state, a.body.opponent, a.body.link], ['your_turn', null, null]);
  const b = await call('/api/duels', B, { method: 'POST', body: { kind: 'quiz', mode: 'random' } });
  assert.strictEqual(b.body.id, a.body.id, 'B kutayotgan A duelga qo\'shildi');
  assert.strictEqual(b.body.opponent.name, `D${A}`);
  const id = a.body.id;
  // Raund ma'lumoti: savol va 4 variant, to'g'ri javob ko'rsatilmaydi
  const r0 = (await call(`/api/duels/${id}/next`, A, { method: 'POST' })).body;
  assert.ok(r0.question && r0.options.length === 4 && r0.seconds === 15);
  assert.ok(!('correct' in r0) && !('correctKey' in r0));
  assert.deepStrictEqual((await call(`/api/duels/${id}/next`, A, { method: 'POST' })).body.round, 0, 'boshlangan raund qaytadi');
  await db.query('DELETE FROM duel_answers WHERE duel_id = $1', [id]);

  h.clear();
  await play(A, id, 4);
  assert.strictEqual((await call(`/api/duels/${id}`, A)).body.state, 'opponent_turn');
  assert.strictEqual((await call(`/api/duels/${id}/answer`, A, { method: 'POST', body: { round: 4, key: 'A' } })).body.error, 'already_answered');
  const last = await play(B, id, 3);
  assert.deepStrictEqual([last.last, last.duel.state, last.duel.result], [true, 'finished', { result: 'loss', my: 3, their: 4, points: 0 }]);
  const da = (await call(`/api/duels/${id}`, A)).body;
  assert.deepStrictEqual(da.result, { result: 'win', my: 4, their: 3, points: 10 });
  assert.deepStrictEqual([(await user(A)).points_duel, (await user(B)).points_duel], [10, 0]);
  assert.match(h.lastText(A), /^⚔️ Quiz duel: siz <b>D7202<\/b> ni 4:3 hisobida yutdingiz! 🏆 \+10 points/);
  assert.match(h.lastText(B), /^⚔️ Quiz duel: <b>D7201<\/b> 4:3 hisobida yutdi/);
  assert.deepStrictEqual((await call(`/api/duels/${id}/next`, A, { method: 'POST' })).body.error, 'closed');

  leaderboard.clearRankingCache();
  const lb = (await call('/api/leaderboard/duel/weekly', A)).body;
  assert.deepStrictEqual([lb.top.length, lb.top[0].points, lb.me.place], [1, 10, 1]);
  const prof = (await call('/api/profile', A)).body;
  assert.deepStrictEqual([prof.duel.wins, prof.duel.losses, prof.duel.total], [1, 0, 10]);
  const list = (await call('/api/duels', B)).body;
  assert.deepStrictEqual([list.stats.losses, list.duels[0].state], [1, 'finished']);
});

test("do'stni chaqirish (Futbolchini top): havola, qabul qilish, boshqasi qo'shila olmaydi; vaqt tugasa — xato", async () => {
  const a = await call('/api/duels', A, { method: 'POST', body: { kind: 'player', mode: 'invite' } });
  assert.match(a.body.link, /^https:\/\/t\.me\/.+\?start=duel_[A-Za-z0-9_-]{8}$/);
  const code = a.body.link.split('duel_')[1];
  const pv = (await call(`/api/duels/invite/${code}`, C)).body;
  assert.deepStrictEqual([pv.from, pv.kind, pv.available, pv.mine], [`D${A}`, 'player', true, false]);
  assert.strictEqual((await call(`/api/duels/invite/${code}/join`, A, { method: 'POST' })).body.error, 'own_duel');
  assert.strictEqual((await call(`/api/duels/invite/${code}/join`, FREE, { method: 'POST' })).status, 402);
  const j = await call(`/api/duels/invite/${code}/join`, C, { method: 'POST' });
  assert.deepStrictEqual([j.body.state, j.body.opponent.name], ['your_turn', `D${A}`]);
  assert.strictEqual((await call(`/api/duels/invite/${code}/join`, E, { method: 'POST' })).body.error, 'not_available');
  // Futbolchi raundi: ma'lumotlar va 4 ta ism, to'g'risi ular orasida
  const id = a.body.id;
  const r0 = (await call(`/api/duels/${id}/next`, C, { method: 'POST' })).body;
  assert.ok(r0.clues.country && r0.clues.position && r0.clues.born > 1900 && r0.clues.clubs.length >= 1);
  assert.strictEqual(r0.options.length, 4);
  assert.strictEqual(new Set(r0.options.map((o) => o.text)).size, 4);
  const d = await db.one('SELECT rounds FROM duels WHERE id = $1', [id]);
  assert.ok(r0.options.some((o) => o.text === d.rounds[0].p));
  // Vaqt tugadi: keyingi so'rovda raund xato deb yopiladi va keyingisi chiqadi
  await db.query("UPDATE duel_answers SET started_at = now() - interval '1 minute' WHERE duel_id = $1", [id]);
  const r1 = (await call(`/api/duels/${id}/next`, C, { method: 'POST' })).body;
  assert.strictEqual(r1.round, 1);
  const a0 = await db.one('SELECT * FROM duel_answers WHERE duel_id = $1 AND round = 0', [id]);
  assert.deepStrictEqual([a0.correct, a0.time_ms], [false, 20000]);
  // Kechikib berilgan javob ham hisoblanmaydi
  await db.query("UPDATE duel_answers SET started_at = now() - interval '1 minute' WHERE duel_id = $1 AND round = 1", [id]);
  const late = (await call(`/api/duels/${id}/answer`, C, { method: 'POST', body: { round: 1, key: await correctKey(id, 1) } })).body;
  assert.strictEqual(late.correct, false);
});

test("teng hisob — tezrog'i yutadi; kunlik limitdan keyin points berilmaydi", async () => {
  await settings.set('duel_daily_limit', 1);
  const a = await call('/api/duels', A, { method: 'POST', body: { kind: 'quiz', mode: 'invite' } });
  const code = a.body.link.split('duel_')[1];
  await call(`/api/duels/invite/${code}/join`, E, { method: 'POST' });
  await play(A, a.body.id, 2);
  await play(E, a.body.id, 2);
  const d = a.body.id;
  const res = await db.many('SELECT * FROM duel_results WHERE duel_id = $1', [d]);
  assert.strictEqual(res.length, 2);
  const winner = (await db.one('SELECT winner_id FROM duels WHERE id = $1', [d])).winner_id;
  const fast = res.reduce((x, y) => (x.time_ms <= y.time_ms ? x : y));
  if (res[0].time_ms !== res[1].time_ms) assert.strictEqual(winner, fast.user_id);
  // A bugun allaqachon 1 ta duel o'ynagan (limit 1) — points 0; E uchun birinchi duel — points beriladi (yutsa yoki durang)
  const aId = await uid(A);
  const eRes = res.find((r) => r.user_id !== aId);
  assert.strictEqual(res.find((r) => r.user_id === aId).points, 0, 'A limitdan oshdi');
  assert.strictEqual(eRes.points, eRes.result === 'win' ? 10 : eRes.result === 'draw' ? 3 : 0);
  await settings.set('duel_daily_limit', 10);
});

test("fon vazifasi: kutayotgan duel muddati tugasa bekor, faol duel muddati tugasa — o'ynagani yutadi", async () => {
  const w = await call('/api/duels', E, { method: 'POST', body: { kind: 'player', mode: 'random' } });
  await db.query("UPDATE duels SET expires_at = now() - interval '1 minute' WHERE id = $1", [w.body.id]);
  const a = await call('/api/duels', B, { method: 'POST', body: { kind: 'quiz', mode: 'invite' } });
  await call(`/api/duels/invite/${a.body.link.split('duel_')[1]}/join`, C, { method: 'POST' });
  await play(B, a.body.id, 1);
  await db.query("UPDATE duels SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.body.id]);
  const r = await duels.tick();
  assert.ok(r.expired >= 1 && r.finished >= 1);
  assert.strictEqual((await db.one('SELECT status FROM duels WHERE id = $1', [w.body.id])).status, 'expired');
  const f = await db.one('SELECT * FROM duels WHERE id = $1', [a.body.id]);
  assert.deepStrictEqual([f.status, f.winner_id], ['finished', await uid(B)]);
  // Juda ko'p tugamagan duel ochib bo'lmaydi
  for (let i = 0; i < 5; i += 1) await call('/api/duels', E, { method: 'POST', body: { kind: 'quiz', mode: 'invite' } });
  assert.strictEqual((await call('/api/duels', E, { method: 'POST', body: { kind: 'quiz', mode: 'invite' } })).body.error, 'too_many');
});

test("botda /start duel_<kod>: taklif xabari Mini App tugmasi bilan, yangi foydalanuvchi referral bo'ladi", async () => {
  const a = await call('/api/duels', A, { method: 'POST', body: { kind: 'player', mode: 'invite' } });
  const code = a.body.link.split('duel_')[1];
  h.clear();
  await h.text(7299, `/start duel_${code}`);
  const msg = h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 7299).map((c) => c.payload).find((p) => p.text.startsWith('⚔️'));
  assert.ok(msg, 'taklif xabari');
  assert.match(msg.text, /<b>D7201<\/b> sizni «Futbolchini top» dueliga chaqirdi/);
  assert.ok(msg.reply_markup.inline_keyboard[0][0].web_app.url.endsWith(`/app/?duel=${code}`));
  const ref = await db.one('SELECT r.* FROM referrals r JOIN users u ON u.id = r.referred_id WHERE u.telegram_id = 7299');
  assert.strictEqual(ref.referrer_id, await uid(A));
});

test("futbolchilar banki: ism takrorlanmaydi, davlat va pozitsiya lug'atda, har pozitsiyada 4+ futbolchi", () => {
  const dict = require('../src/data/quiz-bank/dict.json');
  const P = duels.PLAYERS;
  assert.ok(P.length >= 100);
  assert.strictEqual(new Set(P.map((p) => p.name)).size, P.length);
  for (const p of P) {
    assert.ok(dict[p.country], `davlat: ${p.name}`);
    assert.ok(['GK', 'DEF', 'MID', 'FWD'].includes(p.pos), `pozitsiya: ${p.name}`);
    assert.ok(p.born > 1920 && p.born < 2012, `yil: ${p.name}`);
    assert.ok(Array.isArray(p.clubs) && p.clubs.length >= 1, `klublar: ${p.name}`);
  }
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) assert.ok(P.filter((p) => p.pos === pos).length >= 4, pos);
});

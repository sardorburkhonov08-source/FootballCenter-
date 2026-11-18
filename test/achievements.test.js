// 🏅 Yutuqlar va 📤 natija kartasi
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const achievements = require('../src/services/achievements');
const shareCard = require('../src/services/shareCard');

let h;
let server;
let base;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'Ali', last_name: 'Valiyev' }, process.env.BOT_TOKEN)}` });
const call = async (path, id) => {
  const res = await fetch(`${base}${path}`, { headers: id ? auth(id) : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const U = 8101;
let uid;

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('/api/me', U);
  uid = (await db.one('SELECT id FROM users WHERE telegram_id = $1', [U])).id;
  await db.query("UPDATE users SET language = 'uz' WHERE id = $1", [uid]);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("ma'lumotdan aniqlanadi, bir marta beriladi va botda xabar keladi", async () => {
  assert.deepStrictEqual(await achievements.check(uid), []);
  const q = await db.one('SELECT id FROM quiz_questions LIMIT 1');
  await db.query("INSERT INTO quiz_answers (user_id, question_id, selected_option, points_earned, answered_at) VALUES ($1, $2, 'A', 2, now())", [uid, q.id]);
  const g = await db.one(`INSERT INTO score_games (api_match_id, home_team_name, away_team_name, kickoff_at, status, result)
    VALUES (1, 'A', 'B', now() - interval '1 day', 'finished', '{"home":2,"away":1}') RETURNING id`);
  await db.query('INSERT INTO score_predictions (user_id, game_id, home, away, points_earned) VALUES ($1, $2, 2, 1, 5)', [uid, g.id]);
  await db.query('UPDATE users SET points_manager = 995, points_score = 5, points_quiz = 2 WHERE id = $1', [uid]);
  h.clear();
  assert.deepStrictEqual((await achievements.check(uid)).sort(), ['points_1000', 'quiz_1', 'score_exact_1']);
  const texts = h.texts(U);
  assert.strictEqual(texts.length, 3);
  assert.ok(texts.some((x) => /^🏅 Yangi yutuq: 🎯 <b>Snayper<\/b>\n«Hisobni top»da birinchi aniq hisob/.test(x)), texts.join('\n'));
  h.clear();
  assert.deepStrictEqual(await achievements.check(uid), [], 'qayta berilmaydi');
  assert.strictEqual(h.texts(U).length, 0);
  // Taxmin xato bo'lsa — aniq hisob hisoblanmaydi
  const g2 = await db.one(`INSERT INTO score_games (api_match_id, home_team_name, away_team_name, kickoff_at, status, result)
    VALUES (2, 'C', 'D', now() - interval '1 day', 'finished', '{"home":0,"away":0}') RETURNING id`);
  await db.query('INSERT INTO score_predictions (user_id, game_id, home, away, points_earned) VALUES ($1, $2, 1, 1, 2)', [uid, g2.id]);
  const exact = await db.one(`SELECT count(*)::int AS n FROM score_predictions p JOIN score_games g ON g.id = p.game_id
    WHERE p.user_id = $1 AND p.home = (g.result->>'home')::int AND p.away = (g.result->>'away')::int`, [uid]);
  assert.strictEqual(exact.n, 1);
});

test("profilda ro'yxat (olinganlari sana bilan), tilga qarab", async () => {
  const p = await call('/api/profile', U);
  const a = p.body.achievements;
  assert.strictEqual(a.total, achievements.LIST.length);
  assert.strictEqual(a.earned, 3);
  const sniper = a.list.find((x) => x.id === 'score_exact_1');
  assert.deepStrictEqual([sniper.icon, sniper.name, !!sniper.earnedAt], ['🎯', 'Snayper', true]);
  assert.strictEqual(a.list.find((x) => x.id === 'gift').earnedAt, null);
  await db.query("UPDATE users SET language = 'ru' WHERE id = $1", [uid]);
  assert.strictEqual((await call('/api/profile', U)).body.achievements.list[0].name, 'Первый верный ответ');
  await db.query("UPDATE users SET language = 'uz' WHERE id = $1", [uid]);
});

test("📤 natija kartasi: imzolangan rasm, points, yutuqlar va referral havola", async () => {
  const d = await call('/api/share', U);
  assert.match(d.body.path, /^\/share\/8101-[a-f0-9]{20}\.png\?v=[a-f0-9]{10}$/);
  assert.match(d.body.url, /^https:\/\/fc\.example\.com\/share\//);
  const res = await fetch(`${base}${d.body.path}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(png.subarray(1, 4).toString(), 'PNG');
  assert.strictEqual((await fetch(`${base}/share/8101-${'0'.repeat(20)}.png`)).status, 404, 'soxta imzo');
  // SVG mazmuni
  const u = await db.one('SELECT * FROM users WHERE id = $1', [uid]);
  const svg = shareCard.svg({
    lang: 'uz', name: 'Ali Valiyev', points: 997, link: `https://t.me/fc_bot?start=ref_${u.ref_code}`,
    games: [{ kind: 'manager', name: 'Mini Manager', me: { points: 990, place: 1 } }, { kind: 'quiz', name: 'Football Quiz', me: null }, { kind: 'score', name: null, me: { points: 5, place: 2 } }],
    ach: await achievements.forUser(uid, 'uz'),
  });
  for (const s of ['MENING NATIJALARIM', 'ALI VALIYEV', '997', 'HISOBNI TOP', "Bu hafta · 2-o'rin", 'YUTUQLAR  3 / 13', `t.me/fc_bot?start=ref_${u.ref_code}`]) {
    assert.ok(svg.includes(s.replace(/'/g, "'")), `yo'q: ${s}`);
  }
  // Natija o'zgarsa — rasm versiyasi o'zgaradi
  await db.query('UPDATE users SET points_quiz = 10 WHERE id = $1', [uid]);
  assert.notStrictEqual((await call('/api/share', U)).body.path, d.body.path);
});

// ☀️ Kunlik dayjest (kuniga 1 marta) va kunlik vazifalar, daraja, ⚽ bonus animatsiyasi, chat tozaligi
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const { fromParts, ymd } = require('../src/services/time');
const quests = require('../src/services/quests');

let h;
let server;
let base;
const U = 7601;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'Sardor' }, process.env.BOT_TOKEN)}` });
async function call(path, id, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(id), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await h.text(U, '/start');
  await h.click(U, 'lang:uz');
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days', first_name = 'Sardor' WHERE telegram_id = $1", [U]);
});
test.after(async () => { server.close(); await db.pool.end(); });

test("☀️ dayjest kuniga 1 marta, belgilangan soatdan keyin; har soatlik Quiz xabari yo'q", async () => {
  const { dailyDigest } = require('../src/jobs/scheduler');
  const sent = () => h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === U && c.payload.text.startsWith('☀️'));
  h.clear();
  assert.strictEqual(await dailyDigest(fromParts(2026, 10, 20, 11, 5)), false, 'soat 12 dan oldin — yuborilmaydi');
  assert.strictEqual(await dailyDigest(fromParts(2026, 10, 20, 12, 7)), true);
  assert.strictEqual(await dailyDigest(fromParts(2026, 10, 20, 13, 7)), false, 'shu kuni qayta yuborilmaydi');
  assert.strictEqual(sent().length, 1);
  const msg = sent()[0].payload;
  assert.match(msg.text, /^☀️ Xayrli kun, Sardor! Bugun FootballCenter'da:\n\n✅ Kunlik vazifalar: 0\/3 — bajarsangiz \+5 points/);
  assert.ok(msg.text.includes('🧠 Har soatda yangi Quiz savoli'));
  assert.ok(msg.text.includes('🎁 Bonusingiz tayyor'));
  assert.ok(msg.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('/app/'));
  assert.strictEqual(await dailyDigest(fromParts(2026, 10, 21, 12, 30)), true, 'ertasi kuni — yana');
  await settings.set('digest_hour', 9);
  assert.strictEqual(await dailyDigest(fromParts(2026, 10, 22, 9, 15)), true);
  assert.strictEqual(sent().length, 3);
});

test("✅ kunlik vazifalar: 3 ta, guruhlar takrorlanmaydi, bajarilgach mukofot va ketma-ket kunlar bonusi", async () => {
  const u = await user(U);
  const day = fromParts(2026, 10, 25, 15, 0);
  const st = await quests.today(u, day);
  assert.strictEqual(st.total, 3);
  const groups = st.quests.map((q) => quests.POOL.find((p) => p.id === q.id).group);
  assert.strictEqual(new Set(groups).size, 3);
  assert.deepStrictEqual((await quests.today(u, day)).quests.map((q) => q.id), st.quests.map((q) => q.id), 'kun davomida o\'zgarmaydi');
  await assert.rejects(quests.claim(u, day), /not_done/);
  // Vazifalarni "bajarilgan" qilib qo'yamiz: bugungi kunga o'zimiz tanlagan 3 ta oson vazifa
  await db.query("UPDATE user_quest_days SET quests = '[\"bonus\", \"quiz\", \"penalty\"]'::jsonb WHERE user_id = $1 AND day = $2", [u.id, ymd(day)]);
  const at = new Date(day.getTime() - 3600000);
  await db.query('INSERT INTO bonuses_log (user_id, amount, claimed_at) VALUES ($1, 100, $2)', [u.id, at]);
  const q = await db.one("SELECT id FROM quiz_questions LIMIT 1");
  await db.query("INSERT INTO quiz_answers (user_id, question_id, selected_option, points_earned, answered_at) VALUES ($1, $2, 'A', 1, $3)", [u.id, q.id, at]);
  await db.query("INSERT INTO penalty_games (user_id, status, result, finished_at) VALUES ($1, 'finished', 'win', $2)", [u.id, at]);
  const ready = await quests.today(u, day);
  assert.deepStrictEqual([ready.done, ready.allDone, ready.reward], [3, true, 5]);
  const c = await quests.claim(u, day);
  assert.deepStrictEqual([c.claimed, c.reward, c.streak], [true, 5, 1]);
  await assert.rejects(quests.claim(u, day), /already_claimed/);
  assert.strictEqual((await user(U)).points_quest, 5);
  // Kecha ham bajarilgan bo'lsa — ertasiga +1
  await db.query("INSERT INTO user_quest_days (user_id, day, quests, reward, streak, claimed_at) VALUES ($1, '2026-11-24', '[]', 5, 1, now())", [u.id]);
  assert.strictEqual(await quests.streakBefore(u.id, '2026-11-26'), 2);
  assert.strictEqual((await quests.today(u, fromParts(2026, 10, 26, 10, 0))).reward, 7);
});

test("📈 /api/today: daraja va vazifalar; Premiumsizga vazifalar yo'q", async () => {
  const d = (await call('/api/today', U)).body;
  assert.deepStrictEqual([d.level.level, d.level.name, d.points], [1, 'Havaskor', 5]);
  assert.strictEqual(d.quests.total, 3);
  await call('/api/me', 7602);
  assert.strictEqual((await call('/api/today', 7602)).body.quests, null);
  assert.strictEqual((await call('/api/quests/claim', 7602, { method: 'POST' })).status, 402);
});

test("⚽ bonus: Telegram animatsiyasi, gol bo'lsa ×2; /start xabari o'chiriladi", async () => {
  await db.query('DELETE FROM bonuses_log');
  h.overrides.sendDice = () => ({ message_id: 900, date: 0, chat: { id: U, type: 'private' }, dice: { emoji: '⚽', value: 5 } });
  h.clear();
  await h.click(U, 'bal:bonus');
  assert.ok(h.calls.some((c) => c.method === 'sendDice' && c.payload.emoji === '⚽'));
  const m = h.lastText(U).match(/^⚽🎉 GOOOL! Bonus ×2: sizga ([\d ]+) so'm berildi!/);
  assert.ok(m, h.lastText(U));
  assert.strictEqual(Number(m[1].replace(/\s/g, '')) % 2, 0, 'ikki baravar');
  delete h.overrides.sendDice;
  h.clear();
  await h.text(U, '/start');
  assert.ok(h.calls.some((c) => c.method === 'deleteMessage' && c.payload.chat_id === U), '/start buyrug\'i o\'chiriladi');
});

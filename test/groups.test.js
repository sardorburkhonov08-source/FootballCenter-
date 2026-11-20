// 👥 Guruhlarda bot, 🔎 inline rejim, 🗳 "Kim yutadi?" ovoz berish (sinov)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const football = require('../src/services/football');
const groups = require('../src/services/groups');
const poll = require('../src/services/poll');
const users = require('../src/services/users');
const { prevRange } = require('../src/services/time');

const GROUP = -100777;
const ADMIN_TG = 6101;   // guruh admini
const MEMBER_TG = 6102;
let h;
let upd = 50000;
const from = (id) => ({ id, is_bot: false, first_name: `G${id}`, username: `g${id}`, language_code: 'uz' });
const gchat = { id: GROUP, type: 'supergroup', title: 'Futbolchilar' };
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);
const groupTexts = () => h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === GROUP).map((c) => c.payload.text);

async function groupMsg(tg, text) {
  const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
  await h.bot.handleUpdate({ update_id: upd++, message: { message_id: upd, date: Math.floor(Date.now() / 1000), chat: gchat, from: from(tg), text, entities } });
}
async function groupClick(tg, data) {
  await h.bot.handleUpdate({ update_id: upd++, callback_query: { id: String(upd), from: from(tg), chat_instance: 'g', data, message: { message_id: 7, date: 0, chat: gchat, text: 'q' } } });
}
const lastAlert = () => h.calls.filter((c) => c.method === 'answerCallbackQuery').pop().payload;

const FIX = [
  { id: 901, short: '2H', elapsed: 67, home: 'Arsenal', away: 'Chelsea', gh: 2, ga: 1, league: { id: 39, name: 'Premier League' } },
  { id: 902, short: 'NS', home: 'Pakhtakor', away: 'Navbahor', league: { id: 369, name: 'Super League' } },
];
football.setFetch(async (url) => {
  const u = new URL(url);
  let response = [];
  if (u.pathname === '/fixtures' && u.searchParams.get('date')) {
    response = FIX.map((f) => ({
      fixture: { id: f.id, timestamp: Math.floor(Date.now() / 1000) + 3600, status: { short: f.short, elapsed: f.elapsed || null } },
      league: { ...f.league, country: 'X', season: 2026 },
      teams: { home: { id: f.id * 10, name: f.home, logo: null }, away: { id: f.id * 10 + 1, name: f.away, logo: null } },
      goals: { home: f.gh ?? null, away: f.ga ?? null },
    }));
  }
  return { ok: true, status: 200, headers: new Map([['x-ratelimit-requests-remaining', '90']]), json: async () => ({ errors: [], response }) };
});

test.before(async () => {
  await resetDb();
  h = createTestBot();
  h.bot.botInfo.username = 'fc_test_bot';
  h.overrides.getChatMember = (p) => ({ status: p.user_id === ADMIN_TG ? 'administrator' : 'member', user: { id: p.user_id } });
});
test.after(async () => { await db.pool.end(); });

test("👥 bot guruhga qo'shiladi: salom, kunlik savol, birinchi javob hisoblanadi, /top", async () => {
  await h.bot.handleUpdate({ update_id: upd++, my_chat_member: { chat: gchat, from: from(ADMIN_TG), date: 0,
    old_chat_member: { status: 'left', user: { id: 42, is_bot: true, first_name: 'FC' } }, new_chat_member: { status: 'member', user: { id: 42, is_bot: true, first_name: 'FC' } } } });
  assert.ok(groupTexts()[0].startsWith('👋 Salom! Men <b>FootballCenter</b>'), groupTexts()[0]);
  assert.strictEqual((await groups.byChat(GROUP)).active, true);

  // Soatidan oldin yuborilmaydi; keyin — bir marta
  await settings.set('group_quiz_hour', 23);
  const early = new Date(); early.setUTCHours(10, 0, 0, 0);   // Toshkentda 15:00
  assert.strictEqual(await groups.postDaily(h.bot.api, early), 0);
  await settings.set('group_quiz_hour', 0);
  h.clear();
  assert.strictEqual(await groups.postDaily(h.bot.api), 1);
  assert.strictEqual(await groups.postDaily(h.bot.api), 0);
  const sent = h.calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === GROUP).payload;
  assert.ok(sent.text.startsWith('🧠 <b>Kunlik guruh Quiz'));
  const btns = sent.reply_markup.inline_keyboard.flat();
  assert.strictEqual(btns.length, 4);

  // To'g'ri tugmani topamiz
  const gq = await db.one('SELECT * FROM group_quiz WHERE chat_id = $1', [GROUP]);
  const q = await db.one('SELECT correct_option FROM quiz_questions WHERE id = $1', [gq.question_id]);
  const right = gq.order_map.indexOf(q.correct_option);
  const wrong = (right + 1) % 4;
  await groupClick(MEMBER_TG, `gq:${gq.id}:${right}`);
  assert.ok(lastAlert().text.startsWith('✅ To\'g\'ri'));
  await groupClick(MEMBER_TG, `gq:${gq.id}:${wrong}`);
  assert.ok(lastAlert().text.startsWith('ℹ️'));
  await groupClick(ADMIN_TG, `gq:${gq.id}:${wrong}`);
  assert.ok(lastAlert().text.startsWith('❌ Noto\'g\'ri'));
  assert.strictEqual(lastAlert().show_alert, true);
  // Guruh balli umumiy points'ga qo'shilmaydi
  assert.strictEqual(users.totalPoints(await user(MEMBER_TG)), 0);

  h.clear();
  await groupMsg(ADMIN_TG, '/top@fc_test_bot');
  const top = groupTexts().pop();
  assert.ok(top.startsWith('🏆 <b>Guruh reytingi'), top);
  assert.ok(top.includes('🥇 G6102 — 1 ✅'));
  // Boshqa botga yozilgan buyruq e'tiborsiz; oddiy xabarga javob yo'q
  h.clear();
  await groupMsg(ADMIN_TG, '/top@other_bot');
  await groupMsg(ADMIN_TG, 'salom hammaga');
  assert.strictEqual(groupTexts().length, 0);
  // /quiz — savol yuqorida
  await groupMsg(MEMBER_TG, '/quiz');
  const ref = h.calls.filter((c) => c.method === 'sendMessage').pop().payload;
  assert.ok(ref.text.startsWith('☝️'));
  assert.strictEqual(ref.reply_parameters.message_id, Number(gq.message_id));
});

test("👥 /lang faqat adminlarga; haftalik chempion bir marta e'lon qilinadi; chiqarilsa — nofaol", async () => {
  h.clear();
  await groupMsg(MEMBER_TG, '/lang');
  assert.ok(groupTexts().pop().startsWith('⛔'));
  await groupMsg(ADMIN_TG, '/lang');
  assert.ok(groupTexts().pop().startsWith('🌐'));
  await groupClick(MEMBER_TG, 'glang:ru');
  assert.ok(lastAlert().text.startsWith('⛔'));
  await groupClick(ADMIN_TG, 'glang:ru');
  assert.strictEqual((await groups.byChat(GROUP)).language, 'ru');

  // O'tgan haftaga ko'chiramiz → chempion
  const r = prevRange('weekly', new Date());
  const mid = new Date((r.start.getTime() + r.end.getTime()) / 2);
  await db.query('UPDATE group_quiz SET posted_at = $1', [mid]);
  await db.query('UPDATE group_quiz_answers SET answered_at = $1', [mid]);
  h.clear();
  assert.strictEqual(await groups.finalizeWeeks(h.bot.api), 1);
  assert.strictEqual(await groups.finalizeWeeks(h.bot.api), 0);
  const msg = groupTexts().pop();
  assert.ok(msg.startsWith('👑 <b>Чемпион группы недели: G6102!</b>'), msg);

  await h.bot.handleUpdate({ update_id: upd++, my_chat_member: { chat: gchat, from: from(ADMIN_TG), date: 0,
    old_chat_member: { status: 'member', user: { id: 42, is_bot: true, first_name: 'FC' } }, new_chat_member: { status: 'kicked', user: { id: 42, is_bot: true, first_name: 'FC' }, until_date: 0 } } });
  assert.strictEqual((await groups.byChat(GROUP)).active, false);
  h.clear();
  assert.strictEqual(await groups.postDaily(h.bot.api, new Date(Date.now() + 86400000)), 0);
});

test('🗳 "Kim yutadi?": ovoz → foizlar, bir marta; o\'yin tugagach to\'g\'ri taxmin points oladi', async () => {
  await h.text(6201, '/start'); await h.click(6201, 'lang:uz');
  await h.text(6202, '/start'); await h.click(6202, 'lang:uz');
  const kickoff = new Date(Date.now() + 120000);
  const g = await db.one(
    `INSERT INTO score_games (api_match_id, home_team_name, away_team_name, competition, kickoff_at) VALUES (5001, 'Real Madrid', 'Barcelona', 'La Liga', $1) RETURNING *`, [kickoff],
  );
  assert.strictEqual((await poll.todayGame(new Date())).id, g.id);
  const m = await poll.message(g, 'uz');
  assert.ok(m.text.startsWith('🗳 <b>Kim yutadi?</b>'));
  assert.deepStrictEqual(m.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`pl:${g.id}:H`, `pl:${g.id}:D`, `pl:${g.id}:A`]);

  h.clear();
  await h.click(6201, `pl:${g.id}:H`, { text: m.text });
  const edited = h.calls.find((c) => c.method === 'editMessageText').payload.text;
  assert.ok(edited.includes('Real Madrid — <b>100%</b>'), edited);
  assert.ok(edited.includes('Sizning tanlovingiz: <b>Real Madrid</b>'));
  await h.click(6202, `pl:${g.id}:A`, { text: m.text });
  await h.click(6202, `pl:${g.id}:H`, { text: m.text });   // o'zgartirib bo'lmaydi
  assert.ok(h.alerts().pop().startsWith('ℹ️'));
  assert.deepStrictEqual(await poll.stats(g.id), { total: 2, H: 50, D: 0, A: 50 });

  await db.query(`UPDATE score_games SET status = 'finished', result = '{"home":2,"away":1}' WHERE id = $1`, [g.id]);
  assert.strictEqual(await poll.score(), 2);
  assert.strictEqual(await poll.score(), 0);
  assert.strictEqual((await user(6201)).points_poll, 2);
  assert.strictEqual((await user(6202)).points_poll, 0);
  assert.strictEqual(users.totalPoints(await user(6201)), 2);
  const lb = require('../src/services/leaderboard');
  lb.clearRankingCache();
  const { me } = await lb.board('overall', 'weekly', (await user(6201)).id, 10);
  assert.strictEqual(me.points, 2);

  // O'chirilsa — dayjestda chiqmaydi, ovoz qabul qilinmaydi
  await settings.set('poll_enabled', false);
  assert.strictEqual(await poll.todayGame(), null);
  await settings.set('poll_enabled', true);
});

test("🔎 inline: Premium — duel chaqiruvi, taklif va bugungi o'yinlar; havola duel taklifini ochadi", async () => {
  await h.text(6301, '/start'); await h.click(6301, 'lang:uz');
  const u = await user(6301);
  await db.query("UPDATE users SET premium_expires_at = now() + interval '5 days' WHERE id = $1", [u.id]);
  h.clear();
  await h.bot.handleUpdate({ update_id: upd++, inline_query: { id: 'iq1', from: from(6301), query: '', offset: '' } });
  const res = h.calls.find((c) => c.method === 'answerInlineQuery').payload.results;
  assert.deepStrictEqual(res.map((r) => r.id), ['duel', 'invite', 'm901', 'm902']);
  assert.strictEqual(res[2].title, "🔴 67' Arsenal 2–1 Chelsea");
  assert.ok(res[0].reply_markup.inline_keyboard[0][0].url.endsWith(`?start=dch_${u.id}`));

  h.clear();
  await h.bot.handleUpdate({ update_id: upd++, inline_query: { id: 'iq2', from: from(6301), query: 'pakhta', offset: '' } });
  assert.deepStrictEqual(h.calls.find((c) => c.method === 'answerInlineQuery').payload.results.map((r) => r.id), ['m902']);

  // Do'st havolani ochadi — chaqiruvchi nomidan Quiz duel taklifi; qayta ochsa yangi duel ochilmaydi
  h.clear();
  await h.text(6302, `/start dch_${u.id}`);
  const invite = h.texts(6302).find((x) => x.startsWith('⚔️'));
  assert.ok(invite, JSON.stringify(h.texts(6302)));
  await h.text(6302, `/start dch_${u.id}`);
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM duels WHERE creator_id = $1 AND mode = 'invite'", [u.id])).n, 1);
  // Yangi foydalanuvchi chaqiruvchining referrali bo'ladi
  assert.ok(await db.one('SELECT 1 FROM referrals WHERE referrer_id = $1', [u.id]));
});

test("👥 faqat guruhda javob bergan foydalanuvchi botga keyin kirsa — yangi hisoblanadi (sovg'a Premium, referral)", async () => {
  await settings.set('welcome_premium_days', 3);
  await groups.register(gchat, null);
  await db.query('UPDATE group_chats SET active = true, language = $2 WHERE chat_id = $1', [GROUP, 'uz']);
  const { gq } = await groups.ensureToday(GROUP, new Date(Date.now() + 2 * 86400000));
  await db.query('UPDATE group_quiz SET posted_at = now() WHERE id = $1', [gq.id]);
  await groupClick(6401, `gq:${gq.id}:0`);
  const g = await user(6401);
  assert.strictEqual(g.group_only, true);
  assert.ok(!users.isPremium(g));
  const inviter = await user(6301);
  await h.text(6401, `/start ref_${inviter.ref_code}`);
  const after = await user(6401);
  assert.strictEqual(after.group_only, false);
  assert.ok(users.isPremium(after));
  assert.ok(await db.one('SELECT 1 FROM referrals WHERE referrer_id = $1 AND referred_id = $2', [inviter.id, after.id]));
  await settings.set('welcome_premium_days', 0);
});

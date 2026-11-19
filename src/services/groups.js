// 👥 Guruhlarda bot (egasi talabi): kuniga bitta guruh Quiz savoli (inline tugmalar bilan), guruhning haftalik reytingi
// (/top) va hafta tugagach guruh chempioni e'loni. Guruh reytingi alohida — umumiy points'ga qo'shilmaydi.
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const quiz = require('./quiz');
const users = require('./users');
const { t, LANGS } = require('../i18n');
const { parts, ymd, weekRange, prevRange } = require('./time');

const ANSWER_HOURS = 24;          // savolga javob berish muddati
const TOP_N = 10;

async function byChat(chatId) { return db.one('SELECT * FROM group_chats WHERE chat_id = $1', [chatId]); }

/** Bot guruhga qo'shildi (yoki qayta faollashdi) → guruh qatori. created — birinchi marta */
async function register(chat, adder) {
  const existing = await byChat(chat.id);
  const lang = (existing && existing.language) || (adder && LANGS.includes(adder.language) ? adder.language : 'uz');
  const row = await db.one(
    `INSERT INTO group_chats (chat_id, title, language, active, added_by) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, active = true RETURNING *`,
    [chat.id, chat.title || null, lang, adder ? adder.id : null],
  );
  return { group: row, created: !existing };
}

async function deactivate(chatId) { await db.query('UPDATE group_chats SET active = false WHERE chat_id = $1', [chatId]); }

/** Oddiy guruh superguruhga aylanganda chat_id o'zgaradi */
async function migrate(oldId, newId) {
  await db.query('UPDATE group_chats SET chat_id = $2 WHERE chat_id = $1 AND NOT EXISTS (SELECT 1 FROM group_chats WHERE chat_id = $2)', [oldId, newId]);
}

async function setLanguage(chatId, lang) {
  if (!LANGS.includes(lang)) return null;
  return db.one('UPDATE group_chats SET language = $2 WHERE chat_id = $1 RETURNING *', [chatId, lang]);
}

/** Guruhda hali berilmagan tasodifiy bank savoli (tugasa — istalgani) */
async function pickQuestion(chatId) {
  return (await db.one(
    `SELECT * FROM quiz_questions q WHERE source IN ('bank', 'bank_repeat')
       AND NOT EXISTS (SELECT 1 FROM group_quiz g WHERE g.chat_id = $1 AND g.question_id = q.id)
     ORDER BY random() LIMIT 1`, [chatId],
  )) || db.one('SELECT * FROM quiz_questions ORDER BY random() LIMIT 1');
}

function shuffledOrder() {
  const a = ['A', 'B', 'C', 'D'];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join('');
}

/** Savol xabari: matn + 4 tugma (tartib aralashtirilgan) */
async function quizMessage(gq, lang) {
  const q = await db.one('SELECT * FROM quiz_questions WHERE id = $1', [gq.question_id]);
  const pq = quiz.publicQuestion(q, lang);
  const rows = gq.order_map.split('').map((opt, slot) => [{ text: String(pq.options[opt]).slice(0, 60), callback_data: `gq:${gq.id}:${slot}` }]);
  return { text: t(lang, 'grp_quiz', { question: pq.question }), reply_markup: { inline_keyboard: rows } };
}

/** Bugungi savolni yaratish (bir kunda bir marta). → { gq, created } */
async function ensureToday(chatId, now = new Date()) {
  const day = ymd(now);
  const have = await db.one('SELECT * FROM group_quiz WHERE chat_id = $1 AND day = $2', [chatId, day]);
  if (have) return { gq: have, created: false };
  const q = await pickQuestion(chatId);
  if (!q) return { gq: null, created: false };
  const gq = await db.one(
    `INSERT INTO group_quiz (chat_id, day, question_id, order_map) VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id, day) DO NOTHING RETURNING *`, [chatId, day, q.id, shuffledOrder()],
  );
  if (!gq) return { gq: await db.one('SELECT * FROM group_quiz WHERE chat_id = $1 AND day = $2', [chatId, day]), created: false };
  return { gq, created: true };
}

function isGone(e) {
  const d = String((e && (e.description || e.message)) || '');
  return /kicked|not a member|chat not found|bot was blocked|have no rights to send|CHAT_WRITE_FORBIDDEN|group chat was upgraded/i.test(d);
}

/** Savolni guruhga yuborish */
async function post(api, group, gq) {
  const m = await quizMessage(gq, group.language);
  try {
    const msg = await api.sendMessage(group.chat_id, m.text, { parse_mode: 'HTML', reply_markup: m.reply_markup });
    await db.query('UPDATE group_quiz SET message_id = $2, posted_at = now() WHERE id = $1', [gq.id, msg.message_id]);
    return msg;
  } catch (e) {
    if (isGone(e)) await deactivate(group.chat_id);
    else console.warn(`[groups] ${group.chat_id}: ${e.description || e.message}`);
    return null;
  }
}

/** ⏰ Fon vazifasi: group_quiz_hour dan keyin har faol guruhga bugungi savol */
async function postDaily(api, now = new Date()) {
  if (!api || !(await settings.get('group_quiz_enabled'))) return 0;
  if (parts(now).hour < Number(await settings.get('group_quiz_hour'))) return 0;
  const groups = await db.many(
    'SELECT g.* FROM group_chats g WHERE g.active AND NOT EXISTS (SELECT 1 FROM group_quiz q WHERE q.chat_id = g.chat_id AND q.day = $1)', [ymd(now)],
  );
  let sent = 0;
  for (const g of groups) {
    const { gq, created } = await ensureToday(g.chat_id, now);
    if (gq && created && (await post(api, g, gq))) sent += 1;
    await new Promise((r) => setTimeout(r, 40));
  }
  return sent;
}

/**
 * Javob: birinchi javob hisoblanadi.
 * → { status: 'ok'|'already'|'expired'|'not_found', correct, answer, lang }
 */
async function answer(user, gqId, slot) {
  const gq = await db.one('SELECT q.*, g.language FROM group_quiz q JOIN group_chats g ON g.chat_id = q.chat_id WHERE q.id = $1', [gqId]);
  if (!gq || !(slot >= 0 && slot < 4)) return { status: 'not_found' };
  const lang = gq.language;
  const q = await db.one('SELECT * FROM quiz_questions WHERE id = $1', [gq.question_id]);
  const correctText = quiz.publicQuestion(q, lang).options[q.correct_option];
  const seconds = Math.max(0, Math.round((Date.now() - new Date(gq.posted_at).getTime()) / 1000));
  if (seconds > ANSWER_HOURS * 3600) return { status: 'expired', lang };
  const opt = gq.order_map[slot];
  const correct = opt === q.correct_option;
  const ins = await db.one(
    `INSERT INTO group_quiz_answers (group_quiz_id, user_id, option, correct, seconds) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING *`, [gq.id, user.id, opt, correct, seconds],
  );
  if (!ins) return { status: 'already', lang };
  return { status: 'ok', correct, answer: correctText, lang };
}

/** Guruh reytingi (hafta): to'g'ri javoblar soni, teng bo'lsa — tezroq */
async function board(chatId, r = weekRange(new Date()), limit = TOP_N) {
  const rows = await db.many(
    `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username,
            count(*) FILTER (WHERE a.correct)::int AS correct, COALESCE(sum(a.seconds) FILTER (WHERE a.correct), 0)::int AS time
     FROM group_quiz_answers a JOIN group_quiz q ON q.id = a.group_quiz_id JOIN users u ON u.id = a.user_id
     WHERE q.chat_id = $1 AND a.answered_at >= $2 AND a.answered_at < $3 AND NOT u.is_blocked
     GROUP BY u.id HAVING count(*) FILTER (WHERE a.correct) > 0
     ORDER BY correct DESC, time ASC, u.id LIMIT $4`, [chatId, r.start, r.end, limit],
  );
  return rows.map((x, i) => ({ place: i + 1, id: x.id, name: users.displayName(x), correct: x.correct }));
}

function boardLines(lang, rows) {
  const medal = ['🥇', '🥈', '🥉'];
  return rows.map((r) => t(lang, 'grp_top_line', { place: medal[r.place - 1] || `${r.place}.`, name: r.name, n: r.correct })).join('\n');
}

/** 👑 Hafta tugagach — har guruhda chempion e'loni (bir marta) */
async function finalizeWeeks(api, now = new Date(), graceMs = 0) {
  if (!api) return 0;
  const r = prevRange('weekly', now);
  if (now.getTime() < r.end.getTime() + graceMs) return 0;
  const groups = await db.many(
    `SELECT DISTINCT g.* FROM group_chats g JOIN group_quiz q ON q.chat_id = g.chat_id
     WHERE g.active AND q.posted_at >= $1 AND q.posted_at < $2
       AND NOT EXISTS (SELECT 1 FROM group_weekly_winners w WHERE w.chat_id = g.chat_id AND w.week_start = $1)`, [r.start, r.end],
  );
  let sent = 0;
  for (const g of groups) {
    const rows = await board(g.chat_id, r, 3);
    const w = rows[0];
    const ins = await db.one(
      `INSERT INTO group_weekly_winners (chat_id, week_start, user_id, correct) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING *`, [g.chat_id, r.start, w ? w.id : null, w ? w.correct : 0],
    );
    if (!ins || !w) continue;
    try {
      await api.sendMessage(g.chat_id, t(g.language, 'grp_champion', { name: w.name, n: w.correct, list: { __html: boardLines(g.language, rows) } }), { parse_mode: 'HTML' });
      sent += 1;
    } catch (e) { if (isGone(e)) await deactivate(g.chat_id); }
  }
  return sent;
}

module.exports = { ANSWER_HOURS, byChat, register, deactivate, migrate, setLanguage, ensureToday, quizMessage, post, postDaily, answer, board, boardLines, finalizeWeeks };

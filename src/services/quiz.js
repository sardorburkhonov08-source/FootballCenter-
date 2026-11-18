// 🧠 Football Quiz — faqat Premium. Har soatda 1 savol, 15 soniya, 5 soniyada 2 ball, 15 soniyada 1 ball.
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const settings = require('./settings');

const LANGS = ['uz', 'uz_cyrl', 'ru', 'en'];

const ANSWER_SECONDS = 15;
const FAST_SECONDS = 5;
const NETWORK_GRACE = 1; // tarmoq kechikishi uchun 15 soniya chegarasiga qo'shimcha

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

const FOOTBALL_RE = /\b(football|soccer|fifa|uefa|world cup|premier league|la liga|serie a|bundesliga|ligue 1|champions league|euro \d{4}|ballon d'or|striker|goalkeeper|penalty|offside|hat-trick|hat trick|manchester|liverpool|arsenal|chelsea|barcelona|real madrid|juventus|bayern|messi|ronaldo|pel[eé]|maradona)\b/i;

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;/g, 'é').replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü').replace(/&aacute;/g, 'á').replace(/&ntilde;/g, 'ñ').replace(/&oacute;/g, 'ó')
    .replace(/&iacute;/g, 'í').replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Savollar bazasini API'dan to'ldirish (standart: Open Trivia DB, Sport toifasi, futbolga oid savollar) */
async function fetchFromApi() {
  const res = await fetchImpl(config.quizApiUrl);
  if (!res.ok) throw new Error(`Quiz API ${res.status}`);
  const data = await res.json();
  let added = 0;
  for (const q of data.results || []) {
    const question = decodeEntities(q.question);
    const incorrect = (q.incorrect_answers || []).map(decodeEntities);
    if (incorrect.length !== 3 || !FOOTBALL_RE.test(question + ' ' + decodeEntities(q.correct_answer))) continue;
    const correct = decodeEntities(q.correct_answer);
    const options = shuffle([correct, ...incorrect]);
    const letter = 'ABCD'[options.indexOf(correct)];
    const hash = crypto.createHash('sha1').update(question.toLowerCase()).digest('hex');
    const r = await db.query(
      `INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source, source_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'api',$7) ON CONFLICT (source_hash) DO NOTHING`,
      [question, options[0], options[1], options[2], options[3], letter, hash],
    );
    added += r.rowCount;
  }
  return added;
}

/** Joriy savol: oxirgi e'lon qilingan (keyingisi chiqquncha amal qiladi) */
async function current() {
  return db.one('SELECT * FROM quiz_questions WHERE published_at IS NOT NULL AND published_at <= now() ORDER BY published_at DESC LIMIT 1');
}

/**
 * Yangi savolni e'lon qilish (har soatda ishga tushadi).
 * Navbat: admin qo'shganlari → 4 tilli savollar bazasi (tasodifiy). Hammasi chiqib bo'lsa — eng uzoq vaqt oldin
 * chiqqan baza savoli nusxa sifatida qayta e'lon qilinadi (javoblar har nusxaga alohida yoziladi).
 * Inglizcha tashqi API (Open Trivia DB) faqat quiz_api_enabled yoqilgan bo'lsa ishlatiladi.
 */
async function publishNext() {
  let q = await db.one('SELECT id FROM quiz_questions WHERE published_at IS NULL ORDER BY source = \'manual\' DESC, random() LIMIT 1');
  if (!q && await settings.get('quiz_api_enabled')) {
    try { await fetchFromApi(); } catch (e) { console.warn('[quiz] API:', e.message); }
    q = await db.one('SELECT id FROM quiz_questions WHERE published_at IS NULL ORDER BY random() LIMIT 1');
  }
  if (!q) {
    q = await db.one(
      `INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source, i18n)
       SELECT question, option_a, option_b, option_c, option_d, correct_option, 'bank_repeat', i18n FROM quiz_questions
       WHERE source IN ('bank', 'bank_repeat') AND published_at IS NOT NULL
         AND question NOT IN (SELECT question FROM quiz_questions WHERE published_at > now() - interval '30 days')
       ORDER BY published_at ASC LIMIT 1 RETURNING id`,
    );
  }
  if (!q) return null;
  return db.one('UPDATE quiz_questions SET published_at = now() WHERE id = $1 RETURNING *', [q.id]);
}

/** Savol foydalanuvchi tilida (tarjimasi bo'lmasa — asosiy matn) */
function publicQuestion(q, lang) {
  const tr = lang && lang !== 'uz' && q.i18n && q.i18n[lang];
  const x = tr || { q: q.question, a: q.option_a, b: q.option_b, c: q.option_c, d: q.option_d };
  return { id: q.id, question: x.q, options: { A: x.a, B: x.b, C: x.c, D: x.d } };
}
function langOf(user) { return LANGS.includes(user && user.language) ? user.language : 'uz'; }

function elapsedSeconds(startedAt) {
  return (Date.now() - new Date(startedAt).getTime()) / 1000;
}

/** Holat: savol, foydalanuvchi javobi, keyingi savol vaqti */
async function state(user) {
  const q = await current();
  if (!q) return { question: null };
  const a = await db.one('SELECT * FROM quiz_answers WHERE user_id = $1 AND question_id = $2', [user.id, q.id]);
  const nextAt = new Date(new Date(q.published_at).getTime() + 3600 * 1000);
  const base = { questionId: q.id, publishedAt: q.published_at, nextAt };
  if (!a) return { ...base, status: 'new' };
  if (a.answered_at) return { ...base, status: 'answered', result: resultOf(q, a), question: publicQuestion(q, langOf(user)) };
  const left = ANSWER_SECONDS - elapsedSeconds(a.started_at);
  if (left + NETWORK_GRACE <= 0) {
    const done = await finalize(user, q, a, null);
    return { ...base, status: 'answered', result: resultOf(q, done), question: publicQuestion(q, langOf(user)) };
  }
  return { ...base, status: 'in_progress', question: publicQuestion(q, langOf(user)), secondsLeft: Math.max(0, left) };
}

function resultOf(q, a) {
  return { selected: a.selected_option, correct: q.correct_option, points: a.points_earned, time: a.response_time_seconds };
}

async function finalize(user, q, a, option) {
  const elapsed = elapsedSeconds(a.started_at);
  let points = 0;
  if (option && option === q.correct_option && elapsed <= ANSWER_SECONDS + NETWORK_GRACE) points = elapsed <= FAST_SECONDS ? 2 : 1;
  return db.tx(async (c) => {
    const r = await c.query(
      `UPDATE quiz_answers SET selected_option = $3, response_time_seconds = $4, points_earned = $5, answered_at = now()
       WHERE user_id = $1 AND question_id = $2 AND answered_at IS NULL RETURNING *`,
      [user.id, q.id, option, Math.min(elapsed, 999).toFixed(2), points],
    );
    if (!r.rowCount) return (await c.query('SELECT * FROM quiz_answers WHERE user_id = $1 AND question_id = $2', [user.id, q.id])).rows[0];
    if (points) await c.query('UPDATE users SET points_quiz = points_quiz + $2 WHERE id = $1', [user.id, points]);
    return r.rows[0];
  });
}

/** Taymerni boshlash — vaqt serverda o'lchanadi */
async function start(user, questionId) {
  const q = await current();
  if (!q || q.id !== Number(questionId)) return { error: 'expired' };
  await db.query('INSERT INTO quiz_answers (user_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, q.id]);
  return state(user);
}

async function answer(user, questionId, option) {
  const q = await current();
  if (!q || q.id !== Number(questionId)) return { error: 'expired' };
  if (!['A', 'B', 'C', 'D'].includes(option)) return { error: 'bad_option' };
  const a = await db.one('SELECT * FROM quiz_answers WHERE user_id = $1 AND question_id = $2', [user.id, q.id]);
  if (!a) return { error: 'not_started' };
  if (a.answered_at) return { status: 'answered', result: resultOf(q, a) };
  const done = await finalize(user, q, a, option);
  return { status: 'answered', result: resultOf(q, done), question: publicQuestion(q, langOf(user)) };
}

module.exports = { ANSWER_SECONDS, FAST_SECONDS, setFetch, fetchFromApi, current, publishNext, publicQuestion, state, start, answer, decodeEntities };

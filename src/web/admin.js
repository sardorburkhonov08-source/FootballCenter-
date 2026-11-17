// Web App admin paneli API'si (/api/admin)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db/pool');
const config = require('../config');
const settings = require('../services/settings');
const football = require('../services/football');
const manager = require('../services/manager');
const quiz = require('../services/quiz');
const users = require('../services/users');
const { ymd, dayStart } = require('../services/time');
const { requireAdmin, checkPassword, signSession, SESSION_TTL } = require('./auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

fs.mkdirSync(config.uploadDir, { recursive: true });

const MEDIA = {
  'image/jpeg': ['image', '.jpg'], 'image/png': ['image', '.png'], 'image/webp': ['image', '.webp'],
  'image/gif': ['animation', '.gif'], 'video/mp4': ['video', '.mp4'], 'video/webm': ['video', '.webm'],
  'application/json': ['lottie', '.json'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${MEDIA[file.mimetype][1]}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!MEDIA[file.mimetype]),
});

function removeUpload(name) {
  if (!name) return;
  const p = path.join(config.uploadDir, path.basename(name));
  fs.unlink(p, () => {});
}

// ---- Kirish (brauzerdan)
const loginAttempts = new Map();
router.post('/login', express.json(), (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - a.at > 15 * 60 * 1000) { a.n = 0; a.at = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'too_many_attempts' });
  const { login, password } = req.body || {};
  if (!checkPassword(login, password)) {
    a.n += 1;
    loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'bad_credentials' });
  }
  loginAttempts.delete(ip);
  const token = signSession({ login, exp: Date.now() + SESSION_TTL });
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.set('Set-Cookie', `fc_admin=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`);
  return res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.set('Set-Cookie', 'fc_admin=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ via: req.admin.via, name: req.admin.user ? users.displayName(req.admin.user) : req.admin.login }));

// ---- 🎬 Bannerlar
router.get('/banners', wrap(async (req, res) => {
  res.json(await db.many('SELECT * FROM banners ORDER BY sort_order, id'));
}));

router.post('/banners', upload.single('media'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'bad_media' });
  const duration = Math.min(120, Math.max(2, Number(req.body.duration) || 8));
  const link = String(req.body.link || '').trim();
  if (link && !/^https?:\/\/|^tg:\/\//.test(link)) { removeUpload(req.file.filename); return res.status(400).json({ error: 'bad_link' }); }
  const row = await db.one(
    'INSERT INTO banners (media_path, media_type, link, duration_seconds, sort_order) VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order),0)+1 FROM banners)) RETURNING *',
    [req.file.filename, MEDIA[req.file.mimetype][0], link || null, duration],
  );
  return res.json(row);
}));

router.patch('/banners/:id', express.json(), wrap(async (req, res) => {
  const b = req.body || {};
  const link = b.link === undefined ? undefined : String(b.link || '').trim();
  if (link && !/^https?:\/\/|^tg:\/\//.test(link)) return res.status(400).json({ error: 'bad_link' });
  const row = await db.one(
    `UPDATE banners SET is_active = COALESCE($2, is_active), duration_seconds = COALESCE($3, duration_seconds),
       link = CASE WHEN $4::boolean THEN $5 ELSE link END, sort_order = COALESCE($6, sort_order) WHERE id = $1 RETURNING *`,
    [Number(req.params.id), typeof b.isActive === 'boolean' ? b.isActive : null,
      b.duration ? Math.min(120, Math.max(2, Number(b.duration))) : null, link !== undefined, link || null,
      Number.isInteger(b.sortOrder) ? b.sortOrder : null],
  );
  return row ? res.json(row) : res.status(404).json({ error: 'not_found' });
}));

router.delete('/banners/:id', wrap(async (req, res) => {
  const row = await db.one('DELETE FROM banners WHERE id = $1 RETURNING *', [Number(req.params.id)]);
  if (row) removeUpload(row.media_path);
  res.json({ ok: true });
}));

// ---- 🎮 Mini Manager — o'yin belgilash
router.get('/manager/matches', wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : ymd();
  const toDefault = new Date(Date.parse(`${from}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : toDefault;
  try {
    const list = await football.matchesRange(from, to);
    res.json({ from, to, matches: list.filter((m) => m.state === 'scheduled') });
  } catch (e) {
    if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable' });
    throw e;
  }
  return undefined;
}));

router.get('/manager/games', wrap(async (req, res) => {
  res.json(await db.many(
    `SELECT g.*, (SELECT count(*)::int FROM mini_manager_predictions p WHERE p.game_id = g.id) AS participants
     FROM mini_manager_games g ORDER BY kickoff_at DESC LIMIT 100`,
  ));
}));

router.post('/manager/games', express.json(), wrap(async (req, res) => {
  const id = Number(req.body && req.body.apiMatchId);
  if (!id) return res.status(400).json({ error: 'bad_match' });
  try {
    return res.json(await manager.assignGame(id));
  } catch (e) {
    if (e instanceof manager.ValidationError) return res.status(400).json({ error: e.message });
    if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable' });
    throw e;
  }
}));

router.delete('/manager/games/:id', wrap(async (req, res) => {
  const g = await db.one('SELECT * FROM mini_manager_games WHERE id = $1', [Number(req.params.id)]);
  if (!g) return res.status(404).json({ error: 'not_found' });
  if (g.status === 'finished') return res.status(400).json({ error: 'already_finished' });
  await db.query('DELETE FROM mini_manager_games WHERE id = $1', [g.id]);
  return res.json({ ok: true });
}));

router.get('/tactics', wrap(async (req, res) => res.json(await settings.get('tactics'))));
router.put('/tactics', express.json(), wrap(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body.map((s) => String(s).trim()).filter((s) => /^\d(-\d){2,4}$/.test(s)) : [];
  const valid = [...new Set(list)].filter((s) => s.split('-').reduce((a, b) => a + Number(b), 0) === 10);
  if (!valid.length) return res.status(400).json({ error: 'bad_tactics' });
  await settings.set('tactics', valid);
  return res.json(valid);
}));

// ---- 🏆 Sovrinlar (Mini Manager / Quiz, haftalik / oylik)
router.get('/prizes', wrap(async (req, res) => res.json(await db.many('SELECT * FROM prizes ORDER BY created_at DESC'))));

router.post('/prizes', upload.single('media'), wrap(async (req, res) => {
  const { kind, period } = req.body;
  const text = String(req.body.text || '').trim();
  if (!['manager', 'quiz'].includes(kind) || !['weekly', 'monthly'].includes(period) || !text) {
    if (req.file) removeUpload(req.file.filename);
    return res.status(400).json({ error: 'bad_prize' });
  }
  const row = await db.one(
    'INSERT INTO prizes (kind, period, text, media_path, media_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [kind, period, text.slice(0, 1000), req.file ? req.file.filename : null, req.file ? MEDIA[req.file.mimetype][0] : null],
  );
  return res.json(row);
}));

router.patch('/prizes/:id', express.json(), wrap(async (req, res) => {
  const b = req.body || {};
  const row = await db.one('UPDATE prizes SET is_active = COALESCE($2, is_active), text = COALESCE($3, text) WHERE id = $1 RETURNING *',
    [Number(req.params.id), typeof b.isActive === 'boolean' ? b.isActive : null, b.text ? String(b.text).slice(0, 1000) : null]);
  return row ? res.json(row) : res.status(404).json({ error: 'not_found' });
}));

router.delete('/prizes/:id', wrap(async (req, res) => {
  const row = await db.one('DELETE FROM prizes WHERE id = $1 RETURNING *', [Number(req.params.id)]);
  if (row) removeUpload(row.media_path);
  res.json({ ok: true });
}));

// ---- 🧠 Quiz savollari (asosiy manba — API; qo'lda qo'shish ham mumkin)
router.get('/quiz/questions', wrap(async (req, res) => {
  const counts = await db.one("SELECT count(*) FILTER (WHERE published_at IS NULL)::int AS queued, count(*)::int AS total FROM quiz_questions");
  const rows = await db.many('SELECT * FROM quiz_questions ORDER BY published_at DESC NULLS FIRST, id DESC LIMIT 50');
  res.json({ ...counts, questions: rows });
}));

router.post('/quiz/questions', express.json(), wrap(async (req, res) => {
  const b = req.body || {};
  const fields = ['question', 'a', 'b', 'c', 'd'].map((k) => String(b[k] || '').trim());
  if (fields.some((f) => !f) || !['A', 'B', 'C', 'D'].includes(b.correct)) return res.status(400).json({ error: 'bad_question' });
  const row = await db.one(
    "INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source) VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING *",
    [...fields, b.correct],
  );
  return res.json(row);
}));

router.post('/quiz/fetch', wrap(async (req, res) => {
  try { res.json({ added: await quiz.fetchFromApi() }); } catch (e) { res.status(503).json({ error: 'quiz_api_unavailable' }); }
}));

router.delete('/quiz/questions/:id', wrap(async (req, res) => {
  await db.query('DELETE FROM quiz_questions WHERE id = $1 AND published_at IS NULL', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---- 📊 Statistika
router.get('/stats', wrap(async (req, res) => {
  const today = dayStart();
  const days = await db.many(
    `SELECT visit_date::text AS date, count(*)::int AS visits FROM webapp_visits
     WHERE visit_date > (now() AT TIME ZONE 'Asia/Tashkent')::date - 14 GROUP BY visit_date ORDER BY visit_date`,
  );
  const s = await db.one(
    `SELECT (SELECT count(*)::int FROM webapp_visits WHERE visit_date = $2) AS visits_today,
            (SELECT count(DISTINCT user_id)::int FROM mini_manager_predictions) AS manager_participants,
            (SELECT count(DISTINCT p.user_id)::int FROM mini_manager_predictions p JOIN mini_manager_games g ON g.id = p.game_id
               WHERE g.kickoff_at > now() - interval '7 days') AS manager_participants_week,
            (SELECT count(DISTINCT user_id)::int FROM quiz_answers WHERE answered_at IS NOT NULL) AS quiz_participants,
            (SELECT count(DISTINCT user_id)::int FROM quiz_answers WHERE answered_at >= $1) AS quiz_participants_today,
            (SELECT count(*)::int FROM users WHERE premium_expires_at > now()) AS premium_total,
            (SELECT count(DISTINCT user_id)::int FROM premium_purchases WHERE created_at >= $1) AS premium_new_today,
            (SELECT count(*)::int FROM users) AS users_total`,
    [today, ymd()],
  );
  const top = await db.many(
    `SELECT id, telegram_id, first_name, last_name, username, coach_name, points_manager, points_quiz,
            (points_manager + points_quiz) AS total
     FROM users WHERE (points_manager + points_quiz) > 0 AND NOT is_blocked ORDER BY total DESC LIMIT 20`,
  );
  const winners = await db.many(
    `SELECT w.*, u.first_name, u.last_name, u.username, u.telegram_id FROM period_winners w LEFT JOIN users u ON u.id = w.user_id
     ORDER BY w.period_end DESC, w.kind LIMIT 30`,
  );
  res.json({ ...s, days, top: top.map((u) => ({ ...u, name: users.displayName(u) })), winners: winners.map((w) => ({ ...w, name: w.user_id ? users.displayName(w) : null })) });
}));

module.exports = router;

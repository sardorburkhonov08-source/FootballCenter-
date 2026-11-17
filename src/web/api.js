// Web App foydalanuvchi API'si (/api)
const express = require('express');
const db = require('../db/pool');
const settings = require('../services/settings');
const users = require('../services/users');
const football = require('../services/football');
const manager = require('../services/manager');
const quiz = require('../services/quiz');
const leaderboard = require('../services/leaderboard');
const referral = require('../services/referral');
const { ymd } = require('../services/time');
const { requireTelegramUser } = require('./auth');
const config = require('../config');

const router = express.Router();
router.use(requireTelegramUser);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requirePremium(req, res, next) {
  if (!users.isPremium(req.user)) return res.status(402).json({ error: 'premium_required' });
  return next();
}

/** Football API xatolarini bir xil formatda qaytarish */
function footballRoute(fn) {
  return wrap(async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (e) {
      if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable', status: e.status || null });
      throw e;
    }
  });
}

function publicUser(u) {
  return {
    id: u.telegram_id, firstName: u.first_name, lastName: u.last_name, username: u.username, language: u.language || 'uz',
    premium: users.isPremium(u), premiumExpiresAt: u.premium_expires_at, isAdmin: users.isAdmin(u), coachName: u.coach_name,
  };
}

// Web App ochilganda: tashrif yoziladi va referral faollashadi
router.get('/me', wrap(async (req, res) => {
  await db.query('INSERT INTO webapp_visits (user_id, visit_date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, ymd()]);
  await referral.activate(req.user.id, 'webapp').catch((e) => console.error('[referral]', e));
  const s = await settings.getMany(['webapp_news_enabled', 'prize_rotate_seconds', 'leaderboard_top']);
  res.json({ botUsername: config.botUsername || null, user: publicUser(req.user), features: { news: !!s.webapp_news_enabled }, prizeRotateSeconds: s.prize_rotate_seconds, leaderboardTop: s.leaderboard_top });
}));

router.get('/banners', wrap(async (req, res) => {
  const rows = await db.many('SELECT id, media_path, media_type, link, duration_seconds FROM banners WHERE is_active ORDER BY sort_order, id');
  res.json(rows.map((b) => ({ id: b.id, url: `/uploads/${b.media_path}`, type: b.media_type, link: b.link || null, duration: b.duration_seconds })));
}));

router.get('/prizes', wrap(async (req, res) => {
  const kind = req.query.kind === 'quiz' ? 'quiz' : 'manager';
  const rows = await db.many('SELECT * FROM prizes WHERE is_active AND kind = $1 ORDER BY period DESC, id DESC', [kind]);
  res.json(rows.map((p) => ({ id: p.id, period: p.period, text: p.text, url: p.media_path ? `/uploads/${p.media_path}` : null, type: p.media_type })));
}));

// ---------- 🏠 Home
router.get('/matches', footballRoute(async (req) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : ymd();
  const list = await football.matchesByDate(date);
  const subs = await db.many('SELECT api_match_id FROM match_subscriptions WHERE user_id = $1', [req.user.id]);
  const subSet = new Set(subs.map((s) => Number(s.api_match_id)));
  return { date, matches: list.map((m) => ({ ...m, subscribed: subSet.has(m.id) })) };
}));

router.get('/matches/:id', requirePremium, footballRoute(async (req) => football.matchDetail(req.params.id)));

// ⚽ O'yin boshlanishidan 15 daqiqa oldin eslatma (Premium)
router.post('/matches/:id/subscribe', requirePremium, footballRoute(async (req) => {
  const id = Number(req.params.id);
  const existing = await db.one('SELECT 1 AS x FROM match_subscriptions WHERE user_id = $1 AND api_match_id = $2', [req.user.id, id]);
  if (existing) {
    await db.query('DELETE FROM match_subscriptions WHERE user_id = $1 AND api_match_id = $2', [req.user.id, id]);
    return { subscribed: false };
  }
  const m = football.normMatch(await football.rawMatch(id));
  if (m.state !== 'scheduled') return { subscribed: false, error: 'not_scheduled' };
  await db.query(
    'INSERT INTO match_subscriptions (user_id, api_match_id, kickoff_at, title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [req.user.id, id, m.utcDate, `${m.home.name} — ${m.away.name}`],
  );
  return { subscribed: true };
}));

router.get('/competitions', footballRoute(async () => football.competitions()));

const COMP_TABS = ['standings', 'results', 'calendar', 'scorers', 'assists'];
router.get('/competitions/:id', footballRoute(async (req) => ({ ...(await football.competitionInfo(req.params.id)), tabs: COMP_TABS, freeTabs: ['standings'] })));

router.get('/competitions/:id/:tab', (req, res, next) => {
  if (!COMP_TABS.includes(req.params.tab)) return res.status(404).json({ error: 'not_found' });
  if (req.params.tab !== 'standings' && !users.isPremium(req.user)) return res.status(402).json({ error: 'premium_required' });
  return next();
}, footballRoute(async (req) => {
  const { id, tab } = req.params;
  if (tab === 'standings') return { standings: await football.standings(id) };
  if (tab === 'results') return { matches: await football.competitionMatches(id, 'results') };
  if (tab === 'calendar') return { matches: await football.competitionMatches(id, 'calendar') };
  const s = await football.scorers(id);
  return { players: tab === 'scorers' ? s.scorers : s.assists };
}));

// ---------- 🎮 Mini Manager
router.post('/manager/coach', express.json(), wrap(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 32) return res.status(400).json({ error: 'bad_coach_name' });
  const u = await db.one('UPDATE users SET coach_name = $2 WHERE id = $1 RETURNING *', [req.user.id, name]);
  return res.json({ coachName: u.coach_name });
}));

router.get('/manager/games', wrap(async (req, res) => {
  res.json({ coachName: req.user.coach_name, games: await manager.listGames(req.user) });
}));

router.get('/manager/games/:id', wrap(async (req, res) => {
  const g = await manager.getGame(req.user, Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'not_found' });
  return res.json(g);
}));

router.post('/manager/games/:id/prediction', express.json(), wrap(async (req, res) => {
  try {
    res.json({ prediction: await manager.savePrediction(req.user, Number(req.params.id), req.body || {}) });
  } catch (e) {
    if (e instanceof manager.ValidationError) return res.status(400).json({ error: e.message });
    if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable' });
    throw e;
  }
  return undefined;
}));

router.get('/leaderboard/:kind/:period', wrap(async (req, res) => {
  const { kind, period } = req.params;
  if (!['manager', 'quiz'].includes(kind) || !['weekly', 'monthly'].includes(period)) return res.status(404).json({ error: 'not_found' });
  if (kind === 'quiz' && !users.isPremium(req.user)) return res.status(402).json({ error: 'premium_required' });
  const top = Number(await settings.get('leaderboard_top')) || 30;
  return res.json(await leaderboard.board(kind, period, req.user.id, top));
}));

// ---------- 🧠 Football Quiz (faqat Premium)
router.get('/quiz', requirePremium, wrap(async (req, res) => res.json(await quiz.state(req.user))));
router.post('/quiz/start', requirePremium, express.json(), wrap(async (req, res) => {
  const r = await quiz.start(req.user, req.body && req.body.questionId);
  return r.error ? res.status(409).json(r) : res.json(r);
}));
router.post('/quiz/answer', requirePremium, express.json(), wrap(async (req, res) => {
  const r = await quiz.answer(req.user, req.body && req.body.questionId, req.body && req.body.option);
  return r.error ? res.status(409).json(r) : res.json(r);
}));

// ---------- 👤 Profil
router.get('/profile', wrap(async (req, res) => {
  const u = await users.byId(req.user.id);
  const stat = async (kind) => {
    const [w, m, overall] = await Promise.all([
      leaderboard.board(kind, 'weekly', u.id, 0),
      leaderboard.board(kind, 'monthly', u.id, 0),
      leaderboard.overallPlace(kind, u.id),
    ]);
    return { week: w.me, month: m.me, total: overall.points, overallPlace: overall.place };
  };
  const counts = await db.one(
    `SELECT (SELECT count(*)::int FROM mini_manager_predictions WHERE user_id = $1) AS predictions,
            (SELECT count(*)::int FROM quiz_answers WHERE user_id = $1 AND answered_at IS NOT NULL) AS answers,
            (SELECT count(*)::int FROM quiz_answers WHERE user_id = $1 AND points_earned > 0) AS correct`,
    [u.id],
  );
  res.json({
    user: publicUser(u), telegramId: u.telegram_id, balance: u.balance, registeredAt: u.registered_at,
    referrals: await users.activeReferralCount(u.id),
    manager: { ...(await stat('manager')), predictions: counts.predictions },
    quiz: users.isPremium(u) ? { ...(await stat('quiz')), answers: counts.answers, correct: counts.correct } : null,
  });
}));

module.exports = router;

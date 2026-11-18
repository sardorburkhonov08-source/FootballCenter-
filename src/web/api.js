// Web App foydalanuvchi API'si (/api)
const express = require('express');
const db = require('../db/pool');
const settings = require('../services/settings');
const users = require('../services/users');
const football = require('../services/football');
const scorePredict = require('../services/scorePredict');
const achievements = require('../services/achievements');
const manager = require('../services/manager');
const quiz = require('../services/quiz');
const leaderboard = require('../services/leaderboard');
const referral = require('../services/referral');
const popularity = require('../services/popularity');
const fancard = require('../services/fancard');
const community = require('../services/community');
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
      if (e instanceof football.FootballUnavailable) {
        football.logError(req.path, e);
        return res.status(503).json({ error: 'football_unavailable', reason: e.reason });
      }
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
/**
 * O'yinlar tartibi: 1) admin belgilagan asosiy ligalar (shu tartibda); 2) avtomatik ommabop ligalar
 * (foydalanuvchilar qiziqishi bo'yicha); 3) qolganlari — davlat, liga nomi va vaqt bo'yicha.
 */
function orderMatches(list, featuredIds, popularIds = []) {
  const rank = new Map(featuredIds.map((id, i) => [Number(id), i]));
  popularIds.forEach((id, i) => { if (!rank.has(Number(id))) rank.set(Number(id), 1000 + i); });
  const r = (m) => (m.competition && rank.has(m.competition.id) ? rank.get(m.competition.id) : Infinity);
  const text = (v) => (v || '').toString();
  return list
    .map((m) => { const x = r(m); return { ...m, featured: x < 1000, popular: x >= 1000 && x !== Infinity }; })
    .sort((a, b) => (r(a) - r(b))
      || (r(a) !== Infinity ? 0 : text(a.area && a.area.name).localeCompare(text(b.area && b.area.name)))
      || text(a.competition && a.competition.name).localeCompare(text(b.competition && b.competition.name))
      || a.utcDate.localeCompare(b.utcDate));
}

/** Liga qiziqishini yozish — foydalanuvchi javobini kechiktirmaydi, xato bo'lsa e'tiborsiz */
function track(req, leagueId) {
  popularity.record(req.user.id, leagueId).catch((e) => console.warn('[popularity]', e.message));
}

router.get('/matches', footballRoute(async (req) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : ymd();
  const featured = (await settings.get('featured_leagues')) || [];
  const list = orderMatches(await football.matchesByDate(date), featured, await popularity.popularIds());
  const subs = await db.many('SELECT api_match_id FROM match_subscriptions WHERE user_id = $1', [req.user.id]);
  const subSet = new Set(subs.map((s) => Number(s.api_match_id)));
  return { date, matches: list.map((m) => ({ ...m, subscribed: subSet.has(m.id) })) };
}));

// 🔍 Jamoa qidirish (ligalar va kunlik o'yinlar Mini App ichida, so'rovsiz qidiriladi)
router.get('/search/teams', footballRoute(async (req) => ({ teams: await football.searchTeams(req.query.q) })));

router.get('/teams/:id/matches', footballRoute(async (req) => {
  if (!/^\d+$/.test(req.params.id)) return { next: [], last: [] };
  return football.teamMatches(req.params.id);
}));

// Mini App'da liga guruhi ochilganda (qiziqish statistikasi uchun)
router.post('/stats/league/:id', wrap(async (req, res) => {
  track(req, req.params.id);
  res.json({ ok: true });
}));

router.get('/matches/:id', requirePremium, footballRoute(async (req) => {
  const d = await football.matchDetail(req.params.id);
  if (d.competition) track(req, d.competition.id);
  return d;
}));

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
  if (m.competition) track(req, m.competition.id);
  await db.query(
    'INSERT INTO match_subscriptions (user_id, api_match_id, kickoff_at, title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [req.user.id, id, m.utcDate, `${m.home.name} — ${m.away.name}`],
  );
  return { subscribed: true };
}));

router.get('/competitions', footballRoute(async () => {
  const data = await football.competitions();
  const all = [...data.international, ...data.countries.flatMap((c) => c.competitions.map((x) => ({ ...x, area: c.name })))];
  const byId = new Map(all.map((x) => [x.id, x]));
  const featuredIds = ((await settings.get('featured_leagues')) || []).map(Number);
  const featured = featuredIds.map((id) => byId.get(id)).filter(Boolean);
  const popular = (await popularity.popularIds()).filter((id) => !featuredIds.includes(id)).map((id) => byId.get(id)).filter(Boolean);
  return { featured, popular, ...data };
}));

const COMP_TABS = ['standings', 'results', 'calendar', 'scorers', 'assists'];
router.get('/competitions/:id', footballRoute(async (req) => ({ ...(await football.competitionInfo(req.params.id)), tabs: COMP_TABS, freeTabs: ['standings'] })));

router.get('/competitions/:id/:tab', (req, res, next) => {
  if (!COMP_TABS.includes(req.params.tab)) return res.status(404).json({ error: 'not_found' });
  if (req.params.tab !== 'standings' && !users.isPremium(req.user)) return res.status(402).json({ error: 'premium_required' });
  return next();
}, footballRoute(async (req) => {
  const { id, tab } = req.params;
  track(req, id);
  if (tab === 'standings') return { standings: await football.standings(id) };
  if (tab === 'results') return { matches: await football.competitionMatches(id, 'results') };
  if (tab === 'calendar') return { matches: await football.competitionMatches(id, 'calendar') };
  const s = await football.scorers(id);
  return { players: tab === 'scorers' ? s.scorers : s.assists };
}));

// ---------- 🎮 Mini Manager (egasi talabi bilan — faqat Premium)
router.post('/manager/coach', requirePremium, express.json(), wrap(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 32) return res.status(400).json({ error: 'bad_coach_name' });
  const u = await db.one('UPDATE users SET coach_name = $2 WHERE id = $1 RETURNING *', [req.user.id, name]);
  return res.json({ coachName: u.coach_name });
}));

router.get('/manager/games', requirePremium, wrap(async (req, res) => {
  res.json({ coachName: req.user.coach_name, games: await manager.listGames(req.user) });
}));

router.get('/manager/games/:id', requirePremium, wrap(async (req, res) => {
  const g = await manager.getGame(req.user, Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'not_found' });
  return res.json(g);
}));

router.post('/manager/games/:id/prediction', requirePremium, express.json(), wrap(async (req, res) => {
  try {
    res.json({ prediction: await manager.savePrediction(req.user, Number(req.params.id), req.body || {}) });
  } catch (e) {
    if (e instanceof manager.ValidationError) return res.status(400).json({ error: e.message });
    if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable', reason: e.reason });
    throw e;
  }
  return undefined;
}));

// ---------- 🎯 Hisobni top (faqat Premium)
function scoreRoute(fn) {
  return wrap(async (req, res) => {
    try {
      return res.json(await fn(req));
    } catch (e) {
      if (e instanceof scorePredict.ScoreError) return res.status(e.message === 'not_found' ? 404 : e.message === 'locked' ? 409 : 400).json({ error: e.message });
      throw e;
    }
  });
}
router.get('/score/games', requirePremium, scoreRoute((req) => scorePredict.listGames(req.user)));
router.post('/score/games/:id', requirePremium, express.json(), scoreRoute((req) => scorePredict.savePrediction(req.user, req.params.id, req.body || {})));

router.get('/leaderboard/:kind/:period', wrap(async (req, res) => {
  const { kind, period } = req.params;
  if (!['manager', 'quiz', 'score'].includes(kind) || !['weekly', 'monthly'].includes(period)) return res.status(404).json({ error: 'not_found' });
  if (kind !== 'manager' && !users.isPremium(req.user)) return res.status(402).json({ error: 'premium_required' });
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
  if (!r.error) achievements.checkLater(req.user.id);
  return r.error ? res.status(409).json(r) : res.json(r);
}));

// ---------- 🪪 Muxlislik kartasi (faqat Premium; Premium bo'lmaganlarga namunaviy karta ko'rsatiladi)
async function fanCardResponse(user) {
  const data = await fancard.getCard(user);
  const u = await users.byId(user.id);
  return {
    ...data,
    balance: Number(u.balance),
    refLink: config.botUsername && u.ref_code ? `https://t.me/${config.botUsername}?start=ref_${u.ref_code}` : null,
    storyUrl: data.images && config.publicUrl ? `${config.publicUrl}${data.images.story}` : null,
  };
}

/** Karta amallari: xatolar bir xil formatda qaytadi */
function cardRoute(fn) {
  return wrap(async (req, res) => {
    try {
      await fn(req);
    } catch (e) {
      if (e instanceof fancard.CardError) {
        const status = e.message === 'premium_required' ? 402 : ['no_money', 'already_active', 'photo_locked', 'same_team'].includes(e.message) ? 409 : 400;
        return res.status(status).json({ error: e.message });
      }
      if (e instanceof football.FootballUnavailable) return res.status(503).json({ error: 'football_unavailable', reason: e.reason });
      throw e;
    }
    return res.json(await fanCardResponse(req.user));
  });
}
const photoJson = express.json({ limit: '3mb' });

router.get('/fan-card', wrap(async (req, res) => res.json(await fanCardResponse(req.user))));
router.post('/fan-card/activate', photoJson, cardRoute((req) => fancard.activate(req.user, req.body || {})));
router.patch('/fan-card', express.json(), cardRoute((req) => fancard.updateFavorites(req.user, req.body || {})));
router.post('/fan-card/photo', photoJson, cardRoute((req) => fancard.uploadPhoto(req.user, req.body && req.body.photo)));
router.post('/fan-card/club', express.json(), cardRoute((req) => fancard.changeClub(req.user, req.body && req.body.teamId)));

// Sevimli futbolchi uchun taklif ro'yxati — tanlangan klub tarkibidan
router.get('/teams/:id/squad', footballRoute(async (req) => {
  if (!/^\d+$/.test(req.params.id)) return { players: [] };
  return { players: (await football.squad(req.params.id)).map((p) => p.name) };
}));

// ---------- 👥 Fan community
function communityRoute(fn) {
  return wrap(async (req, res) => {
    try {
      return res.json(await fn(req));
    } catch (e) {
      if (e instanceof community.CommunityError) {
        const status = e.message === 'premium_required' ? 402 : e.message === 'not_found' ? 404 : ['not_owner'].includes(e.message) ? 403 : 409;
        return res.status(['bad_name', 'bad_description', 'bad_post'].includes(e.message) ? 400 : status).json({ error: e.message });
      }
      throw e;
    }
  });
}
router.get('/community', communityRoute((req) => community.overview(req.user)));
router.get('/community/:id', communityRoute((req) => community.detail(req.user, req.params.id)));
router.post('/community', express.json(), communityRoute(async (req) => {
  const r = await community.requestCreate(req.user, req.body || {});
  community.notifyAdmins(r).catch((e) => console.error('[community notify]', e));
  return { ok: true, id: r.id, price: Number(r.price) };
}));
router.post('/community/leave', communityRoute(async (req) => { await community.leave(req.user); return { ok: true }; }));
router.post('/community/:id/join', communityRoute(async (req) => { await community.join(req.user, req.params.id); return { ok: true }; }));
router.patch('/community/:id', express.json(), communityRoute(async (req) => { await community.updateInfo(req.user, req.params.id, req.body || {}); return { ok: true }; }));
router.post('/community/:id/kick', express.json(), communityRoute(async (req) => {
  const r = await community.kick(req.user, req.params.id, req.body && req.body.userId);
  if (r.user) require('../services/notify').toUser(r.user, 'community_kicked', { name: r.community.name }).catch(() => {});
  return { ok: true };
}));
router.post('/community/:id/posts', express.json(), communityRoute(async (req) => community.addPost(req.user, req.params.id, req.body && req.body.text)));
router.post('/community/posts/:postId/react', express.json(), communityRoute(async (req) => community.react(req.user, req.params.postId, req.body && req.body.reaction)));
router.delete('/community/posts/:postId', communityRoute(async (req) => { await community.deletePost(req.user, req.params.postId); return { ok: true }; }));

// ---------- 🏅 Yutuqlar va 📤 natija kartasi
router.get('/share', wrap(async (req, res) => res.json(await require('../services/shareCard').info(req.user))));

// ---------- 👤 Profil
router.get('/profile', wrap(async (req, res) => {
  await achievements.check(req.user.id).catch((e) => console.error('[achievements]', e.message));
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
            (SELECT count(*)::int FROM quiz_answers WHERE user_id = $1 AND points_earned > 0) AS correct,
            (SELECT count(*)::int FROM score_predictions WHERE user_id = $1) AS score_predictions,
            (SELECT count(*)::int FROM score_predictions WHERE user_id = $1 AND points_earned > 0) AS score_hits`,
    [u.id],
  );
  res.json({
    user: publicUser(u), telegramId: u.telegram_id, balance: u.balance, registeredAt: u.registered_at,
    referrals: await users.activeReferralCount(u.id),
    manager: users.isPremium(u) ? { ...(await stat('manager')), predictions: counts.predictions } : null,
    quiz: users.isPremium(u) ? { ...(await stat('quiz')), answers: counts.answers, correct: counts.correct } : null,
    score: users.isPremium(u) ? { ...(await stat('score')), predictions: counts.score_predictions, hits: counts.score_hits } : null,
    achievements: await achievements.forUser(u.id, u.language || 'uz'),
  });
}));

module.exports = router;
module.exports.orderMatches = orderMatches;

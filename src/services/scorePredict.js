// 🎯 "Hisobni top" — admin belgilagan o'yinlar uchun aniq hisobni taxmin qilish (egasi talabi bilan, faqat Premium).
// - Admin web admin'da API'dagi kelgusi o'yinlardan bir nechtasini belgilaydi.
// - Foydalanuvchi o'yin boshlanguncha hisobni kiritadi/o'zgartiradi; boshlangach taxmin qulflanadi.
// - O'yin tugagach ball beriladi: aniq hisob — score_exact_points, faqat natija to'g'ri — score_outcome_points.
//   Ballar umumiy points'ga qo'shiladi (users.points_score).
// - API yuklamasi: natijalar bir kunning barcha o'yinlari bilan bitta so'rovda olinadi (/fixtures?date=, keshlangan).
const db = require('../db/pool');
const football = require('./football');
const settings = require('./settings');
const { ymd } = require('./time');

class ScoreError extends Error {}

const MAX_GOALS = 20;
const SCORE_AFTER_MIN = 110;   // boshlanganidan shuncha daqiqa o'tgach natija tekshiriladi

async function rules() {
  const s = await settings.getMany(['score_exact_points', 'score_outcome_points']);
  return { exact: Number(s.score_exact_points), outcome: Number(s.score_outcome_points) };
}

const outcome = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');

/** Taxmin uchun ball: aniq hisob → exact, faqat natija → outcome, aks holda 0 */
function points(pred, result, r) {
  if (pred.home === result.home && pred.away === result.away) return r.exact;
  if (outcome(pred.home, pred.away) === outcome(result.home, result.away)) return r.outcome;
  return 0;
}

function isLocked(g) { return g.status !== 'upcoming' || new Date(g.kickoff_at) <= new Date(); }

function publicGame(g, p) {
  return {
    id: g.id, competition: g.competition, kickoffAt: g.kickoff_at, status: g.status, locked: isLocked(g),
    home: { name: g.home_team_name, crest: g.home_team_crest },
    away: { name: g.away_team_name, crest: g.away_team_crest },
    result: g.result,
    prediction: p ? { home: p.home, away: p.away, points: p.points_earned } : null,
  };
}

// ---------- Admin
async function assignGame(apiMatchId) {
  const m = football.normMatch(await football.rawMatch(apiMatchId));
  if (m.state !== 'scheduled' || new Date(m.utcDate) <= new Date()) throw new ScoreError('match_not_scheduled');
  return db.one(
    `INSERT INTO score_games (api_match_id, home_team_id, home_team_name, home_team_crest, away_team_id, away_team_name,
       away_team_crest, competition, kickoff_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (api_match_id) DO UPDATE SET kickoff_at = EXCLUDED.kickoff_at RETURNING *`,
    [m.id, m.home.id, m.home.fullName, m.home.crest, m.away.id, m.away.fullName, m.away.crest,
      m.competition ? m.competition.name : null, new Date(m.utcDate)],
  );
}

async function adminList() {
  return db.many(
    `SELECT g.*, (SELECT count(*)::int FROM score_predictions p WHERE p.game_id = g.id) AS participants
     FROM score_games g ORDER BY kickoff_at DESC LIMIT 100`,
  );
}

/** Hisoblangan o'yin o'chirilmaydi (ballar berilgan) */
async function removeGame(id) {
  const g = await db.one('SELECT * FROM score_games WHERE id = $1', [Number(id)]);
  if (!g) throw new ScoreError('not_found');
  if (g.status === 'finished') throw new ScoreError('already_finished');
  await db.query('DELETE FROM score_games WHERE id = $1', [g.id]);
}

// ---------- Foydalanuvchi
/** Kelgusi va boshlangan o'yinlar + oxirgi 3 kunda tugaganlar */
async function listGames(user) {
  const games = await db.many(
    `SELECT * FROM score_games WHERE status <> 'finished' OR kickoff_at > now() - interval '3 days'
     ORDER BY (status = 'finished'), kickoff_at LIMIT 60`,
  );
  const preds = games.length
    ? await db.many('SELECT * FROM score_predictions WHERE user_id = $1 AND game_id = ANY($2::int[])', [user.id, games.map((g) => g.id)])
    : [];
  return { games: games.map((g) => publicGame(g, preds.find((p) => p.game_id === g.id))), rules: await rules() };
}

function goals(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isInteger(n) || n < 0 || n > MAX_GOALS) throw new ScoreError('bad_score');
  return n;
}

async function savePrediction(user, gameId, body = {}) {
  const home = goals(body.home);
  const away = goals(body.away);
  const g = await db.one('SELECT * FROM score_games WHERE id = $1', [Number(gameId)]);
  if (!g) throw new ScoreError('not_found');
  if (isLocked(g)) throw new ScoreError('locked');
  const p = await db.one(
    `INSERT INTO score_predictions (user_id, game_id, home, away) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, game_id) DO UPDATE SET home = EXCLUDED.home, away = EXCLUDED.away, updated_at = now()
     RETURNING *`,
    [user.id, g.id, home, away],
  );
  return publicGame(g, p);
}

// ---------- Fon vazifalari
async function lockStarted() {
  const r = await db.query("UPDATE score_games SET status = 'locked' WHERE status = 'upcoming' AND kickoff_at <= now()");
  return r.rowCount;
}

/** Bitta o'yinga ball berish (bir marta) */
async function finish(g, result) {
  const r = await rules();
  const users = await db.tx(async (c) => {
    const done = await c.query("UPDATE score_games SET status = 'finished', result = $2::jsonb WHERE id = $1 AND status = 'locked' RETURNING id",
      [g.id, JSON.stringify(result)]);
    if (!done.rowCount) return 0;
    const preds = (await c.query('SELECT * FROM score_predictions WHERE game_id = $1', [g.id])).rows;
    for (const p of preds) {
      const pts = points(p, result, r);
      await c.query('UPDATE score_predictions SET points_earned = $2 WHERE id = $1', [p.id, pts]);
      if (pts) await c.query('UPDATE users SET points_score = points_score + $2 WHERE id = $1', [p.user_id, pts]);
    }
    return preds.map((p) => p.user_id);
  });
  require('./achievements').checkLater(...users);
  return users.length;
}

/** Tugagan o'yinlarni hisoblash: har bir kun uchun bitta API so'rovi */
async function scoreFinished() {
  const games = await db.many(
    `SELECT * FROM score_games WHERE status = 'locked' AND kickoff_at < now() - ($1 || ' minutes')::interval ORDER BY kickoff_at`,
    [String(SCORE_AFTER_MIN)],
  );
  const byDay = new Map();
  for (const g of games) {
    const d = ymd(new Date(g.kickoff_at));
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(g);
  }
  let scored = 0;
  for (const [day, list] of byDay) {
    let matches;
    try { matches = await football.matchesByDate(day, { background: true }); } catch (e) { continue; }
    for (const g of list) {
      const m = matches.find((x) => Number(x.id) === Number(g.api_match_id));
      if (m && m.state === 'finished') {
        if (m.score.home === null || m.score.home === undefined) continue;
        await finish(g, { home: m.score.home, away: m.score.away });
        scored += 1;
      } else if (!m || m.state === 'cancelled') {
        // Kun ro'yxatida yo'q yoki qoldirilgan — o'yinni alohida tekshiramiz (kam uchraydi)
        let raw;
        try { raw = football.normMatch(await football.rawMatch(g.api_match_id, { background: true })); } catch (e) { continue; }
        if (raw.state === 'finished' && raw.score.home !== null && raw.score.home !== undefined) {
          await finish(g, { home: raw.score.home, away: raw.score.away });
          scored += 1;
        } else if (raw.state !== 'live' && raw.utcDate && new Date(raw.utcDate) > new Date()) {
          // Boshqa kunga ko'chirilgan — taxminlar yana ochiladi
          await db.query("UPDATE score_games SET status = 'upcoming', kickoff_at = $2 WHERE id = $1", [g.id, raw.utcDate]);
        }
      }
    }
  }
  return scored;
}

module.exports = {
  ScoreError, MAX_GOALS, rules, points, isLocked, assignGame, adminList, removeGame, listGames, savePrediction, lockStarted, scoreFinished,
};

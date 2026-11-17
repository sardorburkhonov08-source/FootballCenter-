// 🎮 Mini Manager
const db = require('../db/pool');
const football = require('./football');
const settings = require('./settings');
const scoring = require('./scoring');
const notify = require('./notify');
const { weekRange } = require('./time');

class ValidationError extends Error {}

async function assignGame(apiMatchId) {
  const m = football.normMatch(await football.rawMatch(apiMatchId));
  if (m.state !== 'scheduled') throw new ValidationError('match_not_scheduled');
  const kickoff = new Date(m.utcDate);
  const w = weekRange(kickoff);
  return db.one(
    `INSERT INTO mini_manager_games (api_match_id, home_team_id, home_team_name, home_team_crest, away_team_id, away_team_name,
       away_team_crest, competition, kickoff_at, week_start, week_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (api_match_id) DO UPDATE SET kickoff_at = EXCLUDED.kickoff_at RETURNING *`,
    [m.id, m.home.id, m.home.fullName, m.home.crest, m.away.id, m.away.fullName, m.away.crest,
      m.competition ? m.competition.name : null, kickoff, w.start, w.end],
  );
}

function isLocked(game) {
  return game.status !== 'upcoming' || new Date(game.kickoff_at) <= new Date();
}

function publicGame(g, pred) {
  return {
    id: g.id, apiMatchId: g.api_match_id, competition: g.competition, kickoffAt: g.kickoff_at, status: g.status,
    locked: isLocked(g), weekStart: g.week_start, weekEnd: g.week_end,
    home: { id: g.home_team_id, name: g.home_team_name, crest: g.home_team_crest },
    away: { id: g.away_team_id, name: g.away_team_name, crest: g.away_team_crest },
    result: g.result,
    prediction: pred ? publicPrediction(pred) : null,
  };
}

function publicPrediction(p) {
  return {
    tacticHome: p.tactic_home, tacticAway: p.tactic_away, lineupHome: p.lineup_home, lineupAway: p.lineup_away,
    scorerHome: p.scorer_home, scorerAway: p.scorer_away, assistHome: p.assist_home, assistAway: p.assist_away,
    redHome: p.red_card_home, redAway: p.red_card_away, yellowHome: p.yellow_card_home, yellowAway: p.yellow_card_away,
    scoreHome: p.predicted_score_home, scoreAway: p.predicted_score_away, winner: p.predicted_winner,
    points: p.points_earned, breakdown: p.points_breakdown, updatedAt: p.updated_at,
  };
}

/** Joriy hafta o'yinlari + kelgusi o'yinlar + oxirgi tugaganlar */
async function listGames(user) {
  const w = weekRange();
  const games = await db.many(
    `SELECT * FROM mini_manager_games
     WHERE (week_start = $1) OR status = 'upcoming' OR kickoff_at > now() - interval '14 days'
     ORDER BY kickoff_at DESC LIMIT 30`,
    [w.start],
  );
  const preds = games.length ? await db.many('SELECT * FROM mini_manager_predictions WHERE user_id = $1 AND game_id = ANY($2)', [user.id, games.map((g) => g.id)]) : [];
  return games.map((g) => publicGame(g, preds.find((p) => p.game_id === g.id)));
}

async function getGame(user, gameId) {
  const g = await db.one('SELECT * FROM mini_manager_games WHERE id = $1', [gameId]);
  if (!g) return null;
  const pred = await db.one('SELECT * FROM mini_manager_predictions WHERE user_id = $1 AND game_id = $2', [user.id, g.id]);
  let squads = { home: [], away: [] };
  let squadError = false;
  try {
    const [home, away] = await Promise.all([football.squad(g.home_team_id), football.squad(g.away_team_id)]);
    squads = { home, away };
  } catch (e) {
    squadError = true;
  }
  return { ...publicGame(g, pred), squads, squadError, tactics: await settings.get('tactics') };
}

function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

async function savePrediction(user, gameId, body) {
  if (!user.coach_name) throw new ValidationError('coach_required');
  const g = await db.one('SELECT * FROM mini_manager_games WHERE id = $1', [gameId]);
  if (!g) throw new ValidationError('game_not_found');
  if (isLocked(g)) throw new ValidationError('locked');

  const tactics = await settings.get('tactics');
  if (!tactics.includes(body.tacticHome) || !tactics.includes(body.tacticAway)) throw new ValidationError('bad_tactic');

  const [homeSquad, awaySquad] = await Promise.all([football.squad(g.home_team_id), football.squad(g.away_team_id)]);
  const homeIds = new Set(homeSquad.map((p) => p.id));
  const awayIds = new Set(awaySquad.map((p) => p.id));

  const checkLineup = (arr, ids) => {
    if (!Array.isArray(arr) || arr.length !== 11) return false;
    const nums = arr.map(Number);
    return new Set(nums).size === 11 && nums.every((id) => ids.has(id));
  };
  if (!checkLineup(body.lineupHome, homeIds) || !checkLineup(body.lineupAway, awayIds)) throw new ValidationError('bad_lineup');

  const pick = (v, ids) => {
    const n = intOrNull(v);
    if (Number.isNaN(n)) throw new ValidationError('bad_pick');
    if (n === null || n === scoring.NONE) return n;
    if (!ids.has(n)) throw new ValidationError('bad_pick');
    return n;
  };
  const picks = {
    scorer_home: pick(body.scorerHome, homeIds), scorer_away: pick(body.scorerAway, awayIds),
    assist_home: pick(body.assistHome, homeIds), assist_away: pick(body.assistAway, awayIds),
    red_card_home: pick(body.redHome, homeIds), red_card_away: pick(body.redAway, awayIds),
    yellow_card_home: pick(body.yellowHome, homeIds), yellow_card_away: pick(body.yellowAway, awayIds),
  };
  const sh = intOrNull(body.scoreHome);
  const sa = intOrNull(body.scoreAway);
  if (sh === null || sa === null || Number.isNaN(sh) || Number.isNaN(sa) || sh > 30 || sa > 30) throw new ValidationError('bad_score');
  if (!['HOME', 'AWAY', 'DRAW'].includes(body.winner)) throw new ValidationError('bad_winner');
  const scoreWinner = sh > sa ? 'HOME' : sh < sa ? 'AWAY' : 'DRAW';
  if (scoreWinner !== body.winner) throw new ValidationError('winner_mismatch');

  const row = await db.one(
    `INSERT INTO mini_manager_predictions (user_id, game_id, coach_name, tactic_home, tactic_away, lineup_home, lineup_away,
       scorer_home, scorer_away, assist_home, assist_away, red_card_home, red_card_away, yellow_card_home, yellow_card_away,
       predicted_score_home, predicted_score_away, predicted_winner, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     ON CONFLICT (user_id, game_id) DO UPDATE SET coach_name = EXCLUDED.coach_name, tactic_home = EXCLUDED.tactic_home,
       tactic_away = EXCLUDED.tactic_away, lineup_home = EXCLUDED.lineup_home, lineup_away = EXCLUDED.lineup_away,
       scorer_home = EXCLUDED.scorer_home, scorer_away = EXCLUDED.scorer_away, assist_home = EXCLUDED.assist_home,
       assist_away = EXCLUDED.assist_away, red_card_home = EXCLUDED.red_card_home, red_card_away = EXCLUDED.red_card_away,
       yellow_card_home = EXCLUDED.yellow_card_home, yellow_card_away = EXCLUDED.yellow_card_away,
       predicted_score_home = EXCLUDED.predicted_score_home, predicted_score_away = EXCLUDED.predicted_score_away,
       predicted_winner = EXCLUDED.predicted_winner, updated_at = now()
     WHERE NOT mini_manager_predictions.is_locked
     RETURNING *`,
    [user.id, g.id, user.coach_name, body.tacticHome, body.tacticAway, JSON.stringify(body.lineupHome.map(Number)),
      JSON.stringify(body.lineupAway.map(Number)), picks.scorer_home, picks.scorer_away, picks.assist_home, picks.assist_away,
      picks.red_card_home, picks.red_card_away, picks.yellow_card_home, picks.yellow_card_away, sh, sa, body.winner],
  );
  if (!row) throw new ValidationError('locked');
  return publicPrediction(row);
}

/** Boshlangan o'yinlarni qulflash */
async function lockStarted() {
  const games = await db.many("UPDATE mini_manager_games SET status = 'locked' WHERE status = 'upcoming' AND kickoff_at <= now() RETURNING id");
  if (games.length) await db.query('UPDATE mini_manager_predictions SET is_locked = true WHERE game_id = ANY($1)', [games.map((g) => g.id)]);
  return games.length;
}

/** Tugagan o'yinlarni API orqali hisoblash */
async function scoreFinished() {
  const games = await db.many("SELECT * FROM mini_manager_games WHERE status = 'locked' AND kickoff_at < now() - interval '100 minutes'");
  let scored = 0;
  for (const g of games) {
    let m;
    try { m = await football.rawMatch(g.api_match_id, { background: true }); } catch (e) { continue; }
    const state = football.matchState(m.status);
    if (state === 'cancelled') {
      // O'yin qoldirildi — taxminlar ochiladi va kickoff yangilanadi
      if (m.utcDate && new Date(m.utcDate) > new Date()) {
        await db.query("UPDATE mini_manager_games SET status = 'upcoming', kickoff_at = $2 WHERE id = $1", [g.id, m.utcDate]);
        await db.query('UPDATE mini_manager_predictions SET is_locked = false WHERE game_id = $1', [g.id]);
      }
      continue;
    }
    if (state !== 'finished') continue;
    const result = scoring.extractResult(m);
    if (result.homeGoals === null || result.homeGoals === undefined) continue;
    const scoredPreds = await db.tx(async (c) => {
      const done = await c.query("UPDATE mini_manager_games SET status = 'finished', result = $2::jsonb WHERE id = $1 AND status = 'locked' RETURNING id",
        [g.id, JSON.stringify({ home: result.homeGoals, away: result.awayGoals })]);
      if (!done.rowCount) return [];
      const preds = (await c.query('SELECT * FROM mini_manager_predictions WHERE game_id = $1', [g.id])).rows;
      for (const p of preds) {
        const s = scoring.score(p, result);
        await c.query('UPDATE mini_manager_predictions SET points_earned = $2, points_breakdown = $3::jsonb, is_locked = true WHERE id = $1',
          [p.id, s.total, JSON.stringify(s.breakdown)]);
        await c.query('UPDATE users SET points_manager = points_manager + $2 WHERE id = $1', [p.user_id, s.total]);
        p.points_earned = s.total;
      }
      return preds;
    });
    if (!scoredPreds.length && !(await db.one("SELECT 1 AS x FROM mini_manager_games WHERE id = $1 AND status = 'finished'", [g.id]))) continue;
    scored += 1;
    const title = `${g.home_team_name} ${result.homeGoals}:${result.awayGoals} ${g.away_team_name}`;
    for (const p of scoredPreds) {
      const u = await db.one('SELECT * FROM users WHERE id = $1', [p.user_id]);
      await notify.toUser(u, 'manager_result_notify', { title, points: p.points_earned }, { kind: 'manager_result' });
    }
  }
  return scored;
}

module.exports = { ValidationError, assignGame, listGames, getGame, savePrediction, lockStarted, scoreFinished, isLocked };

const db = require('../db/pool');
const { weekRange, monthRange } = require('./time');

function range(period, date = new Date()) {
  return period === 'monthly' ? monthRange(date) : weekRange(date);
}

// Reyting hisoblash og'ir (barcha javoblarni yig'adi). Natija 30 soniya umumiy keshda saqlanadi:
// minglab foydalanuvchi bir vaqtda ochsa ham bazada bitta hisob-kitob bajariladi.
const RANKING_TTL_MS = 30 * 1000;
const rankingCache = new Map();   // key -> { at, promise }

function clearRankingCache() { rankingCache.clear(); }

/** Davr bo'yicha reyting (keshlangan): kind = manager | quiz | score | duel */
async function ranking(kind, r) {
  const key = `${kind}:${new Date(r.start).getTime()}:${new Date(r.end).getTime()}`;
  const hit = rankingCache.get(key);
  if (hit && Date.now() - hit.at < RANKING_TTL_MS) return hit.promise;
  const promise = computeRanking(kind, r);
  rankingCache.set(key, { at: Date.now(), promise });
  promise.catch(() => rankingCache.delete(key));
  if (rankingCache.size > 50) rankingCache.delete(rankingCache.keys().next().value);
  return promise;
}

async function computeRanking(kind, r) {
  if (kind === 'manager') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(p.points_earned)::int AS points, max(g.kickoff_at) AS last_at
       FROM mini_manager_predictions p
       JOIN mini_manager_games g ON g.id = p.game_id
       JOIN users u ON u.id = p.user_id
       WHERE g.status = 'finished' AND p.points_earned IS NOT NULL AND g.kickoff_at >= $1 AND g.kickoff_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(p.points_earned) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end],
    );
  }
  if (kind === 'quest') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(q.reward)::int AS points, max(q.claimed_at) AS last_at
       FROM user_quest_days q JOIN users u ON u.id = q.user_id
       WHERE q.claimed_at >= $1 AND q.claimed_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(q.reward) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end],
    );
  }
  if (kind === 'crossbar' || kind === 'keepy') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(g.points)::int AS points, max(g.finished_at) AS last_at
       FROM arcade_games g JOIN users u ON u.id = g.user_id
       WHERE g.kind = $3 AND g.status = 'finished' AND g.finished_at >= $1 AND g.finished_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(g.points) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end, kind],
    );
  }
  if (kind === 'penalty') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(g.points)::int AS points, max(g.finished_at) AS last_at
       FROM penalty_games g JOIN users u ON u.id = g.user_id
       WHERE g.status = 'finished' AND g.finished_at >= $1 AND g.finished_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(g.points) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end],
    );
  }
  if (kind === 'duel') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(r.points)::int AS points, max(r.created_at) AS last_at
       FROM duel_results r JOIN users u ON u.id = r.user_id
       WHERE r.created_at >= $1 AND r.created_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(r.points) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end],
    );
  }
  if (kind === 'score') {
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(p.points_earned)::int AS points, max(g.kickoff_at) AS last_at
       FROM score_predictions p
       JOIN score_games g ON g.id = p.game_id
       JOIN users u ON u.id = p.user_id
       WHERE g.status = 'finished' AND p.points_earned IS NOT NULL AND g.kickoff_at >= $1 AND g.kickoff_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(p.points_earned) > 0
       ORDER BY points DESC, last_at ASC`,
      [r.start, r.end],
    );
  }
  return db.many(
    `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
            sum(a.points_earned)::int AS points, sum(a.response_time_seconds) AS total_time
     FROM quiz_answers a JOIN users u ON u.id = a.user_id
     WHERE a.answered_at >= $1 AND a.answered_at < $2 AND NOT u.is_blocked
     GROUP BY u.id HAVING sum(a.points_earned) > 0
     ORDER BY points DESC, total_time ASC`,
    [r.start, r.end],
  );
}

function label(row, kind) {
  if (kind === 'manager' && row.coach_name) return row.coach_name;
  const n = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return n || (row.username ? `@${row.username}` : `#${row.id}`);
}

/** TOP N + foydalanuvchining o'z o'rni */
async function board(kind, period, userId, top = 30) {
  const r = range(period);
  const rows = await ranking(kind, r);
  const list = rows.slice(0, top).map((row, i) => ({ place: i + 1, name: label(row, kind), points: row.points, me: row.id === userId }));
  const idx = rows.findIndex((row) => row.id === userId);
  return {
    period, start: r.start, end: r.end, top: list,
    me: idx === -1 ? null : { place: idx + 1, points: rows[idx].points, total: rows.length },
  };
}

/** Umumiy (barcha vaqt) o'rin */
async function overallPlace(kind, userId) {
  const col = { manager: 'points_manager', quiz: 'points_quiz', score: 'points_score', duel: 'points_duel', penalty: 'points_penalty' }[kind];
  const r = await db.one(
    `SELECT u.${col} AS points,
            (SELECT count(*)::int + 1 FROM users x WHERE x.${col} > u.${col} AND NOT x.is_blocked) AS place
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  return r && r.points > 0 ? r : { points: r ? r.points : 0, place: null };
}

module.exports = { range, ranking, computeRanking, board, overallPlace, label, clearRankingCache, RANKING_TTL_MS };

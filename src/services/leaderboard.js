const db = require('../db/pool');
const { weekRange, monthRange } = require('./time');

function range(period, date = new Date()) {
  return period === 'monthly' ? monthRange(date) : weekRange(date);
}

/** Davr bo'yicha reyting: kind = manager | quiz */
async function ranking(kind, r) {
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
  const col = kind === 'manager' ? 'points_manager' : 'points_quiz';
  const r = await db.one(
    `SELECT u.${col} AS points,
            (SELECT count(*)::int + 1 FROM users x WHERE x.${col} > u.${col} AND NOT x.is_blocked) AS place
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  return r && r.points > 0 ? r : { points: r ? r.points : 0, place: null };
}

module.exports = { range, ranking, board, overallPlace, label };

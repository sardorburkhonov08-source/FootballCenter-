const db = require('../db/pool');
const { weekRange, monthRange, dayStart } = require('./time');

function range(period, date = new Date()) {
  if (period === 'daily') { const start = dayStart(date); return { start, end: new Date(start.getTime() + 86400000) }; }
  return period === 'monthly' ? monthRange(date) : weekRange(date);
}

// 🏆 Umumiy reyting (egasi talabi bilan): hamma o'yinlar points'i yig'indisi — faqat foydalanuvchining o'zi to'plagani
// (community bunga kirmaydi). Haftalik va oylik g'oliblar shu reyting bo'yicha aniqlanadi.
// admin — ⭐ admin qo'shgan/olib tashlagan points (point_adjustments; manfiy bo'lishi mumkin)
const GAME_KINDS = ['manager', 'quiz', 'score', 'duel', 'penalty', 'crossbar', 'keepy', 'quest', 'poll', 'admin'];

// Reyting hisoblash og'ir (barcha javoblarni yig'adi). Natija 30 soniya umumiy keshda saqlanadi:
// minglab foydalanuvchi bir vaqtda ochsa ham bazada bitta hisob-kitob bajariladi.
const RANKING_TTL_MS = 30 * 1000;
const rankingCache = new Map();   // key -> { at, promise }

function clearRankingCache() { rankingCache.clear(); }

/** Davr bo'yicha reyting (keshlangan): kind = manager | quiz | score | duel */
async function ranking(kind, r, maxAgeMs = RANKING_TTL_MS) {
  const key = `${kind}:${new Date(r.start).getTime()}:${new Date(r.end).getTime()}`;
  const hit = rankingCache.get(key);
  if (hit && Date.now() - hit.at < Math.min(maxAgeMs, RANKING_TTL_MS)) return hit.promise;
  const promise = computeRanking(kind, r);
  rankingCache.set(key, { at: Date.now(), promise });
  promise.catch(() => rankingCache.delete(key));
  if (rankingCache.size > 50) rankingCache.delete(rankingCache.keys().next().value);
  return promise;
}

async function computeRanking(kind, r) {
  if (kind === 'overall') {
    const lists = await Promise.all(GAME_KINDS.map((k) => computeRanking(k, r)));
    const acc = new Map();
    for (const row of lists.flat()) {
      const cur = acc.get(row.id) || { ...row, points: 0, last_at: null };
      cur.points += Number(row.points) || 0;
      if (row.last_at && (!cur.last_at || new Date(row.last_at) > new Date(cur.last_at))) cur.last_at = row.last_at;
      acc.set(row.id, cur);
    }
    // teng bo'lsa — kim oldin yetib olgan (oxirgi points vaqti erta)
    return [...acc.values()].filter((x) => x.points > 0).sort((a, b) => b.points - a.points
      || (a.last_at && b.last_at ? new Date(a.last_at) - new Date(b.last_at) : 0) || a.id - b.id);
  }
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
  if (kind === 'admin') {   // ⭐ admin tuzatishlari (umumiy reytingga qo'shiladi; manfiy ham bo'ladi)
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(p.amount)::int AS points, max(p.created_at) AS last_at
       FROM point_adjustments p JOIN users u ON u.id = p.user_id
       WHERE p.created_at >= $1 AND p.created_at < $2 AND NOT u.is_blocked
       GROUP BY u.id HAVING sum(p.amount) <> 0`,
      [r.start, r.end],
    );
  }
  if (kind === 'poll') {   // 🗳 "Kim yutadi?" (sinov)
    return db.many(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.coach_name,
              sum(v.points)::int AS points, max(v.scored_at) AS last_at
       FROM poll_votes v JOIN users u ON u.id = v.user_id
       WHERE v.points > 0 AND v.scored_at >= $1 AND v.scored_at < $2 AND NOT u.is_blocked
       GROUP BY u.id ORDER BY points DESC, last_at ASC`,
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
  const slice = rows.slice(0, top);
  // Profil rasmlari (podium uchun) — bitta so'rov
  const photos = slice.length ? new Map((await db.many('SELECT id, photo_url FROM users WHERE id = ANY($1::bigint[])', [slice.map((x) => x.id)])).map((x) => [Number(x.id), x.photo_url])) : new Map();
  const list = slice.map((row, i) => ({ place: i + 1, name: label(row, kind), points: row.points, me: row.id === userId, photo: photos.get(Number(row.id)) || null }));
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

module.exports = { GAME_KINDS, range, ranking, computeRanking, board, overallPlace, label, clearRankingCache, RANKING_TTL_MS };

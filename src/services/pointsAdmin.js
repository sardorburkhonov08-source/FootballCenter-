// ⭐ Admin tomonidan points qo'shish / olib tashlash (egasi talabi).
// Tuzatish umumiy points'ga (users.points_admin) va haftalik/oylik umumiy reytingga (point_adjustments.created_at) ta'sir qiladi.
// Olib tashlashda umumiy points 0 dan pastga tushmaydi.
const db = require('../db/pool');
const users = require('./users');

const MAX_AMOUNT = 100000;

class PointsError extends Error {}

/** amount: musbat — qo'shish, manfiy — olib tashlash. Natija: { user, amount (haqiqiy), total } */
async function adjust(userId, amount, adminId, reason = null) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > MAX_AMOUNT) throw new PointsError('bad_amount');
  const res = await db.tx(async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!u) throw new PointsError('not_found');
    const total = users.totalPoints(u);
    const real = n < 0 ? Math.max(n, -total) : n;
    if (real === 0) throw new PointsError('nothing_to_remove');
    const upd = (await c.query('UPDATE users SET points_admin = points_admin + $2 WHERE id = $1 RETURNING *', [userId, real])).rows[0];
    await c.query('INSERT INTO point_adjustments (user_id, admin_id, amount, reason) VALUES ($1, $2, $3, $4)',
      [userId, adminId || null, real, reason ? String(reason).slice(0, 300) : null]);
    return { user: upd, amount: real, total: users.totalPoints(upd) };
  });
  require('./leaderboard').clearRankingCache();
  if (res.amount > 0) require('./achievements').checkLater(userId);
  return res;
}

/** Oxirgi tuzatishlar (admin uchun) */
function history(userId, limit = 5) {
  return db.many(
    `SELECT p.*, a.first_name AS admin_first_name, a.last_name AS admin_last_name, a.username AS admin_username
     FROM point_adjustments p LEFT JOIN users a ON a.id = p.admin_id WHERE p.user_id = $1 ORDER BY p.id DESC LIMIT $2`,
    [userId, limit],
  );
}

module.exports = { adjust, history, PointsError, MAX_AMOUNT };

const db = require('../db/pool');
const users = require('./users');
const { formatDate } = require('./time');

const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Promo-kodni ishlatish. Tekshiruv tartibi texnik topshiriqdagidek:
 * mavjudmi -> muddati -> faolmi -> umumiy limit -> foydalanuvchi ishlatganmi.
 * Qaytadi: { key, params } — foydalanuvchiga ko'rsatiladigan matn kaliti.
 */
async function redeem(user, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  return db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM promo_codes WHERE upper(code) = $1 FOR UPDATE', [code]);
    const promo = rows[0];
    if (!promo) return { key: 'promo_not_found' };
    const now = new Date();
    if (new Date(promo.expires_at) < now) return { key: 'promo_expired' };
    if (promo.status !== 'active' || new Date(promo.starts_at) > now) return { key: 'promo_inactive' };
    if (promo.used_count >= promo.max_uses) return { key: 'promo_limit' };
    const used = await c.query('SELECT 1 FROM promo_code_uses WHERE promo_code_id = $1 AND user_id = $2', [promo.id, user.id]);
    if (used.rowCount) return { key: 'promo_used' };
    if (promo.premium_only && !users.isPremium(user)) return { key: 'promo_premium_only' };
    if (promo.type === 'premium' && users.premiumFree()) return { key: 'promo_premium_off' };   // Premium o'chiq — Premium promokodlar ishlamaydi

    await c.query('INSERT INTO promo_code_uses (promo_code_id, user_id) VALUES ($1, $2)', [promo.id, user.id]);
    await c.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [promo.id]);

    if (promo.type === 'premium') {
      const u = await users.grantPremium(c, user.id, promo.value, 'promo', 0);
      return { key: 'promo_success_premium', params: { days: promo.value, date: formatDate(u.premium_expires_at) }, premium: true };
    }
    await c.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [user.id, promo.value]);
    return { key: 'promo_success_balance', params: { amount: promo.value } };
  });
}

async function create({ code, type, value, maxUses, startsAt, expiresAt, premiumOnly }) {
  return db.one(
    `INSERT INTO promo_codes (code, type, value, max_uses, starts_at, expires_at, premium_only)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [code.toUpperCase(), type, value, maxUses, startsAt, expiresAt, !!premiumOnly],
  );
}

async function exists(code) {
  return !!(await db.one('SELECT 1 AS x FROM promo_codes WHERE upper(code) = upper($1)', [code]));
}

module.exports = { CODE_RE, redeem, create, exists };

const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const { HOUR } = require('./time');

async function config(user) {
  const p = users.isPremium(user) ? 'premium' : 'free';
  const s = await settings.getMany([`bonus_${p}_min`, `bonus_${p}_max`, `bonus_${p}_per_day`]);
  const perDay = Math.max(1, Number(s[`bonus_${p}_per_day`]));
  return { min: Number(s[`bonus_${p}_min`]), max: Number(s[`bonus_${p}_max`]), cooldownMs: (24 * HOUR) / perDay };
}

/**
 * Bonus olish. Oddiy: kuniga 1 marta (24 soatda), Premium: kuniga 2 marta (har 12 soatda).
 * Qaytadi: { ok:true, amount, balance } yoki { ok:false, waitMs }
 */
async function claim(user) {
  const cfg = await config(user);
  return db.tx(async (c) => {
    await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const last = (await c.query('SELECT claimed_at FROM bonuses_log WHERE user_id = $1 ORDER BY claimed_at DESC LIMIT 1', [user.id])).rows[0];
    if (last) {
      const next = new Date(last.claimed_at).getTime() + cfg.cooldownMs;
      if (next > Date.now()) return { ok: false, waitMs: next - Date.now() };
    }
    const lo = Math.min(cfg.min, cfg.max);
    const hi = Math.max(cfg.min, cfg.max);
    const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
    await c.query('INSERT INTO bonuses_log (user_id, amount) VALUES ($1, $2)', [user.id, amount]);
    const r = await c.query('UPDATE users SET balance = balance + $2, bonus_ready_notified = false WHERE id = $1 RETURNING balance', [user.id, amount]);
    return { ok: true, amount, balance: r.rows[0].balance };
  });
}

module.exports = { claim, config };

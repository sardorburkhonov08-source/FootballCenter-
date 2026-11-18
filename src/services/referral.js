const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const notify = require('./notify');
const { monthRange } = require('./time');
const { money } = require('../i18n');

/** Yangi foydalanuvchi /start ref_XXX bilan kelganda (faqat birinchi marta) */
async function attach(newUser, refCode) {
  if (!refCode || !(await settings.get('referral_enabled'))) return null;
  const referrer = await db.one('SELECT * FROM users WHERE ref_code = $1', [refCode]);
  if (!referrer || referrer.id === newUser.id) return null;
  const ref = await db.one(
    `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)
     ON CONFLICT (referred_id) DO NOTHING RETURNING *`,
    [referrer.id, newUser.id],
  );
  if (!ref) return null;
  await db.query('UPDATE users SET referred_by = $2 WHERE id = $1', [newUser.id, referrer.id]);
  // Soxta referral himoyasi o'chirilgan bo'lsa — darhol faol
  if (!(await settings.get('referral_fake_protection'))) await activate(newUser.id, 'instant');
  return ref;
}

/**
 * Referralni faollashtirish (Web App'ga kirish yoki Premium sotib olish).
 * Bonus miqdori taklif qiluvchining joriy tarifiga qarab olinadi.
 */
async function activate(referredUserId, reason) {
  if (!(await settings.get('referral_enabled'))) return null;
  const res = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM referrals WHERE referred_id = $1 AND NOT is_active FOR UPDATE', [referredUserId]);
    const ref = rows[0];
    if (!ref) return null;
    const referrer = (await c.query('SELECT * FROM users WHERE id = $1', [ref.referrer_id])).rows[0];
    const amount = Number(await settings.get(users.isPremium(referrer) ? 'referral_bonus_premium' : 'referral_bonus_free'));
    await c.query('UPDATE referrals SET is_active = true, activated_at = now(), bonus_amount = $2 WHERE id = $1', [ref.id, amount]);
    await c.query('UPDATE users SET balance = balance + $2, referral_earned = referral_earned + $2 WHERE id = $1', [referrer.id, amount]);
    return { referrer, amount };
  });
  if (res) {
    const referred = await users.byId(referredUserId);
    await notify.toUser(res.referrer, 'ref_activated_notify', { name: users.displayName(referred), amount: money(res.amount) }, { kind: 'payment' });
    require('./achievements').checkLater(res.referrer.id);
  }
  return res;
}

async function stats(user) {
  const month = monthRange();
  return db.one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_active)::int AS active,
            count(*) FILTER (WHERE NOT is_active)::int AS pending,
            count(*) FILTER (WHERE is_active AND activated_at >= $2 AND activated_at < $3)::int AS month
     FROM referrals WHERE referrer_id = $1`,
    [user.id, month.start, month.end],
  );
}

/** Oylik leaderboard: [{ user_id, count, ... }] */
async function league(range = monthRange(), limit = 10) {
  return db.many(
    `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, count(*)::int AS count,
            max(r.activated_at) AS last_at
     FROM referrals r JOIN users u ON u.id = r.referrer_id
     WHERE r.is_active AND r.activated_at >= $1 AND r.activated_at < $2
     GROUP BY u.id ORDER BY count DESC, last_at ASC LIMIT $3`,
    [range.start, range.end, limit],
  );
}

async function leaguePlace(user, range = monthRange()) {
  const rows = await league(range, 100000);
  const idx = rows.findIndex((r) => r.id === user.id);
  return idx === -1 ? null : idx + 1;
}

module.exports = { attach, activate, stats, league, leaguePlace };

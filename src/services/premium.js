const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const referral = require('./referral');

// 💎 Premium tariflari (egasi talabi bilan: 7 kunlik va 30 kunlik). Narx va muddat — admin sozlamalari.
const PLANS = {
  week: { price: 'premium_week_price', days: 'premium_week_days' },
  month: { price: 'premium_price', days: 'premium_days' },
};

/** { week: { plan, price, days }, month: {...} } */
async function plans() {
  const s = await settings.getMany(Object.values(PLANS).flatMap((p) => [p.price, p.days]));
  const out = {};
  for (const [plan, k] of Object.entries(PLANS)) out[plan] = { plan, price: Number(s[k.price]), days: Number(s[k.days]) };
  return out;
}

async function planInfo(plan) {
  const all = await plans();
  return all[plan] || all.month;
}

/** Balansdan Premium sotib olish. { ok, price, days, user } yoki { ok:false, reason:'no_money' } */
async function buy(user, plan = 'month') {
  const { price, days } = await planInfo(plan);
  const result = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const u = rows[0];
    if (Number(u.balance) < price) return { ok: false, reason: 'no_money' };
    await c.query('UPDATE users SET balance = balance - $2 WHERE id = $1', [u.id, price]);
    const updated = await users.grantPremium(c, u.id, days, 'purchase', price);
    return { ok: true, price, days, user: updated };
  });
  // Premium sotib olish referralni faollashtiradi
  if (result.ok) await referral.activate(result.user.id, 'premium').catch((e) => console.error(e));
  return result;
}

/**
 * 🎁 Do'stga Premium sovg'a qilish: pul sovg'a qiluvchining balansidan yechiladi, Premium do'stga beriladi.
 * { ok, price, days, from, to } yoki { ok:false, reason: 'no_money' | 'not_found' | 'self' }
 */
async function gift(fromUser, toUserId, plan = 'month') {
  const { price, days } = await planInfo(plan);
  if (Number(toUserId) === Number(fromUser.id)) return { ok: false, reason: 'self' };
  const result = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [fromUser.id]);
    const u = rows[0];
    const to = (await c.query('SELECT * FROM users WHERE id = $1', [toUserId])).rows[0];
    if (!to) return { ok: false, reason: 'not_found' };
    if (Number(u.balance) < price) return { ok: false, reason: 'no_money' };
    const from = (await c.query('UPDATE users SET balance = balance - $2 WHERE id = $1 RETURNING *', [u.id, price])).rows[0];
    const updated = await users.grantPremium(c, to.id, days, 'gift', price);
    await c.query('UPDATE premium_purchases SET from_user_id = $2 WHERE id = (SELECT max(id) FROM premium_purchases WHERE user_id = $1)', [to.id, u.id]);
    return { ok: true, price, days, from, to: updated };
  });
  // Sovg'a Premium ham Premium hisoblanadi — do'stning referrali faollashadi
  if (result.ok) await referral.activate(result.to.id, 'premium').catch((e) => console.error(e));
  return result;
}

module.exports = { PLANS, plans, planInfo, buy, gift };

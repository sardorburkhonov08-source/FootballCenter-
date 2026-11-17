const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const referral = require('./referral');

/** Balansdan Premium sotib olish. { ok, price, user } yoki { ok:false, reason:'no_money' } */
async function buy(user) {
  const price = Number(await settings.get('premium_price'));
  const days = Number(await settings.get('premium_days'));
  const result = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const u = rows[0];
    if (Number(u.balance) < price) return { ok: false, reason: 'no_money' };
    await c.query('UPDATE users SET balance = balance - $2 WHERE id = $1', [u.id, price]);
    const updated = await users.grantPremium(c, u.id, days, 'purchase', price);
    return { ok: true, price, user: updated };
  });
  // Premium sotib olish referralni faollashtiradi
  if (result.ok) await referral.activate(result.user.id, 'premium').catch((e) => console.error(e));
  return result;
}

module.exports = { buy };

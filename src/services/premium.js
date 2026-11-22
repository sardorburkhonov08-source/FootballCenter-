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
async function enabled() { return (await settings.get('premium_enabled')) !== false; }

async function buy(user, plan = 'month') {
  if (!(await enabled())) return { ok: false, reason: 'off' };
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
  if (!(await enabled())) return { ok: false, reason: 'off' };
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
  if (result.ok) {
    await referral.activate(result.to.id, 'premium').catch((e) => console.error(e));
    require('./achievements').checkLater(result.from.id);
  }
  return result;
}

// ---- ⭐ Telegram Stars orqali to'lov (egasi talabi; narxni admin belgilaydi, 0 — o'chiq).
// Telegram Stars to'lovni o'zi tasdiqlaydi, shuning uchun Premium successful_payment kelganda darhol beriladi (SPEC 20.4 dan farq).
const STAR_KEYS = { week: 'premium_week_stars', month: 'premium_month_stars' };

/** { week: { plan, stars, days }, ... } — faqat narxi > 0 bo'lganlari */
async function starPlans() {
  if (!(await enabled())) return {};
  const p = await plans();
  const s = await settings.getMany(Object.values(STAR_KEYS));
  const out = {};
  for (const [plan, key] of Object.entries(STAR_KEYS)) {
    const stars = Math.floor(Number(s[key]) || 0);
    if (stars > 0) out[plan] = { plan, stars, days: p[plan].days };
  }
  return out;
}

function starPayload(plan, userId, stars) { return `prem:${plan}:${userId}:${stars}`; }

/** pre_checkout_query tekshiruvi: to'lov joriy narx va to'g'ri foydalanuvchiga mosmi */
async function checkStarPayload(payload, user, { currency, total }) {
  const m = /^prem:(week|month):(\d+):(\d+)$/.exec(payload || '');
  if (!m || currency !== 'XTR' || !user || Number(m[2]) !== Number(user.id)) return null;
  const plan = (await starPlans())[m[1]];
  if (!plan || plan.stars !== Number(m[3]) || plan.stars !== Number(total)) return null;
  return plan;
}

/**
 * successful_payment: Premium berish (bir to'lov — bir marta, charge_id bo'yicha).
 * → { ok, days, user } | { ok:false, reason:'duplicate'|'bad' }
 */
async function grantStars(user, payment) {
  const m = /^prem:(week|month):(\d+):(\d+)$/.exec(payment.invoice_payload || '');
  if (!m || payment.currency !== 'XTR' || Number(m[2]) !== Number(user.id)) return { ok: false, reason: 'bad' };
  const { days } = await planInfo(m[1]);
  const result = await db.tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO star_payments (user_id, plan, stars, days, charge_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (charge_id) DO NOTHING RETURNING id`,
      [user.id, m[1], Number(payment.total_amount), days, payment.telegram_payment_charge_id],
    );
    if (!ins.rows.length) return { ok: false, reason: 'duplicate' };
    const updated = await users.grantPremium(c, user.id, days, 'stars', 0);
    return { ok: true, days, stars: Number(payment.total_amount), user: updated };
  });
  if (result.ok) await referral.activate(user.id, 'premium').catch((e) => console.error(e));
  return result;
}

module.exports = { PLANS, enabled, plans, planInfo, buy, gift, STAR_KEYS, starPlans, starPayload, checkStarPayload, grantStars };

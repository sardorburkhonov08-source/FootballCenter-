const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const { DAY } = require('./time');

function newRefCode() {
  return crypto.randomBytes(5).toString('hex');
}

/** Telegram `from` obyektidan foydalanuvchini yaratish/yangilash. { user, created } */
async function upsertFromTelegram(from) {
  const existing = await db.one('SELECT * FROM users WHERE telegram_id = $1', [from.id]);
  if (existing) {
    // Bazaga keraksiz yozuv yubormaslik: ism o'zgarmagan va oxirgi faollik 5 daqiqadan yangi bo'lsa — yozmaymiz
    const same = existing.username === (from.username || null) && existing.first_name === (from.first_name || null)
      && existing.last_name === (from.last_name || null);
    const recent = existing.last_seen_at && Date.now() - new Date(existing.last_seen_at).getTime() < 5 * 60 * 1000;
    if (same && recent) return { user: existing, created: false };
    const user = await db.one(
      `UPDATE users SET username = $2, first_name = $3, last_name = $4, last_seen_at = now()
       WHERE telegram_id = $1 RETURNING *`,
      [from.id, from.username || null, from.first_name || null, from.last_name || null],
    );
    return { user, created: false };
  }
  const isOwner = config.adminIds.includes(Number(from.id));
  for (let i = 0; i < 5; i += 1) {
    try {
      const user = await db.one(
        `INSERT INTO users (telegram_id, username, first_name, last_name, ref_code, is_admin, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (telegram_id) DO NOTHING RETURNING *`,
        [from.id, from.username || null, from.first_name || null, from.last_name || null, newRefCode(), isOwner],
      );
      if (user) return { user: await welcomePremium(user), created: true };
      return { user: await db.one('SELECT * FROM users WHERE telegram_id = $1', [from.id]), created: false };
    } catch (e) {
      if (e.code !== '23505') throw e; // ref_code to'qnashuvi — qayta urinish
    }
  }
  throw new Error('ref_code yaratib bo\'lmadi');
}

/** 🎁 Yangi foydalanuvchiga sovg'a Premium (settings.welcome_premium_days; 0 — o'chiq) */
async function welcomePremium(user) {
  const settings = require('./settings');
  const days = Number(await settings.get('welcome_premium_days'));
  if (!Number.isInteger(days) || days <= 0) return user;
  return grantPremium(db, user.id, days, 'welcome');
}

/** Foydalanuvchi sovg'a Premium olganmi */
async function gotWelcomePremium(userId) {
  return !!(await db.one("SELECT 1 FROM premium_purchases WHERE user_id = $1 AND source = 'welcome' LIMIT 1", [userId]));
}

async function byTelegramId(id) {
  return db.one('SELECT * FROM users WHERE telegram_id = $1', [id]);
}

async function byId(id) {
  return db.one('SELECT * FROM users WHERE id = $1', [id]);
}

/** ID yoki @username bo'yicha qidirish */
async function find(query) {
  const q = String(query || '').trim();
  if (/^\d{3,}$/.test(q)) return byTelegramId(Number(q));
  const name = q.replace(/^@/, '').toLowerCase();
  if (!name) return null;
  return db.one('SELECT * FROM users WHERE lower(username) = $1', [name]);
}

/** Umumiy points: Mini Manager + Quiz + Hisobni top + Duel */
function totalPoints(u) { return ['points_manager', 'points_quiz', 'points_score', 'points_duel'].reduce((sum, k) => sum + (Number(u[k]) || 0), 0); }

function isPremium(user) {
  return !!(user && user.premium_expires_at && new Date(user.premium_expires_at) > new Date());
}

function isOwner(user) {
  return !!user && config.adminIds.includes(Number(user.telegram_id));
}

function isAdmin(user) {
  return !!user && (user.is_admin || isOwner(user));
}

function premiumDaysLeft(user) {
  if (!isPremium(user)) return 0;
  return Math.max(1, Math.ceil((new Date(user.premium_expires_at) - Date.now()) / DAY));
}

function displayName(user) {
  if (!user) return '';
  const n = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return n || (user.username ? `@${user.username}` : String(user.telegram_id));
}

/**
 * Premium berish/uzaytirish. Joriy muddat tugamagan bo'lsa, ustiga qo'shiladi.
 * `q` — tranzaksiya client'i yoki db.
 */
async function grantPremium(q, userId, days, source, amount = 0) {
  const r = await q.query(
    `UPDATE users SET
       premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), now()) + ($2 || ' days')::interval,
       tariff = 'premium', premium_reminder_sent_for = NULL
     WHERE id = $1 RETURNING *`,
    [userId, String(days)],
  );
  await q.query('INSERT INTO premium_purchases (user_id, amount, days, source) VALUES ($1, $2, $3, $4)',
    [userId, amount, days, source]);
  return r.rows[0];
}

async function setLanguage(telegramId, lang) {
  return db.one('UPDATE users SET language = $2 WHERE telegram_id = $1 RETURNING *', [telegramId, lang]);
}

async function activeReferralCount(userId) {
  const r = await db.one('SELECT count(*)::int AS c FROM referrals WHERE referrer_id = $1 AND is_active', [userId]);
  return r.c;
}

module.exports = {
  totalPoints,
  welcomePremium, gotWelcomePremium,
  upsertFromTelegram, byTelegramId, byId, find, isPremium, isOwner, isAdmin, premiumDaysLeft, displayName,
  grantPremium, setLanguage, activeReferralCount,
};

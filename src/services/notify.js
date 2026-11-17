// Foydalanuvchilarga bot orqali xabar yuborish + bildirishnoma sozlamalarini hisobga olish.
const db = require('../db/pool');
const { t } = require('../i18n');
const users = require('./users');

let api = null;
function setApi(botApi) { api = botApi; }
function getApi() { return api; }

/**
 * Bildirishnoma turlari:
 *  - always: har doim yoqilgan (o'chirib bo'lmaydi)
 *  - freeAlways: Oddiy uchun doim yoqilgan, Premium uchun yoqish/o'chirish mumkin
 *  - premium: Oddiy uchun qulflangan (yuborilmaydi), Premium uchun yoqish/o'chirish mumkin
 */
const NOTIFICATIONS = [
  { key: 'news', mode: 'freeAlways' },
  { key: 'premium_expiry', mode: 'premium' },
  { key: 'match_start', mode: 'premium' },
  { key: 'manager_result', mode: 'premium' },
  { key: 'leaderboard', mode: 'premium' },
  { key: 'quiz_new', mode: 'premium' },
  { key: 'payment', mode: 'always' },
  { key: 'bonus_ready', mode: 'premium' },
];

function isEnabled(user, key) {
  const def = NOTIFICATIONS.find((n) => n.key === key);
  if (!def) return false;
  if (def.mode === 'always') return true;
  const premium = users.isPremium(user);
  const pref = (user.notify || {})[key];
  if (def.mode === 'freeAlways') return premium ? pref !== false : true;
  return premium ? pref !== false : false;
}

async function toggle(user, key) {
  const cur = isEnabled(user, key);
  const next = { ...(user.notify || {}), [key]: !cur };
  return db.one('UPDATE users SET notify = $2::jsonb WHERE id = $1 RETURNING *', [user.id, JSON.stringify(next)]);
}

async function sendRaw(chatId, text, extra = {}) {
  if (!api) return false;
  try {
    await api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    return true;
  } catch (e) {
    console.warn(`[notify] ${chatId}: ${e.description || e.message}`);
    return false;
  }
}

/** Foydalanuvchiga uning tilida xabar. `kind` berilsa — bildirishnoma sozlamasi tekshiriladi. */
async function toUser(user, key, params = {}, { kind, extra } = {}) {
  if (!user || user.is_blocked) return false;
  if (kind && !isEnabled(user, kind)) return false;
  return sendRaw(user.telegram_id, t(user.language || 'uz', key, params), extra);
}

/** Barcha adminlarga (ega + is_admin) */
async function adminIds() {
  const config = require('../config');
  const rows = await db.many('SELECT telegram_id FROM users WHERE is_admin AND NOT is_blocked');
  return [...new Set([...config.ownerIds, ...rows.map((r) => Number(r.telegram_id))])];
}

module.exports = { setApi, getApi, NOTIFICATIONS, isEnabled, toggle, sendRaw, toUser, adminIds };

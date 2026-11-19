// 📈 Shaxsiy daraja (egasi talabi bilan): umumiy points (users.totalPoints) bo'yicha Lv 1—13.
// Chegaralar — settings.user_level_xp. Yangi darajaga chiqilganda botda 🎉 tabrik (achievements.check orqali).
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const notify = require('./notify');
const { t } = require('../i18n');

async function thresholds() {
  const v = await settings.get('user_level_xp');
  return (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

/** Darajaning unvoni (har 2 daraja — bitta unvon): ulv_1 … ulv_7 */
function tierOf(level) { return Math.min(7, Math.ceil(level / 2)); }

function levelOf(xp, th) {
  let level = 1;
  th.forEach((x, i) => { if (xp >= x) level = i + 2; });
  return { level, xp, from: level > 1 ? th[level - 2] : 0, next: th[level - 1] ?? null, tier: tierOf(level) };
}

async function forUser(u, lang = (u && u.language) || 'uz') {
  const lv = levelOf(users.totalPoints(u), await thresholds());
  return { ...lv, name: t(lang, `ulv_${lv.tier}`) };
}

/** Daraja oshganini tekshirish; birinchi marta (level = 0) — xabarsiz o'rnatiladi */
async function check(userId) {
  const u = await users.byId(userId);
  if (!u) return null;
  const lv = levelOf(users.totalPoints(u), await thresholds());
  if (lv.level === u.level) return null;
  const up = u.level > 0 && lv.level > u.level;
  await db.query('UPDATE users SET level = $2 WHERE id = $1', [u.id, lv.level]);
  if (up) {
    const lang = u.language || 'uz';
    await notify.celebrate(u, '🎉');
    await notify.toUser(u, 'level_up', { level: lv.level, name: t(lang, `ulv_${lv.tier}`) });
  }
  return up ? lv : null;
}

module.exports = { thresholds, levelOf, tierOf, forUser, check };

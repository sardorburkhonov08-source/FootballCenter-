// 🏅 Yutuqlar (egasi talabi bilan, SPEC'dan tashqari).
// Yutuqlar mavjud ma'lumotlardan bitta so'rov bilan aniqlanadi (check), yangi olinganlari user_achievements ga yoziladi
// va foydalanuvchiga botda xabar ketadi. "Haftaning fan klubi a'zosi" — haftalik g'olib aniqlanganda beriladi (award).
const db = require('../db/pool');
const settings = require('./settings');
const notify = require('./notify');
const { t } = require('../i18n');

// Tartib — ko'rsatish tartibi. sql — foydalanuvchi uchun boolean ifoda ($1 = user id, u — users qatori)
const LIST = [
  { id: 'quiz_1', icon: '🧠', sql: "EXISTS (SELECT 1 FROM quiz_answers WHERE user_id = $1 AND points_earned > 0)" },
  { id: 'quiz_50', icon: '🧠', sql: "(SELECT count(*) FROM quiz_answers WHERE user_id = $1 AND points_earned > 0) >= 50" },
  { id: 'score_exact_1', icon: '🎯', sql: 'EXACT >= 1' },
  { id: 'score_exact_10', icon: '🎯', sql: 'EXACT >= 10' },
  { id: 'manager_1', icon: '🎮', sql: 'EXISTS (SELECT 1 FROM mini_manager_predictions WHERE user_id = $1 AND points_earned IS NOT NULL)' },
  { id: 'manager_100', icon: '🎮', sql: 'EXISTS (SELECT 1 FROM mini_manager_predictions WHERE user_id = $1 AND points_earned >= 100)' },
  { id: 'weekly_top', icon: '🏆', sql: "EXISTS (SELECT 1 FROM period_winners WHERE user_id = $1 AND kind IN ('manager', 'quiz'))" },
  { id: 'fan_card', icon: '🪪', sql: 'EXISTS (SELECT 1 FROM fan_cards WHERE user_id = $1)' },
  { id: 'first_fans', icon: '⭐', sql: 'EXISTS (SELECT 1 FROM fan_cards WHERE user_id = $1 AND fan_number <= $2)' },
  { id: 'fan_club_week', icon: '👥', sql: null },
  { id: 'referral_5', icon: '🤝', sql: '(SELECT count(*) FROM referrals WHERE referrer_id = $1 AND is_active) >= 5' },
  { id: 'gift', icon: '🎁', sql: "EXISTS (SELECT 1 FROM premium_purchases WHERE from_user_id = $1 AND source = 'gift')" },
  { id: 'points_1000', icon: '💯', sql: '(u.points_manager + u.points_quiz + u.points_score) >= 1000' },
];
const BY_ID = Object.fromEntries(LIST.map((a) => [a.id, a]));

const EXACT = `(SELECT count(*) FROM score_predictions p JOIN score_games g ON g.id = p.game_id
  WHERE p.user_id = $1 AND g.status = 'finished' AND p.home = (g.result->>'home')::int AND p.away = (g.result->>'away')::int)`;

function checkSql() {
  const cols = LIST.filter((a) => a.sql).map((a) => `(${a.sql.replace(/EXACT/g, EXACT)}) AS "${a.id}"`);
  return `SELECT ${cols.join(',\n')} FROM users u WHERE u.id = $1`;
}
const CHECK_SQL = checkSql();

function localized(a, lang, earnedAt = null) {
  return { id: a.id, icon: a.icon, name: t(lang, `ach_${a.id}`), desc: t(lang, `ach_${a.id}_desc`), earnedAt };
}

/** Yangi olingan yutuqlarni yozish + xabar. → yangi id'lar */
async function grant(userId, ids) {
  if (!ids.length) return [];
  const rows = await db.many(
    `INSERT INTO user_achievements (user_id, achievement) SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING RETURNING achievement`, [userId, ids],
  );
  const fresh = rows.map((r) => r.achievement);
  if (fresh.length) {
    const u = await db.one('SELECT * FROM users WHERE id = $1', [userId]);
    const lang = (u && u.language) || 'uz';
    for (const id of fresh) {
      const a = localized(BY_ID[id], lang);
      await notify.toUser(u, 'ach_unlocked', { icon: a.icon, name: a.name, desc: a.desc });
    }
  }
  return fresh;
}

/** Foydalanuvchi yutuqlarini tekshirish (bitta so'rov). Xatolar asosiy amalni to'xtatmasin — chaqiruvchi .catch qiladi */
async function check(userId) {
  const firstFans = Number(await settings.get('fan_card_first_fans'));
  const row = await db.one(CHECK_SQL, [userId, firstFans]);
  if (!row) return [];
  const have = new Set((await db.many('SELECT achievement FROM user_achievements WHERE user_id = $1', [userId])).map((r) => r.achievement));
  return grant(userId, LIST.filter((a) => a.sql && row[a.id] && !have.has(a.id)).map((a) => a.id));
}

/** Orqa fonda tekshirish (asosiy amalni kuttirmaydi) */
function checkLater(...userIds) {
  for (const id of userIds) if (id) check(id).catch((e) => console.error('[achievements]', e.message));
}

/** Bir nechta foydalanuvchiga ma'lum yutuqni berish (masalan, haftaning fan klubi a'zolari) */
async function award(userIds, id) {
  for (const uid of userIds) await grant(uid, [id]).catch((e) => console.error('[achievements]', e.message));
}

/** Profil uchun: barcha yutuqlar (olinganlari sana bilan) */
async function forUser(userId, lang = 'uz') {
  const rows = await db.many('SELECT achievement, earned_at FROM user_achievements WHERE user_id = $1', [userId]);
  const got = new Map(rows.map((r) => [r.achievement, r.earned_at]));
  const list = LIST.map((a) => localized(a, lang, got.get(a.id) || null));
  return { earned: list.filter((a) => a.earnedAt).length, total: LIST.length, list };
}

async function count(userId) {
  return (await db.one('SELECT count(*)::int AS n FROM user_achievements WHERE user_id = $1', [userId])).n;
}

module.exports = { LIST, check, checkLater, award, forUser, count };

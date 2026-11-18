// 🔥 Ligalar ommabopligi: foydalanuvchilar qiziqishi bo'yicha avtomatik tartib.
// Bitta foydalanuvchi bir ligani kuniga necha marta ochmasin — bir marta hisoblanadi.
// Bazada faqat (liga, kun, foydalanuvchilar soni) saqlanadi; kim ko'rgani faqat xotirada,
// kun almashganda o'chiriladi (dublikatni oldini olish uchun).
const db = require('../db/pool');
const settings = require('./settings');
const { ymd } = require('./time');

let seenDay = null;
const seen = new Set(); // `${userId}:${leagueId}` — faqat joriy kun uchun, xotirada

let cache = null;       // { at, key, ids }
const CACHE_MS = 10 * 60 * 1000;

async function record(userId, leagueId) {
  const lid = Number(leagueId);
  if (!userId || !Number.isInteger(lid) || lid <= 0) return false;
  const day = ymd();
  if (seenDay !== day) { seen.clear(); seenDay = day; }
  const key = `${userId}:${lid}`;
  if (seen.has(key)) return false;
  if (seen.size > 500000) seen.clear(); // xotira himoyasi
  seen.add(key);
  await db.query(
    `INSERT INTO league_popularity (league_id, day, users) VALUES ($1, $2, 1)
     ON CONFLICT (league_id, day) DO UPDATE SET users = league_popularity.users + 1`,
    [lid, day],
  );
  return true;
}

/** Oxirgi N kundagi reyting: [{ league_id, users }] */
async function stats(days, limit = 50) {
  return db.many(
    `SELECT league_id, sum(users)::int AS users FROM league_popularity
     WHERE day > (now() AT TIME ZONE 'Asia/Tashkent')::date - $1::int
     GROUP BY league_id ORDER BY users DESC, league_id LIMIT $2`,
    [days, limit],
  );
}

/** Avtomatik ommabop ligalar ID'lari (admin sozlamalari bo'yicha, 10 daqiqa keshlanadi) */
async function popularIds() {
  const s = await settings.getMany(['popular_leagues_enabled', 'popular_leagues_days', 'popular_leagues_limit', 'popular_leagues_min_users']);
  if (!s.popular_leagues_enabled) return [];
  const key = `${s.popular_leagues_days}:${s.popular_leagues_limit}:${s.popular_leagues_min_users}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const rows = await stats(Number(s.popular_leagues_days), Number(s.popular_leagues_limit));
  const ids = rows.filter((r) => r.users >= Number(s.popular_leagues_min_users)).map((r) => r.league_id);
  cache = { at: Date.now(), key, ids };
  return ids;
}

function clearCache() { cache = null; }

/** Faqat testlar uchun: xotiradagi kunlik dublikat ro'yxatini tozalash */
function resetSeen() { seen.clear(); seenDay = null; }

async function cleanup() {
  await db.query("DELETE FROM league_popularity WHERE day < (now() AT TIME ZONE 'Asia/Tashkent')::date - 120");
}

module.exports = { record, stats, popularIds, clearCache, resetSeen, cleanup };

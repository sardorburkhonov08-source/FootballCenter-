// 👥 Do'stlar ligasi (SINOV, egasi talabi): foydalanuvchi liga ochadi, havola (t.me/<bot>?start=lg_<kod>) bilan do'stlarini
// chaqiradi; a'zolar faqat bir-biri bilan umumiy points bo'yicha bellashadi. Reyting mavjud umumiy reytingdan olinadi
// (alohida points yo'q). settings.leagues_enabled, leagues_max_members, leagues_max_per_user.
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const leaderboard = require('./leaderboard');
const config = require('../config');

class LeagueError extends Error {}
const PERIODS = ['weekly', 'monthly', 'all'];

function newCode() { return crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8); }
function link(code) { return config.botUsername ? `https://t.me/${config.botUsername}?start=lg_${code}` : null; }

async function ensureEnabled() {
  if (!(await settings.get('leagues_enabled'))) throw new LeagueError('disabled');
}

async function byCode(code) {
  if (!/^[A-Za-z0-9]{4,12}$/.test(String(code || ''))) return null;
  return db.one('SELECT * FROM friend_leagues WHERE code = $1', [code]);
}

async function memberCount(leagueId) {
  return (await db.one('SELECT count(*)::int AS n FROM friend_league_members WHERE league_id = $1', [leagueId])).n;
}

async function myLeagueCount(userId) {
  return (await db.one('SELECT count(*)::int AS n FROM friend_league_members WHERE user_id = $1', [userId])).n;
}

/** Yangi liga (ochgan odam darhol a'zo) */
async function create(user, rawName) {
  await ensureEnabled();
  const name = String(rawName || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 30) throw new LeagueError('bad_name');
  if (await myLeagueCount(user.id) >= Number(await settings.get('leagues_max_per_user'))) throw new LeagueError('too_many');
  return db.tx(async (c) => {
    let lg = null;
    for (let i = 0; i < 5 && !lg; i += 1) {
      lg = (await c.query('INSERT INTO friend_leagues (code, name, owner_id) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING *', [newCode(), name, user.id])).rows[0];
    }
    if (!lg) throw new Error('league code');
    await c.query('INSERT INTO friend_league_members (league_id, user_id) VALUES ($1, $2)', [lg.id, user.id]);
    return lg;
  });
}

/** Havola bo'yicha qo'shilish */
async function join(user, code) {
  await ensureEnabled();
  const lg = await byCode(code);
  if (!lg) throw new LeagueError('not_found');
  const already = await db.one('SELECT 1 FROM friend_league_members WHERE league_id = $1 AND user_id = $2', [lg.id, user.id]);
  if (already) return lg;
  if (await myLeagueCount(user.id) >= Number(await settings.get('leagues_max_per_user'))) throw new LeagueError('too_many');
  if (await memberCount(lg.id) >= Number(await settings.get('leagues_max_members'))) throw new LeagueError('full');
  await db.query('INSERT INTO friend_league_members (league_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lg.id, user.id]);
  return lg;
}

/** Taklif oldidan ko'rish */
async function preview(user, code) {
  const lg = await byCode(code);
  if (!lg) throw new LeagueError('not_found');
  const owner = await users.byId(lg.owner_id);
  const mine = !!(await db.one('SELECT 1 FROM friend_league_members WHERE league_id = $1 AND user_id = $2', [lg.id, user.id]));
  return { id: lg.id, name: lg.name, owner: users.displayName(owner), members: await memberCount(lg.id), mine };
}

async function getMember(user, leagueId) {
  const lg = await db.one('SELECT * FROM friend_leagues WHERE id = $1', [leagueId]);
  if (!lg) throw new LeagueError('not_found');
  const m = await db.one('SELECT 1 FROM friend_league_members WHERE league_id = $1 AND user_id = $2', [lg.id, user.id]);
  if (!m) throw new LeagueError('not_member');
  return lg;
}

/** Chiqish. Egasi chiqsa — liga keyingi eng eski a'zoga o'tadi; a'zo qolmasa — o'chiriladi */
async function leave(user, leagueId) {
  const lg = await getMember(user, leagueId);
  await db.query('DELETE FROM friend_league_members WHERE league_id = $1 AND user_id = $2', [lg.id, user.id]);
  if (Number(lg.owner_id) === Number(user.id)) {
    const next = await db.one('SELECT user_id FROM friend_league_members WHERE league_id = $1 ORDER BY joined_at, user_id LIMIT 1', [lg.id]);
    if (next) await db.query('UPDATE friend_leagues SET owner_id = $2 WHERE id = $1', [lg.id, next.user_id]);
    else await db.query('DELETE FROM friend_leagues WHERE id = $1', [lg.id]);
  }
  return { ok: true };
}

/** Egasi a'zoni chiqaradi */
async function kick(user, leagueId, telegramId) {
  const lg = await getMember(user, leagueId);
  if (Number(lg.owner_id) !== Number(user.id)) throw new LeagueError('not_owner');
  const target = await users.byTelegramId(Number(telegramId));
  if (!target || Number(target.id) === Number(user.id)) throw new LeagueError('not_found');
  await db.query('DELETE FROM friend_league_members WHERE league_id = $1 AND user_id = $2', [lg.id, target.id]);
  return { ok: true };
}

/** A'zolar reytingi: davr bo'yicha umumiy points (o'yinlar yig'indisi), 0 points'lilar ham ko'rinadi */
async function standings(leagueId, period) {
  const members = await db.many(
    `SELECT u.* FROM friend_league_members m JOIN users u ON u.id = m.user_id WHERE m.league_id = $1 AND NOT u.is_blocked ORDER BY m.joined_at`, [leagueId],
  );
  let pts;
  if (period === 'all') pts = new Map(members.map((u) => [Number(u.id), users.totalPoints(u)]));
  else {
    const rows = await leaderboard.ranking('overall', leaderboard.range(period));
    pts = new Map(rows.map((r) => [Number(r.id), Number(r.points) || 0]));
  }
  return members
    .map((u) => ({ id: Number(u.id), tgId: Number(u.telegram_id), name: users.displayName(u), photo: u.photo_url || null, points: pts.get(Number(u.id)) || 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .map((x, i) => ({ ...x, place: i + 1 }));
}

/** Mening ligalarim (ro'yxat uchun: a'zolar soni va haftalik o'rnim) */
async function list(user) {
  const rows = await db.many(
    `SELECT l.*, (SELECT count(*)::int FROM friend_league_members x WHERE x.league_id = l.id) AS members
     FROM friend_leagues l JOIN friend_league_members m ON m.league_id = l.id WHERE m.user_id = $1 ORDER BY m.joined_at`, [user.id],
  );
  const out = [];
  for (const l of rows) {
    const st = await standings(l.id, 'weekly');
    const me = st.find((x) => x.id === Number(user.id));
    out.push({ id: Number(l.id), name: l.name, members: l.members, owner: Number(l.owner_id) === Number(user.id), place: me ? me.place : null, leader: st[0] ? st[0].name : null });
  }
  return out;
}

async function detail(user, leagueId, period = 'weekly') {
  const lg = await getMember(user, leagueId);
  const p = PERIODS.includes(period) ? period : 'weekly';
  const st = await standings(lg.id, p);
  return {
    id: Number(lg.id), name: lg.name, code: lg.code, link: link(lg.code), owner: Number(lg.owner_id) === Number(user.id),
    period: p, maxMembers: Number(await settings.get('leagues_max_members')),
    standings: st.map((x) => ({ place: x.place, tgId: x.tgId, name: x.name, photo: x.photo, points: x.points, me: x.id === Number(user.id), owner: x.id === Number(lg.owner_id) })),
  };
}

module.exports = { LeagueError, PERIODS, byCode, link, create, join, preview, leave, kick, standings, list, detail };

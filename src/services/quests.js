// ✅ Kunlik vazifalar (egasi talabi bilan, Premium): har kuni (Toshkent) 3 ta vazifa — mavjud o'yinlardan tanlanadi.
// Bajarilganligi mavjud jadvallardan (bugun) hisoblanadi — alohida hodisa yozilmaydi. Hammasi bajarilsa "Mukofotni olish":
// quest_reward_points + ketma-ket kunlar soni × quest_streak_bonus (ko'pi bilan quest_streak_max kun). Points umumiy points'ga.
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const { dayStart, ymd } = require('./time');

class QuestError extends Error {}

const PER_DAY = 3;
// group — bir kunda bir guruhdan bittadan; available — vazifani bugun bajarish mumkinmi
const POOL = [
  { id: 'quiz', icon: '🧠', group: 'quiz', target: 1, sql: 'SELECT count(*)::int AS n FROM quiz_answers WHERE user_id = $1 AND answered_at >= $2' },
  { id: 'quiz3', icon: '🧠', group: 'quiz', target: 3, sql: 'SELECT count(*)::int AS n FROM quiz_answers WHERE user_id = $1 AND answered_at >= $2' },
  { id: 'duel', icon: '⚔️', group: 'duel', target: 1, sql: `SELECT count(DISTINCT duel_id)::int AS n FROM duel_answers WHERE user_id = $1 AND round = 4 AND answered_at >= $2` },
  { id: 'penalty', icon: '🥅', group: 'penalty', target: 1, sql: "SELECT count(*)::int AS n FROM penalty_games WHERE user_id = $1 AND status = 'finished' AND finished_at >= $2" },
  { id: 'crossbar', icon: '💥', group: 'arcade', target: 1, sql: "SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = 'crossbar' AND detail IS NOT NULL AND finished_at >= $2" },
  { id: 'keepy', icon: '⚽', group: 'arcade', target: 1, sql: "SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = 'keepy' AND detail IS NOT NULL AND finished_at >= $2" },
  { id: 'score', icon: '🎯', group: 'score', target: 1, sql: 'SELECT count(*)::int AS n FROM score_predictions WHERE user_id = $1 AND updated_at >= $2',
    available: "SELECT EXISTS (SELECT 1 FROM score_games WHERE status = 'upcoming' AND kickoff_at > now()) AS ok" },
  { id: 'bonus', icon: '🎁', group: 'bonus', target: 1, sql: 'SELECT count(*)::int AS n FROM bonuses_log WHERE user_id = $1 AND claimed_at >= $2' },
  { id: 'react', icon: '👍', group: 'community', target: 1, sql: 'SELECT count(*)::int AS n FROM community_post_reactions WHERE user_id = $1 AND created_at >= $2',
    available: `SELECT EXISTS (SELECT 1 FROM community_members m JOIN community_posts p ON p.community_id = m.community_id
                 JOIN communities c ON c.id = m.community_id WHERE m.user_id = $1 AND c.status = 'active') AS ok` },
];
const BY_ID = Object.fromEntries(POOL.map((q) => [q.id, q]));

/** Foydalanuvchi va kun bo'yicha barqaror tasodifiy tartib */
function seededOrder(list, seed) {
  return list
    .map((q) => ({ q, k: crypto.createHash('sha1').update(`${seed}:${q.id}`).digest('hex') }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.q);
}

async function pick(userId, day) {
  const avail = [];
  for (const q of POOL) {
    if (!q.available) { avail.push(q); continue; }
    const r = await db.one(q.available, q.available.includes('$1') ? [userId] : []);
    if (r && r.ok) avail.push(q);
  }
  const out = [];
  const groups = new Set();
  for (const q of seededOrder(avail, `${userId}:${day}`)) {
    if (groups.has(q.group)) continue;
    out.push(q.id);
    groups.add(q.group);
    if (out.length >= PER_DAY) break;
  }
  return out;
}

async function rules() {
  const s = await settings.getMany(['quest_reward_points', 'quest_streak_bonus', 'quest_streak_max']);
  return { reward: Number(s.quest_reward_points), bonus: Number(s.quest_streak_bonus), max: Number(s.quest_streak_max) };
}

/** Ketma-ket mukofot olingan kunlar (bugungidan oldin, kechadan boshlab) */
async function streakBefore(userId, day) {
  const rows = await db.many(
    "SELECT to_char(day, 'YYYY-MM-DD') AS d FROM user_quest_days WHERE user_id = $1 AND claimed_at IS NOT NULL AND day < $2 ORDER BY day DESC LIMIT 60",
    [userId, day],
  );
  let n = 0;
  let expect = new Date(`${day}T00:00:00Z`);
  for (const r of rows) {
    expect = new Date(expect.getTime() - 86400000);
    if (r.d !== expect.toISOString().slice(0, 10)) break;
    n += 1;
  }
  return n;
}

async function ensureDay(userId, day) {
  const row = await db.one('SELECT * FROM user_quest_days WHERE user_id = $1 AND day = $2', [userId, day]);
  if (row) return row;
  const ids = await pick(userId, day);
  await db.query('INSERT INTO user_quest_days (user_id, day, quests) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [userId, day, JSON.stringify(ids)]);
  return db.one('SELECT * FROM user_quest_days WHERE user_id = $1 AND day = $2', [userId, day]);
}

/** Bugungi vazifalar va progress */
async function today(user, now = new Date()) {
  const day = ymd(now);
  const since = dayStart(now);
  const row = await ensureDay(user.id, day);
  const list = [];
  for (const id of row.quests) {
    const q = BY_ID[id];
    if (!q) continue;
    const n = (await db.one(q.sql, [user.id, since])).n;
    list.push({ id, icon: q.icon, target: q.target, progress: Math.min(n, q.target), done: n >= q.target });
  }
  const [r, before] = await Promise.all([rules(), streakBefore(user.id, day)]);
  const claimed = !!row.claimed_at;
  const streak = claimed ? row.streak : before;
  return {
    day, quests: list, done: list.filter((q) => q.done).length, total: list.length,
    allDone: list.length > 0 && list.every((q) => q.done), claimed, reward: claimed ? row.reward : r.reward + Math.min(before, r.max) * r.bonus,
    streak, rules: r,
  };
}

async function claim(user, now = new Date()) {
  const st = await today(user, now);
  if (st.claimed) throw new QuestError('already_claimed');
  if (!st.allDone) throw new QuestError('not_done');
  const r = st.rules;
  const before = await streakBefore(user.id, st.day);
  const reward = r.reward + Math.min(before, r.max) * r.bonus;
  const ok = await db.tx(async (c) => {
    const u = (await c.query(
      'UPDATE user_quest_days SET claimed_at = now(), reward = $3, streak = $4 WHERE user_id = $1 AND day = $2 AND claimed_at IS NULL RETURNING *',
      [user.id, st.day, reward, before + 1],
    )).rows[0];
    if (!u) return false;
    await c.query('UPDATE users SET points_quest = points_quest + $2 WHERE id = $1', [user.id, reward]);
    return true;
  });
  if (!ok) throw new QuestError('already_claimed');
  require('./achievements').checkLater(user.id);
  return today(user, now);
}

module.exports = { QuestError, POOL, PER_DAY, today, claim, pick, streakBefore };

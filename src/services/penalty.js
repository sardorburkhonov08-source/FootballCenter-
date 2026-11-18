// 🥅 Penalty (sinov, egasi talabi bilan, faqat Premium): botga qarshi seriya.
// Navbat bilan: siz urasiz (burchak tanlaysiz, bot-darvozabon tasodifiy sakraydi), so'ng bot uradi (siz sakrash tomonini tanlaysiz).
// 5 tadan zarba; natija aniq bo'lsa erta tugaydi. Teng bo'lsa — sudden death (5 juftgacha), so'ng durang.
// Botning tanlovi serverda (crypto.randomInt) — oldindan bilib bo'lmaydi.
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const { dayStart } = require('./time');

class PenaltyError extends Error {}

const DIRS = ['left', 'center', 'right'];
const REGULAR = 5;
const SUDDEN_MAX = 5;

const rand = () => DIRS[crypto.randomInt(DIRS.length)];

async function rules() {
  const s = await settings.getMany(['penalty_win_points', 'penalty_draw_points', 'penalty_daily_games']);
  return { win: Number(s.penalty_win_points), draw: Number(s.penalty_draw_points), limit: Number(s.penalty_daily_games), kicks: REGULAR };
}

/** Holat: keyingi zarbani kim uradi va o'yin tugaganmi */
function evaluate(kicks) {
  const u = kicks.filter((k) => k.by === 'user');
  const b = kicks.filter((k) => k.by === 'bot');
  const ug = u.filter((k) => k.goal).length;
  const bg = b.filter((k) => k.goal).length;
  if (u.length <= REGULAR && b.length <= REGULAR && !(u.length === REGULAR && b.length === REGULAR)) {
    // Asosiy seriya: qolgan zarbalar bilan ham yetib bo'lmasa — tugaydi
    const uLeft = REGULAR - u.length;
    const bLeft = REGULAR - b.length;
    if (ug > bg + bLeft || bg > ug + uLeft) return { over: true, ug, bg };
    return { over: false, ug, bg, next: u.length === b.length ? 'user' : 'bot' };
  }
  // Sudden death: juft tugagach farq bo'lsa — tugaydi
  if (u.length === b.length) {
    if (ug !== bg) return { over: true, ug, bg };
    if (u.length >= REGULAR + SUDDEN_MAX) return { over: true, ug, bg };
    return { over: false, ug, bg, next: 'user', sudden: true };
  }
  return { over: false, ug, bg, next: 'bot', sudden: true };
}

function publicGame(g) {
  const e = evaluate(g.kicks);
  return {
    id: g.id, status: g.status, kicks: g.kicks, userGoals: e.ug, botGoals: e.bg,
    next: g.status === 'active' ? e.next : null, sudden: !!e.sudden, result: g.result, points: g.points,
  };
}

async function state(user) {
  const [r, active, today, stats] = await Promise.all([
    rules(),
    db.one("SELECT * FROM penalty_games WHERE user_id = $1 AND status = 'active'", [user.id]),
    db.one('SELECT count(*)::int AS n FROM penalty_games WHERE user_id = $1 AND created_at >= $2', [user.id, dayStart()]),
    db.one(
      `SELECT count(*)::int AS played, count(*) FILTER (WHERE result = 'win')::int AS wins,
              COALESCE(max(user_goals), 0)::int AS best FROM penalty_games WHERE user_id = $1 AND status = 'finished'`, [user.id],
    ),
  ]);
  return { rules: r, today: today.n, left: Math.max(0, r.limit - today.n), game: active ? publicGame(active) : null, stats };
}

async function start(user) {
  const r = await rules();
  const active = await db.one("SELECT * FROM penalty_games WHERE user_id = $1 AND status = 'active'", [user.id]);
  if (active) return publicGame(active);
  const today = (await db.one('SELECT count(*)::int AS n FROM penalty_games WHERE user_id = $1 AND created_at >= $2', [user.id, dayStart()])).n;
  if (today >= r.limit) throw new PenaltyError('daily_limit');
  try {
    return publicGame(await db.one('INSERT INTO penalty_games (user_id) VALUES ($1) RETURNING *', [user.id]));
  } catch (e) {
    if (e.code === '23505') return publicGame(await db.one("SELECT * FROM penalty_games WHERE user_id = $1 AND status = 'active'", [user.id]));
    throw e;
  }
}

/** Zarba: navbat foydalanuvchida bo'lsa — dir = zarba yo'nalishi, botda bo'lsa — dir = sakrash tomoni */
async function kick(user, dir, { random = rand } = {}) {
  if (!DIRS.includes(dir)) throw new PenaltyError('bad_dir');
  const r = await rules();
  return db.tx(async (c) => {
    const g = (await c.query("SELECT * FROM penalty_games WHERE user_id = $1 AND status = 'active' FOR UPDATE", [user.id])).rows[0];
    if (!g) throw new PenaltyError('no_game');
    const e = evaluate(g.kicks);
    const k = e.next === 'user'
      ? { by: 'user', shot: dir, dive: random() }
      : { by: 'bot', shot: random(), dive: dir };
    k.goal = k.shot !== k.dive;
    const kicks = [...g.kicks, k];
    const after = evaluate(kicks);
    let result = null;
    let points = 0;
    if (after.over) {
      result = after.ug > after.bg ? 'win' : after.ug < after.bg ? 'loss' : 'draw';
      points = result === 'win' ? r.win : result === 'draw' ? r.draw : 0;
      if (points) await c.query('UPDATE users SET points_penalty = points_penalty + $2 WHERE id = $1', [user.id, points]);
    }
    const row = (await c.query(
      `UPDATE penalty_games SET kicks = $2::jsonb, user_goals = $3, bot_goals = $4, status = $5, result = $6, points = $7,
         finished_at = CASE WHEN $5 = 'finished' THEN now() ELSE NULL END WHERE id = $1 RETURNING *`,
      [g.id, JSON.stringify(kicks), after.ug, after.bg, after.over ? 'finished' : 'active', result, points],
    )).rows[0];
    return { kick: k, game: publicGame(row) };
  });
}

module.exports = { PenaltyError, DIRS, REGULAR, evaluate, rules, state, start, kick };

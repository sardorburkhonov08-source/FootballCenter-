// 🎮 Taymingli o'yinlar (egasi talabi bilan, faqat Premium): 🥅 Crossbar challenge va ⚽ Keepy-uppy.
// O'yin brauzerda silliq o'ynalishi uchun server parametrlarni (tebranish davri, tushish vaqtlari) va botning natijasini
// beradi; o'yinchi oxirida bosish vaqtlarini yuboradi va natija serverda shu formulalar bilan qayta hisoblanadi.
// Botning natijasidan ko'proq — g'alaba, teng — durang. Kuniga settings.arcade_daily_games ta o'yin (har bir tur uchun).
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const { dayStart } = require('./time');

class ArcadeError extends Error {}

const KINDS = ['crossbar', 'keepy'];
const CROSSBAR = { attempts: 5, target: 75, minMs: 150, maxMs: 15000 };
const KEEPY = { falls: 80 };

const randInt = (a, b) => a + crypto.randomInt(b - a + 1);

// ---------- 🥅 Crossbar: indikator 0—100 oralig'ida tebranadi, crossbar — 75. Aniqlik bo'yicha 3 / 2 / 1 / 0 ball.
function crossbarPos(ms, period) { return 50 - 50 * Math.cos((2 * Math.PI * ms) / period); }
function crossbarPoints(pos) {
  const d = Math.abs(pos - CROSSBAR.target);
  if (d <= 2.5) return 3;
  if (d <= 6) return 2;
  if (d <= 12) return 1;
  return 0;
}
function crossbarScore(params, taps) {
  const shots = params.attempts.map((a, i) => {
    const ms = Number(taps[i]);
    if (!Number.isFinite(ms) || ms < CROSSBAR.minMs || ms > CROSSBAR.maxMs) return { pos: null, points: 0 };
    const pos = crossbarPos(ms, a.period);
    return { pos: Math.round(pos * 10) / 10, points: crossbarPoints(pos) };
  });
  return { score: shots.reduce((s, x) => s + x.points, 0), detail: { shots } };
}

// ---------- ⚽ Keepy-uppy: to'p har safar tezroq tushadi; oyoqqa yetgan paytga (t) ±w ms ichida bosish kerak.
function keepyScore(params, taps) {
  let n = 0;
  for (let i = 0; i < params.falls.length && i < taps.length; i += 1) {
    const ms = Number(taps[i]);
    const f = params.falls[i];
    if (!Number.isFinite(ms) || Math.abs(ms - f.t) > f.w) break;
    n += 1;
  }
  return { score: n, detail: { touches: n } };
}

function newParams(kind) {
  if (kind === 'crossbar') return { attempts: Array.from({ length: CROSSBAR.attempts }, () => ({ period: randInt(1100, 1800) })), target: CROSSBAR.target };
  return {
    falls: Array.from({ length: KEEPY.falls }, (_, k) => ({
      t: Math.round(Math.max(420, 1300 - 55 * k) * (0.9 + crypto.randomInt(21) / 100)),
      w: Math.max(70, 240 - 10 * k),
    })),
  };
}
const botScore = (kind) => (kind === 'crossbar' ? randInt(6, 10) : randInt(8, 16));
const scoreOf = (kind, params, taps) => (kind === 'crossbar' ? crossbarScore(params, taps) : keepyScore(params, taps));

async function rules() {
  const s = await settings.getMany(['arcade_win_points', 'arcade_draw_points', 'arcade_daily_games']);
  return { win: Number(s.arcade_win_points), draw: Number(s.arcade_draw_points), limit: Number(s.arcade_daily_games), attempts: CROSSBAR.attempts };
}

function publicGame(g) {
  return {
    id: g.id, kind: g.kind, status: g.status, params: g.params, botScore: g.bot_score,
    score: g.score, result: g.result, points: g.points, detail: g.detail,
  };
}

function checkKind(kind) { if (!KINDS.includes(kind)) throw new ArcadeError('bad_kind'); }

async function state(user, kind) {
  checkKind(kind);
  const [r, active, today, stats] = await Promise.all([
    rules(),
    db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active'", [user.id, kind]),
    db.one('SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = $2 AND created_at >= $3', [user.id, kind, dayStart()]),
    db.one(
      `SELECT count(*)::int AS played, count(*) FILTER (WHERE result = 'win')::int AS wins, COALESCE(max(score), 0)::int AS best
       FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'finished'`, [user.id, kind],
    ),
  ]);
  return { kind, rules: r, today: today.n, left: Math.max(0, r.limit - today.n), game: active ? publicGame(active) : null, stats };
}

async function start(user, kind) {
  checkKind(kind);
  const active = await db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active'", [user.id, kind]);
  if (active) return publicGame(active);
  const r = await rules();
  const today = (await db.one('SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = $2 AND created_at >= $3', [user.id, kind, dayStart()])).n;
  if (today >= r.limit) throw new ArcadeError('daily_limit');
  try {
    return publicGame(await db.one('INSERT INTO arcade_games (user_id, kind, params, bot_score) VALUES ($1,$2,$3::jsonb,$4) RETURNING *',
      [user.id, kind, JSON.stringify(newParams(kind)), botScore(kind)]));
  } catch (e) {
    if (e.code === '23505') return publicGame(await db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active'", [user.id, kind]));
    throw e;
  }
}

/** taps — bosish vaqtlari (ms): crossbar — har urinishda indikator boshlanganidan; keepy — har tushish boshlanganidan */
async function finish(user, kind, taps) {
  checkKind(kind);
  if (!Array.isArray(taps) || taps.length > KEEPY.falls) throw new ArcadeError('bad_taps');
  const r = await rules();
  return db.tx(async (c) => {
    const g = (await c.query("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active' FOR UPDATE", [user.id, kind])).rows[0];
    if (!g) throw new ArcadeError('no_game');
    const { score, detail } = scoreOf(kind, g.params, taps);
    const result = score > g.bot_score ? 'win' : score === g.bot_score ? 'draw' : 'loss';
    const points = result === 'win' ? r.win : result === 'draw' ? r.draw : 0;
    if (points) await c.query('UPDATE users SET points_arcade = points_arcade + $2 WHERE id = $1', [user.id, points]);
    const row = (await c.query(
      `UPDATE arcade_games SET status = 'finished', score = $2, detail = $3::jsonb, result = $4, points = $5, finished_at = now()
       WHERE id = $1 RETURNING *`, [g.id, score, JSON.stringify(detail), result, points],
    )).rows[0];
    return publicGame(row);
  });
}

module.exports = { ArcadeError, KINDS, CROSSBAR, crossbarPos, crossbarPoints, crossbarScore, keepyScore, newParams, rules, state, start, finish };

// 🎮 Taymingli o'yinlar (egasi talabi bilan, faqat Premium): 💥 Crossbar challenge va ⚽ Keepy-uppy.
// O'yin brauzerda silliq o'ynalishi uchun server parametrlarni (tebranish davri, tushish vaqti va joyi) beradi;
// o'yinchi oxirida bosish vaqtlarini yuboradi va natija serverda shu formulalar bilan qayta hisoblanadi.
// Rejimlar:
//  - 🤖 bot: botning natijasidan ko'proq — g'alaba, teng — durang; kuniga settings.arcade_daily_games ta (har tur uchun).
//  - 🎲 tasodifiy raqib / 🤝 do'st (match): ikkalasi bir xil parametrlarda navbatma-navbat o'ynaydi (24 soat),
//    ko'proq ball — g'olib. Do'st havolasi: t.me/<bot>?start=ag_<kod>. Points — arcade_pvp_*.
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const notify = require('./notify');
const { dayStart } = require('./time');
const { t } = require('../i18n');

class ArcadeError extends Error {}

const KINDS = ['crossbar', 'keepy'];
const CROSSBAR = { attempts: 5, target: 75, minMs: 150, maxMs: 15000 };
const KEEPY = { falls: 80, xTolerance: 16 };
const MATCH_TTL_HOURS = 24;
const MAX_OPEN = 5;

const randInt = (a, b) => a + crypto.randomInt(b - a + 1);

// ---------- 💥 Crossbar: indikator 0—100 oralig'ida tebranadi, crossbar — 75. Aniqlik bo'yicha 3 / 2 / 1 / 0 ball.
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

// ---------- ⚽ Keepy-uppy: to'p maydon bo'ylab uchadi va har safar boshqa joyga (x, %) tushadi; tushish paytiga (t ms)
// ±w ms ichida to'pning ustiga (±xTolerance %) bosish kerak. Har safar tezlashadi.
function keepyScore(params, taps) {
  let n = 0;
  for (let i = 0; i < params.falls.length && i < taps.length; i += 1) {
    const tap = taps[i];
    const f = params.falls[i];
    const ms = Number(tap && typeof tap === 'object' ? tap.ms : tap);
    if (!Number.isFinite(ms) || Math.abs(ms - f.t) > f.w) break;
    if (f.x !== undefined) {
      const x = Number(tap && typeof tap === 'object' ? tap.x : NaN);
      if (!Number.isFinite(x) || Math.abs(x - f.x) > KEEPY.xTolerance) break;
    }
    n += 1;
  }
  return { score: n, detail: { touches: n } };
}

function newParams(kind) {
  if (kind === 'crossbar') return { attempts: Array.from({ length: CROSSBAR.attempts }, () => ({ period: randInt(1100, 1800) })), target: CROSSBAR.target };
  let x = 50;
  return {
    falls: Array.from({ length: KEEPY.falls }, (_, k) => {
      // Keyingi tushish joyi: oldingisidan kamida 15% uzoqda, maydon chetidan 12% ichkarida
      let nx;
      do { nx = randInt(12, 88); } while (Math.abs(nx - x) < 15);
      x = nx;
      return {
        t: Math.round(Math.max(420, 1300 - 55 * k) * (0.9 + crypto.randomInt(21) / 100)),
        w: Math.max(70, 240 - 10 * k),
        x,
      };
    }),
  };
}
const botScore = (kind) => (kind === 'crossbar' ? randInt(6, 10) : randInt(8, 16));
const scoreOf = (kind, params, taps) => (kind === 'crossbar' ? crossbarScore(params, taps) : keepyScore(params, taps));

async function rules() {
  const s = await settings.getMany(['arcade_win_points', 'arcade_draw_points', 'arcade_daily_games', 'arcade_pvp_win_points', 'arcade_pvp_draw_points', 'arcade_pvp_daily_limit']);
  return {
    win: Number(s.arcade_win_points), draw: Number(s.arcade_draw_points), limit: Number(s.arcade_daily_games), attempts: CROSSBAR.attempts,
    pvp: { win: Number(s.arcade_pvp_win_points), draw: Number(s.arcade_pvp_draw_points), limit: Number(s.arcade_pvp_daily_limit) },
  };
}

function publicGame(g) {
  return {
    id: g.id, kind: g.kind, status: g.status, params: g.params, botScore: g.bot_score, matchId: g.match_id || null,
    score: g.score, result: g.result, points: g.points, detail: g.detail,
  };
}

function checkKind(kind) { if (!KINDS.includes(kind)) throw new ArcadeError('bad_kind'); }

// ---------- 🤖 Botga qarshi
async function state(user, kind) {
  checkKind(kind);
  const [r, active, today, stats] = await Promise.all([
    rules(),
    db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active' AND match_id IS NULL", [user.id, kind]),
    db.one('SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = $2 AND match_id IS NULL AND created_at >= $3', [user.id, kind, dayStart()]),
    db.one(
      `SELECT count(*)::int AS played, count(*) FILTER (WHERE result = 'win')::int AS wins, COALESCE(max(score), 0)::int AS best
       FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'finished'`, [user.id, kind],
    ),
  ]);
  return { kind, rules: r, today: today.n, left: Math.max(0, r.limit - today.n), game: active ? publicGame(active) : null, stats };
}

async function start(user, kind) {
  checkKind(kind);
  const active = await db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active' AND match_id IS NULL", [user.id, kind]);
  if (active) return publicGame(active);
  const r = await rules();
  const today = (await db.one('SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = $2 AND match_id IS NULL AND created_at >= $3', [user.id, kind, dayStart()])).n;
  if (today >= r.limit) throw new ArcadeError('daily_limit');
  try {
    return publicGame(await db.one('INSERT INTO arcade_games (user_id, kind, params, bot_score) VALUES ($1,$2,$3::jsonb,$4) RETURNING *',
      [user.id, kind, JSON.stringify(newParams(kind)), botScore(kind)]));
  } catch (e) {
    if (e.code === '23505') return publicGame(await db.one("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active' AND match_id IS NULL", [user.id, kind]));
    throw e;
  }
}

function checkTaps(taps) { if (!Array.isArray(taps) || taps.length > KEEPY.falls) throw new ArcadeError('bad_taps'); }

/** taps — bosish vaqtlari: crossbar — [ms]; keepy — [{ ms, x }] (har tushish boshlanganidan) */
async function finish(user, kind, taps) {
  checkKind(kind);
  checkTaps(taps);
  const r = await rules();
  return db.tx(async (c) => {
    const g = (await c.query("SELECT * FROM arcade_games WHERE user_id = $1 AND kind = $2 AND status = 'active' AND match_id IS NULL FOR UPDATE", [user.id, kind])).rows[0];
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

// ---------- 🎲 Tasodifiy raqib / 🤝 do'st (match)
function newCode() { return crypto.randomBytes(6).toString('base64url'); }

async function openCount(userId) {
  return (await db.one(
    "SELECT count(*)::int AS n FROM arcade_matches WHERE status IN ('waiting', 'active') AND (creator_id = $1 OR opponent_id = $1)", [userId],
  )).n;
}

async function matchSummary(m, userId) {
  const games = await db.many('SELECT * FROM arcade_games WHERE match_id = $1', [m.id]);
  const oppId = m.creator_id === userId ? m.opponent_id : m.creator_id;
  const mine = games.find((g) => g.user_id === userId);
  const theirs = games.find((g) => g.user_id === oppId);
  const opp = oppId ? await users.byId(oppId) : null;
  const myDone = !!(mine && mine.status === 'finished');
  let state;
  if (m.status === 'finished') state = 'finished';
  else if (m.status === 'expired') state = 'expired';
  else if (!myDone) state = 'your_turn';
  else state = m.opponent_id ? 'opponent_turn' : 'waiting_opponent';
  return {
    id: m.id, kind: m.kind, mode: m.mode, state, createdAt: m.created_at, expiresAt: m.expires_at,
    opponent: opp ? { name: users.displayName(opp), played: !!(theirs && theirs.status === 'finished') } : null,
    my: mine && mine.status === 'finished' ? mine.score : null,
    // Raqibning natijasi faqat match tugagach ko'rinadi
    their: m.status === 'finished' && theirs ? theirs.score : null,
    result: m.status === 'finished' && mine ? { result: mine.result, points: mine.points } : null,
    activeGame: mine && mine.status === 'active' ? publicGame(mine) : null,
  };
}

async function getMatch(user, id) {
  const m = await db.one('SELECT * FROM arcade_matches WHERE id = $1', [Number(id)]);
  if (!m || (m.creator_id !== user.id && m.opponent_id !== user.id)) throw new ArcadeError('not_found');
  return m;
}

async function createMatch(user, kind, mode) {
  checkKind(kind);
  if (!['random', 'invite'].includes(mode)) throw new ArcadeError('bad_mode');
  if (await openCount(user.id) >= MAX_OPEN) throw new ArcadeError('too_many');
  if (mode === 'random') {
    const joined = await db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM arcade_matches WHERE status = 'waiting' AND mode = 'random' AND kind = $1 AND creator_id <> $2 AND expires_at > now()
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [kind, user.id],
      );
      if (!rows[0]) return null;
      return (await c.query(
        "UPDATE arcade_matches SET opponent_id = $2, status = 'active', expires_at = now() + ($3 || ' hours')::interval WHERE id = $1 RETURNING *",
        [rows[0].id, user.id, String(MATCH_TTL_HOURS)],
      )).rows[0];
    });
    if (joined) return joined;
  }
  return db.one(
    `INSERT INTO arcade_matches (kind, mode, code, creator_id, params, expires_at)
     VALUES ($1,$2,$3,$4,$5::jsonb, now() + ($6 || ' hours')::interval) RETURNING *`,
    [kind, mode, newCode(), user.id, JSON.stringify(newParams(kind)), String(MATCH_TTL_HOURS)],
  );
}

async function byCode(code) {
  if (!/^[A-Za-z0-9_-]{4,20}$/.test(String(code || ''))) return null;
  return db.one('SELECT * FROM arcade_matches WHERE code = $1', [code]);
}

async function invitePreview(user, code) {
  const m = await byCode(code);
  if (!m || m.mode !== 'invite') throw new ArcadeError('not_found');
  const creator = await users.byId(m.creator_id);
  return {
    id: m.id, kind: m.kind, from: users.displayName(creator), mine: m.creator_id === user.id || m.opponent_id === user.id,
    available: m.status === 'waiting' && new Date(m.expires_at) > new Date() && m.creator_id !== user.id,
  };
}

async function joinMatch(user, code) {
  const m = await byCode(code);
  if (!m || m.mode !== 'invite') throw new ArcadeError('not_found');
  if (m.creator_id === user.id) throw new ArcadeError('own_match');
  if (m.opponent_id === user.id) return m;
  if (await openCount(user.id) >= MAX_OPEN) throw new ArcadeError('too_many');
  const r = await db.one(
    `UPDATE arcade_matches SET opponent_id = $2, status = 'active', expires_at = now() + ($3 || ' hours')::interval
     WHERE id = $1 AND status = 'waiting' AND opponent_id IS NULL AND expires_at > now() RETURNING *`,
    [m.id, user.id, String(MATCH_TTL_HOURS)],
  );
  if (!r) throw new ArcadeError('not_available');
  return r;
}

/** Match'dagi o'yinni boshlash (har o'yinchi bir marta) */
async function startMatchGame(user, id) {
  const m = await getMatch(user, id);
  if (!['waiting', 'active'].includes(m.status) || new Date(m.expires_at) <= new Date()) throw new ArcadeError('closed');
  const g = await db.one('SELECT * FROM arcade_games WHERE match_id = $1 AND user_id = $2', [m.id, user.id]);
  if (g) {
    if (g.status === 'finished') throw new ArcadeError('already_played');
    return publicGame(g);
  }
  return publicGame(await db.one(
    `INSERT INTO arcade_games (user_id, kind, params, match_id) VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (match_id, user_id) WHERE match_id IS NOT NULL DO UPDATE SET match_id = EXCLUDED.match_id RETURNING *`,
    [user.id, m.kind, JSON.stringify(m.params), m.id],
  ));
}

async function finishMatchGame(user, id, taps) {
  checkTaps(taps);
  const m = await getMatch(user, id);
  const s = scoreOf(m.kind, m.params, taps);
  const done = await db.one(
    `UPDATE arcade_games SET status = 'finished', score = $3, detail = $4::jsonb, finished_at = now()
     WHERE match_id = $1 AND user_id = $2 AND status = 'active' RETURNING *`,
    [m.id, user.id, s.score, JSON.stringify(s.detail)],
  );
  if (!done) throw new ArcadeError('no_game');
  await completeMatch(m.id);
  return matchSummary(await db.one('SELECT * FROM arcade_matches WHERE id = $1', [m.id]), user.id);
}

async function pvpPointsFor(c, userId, kind, result, r) {
  const counted = (await c.query(
    `SELECT count(*)::int AS n FROM arcade_games WHERE user_id = $1 AND kind = $2 AND match_id IS NOT NULL AND result IS NOT NULL AND finished_at >= $3`,
    [userId, kind, dayStart()],
  )).rows[0].n;
  if (counted >= r.pvp.limit) return 0;
  return result === 'win' ? r.pvp.win : result === 'draw' ? r.pvp.draw : 0;
}

/** Ikkalasi o'ynab bo'lsa (yoki force — muddat tugagan) match hisoblanadi; o'ynamagan — 0 ball */
async function completeMatch(matchId, { force = false } = {}) {
  const r = await rules();
  const res = await db.tx(async (c) => {
    const m = (await c.query('SELECT * FROM arcade_matches WHERE id = $1 FOR UPDATE', [matchId])).rows[0];
    if (!m || m.status !== 'active') return null;
    const games = (await c.query('SELECT * FROM arcade_games WHERE match_id = $1', [m.id])).rows;
    const scoreOfUser = (uid) => { const g = games.find((x) => x.user_id === uid && x.status === 'finished'); return g ? g.score : null; };
    const a = scoreOfUser(m.creator_id);
    const b = scoreOfUser(m.opponent_id);
    if (!force && (a === null || b === null)) return null;
    const sa = a ?? 0;
    const sb = b ?? 0;
    const winner = sa > sb ? m.creator_id : sb > sa ? m.opponent_id : null;
    const out = [];
    for (const [uid, my, their] of [[m.creator_id, sa, sb], [m.opponent_id, sb, sa]]) {
      const result = winner === null ? 'draw' : winner === uid ? 'win' : 'loss';
      const pts = await pvpPointsFor(c, uid, m.kind, result, r);
      const g = games.find((x) => x.user_id === uid);
      if (g) {
        await c.query("UPDATE arcade_games SET status = 'finished', score = COALESCE(score, 0), result = $2, points = $3, finished_at = COALESCE(finished_at, now()) WHERE id = $1",
          [g.id, result, pts]);
      } else {
        await c.query("INSERT INTO arcade_games (user_id, kind, params, match_id, status, score, result, points, finished_at) VALUES ($1,$2,$3::jsonb,$4,'finished',0,$5,$6,now())",
          [uid, m.kind, JSON.stringify(m.params), m.id, result, pts]);
      }
      if (pts) await c.query('UPDATE users SET points_arcade = points_arcade + $2 WHERE id = $1', [uid, pts]);
      out.push({ uid, result, pts, my, their });
    }
    await c.query("UPDATE arcade_matches SET status = 'finished', winner_id = $2, finished_at = now() WHERE id = $1", [m.id, winner]);
    return { m, out };
  });
  if (!res) return null;
  for (const me of res.out) {
    const opp = res.out.find((x) => x.uid !== me.uid);
    const [u, ou] = await Promise.all([users.byId(me.uid), users.byId(opp.uid)]);
    const lang = (u && u.language) || 'uz';
    await notify.toUser(u, `duel_result_${me.result}`, {
      kind: t(lang, `arcade_kind_${res.m.kind}`), name: users.displayName(ou), my: me.my, their: me.their, points: me.pts,
    }).catch(() => {});
  }
  return res.m;
}

async function listMatches(user, kind) {
  checkKind(kind);
  const rows = await db.many(
    `SELECT * FROM arcade_matches WHERE kind = $2 AND (creator_id = $1 OR opponent_id = $1) AND status <> 'expired'
     ORDER BY (status IN ('waiting', 'active')) DESC, created_at DESC LIMIT 15`, [user.id, kind],
  );
  return Promise.all(rows.map((m) => matchSummary(m, user.id)));
}

async function matchDetail(user, id) { return matchSummary(await getMatch(user, id), user.id); }

/** Fon vazifasi: muddati tugagan kutayotgan match — bekor, faoli — hisoblanadi */
async function tick() {
  const due = await db.many("SELECT id FROM arcade_matches WHERE status = 'active' AND expires_at <= now()");
  for (const r of due) await completeMatch(r.id, { force: true });
  const exp = await db.query("UPDATE arcade_matches SET status = 'expired' WHERE status = 'waiting' AND expires_at <= now()");
  return { finished: due.length, expired: exp.rowCount };
}

module.exports = {
  ArcadeError, KINDS, CROSSBAR, KEEPY, crossbarPos, crossbarPoints, crossbarScore, keepyScore, newParams, rules, state, start, finish,
  createMatch, byCode, invitePreview, joinMatch, startMatchGame, finishMatchGame, completeMatch, listMatches, matchDetail, tick,
};

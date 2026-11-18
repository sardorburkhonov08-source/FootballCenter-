// ⚔️ Duel o'yinlari (egasi talabi bilan, faqat Premium): 🧠 Quiz duel va 🕵️ "Futbolchini top" 1v1.
// - Navbatma-navbat: ikkala o'yinchi bir xil 5 ta raundni o'z vaqtida o'ynaydi (duel 24 soat amal qiladi).
// - Raqib: tasodifiy (kutayotgan duelga qo'shiladi yoki yangisini ochadi) yoki do'st (havola: ?start=duel_<kod>).
// - Har raund vaqti server bo'yicha o'lchanadi. Ko'proq to'g'ri javob — g'olib, teng bo'lsa — kamroq vaqt sarflagan.
// - Points: g'alaba — settings.duel_win_points, durang — duel_draw_points; kuniga duel_daily_limit tagacha duel hisoblanadi.
//   Points umumiy points'ga qo'shiladi (users.points_duel).
const crypto = require('crypto');
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const notify = require('./notify');
const quiz = require('./quiz');
const { dayStart } = require('./time');
const { t } = require('../i18n');
const PLAYERS = require('../data/players.json');
const DICT = require('../data/quiz-bank/dict.json');

class DuelError extends Error {}

const KINDS = ['quiz', 'player'];
const ROUNDS = 5;
const SECONDS = { quiz: 15, player: 20 };
const GRACE = 2;            // tarmoq kechikishi uchun (soniya)
const TTL_HOURS = 24;
const MAX_OPEN = 5;         // bir vaqtda tugamagan duellar soni

const LANG_IDX = { uz: 0, uz_cyrl: 0, ru: 1, en: 2 };
const PLAYER_BY_NAME = new Map(PLAYERS.map((p) => [p.name, p]));

function newCode() { return crypto.randomBytes(6).toString('base64url'); }
function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function langOf(u) { return LANG_IDX[u && u.language] !== undefined ? u.language : 'uz'; }
function dictName(code, lang) {
  const v = DICT[code];
  if (!v) return code;
  const s = v[LANG_IDX[lang] ?? 0];
  return lang === 'uz_cyrl' ? require('../i18n/translit').translit(s) : s;
}

// ---------- Raundlar
async function buildRounds(kind) {
  if (kind === 'quiz') {
    // Avval e'lon qilingan bank savollari (soatlik Quiz'dagi kelgusi savollar oldindan ochilib qolmasin)
    const rows = await db.many(
      "SELECT id FROM quiz_questions WHERE source IN ('bank', 'bank_repeat') ORDER BY (published_at IS NULL), random() LIMIT $1", [ROUNDS],
    );
    if (rows.length < ROUNDS) throw new DuelError('no_questions');
    return rows.map((r) => ({ q: Number(r.id) }));
  }
  return shuffle(PLAYERS).slice(0, ROUNDS).map((p) => {
    const same = shuffle(PLAYERS.filter((x) => x.name !== p.name && x.pos === p.pos));
    const others = same.length >= 3 ? same : [...same, ...shuffle(PLAYERS.filter((x) => x.name !== p.name && x.pos !== p.pos))];
    return { p: p.name, opts: shuffle([p.name, ...others.slice(0, 3).map((x) => x.name)]) };
  });
}

/** Raund ma'lumoti (javobsiz) va to'g'ri javob kaliti */
async function roundView(duel, index, lang) {
  const r = duel.rounds[index];
  if (duel.kind === 'quiz') {
    const q = await db.one('SELECT * FROM quiz_questions WHERE id = $1', [r.q]);
    if (!q) throw new DuelError('question_missing');
    const pq = quiz.publicQuestion(q, lang);
    return {
      correct: q.correct_option,
      view: { question: pq.question, options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: pq.options[k] })) },
    };
  }
  const p = PLAYER_BY_NAME.get(r.p);
  return {
    correct: String(r.opts.indexOf(r.p)),
    view: {
      clues: { country: dictName(p.country, lang), position: dictName(p.pos, lang), born: p.born, clubs: p.clubs },
      options: r.opts.map((name, i) => ({ key: String(i), text: name })),
    },
  };
}

// ---------- Holat
function sideOf(duel, userId) {
  if (duel.creator_id === userId) return 'creator';
  if (duel.opponent_id === userId) return 'opponent';
  return null;
}

async function answersOf(duelId) {
  return db.many('SELECT * FROM duel_answers WHERE duel_id = $1 ORDER BY round', [duelId]);
}

function tally(rows, userId, kind) {
  const mine = rows.filter((a) => a.user_id === userId && a.answered_at);
  const missing = ROUNDS - mine.length;
  return {
    answered: mine.length,
    score: mine.filter((a) => a.correct).length,
    timeMs: mine.reduce((s, a) => s + (a.time_ms || 0), 0) + missing * SECONDS[kind] * 1000,
  };
}

async function summary(duel, userId, rows) {
  const ans = rows || await answersOf(duel.id);
  const oppId = duel.creator_id === userId ? duel.opponent_id : duel.creator_id;
  const [opp, results] = await Promise.all([
    oppId ? users.byId(oppId) : null,
    duel.status === 'finished' ? db.many('SELECT * FROM duel_results WHERE duel_id = $1', [duel.id]) : [],
  ]);
  const me = tally(ans, userId, duel.kind);
  const done = me.answered >= ROUNDS;
  let state;
  if (duel.status === 'finished') state = 'finished';
  else if (duel.status === 'expired') state = 'expired';
  else if (!done) state = 'your_turn';
  else state = duel.opponent_id ? 'opponent_turn' : 'waiting_opponent';
  const myRes = results.find((r) => r.user_id === userId);
  const oppRes = results.find((r) => r.user_id === oppId);
  return {
    id: duel.id, kind: duel.kind, mode: duel.mode, state, rounds: ROUNDS, seconds: SECONDS[duel.kind],
    createdAt: duel.created_at, expiresAt: duel.expires_at, finishedAt: duel.finished_at,
    me: { answered: me.answered, score: me.score },
    opponent: opp ? { name: users.displayName(opp), answered: tally(ans, oppId, duel.kind).answered } : null,
    result: myRes ? { result: myRes.result, my: myRes.score, their: oppRes ? oppRes.score : 0, points: myRes.points } : null,
  };
}

async function getOwn(user, duelId) {
  const d = await db.one('SELECT * FROM duels WHERE id = $1', [Number(duelId)]);
  if (!d || !sideOf(d, user.id)) throw new DuelError('not_found');
  return d;
}

async function openCount(userId) {
  return (await db.one(
    "SELECT count(*)::int AS n FROM duels WHERE status IN ('waiting', 'active') AND (creator_id = $1 OR opponent_id = $1)", [userId],
  )).n;
}

// ---------- Duel ochish / qo'shilish
/** mode: random — kutayotgan duelga qo'shiladi yoki yangisini ochadi; invite — do'st uchun havola */
async function create(user, kind, mode) {
  if (!KINDS.includes(kind)) throw new DuelError('bad_kind');
  if (!['random', 'invite'].includes(mode)) throw new DuelError('bad_mode');
  if (await openCount(user.id) >= MAX_OPEN) throw new DuelError('too_many');
  if (mode === 'random') {
    const joined = await db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM duels WHERE status = 'waiting' AND mode = 'random' AND kind = $1 AND creator_id <> $2 AND expires_at > now()
           AND NOT EXISTS (SELECT 1 FROM duels x WHERE x.status = 'active' AND x.kind = $1
             AND ((x.creator_id = duels.creator_id AND x.opponent_id = $2) OR (x.creator_id = $2 AND x.opponent_id = duels.creator_id)))
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [kind, user.id],
      );
      if (!rows[0]) return null;
      return (await c.query(
        `UPDATE duels SET opponent_id = $2, status = 'active', expires_at = now() + ($3 || ' hours')::interval WHERE id = $1 RETURNING *`,
        [rows[0].id, user.id, String(TTL_HOURS)],
      )).rows[0];
    });
    if (joined) return joined;
  }
  return db.one(
    `INSERT INTO duels (kind, mode, code, creator_id, rounds, expires_at) VALUES ($1,$2,$3,$4,$5::jsonb, now() + ($6 || ' hours')::interval) RETURNING *`,
    [kind, mode, newCode(), user.id, JSON.stringify(await buildRounds(kind)), String(TTL_HOURS)],
  );
}

/** Do'st havolasi bo'yicha duel (qabul qilishdan oldin ko'rsatish uchun) */
async function byCode(code) {
  if (!/^[A-Za-z0-9_-]{4,20}$/.test(String(code || ''))) return null;
  return db.one('SELECT * FROM duels WHERE code = $1', [code]);
}

async function invitePreview(user, code) {
  const d = await byCode(code);
  if (!d || d.mode !== 'invite') throw new DuelError('not_found');
  const creator = await users.byId(d.creator_id);
  const mine = sideOf(d, user.id);
  return {
    id: d.id, kind: d.kind, from: users.displayName(creator), mine: !!mine,
    available: d.status === 'waiting' && new Date(d.expires_at) > new Date() && d.creator_id !== user.id,
  };
}

async function join(user, code) {
  const d = await byCode(code);
  if (!d || d.mode !== 'invite') throw new DuelError('not_found');
  if (d.creator_id === user.id) throw new DuelError('own_duel');
  if (d.opponent_id === user.id) return d;
  if (await openCount(user.id) >= MAX_OPEN) throw new DuelError('too_many');
  const r = await db.one(
    `UPDATE duels SET opponent_id = $2, status = 'active', expires_at = now() + ($3 || ' hours')::interval
     WHERE id = $1 AND status = 'waiting' AND opponent_id IS NULL AND expires_at > now() RETURNING *`,
    [d.id, user.id, String(TTL_HOURS)],
  );
  if (!r) throw new DuelError('not_available');
  return r;
}

// ---------- O'yin
/** Keyingi raund (yoki boshlangan, vaqti tugamagan raund). Hammasi o'ynalgan bo'lsa — { done: true } */
async function next(user, duelId) {
  const d = await getOwn(user, duelId);
  if (!['waiting', 'active'].includes(d.status) || new Date(d.expires_at) <= new Date()) throw new DuelError('closed');
  const limit = SECONDS[d.kind];
  const mine = (await answersOf(d.id)).filter((a) => a.user_id === user.id);
  const open = mine.find((a) => !a.answered_at);
  const lang = langOf(user);
  if (open) {
    const left = limit - (Date.now() - new Date(open.started_at).getTime()) / 1000;
    if (left > 0) {
      const rv = await roundView(d, open.round, lang);
      return { round: open.round, total: ROUNDS, secondsLeft: left, seconds: limit, ...rv.view };
    }
    await timeoutRound(d, user.id, open.round);
    mine.find((a) => a.round === open.round).answered_at = new Date();
  }
  const answered = mine.filter((a) => a.answered_at).length;
  if (answered >= ROUNDS) {
    await complete(d.id);
    return { done: true };
  }
  await db.query('INSERT INTO duel_answers (duel_id, user_id, round) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [d.id, user.id, answered]);
  const rv = await roundView(d, answered, lang);
  return { round: answered, total: ROUNDS, secondsLeft: limit, seconds: limit, ...rv.view };
}

async function timeoutRound(d, userId, round) {
  await db.query(
    'UPDATE duel_answers SET answered_at = now(), correct = false, time_ms = $4 WHERE duel_id = $1 AND user_id = $2 AND round = $3 AND answered_at IS NULL',
    [d.id, userId, round, SECONDS[d.kind] * 1000],
  );
}

async function answer(user, duelId, round, key) {
  const d = await getOwn(user, duelId);
  const a = await db.one('SELECT * FROM duel_answers WHERE duel_id = $1 AND user_id = $2 AND round = $3', [d.id, user.id, Number(round)]);
  if (!a) throw new DuelError('no_round');
  if (a.answered_at) throw new DuelError('already_answered');
  const limit = SECONDS[d.kind];
  const elapsedMs = Date.now() - new Date(a.started_at).getTime();
  const inTime = elapsedMs <= (limit + GRACE) * 1000;
  const rv = await roundView(d, a.round, langOf(user));
  const correct = inTime && String(key) === rv.correct;
  const timeMs = inTime ? Math.min(elapsedMs, limit * 1000) : limit * 1000;
  const r = await db.one(
    `UPDATE duel_answers SET answered_at = now(), answer = $4, correct = $5, time_ms = $6
     WHERE duel_id = $1 AND user_id = $2 AND round = $3 AND answered_at IS NULL RETURNING *`,
    [d.id, user.id, a.round, String(key ?? ''), correct, timeMs],
  );
  if (!r) throw new DuelError('already_answered');
  const last = a.round + 1 >= ROUNDS;
  if (last) await complete(d.id);
  return { correct, correctKey: rv.correct, timeMs, last };
}

// ---------- Yakunlash
async function pointsFor(c, userId, result, s) {
  const counted = (await c.query('SELECT count(*)::int AS n FROM duel_results WHERE user_id = $1 AND created_at >= $2', [userId, dayStart()])).rows[0].n;
  if (counted >= s.limit) return 0;
  return result === 'win' ? s.win : result === 'draw' ? s.draw : 0;
}

/** Ikkalasi o'ynab bo'lsa (yoki force — muddat tugagan bo'lsa) duel hisoblanadi. → yakunlangan duel yoki null */
async function complete(duelId, { force = false } = {}) {
  const st = await settings.getMany(['duel_win_points', 'duel_draw_points', 'duel_daily_limit']);
  const s = { win: Number(st.duel_win_points), draw: Number(st.duel_draw_points), limit: Number(st.duel_daily_limit) };
  const res = await db.tx(async (c) => {
    const d = (await c.query('SELECT * FROM duels WHERE id = $1 FOR UPDATE', [duelId])).rows[0];
    if (!d || d.status !== 'active') return null;
    const rows = (await c.query('SELECT * FROM duel_answers WHERE duel_id = $1', [d.id])).rows;
    const a = tally(rows, d.creator_id, d.kind);
    const b = tally(rows, d.opponent_id, d.kind);
    if (!force && (a.answered < ROUNDS || b.answered < ROUNDS)) return null;
    let winner = null;
    if (a.score !== b.score) winner = a.score > b.score ? d.creator_id : d.opponent_id;
    else if (a.timeMs !== b.timeMs) winner = a.timeMs < b.timeMs ? d.creator_id : d.opponent_id;
    const out = [];
    for (const [uid, x] of [[d.creator_id, a], [d.opponent_id, b]]) {
      const result = winner === null ? 'draw' : winner === uid ? 'win' : 'loss';
      const pts = await pointsFor(c, uid, result, s);
      await c.query('INSERT INTO duel_results (duel_id, user_id, result, score, time_ms, points) VALUES ($1,$2,$3,$4,$5,$6)',
        [d.id, uid, result, x.score, x.timeMs, pts]);
      if (pts) await c.query('UPDATE users SET points_duel = points_duel + $2 WHERE id = $1', [uid, pts]);
      out.push({ uid, result, pts, score: x.score });
    }
    await c.query("UPDATE duels SET status = 'finished', winner_id = $2, finished_at = now() WHERE id = $1", [d.id, winner]);
    return { d, out };
  });
  if (!res) return null;
  // Natija ikkala o'yinchiga botda
  for (const me of res.out) {
    const opp = res.out.find((x) => x.uid !== me.uid);
    const u = await users.byId(me.uid);
    const ou = await users.byId(opp.uid);
    const lang = langOf(u);
    await notify.toUser(u, `duel_result_${me.result}`, {
      kind: t(lang, `duel_kind_${res.d.kind}`), name: users.displayName(ou), my: me.score, their: opp.score, points: me.pts,
    }).catch(() => {});
  }
  return res.d;
}

/** Fon vazifasi: vaqti o'tgan raundlar — xato; muddati tugagan duellar — kutayotgani bekor, faoli hisoblanadi */
async function tick() {
  await db.query(
    `UPDATE duel_answers a SET answered_at = now(), correct = false,
       time_ms = CASE d.kind WHEN 'quiz' THEN $1::int ELSE $2::int END
     FROM duels d WHERE d.id = a.duel_id AND a.answered_at IS NULL
       AND a.started_at < now() - make_interval(secs => (CASE d.kind WHEN 'quiz' THEN $1::int ELSE $2::int END) / 1000.0 + $3::int)`,
    [SECONDS.quiz * 1000, SECONDS.player * 1000, GRACE],
  );
  const ready = await db.many(
    `SELECT d.id FROM duels d WHERE d.status = 'active'
       AND (SELECT count(*) FROM duel_answers a WHERE a.duel_id = d.id AND a.answered_at IS NOT NULL) >= $1`, [ROUNDS * 2],
  );
  for (const r of ready) await complete(r.id);
  const due = await db.many("SELECT id FROM duels WHERE status = 'active' AND expires_at <= now()");
  for (const r of due) await complete(r.id, { force: true });
  const exp = await db.query("UPDATE duels SET status = 'expired' WHERE status = 'waiting' AND expires_at <= now()");
  return { finished: ready.length + due.length, expired: exp.rowCount };
}

// ---------- Ro'yxat
async function list(user) {
  const rows = await db.many(
    `SELECT * FROM duels WHERE (creator_id = $1 OR opponent_id = $1) AND status <> 'expired'
     ORDER BY (status IN ('waiting', 'active')) DESC, created_at DESC LIMIT 20`, [user.id],
  );
  const ans = rows.length ? await db.many('SELECT * FROM duel_answers WHERE duel_id = ANY($1::int[])', [rows.map((d) => d.id)]) : [];
  const duels = await Promise.all(rows.map((d) => summary(d, user.id, ans.filter((a) => a.duel_id === d.id))));
  const st = await db.one(
    `SELECT count(*) FILTER (WHERE result = 'win')::int AS wins, count(*) FILTER (WHERE result = 'draw')::int AS draws,
            count(*) FILTER (WHERE result = 'loss')::int AS losses, count(*) FILTER (WHERE created_at >= $2)::int AS today
     FROM duel_results WHERE user_id = $1`, [user.id, dayStart()],
  );
  const s = await settings.getMany(['duel_win_points', 'duel_draw_points', 'duel_daily_limit']);
  return {
    duels, stats: st,
    rules: { win: Number(s.duel_win_points), draw: Number(s.duel_draw_points), limit: Number(s.duel_daily_limit), rounds: ROUNDS, seconds: SECONDS },
  };
}

async function detail(user, duelId) {
  return summary(await getOwn(user, duelId), user.id);
}

module.exports = {
  DuelError, KINDS, ROUNDS, SECONDS, PLAYERS, create, join, byCode, invitePreview, next, answer, complete, tick, list, detail, buildRounds,
};

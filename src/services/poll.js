// 🗳 "Kim yutadi?" — tezkor ovoz berish (SINOV rejimi, egasi talabi: yoqmasa olib tashlanadi; settings.poll_enabled).
// Kunning katta o'yini — admin "🎯 Hisobni top" ga belgilagan bugungi o'yinlardan eng kechki boshlanadigani.
// Kunlik dayjestdan keyin alohida xabar (3 tugma); ovoz bergach foizlar ko'rinadi; o'yin tugagach to'g'ri taxmin — poll_points.
// Olib tashlash: shu fayl, handlers/sections.js dagi pl: tugmasi, scheduler (poll), users.POINT_COLUMNS / leaderboard dagi 'poll'.
const db = require('../db/pool');
const settings = require('./settings');
const { t, raw, escapeHtml } = require('../i18n');
const { ymd, formatDateTime } = require('./time');

const PICKS = ['H', 'D', 'A'];

/** Bugungi ovoz o'yini (boshlanmagan) yoki null */
async function todayGame(now = new Date()) {
  if (!(await settings.get('poll_enabled'))) return null;
  return db.one(
    `SELECT * FROM score_games WHERE status = 'upcoming' AND kickoff_at > $1
       AND (kickoff_at AT TIME ZONE 'Asia/Tashkent')::date = $2::date
     ORDER BY kickoff_at DESC, id LIMIT 1`, [now, ymd(now)],
  );
}

async function stats(gameId) {
  const rows = await db.many('SELECT pick, count(*)::int AS n FROM poll_votes WHERE game_id = $1 GROUP BY pick', [gameId]);
  const c = { H: 0, D: 0, A: 0 };
  for (const r of rows) c[r.pick] = r.n;
  const total = c.H + c.D + c.A;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return { total, H: pct(c.H), D: pct(c.D), A: pct(c.A) };
}

function pickName(lang, game, pick) {
  return pick === 'H' ? game.home_team_name : pick === 'A' ? game.away_team_name : t(lang, 'poll_draw');
}

/** Ovoz xabari (hali ovoz bermagan) */
async function message(game, lang) {
  const points = await settings.get('poll_points');
  return {
    text: t(lang, 'poll_msg', { home: game.home_team_name, away: game.away_team_name, comp: game.competition || '—', time: formatDateTime(game.kickoff_at), points }),
    reply_markup: { inline_keyboard: [PICKS.map((p) => ({ text: p === 'D' ? `🤝 ${pickName(lang, game, p)}` : pickName(lang, game, p), callback_data: `pl:${game.id}:${p}` }))] },
  };
}

function bar(p) { const n = Math.round(p / 10); return `${'🟩'.repeat(n)}${'⬜'.repeat(10 - n)}`; }

/** Natija ko'rinishi (ovoz bergandan keyin): har tanlov foizi va chizig'i */
async function resultText(game, lang, myPick) {
  const s = await stats(game.id);
  const line = (p) => `${escapeHtml(pickName(lang, game, p))} — <b>${s[p]}%</b>\n${bar(s[p])}`;
  return t(lang, 'poll_result', {
    home: game.home_team_name, away: game.away_team_name,
    lines: raw(PICKS.map(line).join('\n')), pick: pickName(lang, game, myPick), total: s.total,
  });
}

/** Ovoz berish (bir marta, o'yin boshlanguncha). → { status: 'ok'|'already'|'closed'|'off', game, pick } */
async function vote(user, gameId, pick) {
  if (!PICKS.includes(pick)) return { status: 'closed' };
  if (!(await settings.get('poll_enabled'))) return { status: 'off' };
  const game = await db.one('SELECT * FROM score_games WHERE id = $1', [gameId]);
  if (!game) return { status: 'closed' };
  const mine = await db.one('SELECT pick FROM poll_votes WHERE game_id = $1 AND user_id = $2', [gameId, user.id]);
  if (mine) return { status: 'already', game, pick: mine.pick };
  if (game.status !== 'upcoming' || new Date(game.kickoff_at) <= new Date()) return { status: 'closed', game };
  await db.query('INSERT INTO poll_votes (game_id, user_id, pick) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [gameId, user.id, pick]);
  const final = await db.one('SELECT pick FROM poll_votes WHERE game_id = $1 AND user_id = $2', [gameId, user.id]);
  return { status: 'ok', game, pick: final.pick };
}

/** O'yin tugagach to'g'ri taxminlarga points (fon vazifasi). → hisoblangan ovozlar soni */
async function score() {
  const games = await db.many(
    `SELECT g.* FROM score_games g WHERE g.status = 'finished' AND g.result IS NOT NULL
       AND EXISTS (SELECT 1 FROM poll_votes v WHERE v.game_id = g.id AND v.points IS NULL)`,
  );
  const points = Number(await settings.get('poll_points')) || 0;
  let n = 0;
  for (const g of games) {
    const h = Number(g.result.home); const a = Number(g.result.away);
    const outcome = h > a ? 'H' : h < a ? 'A' : 'D';
    n += await db.tx(async (c) => {
      const rows = (await c.query(
        `UPDATE poll_votes SET points = CASE WHEN pick = $2 THEN $3::int ELSE 0 END, scored_at = now()
         WHERE game_id = $1 AND points IS NULL RETURNING user_id, points`, [g.id, outcome, points],
      )).rows;
      const winners = rows.filter((r) => r.points > 0).map((r) => r.user_id);
      if (winners.length) await c.query('UPDATE users SET points_poll = points_poll + $2 WHERE id = ANY($1::bigint[])', [winners, points]);
      return rows.length;
    });
  }
  return n;
}

module.exports = { PICKS, todayGame, stats, message, resultText, vote, score };

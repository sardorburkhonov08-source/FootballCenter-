// Fon vazifalari. Barcha vaqtlar Asia/Tashkent (services/time.js).
const db = require('../db/pool');
const { t } = require('../i18n');
const settings = require('../services/settings');
const users = require('../services/users');
const notify = require('../services/notify');
const manager = require('../services/manager');
const scorePredict = require('../services/scorePredict');
const quiz = require('../services/quiz');
const community = require('../services/community');
const donations = require('../services/donations');
const leaderboard = require('../services/leaderboard');
const referral = require('../services/referral');
const { prevRange, parts, formatDate, HOUR } = require('../services/time');

const PERIOD_GRACE_MS = 3 * HOUR; // kechikkan o'yin natijalari uchun

async function matchStartReminders() {
  const subs = await db.many(
    `SELECT s.*, u.* , s.api_match_id AS match_id FROM match_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE NOT s.notified AND s.kickoff_at > now() AND s.kickoff_at <= now() + interval '15 minutes'`,
  );
  for (const s of subs) {
    await db.query('UPDATE match_subscriptions SET notified = true WHERE user_id = $1 AND api_match_id = $2', [s.user_id, s.match_id]);
    await notify.toUser(s, 'match_start_notify', { title: s.title }, { kind: 'match_start' });
  }
  await db.query("DELETE FROM match_subscriptions WHERE kickoff_at < now() - interval '1 day'");
}

async function premiumExpiry() {
  await db.query("UPDATE users SET tariff = 'free' WHERE tariff = 'premium' AND (premium_expires_at IS NULL OR premium_expires_at <= now())");
  const rows = await db.many(
    `SELECT * FROM users WHERE premium_expires_at > now() AND premium_expires_at <= now() + interval '3 days'
     AND premium_reminder_sent_for IS DISTINCT FROM premium_expires_at AND NOT is_blocked`,
  );
  for (const u of rows) {
    await db.query('UPDATE users SET premium_reminder_sent_for = premium_expires_at WHERE id = $1', [u.id]);
    await notify.toUser(u, 'premium_expiry_reminder', { date: formatDate(u.premium_expires_at) }, { kind: 'premium_expiry' });
  }
}

async function bonusReady() {
  const perDay = Math.max(1, Number(await settings.get('bonus_premium_per_day')));
  const cooldownHours = 24 / perDay;
  const rows = await db.many(
    `SELECT u.* FROM users u
     WHERE NOT u.bonus_ready_notified AND u.premium_expires_at > now() AND NOT u.is_blocked
       AND (SELECT max(claimed_at) FROM bonuses_log b WHERE b.user_id = u.id) <= now() - ($1 || ' hours')::interval`,
    [String(cooldownHours)],
  );
  for (const u of rows) {
    await db.query('UPDATE users SET bonus_ready_notified = true WHERE id = $1', [u.id]);
    await notify.toUser(u, 'bonus_ready_notify', {}, { kind: 'bonus_ready' });
  }
}

async function quizTick() {
  const cur = await quiz.current();
  // Inglizcha tashqi API o'chiq bo'lsa, undan kelgan (faqat inglizcha) joriy savol soat kutmasdan almashtiriladi
  const staleEnglish = cur && cur.source === 'api' && !(await settings.get('quiz_api_enabled'));
  if (cur && !staleEnglish && Date.now() - new Date(cur.published_at).getTime() < HOUR) return;
  const q = await quiz.publishNext();
  if (!q) return;
  const rows = await db.many('SELECT * FROM users WHERE premium_expires_at > now() AND NOT is_blocked');
  for (const u of rows) {
    await notify.toUser(u, 'quiz_new_notify', {}, { kind: 'quiz_new' });
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Davr (hafta/oy) yakunlanganda g'olibni yozish va xabar berish */
async function finalizePeriods(now = new Date()) {
  for (const period of ['weekly', 'monthly']) {
    const r = prevRange(period, now);
    if (now.getTime() < r.end.getTime() + PERIOD_GRACE_MS) continue;
    for (const kind of ['manager', 'quiz']) {
      const rows = await leaderboard.computeRanking(kind, r); // keshsiz — g'olib aniq bo'lishi kerak
      const winner = rows[0];
      const ins = await db.one(
        `INSERT INTO period_winners (kind, period, period_start, period_end, user_id, points)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
        [kind, period, r.start, r.end, winner ? winner.id : null, winner ? winner.points : 0],
      );
      if (!ins || !winner) continue;
      const winnerUser = await users.byId(winner.id);
      require('../services/achievements').checkLater(winner.id);
      const kindKey = kind === 'manager' ? 'kind_manager' : 'kind_quiz';
      await notify.toUser(winnerUser, 'leaderboard_winner_notify', {
        kind: t(winnerUser.language || 'uz', kindKey), period: t(winnerUser.language || 'uz', `period_${period}`),
      });
      for (let i = 0; i < rows.length; i += 1) {
        const u = await users.byId(rows[i].id);
        const lang = u.language || 'uz';
        await notify.toUser(u, 'leaderboard_done_notify', {
          kind: t(lang, kindKey), period: t(lang, `period_${period}`), winner: leaderboard.label(winner, kind), points: winner.points, place: i + 1,
        }, { kind: 'leaderboard' });
      }
    }
  }

  // 👥 Haftaning fan klubi — fan community'lar reytingi g'olibi (bir marta), hamma foydalanuvchiga xabar (orqa fonda)
  const cmWin = await community.finalizeWeek(now, PERIOD_GRACE_MS);
  // ⚔️ Derbi: tugagan haftani hisoblash, yangi hafta juftliklarini tuzish
  await community.resolveDerbies(now, PERIOD_GRACE_MS);
  await community.ensureDerbies(now);
  if (cmWin) community.announceWinner(cmWin).catch((e) => console.error('[community winner]', e));

  // 🏆 Referral League — o'tgan oy g'olibiga Premium
  const m = prevRange('monthly', now);
  if (now.getTime() >= m.end.getTime()) {
    const [winner] = await referral.league(m, 1);
    const ins = await db.one(
      `INSERT INTO period_winners (kind, period, period_start, period_end, user_id, points)
       VALUES ('referral','monthly',$1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
      [m.start, m.end, winner ? winner.id : null, winner ? winner.count : 0],
    );
    if (ins && winner) {
      const days = Number(await settings.get('referral_league_premium_days'));
      const u = await db.tx((c) => users.grantPremium(c, winner.id, days, 'referral_league', 0));
      const p = parts(m.start);
      await notify.toUser(u, 'ref_league_won', { month: `${String(p.month + 1).padStart(2, '0')}.${p.year}`, days });
    }
  }
}

const JOBS = [
  { name: 'lock_games', every: 60, fn: () => Promise.all([manager.lockStarted(), scorePredict.lockStarted()]) },
  { name: 'match_reminders', every: 60, fn: matchStartReminders },
  { name: 'donation_announce', every: 60, fn: () => donations.processExpired(notify.getApi()) },
  { name: 'quiz', every: 60, fn: quizTick },
  { name: 'score_games', every: 300, fn: () => manager.scoreFinished() },
  { name: 'score_predict', every: 300, fn: () => scorePredict.scoreFinished() },
  { name: 'duels', every: 60, fn: () => require('../services/duels').tick() },
  { name: 'arcade_matches', every: 300, fn: () => require('../services/arcade').tick() },
  { name: 'premium_expiry', every: 300, fn: premiumExpiry },
  { name: 'bonus_ready', every: 300, fn: bonusReady },
  { name: 'periods', every: 300, fn: () => finalizePeriods() },
  { name: 'api_cache_cleanup', every: 6 * 3600, fn: () => require('../services/football').cleanupCache() },
  { name: 'popularity_cleanup', every: 24 * 3600, fn: () => require('../services/popularity').cleanup() },
];

function start() {
  const timers = [];
  for (const job of JOBS) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try { await job.fn(); } catch (e) { console.error(`[job:${job.name}]`, e.message || e); } finally { running = false; }
    };
    timers.push(setTimeout(run, 5000));
    timers.push(setInterval(run, job.every * 1000));
  }
  return () => timers.forEach((x) => clearInterval(x));
}

module.exports = { start, JOBS, matchStartReminders, premiumExpiry, bonusReady, quizTick, finalizePeriods };

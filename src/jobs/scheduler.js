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
const { prevRange, parts, formatDate, HOUR, ymd } = require('../services/time');

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
  await dailyDigest();
}

/**
 * ☀️ Kunlik dayjest — kuniga 1 marta bitta xabar (egasi talabi; "yangi Quiz savoli" xabari har soatda yuborilmaydi):
 * settings.digest_hour (Toshkent) dan keyingi birinchi Quiz savolida. Bugungi vazifalar, navbati kelgan duellar va bellashuvlar,
 * taxmin kutayotgan "Hisobni top" o'yinlari, tayyor bonus. Faqat Premium (bildirishnoma turi — quiz_new).
 */
async function dailyDigest(now = new Date()) {
  const hour = Number(await settings.get('digest_hour'));
  if (parts(now).hour < hour) return false;
  const mark = await db.one("INSERT INTO daily_notify_log (kind, day) VALUES ('digest', $1) ON CONFLICT DO NOTHING RETURNING *", [ymd(now)]);
  if (!mark) return false;
  const rows = await db.many('SELECT * FROM users WHERE premium_expires_at > now() AND NOT is_blocked AND language IS NOT NULL');
  const webApp = require('../config').webAppUrl;
  const pollGame = await require('../services/poll').todayGame(now);   // 🗳 "Kim yutadi?" (sinov)
  for (const u of rows) {
    if (!notify.isEnabled(u, 'quiz_new')) continue;
    try {
      const text = await digestText(u, now);
      const lang = u.language || 'uz';
      await notify.sendRaw(u.telegram_id, text, webApp ? { reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_digest_play'), web_app: { url: `${webApp}/` } }]] } } : {});
      if (pollGame) {
        const m = await require('../services/poll').message(pollGame, lang);
        await notify.sendRaw(u.telegram_id, m.text, { reply_markup: m.reply_markup });
      }
    } catch (e) { console.error('[digest]', e.message); }
    await new Promise((r) => setTimeout(r, 40));
  }
  return true;
}

async function digestText(u, now = new Date()) {
  const lang = u.language || 'uz';
  const L = (k, p) => t(lang, k, p);
  const lines = [L('digest_title', { name: u.first_name || '' }), ''];
  const q = await require('../services/quests').today(u, now);
  if (q.total) lines.push(q.claimed ? L('digest_quests_done', { reward: q.reward }) : L('digest_quests', { done: q.done, total: q.total, reward: q.reward }));
  if (q.streak > 0) lines.push(L('digest_streak', { n: q.streak }));
  const c = await db.one(
    `SELECT
       (SELECT count(*)::int FROM duels d WHERE d.status IN ('waiting', 'active') AND (d.creator_id = $1 OR d.opponent_id = $1)
          AND (SELECT count(*) FROM duel_answers a WHERE a.duel_id = d.id AND a.user_id = $1 AND a.answered_at IS NOT NULL) < 5) AS duels,
       (SELECT count(*)::int FROM arcade_matches m WHERE m.status IN ('waiting', 'active') AND (m.creator_id = $1 OR m.opponent_id = $1)
          AND NOT EXISTS (SELECT 1 FROM arcade_games g WHERE g.match_id = m.id AND g.user_id = $1 AND g.status = 'finished')) AS matches,
       (SELECT count(*)::int FROM score_games s WHERE s.status = 'upcoming' AND s.kickoff_at > now()
          AND NOT EXISTS (SELECT 1 FROM score_predictions p WHERE p.game_id = s.id AND p.user_id = $1)) AS score`,
    [u.id],
  );
  if (c.duels + c.matches > 0) lines.push(L('digest_duels', { n: c.duels + c.matches }));
  if (c.score > 0) lines.push(L('digest_score', { n: c.score }));
  lines.push(L('digest_quiz'));
  if ((await require('../services/bonus').waitMs(u)) === 0) lines.push(L('digest_bonus'));
  lines.push('', L('digest_footer'));
  return lines.join('\n');
}

/** Davr (hafta/oy) yakunlanganda g'olibni yozish va xabar berish */
async function finalizePeriods(now = new Date()) {
  for (const period of ['weekly', 'monthly']) {
    const r = prevRange(period, now);
    if (now.getTime() < r.end.getTime() + PERIOD_GRACE_MS) continue;
    // 🏆 G'oliblar — umumiy points bo'yicha (egasi talabi; har o'yin alohida g'olib aniqlanmaydi)
    for (const kind of ['overall']) {
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
      const kindKey = `kind_${kind}`;
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
  { name: 'poll_score', every: 300, fn: () => require('../services/poll').score() },
  { name: 'groups_quiz', every: 120, fn: () => require('../services/groups').postDaily(notify.getApi()) },
  { name: 'groups_week', every: 600, fn: () => require('../services/groups').finalizeWeeks(notify.getApi()) },
  { name: 'db_health', every: 300, fn: () => require('../services/alerts').checkDb() },
  { name: 'popularity_cleanup', every: 24 * 3600, fn: () => require('../services/popularity').cleanup() },
];

function start() {
  const timers = [];
  for (const job of JOBS) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try { await job.fn(); } catch (e) {
        console.error(`[job:${job.name}]`, e.message || e);
        require('../services/alerts').reportLater(`job:${job.name}`, e);
      } finally { running = false; }
    };
    timers.push(setTimeout(run, 5000));
    timers.push(setInterval(run, job.every * 1000));
  }
  return () => timers.forEach((x) => clearInterval(x));
}

module.exports = { start, JOBS, matchStartReminders, premiumExpiry, bonusReady, quizTick, dailyDigest, digestText, finalizePeriods };

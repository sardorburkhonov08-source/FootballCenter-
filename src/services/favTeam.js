// ⭐ Sevimli jamoa (egasi talabi): o'yini davomida gol va yakun haqida botda xabar.
// API yuklamasi: kunning barcha o'yinlari — bitta /fixtures?date= so'rovi (kesh). U faqat sevimli jamoalardan birining
// o'yini ketayotgan (yoki hozir boshlanadigan) paytda yangilanadi, tekshiruv oralig'i — settings.fav_team_check_seconds.
const db = require('../db/pool');
const settings = require('./settings');
const football = require('./football');
const notify = require('./notify');
const { t } = require('../i18n');
const { ymd } = require('./time');

const WINDOW_BEFORE_MS = 5 * 60000;         // boshlanishidan 5 daqiqa oldin
const WINDOW_AFTER_MS = 3 * 3600000;        // boshlanganidan 3 soat keyingacha
let lastCheck = 0;

function teamIds(m) { return [m.home && m.home.id, m.away && m.away.id].filter(Boolean).map(Number); }

/** Hozir kuzatish kerak bo'lgan o'yinmi */
function inWindow(m, now) {
  if (m.state === 'live') return true;
  if (m.state !== 'scheduled') return false;
  const k = new Date(m.utcDate).getTime();
  return now >= k - WINDOW_BEFORE_MS && now <= k + WINDOW_AFTER_MS;
}

async function fans(teamId) {
  return db.many(
    `SELECT * FROM users WHERE (favorite_team->>'id')::int = $1 AND NOT is_blocked AND NOT group_only AND language IS NOT NULL`, [teamId],
  );
}

function scoreLine(m, h, a) { return { home: m.home ? m.home.name : '?', away: m.away ? m.away.name : '?', h, a }; }

async function sendGoal(m, h, a, scorerSide) {
  const scorer = scorerSide === 'home' ? m.home : m.away;
  for (const teamId of teamIds(m)) {
    const mine = Number(scorer && scorer.id) === teamId;
    for (const u of await fans(teamId)) {
      await notify.toUser(u, mine ? 'fav_goal_for' : 'fav_goal_against', {
        ...scoreLine(m, h, a), team: scorer ? scorer.name : '', minute: m.minute ? ` · ${m.minute}'` : '',
      }, { kind: 'fav_team', extra: mine ? notify.effect('fire') : {} });
    }
  }
}

async function sendFinal(m, h, a) {
  for (const teamId of teamIds(m)) {
    const isHome = Number(m.home && m.home.id) === teamId;
    const my = isHome ? h : a;
    const their = isHome ? a : h;
    const key = my > their ? 'fav_ft_win' : my < their ? 'fav_ft_loss' : 'fav_ft_draw';
    const team = isHome ? m.home.name : m.away.name;
    for (const u of await fans(teamId)) {
      await notify.toUser(u, key, { ...scoreLine(m, h, a), team }, { kind: 'fav_team', extra: key === 'fav_ft_win' ? notify.effect('party') : {} });
    }
  }
}

/** ⏰ Fon vazifasi. → yuborilgan voqealar soni (gol/yakun) */
async function tick(now = Date.now(), { force = false } = {}) {
  if (!(await settings.get('fav_team_notify'))) return 0;
  const every = Math.max(30, Number(await settings.get('fav_team_check_seconds')) || 120) * 1000;
  if (!force && now - lastCheck < every) return 0;
  lastCheck = now;
  const ids = new Set((await db.many(
    "SELECT DISTINCT (favorite_team->>'id')::int AS id FROM users WHERE favorite_team IS NOT NULL AND NOT is_blocked AND NOT group_only",
  )).map((r) => Number(r.id)));
  if (!ids.size) return 0;
  const day = ymd(new Date(now));
  const tracked = await db.many("SELECT * FROM fav_match_state WHERE state = 'live'");
  const peek = await football.cachedMatchesByDate(day);
  const relevant = (list) => (list || []).filter((m) => teamIds(m).some((id) => ids.has(id)));
  // API'ga faqat kerak bo'lganda: sevimli jamoa o'yini ketayotgan/boshlanayotgan bo'lsa yoki kesh hali yo'q bo'lsa
  const need = !peek || tracked.length > 0 || relevant(peek).some((m) => inWindow(m, now));
  if (!need) return 0;
  let list;
  try { list = await football.matchesByDate(day); } catch (e) { return 0; }
  let events = 0;
  for (const m of relevant(list)) {
    if (m.state !== 'live' && m.state !== 'finished') continue;
    const h = Number(m.score.home) || 0;
    const a = Number(m.score.away) || 0;
    const prev = await db.one('SELECT * FROM fav_match_state WHERE api_match_id = $1', [m.id]);
    if (!prev) {
      // Birinchi ko'rish: oldingi gollar uchun xabar yuborilmaydi (kech qo'shilgan bo'lsa — spam bo'lmasin)
      await db.query('INSERT INTO fav_match_state (api_match_id, home, away, state) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [m.id, h, a, m.state]);
      continue;
    }
    if (prev.state === 'finished') continue;
    // Bir vaqtda bitta jarayon xabar yuborsin
    const upd = await db.one(
      `UPDATE fav_match_state SET home = $2, away = $3, state = $4, updated_at = now()
       WHERE api_match_id = $1 AND home = $5 AND away = $6 AND state = $7 RETURNING *`, [m.id, h, a, m.state, prev.home, prev.away, prev.state],
    );
    if (!upd) continue;
    if (h > prev.home) { await sendGoal(m, h, a, 'home'); events += 1; }
    if (a > prev.away) { await sendGoal(m, h, a, 'away'); events += 1; }
    if (m.state === 'finished') { await sendFinal(m, h, a); events += 1; }
  }
  await db.query("DELETE FROM fav_match_state WHERE updated_at < now() - interval '3 days'");
  return events;
}

function reset() { lastCheck = 0; }

module.exports = { tick, reset, inWindow };

const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const quiz = require('../src/services/quiz');
const { createApp } = require('../src/web/server');

let server;
let base;
let h;

const NOW = Date.now();
// ---- Soxta API-Football v3 javoblari
const logo = (id) => `https://media.api-sports.io/football/teams/${id}.png`;
const team = (id, name) => ({ id, name, logo: logo(id) });
const POS = (i) => (i === 0 ? 'Goalkeeper' : i < 6 ? 'Defender' : i < 11 ? 'Midfielder' : 'Attacker');
const squad = (teamId) => Array.from({ length: 16 }, (_, i) => ({ id: teamId * 100 + i, name: `P${teamId}-${i}`, number: i + 1, position: POS(i) }));
const KICKOFF = NOW + 3 * 3600 * 1000;
let matchState = { short: 'NS', ts: KICKOFF };
const PL = { id: 39, name: 'Premier League', country: 'England', logo: 'pl.png', flag: 'gb.svg', season: 2026, round: 'Regular Season - 12' };

function fixture(over = {}) {
  const ts = over.ts || matchState.ts;
  return {
    fixture: { id: over.id || 555, date: new Date(ts).toISOString(), timestamp: Math.floor(ts / 1000), venue: { name: 'Emirates' }, status: { short: over.short || matchState.short, elapsed: null } },
    league: PL,
    teams: { home: team(1, 'Arsenal'), away: team(2, 'Chelsea') },
    goals: { home: over.home ?? matchState.home ?? null, away: over.away ?? matchState.away ?? null },
    score: { halftime: { home: null, away: null } },
    events: over.events || matchState.events || [],
    lineups: over.lineups || matchState.lineups || [],
    statistics: [],
  };
}

const ymdTashkent = new Date(NOW + 5 * 3600 * 1000).toISOString().slice(0, 10);
const league = (id, name, country, code, type = 'League') => ({ league: { id, name, type, logo: `${id}.png` }, country: { name: country, code, flag: code ? `${code}.svg` : null }, seasons: [{ year: 2026, current: true }] });
const player = (id, name, goals, assists) => ({ player: { id, name }, statistics: [{ team: team(1, 'Arsenal'), goals: { total: goals, assists } }] });

const apiRequests = [];
football.setFetch(async (url) => {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams);
  apiRequests.push(u.pathname + u.search);
  let response = null;
  if (u.pathname === '/fixtures' && q.date) {
    response = [fixture({ ts: Date.parse(`${q.date}T15:00:00+05:00`) }), fixture({ id: 556, short: '1H', home: 1, away: 1, ts: Date.parse(`${q.date}T13:00:00+05:00`) })];
  } else if (u.pathname === '/fixtures' && q.id === '555') response = [fixture()];
  else if (u.pathname === '/players/squads') response = [{ team: team(Number(q.team), 'T'), players: squad(Number(q.team)) }];
  else if (u.pathname === '/leagues') {
    response = [league(2, 'UEFA Champions League', 'World', null, 'Cup'), league(39, 'Premier League', 'England', 'GB-ENG'),
      league(369, 'Super League', 'Uzbekistan', 'UZ'), league(140, 'La Liga', 'Spain', 'ES')];
  } else if (u.pathname === '/standings' && q.league === '39' && q.season === '2026') {
    response = [{ league: { standings: [[{ rank: 1, team: team(1, 'Arsenal'), points: 25, goalsDiff: 15, group: 'Premier League', all: { played: 10, win: 8, draw: 1, lose: 1, goals: { for: 20, against: 5 } } }]] } }];
  } else if (u.pathname === '/players/topscorers') response = [player(1, 'Saka', 9, 2), player(2, 'Odegaard', 3, 7)];
  else if (u.pathname === '/players/topassists') response = [player(2, 'Odegaard', 3, 7), player(1, 'Saka', 9, 2)];
  if (!response) return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response: [] }) };
  return { ok: true, status: 200, headers: new Map([['x-ratelimit-requests-remaining', '90']]), json: async () => ({ errors: [], response }) };
});

quiz.setFetch(async () => ({ ok: true, json: async () => ({ results: [
  { question: 'Which country won the 2018 FIFA World Cup?', correct_answer: 'France', incorrect_answers: ['Croatia', 'Brazil', 'Germany'] },
  { question: 'What is the capital of Japan?', correct_answer: 'Tokyo', incorrect_answers: ['Kyoto', 'Osaka', 'Nagoya'] },
] }) }));

function auth(id, extra = {}) {
  return { Authorization: `tma ${signInitData({ id, first_name: `W${id}`, username: `w${id}`, ...extra }, process.env.BOT_TOKEN)}` };
}
async function call(path, { id, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { ...(id ? auth(id) : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* */ }
  return { status: res.status, body: json, headers: res.headers };
}

const FREE = 3001;
const PREM = 3002;
const REFERRER = 3003;

test.before(async () => {
  await resetDb();
  h = createTestBot();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test('initData: imzosiz yoki soxta so\'rov rad etiladi', async () => {
  assert.strictEqual((await call('/api/me')).status, 401);
  assert.strictEqual((await call('/api/me', { headers: { Authorization: 'tma user=%7B%22id%22%3A1%7D&hash=abc' } })).status, 401);
  const wrongToken = signInitData({ id: 5 }, '999:OTHER');
  assert.strictEqual((await call('/api/me', { headers: { Authorization: `tma ${wrongToken}` } })).status, 401);
  const old = signInitData({ id: 5 }, process.env.BOT_TOKEN, Math.floor(Date.now() / 1000) - 2 * 86400);
  assert.strictEqual((await call('/api/me', { headers: { Authorization: `tma ${old}` } })).status, 401);
});

test('referral: Web App\'ga kirgach faollashadi va bonus tushadi', async () => {
  await h.text(REFERRER, '/start');
  await h.click(REFERRER, 'lang:uz');
  const ref = await db.one('SELECT * FROM users WHERE telegram_id = $1', [REFERRER]);
  await h.text(FREE, `/start ref_${ref.ref_code}`);
  await h.click(FREE, 'lang:uz');
  let r = await db.one('SELECT * FROM referrals');
  assert.strictEqual(r.is_active, false, '/start bilan bonus berilmaydi');
  h.clear();
  const me = await call('/api/me', { id: FREE });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.premium, false);
  r = await db.one('SELECT * FROM referrals');
  assert.strictEqual(r.is_active, true);
  const after = await db.one('SELECT balance, referral_earned FROM users WHERE telegram_id = $1', [REFERRER]);
  assert.strictEqual(Number(after.balance), 1000);
  assert.match(h.lastText(REFERRER), /^🎉 Taklif qilgan do'stingiz W3001 faol bo'ldi! Balansingizga 1 000 so'm qo'shildi/);
  await call('/api/me', { id: FREE });
  assert.strictEqual(Number((await db.one('SELECT balance FROM users WHERE telegram_id = $1', [REFERRER])).balance), 1000, 'ikki marta emas');
});

test("Home: o'yinlar ro'yxati hamma uchun, tafsilot faqat Premium", async () => {
  await call('/api/me', { id: PREM });
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days', tariff = 'premium' WHERE telegram_id = $1", [PREM]);
  const list = await call(`/api/matches?date=${ymdTashkent}`, { id: FREE });
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.matches.length, 2);
  const live = list.body.matches.find((m) => m.id === 556);
  assert.strictEqual(live.state, 'live');
  assert.strictEqual(live.score.home, 1);
  assert.strictEqual((await call('/api/matches/555', { id: FREE })).status, 402);
  const det = await call('/api/matches/555', { id: PREM });
  assert.strictEqual(det.status, 200);
  assert.deepStrictEqual(det.body.tabs, {}, "API bermagan tablar yo'q");
  assert.strictEqual((await call('/api/matches/555/subscribe', { id: FREE, method: 'POST' })).status, 402);
  const sub = await call('/api/matches/555/subscribe', { id: PREM, method: 'POST' });
  assert.strictEqual(sub.body.subscribed, true);
});

test("Musobaqalar: xalqaro + davlatlar alifbo bo'yicha; Oddiy faqat jadval", async () => {
  const c = await call('/api/competitions', { id: FREE });
  assert.deepStrictEqual(c.body.international.map((x) => x.name), ['UEFA Champions League']);
  assert.deepStrictEqual(c.body.countries.map((x) => x.name), ['England', 'Spain', 'Uzbekistan']);
  assert.strictEqual((await call('/api/competitions/39/standings', { id: FREE })).body.standings[0].table[0].points, 25);
  for (const tab of ['results', 'calendar', 'scorers', 'assists']) assert.strictEqual((await call(`/api/competitions/39/${tab}`, { id: FREE })).status, 402, tab);
  const assists = await call('/api/competitions/39/assists', { id: PREM });
  assert.deepStrictEqual(assists.body.players.map((p) => p.player.name), ['Odegaard', 'Saka']);
});

test('Mini Manager: murabbiy, taxmin, qulf, hisoblash, reyting', async () => {
  const manager = require('../src/services/manager');
  const g = await manager.assignGame(555);
  assert.strictEqual(g.home_team_name, 'Arsenal');
  // Mini Manager — faqat Premium (egasi talabi)
  for (const [path, method] of [['/api/manager/games', 'GET'], [`/api/manager/games/${g.id}`, 'GET'], ['/api/manager/coach', 'POST'], [`/api/manager/games/${g.id}/prediction`, 'POST']]) {
    assert.strictEqual((await call(path, { id: FREE, method, body: method === 'POST' ? {} : undefined })).status, 402, path);
  }
  // Quyidagi oqim uchun FREE vaqtincha Premium (o'yin boshlangach qaytariladi — taxmin va ball saqlanadi)
  await db.query("UPDATE users SET premium_expires_at = now() + interval '1 day' WHERE telegram_id = $1", [FREE]);
  assert.strictEqual((await call(`/api/manager/games/${g.id}/prediction`, { id: FREE, method: 'POST', body: {} })).body.error, 'coach_required');
  assert.strictEqual((await call('/api/manager/coach', { id: FREE, method: 'POST', body: { name: 'A' } })).status, 400);
  assert.strictEqual((await call('/api/manager/coach', { id: FREE, method: 'POST', body: { name: 'Coach Sardor' } })).body.coachName, 'Coach Sardor');

  const game = await call(`/api/manager/games/${g.id}`, { id: FREE });
  assert.strictEqual(game.body.squads.home.length, 16);
  assert.ok(game.body.tactics.includes('4-2-3-1'));
  const XI = (t) => Array.from({ length: 11 }, (_, i) => t * 100 + i);
  const body = { tacticHome: '4-3-3', tacticAway: '4-4-2', lineupHome: XI(1), lineupAway: XI(2), scorerHome: 105, scorerAway: 0, assistHome: 106, assistAway: null, redHome: 0, redAway: 0, yellowHome: null, yellowAway: 203, scoreHome: 2, scoreAway: 0, winner: 'HOME' };
  const bad = async (patch, err) => assert.strictEqual((await call(`/api/manager/games/${g.id}/prediction`, { id: FREE, method: 'POST', body: { ...body, ...patch } })).body.error, err);
  await bad({ lineupHome: XI(1).slice(0, 10) }, 'bad_lineup');
  await bad({ lineupHome: [...XI(1).slice(0, 10), 200] }, 'bad_lineup');
  await bad({ scorerHome: 999 }, 'bad_pick');
  await bad({ winner: 'AWAY' }, 'winner_mismatch');
  await bad({ tacticHome: '9-9-9' }, 'bad_tactic');
  const ok = await call(`/api/manager/games/${g.id}/prediction`, { id: FREE, method: 'POST', body });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  await call('/api/manager/coach', { id: PREM, method: 'POST', body: { name: 'Pro' } });
  await call(`/api/manager/games/${g.id}/prediction`, { id: PREM, method: 'POST', body: { ...body, scoreHome: 1, scoreAway: 1, winner: 'DRAW' } });

  // O'yin boshlandi -> qulflanadi
  await db.query("UPDATE mini_manager_games SET kickoff_at = now() - interval '2 hours'");
  assert.strictEqual(await manager.lockStarted(), 1);
  assert.strictEqual((await call(`/api/manager/games/${g.id}/prediction`, { id: FREE, method: 'POST', body })).body.error, 'locked');
  await db.query('UPDATE users SET premium_expires_at = NULL WHERE telegram_id = $1', [FREE]);

  // Tugadi -> hisoblash
  Object.assign(matchState, {
    short: 'FT', home: 2, away: 0,
    lineups: [
      { team: { id: 1 }, startXI: XI(1).map((id) => ({ player: { id } })) },
      { team: { id: 2 }, startXI: [...XI(2).slice(0, 10), 215].map((id) => ({ player: { id } })) },
    ],
    events: [
      { time: { elapsed: 10 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { id: 105 }, assist: { id: 106 } },
      { time: { elapsed: 50 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { id: 110 }, assist: { id: null } },
      { time: { elapsed: 60 }, team: { id: 2 }, type: 'Card', detail: 'Yellow Card', player: { id: 203 }, assist: { id: null } },
    ],
  });
  await football.clearCache();
  h.clear();
  assert.strictEqual(await manager.scoreFinished(), 1);
  const pred = await db.one('SELECT p.* FROM mini_manager_predictions p JOIN users u ON u.id = p.user_id WHERE u.telegram_id = $1', [FREE]);
  // 10 + 30 + 15 (home scorer) + 15 (away "bo'lmaydi") + 10 assist home + 10 + 10 (qizil yo'q) + 5 sariq + 22 + 20 tarkib
  assert.strictEqual(pred.points_earned, 147);
  assert.strictEqual((await db.one('SELECT points_manager FROM users WHERE telegram_id = $1', [FREE])).points_manager, 147);
  assert.strictEqual(h.calls.filter((c) => c.payload.text && c.payload.text.startsWith('🎮 Mini Manager natijasi')).length, 1, 'faqat Premium (bildirishnoma yoqilgan) oladi');

  const lb = await call('/api/leaderboard/manager/weekly', { id: PREM });
  assert.strictEqual(lb.body.top[0].name, 'Coach Sardor');
  assert.strictEqual(lb.body.me.place, 2);
  assert.strictEqual((await call('/api/leaderboard/quiz/weekly', { id: FREE })).status, 402);
});

test('Football Quiz: faqat Premium, server vaqti bo\'yicha ball', async () => {
  assert.strictEqual((await call('/api/quiz', { id: FREE })).status, 402);
  assert.strictEqual((await call('/api/quiz', { id: PREM })).body.question, null);
  const q = await quiz.publishNext();
  assert.ok(q, '4 tilli savollar bazasidan savol olindi');
  assert.strictEqual(q.source, 'bank');
  assert.ok(q.i18n && q.i18n.ru && q.i18n.en && q.i18n.uz_cyrl, '4 tilda');
  assert.ok((await db.one("SELECT count(*)::int AS c FROM quiz_questions WHERE source = 'bank'")).c >= 1000, '1000+ savol');
  let st = await call('/api/quiz', { id: PREM });
  assert.strictEqual(st.body.status, 'new');
  assert.strictEqual(st.body.question, undefined, 'boshlanmaguncha savol ko\'rsatilmaydi');
  st = await call('/api/quiz/start', { id: PREM, method: 'POST', body: { questionId: q.id } });
  assert.strictEqual(st.body.status, 'in_progress');
  assert.ok(st.body.secondsLeft > 14);
  assert.strictEqual(st.body.question.options.A !== undefined, true);
  // Savol foydalanuvchi tilida
  const prevLang = (await db.one('SELECT language FROM users WHERE telegram_id = $1', [PREM])).language;
  await db.query("UPDATE users SET language = 'ru' WHERE telegram_id = $1", [PREM]);
  const ru = await call('/api/quiz', { id: PREM });
  assert.strictEqual(ru.body.question.question, q.i18n.ru.q);
  assert.strictEqual(ru.body.question.options.A, q.i18n.ru.a);
  await db.query('UPDATE users SET language = $2 WHERE telegram_id = $1', [PREM, prevLang]);
  assert.strictEqual(JSON.stringify(st.body).includes('correct'), false, "to'g'ri javob oshkor qilinmaydi");
  const a = await call('/api/quiz/answer', { id: PREM, method: 'POST', body: { questionId: q.id, option: q.correct_option } });
  assert.strictEqual(a.body.result.points, 2);
  const again = await call('/api/quiz/answer', { id: PREM, method: 'POST', body: { questionId: q.id, option: 'A' } });
  assert.strictEqual(again.body.result.points, 2, 'qayta javob berib bo\'lmaydi');

  // Kech javob: 6 soniya -> 1 ball, 20 soniya -> 0
  const P2 = 3010;
  await call('/api/me', { id: P2 });
  await db.query("UPDATE users SET premium_expires_at = now() + interval '1 day' WHERE telegram_id = $1", [P2]);
  await call('/api/quiz/start', { id: P2, method: 'POST', body: { questionId: q.id } });
  await db.query("UPDATE quiz_answers SET started_at = now() - interval '6 seconds' WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)", [P2]);
  assert.strictEqual((await call('/api/quiz/answer', { id: P2, method: 'POST', body: { questionId: q.id, option: q.correct_option } })).body.result.points, 1);
  const P3 = 3011;
  await call('/api/me', { id: P3 });
  await db.query("UPDATE users SET premium_expires_at = now() + interval '1 day' WHERE telegram_id = $1", [P3]);
  await call('/api/quiz/start', { id: P3, method: 'POST', body: { questionId: q.id } });
  await db.query("UPDATE quiz_answers SET started_at = now() - interval '20 seconds' WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)", [P3]);
  const late = await call('/api/quiz', { id: P3 });
  assert.strictEqual(late.body.status, 'answered');
  assert.strictEqual(late.body.result.points, 0);
});

test('profil API', async () => {
  const p = await call('/api/profile', { id: FREE });
  assert.strictEqual(p.body.manager, null, 'Oddiy uchun Mini Manager statistikasi yo\'q');
  assert.strictEqual(p.body.quiz, null, 'Oddiy uchun quiz statistikasi yo\'q');
  // Premium qaytsa — oldingi ballar saqlangan
  await db.query("UPDATE users SET premium_expires_at = now() + interval '1 day' WHERE telegram_id = $1", [FREE]);
  const back = await call('/api/profile', { id: FREE });
  assert.strictEqual(back.body.manager.total, 147);
  assert.strictEqual(back.body.manager.overallPlace, 1);
  await db.query('UPDATE users SET premium_expires_at = NULL WHERE telegram_id = $1', [FREE]);
  const pp = await call('/api/profile', { id: PREM });
  assert.strictEqual(pp.body.quiz.total, 2);
});

test('web admin: login, banner yuklash, sovrin, statistika; oddiy foydalanuvchi kira olmaydi', async () => {
  assert.strictEqual((await call('/api/admin/me')).status, 401);
  assert.strictEqual((await call('/api/admin/me', { id: FREE })).status, 403);
  assert.strictEqual((await call('/api/admin/login', { method: 'POST', body: { login: 'admin', password: 'wrong' } })).status, 401);
  const login = await call('/api/admin/login', { method: 'POST', body: { login: 'admin', password: 'secret' } });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ah = { headers: { Cookie: cookie } };
  assert.strictEqual((await call('/api/admin/me', ah)).body.via, 'password');

  const fd = new FormData();
  fd.append('media', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'b.png');
  fd.append('link', 'https://t.me/fc_channel');
  fd.append('duration', '6');
  const up = await call('/api/admin/banners', { ...ah, method: 'POST', body: fd });
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  const bad = new FormData();
  bad.append('media', new Blob(['x'], { type: 'text/html' }), 'x.html');
  assert.strictEqual((await call('/api/admin/banners', { ...ah, method: 'POST', body: bad })).body.error, 'bad_media');
  const banners = await call('/api/banners', { id: FREE });
  assert.strictEqual(banners.body.length, 1);
  assert.strictEqual(banners.body[0].link, 'https://t.me/fc_channel');
  assert.strictEqual((await fetch(`${base}${banners.body[0].url}`)).status, 200);

  const pf = new FormData();
  pf.append('kind', 'manager'); pf.append('period', 'weekly'); pf.append('text', 'iPhone 17');
  assert.strictEqual((await call('/api/admin/prizes', { ...ah, method: 'POST', body: pf })).status, 200);
  assert.strictEqual((await call('/api/prizes?kind=manager', { id: FREE })).body[0].text, 'iPhone 17');

  const st = await call('/api/admin/stats', ah);
  assert.ok(st.body.visits_today >= 3);
  assert.strictEqual(st.body.manager_participants, 2);
  assert.strictEqual(st.body.quiz_participants, 3);

  // Telegram orqali admin — avtomatik
  await call('/api/me', { id: 1000 });
  assert.strictEqual((await call('/api/admin/me', { id: 1000 })).body.via, 'telegram');
  assert.strictEqual((await call('/api/admin/tactics', { id: 1000, method: 'PUT', body: ['4-4-2', '9-9'] })).body.length, 1);
});

test('fon vazifalari: davr g\'olibi, eslatmalar', async () => {
  const jobs = require('../src/jobs/scheduler');
  const { weekRange, HOUR } = require('../src/services/time');
  // Joriy hafta tugagandan 4 soat keyin -> haftalik g'olib aniqlanadi
  const later = new Date(weekRange().end.getTime() + 4 * HOUR);
  await db.query("UPDATE mini_manager_games SET kickoff_at = $1", [new Date(weekRange().start.getTime() + HOUR)]);
  await db.query("UPDATE quiz_answers SET answered_at = $1 WHERE answered_at IS NOT NULL", [new Date(weekRange().start.getTime() + HOUR)]);
  h.clear();
  await jobs.finalizePeriods(later);
  // G'olib — umumiy points bo'yicha (hamma o'yinlar), har o'yin alohida emas (egasi talabi)
  const w = await db.many("SELECT kind, period, points, user_id FROM period_winners WHERE period = 'weekly' ORDER BY kind");
  assert.deepStrictEqual(w.map((x) => x.kind), ['overall']);
  assert.ok(w[0].points >= 147, `umumiy points: ${w[0].points}`);
  assert.ok(h.texts(FREE).some((x) => x.startsWith('🏆 Tabriklaymiz! Siz 🏆 Umumiy reyting haftalik')), h.texts(FREE).join('\n'));
  await jobs.finalizePeriods(later);
  assert.strictEqual((await db.one("SELECT count(*)::int AS c FROM period_winners WHERE period = 'weekly'")).c, 1, 'takrorlanmaydi');

  await db.query("UPDATE users SET premium_expires_at = now() + interval '2 days' WHERE telegram_id = $1", [PREM]);
  h.clear();
  await jobs.premiumExpiry();
  await jobs.premiumExpiry();
  assert.strictEqual(h.texts(PREM).filter((x) => x.startsWith('⏰ Premium obunangiz tugashiga 3 kun qoldi')).length, 1);

  await db.query("UPDATE match_subscriptions SET kickoff_at = now() + interval '10 minutes'");
  h.clear();
  await jobs.matchStartReminders();
  assert.match(h.lastText(PREM), /^⚽ Arsenal — Chelsea o'yini 15 daqiqadan so'ng boshlanadi!/);
});

test("asosiy ligalar: o'yinlar tepada va admin tartibida; ro'yxat admin paneldan o'zgaradi", async () => {
  const { orderMatches } = require('../src/web/api');
  const m = (id, compId, comp, area, time) => ({ id, utcDate: `2026-11-18T${time}:00Z`, competition: { id: compId, name: comp }, area: { name: area } });
  const list = [
    m(1, 500, 'A-League', 'Australia', '10'), m(2, 39, 'Premier League', 'England', '20'),
    m(3, 2, 'UEFA Champions League', 'World', '19'), m(4, 300, 'Super League', 'Uzbekistan', '12'),
    m(5, 39, 'Premier League', 'England', '15'), m(6, 400, 'Bundesliga', 'Austria', '09'),
  ];
  const ordered = orderMatches(list, [2, 39]);
  assert.deepStrictEqual(ordered.map((x) => x.id), [3, 5, 2, 1, 6, 4], 'avval UCL, so\'ng APL (vaqt bo\'yicha), keyin davlatlar alifbosi');
  assert.deepStrictEqual(ordered.map((x) => x.featured), [true, true, true, false, false, false]);

  const ah = { id: 1000 };
  await call('/api/me', ah);
  const before = await call('/api/admin/featured-leagues', ah);
  assert.ok(before.body.ids.includes(39));
  assert.ok(before.body.leagues.some((l) => l.name === 'Super League' && l.area === 'Uzbekistan'));
  assert.strictEqual((await call('/api/admin/featured-leagues', { ...ah, method: 'PUT', body: 'x' })).status, 400);
  assert.deepStrictEqual((await call('/api/admin/featured-leagues', { ...ah, method: 'PUT', body: [369, 2, 2, 'abc'] })).body, [369, 2]);
  assert.strictEqual((await call('/api/admin/featured-leagues', { id: FREE, method: 'PUT', body: [1] })).status, 403);

  const comps = await call('/api/competitions', { id: FREE });
  assert.deepStrictEqual(comps.body.featured.map((c) => c.name), ['Super League', 'UEFA Champions League']);
  const matches = await call(`/api/matches?date=${ymdTashkent}`, { id: FREE });
  assert.strictEqual(matches.status, 200);
  assert.ok(matches.body.matches.every((x) => x.featured === false), 'Uzbekistan/UCL o\'yinlari yo\'q — hammasi oddiy');
});

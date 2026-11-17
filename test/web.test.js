const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, fakeFootball, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const quiz = require('../src/services/quiz');
const { createApp } = require('../src/web/server');

let server;
let base;
let h;

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const team = (id, name) => ({ id, name, shortName: name, tla: name.slice(0, 3).toUpperCase(), crest: `https://crests/${id}.png` });
const squad = (teamId) => Array.from({ length: 16 }, (_, i) => ({ id: teamId * 100 + i, name: `P${teamId}-${i}`, position: i === 0 ? 'Goalkeeper' : i < 6 ? 'Defence' : i < 11 ? 'Midfield' : 'Offence' }));
const KICKOFF = NOW + 3 * 3600 * 1000;
let matchState = { status: 'TIMED', utcDate: iso(KICKOFF) };

function rawMatch() {
  return {
    id: 555, utcDate: matchState.utcDate, status: matchState.status, competition: { id: 2021, name: 'Premier League', code: 'PL' },
    homeTeam: { ...team(1, 'Arsenal'), lineup: matchState.lineupHome }, awayTeam: { ...team(2, 'Chelsea'), lineup: matchState.lineupAway },
    score: { winner: null, fullTime: { home: matchState.home ?? null, away: matchState.away ?? null } },
    goals: matchState.goals, bookings: matchState.bookings,
  };
}

const ymdTashkent = new Date(NOW + 5 * 3600 * 1000).toISOString().slice(0, 10);

football.setFetch(fakeFootball({
  '/matches': () => ({ matches: [{ ...rawMatch(), utcDate: `${ymdTashkent}T10:00:00Z` }, { ...rawMatch(), id: 556, status: 'IN_PLAY', utcDate: `${ymdTashkent}T08:00:00Z`, score: { fullTime: { home: 1, away: 1 } } }] }),
  '/matches/555': () => rawMatch(),
  '/teams/1': { squad: squad(1) },
  '/teams/2': { squad: squad(2) },
  '/competitions': { competitions: [
    { id: 2001, name: 'UEFA Champions League', code: 'CL', area: { id: 2077, name: 'Europe', code: 'EUR' } },
    { id: 2021, name: 'Premier League', code: 'PL', area: { id: 2072, name: 'England', code: 'ENG' } },
    { id: 9001, name: 'Super League', code: 'UZB', area: { id: 2250, name: 'Uzbekistan', code: 'UZB' } },
    { id: 2014, name: 'La Liga', code: 'PD', area: { id: 2224, name: 'Spain', code: 'ESP' } },
  ] },
  '/competitions/2021/standings': { standings: [{ type: 'TOTAL', table: [{ position: 1, team: team(1, 'Arsenal'), playedGames: 10, won: 8, draw: 1, lost: 1, points: 25, goalsFor: 20, goalsAgainst: 5, goalDifference: 15 }] }] },
  '/competitions/2021/scorers': { scorers: [{ player: { id: 1, name: 'Saka' }, team: team(1, 'Arsenal'), goals: 9, assists: 2 }, { player: { id: 2, name: 'Odegaard' }, team: team(1, 'Arsenal'), goals: 3, assists: 7 }] },
}));

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
  assert.strictEqual((await call('/api/competitions/2021/standings', { id: FREE })).body.standings[0].table[0].points, 25);
  for (const tab of ['results', 'calendar', 'scorers', 'assists']) assert.strictEqual((await call(`/api/competitions/2021/${tab}`, { id: FREE })).status, 402, tab);
  const assists = await call('/api/competitions/2021/assists', { id: PREM });
  assert.deepStrictEqual(assists.body.players.map((p) => p.player.name), ['Odegaard', 'Saka']);
});

test('Mini Manager: murabbiy, taxmin, qulf, hisoblash, reyting', async () => {
  const manager = require('../src/services/manager');
  const g = await manager.assignGame(555);
  assert.strictEqual(g.home_team_name, 'Arsenal');
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

  // Tugadi -> hisoblash
  Object.assign(matchState, {
    status: 'FINISHED', home: 2, away: 0,
    lineupHome: XI(1).map((id) => ({ id })), lineupAway: [...XI(2).slice(0, 10), 215].map((id) => ({ id })),
    goals: [{ team: { id: 1 }, scorer: { id: 105 }, assist: { id: 106 }, type: 'REGULAR' }, { team: { id: 1 }, scorer: { id: 110 }, assist: null, type: 'REGULAR' }],
    bookings: [{ team: { id: 2 }, player: { id: 203 }, card: 'YELLOW' }],
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
  assert.ok(q, 'API\'dan savol olindi');
  assert.match(q.question, /World Cup/, 'faqat futbolga oid savollar');
  assert.strictEqual((await db.one('SELECT count(*)::int AS c FROM quiz_questions')).c, 1);
  let st = await call('/api/quiz', { id: PREM });
  assert.strictEqual(st.body.status, 'new');
  assert.strictEqual(st.body.question, undefined, 'boshlanmaguncha savol ko\'rsatilmaydi');
  st = await call('/api/quiz/start', { id: PREM, method: 'POST', body: { questionId: q.id } });
  assert.strictEqual(st.body.status, 'in_progress');
  assert.ok(st.body.secondsLeft > 14);
  assert.strictEqual(st.body.question.options.A !== undefined, true);
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
  assert.strictEqual(p.body.manager.total, 147);
  assert.strictEqual(p.body.manager.overallPlace, 1);
  assert.strictEqual(p.body.quiz, null, 'Oddiy uchun quiz statistikasi yo\'q');
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
  const w = await db.many("SELECT kind, period, points FROM period_winners WHERE period = 'weekly' ORDER BY kind");
  assert.deepStrictEqual(w.map((x) => [x.kind, x.points]), [['manager', 147], ['quiz', 2]]);
  assert.ok(h.texts(FREE).some((x) => x.startsWith('🏆 Tabriklaymiz! Siz 🎮 Mini Manager haftalik')));
  await jobs.finalizePeriods(later);
  assert.strictEqual((await db.one("SELECT count(*)::int AS c FROM period_winners WHERE period = 'weekly'")).c, 2, 'takrorlanmaydi');

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

// Tashqi Football API — API-Football v3 (api-sports.io). Kalit: FOOTBALL_API_KEY (environment variable).
// Hujjat: https://www.api-football.com/documentation-v3
//
// Ortiqcha so'rovlardan himoya (bepul tarif: kuniga 100, daqiqasiga 10 so'rov):
//  1. Ikki darajali kesh: xotira + PostgreSQL (api_cache) — deploy'dan keyin ham saqlanadi.
//     Bir xil ma'lumot barcha foydalanuvchilarga bitta so'rov bilan beriladi.
//  2. Ma'lumot turiga qarab yangilanish vaqti (TTL): tugagan o'yinlar qayta so'ralmaydi,
//     jonli o'yinlar tez-tez, jadval/tarkib kamroq yangilanadi.
//  3. "Eskirgan bo'lsa ham darhol ber, orqada yangila" (stale-while-revalidate).
//  4. Bir vaqtdagi bir xil so'rovlar bitta so'rovga birlashtiriladi.
//  5. Daqiqalik navbat va kunlik limit nazorati: limit tugashiga yaqin foydalanuvchi so'rovlari
//     API'ga yuborilmaydi (zaxira fon vazifalari uchun — Mini Manager hisoblash).
//  6. API rad etgan so'rov (masalan, tarifda yo'q mavsum) ham keshlanadi — qayta-qayta so'ralmaydi.
// Frontend va Mini Manager provayderga bog'lanmasligi uchun javoblar normalize qilinadi.
const config = require('../config');
const db = require('../db/pool');

class FootballUnavailable extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason || 'unavailable'; // unavailable | busy | limit | plan | token | not_found
  }
}

const MIN = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;
const MEM_LIMIT = 500;                  // xotiradagi kesh yozuvlari soni chegarasi
const USER_MAX_WAIT_MS = 15000;         // foydalanuvchi so'rovi navbatda ko'pi bilan shuncha kutadi
const RATE_LIMIT = Number(process.env.FOOTBALL_API_RATE || 10);              // daqiqasiga
const DAILY_RESERVE = Number(process.env.FOOTBALL_DAILY_RESERVE || 10);      // fon vazifalari uchun zaxira
const TZ = 'Asia/Tashkent';

const mem = new Map();                  // key -> { data, fetchedAt, expiresAt }
const inflight = new Map();             // key -> Promise
const callTimes = [];
let blockedUntil = 0;                   // shu vaqtgacha API'ga so'rov yuborilmaydi
let daily = { remaining: null, day: null };
const stats = { network: 0, memHits: 0, dbHits: 0, stale: 0 };

let fetchImpl = (...args) => fetch(...args);
function setFetch(fn) { fetchImpl = fn; }      // testlar uchun

function utcDay() { return new Date().toISOString().slice(0, 10); }
function nextUtcMidnight() { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); }

async function clearCache() {
  mem.clear();
  daily = { remaining: null, day: null };
  blockedUntil = 0;
  callTimes.length = 0;
  await db.query('DELETE FROM api_cache').catch(() => {});
}

function remember(key, entry) {
  if (mem.size >= MEM_LIMIT) mem.delete(mem.keys().next().value);
  mem.set(key, entry);
}

async function readCache(key) {
  const m = mem.get(key);
  if (m) { stats.memHits += 1; return m; }
  const row = await db.one('SELECT data, fetched_at, expires_at FROM api_cache WHERE key = $1', [key]).catch(() => null);
  if (!row) return null;
  stats.dbHits += 1;
  const entry = { data: row.data, fetchedAt: new Date(row.fetched_at).getTime(), expiresAt: new Date(row.expires_at).getTime() };
  remember(key, entry);
  return entry;
}

async function writeCache(key, data, ttlSec) {
  const entry = { data, fetchedAt: Date.now(), expiresAt: Date.now() + ttlSec * 1000 };
  remember(key, entry);
  await db.query(
    `INSERT INTO api_cache (key, data, fetched_at, expires_at) VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(data), new Date(entry.expiresAt)],
  ).catch((e) => console.warn('[football cache]', e.message));
  return entry;
}

/** Daqiqalik limit navbati. maxWaitMs dan ko'p kutish kerak bo'lsa — darhol rad etadi */
async function throttle(maxWaitMs) {
  for (;;) {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] > 60000) callTimes.shift();
    let wait = 0;
    if (blockedUntil > now) wait = blockedUntil - now;
    else if (callTimes.length >= RATE_LIMIT) wait = 60000 - (now - callTimes[0]) + 50;
    if (!wait) { callTimes.push(now); return; }
    if (wait > maxWaitMs) throw new FootballUnavailable('Football API band, keyinroq urinib ko\'ring', 'busy');
    await new Promise((r) => setTimeout(r, wait));
  }
}

function header(res, name) {
  if (!res.headers || typeof res.headers.get !== 'function') return null;
  return res.headers.get(name) ?? res.headers.get(name.toLowerCase());
}

/** API-Football xatolari javob tanasida keladi: { errors: { requests | rateLimit | plan | token: "..." } } */
function apiErrors(body) {
  const e = body && body.errors;
  if (!e) return null;
  if (Array.isArray(e)) return e.length ? { message: e.join('; ') } : null;
  return Object.keys(e).length ? e : null;
}

async function fetchFromApi(key, ttl, { background }) {
  if (!background && daily.day === utcDay() && daily.remaining !== null && daily.remaining <= DAILY_RESERVE) {
    throw new FootballUnavailable('Kunlik limit tugashiga yaqin', 'limit');
  }
  await throttle(background ? 5 * 60000 : USER_MAX_WAIT_MS);
  stats.network += 1;
  const res = await fetchImpl(`${config.footballApiBase}${key}`, { headers: { 'x-apisports-key': config.footballApiKey } });

  const dayLeft = header(res, 'x-ratelimit-requests-remaining');
  if (dayLeft !== null && dayLeft !== undefined && dayLeft !== '') daily = { remaining: Number(dayLeft), day: utcDay() };
  if (header(res, 'x-ratelimit-remaining') === '0') blockedUntil = Date.now() + 60000;

  if (res.status === 429) { blockedUntil = Date.now() + 60000; throw new FootballUnavailable('Football API limiti', 'busy'); }
  if (res.status === 401 || res.status === 403) throw new FootballUnavailable('Football API kaliti noto\'g\'ri', 'token');
  if (!res.ok) throw new FootballUnavailable(`Football API ${res.status}`);
  const body = await res.json();

  const errors = apiErrors(body);
  if (errors) {
    if (errors.requests) {
      daily = { remaining: 0, day: utcDay() };
      blockedUntil = nextUtcMidnight();
      throw new FootballUnavailable('Kunlik limit tugadi', 'limit');
    }
    if (errors.rateLimit) { blockedUntil = Date.now() + 60000; throw new FootballUnavailable('Daqiqalik limit', 'busy'); }
    if (errors.token) throw new FootballUnavailable('Football API kaliti noto\'g\'ri', 'token');
    if (errors.plan) {
      // Tarifda yo'q ma'lumot (masalan, joriy mavsum) — rad javobi ham keshlanadi, qayta so'ralmaydi
      await writeCache(key, { __error: 'plan', message: String(errors.plan) }, 6 * HOUR);
      throw new FootballUnavailable(String(errors.plan), 'plan');
    }
    throw new FootballUnavailable(JSON.stringify(errors));
  }
  const data = body.response || [];
  const ttlSec = Math.max(30, Math.round(typeof ttl === 'function' ? ttl(data) : ttl));
  return writeCache(key, data, ttlSec);
}

function refresh(key, ttl, opts) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchFromApi(key, ttl, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function unwrap(data) {
  if (data && data.__error) throw new FootballUnavailable(data.message || data.__error, data.__error);
  return data;
}

/**
 * API so'rovi (kesh orqali). Natija — API javobining `response` qismi.
 *  ttl — soniya yoki (data) => soniya (ma'lumot mazmuniga qarab).
 *  opts.background — fon vazifalari: navbatda uzoqroq kutadi, kunlik zaxiradan foydalana oladi.
 */
async function request(path, params = {}, ttl = MIN, opts = {}) {
  if (!config.footballApiKey) throw new FootballUnavailable('FOOTBALL_API_KEY sozlanmagan');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const key = path + (qs ? `?${qs}` : '');
  const cached = await readCache(key);
  if (cached && cached.expiresAt > Date.now()) return unwrap(cached.data);
  if (cached) {
    // Eskirgan: darhol eskisini beramiz, orqada (bitta so'rov bilan) yangilaymiz
    stats.stale += 1;
    refresh(key, ttl, { background: !!opts.background }).catch(() => {});
    return unwrap(cached.data);
  }
  return unwrap((await refresh(key, ttl, { background: !!opts.background })).data);
}

async function cleanupCache() {
  await db.query("DELETE FROM api_cache WHERE expires_at < now() - interval '30 days'");
}

// ---------- Holatlar (fixture.status.short)
const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
const DONE = ['FT', 'AET', 'PEN', 'AWD', 'WO'];
const CANCELLED = ['PST', 'CANC', 'ABD', 'SUSP'];

function statusOf(f) { return f && f.fixture && f.fixture.status ? f.fixture.status.short : null; }

function matchState(short) {
  if (LIVE.includes(short)) return 'live';
  if (DONE.includes(short)) return 'finished';
  if (CANCELLED.includes(short)) return 'cancelled';
  return 'scheduled';
}

/** Xom o'yin obyektining holati: scheduled | live | finished | cancelled */
function rawState(f) { return matchState(statusOf(f)); }

function kickoffMs(f) { return f.fixture.timestamp ? f.fixture.timestamp * 1000 : Date.parse(f.fixture.date); }

// ---------- Normalizatsiya
function team(t) {
  return t ? { id: t.id, name: t.name, fullName: t.name, crest: t.logo || null, tla: null } : null;
}

function normMatch(f) {
  const short = statusOf(f);
  return {
    id: f.fixture.id,
    utcDate: new Date(kickoffMs(f)).toISOString(),
    status: short,
    state: matchState(short),
    minute: f.fixture.status ? f.fixture.status.elapsed || null : null,
    competition: f.league ? { id: f.league.id, name: f.league.name, code: null, emblem: f.league.logo || null, season: f.league.season } : null,
    area: f.league ? { name: f.league.country, flag: f.league.flag || null } : null,
    matchday: f.league ? f.league.round || null : null,
    stage: null,
    home: team(f.teams && f.teams.home),
    away: team(f.teams && f.teams.away),
    score: {
      home: f.goals ? f.goals.home : null,
      away: f.goals ? f.goals.away : null,
      winner: f.teams && f.teams.home && f.teams.home.winner ? 'HOME_TEAM' : f.teams && f.teams.away && f.teams.away.winner ? 'AWAY_TEAM' : null,
    },
  };
}

function normPerson(p) { return p && (p.id || p.name) ? { id: p.id || null, name: p.name } : null; }

/** "Ball Possession" -> "ball_possession"; frontend tarjimalari bilan mos kalitlar */
const STAT_ALIASES = { total_shots: 'shots', goalkeeper_saves: 'saves' };
function statKey(type) {
  const k = String(type).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return STAT_ALIASES[k] || k;
}

/** Kartochka turi: 'yellow' | 'red' | 'second_yellow' | null */
function cardKind(detail) {
  const d = String(detail || '').toLowerCase();
  if (d.includes('second yellow')) return 'second_yellow';
  if (d.includes('red')) return 'red';
  if (d.includes('yellow')) return 'yellow';
  return null;
}

function isScoredGoal(e) {
  const d = String(e.detail || '').toLowerCase();
  return e.type === 'Goal' && !d.includes('own') && !d.includes('missed');
}

/** Batafsil sahifa: faqat API bergan ma'lumotlar tab sifatida chiqadi */
function normMatchDetail(f) {
  const base = normMatch(f);
  const homeId = base.home && base.home.id;
  const tabs = {};

  const statsBy = {};
  for (const s of f.statistics || []) {
    const obj = {};
    for (const it of s.statistics || []) if (it.value !== null && it.value !== undefined) obj[statKey(it.type)] = it.value;
    statsBy[s.team && s.team.id === homeId ? 'home' : 'away'] = obj;
  }
  if (Object.keys(statsBy).length) tabs.statistics = { home: statsBy.home || {}, away: statsBy.away || {} };

  const lineups = {};
  for (const l of f.lineups || []) {
    const side = l.team && l.team.id === homeId ? 'home' : 'away';
    const pl = (x) => ({ id: x.player.id, name: x.player.name, position: x.player.pos || null, shirtNumber: x.player.number ?? null });
    lineups[side] = {
      formation: l.formation || null, coach: l.coach ? l.coach.name : null,
      lineup: (l.startXI || []).map(pl), bench: (l.substitutes || []).map(pl),
    };
  }
  if (lineups.home || lineups.away) tabs.lineups = { home: lineups.home || null, away: lineups.away || null };

  const events = [];
  for (const e of f.events || []) {
    const minute = e.time ? e.time.elapsed : null;
    const extra = e.time ? e.time.extra || null : null;
    const teamId = e.team ? e.team.id : null;
    if (e.type === 'Goal') {
      if (String(e.detail || '').toLowerCase().includes('missed')) continue;
      events.push({ type: 'goal', minute, extra, teamId, player: normPerson(e.player), assist: normPerson(e.assist), detail: e.detail || null });
    } else if (e.type === 'Card') {
      const kind = cardKind(e.detail);
      if (kind) events.push({ type: kind === 'yellow' ? 'yellow' : 'red', minute, extra, teamId, player: normPerson(e.player), detail: e.detail });
    } else if (String(e.type).toLowerCase() === 'subst') {
      events.push({ type: 'sub', minute, extra, teamId, player: normPerson(e.player), out: normPerson(e.assist) });
    }
  }
  if (events.length) tabs.events = events.sort((a, b) => (a.minute || 0) - (b.minute || 0));

  return { ...base, halfTime: f.score && f.score.halftime ? f.score.halftime : null, venue: f.fixture.venue ? f.fixture.venue.name : null, tabs };
}

/**
 * Mini Manager hisoblash uchun natija (scoring.score formatida).
 * Batafsil ma'lumot (events/lineups) API'da bo'lmasa — tegishli maydon null.
 */
function matchResult(f) {
  const homeId = f.teams.home.id;
  const awayId = f.teams.away.id;
  const ev = Array.isArray(f.events) && f.events.length ? f.events : null;
  const goals = ev ? ev.filter((e) => e.type === 'Goal' && !String(e.detail || '').toLowerCase().includes('missed')).map((e) => ({
    teamId: e.team && e.team.id, scorerId: e.player && e.player.id, assistId: e.assist && e.assist.id, own: !isScoredGoal(e),
  })) : null;
  const bookings = ev ? ev.filter((e) => e.type === 'Card' && cardKind(e.detail)).map((e) => {
    const k = cardKind(e.detail);
    return { teamId: e.team && e.team.id, playerId: e.player && e.player.id, card: k === 'second_yellow' ? 'YELLOW_RED' : k === 'red' ? 'RED' : 'YELLOW' };
  }) : null;
  const xi = (id) => {
    const l = (f.lineups || []).find((x) => x.team && x.team.id === id);
    return l && Array.isArray(l.startXI) && l.startXI.length ? l.startXI.map((x) => x.player.id) : null;
  };
  return {
    homeId, awayId,
    homeGoals: f.goals ? f.goals.home : null,
    awayGoals: f.goals ? f.goals.away : null,
    goals, bookings,
    lineupHome: xi(homeId), lineupAway: xi(awayId),
  };
}

// ---------- Yangilanish vaqtlari (soniya) — ma'lumot mazmuniga qarab
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** O'yinlar ro'yxati: jonli bo'lsa — 1 daqiqa; hammasi tugagan — 1 kun; aks holda keyingi o'yingacha */
function ttlForMatchList(fixtures, rangeEndMs) {
  if (fixtures.some((f) => LIVE.includes(statusOf(f)))) return MIN;
  const pending = fixtures.filter((f) => { const s = statusOf(f); return !DONE.includes(s) && !CANCELLED.includes(s); }).map(kickoffMs);
  if (!pending.length) return rangeEndMs && rangeEndMs < Date.now() ? DAY : 6 * HOUR;
  const untilNext = (Math.min(...pending) - Date.now()) / 1000;
  return untilNext <= 0 ? 2 * MIN : clamp(untilNext, 2 * MIN, HOUR);
}

/** Bitta o'yin: jonli — 30 s; tugagan — 6 soat; boshlanmagan — boshlanishigacha (ko'pi bilan 6 soat) */
function ttlForMatch(f) {
  const s = statusOf(f);
  if (LIVE.includes(s)) return 30;
  if (DONE.includes(s) || CANCELLED.includes(s)) return 6 * HOUR;
  const untilStart = (kickoffMs(f) - Date.now()) / 1000;
  return untilStart <= 0 ? MIN : clamp(untilStart, 2 * MIN, 6 * HOUR);
}

const firstFixtureTtl = (list) => (list[0] ? ttlForMatch(list[0]) : HOUR);

// ---------- API funksiyalari
function sortMatches(list) {
  return list.sort((a, b) => (a.competition && b.competition && a.competition.name !== b.competition.name
    ? a.competition.name.localeCompare(b.competition.name) : a.utcDate.localeCompare(b.utcDate)));
}

/** Toshkent vaqti bo'yicha bir kundagi barcha o'yinlar — bitta so'rov */
async function matchesByDate(ymd, opts = {}) {
  const dayEnd = Date.parse(`${ymd}T23:59:59+05:00`);
  const data = await request('/fixtures', { date: ymd, timezone: TZ }, (d) => ttlForMatchList(d, dayEnd), opts);
  return sortMatches(data.map(normMatch));
}

async function matchDetail(id) {
  return normMatchDetail(await rawMatch(id));
}

/** Xom o'yin obyekti (events, lineups, statistics bilan) */
async function rawMatch(id, opts = {}) {
  const data = await request('/fixtures', { id: Number(id) }, firstFixtureTtl, opts);
  if (!data[0]) throw new FootballUnavailable('O\'yin topilmadi', 'not_found');
  return data[0];
}

/** Joriy mavsumdagi barcha ligalar (bitta so'rov, kuniga bir marta) */
async function allLeagues() {
  return request('/leagues', { current: 'true' }, DAY);
}

function currentSeason(item) {
  const seasons = item.seasons || [];
  const cur = seasons.find((s) => s.current) || seasons[seasons.length - 1];
  return cur ? cur.year : null;
}

async function competitions() {
  const intl = [];
  const countries = new Map();
  for (const it of await allLeagues()) {
    const item = { id: it.league.id, name: it.league.name, code: null, type: it.league.type, emblem: it.league.logo || null };
    const country = it.country || {};
    // Xalqaro turnirlar (Chempionlar Ligasi, JCh va h.k.) — davlat kodi yo'q, odatda "World"
    if (!country.code || country.name === 'World') intl.push({ ...item, area: country.name || 'World' });
    else {
      const key = country.name;
      if (!countries.has(key)) countries.set(key, { id: key, name: country.name, flag: country.flag || null, competitions: [] });
      countries.get(key).competitions.push(item);
    }
  }
  for (const c of countries.values()) c.competitions.sort((a, b) => a.name.localeCompare(b.name));
  return {
    international: intl.sort((a, b) => a.name.localeCompare(b.name)),
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function leagueInfo(id) {
  const it = (await allLeagues()).find((x) => x.league.id === Number(id));
  if (!it) throw new FootballUnavailable('Liga topilmadi', 'not_found');
  return it;
}

async function competitionInfo(id) {
  const it = await leagueInfo(id);
  return { id: it.league.id, name: it.league.name, code: null, emblem: it.league.logo || null, area: it.country ? it.country.name : null, season: currentSeason(it) };
}

async function standings(id) {
  const season = currentSeason(await leagueInfo(id));
  const data = await request('/standings', { league: Number(id), season }, 15 * MIN);
  const groups = (data[0] && data[0].league && data[0].league.standings) || [];
  return groups.map((rows) => ({
    group: rows[0] && rows[0].group && groups.length > 1 ? rows[0].group : null,
    table: rows.map((r) => ({
      position: r.rank, team: team(r.team), played: r.all.played, won: r.all.win, draw: r.all.draw, lost: r.all.lose,
      goalsFor: r.all.goals.for, goalsAgainst: r.all.goals.against, goalDifference: r.goalsDiff, points: r.points,
    })),
  }));
}

async function competitionMatches(id, kind) {
  const season = currentSeason(await leagueInfo(id));
  const params = kind === 'results' ? { league: Number(id), season, last: 50, timezone: TZ } : { league: Number(id), season, next: 50, timezone: TZ };
  const data = await request('/fixtures', params, kind === 'results' ? 15 * MIN : HOUR);
  const list = data.map(normMatch);
  return kind === 'results' ? list.sort((a, b) => b.utcDate.localeCompare(a.utcDate)) : list.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

function normPlayerStat(r) {
  const st = (r.statistics && r.statistics[0]) || {};
  return {
    player: normPerson(r.player), team: team(st.team),
    goals: (st.goals && st.goals.total) || 0, assists: (st.goals && st.goals.assists) || 0, penalties: (st.penalty && st.penalty.scored) || 0,
  };
}

async function scorers(id) {
  const season = currentSeason(await leagueInfo(id));
  const [top, assists] = await Promise.all([
    request('/players/topscorers', { league: Number(id), season }, HOUR),
    request('/players/topassists', { league: Number(id), season }, HOUR),
  ]);
  return {
    scorers: top.map(normPlayerStat).slice(0, 10),
    assists: assists.map(normPlayerStat).filter((r) => r.assists > 0).slice(0, 10),
  };
}

function positionGroup(pos) {
  const p = String(pos || '').toLowerCase();
  if (p.includes('goal') || p === 'g') return 'GK';
  if (p.includes('def') || p.includes('back') || p === 'd') return 'DEF';
  if (p.includes('mid') || p === 'm') return 'MID';
  if (p.includes('att') || p.includes('forw') || p.includes('wing') || p.includes('strik') || p === 'f') return 'FWD';
  return 'MID';
}

/** Klubning joriy tarkibi */
async function squad(teamId) {
  const data = await request('/players/squads', { team: Number(teamId) }, DAY);
  const players = (data[0] && data[0].players) || [];
  return players.map((p) => ({ id: p.id, name: p.name, position: p.position || null, group: positionGroup(p.position), nationality: null }));
}

/** Admin uchun: sanalar oralig'idagi o'yinlar (har kun — bitta keshlangan so'rov, ko'pi bilan 14 kun) */
async function matchesRange(fromYmd, toYmd) {
  const out = [];
  const end = Date.parse(`${toYmd}T00:00:00Z`);
  for (let d = Date.parse(`${fromYmd}T00:00:00Z`), i = 0; d <= end && i < 14; d += DAY * 1000, i += 1) {
    out.push(...(await matchesByDate(new Date(d).toISOString().slice(0, 10))));
  }
  return out.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

module.exports = {
  FootballUnavailable, setFetch, clearCache, cleanupCache, stats, request, ttlForMatch, ttlForMatchList,
  matchesByDate, matchDetail, rawMatch, rawState, matchResult, competitions, competitionInfo,
  standings, competitionMatches, scorers, squad, matchesRange, normMatch, matchState, positionGroup,
};

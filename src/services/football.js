// Tashqi Football API (football-data.org v4). Kalit: FOOTBALL_API_KEY (environment variable).
//
// Ortiqcha so'rovlardan himoya (bepul tarif: daqiqasiga 10 so'rov):
//  1. Ikki darajali kesh: xotira + PostgreSQL (api_cache) — deploy'dan keyin ham saqlanadi.
//     Bir xil ma'lumot barcha foydalanuvchilarga bitta so'rov bilan beriladi.
//  2. Ma'lumot turiga qarab yangilanish vaqti (TTL): tugagan o'yinlar qayta so'ralmaydi,
//     jonli o'yinlar tez-tez, jadval/tarkib kamroq yangilanadi.
//  3. "Eskirgan bo'lsa ham darhol ber, orqada yangila" (stale-while-revalidate):
//     foydalanuvchi API'ni kutmaydi, yangilash uchun faqat bitta so'rov ketadi.
//  4. Bir vaqtdagi bir xil so'rovlar bitta so'rovga birlashtiriladi.
//  5. Daqiqalik limit navbati; navbat juda uzun bo'lsa foydalanuvchi so'rovi kutib qolmaydi.
// Frontend provayderga bog'lanmasligi uchun javoblar normalize qilinadi.
const config = require('../config');
const db = require('../db/pool');

class FootballUnavailable extends Error {}

const MIN = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;
const MEM_LIMIT = 2000;                 // xotiradagi kesh yozuvlari soni chegarasi
const USER_MAX_WAIT_MS = 15000;         // foydalanuvchi so'rovi navbatda ko'pi bilan shuncha kutadi

const mem = new Map();                  // key -> { data, fetchedAt, expiresAt }
const inflight = new Map();             // key -> Promise
const callTimes = [];
let blockedUntil = 0;                   // API "limit tugadi" desa — shu vaqtgacha so'rov yuborilmaydi
const RATE_LIMIT = Number(process.env.FOOTBALL_API_RATE || 10);
const stats = { network: 0, memHits: 0, dbHits: 0, stale: 0 };

let fetchImpl = (...args) => fetch(...args);
function setFetch(fn) { fetchImpl = fn; }      // testlar uchun

async function clearCache() {
  mem.clear();
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
    if (wait > maxWaitMs) throw new FootballUnavailable('Football API band, keyinroq urinib ko\'ring');
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function fetchFromApi(key, ttl, maxWaitMs) {
  await throttle(maxWaitMs);
  stats.network += 1;
  const res = await fetchImpl(`${config.footballApiBase}${key}`, { headers: { 'X-Auth-Token': config.footballApiKey } });
  // football-data.org daqiqalik qoldiqni va qayta tiklanish vaqtini sarlavhada beradi
  const left = res.headers && res.headers.get ? res.headers.get('x-requests-available-minute') : null;
  const reset = res.headers && res.headers.get ? Number(res.headers.get('x-requestcounter-reset')) : 0;
  if (left === '0' && reset > 0) blockedUntil = Date.now() + reset * 1000;
  if (res.status === 429) {
    blockedUntil = Date.now() + (reset > 0 ? reset : 60) * 1000;
    throw new FootballUnavailable('Football API limiti');
  }
  if (res.status === 403 || res.status === 404) {
    const err = new FootballUnavailable(`Football API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) throw new FootballUnavailable(`Football API ${res.status}`);
  const data = await res.json();
  const ttlSec = Math.max(30, Math.round(typeof ttl === 'function' ? ttl(data) : ttl));
  return writeCache(key, data, ttlSec);
}

function refresh(key, ttl, maxWaitMs) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchFromApi(key, ttl, maxWaitMs).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * API so'rovi (kesh orqali).
 *  ttl — soniya yoki (data) => soniya (ma'lumot mazmuniga qarab).
 *  opts.background — fon vazifalari: navbatda uzoqroq kutishi mumkin.
 */
async function request(path, params = {}, ttl = MIN, opts = {}) {
  if (!config.footballApiKey) throw new FootballUnavailable('FOOTBALL_API_KEY sozlanmagan');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const key = path + (qs ? `?${qs}` : '');
  const maxWaitMs = opts.background ? 5 * 60000 : USER_MAX_WAIT_MS;
  const cached = await readCache(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) {
    // Eskirgan: darhol eskisini beramiz, orqada (bitta so'rov bilan) yangilaymiz
    stats.stale += 1;
    refresh(key, ttl, 5 * 60000).catch(() => {});
    return cached.data;
  }
  return (await refresh(key, ttl, maxWaitMs)).data;
}

async function cleanupCache() {
  await db.query("DELETE FROM api_cache WHERE expires_at < now() - interval '30 days'");
}

// ---------- Normalizatsiya
const LIVE = ['IN_PLAY', 'PAUSED', 'LIVE', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'];
const DONE = ['FINISHED', 'AWARDED'];

function matchState(status) {
  if (LIVE.includes(status)) return 'live';
  if (DONE.includes(status)) return 'finished';
  if (['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(status)) return 'cancelled';
  return 'scheduled';
}

function team(t) {
  return t ? { id: t.id, name: t.shortName || t.name, fullName: t.name, crest: t.crest || null, tla: t.tla || null } : null;
}

function normMatch(m) {
  return {
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    state: matchState(m.status),
    minute: m.minute || null,
    competition: m.competition ? { id: m.competition.id, name: m.competition.name, code: m.competition.code, emblem: m.competition.emblem } : null,
    area: m.area ? { name: m.area.name, flag: m.area.flag } : null,
    matchday: m.matchday || null,
    stage: m.stage || null,
    home: team(m.homeTeam),
    away: team(m.awayTeam),
    score: {
      home: m.score && m.score.fullTime ? m.score.fullTime.home : null,
      away: m.score && m.score.fullTime ? m.score.fullTime.away : null,
      winner: m.score ? m.score.winner : null,
    },
  };
}

function normPerson(p) { return p ? { id: p.id, name: p.name } : null; }

/** Batafsil sahifa: faqat API bergan ma'lumotlar tab sifatida chiqadi */
function normMatchDetail(m) {
  const base = normMatch(m);
  const tabs = {};
  const stat = (t) => (t && t.statistics && Object.keys(t.statistics).length ? t.statistics : null);
  if (stat(m.homeTeam) || stat(m.awayTeam)) tabs.statistics = { home: stat(m.homeTeam) || {}, away: stat(m.awayTeam) || {} };
  const lineup = (t) => (t && Array.isArray(t.lineup) && t.lineup.length
    ? { formation: t.formation || null, coach: t.coach ? t.coach.name : null, lineup: t.lineup.map((p) => ({ id: p.id, name: p.name, position: p.position, shirtNumber: p.shirtNumber })), bench: (t.bench || []).map((p) => ({ id: p.id, name: p.name, position: p.position, shirtNumber: p.shirtNumber })) }
    : null);
  if (lineup(m.homeTeam) || lineup(m.awayTeam)) tabs.lineups = { home: lineup(m.homeTeam), away: lineup(m.awayTeam) };
  const events = [];
  for (const g of m.goals || []) events.push({ type: 'goal', minute: g.minute, extra: g.injuryTime || null, teamId: g.team && g.team.id, player: normPerson(g.scorer), assist: normPerson(g.assist), detail: g.type });
  for (const b of m.bookings || []) events.push({ type: b.card === 'YELLOW' ? 'yellow' : 'red', minute: b.minute, teamId: b.team && b.team.id, player: normPerson(b.player), detail: b.card });
  for (const s of m.substitutions || []) events.push({ type: 'sub', minute: s.minute, teamId: s.team && s.team.id, player: normPerson(s.playerIn), out: normPerson(s.playerOut) });
  if (events.length) tabs.events = events.sort((a, b) => (a.minute || 0) - (b.minute || 0));
  return { ...base, halfTime: m.score && m.score.halfTime ? m.score.halfTime : null, venue: m.venue || null, tabs };
}

// ---------- Yangilanish vaqtlari (soniya) — ma'lumot mazmuniga qarab
const CANCELLED = ['POSTPONED', 'SUSPENDED', 'CANCELLED'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** O'yinlar ro'yxati: jonli bo'lsa — 1 daqiqa; hammasi tugagan — 1 kun; aks holda keyingi o'yingacha */
function ttlForMatchList(matches, rangeEndMs) {
  if (matches.some((m) => LIVE.includes(m.status))) return MIN;
  const pending = matches.filter((m) => !DONE.includes(m.status) && !CANCELLED.includes(m.status)).map((m) => Date.parse(m.utcDate));
  if (!pending.length) return rangeEndMs && rangeEndMs < Date.now() ? DAY : 6 * HOUR;
  const untilNext = (Math.min(...pending) - Date.now()) / 1000;
  return untilNext <= 0 ? 2 * MIN : clamp(untilNext, 2 * MIN, HOUR);
}

/** Bitta o'yin: jonli — 30 s; tugagan — 6 soat; boshlanmagan — boshlanishigacha (ko'pi bilan 6 soat) */
function ttlForMatch(m) {
  if (LIVE.includes(m.status)) return 30;
  if (DONE.includes(m.status) || CANCELLED.includes(m.status)) return 6 * HOUR;
  const untilStart = (Date.parse(m.utcDate) - Date.now()) / 1000;
  return untilStart <= 0 ? MIN : clamp(untilStart, 2 * MIN, 6 * HOUR);
}

// ---------- API funksiyalari
async function matchesByDate(ymd) {
  const next = new Date(`${ymd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const to = next.toISOString().slice(0, 10);
  // football-data sanalari UTC; Toshkent kuni (UTC+5) uchun ikki UTC kunini olib, filtrlaymiz
  const prev = new Date(`${ymd}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const rangeEnd = Date.parse(`${to}T23:59:59Z`);
  const data = await request('/matches', { dateFrom: prev.toISOString().slice(0, 10), dateTo: to },
    (d) => ttlForMatchList(d.matches || [], rangeEnd));
  const startMs = Date.parse(`${ymd}T00:00:00+05:00`);
  const endMs = startMs + 24 * 3600 * 1000;
  return (data.matches || [])
    .filter((m) => { const t = Date.parse(m.utcDate); return t >= startMs && t < endMs; })
    .map(normMatch)
    .sort((a, b) => (a.competition && b.competition && a.competition.name !== b.competition.name
      ? a.competition.name.localeCompare(b.competition.name) : a.utcDate.localeCompare(b.utcDate)));
}

async function matchDetail(id) {
  return normMatchDetail(await request(`/matches/${Number(id)}`, {}, ttlForMatch));
}

/** Xom match obyekti (Mini Manager hisoblash uchun) */
async function rawMatch(id, opts = {}) {
  return request(`/matches/${Number(id)}`, {}, ttlForMatch, opts);
}

const INTL_AREAS = new Set(['INT', 'EUR', 'SAM', 'NAM', 'AFR', 'ASI', 'OCE', 'CCA', 'WOR']);
const INTL_NAMES = new Set(['World', 'Europe', 'South America', 'North America', 'Africa', 'Asia', 'Oceania', 'N/C America']);

async function competitions() {
  const data = await request('/competitions', {}, DAY);
  const intl = [];
  const countries = new Map();
  for (const c of data.competitions || []) {
    const item = { id: c.id, name: c.name, code: c.code, type: c.type, emblem: c.emblem };
    const area = c.area || {};
    if (INTL_AREAS.has(area.code) || INTL_NAMES.has(area.name)) intl.push({ ...item, area: area.name });
    else {
      if (!countries.has(area.id)) countries.set(area.id, { id: area.id, name: area.name, flag: area.flag || null, competitions: [] });
      countries.get(area.id).competitions.push(item);
    }
  }
  return {
    international: intl.sort((a, b) => a.name.localeCompare(b.name)),
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function competitionInfo(id) {
  const c = await request(`/competitions/${Number(id)}`, {}, DAY);
  return { id: c.id, name: c.name, code: c.code, emblem: c.emblem, area: c.area ? c.area.name : null };
}

async function standings(id) {
  const data = await request(`/competitions/${Number(id)}/standings`, {}, 15 * MIN);
  return (data.standings || [])
    .filter((s) => !s.type || s.type === 'TOTAL')
    .map((s) => ({
      group: s.group || s.stage || null,
      table: (s.table || []).map((r) => ({
        position: r.position, team: team(r.team), played: r.playedGames, won: r.won, draw: r.draw, lost: r.lost,
        goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points,
      })),
    }));
}

async function competitionMatches(id, kind) {
  const params = kind === 'results' ? { status: 'FINISHED' } : { status: 'SCHEDULED,TIMED' };
  const data = await request(`/competitions/${Number(id)}/matches`, params, kind === 'results' ? 15 * MIN : HOUR);
  let list = (data.matches || []).map(normMatch);
  list = kind === 'results' ? list.sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 50)
    : list.sort((a, b) => a.utcDate.localeCompare(b.utcDate)).slice(0, 50);
  return list;
}

async function scorers(id) {
  const data = await request(`/competitions/${Number(id)}/scorers`, { limit: 50 }, HOUR);
  const rows = (data.scorers || []).map((s) => ({
    player: normPerson(s.player), team: team(s.team), goals: s.goals || 0, assists: s.assists || 0, penalties: s.penalties || 0,
  }));
  return {
    scorers: [...rows].sort((a, b) => b.goals - a.goals).slice(0, 10),
    assists: rows.filter((r) => r.assists > 0).sort((a, b) => b.assists - a.assists).slice(0, 10),
  };
}

function positionGroup(pos) {
  const p = String(pos || '').toLowerCase();
  if (p.includes('goal')) return 'GK';
  if (p.includes('def') || p.includes('back')) return 'DEF';
  if (p.includes('mid')) return 'MID';
  if (p.includes('off') || p.includes('forw') || p.includes('wing') || p.includes('strik') || p.includes('attack')) return 'FWD';
  return 'MID';
}

/** Klubning joriy tarkibi */
async function squad(teamId) {
  const data = await request(`/teams/${Number(teamId)}`, {}, DAY);
  return (data.squad || []).map((p) => ({ id: p.id, name: p.name, position: p.position || null, group: positionGroup(p.position), nationality: p.nationality || null }));
}

/** Admin uchun: sanalar oralig'idagi o'yinlar */
async function matchesRange(fromYmd, toYmd) {
  const data = await request('/matches', { dateFrom: fromYmd, dateTo: toYmd }, (d) => ttlForMatchList(d.matches || []));
  return (data.matches || []).map(normMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

module.exports = {
  FootballUnavailable, setFetch, clearCache, cleanupCache, stats, request, ttlForMatch, ttlForMatchList, matchesByDate, matchDetail, rawMatch, competitions, competitionInfo,
  standings, competitionMatches, scorers, squad, matchesRange, normMatch, matchState, positionGroup,
};

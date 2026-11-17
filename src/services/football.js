// Tashqi Football API (football-data.org v4). Kalit: FOOTBALL_API_KEY (.env).
// Bepul tarif: daqiqasiga 10 so'rov — shuning uchun kesh + navbat.
// Frontend provayderga bog'lanmasligi uchun javoblar normalize qilinadi.
const config = require('../config');

class FootballUnavailable extends Error {}

const cache = new Map();          // key -> { at, ttl, data }
const inflight = new Map();       // key -> Promise
const callTimes = [];
const RATE_LIMIT = Number(process.env.FOOTBALL_API_RATE || 10);

let fetchImpl = (...args) => fetch(...args);
function setFetch(fn) { fetchImpl = fn; }      // testlar uchun
function clearCache() { cache.clear(); }

async function throttle() {
  for (;;) {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] > 60000) callTimes.shift();
    if (callTimes.length < RATE_LIMIT) { callTimes.push(now); return; }
    await new Promise((r) => setTimeout(r, 60000 - (now - callTimes[0]) + 50));
  }
}

async function request(path, params = {}, ttlSec = 60) {
  if (!config.footballApiKey) throw new FootballUnavailable('FOOTBALL_API_KEY sozlanmagan');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const key = path + (qs ? `?${qs}` : '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.data;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    await throttle();
    const res = await fetchImpl(`${config.footballApiBase}${key}`, { headers: { 'X-Auth-Token': config.footballApiKey } });
    if (res.status === 429) {
      if (hit) return hit.data; // eskirgan bo'lsa ham keshdagini qaytaramiz
      throw new FootballUnavailable('Football API limiti');
    }
    if (res.status === 403 || res.status === 404) {
      const err = new FootballUnavailable(`Football API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new FootballUnavailable(`Football API ${res.status}`);
    const data = await res.json();
    cache.set(key, { at: Date.now(), ttl: ttlSec, data });
    return data;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
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

// ---------- API funksiyalari
async function matchesByDate(ymd) {
  const next = new Date(`${ymd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const to = next.toISOString().slice(0, 10);
  // football-data sanalari UTC; Toshkent kuni (UTC+5) uchun ikki UTC kunini olib, filtrlaymiz
  const prev = new Date(`${ymd}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const data = await request('/matches', { dateFrom: prev.toISOString().slice(0, 10), dateTo: to }, 60);
  const startMs = Date.parse(`${ymd}T00:00:00+05:00`);
  const endMs = startMs + 24 * 3600 * 1000;
  return (data.matches || [])
    .filter((m) => { const t = Date.parse(m.utcDate); return t >= startMs && t < endMs; })
    .map(normMatch)
    .sort((a, b) => (a.competition && b.competition && a.competition.name !== b.competition.name
      ? a.competition.name.localeCompare(b.competition.name) : a.utcDate.localeCompare(b.utcDate)));
}

async function matchDetail(id) {
  return normMatchDetail(await request(`/matches/${Number(id)}`, {}, 30));
}

/** Xom match obyekti (Mini Manager hisoblash uchun) */
async function rawMatch(id, ttl = 30) {
  return request(`/matches/${Number(id)}`, {}, ttl);
}

const INTL_AREAS = new Set(['INT', 'EUR', 'SAM', 'NAM', 'AFR', 'ASI', 'OCE', 'CCA', 'WOR']);
const INTL_NAMES = new Set(['World', 'Europe', 'South America', 'North America', 'Africa', 'Asia', 'Oceania', 'N/C America']);

async function competitions() {
  const data = await request('/competitions', {}, 6 * 3600);
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
  const c = await request(`/competitions/${Number(id)}`, {}, 6 * 3600);
  return { id: c.id, name: c.name, code: c.code, emblem: c.emblem, area: c.area ? c.area.name : null };
}

async function standings(id) {
  const data = await request(`/competitions/${Number(id)}/standings`, {}, 300);
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
  const data = await request(`/competitions/${Number(id)}/matches`, params, kind === 'results' ? 300 : 900);
  let list = (data.matches || []).map(normMatch);
  list = kind === 'results' ? list.sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 50)
    : list.sort((a, b) => a.utcDate.localeCompare(b.utcDate)).slice(0, 50);
  return list;
}

async function scorers(id) {
  const data = await request(`/competitions/${Number(id)}/scorers`, { limit: 50 }, 900);
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
  const data = await request(`/teams/${Number(teamId)}`, {}, 12 * 3600);
  return (data.squad || []).map((p) => ({ id: p.id, name: p.name, position: p.position || null, group: positionGroup(p.position), nationality: p.nationality || null }));
}

/** Admin uchun: sanalar oralig'idagi o'yinlar */
async function matchesRange(fromYmd, toYmd) {
  const data = await request('/matches', { dateFrom: fromYmd, dateTo: toYmd }, 120);
  return (data.matches || []).map(normMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

module.exports = {
  FootballUnavailable, setFetch, clearCache, request, matchesByDate, matchDetail, rawMatch, competitions, competitionInfo,
  standings, competitionMatches, scorers, squad, matchesRange, normMatch, matchState, positionGroup,
};

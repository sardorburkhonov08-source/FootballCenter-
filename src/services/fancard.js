// 🪪 Muxlislik kartasi: profil bo'limida. Karta raqami — users.id (ro'yxatdan o'tish tartibi).
// Oddiy tarif — FootballCenter uslubidagi oddiy karta; Premium — tanlangan klub logotipi va klub ranglari.
// Klub ranglari logotipdan avtomatik aniqlanadi (API-Football rang bermaydi) va team_colors jadvalida saqlanadi.
const crypto = require('crypto');
const { PNG } = require('pngjs');
const db = require('../db/pool');
const config = require('../config');
const football = require('./football');
const users = require('./users');
const { t, LOCALES } = require('../i18n');
const { parts } = require('./time');

const REGIONS = ['tashkent_city', 'tashkent', 'andijan', 'bukhara', 'fergana', 'jizzakh', 'khorezm', 'namangan', 'navoi',
  'kashkadarya', 'karakalpakstan', 'samarkand', 'syrdarya', 'surkhandarya', 'abroad'];
const PLAYER_MAX = 40;
const DEFAULT = { primary: '#16241d', secondary: '#2ecc71' }; // dizayn tizimi (SPEC 19)

class CardError extends Error {}

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

// ---------- Ranglar
function hex(r, g, b) { return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`; }
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Fon rangiga mos matn rangi (o'qilishi uchun) */
function textOn(bg) { return luminance(bg) > 0.45 ? '#0c1712' : '#f3f7f4'; }
function saturation(r, g, b) { const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }

/**
 * Logotipdagi asosiy ranglar: shaffof va oq/och kulrang piksellar hisobga olinmaydi,
 * ranglar guruhlanadi, to'yingan (yorqin) ranglarga ustunlik beriladi.
 */
function dominantColors(pngBuffer) {
  const img = PNG.sync.read(pngBuffer);
  const buckets = new Map();
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    if (r > 225 && g > 225 && b > 225) continue;              // oq fon
    if (saturation(r, g, b) < 0.12 && r > 150) continue;       // och kulrang
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const list = [...buckets.values()]
    .map((e) => { const c = [e.r / e.n, e.g / e.n, e.b / e.n]; return { c, score: e.n * (0.35 + saturation(...c)) }; })
    .sort((a, b) => b.score - a.score);
  if (!list.length) return null;
  const primary = list[0].c;
  const far = (c) => Math.abs(c[0] - primary[0]) + Math.abs(c[1] - primary[1]) + Math.abs(c[2] - primary[2]) > 120;
  const second = list.find((x) => far(x.c));
  return { primary: hex(...primary), secondary: second ? hex(...second.c) : null };
}

/** Klub ranglari (bazadan yoki logotipdan bir marta aniqlanadi) */
async function teamColors(teamId, logoUrl) {
  const row = await db.one('SELECT * FROM team_colors WHERE team_id = $1', [teamId]);
  if (row) return row;
  if (!logoUrl) return null;
  try {
    const res = await fetchImpl(logoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const colors = dominantColors(buf);
    if (!colors) return null;
    return db.one(
      `INSERT INTO team_colors (team_id, primary_color, secondary_color, logo_png) VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id) DO UPDATE SET primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color,
         logo_png = EXCLUDED.logo_png, updated_at = now() RETURNING *`,
      [teamId, colors.primary, colors.secondary, buf.toString('base64')],
    );
  } catch (e) {
    console.warn('[fancard] logotip ranglari:', e.message);
    return null;
  }
}

// ---------- Karta ma'lumotlari
function currentYear() { return parts(new Date()).year; }

function regionName(lang, code) { return code ? t(lang, `region_${code}`) : null; }

function regionsList(lang) { return REGIONS.map((code) => ({ code, name: regionName(lang, code) })); }

async function getCard(user, lang = user.language || 'uz') {
  const u = await users.byId(user.id);
  const premium = users.isPremium(u);
  const stats = await db.one(
    `SELECT (SELECT count(*)::int FROM users WHERE NOT is_blocked) AS total,
            (SELECT count(*)::int FROM users WHERE fav_team_id = $1 AND NOT is_blocked) AS same_team,
            (SELECT count(*)::int FROM users WHERE fan_region = $2 AND NOT is_blocked) AS same_region`,
    [u.fav_team_id, u.fan_region],
  );
  let style = { kind: 'standard', bg: DEFAULT.primary, accent: DEFAULT.secondary, text: '#f3f7f4' };
  if (premium && u.fav_team_id) {
    const c = await teamColors(u.fav_team_id, u.fav_team_logo);
    if (c) style = { kind: 'club', bg: c.primary_color, accent: c.secondary_color || textOn(c.primary_color), text: textOn(c.primary_color) };
    else style = { ...style, kind: 'club' };
  }
  const filled = [u.fav_team_id, u.fav_player, u.fan_region, u.fan_since].filter((v) => v !== null && v !== undefined && v !== '').length;
  return {
    number: u.id,
    name: [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : `#${u.id}`),
    registeredAt: u.registered_at,
    premium,
    team: u.fav_team_id ? { id: u.fav_team_id, name: u.fav_team_name, logo: premium ? u.fav_team_logo : null } : null,
    player: u.fav_player || null,
    region: u.fan_region ? { code: u.fan_region, name: regionName(lang, u.fan_region) } : null,
    since: u.fan_since || null,
    filled, fields: 4,
    style,
    stats: {
      total: stats.total,
      sameTeam: u.fav_team_id ? stats.same_team : null,
      sameRegion: u.fan_region ? stats.same_region : null,
    },
    regions: regionsList(lang),
    updatedAt: u.fan_card_updated_at,
  };
}

/** Kartani tahrirlash. Faqat yuborilgan maydonlar o'zgaradi; null — o'chirish. */
async function update(user, body = {}) {
  const sets = {};
  if ('teamId' in body) {
    if (body.teamId === null) Object.assign(sets, { fav_team_id: null, fav_team_name: null, fav_team_logo: null });
    else {
      const id = Number(body.teamId);
      if (!Number.isInteger(id) || id <= 0) throw new CardError('bad_team');
      const tm = await football.teamInfo(id);
      Object.assign(sets, { fav_team_id: tm.id, fav_team_name: tm.name, fav_team_logo: tm.logo });
      teamColors(tm.id, tm.logo).catch(() => {}); // ranglarni oldindan aniqlab qo'yamiz
    }
  }
  if ('player' in body) {
    const p = body.player === null ? '' : String(body.player).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
    if ([...p].length > PLAYER_MAX) throw new CardError('bad_player');
    sets.fav_player = p || null;
  }
  if ('region' in body) {
    if (body.region !== null && !REGIONS.includes(body.region)) throw new CardError('bad_region');
    sets.fan_region = body.region;
  }
  if ('since' in body) {
    const y = body.since === null ? null : Number(body.since);
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > currentYear())) throw new CardError('bad_since');
    sets.fan_since = y;
  }
  const keys = Object.keys(sets);
  if (keys.length) {
    await db.query(
      `UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, fan_card_updated_at = now() WHERE id = $1`,
      [user.id, ...keys.map((k) => sets[k])],
    );
  }
  return getCard(user);
}

// ---------- Stories uchun rasm (PNG, 1080×1920)
/** Telegram rasmni o'zi yuklab oladi — shuning uchun manzil imzolanadi (taxmin qilib bo'lmaydi) */
function signature(telegramId) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`card:${telegramId}`).digest('hex').slice(0, 20);
}
function imagePath(telegramId) { return `/card/${telegramId}-${signature(telegramId)}.png`; }
function verifyImagePath(file) {
  const m = /^(\d+)-([a-f0-9]{20})\.png$/.exec(file || '');
  if (!m) return null;
  const sig = signature(m[1]);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2])) ? Number(m[1]) : null;
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function clip(s, n) { const a = [...String(s || '')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); }

function cardSvg(card, lang, { botUsername, logoPng } = {}) {
  const L = (k, p) => t(lang, k, p);
  const s = card.style;
  const muted = s.text === '#0c1712' ? 'rgba(12,23,18,0.62)' : 'rgba(243,247,244,0.62)';
  const field = (x, y, label, value, max) => `
    <text x="${x}" y="${y}" font-size="26" font-weight="700" letter-spacing="2" fill="${muted}">${esc(L(label).toUpperCase())}</text>
    <text x="${x}" y="${y + 50}" font-size="40" font-weight="700" fill="${s.text}">${esc(clip(value || '—', max))}</text>`;
  const stat = (x, value, label) => `
    <rect x="${x}" y="1180" width="300" height="220" rx="32" fill="#16241d" stroke="#2a3f31" stroke-width="2"/>
    <text x="${x + 36}" y="1290" font-size="84" font-weight="800" fill="#f2c94c">${esc(value ?? '—')}</text>
    <text x="${x + 36}" y="1350" font-size="28" fill="#7d9284">${esc(clip(label, 18))}</text>`;
  const logo = logoPng ? `<image href="data:image/png;base64,${logoPng}" x="760" y="520" width="140" height="140" preserveAspectRatio="xMidYMid meet"/>` : '';
  const premiumMark = card.premium ? `<text x="920" y="1010" font-size="28" font-weight="800" letter-spacing="3" text-anchor="end" fill="${s.text}">PREMIUM</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" font-family="Inter, DejaVu Sans, sans-serif">
  <rect width="1080" height="1920" fill="#0c1712"/>
  <text x="80" y="200" font-size="40" font-weight="800" letter-spacing="6" fill="#2ecc71">FOOTBALLCENTER</text>
  <text x="80" y="290" font-size="64" font-weight="800" fill="#f3f7f4">${esc(L('card_title').toUpperCase())}</text>
  <defs><clipPath id="card"><rect x="80" y="420" width="920" height="640" rx="48"/></clipPath></defs>
  <g clip-path="url(#card)">
    <rect x="80" y="420" width="920" height="640" fill="${s.bg}"/>
    <rect x="80" y="420" width="920" height="16" fill="${s.accent}"/>
  </g>
  <text x="160" y="560" font-size="34" font-weight="800" letter-spacing="4" fill="${s.text}">${esc(card.team ? clip(card.team.name, 22).toUpperCase() : 'FOOTBALLCENTER')}</text>
  <text x="${logo ? 720 : 920}" y="560" font-size="40" font-weight="800" text-anchor="end" fill="${s.text}">№ ${String(card.number).padStart(4, '0')}</text>
  ${logo}
  <text x="160" y="740" font-size="104" font-weight="800" fill="${s.text}">${esc(clip(card.name, 14).toUpperCase())}</text>
  ${field(160, 820, 'card_since', card.since ? L('card_since_value', { year: card.since }) : null, 14)}
  ${field(560, 820, 'card_player', card.player, 16)}
  ${field(160, 930, 'card_region', card.region ? card.region.name : null, 28)}
  ${premiumMark}
  ${stat(80, card.stats.sameTeam, card.team ? L('card_stat_club', { club: clip(card.team.name, 10) }) : L('card_club'))}
  ${stat(390, card.stats.sameRegion, L('card_stat_region'))}
  ${stat(700, card.stats.total, L('card_stat_total'))}
  <text x="80" y="1640" font-size="40" font-weight="700" fill="#f3f7f4">${esc(L('card_join'))}:</text>
  <text x="80" y="1710" font-size="48" font-weight="800" fill="#2ecc71">${esc(botUsername ? `@${botUsername}` : 'FootballCenter')}</text>
</svg>`;
}

async function renderPng(telegramId) {
  const user = await users.byTelegramId(telegramId);
  if (!user) return null;
  const lang = user.language || 'uz';
  const card = await getCard(user, lang);
  let logoPng = null;
  if (card.premium && card.team) {
    const c = await db.one('SELECT logo_png FROM team_colors WHERE team_id = $1', [card.team.id]);
    logoPng = c ? c.logo_png : null;
  }
  const { Resvg } = require('@resvg/resvg-js');
  const svg = cardSvg(card, LOCALES[lang] ? lang : 'uz', { botUsername: config.botUsername, logoPng });
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

module.exports = {
  REGIONS, CardError, setFetch, dominantColors, textOn, teamColors, getCard, update, regionsList,
  imagePath, verifyImagePath, cardSvg, renderPng,
};

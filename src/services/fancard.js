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

function shade(hexColor, k) {
  const ch = rgb(hexColor).map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return hex(...ch);
}

/**
 * Stories rasmi (1080×1920): Mini App'dagi karta bilan bir xil dizayn —
 * stadion chiptasi (yon kesiklar, perforatsiya), maydon chiziqlari, Oswald shrifti.
 */
function cardSvg(card, lang, { botUsername, logoPng } = {}) {
  const L = (k, p) => t(lang, k, p);
  const s = card.style;
  const bg = s.bg === DEFAULT.primary ? '#12301f' : s.bg;
  const dark = s.text !== '#0c1712';
  const stripe = shade(bg, dark ? 0.05 : -0.05);
  const muted = dark ? 'rgba(243,247,244,0.62)' : 'rgba(12,23,18,0.62)';
  const lineOpacity = 0.22;
  // Karta geometriyasi
  const X = 60; const Y = 400; const W = 960; const H = 607; const MAIN = Math.round(H * 0.74);
  const k = W / 316;                     // Mini App'dagi maydon chizmasi (316×148) masshtabi
  const py = (v) => Y + (v / 148) * MAIN;
  const stripes = Array.from({ length: 8 }, (_, i) => `<rect x="${X + (i * W) / 8}" y="${Y}" width="${W / 8 + 1}" height="${H}" fill="${i % 2 ? stripe : bg}"/>`).join('');
  const D = 'font-family="Oswald, DejaVu Sans" font-weight="700"';
  const field = (x, label, value, max) => `
    <text x="${x}" y="${Y + MAIN + 62}" font-size="24" font-weight="800" letter-spacing="4" fill="${muted}">${esc(L(label).toUpperCase())}</text>
    <text x="${x}" y="${Y + MAIN + 118}" ${D} font-size="44" fill="${s.text}">${esc(clip(value || '—', max))}</text>`;
  const stat = (x, value, label) => `
    <rect x="${x}" y="1110" width="300" height="240" rx="32" fill="#16241d" stroke="#2a3f31" stroke-width="2"/>
    <text x="${x + 150}" y="1245" ${D} font-size="110" text-anchor="middle" fill="#f2c94c">${esc(value ?? '—')}</text>
    <text x="${x + 150}" y="1305" font-size="28" text-anchor="middle" fill="#7d9284">${esc(clip(label, 17))}</text>`;
  const name = clip(card.name, 16).toUpperCase();
  const nameSize = [...name].length > 10 ? 120 : 150;
  const watermark = logoPng ? `<image href="data:image/png;base64,${logoPng}" x="${X + W * 0.56}" y="${Y + 40}" width="440" height="440" opacity="0.14" preserveAspectRatio="xMidYMid meet"/>` : '';
  const clubIcon = logoPng ? `<image href="data:image/png;base64,${logoPng}" x="${X + 54}" y="${Y + MAIN - 92}" width="52" height="52" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${X + 54}" y="${Y + MAIN - 52}" font-size="40" fill="${s.text}">♥</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" font-family="Inter, DejaVu Sans, sans-serif">
  <rect width="1080" height="1920" fill="#0c1712"/>
  <text x="60" y="190" font-size="30" font-weight="800" letter-spacing="7" fill="#2ecc71">${esc(`FOOTBALLCENTER · ${L('card_title')}`.toUpperCase())}</text>
  <text x="60" y="320" ${D} font-size="118" fill="#f3f7f4">${esc(L('card_headline').toUpperCase())}</text>
  <defs>
    <mask id="ticket">
      <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="56" fill="#fff"/>
      <circle cx="${X}" cy="${Y + MAIN}" r="34" fill="#000"/>
      <circle cx="${X + W}" cy="${Y + MAIN}" r="34" fill="#000"/>
    </mask>
    <clipPath id="field"><rect x="${X}" y="${Y}" width="${W}" height="${MAIN}"/></clipPath>
  </defs>
  <g mask="url(#ticket)">
    ${stripes}
    <g clip-path="url(#field)" fill="none" stroke="${s.text}" stroke-opacity="${lineOpacity}" stroke-width="4">
      <line x1="${X + 196 * k}" y1="${Y}" x2="${X + 196 * k}" y2="${Y + MAIN}"/>
      <circle cx="${X + 196 * k}" cy="${py(80)}" r="${44 * k}"/>
      <rect x="${X + 272 * k}" y="${py(30)}" width="${60 * k}" height="${py(130) - py(30)}"/>
      <path d="M${X + 272 * k} ${py(56)} A ${26 * k} ${26 * k} 0 0 0 ${X + 272 * k} ${py(104)}"/>
    </g>
    <circle cx="${X + 196 * k}" cy="${py(80)}" r="8" fill="${s.text}" fill-opacity="${lineOpacity}"/>
    ${watermark}
    <line x1="${X + 50}" y1="${Y + MAIN}" x2="${X + W - 50}" y2="${Y + MAIN}" stroke="${s.text}" stroke-opacity="0.35" stroke-width="5" stroke-dasharray="18 14"/>
  </g>
  <text x="${X + 54}" y="${Y + 82}" font-size="30" font-weight="800" letter-spacing="6" fill="${s.text}">FOOTBALLCENTER</text>
  <text x="${X + W - 54}" y="${Y + 76}" font-size="24" font-weight="800" letter-spacing="6" text-anchor="end" fill="${muted}">FAN PASS</text>
  <text x="${X + W - 54}" y="${Y + 150}" ${D} font-size="68" letter-spacing="2" text-anchor="end" fill="${s.text}">№ ${String(card.number).padStart(4, '0')}</text>
  ${card.premium ? `<rect x="${X + W - 254}" y="${Y + 172}" width="200" height="50" rx="12" fill="${s.accent}"/><text x="${X + W - 154}" y="${Y + 206}" font-size="24" font-weight="900" letter-spacing="6" text-anchor="middle" fill="${bg}">PREMIUM</text>` : ''}
  <text x="${X + 54}" y="${Y + MAIN - 118}" ${D} font-size="${nameSize}" fill="${s.text}">${esc(name)}</text>
  ${card.team ? `${clubIcon}<text x="${X + 124}" y="${Y + MAIN - 52}" font-size="34" font-weight="800" letter-spacing="4" fill="${s.text}">${esc(clip(card.team.name, 26).toUpperCase())}</text>` : ''}
  ${field(X + 54, 'card_since', card.since ? L('card_since_value', { year: card.since }) : null, 12)}
  ${field(X + 330, 'card_player', card.player, 12)}
  ${field(X + 590, 'card_region', card.region ? card.region.name : null, 16)}
  ${stat(60, card.stats.sameTeam, card.team ? L('card_stat_club', { club: clip(card.team.name, 9) }) : L('card_club'))}
  ${stat(390, card.stats.sameRegion, L('card_stat_region'))}
  ${stat(720, card.stats.total, L('card_stat_total'))}
  <text x="60" y="1530" font-size="40" font-weight="700" fill="#f3f7f4">${esc(L('card_join'))}</text>
  <text x="60" y="1630" ${D} font-size="84" fill="#2ecc71">${esc(botUsername ? `@${botUsername}` : 'FootballCenter')}</text>
</svg>`;
}

const FONT_FILES = [require('path').join(__dirname, '..', '..', 'public', 'app', 'fonts', 'Oswald-Bold.ttf')];

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
  return new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

module.exports = {
  REGIONS, CardError, setFetch, dominantColors, textOn, teamColors, getCard, update, regionsList,
  imagePath, verifyImagePath, cardSvg, renderPng, FONT_FILES,
};

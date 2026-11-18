// 📤 Natija kartasi — Telegram Stories uchun rasm (1080×1920): umumiy points, har bir o'yindagi haftalik natija,
// yutuqlar va referral havola (shtrix-kod bilan). Rasm serverda chiziladi (@resvg/resvg-js), xotira keshi bilan.
const crypto = require('crypto');
const config = require('../config');
const users = require('./users');
const leaderboard = require('./leaderboard');
const achievements = require('./achievements');
const barcode = require('./barcode');
const fancard = require('./fancard');
const { LOCALES } = require('../i18n');

const { esc, up, fit, num, toPng, plainT, cached, D, I } = fancard.draw;
const DESIGN = 1;
const GAMES = [['manager', 'Mini Manager'], ['quiz', 'Football Quiz'], ['score', null]];

function signature(telegramId) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`share:${telegramId}`).digest('hex').slice(0, 20);
}
function imagePath(telegramId) { return `/share/${telegramId}-${signature(telegramId)}.png`; }
function verifyImagePath(file) {
  const m = /^(\d+)-([a-f0-9]{20})\.png$/.exec(file || '');
  if (!m) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature(m[1])), Buffer.from(m[2]))) return null;
  return Number(m[1]);
}

function refLink(u) {
  if (!config.botUsername) return null;
  return u.ref_code ? `https://t.me/${config.botUsername}?start=ref_${u.ref_code}` : `https://t.me/${config.botUsername}`;
}

async function viewModel(u) {
  const lang = LOCALES[u.language] ? u.language : 'uz';
  const [boards, ach] = await Promise.all([
    Promise.all(GAMES.map(([kind]) => leaderboard.board(kind, 'weekly', u.id, 0))),
    achievements.forUser(u.id, lang),
  ]);
  const games = GAMES.map(([kind, name], i) => ({ kind, name, me: boards[i].me }));
  const v = {
    lang, name: users.displayName(u), points: users.totalPoints(u), games, ach, link: refLink(u),
  };
  v.key = [DESIGN, lang, v.name, v.points, ach.earned, ...games.map((g) => (g.me ? `${g.me.points}/${g.me.place}` : '-')), v.link].join(':');
  return v;
}

function svg(v) {
  const L = plainT(v.lang);
  const title = up(L('share_title'));
  const name = up(v.name);
  const rows = v.games.map((g, i) => {
    const y = 900 + i * 140;
    const label = up(g.name || L('share_score'));
    const pts = g.me ? num(g.me.points) : '0';
    const sub = `${L('share_week')} · ${g.me && g.me.place ? L('share_place', { place: g.me.place }) : '—'}`;
    return `<rect x="60" y="${y}" width="960" height="120" rx="28" fill="#16241d" stroke="#2a3f31" stroke-width="2"/>
<text x="100" y="${y + 74}" ${D} font-size="${fit(label, 46, 520)}" fill="#f3f7f4">${esc(label)}</text>
<text x="980" y="${y + 62}" ${D} font-size="50" text-anchor="end" fill="#f2c94c">${esc(pts)}</text>
<text x="980" y="${y + 96}" ${I} font-size="22" text-anchor="end" fill="#7d9284">${esc(sub)}</text>`;
  }).join('\n');
  const n = v.ach.total;
  const step = Math.min(70, 900 / n);
  const x0 = 540 - ((n - 1) * step) / 2;
  const dots = v.ach.list.map((a, i) => (a.earnedAt
    ? `<circle cx="${x0 + i * step}" cy="1420" r="24" fill="#f2c94c"/><circle cx="${x0 + i * step}" cy="1420" r="12" fill="#c9a227"/>`
    : `<circle cx="${x0 + i * step}" cy="1420" r="22" fill="none" stroke="#2a3f31" stroke-width="4"/>`)).join('');
  const achTitle = `${up(L('share_achievements'))}  ${v.ach.earned} / ${v.ach.total}`;
  const linkText = v.link ? v.link.replace(/^https:\/\//, '') : 'FootballCenter';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123122"/><stop offset="1" stop-color="#0c1712"/></linearGradient></defs>
<rect width="1080" height="1920" fill="url(#bg)"/>
<rect width="1080" height="14" fill="#2ecc71"/><rect y="14" width="1080" height="6" fill="#f2c94c"/>
<text x="540" y="150" ${I} font-size="26" letter-spacing="8" text-anchor="middle" fill="#f2c94c">FOOTBALLCENTER</text>
<text x="540" y="260" ${D} font-size="${fit(title, 92, 960)}" text-anchor="middle" fill="#ffffff">${esc(title)}</text>
<text x="540" y="350" ${D} font-size="${fit(name, 60, 900)}" text-anchor="middle" fill="#2ecc71">${esc(name)}</text>
<circle cx="540" cy="610" r="200" fill="#16241d" stroke="#f2c94c" stroke-width="10"/>
<text x="540" y="645" ${D} font-size="${fit(num(v.points), 140, 330, 0.55)}" text-anchor="middle" fill="#f2c94c">${esc(num(v.points))}</text>
<text x="540" y="705" ${I} font-size="28" letter-spacing="3" text-anchor="middle" fill="#7d9284">${esc(up(L('share_points')))}</text>
${rows}
<text x="540" y="1360" ${D} font-size="40" text-anchor="middle" fill="#f3f7f4">${esc(achTitle)}</text>
${dots}
<rect x="60" y="1500" width="960" height="340" rx="32" fill="#ffffff"/>
<text x="540" y="1568" ${D} font-size="${fit(L('share_join'), 40, 880)}" text-anchor="middle" fill="#0c1712">${esc(L('share_join'))}</text>
${barcode.svgBars(v.link || 'https://t.me', 140, 1600, 800, 150, '#0c1712')}
<text x="540" y="1800" ${I} font-size="${fit(linkText, 28, 900, 0.6, 16)}" text-anchor="middle" fill="#0c1712">${esc(linkText)}</text>
</svg>`;
}

/** Ulashish ma'lumoti: rasm manzili (versiyali) va matn uchun havola */
async function info(user) {
  const u = await users.byId(user.id);
  const v = await viewModel(u);
  const ver = crypto.createHash('sha1').update(v.key).digest('hex').slice(0, 10);
  const path = `${imagePath(u.telegram_id)}?v=${ver}`;
  return { path, url: config.publicUrl ? `${config.publicUrl}${path}` : null, refLink: v.link };
}

async function renderPng(telegramId) {
  const u = await users.byTelegramId(telegramId);
  if (!u) return null;
  const v = await viewModel(u);
  return cached(`share:${u.id}:${v.key}`, () => toPng(svg(v)));
}

module.exports = { imagePath, verifyImagePath, info, renderPng, svg };

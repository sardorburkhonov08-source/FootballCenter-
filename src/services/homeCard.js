// 🏁 Boshlang'ich ekran rasmi (egasi talabi): Web sahifa haqida to'liq ma'lumot (6 ta imkoniyat) va
// asosiy menyu haqida qisqacha. 1200×1260 PNG, foydalanuvchi tilida; tilga bog'liq, shaxsiy emas — xotira keshi.
// Rasm chizuvchida emoji shrifti yo'q, shuning uchun belgilar SVG chiziqlar bilan chiziladi.
const fancard = require('./fancard');
const config = require('../config');
const { LOCALES } = require('../i18n');

const { esc, up, fit, toPng, plainT, cached, D, I } = fancard.draw;
const DESIGN = 2;
const I5 = 'font-family="Inter, DejaVu Sans" font-weight="500"';
const I6 = 'font-family="Inter, DejaVu Sans" font-weight="600"';
const W = 1200;
const H = 1300;

// 24×24 o'lchamdagi chiziqli belgilar (Mini App pastki menyusidagi uslubda)
const ICONS = {
  live: '<circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  games: '<path d="M6 8h12a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14.5 14h-5l-1.2 1.6A3.5 3.5 0 0 1 2 13.5V12a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".9" fill="#fff"/><circle cx="18" cy="13.5" r=".9" fill="#fff"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M6 15.5c.6-1.2 1.5-1.8 2.5-1.8s1.9.6 2.5 1.8M13.5 10h4.5M13.5 13h3"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
};
const FEATURES = [
  { key: 'live', icon: 'live', grad: ['#ff6b6b', '#c0392b'] },
  { key: 'games', icon: 'games', grad: ['#3df27a', '#178a49'] },
  { key: 'prize', icon: 'trophy', grad: ['#f7d774', '#d9a520'] },
  { key: 'fav', icon: 'star', grad: ['#c084fc', '#7c3aed'] },
  { key: 'card', icon: 'card', grad: ['#5eead4', '#0f766e'] },
  { key: 'friends', icon: 'people', grad: ['#ff8a5b', '#e5534b'] },
];

/** So'zlar bo'yicha qatorlarga bo'lish (taxminiy kenglik: belgilar soni) */
function wrap(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length > maxChars && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, '')}…`;
    return kept;
  }
  return lines;
}

function logoMark(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
<path d="M14 18h7M9 26h8M6 34h7" stroke="#7CFC00" stroke-width="3.2" stroke-linecap="round"/>
<path d="M24 52 32 12h26l-3 9H40l-2 8h14l-3 9H36l-3 14z" fill="#ffffff"/>
<circle cx="49" cy="47" r="9" fill="#fff"/><path d="M49 42l4 3-1.5 4.6h-5L45 45z" fill="#0c1712"/>
<path d="M49 38v4M57.5 44.5 53 45M54 55l-2.5-5.4M44 55l2.5-5.4M40.5 44.5 45 45" stroke="#0c1712" stroke-width="1.4"/></g>`;
}

function featureCard(L, f, i, x, y, w, h) {
  const id = `fg${i}`;
  const title = L(`hc_${f.key}_t`);
  const lines = wrap(L(`hc_${f.key}_d`), 30, 3);
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${f.grad[0]}"/><stop offset="1" stop-color="${f.grad[1]}"/></linearGradient></defs>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
<rect x="${x + 24}" y="${y + 26}" width="76" height="76" rx="22" fill="url(#${id})"/>
<g transform="translate(${x + 38} ${y + 40}) scale(2)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[f.icon]}</g>
<text x="${x + 120}" y="${y + 74}" ${D} font-size="${fit(up(title), 38, w - 140)}" fill="#ffffff">${esc(up(title))}</text>
${lines.map((ln, k) => `<text x="${x + 26}" y="${y + 140 + k * 33}" ${I5} font-size="25" fill="#c9dccf">${esc(ln)}</text>`).join('\n')}`;
}

function svg(lang) {
  const L = plainT(lang);
  const cardW = 534;
  const cardH = 222;
  const gx = 48;
  const gap = 36;
  const top = 322;
  const cards = FEATURES.map((f, i) => featureCard(L, f, i, gx + (i % 2) * (cardW + gap - 4), top + Math.floor(i / 2) * (cardH + 20), cardW, cardH)).join('\n');
  const menuY = top + 3 * (cardH + 20) + 6;
  const menuLines = wrap(L('hc_menu_d'), 62, 2);
  const bot = config.botUsername ? `@${config.botUsername}` : 'FootballCenter';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14532d"/><stop offset=".45" stop-color="#0b2216"/><stop offset="1" stop-color="#06110b"/></linearGradient>
  <radialGradient id="glow" cx="1" cy="0" r=".9"><stop offset="0" stop-color="#3df27a" stop-opacity=".35"/><stop offset="1" stop-color="#3df27a" stop-opacity="0"/></radialGradient>
  <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#62ff8f"/><stop offset="1" stop-color="#a5ff3d"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<circle cx="${W - 90}" cy="120" r="230" fill="none" stroke="#3df27a" stroke-opacity=".12" stroke-width="40"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="44" fill="none" stroke="#3df27a" stroke-opacity=".55" stroke-width="3"/>
${logoMark(48, 52, 1.9)}
<text x="188" y="94" ${I} font-size="24" letter-spacing="8" fill="#a5ff3d">FOOTBALLCENTER</text>
<text x="184" y="190" ${D} font-size="${fit(up(L('hc_title')), 78, 900)}" fill="#ffffff">${esc(up(L('hc_title')))}</text>
<text x="50" y="262" ${I6} font-size="${fit(L('hc_sub'), 30, 1100, 0.5)}" fill="#e6f4ea">${esc(L('hc_sub'))}</text>
<rect x="50" y="286" width="150" height="6" rx="3" fill="url(#neon)"/>
${cards}
<rect x="48" y="${menuY}" width="${W - 96}" height="140" rx="26" fill="#000" fill-opacity=".28" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/>
<text x="80" y="${menuY + 56}" ${D} font-size="34" fill="#a5ff3d">${esc(up(L('hc_menu_t')))}</text>
${menuLines.map((ln, k) => `<text x="80" y="${menuY + 98 + k * 32}" ${I5} font-size="25" fill="#c9dccf">${esc(ln)}</text>`).join('\n')}
<text x="${W / 2}" y="${H - 44}" ${I} font-size="26" text-anchor="middle" fill="#ffffff" fill-opacity=".75">${esc(`${L('hc_cta')} · ${bot}`)}</text>
</svg>`;
}

/** PNG (tilga qarab keshlangan) */
function renderPng(lang) {
  const l = LOCALES[lang] ? lang : 'uz';
  return cached(`home:${DESIGN}:${l}:${config.botUsername || ''}`, () => toPng(svg(l)));
}

module.exports = { svg, renderPng, wrap };

// 🖼 Botdagi rasmli bosh menyu (egasi talabi bilan): /start va "🏠 Menyu" — shaxsiy karta-rasm (1200×630):
// salom (Toshkent vaqtiga qarab), daraja va progress, umumiy points, haftalik o'rin, ketma-ket kunlar, kunlik vazifalar, tarif.
// Rasm serverda chiziladi (@resvg/resvg-js, muxlislik kartasi bilan umumiy yordamchilar), xotira keshi bilan.
const users = require('./users');
const levels = require('./levels');
const leaderboard = require('./leaderboard');
const fancard = require('./fancard');
const { parts, formatDate } = require('./time');
const { LOCALES } = require('../i18n');

const { esc, up, fit, num, toPng, plainT, cached, D, I } = fancard.draw;
const DESIGN = 1;

function greetKey(now = new Date()) {
  const h = parts(now).hour;
  return h < 5 ? 'mc_night' : h < 12 ? 'mc_morning' : h < 18 ? 'mc_day' : h < 23 ? 'mc_evening' : 'mc_night';
}

async function viewModel(u, now = new Date()) {
  const lang = LOCALES[u.language] ? u.language : 'uz';
  const premium = users.isPremium(u);
  const [lv, week, q] = await Promise.all([
    levels.forUser(u, lang),
    leaderboard.board('overall', 'weekly', u.id, 0),
    premium ? require('./quests').today(u, now).catch(() => null) : null,
  ]);
  const v = {
    lang, greet: greetKey(now), name: u.first_name || users.displayName(u), level: lv, points: users.totalPoints(u),
    place: week.me ? week.me.place : null, quests: q ? { done: q.done, total: q.total, claimed: q.claimed } : null,
    streak: q ? q.streak : 0, premium, until: premium ? formatDate(u.premium_expires_at) : null,
  };
  v.key = [DESIGN, lang, v.greet, v.name, lv.level, lv.xp, v.place, v.quests && `${v.quests.done}/${v.quests.total}/${v.quests.claimed}`, v.streak, v.until].join(':');
  return v;
}

function svg(v) {
  const L = plainT(v.lang);
  const greet = up(L(v.greet, { name: v.name }));
  const lv = v.level;
  const pct = lv.next ? Math.max(0.03, Math.min(1, (lv.xp - lv.from) / (lv.next - lv.from))) : 1;
  const stat = (x, label, value, color = '#ffffff') => `<text x="${x}" y="402" ${I} font-size="20" letter-spacing="2" fill="#a7c4b1">${esc(up(label))}</text>
<text x="${x}" y="462" ${D} font-size="${fit(value, 56, 300)}" fill="${color}">${esc(value)}</text>`;
  const q = v.quests;
  const dots = q ? Array.from({ length: q.total }, (_, i) => (i < q.done
    ? `<circle cx="${520 + i * 44}" cy="548" r="15" fill="#f2c94c"/>`
    : `<circle cx="${520 + i * 44}" cy="548" r="14" fill="none" stroke="#5f7d69" stroke-width="4"/>`)).join('') : '';
  const qText = q ? (q.claimed ? L('mc_quests_done') : L('mc_quests', { done: q.done, total: q.total })) : L('mc_quests_locked');
  const tariff = v.premium ? L('mc_premium', { date: v.until }) : L('mc_free');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b5e3a"/><stop offset=".55" stop-color="#0f2f20"/><stop offset="1" stop-color="#0c1712"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7d774"/><stop offset="1" stop-color="#d9a520"/></linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<circle cx="1080" cy="90" r="230" fill="#2ecc71" opacity=".08"/><circle cx="1080" cy="90" r="150" fill="#2ecc71" opacity=".08"/>
<rect width="1200" height="10" fill="#2ecc71"/><rect y="10" width="1200" height="5" fill="#f2c94c"/>
<text x="70" y="92" ${I} font-size="24" letter-spacing="7" fill="#f2c94c">FOOTBALLCENTER</text>
<text x="70" y="180" ${D} font-size="${fit(greet, 76, 1060)}" fill="#ffffff">${esc(greet)}</text>
<rect x="70" y="214" width="${44 + [...`LV ${lv.level} · ${up(lv.name)}`].length * 16}" height="48" rx="24" fill="#000000" opacity=".28"/>
<text x="92" y="247" ${D} font-size="28" fill="#f2c94c">${esc(`LV ${lv.level} · ${up(lv.name)}`)}</text>
<rect x="70" y="290" width="1060" height="16" rx="8" fill="#000000" opacity=".3"/>
<rect x="70" y="290" width="${Math.round(1060 * pct)}" height="16" rx="8" fill="url(#gold)"/>
<text x="1130" y="340" ${I} font-size="20" text-anchor="end" fill="#a7c4b1">${esc(lv.next ? L('mc_next', { left: num(lv.next - lv.xp), n: lv.level + 1 }) : L('mc_max'))}</text>
${stat(70, L('mc_points'), num(v.points), '#f2c94c')}
${stat(420, L('mc_place'), v.place ? `#${v.place}` : '—')}
${stat(770, L('mc_streak'), L('mc_days', { n: v.streak }))}
<rect x="0" y="500" width="1200" height="130" fill="#000000" opacity=".22"/>
<text x="70" y="560" ${D} font-size="${fit(qText, 34, 410)}" fill="#ffffff">${esc(up(qText))}</text>
${dots}
<text x="1130" y="560" ${I} font-size="${fit(tariff, 24, 300, 0.56)}" text-anchor="end" fill="${v.premium ? '#f2c94c' : '#a7c4b1'}">${esc(tariff)}</text>
</svg>`;
}

async function renderPng(user, now = new Date()) {
  const u = await users.byId(user.id);
  const v = await viewModel(u, now);
  return cached(`menu:${u.id}:${v.key}`, () => toPng(svg(v)));
}

module.exports = { renderPng, svg, viewModel };

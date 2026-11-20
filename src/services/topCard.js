// 🏆 Botdagi reyting rasmi (egasi talabi bilan): umumiy reyting TOP-3 shohsupada, Telegram profil rasmlari bilan (1200×630).
// Profil rasmi Bot API orqali olinadi (getUserProfilePhotos → getFile), xotirada keshlanadi; rasm bo'lmasa — bosh harf.
const config = require('../config');
const leaderboard = require('./leaderboard');
const fancard = require('./fancard');
const { LOCALES } = require('../i18n');

const { esc, up, fit, num, toPng, plainT, cached, D, I } = fancard.draw;
const PERIODS = ['daily', 'weekly', 'monthly'];
const AVATAR_TTL_MS = 12 * 3600 * 1000;
const AVATAR_FAIL_TTL_MS = 3600 * 1000;
const AVATAR_TIMEOUT_MS = 3000;

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

const avatars = new Map();   // tgId -> { at, ok, data }

async function withTimeout(p, ms) {
  let timer;
  try { return await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); })]); } finally { clearTimeout(timer); }
}

/** Telegram profil rasmi → data:image/jpeg;base64 yoki null */
async function avatar(tgId) {
  const hit = avatars.get(tgId);
  if (hit && Date.now() - hit.at < (hit.ok ? AVATAR_TTL_MS : AVATAR_FAIL_TTL_MS)) return hit.data;
  let data = null;
  try {
    const api = require('./notify').getApi();
    if (api && config.botToken) {
      const r = await withTimeout(api.getUserProfilePhotos(Number(tgId), { limit: 1 }), AVATAR_TIMEOUT_MS);
      const sizes = r && r.photos && r.photos[0];
      if (sizes && sizes.length) {
        const size = sizes.find((s) => s.width >= 160) || sizes[sizes.length - 1];
        const file = await withTimeout(api.getFile(size.file_id), AVATAR_TIMEOUT_MS);
        if (file && file.file_path) {
          const res = await withTimeout(fetchImpl(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`), AVATAR_TIMEOUT_MS);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 400000 && buf[0] === 0xff && buf[1] === 0xd8) data = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
        }
      }
    }
  } catch (e) { /* rasm bo'lmasa — bosh harf */ }
  avatars.set(tgId, { at: Date.now(), ok: !!data, data });
  if (avatars.size > 500) avatars.delete(avatars.keys().next().value);
  return data;
}

async function viewModel(user, period = 'weekly') {
  const lang = LOCALES[user.language] ? user.language : 'uz';
  const p = PERIODS.includes(period) ? period : 'weekly';
  const b = await leaderboard.board('overall', p, user.id, 10);
  const rows = await leaderboard.ranking('overall', leaderboard.range(p));
  const top3 = await Promise.all(rows.slice(0, 3).map(async (r, i) => ({
    place: i + 1, name: b.top[i] ? b.top[i].name : '', points: r.points, photo: await avatar(r.telegram_id),
  })));
  const v = { lang, period: p, top: b.top, me: b.me, podium: top3 };
  v.key = [p, lang, top3.map((x) => `${x.name}:${x.points}:${x.photo ? x.photo.length : 0}`).join('|')].join(':');
  return v;
}

// Shohsupa: [o'rin, markaz x, blok tepasi, avatar radiusi, blok rangi]
const SLOTS = [
  { place: 2, x: 330, top: 450, r: 60, fill: '#c9d1d6' },
  { place: 1, x: 600, top: 395, r: 72, fill: '#f2c94c' },
  { place: 3, x: 870, top: 495, r: 56, fill: '#d79a62' },
];

function slotSvg(s, item) {
  const cy = s.top - s.r - 26;
  const w = 240;
  const clip = `av${s.place}`;
  const initial = item ? esc(up([...String(item.name || '?')][0] || '?')) : '';
  const face = !item ? `<circle cx="${s.x}" cy="${cy}" r="${s.r}" fill="#000000" opacity=".25"/>`
    : item.photo ? `<clipPath id="${clip}"><circle cx="${s.x}" cy="${cy}" r="${s.r}"/></clipPath>
<image href="${item.photo}" x="${s.x - s.r}" y="${cy - s.r}" width="${s.r * 2}" height="${s.r * 2}" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid slice"/>`
      : `<circle cx="${s.x}" cy="${cy}" r="${s.r}" fill="#1b5e3a"/><text x="${s.x}" y="${cy + s.r * 0.36}" ${D} font-size="${Math.round(s.r * 1.05)}" text-anchor="middle" fill="#ffffff">${initial}</text>`;
  const crown = s.place === 1 ? `<path d="M${s.x - 46} ${cy - s.r - 4} l-8 -44 l30 22 l24 -34 l24 34 l30 -22 l-8 44 z" fill="#f2c94c" stroke="#0c1712" stroke-width="3"/>` : '';
  const name = item ? item.name : '—';
  return `${face}
<circle cx="${s.x}" cy="${cy}" r="${s.r + 4}" fill="none" stroke="${s.fill}" stroke-width="7"/>
${crown}
<circle cx="${s.x + s.r * 0.72}" cy="${cy + s.r * 0.72}" r="22" fill="${s.fill}" stroke="#0c1712" stroke-width="4"/>
<text x="${s.x + s.r * 0.72}" y="${cy + s.r * 0.72 + 10}" ${D} font-size="28" text-anchor="middle" fill="#0c1712">${s.place}</text>
<rect x="${s.x - w / 2}" y="${s.top}" width="${w}" height="${640 - s.top}" rx="18" fill="${s.fill}" opacity=".95"/>
<rect x="${s.x - w / 2}" y="${s.top}" width="${w}" height="${640 - s.top}" rx="18" fill="url(#shine)"/>
<text x="${s.x}" y="${s.top + 46}" ${I} font-size="${fit(name, 28, w - 24, 0.6)}" text-anchor="middle" fill="#0c1712">${esc(name)}</text>
<text x="${s.x}" y="${s.top + 96}" ${D} font-size="${fit(item ? num(item.points) : '', 44, w - 30)}" text-anchor="middle" fill="#0c1712">${item ? esc(num(item.points)) : ''}</text>`;
}

function svg(v) {
  const L = plainT(v.lang);
  const title = up(L('tc_title'));
  const sub = up(L(`tc_${v.period}`));
  const body = SLOTS.map((s) => slotSvg(s, v.podium[s.place - 1])).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b5e3a"/><stop offset=".55" stop-color="#0f2f20"/><stop offset="1" stop-color="#0c1712"/></linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".4" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <radialGradient id="spot" cx=".5" cy="0" r=".7"><stop offset="0" stop-color="#f2c94c" stop-opacity=".22"/><stop offset="1" stop-color="#f2c94c" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect width="1200" height="630" fill="url(#spot)"/>
<rect width="1200" height="10" fill="#2ecc71"/><rect y="10" width="1200" height="5" fill="#f2c94c"/>
<text x="70" y="78" ${I} font-size="22" letter-spacing="7" fill="#f2c94c">FOOTBALLCENTER</text>
<text x="70" y="148" ${D} font-size="${fit(title, 64, 640)}" fill="#ffffff">${esc(title)}</text>
<rect x="${1130 - 36 - [...sub].length * 14}" y="96" width="${36 + [...sub].length * 14}" height="54" rx="27" fill="#000000" opacity=".3"/>
<text x="${1130 - 18}" y="133" ${D} font-size="28" text-anchor="end" fill="#f2c94c">${esc(sub)}</text>
${body}
</svg>`;
}

async function renderPng(user, period = 'weekly') {
  const v = await viewModel(user, period);
  return { png: await cached(`top:${v.key}`, () => toPng(svg(v))), view: v };
}

function clearAvatars() { avatars.clear(); }

module.exports = { PERIODS, renderPng, svg, viewModel, avatar, setFetch, clearAvatars };

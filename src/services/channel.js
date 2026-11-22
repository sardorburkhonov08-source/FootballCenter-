// 📣 Kanalga avtomatik post (SINOV, egasi talabi): har kuni ertalab kechagi natijalar rasmi va
// hafta/oy tugaganda g'olib kartasi. Kanal — settings.channel_post_id (@kanal yoki -100...), bot kanalda admin bo'lishi kerak.
// Yozuvlar — settings.channel_lang tilida (ch_* kalitlari).
const { InputFile } = require('grammy');
const db = require('../db/pool');
const config = require('../config');
const settings = require('./settings');
const football = require('./football');
const { t, LOCALES } = require('../i18n');
const { parts, ymd, formatDate } = require('./time');

const { esc, up, fit, num, toPng, plainT, D, I } = require('./fancard').draw;
const W = 1080;
const H = 1350;
const MAX_ROWS = 12;

async function target() {
  const s = await settings.getMany(['channel_post_id', 'channel_lang']);
  const id = String(s.channel_post_id || '').trim();
  return id ? { chatId: /^-?\d+$/.test(id) ? Number(id) : id, lang: LOCALES[s.channel_lang] ? s.channel_lang : 'uz' } : null;
}

function bgDefs() {
  return `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b5e3a"/><stop offset=".5" stop-color="#0f2f20"/><stop offset="1" stop-color="#08110d"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9a520"/><stop offset=".5" stop-color="#f7d774"/><stop offset="1" stop-color="#d9a520"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="${W - 60}" cy="80" r="260" fill="#2ecc71" opacity=".07"/>
<rect width="${W}" height="12" fill="#2ecc71"/><rect y="12" width="${W}" height="6" fill="#f2c94c"/>`;
}

function footer(L) {
  const bot = config.botUsername ? `@${config.botUsername}` : 'FootballCenter';
  return `<rect y="${H - 110}" width="${W}" height="110" fill="#000" opacity=".28"/>
<text x="60" y="${H - 48}" ${D} font-size="40" fill="#ffffff">${esc(bot)}</text>
<text x="${W - 60}" y="${H - 50}" ${I} font-size="24" text-anchor="end" fill="#a7c4b1">${esc(L('ch_footer'))}</text>`;
}

// ---------- ⚽ Kechagi natijalar
function resultsSvg(lang, dateLabel, matches) {
  const L = plainT(lang);
  let y = 280;
  let body = '';
  let comp = null;
  for (const m of matches) {
    const c = m.competition ? m.competition.name : '';
    // Pastki qismga sig'maydigan qatorlar chiqarilmaydi
    if (y + (c !== comp ? 54 : 0) + 74 > H - 120) break;
    if (c !== comp) {
      if (comp !== null) y += 18;   // ligalar orasida bo'sh joy
      comp = c;
      body += `<text x="60" y="${y + 20}" ${I} font-size="22" letter-spacing="2" fill="#f2c94c">${esc(up(c))}</text>`;
      y += 36;
    }
    const h = m.home ? m.home.name : '?';
    const a = m.away ? m.away.name : '?';
    body += `<rect x="40" y="${y}" width="${W - 80}" height="62" rx="16" fill="#ffffff" opacity=".07"/>
<text x="${W / 2 - 78}" y="${y + 42}" ${D} font-size="${fit(h, 32, 380)}" text-anchor="end" fill="#ffffff">${esc(up(h))}</text>
<rect x="${W / 2 - 62}" y="${y + 9}" width="124" height="44" rx="12" fill="url(#gold)"/>
<text x="${W / 2}" y="${y + 43}" ${D} font-size="34" text-anchor="middle" fill="#1a120a">${m.score.home ?? 0} : ${m.score.away ?? 0}</text>
<text x="${W / 2 + 78}" y="${y + 42}" ${D} font-size="${fit(a, 32, 380)}" fill="#ffffff">${esc(up(a))}</text>`;
    y += 74;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bgDefs()}
<text x="60" y="96" ${I} font-size="26" letter-spacing="9" fill="#f2c94c">FOOTBALLCENTER</text>
<text x="60" y="196" ${D} font-size="96" fill="#ffffff">${esc(up(L('ch_results_title')))}</text>
<text x="60" y="250" ${I} font-size="30" fill="#a7c4b1">${esc(dateLabel)}</text>
${body}
${footer(L)}
</svg>`;
}

/** Tugagan o'yinlar: asosiy ligalar tartibida, ko'pi bilan MAX_ROWS ta */
async function finishedMatches(day) {
  const featured = ((await settings.get('featured_leagues')) || []).map(Number);
  const rank = (m) => { const i = featured.indexOf(Number(m.competition && m.competition.id)); return i === -1 ? Infinity : i; };
  const list = (await football.matchesByDate(day)).filter((m) => m.state === 'finished');
  const top = list.filter((m) => rank(m) !== Infinity).sort((a, b) => rank(a) - rank(b) || a.utcDate.localeCompare(b.utcDate));
  return (top.length ? top : list).slice(0, MAX_ROWS);
}

/** ⏰ Fon vazifasi: soat channel_daily_hour dan keyin kechagi natijalar (kuniga bir marta) */
async function postDailyResults(api, now = new Date()) {
  const tg = await target();
  if (!api || !tg || !(await settings.get('channel_daily_enabled'))) return false;
  if (parts(now).hour < Number(await settings.get('channel_daily_hour'))) return false;
  const yesterday = ymd(new Date(now.getTime() - 86400000));
  const mark = await db.one("INSERT INTO daily_notify_log (kind, day) VALUES ('channel_results', $1) ON CONFLICT DO NOTHING RETURNING *", [ymd(now)]);
  if (!mark) return false;
  try {
    const matches = await finishedMatches(yesterday);
    if (!matches.length) return false;
    const label = formatDate(new Date(`${yesterday}T12:00:00+05:00`));
    const png = toPng(resultsSvg(tg.lang, label, matches));
    await api.sendPhoto(tg.chatId, new InputFile(png, 'results.png'), {
      caption: t(tg.lang, 'ch_results_caption', { date: label, bot: config.botUsername ? `@${config.botUsername}` : 'FootballCenter' }), parse_mode: 'HTML',
    });
    return true;
  } catch (e) {
    // Keyingi urinish uchun belgi olib tashlanadi; admin xabardor qilinadi
    await db.query("DELETE FROM daily_notify_log WHERE kind = 'channel_results' AND day = $1", [ymd(now)]);
    require('./alerts').reportLater('channel', e);
    return false;
  }
}

// ---------- 🏆 Haftaning / oyning g'olibi
function winnerSvg(lang, { period, name, points, prize, photo }) {
  const L = plainT(lang);
  const cx = W / 2;
  const cy = 560;
  const r = 170;
  const initial = esc(up([...String(name || '?')][0] || '?'));
  const face = photo
    ? `<clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image href="${photo}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1b5e3a"/><text x="${cx}" y="${cy + 62}" ${D} font-size="180" text-anchor="middle" fill="#ffffff">${initial}</text>`;
  const prizeText = prize ? up(prize) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bgDefs()}
<text x="${cx}" y="120" ${I} font-size="26" letter-spacing="9" text-anchor="middle" fill="#f2c94c">FOOTBALLCENTER</text>
<text x="${cx}" y="236" ${D} font-size="104" text-anchor="middle" fill="#ffffff">${esc(up(L(period === 'monthly' ? 'ch_winner_month' : 'ch_winner_week')))}</text>
<circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="none" stroke="url(#gold)" stroke-width="14"/>
${face}
<path d="M${cx - 96} ${cy - r - 18} l-16 -84 l56 40 l56 -64 l56 64 l56 -40 l-16 84 z" fill="url(#gold)" stroke="#0c1712" stroke-width="5"/>
<text x="${cx}" y="${cy + r + 120}" ${D} font-size="${fit(up(name), 84, 940)}" text-anchor="middle" fill="#ffffff">${esc(up(name))}</text>
<text x="${cx}" y="${cy + r + 190}" ${D} font-size="56" text-anchor="middle" fill="#f2c94c">${esc(`${num(points)} POINTS`)}</text>
${prizeText ? `<rect x="120" y="${cy + r + 230}" width="${W - 240}" height="84" rx="42" fill="url(#gold)"/>
<text x="${cx}" y="${cy + r + 286}" ${D} font-size="${fit(`${L('ch_prize')}: ${prizeText}`, 40, W - 300)}" text-anchor="middle" fill="#1a120a">${esc(`${up(L('ch_prize'))}: ${prizeText}`)}</text>` : ''}
${footer(L)}
</svg>`;
}

/** Hafta/oy g'olibi aniqlanganda (scheduler.finalizePeriods) — kanalga karta */
async function postWinner(api, winnerUser, points, period) {
  const tg = await target();
  if (!api || !tg || !winnerUser || !(await settings.get('channel_winner_enabled'))) return false;
  try {
    const users = require('./users');
    const prize = await db.one("SELECT text FROM prizes WHERE kind = 'overall' AND period = $1 AND is_active ORDER BY id DESC LIMIT 1", [period]);
    const prizeText = prize ? String(prize.text).split('\n')[0].slice(0, 60) : '';
    const name = users.displayName(winnerUser);
    const photo = await require('./topCard').avatar(winnerUser.telegram_id);
    const png = toPng(winnerSvg(tg.lang, { period, name, points, prize: prizeText, photo }));
    await api.sendPhoto(tg.chatId, new InputFile(png, 'winner.png'), {
      caption: t(tg.lang, period === 'monthly' ? 'ch_winner_caption_month' : 'ch_winner_caption_week', {
        name, points: num(points), prize: prizeText || '—', bot: config.botUsername ? `@${config.botUsername}` : 'FootballCenter',
      }),
      parse_mode: 'HTML',
    });
    return true;
  } catch (e) {
    require('./alerts').reportLater('channel', e);
    return false;
  }
}

module.exports = { target, resultsSvg, winnerSvg, finishedMatches, postDailyResults, postWinner };

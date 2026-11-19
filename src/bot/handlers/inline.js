// 🔎 Inline rejim: istalgan chatda "@bot" yozilsa — ⚔️ Quiz duelga chaqiruv, 🎮 botga taklif va bugungi o'yinlar hisobi.
// BotFather'da /setinline yoqilgan bo'lishi kerak. Qidiruv matni bo'lsa — jamoa/liga nomi bo'yicha filtr.
const { t } = require('../../i18n');
const users = require('../../services/users');
const settings = require('../../services/settings');
const football = require('../../services/football');
const { ymd, parts } = require('../../services/time');

const MAX_MATCHES = 20;
const FOOTBALL_WAIT_MS = 4000;

function pad(n) { return String(n).padStart(2, '0'); }

function matchLine(m) {
  const h = m.home ? m.home.name : '?';
  const a = m.away ? m.away.name : '?';
  if (m.state === 'live') return `🔴 ${m.minute ? `${m.minute}' ` : ''}${h} ${m.score.home ?? 0}–${m.score.away ?? 0} ${a}`;
  if (m.state === 'finished') return `✅ ${h} ${m.score.home ?? 0}–${m.score.away ?? 0} ${a}`;
  if (m.state === 'cancelled') return `⛔ ${h} — ${a}`;
  const p = parts(new Date(m.utcDate));
  return `🕒 ${pad(p.hour)}:${pad(p.minute)} ${h} — ${a}`;
}

/** Bugungi o'yinlar: jonli → asosiy ligalar → qolgani; qidiruv bo'yicha filtr */
async function todayMatches(query) {
  const all = await Promise.race([
    football.matchesByDate(ymd()),
    new Promise((resolve) => setTimeout(() => resolve([]), FOOTBALL_WAIT_MS)),
  ]).catch(() => []);
  const featured = (await settings.get('featured_leagues')) || [];
  const q = String(query || '').toLowerCase();
  const list = all.filter((m) => !q || [m.home && m.home.name, m.away && m.away.name, m.competition && m.competition.name]
    .some((x) => x && x.toLowerCase().includes(q)));
  const rank = (m) => (m.state === 'live' ? 0 : 2) + (m.competition && featured.includes(m.competition.id) ? 0 : 1);
  return list.map((m, i) => ({ m, i })).sort((x, y) => rank(x.m) - rank(y.m) || x.i - y.i).slice(0, MAX_MATCHES).map((x) => x.m);
}

function register(bot) {
  bot.on('inline_query', async (ctx) => {
    const lang = ctx.lang;
    const user = ctx.user;
    const query = ctx.inlineQuery.query.trim();
    const botName = ctx.me.username;
    const results = [];
    const name = users.displayName(user);
    // ⚔️ Quiz duelga chaqiruv (duel — Premium o'yin; chaqiruvchi Premium bo'lishi kerak)
    if (!query && users.isPremium(user)) {
      results.push({
        type: 'article', id: 'duel', title: t(lang, 'inl_duel_title'), description: t(lang, 'inl_duel_desc'),
        input_message_content: { message_text: t(lang, 'inl_duel_msg', { name }), parse_mode: 'HTML' },
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'inl_duel_btn'), url: `https://t.me/${botName}?start=dch_${user.id}` }]] },
      });
    }
    if (!query) {
      const invite = await require('./balance').inviteText(lang);
      results.push({
        type: 'article', id: 'invite', title: t(lang, 'inl_invite_title'), description: t(lang, 'inl_invite_desc'),
        input_message_content: { message_text: invite },
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'inl_invite_btn'), url: `https://t.me/${botName}?start=ref_${user.ref_code}` }]] },
      });
    }
    const matches = await todayMatches(query);
    for (const m of matches) {
      const line = matchLine(m);
      const comp = m.competition ? m.competition.name : '';
      results.push({
        type: 'article', id: `m${m.id}`, title: line, description: comp,
        thumbnail_url: (m.home && m.home.crest) || undefined,
        input_message_content: { message_text: `${line}${comp ? `\n🏆 ${comp}` : ''}` },
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'inl_open_bot'), url: `https://t.me/${botName}?start=ref_${user.ref_code}` }]] },
      });
    }
    if (!matches.length && query) {
      results.push({ type: 'article', id: 'none', title: t(lang, 'inl_no_matches'), input_message_content: { message_text: t(lang, 'inl_no_matches') } });
    }
    await ctx.answerInlineQuery(results, { cache_time: 30, is_personal: true });
  });
}

module.exports = { register, matchLine, todayMatches };

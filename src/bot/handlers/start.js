// /start, majburiy obuna, til tanlash, asosiy menyu
const { t, LANGS, LANG_PROMPT } = require('../../i18n');
const settings = require('../../services/settings');
const users = require('../../services/users');
const referral = require('../../services/referral');
const state = require('../state');
const ui = require('../ui');
const { formatDate } = require('../../services/time');

const MEMBER_STATUSES = ['creator', 'administrator', 'member'];

async function missingChannels(ctx) {
  if (!(await settings.get('force_sub_enabled')) || users.isAdmin(ctx.user)) return [];
  const channels = (await settings.get('force_sub_channels')) || [];
  const missing = [];
  for (const ch of channels) {
    try {
      const m = await ctx.api.getChatMember(ch.chat_id, ctx.from.id);
      const ok = MEMBER_STATUSES.includes(m.status) || (m.status === 'restricted' && m.is_member);
      if (!ok) missing.push(ch);
    } catch (e) {
      // Bot kanalda admin emas yoki kanal o'chirilgan — foydalanuvchini to'sib qo'ymaymiz
      console.warn(`[force-sub] ${ch.chat_id}: ${e.description || e.message}`);
    }
  }
  return missing;
}

async function showSubscribe(ctx, missing, notJoined = false) {
  const lang = ctx.lang;
  const rows = missing.map((ch) => [ui.urlBtn(t(lang, 'sub_channel_btn', { title: ch.title || ch.chat_id }), ch.url)]);
  rows.push([ui.btn(t(lang, 'confirm_btn'), 'sub:check')]);
  const text = notJoined ? `${t(lang, 'sub_not_joined')}\n\n${t(lang, 'sub_required')}` : t(lang, 'sub_required');
  await ui.show(ctx, text, ui.kb(rows));
}

/** Obunadan keyingi qadam: til tanlanmagan bo'lsa — til, aks holda menyu */
async function afterSubscription(ctx) {
  if (!ctx.user.language) {
    await ui.show(ctx, LANG_PROMPT, ui.langKb());
    return;
  }
  await ui.showMenu(ctx);
}

async function onStart(ctx) {
  await state.clear(ctx.from.id);
  const payload = (ctx.match || '').trim();
  if (ctx.userCreated && payload.startsWith('ref_')) {
    await referral.attach(ctx.user, payload.slice(4)).catch((e) => console.error('[referral]', e));
  }
  const missing = await missingChannels(ctx);
  if (missing.length) return showSubscribe(ctx, missing);
  // Mini App'dagi "💎 Premium sotib olish" tugmasi: t.me/<bot>?start=premium — Premium sahifasi darhol ochiladi
  if (payload === 'premium' && ctx.user.language) return require('./sections').showPremiumInfo(ctx);
  return afterSubscription(ctx);
}

function register(bot) {
  bot.command('start', onStart);

  bot.callbackQuery('sub:check', async (ctx) => {
    const missing = await missingChannels(ctx);
    if (missing.length) {
      await ctx.answerCallbackQuery();
      return showSubscribe(ctx, missing, true);
    }
    await ctx.answerCallbackQuery();
    return afterSubscription(ctx);
  });

  bot.callbackQuery(/^lang:(\w+)$/, async (ctx) => {
    const lang = ctx.match[1];
    if (!LANGS.includes(lang)) return ctx.answerCallbackQuery();
    const firstTime = !ctx.user.language;
    ctx.user = await users.setLanguage(ctx.from.id, lang);
    ctx.lang = lang;
    await ctx.answerCallbackQuery({ text: t(lang, 'lang_saved') });
    await ui.show(ctx, t(lang, 'lang_saved'), undefined);
    // 🎁 Birinchi marta til tanlaganda — sovg'a Premium haqida xabar
    if (firstTime && users.isPremium(ctx.user) && (await users.gotWelcomePremium(ctx.user.id))) {
      await ctx.reply(t(lang, 'welcome_premium', { days: await settings.get('welcome_premium_days'), date: formatDate(ctx.user.premium_expires_at) }), ui.HTML);
    }
    await ctx.reply(t(lang, 'menu_title', { name: ctx.from.first_name || '' }), { ...ui.HTML, reply_markup: ui.mainMenuKb(lang, ctx.user) });
  });

  bot.callbackQuery('m:menu', async (ctx) => {
    await state.clear(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ui.showMenu(ctx);
  });

  bot.callbackQuery('cancel', async (ctx) => {
    await state.clear(ctx.from.id);
    await ctx.answerCallbackQuery({ text: t(ctx.lang, 'cancelled') });
    await ui.showMenu(ctx);
  });

  bot.callbackQuery('m:webapp_missing', (ctx) => ctx.answerCallbackQuery({ text: t(ctx.lang, 'webapp_not_configured'), show_alert: true }));

  bot.command('menu', async (ctx) => {
    await state.clear(ctx.from.id);
    await ui.showMenu(ctx);
  });
}

module.exports = { register, missingChannels };

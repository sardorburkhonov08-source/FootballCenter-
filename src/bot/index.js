const { Bot } = require('grammy');
const { autoRetry } = require('@grammyjs/auto-retry');
const { createLimiter } = require('../services/ratelimit');
const config = require('../config');
const { t } = require('../i18n');
const settings = require('../services/settings');
const users = require('../services/users');
const state = require('./state');
const ui = require('./ui');

const modules = [
  require('./handlers/start'),
  require('./handlers/balance'),
  require('./handlers/donate'),
  require('./handlers/sections'),
  require('./handlers/admin'),
  require('./handlers/inline'),
];

const STATES = Object.assign({}, ...modules.map((m) => m.states || {}));

function createBot(token = config.botToken, botConfig = {}) {
  const bot = new Bot(token, botConfig);

  // Telegram "juda tez" (429) desa — kutib, qayta yuboradi; xabarlar yo'qolmaydi
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // Xatolar: foydalanuvchiga "xatolik" javobi + adminga 🚨 xabar. bot.catch faqat polling'da ishlaydi,
  // webhook rejimida (Railway) ham xuddi shunday bo'lishi uchun — eng birinchi middleware'da ushlanadi.
  async function onError(err) {
    console.error('[bot]', err.error || err);
    require('../services/alerts').reportLater('bot', err);
    const ctx = err.ctx;
    try {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t(ctx.lang || 'uz', 'error'), show_alert: true });
      else if (ctx.chat) await ctx.reply(t(ctx.lang || 'uz', 'error'));
    } catch (e) { /* e'tiborsiz */ }
  }
  bot.use(async (ctx, next) => {
    try { await next(); } catch (error) { await onError({ error, ctx }); }
  });

  // 👥 Guruh yangilanishlari — alohida handler (kunlik guruh Quiz'i, reyting); kanal yangilanishlari e'tiborsiz
  const groupHandler = require('./handlers/groups');
  bot.use(async (ctx, next) => {
    if (groupHandler.isGroup(ctx.chat)) return groupHandler.handle(ctx);
    if (!ctx.from || (ctx.chat && ctx.chat.type !== 'private')) return undefined;
    return next();
  });

  // Foydalanuvchini yuklash, blok va texnik ishlar tekshiruvi
  bot.use(async (ctx, next) => {
    const { user, created } = await users.upsertFromTelegram(ctx.from);
    ctx.user = user;
    ctx.userCreated = created;
    ctx.lang = user.language || 'uz';
    if (ctx.preCheckoutQuery && (user.is_blocked || (!users.isAdmin(user) && (await settings.get('maintenance_mode'))))) {
      return ctx.answerPreCheckoutQuery(false, { error_message: t(ctx.lang, user.is_blocked ? 'blocked' : 'maintenance') });
    }
    if (user.is_blocked) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t(ctx.lang, 'blocked'), show_alert: true }).catch(() => {});
      else await ctx.reply(t(ctx.lang, 'blocked'));
      return undefined;
    }
    if (!users.isAdmin(user) && (await settings.get('maintenance_mode'))) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t(ctx.lang, 'maintenance'), show_alert: true }).catch(() => {});
      else await ctx.reply(t(ctx.lang, 'maintenance'));
      return undefined;
    }
    require('../services/activity').touch(user.id);
    return next();
  });

  // Spam himoyasi: bitta foydalanuvchidan 3 soniyada 8 tadan ortiq bosish/xabar e'tiborsiz qoldiriladi
  const limiter = createLimiter({ max: 8, windowMs: 3000 });
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const r = limiter.hit(ctx.from.id);
    if (r.allowed) return next();
    if (r.warn) {
      const lang = ctx.lang || 'uz';
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t(lang, 'too_fast') }).catch(() => {});
      else await ctx.reply(t(lang, 'too_fast')).catch(() => {});
    } else if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }
    return undefined;
  });

  for (const m of modules) m.register(bot);

  // Matn/rasm/boshqa xabarlar — joriy suhbat holatiga qarab
  bot.on('message', async (ctx) => {
    const s = await state.get(ctx.from.id);
    if (s && STATES[s.state]) {
      if (s.state.startsWith('admin_') && !users.isAdmin(ctx.user)) {
        await state.clear(ctx.from.id);
      } else {
        return STATES[s.state](ctx, s.data || {});
      }
    }
    if (!ctx.user.language) return ctx.reply(require('../i18n').LANG_PROMPT, { reply_markup: ui.langKb() });
    return ctx.reply(t(ctx.lang, 'unknown'), { ...ui.HTML, reply_markup: ui.mainMenuKb(ctx.lang, ctx.user) });
  });

  // Eskirgan/noma'lum tugmalar
  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery());

  bot.catch(onError);

  return bot;
}

async function setupCommands(bot) {
  const descriptions = { uz: 'Botni ishga tushirish', ru: 'Запустить бота', en: 'Start the bot' };
  await bot.api.setMyCommands([{ command: 'start', description: descriptions.uz }]).catch(() => {});
  for (const lc of ['ru', 'en']) {
    await bot.api.setMyCommands([{ command: 'start', description: descriptions[lc] }], { language_code: lc }).catch(() => {});
  }
  const groupCmds = {
    uz: [['quiz', 'Bugungi Quiz savoli'], ['top', 'Guruh reytingi'], ['lang', 'Guruh tili']],
    ru: [['quiz', 'Квиз дня'], ['top', 'Рейтинг группы'], ['lang', 'Язык группы']],
    en: [['quiz', "Today's quiz"], ['top', 'Group leaderboard'], ['lang', 'Group language']],
  };
  for (const [lc, list] of Object.entries(groupCmds)) {
    await bot.api.setMyCommands(list.map(([command, description]) => ({ command, description })),
      { scope: { type: 'all_group_chats' }, ...(lc === 'uz' ? {} : { language_code: lc }) }).catch(() => {});
  }
  if (config.webAppUrl) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'FootballCenter', web_app: { url: `${config.webAppUrl}/` } } }).catch((e) => console.warn('[menu button]', e.description || e.message));
  }
}

module.exports = { createBot, setupCommands, STATES };

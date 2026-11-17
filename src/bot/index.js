const { Bot } = require('grammy');
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
];

const STATES = Object.assign({}, ...modules.map((m) => m.states || {}));

function createBot(token = config.botToken, botConfig = {}) {
  const bot = new Bot(token, botConfig);

  // Faqat shaxsiy chatlar (kanal/guruh yangilanishlari e'tiborsiz)
  bot.use(async (ctx, next) => {
    if (!ctx.from || (ctx.chat && ctx.chat.type !== 'private')) return undefined;
    return next();
  });

  // Foydalanuvchini yuklash, blok va texnik ishlar tekshiruvi
  bot.use(async (ctx, next) => {
    const { user, created } = await users.upsertFromTelegram(ctx.from);
    ctx.user = user;
    ctx.userCreated = created;
    ctx.lang = user.language || 'uz';
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
    return next();
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

  bot.catch(async (err) => {
    console.error('[bot]', err.error || err);
    const ctx = err.ctx;
    try {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: t(ctx.lang || 'uz', 'error'), show_alert: true });
      else await ctx.reply(t(ctx.lang || 'uz', 'error'));
    } catch (e) { /* e'tiborsiz */ }
  });

  return bot;
}

async function setupCommands(bot) {
  const descriptions = { uz: 'Botni ishga tushirish', ru: 'Запустить бота', en: 'Start the bot' };
  await bot.api.setMyCommands([{ command: 'start', description: descriptions.uz }]).catch(() => {});
  for (const lc of ['ru', 'en']) {
    await bot.api.setMyCommands([{ command: 'start', description: descriptions[lc] }], { language_code: lc }).catch(() => {});
  }
  if (config.webAppUrl) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'FootballCenter', web_app: { url: `${config.webAppUrl}/` } } }).catch((e) => console.warn('[menu button]', e.description || e.message));
  }
}

module.exports = { createBot, setupCommands, STATES };

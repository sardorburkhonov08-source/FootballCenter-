// Test muhiti: lokal PostgreSQL (TEST_DATABASE_URL) + soxta Telegram API
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/fc_test?host=/var/tmp';
process.env.BOT_TOKEN = '123456:TEST_TOKEN';
process.env.ADMIN_IDS = '1000';
process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'secret';
process.env.FOOTBALL_API_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = '';
process.env.WEBHOOK_URL = 'https://fc.example.com';
process.env.RATE_LIMIT_OFF = 'true';
process.env.DICE_WAIT_MS = '0';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'fc-test-uploads');

const db = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const settings = require('../src/services/settings');

async function resetDb() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  settings.invalidate();
  // Testlarda yangi foydalanuvchi standart holatda Oddiy tarifda (sovg'a Premium alohida testda)
  await settings.set('welcome_premium_days', 0);
  // Bosh menyu testlarda matn ko'rinishida (rasmli menyu alohida testda)
  await settings.set('menu_image_enabled', false);
  // Tanishtiruv (onboarding) testlarda standart o'chiq — alohida testda yoqiladi
  await settings.set('onboarding_enabled', false);
}

/** grammY bot + barcha API chaqiruvlarini yozib boruvchi soxta API */
function createTestBot() {
  const { createBot } = require('../src/bot');
  const notify = require('../src/services/notify');
  const bot = createBot(process.env.BOT_TOKEN, {
    botInfo: { id: 42, is_bot: true, first_name: 'FC', username: 'fc_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false },
  });
  const calls = [];
  const overrides = {};
  let msgId = 100;
  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload });
    if (overrides[method]) return { ok: true, result: await overrides[method](payload) };
    let result = true;
    if (['sendMessage', 'sendPhoto', 'sendDocument', 'copyMessage'].includes(method)) {
      msgId += 1;
      result = { message_id: msgId, date: Math.floor(Date.now() / 1000), chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
    }
    if (method === 'getChatMember') result = { status: 'member', user: { id: payload.user_id } };
    return { ok: true, result };
  });
  notify.setApi(bot.api);
  let updateId = 1;
  const from = (id, extra = {}) => ({ id, is_bot: false, first_name: `User${id}`, username: `user${id}`, language_code: 'uz', ...extra });
  const chat = (id) => ({ id, type: 'private', first_name: `User${id}` });

  const helpers = {
    bot, calls, overrides,
    clear() { calls.length = 0; },
    async text(userId, text, extra) {
      const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
      await bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: chat(userId), from: from(userId, extra), text, entities } });
    },
    async photo(userId) {
      await bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: chat(userId), from: from(userId), photo: [{ file_id: 'small', file_unique_id: 's', width: 90, height: 90 }, { file_id: `receipt_${userId}`, file_unique_id: 'b', width: 900, height: 900 }] } });
    },
    async click(userId, data, message = { text: 'old' }) {
      await bot.handleUpdate({ update_id: updateId++, callback_query: { id: String(updateId), from: from(userId), chat_instance: '1', data, message: { message_id: 5, date: 0, chat: chat(userId), ...message } } });
    },
    /** Oxirgi foydalanuvchiga ko'rsatilgan matn (yuborilgan yoki tahrirlangan) */
    lastText(chatId) {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        const c = calls[i];
        if (['sendMessage', 'editMessageText'].includes(c.method) && (chatId === undefined || c.payload.chat_id === chatId)) return c.payload.text;
        if (c.method === 'answerCallbackQuery' && c.payload.text && chatId === undefined) return c.payload.text;
      }
      return null;
    },
    texts(chatId) {
      return calls.filter((c) => ['sendMessage', 'editMessageText'].includes(c.method) && (chatId === undefined || c.payload.chat_id === chatId)).map((c) => c.payload.text);
    },
    alerts() { return calls.filter((c) => c.method === 'answerCallbackQuery' && c.payload.text).map((c) => c.payload.text); },
    buttons() {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        const m = calls[i].payload && calls[i].payload.reply_markup;
        if (m && m.inline_keyboard) return m.inline_keyboard.flat();
      }
      return [];
    },
  };
  return helpers;
}

/** Soxta Football API javoblari */
function fakeFootball(routes) {
  return async (url) => {
    const u = new URL(url);
    const key = u.pathname.replace('/v4', '');
    const handler = routes[key] || routes[`${key}?${u.searchParams.toString()}`];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    const body = typeof handler === 'function' ? handler(u) : handler;
    return { ok: true, status: 200, json: async () => body };
  };
}

module.exports = { db, resetDb, createTestBot, fakeFootball, settings };

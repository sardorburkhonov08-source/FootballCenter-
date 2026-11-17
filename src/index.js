const config = require('./config');
const { migrate } = require('./db/migrate');
const { createApp } = require('./web/server');
const notify = require('./services/notify');

/** Telegram'ga ulanish; xato bo'lsa (tarmoq, noto'g'ri token) 30 soniyadan keyin qayta urinadi */
async function startBot(bot) {
  const { setupCommands } = require('./bot');
  for (;;) {
    try {
      await bot.init();
      break;
    } catch (e) {
      const unauthorized = e && e.error_code === 401;
      console.error(unauthorized
        ? '❌ BOT_TOKEN noto\'g\'ri — BotFather\'dan tokenni tekshiring (.env). 30 soniyadan keyin qayta urinish.'
        : `⚠️ Telegram'ga ulanib bo'lmadi (${e.message}). 30 soniyadan keyin qayta urinish.`);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  config.botUsername = bot.botInfo.username;
  notify.setApi(bot.api);
  await setupCommands(bot);
  if (config.useWebhook) {
    if (!config.webAppUrl) throw new Error('USE_WEBHOOK=true uchun WEBAPP_URL kerak');
    await bot.api.setWebhook(`${config.webAppUrl}/tg-webhook`, { secret_token: config.webhookSecret || undefined, drop_pending_updates: false });
    console.log(`🤖 Bot webhook rejimida: @${bot.botInfo.username}`);
  } else {
    await bot.api.deleteWebhook().catch(() => {});
    bot.start({ onStart: (me) => console.log(`🤖 Bot ishga tushdi: @${me.username} (long polling)`) });
  }
}

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL sozlanmagan (.env)');
  await migrate();
  console.log('✅ Ma\'lumotlar bazasi tayyor');

  // Bot obyekti tarmoqsiz yaratiladi; web server bot Telegram'ga ulanishini kutmasdan ishga tushadi
  let bot = null;
  if (!config.disableBot) {
    if (!config.botToken) throw new Error('BOT_TOKEN sozlanmagan (.env)');
    const { createBot } = require('./bot');
    bot = createBot();
  }

  const app = createApp({ bot });
  const server = app.listen(config.port, () => console.log(`🌐 Web server: http://localhost:${config.port}`));

  if (bot) startBot(bot).catch((e) => console.error('❌ Bot:', e));
  const stopJobs = config.disableJobs ? () => {} : require('./jobs/scheduler').start();

  // To'xtatish signali (docker stop, systemctl stop) — toza yopish
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`⏹ ${signal} — to'xtatilmoqda...`);
    stopJobs();
    if (bot && bot.isRunning()) await bot.stop().catch(() => {});
    server.close();
    await require('./db/pool').pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});

const config = require('./config');
const { migrate } = require('./db/migrate');
const { createApp } = require('./web/server');
const notify = require('./services/notify');

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL sozlanmagan (.env)');
  await migrate();
  console.log('✅ Ma\'lumotlar bazasi tayyor');

  let bot = null;
  if (!config.disableBot) {
    if (!config.botToken) throw new Error('BOT_TOKEN sozlanmagan (.env)');
    const { createBot, setupCommands } = require('./bot');
    bot = createBot();
    await bot.init();
    config.botUsername = bot.botInfo.username;
    notify.setApi(bot.api);
    await setupCommands(bot);
  }

  const app = createApp({ bot });
  const server = app.listen(config.port, () => console.log(`🌐 Web server: http://localhost:${config.port}`));

  if (bot) {
    if (config.useWebhook) {
      if (!config.webAppUrl) throw new Error('USE_WEBHOOK=true uchun WEBAPP_URL kerak');
      await bot.api.setWebhook(`${config.webAppUrl}/tg-webhook`, { secret_token: config.webhookSecret || undefined, drop_pending_updates: false });
      console.log('🤖 Bot webhook rejimida');
    } else {
      await bot.api.deleteWebhook().catch(() => {});
      bot.start({ onStart: (me) => console.log(`🤖 Bot ishga tushdi: @${me.username} (long polling)`) });
    }
  }

  const stopJobs = config.disableJobs ? () => {} : require('./jobs/scheduler').start();

  // To'xtatish signali (docker stop, systemctl stop) — toza yopish
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`⏹ ${signal} — to'xtatilmoqda...`);
    stopJobs();
    if (bot && !config.useWebhook) await bot.stop().catch(() => {});
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

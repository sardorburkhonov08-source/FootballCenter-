require('dotenv').config({ quiet: true });

function list(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),
  botToken: process.env.BOT_TOKEN || '',
  botUsername: process.env.BOT_USERNAME || '',
  // Web App ochiladigan to'liq HTTPS manzil (masalan https://football.example.com)
  webAppUrl: (process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
  // Bo'sh bo'lsa long polling ishlatiladi; to'ldirilsa webhook (WEBAPP_URL + /tg-webhook)
  useWebhook: process.env.USE_WEBHOOK === 'true',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Ega(lar) Telegram ID'lari — har doim admin, o'chirib bo'lmaydi
  ownerIds: list(process.env.OWNER_IDS).map(Number),
  adminLogin: process.env.ADMIN_LOGIN || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || process.env.BOT_TOKEN || 'dev-secret',
  footballApiKey: process.env.FOOTBALL_API_KEY || '',
  footballApiBase: process.env.FOOTBALL_API_BASE || 'https://api.football-data.org/v4',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  quizApiUrl: process.env.QUIZ_API_URL || 'https://opentdb.com/api.php?amount=50&category=21&type=multiple',
  uploadDir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  timezone: 'Asia/Tashkent',
  disableBot: process.env.DISABLE_BOT === 'true',
  disableJobs: process.env.DISABLE_JOBS === 'true',
};

module.exports = config;

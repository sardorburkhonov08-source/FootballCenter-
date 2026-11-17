// Barcha maxfiy qiymatlar FAQAT environment variable orqali olinadi (repo public!).
// Lokal ishlab chiqishda .env fayli o'qiladi; Railway'da Variables bo'limidan beriladi.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const path = require('path');

// Loyiha bo'yicha yagona vaqt zonasi (SPEC 20.5)
process.env.TZ = 'Asia/Tashkent';

function list(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function stripSlash(v) {
  return (v || '').trim().replace(/\/+$/, '');
}

/** Tokendan kelib chiqadigan barqaror maxfiy qiymat (alohida env berilmasa) */
function derived(label, token) {
  return token ? crypto.createHash('sha256').update(`${label}:${token}`).digest('hex').slice(0, 48) : '';
}

const botToken = process.env.BOT_TOKEN || '';

// Serverning ommaviy HTTPS manzili, masalan https://footballcenter-production.up.railway.app
// WEBHOOK_URL berilmasa, Railway beradigan domen (agar mavjud bo'lsa) ishlatiladi.
const publicUrl = stripSlash(process.env.WEBHOOK_URL)
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');

const config = {
  port: Number(process.env.PORT || 3000),
  botToken,
  botUsername: process.env.BOT_USERNAME || '',

  publicUrl,
  // Mini App manzili (SPEC 1.3: ⚽ FootballCenter tugmasi shu manzilni ochadi)
  webAppUrl: publicUrl ? `${publicUrl}/app` : '',
  // Telegram webhook yo'li. publicUrl bo'lsa — webhook rejimi, bo'lmasa (lokal) — long polling.
  webhookPath: '/telegram/webhook',
  useWebhook: !!publicUrl && process.env.BOT_MODE !== 'polling',
  webhookSecret: process.env.WEBHOOK_SECRET || derived('webhook', botToken),

  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',

  // Admin/ega Telegram ID'lari (vergul bilan). Ega va admin bir xil huquqqa ega (SPEC 16).
  adminIds: list(process.env.ADMIN_IDS).map(Number).filter(Number.isFinite),

  // Web admin paneliga brauzerdan kirish (SPEC 17.1)
  adminLogin: process.env.ADMIN_LOGIN || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || derived('session', botToken) || crypto.randomBytes(32).toString('hex'),

  footballApiKey: process.env.FOOTBALL_API_KEY || '',
  footballApiBase: process.env.FOOTBALL_API_BASE || 'https://api.football-data.org/v4',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  quizApiUrl: process.env.QUIZ_API_URL || 'https://opentdb.com/api.php?amount=50&category=21&type=multiple',

  // Yuklangan fayllar (banner, sovrin). Railway'da Volume ulanadi — aks holda har deploy'da o'chadi.
  uploadDir: process.env.UPLOAD_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'uploads'),

  timezone: 'Asia/Tashkent',
  disableBot: process.env.DISABLE_BOT === 'true',
  disableJobs: process.env.DISABLE_JOBS === 'true',
};

module.exports = config;

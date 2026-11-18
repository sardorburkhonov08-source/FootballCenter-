// Admin tomonidan boshqariladigan barcha qiymatlar shu yerda — kodda qattiq yozilmaydi.
// DEFAULTS faqat boshlang'ich qiymatlar; admin panel orqali bazaga yozilgani ustun turadi.
const db = require('../db/pool');

const CARD_TYPES = ['humo', 'uzcard', 'visa', 'mastercard'];

const DEFAULTS = {
  // Majburiy obuna
  force_sub_enabled: false,
  force_sub_channels: [],            // [{ chat_id: '@kanal' | -100..., url: 'https://t.me/...', title }]

  // To'lov kartalari: { humo: { number, holder }, ... }
  cards_topup: {},
  cards_donation: {},                // bo'sh bo'lsa cards_topup ishlatiladi

  // Tarif
  premium_price: 30000,
  premium_days: 30,

  // AI limitlari (24 soatlik sirpanuvchi oyna)
  ai_limit_free: 1,
  ai_limit_premium: 10,

  // Bonus
  bonus_free_min: 100,
  bonus_free_max: 500,
  bonus_free_per_day: 1,
  bonus_premium_min: 300,
  bonus_premium_max: 1000,
  bonus_premium_per_day: 2,

  // Referral
  referral_enabled: true,
  referral_bonus_free: 1000,
  referral_bonus_premium: 1500,
  referral_fake_protection: true,
  referral_league_premium_days: 30,

  // Donat
  donation_channel_id: '',
  donation_big_threshold: 50000,
  donation_announce_timeout_minutes: 10,

  // Texnik ishlar
  maintenance_mode: false,

  // Web App
  webapp_news_enabled: false,        // 📰 Yangiliklar — hozircha OFF
  tactics: ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '4-3-2-1', '4-1-2-1-2', '4-4-1-1', '4-2-2-2',
    '3-5-2', '3-4-3', '3-4-2-1', '3-4-1-2', '3-1-4-2', '3-5-1-1', '5-3-2', '5-4-1', '5-2-3', '5-2-1-2'],
  prize_rotate_seconds: 15,
  // Asosiy ligalar (API-Football league ID, tartibi bilan): o'yinlar ro'yxatida eng tepada chiqadi.
  // Web admin paneli → "⭐ Asosiy ligalar" orqali o'zgartiriladi.
  // 2 — UEFA Chempionlar Ligasi, 3 — Yevropa Ligasi, 848 — Konferensiya Ligasi, 1 — Jahon chempionati,
  // 4 — Yevropa chempionati, 39 — APL, 140 — La Liga, 135 — Seriya A, 78 — Bundesliga, 61 — Liga 1
  featured_leagues: [2, 3, 848, 1, 4, 39, 140, 135, 78, 61],
  // 🔥 Ommabop ligalar (avtomatik): oxirgi N kunda eng ko'p foydalanuvchi qiziqqan ligalar
  // asosiy ligalardan keyin chiqadi. Kamida min_users foydalanuvchi bo'lishi kerak.
  popular_leagues_enabled: true,
  popular_leagues_days: 14,
  popular_leagues_limit: 10,
  popular_leagues_min_users: 3,
  leaderboard_top: 30,
};

const cache = new Map();
let cacheAt = 0;
const CACHE_TTL = 5000;

async function loadAll() {
  if (Date.now() - cacheAt < CACHE_TTL) return;
  const rows = await db.many('SELECT key, value FROM settings');
  cache.clear();
  for (const r of rows) cache.set(r.key, r.value);
  cacheAt = Date.now();
}

async function get(key) {
  await loadAll();
  if (cache.has(key)) return cache.get(key);
  return DEFAULTS[key];
}

async function getMany(keys) {
  const out = {};
  for (const k of keys) out[k] = await get(k);
  return out;
}

async function set(key, value) {
  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)],
  );
  cache.set(key, value);
}

function invalidate() { cacheAt = 0; }

async function getCard(purpose, type) {
  const own = (await get(purpose === 'donation' ? 'cards_donation' : 'cards_topup')) || {};
  if (own[type] && own[type].number) return own[type];
  if (purpose === 'donation') {
    const fallback = (await get('cards_topup')) || {};
    if (fallback[type] && fallback[type].number) return fallback[type];
  }
  return null;
}

module.exports = { DEFAULTS, CARD_TYPES, get, getMany, set, invalidate, getCard };

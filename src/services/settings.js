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
  premium_week_price: 10000,
  premium_week_days: 7,
  // ⚔️ Duel: g'alaba / durang uchun points, kuniga nechta duel points beradi
  duel_win_points: 10,
  duel_draw_points: 3,
  duel_daily_limit: 10,
  // 🥅 Penalty (sinov): g'alaba / durang uchun points, kuniga nechta o'yin
  penalty_win_points: 3,
  penalty_draw_points: 1,
  penalty_daily_games: 3,
  // 🎮 Crossbar challenge va Keepy-uppy: g'alaba / durang points, kuniga nechta o'yin (har bir tur uchun)
  arcade_win_points: 3,
  arcade_draw_points: 1,
  arcade_daily_games: 3,
  // 🎯 Hisobni top
  score_exact_points: 5,
  score_outcome_points: 2,
  // 🎁 Botga yangi kirgan foydalanuvchiga necha kunlik bepul Premium (0 — o'chiq)
  welcome_premium_days: 3,

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
  // 🧠 Quiz: inglizcha tashqi API (Open Trivia DB) — o'chiq; savollar 4 tilli bazadan (src/data/quiz-bank)
  quiz_api_enabled: false,
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

  // 🪪 Muxlislik kartasi (faqat Premium)
  fan_card_club_change_price: 50000,   // klubni almashtirish narxi (balansdan yechiladi)
  fan_card_first_fans: 100,
  // 👥 Fan community: klubning birinchi community'si bepul, keyingilari shu narxda (tasdiqlanganda balansdan yechiladi)
  community_extra_price: 1000000,
  community_level_xp: [500, 2000, 5000, 10000, 20000, 50000],   // 2—7-darajalar uchun kerakli XP (jami points)            // klubning birinchi N muxlisi kartasida maxsus belgi
  // GOAT tanlash uchun takliflar ro'yxati (foydalanuvchi qidirib tanlaydi)
  // Klub ranglari (API-Football jamoa ID → { primary, secondary }). Bu ro'yxatdagi klublar uchun rang logotipdan
  // aniqlanmaydi — rasmiy rang ishlatiladi. Web admin → "🪪 Muxlislik kartalari" → "Klub ranglari" orqali o'zgartiriladi.
  fan_card_team_colors: {
    50: { primary: '#6cabdd', secondary: '#1c2c5b' },   // Manchester City
    33: { primary: '#da291c', secondary: '#fbe122' },   // Manchester United
    40: { primary: '#c8102e', secondary: '#00b2a9' },   // Liverpool
    42: { primary: '#ef0107', secondary: '#063672' },   // Arsenal
    49: { primary: '#034694', secondary: '#dba111' },   // Chelsea
    47: { primary: '#132257', secondary: '#ffffff' },   // Tottenham
    541: { primary: '#00529f', secondary: '#febe10' },  // Real Madrid
    529: { primary: '#a50044', secondary: '#004d98' },  // Barcelona
    530: { primary: '#cb3524', secondary: '#272e61' },  // Atletico Madrid
    157: { primary: '#dc052d', secondary: '#0066b2' },  // Bayern
    165: { primary: '#fde100', secondary: '#000000' },  // Borussia Dortmund
    496: { primary: '#000000', secondary: '#ffffff' },  // Juventus
    505: { primary: '#010e80', secondary: '#000000' },  // Inter
    489: { primary: '#fb090b', secondary: '#000000' },  // AC Milan
    492: { primary: '#12a0d7', secondary: '#003c82' },  // Napoli
    85: { primary: '#004170', secondary: '#da291c' },   // PSG
  },
  fan_card_goats: ['Lionel Messi', 'Cristiano Ronaldo', 'Pelé', 'Diego Maradona', 'Johan Cruyff', 'Zinedine Zidane',
    'Ronaldo Nazário', 'Ronaldinho', 'Franz Beckenbauer', 'Alfredo Di Stéfano', 'Ferenc Puskás', 'George Best',
    'Michel Platini', 'Marco van Basten', 'Paolo Maldini', 'Thierry Henry', 'Kaká', 'Andrés Iniesta', 'Xavi',
    'Zlatan Ibrahimović', 'Neymar', 'Kylian Mbappé', 'Erling Haaland', 'Luka Modrić', 'Karim Benzema',
    'Robert Lewandowski', 'Mohamed Salah', 'Kevin De Bruyne', 'Gianluigi Buffon', 'Lev Yashin', 'Eusébio',
    'Gerd Müller', 'Roberto Baggio', 'Francesco Totti', 'Steven Gerrard', 'Wayne Rooney', 'Sergio Ramos',
    'Iker Casillas', 'Andriy Shevchenko', 'Lamine Yamal', 'Jude Bellingham', 'Vinícius Júnior', 'Eldor Shomurodov',
    'Server Djeparov', 'Abbosbek Fayzullayev'],
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

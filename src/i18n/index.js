const LOCALES = {
  uz: require('./locales/uz'),
  uz_cyrl: require('./locales/uz_cyrl'),
  ru: require('./locales/ru'),
  en: require('./locales/en'),
};

const LANGS = ['uz', 'uz_cyrl', 'ru', 'en'];
const LANG_NAMES = { uz: "🇺🇿 O'zbek (lotin)", uz_cyrl: '🇺🇿 Ўзбек (кирил)', ru: '🇷🇺 Русский', en: '🇺🇸 English' };

// Birinchi /start va "Tilni o'zgartirish" uchun — 4 tilda bitta xabar
const LANG_PROMPT = "O'zingizga qulay tilni tanlang 🇺🇿\n\nЎзингизга қулай тилни танланг 🇺🇿\n\nВыбери язык, который тебе нравится 🇷🇺\n\nChoose the language you like 🇺🇸";

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Raw HTML qiymat (escape qilinmaydi) */
function raw(html) { return { __html: String(html) }; }

/**
 * Tarjima. Parametrlar HTML-escape qilinadi (raw() bilan o'ralganidan tashqari).
 * Topilmagan kalit — o'zbek (lotin) varianti, u ham bo'lmasa kalitning o'zi.
 */
function t(lang, key, params = {}) {
  const dict = LOCALES[lang] || LOCALES.uz;
  let str = dict[key];
  if (str === undefined) str = LOCALES.uz[key];
  if (str === undefined) return key;
  return str.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in params)) return m;
    const v = params[name];
    if (v && typeof v === 'object' && '__html' in v) return v.__html;
    return escapeHtml(v === null || v === undefined ? '' : v);
  });
}

/** Summa formati: 1 250 000 */
function money(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Bazadagi ko'p tilli maydondan (text_uz, text_ru ...) mos tilni olish */
function pickLang(row, prefix, lang) {
  if (!row) return null;
  return row[`${prefix}_${lang}`] || row[`${prefix}_uz`] || null;
}

module.exports = { t, raw, money, escapeHtml, pickLang, LANGS, LANG_NAMES, LANG_PROMPT, LOCALES };

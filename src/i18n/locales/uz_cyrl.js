// O'zbek (kirill) — uz.js dan avtomatik transliteratsiya. Aniq tarjima kerak bo'lsa, OVERRIDES ga qo'shing.
const uz = require('./uz');
const { translit } = require('../translit');

const OVERRIDES = {
  lang_saved: '✅ Тил сақланди: Ўзбек (кирил)',
  sum: 'сўм',
  a_faq_skip_hint: 'ℹ️ Ўтказиб юборилса, Ўзбек (лотин) матни ишлатилади.',
};

const out = {};
for (const [k, v] of Object.entries(uz)) out[k] = OVERRIDES[k] || translit(v);
module.exports = out;

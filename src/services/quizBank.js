// 🧠 Quiz savollar bazasi — 4 tilda (src/data/quiz-bank). Server ishga tushganda bazaga qo'shiladi (bir marta).
//
// Fayl formati (qNN.json): [ [uz, ru, en, [to'g'ri, xato, xato, xato]], ... ]
//   variant: "matn" (hamma tilda bir xil), ["uz", "ru", "en"] yoki "#KOD" (dict.json lug'atidan).
// Kirill (uz_cyrl) matni o'zbek lotindan transliteratsiya qilinadi (umumiy nomlar lotinda qoladi). To'g'ri javob o'rni har savol uchun
// barqaror tasodifiy (savol matnidan hisoblanadi) — barcha tillarda bir xil harf.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { translit } = require('../i18n/translit');

const DIR = path.join(__dirname, '..', 'data', 'quiz-bank');
const LANG_IDX = { uz: 0, ru: 1, en: 2 };

let cached = null;

function dict() { return JSON.parse(fs.readFileSync(path.join(DIR, 'dict.json'), 'utf8')); }

function files() { return fs.readdirSync(DIR).filter((f) => /^q\d+\.json$/.test(f)).sort(); }

function optionText(opt, lang, d) {
  if (Array.isArray(opt)) return opt[LANG_IDX[lang]];
  if (typeof opt === 'string' && opt.startsWith('#')) {
    const e = d[opt.slice(1)];
    if (!e) throw new Error(`Quiz lug'atida yo'q: ${opt}`);
    return e[LANG_IDX[lang]];
  }
  return String(opt);
}

/** Barcha savollar: [{ hash, correct: 'A'..'D', uz: {q,a,b,c,d}, uz_cyrl, ru, en }] */
function load() {
  if (cached) return cached;
  const d = dict();
  const out = [];
  for (const file of files()) {
    const list = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    list.forEach((item, i) => {
      const [uz, ru, en, opts] = item;
      if (!uz || !ru || !en || !Array.isArray(opts) || opts.length !== 4) throw new Error(`${file} #${i + 1}: format noto'g'ri`);
      const hash = crypto.createHash('sha1').update(`bank:${en.trim().toLowerCase()}`).digest('hex');
      // To'g'ri javob (opts[0]) o'rni: savolga bog'liq barqaror aralashtirish
      const order = [0, 1, 2, 3].sort((a, b) => parseInt(hash.slice(a * 4, a * 4 + 4), 16) - parseInt(hash.slice(b * 4, b * 4 + 4), 16));
      const build = (lang, q) => {
        const o = order.map((k) => optionText(opts[k], lang, d));
        return { q, a: o[0], b: o[1], c: o[2], d: o[3] };
      };
      const uzRow = build('uz', uz);
      // Kirill: o'zbekcha matn transliteratsiya qilinadi; hamma tilda bir xil yoziladigan nomlar
      // (futbolchi, klub, raqam) lotin harfida qoladi — «Manchester City» → «Манчестер Цитй» bo'lib ketmasin
      const shared = (opt) => typeof opt === 'string' && !opt.startsWith('#');
      const cyrlOpts = order.map((k) => (shared(opts[k]) ? String(opts[k]) : translit(optionText(opts[k], 'uz', d))));
      out.push({
        hash, file, index: i + 1, correct: 'ABCD'[order.indexOf(0)],
        uz: uzRow,
        uz_cyrl: { q: translit(uz), a: cyrlOpts[0], b: cyrlOpts[1], c: cyrlOpts[2], d: cyrlOpts[3] },
        ru: build('ru', ru),
        en: build('en', en),
      });
    });
  }
  cached = out;
  return out;
}

/** Bazaga qo'shish — mavjudlari (source_hash) o'tkazib yuboriladi */
async function seed(client) {
  const list = load();
  const have = Number((await client.query("SELECT count(*)::int AS n FROM quiz_questions WHERE source = 'bank'")).rows[0].n);
  if (have >= list.length) return 0;
  let added = 0;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const values = [];
    const params = [];
    chunk.forEach((x, k) => {
      const b = k * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},'bank',$${b + 7},$${b + 8}::jsonb)`);
      params.push(x.uz.q, x.uz.a, x.uz.b, x.uz.c, x.uz.d, x.correct, x.hash, JSON.stringify({ uz_cyrl: x.uz_cyrl, ru: x.ru, en: x.en }));
    });
    const r = await client.query(
      `INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source, source_hash, i18n)
       VALUES ${values.join(',')} ON CONFLICT (source_hash) DO NOTHING`,
      params,
    );
    added += r.rowCount;
  }
  return added;
}

module.exports = { load, seed, files, DIR };

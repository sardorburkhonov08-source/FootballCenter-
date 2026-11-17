// uz.json dan uz_cyrl.json ga yetishmayotgan kalitlarni transliteratsiya qilib qo'shadi.
// Mavjud (qo'lda tuzatilgan) tarjimalarga tegmaydi. Hammasini qayta yaratish: node scripts/i18n-cyrl.js --force
const fs = require('fs');
const path = require('path');
const { translit } = require('../src/i18n/translit');

const dir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const uz = JSON.parse(fs.readFileSync(path.join(dir, 'uz.json'), 'utf8'));
const file = path.join(dir, 'uz_cyrl.json');
const force = process.argv.includes('--force');
const current = !force && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

const out = {};
let added = 0;
for (const [k, v] of Object.entries(uz)) {
  if (k in current) out[k] = current[k];
  else { out[k] = translit(v); added += 1; }
}
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`✅ uz_cyrl.json: ${added} ta kalit qo'shildi, jami ${Object.keys(out).length}`);

// 📊 Kunlik faol foydalanuvchilar (DAU): bot yoki Mini App'dan foydalangan har bir foydalanuvchi kuniga bir marta yoziladi.
// Xotiradagi to'plam bir kunda bir foydalanuvchi uchun bazaga takror yozmaydi.
const db = require('../db/pool');
const { ymd } = require('./time');

let seenDay = null;
let seen = new Set();

/** Faollikni qayd etish (orqa fonda; xato asosiy amalni to'xtatmaydi) */
function touch(userId) {
  if (!userId) return;
  const day = ymd();
  if (day !== seenDay) { seenDay = day; seen = new Set(); }
  if (seen.has(userId)) return;
  seen.add(userId);
  db.query('INSERT INTO daily_active (day, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [day, userId])
    .catch((e) => { seen.delete(userId); console.error('[activity]', e.message); });
}

function reset() { seenDay = null; seen = new Set(); }

module.exports = { touch, reset };

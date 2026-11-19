// 🧠 Yangi Quiz savoli haqidagi xabar — kuniga 1 marta (egasi talabi)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { fromParts } = require('../src/services/time');

let h;
test.before(async () => {
  await resetDb();
  h = createTestBot();
  await h.text(7601, '/start');
  await h.click(7601, 'lang:uz');
  await db.query("UPDATE users SET premium_expires_at = now() + interval '10 days' WHERE telegram_id = 7601");
});
test.after(async () => { await db.pool.end(); });

test("har soatda emas, kuniga bir marta: belgilangan soatdan keyingi birinchi savolda", async () => {
  const { quizDailyNotify } = require('../src/jobs/scheduler');
  const sent = () => h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 7601 && c.payload.text.startsWith('🧠 Yangi Quiz savoli')).length;
  h.clear();
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 20, 11, 5)), false, 'soat 12 dan oldin — yuborilmaydi');
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 20, 12, 7)), true);
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 20, 13, 7)), false, 'shu kuni qayta yuborilmaydi');
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 20, 23, 7)), false);
  assert.strictEqual(sent(), 1);
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 21, 12, 30)), true, 'ertasi kuni — yana bir marta');
  assert.strictEqual(sent(), 2);
  // Admin soatni o'zgartiradi
  await settings.set('quiz_notify_hour', 9);
  assert.strictEqual(await quizDailyNotify(fromParts(2026, 10, 22, 9, 15)), true);
  assert.strictEqual(sent(), 3);
});

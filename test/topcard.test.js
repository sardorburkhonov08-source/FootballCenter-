// 🏆 Botdagi reyting (shohsupa rasmi) va ✨ Telegram xabar effektlari
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const topCard = require('../src/services/topCard');
const leaderboard = require('../src/services/leaderboard');
const { EFFECTS } = require('../src/services/notify');

let h;
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;
// Eng kichik haqiqiy JPEG bosh baytlari (rasm sifatida tekshiruvdan o'tishi uchun)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test.before(async () => {
  await resetDb();
  h = createTestBot();
  for (const tg of [8101, 8102, 8103, 8104]) { await h.text(tg, '/start'); await h.click(tg, 'lang:uz'); }
  const [a, b, c, d] = await Promise.all([8101, 8102, 8103, 8104].map(uid));
  await db.query(`INSERT INTO penalty_games (user_id, status, result, points, finished_at)
    VALUES ($1, 'finished', 'win', 9, now()), ($2, 'finished', 'win', 6, now()), ($3, 'finished', 'win', 3, now()), ($4, 'finished', 'draw', 1, now())`, [a, b, c, d]);
  leaderboard.clearRankingCache();
  // Profil rasmi: faqat 8101 da bor
  h.overrides.getUserProfilePhotos = (p) => (p.user_id === 8101
    ? { total_count: 1, photos: [[{ file_id: 'small', file_unique_id: 's', width: 160, height: 160 }]] } : { total_count: 0, photos: [] });
  h.overrides.getFile = () => ({ file_id: 'small', file_unique_id: 's', file_path: 'photos/a.jpg' });
  topCard.setFetch(async () => ({ ok: true, arrayBuffer: async () => JPEG }));
});
test.after(async () => { await db.pool.end(); });

test('🏆 Profil ichida Reyting: shohsupa rasmi, 4—10-o\'rinlar va o\'z o\'rningiz; davr almashsa — rasm tahrirlanadi', async () => {
  h.clear();
  await h.text(8104, '/menu');
  assert.ok(!h.buttons().some((b) => b.callback_data === 'm:top'), 'bosh menyuda Reyting yo\'q');
  h.clear();
  await h.click(8104, 'm:profile');
  assert.ok(h.buttons().some((b) => b.callback_data === 'm:top'), 'Profil ichida Reyting tugmasi');
  h.clear();
  await h.click(8104, 'm:top');
  const photo = h.calls.find((c) => c.method === 'sendPhoto');
  assert.ok(photo, 'rasm yuborildi');
  const cap = photo.payload.caption;
  assert.ok(cap.startsWith('🏆 <b>Umumiy reyting — bu hafta</b>'), cap);
  assert.ok(cap.includes('4. User8104 — 1'));
  assert.ok(cap.includes('👤 Siz: <b>#4</b> · 1 points'));
  const kb = photo.payload.reply_markup.inline_keyboard;
  assert.deepStrictEqual(kb[0].map((b) => b.text), ['Bugun', '✅ Hafta', 'Oy']);
  assert.strictEqual(kb[kb.length - 1][0].callback_data, 'm:profile', 'orqaga — Profilga');

  // Avatar bir marta olinadi va keshlanadi
  const v = await topCard.viewModel(await db.one('SELECT * FROM users WHERE telegram_id = 8101'), 'weekly');
  assert.ok(v.podium[0].photo.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(v.podium[1].photo, null);
  assert.deepStrictEqual(v.podium.map((x) => x.points), [9, 6, 3]);

  h.clear();
  await h.click(8104, 'm:top:monthly', { photo: [{ file_id: 'x', file_unique_id: 'x', width: 1, height: 1 }], caption: 'old' });
  const edit = h.calls.find((c) => c.method === 'editMessageMedia');
  assert.ok(edit, 'xabar tahrirlandi');
  assert.ok(edit.payload.media.caption.startsWith('🏆 <b>Umumiy reyting — bu oy</b>'));
  assert.ok(!h.calls.some((c) => c.method === 'sendPhoto'));
});

test('🏆 points yo\'q foydalanuvchi va bo\'sh davr', async () => {
  await h.text(8105, '/start'); await h.click(8105, 'lang:uz');
  h.clear();
  await h.click(8105, 'm:top');
  const cap = h.calls.find((c) => c.method === 'sendPhoto').payload.caption;
  assert.ok(cap.includes("👤 Siz bu davrda hali points to'plamagansiz"));
  const png = (await topCard.renderPng(await db.one('SELECT * FROM users WHERE telegram_id = 8105'), 'daily')).png;
  assert.ok(png.length > 1000);
});

test('✨ effektlar: bayram xabari, sovg\'a Premium; effekt rad etilsa — effektsiz qayta yuboriladi', async () => {
  const notify = require('../src/services/notify');
  const u = await db.one('SELECT * FROM users WHERE telegram_id = 8101');
  h.clear();
  await notify.celebrate(u, '🏆');
  assert.strictEqual(h.calls.find((c) => c.method === 'sendMessage').payload.message_effect_id, EFFECTS.fire);

  let rejected = 0;
  h.overrides.sendMessage = (p) => {
    if (p.message_effect_id) { rejected += 1; const e = new Error('Bad Request: EFFECT_ID_INVALID'); e.description = e.message; throw e; }
    return { message_id: 1, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text };
  };
  h.clear();
  assert.strictEqual(await notify.celebrate(u, '🎉'), true);
  assert.strictEqual(rejected, 1);
  assert.strictEqual(h.calls.filter((c) => c.method === 'sendMessage').length, 2);
  delete h.overrides.sendMessage;

  // Yangi foydalanuvchiga sovg'a Premium xabari — 🎉 effekt bilan
  await settings.set('welcome_premium_days', 3);
  await h.text(8106, '/start');
  h.clear();
  await h.click(8106, 'lang:uz');
  const welcome = h.calls.find((c) => c.method === 'sendMessage' && /^🎁/.test(c.payload.text));
  assert.strictEqual(welcome.payload.message_effect_id, EFFECTS.party);
  await settings.set('welcome_premium_days', 0);
});

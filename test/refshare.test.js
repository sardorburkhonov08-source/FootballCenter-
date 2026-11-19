// 📤 Referral havolasini bir bosishda do'stlarga yuborish — chorlovchi matn bilan (admin o'zgartiradi)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot } = require('./helpers');

let h;
test.before(async () => { await resetDb(); h = createTestBot(); });
test.after(async () => { await db.pool.end(); });

test("🔗 havola xabarida 📤 Do'stlarga yuborish tugmasi: Telegram ulashish oynasi havola va taklif matni bilan", async () => {
  await h.text(7901, '/start');
  await h.click(7901, 'lang:uz');
  h.clear();
  await h.click(7901, 'ref:link');
  assert.match(h.lastText(7901), /^🔗 Sizning shaxsiy havolangiz:/);
  const btn = h.buttons().find((b) => b.url);
  assert.strictEqual(btn.text, "📤 Do'stlarga yuborish");
  const u = new URL(btn.url);
  assert.strictEqual(u.origin + u.pathname, 'https://t.me/share/url');
  const code = (await db.one('SELECT ref_code FROM users WHERE telegram_id = 7901')).ref_code;
  assert.strictEqual(u.searchParams.get('url'), `https://t.me/fc_test_bot?start=ref_${code}`);
  assert.match(u.searchParams.get('text'), /^⚽ O'zingni futbol bo'yicha bilimdon deb bilasanmi\? Unda FootballCenter aynan sen uchun!/);
  assert.ok(u.searchParams.get('text').includes('jonli natijalar'));
  assert.ok(h.buttons().some((b) => b.callback_data === 'bal:ref'), 'orqaga tugmasi');
});

test("admin taklif matnini o'zgartiradi (bot admin → Referral sozlamalari → ✏️ Taklif matni)", async () => {
  await h.text(1000, '/start');
  await h.click(1000, 'lang:uz');
  await h.click(1000, 'a:referral');
  assert.ok(h.buttons().some((b) => b.callback_data === 'at:ref_invite'));
  await h.click(1000, 'at:ref_invite');
  await h.click(1000, 'ar:texts:ref_invite:uz');
  await h.text(1000, "🔥 Futbolni sevasanmi? Keldik!");
  h.clear();
  await h.click(7901, 'ref:link');
  const u = new URL(h.buttons().find((b) => b.url).url);
  assert.strictEqual(u.searchParams.get('text'), '🔥 Futbolni sevasanmi? Keldik!');
});

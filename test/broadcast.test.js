// 🎯 Maqsadli va ⏰ rejalashtirilgan xabar tarqatish, 📣 kanalga avtomatik post, 👋 tanishtiruv
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const football = require('../src/services/football');
const broadcast = require('../src/services/broadcast');
const channel = require('../src/services/channel');
const { ymd, fromParts, parts } = require('../src/services/time');

let h;
const ADMIN = 1000;
const user = (tg) => db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);
const copied = () => h.calls.filter((c) => c.method === 'copyMessage').map((c) => c.payload.chat_id).sort();

// Kechagi tugagan o'yinlar (kanal posti uchun)
football.setFetch(async (url) => {
  const u = new URL(url);
  let response = [];
  if (u.pathname === '/fixtures' && u.searchParams.get('date')) {
    response = [[1, 'Arsenal', 'Chelsea', 2, 1, 39, 'Premier League'], [2, 'Pakhtakor', 'Navbahor', 0, 0, 369, 'Super League']].map(([id, hn, an, gh, ga, lid, ln]) => ({
      fixture: { id, timestamp: Math.floor(Date.now() / 1000) - 86400, status: { short: 'FT', elapsed: 90 } },
      league: { id: lid, name: ln, country: 'X', season: 2026 },
      teams: { home: { id: id * 10, name: hn }, away: { id: id * 10 + 1, name: an } }, goals: { home: gh, away: ga },
    }));
  }
  return { ok: true, status: 200, headers: new Map([['x-ratelimit-requests-remaining', '90']]), json: async () => ({ errors: [], response }) };
});

test.before(async () => {
  await resetDb();
  h = createTestBot();
  for (const tg of [ADMIN, 9501, 9502, 9503]) { await h.text(tg, '/start'); await h.click(tg, 'lang:uz'); }
  await db.query("UPDATE users SET premium_expires_at = now() + interval '5 days' WHERE telegram_id = 9501");
  await db.query("UPDATE users SET last_seen_at = now() - interval '10 days' WHERE telegram_id = 9503");
  // 9502 — Real Madrid muxlisi (muxlislik kartasi), Toshkent shahri
  const u = await user(9502);
  await db.query(`INSERT INTO fan_cards (user_id, team_id, team_name, fan_number, last_name, first_name, birth_year, gender, goat, fav_player, region, fan_since)
    VALUES ($1, 541, 'Real Madrid', 1, 'A', 'B', 2000, 'male', 'Messi', 'Vinicius', 'tashkent_city', 2010)`, [u.id]);
});
test.after(async () => { await db.pool.end(); });

test('🎯 auditoriya: hammaga / Premium / 7+ kun kirmaganlar / klub / hudud', async () => {
  const tgs = async (aud) => (await broadcast.audienceUsers(aud)).map((x) => Number(x.telegram_id)).sort();
  assert.deepStrictEqual(await tgs({ type: 'all' }), [ADMIN, 9501, 9502, 9503]);
  assert.deepStrictEqual(await tgs({ type: 'premium' }), [9501]);
  assert.deepStrictEqual(await tgs({ type: 'inactive' }), [9503]);
  assert.deepStrictEqual(await tgs({ type: 'club', value: 541 }), [9502]);
  assert.deepStrictEqual(await tgs({ type: 'region', value: 'tashkent_city' }), [9502]);
});

test('📢 bot admin: xabar → auditoriya tanlash → hozir yuborish (faqat tanlanganlarga)', async () => {
  await h.click(ADMIN, 'a:broadcast');
  await h.text(ADMIN, 'Real muxlislari, bugun El Clasico!');
  assert.ok(h.lastText(ADMIN).startsWith('📢 <b>Xabarni kimga yuboramiz?</b>'));
  assert.ok(h.lastText(ADMIN).includes('Qabul qiluvchilar: <b>4</b>'));
  await h.click(ADMIN, 'bc:clubs');
  assert.ok(h.buttons().some((b) => b.callback_data === 'bc:a:club:541' && b.text === 'Real Madrid (1)'));
  await h.click(ADMIN, 'bc:a:club:541');
  assert.ok(h.lastText(ADMIN).includes('⚽ Real Madrid muxlislari'));
  assert.ok(h.lastText(ADMIN).includes('<b>1</b>'));
  h.clear();
  await h.click(ADMIN, 'bc:go');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepStrictEqual(copied(), [9502]);
});

test('⏰ rejalashtirish: o\'tgan vaqt rad etiladi; vaqti kelganda bir marta yuboriladi; bekor qilish', async () => {
  await h.click(ADMIN, 'a:broadcast');
  await h.text(ADMIN, 'Ertaga turnir!');
  await h.click(ADMIN, 'bc:a:premium');
  await h.click(ADMIN, 'bc:later');
  await h.text(ADMIN, '01.01.2020 10:00');
  assert.ok(h.lastText(ADMIN).startsWith('⚠️'));
  const p = parts(new Date(Date.now() + 2 * 86400000));
  const pad = (n) => String(n).padStart(2, '0');
  await h.text(ADMIN, `${pad(p.day)}.${pad(p.month + 1)}.${p.year} 18:00`);
  assert.ok(h.lastText(ADMIN).startsWith('⏰ Rejalashtirildi'), h.lastText(ADMIN));
  const job = (await broadcast.pending())[0];
  assert.strictEqual(job.audience.type, 'premium');
  assert.strictEqual(new Date(job.send_at).getTime(), fromParts(p.year, p.month, p.day, 18, 0).getTime());

  // Hali vaqti emas
  h.clear();
  assert.strictEqual(await broadcast.tick(h.bot.api), 0);
  await db.query("UPDATE scheduled_broadcasts SET send_at = now() - interval '1 minute' WHERE id = $1", [job.id]);
  assert.strictEqual(await broadcast.tick(h.bot.api), 1);
  assert.strictEqual(await broadcast.tick(h.bot.api), 0);
  assert.deepStrictEqual(copied(), [9501]);
  const done = await db.one('SELECT * FROM scheduled_broadcasts WHERE id = $1', [job.id]);
  assert.deepStrictEqual([done.status, done.ok_count], ['sent', 1]);
  assert.ok(h.texts(ADMIN).some((x) => x.startsWith('✅ Yetkazildi: 1')));

  // Bekor qilish
  const j2 = await broadcast.schedule({ fromChatId: ADMIN, messageId: 5, audience: { type: 'all' }, sendAt: new Date(Date.now() + 3600000), adminId: (await user(ADMIN)).id });
  await h.click(ADMIN, 'bcq:list');
  assert.ok(h.lastText(ADMIN).includes(`#${j2.id}`));
  await h.click(ADMIN, `bcq:x:${j2.id}`);
  assert.strictEqual((await db.one('SELECT status FROM scheduled_broadcasts WHERE id = $1', [j2.id])).status, 'cancelled');
});

test('📣 kanal: kanal sozlanmasa — post yo\'q; sozlansa — kechagi natijalar kuniga bir marta, g\'olib kartasi', async () => {
  const morning = fromParts(...(() => { const p = parts(new Date()); return [p.year, p.month, p.day, 10, 0]; })());
  h.clear();
  assert.strictEqual(await channel.postDailyResults(h.bot.api, morning), false);
  await h.click(ADMIN, 'a:channel');
  await h.click(ADMIN, 'as:channel:channel_post_id');
  await h.text(ADMIN, 'kanal');
  assert.ok(h.lastText(ADMIN).startsWith('ℹ️ Kanal ID'));
  await h.text(ADMIN, '@fc_test_channel');
  assert.strictEqual(await settings.get('channel_post_id'), '@fc_test_channel');

  h.clear();
  assert.strictEqual(await channel.postDailyResults(h.bot.api, new Date(morning.getTime() - 3 * 3600000)), false, 'soatidan oldin');
  assert.strictEqual(await channel.postDailyResults(h.bot.api, morning), true);
  assert.strictEqual(await channel.postDailyResults(h.bot.api, morning), false, 'kuniga bir marta');
  const photo = h.calls.find((c) => c.method === 'sendPhoto');
  assert.strictEqual(photo.payload.chat_id, '@fc_test_channel');
  assert.ok(photo.payload.caption.startsWith('⚽ <b>Kechagi natijalar</b>'));

  // Rasm SVG'si: o'yinlar va hisob
  const svg = channel.resultsSvg('uz', '21.11.2026', await channel.finishedMatches(ymd(new Date(Date.now() - 86400000))));
  assert.ok(svg.includes('ARSENAL') && svg.includes('2 : 1'));

  h.clear();
  await db.query("INSERT INTO prizes (kind, period, text) VALUES ('overall', 'weekly', 'Istalgan jamoa formasi')");
  assert.strictEqual(await channel.postWinner(h.bot.api, await user(9501), 240, 'weekly'), true);
  const w = h.calls.find((c) => c.method === 'sendPhoto').payload;
  assert.ok(w.caption.startsWith("🏆 <b>Haftaning g'olibi — User9501!</b>"), w.caption);
  assert.ok(w.caption.includes('Istalgan jamoa formasi'));
});

test('👋 tanishtiruv: yangi foydalanuvchi til tanlagach 3 qadam, keyin menyu; o\'chirilsa — darhol menyu', async () => {
  await settings.set('onboarding_enabled', true);
  await h.text(9601, '/start');
  h.clear();
  await h.click(9601, 'lang:uz');
  assert.ok(h.lastText(9601).startsWith('👋 <b>Xush kelibsiz, User9601!</b>'), h.lastText(9601));
  assert.ok(h.lastText(9601).includes('1/3'));
  await h.click(9601, 'ob:2');
  assert.ok(h.lastText(9601).startsWith('🎮'));
  await h.click(9601, 'ob:3');
  assert.ok(h.lastText(9601).includes('3/3'));
  assert.ok(h.buttons().some((b) => b.callback_data === 'ob:done'));
  await h.click(9601, 'ob:done');
  assert.ok(h.buttons().some((b) => b.callback_data === 'm:balance'));

  await settings.set('onboarding_enabled', false);
  await h.text(9602, '/start');
  h.clear();
  await h.click(9602, 'lang:uz');
  assert.ok(!h.texts(9602).some((x) => x.startsWith('👋 <b>Xush kelibsiz')));
  assert.ok(h.buttons().some((b) => b.callback_data === 'm:balance'));
  await settings.set('onboarding_enabled', true);
});

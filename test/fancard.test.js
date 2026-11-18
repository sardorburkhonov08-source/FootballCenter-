// 🪪 Muxlislik kartasi — ID karta uslubida, faqat Premium
const test = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { db, resetDb, createTestBot, settings } = require('./helpers');
const { signInitData } = require('../src/web/auth');
const football = require('../src/services/football');
const fancard = require('../src/services/fancard');
const barcode = require('../src/services/barcode');

/** Sun'iy logotip: oq fon, katta qizil doira va kichik ko'k qism */
function logoPng() {
  const png = new PNG({ width: 60, height: 60 });
  for (let y = 0; y < 60; y += 1) for (let x = 0; x < 60; x += 1) {
    const i = (y * 60 + x) * 4;
    let c = [255, 255, 255, 255];
    if ((x - 30) ** 2 + (y - 30) ** 2 < 600) c = [200, 16, 46, 255];
    if (x > 50 && y > 50) c = [20, 40, 160, 255];
    if (x < 3) c = [0, 0, 0, 0];
    png.data.set(c, i);
  }
  return PNG.sync.write(png);
}
const PHOTO = `data:image/png;base64,${logoPng().toString('base64')}`;

let server;
let base;
let h;
const OWNER = 1000;
const auth = (id) => ({ Authorization: `tma ${signInitData({ id, first_name: 'Sardor' }, process.env.BOT_TOKEN)}` });
async function call(path, id, opts = {}) {
  const res = await fetch(`${base}${path}`, { method: opts.method || 'GET', headers: { ...auth(id), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function png(path) {
  const res = await fetch(`${base}${path}`);
  if (res.status !== 200) return { status: res.status };
  const img = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  return { status: 200, type: res.headers.get('content-type'), size: [img.width, img.height] };
}
const uid = async (tg) => (await db.one('SELECT id FROM users WHERE telegram_id = $1', [tg])).id;
const premium = (tg) => db.query("UPDATE users SET premium_expires_at = now() + interval '30 days' WHERE telegram_id = $1", [tg]);
const FULL = { photo: PHOTO, lastName: 'Aliyev', firstName: 'Aziz', birthYear: 2000, gender: 'male', teamId: 50, player: 'Foden', goat: 'Cristiano Ronaldo', since: 2016, region: 'tashkent_city' };

test.before(async () => {
  await resetDb();
  h = createTestBot();
  football.setFetch(async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    let response = [];
    if (u.pathname === '/teams' && q.id === '50') response = [{ team: { id: 50, name: 'Red City', logo: 'https://media.example/50.png', country: 'England' } }];
    if (u.pathname === '/teams' && q.id === '60') response = [{ team: { id: 60, name: 'Blue & <United>', logo: null, country: 'England' } }];
    if (u.pathname === '/players/squads') response = [{ players: [{ id: 1, name: 'Foden', position: 'Midfielder' }] }];
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ errors: [], response }) };
  });
  fancard.setFetch(async () => ({ ok: true, arrayBuffer: async () => logoPng() }));
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test('logotipdan klub ranglari; Code 128 shtrix-kodi', () => {
  const c = fancard.dominantColors(logoPng());
  assert.strictEqual(c.primary, '#c8102e');
  assert.strictEqual(c.secondary, '#1428a0');
  assert.strictEqual(fancard.palette('#ffe14d').accent !== '#ffe14d', true, "och rang matn uchun qoraytiriladi");
  const m = barcode.modules('Ab');
  // Start B + 'A' + 'b' + nazorat belgisi (har biri 11 modul) + Stop (13 modul)
  assert.strictEqual(m.length, 11 * 4 + 13);
  assert.strictEqual(m.slice(0, 11), '11010010000', 'Start B');
  assert.strictEqual(m.slice(-13), '1100011101011', 'Stop');
});

test("eski (004) karta ustunlari users jadvalidan olib tashlangan", async () => {
  const cols = await db.many("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND (column_name LIKE 'fav_%' OR column_name LIKE 'fan_%')");
  assert.deepStrictEqual(cols, []);
});

test("Premium yo'q: qulflangan namuna, faollashtirib bo'lmaydi", async () => {
  await call('/api/me', 9001);
  const r = await call('/api/fan-card', 9001);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.premium, r.body.activated, r.body.images], [false, false, null]);
  assert.strictEqual(r.body.sampleUrl, '/card/sample-uz.png');
  assert.strictEqual(r.body.clubChangePrice, 50000);
  assert.strictEqual(r.body.regions.length, 15);
  assert.ok(r.body.goats.includes('Lionel Messi'));
  assert.strictEqual((await call('/api/fan-card/activate', 9001, { method: 'POST', body: FULL })).status, 402);
  assert.deepStrictEqual(await png('/card/sample-ru.png'), { status: 200, type: 'image/png', size: [1200, 756] });
  assert.strictEqual((await png('/card/sample-de.png')).status, 404);
});

test("Faollashtirish: hamma maydon majburiy va tekshiriladi", async () => {
  await call('/api/me', 9002);
  await premium(9002);
  const bad = [
    [{ photo: null }, 'bad_photo'], [{ photo: 'data:image/png;base64,AAAA' }, 'bad_photo'],
    [{ lastName: '' }, 'bad_last_name'], [{ lastName: 'Ali<b>' }, 'bad_last_name'], [{ firstName: 'x'.repeat(31) }, 'bad_first_name'],
    [{ birthYear: 1800 }, 'bad_birth_year'], [{ birthYear: new Date().getFullYear() }, 'bad_birth_year'],
    [{ gender: 'x' }, 'bad_gender'], [{ region: 'mars' }, 'bad_region'], [{ since: 1990 }, 'bad_since'],
    [{ goat: 'x' }, 'bad_goat'], [{ player: '' }, 'bad_player'], [{ teamId: 'abc' }, 'bad_team'],
  ];
  for (const [patch, code] of bad) {
    const r = await call('/api/fan-card/activate', 9002, { method: 'POST', body: { ...FULL, ...patch } });
    assert.deepStrictEqual([r.status, r.body.error], [400, code], JSON.stringify(patch));
  }
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM fan_cards')).n, 0);

  const r = await call('/api/fan-card/activate', 9002, { method: 'POST', body: { ...FULL, player: '  Foden <b> ' } });
  assert.strictEqual(r.status, 200);
  const c = r.body.card;
  assert.deepStrictEqual({ team: c.team.name, number: c.fanNumber, last: c.lastName, age: c.age, player: c.player, region: c.region.name, first: c.first, photo: c.hasPhoto },
    { team: 'Red City', number: 1, last: 'Aliyev', age: new Date().getFullYear() - 2000, player: 'Foden b', region: 'Toshkent shahri', first: true, photo: true });
  assert.match(r.body.images.front, /^\/card\/9002-[a-f0-9]{20}-front\.png\?v=/);
  assert.match(r.body.storyUrl, /^https:\/\/fc\.example\.com\/card\/9002-/);
  assert.strictEqual((await call('/api/fan-card/activate', 9002, { method: 'POST', body: FULL })).status, 409, 'ikkinchi marta emas');

  // Ikkinchi muxlis — 2-raqam
  await call('/api/me', 9003);
  await premium(9003);
  const r2 = await call('/api/fan-card/activate', 9003, { method: 'POST', body: { ...FULL, firstName: "G'ayrat" } });
  assert.strictEqual(r2.body.card.fanNumber, 2);
});

test('Karta rasmlari: old/orqa 1200×756, Stories 1080×1920; imzosiz — 404', async () => {
  const r = await call('/api/fan-card', 9002);
  for (const [side, size] of [['front', [1200, 756]], ['back', [1200, 756]], ['story', [1080, 1920]]]) {
    assert.deepStrictEqual(await png(r.body.images[side]), { status: 200, type: 'image/png', size }, side);
  }
  const sig = fancard.imagePath(9002).split('-')[1];
  assert.strictEqual((await png(`/card/9002-${'0'.repeat(20)}-front.png`)).status, 404);
  assert.strictEqual((await png(`/card/9001-${sig}-front.png`)).status, 404, 'boshqa foydalanuvchi uchun imzo ishlamaydi');
  assert.strictEqual((await png(fancard.imagePath(9001, 'front'))).status, 404, 'Premium yo\'q / karta yo\'q');
  // Premium tugasa — karta yashiriladi, ma'lumot saqlanadi
  await db.query("UPDATE users SET premium_expires_at = now() - interval '1 day' WHERE telegram_id = 9003");
  const exp = await call('/api/fan-card', 9003);
  assert.deepStrictEqual([exp.body.premium, exp.body.activated, exp.body.images], [false, true, null]);
  assert.strictEqual((await png(fancard.imagePath(9003, 'front'))).status, 404);
  await premium(9003);
});

test("SVG: tanlangan til, matn escape qilinadi, reyting medali", async () => {
  await db.query('UPDATE users SET points_quiz = 50 WHERE telegram_id = 9003');
  const svgFor = async (tg, lang, side) => {
    const u = await db.one('SELECT * FROM users WHERE telegram_id = $1', [tg]);
    const card = await fancard.cardRow(u.id);
    const rank = await fancard.clubRank(card);
    const v = {
      club: 'Blue & <United>', logoPng: null, pal: fancard.palette('#c8102e'), photo: null, lastName: card.last_name, firstName: card.first_name,
      goat: card.goat, age: 24, gender: card.gender, player: card.fav_player, since: card.fan_since, fanNumber: card.fan_number, first: true, firstLimit: 100,
      region: 'Ташкент', points: 1234567, activated: '18.11.2026', rank, botUsername: 'fc_bot',
    };
    return { svg: fancard.cardSvg(v, lang, side), rank };
  };
  const front = await svgFor(9002, 'ru', 'front');
  assert.match(front.svg, /КЛУБ BLUE &amp; &lt;UNITED&gt;/);
  assert.match(front.svg, /КАРТА БОЛЕЛЬЩИКА/);
  assert.match(front.svg, /№ 000001/);
  assert.match(front.svg, /ПЕРВЫЕ 100 БОЛЕЛЬЩИКОВ/);
  assert.doesNotMatch(front.svg, /&amp;amp;/, 'ikki marta escape qilinmaydi');
  const back = await svgFor(9003, 'uz', 'back');
  assert.deepStrictEqual(back.rank, { total: 2, place: 1 }, "ko'proq points — 1-o'rin");
  assert.match(back.svg, /1-O'RIN/);
  assert.match(back.svg, /1 234 567/);
  assert.match(back.svg, /t\.me\/fc_bot/);
  assert.match(back.svg, /#f2c94c/, 'oltin medal');
  const second = await svgFor(9002, 'uz', 'back');
  assert.deepStrictEqual(second.rank, { total: 2, place: 2 });
});

test("Faollashtirilgandan keyin faqat GOAT va sevimli futbolchi o'zgaradi", async () => {
  const r = await call('/api/fan-card', 9002, { method: 'PATCH', body: { goat: 'Lionel Messi', player: 'Haaland', lastName: 'Boshqa', since: 2020 } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.card.goat, r.body.card.player, r.body.card.lastName, r.body.card.since], ['Lionel Messi', 'Haaland', 'Aliyev', 2016]);
  assert.strictEqual((await call('/api/fan-card', 9002, { method: 'PATCH', body: { goat: 'x' } })).status, 400);
  assert.strictEqual((await call('/api/fan-card', 9001, { method: 'PATCH', body: { goat: 'Pelé' } })).status, 402);
});

test("Klubni almashtirish: narx balansdan yechiladi, yangi klubda navbat oxiridan raqam", async () => {
  const id = await uid(9002);
  const noMoney = await call('/api/fan-card/club', 9002, { method: 'POST', body: { teamId: 60 } });
  assert.deepStrictEqual([noMoney.status, noMoney.body.error], [409, 'no_money']);
  await db.query('UPDATE users SET balance = 70000 WHERE id = $1', [id]);
  assert.strictEqual((await call('/api/fan-card/club', 9002, { method: 'POST', body: { teamId: 50 } })).body.error, 'same_team');
  // Yangi klubda raqam hisoblagichi: avval kimdir olgan raqam qayta berilmaydi
  await db.query('INSERT INTO fan_team_counters (team_id, last_number) VALUES (60, 7)');
  const r = await call('/api/fan-card/club', 9002, { method: 'POST', body: { teamId: 60 } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.card.team.name, r.body.card.fanNumber, r.body.balance], ['Blue & <United>', 8, 20000]);
  const log = await db.one('SELECT * FROM fan_card_club_changes WHERE user_id = $1', [id]);
  assert.deepStrictEqual([log.old_team_id, log.new_team_id, log.old_fan_number, log.new_fan_number, Number(log.price)], [50, 60, 1, 8, 50000]);
  // Narx admin sozlamasidan olinadi
  await settings.set('fan_card_club_change_price', 20000);
  assert.strictEqual((await call('/api/fan-card/club', 9002, { method: 'POST', body: { teamId: 50 } })).body.card.fanNumber, 3, 'Red City: 1, 2 band — keyingisi 3');
  assert.strictEqual(Number((await db.one('SELECT balance FROM users WHERE id = $1', [id])).balance), 0);
  await settings.set('fan_card_first_fans', 2);
  assert.strictEqual((await call('/api/fan-card', 9002)).body.card.first, false, "3-muxlis 'birinchi 2' ga kirmaydi");
});

test("Web admin: rasmni o'chirish (foydalanuvchiga xabar), ma'lumotni tuzatish, sozlamalar", async () => {
  await call('/api/me', OWNER);
  const list = await call('/api/admin/fan-cards?q=aziz', OWNER);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.cards.length, 1, "G'ayrat emas, faqat Aziz");
  const card = list.body.cards[0];
  assert.match(card.photoUrl, /^\/uploads\/fancards\/\d+-[a-f0-9]{24}\.png$/);
  assert.strictEqual((await fetch(`${base}${card.photoUrl}`)).status, 200);
  assert.strictEqual((await call(`/api/admin/fan-cards?q=aziz`, 9002)).status, 403, 'faqat admin');

  h.clear();
  assert.strictEqual((await call(`/api/admin/fan-cards/${card.userId}/photo`, OWNER, { method: 'DELETE' })).status, 200);
  assert.match(h.lastText(9002), /^🪪 Muxlislik kartangizdagi rasm admin tomonidan o'chirildi/);
  assert.strictEqual((await fetch(`${base}${card.photoUrl}`)).status, 404, "fayl o'chirildi");
  const after = await call('/api/fan-card', 9002);
  assert.strictEqual(after.body.card.hasPhoto, false);
  assert.strictEqual((await png(after.body.images.front)).status, 200, 'rasmsiz ham chiziladi');
  // Foydalanuvchi yangi rasm yuklaydi — faqat bir marta
  assert.strictEqual((await call('/api/fan-card/photo', 9002, { method: 'POST', body: { photo: PHOTO } })).status, 200);
  assert.strictEqual((await call('/api/fan-card/photo', 9002, { method: 'POST', body: { photo: PHOTO } })).status, 409);

  const bad = await call(`/api/admin/fan-cards/${card.userId}`, OWNER, { method: 'PATCH', body: { since: 1990 } });
  assert.deepStrictEqual([bad.status, bad.body.error], [400, 'bad_since']);
  assert.strictEqual((await call(`/api/admin/fan-cards/${card.userId}`, OWNER, { method: 'PATCH', body: { lastName: 'Valiyev', gender: 'female', region: 'samarkand' } })).status, 200);
  const fixed = await fancard.cardRow(card.userId);
  assert.deepStrictEqual([fixed.last_name, fixed.gender, fixed.region, fixed.first_name], ['Valiyev', 'female', 'samarkand', 'Aziz']);

  const st = await call('/api/admin/fan-card-settings', OWNER, { method: 'PUT', body: { price: 45000, firstFans: 100, goats: ['Pelé', ' Pelé ', 'x', '<b>Zico</b>'] } });
  assert.deepStrictEqual(st.body, { price: 45000, firstFans: 100, goats: ['Pelé', 'bZico/b'] });
  assert.strictEqual((await call('/api/admin/fan-card-settings', OWNER, { method: 'PUT', body: { price: -1, firstFans: 1, goats: [] } })).status, 400);
});

test("Bot admin: kartani ko'rish, rasmni o'chirish, maydonni tuzatish", async () => {
  await h.text(OWNER, '/start');
  await h.click(OWNER, 'lang:uz').catch(() => {});
  await h.click(OWNER, 'a:users');
  await h.text(OWNER, '9002');
  assert.ok(h.buttons().some((b) => b.callback_data === 'fc:v:9002'), 'foydalanuvchi kartochkasida tugma');
  await h.click(OWNER, 'fc:v:9002');
  assert.match(h.lastText(OWNER), /^🪪 <b>Muxlislik kartasi<\/b>/);
  assert.match(h.lastText(OWNER), /Familiya: Valiyev/);
  await h.click(OWNER, 'fc:e:9002:firstName');
  await h.text(OWNER, '123');
  assert.match(h.lastText(OWNER), /^⚠️ Qiymat noto'g'ri/);
  await h.text(OWNER, 'Bobur');
  assert.match(h.lastText(OWNER), /Ism: Bobur/);
  await h.click(OWNER, 'fc:s:9002:gender:male');
  assert.strictEqual((await fancard.cardRow(await uid(9002))).gender, 'male');
  h.clear();
  await h.click(OWNER, 'fc:rpy:9002');
  assert.match(h.lastText(9002), /^🪪 Muxlislik kartangizdagi rasm/);
  assert.strictEqual((await fancard.cardRow(await uid(9002))).photo_path, null);
  await h.click(OWNER, 'fc:v:9001');
  assert.match(h.lastText(OWNER), /faollashtirmagan/);
  // Sozlamalar bo'limi
  await h.click(OWNER, 'a:fancard');
  assert.match(h.lastText(OWNER), /Klubni almashtirish narxi/);
});

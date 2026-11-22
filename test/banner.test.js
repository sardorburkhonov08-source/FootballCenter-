// 🖼 Banner: istalgan format (MOV, AVIF, Lottie), o'lcham saqlanadi va Mini App'ga beriladi; xavfli fayllar rad etiladi
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const { signInitData } = require('../src/web/auth');

let server;
let base;
let cookie;
const auth = { Authorization: `tma ${signInitData({ id: 7501, first_name: 'B' }, process.env.BOT_TOKEN)}` };
async function upload(file, type, name, extra = {}) {
  const fd = new FormData();
  fd.append('media', new Blob([file], { type }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(`${base}/api/admin/banners`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
  return { status: r.status, body: await r.json() };
}

test.before(async () => {
  await resetDb();
  server = require('../src/web/server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'secret' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { server.close(); await db.pool.end(); });

test("banner o'lchami saqlanadi; MOV video, AVIF rasm va Lottie qabul qilinadi; HTML/SVG rad etiladi", async () => {
  const tall = await upload(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png', 'tall.png', { width: '1080', height: '1920', duration: '5' });
  assert.strictEqual(tall.status, 200);
  assert.deepStrictEqual([tall.body.width, tall.body.height], [1080, 1920]);

  const mov = await upload(Buffer.from('00000014667479707174', 'hex'), 'video/quicktime', 'clip.mov', { width: '1920', height: '1080' });
  assert.strictEqual(mov.status, 200);
  assert.strictEqual(mov.body.media_type, 'video');
  assert.ok(mov.body.media_path.endsWith('.mov'));

  const avif = await upload(Buffer.from('0000001c66747970617669', 'hex'), 'image/avif', 'a.avif');
  assert.strictEqual(avif.body.media_type, 'image');
  assert.strictEqual(avif.body.width, null, "o'lcham yuborilmasa — null (Mini App o'zi aniqlaydi)");

  const lottie = await upload(Buffer.from(JSON.stringify({ v: '5.7', w: 800, h: 600, layers: [] })), 'application/json', 'anim.json');
  assert.deepStrictEqual([lottie.body.media_type, lottie.body.width, lottie.body.height], ['lottie', 800, 600]);

  // Noto'g'ri o'lcham e'tiborsiz
  const bad = await upload(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png', 'b.png', { width: '-5', height: 'abc' });
  assert.deepStrictEqual([bad.body.width, bad.body.height], [null, null]);

  // Brauzerda ochilganda skript bajarishi mumkin bo'lgan fayllar serverga to'g'ridan-to'g'ri qabul qilinmaydi
  assert.strictEqual((await upload(Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg')).body.error, 'bad_media');
  assert.strictEqual((await upload(Buffer.from('<p>'), 'text/html', 'x.html')).body.error, 'bad_media');

  const list = await (await fetch(`${base}/api/banners`, { headers: auth })).json();
  assert.deepStrictEqual(list.map((b) => [b.type, b.width, b.height]), [['image', 1080, 1920], ['video', 1920, 1080], ['image', null, null], ['lottie', 800, 600], ['image', null, null]]);
});

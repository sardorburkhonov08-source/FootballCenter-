const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const { migrate, migrationFiles } = require('../src/db/migrate');
const settings = require('../src/services/settings');
const config = require('../src/config');

let server;
let base;

test.before(async () => {
  await resetDb();
  const { createTestBot } = require('./helpers');
  const h = createTestBot();
  const { createApp } = require('../src/web/server');
  server = createApp({ bot: h.bot }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.pool.end(); });

test('migratsiyalar: SPEC 18 jadvallari, qayta ishga tushirish xavfsiz', async () => {
  const tables = (await db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.table_name);
  for (const tbl of ['users', 'promo_codes', 'promo_code_uses', 'referrals', 'donations', 'balance_topups', 'bonuses_log',
    'mini_manager_games', 'mini_manager_predictions', 'quiz_questions', 'quiz_answers', 'support_tickets', 'settings', 'schema_migrations']) {
    assert.ok(tables.includes(tbl), `${tbl} jadvali yo'q`);
  }
  const applied = (await db.many('SELECT version FROM schema_migrations')).map((r) => r.version);
  assert.deepStrictEqual(applied, migrationFiles());
  assert.deepStrictEqual(await migrate(), [], 'ikkinchi marta hech narsa bajarilmaydi');
});

test("settings seed: barcha boshlang'ich qiymatlar bazada, admin o'zgartirgani saqlanadi", async () => {
  const keys = (await db.many('SELECT key FROM settings')).map((r) => r.key);
  for (const k of Object.keys(settings.DEFAULTS)) assert.ok(keys.includes(k), `${k} seed qilinmagan`);
  await settings.set('premium_price', 45000);
  await migrate();
  settings.invalidate();
  assert.strictEqual(await settings.get('premium_price'), 45000);
});

test('Mini App /app manzilida, / → /app/', async () => {
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.strictEqual(root.status, 302);
  assert.strictEqual(root.headers.get('location'), '/app/');
  const app = await fetch(`${base}/app/`);
  assert.strictEqual(app.status, 200);
  assert.match(await app.text(), /telegram-web-app\.js/);
  for (const f of ['/app/app.js', '/app/app.css', '/app/i18n.js', '/app/translit.js', '/admin/']) {
    assert.strictEqual((await fetch(`${base}${f}`)).status, 200, f);
  }
  assert.strictEqual(config.webAppUrl, 'https://fc.example.com/app');
});

test('webhook: faqat to\'g\'ri maxfiy kalit bilan qabul qilinadi', async () => {
  assert.ok(config.useWebhook);
  assert.ok(/^[a-f0-9]{48}$/.test(config.webhookSecret), 'secret tokendan hosil qilinadi');
  const update = { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 5555, type: 'private' }, from: { id: 5555, is_bot: false, first_name: 'W' }, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } };
  const bad = await fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, body: JSON.stringify(update) });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(await db.one('SELECT 1 AS x FROM users WHERE telegram_id = 5555'), null);
  const ok = await fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': config.webhookSecret }, body: JSON.stringify(update) });
  assert.strictEqual(ok.status, 200);
  assert.ok(await db.one('SELECT 1 AS x FROM users WHERE telegram_id = 5555'), '/start qayta ishlandi');
});

test("kodda token/parol yo'q", () => {
  const { execSync } = require('child_process');
  const hits = execSync("git grep -nIE '[0-9]{8,10}:[A-Za-z0-9_-]{35}|sk-ant-[A-Za-z0-9]|postgres://[^@ ]+:[^@ ]+@' -- ':!test/*' ':!*.md' || true", { cwd: `${__dirname}/..` }).toString().trim();
  assert.strictEqual(hits, '');
});

// Migratsiyalar: src/db/migrations/NNN_nom.sql fayllari tartib bilan, har biri bir marta bajariladi.
// Server ishga tushganda avtomatik chaqiriladi. Qo'lda: npm run migrate
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 7420151; // bir vaqtda ikki nusxa ishga tushsa, migratsiya faqat bittasida bajariladi

function migrationFiles() {
  return fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
}

async function migrate() {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const file of migrationFiles()) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migratsiya ${file} bajarilmadi: ${e.message}`);
      }
    }
    await seedSettings(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}

/** settings jadvaliga boshlang'ich qiymatlar — faqat yo'q kalitlar qo'shiladi, admin o'zgartirganlariga tegilmaydi */
async function seedSettings(client) {
  const { DEFAULTS } = require('../services/settings');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)]);
  }
}

module.exports = { migrate, migrationFiles };

if (require.main === module) {
  migrate()
    .then((applied) => { console.log(`✅ Migratsiya: ${applied.length ? applied.join(', ') : 'yangi migratsiya yo\'q'}`); return pool.end(); })
    .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  // Sessiya vaqt zonasi — loyiha bo'yicha yagona (SPEC 20.5)
  options: '-c timezone=Asia/Tashkent',
});

// pg BIGINT'ni string qaytaradi; bizdagi qiymatlar Number.MAX_SAFE_INTEGER'dan kichik
require('pg').types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Tranzaksiya: fn(client) ichida client.query ishlatiladi */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, many, tx };

// Ko'p bosqichli suhbatlar holati — bazada (server qayta ishga tushsa ham yo'qolmaydi)
const db = require('../db/pool');

async function get(telegramId) {
  return db.one('SELECT state, data FROM user_states WHERE telegram_id = $1', [telegramId]);
}

async function set(telegramId, state, data = {}) {
  await db.query(
    `INSERT INTO user_states (telegram_id, state, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (telegram_id) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [telegramId, state, JSON.stringify(data)],
  );
}

async function clear(telegramId) {
  await db.query('DELETE FROM user_states WHERE telegram_id = $1', [telegramId]);
}

module.exports = { get, set, clear };

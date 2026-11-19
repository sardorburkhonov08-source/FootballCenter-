// 🚨 Adminlarga texnik xabarlar: server xatolari, futbol API kunlik limiti tugashi, sekin baza.
// Bir xil turdagi xabar settings.alerts_repeat_minutes da ko'pi bilan bir marta yuboriladi (spam bo'lmasin).
const db = require('../db/pool');
const settings = require('./settings');
const notify = require('./notify');
const { t } = require('../i18n');

const lastSent = new Map();   // key -> vaqt (ms)

/**
 * Xabar yuborish. key — turi (masalan 'bot', 'job:quiz', 'web', 'football_limit', 'db_slow').
 * text — qisqa tavsif (xato matni). → yuborildimi
 */
async function report(key, text) {
  try {
    // Baza ishlamasa ham xabar ketsin: sozlamalar — standart qiymat, adminlar — ADMIN_IDS
    const safe = (p, fallback) => p.catch(() => fallback);
    if (!(await safe(settings.get('alerts_enabled'), true))) return false;
    const repeatMs = Math.max(1, Number(await safe(settings.get('alerts_repeat_minutes'), 30)) || 30) * 60000;
    const now = Date.now();
    if (lastSent.has(key) && now - lastSent.get(key) < repeatMs) return false;
    lastSent.set(key, now);
    const ids = await safe(notify.adminIds(), require('../config').adminIds);
    const rows = await safe(db.many('SELECT telegram_id, language FROM users WHERE telegram_id = ANY($1::bigint[])', [ids]), []);
    const langs = new Map(rows.map((r) => [Number(r.telegram_id), r.language]));
    const body = String(text || '').slice(0, 800);
    let sent = false;
    for (const id of ids) {
      const lang = langs.get(Number(id)) || 'uz';
      sent = (await notify.sendRaw(id, t(lang, 'alert_msg', { title: t(lang, `alert_${key.split(':')[0]}`), key, text: body }))) || sent;
    }
    return sent;
  } catch (e) {
    console.error('[alerts]', e.message);
    return false;
  }
}

/** Xato obyektidan qisqa matn */
function errText(e) {
  if (!e) return 'unknown';
  const err = e.error || e;
  return String(err.description || err.message || err).split('\n')[0];
}

/** Orqa fonda (chaqiruvchini kuttirmaydi) */
function reportLater(key, e) { report(key, typeof e === 'string' ? e : errText(e)).catch(() => {}); }

/** 🐢 Baza tezligi: SELECT 1 vaqti alerts_db_slow_ms dan oshsa — xabar */
async function checkDb() {
  const v = Number(await settings.get('alerts_db_slow_ms'));
  const limit = Number.isFinite(v) ? v : 2000;
  const t0 = Date.now();
  await db.query('SELECT 1');
  const ms = Date.now() - t0;
  if (ms > limit) await report('db_slow', `SELECT 1 — ${ms} ms (> ${limit} ms)`);
  return ms;
}

function reset() { lastSent.clear(); }

module.exports = { report, reportLater, errText, checkDb, reset };

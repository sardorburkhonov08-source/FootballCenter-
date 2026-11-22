// 📢 Xabar tarqatish: 🎯 auditoriya (hammaga, Premium, oddiy, 7+ kun kirmaganlar, klub muxlislari, hudud) va ⏰ rejalashtirish.
// Xabar admin chatidagi asl xabardan copyMessage bilan nusxalanadi (matn, rasm, video — istalgan turi).
const db = require('../db/pool');
const notify = require('./notify');
const users = require('./users');
const { t } = require('../i18n');

const TYPES = ['all', 'premium', 'free', 'inactive', 'club', 'region'];
const INACTIVE_DAYS = 7;

function normalize(aud) {
  const a = aud && TYPES.includes(aud.type) ? { type: aud.type } : { type: 'all' };
  if (a.type === 'club') a.value = Number(aud.value) || 0;
  if (a.type === 'region') a.value = String(aud.value || '');
  return a;
}

/** Auditoriya foydalanuvchilari (bloklanmagan, botni ochgan, «Bot yangiliklari» yoqilgan) */
async function audienceUsers(aud) {
  const a = normalize(aud);
  const where = ['NOT u.is_blocked', 'NOT u.group_only'];
  const params = [];
  if (a.type === 'inactive') where.push(`(u.last_seen_at IS NULL OR u.last_seen_at < now() - interval '${INACTIVE_DAYS} days')`);
  if (a.type === 'club') { params.push(a.value); where.push(`EXISTS (SELECT 1 FROM fan_cards f WHERE f.user_id = u.id AND f.team_id = $${params.length})`); }
  if (a.type === 'region') { params.push(a.value); where.push(`EXISTS (SELECT 1 FROM fan_cards f WHERE f.user_id = u.id AND f.region = $${params.length})`); }
  let rows = await db.many(`SELECT u.* FROM users u WHERE ${where.join(' AND ')}`, params);
  if (a.type === 'premium') rows = rows.filter((u) => users.isPremium(u));
  if (a.type === 'free') rows = rows.filter((u) => !users.isPremium(u));
  return rows.filter((u) => notify.isEnabled(u, 'news'));
}

/** Auditoriya nomi (admin tilida) */
async function audienceLabel(lang, aud) {
  const a = normalize(aud);
  if (a.type === 'club') {
    const c = await db.one('SELECT team_name FROM fan_cards WHERE team_id = $1 LIMIT 1', [a.value]);
    return t(lang, 'bc_aud_club_named', { club: c ? c.team_name : String(a.value) });
  }
  if (a.type === 'region') return t(lang, 'bc_aud_region_named', { region: t(lang, `region_${a.value}`) });
  return t(lang, `bc_aud_${a.type}`);
}

/** Muxlislari ko'p klublar va hududlar (tanlash tugmalari uchun) */
async function topClubs(limit = 12) {
  return db.many('SELECT team_id, max(team_name) AS team_name, count(*)::int AS n FROM fan_cards GROUP BY team_id ORDER BY n DESC, team_id LIMIT $1', [limit]);
}
async function regionCounts() {
  return db.many('SELECT region, count(*)::int AS n FROM fan_cards GROUP BY region ORDER BY n DESC');
}

/** Yuborish. → { ok, fail }; adminga hisobot */
async function run(api, fromChatId, messageId, adminUser, aud) {
  const audience = await audienceUsers(aud);
  let ok = 0;
  let fail = 0;
  for (const u of audience) {
    try {
      await api.copyMessage(u.telegram_id, fromChatId, messageId);
      ok += 1;
    } catch (e) {
      fail += 1;
    }
    await new Promise((r) => setTimeout(r, 40)); // ~25 xabar/soniya — Telegram limitidan past
  }
  if (adminUser) await notify.sendRaw(adminUser.telegram_id, t(adminUser.language || 'uz', 'a_broadcast_done', { ok, fail }));
  return { ok, fail };
}

// ---------- ⏰ Rejalashtirish
async function schedule({ fromChatId, messageId, audience, sendAt, adminId }) {
  return db.one(
    'INSERT INTO scheduled_broadcasts (from_chat_id, message_id, audience, send_at, created_by) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *',
    [fromChatId, messageId, JSON.stringify(normalize(audience)), sendAt, adminId],
  );
}
async function pending() {
  return db.many("SELECT * FROM scheduled_broadcasts WHERE status = 'pending' ORDER BY send_at");
}
async function cancel(id) {
  return db.one("UPDATE scheduled_broadcasts SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
}

/** ⏰ Fon vazifasi: vaqti kelganlarini yuborish (har biri bir marta) */
async function tick(api) {
  if (!api) return 0;
  let n = 0;
  for (;;) {
    const job = await db.one(
      `UPDATE scheduled_broadcasts SET status = 'sending' WHERE id = (
         SELECT id FROM scheduled_broadcasts WHERE status = 'pending' AND send_at <= now() ORDER BY send_at LIMIT 1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
    );
    if (!job) return n;
    const admin = job.created_by ? await users.byId(job.created_by) : null;
    const r = await run(api, job.from_chat_id, job.message_id, admin, job.audience);
    await db.query("UPDATE scheduled_broadcasts SET status = 'sent', ok_count = $2, fail_count = $3, sent_at = now() WHERE id = $1", [job.id, r.ok, r.fail]);
    n += 1;
  }
}

module.exports = { TYPES, INACTIVE_DAYS, normalize, audienceUsers, audienceLabel, topClubs, regionCounts, run, schedule, pending, cancel, tick };

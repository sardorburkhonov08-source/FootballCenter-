// ❤️ Donat: tasdiqlashdan keyingi minnatdorchilik, ruxsat so'rash va kanalga e'lon
const db = require('../db/pool');
const { t, money } = require('../i18n');
const settings = require('./settings');
const users = require('./users');
const notify = require('./notify');

/** Admin tasdiqlagach foydalanuvchiga yuboriladigan xabarlar */
async function afterApproved(api, donation) {
  const user = await users.byId(donation.user_id);
  const lang = user.language || 'uz';
  const name = users.displayName(user);
  const prev = await db.one(
    "SELECT count(*)::int AS c FROM donations WHERE user_id = $1 AND status = 'approved' AND id <> $2", [user.id, donation.id],
  );
  const threshold = Number(await settings.get('donation_big_threshold'));
  let key = 'donate_thanks_repeat';
  if (prev.c === 0) key = Number(donation.amount) > threshold ? 'donate_thanks_first_big' : 'donate_thanks_first_small';
  await notify.toUser(user, key, { name });

  const timeout = Number(await settings.get('donation_announce_timeout_minutes'));
  await db.query("UPDATE donations SET announce_deadline = now() + ($2 || ' minutes')::interval WHERE id = $1", [donation.id, String(timeout)]);
  await notify.toUser(user, 'donate_announce_ask', { name }, {
    extra: {
      reply_markup: {
        inline_keyboard: [[
          { text: t(lang, 'btn_announce_yes'), callback_data: `dn:ann:yes:${donation.id}` },
          { text: t(lang, 'btn_announce_anon'), callback_data: `dn:ann:anon:${donation.id}` },
        ]],
      },
    },
  });
}

/**
 * Foydalanuvchi tanlovi (yoki muddat tugashi) — bir marta. Har ikki holatda kanalga post ketadi.
 * Qaytadi: yangilangan donation yoki null (allaqachon hal qilingan).
 */
async function decideAnnouncement(api, donationId, anonymous) {
  const d = await db.one(
    `UPDATE donations SET is_anonymous = $2 WHERE id = $1 AND status = 'approved' AND is_anonymous IS NULL RETURNING *`,
    [donationId, anonymous],
  );
  if (!d) return null;
  await postToChannel(api, d);
  return d;
}

async function postToChannel(api, d) {
  const channel = await settings.get('donation_channel_id');
  if (!channel || !api) {
    console.warn('[donation] donat kanali sozlanmagan — post yuborilmadi');
    return false;
  }
  const user = await users.byId(d.user_id);
  const text = t('uz', 'donation_channel_post', {
    name: d.is_anonymous ? t('uz', 'anonymous') : users.displayName(user),
    amount: money(d.amount),
    comment_line: d.comment ? { __html: t('uz', 'donation_channel_comment', { comment: d.comment }) } : '',
  });
  try {
    await api.sendMessage(channel, text, { parse_mode: 'HTML' });
    await db.query('UPDATE donations SET announced_in_channel = true WHERE id = $1', [d.id]);
    return true;
  } catch (e) {
    console.error(`[donation] kanalga post: ${e.description || e.message}`);
    return false;
  }
}

/** Muddati o'tgan javobsiz e'lonlar -> avtomatik anonim */
async function processExpired(api) {
  const rows = await db.many(
    "SELECT id FROM donations WHERE status = 'approved' AND is_anonymous IS NULL AND announce_deadline < now()",
  );
  for (const r of rows) {
    const d = await decideAnnouncement(api, r.id, true);
    if (d) await notify.toUser(await users.byId(d.user_id), 'donate_announce_late');
  }
  return rows.length;
}

module.exports = { afterApproved, decideAnnouncement, postToChannel, processExpired };

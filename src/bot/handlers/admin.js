// 🔒 Bot Admin Panel — faqat admin/ega. Ega va admin bir xil, to'liq huquqqa ega.
const { InputFile } = require('grammy');
const db = require('../../db/pool');
const config = require('../../config');
const { t, raw, money, escapeHtml, LANGS, LANG_NAMES } = require('../../i18n');
const { translit } = require('../../i18n/translit');
const settings = require('../../services/settings');
const users = require('../../services/users');
const notify = require('../../services/notify');
const promo = require('../../services/promo');
const donations = require('../../services/donations');
const fancard = require('../../services/fancard');
const { formatDate, formatDateTime, parseDate, dayStart, ymd } = require('../../services/time');
const state = require('../state');
const ui = require('../ui');
const { CARD_LABEL, formatCardNumber } = require('./balance');
const { RULE_KEYS, tariffLabel } = require('./sections');

// ---------- Sozlamalar muharriri (umumiy)
const BOOL_KEYS = ['force_sub_enabled', 'referral_enabled', 'referral_fake_protection', 'maintenance_mode'];
const TEXT_KEYS = ['donation_channel_id'];
const MIN1_KEYS = ['premium_price', 'premium_days', 'bonus_free_per_day', 'bonus_premium_per_day', 'referral_league_premium_days',
  'donation_announce_timeout_minutes', 'fan_card_club_change_price', 'fan_card_first_fans'];
const MIN_MAX = [['bonus_free_min', 'bonus_free_max'], ['bonus_premium_min', 'bonus_premium_max']];

const SECTIONS = {
  referral: { title: 'a_btn_referral', keys: ['referral_enabled', 'referral_bonus_free', 'referral_bonus_premium', 'referral_fake_protection', 'referral_league_premium_days'] },
  bonus: { title: 'a_btn_bonus', keys: ['bonus_free_min', 'bonus_free_max', 'bonus_free_per_day', 'bonus_premium_min', 'bonus_premium_max', 'bonus_premium_per_day'] },
  donation: { title: 'a_btn_donation', keys: ['donation_channel_id', 'donation_big_threshold', 'donation_announce_timeout_minutes'] },
  tariff: { title: 'a_btn_tariff', keys: ['premium_price', 'premium_days', 'ai_limit_free', 'ai_limit_premium'] },
  maintenance: { title: 'a_btn_maintenance', keys: ['maintenance_mode'] },
  forcesub: { title: 'a_btn_forcesub', keys: ['force_sub_enabled'] },
  fancard: { title: 'a_btn_fancard_settings', keys: ['fan_card_club_change_price', 'fan_card_first_fans'] },
};

function fmtValue(lang, key, v) {
  if (BOOL_KEYS.includes(key)) return v ? t(lang, 'a_on') : t(lang, 'a_off');
  if (TEXT_KEYS.includes(key)) return v ? String(v) : t(lang, 'a_none');
  return money(v);
}

async function renderSection(ctx, name) {
  const lang = ctx.lang;
  const sec = SECTIONS[name];
  const values = await settings.getMany(sec.keys);
  const list = sec.keys.map((k) => `• ${escapeHtml(t(lang, `a_set_${k}`))}: <b>${escapeHtml(fmtValue(lang, k, values[k]))}</b>`).join('\n');
  const rows = sec.keys.map((k) => [ui.btn(BOOL_KEYS.includes(k) ? `🔁 ${t(lang, `a_set_${k}`)}` : `✏️ ${t(lang, `a_set_${k}`)}`, `as:${name}:${k}`)]);
  let extraText = '';
  if (name === 'tariff') {
    rows.push([ui.btn(t(lang, 'a_btn_edit_compare'), 'at:tariff_compare'), ui.btn(t(lang, 'a_btn_edit_premium_desc'), 'at:premium_description')]);
  }
  if (name === 'forcesub') {
    const channels = (await settings.get('force_sub_channels')) || [];
    extraText = `\n\n${t(lang, 'a_forcesub_channels', { list: channels.length ? channels.map((c) => `• ${c.title || c.chat_id} (${c.chat_id})`).join('\n') : t(lang, 'a_none') })}`;
    rows.push([ui.btn(t(lang, 'a_btn_add_channel'), 'fs:add')]);
    channels.forEach((c, i) => rows.push([ui.btn(t(lang, 'a_btn_remove', { title: c.title || String(c.chat_id) }), `fs:rm:${i}`)]));
  }
  rows.push([ui.btn(t(lang, 'back'), 'm:admin')]);
  await ui.show(ctx, t(lang, 'a_section', { section: t(lang, sec.title), list: raw(list) }) + extraText, ui.kb(rows));
}

// ---------- Ekranlar
function adminMenuKb(lang) {
  const L = (k) => t(lang, k);
  const rows = [
    [ui.btn(L('a_btn_forcesub'), 'a:forcesub'), ui.btn(L('a_btn_cards'), 'a:cards')],
    [ui.btn(L('a_btn_payments'), 'a:payments'), ui.btn(L('a_btn_promos'), 'a:promos')],
    [ui.btn(L('a_btn_referral'), 'a:referral'), ui.btn(L('a_btn_bonus'), 'a:bonus')],
    [ui.btn(L('a_btn_donation'), 'a:donation'), ui.btn(L('a_btn_rules'), 'a:rules')],
    [ui.btn(L('a_btn_tariff'), 'a:tariff'), ui.btn(L('a_btn_tickets'), 'a:tickets')],
    [ui.btn(L('a_btn_faq'), 'a:faq'), ui.btn(L('a_btn_admins'), 'a:admins')],
    [ui.btn(L('a_btn_users'), 'a:users')],
    [ui.btn(L('a_btn_fancard_settings'), 'a:fancard')],
    [ui.btn(L('a_btn_maintenance'), 'a:maintenance')],
    [ui.btn(L('a_btn_stats'), 'a:stats'), ui.btn(L('a_btn_export'), 'a:export')],
    [ui.btn(L('a_btn_broadcast'), 'a:broadcast')],
  ];
  if (config.webAppUrl) rows.push([{ text: L('a_btn_webadmin'), web_app: { url: `${config.publicUrl}/admin/` } }]);
  rows.push([ui.btn(L('back'), 'm:menu')]);
  return ui.kb(rows);
}

async function showCards(ctx) {
  const lang = ctx.lang;
  const fmt = (cards) => settings.CARD_TYPES.map((c) => `• ${CARD_LABEL[c]}: ${cards[c] && cards[c].number ? `<code>${formatCardNumber(cards[c].number)}</code> — ${escapeHtml(cards[c].holder)}` : t(lang, 'a_none')}`).join('\n');
  const s = await settings.getMany(['cards_topup', 'cards_donation']);
  const rows = settings.CARD_TYPES.map((c) => [
    ui.btn(t(lang, 'a_btn_card_topup', { type: CARD_LABEL[c] }), `cd:topup:${c}`),
    ui.btn(t(lang, 'a_btn_card_donation', { type: CARD_LABEL[c] }), `cd:donation:${c}`),
  ]);
  rows.push([ui.btn(t(lang, 'back'), 'm:admin')]);
  await ui.show(ctx, t(lang, 'a_cards_title', { topup: raw(fmt(s.cards_topup || {})), donation: raw(fmt(s.cards_donation || {})) }), ui.kb(rows));
}

async function showPromos(ctx) {
  const lang = ctx.lang;
  const rows = await db.many('SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT 25');
  const list = rows.length ? rows.map((p) => t(lang, 'a_promo_line', {
    status: p.status === 'active' ? '🟢' : '⚪️', code: p.code,
    type: t(lang, p.type === 'premium' ? 'a_type_premium' : 'a_type_balance', { value: money(p.value) }),
    used: p.used_count, max: p.max_uses, from: formatDateTime(p.starts_at), to: formatDateTime(p.expires_at),
    premium: p.premium_only ? t(lang, 'a_premium_only_tag') : '',
  })).join('\n') : t(lang, 'a_none');
  const kbRows = [[ui.btn(t(lang, 'a_btn_promo_create'), 'pc:new')]];
  for (const p of rows) kbRows.push([ui.btn(t(lang, 'a_btn_promo_toggle', { code: p.code }), `pc:tg:${p.id}`), ui.btn(t(lang, 'a_btn_promo_delete', { code: p.code }), `pc:del:${p.id}`)]);
  kbRows.push([ui.btn(t(lang, 'back'), 'm:admin')]);
  await ui.show(ctx, `${t(lang, 'a_promos_title', { list: raw(list) })}\n\n${t(lang, 'a_promo_toggle_hint')}`, ui.kb(kbRows));
}

async function showFaq(ctx) {
  const lang = ctx.lang;
  const rows = await db.many('SELECT * FROM faq ORDER BY sort_order, id');
  const list = rows.length ? rows.map((r, i) => `${i + 1}. ${escapeHtml(r.q_uz || '')}`).join('\n') : t(lang, 'a_none');
  const kbRows = [[ui.btn(t(lang, 'a_btn_faq_add'), 'fq:add')]];
  kbRows.push(...ui.grid(rows.map((r, i) => ui.btn(t(lang, 'a_btn_faq_delete', { n: i + 1 }), `fq:del:${r.id}`)), 4));
  kbRows.push([ui.btn(t(lang, 'back'), 'm:admin')]);
  await ui.show(ctx, t(lang, 'a_faq_title', { count: rows.length, list: raw(list) }), ui.kb(kbRows));
}

async function showAdmins(ctx) {
  const lang = ctx.lang;
  const rows = await db.many('SELECT * FROM users WHERE is_admin OR telegram_id = ANY($1) ORDER BY registered_at', [config.adminIds]);
  const known = new Set(rows.map((r) => Number(r.telegram_id)));
  const lines = rows.map((u) => `• ${escapeHtml(users.displayName(u))} — <code>${u.telegram_id}</code>${users.isOwner(u) ? t(lang, 'a_owner_tag') : ''}`);
  for (const id of config.adminIds) if (!known.has(id)) lines.push(`• <code>${id}</code>${t(lang, 'a_owner_tag')}`);
  const kbRows = [[ui.btn(t(lang, 'a_btn_admin_add'), 'ad:add')]];
  for (const u of rows) if (!users.isOwner(u)) kbRows.push([ui.btn(t(lang, 'a_btn_remove', { title: users.displayName(u) }), `ad:rm:${u.telegram_id}`)]);
  kbRows.push([ui.btn(t(lang, 'back'), 'm:admin')]);
  await ui.show(ctx, t(lang, 'a_admins_title', { list: raw(lines.join('\n') || t(lang, 'a_none')) }), ui.kb(kbRows));
}

async function userCard(ctx, u) {
  const lang = ctx.lang;
  const text = t(lang, 'a_user_card', {
    name: users.displayName(u), username: u.username ? `@${u.username}` : t(lang, 'none'), tgid: u.telegram_id,
    lang: LANG_NAMES[u.language] || t(lang, 'none'), balance: money(u.balance), tariff: tariffLabel(lang, u),
    date: formatDate(u.registered_at), refs: await users.activeReferralCount(u.id),
    status: t(lang, u.is_blocked ? 'a_status_blocked' : 'a_status_active'),
  });
  const action = u.is_blocked ? ui.btn(t(lang, 'a_btn_unblock'), `us:u:${u.telegram_id}`) : ui.btn(t(lang, 'a_btn_block'), `us:b:${u.telegram_id}`);
  return ui.show(ctx, text, ui.kb([[action], [ui.btn(t(lang, 'a_btn_fancard'), `fc:v:${u.telegram_id}`)],
    [ui.btn(t(lang, 'a_btn_users'), 'a:users')], [ui.btn(t(lang, 'back'), 'm:admin')]]));
}

// ---------- 🪪 Muxlislik kartasi: nomaqbul rasmni o'chirish, xato ma'lumotni tuzatish
const FC_TEXT_FIELDS = { lastName: 'card_l_surname', firstName: 'card_l_name', birthYear: 'a_fancard_birth_year', since: 'card_l_since', goat: 'card_l_goat', player: 'card_l_player' };

async function fanCardAdmin(ctx, u) {
  const lang = ctx.lang;
  const c = await fancard.cardRow(u.id);
  const back = [ui.btn(t(lang, 'back'), `fc:u:${u.telegram_id}`)];
  if (!c) return ui.show(ctx, t(lang, 'a_fancard_none'), ui.kb([back]));
  const text = t(lang, 'a_fancard_info', {
    user: users.displayName(u), club: c.team_name, number: String(c.fan_number).padStart(6, '0'),
    last: c.last_name, first: c.first_name, year: c.birth_year, gender: t(lang, `card_gender_${c.gender}`),
    region: t(lang, `region_${c.region}`), since: c.fan_since, goat: c.goat, player: c.fav_player,
    photo: t(lang, c.photo_path ? 'a_fancard_photo_yes' : 'a_fancard_photo_no'), date: formatDate(c.activated_at),
  });
  const tg = u.telegram_id;
  const edit = (field, key) => ui.btn(`✏️ ${t(lang, key)}`, `fc:e:${tg}:${field}`);
  const rows = [
    [edit('lastName', 'card_l_surname'), edit('firstName', 'card_l_name')],
    [edit('birthYear', 'a_fancard_birth_year'), edit('gender', 'card_l_gender')],
    [edit('region', 'card_l_region'), edit('since', 'card_l_since')],
    [edit('goat', 'card_l_goat'), edit('player', 'card_l_player')],
    c.photo_path ? [ui.btn(t(lang, 'a_btn_fancard_photo_remove'), `fc:rp:${tg}`)] : null,
    back,
  ];
  return ui.show(ctx, text, ui.kb(rows));
}

async function stats(ctx) {
  const today = dayStart();
  const r = await db.one(
    `SELECT (SELECT count(*)::int FROM users) AS total,
            (SELECT count(*)::int FROM users WHERE registered_at >= $1) AS today,
            (SELECT count(*)::int FROM users WHERE premium_expires_at > now()) AS premium,
            (SELECT count(*)::int FROM premium_purchases WHERE source = 'purchase') AS purchases,
            (SELECT count(*)::int FROM users WHERE is_blocked) AS blocked,
            (SELECT COALESCE(sum(amount),0) FROM balance_topups WHERE status = 'approved') AS topups,
            (SELECT COALESCE(sum(amount),0) FROM donations WHERE status = 'approved') AS donations,
            (SELECT count(*)::int FROM webapp_visits WHERE visit_date = $2) AS visits`,
    [today, ymd()],
  );
  await ui.show(ctx, t(ctx.lang, 'a_stats', { ...r, topups: money(r.topups), donations: money(r.donations) }), ui.backKb(ctx.lang, 'm:admin'));
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : (v instanceof Date ? v.toISOString() : String(v));
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportUsers(ctx) {
  const rows = await db.many(`SELECT telegram_id, username, first_name, last_name, language, balance, points_manager, points_quiz,
      CASE WHEN premium_expires_at > now() THEN 'premium' ELSE 'free' END AS tariff, premium_expires_at, registered_at, is_blocked, is_admin,
      (SELECT count(*) FROM referrals r WHERE r.referrer_id = users.id AND r.is_active) AS active_referrals
    FROM users ORDER BY registered_at`);
  const cols = ['telegram_id', 'username', 'first_name', 'last_name', 'language', 'balance', 'points_manager', 'points_quiz', 'tariff',
    'premium_expires_at', 'registered_at', 'is_blocked', 'is_admin', 'active_referrals'];
  const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  await ctx.replyWithDocument(new InputFile(Buffer.from(csv, 'utf8'), `users_${ymd()}.csv`), { caption: t(ctx.lang, 'a_export_caption', { count: rows.length }) });
}

async function broadcastAudience() {
  const all = await db.many('SELECT * FROM users WHERE NOT is_blocked');
  return all.filter((u) => notify.isEnabled(u, 'news'));
}

async function runBroadcast(api, fromChatId, messageId, adminUser) {
  const audience = await broadcastAudience();
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
  await notify.sendRaw(adminUser.telegram_id, t(adminUser.language || 'uz', 'a_broadcast_done', { ok, fail }));
}

/** To'lov/donat so'rovi qayta ishlangach admin xabarini yangilash */
async function markProcessed(ctx, suffix) {
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (!msg) return;
  try {
    if (msg.caption !== undefined) await ctx.editMessageCaption({ caption: `${msg.caption}\n\n${suffix}`, reply_markup: { inline_keyboard: [] } });
    else await ctx.editMessageText(`${msg.text}\n\n${suffix}`, { reply_markup: { inline_keyboard: [] } });
  } catch (e) { /* e'tiborsiz */ }
}

async function approveTopup(ctx, id) {
  const lang = ctx.lang;
  const res = await db.tx(async (c) => {
    const r = await c.query("UPDATE balance_topups SET status = 'approved', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
    if (!r.rowCount) return null;
    await c.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [r.rows[0].user_id, r.rows[0].amount]);
    return r.rows[0];
  });
  if (!res) return ctx.answerCallbackQuery({ text: t(lang, 'a_already_processed'), show_alert: true });
  await ctx.answerCallbackQuery();
  await markProcessed(ctx, t(lang, 'a_approved_done', { admin: users.displayName(ctx.user) }));
  const u = await users.byId(res.user_id);
  await notify.toUser(u, 'topup_approved', { amount: money(res.amount) }, { kind: 'payment' });
  return undefined;
}

async function approveDonation(ctx, id) {
  const d = await db.one("UPDATE donations SET status = 'approved', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
  if (!d) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'a_already_processed'), show_alert: true });
  await ctx.answerCallbackQuery();
  await markProcessed(ctx, t(ctx.lang, 'a_approved_done', { admin: users.displayName(ctx.user) }));
  await donations.afterApproved(ctx.api, d);
  return undefined;
}

// ---------- Ro'yxatdan o'tkazish
function register(bot) {
  const admin = bot.filter((ctx) => users.isAdmin(ctx.user));
  const L = (ctx, k, p) => t(ctx.lang, k, p);

  admin.callbackQuery('m:admin', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    await ui.show(ctx, L(ctx, 'a_title'), adminMenuKb(ctx.lang));
  });

  admin.callbackQuery(/^a:(referral|bonus|donation|tariff|maintenance|forcesub|fancard)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    await renderSection(ctx, ctx.match[1]);
  });

  admin.callbackQuery(/^as:(\w+):(\w+)$/, async (ctx) => {
    const [, section, key] = ctx.match;
    if (!SECTIONS[section] || !SECTIONS[section].keys.includes(key)) return ctx.answerCallbackQuery();
    if (BOOL_KEYS.includes(key)) {
      await settings.set(key, !(await settings.get(key)));
      await ctx.answerCallbackQuery({ text: L(ctx, 'a_saved') });
      return renderSection(ctx, section);
    }
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_setting', { section, key });
    const hint = key === 'donation_channel_id' ? `\n\n${L(ctx, 'a_channel_value_hint')}` : '';
    return ui.show(ctx, L(ctx, 'a_enter_value', { label: L(ctx, `a_set_${key}`), current: fmtValue(ctx.lang, key, await settings.get(key)) }) + hint, ui.kb([[ui.btn(L(ctx, 'back'), `a:${section}`)]]));
  });

  // Majburiy obuna kanallari
  admin.callbackQuery('fs:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_channel_add');
    await ui.show(ctx, L(ctx, 'a_channel_enter'), ui.kb([[ui.btn(L(ctx, 'back'), 'a:forcesub')]]));
  });
  admin.callbackQuery(/^fs:rm:(\d+)$/, async (ctx) => {
    const channels = [...((await settings.get('force_sub_channels')) || [])];
    channels.splice(Number(ctx.match[1]), 1);
    await settings.set('force_sub_channels', channels);
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_deleted') });
    await renderSection(ctx, 'forcesub');
  });

  // Kartalar
  admin.callbackQuery('a:cards', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await showCards(ctx); });
  admin.callbackQuery(/^cd:(topup|donation):(\w+)$/, async (ctx) => {
    const [, purpose, type] = ctx.match;
    if (!settings.CARD_TYPES.includes(type)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_card_number', { purpose, type });
    return ui.show(ctx, L(ctx, 'a_card_number_enter', { type: CARD_LABEL[type] }), ui.kb([[ui.btn(L(ctx, 'back'), 'a:cards')]]));
  });

  // To'lovlar
  admin.callbackQuery('a:payments', async (ctx) => {
    await ctx.answerCallbackQuery();
    const tps = await db.many("SELECT * FROM balance_topups WHERE status = 'pending' ORDER BY created_at LIMIT 20");
    const dns = await db.many("SELECT * FROM donations WHERE status = 'pending' ORDER BY created_at LIMIT 20");
    if (!tps.length && !dns.length) return ui.show(ctx, L(ctx, 'a_payments_none'), ui.backKb(ctx.lang, 'm:admin'));
    await ui.show(ctx, L(ctx, 'a_payments_title', { topups: tps.length, donations: dns.length }), ui.backKb(ctx.lang, 'm:admin'));
    const lang = ctx.lang;
    for (const tp of tps) {
      const u = await users.byId(tp.user_id);
      await ctx.replyWithPhoto(tp.receipt_image, {
        caption: t(lang, 'a_topup_caption', { id: tp.id, user: users.displayName(u), tgid: u.telegram_id, type: CARD_LABEL[tp.card_type], amount: money(tp.amount), date: formatDateTime(tp.created_at) }),
        parse_mode: 'HTML',
        reply_markup: ui.kb([[ui.btn(t(lang, 'a_btn_approve'), `adm:tp:ok:${tp.id}`), ui.btn(t(lang, 'a_btn_reject'), `adm:tp:no:${tp.id}`)]]),
      }).catch((e) => console.warn(e.description || e.message));
    }
    for (const d of dns) {
      const u = await users.byId(d.user_id);
      await ctx.replyWithPhoto(d.receipt_image, {
        caption: t(lang, 'a_donation_caption', { id: d.id, user: users.displayName(u), tgid: u.telegram_id, type: CARD_LABEL[d.card_type], amount: money(d.amount), comment: d.comment || t(lang, 'none'), date: formatDateTime(d.created_at) }),
        parse_mode: 'HTML',
        reply_markup: ui.kb([[ui.btn(t(lang, 'a_btn_approve'), `adm:dn:ok:${d.id}`), ui.btn(t(lang, 'a_btn_reject'), `adm:dn:no:${d.id}`)]]),
      }).catch((e) => console.warn(e.description || e.message));
    }
    return undefined;
  });

  admin.callbackQuery(/^adm:tp:ok:(\d+)$/, (ctx) => approveTopup(ctx, Number(ctx.match[1])));
  admin.callbackQuery(/^adm:dn:ok:(\d+)$/, (ctx) => approveDonation(ctx, Number(ctx.match[1])));
  admin.callbackQuery(/^adm:(tp|dn):no:(\d+)$/, async (ctx) => {
    const [, kind, id] = ctx.match;
    const table = kind === 'tp' ? 'balance_topups' : 'donations';
    const row = await db.one(`SELECT status FROM ${table} WHERE id = $1`, [Number(id)]);
    if (!row || row.status !== 'pending') return ctx.answerCallbackQuery({ text: L(ctx, 'a_already_processed'), show_alert: true });
    await ctx.answerCallbackQuery();
    const msg = ctx.callbackQuery.message;
    await state.set(ctx.from.id, 'admin_reject', { kind, id: Number(id), chatId: msg && msg.chat.id, messageId: msg && msg.message_id, caption: msg && (msg.caption || msg.text) });
    return ctx.reply(L(ctx, 'a_reject_reason_enter', { id }), { reply_markup: ui.cancelKb(ctx.lang) });
  });

  // Promokodlar
  admin.callbackQuery('a:promos', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await showPromos(ctx); });
  admin.callbackQuery('pc:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_promo', { step: 'code' });
    await ui.show(ctx, L(ctx, 'a_promo_code_enter'), ui.kb([[ui.btn(L(ctx, 'back'), 'a:promos')]]));
  });
  admin.callbackQuery(/^pc:type:(premium|balance)$/, async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'admin_promo' || s.data.step !== 'type') return undefined;
    await state.set(ctx.from.id, 'admin_promo', { ...s.data, type: ctx.match[1], step: 'value' });
    return ui.show(ctx, L(ctx, ctx.match[1] === 'premium' ? 'a_promo_value_premium' : 'a_promo_value_balance'), ui.kb([[ui.btn(L(ctx, 'back'), 'a:promos')]]));
  });
  admin.callbackQuery(/^pc:po:(0|1)$/, async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'admin_promo' || s.data.step !== 'premium_only') return undefined;
    const d = s.data;
    const created = await promo.create({ code: d.code, type: d.type, value: d.value, maxUses: d.maxUses, startsAt: d.startsAt, expiresAt: d.expiresAt, premiumOnly: ctx.match[1] === '1' });
    await state.clear(ctx.from.id);
    await ui.show(ctx, L(ctx, 'a_promo_created', { code: created.code }), ui.kb([[ui.btn(L(ctx, 'a_btn_promos'), 'a:promos')]]));
    return undefined;
  });
  admin.callbackQuery(/^pc:tg:(\d+)$/, async (ctx) => {
    await db.query("UPDATE promo_codes SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END WHERE id = $1", [Number(ctx.match[1])]);
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_saved') });
    await showPromos(ctx);
  });
  admin.callbackQuery(/^pc:del:(\d+)$/, async (ctx) => {
    await db.query('DELETE FROM promo_codes WHERE id = $1', [Number(ctx.match[1])]);
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_deleted') });
    await showPromos(ctx);
  });

  // Qoidalar va tahrirlanadigan matnlar
  admin.callbackQuery('a:rules', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    await ui.show(ctx, L(ctx, 'a_rules_title'), ui.kb([...RULE_KEYS.map((k) => [ui.btn(L(ctx, `rule_${k}`), `ar:rules:${k}`)]), [ui.btn(L(ctx, 'back'), 'm:admin')]]));
  });
  admin.callbackQuery(/^at:(tariff_compare|premium_description)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ui.show(ctx, L(ctx, 'a_lang_choose'), ui.kb([...ui.grid(LANGS.map((l) => ui.btn(LANG_NAMES[l], `ar:texts:${ctx.match[1]}:${l}`))), [ui.btn(L(ctx, 'back'), 'a:tariff')]]));
  });
  admin.callbackQuery(/^ar:rules:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ui.show(ctx, L(ctx, 'a_lang_choose'), ui.kb([...ui.grid(LANGS.map((l) => ui.btn(LANG_NAMES[l], `ar:rules:${ctx.match[1]}:${l}`))), [ui.btn(L(ctx, 'back'), 'a:rules')]]));
  });
  admin.callbackQuery(/^ar:(rules|texts):(\w+?):(uz|uz_cyrl|ru|en)$/, async (ctx) => {
    const [, table, key, lang] = ctx.match;
    if (table === 'rules' && !RULE_KEYS.includes(key)) return ctx.answerCallbackQuery();
    if (table === 'texts' && !['tariff_compare', 'premium_description'].includes(key)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const row = await db.one(`SELECT text_${lang} AS v FROM ${table} WHERE key = $1`, [key]);
    await state.set(ctx.from.id, 'admin_text', { table, key, lang });
    return ui.show(ctx, L(ctx, 'a_text_enter', { lang: LANG_NAMES[lang], current: (row && row.v) || t(ctx.lang, 'a_none') }), ui.kb([[ui.btn(L(ctx, 'back'), table === 'rules' ? 'a:rules' : 'a:tariff')]]));
  });

  // Murojaatlar
  admin.callbackQuery('a:tickets', async (ctx) => {
    await ctx.answerCallbackQuery();
    const rows = await db.many("SELECT * FROM support_tickets WHERE status = 'pending' ORDER BY created_at LIMIT 20");
    await ui.show(ctx, L(ctx, 'a_tickets_title', { count: rows.length }), ui.backKb(ctx.lang, 'm:admin'));
    for (const tk of rows) {
      const u = await users.byId(tk.user_id);
      await ctx.reply(L(ctx, 'a_ticket', { id: tk.id, user: users.displayName(u), tgid: u.telegram_id, date: formatDateTime(tk.created_at), message: tk.message }),
        { ...ui.HTML, reply_markup: ui.kb([[ui.btn(L(ctx, 'a_btn_reply'), `adm:tk:${tk.id}`)]]) });
    }
  });
  admin.callbackQuery(/^adm:tk:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const tk = await db.one('SELECT status FROM support_tickets WHERE id = $1', [id]);
    if (!tk || tk.status !== 'pending') return ctx.answerCallbackQuery({ text: L(ctx, 'a_already_processed'), show_alert: true });
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_ticket_reply', { id });
    return ctx.reply(L(ctx, 'a_reply_enter', { id }), { reply_markup: ui.cancelKb(ctx.lang) });
  });

  // FAQ
  admin.callbackQuery('a:faq', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await showFaq(ctx); });
  admin.callbackQuery('fq:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_faq', { field: 'q', li: 0, values: {} });
    await ui.show(ctx, L(ctx, 'a_faq_q_enter', { lang: LANG_NAMES.uz }), ui.kb([[ui.btn(L(ctx, 'back'), 'a:faq')]]));
  });
  admin.callbackQuery('fq:skip', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'admin_faq') return undefined;
    return faqStep(ctx, s.data, null);
  });
  admin.callbackQuery(/^fq:del:(\d+)$/, async (ctx) => {
    await db.query('DELETE FROM faq WHERE id = $1', [Number(ctx.match[1])]);
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_deleted') });
    await showFaq(ctx);
  });

  // Adminlar
  admin.callbackQuery('a:admins', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await showAdmins(ctx); });
  admin.callbackQuery('ad:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_add');
    await ui.show(ctx, L(ctx, 'a_admin_enter'), ui.kb([[ui.btn(L(ctx, 'back'), 'a:admins')]]));
  });
  admin.callbackQuery(/^ad:rm:(\d+)$/, async (ctx) => {
    const u = await users.byTelegramId(Number(ctx.match[1]));
    if (!u) return ctx.answerCallbackQuery();
    if (users.isOwner(u)) return ctx.answerCallbackQuery({ text: L(ctx, 'a_cannot_remove_owner'), show_alert: true });
    await db.query('UPDATE users SET is_admin = false WHERE id = $1', [u.id]);
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_admin_removed', { user: users.displayName(u) }) });
    return showAdmins(ctx);
  });

  // Foydalanuvchilar
  admin.callbackQuery('a:users', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_user_search');
    await ui.show(ctx, L(ctx, 'a_user_search_enter'), ui.kb([[ui.btn(L(ctx, 'back'), 'm:admin')]]));
  });
  admin.callbackQuery(/^us:(b|u):(\d+)$/, async (ctx) => {
    const u = await users.byTelegramId(Number(ctx.match[2]));
    if (!u) return ctx.answerCallbackQuery();
    const block = ctx.match[1] === 'b';
    if (block && users.isAdmin(u)) return ctx.answerCallbackQuery({ text: L(ctx, 'a_cannot_block_admin'), show_alert: true });
    const updated = await db.one('UPDATE users SET is_blocked = $2 WHERE id = $1 RETURNING *', [u.id, block]);
    await ctx.answerCallbackQuery({ text: L(ctx, block ? 'a_blocked_done' : 'a_unblocked_done') });
    return userCard(ctx, updated);
  });

  // 🪪 Muxlislik kartasi
  const fcUser = async (ctx) => {
    const u = await users.byTelegramId(Number(ctx.match[1]));
    if (!u) await ctx.answerCallbackQuery({ text: L(ctx, 'a_user_not_found'), show_alert: true });
    return u;
  };
  admin.callbackQuery(/^fc:u:(\d+)$/, async (ctx) => {
    const u = await fcUser(ctx); if (!u) return undefined;
    await ctx.answerCallbackQuery(); await state.clear(ctx.from.id);
    return userCard(ctx, u);
  });
  admin.callbackQuery(/^fc:v:(\d+)$/, async (ctx) => {
    const u = await fcUser(ctx); if (!u) return undefined;
    await ctx.answerCallbackQuery(); await state.clear(ctx.from.id);
    return fanCardAdmin(ctx, u);
  });
  admin.callbackQuery(/^fc:rp:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return ui.show(ctx, L(ctx, 'a_fancard_photo_confirm'), ui.kb([[ui.btn(L(ctx, 'confirm_btn'), `fc:rpy:${ctx.match[1]}`), ui.btn(L(ctx, 'cancel_btn'), `fc:v:${ctx.match[1]}`)]]));
  });
  admin.callbackQuery(/^fc:rpy:(\d+)$/, async (ctx) => {
    const u = await fcUser(ctx); if (!u) return undefined;
    try { await fancard.adminRemovePhoto(u.id); } catch (e) { if (!(e instanceof fancard.CardError)) throw e; }
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_fancard_photo_removed') });
    await notify.toUser(u, 'fancard_photo_removed');
    return fanCardAdmin(ctx, u);
  });
  admin.callbackQuery(/^fc:e:(\d+):(\w+)$/, async (ctx) => {
    const u = await fcUser(ctx); if (!u) return undefined;
    await ctx.answerCallbackQuery();
    const field = ctx.match[2];
    const tg = u.telegram_id;
    const back = [ui.btn(L(ctx, 'back'), `fc:v:${tg}`)];
    if (field === 'gender') {
      return ui.show(ctx, L(ctx, 'a_fancard_choose', { field: L(ctx, 'card_l_gender') }),
        ui.kb([fancard.GENDERS.map((g) => ui.btn(L(ctx, `card_gender_${g}`), `fc:s:${tg}:gender:${g}`)), back]));
    }
    if (field === 'region') {
      const rows = [];
      for (let i = 0; i < fancard.REGIONS.length; i += 2) rows.push(fancard.REGIONS.slice(i, i + 2).map((r) => ui.btn(L(ctx, `region_${r}`), `fc:s:${tg}:region:${r}`)));
      rows.push(back);
      return ui.show(ctx, L(ctx, 'a_fancard_choose', { field: L(ctx, 'card_l_region') }), ui.kb(rows));
    }
    if (!FC_TEXT_FIELDS[field]) return undefined;
    await state.set(ctx.from.id, 'admin_fancard_edit', { tg, field });
    return ui.show(ctx, L(ctx, 'a_fancard_enter', { field: L(ctx, FC_TEXT_FIELDS[field]) }), ui.kb([back]));
  });
  admin.callbackQuery(/^fc:s:(\d+):(gender|region):(\w+)$/, async (ctx) => {
    const u = await fcUser(ctx); if (!u) return undefined;
    try {
      await fancard.adminUpdate(u.id, { [ctx.match[2]]: ctx.match[3] });
    } catch (e) {
      if (e instanceof fancard.CardError) return ctx.answerCallbackQuery({ text: L(ctx, 'a_fancard_bad'), show_alert: true });
      throw e;
    }
    await ctx.answerCallbackQuery({ text: L(ctx, 'a_fancard_saved') });
    return fanCardAdmin(ctx, u);
  });

  // Statistika, eksport
  admin.callbackQuery('a:stats', async (ctx) => { await ctx.answerCallbackQuery(); await stats(ctx); });
  admin.callbackQuery('a:export', async (ctx) => { await ctx.answerCallbackQuery(); await exportUsers(ctx); });

  // Broadcast
  admin.callbackQuery('a:broadcast', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'admin_broadcast');
    await ui.show(ctx, L(ctx, 'a_broadcast_enter'), ui.kb([[ui.btn(L(ctx, 'back'), 'm:admin')]]));
  });
  admin.callbackQuery('bc:go', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'admin_broadcast_confirm') return undefined;
    await state.clear(ctx.from.id);
    await ui.show(ctx, L(ctx, 'a_broadcast_started'), undefined);
    runBroadcast(ctx.api, s.data.chatId, s.data.messageId, ctx.user).catch((e) => console.error('[broadcast]', e));
    return undefined;
  });
}

// ---------- FAQ qo'shish bosqichlari: savol (4 til), so'ng javob (4 til)
async function faqStep(ctx, data, value) {
  const lang = LANGS[data.li];
  const values = { ...data.values };
  const col = `${data.field}_${lang}`;
  if (value) values[col] = value;
  else if (lang === 'uz_cyrl' && values[`${data.field}_uz`]) values[col] = translit(values[`${data.field}_uz`]);
  let { field, li } = data;
  li += 1;
  if (li >= LANGS.length) {
    if (field === 'q') { field = 'a'; li = 0; } else {
      await db.query(`INSERT INTO faq (q_uz, q_uz_cyrl, q_ru, q_en, a_uz, a_uz_cyrl, a_ru, a_en, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT COALESCE(max(sort_order),0)+1 FROM faq))`,
      [values.q_uz, values.q_uz_cyrl || null, values.q_ru || null, values.q_en || null, values.a_uz, values.a_uz_cyrl || null, values.a_ru || null, values.a_en || null]);
      await state.clear(ctx.from.id);
      return ctx.reply(t(ctx.lang, 'a_faq_added'), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'a_btn_faq'), 'a:faq')]]) });
    }
  }
  await state.set(ctx.from.id, 'admin_faq', { field, li, values });
  const nextLang = LANGS[li];
  const prompt = t(ctx.lang, field === 'q' ? 'a_faq_q_enter' : 'a_faq_a_enter', { lang: LANG_NAMES[nextLang] });
  const rows = nextLang === 'uz' ? [] : [[ui.btn(t(ctx.lang, 'skip_btn'), 'fq:skip')]];
  rows.push([ui.btn(t(ctx.lang, 'cancel_btn'), 'a:faq')]);
  return ctx.reply(nextLang === 'uz' ? prompt : `${prompt}\n${t(ctx.lang, 'a_faq_skip_hint')}`, { reply_markup: ui.kb(rows) });
}

function needText(ctx) {
  const text = ctx.message && ctx.message.text;
  return text ? text.trim() : '';
}

const states = {
  async admin_setting(ctx, { section, key }) {
    const text = needText(ctx);
    let value;
    if (TEXT_KEYS.includes(key)) {
      value = text;
      if (key === 'donation_channel_id' && !/^(@\w{4,}|-?\d{5,})$/.test(value)) return ctx.reply(t(ctx.lang, 'a_channel_value_hint'));
    } else {
      const n = Number(text.replace(/\s/g, ''));
      const min = MIN1_KEYS.includes(key) ? 1 : 0;
      if (!Number.isInteger(n) || n < min) return ctx.reply(t(ctx.lang, 'a_value_invalid'));
      value = n;
      const pair = MIN_MAX.find((p) => p.includes(key));
      if (pair) {
        const other = await settings.get(pair[0] === key ? pair[1] : pair[0]);
        const [lo, hi] = pair[0] === key ? [n, other] : [other, n];
        if (lo > hi) return ctx.reply(t(ctx.lang, 'a_min_max_invalid'));
      }
    }
    await settings.set(key, value);
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'a_saved'));
    return renderSection(ctx, section);
  },

  async admin_channel_add(ctx) {
    const [chatRef, invite] = needText(ctx).split(/\s+/);
    if (!chatRef) return ctx.reply(t(ctx.lang, 'a_channel_enter'));
    try {
      const chat = await ctx.api.getChat(/^-?\d+$/.test(chatRef) ? Number(chatRef) : chatRef);
      const me = await ctx.api.getChatMember(chat.id, ctx.me.id);
      if (!['administrator', 'creator'].includes(me.status)) throw new Error('not admin');
      const url = invite && /^https:\/\/t\.me\//.test(invite) ? invite : (chat.username ? `https://t.me/${chat.username}` : chat.invite_link);
      if (!url) throw new Error('no url');
      const channels = [...((await settings.get('force_sub_channels')) || [])].filter((c) => String(c.chat_id) !== String(chat.id));
      channels.push({ chat_id: chat.id, title: chat.title || chatRef, url });
      await settings.set('force_sub_channels', channels);
      await state.clear(ctx.from.id);
      await ctx.reply(t(ctx.lang, 'a_channel_added', { title: chat.title || chatRef }));
      return renderSection(ctx, 'forcesub');
    } catch (e) {
      return ctx.reply(t(ctx.lang, 'a_channel_bad'));
    }
  },

  async admin_card_number(ctx, data) {
    const text = needText(ctx);
    if (text === '-') {
      const key = data.purpose === 'donation' ? 'cards_donation' : 'cards_topup';
      const cards = { ...((await settings.get(key)) || {}) };
      delete cards[data.type];
      await settings.set(key, cards);
      await state.clear(ctx.from.id);
      await ctx.reply(t(ctx.lang, 'a_card_removed'));
      return showCards(ctx);
    }
    const digits = text.replace(/\D/g, '');
    if (digits.length !== 16 || /[^\d\s-]/.test(text)) return ctx.reply(t(ctx.lang, 'a_card_number_bad'));
    await state.set(ctx.from.id, 'admin_card_holder', { ...data, number: digits });
    return ctx.reply(t(ctx.lang, 'a_card_holder_enter'));
  },

  async admin_card_holder(ctx, data) {
    const holder = needText(ctx).slice(0, 100);
    if (!holder) return ctx.reply(t(ctx.lang, 'a_card_holder_enter'));
    const key = data.purpose === 'donation' ? 'cards_donation' : 'cards_topup';
    const cards = { ...((await settings.get(key)) || {}) };
    cards[data.type] = { number: data.number, holder };
    await settings.set(key, cards);
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'a_saved'));
    return showCards(ctx);
  },

  async admin_reject(ctx, data) {
    const reason = needText(ctx).slice(0, 500);
    if (!reason) return ctx.reply(t(ctx.lang, 'a_reject_reason_enter', { id: data.id }));
    const table = data.kind === 'tp' ? 'balance_topups' : 'donations';
    const row = await db.one(`UPDATE ${table} SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [data.id, reason]);
    await state.clear(ctx.from.id);
    if (!row) return ctx.reply(t(ctx.lang, 'a_already_processed'));
    const suffix = t(ctx.lang, 'a_rejected_done', { admin: users.displayName(ctx.user), reason });
    if (data.chatId && data.messageId) {
      await ctx.api.editMessageCaption(data.chatId, data.messageId, { caption: `${data.caption || ''}\n\n${suffix}`, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
    await ctx.reply(suffix);
    const u = await users.byId(row.user_id);
    await notify.toUser(u, data.kind === 'tp' ? 'topup_rejected' : 'donate_rejected', { reason }, { kind: 'payment' });
    return undefined;
  },

  async admin_promo(ctx, data) {
    const text = needText(ctx);
    const back = ui.kb([[ui.btn(t(ctx.lang, 'back'), 'a:promos')]]);
    const ask = (key) => ctx.reply(t(ctx.lang, key), { reply_markup: back });
    if (data.step === 'code') {
      if (!promo.CODE_RE.test(text)) return ask('a_promo_code_bad');
      if (await promo.exists(text)) return ask('a_promo_code_exists');
      await state.set(ctx.from.id, 'admin_promo', { step: 'type', code: text.toUpperCase() });
      return ctx.reply(t(ctx.lang, 'a_promo_type_choose'), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'a_btn_type_premium'), 'pc:type:premium'), ui.btn(t(ctx.lang, 'a_btn_type_balance'), 'pc:type:balance')]]) });
    }
    if (data.step === 'value' || data.step === 'max') {
      const n = Number(text.replace(/\s/g, ''));
      if (!Number.isInteger(n) || n < 1) return ask('a_value_invalid');
      if (data.step === 'value') { await state.set(ctx.from.id, 'admin_promo', { ...data, value: n, step: 'max' }); return ask('a_promo_max_enter'); }
      await state.set(ctx.from.id, 'admin_promo', { ...data, maxUses: n, step: 'start' });
      return ask('a_promo_start_enter');
    }
    if (data.step === 'start') {
      const d = parseDate(text);
      if (!d) return ask('a_date_bad');
      await state.set(ctx.from.id, 'admin_promo', { ...data, startsAt: d.toISOString(), step: 'end' });
      return ask('a_promo_end_enter');
    }
    if (data.step === 'end') {
      const d = parseDate(text, true);
      if (!d) return ask('a_date_bad');
      if (d <= new Date(data.startsAt)) return ask('a_promo_end_before');
      await state.set(ctx.from.id, 'admin_promo', { ...data, expiresAt: d.toISOString(), step: 'premium_only' });
      return ctx.reply(t(ctx.lang, 'a_promo_premium_only_ask'), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'a_btn_yes'), 'pc:po:1'), ui.btn(t(ctx.lang, 'a_btn_no'), 'pc:po:0')]]) });
    }
    return undefined;
  },

  async admin_text(ctx, { table, key, lang }) {
    const text = needText(ctx);
    if (!text) return undefined;
    await db.query(`INSERT INTO ${table} (key, text_${lang}) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET text_${lang} = EXCLUDED.text_${lang}`, [key, text.slice(0, 3800)]);
    await state.clear(ctx.from.id);
    return ctx.reply(t(ctx.lang, 'a_saved'), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'back'), table === 'rules' ? 'a:rules' : 'a:tariff')]]) });
  },

  async admin_ticket_reply(ctx, { id }) {
    const reply = needText(ctx);
    if (!reply) return undefined;
    const tk = await db.one("UPDATE support_tickets SET admin_reply = $2, status = 'answered', answered_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [id, reply.slice(0, 3500)]);
    await state.clear(ctx.from.id);
    if (!tk) return ctx.reply(t(ctx.lang, 'a_already_processed'));
    const u = await users.byId(tk.user_id);
    await notify.toUser(u, 'problem_answer', { reply });
    return ctx.reply(t(ctx.lang, 'a_reply_sent'), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'a_btn_tickets'), 'a:tickets')]]) });
  },

  async admin_faq(ctx, data) {
    const text = needText(ctx);
    if (!text) return undefined;
    return faqStep(ctx, data, text.slice(0, 2000));
  },

  async admin_add(ctx) {
    const u = await users.find(needText(ctx));
    if (!u) return ctx.reply(t(ctx.lang, 'a_user_not_found'));
    await db.query('UPDATE users SET is_admin = true, is_blocked = false WHERE id = $1', [u.id]);
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'a_admin_added', { user: users.displayName(u) }));
    return showAdmins(ctx);
  },

  async admin_user_search(ctx) {
    const u = await users.find(needText(ctx));
    if (!u) return ctx.reply(t(ctx.lang, 'a_user_not_found'));
    await state.clear(ctx.from.id);
    return userCard(ctx, u);
  },

  async admin_fancard_edit(ctx, { tg, field }) {
    const text = needText(ctx);
    const u = await users.byTelegramId(tg);
    if (!u) { await state.clear(ctx.from.id); return ctx.reply(t(ctx.lang, 'a_user_not_found')); }
    try {
      await fancard.adminUpdate(u.id, { [field]: text });
    } catch (e) {
      if (e instanceof fancard.CardError) return ctx.reply(t(ctx.lang, 'a_fancard_bad'));
      throw e;
    }
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'a_fancard_saved'));
    return fanCardAdmin(ctx, u);
  },

  async admin_broadcast(ctx) {
    const count = (await broadcastAudience()).length;
    await state.set(ctx.from.id, 'admin_broadcast_confirm', { chatId: ctx.chat.id, messageId: ctx.message.message_id });
    return ctx.reply(t(ctx.lang, 'a_broadcast_confirm', { count }), { reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'confirm_btn'), 'bc:go'), ui.btn(t(ctx.lang, 'cancel_btn'), 'm:admin')]]) });
  },

  async admin_broadcast_confirm(ctx) {
    return states.admin_broadcast(ctx);
  },
};

module.exports = { register, states, SECTIONS, runBroadcast, broadcastAudience };

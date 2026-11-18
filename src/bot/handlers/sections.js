// 👤 Profil, 📜 Qoidalar, 💎 Tarif, ⚙️ Sozlamalar, 🆘 Yordam, 🤖 AI Yordamchi
const db = require('../../db/pool');
const { t, raw, money, escapeHtml, pickLang, LANG_NAMES, LANG_PROMPT } = require('../../i18n');
const settings = require('../../services/settings');
const users = require('../../services/users');
const notify = require('../../services/notify');
const premium = require('../../services/premium');
const ai = require('../../services/ai');
const { formatDate, formatDateTime } = require('../../services/time');
const state = require('../state');
const ui = require('../ui');

const RULE_KEYS = ['general', 'user', 'premium', 'bonus', 'ai', 'privacy', 'block', 'copyright'];

function tariffLabel(lang, user) {
  return users.isPremium(user) ? t(lang, 'tariff_premium_left', { days: users.premiumDaysLeft(user) }) : t(lang, 'tariff_free');
}

/** Admin tahrirlagan matn (texts jadvali) yoki standart */
async function editableText(key, lang, fallbackKey) {
  const row = await db.one('SELECT * FROM texts WHERE key = $1', [key]);
  const v = pickLang(row, 'text', lang);
  return v ? escapeHtml(v) : t(lang, fallbackKey);
}

async function sendTicketToAdmins(api, ticket, user) {
  for (const adminId of await notify.adminIds()) {
    const admin = await users.byTelegramId(adminId);
    const lang = (admin && admin.language) || 'uz';
    await notify.sendRaw(adminId, t(lang, 'a_ticket', {
      id: ticket.id, user: users.displayName(user) + (user.username ? ` (@${user.username})` : ''), tgid: user.telegram_id,
      date: formatDateTime(ticket.created_at), message: ticket.message,
    }), { reply_markup: ui.kb([[ui.btn(t(lang, 'a_btn_reply'), `adm:tk:${ticket.id}`)]]) });
  }
}

async function aiScreen(ctx) {
  const left = await ai.remaining(ctx.user);
  return ui.show(ctx, t(ctx.lang, 'ai_title', { left }), ui.kb([[ui.btn(t(ctx.lang, 'btn_ask'), 'ai:ask')], [ui.btn(t(ctx.lang, 'back'), 'm:menu')]]));
}

function notifKb(lang, user) {
  const premiumUser = users.isPremium(user);
  const rows = notify.NOTIFICATIONS.map((n) => {
    let mark;
    if (n.mode === 'always') mark = '✅';
    else if (n.mode === 'premium' && !premiumUser) mark = '🔒';
    else mark = notify.isEnabled(user, n.key) ? '✅' : '❌';
    return [ui.btn(`${mark} ${t(lang, `notif_${n.key}`)}`, `nt:${n.key}`)];
  });
  rows.push([ui.btn(t(lang, 'back'), 'm:settings')]);
  return ui.kb(rows);
}

function register(bot) {
  // ---- 👤 Profil (faqat ko'rish)
  bot.callbackQuery('m:profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    const u = await users.byId(ctx.user.id);
    const lang = ctx.lang;
    await ui.show(ctx, t(lang, 'profile', {
      name: users.displayName(u), username: u.username ? `@${u.username}` : t(lang, 'none'), id: u.telegram_id,
      lang: LANG_NAMES[u.language] || t(lang, 'none'), balance: money(u.balance), points: (u.points_manager || 0) + (u.points_quiz || 0), // umumiy: Mini Manager + Quiz
      tariff: tariffLabel(lang, u), date: formatDate(u.registered_at), refs: await users.activeReferralCount(u.id),
    }), ui.backKb(lang));
  });

  // ---- 📜 Qoidalar
  bot.callbackQuery('m:rules', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.lang;
    await ui.show(ctx, t(lang, 'rules_title'), ui.kb([...RULE_KEYS.map((k) => [ui.btn(t(lang, `rule_${k}`), `rule:${k}`)]), [ui.btn(t(lang, 'back'), 'm:menu')]]));
  });

  bot.callbackQuery(/^rule:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1];
    if (!RULE_KEYS.includes(key)) return undefined;
    const row = await db.one('SELECT * FROM rules WHERE key = $1', [key]);
    const text = pickLang(row, 'text', ctx.lang);
    const body = text ? `${t(ctx.lang, `rule_${key}`)}\n\n${escapeHtml(text)}` : `${t(ctx.lang, `rule_${key}`)}\n\n${t(ctx.lang, 'rule_empty')}`;
    if (body.length > 4000) return ui.replyLong(ctx, body, ui.backKb(ctx.lang, 'm:rules'));
    return ui.show(ctx, body, ui.backKb(ctx.lang, 'm:rules'));
  });

  // ---- 💎 Tarif
  bot.callbackQuery('m:tariff', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.lang;
    const u = await users.byId(ctx.user.id);
    await ui.show(ctx, t(lang, 'tariff_title', { tariff: users.isPremium(u) ? t(lang, 'tariff_premium') : t(lang, 'tariff_free') }), ui.kb([
      [ui.btn(t(lang, 'btn_tariff_free'), 'tf:free')],
      [ui.btn(t(lang, 'btn_tariff_premium'), 'tf:premium')],
      [ui.btn(t(lang, 'back'), 'm:menu')],
    ]));
  });

  bot.callbackQuery('tf:free', async (ctx) => {
    await ctx.answerCallbackQuery();
    const u = await users.byId(ctx.user.id);
    const text = users.isPremium(u) ? t(ctx.lang, 'tariff_free_info_premium', { date: formatDate(u.premium_expires_at) }) : t(ctx.lang, 'tariff_free_info');
    await ui.show(ctx, text, ui.backKb(ctx.lang, 'm:tariff'));
  });

  bot.callbackQuery('tf:premium', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPremiumInfo(ctx);
  });

  // tf:buy — eski xabarlardagi tugma (30 kunlik)
  bot.callbackQuery(/^tf:buy(?::(week|month))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await premium.buy(ctx.user, ctx.match[1] || 'month');
    if (!r.ok) return showNoMoney(ctx);
    return ui.show(ctx, t(ctx.lang, 'premium_activated', { price: money(r.price), date: formatDate(r.user.premium_expires_at) }), ui.backKb(ctx.lang));
  });

  // ---- 🎁 Do'stga Premium sovg'a qilish: tarif → do'st (@username / ID) → tasdiqlash
  bot.callbackQuery('tf:gift', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    const p = await premium.plans();
    await ui.show(ctx, t(ctx.lang, 'gift_choose_plan'), ui.kb([
      ...Object.values(p).map((x) => [ui.btn(t(ctx.lang, 'btn_buy_plan', { days: x.days, price: money(x.price) }), `tf:gift:${x.plan}`)]),
      [ui.btn(t(ctx.lang, 'back'), 'tf:premium')],
    ]));
  });

  bot.callbackQuery(/^tf:gift:(week|month)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'premium_gift', { plan: ctx.match[1] });
    await ui.show(ctx, t(ctx.lang, 'gift_enter_friend'), ui.cancelKb(ctx.lang));
  });

  bot.callbackQuery('tf:giftok', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = await state.get(ctx.from.id);
    if (!s || s.state !== 'premium_gift_confirm') return showPremiumInfo(ctx);
    await state.clear(ctx.from.id);
    const r = await premium.gift(ctx.user, s.data.to, s.data.plan);
    if (!r.ok) {
      if (r.reason === 'no_money') return showNoMoney(ctx);
      return showPremiumInfo(ctx);
    }
    const date = formatDate(r.to.premium_expires_at);
    await ui.show(ctx, t(ctx.lang, 'gift_sent', { name: users.displayName(r.to), date, price: money(r.price) }), ui.backKb(ctx.lang));
    await notify.toUser(r.to, 'gift_received', { name: users.displayName(r.from), days: r.days, date: date });
    return undefined;
  });

  // ---- ⚙️ Sozlamalar
  bot.callbackQuery('m:settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.lang;
    await ui.show(ctx, t(lang, 'settings_title'), ui.kb([
      [ui.btn(t(lang, 'btn_change_lang'), 'set:lang')],
      [ui.btn(t(lang, 'btn_notifications'), 'set:notif')],
      [ui.btn(t(lang, 'back'), 'm:menu')],
    ]));
  });

  bot.callbackQuery('set:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ui.show(ctx, LANG_PROMPT, ui.langKb());
  });

  bot.callbackQuery('set:notif', async (ctx) => {
    await ctx.answerCallbackQuery();
    const u = await users.byId(ctx.user.id);
    await ui.show(ctx, `${t(ctx.lang, 'notif_title')}\n\n${t(ctx.lang, 'notif_match_hint')}`, notifKb(ctx.lang, u));
  });

  bot.callbackQuery(/^nt:(\w+)$/, async (ctx) => {
    const key = ctx.match[1];
    const def = notify.NOTIFICATIONS.find((n) => n.key === key);
    if (!def) return ctx.answerCallbackQuery();
    const u = await users.byId(ctx.user.id);
    const premiumUser = users.isPremium(u);
    if (def.mode === 'always' || (def.mode === 'freeAlways' && !premiumUser)) {
      return ctx.answerCallbackQuery({ text: t(ctx.lang, 'notif_always_on'), show_alert: true });
    }
    if (def.mode === 'premium' && !premiumUser) {
      return ctx.answerCallbackQuery({ text: t(ctx.lang, 'notif_locked'), show_alert: true });
    }
    const updated = await notify.toggle(u, key);
    await ctx.answerCallbackQuery();
    return ui.show(ctx, `${t(ctx.lang, 'notif_title')}\n\n${t(ctx.lang, 'notif_match_hint')}`, notifKb(ctx.lang, updated));
  });

  // ---- 🆘 Yordam
  bot.callbackQuery('m:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    const lang = ctx.lang;
    await ui.show(ctx, t(lang, 'help_title'), ui.kb([
      [ui.btn(t(lang, 'btn_write_problem'), 'hp:write')],
      [ui.btn(t(lang, 'btn_faq'), 'hp:faq')],
      [ui.btn(t(lang, 'back'), 'm:menu')],
    ]));
  });

  bot.callbackQuery('hp:write', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'support_message');
    await ui.show(ctx, t(ctx.lang, 'problem_enter'), ui.cancelKb(ctx.lang));
  });

  bot.callbackQuery('hp:faq', async (ctx) => {
    await ctx.answerCallbackQuery();
    const rows = await db.many('SELECT * FROM faq ORDER BY sort_order, id');
    const back = ui.backKb(ctx.lang, 'm:help');
    if (!rows.length) return ui.show(ctx, `${t(ctx.lang, 'faq_title')}\n\n${t(ctx.lang, 'faq_empty')}`, back);
    const body = rows.map((r, i) => `<b>${i + 1}. ${escapeHtml(pickLang(r, 'q', ctx.lang) || '')}</b>\n${escapeHtml(pickLang(r, 'a', ctx.lang) || '')}`).join('\n\n');
    const text = `${t(ctx.lang, 'faq_title')}\n\n${body}`;
    if (text.length > 4000) return ui.replyLong(ctx, text, back);
    return ui.show(ctx, text, back);
  });

  // ---- 🤖 AI Yordamchi
  bot.callbackQuery('m:ai', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await aiScreen(ctx); });

  bot.callbackQuery('ai:ask', async (ctx) => {
    await ctx.answerCallbackQuery();
    if ((await ai.remaining(ctx.user)) <= 0) {
      const key = users.isPremium(ctx.user) ? 'ai_limit_premium' : 'ai_limit_free';
      const markup = users.isPremium(ctx.user) ? ui.backKb(ctx.lang) : ui.kb([[ui.btn(t(ctx.lang, 'btn_buy_premium'), 'tf:premium')], [ui.btn(t(ctx.lang, 'back'), 'm:menu')]]);
      return ui.show(ctx, t(ctx.lang, key), markup);
    }
    await state.set(ctx.from.id, 'ai_question');
    return ui.show(ctx, t(ctx.lang, 'ai_enter'), ui.cancelKb(ctx.lang));
  });
}

const states = {
  async premium_gift(ctx, data) {
    const lang = ctx.lang;
    const friend = await users.find(ctx.message.text);
    if (!friend || friend.is_blocked) return ctx.reply(t(lang, 'gift_not_found'), { reply_markup: ui.cancelKb(lang) });
    if (friend.id === ctx.user.id) return ctx.reply(t(lang, 'gift_self'), { reply_markup: ui.cancelKb(lang) });
    const plan = await premium.planInfo(data.plan);
    await state.set(ctx.from.id, 'premium_gift_confirm', { plan: plan.plan, to: friend.id });
    return ctx.reply(t(lang, 'gift_confirm', { name: users.displayName(friend), days: plan.days, price: money(plan.price) }), {
      ...ui.HTML,
      reply_markup: ui.kb([[ui.btn(t(lang, 'btn_gift_confirm'), 'tf:giftok')], [ui.btn(t(lang, 'back'), 'tf:premium')]]),
    });
  },

  async support_message(ctx) {
    const text = String(ctx.message.text || '').trim();
    if (!text) return ctx.reply(t(ctx.lang, 'problem_enter'), { reply_markup: ui.cancelKb(ctx.lang) });
    const ticket = await db.one('INSERT INTO support_tickets (user_id, message) VALUES ($1, $2) RETURNING *', [ctx.user.id, text.slice(0, 3500)]);
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'problem_sent'), { reply_markup: ui.backKb(ctx.lang, 'm:help') });
    await sendTicketToAdmins(ctx.api, ticket, ctx.user);
    return undefined;
  },

  async ai_question(ctx) {
    const text = String(ctx.message.text || '').trim();
    if (!text) return ctx.reply(t(ctx.lang, 'ai_enter'), { reply_markup: ui.cancelKb(ctx.lang) });
    await state.clear(ctx.from.id);
    const lang = ctx.lang;
    const after = ui.kb([[ui.btn(t(lang, 'btn_ask'), 'ai:ask')], [ui.btn(t(lang, 'back'), 'm:menu')]]);
    const waiting = await ctx.reply(t(lang, 'ai_thinking'));
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
    const r = await ai.ask(ctx.user, text, lang);
    let out;
    if (r.status === 'limit') out = t(lang, users.isPremium(ctx.user) ? 'ai_limit_premium' : 'ai_limit_free');
    else if (r.status === 'off_topic') out = t(lang, 'ai_off_topic');
    else if (r.status === 'unavailable') out = t(lang, 'ai_unavailable');
    else out = t(lang, 'ai_answer', { answer: r.answer, left: await ai.remaining(ctx.user) });
    await ctx.api.deleteMessage(ctx.chat.id, waiting.message_id).catch(() => {});
    return ui.replyLong(ctx, out, after);
  },
};

/** 💎 Premium haqida va sotib olish tugmasi (Mini App'dan ?start=premium havolasi ham shu sahifani ochadi) */
async function showPremiumInfo(ctx) {
  const lang = ctx.lang;
  const p = await premium.plans();
  const description = await editableText('premium_description', lang, 'premium_description_default');
  await ui.show(ctx, t(lang, 'premium_info', {
    week_days: p.week.days, week_price: money(p.week.price), days: p.month.days, price: money(p.month.price), description: raw(description),
  }), ui.kb([
    ...Object.values(p).map((x) => [ui.btn(t(lang, 'btn_buy_plan', { days: x.days, price: money(x.price) }), `tf:buy:${x.plan}`)]),
    [ui.btn(t(lang, 'btn_gift_premium'), 'tf:gift')],
    [ui.btn(t(lang, 'back'), 'm:tariff')],
  ]));
}

function showNoMoney(ctx) {
  return ui.show(ctx, t(ctx.lang, 'premium_no_money'), ui.kb([[ui.btn(t(ctx.lang, 'btn_topup'), 'bal:topup')], [ui.btn(t(ctx.lang, 'back'), 'tf:premium')]]));
}

module.exports = { register, states, RULE_KEYS, tariffLabel, showPremiumInfo };

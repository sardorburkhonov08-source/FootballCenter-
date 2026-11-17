// ❤️ Donat oqimi
const db = require('../../db/pool');
const { t, money } = require('../../i18n');
const settings = require('../../services/settings');
const users = require('../../services/users');
const notify = require('../../services/notify');
const donations = require('../../services/donations');
const { formatDateTime } = require('../../services/time');
const state = require('../state');
const ui = require('../ui');
const { parseAmount, CARD_LABEL, cardKb, formatCardNumber } = require('./balance');

const COMMENT_MAX = 200;

async function showSummary(ctx, data) {
  await state.set(ctx.from.id, 'donate_final', data);
  const lang = ctx.lang;
  const text = t(lang, 'donate_summary', { amount: money(data.amount), type: CARD_LABEL[data.card], comment: data.comment || t(lang, 'none') });
  const markup = ui.kb([[ui.btn(t(lang, 'confirm_btn'), 'dn:send'), ui.btn(t(lang, 'cancel_btn'), 'cancel')]]);
  if (ctx.callbackQuery) return ui.show(ctx, text, markup);
  return ctx.reply(text, { ...ui.HTML, reply_markup: markup });
}

async function sendDonationToAdmins(api, d, user) {
  for (const adminId of await notify.adminIds()) {
    const admin = await users.byTelegramId(adminId);
    const lang = (admin && admin.language) || 'uz';
    try {
      await api.sendPhoto(adminId, d.receipt_image, {
        caption: t(lang, 'a_donation_caption', {
          id: d.id, user: users.displayName(user) + (user.username ? ` (@${user.username})` : ''), tgid: user.telegram_id,
          type: CARD_LABEL[d.card_type], amount: money(d.amount), comment: d.comment || t(lang, 'none'), date: formatDateTime(d.created_at),
        }),
        parse_mode: 'HTML',
        reply_markup: ui.kb([[ui.btn(t(lang, 'a_btn_approve'), `adm:dn:ok:${d.id}`), ui.btn(t(lang, 'a_btn_reject'), `adm:dn:no:${d.id}`)]]),
      });
    } catch (e) { console.warn(`[admin notify] ${adminId}: ${e.description || e.message}`); }
  }
}

function register(bot) {
  bot.callbackQuery('m:donate', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.clear(ctx.from.id);
    await ui.show(ctx, t(ctx.lang, 'donate_title'), cardKb(ctx.lang, 'dn:card', 'm:menu'));
  });

  bot.callbackQuery(/^dn:card:(\w+)$/, async (ctx) => {
    const type = ctx.match[1];
    const card = settings.CARD_TYPES.includes(type) ? await settings.getCard('donation', type) : null;
    if (!card) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'card_unavailable'), show_alert: true });
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'donate_amount', { card: type });
    return ui.show(ctx, t(ctx.lang, 'donate_card_info', { type: CARD_LABEL[type], number: formatCardNumber(card.number), holder: card.holder }), ui.cancelKb(ctx.lang));
  });

  bot.callbackQuery('dn:amt_ok', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'donate_amount_confirm') return ui.showMenu(ctx);
    await state.set(ctx.from.id, 'donate_receipt', s.data);
    return ui.show(ctx, t(ctx.lang, 'donate_send_receipt'), ui.cancelKb(ctx.lang));
  });

  bot.callbackQuery('dn:cmt', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'donate_comment_choice') return ui.showMenu(ctx);
    await state.set(ctx.from.id, 'donate_comment', s.data);
    return ui.show(ctx, t(ctx.lang, 'donate_comment_enter'), ui.cancelKb(ctx.lang));
  });

  bot.callbackQuery('dn:skip', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'donate_comment_choice') return ui.showMenu(ctx);
    return showSummary(ctx, { ...s.data, comment: null });
  });

  bot.callbackQuery('dn:send', async (ctx) => {
    const s = await state.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!s || s.state !== 'donate_final') return ui.showMenu(ctx);
    const { card, amount, receipt, comment } = s.data;
    const d = await db.one(
      'INSERT INTO donations (user_id, amount, card_type, receipt_image, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [ctx.user.id, amount, card, receipt, comment || null],
    );
    await state.clear(ctx.from.id);
    await ui.show(ctx, t(ctx.lang, 'donate_sent'), ui.backKb(ctx.lang));
    await sendDonationToAdmins(ctx.api, d, ctx.user);
    return undefined;
  });

  // Kanalda e'lon qilish ruxsati
  bot.callbackQuery(/^dn:ann:(yes|anon):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[2]);
    const own = await db.one('SELECT id FROM donations WHERE id = $1 AND user_id = $2', [id, ctx.user.id]);
    if (!own) return ctx.answerCallbackQuery();
    const d = await donations.decideAnnouncement(ctx.api, id, ctx.match[1] === 'anon');
    await ctx.answerCallbackQuery();
    if (!d) return ui.show(ctx, t(ctx.lang, 'donate_announce_late'), ui.backKb(ctx.lang));
    return ui.show(ctx, t(ctx.lang, d.is_anonymous ? 'donate_announce_anon' : 'donate_announce_named'), ui.backKb(ctx.lang));
  });
}

const states = {
  async donate_amount(ctx, data) {
    const amount = parseAmount(ctx.message.text);
    if (!amount) return ctx.reply(t(ctx.lang, 'amount_invalid'), { reply_markup: ui.cancelKb(ctx.lang) });
    await state.set(ctx.from.id, 'donate_amount_confirm', { ...data, amount });
    return ctx.reply(t(ctx.lang, 'donate_amount_confirm', { amount: money(amount) }), {
      ...ui.HTML, reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'confirm_btn'), 'dn:amt_ok'), ui.btn(t(ctx.lang, 'cancel_btn'), 'cancel')]]),
    });
  },

  async donate_amount_confirm(ctx, data) {
    // Foydalanuvchi tasdiqlash o'rniga yangi summa yozsa
    return states.donate_amount(ctx, { card: data.card });
  },

  async donate_receipt(ctx, data) {
    const photo = ctx.message.photo;
    if (!photo || !photo.length) return ctx.reply(t(ctx.lang, 'receipt_must_be_photo'), { reply_markup: ui.cancelKb(ctx.lang) });
    await state.set(ctx.from.id, 'donate_comment_choice', { ...data, receipt: photo[photo.length - 1].file_id });
    return ctx.reply(t(ctx.lang, 'donate_comment_ask'), {
      reply_markup: ui.kb([[ui.btn(t(ctx.lang, 'btn_write_comment'), 'dn:cmt'), ui.btn(t(ctx.lang, 'skip_btn'), 'dn:skip')]]),
    });
  },

  async donate_comment_choice(ctx, data) {
    // Tugma bosish o'rniga to'g'ridan-to'g'ri izoh yozilsa
    return states.donate_comment(ctx, data);
  },

  async donate_comment(ctx, data) {
    const text = String(ctx.message.text || '').trim();
    if (!text) return ctx.reply(t(ctx.lang, 'donate_comment_enter'), { reply_markup: ui.cancelKb(ctx.lang) });
    if ([...text].length > COMMENT_MAX) {
      return ctx.reply(t(ctx.lang, 'donate_comment_too_long', { len: [...text].length }), { reply_markup: ui.cancelKb(ctx.lang) });
    }
    return showSummary(ctx, { ...data, comment: text });
  },
};

module.exports = { register, states, COMMENT_MAX };

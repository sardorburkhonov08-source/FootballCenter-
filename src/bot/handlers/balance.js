// 💰 Balans: to'ldirish, promokod, referral, bonus
const db = require('../../db/pool');
const { t, raw, money, escapeHtml } = require('../../i18n');
const settings = require('../../services/settings');
const users = require('../../services/users');
const promo = require('../../services/promo');
const referral = require('../../services/referral');
const bonus = require('../../services/bonus');
const notify = require('../../services/notify');
const { formatDateTime, monthRange, parts } = require('../../services/time');
const state = require('../state');
const ui = require('../ui');

// ⚽ animatsiyasi tugashini kutish (testlarda 0)
const DICE_WAIT_MS = Number(process.env.DICE_WAIT_MS ?? 3500);

const CARD_LABEL = { humo: 'Humo', uzcard: 'Uzcard', visa: 'Visa', mastercard: 'Mastercard' };

/** "50 000" / "50000" -> 50000; noto'g'ri bo'lsa null */
function parseAmount(text) {
  const s = String(text || '').replace(/[\s_.,]/g, '');
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function cardKb(lang, prefix, back) {
  return ui.kb([...ui.grid(settings.CARD_TYPES.map((c) => ui.btn(CARD_LABEL[c], `${prefix}:${c}`))), [ui.btn(t(lang, 'back'), back)]]);
}

function formatCardNumber(n) {
  return String(n).replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
}

async function showBalance(ctx) {
  const lang = ctx.lang;
  const u = await users.byId(ctx.user.id);
  await ui.show(ctx, t(lang, 'balance_title', { balance: money(u.balance) }), ui.kb([
    [ui.btn(t(lang, 'btn_topup'), 'bal:topup'), ui.btn(t(lang, 'btn_promo'), 'bal:promo')],
    [ui.btn(t(lang, 'btn_referral'), 'bal:ref'), ui.btn(t(lang, 'btn_bonus'), 'bal:bonus')],
    [ui.btn(t(lang, 'back'), 'm:menu')],
  ]));
}

/** Adminlarga to'lov (chek rasmi bilan) yuborish */
async function sendTopupToAdmins(api, topup, user) {
  const caption = (lang) => t(lang, 'a_topup_caption', {
    id: topup.id, user: users.displayName(user) + (user.username ? ` (@${user.username})` : ''), tgid: user.telegram_id,
    type: CARD_LABEL[topup.card_type], amount: money(topup.amount), date: formatDateTime(topup.created_at),
  });
  for (const adminId of await notify.adminIds()) {
    const admin = await users.byTelegramId(adminId);
    const lang = (admin && admin.language) || 'uz';
    try {
      await api.sendPhoto(adminId, topup.receipt_image, {
        caption: caption(lang), parse_mode: 'HTML',
        reply_markup: ui.kb([[ui.btn(t(lang, 'a_btn_approve'), `adm:tp:ok:${topup.id}`), ui.btn(t(lang, 'a_btn_reject'), `adm:tp:no:${topup.id}`)]]),
      });
    } catch (e) { console.warn(`[admin notify] ${adminId}: ${e.description || e.message}`); }
  }
}

function register(bot) {
  bot.callbackQuery('m:balance', async (ctx) => { await ctx.answerCallbackQuery(); await state.clear(ctx.from.id); await showBalance(ctx); });

  // ---- ➕ Balans to'ldirish
  bot.callbackQuery('bal:topup', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ui.show(ctx, t(ctx.lang, 'choose_card'), cardKb(ctx.lang, 'tp:card', 'm:balance'));
  });

  bot.callbackQuery(/^tp:card:(\w+)$/, async (ctx) => {
    const type = ctx.match[1];
    const card = settings.CARD_TYPES.includes(type) ? await settings.getCard('topup', type) : null;
    if (!card) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'card_unavailable'), show_alert: true });
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'topup_amount', { card: type });
    await ui.show(ctx, t(ctx.lang, 'topup_card_info', { type: CARD_LABEL[type], number: formatCardNumber(card.number), holder: card.holder }), ui.cancelKb(ctx.lang));
  });

  // ---- 🎫 Promokod
  bot.callbackQuery('bal:promo', async (ctx) => {
    await ctx.answerCallbackQuery();
    await state.set(ctx.from.id, 'promo_code');
    await ui.show(ctx, t(ctx.lang, 'promo_enter'), ui.cancelKb(ctx.lang));
  });

  // ---- 🎁 Bonus
  // 🎁 Bonus: ⚽ Telegram animatsiyasi — gol bo'lsa bonus ×N (settings.bonus_goal_multiplier; 1 — o'chiq)
  bot.callbackQuery('bal:bonus', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.lang;
    const wait = await bonus.waitMs(ctx.user);
    if (wait > 0) return ui.show(ctx, t(lang, 'bonus_wait', { time: ui.duration(lang, wait) }), ui.backKb(lang, 'm:balance'));
    const mult = Math.max(1, Math.floor(Number(await settings.get('bonus_goal_multiplier')) || 1));
    let goal = false;
    if (mult > 1) {
      await ui.show(ctx, t(lang, 'bonus_kick', { mult }));
      const m = await ctx.replyWithDice('⚽').catch(() => null);
      goal = !!(m && m.dice && m.dice.value >= 3);   // ⚽: 3—5 — gol
      await new Promise((r) => setTimeout(r, DICE_WAIT_MS));
    }
    const r = await bonus.claim(ctx.user, { multiplier: goal ? mult : 1 });
    const params = { amount: money(r.amount || 0), balance: money(r.balance || 0), mult };
    const text = !r.ok ? t(lang, 'bonus_wait', { time: ui.duration(lang, r.waitMs) })
      : t(lang, mult === 1 ? 'bonus_got' : goal ? 'bonus_got_goal' : 'bonus_got_miss', params);
    if (mult > 1) return ctx.reply(text, { ...ui.HTML, reply_markup: ui.backKb(lang, 'm:balance') });
    return ui.show(ctx, text, ui.backKb(lang, 'm:balance'));
  });

  // ---- 👥 Referral
  const refMenu = async (ctx) => {
    const lang = ctx.lang;
    if (!(await settings.get('referral_enabled'))) {
      return ui.show(ctx, t(lang, 'referral_disabled'), ui.backKb(lang, 'm:balance'));
    }
    return ui.show(ctx, t(lang, 'referral_title'), ui.kb([
      [ui.btn(t(lang, 'btn_ref_link'), 'ref:link'), ui.btn(t(lang, 'btn_ref_stats'), 'ref:stats')],
      [ui.btn(t(lang, 'btn_ref_balance'), 'ref:bal'), ui.btn(t(lang, 'btn_ref_how'), 'ref:how')],
      [ui.btn(t(lang, 'btn_ref_league'), 'ref:league')],
      [ui.btn(t(lang, 'back'), 'm:balance')],
    ]));
  };
  bot.callbackQuery('bal:ref', async (ctx) => { await ctx.answerCallbackQuery(); await refMenu(ctx); });

  bot.callbackQuery(/^ref:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.lang;
    const back = ui.backKb(lang, 'bal:ref');
    const what = ctx.match[1];
    if (what === 'link') {
      const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.user.ref_code}`;
      return ui.show(ctx, t(lang, 'ref_link', { link }), back);
    }
    if (what === 'stats') return ui.show(ctx, t(lang, 'ref_stats', await referral.stats(ctx.user)), back);
    if (what === 'bal') {
      const u = await users.byId(ctx.user.id);
      return ui.show(ctx, t(lang, 'ref_balance', { amount: money(u.referral_earned) }), back);
    }
    if (what === 'how') {
      const s = await settings.getMany(['referral_bonus_free', 'referral_bonus_premium', 'referral_fake_protection', 'referral_league_premium_days']);
      return ui.show(ctx, t(lang, 'ref_how', {
        step3: t(lang, s.referral_fake_protection ? 'ref_step3_protected' : 'ref_step3_instant'),
        free: money(s.referral_bonus_free), premium: money(s.referral_bonus_premium), days: s.referral_league_premium_days,
      }), back);
    }
    if (what === 'league') {
      const range = monthRange();
      const p = parts(range.start);
      const month = `${String(p.month + 1).padStart(2, '0')}.${p.year}`;
      const rows = await referral.league(range, 10);
      if (!rows.length) return ui.show(ctx, t(lang, 'ref_league_empty', { month }), back);
      const list = rows.map((r, i) => t(lang, 'ref_league_line', { place: i + 1, name: users.displayName(r), count: r.count })).join('\n');
      const place = await referral.leaguePlace(ctx.user, range);
      return ui.show(ctx, t(lang, 'ref_league', { month, list: raw(list), place: place || t(lang, 'place_none') }), back);
    }
    return undefined;
  });
}

const states = {
  async topup_amount(ctx, data) {
    const amount = parseAmount(ctx.message.text);
    if (!amount) return ctx.reply(t(ctx.lang, 'amount_invalid'), { reply_markup: ui.cancelKb(ctx.lang) });
    await state.set(ctx.from.id, 'topup_receipt', { ...data, amount });
    return ctx.reply(t(ctx.lang, 'send_receipt'), { reply_markup: ui.cancelKb(ctx.lang) });
  },

  async topup_receipt(ctx, data) {
    const photo = ctx.message.photo;
    if (!photo || !photo.length) return ctx.reply(t(ctx.lang, 'receipt_must_be_photo'), { reply_markup: ui.cancelKb(ctx.lang) });
    const fileId = photo[photo.length - 1].file_id;
    const topup = await db.one(
      'INSERT INTO balance_topups (user_id, amount, card_type, receipt_image) VALUES ($1, $2, $3, $4) RETURNING *',
      [ctx.user.id, data.amount, data.card, fileId],
    );
    await state.clear(ctx.from.id);
    await ctx.reply(t(ctx.lang, 'topup_sent'), { reply_markup: ui.backKb(ctx.lang, 'm:balance') });
    await sendTopupToAdmins(ctx.api, topup, ctx.user);
    return undefined;
  },

  async promo_code(ctx) {
    const code = String(ctx.message.text || '').trim();
    await state.clear(ctx.from.id);
    if (!promo.CODE_RE.test(code)) return ctx.reply(t(ctx.lang, 'promo_not_found'), { reply_markup: ui.backKb(ctx.lang, 'm:balance') });
    const r = await promo.redeem(ctx.user, code);
    const params = { ...(r.params || {}) };
    if (params.amount !== undefined) params.amount = money(params.amount);
    return ctx.reply(t(ctx.lang, r.key, params), { parse_mode: 'HTML', reply_markup: ui.backKb(ctx.lang, 'm:balance') });
  },
};

module.exports = { register, states, parseAmount, CARD_LABEL, cardKb, formatCardNumber, sendTopupToAdmins, escapeHtml };

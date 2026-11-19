const { t, LANGS, LANG_NAMES } = require('../i18n');
const config = require('../config');
const users = require('../services/users');

function btn(text, data) { return { text, callback_data: data }; }
function urlBtn(text, url) { return { text, url }; }
function kb(rows) { return { inline_keyboard: rows.filter((r) => r && r.length) }; }

/** Elementlarni 2 ustunli qatorlarga ajratish */
function grid(buttons, cols = 2) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += cols) rows.push(buttons.slice(i, i + cols));
  return rows;
}

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * Ekranni ko'rsatish: callback bo'lsa — mavjud xabarni tahrirlash, aks holda yangi xabar.
 */
// 🧹 Chat toza tursin: har bir chatdagi oxirgi "ekran" (menyu) xabari. Yangi ekran yuborilganda eskisi o'chiriladi.
const lastScreen = new Map();   // chatId -> message_id
const SCREEN_MAP_MAX = 20000;

async function show(ctx, text, markup) {
  const extra = { ...HTML, reply_markup: markup };
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (msg && msg.text !== undefined) {
    try {
      await ctx.editMessageText(text, extra);
      if (ctx.chat) lastScreen.set(ctx.chat.id, msg.message_id);
      return;
    } catch (e) {
      if (String(e.description || e.message).includes('message is not modified')) return;
    }
  }
  const chatId = ctx.chat && ctx.chat.id;
  const prev = chatId ? lastScreen.get(chatId) : null;
  const sent = await ctx.reply(text, extra);
  if (!chatId) return;
  if (prev && (!sent || prev !== sent.message_id)) ctx.api.deleteMessage(chatId, prev).catch(() => {});
  if (sent && sent.message_id) {
    lastScreen.delete(chatId);
    lastScreen.set(chatId, sent.message_id);
    if (lastScreen.size > SCREEN_MAP_MAX) lastScreen.delete(lastScreen.keys().next().value);
  }
}

/** Uzun matnni Telegram limitiga (4096) mos bo'laklarga bo'lib yuborish */
async function replyLong(ctx, text, markup) {
  const LIMIT = 4000;
  const parts = [];
  let rest = text;
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf('\n', LIMIT);
    if (cut < LIMIT / 2) cut = LIMIT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  for (let i = 0; i < parts.length; i += 1) {
    await ctx.reply(parts[i], { ...HTML, reply_markup: i === parts.length - 1 ? markup : undefined });
  }
}

function backKb(lang, data = 'm:menu') {
  return kb([[btn(t(lang, 'back'), data)]]);
}

function cancelKb(lang) {
  return kb([[btn(t(lang, 'cancel_btn'), 'cancel')]]);
}

function langKb() {
  return kb(grid(LANGS.map((l) => btn(LANG_NAMES[l], `lang:${l}`))));
}

function mainMenuKb(lang, user) {
  const L = (k) => t(lang, k);
  const rows = [
    [btn(L('btn_balance'), 'm:balance'), btn(L('btn_profile'), 'm:profile')],
    [btn(L('btn_donate'), 'm:donate'), btn(L('btn_rules'), 'm:rules')],
    [btn(L('btn_tariff'), 'm:tariff'), btn(L('btn_settings'), 'm:settings')],
    [btn(L('btn_help'), 'm:help'), btn(L('btn_ai'), 'm:ai')],
  ];
  rows.push(config.webAppUrl
    ? [{ text: L('btn_webapp'), web_app: { url: `${config.webAppUrl}/` } }]
    : [btn(L('btn_webapp'), 'm:webapp_missing')]);
  if (users.isAdmin(user)) rows.push([btn(L('btn_admin'), 'm:admin')]);
  return kb(rows);
}

/** Rasmli ekran (bosh menyu): yangi rasm yuboriladi, oldingi ekran va bosilgan xabar o'chiriladi */
async function showPhoto(ctx, png, caption, markup) {
  const { InputFile } = require('grammy');
  const chatId = ctx.chat.id;
  const prev = lastScreen.get(chatId);
  const cbMsg = ctx.callbackQuery && ctx.callbackQuery.message;
  const sent = await ctx.replyWithPhoto(new InputFile(png, 'menu.png'), { caption, parse_mode: 'HTML', reply_markup: markup });
  const sentId = sent && sent.message_id;
  for (const id of new Set([prev, cbMsg && cbMsg.message_id])) if (id && id !== sentId) ctx.api.deleteMessage(chatId, id).catch(() => {});
  if (sentId) { lastScreen.delete(chatId); lastScreen.set(chatId, sentId); }
}

/** 🏠 Bosh menyu: shaxsiy karta-rasm bilan (settings.menu_image_enabled), xato bo'lsa — matn */
async function showMenu(ctx) {
  const lang = ctx.lang;
  const caption = t(lang, 'menu_title', { name: ctx.from.first_name || '' });
  const markup = mainMenuKb(lang, ctx.user);
  if (await require('../services/settings').get('menu_image_enabled')) {
    try {
      const png = await require('../services/menuCard').renderPng(ctx.user);
      return await showPhoto(ctx, png, caption, markup);
    } catch (e) { console.error('[menu image]', e.message); }
  }
  return show(ctx, caption, markup);
}

/** Davomiylik: "3 soat 20 daqiqa" */
function duration(lang, ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? t(lang, 'dur_hm', { h, m }) : t(lang, 'dur_m', { m });
}

module.exports = { btn, urlBtn, kb, grid, HTML, show, showPhoto, replyLong, backKb, cancelKb, langKb, mainMenuKb, showMenu, duration };

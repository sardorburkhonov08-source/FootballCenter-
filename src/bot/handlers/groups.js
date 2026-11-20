// 👥 Guruh chatlaridagi yangilanishlar: bot qo'shilishi/chiqarilishi, /quiz, /top, /lang, javob tugmalari.
// Shaxsiy chat handlerlari guruhda ishlamaydi — guruh yangilanishlari faqat shu yerda ko'riladi.
const { t, raw, LANGS, LANG_NAMES } = require('../../i18n');
const settings = require('../../services/settings');
const users = require('../../services/users');
const groups = require('../../services/groups');
const { createLimiter } = require('../../services/ratelimit');

const limiter = createLimiter({ max: 6, windowMs: 3000 });
const ADMIN_STATUSES = ['creator', 'administrator'];

function isGroup(chat) { return chat && (chat.type === 'group' || chat.type === 'supergroup'); }

function playKb(ctx, lang) {
  const name = ctx.me && ctx.me.username;
  return name ? { inline_keyboard: [[{ text: t(lang, 'grp_play_btn'), url: `https://t.me/${name}?start=grp` }]] } : undefined;
}

async function ensureGroup(ctx) {
  return (await groups.byChat(ctx.chat.id)) || (await groups.register(ctx.chat, null)).group;
}

async function isChatAdmin(ctx) {
  try {
    const m = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    return ADMIN_STATUSES.includes(m.status);
  } catch (e) { return false; }
}

function langKb() {
  const rows = [];
  for (let i = 0; i < LANGS.length; i += 2) rows.push(LANGS.slice(i, i + 2).map((l) => ({ text: LANG_NAMES[l], callback_data: `glang:${l}` })));
  return { inline_keyboard: rows };
}

async function welcome(ctx, group) {
  const hour = await settings.get('group_quiz_hour');
  await ctx.reply(t(group.language, 'grp_welcome', { hour: String(hour).padStart(2, '0') }), { parse_mode: 'HTML', reply_markup: playKb(ctx, group.language) });
}

/** /quiz — bugungi savol (vaqti kelgan bo'lsa yuboriladi, yuborilgan bo'lsa — unga havola) */
async function cmdQuiz(ctx, group) {
  const lang = group.language;
  if (!(await settings.get('group_quiz_enabled'))) return ctx.reply(t(lang, 'grp_quiz_off'));
  // Vaqti kelmagan bo'lsa ham so'rashsa — bugungi savol erta yuboriladi (kuniga baribir bitta)
  const { gq } = await groups.ensureToday(group.chat_id);
  if (!gq) return ctx.reply(t(lang, 'grp_quiz_off'));
  if (gq.message_id) {
    return ctx.reply(t(lang, 'grp_quiz_above'), { reply_parameters: { message_id: Number(gq.message_id), allow_sending_without_reply: true } });
  }
  return groups.post(ctx.api, group, gq);
}

async function cmdTop(ctx, group) {
  const lang = group.language;
  const rows = await groups.board(group.chat_id);
  if (!rows.length) return ctx.reply(t(lang, 'grp_top_empty'), { parse_mode: 'HTML' });
  return ctx.reply(t(lang, 'grp_top', { list: raw(groups.boardLines(lang, rows)) }), { parse_mode: 'HTML', reply_markup: playKb(ctx, lang) });
}

async function onCommand(ctx, cmd) {
  const group = await ensureGroup(ctx);
  if (!group.active) await groups.register(ctx.chat, null);
  if (cmd === 'quiz') return cmdQuiz(ctx, group);
  if (cmd === 'top') return cmdTop(ctx, group);
  if (cmd === 'lang') {
    if (!(await isChatAdmin(ctx))) return ctx.reply(t(group.language, 'grp_admin_only'));
    return ctx.reply(t(group.language, 'grp_lang_prompt'), { reply_markup: langKb() });
  }
  if (cmd === 'start' || cmd === 'help') return welcome(ctx, group);
  return undefined;
}

async function onCallback(ctx) {
  const data = ctx.callbackQuery.data || '';
  let m = /^gq:(\d+):([0-3])$/.exec(data);
  if (m) {
    const { user } = await users.upsertFromTelegram(ctx.from, { groupOnly: true });
    if (user.is_blocked) return ctx.answerCallbackQuery({ text: t(user.language || 'uz', 'blocked'), show_alert: true });
    const r = await groups.answer(user, Number(m[1]), Number(m[2]));
    const lang = r.lang || 'uz';
    const text = {
      ok: r.correct ? t(lang, 'grp_answer_ok') : t(lang, 'grp_answer_wrong', { answer: r.answer }),
      already: t(lang, 'grp_answer_already'),
      expired: t(lang, 'grp_answer_expired'),
      not_found: t(lang, 'grp_answer_expired'),
    }[r.status];
    return ctx.answerCallbackQuery({ text: text.slice(0, 190), show_alert: r.status === 'ok' && !r.correct });
  }
  m = /^glang:(\w+)$/.exec(data);
  if (m) {
    const group = await ensureGroup(ctx);
    if (!(await isChatAdmin(ctx))) return ctx.answerCallbackQuery({ text: t(group.language, 'grp_admin_only'), show_alert: true });
    const g = await groups.setLanguage(ctx.chat.id, m[1]);
    if (!g) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery({ text: t(g.language, 'grp_lang_saved') });
    return ctx.editMessageText(t(g.language, 'grp_lang_saved')).catch(() => {});
  }
  return ctx.answerCallbackQuery().catch(() => {});
}

/** Guruh yangilanishi. → true — ko'rib chiqildi */
async function handle(ctx) {
  const chat = ctx.chat;
  // Bot guruhga qo'shildi / chiqarildi
  if (ctx.myChatMember) {
    const st = ctx.myChatMember.new_chat_member.status;
    if (['member', 'administrator'].includes(st)) {
      const { user } = ctx.from ? await users.upsertFromTelegram(ctx.from, { groupOnly: true }) : { user: null };
      const { group, created } = await groups.register(chat, user);
      const old = ctx.myChatMember.old_chat_member.status;
      if (created || ['left', 'kicked'].includes(old)) await welcome(ctx, group).catch(() => {});
    } else if (['left', 'kicked'].includes(st)) {
      await groups.deactivate(chat.id);
    }
    return true;
  }
  const msg = ctx.message;
  if (msg && msg.migrate_to_chat_id) { await groups.migrate(chat.id, msg.migrate_to_chat_id); return true; }
  if (!ctx.from) return true;
  if (!limiter.hit(ctx.from.id).allowed) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }
  if (ctx.callbackQuery) { await onCallback(ctx); return true; }
  const text = msg && msg.text;
  const cm = text && /^\/([a-z_]+)(?:@(\w+))?(?:\s|$)/i.exec(text);
  if (cm && (!cm[2] || !ctx.me || cm[2].toLowerCase() === String(ctx.me.username).toLowerCase())) {
    await onCommand(ctx, cm[1].toLowerCase());
  }
  return true;
}

module.exports = { handle, isGroup };

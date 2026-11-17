// 🤖 AI Yordamchi — Claude API orqali. Faqat "bot va futbol" mavzulari.
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/pool');
const config = require('../config');
const settings = require('./settings');
const users = require('./users');
const { HOUR } = require('./time');

let client = null;
function getClient() {
  if (!config.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

const LANG_LABEL = { uz: "Uzbek (Latin script)", uz_cyrl: 'Uzbek (Cyrillic script)', ru: 'Russian', en: 'English' };

const BOT_GUIDE = `FootballCenter is a Telegram bot with a Web App (Mini App). Main menu sections:
- 💰 Balance: top up via card transfer (Humo/Uzcard/Visa/Mastercard) + receipt photo, approved by an admin; 🎫 Promo code; 👥 Referral (personal link, a referral becomes active when the invited friend opens the Web App or buys Premium; monthly Referral League, 1st place gets Premium); 🎁 Bonus (random amount, Free once per day, Premium twice per day).
- 👤 Profile (read-only), ❤️ Donate (card transfer + receipt + optional comment, announced in the donation channel), 📜 Rules, 💎 Plan (Free vs Premium, Premium is bought from the balance), ⚙️ Settings (language, notifications), 🆘 Help (write to admins, FAQ), 🤖 AI Assistant.
- ⚽ FootballCenter Web App: 🏠 Home (matches by date, competitions, standings), 🎮 Mini Manager (weekly prediction game on admin-selected matches: tactics, starting XI, scorer/assist/cards, exact score, winner; weekly and monthly leaderboards), 🧠 Football Quiz (Premium only, one question per hour, 15 seconds, 2 points within 5 s, 1 point within 15 s), 👤 Profile.
Premium unlocks: more AI requests, 2 bonuses per day, Football Quiz, match details, results/fixtures/top scorers, all notifications.`;

function systemPrompt(lang) {
  return `You are the AI assistant of the FootballCenter Telegram bot.
You help ONLY with two topics: (1) how to use the FootballCenter bot and Web App, (2) general football questions (rules, history, clubs, players, tournaments, tactics).

${BOT_GUIDE}

Output format — this is parsed by code, follow it exactly:
- First line: exactly ON_TOPIC or OFF_TOPIC.
- If OFF_TOPIC: output nothing else.
- If ON_TOPIC: from the second line, the answer in ${LANG_LABEL[lang] || LANG_LABEL.uz}, plain text without Markdown, concise (normally under 1200 characters), starting with a fitting emoji.
For live scores, today's fixtures or very recent news, say that you may not have up-to-date data and suggest the ⚽ FootballCenter Web App.`;
}

/** 24 soatlik sirpanuvchi oyna ichida qolgan so'rovlar */
async function remaining(user) {
  const limit = Number(await settings.get(users.isPremium(user) ? 'ai_limit_premium' : 'ai_limit_free'));
  const r = await db.one(
    `SELECT count(*)::int AS c FROM ai_requests WHERE user_id = $1 AND counted AND created_at > now() - interval '24 hours'`,
    [user.id],
  );
  return Math.max(0, limit - r.c);
}

/**
 * Savol berish. Qaytadi:
 *  { status: 'limit' } | { status: 'off_topic' } | { status: 'unavailable' } | { status: 'ok', answer }
 * Mavzudan tashqari javoblar limitdan kamaytirmaydi.
 */
async function ask(user, question, lang) {
  if ((await remaining(user)) <= 0) return { status: 'limit' };
  const anthropic = getClient();
  if (!anthropic) return { status: 'unavailable' };

  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: config.aiModel,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt(lang),
      messages: [{ role: 'user', content: String(question).slice(0, 2000) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) console.warn('[ai] rate limited');
    else if (e instanceof Anthropic.APIError) console.error('[ai] API error', e.status, e.message);
    else console.error('[ai]', e);
    return { status: 'unavailable' };
  }

  if (response.stop_reason === 'refusal') {
    await db.query('INSERT INTO ai_requests (user_id, question, answer, counted) VALUES ($1, $2, NULL, false)', [user.id, question]);
    return { status: 'off_topic' };
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const [first, ...rest] = text.split('\n');
  const onTopic = first.trim().toUpperCase() === 'ON_TOPIC';
  const answer = rest.join('\n').trim();
  if (!onTopic || !answer) {
    await db.query('INSERT INTO ai_requests (user_id, question, answer, counted) VALUES ($1, $2, NULL, false)', [user.id, question]);
    return { status: 'off_topic' };
  }
  await db.query('INSERT INTO ai_requests (user_id, question, answer, counted) VALUES ($1, $2, $3, true)', [user.id, question, answer]);
  return { status: 'ok', answer };
}

module.exports = { remaining, ask, HOUR };

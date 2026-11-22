const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const time = require('../src/services/time');
const scoring = require('../src/services/scoring');
const { translit } = require('../src/i18n/translit');
const { LOCALES, t } = require('../src/i18n');

test('hafta: seshanba 12:00 — keyingi seshanba 11:59 (Toshkent)', () => {
  // 2026-11-17 seshanba. 11:59 Toshkent = 06:59 UTC
  const before = time.weekRange(new Date('2026-11-17T06:59:00Z'));
  assert.strictEqual(before.start.toISOString(), '2026-11-10T07:00:00.000Z');
  assert.strictEqual(before.end.toISOString(), '2026-11-17T07:00:00.000Z');
  const after = time.weekRange(new Date('2026-11-17T07:00:00Z'));
  assert.strictEqual(after.start.toISOString(), '2026-11-17T07:00:00.000Z');
  const sunday = time.weekRange(new Date('2026-11-22T20:00:00Z'));
  assert.strictEqual(sunday.start.toISOString(), '2026-11-17T07:00:00.000Z');
});

test('oy va sana formatlari Toshkent vaqtida', () => {
  const m = time.monthRange(new Date('2026-10-31T20:00:00Z')); // Toshkentda allaqachon 1-noyabr
  assert.strictEqual(m.start.toISOString(), '2026-10-31T19:00:00.000Z');
  assert.strictEqual(time.formatDate(new Date('2026-10-22T18:59:00Z')), '22.10.2026');
  assert.strictEqual(time.parseDate('22.10.2026 18:00').toISOString(), '2026-10-22T13:00:00.000Z');
  assert.strictEqual(time.parseDate('32.10.2026'), null);
});

test("Mini Manager ball tizimi (API-Football natijasi)", () => {
  const football = require('../src/services/football');
  const ev = (teamId, type, detail, player, assist) => ({ time: { elapsed: 10 }, team: { id: teamId }, type, detail, player: { id: player }, assist: { id: assist || null } });
  const match = {
    fixture: { id: 1, status: { short: 'FT' }, timestamp: 1 },
    teams: { home: { id: 1 }, away: { id: 2 } },
    goals: { home: 2, away: 0 },
    events: [
      ev(1, 'Goal', 'Normal Goal', 13, 12),
      ev(1, 'Goal', 'Own Goal', 22),
      ev(2, 'Goal', 'Missed Penalty', 21),
      ev(2, 'Card', 'Yellow Card', 21),
      ev(1, 'subst', 'Substitution 1', 15, 11),
    ],
    lineups: [
      { team: { id: 1 }, startXI: [{ player: { id: 11 } }, { player: { id: 12 } }, { player: { id: 13 } }] },
      { team: { id: 2 }, startXI: [{ player: { id: 21 } }, { player: { id: 22 } }] },
    ],
  };
  const r = football.matchResult(match);
  assert.deepStrictEqual(r.goals.filter((g) => !g.own).map((g) => g.scorerId), [13], "avtogol va o'tkazib yuborilgan penalti hisoblanmaydi");
  const pred = {
    predicted_winner: 'HOME', predicted_score_home: 2, predicted_score_away: 0,
    scorer_home: 13, scorer_away: 0, assist_home: 12, assist_away: 0,
    red_card_home: 0, red_card_away: 0, yellow_card_home: 11, yellow_card_away: 21,
    lineup_home: [11, 12, 99], lineup_away: [21],
  };
  const s = scoring.score(pred, r);
  assert.deepStrictEqual(s.breakdown, {
    winner: 10, exactScore: 30,
    scorer_home: 15, assist_home: 10, red_home: 10, yellow_home: 0, lineup_home: 4,
    scorer_away: 15, assist_away: 10, red_away: 10, yellow_away: 5, lineup_away: 2,
  });
  assert.strictEqual(s.total, 121);

  // Batafsil ma'lumot yo'q: faqat "bo'lmaydi" + 0 gol ma'lum bo'lgan joy hisoblanadi
  const noData = football.matchResult({ fixture: { id: 2, status: { short: 'FT' } }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: { home: 1, away: 0 } });
  const s2 = scoring.score({ predicted_winner: 'AWAY', predicted_score_home: 0, predicted_score_away: 1, scorer_home: null, scorer_away: 0, red_card_home: 0, lineup_home: [], lineup_away: [] }, noData);
  assert.strictEqual(s2.breakdown.scorer_away, 15);
  assert.strictEqual(s2.breakdown.red_home, 0);
  assert.strictEqual(s2.total, 15);

  // Ikkinchi sariq — ham sariq, ham qizil
  const sy = football.matchResult({ ...match, events: [ev(2, 'Card', 'Second Yellow card', 22)] });
  assert.deepStrictEqual(sy.bookings, [{ teamId: 2, playerId: 22, card: 'YELLOW_RED' }]);
});

test('kirill transliteratsiyasi', () => {
  assert.strictEqual(translit("O'zingizga qulay tilni tanlang"), 'Ўзингизга қулай тилни танланг');
  assert.strictEqual(translit("Chin dildan rahmat! {name}"), 'Чин дилдан раҳмат! {name}');
  assert.strictEqual(translit('<code>{number}</code> Premium'), '<code>{number}</code> Premium');
  assert.strictEqual(translit("mas'uliyat, e'lon, ertaga, yetarli"), 'масъулият, эълон, эртага, етарли');
});

test('i18n: koddagi barcha kalitlar 4 tilda mavjud', () => {
  const src = path.join(__dirname, '..', 'src');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
  walk(src);
  const keys = new Set();
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/\b(?:t|L)\((?:ctx\.lang|ctx|lang|'uz'|user\.language \|\| 'uz'|[a-zA-Z.]+(?: \|\| 'uz')?),\s*'([a-z_0-9]+)'/g)) keys.add(m[1]);
    for (const m of code.matchAll(/toUser\([^,]+,\s*'([a-z_0-9]+)'/g)) keys.add(m[1]);
  }
  const dynamic = ['rule_general', 'rule_user', 'rule_premium', 'rule_bonus', 'rule_ai', 'rule_privacy', 'rule_block', 'rule_copyright',
    'notif_news', 'notif_premium_expiry', 'notif_match_start', 'notif_manager_result', 'notif_leaderboard', 'notif_quiz_new', 'notif_payment', 'notif_bonus_ready',
    'promo_not_found', 'promo_expired', 'promo_inactive', 'promo_limit', 'promo_used', 'promo_premium_only', 'promo_success_premium', 'promo_success_balance',
    'donate_thanks_first_small', 'donate_thanks_first_big', 'donate_thanks_repeat', 'kind_manager', 'kind_quiz', 'period_weekly', 'period_monthly'];
  const settingKeys = require('../src/bot/handlers/admin').SECTIONS;
  for (const s of Object.values(settingKeys)) for (const k of s.keys) dynamic.push(`a_set_${k}`);
  dynamic.forEach((k) => keys.add(k));
  assert.ok(keys.size > 150, `kalitlar soni: ${keys.size}`);
  const uzOnly = new Set(['donation_channel_post', 'donation_channel_comment']);
  for (const lang of ['uz', 'uz_cyrl', 'ru', 'en']) {
    const missing = [...keys].filter((k) => !(k in LOCALES[lang]) && !(uzOnly.has(k) && lang !== 'uz'));
    assert.deepStrictEqual(missing, [], `${lang} tilida yo'q kalitlar`);
  }
});

test('har bir bot xabari emoji bilan boshlanadi', () => {
  const noEmoji = [];
  const exempt = /^(sum|none|anonymous|dur_|tariff_free$|tariff_premium|a_set_|a_on|a_off|a_none|a_type_|a_premium_only_tag|a_owner_tag|period_|place_none|a_promo_line|ref_league_line|donation_channel_comment|a_btn_card_|a_btn_promo_|a_btn_faq_delete|a_btn_remove|sub_channel_btn|ref_step3_|region_|card_|share_|ach_(?!unlocked)|duel_kind_|arcade_kind_|ulv_|digest_footer$|mc_|alert_(?!msg)|grp_top_line$|top_line$|bc_sched_line$|ch_results_title$|ch_footer$|ch_winner_(week|month)$|ch_prize$|ob_(next)$|top_p_|btn_top_(daily|weekly|monthly)$|tc_|poll_draw$|inl_\w+_desc$|a_fancard_(photo_yes|photo_no|birth_year)$)/;
  for (const lang of ['uz', 'ru', 'en', 'uz_cyrl']) {
    for (const [k, v] of Object.entries(LOCALES[lang])) {
      if (exempt.test(k)) continue;
      if (!/^\p{Extended_Pictographic}|^[\u{1F1E6}-\u{1F1FF}]|^[0-9]️?⃣|^[©️]/u.test(v)) noEmoji.push(`${lang}.${k}`);
    }
  }
  assert.deepStrictEqual(noEmoji, []);
  assert.match(t('ru', 'topup_approved', { amount: '1 000' }), /^✅/);
});

test("WEBHOOK_URL: https:// yo'q bo'lsa qo'shiladi, oxirgi / olib tashlanadi", () => {
  const { normalizeUrl } = require('../src/config');
  assert.strictEqual(normalizeUrl(' footballcenter-production.up.railway.app/ '), 'https://footballcenter-production.up.railway.app');
  assert.strictEqual(normalizeUrl('http://a.up.railway.app'), 'https://a.up.railway.app');
  assert.strictEqual(normalizeUrl('https://a.up.railway.app//'), 'https://a.up.railway.app');
  assert.strictEqual(normalizeUrl(''), '');
});

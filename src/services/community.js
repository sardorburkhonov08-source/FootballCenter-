// 👥 Fan community'lar (egasi talabi bilan, SPEC'dan tashqari).
// - Foydalanuvchi o'z klubi (muxlislik kartasidagi) uchun community ochishni so'raydi; admin tasdiqlaydi yoki rad etadi.
//   Klubning birinchi community'si bepul, keyingilari pullik (settings.community_extra_price) — pul tasdiqlanganda yechiladi.
// - A'zolar — muxlislik kartasi shu klubniki bo'lganlar; har kim bir vaqtda bitta community'da.
// - Egasi: e'lon yozadi, a'zoni chiqaradi, nom/tavsifni tahrirlaydi. Admin community'ni yopadi.
// - Haftalik fan reytingi: a'zolarning hafta davomida to'plagan points yig'indisi (Mini Manager + Quiz + Hisobni top).
//   Hafta tugagach g'olib yoziladi (wins + 1) va hamma foydalanuvchiga xabar ketadi.
// - Daraja (1—7): XP = a'zolar community'da to'plagan jami points (tugagan haftalar + joriy hafta), chegaralar — settings.community_level_xp.
// - ⚔️ Haftalik derbi: hafta boshida o'tgan hafta reytingidagi qo'shnilar juftlanadi (1–2, 3–4, ...); hafta oxirida
//   ko'proq points to'plagan g'olib — keyingi derbi natijasigacha 👑 toj bilan ko'rsatiladi.
const db = require('../db/pool');
const settings = require('./settings');
const users = require('./users');
const leaderboard = require('./leaderboard');
const fancard = require('./fancard');
const notify = require('./notify');
const { t, money } = require('../i18n');
const { weekRange, prevRange } = require('./time');

class CommunityError extends Error {}

const NAME_MIN = 3;
const NAME_MAX = 40;
const DESC_MAX = 300;
const POST_MAX = 1000;

function clean(v) { return String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').replace(/[ \t]+/g, ' ').trim(); }
function checkName(v) {
  const s = clean(v).replace(/\s+/g, ' ');
  const n = [...s].length;
  if (n < NAME_MIN || n > NAME_MAX) throw new CommunityError('bad_name');
  return s;
}
function checkDesc(v) {
  const s = clean(v);
  if ([...s].length > DESC_MAX) throw new CommunityError('bad_description');
  return s || null;
}

async function extraPrice() { return Number(await settings.get('community_extra_price')); }

async function hasActive(teamId, q = db) {
  const r = await q.query("SELECT 1 FROM communities WHERE team_id = $1 AND status = 'active' LIMIT 1", [teamId]);
  return r.rowCount > 0;
}

/** Hozir shu klub uchun community ochish narxi */
async function priceFor(teamId) { return (await hasActive(teamId)) ? extraPrice() : 0; }

async function membership(userId) {
  return db.one(
    `SELECT m.role, c.* FROM community_members m JOIN communities c ON c.id = m.community_id
     WHERE m.user_id = $1 AND c.status = 'active'`, [userId],
  );
}

async function requirePremiumCard(user) {
  const u = await users.byId(user.id);
  if (!users.isPremium(u)) throw new CommunityError('premium_required');
  const card = await fancard.cardRow(u.id);
  if (!card) throw new CommunityError('card_required');
  return { u, card };
}

// ---------- Haftalik points
/** userId → hafta davomidagi points (Mini Manager + Quiz + Hisobni top). fresh — keshsiz (g'olibni aniqlash uchun) */
async function weekPoints(range, fresh = false) {
  const get = fresh ? leaderboard.computeRanking : leaderboard.ranking;
  const [mm, qz, sc] = await Promise.all([get('manager', range), get('quiz', range), get('score', range)]);
  const pts = new Map();
  for (const r of [...mm, ...qz, ...sc]) pts.set(r.id, (pts.get(r.id) || 0) + Number(r.points));
  return pts;
}

/** Faol community'lar reytingi: [{ id, name, team, points, members, place, wins, colors }] */
async function standings(range = weekRange(), { fresh = false } = {}) {
  const [rows, pts] = await Promise.all([
    db.many(
      `SELECT c.*, (SELECT count(*)::int FROM community_members m WHERE m.community_id = c.id) AS members
       FROM communities c WHERE c.status = 'active' ORDER BY c.id`,
    ),
    weekPoints(range, fresh),
  ]);
  const members = await db.many(
    "SELECT m.user_id, m.community_id FROM community_members m JOIN communities c ON c.id = m.community_id WHERE c.status = 'active'",
  );
  const sum = new Map();
  for (const m of members) sum.set(m.community_id, (sum.get(m.community_id) || 0) + (pts.get(m.user_id) || 0));
  const list = rows.map((c) => ({ ...c, points: sum.get(c.id) || 0 }))
    // teng bo'lsa — ko'proq a'zo, so'ng oldin ochilgani
    .sort((a, b) => b.points - a.points || b.members - a.members || a.id - b.id);
  return list.map((c, i) => ({ ...c, place: i + 1 }));
}

async function lastChampion() {
  return db.one('SELECT * FROM community_weekly_winners WHERE community_id IS NOT NULL ORDER BY period_start DESC LIMIT 1');
}

async function colorsOf(c) {
  const col = await fancard.clubColors(c.team_id, c.team_logo);
  const pal = fancard.palette(col.primary, col.secondary);
  return { primary: pal.band, secondary: pal.stripe, text: pal.bandText, accent: pal.accent, bg: pal.bg };
}

// ---------- Daraja va derbi
const LEVEL_MAX = 7;
async function levelThresholds() {
  const v = await settings.get('community_level_xp');
  return (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, LEVEL_MAX - 1);
}
/** xp → { level, xp, from, next } (next — keyingi darajagacha kerakli jami XP; oxirgi darajada null) */
function levelOf(xp, th) {
  let level = 1;
  th.forEach((x, i) => { if (xp >= x) level = i + 2; });
  return { level, xp, from: level > 1 ? th[level - 2] : 0, next: th[level - 1] ?? null };
}

/** Oxirgi hisoblangan derbi haftasining g'oliblari — 👑 */
async function crownIds() {
  const rows = await db.many(
    `SELECT winner_id FROM community_derbies WHERE winner_id IS NOT NULL
       AND period_start = (SELECT max(period_start) FROM community_derbies WHERE status = 'finished')`,
  );
  return new Set(rows.map((r) => r.winner_id));
}

/** Kontekst: daraja chegaralari va tojlar (bir marta olinadi) */
async function viewContext() {
  const [th, crowns] = await Promise.all([levelThresholds(), crownIds()]);
  return { th, crowns };
}

async function publicCommunity(c, champion, ctx) {
  const x = ctx || await viewContext();
  return {
    id: c.id, name: c.name, description: c.description || '', team: { id: c.team_id, name: c.team_name, logo: c.team_logo },
    members: c.members, points: c.points, place: c.place, wins: c.wins,
    champion: !!(champion && champion.community_id === c.id), colors: await colorsOf(c),
    level: levelOf(Number(c.xp || 0) + Number(c.points || 0), x.th), crown: x.crowns.has(c.id),
  };
}

/** Joriy haftadagi derbi (raqib va jonli hisob) */
async function currentDerby(communityId, list) {
  const r = weekRange();
  const d = await db.one(
    'SELECT * FROM community_derbies WHERE period_start = $1 AND (home_id = $2 OR away_id = $2)', [r.start, communityId],
  );
  if (!d) return null;
  const oppId = d.home_id === communityId ? d.away_id : d.home_id;
  const me = list.find((x) => x.id === communityId);
  const opp = list.find((x) => x.id === oppId) || await db.one('SELECT * FROM communities WHERE id = $1', [oppId]);
  if (!opp) return null;
  return {
    end: d.period_end,
    my: me ? me.points : 0,
    their: opp.points || 0,
    opponent: { id: opp.id, name: opp.name, team: { name: opp.team_name, logo: opp.team_logo }, active: opp.status === 'active' },
  };
}

/** Hafta boshida derbi juftliklarini tuzish (bir marta). → tuzilgan juftlar soni */
async function ensureDerbies(now = new Date()) {
  const r = weekRange(now);
  const mark = await db.one(
    'INSERT INTO community_derby_weeks (period_start, period_end) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *', [r.start, r.end],
  );
  if (!mark) return 0;
  // O'tgan hafta reytingi tartibida qo'shnilar juftlanadi (toq qolgani bu hafta derbisiz)
  const list = await standings(prevRange('weekly', now), { fresh: true });
  let n = 0;
  for (let i = 0; i + 1 < list.length; i += 2) {
    await db.query('INSERT INTO community_derbies (period_start, period_end, home_id, away_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [r.start, r.end, list[i].id, list[i + 1].id]);
    n += 1;
  }
  return n;
}

/** Tugagan haftalar derbilarini hisoblash: ko'proq points — g'olib, teng — durang. → hisoblanganlar soni */
async function resolveDerbies(now = new Date(), graceMs = 0) {
  const due = await db.many("SELECT * FROM community_derbies WHERE status = 'active' AND period_end <= $1 ORDER BY period_start",
    [new Date(now.getTime() - graceMs)]);
  const cache = new Map();
  for (const d of due) {
    const key = new Date(d.period_start).getTime();
    if (!cache.has(key)) cache.set(key, await weekPoints({ start: d.period_start, end: d.period_end }, true));
    const pts = cache.get(key);
    const members = await db.many('SELECT user_id, community_id FROM community_members WHERE community_id = ANY($1::int[])', [[d.home_id, d.away_id]]);
    const sum = (id) => members.filter((m) => m.community_id === id).reduce((s, m) => s + (pts.get(m.user_id) || 0), 0);
    const [hp, ap] = [sum(d.home_id), sum(d.away_id)];
    const winner = hp > ap ? d.home_id : ap > hp ? d.away_id : null;
    await db.query("UPDATE community_derbies SET home_points = $2, away_points = $3, winner_id = $4, status = 'finished' WHERE id = $1 AND status = 'active'",
      [d.id, hp, ap, winner]);
  }
  return due.length;
}

/** Tugagan hafta points'ini community XP'siga qo'shish (bir marta) */
async function addWeekXp(r, list) {
  const mark = await db.one('INSERT INTO community_xp_weeks (period_start) VALUES ($1) ON CONFLICT DO NOTHING RETURNING *', [r.start]);
  if (!mark) return false;
  for (const c of list) if (c.points > 0) await db.query('UPDATE communities SET xp = xp + $2 WHERE id = $1', [c.id, c.points]);
  return true;
}

/** Mini App: Community bo'limi */
async function overview(user) {
  const u = await users.byId(user.id);
  const card = await fancard.cardRow(u.id);
  const range = weekRange();
  const [list, champion, mine, pending] = await Promise.all([
    standings(range), lastChampion(), membership(u.id),
    db.one("SELECT * FROM communities WHERE owner_user_id = $1 AND status = 'pending'", [u.id]),
  ]);
  const ctx = await viewContext();
  const out = await Promise.all(list.map((c) => publicCommunity(c, champion, ctx)));
  return {
    premium: users.isPremium(u),
    card: card ? { teamId: card.team_id, teamName: card.team_name } : null,
    week: { start: range.start, end: range.end },
    my: mine ? { id: mine.id, role: mine.role } : null,
    pending: pending ? { id: pending.id, name: pending.name, teamName: pending.team_name } : null,
    createPrice: card ? await priceFor(card.team_id) : null,
    standings: out,
    champion: champion ? out.find((c) => c.id === champion.community_id) || null : null,
  };
}

/** A'zolar kartalari asosidagi statistika */
async function stats(communityId) {
  const base = await db.one(
    `SELECT count(*)::int AS members,
            round(avg(EXTRACT(YEAR FROM now()) - f.birth_year))::int AS avg_age,
            round(avg(f.fan_since))::int AS avg_since,
            count(*) FILTER (WHERE f.gender = 'male')::int AS male,
            count(*) FILTER (WHERE f.gender = 'female')::int AS female
     FROM community_members m LEFT JOIN fan_cards f ON f.user_id = m.user_id WHERE m.community_id = $1`,
    [communityId],
  );
  const top = (col) => db.many(
    `SELECT f.${col} AS value, count(*)::int AS n FROM community_members m JOIN fan_cards f ON f.user_id = m.user_id
     WHERE m.community_id = $1 GROUP BY f.${col} ORDER BY n DESC, value LIMIT 3`, [communityId],
  );
  const [regions, goats, players] = await Promise.all([top('region'), top('goat'), top('fav_player')]);
  return { ...base, regions, goats, players };
}

/** Community sahifasi */
async function detail(user, id) {
  const c = await db.one("SELECT * FROM communities WHERE id = $1 AND status = 'active'", [Number(id)]);
  if (!c) throw new CommunityError('not_found');
  const range = weekRange();
  const [list, champion, st, posts, memberRows, pts, mine, owner] = await Promise.all([
    standings(range), lastChampion(), stats(c.id),
    postsWithReactions(c.id, user.id),
    db.many(
      `SELECT m.user_id, m.role, u.first_name, u.last_name, u.username, u.telegram_id FROM community_members m
       JOIN users u ON u.id = m.user_id WHERE m.community_id = $1`, [c.id],
    ),
    weekPoints(range), membership(user.id), users.byId(c.owner_user_id),
  ]);
  const ranked = list.find((x) => x.id === c.id) || { ...c, members: memberRows.length, points: 0, place: null };
  const lang = user.language || 'uz';
  const membersOut = memberRows
    .map((m) => ({ id: m.user_id, name: users.displayName(m), role: m.role, points: pts.get(m.user_id) || 0 }))
    .sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, 100);
  return {
    ...(await publicCommunity(ranked, champion)),
    derby: await currentDerby(c.id, list),
    owner: { id: c.owner_user_id, name: users.displayName(owner) },
    isOwner: c.owner_user_id === user.id,
    isMember: !!(mine && mine.id === c.id),
    totalCommunities: list.length,
    stats: {
      ...st,
      regions: st.regions.map((r) => ({ name: r.value ? require('../i18n').t(lang, `region_${r.value}`) : '—', n: r.n })),
      goats: st.goats.map((g) => ({ name: g.value, n: g.n })),
      players: st.players.map((p) => ({ name: p.value, n: p.n })),
    },
    posts,
    memberList: membersOut,
  };
}

// ---------- Foydalanuvchi amallari
/** Community ochish so'rovi (admin tasdiqlaydi) */
async function requestCreate(user, body = {}) {
  const { u, card } = await requirePremiumCard(user);
  if (await membership(u.id)) throw new CommunityError('already_member');
  const name = checkName(body.name);
  const description = checkDesc(body.description);
  const price = await priceFor(card.team_id);
  try {
    return await db.one(
      `INSERT INTO communities (team_id, team_name, team_logo, name, description, owner_user_id, price)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [card.team_id, card.team_name, card.team_logo, name, description, u.id, price],
    );
  } catch (e) {
    if (e.code === '23505') throw new CommunityError('already_pending');
    throw e;
  }
}

async function join(user, id) {
  const { u, card } = await requirePremiumCard(user);
  const c = await db.one("SELECT * FROM communities WHERE id = $1 AND status = 'active'", [Number(id)]);
  if (!c) throw new CommunityError('not_found');
  if (c.team_id !== card.team_id) throw new CommunityError('wrong_club');
  if (await db.one('SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2', [c.id, u.id])) throw new CommunityError('banned');
  const r = await db.query('INSERT INTO community_members (user_id, community_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [u.id, c.id]);
  if (!r.rowCount) throw new CommunityError('already_member');
  return c;
}

async function leave(user) {
  const m = await db.one('SELECT * FROM community_members WHERE user_id = $1', [user.id]);
  if (!m) throw new CommunityError('not_member');
  if (m.role === 'owner') throw new CommunityError('owner_cannot_leave');
  await db.query('DELETE FROM community_members WHERE user_id = $1', [user.id]);
}

async function ownedActive(user, id) {
  const c = await db.one("SELECT * FROM communities WHERE id = $1 AND status = 'active'", [Number(id)]);
  if (!c) throw new CommunityError('not_found');
  if (c.owner_user_id !== user.id) throw new CommunityError('not_owner');
  return c;
}

async function updateInfo(user, id, body = {}) {
  const c = await ownedActive(user, id);
  const name = 'name' in body ? checkName(body.name) : c.name;
  const description = 'description' in body ? checkDesc(body.description) : c.description;
  return db.one('UPDATE communities SET name = $2, description = $3 WHERE id = $1 RETURNING *', [c.id, name, description]);
}

/** Egasi a'zoni chiqaradi (qayta qo'shila olmaydi) */
async function kick(user, id, memberUserId) {
  const c = await ownedActive(user, id);
  const target = Number(memberUserId);
  if (target === user.id) throw new CommunityError('cannot_kick_self');
  const r = await db.query('DELETE FROM community_members WHERE user_id = $1 AND community_id = $2 RETURNING user_id', [target, c.id]);
  if (!r.rowCount) throw new CommunityError('not_member');
  await db.query('INSERT INTO community_bans (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, target]);
  return { community: c, user: await users.byId(target) };
}

async function addPost(user, id, text) {
  const c = await ownedActive(user, id);
  const s = clean(text);
  if (!s || [...s].length > POST_MAX) throw new CommunityError('bad_post');
  return db.one('INSERT INTO community_posts (community_id, author_user_id, text) VALUES ($1,$2,$3) RETURNING *', [c.id, user.id, s]);
}

// ---------- Post reaksiyalari (👍 ⚽ 🔥): har bir a'zo postga bitta reaksiya qo'yadi
const REACTIONS = ['like', 'ball', 'fire'];

async function postsWithReactions(communityId, userId) {
  const posts = await db.many('SELECT id, text, created_at FROM community_posts WHERE community_id = $1 ORDER BY created_at DESC LIMIT 30', [communityId]);
  if (!posts.length) return posts;
  const rows = await db.many(
    `SELECT post_id, reaction, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM community_post_reactions
     WHERE post_id = ANY($1::int[]) GROUP BY post_id, reaction`, [posts.map((p) => p.id), userId],
  );
  return posts.map((p) => {
    const reactions = Object.fromEntries(REACTIONS.map((r) => [r, 0]));
    let myReaction = null;
    for (const r of rows.filter((x) => x.post_id === p.id)) { reactions[r.reaction] = r.n; if (r.mine) myReaction = r.reaction; }
    return { ...p, reactions, myReaction };
  });
}

/** Reaksiya qo'yish: boshqasini bossa — almashadi, o'sha reaksiyani qayta bossa — olib tashlanadi. Faqat a'zolar. */
async function react(user, postId, reaction) {
  if (!REACTIONS.includes(reaction)) throw new CommunityError('bad_reaction');
  const p = await db.one(
    "SELECT p.* FROM community_posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1 AND c.status = 'active'", [Number(postId)],
  );
  if (!p) throw new CommunityError('not_found');
  const mine = await membership(user.id);
  if (!mine || mine.id !== p.community_id) throw new CommunityError('not_member');
  const cur = await db.one('SELECT reaction FROM community_post_reactions WHERE post_id = $1 AND user_id = $2', [p.id, user.id]);
  if (cur && cur.reaction === reaction) {
    await db.query('DELETE FROM community_post_reactions WHERE post_id = $1 AND user_id = $2', [p.id, user.id]);
  } else {
    await db.query(
      `INSERT INTO community_post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`, [p.id, user.id, reaction],
    );
  }
  const [post] = (await postsWithReactions(p.community_id, user.id)).filter((x) => x.id === p.id);
  return post || { id: p.id, reactions: {}, myReaction: null };
}

async function deletePost(user, postId) {
  const p = await db.one('SELECT * FROM community_posts WHERE id = $1', [Number(postId)]);
  if (!p) throw new CommunityError('not_found');
  await ownedActive(user, p.community_id);
  await db.query('DELETE FROM community_posts WHERE id = $1', [p.id]);
}

/** Muxlislik kartasida klub almashtirilsa — eski klub community'sidan chiqariladi (egasi esa klubni almashtira olmaydi) */
async function assertCanChangeClub(userId) {
  const m = await db.one(
    "SELECT m.role FROM community_members m JOIN communities c ON c.id = m.community_id WHERE m.user_id = $1 AND c.status = 'active'", [userId],
  );
  if (m && m.role === 'owner') throw new CommunityError('owner_cannot_change_club');
}
async function onClubChanged(userId) { await db.query("DELETE FROM community_members WHERE user_id = $1 AND role = 'member'", [userId]); }

// ---------- Admin
async function list(status) {
  const where = status ? 'WHERE c.status = $1' : '';
  return db.many(
    `SELECT c.*, u.telegram_id AS owner_tg, u.first_name, u.last_name, u.username, u.balance AS owner_balance,
            (SELECT count(*)::int FROM community_members m WHERE m.community_id = c.id) AS members
     FROM communities c JOIN users u ON u.id = c.owner_user_id ${where}
     ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200`, status ? [status] : [],
  );
}

/** Tasdiqlash: narx shu paytdagi holatga qarab (klubda faol community bo'lsa — pullik), pul balansdan yechiladi */
async function approve(id) {
  return db.tx(async (c) => {
    const row = (await c.query("SELECT * FROM communities WHERE id = $1 AND status = 'pending' FOR UPDATE", [Number(id)])).rows[0];
    if (!row) throw new CommunityError('not_pending');
    const owner = (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [row.owner_user_id])).rows[0];
    const card = (await c.query('SELECT team_id FROM fan_cards WHERE user_id = $1', [owner.id])).rows[0];
    if (!card || card.team_id !== row.team_id) throw new CommunityError('owner_club_changed');
    const busy = (await c.query(
      "SELECT 1 FROM community_members m JOIN communities x ON x.id = m.community_id WHERE m.user_id = $1 AND x.status = 'active'", [owner.id],
    )).rowCount;
    if (busy) throw new CommunityError('owner_already_member');
    // Bir klub uchun bir vaqtda tasdiqlanayotgan so'rovlar navbatga turadi
    await c.query('SELECT pg_advisory_xact_lock(7420160, $1)', [row.team_id]);
    const price = (await hasActive(row.team_id, c)) ? await extraPrice() : 0;
    if (Number(owner.balance) < price) throw new CommunityError('no_money');
    if (price) await c.query('UPDATE users SET balance = balance - $2 WHERE id = $1', [owner.id, price]);
    const done = (await c.query(
      "UPDATE communities SET status = 'active', price = $2, decided_at = now() WHERE id = $1 RETURNING *", [row.id, price],
    )).rows[0];
    await c.query("INSERT INTO community_members (user_id, community_id, role) VALUES ($1, $2, 'owner')", [owner.id, row.id]);
    return { community: done, owner };
  });
}

async function reject(id, reason) {
  const r = await db.one(
    "UPDATE communities SET status = 'rejected', reject_reason = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
    [Number(id), clean(reason).slice(0, 500) || null],
  );
  if (!r) throw new CommunityError('not_pending');
  return { community: r, owner: await users.byId(r.owner_user_id) };
}

/** Admin community'ni yopadi — a'zolar chiqariladi, tarix (g'alabalar) saqlanadi */
async function close(id) {
  return db.tx(async (c) => {
    const r = (await c.query("UPDATE communities SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'active' RETURNING *", [Number(id)])).rows[0];
    if (!r) throw new CommunityError('not_found');
    await c.query('DELETE FROM community_members WHERE community_id = $1', [r.id]);
    return { community: r, owner: (await c.query('SELECT * FROM users WHERE id = $1', [r.owner_user_id])).rows[0] };
  });
}

// ---------- Xabarlar
/** Yangi so'rov — adminlarga tasdiqlash/rad etish tugmalari bilan */
async function notifyAdmins(request) {
  const owner = await users.byId(request.owner_user_id);
  for (const adminId of await notify.adminIds()) {
    const admin = await users.byTelegramId(adminId);
    const lang = (admin && admin.language) || 'uz';
    await notify.sendRaw(adminId, t(lang, 'community_request_admin', {
      id: request.id, club: request.team_name, name: request.name, desc: request.description || '—',
      user: users.displayName(owner) + (owner.username ? ` (@${owner.username})` : ''), tgid: owner.telegram_id,
      price: money(request.price), balance: money(owner.balance),
    }), { reply_markup: { inline_keyboard: [[
      { text: t(lang, 'a_btn_approve'), callback_data: `cm:ok:${request.id}` },
      { text: t(lang, 'a_btn_reject'), callback_data: `cm:no:${request.id}` },
    ]] } });
  }
}

async function approveAndNotify(id) {
  const r = await approve(id);
  const key = Number(r.community.price) > 0 ? 'community_approved_paid' : 'community_approved';
  await notify.toUser(r.owner, key, { name: r.community.name, price: money(r.community.price) });
  return r;
}
async function rejectAndNotify(id, reason) {
  const r = await reject(id, reason);
  await notify.toUser(r.owner, 'community_rejected', { name: r.community.name, reason: r.community.reject_reason || '—' });
  return r;
}
async function closeAndNotify(id) {
  const r = await close(id);
  await notify.toUser(r.owner, 'community_closed', { name: r.community.name });
  return r;
}

/** Haftalik g'olib haqida barcha foydalanuvchilarga xabar (orqa fonda, Telegram limitidan past tezlikda) */
async function announceWinner(win) {
  const rows = await db.many('SELECT * FROM users WHERE NOT is_blocked ORDER BY id');
  for (const u of rows) {
    await notify.toUser(u, 'community_weekly_winner', { club: win.community.team_name, name: win.community.name, points: win.points });
    await new Promise((r) => setTimeout(r, 40));
  }
}

// ---------- Haftalik g'olib
/** O'tgan hafta tugagan bo'lsa g'olibni yozadi (bir marta). → { community, points } yoki null */
async function finalizeWeek(now = new Date(), graceMs = 0) {
  const r = prevRange('weekly', now);
  if (now.getTime() < r.end.getTime() + graceMs) return null;
  const list = await standings(r, { fresh: true });
  // XP: haftalik points community darajasiga qo'shiladi (g'olib bo'lmasa ham)
  await addWeekXp(r, list);
  const top = list[0] && list[0].points > 0 ? list[0] : null;
  const ins = await db.one(
    `INSERT INTO community_weekly_winners (period_start, period_end, community_id, points) VALUES ($1,$2,$3,$4)
     ON CONFLICT (period_start) DO NOTHING RETURNING *`,
    [r.start, r.end, top ? top.id : null, top ? top.points : 0],
  );
  if (!ins || !top) return null;
  await db.query('UPDATE communities SET wins = wins + 1 WHERE id = $1', [top.id]);
  // 🏅 Haftaning fan klubi a'zolariga yutuq
  const members = await db.many('SELECT user_id FROM community_members WHERE community_id = $1', [top.id]);
  await require('./achievements').award(members.map((m) => m.user_id), 'fan_club_week');
  return { community: top, points: top.points };
}

module.exports = {
  CommunityError, NAME_MAX, DESC_MAX, POST_MAX, REACTIONS, react, priceFor, overview, detail, stats, standings, weekPoints, requestCreate, join, leave,
  updateInfo, kick, addPost, deletePost, assertCanChangeClub, onClubChanged, list, approve, reject, close, finalizeWeek, lastChampion,
  notifyAdmins, approveAndNotify, rejectAndNotify, closeAndNotify, announceWinner,
  levelOf, levelThresholds, crownIds, ensureDerbies, resolveDerbies, currentDerby,
};

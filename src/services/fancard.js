// 🪪 Muxlislik kartasi — O'zbekiston ID kartasi uslubida, faqat Premium foydalanuvchilar uchun.
// Old tomon: klub logotipi, "[Klub] klubi muxlislik kartasi", rasm, familiya, ism, GOAT, yosh, jins,
// sevimli futbolchi, muxlislik boshlangan yil, klub, karta raqami (klubning nechanchi muxlisi).
// Orqa tomon: hudud, muxlis raqami, points, faollashtirilgan sana, berilgan joyi, klub reytingi, bot shtrix-kodi.
// Faollashtirilgach faqat GOAT va sevimli futbolchi o'zgaradi; klubni almashtirish pullik (settings).
// Karta rasmlari serverda chiziladi (PNG) — Mini App, Stories va yuklab olish uchun bitta dizayn.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const db = require('../db/pool');
const config = require('../config');
const football = require('./football');
const settings = require('./settings');
const users = require('./users');
const barcode = require('./barcode');
const { t, raw, LOCALES } = require('../i18n');
const { parts, formatDate } = require('./time');

const REGIONS = ['tashkent_city', 'tashkent', 'andijan', 'bukhara', 'fergana', 'jizzakh', 'khorezm', 'namangan', 'navoi',
  'kashkadarya', 'karakalpakstan', 'samarkand', 'syrdarya', 'surkhandarya', 'abroad'];
const GENDERS = ['male', 'female'];
const NAME_MAX = 30;
const TEXT_MAX = 40;
const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
const MIN_AGE = 5;
const MAX_AGE = 100;
const PHOTO_DIR = 'fancards';
const DEFAULT_COLOR = '#1f8a4c';
const DESIGN = 4; // karta dizayni o'zgarsa oshiriladi — eski rasmlar keshdan chiqadi // logotip rangi aniqlanmasa — FootballCenter yashili

class CardError extends Error {}

let fetchImpl = (...a) => fetch(...a);
function setFetch(fn) { fetchImpl = fn; }

// ---------- Ranglar
function hex(r, g, b) { return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`; }
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Fon rangiga mos matn rangi (o'qilishi uchun) */
function textOn(bg) { return luminance(bg) > 0.45 ? '#0c1712' : '#f3f7f4'; }
function saturation(r, g, b) { const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
/** k < 0 — qoraytirish, k > 0 — oqartirish */
function shade(h, k) { return hex(...rgb(h).map((v) => (k < 0 ? v * (1 + k) : v + (255 - v) * k))); }

/**
 * Logotipdagi asosiy ranglar: shaffof va oq/och kulrang piksellar hisobga olinmaydi,
 * ranglar guruhlanadi, to'yingan (yorqin) ranglarga ustunlik beriladi.
 */
function dominantColors(pngBuffer) {
  const img = PNG.sync.read(pngBuffer);
  const buckets = new Map();
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    if (r > 225 && g > 225 && b > 225) continue;              // oq fon
    if (saturation(r, g, b) < 0.12 && r > 150) continue;       // och kulrang
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  // Yaqin ranglar bitta guruhga birlashtiriladi (soya/gradient bir nechta bo'lakka bo'linib ketmasin)
  const clusters = [];
  for (const e of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n];
    const near = clusters.find((k) => Math.abs(k.c[0] - c[0]) + Math.abs(k.c[1] - c[1]) + Math.abs(k.c[2] - c[2]) < 70);
    if (near) {
      const n = near.n + e.n;
      near.c = near.c.map((v, i) => (v * near.n + c[i] * e.n) / n);
      near.n = n;
    } else clusters.push({ c, n: e.n });
  }
  // Ball: maydon × to'yinganlik × yorqinlik — to'q kontur/halqa (qora, to'q ko'k) klubning asosiy rangi bo'lib qolmasin
  const list = clusters
    .map((k) => ({ c: k.c, score: k.n * (0.35 + saturation(...k.c)) * (0.3 + 0.7 * (Math.max(...k.c) / 255)) }))
    .sort((x, y) => y.score - x.score);
  if (!list.length) return null;
  const primary = list[0].c;
  const far = (c) => Math.abs(c[0] - primary[0]) + Math.abs(c[1] - primary[1]) + Math.abs(c[2] - primary[2]) > 120;
  const second = list.find((x) => far(x.c));
  return { primary: hex(...primary), secondary: second ? hex(...second.c) : null };
}

/** Klub ranglari va logotipi (bazadan yoki logotipdan bir marta aniqlanadi) */
async function teamColors(teamId, logoUrl) {
  const row = await db.one('SELECT * FROM team_colors WHERE team_id = $1', [teamId]);
  if (row) return row;
  if (!logoUrl) return null;
  try {
    const res = await fetchImpl(logoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const colors = dominantColors(buf);
    if (!colors) return null;
    return db.one(
      `INSERT INTO team_colors (team_id, primary_color, secondary_color, logo_png) VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id) DO UPDATE SET primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color,
         logo_png = EXCLUDED.logo_png, updated_at = now() RETURNING *`,
      [teamId, colors.primary, colors.secondary, buf.toString('base64')],
    );
  } catch (e) {
    console.warn('[fancard] logotip ranglari:', e.message);
    return null;
  }
}

/** Kartadagi rang sxemasi: urg'u rangi och fonda o'qiladigan bo'lishi kerak */
const HEX_RE = /^#[0-9a-f]{6}$/;
/** Klub ranglari: admin/standart ro'yxatda bo'lsa — o'sha (rasmiy) rang, bo'lmasa logotipdan aniqlangani */
async function clubColors(teamId, logoUrl) {
  const [row, overrides] = await Promise.all([teamColors(teamId, logoUrl), settings.get('fan_card_team_colors')]);
  const o = (overrides || {})[String(teamId)];
  return {
    primary: o && HEX_RE.test(o.primary) ? o.primary : row && row.primary_color,
    secondary: o ? (HEX_RE.test(o.secondary) ? o.secondary : null) : row && row.secondary_color,
    logoPng: row ? row.logo_png : null,
    manual: !!o,
  };
}

function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }

/**
 * Karta ranglari klub rangidan: sarlavha tasmasi — klubning asosiy rangi, fon — shu rangning och tusi,
 * ingichka chiziq — ikkinchi rang. Raqamlar rangi fonda o'qiladigan bo'lguncha qoraytiriladi.
 */
function palette(primary, secondary) {
  const base = primary || DEFAULT_COLOR;
  const bg = shade(base, 0.82);
  let accent = base;
  for (let k = 0.15; contrast(accent, bg) < 4.5 && k < 0.95; k += 0.1) accent = shade(base, -k);
  // Tasmadagi matn: oq yaxshi o'qilsa — oq; bo'lmasa klubning ikkinchi rangi (masalan, havorangda to'q ko'k), u ham bo'lmasa — qora
  const white = '#ffffff';
  let bandText = '#0c1712';
  if (contrast(white, base) >= 3.5) bandText = white;
  else if (secondary && contrast(secondary, base) >= 4.5) bandText = secondary;
  return {
    band: base, bandText, bandMuted: bandText,
    stripe: secondary && Math.abs(luminance(secondary) - luminance(base)) > 0.04 ? secondary : shade(base, -0.4),
    accent, bg, wave: shade(base, -0.25), dark: shade(base, -0.65),
  };
}

// ---------- Tekshiruvlar
function currentYear() { return parts(new Date()).year; }
function cleanText(v) { return String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim(); }
const NAME_RE = /^\p{L}[\p{L}\p{M} '’ʻʼ`-]*$/u;

function checkName(v, code) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim(); // ism/familiyada begona belgi bo'lsa — rad etiladi (tozalanmaydi)
  if (!s || [...s].length > NAME_MAX || !NAME_RE.test(s)) throw new CardError(code);
  return s;
}
function checkText(v, code) {
  const s = cleanText(v);
  if ([...s].length < 2 || [...s].length > TEXT_MAX) throw new CardError(code);
  return s;
}
function checkBirthYear(v) {
  const y = Number(v);
  const now = currentYear();
  if (!Number.isInteger(y) || y < now - MAX_AGE || y > now - MIN_AGE) throw new CardError('bad_birth_year');
  return y;
}
function checkSince(v, birthYear) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < birthYear || y > currentYear()) throw new CardError('bad_since');
  return y;
}
function checkGender(v) { if (!GENDERS.includes(v)) throw new CardError('bad_gender'); return v; }
function checkRegion(v) { if (!REGIONS.includes(v)) throw new CardError('bad_region'); return v; }

/** data:image/jpeg;base64,... → Buffer (faqat JPEG/PNG, hajmi cheklangan) */
function decodePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new CardError('bad_photo');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > PHOTO_MAX_BYTES) throw new CardError('bad_photo');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw new CardError('bad_photo');
  return { buf, ext: isJpeg ? 'jpg' : 'png' };
}

function savePhoto(userId, { buf, ext }) {
  const dir = path.join(config.uploadDir, PHOTO_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${PHOTO_DIR}/${userId}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, name), buf);
  return name;
}
function removePhotoFile(rel) {
  if (!rel) return;
  try { fs.unlinkSync(path.join(config.uploadDir, PHOTO_DIR, path.basename(rel))); } catch (e) { /* fayl yo'q */ }
}
function readPhoto(rel) {
  if (!rel) return null;
  try {
    const buf = fs.readFileSync(path.join(config.uploadDir, PHOTO_DIR, path.basename(rel)));
    return `data:image/${rel.endsWith('.png') ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
  } catch (e) { return null; }
}

// ---------- Ma'lumot
async function cardRow(userId) { return db.one('SELECT * FROM fan_cards WHERE user_id = $1', [userId]); }

/** Klub ichidagi o'rin: umumiy points (Mini Manager + Quiz + Hisobni top + Duel) bo'yicha; teng bo'lsa — kim oldin muxlis bo'lgan */
async function clubRank(card) {
  return db.one(
    `WITH f AS (
       SELECT c.user_id, c.fan_number, ${users.totalPointsSql('u.')} AS pts
       FROM fan_cards c JOIN users u ON u.id = c.user_id WHERE c.team_id = $1 AND NOT u.is_blocked)
     SELECT (SELECT count(*)::int FROM f) AS total,
            (SELECT count(*)::int + 1 FROM f, f me WHERE me.user_id = $2
               AND (f.pts > me.pts OR (f.pts = me.pts AND f.fan_number < me.fan_number))) AS place`,
    [card.team_id, card.user_id],
  );
}

function regionName(lang, code) { return t(lang, `region_${code}`); }
function regionsList(lang) { return REGIONS.map((code) => ({ code, name: regionName(lang, code) })); }

/** Mini App uchun karta holati */
async function getCard(user, lang = user.language || 'uz') {
  const u = await users.byId(user.id);
  const premium = users.isPremium(u);
  const s = await settings.getMany(['fan_card_club_change_price', 'fan_card_first_fans', 'fan_card_goats']);
  const base = {
    premium, regions: regionsList(lang), goats: s.fan_card_goats || [],
    clubChangePrice: Number(s.fan_card_club_change_price), firstFans: Number(s.fan_card_first_fans),
    sampleUrl: `/card/sample-${LOCALES[lang] ? lang : 'uz'}.png`,
  };
  const c = await cardRow(u.id);
  if (!c) return { ...base, activated: false, card: null, images: null };
  const rank = await clubRank(c);
  const points = users.totalPoints(u);
  const earned = await require('./achievements').count(u.id);
  const version = crypto.createHash('sha1')
    .update([DESIGN, c.updated_at && new Date(c.updated_at).getTime(), points, rank.place, rank.total, lang, premium, earned].join(':')).digest('hex').slice(0, 10);
  return {
    ...base,
    activated: true,
    card: {
      team: { id: c.team_id, name: c.team_name, logo: c.team_logo },
      fanNumber: c.fan_number, firstName: c.first_name, lastName: c.last_name,
      birthYear: c.birth_year, age: currentYear() - c.birth_year, gender: c.gender,
      goat: c.goat, player: c.fav_player, region: { code: c.region, name: regionName(lang, c.region) }, since: c.fan_since,
      hasPhoto: !!c.photo_path, activatedAt: c.activated_at, points, rank,
      first: c.fan_number <= Number(s.fan_card_first_fans),
    },
    images: premium ? {
      front: `${imagePath(u.telegram_id, 'front')}?v=${version}`,
      back: `${imagePath(u.telegram_id, 'back')}?v=${version}`,
      story: `${imagePath(u.telegram_id, 'story')}?v=${version}`,
    } : null,
  };
}

function requirePremium(u) { if (!users.isPremium(u)) throw new CardError('premium_required'); }

/** Klub uchun keyingi muxlis raqami (tranzaksiya ichida, raqam qayta berilmaydi) */
async function nextFanNumber(c, teamId) {
  const { rows } = await c.query(
    `INSERT INTO fan_team_counters (team_id, last_number) VALUES ($1, 1)
     ON CONFLICT (team_id) DO UPDATE SET last_number = fan_team_counters.last_number + 1 RETURNING last_number`,
    [teamId],
  );
  return rows[0].last_number;
}

async function teamById(teamId) {
  const id = Number(teamId);
  if (!Number.isInteger(id) || id <= 0) throw new CardError('bad_team');
  const tm = await football.teamInfo(id);
  teamColors(tm.id, tm.logo).catch(() => {}); // ranglar va logotip oldindan saqlanadi
  return tm;
}

/** Kartani faollashtirish: barcha maydonlar majburiy */
async function activate(user, body = {}) {
  const u = await users.byId(user.id);
  requirePremium(u);
  if (await cardRow(u.id)) throw new CardError('already_active');
  const lastName = checkName(body.lastName, 'bad_last_name');
  const firstName = checkName(body.firstName, 'bad_first_name');
  const birthYear = checkBirthYear(body.birthYear);
  const gender = checkGender(body.gender);
  const region = checkRegion(body.region);
  const since = checkSince(body.since, birthYear);
  const goat = checkText(body.goat, 'bad_goat');
  const player = checkText(body.player, 'bad_player');
  const photo = decodePhoto(body.photo);
  const tm = await teamById(body.teamId);
  const photoPath = savePhoto(u.id, photo);
  try {
    await db.tx(async (c) => {
      const exists = await c.query('SELECT 1 FROM fan_cards WHERE user_id = $1 FOR UPDATE', [u.id]);
      if (exists.rowCount) throw new CardError('already_active');
      const number = await nextFanNumber(c, tm.id);
      await c.query(
        `INSERT INTO fan_cards (user_id, team_id, team_name, team_logo, fan_number, last_name, first_name, birth_year, gender,
           goat, fav_player, region, fan_since, photo_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [u.id, tm.id, tm.name, tm.logo, number, lastName, firstName, birthYear, gender, goat, player, region, since, photoPath],
      );
    });
  } catch (e) {
    removePhotoFile(photoPath);
    throw e;
  }
  require('./achievements').checkLater(u.id);
  return getCard(u);
}

/** Faollashtirilgandan keyin foydalanuvchi faqat GOAT va sevimli futbolchini o'zgartiradi */
async function updateFavorites(user, body = {}) {
  const u = await users.byId(user.id);
  requirePremium(u);
  const card = await cardRow(u.id);
  if (!card) throw new CardError('not_active');
  const goat = 'goat' in body ? checkText(body.goat, 'bad_goat') : card.goat;
  const player = 'player' in body ? checkText(body.player, 'bad_player') : card.fav_player;
  await db.query('UPDATE fan_cards SET goat = $2, fav_player = $3, updated_at = now() WHERE user_id = $1', [u.id, goat, player]);
  return getCard(u);
}

/** Admin rasmni o'chirgandan keyin — yangi rasm yuklash (faqat rasm yo'q bo'lsa) */
async function uploadPhoto(user, dataUrl) {
  const u = await users.byId(user.id);
  requirePremium(u);
  const card = await cardRow(u.id);
  if (!card) throw new CardError('not_active');
  if (card.photo_path) throw new CardError('photo_locked');
  const photoPath = savePhoto(u.id, decodePhoto(dataUrl));
  const r = await db.query('UPDATE fan_cards SET photo_path = $2, updated_at = now() WHERE user_id = $1 AND photo_path IS NULL', [u.id, photoPath]);
  if (!r.rowCount) { removePhotoFile(photoPath); throw new CardError('photo_locked'); }
  return getCard(u);
}

/** Klubni almashtirish: narxi balansdan yechiladi, yangi klubda muxlis raqami navbat oxiridan beriladi */
async function changeClub(user, teamId) {
  const u0 = await users.byId(user.id);
  requirePremium(u0);
  const card0 = await cardRow(u0.id);
  if (!card0) throw new CardError('not_active');
  // Fan community egasi klubni almashtira olmaydi (community shu klubniki)
  const community = require('./community');
  try { await community.assertCanChangeClub(u0.id); } catch (e) { if (e instanceof community.CommunityError) throw new CardError('community_owner'); throw e; }
  const tm = await teamById(teamId);
  if (tm.id === card0.team_id) throw new CardError('same_team');
  const price = Number(await settings.get('fan_card_club_change_price'));
  await db.tx(async (c) => {
    const { rows } = await c.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [u0.id]);
    if (Number(rows[0].balance) < price) throw new CardError('no_money');
    const cur = (await c.query('SELECT * FROM fan_cards WHERE user_id = $1 FOR UPDATE', [u0.id])).rows[0];
    if (!cur) throw new CardError('not_active');
    if (cur.team_id === tm.id) throw new CardError('same_team');
    const number = await nextFanNumber(c, tm.id);
    await c.query('UPDATE users SET balance = balance - $2 WHERE id = $1', [u0.id, price]);
    await c.query(
      'UPDATE fan_cards SET team_id = $2, team_name = $3, team_logo = $4, fan_number = $5, updated_at = now() WHERE user_id = $1',
      [u0.id, tm.id, tm.name, tm.logo, number],
    );
    await c.query(
      `INSERT INTO fan_card_club_changes (user_id, old_team_id, new_team_id, old_fan_number, new_fan_number, price)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [u0.id, cur.team_id, tm.id, cur.fan_number, number, price],
    );
  });
  await community.onClubChanged(u0.id); // eski klub community'sidan chiqariladi
  return getCard(u0);
}

// ---------- Admin
/** Nomaqbul rasmni o'chirish — foydalanuvchi yangisini yuklaydi */
async function adminRemovePhoto(userId) {
  const card = await cardRow(userId);
  if (!card) throw new CardError('not_active');
  await db.query('UPDATE fan_cards SET photo_path = NULL, updated_at = now() WHERE user_id = $1', [userId]);
  removePhotoFile(card.photo_path);
  return cardRow(userId);
}

const ADMIN_FIELDS = ['lastName', 'firstName', 'birthYear', 'gender', 'region', 'since', 'goat', 'player'];

/** Xato yozilgan ma'lumotni admin tuzatadi (klub va raqam bundan mustasno) */
async function adminUpdate(userId, body = {}) {
  const card = await cardRow(userId);
  if (!card) throw new CardError('not_active');
  const birthYear = 'birthYear' in body ? checkBirthYear(body.birthYear) : card.birth_year;
  const next = {
    last_name: 'lastName' in body ? checkName(body.lastName, 'bad_last_name') : card.last_name,
    first_name: 'firstName' in body ? checkName(body.firstName, 'bad_first_name') : card.first_name,
    birth_year: birthYear,
    gender: 'gender' in body ? checkGender(body.gender) : card.gender,
    region: 'region' in body ? checkRegion(body.region) : card.region,
    fan_since: checkSince('since' in body ? body.since : card.fan_since, birthYear),
    goat: 'goat' in body ? checkText(body.goat, 'bad_goat') : card.goat,
    fav_player: 'player' in body ? checkText(body.player, 'bad_player') : card.fav_player,
  };
  const keys = Object.keys(next);
  await db.query(
    `UPDATE fan_cards SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE user_id = $1`,
    [userId, ...keys.map((k) => next[k])],
  );
  return cardRow(userId);
}

// ---------- Rasm manzillari (imzolangan: Telegram Stories rasmni o'zi yuklab oladi)
const SIDES = ['front', 'back', 'story'];
function signature(telegramId) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`card:${telegramId}`).digest('hex').slice(0, 20);
}
function imagePath(telegramId, side = 'story') { return `/card/${telegramId}-${signature(telegramId)}-${side}.png`; }
/** → { telegramId, side } yoki null. Eski format (tomonsiz) — Stories rasmi. */
function verifyImagePath(file) {
  const m = /^(\d+)-([a-f0-9]{20})(?:-(front|back|story))?\.png$/.exec(file || '');
  if (!m) return null;
  const sig = signature(m[1]);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(m[2]))) return null;
  return { telegramId: Number(m[1]), side: m[3] || 'story' };
}

// ---------- Chizish (SVG → PNG)
const W = 1200;
const H = 756;
const INK = '#1a1414';
const MUTED = '#7a6a6c';
const D = 'font-family="Oswald" font-weight="700"';
const I = 'font-family="Inter, DejaVu Sans" font-weight="700"';

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function up(s) { return String(s ?? '').toLocaleUpperCase('en-US'); }
/** Matn kenglikka sig'maguncha shrift kichrayadi (Oswald o'rtacha harf kengligi ≈ 0.5em) */
function fit(text, size, maxWidth, k = 0.52, min = 18) { const n = [...String(text)].length || 1; return Math.max(min, Math.min(size, Math.floor(maxWidth / (n * k)))); }
function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

function waves(color) {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    let d = '';
    for (let x = 0; x <= W; x += 12) {
      const y = 120 + i * 40 + 26 * Math.sin(x / 70 + i * 0.7) + 12 * Math.sin(x / 23 + i);
      d += `${x ? 'L' : 'M'}${x},${y.toFixed(1)} `;
    }
    out += `<path d="${d}"/>`;
  }
  return `<g fill="none" stroke="${color}" stroke-opacity="0.16" stroke-width="2">${out}</g>`;
}

/** Oltin to'p (Ballon d'Or uslubida, tagligi bilan) — Premium belgisi */
function trophy(cx, top, id) {
  const r = 40;
  const cy = top + r;
  const P = (ang, dist) => [cx + dist * Math.cos(ang), cy + dist * Math.sin(ang)];
  const deg = Math.PI / 180;
  const poly = (c, rad, rot) => Array.from({ length: 5 }, (_, k) => [c[0] + rad * Math.cos(rot + k * 72 * deg), c[1] + rad * Math.sin(rot + k * 72 * deg)]);
  const str = (a) => a.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
  const inner = Array.from({ length: 5 }, (_, i) => P((-90 + 72 * i) * deg, r * 0.3));
  const outers = Array.from({ length: 5 }, (_, i) => { const a = (-54 + 72 * i) * deg; return poly(P(a, r * 0.9), r * 0.3, a + Math.PI); });
  let seams = '';
  inner.forEach((v, i) => {
    const q = P((-90 + 72 * i) * deg, r * 0.6);
    seams += `<line x1="${v[0].toFixed(1)}" y1="${v[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"/>`;
    for (const o of [outers[i], outers[(i + 4) % 5]]) {
      const n = o.reduce((m, x) => (Math.hypot(x[0] - q[0], x[1] - q[1]) < Math.hypot(m[0] - q[0], m[1] - q[1]) ? x : m));
      seams += `<line x1="${q[0].toFixed(1)}" y1="${q[1].toFixed(1)}" x2="${n[0].toFixed(1)}" y2="${n[1].toFixed(1)}"/>`;
    }
  });
  const nT = cy + r - 4; const nB = nT + 22; const b1 = nB + 14;
  const dark = '#8a6209';
  return `<rect x="${cx - 54}" y="${b1 + 3}" width="108" height="26" rx="5" fill="#000" opacity="0.15"/>
<path d="M${cx - 14},${nT} L${cx + 14},${nT} L${cx + 24},${nB} L${cx - 24},${nB} Z" fill="#c9971f"/>
<rect x="${cx - 36}" y="${nB}" width="72" height="14" rx="3" fill="#e6b93c"/>
<rect x="${cx - 52}" y="${b1}" width="104" height="26" rx="5" fill="${dark}"/>
<rect x="${cx - 40}" y="${b1 + 9}" width="80" height="8" rx="2" fill="#f2c94c"/>
<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6d264"/>
<g clip-path="url(#${id})">
<circle cx="${cx + r * 0.25}" cy="${cy + r * 0.3}" r="${r * 0.95}" fill="#d9a82e" opacity="0.55"/>
${outers.map((o) => `<polygon points="${str(o)}" fill="${dark}"/>`).join('')}
<g stroke="${dark}" stroke-width="${r * 0.05}" stroke-linecap="round">${seams}</g>
<polygon points="${str(inner)}" fill="${dark}"/>
<ellipse cx="${cx - r * 0.42}" cy="${cy - r * 0.5}" rx="${r * 0.22}" ry="${r * 0.12}" transform="rotate(-35 ${cx - r * 0.42} ${cy - r * 0.5})" fill="#fffbe6" opacity="0.85"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${dark}" stroke-width="${r * 0.06}"/>`;
}

/** 🥇🥈🥉 (emoji shrifti rasm chizuvchida yo'q — medal chiziladi) */
function medal(x, y, place, ribbon = 40) {
  const col = ['#f2c94c', '#c9ced6', '#d08a4c'][place - 1];
  const dk = ['#a87b12', '#8a9099', '#8f5526'][place - 1];
  const r = ribbon;
  return `<path d="M${x - 14},${y - r} L${x - 2},${y - 12} L${x + 6},${y - 16} L${x - 4},${y - r} Z" fill="#2f6fd6"/>
<path d="M${x + 14},${y - r} L${x + 2},${y - 12} L${x - 6},${y - 16} L${x + 4},${y - r} Z" fill="#d6342f"/>
<circle cx="${x}" cy="${y}" r="17" fill="${col}" stroke="${dk}" stroke-width="3"/>
<text x="${x}" y="${y + 7}" ${D} font-size="20" text-anchor="middle" fill="${dk}">${place}</text>`;
}

function silhouette(x, y, w, h, opacity = 1) {
  return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#d9cfd0"/>
<circle cx="${x + w / 2}" cy="${y + h * 0.38}" r="${w * 0.2}" fill="#b5a8aa"/>
<path d="M${x + w * 0.12},${y + h} Q${x + w / 2},${y + h * 0.52} ${x + w * 0.88},${y + h} Z" fill="#b5a8aa"/></g>`;
}
function photoBox(v, x, y, w, h, id, opacity = 1) {
  if (!v.photo) return silhouette(x, y, w, h, opacity);
  return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16"/></clipPath></defs>
<image href="${v.photo}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" opacity="${opacity}"/>`;
}
function logoBox(v, x, y, size) {
  if (v.logoPng) return `<image href="data:image/png;base64,${v.logoPng}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  const initials = up(v.club).split(/\s+/).filter(Boolean).slice(0, 2).map((s) => [...s][0]).join('');
  return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="${v.pal.accent}"/>
<text x="${x + size / 2}" y="${y + size / 2 + size * 0.17}" ${D} font-size="${size * 0.45}" text-anchor="middle" fill="#fff">${esc(initials)}</text>`;
}

function field(x, y, label, value, { size = 40, color = INK, maxWidth = 380 } = {}) {
  const val = up(value);
  return `<text x="${x}" y="${y}" ${I} font-size="16" letter-spacing="1.5" fill="${MUTED}">${esc(up(label))}</text>
<text x="${x}" y="${y + 44}" ${D} font-size="${fit(val, size, maxWidth)}" fill="${color}">${esc(val)}</text>`;
}

function shell(v, inner, idp) {
  return `<g><defs><clipPath id="${idp}c"><rect width="${W}" height="${H}" rx="40"/></clipPath></defs>
<g clip-path="url(#${idp}c)"><rect width="${W}" height="${H}" fill="${v.pal.bg}"/>${waves(v.pal.wave)}
${v.logoPng ? `<image href="data:image/png;base64,${v.logoPng}" x="760" y="300" width="420" height="420" opacity="0.1" preserveAspectRatio="xMidYMid meet"/>` : ''}
${inner}</g></g>`;
}

/** Old tomon (1200×756, <g> sifatida) */
function frontGroup(v, L, idp = 'f') {
  const clubLine = up(L('card_header_club', { club: v.club }));
  const pill = v.first
    ? `<rect x="48" y="634" width="300" height="44" rx="22" fill="${v.pal.accent}"/>
<text x="198" y="664" ${I} font-size="${fit(L('card_first', { n: v.firstLimit }), 17, 270, 0.62)}" letter-spacing="1.5" text-anchor="middle" fill="#fff">${esc(up(`★ ${L('card_first', { n: v.firstLimit })} ★`))}</text>`
    : '';
  return shell(v, `
<rect width="${W}" height="190" fill="${v.pal.band}"/><rect y="190" width="${W}" height="8" fill="${v.pal.stripe}"/>
<circle cx="110" cy="98" r="72" fill="#ffffff"/>
${logoBox(v, 50, 38, 120)}
<text x="204" y="90" ${D} font-size="${fit(clubLine, 50, 740)}" fill="${v.pal.bandText}">${esc(clubLine)}</text>
<text x="204" y="136" ${D} font-size="34" fill="${v.pal.bandText}">${esc(up(L('card_header_title')))}</text>
<text x="204" y="166" ${I} font-size="16" letter-spacing="3" fill="${v.pal.bandMuted}" fill-opacity="0.75">FOOTBALLCENTER</text>
${trophy(1088, 30, `${idp}t`)}
${photoBox(v, 48, 226, 300, 390, `${idp}p`)}
${pill}
${field(392, 240, L('card_l_surname'), v.lastName, { maxWidth: 760 })}
${field(392, 320, L('card_l_name'), v.firstName, { maxWidth: 760 })}
${field(392, 400, L('card_l_goat'), v.goat, { maxWidth: 760 })}
${field(392, 480, L('card_l_age'), String(v.age), { maxWidth: 150 })}${field(580, 480, L('card_l_gender'), L(`card_gender_${v.gender}`), { maxWidth: 190 })}${field(800, 480, L('card_l_since'), String(v.since), { maxWidth: 350 })}
${field(392, 560, L('card_l_player'), v.player, { maxWidth: 760 })}
${field(392, 640, L('card_l_club'), v.club, { maxWidth: 440 })}${field(860, 640, L('card_l_number'), `№ ${String(v.fanNumber).padStart(6, '0')}`, { size: 44, color: v.pal.accent, maxWidth: 290 })}
`, idp);
}

/** Orqa tomon: chapda — hujjat ma'lumotlari, o'rtada — statistika, o'ngda — xira rasm va Premium belgisi */
function backGroup(v, L, idp = 'b') {
  const rank = v.rank && v.rank.place
    ? `<text x="500" y="268" ${I} font-size="16" letter-spacing="1.5" fill="${MUTED}">${esc(up(L('card_l_rank')))}</text>
${v.rank.place <= 3 ? medal(520, 302, v.rank.place, 24) : ''}
<text x="${v.rank.place <= 3 ? 550 : 500}" y="312" ${D} font-size="44" fill="${INK}">${esc(up(L('card_rank_value', { place: v.rank.place })))}</text>
<text x="500" y="344" ${I} font-size="18" fill="${MUTED}">${esc(L('card_rank_of', { club: v.club, total: num(v.rank.total) }))}</text>`
    : '';
  const link = v.botUsername ? `t.me/${v.botUsername}` : 'FootballCenter';
  return shell(v, `
<rect width="${W}" height="22" fill="${v.pal.band}"/><rect y="22" width="${W}" height="6" fill="${v.pal.stripe}"/>
${field(48, 76, L('card_l_region'), v.region, { size: 40, maxWidth: 400 })}
${field(48, 172, L('card_l_fan_number'), `№ ${String(v.fanNumber).padStart(6, '0')}`, { size: 44, color: v.pal.accent, maxWidth: 400 })}
${field(48, 268, L('card_l_activated'), v.activated, { size: 40, maxWidth: 400 })}
${field(48, 364, L('card_l_issued'), 'FootballCenter', { size: 40, maxWidth: 400 })}
${field(500, 76, L('card_l_points'), num(v.points), { size: 44, color: v.pal.accent, maxWidth: 400 })}
${rank}
${v.achievements ? field(500, 172, L('card_l_achievements'), `${v.achievements.earned} / ${v.achievements.total}`, { size: 40, color: v.pal.accent, maxWidth: 400 }) : ''}
${photoBox(v, 960, 60, 170, 220, `${idp}p`, 0.35)}
${trophy(1045, 300, `${idp}t`)}
<rect x="0" y="470" width="${W}" height="286" fill="#ffffff" opacity="0.88"/>
${barcode.svgBars(v.botUsername ? `https://t.me/${v.botUsername}` : 'https://t.me', 200, 510, 800, 150, INK)}
<text x="600" y="702" ${I} font-size="22" letter-spacing="2" text-anchor="middle" fill="${INK}">${esc(link)}</text>
`, idp);
}

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

/** side: front | back | story (1080×1920: ikkala tomon) */
/** Rasm uchun tarjima: parametrlar HTML-escape qilinmaydi (SVG'da esc() bir marta qo'llanadi) */
function plainT(lang) { return (k, p) => t(lang, k, p && Object.fromEntries(Object.entries(p).map(([a, b]) => [a, raw(b)]))); }

function cardSvg(v, lang, side) {
  const L = plainT(lang);
  if (side === 'front') return svgDoc(W, H, frontGroup(v, L));
  if (side === 'back') return svgDoc(W, H, backGroup(v, L));
  const s = 960 / W;
  const title = up(L('card_header_club', { club: v.club }));
  return svgDoc(1080, 1920, `<rect width="1080" height="1920" fill="${v.pal.dark}"/>
<text x="540" y="200" ${D} font-size="${fit(title, 76, 960)}" text-anchor="middle" fill="#ffffff">${esc(title)}</text>
<text x="540" y="275" ${D} font-size="52" text-anchor="middle" fill="#f2c94c">${esc(up(L('card_story_title')))}</text>
<g transform="translate(60,360) scale(${s})">${frontGroup(v, L, 'sf')}</g>
<g transform="translate(60,1040) scale(${s})">${backGroup(v, L, 'sb')}</g>
<text x="540" y="1790" ${I} font-size="34" text-anchor="middle" fill="#ffffff">${esc(v.botUsername ? `@${v.botUsername}` : 'FootballCenter')}</text>`);
}

const FONT_FILES = [path.join(__dirname, '..', '..', 'public', 'app', 'fonts', 'Oswald-Bold.ttf')];
function toPng(svg) {
  const { Resvg } = require('@resvg/resvg-js');
  return new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

// Chizilgan rasmlar keshi: karta/points/o'rin o'zgarmaguncha qayta chizilmaydi
const pngCache = new Map();
const PNG_CACHE_MAX = 200;
function cached(key, make) {
  if (pngCache.has(key)) return pngCache.get(key);
  const png = make();
  pngCache.set(key, png);
  if (pngCache.size > PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value);
  return png;
}
function clearImageCache() { pngCache.clear(); }

async function viewModel(u, lang) {
  const c = await cardRow(u.id);
  if (!c) return null;
  const ach = require('./achievements');
  const [colors, rank, firstLimit, earned] = await Promise.all([
    clubColors(c.team_id, c.team_logo), clubRank(c), settings.get('fan_card_first_fans'), ach.count(u.id),
  ]);
  return {
    key: [DESIGN, colors.primary, colors.secondary, c.updated_at && new Date(c.updated_at).getTime(), c.team_id, users.totalPoints(u), rank.place, rank.total, lang, firstLimit, earned].join(':'),
    club: c.team_name, logoPng: colors.logoPng, pal: palette(colors.primary, colors.secondary),
    photo: readPhoto(c.photo_path),
    lastName: c.last_name, firstName: c.first_name, goat: c.goat, age: currentYear() - c.birth_year, gender: c.gender,
    player: c.fav_player, since: c.fan_since, fanNumber: c.fan_number, first: c.fan_number <= Number(firstLimit), firstLimit,
    region: regionName(lang, c.region), points: users.totalPoints(u),
    activated: formatDate(c.activated_at), rank, botUsername: config.botUsername || null,
    achievements: { earned, total: ach.LIST.length },
  };
}

/** Karta rasmi (PNG). Premium bo'lmasa yoki karta faollashtirilmagan bo'lsa — null */
async function renderPng(telegramId, side = 'story') {
  if (!SIDES.includes(side)) return null;
  const u = await users.byTelegramId(telegramId);
  if (!u || !users.isPremium(u)) return null;
  const lang = LOCALES[u.language] ? u.language : 'uz';
  const v = await viewModel(u, lang);
  if (!v) return null;
  return cached(`${u.id}:${side}:${v.key}`, () => toPng(cardSvg(v, lang, side)));
}

/** Premium bo'lmaganlar uchun namunaviy (xira ko'rsatiladigan) karta */
function samplePng(lang) {
  const l = LOCALES[lang] ? lang : 'uz';
  return cached(`sample:${l}`, () => {
    const L = plainT(l);
    const v = {
      club: 'FootballCenter', logoPng: null, pal: palette(DEFAULT_COLOR), photo: null,
      lastName: L('card_sample_last'), firstName: L('card_sample_first'), goat: '—', age: 20, gender: 'male',
      player: '—', since: currentYear(), fanNumber: 1, first: false, firstLimit: 100,
    };
    return toPng(cardSvg(v, l, 'front'));
  });
}

module.exports = {
  REGIONS, GENDERS, ADMIN_FIELDS, CardError, setFetch, dominantColors, textOn, palette, teamColors, clubColors, regionsList, HEX_RE,
  getCard, activate, updateFavorites, uploadPhoto, changeClub, adminRemovePhoto, adminUpdate, cardRow, clubRank,
  imagePath, verifyImagePath, cardSvg, renderPng, samplePng, clearImageCache, FONT_FILES,
  // 📤 Natija kartasi (shareCard.js) uchun umumiy chizish yordamchilari
  draw: { esc, up, fit, num, toPng, plainT, cached, D, I },
  colorUtils: { lighten: shade, luminance, textOn },
};

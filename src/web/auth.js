const crypto = require('crypto');
const config = require('../config');
const users = require('../services/users');
const { createLimiter } = require('../services/ratelimit');

// Mini App: bitta foydalanuvchi daqiqasiga 120 tadan ortiq so'rov yubora olmaydi
const apiLimiter = createLimiter({ max: 120, windowMs: 60 * 1000 });

const MAX_AGE_SEC = 24 * 3600;

/** Telegram Web App initData imzosini tekshirish. To'g'ri bo'lsa — { user, authDate } */
function verifyInitData(initData, botToken = config.botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;
  let user;
  try { user = JSON.parse(params.get('user')); } catch (e) { return null; }
  if (!user || !user.id) return null;
  return { user, authDate, startParam: params.get('start_param') };
}

/** Testlar va lokal tekshiruv uchun initData yaratish */
function signInitData(user, botToken = config.botToken, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

function initDataFromReq(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('tma ') ? h.slice(4) : null;
}

/** /api/* — Telegram foydalanuvchisi talab qilinadi */
async function requireTelegramUser(req, res, next) {
  try {
    const v = verifyInitData(initDataFromReq(req));
    if (!v) return res.status(401).json({ error: 'unauthorized' });
    if (!apiLimiter.hit(v.user.id).allowed) {
      res.set('Retry-After', '30');
      return res.status(429).json({ error: 'too_many_requests' });
    }
    const { user } = await users.upsertFromTelegram(v.user);
    if (user.is_blocked) return res.status(403).json({ error: 'blocked' });
    req.user = user;
    return next();
  } catch (e) { return next(e); }
}

// ---- Admin sessiyasi (brauzerdan login+parol orqali kirish uchun)
const SESSION_TTL = 7 * 24 * 3600 * 1000;

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const calc = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (calc.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

function getCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function checkPassword(login, password) {
  if (!config.adminLogin || !config.adminPassword) return false;
  const eq = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  return eq(login, config.adminLogin) && eq(password, config.adminPassword);
}

/** /api/admin/* — Telegram orqali admin YOKI login+parol sessiyasi */
async function requireAdmin(req, res, next) {
  try {
    const v = verifyInitData(initDataFromReq(req));
    if (v) {
      const u = await users.byTelegramId(v.user.id);
      if (u && users.isAdmin(u) && !u.is_blocked) { req.admin = { via: 'telegram', user: u }; return next(); }
      return res.status(403).json({ error: 'forbidden' });
    }
    const s = readSession(getCookie(req, 'fc_admin'));
    if (s) { req.admin = { via: 'password', login: s.login }; return next(); }
    return res.status(401).json({ error: 'unauthorized' });
  } catch (e) { return next(e); }
}

module.exports = { verifyInitData, signInitData, requireTelegramUser, requireAdmin, signSession, readSession, checkPassword, SESSION_TTL };

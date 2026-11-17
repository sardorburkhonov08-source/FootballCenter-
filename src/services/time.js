// Barcha vaqt hisoblari Asia/Tashkent (UTC+5, yozgi vaqt yo'q) zonasida.
const TZ = 'Asia/Tashkent';
const OFFSET_MS = 5 * 60 * 60 * 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** UTC Date -> Toshkent "devor soati" komponentlari */
function parts(date = new Date()) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
  };
}

/** Toshkent vaqtidagi komponentlardan UTC Date */
function fromParts(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute) - OFFSET_MS);
}

/**
 * Hafta: Seshanba 12:00 dan keyingi Seshanba 11:59:59 gacha.
 * Qaytadi: { start, end } — end eksklyuziv (keyingi seshanba 12:00).
 */
function weekRange(date = new Date()) {
  const p = parts(date);
  // Seshanba = 2
  let daysBack = (p.weekday - 2 + 7) % 7;
  let start = fromParts(p.year, p.month, p.day - daysBack, 12, 0);
  if (start > date) start = new Date(start.getTime() - 7 * DAY);
  return { start, end: new Date(start.getTime() + 7 * DAY) };
}

/** Kalendar oyi (Toshkent vaqti bo'yicha) */
function monthRange(date = new Date()) {
  const p = parts(date);
  return { start: fromParts(p.year, p.month, 1), end: fromParts(p.year, p.month + 1, 1) };
}

function prevRange(kind, date = new Date()) {
  const cur = kind === 'weekly' ? weekRange(date) : monthRange(date);
  return kind === 'weekly' ? weekRange(new Date(cur.start.getTime() - 1)) : monthRange(new Date(cur.start.getTime() - 1));
}

/** Toshkent kun boshlanishi (00:00) */
function dayStart(date = new Date()) {
  const p = parts(date);
  return fromParts(p.year, p.month, p.day);
}

/** YYYY-MM-DD (Toshkent) */
function ymd(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

/** DD.MM.YYYY */
function formatDate(date) {
  if (!date) return '—';
  const p = parts(new Date(date));
  return `${pad(p.day)}.${pad(p.month + 1)}.${p.year}`;
}

/** DD.MM.YYYY HH:MM */
function formatDateTime(date) {
  if (!date) return '—';
  const p = parts(new Date(date));
  return `${pad(p.day)}.${pad(p.month + 1)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "DD.MM.YYYY" yoki "DD.MM.YYYY HH:MM" (Toshkent) -> Date */
function parseDate(text, endOfDay = false) {
  const m = String(text || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map((x) => (x === undefined ? undefined : Number(x)));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h !== undefined) return fromParts(y, mo - 1, d, h, mi);
  return endOfDay ? new Date(fromParts(y, mo - 1, d + 1).getTime() - 1000) : fromParts(y, mo - 1, d);
}

module.exports = {
  TZ, HOUR, DAY, parts, fromParts, weekRange, monthRange, prevRange, dayStart, ymd,
  formatDate, formatDateTime, parseDate,
};

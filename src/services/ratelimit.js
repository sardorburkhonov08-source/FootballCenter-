// Oddiy xotiradagi "sirpanuvchi oyna" limitlagich (bitta server nusxasi uchun yetarli).
// Bir foydalanuvchi qisqa vaqtda juda ko'p so'rov yuborsa — ortiqchalari rad etiladi.
const config = require('../config');

function createLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> { times: number[], warned: boolean }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.times.length || now - v.times[v.times.length - 1] > windowMs) hits.delete(k);
  }, Math.max(windowMs, 30000));
  if (timer.unref) timer.unref();

  /** { allowed, warn } — warn: oynada birinchi marta rad etilganda true (bir marta ogohlantirish uchun) */
  function hit(key) {
    if (config.rateLimitOff) return { allowed: true, warn: false };
    const now = Date.now();
    const e = hits.get(key) || { times: [], warned: false };
    while (e.times.length && now - e.times[0] > windowMs) e.times.shift();
    if (e.times.length >= max) {
      const warn = !e.warned;
      e.warned = true;
      hits.set(key, e);
      return { allowed: false, warn };
    }
    e.times.push(now);
    e.warned = false;
    hits.set(key, e);
    return { allowed: true, warn: false };
  }

  return { hit };
}

module.exports = { createLimiter };

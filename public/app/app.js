/* FootballCenter Web App */
(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = (tg && tg.initData) || '';
  const I = window.I18N;
  const t = (k, p) => I.t(k, p);
  const TZ_OFFSET = 5 * 3600 * 1000; // Asia/Tashkent

  const S = {
    me: null, botUsername: null, tab: 'home', homeSub: 'matches', date: null,
    stacks: { home: [], games: [], community: [], profile: [] },
    scores: {},
    lb: { overall: 'daily', manager: 'weekly', quiz: 'weekly', score: 'weekly', duel: 'weekly', penalty: 'weekly', crossbar: 'weekly', keepy: 'weekly' },
    prizeRotate: 15,
    expanded: new Set(),
  };
  let cleanups = [];

  // ---------------- DOM yordamchilari (innerHTML ishlatilmaydi — XSS'dan himoya)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'style') node.setAttribute('style', v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }
  const $ = (id) => document.getElementById(id);
  // Logotip; bo'lmasa yoki yuklanmasa — nomning bosh harfi rangli doirada (bo'sh kulrang doira o'rniga)
  function crestPh(name, cls) {
    const n = String(name || '').trim();
    let h = 0;
    for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return el('span', { class: `crest-ph${cls && cls.includes('lg') ? ' lg' : ''}`, style: n ? `background:hsl(${h} 45% 34%)` : '', text: n ? [...n][0].toUpperCase() : '' });
  }
  function crest(url, cls, name) {
    if (!url) return crestPh(name, cls);
    const img = el('img', { src: url, class: cls || 'crest', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(crestPh(name, cls)), { once: true });
    return img;
  }
  // 📳 Tebranish (sinov): success|error|warning — natija; light|medium|heavy|rigid|soft — zarba; bo'sh — tanlash.
  // Profil → 📳 dan o'chiriladi (localStorage fc_haptic). Ketma-ket ikki marta titramasin — 60 ms oraliq.
  let lastHaptic = 0;
  function hapticOn() { try { return localStorage.getItem('fc_haptic') !== 'off'; } catch (e) { return true; } }
  function haptic(type) {
    if (!hapticOn() || !tg || !tg.HapticFeedback) return;
    const now = Date.now();
    if (now - lastHaptic < 60 && !['success', 'error', 'warning'].includes(type)) return;
    lastHaptic = now;
    try {
      if (['success', 'error', 'warning'].includes(type)) tg.HapticFeedback.notificationOccurred(type);
      else if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(type)) tg.HapticFeedback.impactOccurred(type);
      else tg.HapticFeedback.selectionChanged();
    } catch (e) { /* */ }
  }
  // Har qanday tugma bosilganda — yengil zarba
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button, [role="button"], .item')) haptic('light'); }, true);

  function toast(msg) {
    const box = $('toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { box.hidden = true; }, 3200);
  }

  function modal(title, text, actions) {
    const m = $('modal');
    m.replaceChildren(el('div', { class: 'sheet', onclick: (e) => e.stopPropagation() },
      el('h3', { text: title }), text ? el('p', { class: 'muted', text }) : null,
      el('div', { class: 'stack' }, actions || [])));
    m.hidden = false;
    m.onclick = () => { m.hidden = true; };
  }
  function closeModal() { $('modal').hidden = true; }

  function openBot(start) {
    const url = S.botUsername ? `https://t.me/${S.botUsername}${start ? `?start=${start}` : ''}` : null;
    if (url && tg && tg.openTelegramLink) tg.openTelegramLink(url);
    else if (tg) tg.close();
  }

  function premiumModal(text) {
    haptic('warning');
    modal(t('premium_only_title'), typeof text === 'string' ? text : t('premium_only_text'), [
      el('button', { class: 'btn block', text: t('buy_premium_btn'), onclick: () => { closeModal(); openBot('premium'); } }),
      el('button', { class: 'btn ghost block', text: t('close_btn'), onclick: closeModal }),
    ]);
  }

  // ---------------- API
  class ApiError extends Error { constructor(status, body) { super(body && body.error ? body.error : `HTTP ${status}`); this.status = status; this.body = body || {}; } }
  // Brauzer ichidagi qisqa kesh: tab/sana almashtirganda bir xil ma'lumot serverdan qayta so'ralmaydi
  const CLIENT_CACHE = [
    [/^\/matches\?/, 60000], [/^\/competitions/, 300000], [/^\/leaderboard\//, 15000],
    [/^\/(banners|prizes)/, 300000], [/^\/manager\/games$/, 15000],
    [/^\/search\/teams/, 600000], [/^\/teams\/\d+\/matches/, 120000],
  ];
  const clientCache = new Map();

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const rule = method === 'GET' && !opts.fresh ? CLIENT_CACHE.find(([re]) => re.test(path)) : null;
    if (rule) {
      const hit = clientCache.get(path);
      if (hit && Date.now() - hit.at < rule[1]) return hit.data;
    }
    const res = await fetch(`/api${path}`, {
      method,
      headers: { Authorization: `tma ${initData}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* */ }
    if (!res.ok) throw new ApiError(res.status, body);
    if (rule) clientCache.set(path, { at: Date.now(), data: body });
    if (method !== 'GET' && !opts.keepCache) clientCache.clear(); // ma'lumot o'zgardi — keshni tozalaymiz
    return body;
  }

  function errorBox(err, retry) {
    let msg = t('error_generic');
    if (err && err.status === 503) {
      const reason = err.body && err.body.reason;
      msg = reason === 'plan' ? t('football_plan') : reason === 'limit' ? t('football_limit') : t('football_unavailable');
    }
    if (err && err.status === 429) msg = t('too_fast');
    return el('div', { class: 'card center' }, el('p', { text: msg }), retry ? el('button', { class: 'btn ghost', text: t('retry'), onclick: retry }) : null);
  }
  function skeleton(n) { return el('div', null, Array.from({ length: n || 3 }, () => el('div', { class: 'skeleton' }))); }

  // ---------------- Vaqt (Toshkent)
  function tashkentYmd(d) { return new Date((d ? d.getTime() : Date.now()) + TZ_OFFSET).toISOString().slice(0, 10); }
  function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function hhmm(iso) { return new Date(new Date(iso).getTime() + TZ_OFFSET).toISOString().slice(11, 16); }
  function ddmm(iso) { const s = new Date(new Date(iso).getTime() + TZ_OFFSET).toISOString(); return `${s.slice(8, 10)}.${s.slice(5, 7)}`; }
  function ddmmyyyy(iso) { const s = new Date(new Date(iso).getTime() + TZ_OFFSET).toISOString(); return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`; }
  const MONTHS = {
    uz: ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'],
    ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  };
  const WEEKDAYS = {
    uz: ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'],
    ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  };
  function localized(table, idx) {
    const v = (table[I.lang === 'uz_cyrl' ? 'uz' : I.lang] || table.uz)[idx];
    return I.lang === 'uz_cyrl' && window.FCTranslit ? window.FCTranslit.translit(v) : v;
  }
  function fmtShortDate(ymd) {
    const d = new Date(`${ymd}T00:00:00Z`);
    return `${d.getUTCDate()} ${localized(MONTHS, d.getUTCMonth())}`;
  }
  function fmtWeekday(ymd) { return localized(WEEKDAYS, new Date(`${ymd}T00:00:00Z`).getUTCDay()); }
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  function money(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  // ---------------- 🎬 Banner (barcha bo'limlar tepasida)
  let lottieLoading = null;
  function loadLottie() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (!lottieLoading) {
      lottieLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
        s.onload = () => resolve(window.lottie);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return lottieLoading;
  }

  function openLink(url) {
    if (!url) return;
    if (tg && /^https:\/\/t\.me\//.test(url) && tg.openTelegramLink) tg.openTelegramLink(url);
    else if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }

  async function initBanner() {
    let banners = [];
    try { banners = await api('/banners'); } catch (e) { return; }
    if (!banners.length) return;
    const box = $('banner');
    box.hidden = false;
    let muted = true;
    // 📐 Banner media'ning o'z nisbatida ko'rinadi (qirqilmaydi). Juda tik bo'lsa — ekranning 70% idan oshmaydi,
    // qolgan joy rasmning xira nusxasi bilan to'ldiriladi.
    const ratios = banners.map((b) => (b.width && b.height ? b.width / b.height : null));
    let i = -1;
    const fitHeight = () => {
      if (i < 0) return;
      const r = ratios[i] || 16 / 7;
      const h = Math.min(box.clientWidth / r, window.innerHeight * 0.7);
      box.style.height = `${Math.round(h)}px`;
    };
    const slides = banners.map((b, k) => {
      let media;
      const learn = (w, h) => { if (!ratios[k] && w && h) { ratios[k] = w / h; if (k === i) fitHeight(); } };
      if (b.type === 'video') {
        media = el('video', { src: b.url, muted: true, loop: true, playsinline: true, preload: 'metadata' });
        media.addEventListener('loadedmetadata', () => learn(media.videoWidth, media.videoHeight), { once: true });
      } else if (b.type === 'lottie') {
        media = el('div', { class: 'lottie' });
        loadLottie().then((lottie) => lottie.loadAnimation({ container: media, renderer: 'svg', loop: true, autoplay: true, path: b.url })).catch(() => {});
      } else {
        media = el('img', { src: b.url, alt: '' });
        media.addEventListener('load', () => learn(media.naturalWidth, media.naturalHeight), { once: true });
      }
      if (media.tagName === 'VIDEO') media.muted = true;
      const backdrop = b.type === 'image' || b.type === 'animation' ? el('img', { class: 'banner-bd', src: b.url, alt: '', 'aria-hidden': 'true' }) : null;
      return el('div', { class: 'banner-slide', onclick: () => openLink(b.link) }, backdrop, media);
    });
    window.addEventListener('resize', fitHeight);
    const sound = el('button', { class: 'banner-sound', 'aria-label': 'sound', text: '🔇', hidden: true });
    sound.addEventListener('click', (e) => {
      e.stopPropagation();
      muted = !muted;
      sound.textContent = muted ? '🔇' : '🔊';
      box.querySelectorAll('video').forEach((v) => { v.muted = muted; });
    });
    const dots = el('div', { class: 'banner-dots' }, banners.length > 1 ? banners.map(() => el('span')) : []);
    box.replaceChildren(...slides, sound, dots);
    let timer = null;
    const show = (n) => {
      i = n % banners.length;
      fitHeight();
      slides.forEach((s, k) => {
        s.classList.toggle('active', k === i);
        const v = s.querySelector('video');
        if (v) { if (k === i) { v.muted = muted; v.currentTime = 0; v.play().catch(() => {}); } else v.pause(); }
      });
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      sound.hidden = banners[i].type !== 'video';
      clearTimeout(timer);
      if (banners.length > 1) timer = setTimeout(() => show(i + 1), Math.max(2, banners[i].duration) * 1000);
    };
    show(0);
  }

  // ---------------- 🎁 Sovrin bloki (kichik, 15 soniyada almashadi)
  function prizeBlock(kind) {
    const box = el('div', { class: 'prize', hidden: true });
    api(`/prizes?kind=${kind}`).then((list) => {
      if (!list.length) return;
      box.hidden = false;
      let i = 0;
      const render = () => {
        const p = list[i % list.length];
        let media = null;
        if (p.url && p.type === 'video') media = el('video', { src: p.url, muted: true, autoplay: true, loop: true, playsinline: true });
        else if (p.url && p.type !== 'lottie') media = el('img', { src: p.url, alt: '' });
        if (media && media.tagName === 'VIDEO') media.muted = true;
        box.replaceChildren(
          media ? el('div', { class: 'pm' }, media) : el('div', { class: 'pm center', style: 'padding:0;display:flex;align-items:center;justify-content:center;font-size:26px' }, '🏆'),
          el('div', { class: 'grow' },
            el('div', { class: 'small gold', style: 'font-weight:700' }, `${t('prize_title')} · ${t(p.period === 'monthly' ? 'prize_monthly' : 'prize_weekly')}`),
            el('div', { class: 'pt', text: p.text })),
        );
        i += 1;
      };
      render();
      if (list.length > 1) {
        const timer = setInterval(render, (S.prizeRotate || 15) * 1000);
        cleanups.push(() => clearInterval(timer));
      }
    }).catch(() => {});
    return box;
  }

  // ---------------- Navigatsiya
  function currentStack() { return S.stacks[S.tab]; }
  // ✨ Sahifalar surilib ochiladi (oldinga — o'ngdan, orqaga — chapdan)
  let navDir = '';
  function push(page) { currentStack().push(page); haptic(); navDir = 'fwd'; render(); }
  function goBack() { if (currentStack().length) { currentStack().pop(); navDir = 'back'; render(); } }

  function updateBackButton() {
    if (!tg || !tg.BackButton) return;
    if (currentStack().length) tg.BackButton.show(); else tg.BackButton.hide();
  }

  function backBar(title) {
    return el('div', { class: 'page-head' },
      el('button', { class: 'back', text: t('back'), onclick: goBack }),
      title ? el('div', { class: 'grow ellipsis', style: 'font-weight:700', text: title }) : null);
  }

  function render() {
    cleanups.forEach((fn) => { try { fn(); } catch (e) { /* */ } });
    cleanups = [];
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    const view = $('view');
    view.replaceChildren();
    view.classList.remove('nav-fwd', 'nav-back');
    if (navDir) { void view.offsetWidth; view.classList.add(`nav-${navDir}`); navDir = ''; }
    const stack = currentStack();
    const page = stack[stack.length - 1];
    updateBackButton();
    window.scrollTo(0, 0);
    if (page) return page.render(view);
    return ({ home: renderHome, games: renderGames, community: renderCommunity, profile: renderProfile })[S.tab](view);
  }



  // ================= 🖼 Avatar, 🔊 ovozlar, 🎨 klub rangi
  function avatar(url, name, cls = '') {
    const letter = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
    if (!url) return el('span', { class: `ava ${cls}`, text: letter });
    const img = el('img', { class: `ava ${cls}`, src: url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: `ava ${cls}`, text: letter })));
    return img;
  }

  /** O'yin ovozlari — WebAudio bilan sintez qilinadi (fayl yuklanmaydi). Profil → 🔊 dan o'chiriladi. */
  const SFX = (() => {
    let ctx = null;
    const on = () => { try { return localStorage.getItem('fc_sound') !== 'off'; } catch (e) { return true; } };
    const ac = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
    const tone = (freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0 } = {}) => {
      const a = ac(); if (!a) return;
      const t0 = a.currentTime + delay;
      const o = a.createOscillator(); const g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    const noise = (dur, vol = 0.25) => {
      const a = ac(); if (!a) return;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = a.createBufferSource(); const g = a.createGain(); const f = a.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = vol;
      src.buffer = buf; src.connect(f).connect(g).connect(a.destination); src.start();
    };
    const play = {
      none: () => { ac(); },
      kick: () => { noise(0.08, 0.35); tone(140, 0.12, { type: 'triangle', vol: 0.3, slide: -80 }); },
      goal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.16, delay: i * 0.09 })); },
      save: () => { tone(330, 0.25, { type: 'sawtooth', vol: 0.08, slide: -150 }); },
      whistle: () => { tone(2600, 0.18, { vol: 0.08 }); tone(2600, 0.32, { vol: 0.08, delay: 0.22 }); },
      tick: () => tone(880, 0.05, { type: 'square', vol: 0.05 }),
      win: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.12 })); },
      lose: () => { tone(300, 0.3, { type: 'triangle', vol: 0.12, slide: -120 }); tone(200, 0.4, { type: 'triangle', vol: 0.1, delay: 0.25, slide: -80 }); },
    };
    return {
      on,
      set(v) { try { localStorage.setItem('fc_sound', v ? 'on' : 'off'); } catch (e) { /* */ } },
      play(name) {
        // 📳 Ovoz bilan birga tebranish (ovoz o'chiq bo'lsa ham)
        const hp = { kick: 'medium', goal: 'success', save: 'warning', win: 'success', lose: 'error', whistle: 'rigid' }[name];
        if (hp) haptic(hp);
        if (!on()) return;
        try { play[name] && play[name](); } catch (e) { /* */ }
      },
    };
  })();

  /** 🎨 Sevimli klub rangi: Mini App aksenti foydalanuvchining klubi rangida (muxlislik kartasi bo'lsa) */
  function applyClub(club) {
    const root = document.documentElement;
    try { if (club) localStorage.setItem('fc_club', JSON.stringify(club)); else localStorage.removeItem('fc_club'); } catch (e) { /* */ }
    if (!club) { ['--accent', '--accent-ink', '--grad'].forEach((k) => root.style.removeProperty(k)); return; }
    const light = root.dataset.theme === 'light';
    const c = light ? club.light : club.dark;
    root.style.setProperty('--accent', c);
    root.style.setProperty('--accent-ink', light ? club.inkLight : club.inkDark);
    root.style.setProperty('--grad', `linear-gradient(135deg, ${c} 0%, ${club.primary} 60%, ${club.secondary || club.primary} 140%)`);
  }
  function applySavedClub() { try { const c = JSON.parse(localStorage.getItem('fc_club') || 'null'); if (c) applyClub(c); } catch (e) { /* */ } }

  /** Daraja halqasi (SVG) — profil rasmi atrofida */
  function levelRing(url, name, pct) {
    const r = 46; const c = 2 * Math.PI * r;
    const ring = el('span', { class: 'ring' });
    ring.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="6"/>`
      + `<circle class="ring-fill" cx="50" cy="50" r="${r}" fill="none" stroke="url(#ringg)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" transform="rotate(-90 50 50)"/>`
      + '<defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7d774"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs></svg>';
    ring.append(avatar(url, name, 'big'));
    setTimeout(() => { const f = ring.querySelector('.ring-fill'); if (f) f.style.strokeDashoffset = String(c * (1 - Math.max(0.02, Math.min(1, pct)))); }, 80);
    return ring;
  }

  // ================= ✨ Effektlar: 🎉 konfetti, raqamlarni sanab chiqish, Telegram mavzusi
  function confetti() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const cv = document.createElement('canvas');
      cv.id = 'confetti';
      cv.width = window.innerWidth * 2; cv.height = window.innerHeight * 2;
      document.body.append(cv);
      const ctx = cv.getContext('2d');
      const colors = ['#2ecc71', '#f2c94c', '#ffffff', '#27ae60', '#f7d774', '#e5534b'];
      const parts = Array.from({ length: 140 }, () => ({
        x: cv.width / 2 + (Math.random() - 0.5) * cv.width * 0.3, y: cv.height * 0.35,
        vx: (Math.random() - 0.5) * 26, vy: -Math.random() * 30 - 10, s: 8 + Math.random() * 10,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)],
      }));
      const t0 = performance.now();
      const frame = (now) => {
        const k = (now - t0) / 1800;
        ctx.clearRect(0, 0, cv.width, cv.height);
        for (const p of parts) {
          p.vy += 1.1; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
          ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.r);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
        }
        if (k < 1) requestAnimationFrame(frame); else cv.remove();
      };
      requestAnimationFrame(frame);
      haptic('success');
      SFX.play('win');
    } catch (e) { /* */ }
  }

  const MASCOT = '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="56" r="40" fill="#f4f7f5" stroke="#1d2b23" stroke-width="3"/>'
    + '<path d="M60 30l13 9-5 15H52l-5-15z" fill="#1d2b23"/><path d="M27 52l13-4 7 15-8 12-13-6zM93 52l-13-4-7 15 8 12 13-6z" fill="#1d2b23" opacity=".85"/>'
    + '<circle cx="48" cy="66" r="5" fill="#1d2b23"/><circle cx="72" cy="66" r="5" fill="#1d2b23"/><circle cx="50" cy="64" r="1.6" fill="#fff"/><circle cx="74" cy="64" r="1.6" fill="#fff"/>'
    + '<path d="M50 79q10 8 20 0" fill="none" stroke="#1d2b23" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M24 92q-8 8-2 16M96 92q8 8 2 16" fill="none" stroke="#2ecc71" stroke-width="6" stroke-linecap="round"/><ellipse cx="60" cy="112" rx="26" ry="5" fill="#000" opacity=".18"/></svg>';
  /** "📭 Hali yo'q" kartalari — futbol personaji va matn bilan */
  function emptyState(node) {
    if (node.dataset.empty || !/^📭/.test(node.textContent.trim()) || node.children.length) return;
    node.dataset.empty = '1';
    const text = node.textContent.trim().replace(/^📭\s*/, '');
    node.classList.add('empty');
    node.innerHTML = '';
    const pic = el('div', { class: 'mascot' });
    pic.innerHTML = MASCOT;
    node.append(pic, el('div', { text }));
  }

  /** Statistikadagi raqamlar 0 dan sanab chiqadi (bir marta) */
  function countUp(node) {
    const txt = node.textContent.trim();
    if (node.dataset.counted || !/^\d[\d\s]*$/.test(txt)) return;
    node.dataset.counted = '1';
    const target = Number(txt.replace(/\s/g, ''));
    if (!target) return;
    const t0 = performance.now();
    const dur = Math.min(900, 300 + target * 4);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      node.textContent = money(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  try {
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        n.querySelectorAll && n.querySelectorAll('.stat b, .count-up').forEach(countUp);
        // 📭 Bo'sh holatlar — futbol personaji bilan
        const empties = n.matches && n.matches('.card.center.muted, .center.muted') ? [n] : [];
        if (n.querySelectorAll) n.querySelectorAll('.card.center.muted, .center.muted').forEach((x) => empties.push(x));
        empties.forEach(emptyState);
      }
    }).observe(document.getElementById('view'), { childList: true, subtree: true });
  } catch (e) { /* */ }

  /** Telegram mavzusi: yorug' / qorong'i (egasi talabi bilan) */
  function applyTheme() {
    const light = !!(tg && tg.colorScheme === 'light');
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const bg = light ? '#f2f6f3' : '#0c1712';
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); if (tg.setBottomBarColor) tg.setBottomBarColor(bg); } catch (e) { /* eski versiyalar */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
    applySavedClub();
  }

  // ================= ✅ BUGUN: salom, daraja va kunlik vazifalar (Home va Games tepasida)
  const QUEST_GAME = { quiz: 'quiz', quiz3: 'quiz', duel: 'duel', penalty: 'penalty', crossbar: 'crossbar', keepy: 'keepy', score: 'score' };
  // ================= 🎨 SVG belgilar (yangi dizayn)
  function svgNode(markup, cls) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.innerHTML = markup;   // faqat koddagi o'zgarmas SVG (foydalanuvchi matni emas)
    return span;
  }
  /** FootballCenter belgisi: qiya "F" va to'p */
  function logoMark() {
    return svgNode(`<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lgF" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b8f5c8"/></linearGradient></defs>
<path d="M14 18h7M9 26h8M6 34h7" stroke="#7CFC00" stroke-width="3.2" stroke-linecap="round"/>
<path d="M24 52 32 12h26l-3 9H40l-2 8h14l-3 9H36l-3 14z" fill="url(#lgF)"/>
<circle cx="49" cy="47" r="9" fill="#fff"/><path d="M49 42l4 3-1.5 4.6h-5L45 45z" fill="#0c1712"/><path d="M49 38v4M57.5 44.5 53 45M54 55l-2.5-5.4M44 55l2.5-5.4M40.5 44.5 45 45" stroke="#0c1712" stroke-width="1.4"/></svg>`, 'logo-mark');
  }
  /** Kartadagi katta to'p (fon bezagi) */
  function ballArt() {
    return svgNode(`<svg viewBox="0 0 200 200" aria-hidden="true"><defs><radialGradient id="ballG" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#3ddc84" stop-opacity=".55"/><stop offset=".6" stop-color="#145c32" stop-opacity=".55"/><stop offset="1" stop-color="#062012" stop-opacity=".6"/></radialGradient></defs>
<circle cx="100" cy="100" r="96" fill="url(#ballG)" stroke="#0a2a17" stroke-opacity=".5" stroke-width="2"/>
<g fill="#06210f" fill-opacity=".55"><path d="M100 62l30 22-11 36H81L70 84z"/><path d="M100 4l22 14-6 22H84l-6-22z"/><path d="M168 52l26 10 2 28-20 12-18-14z"/><path d="M178 132l-8 26-26 14-12-20 16-20z"/><path d="M60 176l-26-10-12-24 18-14 20 18z"/><path d="M6 96l6-30 24-10 10 24-18 20z"/></g>
<g stroke="#0a2a17" stroke-opacity=".6" stroke-width="2" fill="none"><path d="M100 62V40M130 84l28-6M119 120l25 18M81 120l-21 18M70 84l-34-4"/></g></svg>`, 'ball-art');
  }
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';

  function greeting() {
    const h = new Date().getHours();
    return t(h < 5 ? 'today_night' : h < 12 ? 'today_morning' : h < 18 ? 'today_day' : h < 23 ? 'today_evening' : 'today_night', { name: S.me.firstName || '' });
  }

  function todayCard(container, compact) {
    const box = el('div', { class: 'card today', style: 'margin-bottom:14px' }, el('div', { class: 'hello', text: greeting() }), el('div', { class: 'sub', text: '…' }));
    container.append(box);
    const draw = async () => {
      let d;
      try { d = await api('/today', { fresh: true }); } catch (e) { box.remove(); return; }
      applyClub(d.club || null);
      const lv = d.level;
      // Yangi daraja — 🎉
      try {
        const prev = Number(localStorage.getItem('fc_level') || 0);
        if (prev && lv.level > prev) confetti();
        localStorage.setItem('fc_level', String(lv.level));
      } catch (e) { /* */ }
      const pct = lv.next ? Math.round(((lv.xp - lv.from) / (lv.next - lv.from)) * 100) : 100;
      const bar = el('div', { class: 'lv-bar' }, el('span', { style: 'width:0%' }));
      setTimeout(() => { bar.firstChild.style.width = `${Math.max(3, pct)}%`; }, 60);
      const parts = [
        ballArt(),
        el('div', { class: 'td-head' },
          logoMark(),
          el('span', { class: 'td-sep' }),
          el('div', { class: 'td-hello' }, el('div', { class: 'td-hi', text: t('td_welcome') }),
            el('div', { class: 'td-row' }, el('div', { class: 'td-name', text: `${S.me.firstName || ''}!` }),
              el('span', { class: 'lv-badge' }, el('span', { class: 'lv-star', text: '★' }), `Lv ${lv.level} • ${lv.name}`)))),
        bar,
        el('div', { class: 'td-stats' },
          el('span', null, el('span', { class: 'td-ico', text: '⭐' }), el('b', { class: 'count-up', text: money(d.points) }), ` ${t('td_pts')}`),
          el('span', null, el('span', { class: 'td-ico', text: '🏆' }), lv.next ? t('td_next', { left: money(lv.next - lv.xp), n: lv.level + 1 }) : t('lv_max'))),
      ];
      const q = d.quests;
      if (q && compact) {
        parts.push(el('button', { type: 'button', class: 'q-mini', onclick: () => { S.tab = 'games'; S.stacks.games = []; render(); } },
          svgNode(ICON_CHECK, `q-check${q.allDone || q.claimed ? ' done' : ''}`),
          el('span', { text: q.claimed ? t('q_claimed', { n: q.reward }) : `${t('q_title_plain')}: ${q.done}/${q.total}` }),
          q.streak ? el('span', { class: 'streak', text: t('q_streak', { n: q.streak }) }) : null, el('span', { class: 'q-chev', text: '›' })));
      } else if (q) {
        const qbox = el('div', { class: 'card quests', style: 'color:var(--text)' },
          el('div', { class: 'row between' }, el('b', { text: t('q_title') }),
            q.streak ? el('span', { class: 'streak', text: t('q_streak', { n: q.streak }) }) : null),
          q.quests.map((x) => el('button', { type: 'button', class: `quest${x.done ? ' done' : ''}`, style: 'width:100%;text-align:left', onclick: () => {
            if (x.id === 'bonus') { openBot(); return; }
            if (x.id === 'react') { S.tab = 'community'; S.stacks.community = []; render(); return; }
            const g = GAMES.find((y) => y.key === QUEST_GAME[x.id]);
            if (g) { S.tab = 'games'; S.stacks.games = []; render(); g.open(); }
          } },
          el('span', { class: 'qi', text: x.icon }),
          el('span', { class: 'grow' }, el('div', { class: 'qn', text: t(`q_${x.id}`, { n: x.target }) }), el('div', { class: 'qp', text: `${x.progress}/${x.target}` })),
          el('span', { class: 'qc', text: x.done ? '✅' : '›' }))));
        if (q.claimed) qbox.append(el('div', { class: 'small gold', style: 'margin-top:8px;font-weight:700;text-align:center', text: t('q_claimed', { n: q.reward }) }));
        else if (q.allDone) {
          const claim = el('button', { class: 'btn block gold-btn', style: 'margin-top:10px', text: t('q_claim', { n: q.reward }) });
          claim.addEventListener('click', async () => {
            claim.disabled = true;
            try { await api('/quests/claim', { method: 'POST' }); confetti(); toast(t('q_claimed_toast', { n: q.reward })); draw(); } catch (err) { toast(t('error_generic')); claim.disabled = false; }
          });
          qbox.append(claim);
        } else qbox.append(el('div', { class: 'small muted', style: 'margin-top:8px;text-align:center', text: t('q_left', { done: q.done, total: q.total, n: q.reward }) }));
        parts.push(qbox);
      } else {
        parts.push(el('button', { class: 'card quests', type: 'button', style: 'width:100%;color:var(--text);opacity:.8', onclick: () => premiumModal(t('q_locked')) },
          el('b', { text: t('q_title') }), el('div', { class: 'small muted', style: 'margin-top:4px', text: t('q_locked') })));
      }
      put(box, ...parts);
    };
    draw();
  }

  // ================= 🏠 HOME
  function renderHome(view) {
    todayCard(view, true);
    const subs = [['matches', 'home_matches'], ['competitions', 'home_competitions']];
    if (S.features && S.features.news) subs.push(['news', 'home_news']);
    view.append(el('div', { class: 'seg home-seg' }, subs.map(([k, label]) => el('button', {
      class: S.homeSub === k ? 'on' : '', text: t(label), onclick: () => { S.homeSub = k; haptic(); render(); },
    }))));
    view.append(el('button', { class: 'search-bar', type: 'button', onclick: () => push({ render: renderSearch }) },
      svgNode(ICON_SEARCH, 'sb-ico'), el('span', { class: 'muted', text: t('search_placeholder') })));
    const body = el('div');
    view.append(body);
    if (S.homeSub === 'competitions') return renderCompetitions(body);
    if (S.homeSub === 'news') { body.append(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('news_soon') })); return undefined; }
    return renderMatches(body);
  }

  // ================= 🔍 QIDIRUV
  function norm(v) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }

  function leagueItem(c) {
    return el('button', { class: 'item', onclick: () => push({ render: (v) => renderCompetition(v, c.id, c.name) }) },
      c.emblem ? crest(c.emblem) : el('span', { class: 'crest-ph' }),
      el('span', { class: 'grow ellipsis' }, c.name, c.area ? el('span', { class: 'muted small', text: ` · ${c.area}` }) : null),
      el('span', { class: 'chev', text: '›' }));
  }

  function renderSearch(view) {
    const input = el('input', { class: 'input', type: 'search', placeholder: t('search_placeholder'), value: S.searchQ || '', autocomplete: 'off' });
    const out = el('div');
    view.append(backBar(), input, out);
    let localTimer = null;
    let remoteTimer = null;
    let seq = 0;

    const section = (title, nodes) => (nodes.length ? [el('h2', { text: title }), el('div', null, nodes)] : []);

    async function run() {
      const q = input.value.trim();
      S.searchQ = q;
      const my = ++seq;
      if (norm(q).length < 2) { out.replaceChildren(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('search_hint') })); return; }
      const nq = norm(q);
      const blocks = [];
      // 1) Ligalar — keshdagi ro'yxatdan (API so'rovisiz)
      try {
        const c = await api('/competitions');
        const all = [...c.international.map((x) => ({ ...x, area: x.area || 'World' })), ...c.countries.flatMap((k) => k.competitions.map((x) => ({ ...x, area: k.name })))];
        const found = all.filter((x) => norm(`${x.name} ${x.area}`).includes(nq)).slice(0, 15);
        blocks.push(...section(t('search_leagues'), found.map(leagueItem)));
      } catch (e) { /* futbol API mavjud bo'lmasa — o'tkazib yuboramiz */ }
      // 2) Tanlangan kundagi o'yinlar — jamoa yoki liga nomi bo'yicha
      try {
        const date = S.date || tashkentYmd();
        const d = await api(`/matches?date=${date}`);
        const found = d.matches.filter((m) => norm(`${m.home && m.home.name} ${m.away && m.away.name} ${m.competition && m.competition.name}`).includes(nq)).slice(0, 20);
        blocks.push(...section(t('search_matches_day', { date: fmtShortDate(date) }), found.map((m) => matchCard(m, { bell: true }))));
      } catch (e) { /* */ }
      if (my !== seq) return;
      const teamsBox = el('div');
      out.replaceChildren(...blocks, teamsBox);
      // 3) Jamoalar — server orqali (keshlanadi), kamida 3 harf, yozib bo'lgach
      if (nq.length < 3) { if (!blocks.length) out.replaceChildren(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('search_none') })); return; }
      teamsBox.replaceChildren(el('h2', { text: t('search_teams') }), skeleton(2));
      clearTimeout(remoteTimer);
      remoteTimer = setTimeout(async () => {
        try {
          const r = await api(`/search/teams?q=${encodeURIComponent(q)}`);
          if (my !== seq) return;
          teamsBox.replaceChildren(...section(t('search_teams'), r.teams.map((tm) => el('button', { class: 'item', onclick: () => push({ render: (v) => renderTeam(v, tm) }) },
            crest(tm.logo, null, tm.name),
            el('span', { class: 'grow ellipsis' }, tm.name, tm.country ? el('span', { class: 'muted small', text: ` · ${tm.country}` }) : null),
            el('span', { class: 'chev', text: '›' })))));
          if (!r.teams.length && !blocks.length) out.replaceChildren(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('search_none') }));
        } catch (err) {
          if (my === seq) teamsBox.replaceChildren(el('h2', { text: t('search_teams') }), errorBox(err));
        }
      }, 700);
    }

    input.addEventListener('input', () => { clearTimeout(localTimer); localTimer = setTimeout(run, 250); });
    cleanups.push(() => { clearTimeout(localTimer); clearTimeout(remoteTimer); seq += 1; });
    run();
    setTimeout(() => input.focus(), 50);
  }

  async function renderTeam(view, tm) {
    view.append(backBar(tm.name));
    const box = el('div', null, skeleton(3));
    view.append(box);
    try {
      const d = await api(`/teams/${tm.id}/matches`);
      const block = (title, list) => [el('h2', { text: title }), list.length ? el('div', null, list.map((m) => matchCard(m, { bell: true, showDate: true }))) : el('div', { class: 'card center muted', text: t('no_data') })];
      box.replaceChildren(...block(t('team_next'), d.next), ...block(t('team_last'), d.last));
    } catch (err) {
      box.replaceChildren(errorBox(err, () => render()));
    }
  }

  function statusBadge(m) {
    if (m.state === 'live') return el('span', { class: 'badge live', text: m.minute ? `${m.minute}'` : t('status_live') });
    if (m.state === 'finished') return el('span', { class: 'badge', text: `✅ ${t('status_finished')}` });
    if (m.state === 'cancelled') return el('span', { class: 'badge', text: `⛔ ${t('status_cancelled')}` });
    return el('span', { class: 'badge', text: `⏳ ${t('status_scheduled')}` });
  }

  /** O'yin kuni: Bugun / Ertaga / Kecha yoki DD.MM */
  function dayLabel(iso) {
    const d = tashkentYmd(new Date(iso));
    const today = tashkentYmd();
    if (d === today) return t('date_today');
    if (d === addDays(today, 1)) return t('date_tomorrow');
    if (d === addDays(today, -1)) return t('date_yesterday');
    return ddmm(iso);
  }

  /** Uzun so'zli jamoa nomi — kichikroq shrift (tor ustunga sig'sin, so'z bo'linmasin) */
  function nameSize(team) {
    const longest = Math.max(0, ...String((team && team.name) || '').split(/\s+/).map((w) => [...w].length));
    return longest > 11 ? ' xs' : longest > 8 ? ' sm' : '';
  }

  function matchCard(m, { bell } = {}) {
    const premium = S.me.premium;
    const started = m.state === 'live' || m.state === 'finished';
    const side = (team, right) => el('div', { class: `mr-team${right ? ' r' : ''}` },
      right ? null : crest(team && team.crest, 'mr-crest', team && team.name),
      el('span', { class: `mr-name${nameSize(team)}`, text: team ? team.name : '—' }),
      right ? crest(team && team.crest, 'mr-crest', team && team.name) : null);
    // ⚽ Gol bo'lsa hisob bir lahza yonadi (oldingi ko'rilgan hisob bilan solishtiriladi)
    const scoreKey = `${m.score.home}:${m.score.away}`;
    const flash = m.state === 'live' && S.scores[m.id] && S.scores[m.id] !== scoreKey;
    if (started) S.scores[m.id] = scoreKey;
    const sc = (v) => (v === null || v === undefined ? '-' : v);
    const mid = el('div', { class: `mr-mid ${m.state}` },
      el('b', { class: `mr-main${flash ? ' sc-flash' : ''}`, text: started ? `${sc(m.score.home)} : ${sc(m.score.away)}` : m.state === 'cancelled' ? '—' : hhmm(m.utcDate) }),
      el('span', { class: 'mr-sub' }, m.state === 'live' ? [el('i', { class: 'live-dot' }), m.minute ? `${m.minute}'` : t('status_live')]
        : m.state === 'finished' ? t('status_finished') : m.state === 'cancelled' ? t('status_cancelled') : dayLabel(m.utcDate)));
    let bellBtn = null;
    if (bell && m.state === 'scheduled') {
      bellBtn = el('button', { class: `bell${m.subscribed ? ' on' : ''}${premium ? '' : ' locked'}`, 'aria-label': 'bell' });
      bellBtn.innerHTML = ICON_BELL;
      bellBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!premium) return premiumModal();
        try {
          const r = await api(`/matches/${m.id}/subscribe`, { method: 'POST' });
          m.subscribed = r.subscribed;
          bellBtn.classList.toggle('on', r.subscribed);
          haptic('success');
          toast(r.subscribed ? `${t('bell_on')}\n${t('bell_need_bot')}` : t('bell_off'));
        } catch (err) { toast(t('error_generic')); }
        return undefined;
      });
    }
    const card = el('div', { class: `match mrow${m.state === 'live' ? ' live' : ''}${flash ? ' flash' : ''}`, role: 'button' },
      side(m.home, false), mid, side(m.away, true),
      bellBtn || (premium ? el('span', { class: 'mr-gap' }) : el('span', { class: 'lock-badge', text: '🔒' })),
      m.state === 'live' ? el('div', { class: 'live-bar' }, el('span', { style: `width:${Math.min(100, Math.round(((m.minute || 0) / 90) * 100))}%` })) : null);
    card.addEventListener('click', () => {
      if (!premium) return premiumModal();
      return push({ render: (v) => renderMatchDetail(v, m.id) });
    });
    return card;
  }

  function dateStrip() {
    const today = tashkentYmd();
    const strip = el('div', { class: 'dates' });
    for (let n = -30; n <= 30; n += 1) {
      const ymd = addDays(today, n);
      const b = el('button', { class: `date${ymd === S.date ? ' on' : ''}${n === 0 ? ' today' : ''}`, onclick: () => { S.date = ymd; haptic(); render(); } },
        el('b', { text: fmtShortDate(ymd) }), el('span', { text: fmtWeekday(ymd) }));
      strip.append(b);
    }
    requestAnimationFrame(() => {
      const on = strip.querySelector('.date.on');
      if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2;
    });
    return strip;
  }

  async function renderMatches(body) {
    S.date = S.date || tashkentYmd();
    body.append(dateStrip());
    const list = el('div', { style: 'margin-top:4px' }, skeleton(4));
    body.append(list);
    try {
      const data = await api(`/matches?date=${S.date}`);
      list.replaceChildren();
      favBlock(list, data.matches);
      if (!data.matches.length) { list.append(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('no_matches') })); return; }
      // Ligalar bo'yicha guruhlash (server tartibini saqlagan holda)
      const groups = [];
      for (const m of data.matches) {
        const id = m.competition ? m.competition.id : 0;
        let g = groups[groups.length - 1];
        if (!g || g.id !== id) { g = { id, featured: !!m.featured, popular: !!m.popular, competition: m.competition, area: m.area, matches: [] }; groups.push(g); }
        g.matches.push(m);
      }
      // Liga kartochkasi: sarlavha (logotip, nom, "Barcha o'yinlar ›") va ichida o'yinlar
      const leagueCard = (g, bodyNode, extra) => {
        const name = g.competition ? g.competition.name : '';
        return el('div', { class: 'lcard' },
          el('div', { class: 'lcard-head' },
            g.competition && g.competition.emblem ? crest(g.competition.emblem, 'lcard-emb', name) : null,
            el('b', { class: 'grow ellipsis', text: [g.featured || g.popular ? null : g.area && g.area.name, name].filter(Boolean).join(' · ') }),
            g.popular ? el('span', { class: 'hot', text: '🔥' }) : null,
            extra || (g.id ? el('button', { class: 'lcard-all', type: 'button', onclick: () => push({ render: (v) => renderCompetition(v, g.id, name) }) }, t('all_matches'), el('span', { class: 'chev', text: '›' })) : null)),
          bodyNode);
      };
      const featured = groups.filter((g) => g.featured);
      const popular = groups.filter((g) => g.popular);
      const others = groups.filter((g) => !g.featured && !g.popular);
      // O'yinlar ko'p bo'lsa — boshqa ligalar yig'ilgan holda (bosilganda ochiladi)
      const collapse = data.matches.length > 20;
      for (const g of [...featured, ...popular]) {
        list.append(leagueCard(g, el('div', { class: 'lcard-body' }, g.matches.map((m) => matchCard(m, { bell: true })))));
      }
      if (others.length) {
        if (featured.length || popular.length) list.append(el('h2', { text: t('other_leagues') }));
        for (const g of others) {
          const body = el('div', { class: 'lcard-body' });
          const open = !collapse || S.expanded.has(g.id);
          const fill = () => { body.replaceChildren(...g.matches.map((m) => matchCard(m, { bell: true }))); };
          if (open) fill();
          const chev = el('span', { class: 'chev', text: open ? '▾' : '▸' });
          const toggle = collapse ? el('button', { class: 'lcard-all', type: 'button' }, el('span', { class: 'badge', text: g.matches.length }), chev) : null;
          const card = leagueCard(g, body, toggle);
          if (collapse) {
            card.firstChild.classList.add('tappable');
            card.firstChild.addEventListener('click', () => {
              haptic();
              if (S.expanded.has(g.id)) { S.expanded.delete(g.id); body.replaceChildren(); chev.textContent = '▸'; } else {
                S.expanded.add(g.id); fill(); chev.textContent = '▾';
                api(`/stats/league/${g.id}`, { method: 'POST', keepCache: true }).catch(() => {}); // qiziqish statistikasi
              }
            });
          }
          list.append(card);
        }
      }
    } catch (err) {
      list.replaceChildren(errorBox(err, () => render()));
    }
  }

  // ================= ⭐ SEVIMLI JAMOA
  function hasTeam(m, id) { return [m.home && m.home.id, m.away && m.away.id].map(Number).includes(Number(id)); }
  function favPromptHidden() { try { return localStorage.getItem('fc_fav_prompt') === '0'; } catch (e) { return false; } }

  /** Home tepasi: tanlangan jamoaning bugungi o'yini, bo'lmasa keyingi/oxirgi o'yini; tanlanmagan bo'lsa — taklif */
  function favBlock(list, matches) {
    const fav = S.me.favoriteTeam;
    const today = S.date === tashkentYmd();
    if (!fav) {
      if (!today || favPromptHidden()) return;
      const card = el('div', { class: 'card fav-prompt' },
        el('div', { class: 'fav-star', text: '⭐' }),
        el('div', { class: 'grow small', text: t('fav_prompt') }),
        el('button', { class: 'btn sm', text: t('fav_choose'), onclick: () => push({ render: renderFavPicker }) }),
        el('button', { class: 'x', 'aria-label': 'close', text: '×', onclick: () => { try { localStorage.setItem('fc_fav_prompt', '0'); } catch (e) { /* */ } card.remove(); } }));
      list.append(card);
      return;
    }
    const mine = matches.filter((m) => hasTeam(m, fav.id));
    const head = el('button', { class: 'fav-head', type: 'button', onclick: () => push({ render: (v) => renderTeam(v, fav) }) },
      crest(fav.logo, null, fav.name), el('span', { class: 'grow ellipsis', text: fav.name }), el('span', { class: 'muted small', text: t('fav_your_team') }), el('span', { class: 'chev', text: '›' }));
    const box = el('div', { class: 'fav-box' }, head);
    list.append(box);
    if (mine.length) { mine.forEach((m) => box.append(matchCard(m, { bell: true }))); return; }
    if (!today) { box.remove(); return; }
    const slot = el('div', null, el('div', { class: 'skeleton' }));
    box.append(slot);
    api(`/teams/${fav.id}/matches`).then((d) => {
      const next = d.next && d.next[0];
      const last = d.last && d.last[0];
      const m = next || last;
      if (!m) { slot.remove(); return; }
      slot.replaceChildren(el('div', { class: 'small muted fav-sub', text: next ? t('fav_next') : t('fav_last') }), matchCard(m, { bell: true, showDate: true }));
    }).catch(() => slot.remove());
  }

  function renderFavPicker(view) {
    view.append(backBar(t('fav_title')));
    const fav = S.me.favoriteTeam;
    const save = async (teamId) => {
      try {
        const r = await api('/favorite-team', { method: 'POST', body: { teamId } });
        S.me.favoriteTeam = r.favoriteTeam;
        haptic('success');
        toast(teamId ? t('fav_saved') : t('fav_removed'));
        goBack();
      } catch (err) { toast(t('error_generic')); }
    };
    view.append(el('p', { class: 'muted small', text: t('fav_pick_hint') }));
    if (fav) {
      view.append(el('div', { class: 'card row', style: 'gap:12px' }, crest(fav.logo, 'crest lg', fav.name), el('b', { class: 'grow ellipsis', text: fav.name }),
        el('button', { class: 'btn ghost sm', text: t('fav_remove'), onclick: () => save(null) })));
    }
    // Muxlislik kartasidagi klub — bir bosishda
    let club = null;
    try { club = JSON.parse(localStorage.getItem('fc_club') || 'null'); } catch (e) { /* */ }
    if (club && club.id && (!fav || Number(fav.id) !== Number(club.id))) {
      view.append(el('button', { class: 'card row', style: 'width:100%;gap:12px', type: 'button', onclick: () => save(club.id) },
        crest(club.logo, null, club.name), el('span', { class: 'grow ellipsis', text: club.name }), el('span', { class: 'muted small', text: t('fav_from_card') })));
    }
    view.append(el('h2', { text: t('fav_search_title') }), clubSearch((tm) => save(tm.id)),
      el('p', { class: 'muted small', style: 'margin-top:12px', text: t('fav_notify_hint') }));
  }

  const STAT_LABELS = {
    uz: { ball_possession: "To'p nazorati", shots: 'Zarbalar', shots_on_goal: 'Darvozaga zarbalar', shots_off_goal: 'Darvozadan tashqari', corner_kicks: 'Burchak to\'plari', free_kicks: 'Jarima to\'plari', fouls: 'Qoidabuzarliklar', offsides: 'Offsaydlar', saves: 'Seyvlar', yellow_cards: 'Sariq kartalar', red_cards: 'Qizil kartalar', throw_ins: 'Autlar', goal_kicks: 'Darvozadan zarbalar' },
    ru: { ball_possession: 'Владение мячом', shots: 'Удары', shots_on_goal: 'Удары в створ', shots_off_goal: 'Удары мимо', corner_kicks: 'Угловые', free_kicks: 'Штрафные', fouls: 'Фолы', offsides: 'Офсайды', saves: 'Сейвы', yellow_cards: 'Жёлтые карточки', red_cards: 'Красные карточки', throw_ins: 'Ауты', goal_kicks: 'Удары от ворот' },
    en: { ball_possession: 'Possession', shots: 'Shots', shots_on_goal: 'Shots on target', shots_off_goal: 'Shots off target', corner_kicks: 'Corners', free_kicks: 'Free kicks', fouls: 'Fouls', offsides: 'Offsides', saves: 'Saves', yellow_cards: 'Yellow cards', red_cards: 'Red cards', throw_ins: 'Throw-ins', goal_kicks: 'Goal kicks' },
  };
  function statLabel(key) {
    const l = I.lang === 'uz_cyrl' ? 'uz' : I.lang;
    const v = (STAT_LABELS[l] || STAT_LABELS.en)[key] || key.replace(/_/g, ' ');
    return I.lang === 'uz_cyrl' && window.FCTranslit ? window.FCTranslit.translit(v) : v;
  }

  async function renderMatchDetail(view, id) {
    view.append(backBar());
    const box = el('div', null, skeleton(3));
    view.append(box);
    let m;
    try { m = await api(`/matches/${id}`); } catch (err) {
      if (err.status === 402) { box.replaceChildren(); premiumModal(); return; }
      box.replaceChildren(errorBox(err, () => render()));
      return;
    }
    // ⚽ Jonli o'yin: har 30 soniyada yangilanadi (sahifa ochiq va ko'rinib turgan paytda); gol bo'lsa — animatsiya, ovoz, tebranish
    let cur = null;
    const paint = () => {
    const started = m.state !== 'scheduled';
    const hc = (m.colors && m.colors.home) || '#1e8f4e';
    const ac = (m.colors && m.colors.away) || '#0f2f20';
    const head = el('div', { class: 'card match-hero', style: `background:linear-gradient(115deg, ${hc} 0%, ${hc}cc 30%, #0c1712 50%, ${ac}cc 70%, ${ac} 100%)` },
      el('div', { class: 'row between small', style: 'margin-bottom:10px;opacity:.9' }, el('span', { class: 'ellipsis', text: m.competition ? m.competition.name : '' }), statusBadge(m)),
      el('div', { class: 'scoreboard' },
        el('div', null, crest(m.home.crest, null, m.home.name), el('div', { style: 'font-weight:700', text: m.home.name })),
        el('div', null, el('div', { class: 'big', text: started ? `${m.score.home ?? '-'} : ${m.score.away ?? '-'}` : hhmm(m.utcDate) }),
          el('div', { class: 'small muted', text: ddmmyyyy(m.utcDate) }),
          m.halfTime && m.halfTime.home !== null && started ? el('div', { class: 'small muted', text: `(${m.halfTime.home}:${m.halfTime.away})` }) : null),
        el('div', null, crest(m.away.crest, null, m.away.name), el('div', { style: 'font-weight:700', text: m.away.name }))));
    const keys = ['statistics', 'lineups', 'events'].filter((k) => m.tabs && m.tabs[k]);
    box.replaceChildren(head);
    if (m.state === 'live') head.append(el('div', { class: 'live-auto small', text: t('live_auto') }));
    if (!keys.length) { box.append(el('div', { class: 'card center muted', style: 'margin-top:10px', text: t('no_details') })); return; }
    if (!keys.includes(cur)) cur = keys[0];
    const tabs = el('div', { class: 'tabs', style: 'margin-top:12px' });
    const content = el('div', { style: 'margin-top:10px' });
    const draw = () => {
      tabs.replaceChildren(...keys.map((k) => el('button', { class: `tab${k === cur ? ' on' : ''}`, text: t(`tab_${k}`), onclick: () => { cur = k; haptic(); draw(); } })));
      content.replaceChildren();
      if (cur === 'statistics') {
        const st = m.tabs.statistics;
        const allKeys = [...new Set([...Object.keys(st.home), ...Object.keys(st.away)])];
        content.append(el('div', { class: 'card' }, allKeys.map((k) => el('div', { class: 'stat-row' },
          el('span', { class: 'v', text: st.home[k] ?? '-' }), el('span', { class: 'label', text: statLabel(k) }), el('span', { class: 'v', text: st.away[k] ?? '-' })))));
      } else if (cur === 'lineups') {
        for (const side of ['home', 'away']) {
          const lu = m.tabs.lineups[side];
          const team = m[side];
          if (!lu) continue;
          content.append(el('div', { class: 'card' },
            el('div', { class: 'row', style: 'margin-bottom:8px' }, crest(team.crest), el('b', { class: 'grow', text: team.name }), lu.formation ? el('span', { class: 'badge', text: lu.formation }) : null),
            lu.coach ? el('div', { class: 'small muted', text: `${t('coach')}: ${lu.coach}` }) : null,
            lu.lineup.map((p) => el('div', { class: 'kv' }, el('span', { text: p.shirtNumber ?? '' }), el('b', { text: p.name }))),
            lu.bench && lu.bench.length ? el('h3', { text: t('bench') }) : null,
            (lu.bench || []).map((p) => el('div', { class: 'kv small' }, el('span', { text: p.shirtNumber ?? '' }), el('span', { text: p.name })))));
        }
      } else if (cur === 'events') {
        const ico = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '🔁' };
        content.append(el('div', { class: 'card' }, m.tabs.events.map((e) => el('div', { class: `ev${e.teamId === m.away.id ? ' away' : ''}` },
          el('span', { class: 'min', text: e.minute ? `${e.minute}'` : '' }), el('span', { text: ico[e.type] || '•' }),
          el('span', { class: 'grow' }, el('b', { text: e.player ? e.player.name : '' }),
            e.type === 'goal' && e.assist ? el('div', { class: 'small muted', text: `🅰️ ${e.assist.name}` }) : null,
            e.type === 'sub' && e.out ? el('div', { class: 'small muted', text: `↘ ${e.out.name}` }) : null)))));
      }
    };
    draw();
    box.append(tabs, content);
    };
    paint();
    const soon = m.state === 'scheduled' && new Date(m.utcDate).getTime() - Date.now() < 15 * 60000;
    if (m.state === 'live' || soon) {
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || document.hidden || !box.isConnected) return;
        busy = true;
        try {
          const n = await api(`/matches/${id}`, { fresh: true });
          const goalHome = (n.score.home ?? 0) > (m.score.home ?? 0);
          const goalAway = (n.score.away ?? 0) > (m.score.away ?? 0);
          const ended = m.state !== 'finished' && n.state === 'finished';
          const kicked = m.state === 'scheduled' && n.state === 'live';
          m = n;
          paint();
          const hero = box.querySelector('.match-hero');
          if (goalHome || goalAway) {
            if (hero) hero.classList.add('goal');
            SFX.play('goal');
            toast(t('live_goal', { team: (goalHome ? m.home : m.away).name, score: `${m.score.home}:${m.score.away}` }));
            confetti();
          } else if (kicked || ended) SFX.play('whistle');
          if (m.state === 'finished') clearInterval(timer);
        } catch (e) { /* tarmoq xatosi — keyingi safar */ } finally { busy = false; }
      }, 30000);
      cleanups.push(() => clearInterval(timer));
    }
  }

  async function renderCompetitions(body) {
    const box = el('div', { style: 'margin-top:12px' }, skeleton(5));
    body.append(box);
    try {
      const data = await api('/competitions');
      box.replaceChildren();
      // withArea — asosiy/ommabop ro'yxatlarda davlat nomi ham ko'rsatiladi (masalan, "Serie A · Brazil")
      const compItem = (c, withArea) => el('button', { class: 'item', onclick: () => push({ render: (v) => renderCompetition(v, c.id, c.name) }) },
        c.emblem ? crest(c.emblem) : el('span', { class: 'crest-ph' }),
        el('span', { class: 'grow ellipsis' }, c.name, withArea && c.area ? el('span', { class: 'muted small', text: ` · ${c.area}` }) : null),
        el('span', { class: 'chev', text: '›' }));
      if (data.featured && data.featured.length) {
        box.append(el('h2', { text: t('featured_leagues') }), el('div', null, data.featured.map((c) => compItem(c, true))));
      }
      if (data.popular && data.popular.length) {
        box.append(el('h2', { text: t('popular_leagues') }), el('div', null, data.popular.map((c) => compItem(c, true))));
      }
      if (data.international.length) {
        box.append(el('h2', { text: t('intl') }), el('div', null, data.international.map((c) => compItem(c))));
      }
      box.append(el('h2', { text: t('countries') }), el('div', null, data.countries.map((c) => el('button', {
        class: 'item', onclick: () => push({ render: (v) => { v.append(backBar(c.name), el('div', null, c.competitions.map((x) => compItem(x)))); } }),
      }, c.flag ? crest(c.flag) : el('span', { class: 'crest-ph' }), el('span', { class: 'grow', text: c.name }), el('span', { class: 'small muted', text: c.competitions.length }), el('span', { class: 'chev', text: '›' })))));
    } catch (err) {
      box.replaceChildren(errorBox(err, () => render()));
    }
  }

  function renderCompetition(view, id, name) {
    view.append(backBar(name));
    const tabsList = ['standings', 'results', 'calendar', 'scorers', 'assists'];
    let cur = 'standings';
    const tabs = el('div', { class: 'tabs' });
    const content = el('div', { style: 'margin-top:10px' });
    view.append(tabs, content);
    const draw = async () => {
      tabs.replaceChildren(...tabsList.map((k) => {
        const locked = k !== 'standings' && !S.me.premium;
        return el('button', {
          class: `tab${k === cur ? ' on' : ''}${locked ? ' locked' : ''}`, text: `${locked ? '🔒 ' : ''}${t(`ctab_${k}`)}`,
          onclick: () => { if (locked) return premiumModal(); cur = k; haptic(); return draw(); },
        });
      }));
      content.replaceChildren(skeleton(4));
      try {
        const data = await api(`/competitions/${id}/${cur}`);
        content.replaceChildren();
        if (cur === 'standings') {
          if (!data.standings.length) { content.append(el('div', { class: 'card center muted', text: t('no_data') })); return; }
          for (const g of data.standings) {
            content.append(el('div', { class: 'card' },
              g.group && data.standings.length > 1 ? el('h3', { style: 'margin-top:0', text: g.group.replace(/_/g, ' ') }) : null,
              el('div', { class: 'scroll-x' }, el('table', { class: 'table' },
                el('thead', null, el('tr', null, el('th', { text: '#' }), el('th', { class: 't', text: t('th_team') }), ['th_p', 'th_w', 'th_d', 'th_l', 'th_gd', 'th_pts'].map((k) => el('th', { text: t(k) })))),
                el('tbody', null, g.table.map((r) => el('tr', null, el('td', { text: r.position }),
                  el('td', { class: 't' }, el('span', { class: 'tn' }, crest(r.team.crest), el('span', { class: 'ellipsis', style: 'max-width:130px', text: r.team.name }))),
                  el('td', { text: r.played }), el('td', { text: r.won }), el('td', { text: r.draw }), el('td', { text: r.lost }),
                  el('td', { text: r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference }), el('td', { class: 'pts', text: r.points }))))))));
          }
        } else if (cur === 'results' || cur === 'calendar') {
          if (!data.matches.length) { content.append(el('div', { class: 'card center muted', text: t('no_data') })); return; }
          let lastDay = null;
          for (const m of data.matches) {
            const day = ddmmyyyy(m.utcDate);
            if (day !== lastDay) { content.append(el('div', { class: 'league-head', text: day })); lastDay = day; }
            content.append(matchCard(m));
          }
        } else {
          if (!data.players.length) { content.append(el('div', { class: 'card center muted', text: t('no_data') })); return; }
          content.append(el('div', { class: 'card' }, data.players.map((p, i) => el('div', { class: 'lb-row' },
            el('span', { class: 'pl', text: i + 1 }), crest(p.team && p.team.crest),
            el('span', { class: 'grow' }, el('div', { class: 'ellipsis', style: 'font-weight:600', text: p.player ? p.player.name : '' }), el('div', { class: 'small muted ellipsis', text: p.team ? p.team.name : '' })),
            el('span', { class: 'pts', text: cur === 'scorers' ? p.goals : p.assists })))));
        }
      } catch (err) {
        if (err.status === 402) { content.replaceChildren(); premiumModal(); return; }
        content.replaceChildren(errorBox(err, draw));
      }
    };
    draw();
  }

  // ================= 🎮 MINI MANAGER
  /** opts.periods — ['daily','weekly','monthly'] (umumiy reyting), opts.title, opts.hint */
  function leaderboardBlock(kind, opts = {}) {
    const wrap = el('div');
    const periods = opts.periods || ['weekly', 'monthly'];
    const LBL = { daily: 'lb_daily', weekly: 'lb_weekly', monthly: 'lb_monthly' };
    const draw = async () => {
      const period = periods.includes(S.lb[kind]) ? S.lb[kind] : periods[0];
      const seg = el('div', { class: 'seg' }, periods.map((p) => el('button', {
        class: p === period ? 'on' : '', text: t(LBL[p]), onclick: () => { S.lb[kind] = p; haptic(); draw(); },
      })));
      const list = el('div', { class: 'card', style: 'margin-top:8px' }, skeleton(2));
      put(wrap, el('h2', { text: opts.title || t('lb_title') }), opts.hint ? el('p', { class: 'small muted', style: 'margin:-4px 2px 10px', text: opts.hint }) : null, seg, list);
      try {
        const d = await api(`/leaderboard/${kind}/${period}`);
        list.replaceChildren();
        list.append(el('div', { class: 'small muted', style: 'margin-bottom:4px', text: `${ddmmyyyy(d.start)} – ${ddmmyyyy(new Date(new Date(d.end).getTime() - 60000).toISOString())}` }));
        if (!d.top.length) list.append(el('div', { class: 'center muted', style: 'padding:16px 0', text: t('lb_empty') }));
        // 🏆 Podium: TOP-3 shohsupada (profil rasmlari bilan), qolganlar ro'yxatda
        const podium = d.top.slice(0, 3);
        if (podium.length) {
          const order = [podium[1], podium[0], podium[2]].filter(Boolean);
          list.append(el('div', { class: 'podium' }, order.map((r) => el('div', { class: `pod p${r.place}${r.me ? ' me' : ''}` },
            el('span', { class: 'pod-ava' }, avatar(r.photo, r.name), el('span', { class: 'pod-medal', text: ['🥇', '🥈', '🥉'][r.place - 1] })),
            el('b', { class: 'ellipsis pod-name', text: r.name }), el('span', { class: 'pod-pts', text: money(r.points) }),
            el('div', { class: 'pod-step', text: String(r.place) })))));
        }
        const rest = d.top.slice(3);
        const rows = opts.limit && !wrap.expanded ? rest.slice(0, Math.max(0, opts.limit - 3)) : rest;
        for (const r of rows) {
          list.append(el('div', { class: `lb-row${r.place === 1 ? ' top1' : ''}${r.me ? ' me' : ''}` },
            el('span', { class: 'pl', text: r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place }),
            el('span', { class: 'grow ellipsis', text: r.name }), el('span', { class: 'pts', text: r.points })));
        }
        if (d.me && !rows.some((r) => r.me) && !podium.some((r) => r.me)) list.append(el('div', { class: 'lb-row me' }, el('span', { class: 'grow', text: t('lb_me', { place: d.me.place, points: d.me.points }) })));
        if (rows.length < rest.length) list.append(el('button', { class: 'btn ghost block', style: 'margin-top:8px;height:38px', text: t('lb_all', { n: d.top.length }), onclick: () => { wrap.expanded = true; draw(); } }));
      } catch (err) { list.replaceChildren(errorBox(err, draw)); }
    };
    draw();
    wrap.refresh = draw;
    return wrap;
  }

  function coachPrompt(onSaved, current) {
    const input = el('input', { class: 'input', maxlength: '32', placeholder: t('coach_placeholder'), value: current || '' });
    const btn = el('button', { class: 'btn block', style: 'margin-top:10px', text: t('save') });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await api('/manager/coach', { method: 'POST', body: { name: input.value } });
        S.me.coachName = r.coachName;
        haptic('success');
        onSaved();
      } catch (err) { toast(err.body && err.body.error === 'bad_coach_name' ? t('err_bad_coach_name') : t('error_generic')); btn.disabled = false; }
    });
    return el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: t('coach_prompt_title') }), el('p', { class: 'muted small', text: t('coach_prompt_text') }), input, btn);
  }

  /** Premium bo'lmaganlar uchun yopiq bo'lim (Mini Manager, Quiz) */
  function lockedSection(view, icon) {
    view.append(el('div', { class: 'card center' },
      el('div', { style: 'font-size:44px', text: `${icon}🔒` }),
      el('h3', { text: t('premium_only_title') }),
      el('p', { class: 'muted', text: t('premium_only_text') }),
      el('button', { class: 'btn', text: t('buy_premium_btn'), onclick: () => openBot('premium') })));
  }

  // ================= 🎮 GAMES — o'yinlar ro'yxati (Mini Manager, Football Quiz; keyin yangi o'yinlar qo'shiladi)
  const GAMES = [
    { key: 'manager', grad: 'linear-gradient(135deg,#2ecc71,#178a49)', icon: '🎮', title: () => 'Mini Manager', desc: () => t('games_mm_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar('🎮 Mini Manager')); return renderManager(v); } }) },
    { key: 'quiz', grad: 'linear-gradient(135deg,#f7a6c1,#d9467c)', icon: '🧠', title: () => 'Football Quiz', desc: () => t('games_quiz_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar('🧠 Football Quiz')); return renderQuiz(v); } }) },
    { key: 'duel', grad: 'linear-gradient(135deg,#f2c94c,#e07b1a)', icon: '⚔️', title: () => t('du_title'), desc: () => t('games_du_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar(`⚔️ ${t('du_title')}`)); return renderDuels(v); } }) },
    { key: 'penalty', grad: 'linear-gradient(135deg,#9be15d,#2f9e44)', icon: '🥅', title: () => t('pk_title'), desc: () => t('games_pk_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar(`🥅 ${t('pk_title')}`)); return renderPenalty(v); } }) },
    { key: 'crossbar', grad: 'linear-gradient(135deg,#ff8a5b,#e5534b)', icon: '💥', title: () => t('cb_title'), desc: () => t('games_cb_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar(`💥 ${t('cb_title')}`)); return renderArcade(v, 'crossbar'); } }) },
    { key: 'keepy', grad: 'linear-gradient(135deg,#e9e4d0,#a89f7d)', icon: '⚽', title: () => t('ku_title'), desc: () => t('games_ku_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar(`⚽ ${t('ku_title')}`)); return renderArcade(v, 'keepy'); } }) },
    { key: 'score', grad: 'linear-gradient(135deg,#c084fc,#7c3aed)', icon: '🎯', title: () => t('sp_title'), desc: () => t('games_sp_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar(`🎯 ${t('sp_title')}`)); return renderScorePredict(v); } }) },
    { key: 'leagues', grad: 'linear-gradient(135deg,#5eead4,#0f766e)', icon: '👥', title: () => t('lg_title'), desc: () => t('games_lg_desc'), premium: false,
      open: () => push({ render: (v) => { v.append(backBar(`👥 ${t('lg_title')}`)); return renderLeagues(v); } }) },
  ];

  // ================= 👥 DO'STLAR LIGASI (sinov)
  function lgError(err) {
    const code = err && err.body && err.body.error;
    haptic('error');
    toast(t(`lg_err_${code}`) !== `lg_err_${code}` ? t(`lg_err_${code}`) : t('error_generic'));
  }
  async function renderLeagues(view) {
    const box = el('div', null, skeleton(2));
    view.append(el('p', { class: 'muted small', text: t('lg_hint') }), box);
    let d;
    try { d = await api('/leagues', { fresh: true }); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    if (!d.enabled) { box.replaceChildren(el('div', { class: 'card center muted', text: t('lg_disabled') })); return; }
    const name = el('input', { class: 'input', placeholder: t('lg_name_ph'), maxlength: '30' });
    const create = el('button', { class: 'btn block', style: 'margin-top:8px', text: t('lg_create') });
    create.addEventListener('click', async () => {
      create.disabled = true;
      try {
        const r = await api('/leagues', { method: 'POST', body: { name: name.value } });
        haptic('success');
        push({ render: (v) => renderLeague(v, r.id, true) });
      } catch (err) { lgError(err); create.disabled = false; }
    });
    box.replaceChildren(
      d.leagues.length ? el('div', { class: 'list' }, d.leagues.map((l) => el('button', { class: 'item', type: 'button', onclick: () => push({ render: (v) => renderLeague(v, l.id) }) },
        el('span', { class: 'game-ico', style: '--g:linear-gradient(135deg,#5eead4,#0f766e)', text: '👥' }),
        el('span', { class: 'grow' }, el('b', { text: l.name }),
          el('div', { class: 'small muted', text: t('lg_row', { n: l.members, leader: l.leader || '—' }) })),
        el('span', { class: 'badge gold', text: l.place ? `#${l.place}` : '—' }))))
        : (() => { const n = el('div', { class: 'card center muted', text: t('lg_none') }); emptyState(n); return n; })(),
      el('div', { class: 'card', style: 'margin-top:12px' }, el('h3', { style: 'margin-top:0', text: t('lg_create_title') }), name, create));
  }

  async function renderLeague(view, id, justCreated) {
    view.append(backBar(t('lg_title')));
    const box = el('div', null, skeleton(3));
    view.append(box);
    let period = 'weekly';
    const draw = async () => {
      let d;
      try { d = await api(`/leagues/${id}?period=${period}`, { fresh: true }); } catch (err) { box.replaceChildren(errorBox(err, () => draw())); return; }
      const seg = el('div', { class: 'seg' }, ['weekly', 'monthly', 'all'].map((p) => el('button', {
        class: p === period ? 'on' : '', text: t(`lg_p_${p}`), onclick: () => { period = p; draw(); },
      })));
      const invite = el('button', { class: 'btn block', text: t('lg_invite_btn'), onclick: () => { if (d.link) shareLink(d.link, t('lg_share_text', { league: d.name })); } });
      const rows = d.standings.map((x) => el('div', { class: `lb-row${x.me ? ' me' : ''}` },
        el('span', { class: 'pl', text: x.place <= 3 ? ['🥇', '🥈', '🥉'][x.place - 1] : x.place }),
        avatar(x.photo, x.name, 'sm'),
        el('span', { class: 'grow ellipsis' }, el('b', { text: x.name }), x.owner ? el('span', { class: 'small muted', text: ` · ${t('lg_owner')}` }) : null),
        el('span', { class: 'pts', text: x.points }),
        d.owner && !x.me ? el('button', { class: 'mini', text: '✕', title: t('lg_kick'), onclick: async () => {
          if (!window.confirm(t('lg_kick_confirm', { name: x.name }))) return;
          try { await api(`/leagues/${id}/kick`, { method: 'POST', body: { tgId: x.tgId } }); draw(); } catch (err) { lgError(err); }
        } }) : null));
      const leave = el('button', { class: 'btn ghost block', style: 'margin-top:10px', text: t('lg_leave'), onclick: async () => {
        if (!window.confirm(t('lg_leave_confirm', { name: d.name }))) return;
        try { await api(`/leagues/${id}/leave`, { method: 'POST' }); goBack(); } catch (err) { lgError(err); }
      } });
      put(box,
        el('div', { class: 'card lg-head' }, el('div', { class: 'lg-ico', text: '👥' }), el('h2', { style: 'margin:6px 0 2px', text: d.name }),
          el('div', { class: 'small muted', text: t('lg_members', { n: d.standings.length, max: d.maxMembers }) })),
        justCreated && d.standings.length === 1 ? el('div', { class: 'card small', style: 'margin-top:10px', text: t('lg_created_hint') }) : null,
        el('div', { style: 'margin-top:10px' }, invite),
        el('div', { style: 'margin-top:12px' }, seg),
        el('div', { class: 'card', style: 'margin-top:10px' }, rows),
        leave);
    };
    draw();
  }

  async function renderLeagueInvite(view, code) {
    view.append(backBar(t('lg_title')));
    const box = el('div', null, skeleton(2));
    view.append(box);
    let d;
    try { d = await api(`/leagues/invite/${encodeURIComponent(code)}`); } catch (err) { box.replaceChildren(el('div', { class: 'card center muted', text: t('lg_err_not_found') })); return; }
    if (d.mine) { box.replaceChildren(); push({ render: (v) => renderLeague(v, d.id) }); return; }
    const join = el('button', { class: 'btn block', style: 'margin-top:12px', text: t('lg_join') });
    join.addEventListener('click', async () => {
      join.disabled = true;
      try { const r = await api('/leagues/join', { method: 'POST', body: { code } }); haptic('success'); confetti(); push({ render: (v) => renderLeague(v, r.id) }); } catch (err) { lgError(err); join.disabled = false; }
    });
    box.replaceChildren(el('div', { class: 'card center' }, el('div', { class: 'lg-ico', text: '👥' }),
      el('h2', { style: 'margin:6px 0', text: d.name }),
      el('p', { class: 'muted', text: t('lg_invited', { name: d.owner, n: d.members }) }), join));
  }

  // ================= 👥 COMMUNITY — klub fan community'lari va haftalik fan reytingi
  function cmError(err) {
    const code = err && err.body && err.body.error;
    haptic('error');
    if (code === 'premium_required') { premiumModal(t('cm_need_premium')); return; }
    toast(I.DICTS.uz[`cm_err_${code}`] ? t(`cm_err_${code}`) : t('error_generic'));
  }

  /** Community "kartochkasi": klub rangida tasma, logotip, nom, chempion belgisi */
  function cmLevelLabel(lv) { return `Lv ${lv.level} · ${t(`cm_lv${lv.level}`)}`; }

  /** Daraja: nom, XP va keyingi darajagacha progress */
  function cmLevelCard(lv) {
    const pct = lv.next ? Math.max(0, Math.min(100, Math.round(((lv.xp - lv.from) / (lv.next - lv.from)) * 100))) : 100;
    return el('div', { class: 'card', style: 'margin-top:10px' },
      el('div', { class: 'row between' }, el('h3', { style: 'margin:0', text: t('cm_level_title') }), el('span', { class: 'badge gold', text: cmLevelLabel(lv) })),
      el('div', { class: 'cm-progress' }, el('span', { style: `width:${pct}%` })),
      el('div', { class: 'row between small muted' }, el('span', { text: t('cm_xp', { xp: money(lv.xp) }) }),
        el('span', { text: lv.next ? t('cm_next', { left: money(lv.next - lv.xp), n: lv.level + 1 }) : t('cm_max') })));
  }

  /** ⚔️ Haftalik derbi: jonli hisob */
  function cmDerbyCard(c) {
    const d = c.derby;
    const card = el('div', { class: 'card', style: 'margin-top:10px' }, el('div', { class: 'row between' }, el('h3', { style: 'margin:0', text: t('cm_derby') }),
      c.crown ? el('span', { class: 'badge gold', text: t('cm_crown') }) : null));
    if (!d) { card.append(el('p', { class: 'small muted', style: 'margin:8px 0 0', text: t('cm_derby_none') })); return card; }
    const lead = d.my > d.their ? 'win' : d.my < d.their ? 'lose' : 'draw';
    const side = (name, logo, pts, mine) => el('div', { class: `cm-dside${mine ? ' me' : ''}` },
      el('span', { class: 'cm-logo sm' }, logo ? el('img', { src: logo, alt: '', referrerpolicy: 'no-referrer' }) : '⚽'),
      el('b', { class: 'ellipsis', text: name }), el('div', { class: 'cm-dpts', text: pts }));
    card.append(el('div', { class: 'cm-derby' },
      side(c.name, c.team.logo, d.my, true), el('div', { class: 'cm-vs', text: 'VS' }), side(d.opponent.name, d.opponent.team.logo, d.their, false)),
    el('p', { class: `small ${lead === 'win' ? 'gold' : 'muted'}`, style: 'margin:10px 0 0;text-align:center', text: `${t(`cm_derby_${lead}`)} · ${t('cm_derby_ends', { date: `${ddmm(d.end)} ${hhmm(d.end)}` })}` }));
    return card;
  }

  function cmBand(c, big) {
    const col = c.colors || {};
    return el('div', { class: `cm-band${big ? ' big' : ''}`, style: `background:${col.primary};color:${col.text};border-bottom:4px solid ${col.secondary}` },
      el('span', { class: 'cm-logo' }, c.team.logo ? el('img', { src: c.team.logo, alt: '', referrerpolicy: 'no-referrer' }) : '⚽'),
      el('span', { class: 'grow', style: 'min-width:0' },
        el('b', { class: 'ellipsis', style: 'display:block', text: `${c.crown ? '👑 ' : ''}${c.name}` }),
        el('span', { class: 'small', style: 'opacity:.85', text: c.level ? `${c.team.name} · ${cmLevelLabel(c.level)}` : c.team.name })),
      c.champion ? el('span', { class: 'cm-champ', title: t('cm_champion'), text: '🏆' }) : null,
      c.wins ? el('span', { class: 'cm-wins', text: `🏆×${c.wins}` }) : null);
  }

  async function renderCommunity(view) {
    view.append(el('h2', { style: 'margin:4px 2px 4px', text: t('community_title') }),
      el('p', { class: 'small muted', style: 'margin:0 2px 12px', text: t('cm_subtitle') }));
    const box = el('div', null, skeleton(3));
    view.append(box);
    let d;
    try { d = await api('/community'); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const open = (id) => push({ render: (v) => renderCommunityPage(v, id) });
    const parts = [];
    if (d.champion) {
      parts.push(el('button', { class: 'card cm-champion', type: 'button', onclick: () => open(d.champion.id) },
        el('div', { class: 'small', style: 'font-weight:800;color:var(--gold)', text: t('cm_last_champion') }), cmBand(d.champion)));
    }
    const my = d.my && d.standings.find((c) => c.id === d.my.id);
    if (my) {
      parts.push(el('h3', { style: 'margin:14px 2px 8px', text: t('cm_my') }),
        el('button', { class: 'cm-card', type: 'button', onclick: () => open(my.id) }, cmBand(my),
          el('div', { class: 'cm-meta' }, el('span', { text: t('cm_place', { place: my.place }) }), el('span', { text: t('cm_points', { points: my.points }) }), el('span', { text: t('cm_members', { n: my.members }) }))));
    } else if (d.pending) {
      parts.push(el('div', { class: 'card', style: 'border-color:var(--gold)' }, el('b', { text: t('cm_pending_title') }),
        el('p', { class: 'small muted', style: 'margin:6px 0 0', text: t('cm_pending_text', { name: d.pending.name }) })));
    } else if (!d.premium || !d.card) {
      parts.push(el('div', { class: 'card' }, el('b', { text: t('cm_need_title') }),
        el('p', { class: 'small muted', style: 'margin:6px 0 10px', text: t(d.premium ? 'cm_need_card' : 'cm_need_premium') }),
        el('button', { class: 'btn block', text: d.premium ? t('cm_go_card') : t('buy_premium_btn'), onclick: () => {
          if (!d.premium) { openBot('premium'); return; }
          S.tab = 'profile'; S.stacks.profile = []; render();
        } })));
    } else {
      const mine = d.standings.filter((c) => c.team.id === d.card.teamId);
      parts.push(el('h3', { style: 'margin:14px 2px 8px', text: t('cm_club_communities', { club: d.card.teamName }) }));
      if (mine.length) {
        parts.push(el('div', { class: 'list' }, mine.map((c) => el('div', { class: 'cm-card' },
          el('button', { type: 'button', style: 'display:block;width:100%;text-align:left', onclick: () => open(c.id) }, cmBand(c)),
          el('div', { class: 'cm-meta' }, el('span', { text: t('cm_members', { n: c.members }) }), el('span', { text: t('cm_points', { points: c.points }) }),
            el('button', { class: 'btn', style: 'height:34px;margin-left:auto', text: t('cm_join'), onclick: async (e) => {
              e.target.disabled = true;
              try { await api(`/community/${c.id}/join`, { method: 'POST' }); haptic('success'); toast(t('cm_joined')); render(); } catch (err) { cmError(err); e.target.disabled = false; }
            } }))))));
      } else parts.push(el('p', { class: 'small muted', style: 'margin:0 2px', text: t('cm_none_for_club') }));
      parts.push(el('button', { class: 'btn ghost block', style: 'margin-top:10px', text: t('cm_create', { club: d.card.teamName }), onclick: () => push({ render: (v) => renderCommunityCreate(v, d) }) }),
        el('p', { class: 'small muted', style: 'margin:6px 2px 0', text: d.createPrice ? t('cm_price_paid', { price: money(d.createPrice) }) : t('cm_price_free') }));
    }
    parts.push(el('h3', { style: 'margin:18px 2px 4px', text: t('cm_ranking') }),
      el('p', { class: 'small muted', style: 'margin:0 2px 8px', text: t('cm_ranking_hint', { from: ddmmyyyy(d.week.start), to: ddmmyyyy(new Date(new Date(d.week.end).getTime() - 1).toISOString()) }) }));
    parts.push(d.standings.length ? el('div', { class: 'list' }, d.standings.map((c) => el('button', { class: `item cm-row${my && my.id === c.id ? ' on' : ''}`, type: 'button', onclick: () => open(c.id) },
      el('span', { class: 'cm-place', text: c.place <= 3 ? ['🥇', '🥈', '🥉'][c.place - 1] : String(c.place) }),
      el('span', { class: 'cm-logo sm' }, c.team.logo ? el('img', { src: c.team.logo, alt: '', referrerpolicy: 'no-referrer' }) : '⚽'),
      el('span', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block', text: `${c.crown ? '👑 ' : ''}${c.name}${c.champion ? ' 🏆' : ''}` }),
        el('span', { class: 'small muted', text: `${c.team.name} · Lv ${c.level.level} · ${t('cm_members', { n: c.members })}` })),
      el('b', { class: 'gold', text: c.points })))) : el('div', { class: 'card center muted', text: t('cm_ranking_empty') }));
    box.replaceChildren(...parts);
  }

  function renderCommunityCreate(view, d) {
    const name = el('input', { class: 'input', maxlength: '40', placeholder: t('cm_name_ph') });
    const desc = el('textarea', { class: 'input', rows: '3', maxlength: '300', placeholder: t('cm_desc_ph') });
    const send = el('button', { class: 'btn block', style: 'margin-top:14px', text: t('cm_send_request') });
    send.addEventListener('click', async () => {
      if ([...name.value.trim()].length < 3) { toast(t('cm_err_bad_name')); return; }
      send.disabled = true;
      try {
        await api('/community', { method: 'POST', body: { name: name.value.trim(), description: desc.value.trim() } });
        haptic('success'); toast(t('cm_request_sent')); goBack();
      } catch (err) { cmError(err); send.disabled = false; }
    });
    view.replaceChildren(backBar(t('cm_create_title')),
      el('div', { class: 'card' },
        el('div', { class: 'kv' }, el('span', { text: t('cm_club') }), el('b', { text: d.card.teamName })),
        el('div', { class: 'kv' }, el('span', { text: t('cm_price') }), el('b', { class: d.createPrice ? 'gold' : '', text: d.createPrice ? `${money(d.createPrice)} ${t('som')}` : t('cm_free') }))),
      el('label', { class: 'field-label', text: t('cm_name') }), name,
      el('label', { class: 'field-label', style: 'margin-top:10px', text: t('cm_desc') }), desc,
      el('p', { class: 'small muted', style: 'margin:10px 2px 0', text: d.createPrice ? t('cm_create_hint_paid', { price: money(d.createPrice) }) : t('cm_create_hint_free') }),
      send);
  }

  async function renderCommunityPage(view, id) {
    view.append(backBar(t('community_title')));
    const box = el('div', null, skeleton(4));
    view.append(box);
    let c;
    try { c = await api(`/community/${id}`, { fresh: true }); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const refresh = () => render();
    const st = c.stats;
    const statLine = (label, value) => el('div', { class: 'kv' }, el('span', { text: label }), el('b', { text: value }));
    const topList = (items) => (items.length ? items.map((x) => `${x.name} (${x.n})`).join(', ') : '—');
    const parts = [
      el('div', { class: 'cm-card' }, cmBand(c, true), c.description ? el('p', { style: 'margin:10px 14px 0', text: c.description }) : null,
        el('div', { class: 'small muted', style: 'margin:8px 14px 12px', text: t('cm_owner', { name: c.owner.name }) })),
      el('div', { class: 'stats3', style: 'margin-top:10px' },
        el('div', { class: 'stat' }, el('b', { text: c.place ? `${c.place}/${c.totalCommunities}` : '—' }), el('span', { text: t('cm_stat_place') })),
        el('div', { class: 'stat' }, el('b', { class: 'gold', text: c.points }), el('span', { text: t('cm_stat_points') })),
        el('div', { class: 'stat' }, el('b', { text: c.members }), el('span', { text: t('cm_stat_members') }))),
      cmLevelCard(c.level),
      cmDerbyCard(c),
      el('div', { class: 'card', style: 'margin-top:10px' }, el('h3', { style: 'margin-top:0', text: t('cm_stats_title') }),
        statLine(t('cm_avg_age'), st.avg_age ?? '—'),
        statLine(t('cm_gender'), `${t('fc_male')}: ${st.male} · ${t('fc_female')}: ${st.female}`),
        statLine(t('cm_avg_since'), st.avg_since ?? '—'),
        statLine(t('cm_top_regions'), topList(st.regions)),
        statLine(t('cm_top_goats'), topList(st.goats)),
        statLine(t('cm_top_players'), topList(st.players))),
    ];
    // Postlar (egasi yozadi) + reaksiyalar (👍 ⚽ 🔥, faqat a'zolar)
    const REACTS = [['like', '👍'], ['ball', '⚽'], ['fire', '🔥']];
    const reactBar = (p) => {
      const bar = el('div', { class: 'cm-reacts' });
      const draw = () => put(bar, ...REACTS.map(([k, icon]) => el('button', {
        class: `cm-react${p.myReaction === k ? ' on' : ''}`, text: `${icon} ${p.reactions[k] || 0}`,
        onclick: async () => {
          if (!c.isMember) { toast(t('cm_react_members_only')); return; }
          try { Object.assign(p, await api(`/community/posts/${p.id}/react`, { method: 'POST', body: { reaction: k } })); haptic(); draw(); } catch (err) { cmError(err); }
        },
      })));
      draw();
      return bar;
    };
    const posts = el('div', { class: 'list' }, c.posts.length ? c.posts.map((p) => el('div', { class: 'card' },
      el('div', { style: 'white-space:pre-wrap', text: p.text }),
      reactBar(p),
      el('div', { class: 'row between', style: 'margin-top:6px' }, el('span', { class: 'small muted', text: `${ddmmyyyy(p.created_at)} ${hhmm(p.created_at)}` }),
        c.isOwner ? el('button', { class: 'mini danger', text: '🗑', onclick: async () => {
          try { await api(`/community/posts/${p.id}`, { method: 'DELETE' }); refresh(); } catch (err) { cmError(err); }
        } }) : null))) : [el('div', { class: 'card center muted', text: t('cm_no_posts') })]);
    parts.push(el('h3', { style: 'margin:16px 2px 8px', text: t('cm_posts') }));
    if (c.isOwner) {
      const text = el('textarea', { class: 'input', rows: '3', maxlength: '1000', placeholder: t('cm_post_ph') });
      const send = el('button', { class: 'btn', style: 'margin-top:6px', text: t('cm_post_send') });
      send.addEventListener('click', async () => {
        if (!text.value.trim()) return;
        send.disabled = true;
        try { await api(`/community/${c.id}/posts`, { method: 'POST', body: { text: text.value } }); haptic('success'); refresh(); } catch (err) { cmError(err); send.disabled = false; }
      });
      parts.push(el('div', { class: 'card' }, text, send));
    }
    parts.push(posts);
    // A'zolar
    parts.push(el('h3', { style: 'margin:16px 2px 8px', text: t('cm_members_title', { n: c.members }) }),
      el('div', { class: 'list' }, c.memberList.length ? c.memberList.map((m, i) => el('div', { class: 'item' },
        el('span', { class: 'muted', style: 'width:22px', text: String(i + 1) }),
        el('span', { class: 'grow ellipsis', text: `${m.name}${m.role === 'owner' ? ` · ${t('cm_owner_badge')}` : ''}` }),
        el('b', { class: 'gold', text: m.points }),
        c.isOwner && m.role !== 'owner' ? el('button', { class: 'mini danger', text: t('cm_kick'), onclick: () => {
          modal(t('cm_kick'), t('cm_kick_confirm', { name: m.name }), [
            el('button', { class: 'btn block', text: t('cm_kick'), onclick: async () => {
              closeModal();
              try { await api(`/community/${c.id}/kick`, { method: 'POST', body: { userId: m.id } }); toast(t('cm_kicked')); refresh(); } catch (err) { cmError(err); }
            } }),
            el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
        } }) : null)) : []));
    // Amallar
    if (c.isOwner) {
      parts.push(el('button', { class: 'btn ghost block', style: 'margin-top:12px', text: t('cm_edit'), onclick: () => {
        const name = el('input', { class: 'input', maxlength: '40', value: c.name });
        const desc = el('textarea', { class: 'input', rows: '3', maxlength: '300' });
        desc.value = c.description;
        modal(t('cm_edit'), null, [name, desc,
          el('button', { class: 'btn block', text: t('save'), onclick: async () => {
            try { await api(`/community/${c.id}`, { method: 'PATCH', body: { name: name.value.trim(), description: desc.value.trim() } }); closeModal(); toast(t('fc_saved')); refresh(); } catch (err) { cmError(err); }
          } }),
          el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
      } }));
    } else if (c.isMember) {
      parts.push(el('button', { class: 'btn ghost block', style: 'margin-top:12px', text: t('cm_leave'), onclick: () => {
        modal(t('cm_leave'), t('cm_leave_confirm', { name: c.name }), [
          el('button', { class: 'btn block', text: t('cm_leave'), onclick: async () => {
            closeModal();
            try { await api('/community/leave', { method: 'POST' }); toast(t('cm_left')); goBack(); } catch (err) { cmError(err); }
          } }),
          el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
      } }));
    }
    box.replaceChildren(...parts);
  }

  function renderGames(view) {
    todayCard(view);
    view.append(el('h2', { style: 'margin:16px 2px 12px', text: t('games_title') }),
      el('div', { class: 'list' }, GAMES.map((g) => el('button', { class: 'item game-item', type: 'button', onclick: g.open },
        el('span', { class: 'game-ico', style: `--g:${g.grad || 'var(--grad)'}`, text: g.icon }),
        el('span', { class: 'grow' }, el('b', { text: g.title() }), el('div', { class: 'small muted', text: g.desc() })),
        g.premium && !S.me.premium ? el('span', { class: 'badge gold', text: '💎' }) : el('span', { class: 'chev', text: '›' })))));
    // 🏆 Umumiy reyting (hamma o'yinlar points'i) — o'yinlar ro'yxatidan keyin; haftalik va oylik g'oliblar shu bo'yicha
    view.append(prizeBlock('overall'), leaderboardBlock('overall', { limit: 5, periods: ['daily', 'weekly', 'monthly'], title: t('lb_overall_title'), hint: t('lb_overall_hint') }));
  }

  async function renderManager(view) {
    if (!S.me.premium) { lockedSection(view, '🎮'); return; }
    if (!S.me.coachName) { view.append(coachPrompt(() => render())); return; }
    view.append(el('div', { class: 'card row between' },
      el('span', null, el('span', { class: 'muted', text: `${t('coach_label')}: ` }), el('b', { text: S.me.coachName })),
      el('button', { class: 'btn ghost', style: 'height:34px;font-size:13px', text: t('coach_change'), onclick: () => modal(t('coach_prompt_title'), null, [coachPrompt(() => { closeModal(); render(); }, S.me.coachName)]) })));
    view.append(el('h2', { text: t('mm_games') }));
    const list = el('div', null, skeleton(2));
    view.append(list, leaderboardBlock('manager'));
    try {
      const d = await api('/manager/games');
      list.replaceChildren();
      if (!d.games.length) { list.append(el('div', { class: 'card center muted', text: t('mm_no_games') })); return; }
      for (const g of d.games) {
        let status;
        if (g.prediction && g.prediction.points !== null && g.prediction.points !== undefined) status = el('span', { class: 'badge gold', text: t('mm_points', { points: g.prediction.points }) });
        else if (g.locked) status = el('span', { class: 'badge', text: t('mm_locked') });
        else if (g.prediction) status = el('span', { class: 'badge live', text: t('mm_predicted') });
        else status = el('span', { class: 'badge gold', text: t('mm_not_predicted') });
        list.append(el('button', { class: 'match', style: 'width:100%;text-align:left', onclick: () => push({ render: (v) => renderGame(v, g.id) }) },
          el('div', { class: 'teams' },
            el('div', { class: 'team-line' }, crest(g.home.crest), el('span', { class: 'name', text: g.home.name }), g.result ? el('span', { class: 'sc', text: g.result.home }) : null),
            el('div', { class: 'team-line' }, crest(g.away.crest), el('span', { class: 'name', text: g.away.name }), g.result ? el('span', { class: 'sc', text: g.result.away }) : null)),
          el('div', { class: 'side' }, el('span', { class: 'time', text: `${ddmm(g.kickoffAt)} ${hhmm(g.kickoffAt)}` }), status)));
      }
    } catch (err) { list.replaceChildren(errorBox(err, () => render())); }
  }




  // ================= 💥 CROSSBAR CHALLENGE va ⚽ KEEPY-UPPY — taymingli o'yinlar (faqat Premium)
  // Server parametrlarni beradi, o'yin brauzerda o'ynaladi, bosish vaqtlari oxirida yuboriladi va natija serverda qayta hisoblanadi.
  // Rejimlar: 🤖 botga qarshi, 🎲 tasodifiy raqib, 🤝 do'st (ikkalasi bir xil parametrlarda navbatma-navbat o'ynaydi).
  const AR = {
    crossbar: { icon: '💥', title: () => t('cb_title') },
    keepy: { icon: '⚽', title: () => t('ku_title') },
  };
  const cbPos = (ms, period) => 50 - 50 * Math.cos((2 * Math.PI * ms) / period);
  const cbPoints = (pos) => { const d = Math.abs(pos - 75); return d <= 2.5 ? 3 : d <= 6 ? 2 : d <= 12 ? 1 : 0; };
  const KU_X_TOL = 16;

  function arcadeError(err) {
    const code = err && err.body && err.body.error;
    haptic('error');
    if (err && err.status === 402) { premiumModal(); return; }
    toast(I.DICTS.uz[`du_err_${code}`] ? t(`du_err_${code}`) : I.DICTS.uz[`ar_err_${code}`] ? t(`ar_err_${code}`) : t('error_generic'));
  }

  // ================= 🏁 NATIJA EKRANI (sinov): o'yin tugaganda — katta points, haftalik o'rin o'zgarishi, yana o'ynash, do'stni chaqirish
  /** O'yin ekrani ochilganda haftalik o'rinni eslab qolish (natijada o'zgarishni ko'rsatish uchun) */
  function capturePlace() {
    api('/me/place', { fresh: true }).then((p) => { S.placeBefore = p; }).catch(() => {});
  }
  let refLinkCache = null;
  async function inviteFriend() {
    try {
      if (!refLinkCache) refLinkCache = (await api('/share')).refLink;
      if (refLinkCache) shareLink(refLinkCache, t('rs_invite_text'));
    } catch (e) { toast(t('error_generic')); }
  }
  function resultSheet({ result, score, points, again }) {
    const close = () => { wrap.classList.remove('on'); setTimeout(() => wrap.remove(), 250); };
    const place = el('div', { class: 'rs-place muted small', text: '…' });
    const pts = el('b', { class: 'rs-pts', text: '0' });
    const wrap = el('div', { class: 'rs-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
      el('div', { class: `rs ${result || ''}` },
        el('div', { class: 'rs-emoji', text: result === 'win' ? '🏆' : result === 'draw' ? '🤝' : '💪' }),
        el('div', { class: 'rs-title', text: [result ? t(`du_res_${result}`) : null, score].filter(Boolean).join(' · ') }),
        el('div', { class: 'rs-points' }, el('span', { text: points ? '+' : '' }), pts, el('span', { class: 'rs-unit', text: ' points' })),
        place,
        el('div', { class: 'rs-actions' },
          again ? el('button', { class: 'btn block', text: t('pk_again'), onclick: () => { close(); again(); } }) : null,
          el('button', { class: 'btn ghost block', text: t('rs_invite'), onclick: inviteFriend }),
          el('button', { class: 'rs-close', type: 'button', text: t('rs_close'), onclick: close }))));
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('on'));
    // Points sanab chiqadi
    const target = Number(points) || 0;
    const t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 700); pts.textContent = String(Math.round(target * k)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    if (result === 'win') { confetti(); SFX.play('win'); } else if (result === 'loss') SFX.play('lose');
    const before = S.placeBefore;
    api('/me/place', { fresh: true }).then((p) => {
      S.placeBefore = p;
      if (!p.place) { place.textContent = t('rs_no_place'); return; }
      const up = before && before.place ? before.place - p.place : 0;
      place.textContent = up > 0 ? t('rs_place_up', { from: before.place, to: p.place, n: up }) : t('rs_place', { place: p.place });
      if (up > 0) place.className = 'rs-place gold';
    }).catch(() => { place.textContent = ''; });
  }

  function shareLink(link, text) {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); return; } } catch (e) { /* */ }
    window.open(url, '_blank');
  }

  async function renderArcade(view, kind) {
    capturePlace();
    if (!S.me.premium) { lockedSection(view, AR[kind].icon); return; }
    const box = el('div', null, skeleton(3));
    view.append(box, leaderboardBlock(kind));
    let st;
    let matches;
    try { [st, matches] = await Promise.all([api(`/arcade/${kind}`, { fresh: true }), api(`/arcade/${kind}/matches`, { fresh: true })]); } catch (err) {
      if (err.status === 402) { S.me.premium = false; box.replaceChildren(); premiumModal(); return; }
      box.replaceChildren(errorBox(err, () => render())); return;
    }
    const playBot = (g) => (kind === 'crossbar' ? crossbarGame : keepyGame)(box, g, {
      target: t(`ar_target_${kind}`, { n: g.botScore }),
      onDone: (taps, card) => arcadeFinish(box, st, kind, taps, card),
    });
    if (st.game) { playBot(st.game); return; }
    const botBtn = el('button', { class: 'btn block', disabled: st.left <= 0, text: st.left > 0 ? t('ar_vs_bot', { n: st.left }) : t('pk_limit') });
    botBtn.addEventListener('click', async () => {
      botBtn.disabled = true;
      try { const g = await api(`/arcade/${kind}/start`, { method: 'POST' }); haptic(); playBot(g); } catch (err) { arcadeError(err); botBtn.disabled = false; }
    });
    const match = async (mode, btn) => {
      btn.disabled = true;
      try {
        const m = await api(`/arcade/${kind}/match`, { method: 'POST', body: { mode } });
        haptic('success');
        push({ render: (v) => renderArcadeMatch(v, m.id, m.link) });
      } catch (err) { arcadeError(err); btn.disabled = false; }
    };
    const rnd = el('button', { class: 'btn', text: t('du_random') });
    const inv = el('button', { class: 'btn ghost', text: t('du_invite') });
    rnd.addEventListener('click', () => match('random', rnd));
    inv.addEventListener('click', () => match('invite', inv));
    put(box,
      el('div', { class: 'card' }, el('p', { class: 'small muted', style: 'margin-top:0', text: t(`ar_rules_${kind}`, { n: st.rules.attempts, win: st.rules.win, draw: st.rules.draw, limit: st.rules.limit }) }),
        botBtn,
        el('p', { class: 'small muted', style: 'margin:12px 0 8px', text: t('ar_pvp_rules', { win: st.rules.pvp.win, draw: st.rules.pvp.draw }) }),
        el('div', { class: 'grid2' }, rnd, inv)),
      el('div', { class: 'stats3', style: 'margin-top:10px' },
        el('div', { class: 'stat' }, el('b', { text: st.stats.played }), el('span', { text: t('pk_played') })),
        el('div', { class: 'stat' }, el('b', { class: 'gold', text: st.stats.wins }), el('span', { text: t('pk_wins') })),
        el('div', { class: 'stat' }, el('b', { text: st.stats.best }), el('span', { text: t('ar_best') }))),
      matches.length ? el('h3', { style: 'margin:16px 2px 8px', text: t('ar_my_matches') }) : null,
      matches.length ? el('div', { class: 'list' }, matches.map((m) => el('button', { class: 'item', type: 'button', onclick: () => push({ render: (v) => renderArcadeMatch(v, m.id) }) },
        el('span', { style: 'font-size:22px', text: AR[kind].icon }),
        el('span', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block', text: m.opponent ? m.opponent.name : t(m.mode === 'invite' ? 'du_no_friend' : 'du_searching') }),
          el('span', { class: 'small muted', text: `${ddmm(m.createdAt)} ${hhmm(m.createdAt)}` })),
        m.state === 'finished' && m.result
          ? el('span', { class: m.result.result === 'win' ? 'badge gold' : 'badge', text: `${t(`du_res_${m.result.result}`)} ${m.my}:${m.their}` })
          : el('span', { class: m.state === 'your_turn' ? 'badge live' : 'badge', text: t(`du_st_${m.state}`) })))) : null);
  }

  /** Botga qarshi o'yin tugadi: bosish vaqtlarini yuborish va natijani ko'rsatish */
  async function arcadeFinish(box, st, kind, taps, card) {
    const wait = el('div', { class: 'small muted center', style: 'padding:14px 0', text: t('ar_sending') });
    box.replaceChildren(card, wait);
    let g;
    try { g = await api(`/arcade/${kind}/finish`, { method: 'POST', body: { taps } }); } catch (err) { wait.replaceWith(errorBox(err, () => arcadeFinish(box, st, kind, taps, card))); return; }
    haptic(g.result === 'win' ? 'success' : g.result === 'loss' ? 'error' : undefined);
    if (g.result === 'win') confetti();
    const left = st.left - (st.game ? 0 : 1);
    wait.replaceWith(arcadeResultCard(g.result, g.score, g.botScore, g.points, left > 0 ? () => render() : null));
    resultSheet({ result: g.result, score: `${g.score}:${g.botScore}`, points: g.points, again: left > 0 ? () => render() : null });
  }

  function arcadeResultCard(result, my, their, points, again) {
    return el('div', { class: `card center du-final ${result}`, style: 'padding:18px 0' },
      el('div', { style: 'font-size:42px', text: result === 'win' ? '🏆' : result === 'draw' ? '🤝' : '💪' }),
      el('h2', { style: 'margin:4px 0', text: `${t(`du_res_${result}`)} ${my}:${their}` }),
      el('div', { class: points ? 'gold' : 'muted', text: points ? `+${points} points` : t(result === 'loss' ? 'du_next_time' : 'du_no_points') }),
      again ? el('button', { class: 'btn', style: 'margin:12px auto 0;min-width:60%', text: t('pk_again'), onclick: again }) : null);
  }

  /** 🎲/🤝 Raqib bilan bellashuv sahifasi */
  async function renderArcadeMatch(view, id, link) {
    view.append(backBar(t('ar_match_title')));
    const box = el('div', null, skeleton(3));
    view.append(box);
    let m;
    try { m = await api(`/arcade/match/${id}`, { fresh: true }); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const kind = m.kind;
    const inviteLink = link || m.link;
    const head = el('div', { class: 'card' },
      el('div', { class: 'small muted', text: `${AR[kind].icon} ${AR[kind].title()}` }),
      el('div', { class: 'du-vs' }, el('b', { class: 'ellipsis', text: t('du_you') }), el('span', { class: 'muted', text: 'VS' }),
        el('b', { class: 'ellipsis', text: m.opponent ? m.opponent.name : '?' })),
      el('div', { class: 'du-vs small muted' }, el('span', { text: m.my !== null ? String(m.my) : '—' }), el('span'),
        el('span', { text: m.their !== null ? String(m.their) : m.opponent && m.opponent.played ? '✓' : '—' })));
    const parts = [head];
    if (m.state === 'finished' && m.result) {
      parts.push(arcadeResultCard(m.result.result, m.my ?? 0, m.their ?? 0, m.result.points, null));
    } else if (m.state === 'expired') {
      parts.push(el('div', { class: 'card center muted', text: t('du_expired') }));
    } else if (m.state === 'your_turn') {
      const playBox = el('div');
      const play = el('button', { class: 'btn block', text: t('ar_play') });
      play.addEventListener('click', async () => {
        play.disabled = true;
        let g;
        try { g = await api(`/arcade/match/${m.id}/start`, { method: 'POST' }); } catch (err) { arcadeError(err); play.disabled = false; return; }
        haptic();
        (kind === 'crossbar' ? crossbarGame : keepyGame)(playBox, g, {
          target: m.opponent ? t('ar_target_vs', { name: m.opponent.name }) : t('du_searching'),
          onDone: async (taps, card) => {
            playBox.replaceChildren(card, el('div', { class: 'small muted center', style: 'padding:14px 0', text: t('ar_sending') }));
            try { await api(`/arcade/match/${m.id}/finish`, { method: 'POST', body: { taps } }); haptic('success'); render(); } catch (err) { arcadeError(err); }
          },
        });
      });
      parts.push(el('div', { class: 'card' }, el('p', { class: 'small muted', style: 'margin-top:0', text: t(`ar_rules_${kind}_pvp`) }), play), playBox);
    } else {
      parts.push(el('div', { class: 'card center' },
        el('div', { style: 'font-size:36px', text: '⏳' }),
        el('p', { style: 'margin:6px 0 0', text: t(m.state === 'waiting_opponent' ? (m.mode === 'invite' ? 'ar_wait_friend' : 'ar_wait_random') : 'ar_wait_turn', { score: m.my ?? 0 }) }),
        el('p', { class: 'small muted', text: t('du_until', { date: `${ddmm(m.expiresAt)} ${hhmm(m.expiresAt)}` }) })));
    }
    if (inviteLink && !m.opponent) {
      parts.push(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: t('du_invite_title') }), el('p', { class: 'small muted', text: t('ar_invite_hint') }),
        el('div', { class: 'du-link', text: inviteLink }),
        el('button', { class: 'btn block', style: 'margin-top:10px', text: t('du_send_link'), onclick: () => shareLink(inviteLink, t('ar_share_text', { kind: AR[kind].title() })) })));
    }
    box.replaceChildren(...parts);
  }

  /** Do'st havolasi orqali kelgan taklif */
  async function renderArcadeInvite(view, code) {
    view.append(backBar(t('ar_match_title')));
    const box = el('div', null, skeleton(2));
    view.append(box);
    let p;
    try { p = await api(`/arcade/invite/${encodeURIComponent(code)}`); } catch (err) { box.replaceChildren(el('div', { class: 'card center muted', text: t('du_err_not_found') })); return; }
    if (p.mine) { currentStack().pop(); push({ render: (v) => renderArcadeMatch(v, p.id) }); return; }
    if (!p.available) { box.replaceChildren(el('div', { class: 'card center muted', text: t('du_err_not_available') })); return; }
    const accept = el('button', { class: 'btn block', text: t('du_accept') });
    accept.addEventListener('click', async () => {
      if (!S.me.premium) { premiumModal(); return; }
      accept.disabled = true;
      try {
        const m = await api(`/arcade/invite/${encodeURIComponent(code)}/join`, { method: 'POST' });
        haptic('success');
        currentStack().pop();
        push({ render: (v) => renderArcadeMatch(v, m.id) });
      } catch (err) { arcadeError(err); accept.disabled = false; }
    });
    box.replaceChildren(el('div', { class: 'card center' },
      el('div', { style: 'font-size:46px', text: AR[p.kind].icon }),
      el('h3', { text: t('du_invited', { name: p.from, kind: AR[p.kind].title() }) }),
      el('p', { class: 'small muted', text: t(`ar_rules_${p.kind}_pvp`) }),
      accept));
  }

  function arcadeHead(target, my) {
    return el('div', { class: 'row between ar-head' }, el('b', { text: `${t('du_you')}: ${my}` }), el('span', { class: 'muted small ellipsis', text: target }));
  }

  // 💥 Crossbar: 5 urinish, indikator tebranadi — crossbar (75) chizig'ida bosish kerak
  function crossbarGame(box, g, opts) {
    const taps = [];
    let total = 0;
    let i = 0;
    let t0 = 0;
    let running = false;
    let raf = 0;
    const head = el('div');
    const dots = el('div', { class: 'pk-dots', style: 'justify-content:center;margin:8px 0' });
    const marker = el('div', { class: 'cb-marker' });
    const meter = el('div', { class: 'cb-meter' }, el('div', { class: 'cb-band b1' }), el('div', { class: 'cb-band b2' }), el('div', { class: 'cb-band b3' }), marker);
    const ball = el('div', { class: 'cb-ball', text: '⚽' });
    const flash = el('div', { class: 'pk-flash' });
    const field = el('div', { class: 'cb-field' }, el('div', { class: 'cb-goal' }), ball, flash, meter);
    const shot = el('button', { class: 'btn block', style: 'margin-top:10px;height:54px;font-size:18px', text: t('cb_shot') });
    const card = el('div', { class: 'card' }, head, dots, field, shot);
    const drawHead = () => {
      put(head, arcadeHead(opts.target, total));
      put(dots, g.params.attempts.map((_, k) => el('span', { class: `pk-dot${k < taps.length ? (taps[k].p ? ' goal' : ' miss') : ''}` })));
    };
    const frame = () => {
      if (!running) return;
      marker.style.bottom = `${cbPos(performance.now() - t0, g.params.attempts[i].period)}%`;
      raf = requestAnimationFrame(frame);
    };
    const begin = () => {
      ball.style.bottom = '6%'; ball.style.transform = 'translateX(-50%) scale(1)';
      flash.className = 'pk-flash'; flash.textContent = '';
      shot.disabled = false;
      t0 = performance.now();
      running = true;
      raf = requestAnimationFrame(frame);
    };
    cleanups.push(() => { running = false; cancelAnimationFrame(raf); });
    shot.addEventListener('click', () => {
      if (!running) return;
      const ms = Math.round(performance.now() - t0);
      running = false;
      cancelAnimationFrame(raf);
      shot.disabled = true;
      const pos = cbPos(ms, g.params.attempts[i].period);
      const p = cbPoints(pos);
      SFX.play('kick');
      taps.push({ ms, p });
      total += p;
      ball.style.bottom = `${Math.min(88, 8 + pos * 0.93)}%`; ball.style.transform = 'translateX(-50%) scale(.65)';
      setTimeout(() => {
        flash.textContent = p ? t(`cb_hit${p}`) : t(pos > 75 ? 'cb_over' : 'cb_under');
        flash.className = `pk-flash on ${p ? 'good' : 'bad'}`;
        SFX.play(p ? 'goal' : 'save');
        haptic(p ? 'success' : 'error');
        drawHead();
      }, 380);
      setTimeout(() => {
        i += 1;
        if (i >= g.params.attempts.length) opts.onDone(taps.map((x) => x.ms), card);
        else begin();
      }, 1400);
    });
    drawHead();
    box.replaceChildren(card);
    begin();
  }

  // ⚽ Keepy-uppy: to'p maydon bo'ylab uchadi va har safar boshqa joyga tushadi — yerga tegish paytida ustiga bosish kerak
  function keepyGame(box, g, opts) {
    const taps = [];
    let k = 0;
    let phase = 'ready';   // ready | up | fall | over
    let t0 = 0;
    let raf = 0;
    let fromX = 50;
    let apexX = 50;
    const GROUND = 74;     // to'p yerga tekkandagi "top" (%)
    const APEX = 4;
    const head = el('div');
    const count = el('div', { class: 'ku-count', text: '0' });
    const ball = el('div', { class: 'ku-ball', text: '⚽' });
    const flash = el('div', { class: 'pk-flash' });
    const hint = el('div', { class: 'ku-hint', text: t('ku_hint') });
    const field = el('div', { class: 'ku-field' }, count, ball, flash, hint);
    const card = el('div', { class: 'card' }, head, field);
    const drawHead = () => put(head, arcadeHead(opts.target, k));
    const place = (x, y) => { ball.style.left = `${x}%`; ball.style.top = `${y}%`; };
    const kick = (x) => {
      const foot = el('div', { class: 'ku-kick', text: '🦶', style: `left:${x}%` });
      field.append(foot);
      setTimeout(() => foot.remove(), 450);
    };
    const over = () => {
      phase = 'over';
      cancelAnimationFrame(raf);
      flash.textContent = t('ku_drop');
      SFX.play('lose');
      flash.className = 'pk-flash on bad';
      haptic('error');
      setTimeout(() => opts.onDone(taps, card), 900);
    };
    const nextFall = () => { const f = g.params.falls[k]; apexX = (fromX + (f.x ?? 50)) / 2; };
    const frame = () => {
      const now = performance.now();
      const f = g.params.falls[k];
      const toX = f.x ?? 50;
      if (phase === 'up') {
        const p = Math.min(1, (now - t0) / 260);
        place(fromX + (apexX - fromX) * p, GROUND - (GROUND - APEX) * p);
        if (p >= 1) { phase = 'fall'; t0 = now; }
      } else if (phase === 'fall') {
        const elapsed = now - t0;
        const p = elapsed / f.t;
        place(apexX + (toX - apexX) * Math.min(1, p), APEX + (GROUND - APEX) * Math.min(1.12, p));
        if (elapsed > f.t + f.w) { taps.push({ ms: null }); over(); return; }
      } else return;
      raf = requestAnimationFrame(frame);
    };
    cleanups.push(() => { phase = 'over'; cancelAnimationFrame(raf); });
    field.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (phase === 'ready') { hint.remove(); nextFall(); phase = 'up'; t0 = performance.now(); raf = requestAnimationFrame(frame); return; }
      if (phase !== 'fall') return;
      const rect = field.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      const ms = Math.round(performance.now() - t0);
      const f = g.params.falls[k];
      taps.push({ ms, x });
      kick(x);
      if (Math.abs(ms - f.t) > f.w || (f.x !== undefined && Math.abs(x - f.x) > KU_X_TOL)) { over(); return; }
      k += 1;
      SFX.play('kick');
      count.textContent = String(k);
      drawHead();
      haptic();
      if (k >= g.params.falls.length) { phase = 'over'; opts.onDone(taps, card); return; }
      fromX = f.x ?? 50;
      nextFall();
      phase = 'up';
      t0 = performance.now();
    });
    drawHead();
    place(50, GROUND);
    box.replaceChildren(card);
  }

  // ================= 🥅 PENALTY (sinov) — botga qarshi seriya: 5 zarba urasiz, 5 tasini qaytarasiz
  const PK_POS = { left: 24, center: 50, right: 76 };

  async function renderPenalty(view) {
    capturePlace();
    if (!S.me.premium) { lockedSection(view, '🥅'); return; }
    const box = el('div', null, skeleton(3));
    view.append(box, leaderboardBlock('penalty'));
    let st;
    try { st = await api('/penalty', { fresh: true }); } catch (err) {
      if (err.status === 402) { S.me.premium = false; box.replaceChildren(); premiumModal(); return; }
      box.replaceChildren(errorBox(err, () => render())); return;
    }
    if (st.game) { penaltyBoard(box, st, st.game); return; }
    const startBtn = el('button', { class: 'btn block', disabled: st.left <= 0, text: st.left > 0 ? t('pk_start', { n: st.left }) : t('pk_limit') });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try { const g = await api('/penalty/start', { method: 'POST' }); haptic(); penaltyBoard(box, st, g); } catch (err) { toast(t('error_generic')); startBtn.disabled = false; }
    });
    box.replaceChildren(
      el('div', { class: 'card' }, el('p', { class: 'small muted', style: 'margin-top:0', text: t('pk_rules', { n: st.rules.kicks, win: st.rules.win, draw: st.rules.draw, limit: st.rules.limit }) }), startBtn),
      el('div', { class: 'stats3', style: 'margin-top:10px' },
        el('div', { class: 'stat' }, el('b', { text: st.stats.played }), el('span', { text: t('pk_played') })),
        el('div', { class: 'stat' }, el('b', { class: 'gold', text: st.stats.wins }), el('span', { text: t('pk_wins') })),
        el('div', { class: 'stat' }, el('b', { text: st.stats.best }), el('span', { text: t('pk_best') }))));
  }

  function penaltyDots(kicks, by) {
    const mine = kicks.filter((k) => k.by === by);
    const n = Math.max(5, mine.length);
    return el('div', { class: 'pk-dots' }, Array.from({ length: n }, (_, i) => {
      const k = mine[i];
      return el('span', { class: `pk-dot${k ? (k.goal ? ' goal' : ' miss') : ''}` });
    }));
  }

  function penaltyBoard(box, st, game) {
    let g = game;
    let busy = false;
    const keeper = el('div', { class: 'pk-keeper', text: '🧤' });
    const ball = el('div', { class: 'pk-ball', text: '⚽' });
    const flash = el('div', { class: 'pk-flash' });
    const prompt = el('div', { class: 'pk-prompt' });
    const score = el('div', { class: 'pk-score' });
    const zones = ['left', 'center', 'right'].map((dir) => el('button', { class: 'pk-zone', type: 'button', 'aria-label': dir, onclick: () => shoot(dir) }));
    const goal = el('div', { class: 'pk-goal' }, ...zones);
    const pitch = el('div', { class: 'pk-pitch' }, goal, keeper, ball, flash);
    const after = el('div');
    const reset = () => {
      keeper.style.left = '50%'; ball.style.left = '50%'; ball.style.bottom = '8%'; ball.style.transform = 'translateX(-50%) scale(1)';
      flash.textContent = ''; flash.className = 'pk-flash';
    };
    const draw = () => {
      put(score,
        el('div', { class: 'pk-row' }, el('b', { text: t('du_you') }), penaltyDots(g.kicks, 'user'), el('b', { class: 'pk-n', text: g.userGoals })),
        el('div', { class: 'pk-row' }, el('b', { text: '🤖 Bot' }), penaltyDots(g.kicks, 'bot'), el('b', { class: 'pk-n', text: g.botGoals })));
      if (g.status === 'finished') {
        prompt.textContent = '';
        zones.forEach((z) => { z.disabled = true; });
        const left = st.left - (st.game ? 0 : 1);
        const again = el('button', { class: 'btn', style: 'margin:12px auto 0;min-width:60%', text: t('pk_again'), onclick: () => render() });
        put(after, el('div', { class: `card center du-final ${g.result}`, style: 'padding:18px 0' },
          el('div', { style: 'font-size:42px', text: g.result === 'win' ? '🏆' : g.result === 'draw' ? '🤝' : '💪' }),
          el('h2', { style: 'margin:4px 0', text: `${t(`du_res_${g.result}`)} ${g.userGoals}:${g.botGoals}` }),
          el('div', { class: g.points ? 'gold' : 'muted', text: g.points ? `+${g.points} points` : t('du_next_time') }),
          left > 0 ? again : null));
        return;
      }
      prompt.textContent = `${g.sudden ? `${t('pk_sudden')} · ` : ''}${t(g.next === 'user' ? 'pk_your_shot' : 'pk_your_save')}`;
      pitch.classList.toggle('keeping', g.next === 'bot');
    };
    async function shoot(dir) {
      if (busy || g.status !== 'active') return;
      busy = true;
      haptic();
      let r;
      try { r = await api('/penalty/kick', { method: 'POST', body: { dir } }); } catch (err) { toast(t('error_generic')); busy = false; return; }
      const k = r.kick;
      SFX.play('kick');
      ball.style.left = `${PK_POS[k.shot]}%`; ball.style.bottom = '52%'; ball.style.transform = 'translateX(-50%) scale(.7)';
      keeper.style.left = `${PK_POS[k.dive]}%`;
      const good = k.by === 'user' ? k.goal : !k.goal;
      setTimeout(() => {
        flash.textContent = k.goal ? t('pk_goal') : t('pk_saved');
        SFX.play(good ? 'goal' : 'save');
        flash.className = `pk-flash on ${good ? 'good' : 'bad'}`;
        haptic(good ? 'success' : 'error');
      }, 380);
      setTimeout(() => {
        g = r.game; reset(); draw(); busy = false;
        if (g.status === 'finished') {
          const left = st.left - (st.game ? 0 : 1);
          resultSheet({ result: g.result, score: `${g.userGoals}:${g.botGoals}`, points: g.points, again: left > 0 ? () => render() : null });
        }
      }, 1400);
    }
    reset();
    draw();
    box.replaceChildren(el('div', { class: 'card' }, score, prompt, pitch), after);
  }

  // ================= ⚔️ DUEL — Quiz duel va Futbolchini top 1v1 (navbatma-navbat, faqat Premium)
  const DUEL_KINDS = [['quiz', '🧠'], ['player', '🕵️']];
  const duelKindName = (k) => t(`du_kind_${k}`);

  function duelError(err) {
    const code = err && err.body && err.body.error;
    haptic('error');
    if (err && err.status === 402) { premiumModal(); return; }
    toast(I.DICTS.uz[`du_err_${code}`] ? t(`du_err_${code}`) : t('error_generic'));
  }

  function duelStateBadge(d) {
    if (d.state === 'finished' && d.result) {
      const cls = d.result.result === 'win' ? 'badge gold' : d.result.result === 'draw' ? 'badge' : 'badge';
      return el('span', { class: cls, text: `${t(`du_res_${d.result.result}`)} ${d.result.my}:${d.result.their}` });
    }
    return el('span', { class: d.state === 'your_turn' ? 'badge live' : 'badge', text: t(`du_st_${d.state}`) });
  }

  async function renderDuels(view) {
    capturePlace();
    if (!S.me.premium) { lockedSection(view, '⚔️'); return; }
    const box = el('div', null, skeleton(3));
    view.append(box, leaderboardBlock('duel'));
    let d;
    try { d = await api('/duels', { fresh: true }); } catch (err) {
      if (err.status === 402) { S.me.premium = false; box.replaceChildren(); premiumModal(); return; }
      box.replaceChildren(errorBox(err, () => render())); return;
    }
    const start = async (kind, mode, btn) => {
      btn.disabled = true;
      try {
        const r = await api('/duels', { method: 'POST', body: { kind, mode } });
        haptic('success');
        push({ render: (v) => renderDuel(v, r.id, r.link) });
      } catch (err) { duelError(err); btn.disabled = false; }
    };
    const kinds = DUEL_KINDS.map(([k, icon]) => {
      const rnd = el('button', { class: 'btn', text: t('du_random') });
      const inv = el('button', { class: 'btn ghost', text: t('du_invite') });
      rnd.addEventListener('click', () => start(k, 'random', rnd));
      inv.addEventListener('click', () => start(k, 'invite', inv));
      return el('div', { class: 'card' },
        el('h3', { style: 'margin:0 0 4px', text: `${icon} ${duelKindName(k)}` }),
        el('p', { class: 'small muted', style: 'margin:0 0 10px', text: t(`du_desc_${k}`, { n: d.rules.rounds, s: d.rules.seconds[k] }) }),
        el('div', { class: 'grid2' }, rnd, inv));
    });
    const st = d.stats;
    box.replaceChildren(
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', { class: 'gold', text: st.wins }), el('span', { text: t('du_wins') })),
        el('div', { class: 'stat' }, el('b', { text: st.draws }), el('span', { text: t('du_draws') })),
        el('div', { class: 'stat' }, el('b', { text: st.losses }), el('span', { text: t('du_losses') }))),
      el('p', { class: 'small muted', style: 'margin:8px 2px 10px', text: t('du_rules', { win: d.rules.win, draw: d.rules.draw, limit: d.rules.limit, today: Math.min(st.today, d.rules.limit) }) }),
      ...kinds,
      el('h3', { style: 'margin:16px 2px 8px', text: t('du_my') }),
      d.duels.length ? el('div', { class: 'list' }, d.duels.map((x) => el('button', { class: 'item', type: 'button', onclick: () => push({ render: (v) => renderDuel(v, x.id) }) },
        el('span', { style: 'font-size:22px', text: x.kind === 'quiz' ? '🧠' : '🕵️' }),
        el('span', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block', text: x.opponent ? x.opponent.name : t(x.mode === 'invite' ? 'du_no_friend' : 'du_searching') }),
          el('span', { class: 'small muted', text: `${duelKindName(x.kind)} · ${ddmm(x.createdAt)} ${hhmm(x.createdAt)}` })),
        duelStateBadge(x))))
        : el('div', { class: 'card center muted', text: t('du_none') }));
  }

  function shareDuelLink(link, kind) {
    const text = t('du_share_text', { kind: duelKindName(kind) });
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); return; } } catch (e) { /* */ }
    window.open(url, '_blank');
  }

  async function renderDuel(view, id, link) {
    view.append(backBar(t('du_title')));
    const box = el('div', null, skeleton(3));
    view.append(box);
    let d;
    try { d = await api(`/duels/${id}`, { fresh: true }); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const inviteLink = link || d.link;
    const head = el('div', { class: 'card' },
      el('div', { class: 'small muted', text: `${d.kind === 'quiz' ? '🧠' : '🕵️'} ${duelKindName(d.kind)}` }),
      el('div', { class: 'du-vs' }, el('b', { class: 'ellipsis', text: t('du_you') }), el('span', { class: 'muted', text: 'VS' }),
        el('b', { class: 'ellipsis', text: d.opponent ? d.opponent.name : '?' })),
      el('div', { class: 'du-vs small muted' }, el('span', { text: `${d.me.answered}/${d.rounds}` }), el('span'), el('span', { text: d.opponent ? `${d.opponent.answered}/${d.rounds}` : '—' })));
    const parts = [head];
    if (d.state === 'finished' && d.result) {
      const r = d.result;
      parts.push(el('div', { class: `card center du-final ${r.result}` },
        el('div', { style: 'font-size:46px', text: r.result === 'win' ? '🏆' : r.result === 'draw' ? '🤝' : '💪' }),
        el('h2', { style: 'margin:6px 0', text: `${t(`du_res_${r.result}`)} ${r.my}:${r.their}` }),
        el('div', { class: r.points ? 'gold' : 'muted', text: r.points ? `+${r.points} points` : t(r.result === 'loss' ? 'du_next_time' : 'du_no_points') })));
    } else if (d.state === 'expired') {
      parts.push(el('div', { class: 'card center muted', text: t('du_expired') }));
    } else if (d.state === 'your_turn') {
      const play = el('button', { class: 'btn block', text: d.me.answered ? t('du_continue', { n: d.me.answered + 1, total: d.rounds }) : t('du_start') });
      const playBox = el('div');
      play.addEventListener('click', () => { play.remove(); duelRound(playBox, d); });
      parts.push(el('div', { class: 'card' }, el('p', { class: 'small muted', style: 'margin-top:0', text: t(`du_desc_${d.kind}`, { n: d.rounds, s: d.seconds }) }), play), playBox);
    } else {
      parts.push(el('div', { class: 'card center' },
        el('div', { style: 'font-size:36px', text: '⏳' }),
        el('p', { style: 'margin:6px 0 0', text: t(d.state === 'waiting_opponent' ? (d.mode === 'invite' ? 'du_wait_friend' : 'du_wait_random') : 'du_wait_turn', { score: d.me.score, n: d.rounds }) }),
        el('p', { class: 'small muted', text: t('du_until', { date: `${ddmm(d.expiresAt)} ${hhmm(d.expiresAt)}` }) })));
    }
    if (inviteLink && !d.opponent) {
      parts.push(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: t('du_invite_title') }), el('p', { class: 'small muted', text: t('du_invite_hint') }),
        el('div', { class: 'du-link', text: inviteLink }),
        el('button', { class: 'btn block', style: 'margin-top:10px', text: t('du_send_link'), onclick: () => shareDuelLink(inviteLink, d.kind) })));
    }
    box.replaceChildren(...parts);
  }

  /** Bitta raund: taymer, savol yoki futbolchi ma'lumoti, 4 variant */
  async function duelRound(box, d) {
    let r;
    try { r = await api(`/duels/${d.id}/next`, { method: 'POST' }); } catch (err) { duelError(err); return; }
    if (r.done) { render(); return; }
    const card = el('div', { class: 'card' });
    const timerBar = el('div', { class: 'timer' }, el('div', { style: 'width:100%' }));
    const timeText = el('div', { class: 'small muted', style: 'margin-top:6px;text-align:right' });
    const title = el('div', { class: 'small muted', text: t('du_round', { n: r.round + 1, total: r.total }) });
    let body;
    if (r.clues) {
      const c = r.clues;
      body = el('div', { class: 'du-clues' },
        el('div', { class: 'kv' }, el('span', { text: t('du_c_country') }), el('b', { text: c.country })),
        el('div', { class: 'kv' }, el('span', { text: t('du_c_position') }), el('b', { text: c.position })),
        el('div', { class: 'kv' }, el('span', { text: t('du_c_born') }), el('b', { text: c.born })),
        el('div', { class: 'kv' }, el('span', { text: t('du_c_clubs') }), el('b', { style: 'text-align:right', text: c.clubs.join(' → ') })));
    } else body = el('div', { class: 'q-text', text: r.question });
    const letters = ['A', 'B', 'C', 'D'];
    const options = r.options.map((o, i) => el('button', { class: 'opt', 'data-k': o.key }, el('span', { class: 'l', text: letters[i] }), el('span', { text: o.text })));
    const resultLine = el('div', { style: 'margin-top:12px;font-weight:700;text-align:center' });
    const nextBtn = el('button', { class: 'btn block', style: 'margin-top:12px', hidden: true, text: r.round + 1 >= r.total ? t('du_finish') : t('du_next') });
    card.append(title, timerBar, timeText, body, el('div', { style: 'margin-top:12px' }, options), resultLine, nextBtn);
    box.replaceChildren(card);
    const deadline = Date.now() + r.secondsLeft * 1000;
    let done = false;
    const finish = (res) => {
      done = true;
      timerBar.remove(); timeText.remove();
      options.forEach((o) => {
        o.disabled = true;
        if (res && o.dataset.k === res.correctKey) o.classList.add('correct');
      });
      nextBtn.hidden = false;
    };
    nextBtn.addEventListener('click', () => { if (r.round + 1 >= r.total) render(); else duelRound(box, d); });
    const raf = () => {
      if (done) return;
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      timerBar.firstChild.style.width = `${(left / r.seconds) * 100}%`;
      timeText.textContent = `${left.toFixed(1)} s`;
      if (left <= 0) { finish(null); resultLine.textContent = t('quiz_timeout'); haptic('error'); return; }
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    cleanups.push(() => { done = true; });
    options.forEach((o) => o.addEventListener('click', async () => {
      if (done) return;
      done = true;
      options.forEach((x) => { x.disabled = true; });
      try {
        const res = await api(`/duels/${d.id}/answer`, { method: 'POST', body: { round: r.round, key: o.dataset.k } });
        if (!res.correct) o.classList.add('wrong');
        haptic(res.correct ? 'success' : 'error');
        SFX.play(res.correct ? 'goal' : 'save');
        resultLine.textContent = res.correct ? t('du_correct', { s: (res.timeMs / 1000).toFixed(1) }) : t('du_wrong');
        if (res.correct) resultLine.className = 'gold';
        if (res.duel && res.duel.result) {
          const dr = res.duel.result;
          setTimeout(() => resultSheet({ result: dr.result, score: dr.my !== undefined ? `${dr.my}:${dr.their}` : null, points: dr.points, again: null }), 900);
        }
        resultLine.style.cssText = 'margin-top:12px;font-weight:800;text-align:center';
        finish(res);
      } catch (err) { duelError(err); finish(null); }
    }));
  }

  /** Do'st havolasi orqali kelgan duel taklifi */
  async function renderDuelInvite(view, code) {
    view.append(backBar(t('du_title')));
    const box = el('div', null, skeleton(2));
    view.append(box);
    let p;
    try { p = await api(`/duels/invite/${encodeURIComponent(code)}`); } catch (err) { box.replaceChildren(el('div', { class: 'card center muted', text: t('du_err_not_found') })); return; }
    if (p.mine) { currentStack().pop(); push({ render: (v) => renderDuel(v, p.id) }); return; }
    if (!p.available) { box.replaceChildren(el('div', { class: 'card center muted', text: t('du_err_not_available') })); return; }
    const accept = el('button', { class: 'btn block', text: t('du_accept') });
    accept.addEventListener('click', async () => {
      if (!S.me.premium) { premiumModal(); return; }
      accept.disabled = true;
      try {
        const d = await api(`/duels/invite/${encodeURIComponent(code)}/join`, { method: 'POST' });
        haptic('success');
        currentStack().pop();
        push({ render: (v) => renderDuel(v, d.id) });
      } catch (err) { duelError(err); accept.disabled = false; }
    });
    box.replaceChildren(el('div', { class: 'card center' },
      el('div', { style: 'font-size:46px', text: '⚔️' }),
      el('h3', { text: t('du_invited', { name: p.from, kind: duelKindName(p.kind) }) }),
      el('p', { class: 'small muted', text: t(`du_desc_${p.kind}`, { n: 5, s: p.kind === 'quiz' ? 15 : 20 }) }),
      accept));
  }

  // ================= 🎯 HISOBNI TOP — admin belgilagan o'yinlarning aniq hisobini taxmin qilish (faqat Premium)
  async function renderScorePredict(view) {
    if (!S.me.premium) { lockedSection(view, '🎯'); return; }
    const list = el('div', null, skeleton(3));
    view.append(list, leaderboardBlock('score'));
    let d;
    try { d = await api('/score/games'); } catch (err) {
      if (err.status === 402) { S.me.premium = false; list.replaceChildren(); premiumModal(); return; }
      list.replaceChildren(errorBox(err, () => render())); return;
    }
    list.replaceChildren(el('div', { class: 'card small muted', text: t('sp_rules', { exact: d.rules.exact, outcome: d.rules.outcome }) }));
    if (!d.games.length) { list.append(el('div', { class: 'card center muted', text: t('sp_no_games') })); return; }
    for (const g of d.games) list.append(scoreCard(g));
  }

  function scoreCard(g) {
    const card = el('div', { class: 'card sp-card' });
    const val = { home: g.prediction ? g.prediction.home : 0, away: g.prediction ? g.prediction.away : 0 };
    const draw = () => {
      const p = g.prediction;
      const dirty = !p || p.home !== val.home || p.away !== val.away;
      const stepper = (side) => {
        if (g.locked) return el('b', { class: 'sp-num', text: p ? String(p[side]) : '–' });
        const change = (k) => { val[side] = Math.max(0, Math.min(20, val[side] + k)); haptic(); draw(); };
        return el('div', { class: 'sp-step' }, el('button', { class: 'mini', type: 'button', text: '−', onclick: () => change(-1) }),
          el('b', { class: 'sp-num', text: String(val[side]) }), el('button', { class: 'mini', type: 'button', text: '+', onclick: () => change(1) }));
      };
      const line = (side) => el('div', { class: 'team-line sp-line' }, crest(g[side].crest), el('span', { class: 'name grow ellipsis', text: g[side].name }),
        g.result ? el('span', { class: 'sc', text: g.result[side] }) : null, g.result ? null : stepper(side));
      let status;
      if (p && p.points !== null && p.points !== undefined) status = el('span', { class: `badge${p.points > 0 ? ' gold' : ''}`, text: t('mm_points', { points: p.points }) });
      else if (g.locked) status = el('span', { class: 'badge', text: p ? t('mm_locked') : t('sp_missed') });
      else if (p) status = el('span', { class: 'badge live', text: t('mm_predicted') });
      else status = el('span', { class: 'badge gold', text: t('mm_not_predicted') });
      const save = el('button', { class: 'btn block', style: 'margin-top:8px', disabled: !dirty, text: dirty ? t('sp_save') : t('sp_saved') });
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          Object.assign(g, await api(`/score/games/${g.id}`, { method: 'POST', body: val }));
          haptic('success'); toast(t('sp_saved_toast')); draw();
        } catch (err) {
          haptic('error');
          if (err.body && err.body.error === 'locked') { g.locked = true; toast(t('sp_err_locked')); draw(); return; }
          toast(t('error_generic')); save.disabled = false;
        }
      });
      put(card,
        el('div', { class: 'row between small muted', style: 'margin-bottom:6px;gap:8px' }, el('span', { class: 'ellipsis', text: `${g.competition || ''} · ${ddmm(g.kickoffAt)} ${hhmm(g.kickoffAt)}` }), status),
        line('home'), line('away'),
        g.result && p ? el('div', { class: 'small muted', style: 'margin-top:6px', text: t('sp_your', { home: p.home, away: p.away }) }) : null,
        g.locked ? null : save);
    };
    draw();
    return card;
  }

  /** "4-2-3-1" -> qatorlar (hujumdan darvozabongacha) */
  function formationLines(tactic) {
    const nums = String(tactic).split('-').map(Number);
    const lines = nums.map((n, i) => ({ n, group: i === 0 ? 'DEF' : i === nums.length - 1 ? 'FWD' : 'MID' }));
    return [...lines.reverse(), { n: 1, group: 'GK' }];
  }

  async function renderGame(view, id) {
    view.append(backBar());
    const box = el('div', null, skeleton(4));
    view.append(box);
    let g;
    try { g = await api(`/manager/games/${id}`); } catch (err) {
      if (err.status === 402) { S.me.premium = false; box.replaceChildren(); premiumModal(); return; }
      box.replaceChildren(errorBox(err, () => render())); return;
    }
    const p = g.prediction || {};
    const locked = g.locked;
    const form = {
      tacticHome: p.tacticHome || g.tactics[0], tacticAway: p.tacticAway || g.tactics[0],
      lineupHome: (p.lineupHome || []).map(Number), lineupAway: (p.lineupAway || []).map(Number),
      scorerHome: p.scorerHome ?? null, scorerAway: p.scorerAway ?? null, assistHome: p.assistHome ?? null, assistAway: p.assistAway ?? null,
      redHome: p.redHome ?? null, redAway: p.redAway ?? null, yellowHome: p.yellowHome ?? null, yellowAway: p.yellowAway ?? null,
      scoreHome: p.scoreHome ?? '', scoreAway: p.scoreAway ?? '', winner: p.winner || null,
    };

    const header = el('div', { class: 'card' },
      el('div', { class: 'small muted', style: 'margin-bottom:8px', text: `${g.competition || ''} · ${ddmmyyyy(g.kickoffAt)} ${hhmm(g.kickoffAt)}` }),
      el('div', { class: 'scoreboard' },
        el('div', null, crest(g.home.crest), el('div', { style: 'font-weight:700', text: g.home.name })),
        el('div', { class: 'big', text: g.result ? `${g.result.home}:${g.result.away}` : 'vs' }),
        el('div', null, crest(g.away.crest), el('div', { style: 'font-weight:700', text: g.away.name }))),
      el('div', { class: 'small muted center', style: 'padding:10px 0 0', text: t('mm_lock_note') }));
    box.replaceChildren(header);

    if (p.points !== null && p.points !== undefined) {
      const b = p.breakdown || {};
      box.append(el('div', { class: 'card' }, el('div', { class: 'row between' }, el('b', { text: t('mm_breakdown') }), el('span', { class: 'badge gold', text: t('mm_points', { points: p.points }) })),
        Object.entries(b).filter(([, v]) => v > 0).map(([k, v]) => el('div', { class: 'kv small' }, el('span', { text: k.replace(/_/g, ' ') }), el('b', { class: 'gold', text: `+${v}` })))));
    }

    if (g.squadError || !g.squads.home.length || !g.squads.away.length) { box.append(el('div', { class: 'card center muted', text: t('err_squad') })); return; }

    const playerName = (side, pid) => { const pl = g.squads[side].find((x) => x.id === pid); return pl ? pl.name : ''; };

    function teamSection(side) {
      const cap = side === 'home' ? 'Home' : 'Away';
      const squad = g.squads[side];
      const sec = el('div', { class: 'card' });
      const draw = () => {
        const lineupKey = `lineup${cap}`;
        const chosen = form[lineupKey];
        const tacticSel = el('select', { class: 'input', disabled: locked }, g.tactics.map((x) => el('option', { value: x, text: x, selected: x === form[`tactic${cap}`] })));
        tacticSel.addEventListener('change', () => { form[`tactic${cap}`] = tacticSel.value; draw(); });
        const pitch = el('div', { class: 'pitch' });
        let slotIndex = 0;
        for (const line of formationLines(form[`tactic${cap}`])) {
          const lineEl = el('div', { class: 'line' });
          for (let k = 0; k < line.n; k += 1) {
            const idx = slotIndex;
            slotIndex += 1;
            const val = chosen[idx] || '';
            const sel = el('select', { class: val ? 'filled' : '', disabled: locked });
            sel.append(el('option', { value: '', text: t('mm_pick_player') }));
            const sorted = [...squad].sort((a, b) => (a.group === line.group ? 0 : 1) - (b.group === line.group ? 0 : 1) || a.name.localeCompare(b.name));
            for (const pl of sorted) {
              const taken = chosen.includes(pl.id) && chosen[idx] !== pl.id;
              sel.append(el('option', { value: pl.id, text: `${pl.name} · ${t(`pos_${pl.group}`)}`, selected: pl.id === val, disabled: taken }));
            }
            sel.addEventListener('change', () => {
              const arr = [...form[lineupKey]];
              arr[idx] = sel.value ? Number(sel.value) : null;
              form[lineupKey] = arr;
              draw();
            });
            lineEl.append(el('div', { class: 'slot' }, el('span', { class: 'pos', text: val ? playerName(side, val).split(' ').slice(-1)[0] : t(`pos_${line.group}`) }), sel));
          }
          pitch.append(lineEl);
        }
        const count = chosen.filter(Boolean).length;
        const evSelect = (key, label) => {
          const s = el('select', { class: 'input', disabled: locked },
            el('option', { value: '', text: t('mm_no_pick'), selected: form[key] === null }),
            el('option', { value: '0', text: t('mm_none'), selected: form[key] === 0 }),
            [...squad].sort((a, b) => a.name.localeCompare(b.name)).map((pl) => el('option', { value: pl.id, text: pl.name, selected: form[key] === pl.id })));
          s.addEventListener('change', () => { form[key] = s.value === '' ? null : Number(s.value); });
          return el('div', null, el('label', { class: 'field-label', text: label }), s);
        };
        sec.replaceChildren(
          el('div', { class: 'row', style: 'margin-bottom:8px' }, crest(g[side].crest), el('b', { class: 'grow ellipsis', text: g[side].name })),
          el('label', { class: 'field-label', text: t('mm_tactic') }), tacticSel,
          el('div', { class: 'row between' }, el('label', { class: 'field-label', text: t('mm_lineup') }), el('span', { class: `small ${count === 11 ? 'green' : 'muted'}`, text: t('mm_selected', { n: count }) })),
          pitch,
          el('h3', { text: t('mm_events') }),
          el('div', { class: 'grid2' }, evSelect(`scorer${cap}`, t('mm_scorer')), evSelect(`assist${cap}`, t('mm_assist')), evSelect(`red${cap}`, t('mm_red')), evSelect(`yellow${cap}`, t('mm_yellow'))),
        );
      };
      draw();
      return sec;
    }

    const scoreIn = (key) => {
      const i = el('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '0', max: '30', value: form[key], disabled: locked });
      i.addEventListener('input', () => {
        form[key] = i.value === '' ? '' : Number(i.value);
        if (form.scoreHome !== '' && form.scoreAway !== '') {
          form.winner = form.scoreHome > form.scoreAway ? 'HOME' : form.scoreHome < form.scoreAway ? 'AWAY' : 'DRAW';
          drawWinner();
        }
      });
      return i;
    };
    const winnerBox = el('div', { class: 'choice' });
    function drawWinner() {
      winnerBox.replaceChildren(...[['HOME', g.home.name], ['DRAW', t('winner_draw')], ['AWAY', g.away.name]].map(([v, label]) => el('button', {
        class: form.winner === v ? 'on' : '', text: label, disabled: locked, onclick: () => { form.winner = v; haptic(); drawWinner(); },
      })));
    }
    drawWinner();

    const outcome = el('div', { class: 'card' },
      el('label', { class: 'field-label', text: t('mm_score') }),
      el('div', { class: 'score-in' }, scoreIn('scoreHome'), el('b', { text: ':' }), scoreIn('scoreAway')),
      el('label', { class: 'field-label', text: t('mm_winner') }), winnerBox);

    box.append(teamSection('home'), teamSection('away'), outcome);

    if (!locked) {
      const save = el('button', { class: 'btn block sticky-save', text: t('mm_save') });
      save.addEventListener('click', async () => {
        if (form.lineupHome.filter(Boolean).length !== 11 || form.lineupAway.filter(Boolean).length !== 11) { haptic('error'); return toast(t('err_bad_lineup')); }
        if (form.scoreHome === '' || form.scoreAway === '') { haptic('error'); return toast(t('err_bad_score')); }
        save.disabled = true;
        try {
          await api(`/manager/games/${g.id}/prediction`, { method: 'POST', body: { ...form, lineupHome: form.lineupHome.filter(Boolean), lineupAway: form.lineupAway.filter(Boolean) } });
          haptic('success');
          toast(t('mm_saved'));
        } catch (err) {
          haptic('error');
          const code = err.body && err.body.error;
          toast(code && I.DICTS.uz[`err_${code}`] ? t(`err_${code}`) : t('error_generic'));
        }
        save.disabled = false;
        return undefined;
      });
      box.append(save);
    }
  }

  // ================= 🧠 FOOTBALL QUIZ (faqat Premium)
  async function renderQuiz(view) {
    if (!S.me.premium) {
      lockedSection(view, '🧠');
      view.append(el('div', { class: 'locked', style: 'margin-top:10px;pointer-events:none' },
        el('div', { class: 'card' }, el('div', { class: 'q-text', text: '??? ??? ???' }), ['A', 'B', 'C', 'D'].map((l) => el('div', { class: 'opt' }, el('span', { class: 'l', text: l }), el('span', { text: '— — —' }))))));
      return;
    }
    const box = el('div', { style: 'margin-top:10px' }, skeleton(3));
    const lb = leaderboardBlock('quiz');
    box.onAnswered = () => lb.refresh();
    view.append(box, lb);
    await drawQuiz(box);
  }

  async function drawQuiz(box) {
    let st;
    try { st = await api('/quiz'); } catch (err) {
      if (err.status === 402) { S.me.premium = false; render(); return; }
      box.replaceChildren(errorBox(err, () => drawQuiz(box)));
      return;
    }
    const nextLine = el('div', { class: 'small muted center', style: 'padding-top:10px' });
    if (st.nextAt) {
      const tick = () => {
        const left = new Date(st.nextAt).getTime() - Date.now();
        nextLine.textContent = t('quiz_next', { time: countdown(left) });
        if (left <= 0) { clearInterval(timer); setTimeout(() => drawQuiz(box), 3000); }
      };
      const timer = setInterval(tick, 1000);
      cleanups.push(() => clearInterval(timer));
      tick();
    }
    if (!st.questionId) { box.replaceChildren(el('div', { class: 'card center muted', text: t('quiz_no_question') })); return; }

    if (st.status === 'new') {
      const start = el('button', { class: 'btn block', text: t('quiz_start') });
      start.addEventListener('click', async () => {
        start.disabled = true;
        try {
          const r = await api('/quiz/start', { method: 'POST', body: { questionId: st.questionId } });
          haptic();
          showQuestion(box, r, nextLine);
        } catch (err) { drawQuiz(box); }
      });
      box.replaceChildren(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: t('quiz_new_q') }), el('p', { class: 'muted small', text: t('quiz_rules') }), start, nextLine));
      return;
    }
    showQuestion(box, st, nextLine);
  }

  function showQuestion(box, st, nextLine) {
    const q = st.question;
    const card = el('div', { class: 'card' });
    const timerBar = el('div', { class: 'timer' }, el('div', { style: 'width:100%' }));
    const timeText = el('div', { class: 'small muted', style: 'margin-top:6px;text-align:right' });
    const options = ['A', 'B', 'C', 'D'].map((l) => el('button', { class: 'opt', 'data-l': l }, el('span', { class: 'l', text: l }), el('span', { text: q.options[l] })));
    const resultLine = el('div', { style: 'margin-top:12px;font-weight:700;text-align:center' });
    card.append(el('div', { class: 'q-text', text: q.question }), ...options, resultLine);
    if (st.status === 'in_progress') card.prepend(timerBar, timeText);
    box.replaceChildren(card, nextLine);

    const showResult = (r, live) => {
      timerBar.remove();
      timeText.remove();
      if (live && box.onAnswered) box.onAnswered();
      options.forEach((o) => {
        o.disabled = true;
        if (o.dataset.l === r.correct) o.classList.add('correct');
        else if (o.dataset.l === r.selected) o.classList.add('wrong');
      });
      if (!r.selected) resultLine.textContent = t('quiz_timeout');
      else if (r.points > 0) { resultLine.textContent = t('quiz_correct', { points: r.points }); resultLine.className = 'gold'; resultLine.style.cssText = 'margin-top:12px;font-weight:800;text-align:center'; }
      else resultLine.textContent = t('quiz_wrong');
      if (r.selected && r.time !== null && r.time !== undefined) resultLine.append(el('div', { class: 'small muted', style: 'font-weight:500', text: t('quiz_answer_time', { s: Number(r.time).toFixed(1) }) }));
    };

    if (st.status === 'answered') { showResult(st.result); return; }

    const deadline = Date.now() + st.secondsLeft * 1000;
    const total = 15;
    let done = false;
    const raf = () => {
      if (done) return;
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      timerBar.firstChild.style.width = `${(left / total) * 100}%`;
      timerBar.classList.toggle('fast', left > total - 5);
      timeText.textContent = `${left.toFixed(1)} s`;
      if (left <= 0) {
        done = true;
        setTimeout(async () => { try { const s2 = await api('/quiz'); if (s2.result) showResult(s2.result, true); } catch (e) { /* */ } }, 1200);
        return;
      }
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    cleanups.push(() => { done = true; });

    options.forEach((o) => o.addEventListener('click', async () => {
      if (done) return;
      done = true;
      options.forEach((x) => { x.disabled = true; });
      o.classList.add('wrong');
      try {
        const r = await api('/quiz/answer', { method: 'POST', body: { questionId: q.id, option: o.dataset.l } });
        o.classList.remove('wrong');
        haptic(r.result.points > 0 ? 'success' : 'error');
        showResult(r.result, true);
      } catch (err) { toast(t('error_generic')); }
    }));
  }

  // ================= 👤 PROFIL
  // ================= 🪪 MUXLISLIK KARTASI (faqat Premium, ID karta uslubida)
  // Karta rasmlari serverda chiziladi (old/orqa tomon, Stories) — bu yerda faqat ko'rsatiladi va aylantiriladi.
  /** Bo'sh (null) bo'laklarsiz almashtirish */
  function put(box, ...nodes) { box.replaceChildren(...nodes.flat().filter(Boolean)); }
  const NAME_RE = /^\p{L}[\p{L}\p{M} '’ʻʼ`-]*$/u;
  const yearNow = () => new Date(Date.now() + TZ_OFFSET).getUTCFullYear();
  const validName = (v) => { const s = String(v || '').trim(); return !!s && [...s].length <= 30 && NAME_RE.test(s); };
  const validText = (v) => { const n = [...String(v || '').trim()].length; return n >= 2 && n <= 40; };

  function cardError(err) {
    const code = err && err.body && err.body.error;
    if (code === 'no_money') {
      modal(t('fc_no_money'), null, [
        el('button', { class: 'btn block', text: t('fc_topup'), onclick: () => { closeModal(); openBot(); } }),
        el('button', { class: 'btn ghost block', text: t('close_btn'), onclick: closeModal })]);
      return;
    }
    if (code === 'premium_required') { premiumModal(); return; }
    haptic('error');
    if (err && err.status === 503) { toast(t('football_unavailable')); return; }
    toast(I.DICTS.uz[`fc_err_${code}`] ? t(`fc_err_${code}`) : t('error_generic'));
  }

  /** Rasm tanlash: markazdan 3:4 qirqiladi, 600×800 JPEG qilib kichraytiriladi (serverga ~100 KB ketadi) */
  function pickPhoto(onPicked) {
    const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const W = 600; const H = 800;
        const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const sw = W / k; const sh = H / k;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
        URL.revokeObjectURL(url);
        onPicked(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast(t('fc_err_bad_photo')); };
      img.src = url;
    });
    document.body.append(input);
    input.click();
  }

  /** Matn maydoni + mos takliflar ro'yxati (ro'yxatdan tanlash yoki o'zi yozish) */
  function suggestInput({ placeholder, value, items, onChange }) {
    const input = el('input', { class: 'input', placeholder, value: value || '', maxlength: '40', autocomplete: 'off' });
    const list = el('div', { class: 'list', style: 'margin-top:6px' });
    const draw = () => {
      const q = norm(input.value.trim());
      const all = items();
      const found = (q ? all.filter((x) => norm(x).includes(q)) : all).slice(0, 8);
      list.replaceChildren(...found.map((name) => el('button', { class: `item${name === input.value.trim() ? ' on' : ''}`, type: 'button', onclick: () => { input.value = name; haptic(); onChange(name); draw(); } }, el('span', { class: 'grow ellipsis', text: name }))));
    };
    input.addEventListener('input', () => { onChange(input.value.trim()); draw(); });
    draw();
    return { box: el('div', null, input, list), redraw: draw };
  }

  /** Klub qidirish (API-Football) */
  function clubSearch(onPick) {
    const input = el('input', { class: 'input', placeholder: t('fc_club_search'), autocomplete: 'off' });
    const results = el('div', { class: 'list', style: 'margin-top:6px' });
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { results.replaceChildren(); return; }
      timer = setTimeout(async () => {
        try {
          const r = await api(`/search/teams?q=${encodeURIComponent(q)}`);
          results.replaceChildren(...r.teams.slice(0, 8).map((tm) => el('button', { class: 'item', type: 'button', onclick: () => { haptic(); onPick(tm); } },
            tm.logo ? crest(tm.logo) : el('span', { class: 'crest-ph' }),
            el('span', { class: 'grow ellipsis' }, tm.name, tm.country ? el('span', { class: 'muted small', text: ` · ${tm.country}` }) : null))));
        } catch (err) { results.replaceChildren(errorBox(err)); }
      }, 600);
    });
    return el('div', null, input, results);
  }

  const squadCache = new Map();
  function loadSquad(teamId, after) {
    if (!teamId || squadCache.has(teamId)) { after(); return; }
    api(`/teams/${teamId}/squad`).then((r) => { squadCache.set(teamId, r.players || []); after(); }).catch(() => { squadCache.set(teamId, []); after(); });
  }

  /** Karta: ikki tomon, bosilsa aylanadi */
  function flipCard(images) {
    const box = el('button', { class: 'idc-flip', type: 'button', 'aria-label': t('fc_flip_hint') },
      el('div', { class: 'idc-inner' },
        el('img', { class: 'idc-face', src: images.front, alt: '' }),
        el('img', { class: 'idc-face idc-back', src: images.back, alt: '' })));
    box.addEventListener('click', () => { haptic(); box.classList.toggle('flipped'); });
    return box;
  }

  async function fanCardSection(container) {
    put(container, el('div', { class: 'skeleton', style: 'height:220px' }));
    let d;
    try { d = await api('/fan-card', { fresh: true }); } catch (err) { put(container, errorBox(err, () => fanCardSection(container))); return; }
    const heading = el('div', { class: 'fc-heading' }, el('span', { text: t('fc_kicker') }), el('b', { text: t('fc_headline') }));
    const refresh = () => fanCardSection(container);

    if (!d.premium) {
      put(container, heading,
        el('button', { class: 'idc-locked', type: 'button', onclick: () => premiumModal(t('fc_buy_premium_text')) },
          el('img', { src: d.sampleUrl, alt: '' }), el('span', { class: 'idc-lock', text: '🔒' })),
        el('p', { class: 'small muted', style: 'margin:10px 2px', text: t('fc_locked_text') }),
        d.activated ? el('p', { class: 'small', style: 'margin:0 2px 10px', text: t('fc_locked_saved') }) : null,
        el('button', { class: 'btn block gold-btn', text: t('fc_locked_btn'), onclick: () => premiumModal(t('fc_buy_premium_text')) }));
      return;
    }

    if (!d.activated) {
      put(container, heading,
        el('div', { class: 'idc-preview' }, el('img', { src: d.sampleUrl, alt: '' })),
        el('p', { class: 'small muted', style: 'margin:10px 2px', text: t('fc_activate_hint') }),
        el('button', { class: 'btn block', text: t('fc_activate'), onclick: () => activationWarning(d, refresh) }));
      return;
    }

    const c = d.card;
    const share = el('button', { class: 'btn ghost', text: t('fc_share'), onclick: () => {
      const url = d.refLink || (S.botUsername ? `https://t.me/${S.botUsername}` : '');
      const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t('fc_share_text'))}`;
      if (tg && tg.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank', 'noopener');
    } });
    const story = el('button', { class: 'btn', text: t('fc_story'), onclick: () => {
      if (!d.storyUrl || !tg || typeof tg.shareToStory !== 'function') { toast(t('fc_story_unsupported')); return; }
      try { tg.shareToStory(d.storyUrl, { text: `${t('fc_share_text')} ${d.refLink || ''}`.trim().slice(0, 200) }); } catch (e) { toast(t('fc_story_unsupported')); }
    } });
    const save = el('button', { class: 'btn ghost', text: t('fc_save_img'), onclick: () => {
      if (!d.storyUrl || !tg || typeof tg.downloadFile !== 'function') { toast(t('fc_save_unsupported')); return; }
      try { tg.downloadFile({ url: d.storyUrl, file_name: `fan-card-${c.fanNumber}.png` }); } catch (e) { toast(t('fc_save_unsupported')); }
    } });
    const photoWarn = c.hasPhoto ? null : el('div', { class: 'card', style: 'margin:0 0 10px;border-color:var(--gold)' },
      el('p', { style: 'margin-top:0', text: t('fc_photo_removed') }),
      el('button', { class: 'btn block', text: t('fc_photo_upload'), onclick: () => pickPhoto(async (photo) => {
        try { await api('/fan-card/photo', { method: 'POST', body: { photo } }); haptic('success'); toast(t('fc_saved')); refresh(); } catch (err) { cardError(err); }
      }) }));
    put(container, heading, photoWarn,
      flipCard(d.images),
      el('div', { class: 'small muted', style: 'margin:8px 0 10px;text-align:center', text: `↻ ${t('fc_flip_hint')}` }),
      el('div', { class: 'grid2' }, story, share),
      el('div', { class: 'grid2', style: 'margin-top:8px' }, save,
        el('button', { class: 'btn ghost', text: t('fc_edit'), onclick: () => push({ render: (v) => renderFavoritesEdit(v, d) }) })),
      el('button', { class: 'btn ghost block', style: 'margin-top:8px', text: t('fc_change_club'), onclick: () => clubChange(d) }));
  }

  function activationWarning(d, done) {
    haptic('warning');
    modal(t('fc_warn_title'), t('fc_warn_text', { price: money(d.clubChangePrice) }), [
      el('button', { class: 'btn block', text: t('fc_warn_ok'), onclick: () => { closeModal(); push({ render: (v) => renderActivation(v, d, done) }); } }),
      el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
  }

  /** Faollashtirish: savollar birma-bir, hammasi majburiy */
  function renderActivation(view, d, done) {
    const f = { photo: null, lastName: '', firstName: '', birthYear: null, gender: null, team: null, player: '', goat: '', since: null, region: null };
    const regionName = (code) => (d.regions.find((r) => r.code === code) || {}).name || '';
    const years = (from) => Array.from({ length: yearNow() - from + 1 }, (_, i) => yearNow() - i);
    const choice = (items, current, onPick) => el('div', { class: 'list' }, items.map(([value, label]) =>
      el('button', { class: `item${value === current ? ' on' : ''}`, type: 'button', onclick: () => { haptic(); onPick(value); } }, el('span', { class: 'grow', text: label }), value === current ? el('span', { text: '✓' }) : null)));
    const textStep = (key, hint) => ({
      title: t(key === 'lastName' ? 'fc_q_last' : 'fc_q_first'), hint,
      body: (next) => {
        const input = el('input', { class: 'input', value: f[key], maxlength: '30', autocomplete: key === 'lastName' ? 'family-name' : 'given-name' });
        input.addEventListener('input', () => { f[key] = input.value.trim(); next.disabled = !validName(f[key]); });
        setTimeout(() => input.focus(), 50);
        return input;
      },
      valid: () => validName(f[key]),
    });
    const steps = [
      { title: t('fc_q_photo'), hint: t('fc_photo_hint'), valid: () => !!f.photo, body: (next, redraw) => el('div', { style: 'text-align:center' },
        f.photo ? el('img', { class: 'idc-photo', src: f.photo, alt: '' }) : el('div', { class: 'idc-photo ph', text: '👤' }),
        el('button', { class: 'btn ghost', style: 'margin-top:10px', text: f.photo ? t('fc_photo_change') : t('fc_photo_pick'), onclick: () => pickPhoto((p) => { f.photo = p; redraw(); }) })) },
      textStep('lastName', t('fc_name_hint')),
      textStep('firstName', t('fc_name_hint')),
      { title: t('fc_q_birth'), hint: t('fc_birth_hint'), valid: () => !!f.birthYear, body: (next) => {
        const sel = el('select', { class: 'input' }, el('option', { value: '', text: t('fc_choose') }),
          years(yearNow() - 100).filter((y) => y <= yearNow() - 5).map((y) => el('option', { value: y, text: y, selected: f.birthYear === y })));
        sel.addEventListener('change', () => { f.birthYear = Number(sel.value) || null; if (f.since && f.birthYear && f.since < f.birthYear) f.since = null; next.disabled = !f.birthYear; });
        return sel;
      } },
      { title: t('fc_q_gender'), valid: () => !!f.gender, body: (next, redraw) => choice([['male', t('fc_male')], ['female', t('fc_female')]], f.gender, (g) => { f.gender = g; redraw(); }) },
      { title: t('fc_q_club'), valid: () => !!f.team, body: (next, redraw) => el('div', null,
        f.team ? el('div', { class: 'item on', style: 'margin-bottom:8px' }, f.team.logo ? crest(f.team.logo) : el('span', { class: 'crest-ph' }), el('b', { class: 'grow', text: f.team.name }), el('span', { text: '✓' })) : null,
        clubSearch((tm) => { if (!f.team || f.team.id !== tm.id) f.player = ''; f.team = tm; redraw(); })) },
      { title: t('fc_q_player'), valid: () => validText(f.player), body: (next) => {
        const s = suggestInput({ placeholder: t('fc_player_ph'), value: f.player, items: () => squadCache.get(f.team.id) || [], onChange: (v) => { f.player = v; next.disabled = !validText(v); } });
        loadSquad(f.team.id, s.redraw);
        return s.box;
      } },
      { title: t('fc_q_goat'), valid: () => validText(f.goat), body: (next) => suggestInput({ placeholder: t('fc_goat_ph'), value: f.goat, items: () => d.goats, onChange: (v) => { f.goat = v; next.disabled = !validText(v); } }).box },
      { title: t('fc_q_since'), valid: () => !!f.since, body: (next) => {
        const sel = el('select', { class: 'input' }, el('option', { value: '', text: t('fc_choose') }),
          years(f.birthYear).map((y) => el('option', { value: y, text: y, selected: f.since === y })));
        sel.addEventListener('change', () => { f.since = Number(sel.value) || null; next.disabled = !f.since; });
        return sel;
      } },
      { title: t('fc_q_region'), valid: () => !!f.region, body: (next, redraw) => choice(d.regions.map((r) => [r.code, r.name]), f.region, (r) => { f.region = r; redraw(); }) },
      { title: t('fc_q_confirm'), hint: t('fc_confirm_hint'), valid: () => true, final: true, body: () => el('div', { class: 'card' },
        el('div', { style: 'text-align:center' }, el('img', { class: 'idc-photo small', src: f.photo, alt: '' })),
        [[t('fc_l_surname'), f.lastName], [t('fc_l_name'), f.firstName], [t('fc_l_birth'), f.birthYear], [t('fc_l_gender'), t(f.gender === 'male' ? 'fc_male' : 'fc_female')],
          [t('fc_l_club'), f.team && f.team.name], [t('fc_l_player'), f.player], [t('fc_l_goat'), f.goat], [t('fc_l_since'), f.since], [t('fc_l_region'), regionName(f.region)]]
          .map(([k, v]) => el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v })))) },
    ];
    let i = 0;
    const draw = () => {
      const st = steps[i];
      const next = el('button', { class: 'btn', text: st.final ? t('fc_activate_btn') : t('fc_next') });
      next.disabled = !st.valid();
      next.addEventListener('click', async () => {
        if (!st.valid()) return;
        if (!st.final) { i += 1; haptic(); draw(); return; }
        next.disabled = true;
        try {
          await api('/fan-card/activate', { method: 'POST', body: {
            photo: f.photo, lastName: f.lastName, firstName: f.firstName, birthYear: f.birthYear, gender: f.gender,
            teamId: f.team.id, player: f.player, goat: f.goat, since: f.since, region: f.region,
          } });
          haptic("success"); toast(t("fc_activated")); goBack();
        } catch (err) { cardError(err); next.disabled = false; }
      });
      put(view, backBar(t('fc_title')),
        el('div', { class: 'idc-progress' }, el('i', { style: `width:${((i + 1) / steps.length) * 100}%` })),
        el('div', { class: 'small muted', style: 'margin:8px 2px 2px', text: `${i + 1}/${steps.length}` }),
        el('h2', { style: 'margin:4px 2px 4px', text: st.title }),
        st.hint ? el('p', { class: 'small muted', style: 'margin:0 2px 12px', text: st.hint }) : null,
        st.body(next, draw),
        el('div', { class: 'grid2', style: 'margin-top:16px' },
          i ? el('button', { class: 'btn ghost', text: t('fc_prev'), onclick: () => { i -= 1; draw(); } }) : el('span'), next));
    };
    draw();
  }

  /** Faqat GOAT va sevimli futbolchi o'zgaradi */
  function renderFavoritesEdit(view, d) {
    const c = d.card;
    let player = c.player;
    let goat = c.goat;
    const save = el('button', { class: 'btn block', style: 'margin-top:16px', text: t('save') });
    const check = () => { save.disabled = !validText(player) || !validText(goat); };
    const p = suggestInput({ placeholder: t('fc_player_ph'), value: player, items: () => squadCache.get(c.team.id) || [], onChange: (v) => { player = v; check(); } });
    loadSquad(c.team.id, p.redraw);
    const g = suggestInput({ placeholder: t('fc_goat_ph'), value: goat, items: () => d.goats, onChange: (v) => { goat = v; check(); } });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await api('/fan-card', { method: 'PATCH', body: { player, goat } }); haptic('success'); toast(t('fc_saved')); goBack(); } catch (err) { cardError(err); check(); }
    });
    put(view, backBar(t('fc_edit')),
      el('label', { class: 'field-label', text: t('fc_l_player') }), p.box,
      el('label', { class: 'field-label', style: 'margin-top:12px', text: t('fc_l_goat') }), g.box, save);
  }

  /** Klubni almashtirish: narx oldindan aytiladi, tasdiqdan keyin balansdan yechiladi */
  function clubChange(d) {
    haptic('warning');
    modal(t('fc_change_club'), t('fc_club_change_text', { price: money(d.clubChangePrice), balance: money(d.balance) }), [
      el('button', { class: 'btn block', text: t('fc_continue'), onclick: () => {
        closeModal();
        if (d.balance < d.clubChangePrice) { cardError({ body: { error: 'no_money' } }); return; }
        push({ render: (v) => put(v, backBar(t('fc_change_club')), el('h2', { style: 'margin:4px 2px 10px', text: t('fc_q_club') }),
          clubSearch((tm) => {
            if (tm.id === d.card.team.id) { toast(t('fc_err_same_team')); return; }
            modal(t('fc_change_club'), t('fc_club_change_confirm', { club: tm.name, price: money(d.clubChangePrice) }), [
              el('button', { class: 'btn block', text: t('fc_continue'), onclick: async (e) => {
                e.target.disabled = true;
                try { await api('/fan-card/club', { method: 'POST', body: { teamId: tm.id } }); closeModal(); haptic('success'); toast(t('fc_club_change_done')); goBack(); } catch (err) { closeModal(); cardError(err); }
              } }),
              el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
          })) });
      } }),
      el('button', { class: 'btn ghost block', text: t('fc_cancel'), onclick: closeModal })]);
  }

  // ================= 🏅 Yutuqlar va 📤 natija kartasi (Stories)
  // 🏅 Yutuqlar: olinganlari + navbatdagi 3 tasi; qolganlari "Yana N ta" tugmasi ortida
  function achievementsBlock(a) {
    if (!a) return null;
    const item = (x) => el('div', { class: `ach${x.earnedAt ? ' on' : ''}`, title: x.desc },
      el('div', { class: 'ach-ico', text: x.icon }),
      el('b', { class: 'ach-name', text: x.name }),
      el('div', { class: 'ach-desc', text: x.earnedAt ? ddmmyyyy(x.earnedAt) : x.desc }));
    const earned = a.list.filter((x) => x.earnedAt);
    const locked = a.list.filter((x) => !x.earnedAt);
    const SHOW = 3;
    const grid = el('div', { class: 'ach-grid' });
    let open = false;
    const toggle = locked.length > SHOW ? el('button', { class: 'more-btn', type: 'button' }) : null;
    const fill = () => {
      grid.replaceChildren(...earned.map(item), ...(open ? locked : locked.slice(0, SHOW)).map(item));
      if (toggle) toggle.textContent = open ? t('ach_less') : t('ach_more', { n: locked.length - SHOW });
    };
    if (toggle) toggle.addEventListener('click', () => { open = !open; haptic(); fill(); });
    fill();
    return el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('h3', { style: 'margin:0', text: t('ach_title') }), el('span', { class: 'badge gold', text: `${a.earned} / ${a.total}` })),
      el('div', { class: 'ach-bar' }, el('span', { style: `width:${Math.round((a.earned / Math.max(1, a.total)) * 100)}%` })),
      grid, toggle);
  }

  // 📊 O'yinlar statistikasi — bitta ixcham jadval (har o'yin — bir qator: hafta / oy / jami)
  function gameStatsTable(d) {
    const rows = [
      ['🎮', 'Mini Manager', d.manager, (s) => `${t('prof_predictions')}: ${s.predictions}`],
      ['🧠', 'Football Quiz', d.quiz, (s) => `${t('prof_correct')}: ${s.correct} / ${s.answers}`],
      ['⚔️', t('du_title'), d.duel, (s) => `${s.wins} / ${s.draws} / ${s.losses}`],
      ['🎯', t('sp_title'), d.score, (s) => `${t('sp_hits')}: ${s.hits} / ${s.predictions}`],
    ];
    const num = (x, place) => el('div', { class: 'gs-num' }, el('b', { text: x || 0 }), place ? el('span', { text: `#${place}` }) : null);
    return el('div', { class: 'card gstats' },
      el('h3', { style: 'margin:0 0 6px', text: t('prof_stats_title') }),
      el('div', { class: 'gs-row gs-head' }, el('span'), el('span', { text: t('prof_week') }), el('span', { text: t('prof_month') }), el('span', { text: t('prof_total') })),
      rows.map(([icon, name, s, sub]) => (s
        ? el('div', { class: 'gs-row' },
          el('div', { class: 'gs-name' }, el('b', { text: `${icon} ${name}` }), el('span', { text: sub(s) })),
          num(s.week && s.week.points, s.week && s.week.place), num(s.month && s.month.points, s.month && s.month.place), num(s.total, s.overallPlace))
        : el('button', { class: 'gs-row locked', type: 'button', onclick: premiumModal },
          el('div', { class: 'gs-name' }, el('b', { text: `${icon} ${name}` }), el('span', { text: t('prof_quiz_locked') })), el('span', { class: 'gs-lock', text: '🔒' })))));
  }

  function shareBlock() {
    const box = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: t('share_title') }), el('p', { class: 'small muted', text: t('share_hint') }));
    const img = el('img', { class: 'share-prev', alt: '' });
    const story = el('button', { class: 'btn', text: t('fc_story') });
    const save = el('button', { class: 'btn ghost', text: t('share_save') });
    box.append(img, el('div', { class: 'grid2', style: 'margin-top:10px' }, story, save));
    let info = null;
    api('/share', { fresh: true }).then((d) => { info = d; img.src = d.path; }).catch(() => { box.hidden = true; });
    story.addEventListener('click', () => {
      if (!info || !info.url || !tg || typeof tg.shareToStory !== 'function') { toast(t('fc_story_unsupported')); return; }
      try {
        tg.shareToStory(info.url, { text: `${t('share_text')} ${info.refLink || ''}`.trim().slice(0, 200) });
      } catch (e) { toast(t('fc_story_unsupported')); }
    });
    save.addEventListener('click', () => {
      if (!info || !info.url || !tg || typeof tg.downloadFile !== 'function') { toast(t('fc_save_unsupported')); return; }
      try { tg.downloadFile({ url: info.url, file_name: 'footballcenter-results.png' }); } catch (e) { toast(t('fc_save_unsupported')); }
    });
    return box;
  }

  function soundCard() {
    const sw = el('button', { class: `switch${SFX.on() ? ' on' : ''}`, type: 'button', 'aria-label': 'sound' });
    sw.addEventListener('click', () => { const v = !SFX.on(); SFX.set(v); sw.classList.toggle('on', v); if (v) SFX.play('whistle'); haptic(); });
    const hw = el('button', { class: `switch${hapticOn() ? ' on' : ''}`, type: 'button', 'aria-label': 'haptic' });
    hw.addEventListener('click', () => {
      const v = !hapticOn();
      try { localStorage.setItem('fc_haptic', v ? 'on' : 'off'); } catch (e) { /* */ }
      hw.classList.toggle('on', v);
      if (v) haptic('heavy');
    });
    return el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('span', { text: t('prof_sound') }), sw),
      el('div', { class: 'row between', style: 'margin-top:10px' }, el('span', { text: t('prof_haptic') }), hw));
  }

  async function renderProfile(view) {
    const cardBox = el('div', { class: 'prof-card' });
    fanCardSection(cardBox);
    const box = el('div', null, skeleton(4));
    view.append(box);
    let d;
    try { d = await api('/profile'); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const u = d.user;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
    box.replaceChildren(
      el('div', { class: 'card prof-head' },
        levelRing(u.photoUrl, name, d.level && d.level.next ? (d.level.xp - d.level.from) / (d.level.next - d.level.from) : 1),
        el('div', { style: 'font-weight:800;font-size:19px;margin-top:10px', class: 'ellipsis', text: name }),
        el('div', { class: 'small muted', text: [u.username ? `@${u.username}` : null, `ID ${d.telegramId}`].filter(Boolean).join(' · ') }),
        d.level ? el('span', { class: 'badge gold', style: 'margin-top:8px', text: `Lv ${d.level.level} · ${d.level.name}` }) : null,
        d.overall ? el('div', { class: 'stats3', style: 'margin-top:12px;width:100%' },
          el('div', { class: 'stat' }, el('b', { text: d.overall.points }), el('span', { text: 'Points' })),
          el('div', { class: 'stat' }, el('b', { text: d.overall.weekPlace ? `#${d.overall.weekPlace}` : '—' }), el('span', { text: t('prof_week_place') })),
          el('div', { class: 'stat' }, el('b', { text: `🔥 ${d.overall.streak}` }), el('span', { text: t('prof_streak') }))) : null),
      el('button', { class: 'card row fav-row', type: 'button', onclick: () => push({ render: renderFavPicker }) },
        S.me.favoriteTeam ? crest(S.me.favoriteTeam.logo, null, S.me.favoriteTeam.name) : el('span', { class: 'fav-star sm', text: '⭐' }),
        el('span', { class: 'grow' }, el('span', { class: 'small muted', style: 'display:block', text: t('fav_title') }),
          el('b', { class: 'ellipsis', text: S.me.favoriteTeam ? S.me.favoriteTeam.name : t('fav_none') })),
        el('span', { class: 'muted small', text: `${S.me.favoriteTeam ? t('fav_change') : t('fav_choose')} ›` })),
      el('div', { class: 'card' },
        el('div', { class: 'kv' }, el('span', { text: t('prof_balance') }), el('b', { text: `${money(d.balance)} ${t('som')}` })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_tariff') }), el('b', { class: u.premium ? 'gold' : '', text: u.premiumFree ? t('prof_all_free') : u.premium ? t('prof_premium_until', { date: ddmmyyyy(u.premiumExpiresAt) }) : t('prof_free') })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_registered') }), el('b', { text: ddmmyyyy(d.registeredAt) })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_refs') }), el('b', { text: d.referrals }))),
      cardBox,
      gameStatsTable(d),
      achievementsBlock(d.achievements),
      shareBlock(),
      soundCard(),
      ...(u.isAdmin ? [el('button', { class: 'btn ghost block', style: 'margin-top:10px', text: t('admin_panel'), onclick: () => { window.location.href = '/admin/'; } })] : []),
    );
  }

  // ================= Ishga tushirish
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  }

  function guessLang() {
    const l = (navigator.language || 'uz').toLowerCase();
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('en')) return 'en';
    return 'uz';
  }

  function outsideTelegram() {
    I.setLang(guessLang());
    $('view').replaceChildren(el('div', { class: 'card center', style: 'margin-top:40px' },
      el('div', { style: 'font-size:48px', text: '⚽' }),
      el('h3', { text: t('open_in_telegram_title') }),
      el('p', { class: 'muted', text: t('open_in_telegram_text') })));
  }

  async function boot() {
    if (tg) {
      try { tg.ready(); tg.expand(); } catch (e) { /* */ }
      try { if (tg.BackButton) tg.BackButton.onClick(goBack); } catch (e) { /* */ }
    }
    applyTheme();
    try { if (tg) tg.onEvent('themeChanged', applyTheme); } catch (e) { /* */ }
    // Birinchi bosishda ovoz ruxsati (brauzer talabi)
    document.addEventListener('pointerdown', () => SFX.play('none'), { once: true });
    if (!initData) return outsideTelegram();
    try {
      const me = await api('/me');
      S.me = me.user;
      S.features = me.features;
      S.botUsername = me.botUsername;
      S.prizeRotate = me.prizeRotateSeconds || 15;
      I.setLang(S.me.language);
    } catch (err) {
      I.setLang(guessLang());
      $('view').replaceChildren(errorBox(err, () => window.location.reload()));
      return undefined;
    }
    applyStaticI18n();
    $('nav').hidden = false;
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
      if (S.tab === b.dataset.tab) S.stacks[S.tab] = [];
      S.tab = b.dataset.tab;
      haptic();
      render();
    }));
    initBanner();
    // ⚔️ Do'stning duel taklifi: /app/?duel=<kod> (bot tugmasi) yoki startapp=duel_<kod>
    const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    const duelCode = new URLSearchParams(window.location.search).get('duel') || (startParam.startsWith('duel_') ? startParam.slice(5) : '');
    if (duelCode) { S.tab = 'games'; S.stacks.games = [{ render: (v) => renderDuelInvite(v, duelCode) }]; }
    // 💥/⚽ Crossbar / Keepy-uppy taklifi: /app/?ag=<kod> yoki startapp=ag_<kod>
    const agCode = new URLSearchParams(window.location.search).get('ag') || (startParam.startsWith('ag_') ? startParam.slice(3) : '');
    if (agCode) { S.tab = 'games'; S.stacks.games = [{ render: (v) => renderArcadeInvite(v, agCode) }]; }
    // 👥 Do'stlar ligasi taklifi: /app/?lg=<kod> yoki startapp=lg_<kod>
    const lgCode = new URLSearchParams(window.location.search).get('lg') || (startParam.startsWith('lg_') ? startParam.slice(3) : '');
    if (lgCode) { S.tab = 'games'; S.stacks.games = [{ render: (v) => renderLeagueInvite(v, lgCode) }]; }
    render();
    return undefined;
  }

  boot();
})();

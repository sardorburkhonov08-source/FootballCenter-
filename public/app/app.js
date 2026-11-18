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
    stacks: { home: [], games: [], profile: [] },
    lb: { manager: 'weekly', quiz: 'weekly' },
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
  function crest(url, cls) { return url ? el('img', { src: url, class: cls || 'crest', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'crest-ph' }); }
  function haptic(type) { try { if (tg && tg.HapticFeedback) { if (type) tg.HapticFeedback.notificationOccurred(type); else tg.HapticFeedback.selectionChanged(); } } catch (e) { /* */ } }

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
    const slides = banners.map((b) => {
      let media;
      if (b.type === 'video') media = el('video', { src: b.url, muted: true, loop: true, playsinline: true, preload: 'metadata' });
      else if (b.type === 'lottie') {
        media = el('div', { class: 'lottie' });
        loadLottie().then((lottie) => lottie.loadAnimation({ container: media, renderer: 'svg', loop: true, autoplay: true, path: b.url })).catch(() => {});
      } else media = el('img', { src: b.url, alt: '' });
      if (media.tagName === 'VIDEO') media.muted = true;
      return el('div', { class: 'banner-slide', onclick: () => openLink(b.link) }, media);
    });
    const sound = el('button', { class: 'banner-sound', 'aria-label': 'sound', text: '🔇', hidden: true });
    sound.addEventListener('click', (e) => {
      e.stopPropagation();
      muted = !muted;
      sound.textContent = muted ? '🔇' : '🔊';
      box.querySelectorAll('video').forEach((v) => { v.muted = muted; });
    });
    const dots = el('div', { class: 'banner-dots' }, banners.length > 1 ? banners.map(() => el('span')) : []);
    box.replaceChildren(...slides, sound, dots);
    let i = -1;
    let timer = null;
    const show = (n) => {
      i = n % banners.length;
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
  function push(page) { currentStack().push(page); haptic(); render(); }
  function goBack() { if (currentStack().length) { currentStack().pop(); render(); } }

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
    const stack = currentStack();
    const page = stack[stack.length - 1];
    updateBackButton();
    window.scrollTo(0, 0);
    if (page) return page.render(view);
    return ({ home: renderHome, games: renderGames, profile: renderProfile })[S.tab](view);
  }

  // ================= 🏠 HOME
  function renderHome(view) {
    const subs = [['matches', 'home_matches'], ['competitions', 'home_competitions']];
    if (S.features && S.features.news) subs.push(['news', 'home_news']);
    view.append(el('div', { class: 'seg' }, subs.map(([k, label]) => el('button', {
      class: S.homeSub === k ? 'on' : '', text: t(label), onclick: () => { S.homeSub = k; haptic(); render(); },
    }))));
    view.append(el('button', { class: 'search-bar', type: 'button', onclick: () => push({ render: renderSearch }) },
      el('span', { text: '🔍' }), el('span', { class: 'muted', text: t('search_placeholder') })));
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
            tm.logo ? crest(tm.logo) : el('span', { class: 'crest-ph' }),
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
    if (m.state === 'live') return el('span', { class: 'badge live', text: t('status_live') });
    if (m.state === 'finished') return el('span', { class: 'badge', text: `✅ ${t('status_finished')}` });
    if (m.state === 'cancelled') return el('span', { class: 'badge', text: `⛔ ${t('status_cancelled')}` });
    return el('span', { class: 'badge', text: `⏳ ${t('status_scheduled')}` });
  }

  function matchCard(m, { bell, showDate } = {}) {
    const premium = S.me.premium;
    const started = m.state === 'live' || m.state === 'finished';
    const teamLine = (team, sc) => el('div', { class: 'team-line' }, crest(team && team.crest), el('span', { class: 'name', text: team ? team.name : '—' }),
      started ? el('span', { class: 'sc', text: sc === null || sc === undefined ? '-' : sc }) : null);
    let bellBtn = null;
    if (bell && m.state === 'scheduled') {
      bellBtn = el('button', { class: `bell${m.subscribed ? ' on' : ''}${premium ? '' : ' locked'}`, 'aria-label': 'bell', text: m.subscribed ? '🔔' : '🔕' });
      bellBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!premium) return premiumModal();
        try {
          const r = await api(`/matches/${m.id}/subscribe`, { method: 'POST' });
          m.subscribed = r.subscribed;
          bellBtn.textContent = r.subscribed ? '🔔' : '🔕';
          bellBtn.classList.toggle('on', r.subscribed);
          haptic('success');
          toast(r.subscribed ? `${t('bell_on')}\n${t('bell_need_bot')}` : t('bell_off'));
        } catch (err) { toast(t('error_generic')); }
        return undefined;
      });
    }
    const card = el('div', { class: 'match', role: 'button' },
      el('div', { class: 'teams' }, teamLine(m.home, m.score.home), teamLine(m.away, m.score.away)),
      el('div', { class: 'side' },
        m.state === 'scheduled' ? el('span', { class: 'time', text: showDate ? `${ddmm(m.utcDate)} ${hhmm(m.utcDate)}` : hhmm(m.utcDate) }) : statusBadge(m),
        showDate && m.state !== 'scheduled' ? el('span', { class: 'small muted', text: ddmm(m.utcDate) }) : null,
        m.state === 'scheduled' ? statusBadge(m) : null,
        premium ? null : el('span', { class: 'lock-badge', text: '🔒' }),
        bellBtn));
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
      const label = n === -1 ? t('date_yesterday') : n === 0 ? t('date_today') : n === 1 ? t('date_tomorrow') : fmtShortDate(ymd);
      const b = el('button', { class: `date${ymd === S.date ? ' on' : ''}`, onclick: () => { S.date = ymd; haptic(); render(); } },
        el('b', { text: label }), el('span', { text: Math.abs(n) <= 1 ? fmtShortDate(ymd) : fmtWeekday(ymd) }));
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
      if (!data.matches.length) { list.append(el('div', { class: 'card center muted', style: 'margin-top:12px', text: t('no_matches') })); return; }
      // Ligalar bo'yicha guruhlash (server tartibini saqlagan holda)
      const groups = [];
      for (const m of data.matches) {
        const id = m.competition ? m.competition.id : 0;
        let g = groups[groups.length - 1];
        if (!g || g.id !== id) { g = { id, featured: !!m.featured, popular: !!m.popular, competition: m.competition, area: m.area, matches: [] }; groups.push(g); }
        g.matches.push(m);
      }
      const featured = groups.filter((g) => g.featured);
      const popular = groups.filter((g) => g.popular);
      const others = groups.filter((g) => !g.featured && !g.popular);
      // O'yinlar ko'p bo'lsa — boshqa ligalar yig'ilgan holda (bosilganda ochiladi)
      const collapse = data.matches.length > 20;
      const head = (g) => el('span', { class: 'grow ellipsis', text: [g.featured ? null : g.area && g.area.name, g.competition ? g.competition.name : ''].filter(Boolean).join(' · ') });
      if (featured.length) {
        list.append(el('h2', { text: t('featured_matches') }));
        for (const g of featured) {
          list.append(el('div', { class: 'league-head' }, g.competition && g.competition.emblem ? crest(g.competition.emblem) : null, head(g)));
          g.matches.forEach((m) => list.append(matchCard(m, { bell: true })));
        }
      }
      if (popular.length) {
        list.append(el('h2', { text: t('popular_leagues') }));
        for (const g of popular) {
          list.append(el('div', { class: 'league-head' }, g.competition && g.competition.emblem ? crest(g.competition.emblem) : null, head(g)));
          g.matches.forEach((m) => list.append(matchCard(m, { bell: true })));
        }
      }
      if (others.length) {
        if (featured.length || popular.length) list.append(el('h2', { text: t('other_leagues') }));
        for (const g of others) {
          const body = el('div');
          const open = !collapse || S.expanded.has(g.id);
          const fill = () => { body.replaceChildren(...g.matches.map((m) => matchCard(m, { bell: true }))); };
          if (open) fill();
          const chev = el('span', { class: 'chev', text: open ? '▾' : '▸' });
          const header = el('button', { class: 'league-head league-toggle', type: 'button' },
            g.competition && g.competition.emblem ? crest(g.competition.emblem) : null, head(g),
            el('span', { class: 'badge', text: g.matches.length }), collapse ? chev : null);
          if (collapse) {
            header.addEventListener('click', () => {
              haptic();
              if (S.expanded.has(g.id)) { S.expanded.delete(g.id); body.replaceChildren(); chev.textContent = '▸'; } else {
                S.expanded.add(g.id); fill(); chev.textContent = '▾';
                api(`/stats/league/${g.id}`, { method: 'POST', keepCache: true }).catch(() => {}); // qiziqish statistikasi
              }
            });
          }
          list.append(header, body);
        }
      }
    } catch (err) {
      list.replaceChildren(errorBox(err, () => render()));
    }
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
    const started = m.state !== 'scheduled';
    const head = el('div', { class: 'card' },
      el('div', { class: 'row between small muted', style: 'margin-bottom:10px' }, el('span', { class: 'ellipsis', text: m.competition ? m.competition.name : '' }), statusBadge(m)),
      el('div', { class: 'scoreboard' },
        el('div', null, crest(m.home.crest), el('div', { style: 'font-weight:700', text: m.home.name })),
        el('div', null, el('div', { class: 'big', text: started ? `${m.score.home ?? '-'} : ${m.score.away ?? '-'}` : hhmm(m.utcDate) }),
          el('div', { class: 'small muted', text: ddmmyyyy(m.utcDate) }),
          m.halfTime && m.halfTime.home !== null && started ? el('div', { class: 'small muted', text: `(${m.halfTime.home}:${m.halfTime.away})` }) : null),
        el('div', null, crest(m.away.crest), el('div', { style: 'font-weight:700', text: m.away.name }))));
    const keys = ['statistics', 'lineups', 'events'].filter((k) => m.tabs && m.tabs[k]);
    box.replaceChildren(head);
    if (!keys.length) { box.append(el('div', { class: 'card center muted', style: 'margin-top:10px', text: t('no_details') })); return; }
    let cur = keys[0];
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
  function leaderboardBlock(kind) {
    const wrap = el('div');
    const draw = async () => {
      const period = S.lb[kind];
      const seg = el('div', { class: 'seg' }, ['weekly', 'monthly'].map((p) => el('button', {
        class: p === period ? 'on' : '', text: t(p === 'weekly' ? 'lb_weekly' : 'lb_monthly'), onclick: () => { S.lb[kind] = p; haptic(); draw(); },
      })));
      const list = el('div', { class: 'card', style: 'margin-top:8px' }, skeleton(2));
      wrap.replaceChildren(el('h2', { text: t('lb_title') }), seg, list);
      try {
        const d = await api(`/leaderboard/${kind}/${period}`);
        list.replaceChildren();
        list.append(el('div', { class: 'small muted', style: 'margin-bottom:4px', text: `${ddmmyyyy(d.start)} – ${ddmmyyyy(new Date(new Date(d.end).getTime() - 60000).toISOString())}` }));
        if (!d.top.length) list.append(el('div', { class: 'center muted', style: 'padding:16px 0', text: t('lb_empty') }));
        for (const r of d.top) {
          list.append(el('div', { class: `lb-row${r.place === 1 ? ' top1' : ''}${r.me ? ' me' : ''}` },
            el('span', { class: 'pl', text: r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place }),
            el('span', { class: 'grow ellipsis', text: r.name }), el('span', { class: 'pts', text: r.points })));
        }
        if (d.me && !d.top.some((r) => r.me)) list.append(el('div', { class: 'lb-row me' }, el('span', { class: 'grow', text: t('lb_me', { place: d.me.place, points: d.me.points }) })));
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
    { key: 'manager', icon: '🎮', title: () => 'Mini Manager', desc: () => t('games_mm_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar('🎮 Mini Manager')); return renderManager(v); } }) },
    { key: 'quiz', icon: '🧠', title: () => 'Football Quiz', desc: () => t('games_quiz_desc'), premium: true,
      open: () => push({ render: (v) => { v.append(backBar('🧠 Football Quiz')); return renderQuiz(v); } }) },
  ];

  function renderGames(view) {
    view.append(el('h2', { style: 'margin:4px 2px 12px', text: t('games_title') }),
      el('div', { class: 'list' }, GAMES.map((g) => el('button', { class: 'item game-item', type: 'button', onclick: g.open },
        el('span', { class: 'game-ico', text: g.icon }),
        el('span', { class: 'grow' }, el('b', { text: g.title() }), el('div', { class: 'small muted', text: g.desc() })),
        g.premium && !S.me.premium ? el('span', { class: 'badge gold', text: '💎' }) : el('span', { class: 'chev', text: '›' })))),
      el('p', { class: 'small muted', style: 'margin:12px 2px', text: t('games_soon') }));
  }

  async function renderManager(view) {
    if (!S.me.premium) { lockedSection(view, '🎮'); return; }
    if (!S.me.coachName) { view.append(coachPrompt(() => render())); return; }
    view.append(el('div', { class: 'card row between' },
      el('span', null, el('span', { class: 'muted', text: `${t('coach_label')}: ` }), el('b', { text: S.me.coachName })),
      el('button', { class: 'btn ghost', style: 'height:34px;font-size:13px', text: t('coach_change'), onclick: () => modal(t('coach_prompt_title'), null, [coachPrompt(() => { closeModal(); render(); }, S.me.coachName)]) })));
    view.append(el('div', { style: 'margin-top:10px' }, prizeBlock('manager')));
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
    view.append(prizeBlock('quiz'));
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

  async function renderProfile(view) {
    const cardBox = el('div');
    view.append(cardBox);
    fanCardSection(cardBox);
    const box = el('div', { style: 'margin-top:14px' }, skeleton(4));
    view.append(box);
    let d;
    try { d = await api('/profile'); } catch (err) { box.replaceChildren(errorBox(err, () => render())); return; }
    const u = d.user;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
    const place = (x) => el('div', { class: 'small muted', style: 'margin-top:2px', text: x && x.place ? t('place_short', { place: x.place }) : '—' });
    const statBlock = (title, s, extra) => el('div', { class: 'card' },
      el('h3', { style: 'margin-top:0', text: title }),
      el('div', { class: 'stats3' },
        el('div', { class: 'stat' }, el('b', { text: s.week ? s.week.points : 0 }), el('span', { text: t('prof_week') }), place(s.week)),
        el('div', { class: 'stat' }, el('b', { text: s.month ? s.month.points : 0 }), el('span', { text: t('prof_month') }), place(s.month)),
        el('div', { class: 'stat' }, el('b', { text: s.total }), el('span', { text: t('prof_total') }), place(s.overallPlace ? { place: s.overallPlace } : null))),
      el('div', { style: 'margin-top:8px' }, extra));
    box.replaceChildren(
      el('div', { class: 'card row' }, el('div', { class: 'avatar', text: (name || '?').trim().charAt(0).toUpperCase() }),
        el('div', { class: 'grow' }, el('div', { style: 'font-weight:800;font-size:17px', class: 'ellipsis', text: name }),
          el('div', { class: 'small muted', text: [u.username ? `@${u.username}` : null, `ID ${d.telegramId}`].filter(Boolean).join(' · ') }))),
      el('div', { class: 'card' },
        el('div', { class: 'kv' }, el('span', { text: t('prof_balance') }), el('b', { text: `${money(d.balance)} ${t('som')}` })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_tariff') }), el('b', { class: u.premium ? 'gold' : '', text: u.premium ? t('prof_premium_until', { date: ddmmyyyy(u.premiumExpiresAt) }) : t('prof_free') })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_registered') }), el('b', { text: ddmmyyyy(d.registeredAt) })),
        el('div', { class: 'kv' }, el('span', { text: t('prof_refs') }), el('b', { text: d.referrals }))),
      d.manager
        ? statBlock('🎮 Mini Manager', d.manager, el('div', { class: 'kv' }, el('span', { text: t('prof_predictions') }), el('b', { text: d.manager.predictions })))
        : el('button', { class: 'card row between locked', style: 'width:100%;opacity:.55', onclick: premiumModal }, el('b', { text: '🎮 Mini Manager' }), el('span', { class: 'muted', text: t('prof_quiz_locked') })),
      d.quiz
        ? statBlock('🧠 Football Quiz', d.quiz, [el('div', { class: 'kv' }, el('span', { text: t('prof_answers') }), el('b', { text: d.quiz.answers })), el('div', { class: 'kv' }, el('span', { text: t('prof_correct') }), el('b', { text: d.quiz.correct }))])
        : el('button', { class: 'card row between locked', style: 'width:100%;opacity:.55', onclick: premiumModal }, el('b', { text: '🧠 Football Quiz' }), el('span', { class: 'muted', text: t('prof_quiz_locked') })),
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
      try { tg.setHeaderColor('#0c1712'); tg.setBackgroundColor('#0c1712'); } catch (e) { /* eski versiyalar */ }
      try { if (tg.BackButton) tg.BackButton.onClick(goBack); } catch (e) { /* */ }
    }
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
    render();
    return undefined;
  }

  boot();
})();

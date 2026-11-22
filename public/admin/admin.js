/* FootballCenter — Web App admin paneli */
(function () {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = (tg && tg.initData) || '';
  const TZ = 5 * 3600 * 1000;

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  }
  const $ = (id) => document.getElementById(id);
  const fmt = (iso) => { if (!iso) return '—'; const s = new Date(new Date(iso).getTime() + TZ).toISOString(); return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}`; };
  const ymd = (d) => new Date((d || new Date()).getTime() + TZ).toISOString().slice(0, 10);

  function toast(msg) { const b = $('toast'); b.textContent = msg; b.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { b.hidden = true; }, 3000); }

  const ERRORS = {
    bad_media: '⚠️ Fayl turi qo\'llab-quvvatlanmaydi (JPG, PNG, WEBP, GIF, MP4, WEBM, Lottie JSON)',
    bad_link: '⚠️ Havola https:// bilan boshlanishi kerak', file_too_large: '⚠️ Fayl juda katta (maks. 50 MB)',
    football_unavailable: '⚠️ Football API mavjud emas (FOOTBALL_API_KEY ni tekshiring)', match_not_scheduled: '⚠️ Bu o\'yin allaqachon boshlangan',
    bad_prize: '⚠️ Turi, davri va matnini to\'ldiring', bad_question: '⚠️ Barcha maydonlarni to\'ldiring', bad_tactics: '⚠️ Taktika formati: 4-4-2 (jami 10 ta futbolchi)', bad_leagues: '⚠️ Ro\'yxat noto\'g\'ri (ko\'pi bilan 50 ta liga)', bad_popular: '⚠️ Qiymatlar noto\'g\'ri: kun 1–90, liga 0–30, foydalanuvchi ≥ 1',
    already_finished: '⚠️ Tugagan o\'yinni o\'chirib bo\'lmaydi', quiz_api_unavailable: '⚠️ Quiz API mavjud emas', bad_credentials: '❌ Login yoki parol noto\'g\'ri',
    too_many_attempts: '⏳ Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring',
    bad_last_name: '⚠️ Familiya noto\'g\'ri (faqat harflar, 30 tagacha)', bad_first_name: '⚠️ Ism noto\'g\'ri (faqat harflar, 30 tagacha)',
    bad_birth_year: '⚠️ Tug\'ilgan yil noto\'g\'ri (yoshi 5–100)', bad_since: '⚠️ Muxlislik yili tug\'ilgan yildan oldin yoki kelajakda bo\'lmasin',
    bad_goat: '⚠️ GOAT 2–40 belgi bo\'lsin', bad_player: '⚠️ Sevimli futbolchi 2–40 belgi bo\'lsin', bad_gender: '⚠️ Jins noto\'g\'ri', bad_region: '⚠️ Hudud noto\'g\'ri',
    not_active: '⚠️ Karta topilmadi', no_money: '⚠️ Egasining balansida mablag\' yetarli emas', not_pending: '⚠️ So\'rov allaqachon ko\'rib chiqilgan',
    owner_club_changed: '⚠️ Egasi kartadagi klubini almashtirgan — rad eting', owner_already_member: '⚠️ Egasi boshqa community a\'zosi — rad eting', bad_price: '⚠️ Narx — 0 yoki musbat butun son', bad_team_colors: '⚠️ Rang formati: #rrggbb', bad_fan_card_settings: '⚠️ Narx va N — 0 yoki musbat butun son; GOAT ro\'yxati 300 tagacha',
  };

  async function api(path, opts = {}) {
    const headers = initData ? { Authorization: `tma ${initData}` } : {};
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const res = await fetch(`/api/admin${path}`, { method: opts.method || 'GET', headers, body, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) { /* */ }
    if (!res.ok) { const err = new Error((data && data.error) || `HTTP ${res.status}`); err.status = res.status; err.reason = data && data.reason; throw err; }
    return data;
  }
  // Football API rad etish sabablari (src/services/football.js → FootballUnavailable.reason)
  const FOOTBALL_REASONS = {
    plan: 'API-Football tarifingizda bu sana/ma\'lumot yo\'q (bepul tarif sanalarni cheklaydi)',
    limit: 'bugungi so\'rovlar limiti tugagan — ertaga yangilanadi',
    busy: 'daqiqalik so\'rov limiti — 1 daqiqadan keyin qayta urinib ko\'ring',
    token: 'FOOTBALL_API_KEY noto\'g\'ri yoki akkaunt bloklangan',
    not_found: 'ma\'lumot topilmadi',
    unavailable: 'API javob bermadi',
  };
  function fail(e) {
    if (e.message === 'football_unavailable' && FOOTBALL_REASONS[e.reason]) { toast(`⚠️ Football API: ${FOOTBALL_REASONS[e.reason]}`); return; }
    toast(ERRORS[e.message] || `⚠️ Xatolik: ${e.message}`);
  }

  // ---------- 📎 Media tayyorlash: istalgan formatni qabul qilish
  // Brauzer ko'rsata oladigan formatlar o'zgarishsiz yuklanadi; qolgan rasmlar (HEIC, TIFF, BMP, SVG, ICO...) shu yerda
  // canvas orqali WebP/JPEG ga aylantiriladi. O'lcham (width/height) ham shu yerda o'lchanib serverga yuboriladi.
  const MEDIA_ACCEPT = 'image/*,video/*,.heic,.heif,.json,application/json';
  const KEEP_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/apng'];
  const VIDEOS = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg'];
  const EXT_TYPES = { heic: 'image/heic', heif: 'image/heif', mov: 'video/quicktime', m4v: 'video/x-m4v', json: 'application/json', avif: 'image/avif' };
  function loadImage(url) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
  }
  function videoSize(url) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const done = (r) => { clearTimeout(timer); resolve(r); };
      const timer = setTimeout(() => done(null), 8000);
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => done(v.videoWidth && v.videoHeight ? { width: v.videoWidth, height: v.videoHeight } : null);
      v.onerror = () => done(null);
      v.src = url;
    });
  }
  function canvasBlob(canvas, type, q) { return new Promise((resolve) => canvas.toBlob(resolve, type, q)); }
  /** → { file, width, height, converted } yoki Error (o'zbekcha xabar bilan) */
  async function prepareMedia(f) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const type = f.type || EXT_TYPES[ext] || '';
    if (type === 'application/json' || ext === 'json') return { file: new File([f], f.name, { type: 'application/json' }) };
    const url = URL.createObjectURL(f);
    try {
      if (type.startsWith('video/')) {
        if (!VIDEOS.includes(type)) throw new Error('⚠️ Bu video formatini Telegram ko\'rsata olmaydi — MP4 yoki WEBM yuklang');
        const size = await videoSize(url);
        return { file: f, ...(size || {}) };
      }
      let img;
      try { img = await loadImage(url); } catch (e) { throw new Error('⚠️ Bu faylni rasm sifatida o\'qib bo\'lmadi. JPEG, PNG yoki boshqa rasm formatida yuklang'); }
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) { w = 1200; h = 675; }   // o'lchamsiz SVG
      if (KEEP_IMAGES.includes(type)) return { file: f, width: w, height: h };
      const scale = Math.min(1, 2560 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let blob = await canvasBlob(canvas, 'image/webp', 0.9);
      if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', 0.9);
      if (!blob) throw new Error('⚠️ Rasmni aylantirib bo\'lmadi');
      const name = `${f.name.replace(/\.[^.]+$/, '') || 'media'}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      return { file: new File([blob], name, { type: blob.type }), width: canvas.width, height: canvas.height, converted: true };
    } finally { URL.revokeObjectURL(url); }
  }
  function ratioLabel(w, h) {
    if (!w || !h) return '';
    const g = (a, b) => (b ? g(b, a % b) : a);
    const d = g(w, h);
    const r = `${w / d}:${h / d}`;
    return `${w}×${h}${r.length <= 7 ? ` · ${r}` : ''}`;
  }
  /** Fayl tanlanganda o'lcham va aylantirish haqida ma'lumot */
  function mediaInput(info) {
    const input = el('input', { class: 'input', type: 'file', accept: MEDIA_ACCEPT });
    input.addEventListener('change', async () => {
      info.textContent = '';
      input.prepared = null;
      const f = input.files[0];
      if (!f) return;
      info.textContent = '⏳ Tekshirilmoqda...';
      try {
        input.prepared = await prepareMedia(f);
        const p = input.prepared;
        info.textContent = [p.width ? `📐 ${ratioLabel(p.width, p.height)}` : null, p.converted ? `🔄 ${p.file.type.split('/')[1].toUpperCase()} ga aylantirildi` : null].filter(Boolean).join(' · ') || '✅ Tayyor';
      } catch (e) { info.textContent = e.message; }
    });
    return input;
  }
  /** FormData ga tayyorlangan media + o'lcham */
  async function appendMedia(fd, input) {
    const f = input.files[0];
    if (!f) return false;
    const p = input.prepared || await prepareMedia(f);
    fd.append('media', p.file, p.file.name);
    if (p.width && p.height) { fd.append('width', String(p.width)); fd.append('height', String(p.height)); }
    return true;
  }

  function mediaThumb(url, type) {
    if (!url) return el('div', { class: 'thumb' }, '🏆');
    if (type === 'video') { const v = el('video', { src: url, muted: true, playsinline: true }); v.muted = true; return el('div', { class: 'thumb' }, v); }
    if (type === 'lottie') return el('div', { class: 'thumb' }, '✨');
    return el('div', { class: 'thumb' }, el('img', { src: url, alt: '' }));
  }

  // ---------- Bo'limlar
  const SECTIONS = [
    ['banners', '🎬 Bannerlar'], ['featured', '⭐ Asosiy ligalar'], ['games', '🎮 Mini Manager — o\'yinlar'], ['score', '🎯 Hisobni top'], ['prizes', '🏆 Sovrinlar'],
    ['quiz', '🧠 Quiz savollari'], ['tactics', '📐 Taktikalar'], ['fancards', '🪪 Muxlislik kartalari'], ['communities', '👥 Fan community'], ['stats', '📊 Statistika'], ['charts', '📈 Grafiklar'],
  ];
  let current = 'banners';

  function renderTabs() {
    const tabs = $('tabs');
    tabs.hidden = false;
    tabs.replaceChildren(...SECTIONS.map(([k, label]) => el('button', { class: `tab${k === current ? ' on' : ''}`, text: label, onclick: () => { current = k; renderTabs(); show(); } })));
  }

  async function show() {
    const v = $('view');
    v.replaceChildren(el('div', { class: 'skeleton' }));
    try { await ({ banners, featured, games, score, prizes, quiz, tactics, fancards, communities, stats, charts })[current](v); } catch (e) { v.replaceChildren(el('div', { class: 'card center', text: '⚠️ Yuklab bo\'lmadi' })); fail(e); }
  }

  // 👥 Community darajalari: 2—7-darajalar uchun kerakli XP (a'zolar to'plagan jami points)
  function levelsCard(levels) {
    const input = el('input', { class: 'input', value: (levels || []).join(', ') });
    const save = el('button', { class: 'btn', text: '💾 Saqlash' });
    save.addEventListener('click', async () => {
      const list = input.value.split(/[,\s]+/).filter(Boolean).map(Number);
      try { await api('/community-settings', { method: 'PUT', body: { levels: list } }); toast('✅ Saqlandi'); } catch (e) { fail(e); }
    });
    return el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '📈 Darajalar' }),
      el('p', { class: 'small muted', text: '1-daraja — 0 XP. Bu yerda 2, 3, ... 7-darajalar uchun kerakli XP (o\'sib boruvchi, vergul bilan). XP — a\'zolarning community\'da to\'plagan jami points\'i.' }),
      el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'XP chegaralari' }), input), save));
  }

  // 👥 Fan community'lar — so'rovlar (tasdiqlash: pul shu paytda egasining balansidan yechiladi), faollarini yopish, narx
  async function communities(v) {
    const d = await api('/communities');
    const price = el('input', { class: 'input', type: 'number', min: '0', value: d.price });
    const savePrice = el('button', { class: 'btn', text: '💾 Saqlash' });
    savePrice.addEventListener('click', async () => {
      try { await api('/community-settings', { method: 'PUT', body: { price: Number(price.value) } }); toast('✅ Saqlandi'); } catch (e) { fail(e); }
    });
    const STATUS = { pending: '⏳ Kutilmoqda', active: '🟢 Faol', rejected: '❌ Rad etilgan', closed: '🔒 Yopilgan' };
    const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const item = (c) => {
      const actions = [];
      if (c.status === 'pending') {
        actions.push(el('button', { class: 'mini ok', text: '✅ Tasdiqlash', onclick: async () => {
          if (!window.confirm(c.price ? `Tasdiqlansinmi? Egasining balansidan ${money(c.price)} so'm yechiladi (klubda faol community bo'lsa).` : 'Tasdiqlansinmi?')) return;
          try { await api(`/communities/${c.id}/approve`, { method: 'POST' }); toast('✅ Tasdiqlandi'); communities(v).catch(fail); } catch (e) { fail(e); }
        } }));
        actions.push(el('button', { class: 'mini danger', text: '❌ Rad etish', onclick: async () => {
          const reason = window.prompt('Rad etish sababi:');
          if (reason === null) return;
          try { await api(`/communities/${c.id}/reject`, { method: 'POST', body: { reason } }); toast('✅ Rad etildi'); communities(v).catch(fail); } catch (e) { fail(e); }
        } }));
      }
      if (c.status === 'active') {
        actions.push(el('button', { class: 'mini danger', text: '🔒 Yopish', onclick: async () => {
          if (!window.confirm(`«${c.name}» yopilsinmi? Barcha a'zolar chiqariladi.`)) return;
          try { await api(`/communities/${c.id}/close`, { method: 'POST' }); toast('✅ Yopildi'); communities(v).catch(fail); } catch (e) { fail(e); }
        } }));
      }
      return el('div', { class: 'card' },
        el('div', { class: 'row between', style: 'flex-wrap:wrap' },
          el('b', { text: `${c.name} · ${c.team}` }), el('span', { class: 'small', text: STATUS[c.status] || c.status })),
        c.description ? el('p', { class: 'small', style: 'margin:6px 0', text: c.description }) : null,
        el('div', { class: 'small muted', text: [`Egasi: ${c.owner.name}${c.owner.username ? ` (@${c.owner.username})` : ''}`, `ID ${c.owner.telegramId}`,
          `balans ${money(c.owner.balance)} so'm`, `a'zolar ${c.members}`, c.wins ? `🏆 ${c.wins}` : null, `XP ${money(c.xp)}`, c.price ? `narx ${money(c.price)} so'm` : 'bepul',
          `so'rov ${fmt(c.createdAt)}`, c.rejectReason ? `sabab: ${c.rejectReason}` : null].filter(Boolean).join(' · ') }),
        actions.length ? el('div', { class: 'row', style: 'margin-top:8px' }, actions) : null);
    };
    const pending = d.communities.filter((c) => c.status === 'pending');
    const rest = d.communities.filter((c) => c.status !== 'pending');
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '⚙️ Narx' }),
        el('p', { class: 'small muted', text: 'Klubning birinchi fan community\'si bepul. Shu klub uchun keyingilari — shu narxda, admin tasdiqlaganda egasining balansidan yechiladi.' }),
        el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Keyingi community narxi (so\'m)' }), price), savePrice)),
      levelsCard(d.levels),
      el('h2', { text: `⏳ So'rovlar (${pending.length})` }),
      pending.length ? el('div', { class: 'list' }, pending.map(item)) : el('div', { class: 'card center muted', text: '📭 Yangi so\'rov yo\'q' }),
      el('h2', { text: `Barcha community'lar (${rest.length})` }),
      rest.length ? el('div', { class: 'list' }, rest.map(item)) : el('div', { class: 'card center muted', text: '📭 Hali yo\'q' }),
    );
  }

  // 🪪 Muxlislik kartalari — nomaqbul rasmni o'chirish, xato ma'lumotni tuzatish, sozlamalar
  async function fancards(v, query) {
    const q = query || '';
    const [d, st, teams] = await Promise.all([api(`/fan-cards?q=${encodeURIComponent(q)}`), api('/fan-card-settings'), api('/fan-card-teams')]);
    const teamRow = (tm) => {
      const cur = tm.manual || tm.detected || { primary: '#1f8a4c', secondary: null };
      const p1 = el('input', { type: 'color', value: cur.primary, style: 'width:44px;height:34px;padding:0;border:0;background:none' });
      const p2 = el('input', { type: 'color', value: cur.secondary || '#ffffff', style: 'width:44px;height:34px;padding:0;border:0;background:none' });
      return el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        el('div', { class: 'grow', style: 'min-width:160px' }, el('b', { text: tm.name }),
          el('div', { class: 'small muted', text: `${tm.fans} ta muxlis · ${tm.manual ? '✋ qo\'lda belgilangan' : tm.detected ? '🤖 logotipdan aniqlangan' : '⏳ hali aniqlanmagan'}` })),
        el('label', { class: 'small muted' }, 'Asosiy ', p1), el('label', { class: 'small muted' }, 'Ikkinchi ', p2),
        el('button', { class: 'mini ok', text: '💾', title: 'Saqlash', onclick: async () => {
          try { await api(`/fan-card-teams/${tm.teamId}`, { method: 'PUT', body: { primary: p1.value, secondary: p2.value } }); toast('✅ Klub ranglari saqlandi'); fancards(v, q).catch(fail); } catch (e) { fail(e); }
        } }),
        tm.manual ? el('button', { class: 'mini', text: '🤖 Avtomatik', title: 'Logotipdan aniqlangan rangga qaytarish', onclick: async () => {
          try { await api(`/fan-card-teams/${tm.teamId}`, { method: 'DELETE' }); toast('✅ Avtomatik rangga qaytarildi'); fancards(v, q).catch(fail); } catch (e) { fail(e); }
        } }) : null);
    };
    const price = el('input', { class: 'input', type: 'number', min: '0', value: st.price });
    const firstFans = el('input', { class: 'input', type: 'number', min: '0', value: st.firstFans });
    const goats = el('textarea', { class: 'input', rows: '6' });
    goats.value = st.goats.join('\n');
    const saveSt = el('button', { class: 'btn', text: '💾 Saqlash' });
    saveSt.addEventListener('click', async () => {
      try {
        await api('/fan-card-settings', { method: 'PUT', body: { price: Number(price.value), firstFans: Number(firstFans.value), goats: goats.value.split('\n').map((x) => x.trim()).filter(Boolean) } });
        toast('✅ Saqlandi');
      } catch (e) { fail(e); }
    });
    const search = el('input', { class: 'input', placeholder: 'Ism, familiya, @username, Telegram ID yoki klub', value: q });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') fancards(v, search.value.trim()).catch(fail); });
    const GENDERS = { male: 'Erkak', female: 'Ayol' };
    const cardItem = (c) => {
      const inp = (key, value, attrs) => { const i = el('input', { class: 'input', value: value ?? '', ...(attrs || {}) }); i.dataset.key = key; return i; };
      const sel = (key, options, value) => { const s2 = el('select', { class: 'input' }, options.map(([k, label]) => el('option', { value: k, text: label, selected: k === value }))); s2.dataset.key = key; return s2; };
      const fields = [
        ['Familiya', inp('lastName', c.lastName)], ['Ism', inp('firstName', c.firstName)],
        ['Tug\'ilgan yil', inp('birthYear', c.birthYear, { type: 'number' })], ['Jins', sel('gender', Object.entries(GENDERS), c.gender)],
        ['Hudud', sel('region', d.regions.map((r) => [r.code, r.name]), c.region)], ['Muxlislik boshlangan', inp('since', c.since, { type: 'number' })],
        ['GOAT', inp('goat', c.goat)], ['Sevimli futbolchi', inp('player', c.player)],
      ];
      const save = el('button', { class: 'mini ok', text: '💾 Saqlash' });
      save.addEventListener('click', async () => {
        const body = {};
        for (const [, input] of fields) body[input.dataset.key] = ['birthYear', 'since'].includes(input.dataset.key) ? Number(input.value) : input.value;
        try { await api(`/fan-cards/${c.userId}`, { method: 'PATCH', body }); toast('✅ Karta yangilandi'); } catch (e) { fail(e); }
      });
      const removePhoto = c.photoUrl ? el('button', { class: 'mini danger', text: '🗑 Rasmni o\'chirish', onclick: async () => {
        if (!window.confirm('Rasm o\'chirilsinmi? Foydalanuvchiga yangi rasm yuklash haqida xabar boradi.')) return;
        try { await api(`/fan-cards/${c.userId}/photo`, { method: 'DELETE' }); toast('✅ Rasm o\'chirildi'); fancards(v, q).catch(fail); } catch (e) { fail(e); }
      } }) : null;
      return el('div', { class: 'card' },
        el('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:wrap' },
          c.photoUrl ? el('div', { class: 'thumb' }, el('img', { src: c.photoUrl, alt: '' })) : el('div', { class: 'thumb', title: 'Rasm yo\'q — foydalanuvchi yangisini yuklashi kerak' }, '🖼'),
          el('div', { class: 'grow', style: 'min-width:200px' },
            el('b', { text: `${c.team.name} · № ${String(c.fanNumber).padStart(6, '0')}` }),
            el('div', { class: 'small muted', text: [c.username ? `@${c.username}` : null, `ID ${c.telegramId}`, `faollashtirilgan ${fmt(c.activatedAt)}`, c.premium ? '💎 Premium' : 'Premium tugagan'].filter(Boolean).join(' · ') }))),
        el('div', { class: 'form-grid', style: 'margin-top:8px' }, fields.map(([label, input]) => el('div', null, el('label', { class: 'field-label', text: label }), input))),
        el('div', { class: 'row', style: 'margin-top:8px' }, save, removePhoto));
    };
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '⚙️ Sozlamalar' }),
        el('div', { class: 'form-grid' },
          el('div', null, el('label', { class: 'field-label', text: 'Klubni almashtirish narxi (so\'m)' }), price),
          el('div', null, el('label', { class: 'field-label', text: '"Birinchi N muxlis" belgisi — N' }), firstFans),
          el('div', { style: 'grid-column:1/-1' }, el('label', { class: 'field-label', text: 'GOAT takliflari (har qatorda bitta)' }), goats),
          saveSt)),
      el('h2', { text: '🎨 Klub ranglari' }),
      el('p', { class: 'small muted', text: 'Karta klub rangida chiziladi. Rang logotipdan avtomatik aniqlanadi; noto\'g\'ri bo\'lsa, rasmiy rangni shu yerda belgilang. Ro\'yxatda — kartasi bor klublar.' }),
      teams.length ? el('div', { class: 'list' }, teams.map(teamRow)) : el('div', { class: 'card center muted', text: '📭 Hali kartalar yo\'q' }),
      el('div', { class: 'card' }, el('label', { class: 'field-label', text: '🔍 Qidirish (Enter)' }), search),
      el('h2', { text: `Kartalar (${d.cards.length})` }),
      el('p', { class: 'small muted', text: 'Rasmi o\'chirilgan kartalar ro\'yxat boshida. Klub va karta raqamini o\'zgartirib bo\'lmaydi.' }),
      d.cards.length ? el('div', { class: 'list' }, d.cards.map(cardItem)) : el('div', { class: 'card center muted', text: '📭 Kartalar yo\'q' }),
    );
  }

  // 🎬 Bannerlar
  async function banners(v) {
    const list = await api('/banners');
    const info = el('div', { class: 'small muted', style: 'margin-top:4px' });
    const file = mediaInput(info);
    const link = el('input', { class: 'input', placeholder: 'Havola (ixtiyoriy, yashirin)' });
    const dur = el('input', { class: 'input', type: 'number', min: '2', max: '120', value: '8' });
    const add = el('button', { class: 'btn', text: '➕ Yuklash' });
    add.addEventListener('click', async () => {
      if (!file.files[0]) return toast('⚠️ Faylni tanlang');
      const fd = new FormData();
      add.disabled = true;
      try { await appendMedia(fd, file); } catch (e) { toast(e.message); add.disabled = false; return undefined; }
      fd.append('link', link.value); fd.append('duration', dur.value);
      try { await api('/banners', { method: 'POST', body: fd }); toast('✅ Banner qo\'shildi'); show(); } catch (e) { fail(e); add.disabled = false; }
      return undefined;
    });
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ Yangi banner' }),
        el('p', { class: 'small muted', text: 'Istalgan rasm (JPEG, PNG, WEBP, HEIC, GIF ...), video (MP4, WEBM, MOV) yoki Lottie JSON. Banner rasmning o\'z o\'lchamida ko\'rinadi — qirqilmaydi (juda tik bo\'lsa, ekranning 70% idan oshmaydi). Bir nechta faol banner karusel bo\'lib almashadi; video standart holatda ovozsiz.' }),
        el('div', { class: 'form-grid' },
          el('div', null, el('label', { class: 'field-label', text: 'Media' }), file, info),
          el('div', null, el('label', { class: 'field-label', text: 'Havola' }), link),
          el('div', null, el('label', { class: 'field-label', text: 'Ko\'rinish davomiyligi (soniya)' }), dur),
          add)),
      el('h2', { text: `Bannerlar (${list.length})` }),
      list.length ? el('div', { class: 'list' }, list.map((b) => {
        const durIn = el('input', { class: 'input', type: 'number', min: '2', max: '120', value: b.duration_seconds, style: 'width:80px;height:34px' });
        const linkIn = el('input', { class: 'input', value: b.link || '', placeholder: 'Havola yo\'q', style: 'height:34px' });
        return el('div', { class: 'card row', style: 'flex-wrap:wrap' },
          mediaThumb(`/uploads/${b.media_path}`, b.media_type),
          el('div', { class: 'grow', style: 'min-width:180px' }, el('div', { class: 'row' }, linkIn, durIn),
            el('div', { class: 'small muted', style: 'margin-top:4px', text: [b.media_type, ratioLabel(b.width, b.height) || null, b.is_active ? '🟢 faol' : '⚪️ o\'chirilgan'].filter(Boolean).join(' · ') })),
          el('div', { class: 'row' },
            el('button', { class: 'mini ok', text: '💾', title: 'Saqlash', onclick: async () => { try { await api(`/banners/${b.id}`, { method: 'PATCH', body: { link: linkIn.value, duration: Number(durIn.value) } }); toast('✅ Saqlandi'); } catch (e) { fail(e); } } }),
            el('button', { class: 'mini', text: b.is_active ? '⏸ O\'chirish' : '▶️ Yoqish', onclick: async () => { try { await api(`/banners/${b.id}`, { method: 'PATCH', body: { isActive: !b.is_active } }); show(); } catch (e) { fail(e); } } }),
            el('button', { class: 'mini danger', text: '🗑', onclick: async () => { if (!window.confirm('Banner o\'chirilsinmi?')) return; try { await api(`/banners/${b.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } })));
      })) : el('div', { class: 'card center muted', text: '📭 Bannerlar yo\'q' }),
    );
  }

  // ⭐ Asosiy ligalar — Mini App'dagi o'yinlar ro'yxatida eng tepada, shu tartibda chiqadi
  async function featured(v) {
    const d = await api('/featured-leagues');
    let ids = d.ids.map(Number);
    const byId = new Map(d.leagues.map((l) => [l.id, l]));
    const label = (id) => { const l = byId.get(id); return l ? `${l.name} · ${l.area}` : `#${id}`; };
    const listBox = el('div', { class: 'list' });
    const results = el('div', { class: 'list', style: 'margin-top:8px' });
    const search = el('input', { class: 'input', placeholder: 'Liga yoki davlat nomi (masalan: Uzbekistan, Premier)' });
    const title = el('h2');
    const draw = () => {
      title.textContent = `Ro'yxat (${ids.length})`;
      listBox.replaceChildren(...(ids.length ? ids.map((id, i) => el('div', { class: 'card row' },
        el('b', { text: `${i + 1}.` }), byId.get(id) && byId.get(id).emblem ? el('img', { src: byId.get(id).emblem, style: 'width:22px;height:22px;object-fit:contain' }) : null,
        el('span', { class: 'grow ellipsis', text: label(id) }),
        el('button', { class: 'mini', text: '↑', disabled: i === 0, onclick: () => { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; draw(); } }),
        el('button', { class: 'mini', text: '↓', disabled: i === ids.length - 1, onclick: () => { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; draw(); } }),
        el('button', { class: 'mini danger', text: '🗑', onclick: () => { ids = ids.filter((x) => x !== id); draw(); } }),
      )) : [el('div', { class: 'card center muted', text: '📭 Ro\'yxat bo\'sh' })]));
    };
    const doSearch = () => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { results.replaceChildren(); return; }
      const found = d.leagues.filter((l) => !ids.includes(l.id) && `${l.name} ${l.area}`.toLowerCase().includes(q)).slice(0, 30);
      results.replaceChildren(...(found.length ? found.map((l) => el('div', { class: 'card row' },
        l.emblem ? el('img', { src: l.emblem, style: 'width:22px;height:22px;object-fit:contain' }) : null,
        el('span', { class: 'grow ellipsis', text: `${l.name} · ${l.area}` }),
        el('button', { class: 'mini ok', text: '➕ Qo\'shish', onclick: () => { ids.push(l.id); draw(); doSearch(); } }),
      )) : [el('div', { class: 'small muted', text: 'Topilmadi' })]));
    };
    search.addEventListener('input', doSearch);
    const save = el('button', { class: 'btn', text: '💾 Saqlash', onclick: async () => { try { ids = (await api('/featured-leagues', { method: 'PUT', body: ids })).map(Number); draw(); toast('✅ Saqlandi'); } catch (e) { fail(e); } } });
    draw();
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '⭐ Asosiy ligalar' }),
        el('p', { class: 'small muted', text: 'Bu ligalarning o\'yinlari Mini App\'dagi o\'yinlar ro\'yxatida eng tepada, shu tartibda chiqadi. Qolgan ligalar pastda, yig\'ilgan holda ko\'rsatiladi.' }),
        d.error ? el('p', { class: 'small', text: ERRORS.football_unavailable }) : null),
      title, listBox,
      el('div', { style: 'margin-top:10px' }, save),
      el('h2', { text: '➕ Liga qo\'shish' }), search, results,
      popularSection(d, label),
    );
  }

  // 🔥 Avtomatik ommabop ligalar: sozlamalar va statistika
  function popularSection(d, label) {
    const p = d.popular;
    const enabled = el('input', { type: 'checkbox', checked: p.enabled });
    const num = (v, min, max) => el('input', { class: 'input', type: 'number', min: String(min), max: String(max), value: v });
    const days = num(p.days, 1, 90);
    const limit = num(p.limit, 0, 30);
    const minUsers = num(p.minUsers, 1, 100000);
    const save = el('button', { class: 'btn', text: '💾 Saqlash', onclick: async () => {
      try {
        await api('/popular-settings', { method: 'PUT', body: { enabled: enabled.checked, days: Number(days.value), limit: Number(limit.value), minUsers: Number(minUsers.value) } });
        toast('✅ Saqlandi'); show();
      } catch (e) { fail(e); }
    } });
    const auto = new Set(p.ids);
    return el('div', null,
      el('h2', { text: '🔥 Ommabop ligalar (avtomatik)' }),
      el('div', { class: 'card' },
        el('p', { class: 'small muted', text: 'Foydalanuvchilar eng ko\'p qiziqqan ligalar asosiy ligalardan keyin avtomatik chiqadi. Qiziqish: liga guruhini ochish, jadval/musobaqani ko\'rish, o\'yin tafsiloti, 🔔 eslatma. Bir foydalanuvchi bir ligani kuniga bir marta hisoblanadi; kimligi saqlanmaydi.' }),
        el('label', { class: 'row', style: 'margin:8px 0' }, enabled, el('span', { text: 'Avtomatik ommabop ligalar yoqilgan' })),
        el('div', { class: 'form-grid' },
          el('div', null, el('label', { class: 'field-label', text: 'Oxirgi necha kun' }), days),
          el('div', null, el('label', { class: 'field-label', text: 'Ko\'pi bilan nechta liga' }), limit),
          el('div', null, el('label', { class: 'field-label', text: 'Kamida nechta foydalanuvchi' }), minUsers),
          save)),
      el('h3', { text: `Statistika — oxirgi ${p.days} kun` }),
      el('div', { class: 'card' }, p.stats.length ? p.stats.map((r, i) => el('div', { class: 'lb-row' },
        el('span', { class: 'pl', text: i + 1 }),
        el('span', { class: 'grow ellipsis', text: label(r.league_id) }),
        auto.has(r.league_id) ? el('span', { class: 'badge live', text: '🔥 ro\'yxatda' }) : null,
        el('span', { class: 'pts', text: r.users })))
        : el('div', { class: 'muted center', text: '📭 Hali statistika yo\'q' })),
    );
  }

  // 🎮 Mini Manager — o'yin belgilash
  function games(v) {
    return gamesAdmin(v, {
      base: '/manager', hint: 'API\'dagi kelgusi o\'yinlardan birini Mini Manager uchun faol o\'yin qiling. Hafta: seshanba 12:00 — keyingi seshanba 11:59 (Toshkent).',
    });
  }

  // 🎯 Hisobni top — bir nechta o'yin belgilanadi (kuniga 5—10 tasi qulay: natijalar kun bo'yicha bitta API so'rovida olinadi)
  async function score(v) {
    const rules = await api('/score/settings');
    const exact = el('input', { class: 'input', type: 'number', min: '1', value: rules.exact });
    const outcome = el('input', { class: 'input', type: 'number', min: '0', value: rules.outcome });
    const saveRules = el('button', { class: 'btn', text: '💾 Saqlash' });
    saveRules.addEventListener('click', async () => {
      try { await api('/score/settings', { method: 'PUT', body: { exact: Number(exact.value), outcome: Number(outcome.value) } }); toast('✅ Saqlandi'); } catch (e) { fail(e); }
    });
    const settingsCard = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '⭐ Ballar' }),
      el('p', { class: 'small muted', text: 'Yangi qiymat keyin hisoblanadigan o\'yinlarga qo\'llanadi. Ballar umumiy points\'ga qo\'shiladi.' }),
      el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Aniq hisob' }), exact),
        el('div', null, el('label', { class: 'field-label', text: 'Faqat natija (g\'alaba/durang)' }), outcome), saveRules));
    return gamesAdmin(v, {
      base: '/score', multiHint: true, before: settingsCard,
      hint: 'Foydalanuvchilar (faqat Premium) aniq hisobni taxmin qiladi. Bir nechta o\'yin belgilang — kuniga 5—10 tasi qulay.',
    });
  }

  async function gamesAdmin(v, cfg) {
    const assigned = await api(`${cfg.base}/games`);
    const from = el('input', { class: 'input', type: 'date', value: ymd() });
    const to = el('input', { class: 'input', type: 'date', value: ymd(new Date(Date.now() + 7 * 86400000)) });
    const results = el('div', { class: 'list', style: 'margin-top:10px' });
    const search = el('button', { class: 'btn', text: '🔍 API\'dan o\'yinlar' });
    const assignedIds = new Set(assigned.map((g) => Number(g.api_match_id)));
    search.addEventListener('click', async () => {
      results.replaceChildren(el('div', { class: 'skeleton' }));
      try {
        const d = await api(`/manager/matches?from=${from.value}&to=${to.value}`);
        const skippedNote = d.skipped && d.skipped.length ? el('div', { class: 'card small', style: 'border-color:var(--gold)' },
          `⚠️ Bu kunlar olinmadi: ${d.skipped.map((x) => `${x.date.slice(8, 10)}.${x.date.slice(5, 7)} — ${FOOTBALL_REASONS[x.reason] || x.reason}`).join('; ')}`) : null;
        results.replaceChildren(...(skippedNote ? [skippedNote] : []), ...(d.matches.length ? d.matches.map((m) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
          el('div', { class: 'grow', style: 'min-width:200px' }, el('b', { text: `${m.home.fullName} — ${m.away.fullName}` }),
            el('div', { class: 'small muted', text: `${m.competition ? m.competition.name : ''} · ${fmt(m.utcDate)}` })),
          assignedIds.has(m.id) ? el('span', { class: 'badge live', text: '✅ Belgilangan' })
            : el('button', { class: 'mini ok', text: '➕ Belgilash', onclick: async (e) => {
              e.target.disabled = true;
              try {
                await api(`${cfg.base}/games`, { method: 'POST', body: { apiMatchId: m.id } });
                toast('✅ O\'yin belgilandi');
                if (!cfg.multiHint) { show(); return; }
                assignedIds.add(m.id);
                e.target.replaceWith(el('span', { class: 'badge live', text: '✅ Belgilangan' }));
              } catch (err) { fail(err); e.target.disabled = false; }
            } })))
          : [el('div', { class: 'card center muted', text: '📭 Bu oraliqda o\'yinlar topilmadi' })]));
      } catch (e) { results.replaceChildren(); fail(e); }
    });
    const st = { upcoming: '⏳ kutilmoqda', locked: '🔒 boshlangan', finished: '✅ hisoblangan' };
    v.replaceChildren(
      ...(cfg.before ? [cfg.before] : []),
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ O\'yin belgilash' }),
        el('p', { class: 'small muted', text: cfg.hint }),
        el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Dan' }), from), el('div', null, el('label', { class: 'field-label', text: 'Gacha' }), to), search),
        results),
      el('h2', { text: `Belgilangan o'yinlar (${assigned.length})` }),
      assigned.length ? el('div', { class: 'list' }, assigned.map((g) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        el('div', { class: 'grow', style: 'min-width:200px' }, el('b', { text: `${g.home_team_name} — ${g.away_team_name}` }),
          el('div', { class: 'small muted', text: `${g.competition || ''} · ${fmt(g.kickoff_at)} · ${st[g.status]} · 👥 ${g.participants}${g.result ? ` · ${g.result.home}:${g.result.away}` : ''}` })),
        g.status !== 'finished' ? el('button', { class: 'mini danger', text: '🗑', onclick: async () => { if (!window.confirm('O\'yin va unga berilgan taxminlar o\'chirilsinmi?')) return; try { await api(`${cfg.base}/games/${g.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } }) : null)))
        : el('div', { class: 'card center muted', text: '📭 Hali o\'yin belgilanmagan' }),
    );
  }

  // 🏆 Sovrinlar
  async function prizes(v) {
    const list = await api('/prizes');
    const kind = el('select', { class: 'input' }, el('option', { value: 'overall', text: '🏆 Umumiy reyting (hamma o\'yinlar)' }));
    const period = el('select', { class: 'input' }, el('option', { value: 'weekly', text: 'Haftalik' }), el('option', { value: 'monthly', text: 'Oylik' }));
    const text = el('textarea', { class: 'input', placeholder: 'Sovrin matni', maxlength: '1000' });
    const info = el('div', { class: 'small muted', style: 'margin-top:4px' });
    const file = mediaInput(info);
    const add = el('button', { class: 'btn', text: '➕ Qo\'shish' });
    add.addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('kind', kind.value); fd.append('period', period.value); fd.append('text', text.value);
      add.disabled = true;
      try { await appendMedia(fd, file); } catch (e) { toast(e.message); add.disabled = false; return undefined; }
      try { await api('/prizes', { method: 'POST', body: fd }); toast('✅ Sovrin qo\'shildi'); show(); } catch (e) { fail(e); add.disabled = false; }
      return undefined;
    });
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ Yangi sovrin' }),
        el('p', { class: 'small muted', text: 'Faqat TOP 1 sovrin oladi (haftalik va oylik alohida). Bir nechta faol sovrin Web App\'da 15 soniyada almashadi.' }),
        el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Bo\'lim' }), kind), el('div', null, el('label', { class: 'field-label', text: 'Davr' }), period),
          el('div', null, el('label', { class: 'field-label', text: 'Media (ixtiyoriy)' }), file, info)),
        el('label', { class: 'field-label', text: 'Matn' }), text, el('div', { style: 'margin-top:10px' }, add)),
      el('h2', { text: `Sovrinlar (${list.length})` }),
      list.length ? el('div', { class: 'list' }, list.map((p) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        mediaThumb(p.media_path ? `/uploads/${p.media_path}` : null, p.media_type),
        el('div', { class: 'grow', style: 'min-width:180px' }, el('div', { class: 'small muted', text: `${{ overall: '🏆 Umumiy reyting', manager: '🎮 Mini Manager (eski)', quiz: '🧠 Quiz (eski)' }[p.kind]} · ${p.period === 'weekly' ? 'haftalik' : 'oylik'} · ${p.is_active ? '🟢 faol' : '⚪️ o\'chirilgan'}` }),
          el('div', { style: 'white-space:pre-wrap', text: p.text })),
        el('div', { class: 'row' },
          el('button', { class: 'mini', text: p.is_active ? '⏸' : '▶️', onclick: async () => { try { await api(`/prizes/${p.id}`, { method: 'PATCH', body: { isActive: !p.is_active } }); show(); } catch (e) { fail(e); } } }),
          el('button', { class: 'mini danger', text: '🗑', onclick: async () => { if (!window.confirm('Sovrin o\'chirilsinmi?')) return; try { await api(`/prizes/${p.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } })))))
        : el('div', { class: 'card center muted', text: '📭 Sovrinlar yo\'q' }),
    );
  }

  // 🧠 Quiz savollari
  async function quiz(v) {
    const d = await api('/quiz/questions');
    const f = {};
    ['question', 'a', 'b', 'c', 'd'].forEach((k) => { f[k] = el('input', { class: 'input', placeholder: k === 'question' ? 'Savol' : `Variant ${k.toUpperCase()}` }); });
    const correct = el('select', { class: 'input' }, ['A', 'B', 'C', 'D'].map((l) => el('option', { value: l, text: `To'g'ri javob: ${l}` })));
    const add = el('button', { class: 'btn', text: '➕ Qo\'shish' });
    add.addEventListener('click', async () => {
      try {
        await api('/quiz/questions', { method: 'POST', body: { question: f.question.value, a: f.a.value, b: f.b.value, c: f.c.value, d: f.d.value, correct: correct.value } });
        toast('✅ Savol navbatga qo\'shildi'); show();
      } catch (e) { fail(e); }
    });
    const fetchBtn = el('button', { class: 'btn ghost', text: '⬇️ API\'dan savollar olish' });
    fetchBtn.addEventListener('click', async () => { fetchBtn.disabled = true; try { const r = await api('/quiz/fetch', { method: 'POST' }); toast(`✅ ${r.added} ta yangi savol`); show(); } catch (e) { fail(e); fetchBtn.disabled = false; } });
    v.replaceChildren(
      el('div', { class: 'kpis' }, el('div', { class: 'kpi' }, el('b', { text: d.queued }), el('span', { text: 'Navbatdagi savollar' })), el('div', { class: 'kpi' }, el('b', { text: d.total }), el('span', { text: 'Jami savollar' }))),
      el('div', { class: 'card', style: 'margin-top:10px' }, el('h3', { style: 'margin-top:0', text: 'Savollar manbasi' }),
        el('p', { class: 'small muted', text: 'Har soatda navbatdan 1 ta savol e\'lon qilinadi. Navbat bo\'sh qolsa, savollar API\'dan avtomatik olinadi. Qo\'lda qo\'shilgan savollar birinchi chiqadi.' }),
        fetchBtn),
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ Savolni qo\'lda qo\'shish' }), f.question,
        el('div', { class: 'form-grid', style: 'margin-top:8px' }, f.a, f.b, f.c, f.d, correct, add)),
      el('h2', { text: 'Oxirgi savollar' }),
      el('div', { class: 'list' }, d.questions.map((q) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        el('div', { class: 'grow', style: 'min-width:200px' }, el('b', { text: q.question }),
          el('div', { class: 'small muted', text: `A) ${q.option_a} · B) ${q.option_b} · C) ${q.option_c} · D) ${q.option_d} · ✅ ${q.correct_option}` }),
          el('div', { class: 'small muted', text: q.published_at ? `📢 E'lon qilingan: ${fmt(q.published_at)}` : `⏳ Navbatda · ${q.source}` })),
        q.published_at ? null : el('button', { class: 'mini danger', text: '🗑', onclick: async () => { try { await api(`/quiz/questions/${q.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } })))),
    );
  }

  // 📐 Taktikalar
  async function tactics(v) {
    let list = await api('/tactics');
    const input = el('input', { class: 'input', placeholder: 'Masalan: 4-1-2-1-2' });
    const draw = () => {
      tags.replaceChildren(...list.map((x) => el('span', { class: 'tag' }, x, el('button', { text: '×', onclick: () => { list = list.filter((y) => y !== x); draw(); } }))));
    };
    const tags = el('div', { class: 'tag-list' });
    draw();
    const addBtn = el('button', { class: 'btn ghost', text: '➕', onclick: () => { const val = input.value.trim(); if (val && !list.includes(val)) { list.push(val); input.value = ''; draw(); } } });
    const save = el('button', { class: 'btn', text: '💾 Saqlash', onclick: async () => { try { list = await api('/tactics', { method: 'PUT', body: list }); draw(); toast('✅ Saqlandi'); } catch (e) { fail(e); } } });
    v.replaceChildren(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '📐 Mini Manager taktikalari' }),
      el('p', { class: 'small muted', text: 'Foydalanuvchilar har ikki jamoa uchun shu ro\'yxatdan taktika tanlaydi. Format: 4-3-3 (darvozabonsiz jami 10).' }),
      tags, el('div', { class: 'row', style: 'margin-top:10px' }, input, addBtn), el('div', { style: 'margin-top:10px' }, save)));
  }


  // ---------- 📈 SVG grafiklar (kutubxonasiz): chiziq va ustunli (stacked), hover tooltip bilan
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
    return n;
  }
  // Toifaviy ranglar — qat'iy tartib (ko'k ishlatilmaydi; qorong'i fon uchun tekshirilgan)
  const SERIES = ['#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#0ca30c'];
  const niceMax = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
  let tipNode = null;
  function tip(html, x, y) {
    if (!tipNode) { tipNode = el('div', { class: 'chart-tip' }); document.body.append(tipNode); }
    if (html === null) { tipNode.hidden = true; return; }
    tipNode.hidden = false;
    tipNode.replaceChildren(...html);
    const w = tipNode.offsetWidth;
    tipNode.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 12))}px`;
    tipNode.style.top = `${y + 12}px`;
  }
  /**
   * chart({ dates, series: [{ name, color, values }], type: 'line'|'bar', unit, height })
   * bar — ustunlar ustma-ust (stacked). null qiymat — chiziqda uzilish.
   */
  function chart({ dates, series, type = 'line', unit = '', height = 180, compact = false }) {
    // compact — kichik grafik (o'q yozuvlarisiz, faqat hover)
    const W = compact ? 300 : 640; const H = height; const L = compact ? 4 : 34; const R = compact ? 4 : 8; const T = compact ? 6 : 10; const B = compact ? 6 : 22;
    const n = dates.length;
    const totals = dates.map((_, i) => (type === 'bar' ? series.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(0, ...series.map((s) => s.values[i] || 0))));
    const max = niceMax(Math.max(1, ...totals));
    const step = (W - L - R) / n;
    const X = (i) => L + step * i + step / 2;
    const Y = (v) => T + (H - T - B) * (1 - v / max);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
    for (const f of [0, 0.5, 1]) {
      const y = Y(max * f);
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      if (compact) continue;
      const lbl = svgEl('text', { x: L - 6, y: y + 3, class: 'axis', 'text-anchor': 'end' }); lbl.textContent = `${Math.round(max * f)}${unit}`; svg.append(lbl);
    }
    const every = Math.ceil(n / 8);
    dates.forEach((d, i) => {
      if (compact || (i % every && i !== n - 1) || (i !== n - 1 && n - 1 - i < every)) return;
      const lbl = svgEl('text', { x: X(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' }); lbl.textContent = d.slice(5).replace('-', '.'); svg.append(lbl);
    });
    if (type === 'bar') {
      const bw = Math.max(2, step - 2);
      dates.forEach((_, i) => {
        let acc = 0;
        series.forEach((s, k) => {
          const v = s.values[i] || 0;
          if (!v) return;
          const y0 = Y(acc); const y1 = Y(acc + v);
          const top = !series.slice(k + 1).some((o) => o.values[i]);
          svg.append(svgEl('rect', { x: X(i) - bw / 2, y: y1, width: bw, height: Math.max(1, y0 - y1 - (acc ? 2 : 0)), rx: top ? 3 : 0, fill: s.color }));
          acc += v;
        });
      });
    } else {
      for (const s of series) {
        let dpath = ''; let pen = false;
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) { pen = false; return; }
          dpath += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
        });
        svg.append(svgEl('path', { d: dpath, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
    }
    // Hover: vertikal chiziq + tooltip
    const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    svg.append(cross);
    const hit = svgEl('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) * (W / r.width) - L) / step)));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      tip([el('b', { text: dates[i] }), ...series.map((s) => el('div', { class: 'tip-row' }, el('i', { style: `background:${s.color}` }), el('span', { text: s.name }),
        el('b', { text: s.values[i] === null || s.values[i] === undefined ? '—' : `${s.values[i]}${unit}` })))], ev.clientX, ev.clientY);
    };
    hit.addEventListener('mousemove', move);
    hit.addEventListener('touchstart', (ev) => move(ev.touches[0]), { passive: true });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip(null); });
    svg.append(hit);
    const legend = series.length > 1 ? el('div', { class: 'legend' }, series.map((s) => el('span', {}, el('i', { style: `background:${s.color}` }), s.name))) : null;
    return el('div', {}, legend, svg);
  }

  const SOURCE_NAMES = { purchase: '💰 Balansdan', stars: '⭐ Stars', gift: '🎁 Sovg\'a', promo: '🎟 Promokod', referral_league: '👥 Referral League', welcome: '🎉 Yangi foydalanuvchi' };
  const GAME_NAMES = { manager: '🎮 Mini Manager', quiz: '🧠 Quiz', score: '🎯 Hisobni top', duel: '⚔️ Duel', penalty: '🥅 Penalty', crossbar: '💥 Crossbar', keepy: '⚽ Keepy-uppy', quest: '✅ Vazifalar' };

  async function charts(v, days = 30) {
    const c = await api(`/stats/charts?days=${days}`);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const kpi = (val, label) => el('div', { class: 'kpi' }, el('b', { text: val }), el('span', { text: label }));
    const card = (title, body) => el('div', { class: 'card', style: 'margin-top:10px' }, el('h3', { style: 'margin-top:0', text: title }), body);
    const range = el('div', { class: 'row', style: 'gap:6px' }, [7, 30, 90].map((d) => el('button', { class: `mini${d === c.days ? ' ok' : ''}`, text: `${d} kun`, onclick: () => charts(v, d) })));
    // Rang manbaga bog'langan (filtrlanganda o'zgarmaydi); noma'lum manbalar — "Boshqa"
    const known = Object.keys(SOURCE_NAMES);
    const other = c.dates.map((_, i) => Object.keys(c.premium).filter((k) => !known.includes(k)).reduce((a, k) => a + c.premium[k][i], 0));
    const premiumSeries = known.map((k, i) => ({ k, name: SOURCE_NAMES[k], color: SERIES[i], values: c.premium[k] })).filter((x) => x.values)
      .concat(other.some(Boolean) ? [{ name: 'Boshqa', color: '#8a8f8c', values: other }] : []);
    const pct = (x) => (x === null ? '—' : `${x}%`);
    v.replaceChildren(
      el('h2', { class: 'row', style: 'justify-content:space-between' }, el('span', { text: '📈 Grafiklar' }), range),
      el('div', { class: 'kpis' },
        kpi(c.dau[c.dau.length - 1], '👤 Bugun faol (DAU)'), kpi(Math.round(sum(c.dau) / c.days), `👤 O'rtacha DAU (${c.days} kun)`),
        kpi(sum(c.newUsers), `🆕 Yangi foydalanuvchilar (${c.days} kun)`), kpi(pct(c.retentionAvg.d1), '🔁 D1 retention'), kpi(pct(c.retentionAvg.d7), '🔁 D7 retention'),
        kpi(`${c.stars.stars} ⭐`, `⭐ Stars to'lovlari (${c.stars.payments} ta)`)),
      card('👤 Kunlik faol foydalanuvchilar (bot + Mini App)', chart({ dates: c.dates, series: [{ name: 'DAU', color: SERIES[0], values: c.dau }] })),
      card('🆕 Yangi foydalanuvchilar', chart({ dates: c.dates, type: 'bar', series: [{ name: 'Yangi', color: SERIES[1], values: c.newUsers }] })),
      card('🔁 Retention — shu kuni kelganlarning necha foizi qaytgan', chart({ dates: c.dates, unit: '%', series: [
        { name: '1 kundan keyin (D1)', color: SERIES[0], values: c.retention.map((r) => r.d1) },
        { name: '7 kundan keyin (D7)', color: SERIES[1], values: c.retention.map((r) => r.d7) }] })),
      card('💎 Premium (manba bo\'yicha)', premiumSeries.length ? chart({ dates: c.dates, type: 'bar', series: premiumSeries }) : el('div', { class: 'muted small', text: 'Ma\'lumot yo\'q' })),
      card('🎮 O\'yinlar — kunlik o\'ynashlar soni', el('div', { class: 'multiples' }, Object.entries(c.plays).map(([k, vals]) => el('div', {},
        el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', { class: 'small', text: GAME_NAMES[k] || k }), el('span', { class: 'small muted', text: `jami ${sum(vals)}` })),
        chart({ dates: c.dates, type: 'bar', height: 70, compact: true, series: [{ name: GAME_NAMES[k] || k, color: SERIES[2], values: vals }] }))))),
    );
  }

  // 📊 Statistika
  async function stats(v) {
    const s = await api('/stats');
    const max = Math.max(1, ...s.days.map((d) => d.visits));
    const kpi = (val, label) => el('div', { class: 'kpi' }, el('b', { text: val }), el('span', { text: label }));
    const winnerKind = { overall: '🏆 Umumiy reyting', manager: '🎮 Mini Manager', quiz: '🧠 Quiz', referral: '👥 Referral League' };
    v.replaceChildren(
      el('div', { class: 'kpis' },
        kpi(s.visits_today, '🌐 Bugungi Web App tashriflari'), kpi(s.manager_participants_week, '🎮 Mini Manager qatnashchilari (7 kun)'),
        kpi(s.manager_participants, '🎮 Mini Manager (jami)'), kpi(s.quiz_participants_today, '🧠 Bugun Quiz javob berganlar'),
        kpi(s.quiz_participants, '🧠 Quiz (jami)'), kpi(s.premium_total, '💎 Premium (faol)'), kpi(s.premium_new_today, '💎 Bugun yangi Premium'), kpi(s.users_total, '👥 Jami foydalanuvchilar')),
      el('div', { class: 'card', style: 'margin-top:10px' }, el('h3', { style: 'margin-top:0', text: '🌐 Web App tashriflari (14 kun)' }),
        s.days.length ? [el('div', { class: 'bars' }, s.days.map((d) => el('div', { style: `height:${(d.visits / max) * 100}%`, title: `${d.date}: ${d.visits}` }))),
          el('div', { class: 'bars-x' }, s.days.map((d) => el('span', { text: d.date.slice(8) })))] : el('div', { class: 'muted small', text: 'Ma\'lumot yo\'q' })),
      el('h2', { text: '🏅 TOP faol foydalanuvchilar' }),
      el('div', { class: 'card' }, s.top.length ? s.top.map((u, i) => el('div', { class: 'lb-row' }, el('span', { class: 'pl', text: i + 1 }),
        el('span', { class: 'grow ellipsis' }, el('b', { text: u.name }), u.coach_name ? el('span', { class: 'small muted', text: ` · 👔 ${u.coach_name}` }) : null),
        el('span', { class: 'small muted', text: `🎮 ${u.points_manager} · 🧠 ${u.points_quiz} · 🎯 ${u.points_score} · ⚔️ ${u.points_duel} · 🥅 ${u.points_penalty} · 🕹 ${u.points_arcade}` }), el('span', { class: 'pts', text: u.total })))
        : el('div', { class: 'muted center', text: '📭 Hali yo\'q' })),
      el('h2', { text: '🏆 Davr g\'oliblari (sovrin topshirish uchun)' }),
      el('div', { class: 'card' }, s.winners.length ? s.winners.map((w) => el('div', { class: 'kv' },
        el('span', { text: `${winnerKind[w.kind]} · ${w.period === 'weekly' ? 'haftalik' : 'oylik'} · ${fmt(w.period_start).slice(0, 10)}` }),
        el('b', { text: w.name ? `${w.name} (${w.telegram_id}) — ${w.points}` : '—' })))
        : el('div', { class: 'muted center', text: '📭 Hali yakunlangan davrlar yo\'q' })),
    );
  }

  // ---------- Kirish
  function loginForm() {
    const login = el('input', { class: 'input', placeholder: 'Login', autocomplete: 'username' });
    const pass = el('input', { class: 'input', type: 'password', placeholder: 'Parol', autocomplete: 'current-password', style: 'margin-top:8px' });
    const btn = el('button', { class: 'btn block', style: 'margin-top:12px', text: '🔐 Kirish' });
    const submit = async () => {
      btn.disabled = true;
      try { await api('/login', { method: 'POST', body: { login: login.value, password: pass.value } }); start(); } catch (e) { fail(e); btn.disabled = false; }
    };
    btn.addEventListener('click', submit);
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    $('view').replaceChildren(el('div', { class: 'card', style: 'max-width:380px;margin:40px auto 0' },
      el('h3', { style: 'margin-top:0', text: '🔒 Admin paneliga kirish' }),
      el('p', { class: 'small muted', text: 'Telegram orqali ochsangiz, admin sifatida avtomatik kirasiz.' }), login, pass, btn));
  }

  async function start() {
    try {
      const me = await api('/me');
      $('who').replaceChildren(document.createTextNode(`${me.via === 'telegram' ? '📱' : '🔑'} ${me.name} `),
        me.via === 'password' ? el('button', { class: 'mini', text: 'Chiqish', onclick: async () => { await api('/logout', { method: 'POST' }); window.location.reload(); } }) : '');
      renderTabs();
      show();
    } catch (e) {
      if (e.status === 401) return loginForm();
      $('view').replaceChildren(el('div', { class: 'card center', text: e.status === 403 ? '🚫 Sizda admin huquqi yo\'q' : '⚠️ Xatolik' }));
    }
    return undefined;
  }

  if (tg) { try { tg.ready(); tg.expand(); tg.setHeaderColor('#0c1712'); tg.setBackgroundColor('#0c1712'); } catch (e) { /* */ } }
  start();
})();

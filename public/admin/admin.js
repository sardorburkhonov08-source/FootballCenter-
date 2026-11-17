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
    bad_prize: '⚠️ Turi, davri va matnini to\'ldiring', bad_question: '⚠️ Barcha maydonlarni to\'ldiring', bad_tactics: '⚠️ Taktika formati: 4-4-2 (jami 10 ta futbolchi)',
    already_finished: '⚠️ Tugagan o\'yinni o\'chirib bo\'lmaydi', quiz_api_unavailable: '⚠️ Quiz API mavjud emas', bad_credentials: '❌ Login yoki parol noto\'g\'ri',
    too_many_attempts: '⏳ Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring',
  };

  async function api(path, opts = {}) {
    const headers = initData ? { Authorization: `tma ${initData}` } : {};
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const res = await fetch(`/api/admin${path}`, { method: opts.method || 'GET', headers, body, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) { /* */ }
    if (!res.ok) { const err = new Error((data && data.error) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }
  function fail(e) { toast(ERRORS[e.message] || `⚠️ Xatolik: ${e.message}`); }

  function mediaThumb(url, type) {
    if (!url) return el('div', { class: 'thumb' }, '🏆');
    if (type === 'video') { const v = el('video', { src: url, muted: true, playsinline: true }); v.muted = true; return el('div', { class: 'thumb' }, v); }
    if (type === 'lottie') return el('div', { class: 'thumb' }, '✨');
    return el('div', { class: 'thumb' }, el('img', { src: url, alt: '' }));
  }

  // ---------- Bo'limlar
  const SECTIONS = [
    ['banners', '🎬 Bannerlar'], ['games', '🎮 Mini Manager — o\'yinlar'], ['prizes', '🏆 Sovrinlar'],
    ['quiz', '🧠 Quiz savollari'], ['tactics', '📐 Taktikalar'], ['stats', '📊 Statistika'],
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
    try { await ({ banners, games, prizes, quiz, tactics, stats })[current](v); } catch (e) { v.replaceChildren(el('div', { class: 'card center', text: '⚠️ Yuklab bo\'lmadi' })); fail(e); }
  }

  // 🎬 Bannerlar
  async function banners(v) {
    const list = await api('/banners');
    const file = el('input', { class: 'input', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/json' });
    const link = el('input', { class: 'input', placeholder: 'Havola (ixtiyoriy, yashirin)' });
    const dur = el('input', { class: 'input', type: 'number', min: '2', max: '120', value: '8' });
    const add = el('button', { class: 'btn', text: '➕ Yuklash' });
    add.addEventListener('click', async () => {
      if (!file.files[0]) return toast('⚠️ Faylni tanlang');
      const fd = new FormData();
      fd.append('media', file.files[0]); fd.append('link', link.value); fd.append('duration', dur.value);
      add.disabled = true;
      try { await api('/banners', { method: 'POST', body: fd }); toast('✅ Banner qo\'shildi'); show(); } catch (e) { fail(e); add.disabled = false; }
      return undefined;
    });
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ Yangi banner' }),
        el('p', { class: 'small muted', text: 'Rasm, GIF, video (MP4/WEBM) yoki Lottie JSON. Bir nechta faol banner karusel bo\'lib almashadi; video standart holatda ovozsiz.' }),
        el('div', { class: 'form-grid' },
          el('div', null, el('label', { class: 'field-label', text: 'Media' }), file),
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
            el('div', { class: 'small muted', style: 'margin-top:4px', text: `${b.media_type} · ${b.is_active ? '🟢 faol' : '⚪️ o\'chirilgan'}` })),
          el('div', { class: 'row' },
            el('button', { class: 'mini ok', text: '💾', title: 'Saqlash', onclick: async () => { try { await api(`/banners/${b.id}`, { method: 'PATCH', body: { link: linkIn.value, duration: Number(durIn.value) } }); toast('✅ Saqlandi'); } catch (e) { fail(e); } } }),
            el('button', { class: 'mini', text: b.is_active ? '⏸ O\'chirish' : '▶️ Yoqish', onclick: async () => { try { await api(`/banners/${b.id}`, { method: 'PATCH', body: { isActive: !b.is_active } }); show(); } catch (e) { fail(e); } } }),
            el('button', { class: 'mini danger', text: '🗑', onclick: async () => { if (!window.confirm('Banner o\'chirilsinmi?')) return; try { await api(`/banners/${b.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } })));
      })) : el('div', { class: 'card center muted', text: '📭 Bannerlar yo\'q' }),
    );
  }

  // 🎮 Mini Manager — o'yin belgilash
  async function games(v) {
    const assigned = await api('/manager/games');
    const from = el('input', { class: 'input', type: 'date', value: ymd() });
    const to = el('input', { class: 'input', type: 'date', value: ymd(new Date(Date.now() + 7 * 86400000)) });
    const results = el('div', { class: 'list', style: 'margin-top:10px' });
    const search = el('button', { class: 'btn', text: '🔍 API\'dan o\'yinlar' });
    const assignedIds = new Set(assigned.map((g) => Number(g.api_match_id)));
    search.addEventListener('click', async () => {
      results.replaceChildren(el('div', { class: 'skeleton' }));
      try {
        const d = await api(`/manager/matches?from=${from.value}&to=${to.value}`);
        results.replaceChildren(...(d.matches.length ? d.matches.map((m) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
          el('div', { class: 'grow', style: 'min-width:200px' }, el('b', { text: `${m.home.fullName} — ${m.away.fullName}` }),
            el('div', { class: 'small muted', text: `${m.competition ? m.competition.name : ''} · ${fmt(m.utcDate)}` })),
          assignedIds.has(m.id) ? el('span', { class: 'badge live', text: '✅ Belgilangan' })
            : el('button', { class: 'mini ok', text: '➕ Belgilash', onclick: async (e) => { e.target.disabled = true; try { await api('/manager/games', { method: 'POST', body: { apiMatchId: m.id } }); toast('✅ O\'yin belgilandi'); show(); } catch (err) { fail(err); e.target.disabled = false; } } })))
          : [el('div', { class: 'card center muted', text: '📭 Bu oraliqda o\'yinlar topilmadi' })]));
      } catch (e) { results.replaceChildren(); fail(e); }
    });
    const st = { upcoming: '⏳ kutilmoqda', locked: '🔒 boshlangan', finished: '✅ hisoblangan' };
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ O\'yin belgilash' }),
        el('p', { class: 'small muted', text: 'API\'dagi kelgusi o\'yinlardan birini Mini Manager uchun faol o\'yin qiling. Hafta: seshanba 12:00 — keyingi seshanba 11:59 (Toshkent).' }),
        el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Dan' }), from), el('div', null, el('label', { class: 'field-label', text: 'Gacha' }), to), search),
        results),
      el('h2', { text: `Belgilangan o'yinlar (${assigned.length})` }),
      assigned.length ? el('div', { class: 'list' }, assigned.map((g) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        el('div', { class: 'grow', style: 'min-width:200px' }, el('b', { text: `${g.home_team_name} — ${g.away_team_name}` }),
          el('div', { class: 'small muted', text: `${g.competition || ''} · ${fmt(g.kickoff_at)} · ${st[g.status]} · 👥 ${g.participants}${g.result ? ` · ${g.result.home}:${g.result.away}` : ''}` })),
        g.status !== 'finished' ? el('button', { class: 'mini danger', text: '🗑', onclick: async () => { if (!window.confirm('O\'yin va unga berilgan taxminlar o\'chirilsinmi?')) return; try { await api(`/manager/games/${g.id}`, { method: 'DELETE' }); show(); } catch (e) { fail(e); } } }) : null)))
        : el('div', { class: 'card center muted', text: '📭 Hali o\'yin belgilanmagan' }),
    );
  }

  // 🏆 Sovrinlar
  async function prizes(v) {
    const list = await api('/prizes');
    const kind = el('select', { class: 'input' }, el('option', { value: 'manager', text: '🎮 Mini Manager' }), el('option', { value: 'quiz', text: '🧠 Quiz' }));
    const period = el('select', { class: 'input' }, el('option', { value: 'weekly', text: 'Haftalik' }), el('option', { value: 'monthly', text: 'Oylik' }));
    const text = el('textarea', { class: 'input', placeholder: 'Sovrin matni', maxlength: '1000' });
    const file = el('input', { class: 'input', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm' });
    const add = el('button', { class: 'btn', text: '➕ Qo\'shish' });
    add.addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('kind', kind.value); fd.append('period', period.value); fd.append('text', text.value);
      if (file.files[0]) fd.append('media', file.files[0]);
      add.disabled = true;
      try { await api('/prizes', { method: 'POST', body: fd }); toast('✅ Sovrin qo\'shildi'); show(); } catch (e) { fail(e); add.disabled = false; }
    });
    v.replaceChildren(
      el('div', { class: 'card' }, el('h3', { style: 'margin-top:0', text: '➕ Yangi sovrin' }),
        el('p', { class: 'small muted', text: 'Faqat TOP 1 sovrin oladi (haftalik va oylik alohida). Bir nechta faol sovrin Web App\'da 15 soniyada almashadi.' }),
        el('div', { class: 'form-grid' }, el('div', null, el('label', { class: 'field-label', text: 'Bo\'lim' }), kind), el('div', null, el('label', { class: 'field-label', text: 'Davr' }), period),
          el('div', null, el('label', { class: 'field-label', text: 'Media (ixtiyoriy)' }), file)),
        el('label', { class: 'field-label', text: 'Matn' }), text, el('div', { style: 'margin-top:10px' }, add)),
      el('h2', { text: `Sovrinlar (${list.length})` }),
      list.length ? el('div', { class: 'list' }, list.map((p) => el('div', { class: 'card row', style: 'flex-wrap:wrap' },
        mediaThumb(p.media_path ? `/uploads/${p.media_path}` : null, p.media_type),
        el('div', { class: 'grow', style: 'min-width:180px' }, el('div', { class: 'small muted', text: `${p.kind === 'manager' ? '🎮 Mini Manager' : '🧠 Quiz'} · ${p.period === 'weekly' ? 'haftalik' : 'oylik'} · ${p.is_active ? '🟢 faol' : '⚪️ o\'chirilgan'}` }),
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

  // 📊 Statistika
  async function stats(v) {
    const s = await api('/stats');
    const max = Math.max(1, ...s.days.map((d) => d.visits));
    const kpi = (val, label) => el('div', { class: 'kpi' }, el('b', { text: val }), el('span', { text: label }));
    const winnerKind = { manager: '🎮 Mini Manager', quiz: '🧠 Quiz', referral: '👥 Referral League' };
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
        el('span', { class: 'small muted', text: `🎮 ${u.points_manager} · 🧠 ${u.points_quiz}` }), el('span', { class: 'pts', text: u.total })))
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

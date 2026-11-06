// Public site behaviour. Pages work without this script; it adds reveal motion,
// the meetings filter, the contact-form check and the member login.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.add('js');

  // Reveal on scroll. Elements already on screen are shown at once so nothing flickers.
  const els = $$('.reveal,.week,.stops');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !('IntersectionObserver' in window)) els.forEach(e => e.classList.add('in'));
  else {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0 });
    els.forEach(e => { const r = e.getBoundingClientRect(); if (r.top < innerHeight) e.classList.add('in'); else io.observe(e); });
  }

  // Mobile menu: close with Escape or when tapping elsewhere.
  const menu = $('.menu');
  if (menu) {
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open = false; $('summary', menu).focus(); } });
    document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  }


  // Meetings: filter the week grid by category; /meetings/?cat=團契 preselects a category.
  const filter = $('.filter');
  if (filter) {
    const items = $$('#week-grid li[data-cat], #week-grid-extra li[data-cat]'), days = $$('#week-grid .day'), status = $('.filter-status');
    const apply = cat => {
      let n = 0;
      items.forEach(li => { const show = !cat || li.dataset.cat === cat; li.hidden = !show; if (show) n++; });
      days.forEach(d => d.classList.toggle('dim', !!cat && !d.querySelector('li[data-cat]:not([hidden])')));
      status.textContent = `顯示 ${n} 項${cat || ''}聚會`;
    };
    filter.addEventListener('change', e => apply(e.target.value));
    const want = new URLSearchParams(location.search).get('cat');
    const radio = want && $$('input[name="cat"]', filter).find(r => r.value === want);
    if (radio) { radio.checked = true; apply(want); }
  }

  // Contact form: check the fields only. Nothing is sent anywhere.
  const form = $('#contact-form');
  if (form) {
    const msg = { name: '請填寫姓名。', email: '請填寫有效的電郵地址。', message: '請填寫內容。' };
    form.addEventListener('submit', e => {
      e.preventDefault();
      let first = null;
      for (const [name, text] of Object.entries(msg)) {
        const input = form.elements[name], err = $('#e-' + name);
        const bad = !input.value.trim() || !input.checkValidity();
        input.setAttribute('aria-invalid', String(bad));
        err.textContent = bad ? text : '';
        if (bad && !first) first = input;
      }
      const status = $('#form-status');
      status.classList.toggle('ok', !first);
      if (first) { status.textContent = '有欄位需要修改。'; first.focus(); return; }
      status.textContent = '內容齊全。這個表格暫時不會送出，請致電 2560 9640 聯絡教會。';
    });
  }

  // Member login. Only same-site member paths are accepted as the return address.
  const login = $('#login-form');
  if (login) {
    const param = new URLSearchParams(location.search).get('next') || '';
    const next = /^\/members\/[a-z/-]*$/.test(param) && !param.includes('//') ? param : '/members/';
    fetch('/api/session', { cache: 'no-store' }).then(r => r.ok && r.json()).then(s => { if (s && s.authenticated) location.replace(next); }).catch(() => {});
    const input = $('#password'), error = $('#login-error'), button = $('#login-submit');
    login.addEventListener('submit', async e => {
      e.preventDefault();
      if (!input.value) { error.textContent = '請輸入密碼。'; input.focus(); return; }
      button.disabled = true; error.textContent = '';
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        input.value = '';
        if (r.ok) { location.assign(next); return; }
        error.textContent = r.status === 429 ? '嘗試次數太多，請一分鐘後再試。' : r.status === 503 || r.status === 404 || r.status === 405 ? '登入暫時未能使用，請稍後再試。' : '密碼不正確，請重新輸入。';
        input.focus();
      } catch {
        input.value = ''; error.textContent = '連線未完成，請檢查網絡後再試。';
      } finally { button.disabled = false; }
    });
  }
})();

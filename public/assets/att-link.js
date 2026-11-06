// 團契點名連結: /attendance/#<token>. The token is read from the fragment (browsers never
// send it to the server), removed from the address bar at once, and posted a single
// time to get this phone's group cookie. Then the roll call opens.
(() => {
  const status = document.getElementById('link-status'), help = document.getElementById('link-help');
  if (!status) return;
  const token = location.hash.slice(1);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const say = (title, text) => { status.textContent = title; help.textContent = text || ''; help.hidden = !text; };
  const open = () => location.replace('/members/attendance/');
  (async () => {
    if (!token) {
      try { const s = await (await fetch('/api/session', { cache: 'no-store' })).json(); if (s.link || s.authenticated) return open(); } catch {}
      return say('請用團契群組內的點名連結開啟。', '點名連結由傳道同工發到各團契的群組。');
    }
    try {
      const r = await fetch('/api/attendance/link', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (r.ok) return open();
      const data = await r.json().catch(() => ({}));
      if (data.error === 'invalid_link') say('這條點名連結已失效或不完整。', '連結可能已被傳道同工重設。請在團契群組找最新的連結，或向傳道同工查詢。');
      else if (data.error === 'rate_limited') say('嘗試次數太多。', '請一分鐘後再按一次連結。');
      else say('點名服務暫時未能使用。', '請稍後再按一次連結。');
    } catch { say('網絡未連接。', '請連接網絡後再按一次連結。'); }
  })();
})();

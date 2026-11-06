// Shared page frame for the public site (direction A, "wall and red rail").
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Arrow from the adapted Uiverse button (nathAd17/heavy-warthog-57), see /credits/.
export const arrow = '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
export const external = '<svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>';

export const NAV = [
  ['/about/', '認識我們'],
  ['/meetings/', '聚會時間'],
  ['/activities/', '教會活動'],
  ['/notices/', '教會通告'],
  ['/contact/', '聯絡我們'],
];

export const CHURCH = {
  name: '信望愛福音會筲箕灣堂',
  address: '筲箕灣道 334–336 號華寶商業中心 2 樓 205–209 室',
  phone: '2560 9640', tel: '+85225609640', fax: '2567 2117',
  email: 'skwfhcem@gmail.com',
  maps: 'https://maps.google.com/?cid=13131394494997730034',
};

const section = path => (path.match(/^\/[^/]+\//) || ['/'])[0];

function header(path) {
  const here = section(path);
  const link = ([href, label]) => `<li><a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a></li>`;
  return `<header class="top">
  <a class="brand" href="/"><img src="/assets/img/church-seal.png" alt="" width="38" height="38"><span><b>信望愛福音會</b><small>筲箕灣堂</small></span></a>
  <nav aria-label="主選單">
    <ul class="nav">${NAV.map(link).join('')}<li><a class="members" href="/members/"${here === '/members/' ? ' aria-current="page"' : ''}>肢體專區</a></li></ul>
    <details class="menu"><summary>選單</summary><ul>${NAV.map(link).join('')}<li><a href="/members/">肢體專區</a></li></ul></details>
  </nav>
</header>`;
}

function footer() {
  return `<footer class="foot">
  <div>
    <h2>信望愛福音會筲箕灣堂</h2>
    <p>${CHURCH.address}<br>電話 <a href="tel:${CHURCH.tel}">${CHURCH.phone}</a>・傳真 ${CHURCH.fax}</p>
  </div>
  <div>
    <h2>其他堂會</h2>
    <ul><li><a href="/about/churches/">旺角堂・2392 3422</a></li><li><a href="/about/churches/">北角堂・2882 2482</a></li></ul>
  </div>
  <div>
    <h2>網站</h2>
    <ul><li><a href="/members/">肢體專區</a></li><li><a href="/credits/">鳴謝及授權</a></li></ul>
  </div>
  <p class="copy"><span>© 信望愛福音會筲箕灣堂・新網站試行版，內容有待教會審閱</span><span lang="en">Faith Hope Charity Evangelical Mission</span></p>
</footer>`;
}

export function page({ path, title, description, body, bodyClass = '', head = '' }) {
  const full = path === '/' ? '信望愛福音會筲箕灣堂' : `${title}・信望愛福音會筲箕灣堂`;
  return `<!doctype html>
<html lang="zh-Hant-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/assets/img/church-seal.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chiron+Hei+HK:wght@400;500;700&amp;family=Chiron+Sung+HK:wght@500;700;900&amp;display=swap">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
${head}</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">跳到主要內容</a>
${header(path)}
<main id="main">
${body}
</main>
${footer()}
</body>
</html>
`;
}

// Inner-page heading: breadcrumb, title with the double red rail, short lead.
export function pagehead({ crumbs = [], title, lead = '', note = '' }) {
  const trail = [['/', '主頁'], ...crumbs];
  return `<header class="pagehead">
  <nav class="crumbs" aria-label="位置"><ol>${trail.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}<li aria-current="page">${title}</li></ol></nav>
  <div class="ph-row"><h1>${title}</h1><div class="rail" aria-hidden="true"></div></div>
  ${lead ? `<p class="ph-lead">${lead}</p>` : ''}${note}
</header>`;
}

export function sec({ id, label, body, cls = '', labelId }) {
  const hid = labelId || (id ? `${id}-h` : '');
  return `<section class="sec${cls ? ' ' + cls : ''}"${id ? ` id="${id}"` : ''}${hid ? ` aria-labelledby="${hid}"` : ''}>
  <h2 class="vlabel"${hid ? ` id="${hid}"` : ''}>${label}</h2>
  <div class="sec-body">${body}</div>
</section>`;
}

// Marks text written for the redesign (not from the original site) for church review.
export const draft = (text = '本段文字為新網站草稿，待教會審閱。') => `<p class="draft"><span class="tag">草稿</span>${text}</p>`;
export const sourceNote = '<p class="src">內容按教會原網站（2026 年 10 月存檔）整理；人事、地址及聚會安排以教會最新公布為準。</p>';

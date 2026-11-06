import { page, pagehead, sec, esc, arrow, draft } from '../lib/layout.mjs';
import { meetings } from '../lib/blocks.mjs';
import { ICONS } from '../lib/icons.mjs';

const GROUPS = [
  ['崇拜', '主日及週六晚崇拜，另有幼兒崇拜。'],
  ['學習', '主日學、聖經班及信仰研討小組。'],
  ['禱告', '每週三有例行祈禱會。'],
  ['團契', '按年齡及生活階段分組的團契和小組。'],
];

export function activitiesPage() {
  const cards = GROUPS.map(([cat, line]) => {
    const list = meetings.filter(m => m.category === cat);
    return `<article class="act reveal" aria-labelledby="act-${cat}">
      <div class="act-icon">${ICONS[cat]}</div>
      <h3 id="act-${cat}">${cat}<small>${list.length} 項恆常聚會</small></h3>
      <p>${line}</p>
      <ul>${list.map(m => `<li>${esc(m.name)}</li>`).join('')}</ul>
      <a class="link more" href="/meetings/?cat=${encodeURIComponent(cat)}">看${cat}聚會時間</a>
    </article>`;
  }).join('');
  const body = pagehead({ title: '教會活動', lead: '每星期的崇拜、學習、禱告和團契生活。' }) +
    sec({ id: 'life', label: '教會生活', body: `<div class="acts">${cards}</div>${draft('以上四類分組按原網站聚會時間表整理；各類簡介為新網站草稿，待教會審閱。聚會日子和時間只在「聚會時間」頁列出。')}` }) +
    sec({ id: 'news', label: '活動消息', body: `<div class="first reveal"><p>原網站的活動頁只有三張圖片，沒有活動名稱或日期，所以這裏暫時沒有列出特別活動。查詢近期活動，請致電教會。</p><div class="cta"><a class="btn" href="tel:+85225609640">致電 2560 9640 ${arrow}</a><a class="link" href="/meetings/">看聚會時間</a></div></div>` });
  return page({ path: '/activities/', title: '教會活動', description: '信望愛福音會筲箕灣堂的崇拜、主日學、祈禱會和團契。', body });
}

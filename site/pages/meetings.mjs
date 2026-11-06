import { page, pagehead, sec, esc, arrow, sourceNote, draft } from '../lib/layout.mjs';
import { weekGrid, meetings, MAIN_WORSHIP } from '../lib/blocks.mjs';

const CATS = ['崇拜', '學習', '禱告', '團契'];
const DAY_ORDER = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function meetingsPage() {
  const rows = [...meetings].sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.time.localeCompare(b.time));
  const table = `<fieldset class="filter needs-js" aria-controls="meeting-table">
    <legend>只看</legend>
    ${['全部', ...CATS].map((c, i) => `<label class="pill"><input type="radio" name="cat" value="${i ? c : ''}"${i ? '' : ' checked'}><span>${c}</span></label>`).join('')}
  </fieldset>
  <p class="filter-status vh" role="status" aria-live="polite"></p>
  <table class="mtable reveal" id="meeting-table">
    <caption class="vh">全部恆常聚會</caption>
    <thead><tr><th scope="col">聚會</th><th scope="col">類別</th><th scope="col">時間（原網站寫法）</th><th scope="col">日子・時間</th></tr></thead>
    <tbody>${rows.map(m => `<tr data-cat="${m.category}"${MAIN_WORSHIP.includes(m.name) ? ' class="worship"' : ''}><th scope="row">${esc(m.name)}</th><td><span class="cat">${m.category}</span></td><td>${esc(m.original)}</td><td><span class="d">${m.day.replace('星期', '週')}</span> <time>${m.time}</time>${m.note ? `<small>${esc(m.note)}</small>` : ''}</td></tr>`).join('')}</tbody>
  </table>`;
  const body = pagehead({ title: '聚會時間', lead: '主日崇拜在主日上午十時半，週六晚崇拜在週六晚上七時半。歡迎第一次來的朋友。' }) +
    sec({ id: 'week', label: '每週聚會', body: `<p class="lead reveal">一星期共 <b>18</b> 項恆常聚會，按日子排列。紅色是主日崇拜和週六晚崇拜。</p>${weekGrid()}<div class="weeknote"><span class="key">崇拜</span><a class="link" href="/notices/weather/">颱風及暴雨時的安排</a></div>` }) +
    sec({ id: 'all', label: '全部聚會', body: `${table}${sourceNote}${draft('原網站未有各團契及小組的對象和內容介紹；如需補充，請教會提供文字。')}` }) +
    sec({ id: 'first', label: '第一次來', body: `<div class="first reveal"><p>崇拜在<b>筲箕灣道 334–336 號華寶商業中心 2 樓</b>，地下是香港賽馬會。出升降機見到直排燈箱名牌就是本堂。</p><div class="cta"><a class="btn" href="/contact/#visit">怎樣來 ${arrow}</a><a class="link" href="tel:+85225609640">致電 2560 9640</a></div></div>` });
  return page({ path: '/meetings/', title: '聚會時間', description: '信望愛福音會筲箕灣堂每週 18 項恆常聚會：主日崇拜主日上午十時半、週六晚崇拜晚上七時半，以及主日學、祈禱會和團契。', body });
}

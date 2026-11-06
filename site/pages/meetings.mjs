import { page, pagehead, sec, esc, arrow, reportNote, draft } from '../lib/layout.mjs';
import { weekGrid, meetings } from '../lib/blocks.mjs';

const CATS = ['崇拜', '學習', '禱告', '團契'];
const DAY_ORDER = ['', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function meetingsPage() {
  const rows = [...meetings].sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.time.localeCompare(b.time));
  const filter = `<fieldset class="filter needs-js" aria-controls="week-grid">
    <legend>只看</legend>
    <span class="pills">${['全部', ...CATS].map((c, i) => `<label class="pill"><input type="radio" name="cat" value="${i ? c : ''}"${i ? '' : ' checked'}><span>${c}</span></label>`).join('')}</span>
  </fieldset>
  <p class="filter-status vh" role="status" aria-live="polite"></p>`;
  const original = `<details class="orig reveal"><summary>主日報告原文</summary><ul>${rows.map(m => `<li><span>${esc(m.name)}</span><span>${esc(m.original || m.time)}</span></li>`).join('')}</ul></details>`;
  const body = pagehead({ title: '聚會時間', lead: '主日崇拜在主日上午十時半，週六晚崇拜在週六晚上七時半。歡迎第一次來的朋友。' }) +
    sec({ id: 'week', label: '每週聚會', body: `<p class="lead reveal">一星期共 <b>${meetings.length}</b> 項恆常聚會，按日子排列。紅色是主日崇拜和週六晚崇拜；可按類別只看崇拜、學習、禱告或團契。</p>${filter}${weekGrid({ id: 'week-grid' })}<div class="weeknote"><span class="key">崇拜</span><a class="link" href="/notices/weather/">颱風及暴雨時的安排</a></div>${original}${reportNote}${draft('主日報告及原網站都未有各團契及小組的對象和內容介紹；如需補充，請教會提供文字。')}` }) +
    sec({ id: 'first', label: '第一次來', body: `<div class="first reveal"><p>崇拜在<b>筲箕灣道 334–346 號華寶商業中心 2 樓</b>，地下是香港賽馬會。出升降機見到直排燈箱名牌就是本堂。</p><div class="cta"><a class="btn" href="/#visit">怎樣來 ${arrow}</a><a class="link" href="tel:+85225609640">致電 2560 9640</a></div></div>` });
  return page({ path: '/meetings/', title: '聚會時間', description: `信望愛福音會筲箕灣堂每週 ${meetings.length} 項恆常聚會：主日崇拜主日上午十時半、週六晚崇拜晚上七時半，以及主日學、祈禱會和團契。`, body });
}

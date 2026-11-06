// Blocks shared by the homepage and inner pages.
import { readFileSync } from 'node:fs';
import content from '../data/content.mjs';
import { esc, arrow, external, CHURCH } from './layout.mjs';

const DAYS = [['星期日', '日', '主日'], ['星期一', '一'], ['星期二', '二'], ['星期三', '三'], ['星期四', '四'], ['星期五', '五'], ['星期六', '六']];
export const MAIN_WORSHIP = ['主日崇拜', '週六晚崇拜'];

// The original wording of each meeting time, keyed by meeting name.
export const originalTimes = (() => {
  const text = content.meetingsOriginal.replace(/^聚會時間表\s*/, '').replace(/[ \t]*\n?[ \t]*：[ \t]*\n?[ \t]*/g, '：');
  const map = {};
  for (const line of text.split('\n').map(s => s.trim()).filter(Boolean)) {
    const [name, time] = line.split('：');
    if (name && time) map[name.trim()] = time.trim();
  }
  return map;
})();

export const meetings = content.meetings.map(([category, name, day, time, note]) => ({ category, name, day, time, note, original: originalTimes[name] || '' }));

export function weekGrid() {
  const cols = DAYS.map(([day, short, sub]) => {
    const items = meetings.filter(m => m.day === day).sort((a, b) => a.time.localeCompare(b.time));
    const list = items.length
      ? `<ul>${items.map(m => `<li${MAIN_WORSHIP.includes(m.name) ? ' class="worship"' : ''}><time>${m.time}</time><span>${esc(m.name)}</span>${m.note ? `<small>${esc(m.note)}</small>` : ''}</li>`).join('')}</ul>`
      : '<p class="none">沒有恆常聚會</p>';
    return `<div class="day" role="listitem"><h3><span class="vh">${day}</span><span aria-hidden="true">${short}</span>${sub ? `<small aria-hidden="true">${sub}</small>` : ''}</h3>${list}</div>`;
  });
  return `<div class="week reveal" role="list">${cols.join('')}</div>`;
}

export const mapSvg = readFileSync(new URL('./map.svg', import.meta.url), 'utf8');

export function addressBlock({ headingLevel = 'p' } = {}) {
  const tag = headingLevel;
  return `<${tag} class="addr">筲箕灣道 334–336 號<span>華寶商業中心 2 樓 205–209 室</span></${tag}>
  <p class="landmark">地下是<b>香港賽馬會</b>。大廈入口在賽馬會<b>左邊</b>（門上寫「華寶商業中心」），乘升降機到 <b>2 樓</b>。門前就是電車站「南康街」。</p>
  <dl class="facts">
    <div><dt>電話</dt><dd><a href="tel:${CHURCH.tel}">${CHURCH.phone}</a></dd></div>
    <div><dt>傳真</dt><dd>${CHURCH.fax}</dd></div>
    <div><dt>電郵</dt><dd>${CHURCH.email}<span class="tag" title="原網站顯示的電郵與寄信連結不一致，請先致電確認">待核對</span></dd></div>
  </dl>`;
}

export const mapsButton = `<a class="btn" href="${CHURCH.maps}" target="_blank" rel="noopener">在 Google 地圖開啟 ${arrow}<span class="vh">（在新分頁開啟）</span></a>`;

export function waysBlock() {
  return `<div class="mapwrap" tabindex="0" role="group" aria-label="附近地圖（可左右捲動）">${mapSvg}</div>
  <p class="maphint">地圖可以左右拖動。</p>
  <ul class="ways">
    <li><span class="mode tram">電車</span><div><b>南康街站</b>就在門前（往筲箕灣方向）。往西行的<b>新成街站</b>約 100 米。</div></li>
    <li><span class="mode mtr">港鐵</span><div><b>筲箕灣站 A3 出口</b>最近，約 200 米（直線距離）；A1、A2 出口亦在附近。</div></li>
    <li><span class="mode bus">巴士</span><div><b>新成街站</b>及<b>南康街站</b>在門前，共 39 條路線。
      <details><summary>查看路線</summary><p class="routes">2 2X 8H 14 18X 19P 33X 77 77A 81 81A 82 82S 85 85A 99 102 102P 106 106P 110 307D 382 606 608 608P 682 682A 682B 694 694S 720 720A N8 N8X A12 NA12 B13 N122</p></details></div></li>
  </ul>
  <p class="src">地圖及路線資料來自 OpenStreetMap（2026 年 11 月），以運輸公司公布為準。</p>`;
}

export const steps = `<ol class="steps reveal">
  <li class="step-text"><p><b>1</b>在筲箕灣道找到香港賽馬會，大廈入口就在它左邊，門上寫「華寶商業中心」。乘升降機到 2 樓。</p></li>
  <li><figure><img src="/assets/img/entrance.jpg" alt="2 樓升降機大堂：直排燈箱名牌「信望愛福音會筲箕灣堂」和黑色十字架" loading="lazy" width="1100" height="1467"><figcaption><b>2</b>出升降機，第一眼見到直排燈箱名牌</figcaption></figure></li>
  <li><figure><img src="/assets/img/wall-wide.jpg" alt="白色牆上，灰色石磚嵌着紅色「信望愛」三字，雙紅線沿牆伸向十字架" loading="lazy" width="1800" height="1350"><figcaption><b>3</b>再往內走，見到紅字牆</figcaption></figure></li>
</ol>`;

export const DOCS = [
  { slug: 'weather', title: '颱風及暴雨警告訊號聚會安排', short: '颱風及暴雨時的聚會安排', kind: '聚會安排', file: '/documents/weather.pdf' },
  { slug: 'song-copyright', title: '詩歌版權資料', kind: '常用詩歌集及出版社・2011 年', file: '/documents/song-copyright.pdf' },
  { slug: 'recreation', title: '筲箕灣堂康樂設施使用守則', kind: '堂會設施・2011 年', file: '/documents/recreation.pdf' },
  { slug: 'weddings-funerals', title: '聯會通告：處理婚宴喪事指引', kind: '聯會', file: '/documents/weddings-funerals.pdf' },
];

export function stormCard(documents) {
  const w = documents.weather;
  return `<article class="storm reveal" aria-labelledby="storm-h">
  <span class="scope">八號或以上風球・黑色暴雨警告</span>
  <h3 id="storm-h">颱風及暴雨時的聚會安排</h3>
  <dl>
    <div><dt>主日崇拜</dt><dd>${esc(w[0].text)}</dd></div>
    <div><dt>其他聚會</dt><dd>${esc(w[1].text)}</dd></div>
    <div><dt>訊號除下後</dt><dd>${esc(w[2].text)}</dd></div>
  </dl>
  <a href="/notices/weather/">閱讀全文</a>
</article>`;
}

export function docList({ skip = [] } = {}) {
  return `<ul class="doclist">${DOCS.filter(d => !skip.includes(d.slug)).map(d => `<li><a href="/notices/${d.slug}/"><span><b>${d.title}</b><small>${d.kind}</small></span><span class="kind">閱讀</span></a></li>`).join('')}</ul>
  <p class="archived">舊通告：<a href="/notices/covid-2023/">聯會有關疫情的通告（2023 年 2 月 28 日）</a></p>`;
}

export { external };

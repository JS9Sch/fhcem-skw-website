// Blocks shared by the homepage and inner pages.
import { readFileSync } from 'node:fs';
import content from '../data/content.mjs';
import { esc, arrow, external, CHURCH, addressHtml } from './layout.mjs';
import { STOPS, EAST, WEST, TERMINUS, NIGHT, SPECIAL } from '../data/bus.mjs';
import { WALKS } from '../data/walks.mjs';

// A stop name that the page script turns into a button showing its walking route on the map.
const walk = (id, name) => `<b data-walk="${id}" data-note="${esc(WALKS[id])}">${name}</b>`;
const BUS_WALK = { 新成街站: 'bus-sunsing', 南康街站: 'bus-namhong', 南安里站: 'bus-namon' };

const route = r => `<li${NIGHT.includes(r) ? ' class="night"' : SPECIAL.includes(r) ? ' class="special"' : ''}><b>${r}</b>${NIGHT.includes(r) ? '<small>通宵</small>' : SPECIAL.includes(r) ? '<small>特別班</small>' : ''}</li>`;
const routes = list => `<ul class="routes">${list.map(route).join('')}</ul>`;

function busBlock(open) {
  return `<ul class="bus-stops">${STOPS.map(([n, d, t]) => `<li>${walk(BUS_WALK[n], n)}（${d}）：${t}</li>`).join('')}</ul>
      <details class="bus"${open ? ' open' : ''}><summary>按路線看在哪個站下車</summary>
        <h4>乘往東行（往柴灣方向）的巴士</h4>
        <dl class="bus-groups">${EAST.map(([from, stops]) => `<div><dt>由${from}</dt>${stops.map(([stop, list]) => `<dd><span class="at">在<b>${stop}</b>下車</span>${routes(list)}</dd>`).join('')}</div>`).join('')}</dl>
        <h4>乘往西行（往北角、西灣河方向）的巴士：全部在<b>新成街</b>下車</h4>
        ${routes(WEST)}
        <p class="bus-note">以筲箕灣總站為終點的路線（${TERMINUS.join('、')}），請在南康街或南安里下車，不要坐到總站。</p>
        <p class="bus-note"><span class="rt-tag">通宵</span>通宵線　<span class="rt-tag">特別班</span>只在特定時段行駛。</p>
      </details>
      <p class="src">班次以運輸公司公布為準。資料來源：城巴、九巴及運輸署開放數據（2026 年 11 月）。</p>`;
}

const DAYS = [['星期日', '日', '主日'], ['星期一', '一'], ['星期二', '二'], ['星期三', '三'], ['星期四', '四'], ['星期五', '五'], ['星期六', '六']];
export const MAIN_WORSHIP = ['主日崇拜', '週六晚崇拜'];

// The wording of each meeting time as printed in the Sunday report, keyed by meeting name.
export const originalTimes = (() => {
  const text = content.meetingsOriginal.replace(/^聚會時間表\s*/, '').replace(/[ \t]*\n?[ \t]*：[ \t]*\n?[ \t]*/g, '：');
  const map = {};
  for (const line of text.split('\n').map(s => s.trim()).filter(Boolean)) {
    const [name, time] = line.split('：');
    if (name && time) map[name.trim()] = time.trim();
  }
  return map;
})();

// A meeting held on two days is written "星期五／星期六" with times "20:00／17:00"; it shows in both day columns.
export const meetings = content.meetings.map(([category, name, day, time, note]) => {
  const days = day ? day.split('／') : [], times = time ? time.split('／') : [];
  return { category, name, day: days[0] || '', time: times[0] || '', slots: days.map((d, i) => ({ day: d, time: times[i] || times[0] })), note, original: originalTimes[name] || '' };
});

export function weekGrid({ id = '' } = {}) {
  const cols = DAYS.map(([day, short, sub]) => {
    // "also" marks the second column of a two-day meeting so the filter counts it once.
    const items = meetings.flatMap(m => m.slots.filter(s => s.day === day).map(s => ({ ...m, time: s.time, also: m.slots[0].day !== day }))).sort((a, b) => a.time.localeCompare(b.time));
    const list = items.length
      ? `<ul>${items.map(m => `<li data-cat="${m.category}"${m.also ? ' data-also' : ''}${MAIN_WORSHIP.includes(m.name) ? ' class="worship"' : ''}><time>${m.time}</time><span>${esc(m.name)}</span>${m.note ? `<small>${esc(m.note)}</small>` : ''}</li>`).join('')}</ul>`
      : '';
    return `<div class="day" role="listitem"><h3><span class="vh">${day}</span><span aria-hidden="true">${short}</span>${sub ? `<small aria-hidden="true">${sub}</small>` : ''}</h3>${list}</div>`;
  });
  const loose = meetings.filter(m => !m.day);
  const extra = loose.length ? `<ul class="week-extra reveal"${id ? ` id="${id}-extra"` : ''}>${loose.map(m => `<li data-cat="${m.category}"><span>另有</span><b>${esc(m.name)}</b><small>${esc(m.note)}</small></li>`).join('')}</ul>` : '';
  return `<div class="week reveal" role="list"${id ? ` id="${id}"` : ''}>${cols.join('')}</div>${extra}`;
}

// Home page summary: only the two main services; the full timetable lives on /meetings/.
export function worshipCards() {
  const order = DAYS.map(([day]) => day);
  const items = meetings.filter(m => MAIN_WORSHIP.includes(m.name)).sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
  return `<div class="wcards reveal">${items.map(m => `<div class="wcard"><span class="d">${m.day.replace('星期', '週')}</span><time>${m.time}</time><b>${esc(m.name)}</b>${m.note ? `<small>${esc(m.note)}</small>` : ''}</div>`).join('')}</div>`;
}

export const mapSvg = readFileSync(new URL('./map.svg', import.meta.url), 'utf8');

export function factsBlock({ address = false } = {}) {
  return `<dl class="facts">${address ? `
    <div><dt>地址</dt><dd>${addressHtml()}</dd></div>` : ''}
    <div><dt>電話</dt><dd><a href="tel:${CHURCH.tel}">${CHURCH.phone}</a></dd></div>
    <div><dt>WhatsApp</dt><dd><a href="${CHURCH.whatsapp}" target="_blank" rel="noopener">${CHURCH.phone}<span class="vh">（在新分頁開啟 WhatsApp）</span></a></dd></div>
    <div><dt>電郵</dt><dd><a href="mailto:${CHURCH.email}">${CHURCH.email}</a></dd></div>
  </dl>`;
}

export function addressBlock({ headingLevel = 'p' } = {}) {
  const tag = headingLevel;
  return `<${tag} class="addr">筲箕灣道 334–346 號<span>華寶商業中心 2 樓</span><span class="rooms">聚會地點 <span class="nw">203</span> 及 <span class="nw">205–209</span> 室・辦公室 <span class="nw">202</span> 室</span></${tag}>
  <p class="landmark">地下是<b>香港賽馬會</b>。大廈入口在賽馬會<b>左邊</b>（門上寫「華寶商業中心」），乘升降機到 <b>2 樓</b>。門前就是電車站「南康街」。</p>
  ${factsBlock()}`;
}

export const mapsButton = `<a class="btn" href="${CHURCH.maps}" target="_blank" rel="noopener">在 Google 地圖開啟 ${arrow}<span class="vh">（在新分頁開啟）</span></a>`;

export function waysBlock({ open = false } = {}) {
  return `<div class="mapwrap" tabindex="0" role="group" aria-label="附近地圖（可左右捲動）">${mapSvg}</div>
  <p class="walk-note" id="walk-note" aria-live="polite"></p>
  <p class="maphint">地圖可以左右拖動。</p>
  <p class="walk-hint">按下面的站名，地圖會畫出步行到教會的路線。</p>
  <ul class="ways">
    <li><span class="mode tram">電車</span><div>${walk('tram-namhong', '南康街站')}就在門前（往筲箕灣方向）。往西行的${walk('tram-sunsing', '新成街站')}步行約 150 米。</div></li>
    <li><span class="mode mtr">港鐵</span><div>${walk('mtr-a3', '筲箕灣站 A3 出口')}最近，步行約 310 米；A1、A2 出口亦在附近。</div></li>
    <li><span class="mode bus">巴士</span><div>${busBlock(open)}</div></li>
  </ul>
  <p class="src">地圖、步行路線、電車站及港鐵出口資料來自 OpenStreetMap（2026 年 11 月）。</p>`;
}

export const steps = `<ol class="steps reveal">
  <li class="step-text"><p><b>1</b>在筲箕灣道找到香港賽馬會，大廈入口就在它左邊，門上寫「華寶商業中心」。乘升降機到 2 樓。</p></li>
  <li><figure><img src="/assets/img/entrance.jpg" alt="2 樓升降機大堂：直排燈箱名牌「信望愛福音會筲箕灣堂」和黑色十字架" loading="lazy" width="1100" height="1467"><figcaption><b>2</b>出升降機，第一眼見到直排燈箱名牌</figcaption></figure></li>
  <li><figure><img src="/assets/img/wall-wide.jpg" alt="白色牆上，灰色石磚嵌着紅色「信望愛」三字，雙紅線沿牆伸向十字架" loading="lazy" width="1800" height="1350"><figcaption><b>3</b>再往內走，見到紅字牆</figcaption></figure></li>
</ol>`;

export const DOCS = [
  { slug: 'weather', title: '颱風及暴雨警告訊號下聚會安排指引', short: '颱風及暴雨時的聚會安排', kind: '聚會安排' },
  { slug: 'song-copyright', title: '詩歌版權資料', kind: '版權機構名單' },
  { slug: 'recreation', title: '筲箕灣堂康樂設施使用守則', kind: '堂會設施・2011 年', file: '/documents/recreation.pdf' },
  { slug: 'weddings-funerals', title: '聯會通告：處理婚宴喪事指引', kind: '聯會', file: '/documents/weddings-funerals.pdf' },
];

export function stormCard(documents) {
  const w = Object.fromEntries(documents.weather.map(x => [x.key, x.text]));
  return `<article class="storm reveal" aria-labelledby="storm-h">
  <span class="scope">八號或以上熱帶氣旋警告・黑色暴雨警告信號</span>
  <h3 id="storm-h">颱風及暴雨時的聚會安排</h3>
  <dl>
    <div><dt>主日崇拜</dt><dd>${esc(w.sunday)}</dd></div>
    <div><dt>其他聚會</dt><dd>${esc(w.cancel)}</dd></div>
    <div><dt>訊號除下後</dt><dd>${esc(w.lowered)}</dd></div>
  </dl>
  <a href="/notices/weather/">閱讀全文</a>
</article>`;
}

export function docList({ skip = [] } = {}) {
  return `<ul class="doclist">${DOCS.filter(d => !skip.includes(d.slug)).map(d => `<li><a href="/notices/${d.slug}/"><span><b>${d.title}</b><small>${d.kind}</small></span><span class="kind">閱讀</span></a></li>`).join('')}</ul>
  <p class="archived">舊通告：<a href="/notices/covid-2023/">聯會有關疫情的通告（2023 年 2 月 28 日）</a></p>`;
}

export { external };

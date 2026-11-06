import { page, pagehead, sec, esc, arrow, external, NAV } from '../lib/layout.mjs';
import { UIVERSE } from '../data/credits.mjs';

export function creditsPage() {
  const row = (title, text) => `<div><dt>${title}</dt><dd>${text}</dd></div>`;
  const body = pagehead({ title: '鳴謝及授權', lead: '這個網站用到的相片、字型、地圖資料和開放源碼元件。' }) +
    sec({ id: 'images', label: '相片及插圖', body: `<dl class="facts credits reveal">
      ${row('本堂相片', '2 樓入口燈箱名牌及紅字牆，2026 年 10 月 31 日拍攝，由教會提供；已移除位置等相片資料。<span class="tag">待確認署名</span>')}
      ${row('堂印及書法字', '取自教會原網站。')}
      ${row('首屏插圖', '本網站按實景自繪的示意圖：華寶商業中心、香港賽馬會、電車站「南康街」及往筲箕灣的電車。')}
      ${row('活動圖示', '本網站自繪。')}
    </dl>` }) +
    sec({ id: 'map', label: '地圖資料', body: `<dl class="facts credits reveal">
      ${row('附近地圖', '地圖資料 © <a class="link" href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap 貢獻者</a>，以 Open Database License（ODbL）授權；2026 年 11 月 6 日下載，由本網站繪製成圖。')}
      ${row('交通資料', '電車站、港鐵出口及巴士路線同樣取自 OpenStreetMap，以運輸公司公布為準。')}
    </dl>` }) +
    sec({ id: 'fonts', label: '字型', body: `<dl class="facts credits reveal">
      ${row('昭源宋體 Chiron Sung HK', '標題字型。作者 Chiron（tamcy），以 SIL Open Font License 1.1 授權，經 Google Fonts 載入。')}
      ${row('昭源黑體 Chiron Hei HK', '內文字型。作者 Chiron（tamcy），以 SIL Open Font License 1.1 授權，經 Google Fonts 載入。')}
    </dl>` }) +
    sec({ id: 'uiverse', label: '介面元件', body: `<p class="lead reveal">以下元件改編自 <a class="link" href="https://github.com/uiverse-io/galaxy" target="_blank" rel="noopener">Uiverse Galaxy</a>，原作以 MIT 授權發佈。我們改了配色和字型，補回鍵盤操作、焦點提示及螢幕閱讀器標籤，並在「減少動態」設定下停用動畫。</p>
      <ul class="uiverse reveal">${UIVERSE.map(u => `<li><b>${esc(u.name)}</b><span>${esc(u.use)}</span><small>作者 ${esc(u.author)}・MIT・<a class="link" href="${u.url}" target="_blank" rel="noopener">原作 ${external}<span class="vh">（在新分頁開啟）</span></a></small></li>`).join('')}</ul>
      <p class="src"><a class="link" href="/assets/UIVERSE-LICENSE.txt">MIT 授權全文及作者列表</a></p>` }) +
    sec({ id: 'software', label: '其他軟件', body: `<dl class="facts credits reveal">
      ${row('PptxGenJS 4.0.1', '肢體專區「詩歌簡報」匯出 PowerPoint。MIT 授權（<a class="link" href="/assets/PPTXGENJS-LICENSE.txt">全文</a>）。')}
      ${row('JSZip', 'PptxGenJS 內含。MIT 或 GPLv3 雙授權（<a class="link" href="/assets/JSZIP-LICENSE.txt">全文</a>）。')}
    </dl>
    <p class="src">教會的文字、相片和文件屬信望愛福音會筲箕灣堂所有，不包括在上述開放源碼授權之內。</p>` });
  return page({ path: '/credits/', title: '鳴謝及授權', description: '信望愛福音會筲箕灣堂網站使用的相片、字型、地圖資料及開放源碼元件。', body });
}

export function loginPage() {
  const body = pagehead({ title: '肢體專區登入', lead: '肢體專區提供講道集、週刊、月訊及相片集入口，以及試用中的團契工具。' }) +
    `<div class="login-wrap">
      <form class="login reveal" id="login-form" novalidate>
        <div class="field"><input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required maxlength="128" placeholder=" " aria-describedby="login-error"><label for="password">密碼</label></div>
        <p id="login-error" class="err" role="alert"></p>
        <button class="btn" type="submit" id="login-submit">登入 ${arrow}</button>
        <p class="form-note">登入後 8 小時內有效。忘記密碼請向傳道同工查詢。</p>
      </form>
    </div>`;
  return page({ path: '/login/', title: '肢體專區登入', description: '信望愛福音會筲箕灣堂肢體專區登入。', body, bodyClass: 'login-page' });
}

export function notFoundPage() {
  const body = pagehead({ title: '找不到這一頁', lead: '網址可能已經更改。舊網站的連結不再適用，請由以下頁面再找。' }) +
    `<div class="nf"><ul class="cards">${[['/', '主頁'], ...NAV].map(([href, label]) => `<li><a href="${href}"><b>${label}</b><i>前往 ${arrow}</i></a></li>`).join('')}</ul></div>`;
  return page({ path: '/404', title: '找不到這一頁', description: '找不到這一頁。', body });
}

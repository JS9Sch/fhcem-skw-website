import { page } from '../lib/layout.mjs';

// Protected member page. The Worker serves this (from src/member-index.txt) only
// after checking the session; /members/app.js renders the views.
export function memberIndex() {
  const body = `<div id="app"><div class="workspace member-loading"><p role="status">正在確認登入…</p></div></div>
<div id="toast" role="status" aria-live="polite"></div>
<dialog id="entry" aria-labelledby="unit-title"><form method="dialog" class="entry-form">
  <button class="close icon-button" aria-label="關閉">×</button>
  <h2 id="unit-title">選擇示範單位</h2>
  <p>點名、房間及詩歌工具仍在開發中，使用示範資料。將來各單位會有自己的權限。</p>
  <label>以哪個單位試用？<select id="unit"><option>大衛團</option><option>以諾團</option><option>示羅團</option><option>傳道同工</option><option>網站管理員</option></select></label>
  <button type="button" id="enter-demo" class="btn">確定</button>
</form></dialog>`;
  return page({
    path: '/members/', title: '肢體專區', description: '信望愛福音會筲箕灣堂肢體專區。', body, bodyClass: 'members-page',
    head: '<link rel="stylesheet" href="/assets/members.css">\n<script src="/assets/pptxgen.bundle.js" defer></script>\n<script src="/members/app.js" defer></script>\n',
  });
}

import { page, pagehead, sec, CHURCH, reportNote, arrow } from '../lib/layout.mjs';
import { factsBlock } from '../lib/blocks.mjs';

const STAFF = [['堂主任', '張英志先生'], ['傳道人', '江小雲姑娘'], ['傳道人', '王義傑先生'], ['傳道人', '何文浩先生'], ['義務傳道', '陳家樂姑娘'], ['幹事', '蕭鈞耀弟兄']];

export function contactPage() {
  const body = pagehead({ title: '聯絡我們', lead: `歡迎致電 <a class="link" href="tel:${CHURCH.tel}">${CHURCH.phone}</a>，或在聚會時間直接前來。` }) +
    sec({ id: 'reach', label: '聯絡方法', body: `<div class="reach">
      <div class="reveal">${factsBlock({ address: true })}</div>
      <div class="first reveal"><p><b>歡迎實體前來。</b>聚會時間內可直接到教會：筲箕灣道 334–346 號華寶商業中心 2 樓，地下是香港賽馬會。</p><div class="cta"><a class="btn" href="/#visit">怎樣來 ${arrow}</a><a class="link" href="/meetings/">聚會時間</a></div></div>
    </div>` }) +
    sec({ id: 'staff', label: '傳道同工', body: `<div class="staff-grid">
      <dl class="staff reveal">${STAFF.map(([r, n]) => `<div><dt>${r}</dt><dd>${n}</dd></div>`).join('')}</dl>
    </div>${reportNote}` }) +
    sec({ id: 'write', label: '寫信給我們', body: `<form class="contact-form reveal" id="contact-form" novalidate aria-describedby="form-note">
      <p id="form-note" class="form-note"><span class="tag">試行</span>這個表格暫時只會檢查內容，<b>不會送出</b>。請勿填寫私人資料；如有需要，請致電 ${CHURCH.phone}。</p>
      <div class="field"><input id="f-name" name="name" type="text" maxlength="60" autocomplete="name" required placeholder=" " aria-describedby="e-name"><label for="f-name">姓名</label><span class="err" id="e-name"></span></div>
      <div class="field"><input id="f-email" name="email" type="email" maxlength="120" autocomplete="email" required placeholder=" " aria-describedby="e-email"><label for="f-email">電郵</label><span class="err" id="e-email"></span></div>
      <div class="field"><input id="f-subject" name="subject" type="text" maxlength="120" placeholder=" "><label for="f-subject">主題（可留空）</label></div>
      <div class="field"><textarea id="f-message" name="message" rows="5" maxlength="1000" required placeholder=" " aria-describedby="e-message"></textarea><label for="f-message">內容</label><span class="err" id="e-message"></span></div>
      <button class="btn" type="submit">檢查內容（不會送出）</button>
      <p class="form-status" id="form-status" role="status" aria-live="polite"></p>
    </form>` });
  return page({ path: '/contact/', title: '聯絡我們', description: '信望愛福音會筲箕灣堂電話、電郵、地址及傳道同工。', body });
}

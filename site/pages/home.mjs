import documents from '../data/documents.mjs';
import { page, arrow } from '../lib/layout.mjs';
import { scene } from '../lib/scene.mjs';
import { worshipCards, meetings, addressBlock, mapsButton, waysBlock, steps, stormCard, docList } from '../lib/blocks.mjs';

export default function home() {
  const body = `<section class="wall" aria-labelledby="hello">
  <div class="wall-grid">
    <div class="sign" aria-hidden="true">
      <div class="bar"></div>
      <div class="tile"><span>信</span></div>
      <div class="tile"><span>望</span></div>
      <div class="tile"><span>愛</span></div>
    </div>
    <div class="railrow">
      <div class="railname" aria-hidden="true">信望愛福音會筲箕灣堂</div>
      <div class="rail" aria-hidden="true"></div>
    </div>
    <div class="hero-row">
      <div class="hello">
        <h1 id="hello">主日上午十時半，<br><em>二樓</em>見。</h1>
        <p><strong>筲箕灣道 334–336 號華寶商業中心 2 樓。</strong>第一次來，也歡迎你和我們一同敬拜。</p>
        <div class="cta">
          <a class="btn" href="/meetings/">看聚會時間 ${arrow}</a>
          <a class="link" href="#visit">怎樣來</a>
        </div>
      </div>
      ${scene}
    </div>
  </div>
</section>

<section class="sec" id="week" aria-labelledby="week-h">
  <h2 class="vlabel" id="week-h">每週聚會</h2>
  <div class="sec-body">
    <p class="lead reveal">每週兩堂崇拜，歡迎第一次來的朋友。</p>
    ${worshipCards()}
    <div class="weeknote"><span>另有主日學、祈禱會及團契，一星期共 ${meetings.length} 項恆常聚會。</span><a class="link" href="/meetings/">全部聚會時間</a></div>
  </div>
</section>

<section class="sec" id="visit" aria-labelledby="visit-h">
  <h2 class="vlabel" id="visit-h">怎樣來</h2>
  <div class="visit">
    <div class="reveal">
      ${addressBlock()}
      <div class="cta">${mapsButton}<a class="link" href="/contact/">傳道同工及聯絡表格</a></div>
    </div>
    <div class="mapcol reveal">${waysBlock()}</div>
  </div>
  ${steps}
</section>

<section class="sec" id="notices" aria-labelledby="notices-h">
  <h2 class="vlabel" id="notices-h">教會通告</h2>
  <div class="notices">
    ${stormCard(documents)}
    <div class="reveal">${docList({ skip: ['weather'] })}</div>
  </div>
</section>

<section class="sec story" aria-labelledby="story-h">
  <h2 class="vlabel" id="story-h">本會故事</h2>
  <div class="sec-body">
    <div class="stops">
      <div class="stop"><div class="yr">1973</div><div class="pl">西灣河</div><p>二十多位年輕弟兄姊妹購得海澄樓四樓單位作會址，開始信望愛福音會的第一頁。</p></div>
      <div class="stop"><div class="yr">1993</div><div class="pl">筲箕灣</div><p>出售西灣河舊址，遷入現址；同年 3 月 21 日舉行首次主日崇拜。</p></div>
    </div>
    <div class="verse">
      <img src="/assets/img/church-seal.png" alt="" width="64" height="64">
      <div><q>這殿日後的榮耀比先前更大。</q><cite>哈該書 2:9・本會歷史引用</cite></div>
    </div>
    <div class="links">
      <a class="link" href="/about/history/">本會歷史</a>
      <a class="link" href="/about/faith/">信仰立場（八款）</a>
      <a class="link" href="/about/churches/">其他堂會</a>
    </div>
  </div>
</section>`;
  return page({ path: '/', title: '主頁', description: '信望愛福音會筲箕灣堂：主日上午十時半崇拜，筲箕灣道 334–336 號華寶商業中心 2 樓。聚會時間、交通及教會通告。', body, bodyClass: 'home' });
}

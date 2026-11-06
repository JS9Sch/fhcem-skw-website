import content from '../data/content.mjs';
import { page, pagehead, sec, esc, arrow, sourceNote } from '../lib/layout.mjs';

const CRUMB = [['/about/', '認識我們']];

// Every entry below is taken from the history text on the original site.
const TIMELINE = [
  ['1973', '7 月', '西灣河', '二十多位年輕弟兄姊妹購得西灣河海澄樓四樓四座為自置會址，並聘得蔡證光先生作傳道人。'],
  ['1976', '3 月', '西灣河', '購得同一樓層千多呎的單位作為正堂。'],
  ['1979', '6 月・9 月', '西灣河', '購得海澄樓五樓二座作為副堂；同年獲政府批准註冊為合法社團，改名為「信望愛福音會」。'],
  ['1982', '3 月 28 日', '旺角', '旺角堂正式成立及啟用（九龍團契於 1981 年 3 月成立）。'],
  ['1989', '5 月', '銅鑼灣', '北角分堂聚會遷入銅鑼灣自購堂址，命名為銅鑼灣堂。'],
  ['1993', '3 月 21 日', '筲箕灣', '出售西灣河舊址、購入現址後，在筲箕灣堂舉行首次主日崇拜。'],
  ['2003', '6 月', '北角', '銅鑼灣堂遷往北角現址，重新命名為北角堂。'],
];

function faithItems() {
  const lines = content.faith.split('\n').map(s => s.trim()).filter(Boolean);
  const intro = lines.find(l => l.startsWith('本會以'));
  const items = lines.filter(l => /^\(\d\)/.test(l)).map(l => {
    const m = l.match(/^\((\d)\)\s*([^：]+)：(.*)$/);
    return { n: m[1], title: m[2].trim(), text: m[3].trim() };
  });
  return { intro, items };
}

function churches() {
  const lines = content.churches.split('\n').map(s => s.trim()).filter(Boolean).slice(1);
  const mission = lines.pop();
  const split = lines.indexOf('信望愛福音會北角堂');
  return { list: [lines.slice(0, split), lines.slice(split)], mission };
}

export function about() {
  const { items } = faithItems();
  const body = pagehead({ crumbs: [], title: '認識我們', lead: '信望愛福音會始於 1973 年的西灣河，今天有筲箕灣堂、旺角堂和北角堂。' }) +
    sec({ id: 'story', label: '本會故事', cls: 'story', body: `<ol class="timeline">${TIMELINE.map(([y, d, p, t]) => `<li class="reveal"><span class="yr">${y}</span><span class="pl">${p}<small>${d}</small></span><p>${t}</p></li>`).join('')}</ol>
      <p class="src">摘自本會歷史。<a class="link" href="/about/history/">閱讀全文</a></p>` }) +
    sec({ id: 'more', label: '再認識', body: `<ul class="cards">
      <li class="reveal"><a href="/about/faith/"><b>信仰立場</b><span>本會之基本信仰共八款：${items.map(i => i.title).join('、')}。</span><i>閱讀 ${arrow}</i></a></li>
      <li class="reveal"><a href="/about/history/"><b>本會歷史</b><span>由西灣河海澄樓到筲箕灣現址，以及植堂的經過。</span><i>閱讀 ${arrow}</i></a></li>
      <li class="reveal"><a href="/about/churches/"><b>其他堂會</b><span>旺角堂、北角堂的地址、電話及崇拜時間。</span><i>閱讀 ${arrow}</i></a></li>
      <li class="reveal"><a href="/contact/"><b>傳道同工</b><span>堂主任、傳道人及幹事，以及聯絡方法。</span><i>閱讀 ${arrow}</i></a></li>
    </ul>` });
  return page({ path: '/about/', title: '認識我們', description: '信望愛福音會筲箕灣堂的故事、信仰立場、歷史及其他堂會。', body });
}

export function faith() {
  const { intro, items } = faithItems();
  const body = pagehead({ crumbs: CRUMB, title: '信仰立場', lead: esc(intro) }) +
    sec({ id: 'creed', label: '基本信仰', body: `<ol class="creed">${items.map(i => {
      const refs = i.text.match(/\s*\(([^()]*[:：][^()]*)\)。?$/);
      const text = refs ? i.text.slice(0, refs.index) + '。' : i.text;
      return `<li class="reveal"><span class="no" aria-hidden="true">${'一二三四五六七八'[i.n - 1]}</span><h3>${esc(i.title)}</h3><p>${esc(text.replace(/。。$/, '。'))}</p>${refs ? `<p class="ref">${esc(refs[1])}</p>` : ''}</li>`;
    }).join('')}</ol>${sourceNote}` });
  return page({ path: '/about/faith/', title: '信仰立場', description: '信望愛福音會宗旨及基本信仰八款。', body });
}

export function history() {
  const lines = content.history.split('\n').map(s => s.trim()).filter(Boolean).slice(1);
  let html = '', open = false;
  for (const line of lines) {
    if (line === '分支' || line === '遷堂') { html += `<h3>${line}</h3>`; continue; }
    if (line.startsWith('願頌讚') || line.startsWith('自一九七三')) { html += `<p class="close">${esc(line)}</p>`; continue; }
    html += `<p>${esc(line)}</p>`;
  }
  void open;
  const body = pagehead({ crumbs: CRUMB, title: '本會歷史', lead: '「信望愛福音會的前身曾幾經風雨，但也屢蒙神的恩典和蔭庇。」' }) +
    `<div class="history-layout">
      <article class="prose reveal">${html}${sourceNote}</article>
      <aside class="mini-timeline" aria-label="年份一覽"><h2>年份一覽</h2><ol>${TIMELINE.map(([y, d, p]) => `<li><b>${y}</b><span>${p}・${d}</span></li>`).join('')}</ol></aside>
    </div>`;
  return page({ path: '/about/history/', title: '本會歷史', description: '信望愛福音會由 1973 年西灣河開始，至 1993 年遷入筲箕灣現址的歷史。', body });
}

export function churchesPage() {
  const { list, mission } = churches();
  const card = ([name, ...rest]) => {
    const rows = rest.map(l => {
      const m = l.match(/^([^：]+)：\s*(.*)$/);
      return m ? `<div><dt>${esc(m[1])}</dt><dd>${esc(m[2])}</dd></div>` : `<div><dt>地址</dt><dd>${esc(l)}</dd></div>`;
    }).join('');
    return `<article class="church reveal"><h3>${esc(name.replace('信望愛福音會', ''))}<small>${esc('信望愛福音會')}</small></h3><dl class="facts">${rows}</dl></article>`;
  };
  const body = pagehead({ crumbs: CRUMB, title: '其他堂會', lead: '信望愛福音會另有兩間堂會。' }) +
    sec({ id: 'churches', label: '堂會', body: `<div class="church-grid">${list.map(card).join('')}</div>
      <p class="mission reveal">${esc(mission.replace(/『|』/g, ''))}</p><p class="src">地址、電話及同工按 2026 年 10 月 25 日主日報告整理；崇拜時間沿用原網站。以各堂最新公布為準。</p>` });
  return page({ path: '/about/churches/', title: '其他堂會', description: '信望愛福音會旺角堂及北角堂的地址、電話及崇拜時間。', body });
}

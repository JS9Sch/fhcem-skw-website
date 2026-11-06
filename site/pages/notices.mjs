import content from '../data/content.mjs';
import documents from '../data/documents.mjs';
import { page, pagehead, sec, esc, external } from '../lib/layout.mjs';
import { DOCS, stormCard, docList } from '../lib/blocks.mjs';
import { statSync } from 'node:fs';

const CRUMB = [['/notices/', '教會通告']];
const kb = file => Math.round(statSync(new URL('../../public' + file, import.meta.url)).size / 1024);

// Reading version of each PDF, ported from the Codex reader (public/documents.js).
function sections(slug) {
  const c = documents;
  if (slug === 'weather') return {
    date: '教會 2026 年 11 月提供的指引', intro: '適用於八號或以上熱帶氣旋警告及黑色暴雨警告信號。', numbered: true,
    items: c.weather.map((s, i) => ({ id: 'part-' + (i + 1), label: s.title, html: `<p>${esc(s.text)}</p>` })),
  };
  if (slug === 'recreation' || slug === 'weddings-funerals') {
    const labels = slug === 'recreation'
      ? ['主日崇拜時段', '203 室聚會安排', '團契聚會時段', '暫停使用的安排', '借用及歸還', '設施用途與意見']
      : ['教牧、執事及直系親屬', '出席會友婚嫁喜宴', '出席會友及親屬喪禮'];
    return {
      date: slug === 'recreation' ? '文件日期：2011 年 11 月 18 日' : '原文件未標示日期',
      intro: slug === 'recreation' ? '信望愛福音會筲箕灣堂康樂設施使用守則，共六項。' : '聯堂會務指引：本會處理婚嫁喜宴及喪事指引，共三項。',
      numbered: true,
      items: c[slug].map((text, i) => ({ id: 'rule-' + (i + 1), label: labels[i], html: `<p>${esc(text)}</p>` })),
    };
  }
  const { paid, exempt } = c.copyright;
  return {
    date: '教會 2026 年 11 月提供的名單', intro: '教會詩歌版權涉及的機構。版權費用由教會處理，不在網站列出。',
    items: [
      { id: 'paid', label: `需付版權費的機構（${paid.length} 個）`, html: `<ol class="terms">${paid.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` },
      { id: 'exempt', label: `豁免版權費用的機構（${exempt.length} 個）`, html: `<ol class="terms">${exempt.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` },
    ],
  };
}

export function noticesPage() {
  const body = pagehead({ title: '教會通告', lead: '聚會安排及教會指引。每份文件都可以在網頁閱讀，部分另附原本的 PDF。' }) +
    sec({ id: 'now', label: '聚會安排', body: `<div class="notices">${stormCard(documents)}<div class="reveal">${docList({ skip: ['weather'] })}</div></div>` }) +
    sec({ id: 'pdf', label: '原文件', body: `<ul class="pdfs reveal">${DOCS.filter(d => d.file).map(d => `<li><a href="${d.file}" target="_blank" rel="noopener"><b>${d.title}</b><small>PDF・${kb(d.file)} KB</small>${external}<span class="vh">（在新分頁開啟）</span></a></li>`).join('')}</ul>` });
  return page({ path: '/notices/', title: '教會通告', description: '信望愛福音會筲箕灣堂的颱風及暴雨聚會安排、詩歌版權、康樂設施守則及聯會指引。', body });
}

export function documentPage(slug) {
  const doc = DOCS.find(d => d.slug === slug);
  const s = sections(slug);
  const pdf = doc.file ? `<div class="cta"><a class="btn" href="${doc.file}" target="_blank" rel="noopener">開啟原文件（PDF・${kb(doc.file)} KB）${external}<span class="vh">（在新分頁開啟）</span></a><a class="link" href="${doc.file}" download>下載 PDF</a></div>` : '';
  const about = doc.file
    ? '<p>依原 PDF 整理段落和表格，部分小標題是為方便查閱而加上。金額、條款及聚會安排都是原文件內容；現行適用版本仍待教會確認。可開啟原文件核對。</p>'
    : '<p>內容照錄教會 2026 年 11 月提供的文字，小標題是為方便查閱而加上。</p>';
  const body = pagehead({ crumbs: CRUMB, title: doc.title, lead: esc(s.intro), note: `<p class="ph-meta">${s.date}</p>${pdf}` }) +
    `<div class="reader">
      <nav class="toc" aria-label="文件目錄"><h2>目錄</h2><ol>${s.items.map(i => `<li><a href="#${i.id}">${esc(i.label)}</a></li>`).join('')}</ol></nav>
      <article class="doc">${s.items.map((i, n) => `<section id="${i.id}" class="doc-part reveal" aria-labelledby="${i.id}-h"><h2 id="${i.id}-h">${s.numbered ? `<span class="no">${n + 1}</span>` : ''}${esc(i.label)}</h2>${i.html}</section>`).join('')}
        <aside class="about-version"><b>關於這個閱讀版本</b>${about}</aside>
      </article>
    </div>`;
  return page({ path: `/notices/${slug}/`, title: doc.title, description: `${doc.title}（信望愛福音會筲箕灣堂教會通告）。`, body });
}

export function covidPage() {
  const lines = content.covid.split('\n').map(s => s.trim()).filter(Boolean).slice(1);
  // Re-join the date that the original page split across two lines.
  const text = lines.join('\n').replace('(28/2\n/2023更新)', '(28/2/2023更新)').split('\n');
  const html = text.map(l => /^[一二三四五六七八九十]、$/.test(l) ? `<h3>${l}</h3>` : `<p>${esc(l)}</p>`).join('');
  const body = pagehead({ crumbs: CRUMB, title: '聯會有關疫情通告', lead: '2023 年 2 月 28 日更新。', note: '<p class="archive-flag"><span class="tag">歷史存檔</span>此通告保留作紀錄，並非現行防疫或聚會指引。</p>' }) +
    `<div class="reader single"><article class="prose reveal">${html}</article></div>`;
  return page({ path: '/notices/covid-2023/', title: '聯會有關疫情通告（2023 年）', description: '信望愛福音會聯會 2023 年 2 月 28 日疫情通告（歷史存檔）。', body });
}

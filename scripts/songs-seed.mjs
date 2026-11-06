// LOCAL ONLY: fake 詩歌庫 data for `wrangler dev` with SONGS_FAKE_DRIVE=1.
// Reads song names from the review sheet (CSV, kept outside this public repo), picks N songs,
// and prints SQL that fills the songs tables and the fake Drive with small placeholder PDFs
// (not real scores). Two loose PDFs are left in 網站／詩歌庫 for 重新掃描.
//
// usage: node scripts/songs-seed.mjs <review.csv> [N=20] > /tmp/songs-seed.sql
//        npx wrangler d1 execute ATT_DB --local --file /tmp/songs-seed.sql
import { readFileSync } from 'node:fs';
import { FAKE_SCHEMA, FOLDER_MIME } from '../src/drive.js';
import { cleanKey, fileName, folderName, ROOT_PATH } from '../src/songs-core.js';

const [csvPath, countText = '20'] = process.argv.slice(2);
if (!csvPath) { console.error('usage: node scripts/songs-seed.mjs <review.csv> [N]'); process.exit(2); }
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows; return body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}
const rows = parseCsv(readFileSync(csvPath, 'utf8')).filter(r => (r['你的修改（留空＝同意）'] || '') !== '不匯入');
const n = Math.min(Number(countText) || 20, rows.length), step = rows.length / n;
const picked = Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
if (!picked.some(r => !r['中文歌名（建議）'])) { const en = rows.find(r => !r['中文歌名（建議）'] && r['英文歌名']); if (en) picked[picked.length - 1] = en; }

const q = s => `'${String(s).replace(/'/g, "''")}'`;
// A one-page PDF saying it is a placeholder (ASCII only, Helvetica).
function placeholderPdf(label) {
  const text = `Placeholder score (local test) - ${label}`.replace(/[()\\]/g, ' ');
  const stream = `BT /F1 20 Tf 60 760 Td (${text}) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>', `<</Length ${stream.length}>>stream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
let idn = 0; const fid = () => 'fake-seed' + String(++idn).padStart(11, '0');
const sql = [...FAKE_SCHEMA.map(s => s + ';')], t0 = Date.parse('2026-10-01T02:00:00Z');
const file = (parent, name, mime, bytes) => { const id = fid(); sql.push(`INSERT INTO fake_drive_files (id, name, parent, mime, size, created) VALUES (${q(id)}, ${q(name)}, ${q(parent)}, ${q(mime)}, ${bytes ? bytes.length : 0}, '2026-10-01T00:00:00Z');`); if (bytes) sql.push(`INSERT INTO fake_drive_chunks (id, seq, data) VALUES (${q(id)}, 0, ${q(bytes.toString('base64'))});`); return id; };
let parent = 'root';
ROOT_PATH.forEach((name, i) => { parent = file(parent, name, FOLDER_MIME); sql.push(`INSERT INTO drive_folders (path, drive_id) VALUES (${q(ROOT_PATH.slice(0, i + 1).join('/'))}, ${q(parent)});`); });
const root = parent;
picked.forEach((r, i) => {
  const zh = r['中文歌名（建議）'] || '', en = r['英文歌名'] || '', kind = r['類型'] === '鼓譜' ? 'drum' : 'score', key = cleanKey(r['調（估計）']) || '';
  const at = new Date(t0 + i * 36 * 3600e3).toISOString(), id = i + 1, name = folderName(zh || en);
  const folder = file(root, name, FOLDER_MIME);
  sql.push(`INSERT INTO drive_folders (path, drive_id) VALUES (${q([...ROOT_PATH, name].join('/'))}, ${q(folder)});`);
  sql.push(`INSERT INTO songs (id, title_zh, title_en, folder_id, created_at, updated_at, updated_role) VALUES (${id}, ${q(zh)}, ${q(en)}, ${q(folder)}, ${q(at)}, ${q(at)}, '網站管理員');`);
  const pdf = placeholderPdf(`#${id} ${kind} ${key}`), drive = file(folder, fileName(kind, key), 'application/pdf', pdf);
  sql.push(`INSERT INTO song_files (song_id, kind, song_key, drive_id, size, created_at, created_role) VALUES (${id}, ${q(kind)}, ${q(key)}, ${q(drive)}, ${pdf.length}, ${q(at)}, '網站管理員');`);
});
// Loose files for 重新掃描 Drive.
for (const name of ['掃描 2026-11-01 主日詩歌.pdf', 'scan0042.pdf']) file(root, name, 'application/pdf', placeholderPdf(name.replace(/[^\x20-\x7e]/g, '')));
console.log(sql.join('\n'));
console.error(`${picked.length} songs, ${idn} fake Drive items`);

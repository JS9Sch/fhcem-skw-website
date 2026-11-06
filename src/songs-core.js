// 詩歌庫 rules with no I/O: title clean-up, sort order, search, Drive file names.
// Shared by src/songs.js and the node:test suite.

// Chinese titles in stroke order (ICU zh-Hant / zh-HK default collation is stroke count),
// then songs with only an English title, A–Z.
const zh = new Intl.Collator('zh-HK');
const en = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const HAN = /\p{Script=Han}/u;

// Leading catalogue numbers and punctuation are not part of the name: "0002 我心所慕" → "我心所慕".
const LEADING = /^[\s\p{P}\p{S}\d０-９]+/u;
export const stripLeading = s => String(s ?? '').normalize('NFKC').replace(LEADING, '').trim();
// Search form: NFKC (full-width → half-width), lower case, no spaces / punctuation / symbols.
export const searchForm = s => stripLeading(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

export function cleanTitle(s, max = 60) {
  if (typeof s !== 'string') return '';
  const t = s.normalize('NFKC').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t.length > max ? null : t;
}
// Folder names on Drive: no slashes or control characters (Drive allows most others).
export const folderName = s => String(s).replace(/[\\/]/g, '／').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);

export const hasChinese = song => HAN.test(song.title_zh || '');
export function compareSongs(a, b) {
  const az = hasChinese(a), bz = hasChinese(b);
  if (az !== bz) return az ? -1 : 1;
  const ka = az ? stripLeading(a.title_zh) : stripLeading(a.title_en || a.title_zh);
  const kb = bz ? stripLeading(b.title_zh) : stripLeading(b.title_en || b.title_zh);
  return (az ? zh.compare(ka, kb) : en.compare(ka, kb)) || a.id - b.id;
}
export const sortSongs = list => [...list].sort(compareSongs);

// Exact name first, then names that start with the query, then names containing it;
// within each group the normal (stroke) order. Matches Chinese and English titles.
export function searchSongs(list, query) {
  const q = searchForm(query);
  if (!q) return sortSongs(list);
  const rank = song => {
    let best = 9;
    for (const t of [song.title_zh, song.title_en]) {
      const f = searchForm(t);
      if (!f) continue;
      if (f === q) best = Math.min(best, 0);
      else if (f.startsWith(q)) best = Math.min(best, 1);
      else if (f.includes(q)) best = Math.min(best, 2);
    }
    return best;
  };
  return list.map(s => [rank(s), s]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || compareSongs(a[1], b[1])).map(([, s]) => s);
}

// 調: one of the 12 major keys written the usual way (B♭, F♯…), optional minor "m"; '' = none.
const KEY = /^([A-Ga-g])([b♭#♯]?)(m?)$/;
export function cleanKey(s) {
  if (s === undefined || s === null) return '';
  if (typeof s !== 'string') return null;
  const t = s.normalize('NFKC').trim().replace(/\s*調$/, '').trim();
  if (!t) return '';
  const m = KEY.exec(t);
  return m ? m[1].toUpperCase() + ({ b: '♭', '♭': '♭', '#': '♯', '♯': '♯' }[m[2]] || '') + m[3] : null;
}
export const KINDS = { score: '樂譜', drum: '鼓譜' };
// Drive layout: 網站／詩歌庫／<歌名>／樂譜（G調）.pdf, 鼓譜.pdf, 原檔／, 舊版／; 網站／詩歌庫／已刪除／.
export const ROOT_PATH = ['網站', '詩歌庫'];
export const OLD_FOLDER = '舊版', ORIGINALS_FOLDER = '原檔', DELETED_FOLDER = '已刪除';
export const fileLabel = (kind, key) => KINDS[kind] + (key ? `（${key}調）` : '');
export const fileName = (kind, key) => fileLabel(kind, key) + '.pdf';
// "2026-11-06 2215" in Hong Kong time, used to keep moved copies apart.
export function stamp(now) {
  const t = new Date(now + 8 * 3600 * 1000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 13)}${t.slice(14, 16)}`;
}
export const oldName = (kind, key, now) => `${fileLabel(kind, key)} ${stamp(now)}.pdf`;
export const deletedName = (title, kind, key, now) => `${folderName(title)}－${fileLabel(kind, key)} ${stamp(now)}.pdf`;
// What the member sees when downloading: "奇異恩典－樂譜（G調）.pdf".
export const downloadName = (title, kind, key) => `${folderName(title)}－${fileName(kind, key)}`;

export const MAX_UPLOAD = 20 * 1024 * 1024, MAX_PHOTOS = 10;
export const isPdf = bytes => bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
// Phone photos kept in 原檔/: JPEG, PNG, HEIC/HEIF, WebP.
export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  const tag = String.fromCharCode(...bytes.slice(4, 12));
  if (/^ftyp(heic|heix|mif1|msf1|hevc)/.test(tag)) return { mime: 'image/heic', ext: 'heic' };
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
// RFC 6266 / 5987 header for non-ASCII names.
export function disposition(type, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

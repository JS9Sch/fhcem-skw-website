// 詩歌庫: title rules, stroke-order sort, search, then the API against an in-memory D1
// (node:sqlite) with the fake Drive, and the Google back end against a mocked Google.
// No network, no Cloudflare or Google account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stripLeading, searchForm, sortSongs, searchSongs, cleanKey, cleanTitle, cleanVersion, cleanTags, fileLabel, deletedName, fileName, oldName, downloadName, disposition, isPdf, imageType, MAX_UPLOAD } from '../src/songs-core.js';
import { songsApi, googleApi, songAccess, STATE_COOKIE } from '../src/songs.js';
import { googleDrive, sealToken, unsealToken, refreshToken } from '../src/drive.js';
import { sessionCookie } from '../src/auth.js';
import { respond } from '../src/router.js';

const MIGRATIONS = ['0001_attendance.sql', '0002_songs.sql', '0003_song_versions.sql'].map(f => readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON'); for (const m of MIGRATIONS) db.exec(m);
  const plain = r => r === undefined ? null : { ...r };
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async col => { const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    sync: () => db.prepare(sql).run(...args),
  });
  return { prepare: sql => statement(sql), batch: async list => { db.exec('BEGIN'); try { const out = list.map(s => s.sync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }, raw: db };
}
const BASE = 'https://preview.example', NOW = Date.parse('2026-11-06T22:15:00+08:00');
function environment(extra = {}) {
  const records = new Map();
  return {
    PREVIEW_PASSWORD_HASH: createHash('sha256').update('test-only').digest('hex'), PREVIEW_SESSION_SECRET: randomBytes(32).toString('hex'),
    ATTENDANCE_ADMIN_CODE_HASH: 'a'.repeat(32) + ':' + 'b'.repeat(64), ATT_DB: d1(), SONGS_FAKE_DRIVE: '1',
    SESSIONS: { idFromName: id => id, get: id => ({ create: async e => records.set(id, e), active: async e => records.get(id) === e, revoke: async () => records.delete(id) }) },
    ASSETS: { fetch: async () => new Response('asset') }, ...extra,
  };
}
const cookieFor = async (env, role) => (await sessionCookie(env, Date.now(), { role, version: role === 'staff' ? 1 : 0 })).split(';')[0];
async function asStaff(env) { await env.ATT_DB.prepare("UPDATE settings SET value = ? WHERE key = 'staff_password'").bind(JSON.stringify({ salt: 'c'.repeat(32), hash: 'd'.repeat(64), version: 1 })).run(); }
function client(env, cookie) {
  return async (method, path, body, { origin = BASE, type, headers = {} } = {}) => {
    const h = { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...headers };
    let payload;
    if (body instanceof Uint8Array) { payload = body; h['Content-Type'] = type || 'application/pdf'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await songsApi(new Request(BASE + '/api/songs/' + path, { method, headers: h, body: payload }), env, { now: NOW });
    const ct = r.headers.get('Content-Type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
}
const pdf = text => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
// Every fake-Drive item as a path, e.g. "網站/詩歌庫/奇異恩典/樂譜（G調）.pdf".
function drivePaths(env) {
  const rows = env.ATT_DB.raw.prepare('SELECT id, name, parent FROM fake_drive_files').all(), byId = new Map(rows.map(r => [r.id, r]));
  const path = r => (byId.has(r.parent) ? path(byId.get(r.parent)) + '/' : '') + r.name;
  return rows.map(path).sort();
}

test('titles: numbers and punctuation in front are ignored; search form is width- and case-blind', () => {
  assert.equal(stripLeading('0002 我心所慕(這是天父世界)'), '我心所慕(這是天父世界)');
  assert.equal(stripLeading('（12）、主啊'), '主啊');
  assert.equal(searchForm('God Will  Make a Way!'), 'godwillmakeaway');
  assert.equal(searchForm('ＡＢＣ　１２３'), 'abc123');
  assert.equal(searchForm('主，我願'), '主我願');
  assert.equal(cleanTitle('  奇異\n恩典 '), '奇異 恩典');
  assert.equal(cleanTitle('長'.repeat(61)), null);
});

test('sort: Chinese titles by stroke count (zh-HK), English-only titles after, A–Z', () => {
  const list = [{ id: 1, title_zh: '讚美之泉', title_en: '' }, { id: 2, title_zh: '', title_en: 'Amazing Grace' }, { id: 3, title_zh: '一顆謙卑的心', title_en: '' },
    { id: 4, title_zh: '0002 我心所慕', title_en: '' }, { id: 5, title_zh: '主啊賜下靈火', title_en: '' }, { id: 6, title_zh: '', title_en: 'bridal march' }, { id: 7, title_zh: '人生', title_en: '' }];
  assert.deepEqual(sortSongs(list).map(s => s.id), [3, 7, 5, 4, 1, 2, 6]); // 一(1) 人(2) 主(5) 我(7) 讚(26); then A, b
});

test('search: exact first, then starts-with, then contains; Chinese or English title', () => {
  const list = [{ id: 1, title_zh: '主啊，我願', title_en: '' }, { id: 2, title_zh: '主', title_en: '' }, { id: 3, title_zh: '讚美主', title_en: 'Praise the Lord' },
    { id: 4, title_zh: '0002 我心所慕(這是天父世界)', title_en: '' }, { id: 5, title_zh: '', title_en: 'God Will Make a Way' }];
  assert.deepEqual(searchSongs(list, '主').map(s => s.id), [2, 1, 3]);
  assert.deepEqual(searchSongs(list, '我心所慕').map(s => s.id), [4]);
  assert.deepEqual(searchSongs(list, '這是天父世界').map(s => s.id), [4]);
  assert.deepEqual(searchSongs(list, 'god will').map(s => s.id), [5]);
  assert.deepEqual(searchSongs(list, 'PRAISE').map(s => s.id), [3]);
  assert.deepEqual(searchSongs(list, '主啊我願').map(s => s.id), [1]); // punctuation in the title ignored
  assert.deepEqual(searchSongs(list, '找不到'), []);
  assert.equal(searchSongs(list, '  ').length, 5);
});

test('keys, names and file checks', () => {
  assert.equal(cleanKey('G'), 'G'); assert.equal(cleanKey('bb'), 'B♭'); assert.equal(cleanKey('F#'), 'F♯'); assert.equal(cleanKey('Am'), 'Am');
  assert.equal(cleanKey('E♭調'), 'E♭'); assert.equal(cleanKey(''), ''); assert.equal(cleanKey('H'), null); assert.equal(cleanKey('G major'), null);
  assert.equal(fileName('score', 'G'), '樂譜（G調）.pdf'); assert.equal(fileName('drum', ''), '鼓譜.pdf'); assert.equal(fileName('score', ''), '樂譜.pdf');
  assert.equal(oldName('score', 'G', NOW), '樂譜（G調） 2026-11-06 2215.pdf');
  assert.equal(downloadName('奇異恩典', 'score', 'B♭'), '奇異恩典－樂譜（B♭調）.pdf');
  assert.match(disposition('attachment', '奇異恩典－樂譜.pdf'), /^attachment; filename="[^"]+"; filename\*=UTF-8''%E5%A5%87/);
  assert.ok(isPdf(pdf('x'))); assert.ok(!isPdf(jpeg()));
  assert.equal(imageType(jpeg()).mime, 'image/jpeg'); assert.equal(imageType(pdf('x')), null);
});

test('版本 and 標籤: clean-up rules and file names', () => {
  assert.equal(cleanVersion(undefined), ''); assert.equal(cleanVersion(''), ''); assert.equal(cleanVersion(' 標準 '), '');
  assert.equal(cleanVersion(' 簡譜 '), '簡譜'); assert.equal(cleanVersion('ＡＬＴＯ'), 'ALTO'); assert.equal(cleanVersion('粵語  版'), '粵語 版');
  assert.equal(cleanVersion('長'.repeat(16)), '長'.repeat(16)); assert.equal(cleanVersion('長'.repeat(17)), null);
  assert.equal(cleanVersion('a/b'), null); assert.equal(cleanVersion('a\\b'), null); assert.equal(cleanVersion('a\u0001'), null); assert.equal(cleanVersion(3), null);
  assert.equal(fileLabel('score', 'G', '簡譜'), '樂譜（簡譜）（G調）'); assert.equal(fileName('score', '', ''), '樂譜.pdf'); assert.equal(fileName('drum', '', '前奏'), '鼓譜（前奏）.pdf');
  assert.equal(oldName('score', 'G', NOW, '鋼琴'), '樂譜（鋼琴）（G調） 2026-11-06 2215.pdf');
  assert.equal(deletedName('奇異恩典', 'score', 'G', NOW, '和弦'), '奇異恩典－樂譜（和弦）（G調） 2026-11-06 2215.pdf');
  assert.equal(downloadName('奇異恩典', 'score', 'B♭', 'Alto'), '奇異恩典－樂譜（Alto）（B♭調）.pdf');
  assert.deepEqual(cleanTags([]), []); assert.deepEqual(cleanTags([' 其他 ', '其他', 'ＡＢ']), ['其他', 'AB']);
  assert.deepEqual(cleanTags(['a', 'b', 'c', 'd', 'e', 'e']), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(cleanTags(['a', 'b', 'c', 'd', 'e', 'f']), null); assert.equal(cleanTags(['']), null); assert.equal(cleanTags(['長'.repeat(13)]), null);
  assert.deepEqual(cleanTags(['長'.repeat(12)]), ['長'.repeat(12)]); assert.equal(cleanTags('其他'), null); assert.equal(cleanTags([1]), null);
  // Search also finds tags, after every title match.
  const list = [{ id: 1, title_zh: '其他的愛', title_en: '', tags: [] }, { id: 2, title_zh: '主', title_en: '', tags: ['其他'] }, { id: 3, title_zh: '讚美', title_en: '', tags: ['只有鼓譜'] }];
  assert.deepEqual(searchSongs(list, '其他').map(s => s.id), [1, 2]);
  assert.deepEqual(searchSongs(list, '鼓譜').map(s => s.id), [3]);
});

test('versions: same 類型 and 調, different 版本 sit side by side; replace and restore stay within one version', async () => {
  const env = environment(); await asStaff(env);
  const member = client(env, await cookieFor(env, 'member')), staff = client(env, await cookieFor(env, 'staff'));
  const id = (await staff('POST', 'song', { title_zh: '奇異恩典' })).data.song.id;
  const std = await staff('POST', `upload?song=${id}&kind=score&key=G`, pdf('std'));
  const jianpu = await staff('POST', `upload?song=${id}&kind=score&key=G&version=${encodeURIComponent('簡譜')}`, pdf('jianpu'));
  assert.equal(jianpu.status, 201); assert.equal(jianpu.data.replaced, null); assert.equal(jianpu.data.file.version, '簡譜');
  const piano = await staff('POST', `upload?song=${id}&kind=score&key=G&version=${encodeURIComponent('鋼琴')}`, pdf('piano'));
  assert.equal(piano.data.replaced, null);
  // 「標準」 is the same as no version: it replaces the standard file only.
  const std2 = await staff('POST', `upload?song=${id}&kind=score&key=G&version=${encodeURIComponent('標準')}`, pdf('std2'));
  assert.equal(std2.data.replaced, std.data.file.id); assert.equal(std2.data.file.version, '');
  const jianpu2 = await staff('POST', `upload?song=${id}&kind=score&key=G&version=${encodeURIComponent(' 簡譜 ')}`, pdf('jianpu2'));
  assert.equal(jianpu2.data.replaced, jianpu.data.file.id);
  assert.equal((await staff('POST', `upload?song=${id}&kind=score&key=G&version=a%2Fb`, pdf('x'))).data.error, 'invalid_version');
  const shown = (await member('GET', 'song?id=' + id)).data;
  assert.deepEqual(shown.files.map(f => [f.key, f.version]), [['G', ''], ['G', '簡譜'], ['G', '鋼琴']]); // 標準 first
  const old = (await staff('GET', 'song?id=' + id)).data.old;
  assert.deepEqual(old.map(f => f.version).sort(), ['', '簡譜']);
  const paths = drivePaths(env);
  for (const p of ['樂譜（G調）.pdf', '樂譜（簡譜）（G調）.pdf', '樂譜（鋼琴）（G調）.pdf', '舊版/樂譜（G調） 2026-11-06 2215.pdf', '舊版/樂譜（簡譜）（G調） 2026-11-06 2215.pdf'])
    assert.ok(paths.includes('網站/詩歌庫/奇異恩典/' + p), p);
  assert.match((await member('GET', `download/${jianpu2.data.file.id}`)).headers.get('Content-Disposition'), /filename\*=UTF-8''.*%E7%B0%A1%E8%AD%9C/); // 簡譜 in the name
  // Restore the old 簡譜: only 簡譜 swaps, 標準 and 鋼琴 stay.
  const back = await staff('POST', 'restore', { id: jianpu.data.file.id });
  assert.equal(back.data.replaced, jianpu2.data.file.id); assert.equal(back.data.file.version, '簡譜');
  const after = (await member('GET', 'song?id=' + id)).data.files;
  assert.deepEqual(after.map(f => f.id), [std2.data.file.id, jianpu.data.file.id, piano.data.file.id]);
  assert.equal(new TextDecoder().decode((await member('GET', `download/${jianpu.data.file.id}`)).data), new TextDecoder().decode(pdf('jianpu')));
  // Delete one version: the name in 已刪除 says which.
  await staff('DELETE', 'file', { id: piano.data.file.id });
  assert.ok(drivePaths(env).includes('網站/詩歌庫/已刪除/奇異恩典－樂譜（鋼琴）（G調） 2026-11-06 2215.pdf'));
  const row = (await member('GET', 'list')).data.songs[0];
  assert.deepEqual(row.keys, ['G']); assert.deepEqual(row.versions, ['簡譜']);
  // Attach a scanned PDF as a version.
  const { fakeDrive } = await import('../src/drive.js');
  const root = env.ATT_DB.raw.prepare("SELECT drive_id FROM drive_folders WHERE path = '網站/詩歌庫'").get().drive_id;
  const loose = await fakeDrive(env.ATT_DB).upload(root, 'scan 002.pdf', 'application/pdf', pdf('loose'));
  assert.equal((await staff('POST', 'attach', { drive_id: loose.id, song: id, kind: 'score', key: 'G', version: 3 })).data.error, 'invalid_version');
  const filed = await staff('POST', 'attach', { drive_id: loose.id, song: id, kind: 'score', key: 'G', version: '前奏' });
  assert.equal(filed.status, 201); assert.equal(filed.data.replaced, null);
  assert.ok(drivePaths(env).includes('網站/詩歌庫/奇異恩典/樂譜（前奏）（G調）.pdf'));
});

test('tags: set on create and edit, kept when not sent, listed with counts, searchable', async () => {
  const env = environment(); await asStaff(env);
  const member = client(env, await cookieFor(env, 'member')), staff = client(env, await cookieFor(env, 'staff'));
  assert.equal((await staff('POST', 'song', { title_zh: '甲', tags: '其他' })).data.error, 'invalid_tags');
  assert.equal((await staff('POST', 'song', { title_zh: '甲', tags: ['1', '2', '3', '4', '5', '6'] })).data.error, 'invalid_tags');
  const a = (await staff('POST', 'song', { title_zh: '平安', title_en: 'Peace', copyright: 'X', copyright_guess: false, note: '', tags: ['其他', ' 其他 '] })).data.song;
  assert.deepEqual(a.tags, ['其他']);
  const b = (await staff('POST', 'song', { title_zh: '讚美' })).data.song;
  assert.deepEqual(b.tags, []);
  await staff('POST', 'song', { title_zh: '鼓聲', tags: ['只有鼓譜', '其他'] });
  const kept = await staff('PATCH', 'song', { id: a.id, note: '改了' });
  assert.deepEqual(kept.data.song.tags, ['其他']);
  const cleared = await staff('PATCH', 'song', { id: a.id, tags: [] });
  assert.deepEqual(cleared.data.song.tags, []);
  await staff('PATCH', 'song', { id: b.id, tags: ['其他'] });
  const list = (await member('GET', 'list')).data;
  assert.deepEqual(list.tags, [{ name: '其他', count: 2 }, { name: '只有鼓譜', count: 1 }]);
  assert.deepEqual(list.songs.find(s => s.id === b.id).tags, ['其他']);
  assert.deepEqual((await member('GET', 'list?q=' + encodeURIComponent('鼓譜'))).data.songs.map(s => s.title_zh), ['鼓聲']);
  assert.deepEqual((await member('GET', 'list?q=' + encodeURIComponent('其他'))).data.songs.map(s => s.title_zh).sort(), ['讚美', '鼓聲'].sort());
  assert.deepEqual((await member('GET', 'song?id=' + b.id)).data.song.tags, ['其他']);
});

test('permissions live in one function: 會友 view, 同工／管理員 edit, only 管理員 connects Drive', () => {
  assert.deepEqual(songAccess(null), { view: false, edit: false, admin: false, who: '會友' });
  assert.deepEqual(songAccess({ role: 'member' }), { view: true, edit: false, admin: false, who: '會友' });
  assert.deepEqual(songAccess({ role: 'staff' }), { view: true, edit: true, admin: false, who: '傳道同工' });
  assert.deepEqual(songAccess({ role: 'admin' }), { view: true, edit: true, admin: true, who: '網站管理員' });
});

test('API: login needed, 會友 read-only, writes need Origin, 同工 make a song', async () => {
  const env = environment(); await asStaff(env);
  const anon = client(env), member = client(env, await cookieFor(env, 'member')), staff = client(env, await cookieFor(env, 'staff'));
  assert.equal((await anon('GET', 'list')).status, 401);
  const list = await member('GET', 'list');
  assert.equal(list.status, 200); assert.deepEqual(list.data.can, { edit: false, admin: false }); assert.equal(list.data.total, 0);
  assert.equal((await member('POST', 'song', { title_zh: '奇異恩典' })).status, 403);
  assert.equal((await member('POST', 'upload?song=1&kind=score&key=G', pdf('a'))).status, 403);
  assert.equal((await member('GET', 'scan')).status, 403);
  assert.equal((await staff('POST', 'song', { title_zh: '奇異恩典' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await staff('POST', 'song', { title_zh: '' })).data.error, 'title_required');
  assert.equal((await staff('POST', 'song', { title_zh: 'Amazing' })).data.error, 'invalid_title_zh');
  const made = await staff('POST', 'song', { title_zh: '奇異恩典', title_en: 'Amazing Grace', copyright: 'Public Domain', copyright_guess: true });
  assert.equal(made.status, 201); assert.equal(made.data.song.updated_role, '傳道同工'); assert.equal(made.data.song.copyright_guess, true);
  const dup = await staff('POST', 'song', { title_zh: '  奇異恩典！' });
  assert.equal(dup.status, 409); assert.equal(dup.data.song.id, made.data.song.id);
  assert.equal((await member('GET', 'song?id=' + made.data.song.id)).data.song.title_en, 'Amazing Grace');
  assert.equal((await member('GET', 'song?id=999')).status, 404);
});

test('upload, replace (舊版), view/download, photos (原檔), delete (已刪除), restore', async () => {
  const env = environment(); await asStaff(env);
  const member = client(env, await cookieFor(env, 'member')), staff = client(env, await cookieFor(env, 'staff')), admin = client(env, await cookieFor(env, 'admin'));
  const id = (await staff('POST', 'song', { title_zh: '0002 我心所慕' })).data.song.id;
  assert.equal((await staff('POST', `upload?song=${id}&kind=score&key=G`, jpeg(), { type: 'application/pdf' })).data.error, 'not_pdf');
  assert.equal((await staff('POST', `upload?song=${id}&kind=score&key=H`, pdf('a'))).data.error, 'invalid_key');
  assert.equal((await staff('POST', `upload?song=${id}&kind=lyrics&key=G`, pdf('a'))).data.error, 'invalid_kind');
  assert.equal((await staff('POST', `upload?song=${id}&kind=score&key=G`, pdf('a'), { headers: { 'Content-Length': String(MAX_UPLOAD + 1) } })).status, 413);
  const big = new Uint8Array(MAX_UPLOAD + 1); big.set(pdf('big'));
  assert.equal((await staff('POST', `upload?song=${id}&kind=score&key=G`, big)).status, 413);
  const first = await staff('POST', `upload?song=${id}&kind=score&key=G`, pdf('first'));
  assert.equal(first.status, 201); assert.equal(first.data.replaced, null);
  await staff('POST', `upload?song=${id}&kind=drum&key=`, pdf('drum'));
  const second = await admin('POST', `upload?song=${id}&kind=score&key=G&photos=2`, pdf('second'));
  assert.equal(second.data.replaced, first.data.file.id); assert.equal(second.data.file.created_role, '網站管理員');
  assert.equal((await admin('POST', `original?file=${second.data.file.id}&seq=1`, jpeg(), { type: 'image/jpeg' })).status, 201);
  assert.equal((await admin('POST', `original?file=${second.data.file.id}&seq=2`, jpeg(), { type: 'image/jpeg' })).status, 201);
  assert.equal((await admin('POST', `original?file=${second.data.file.id}&seq=3`, jpeg(), { type: 'image/jpeg' })).data.error, 'invalid_seq');
  assert.equal((await admin('POST', `original?file=${second.data.file.id}&seq=1`, pdf('x'), { type: 'image/jpeg' })).data.error, 'not_image');
  assert.deepEqual(drivePaths(env), ['網站', '網站/詩歌庫', '網站/詩歌庫/0002 我心所慕', '網站/詩歌庫/0002 我心所慕/原檔',
    '網站/詩歌庫/0002 我心所慕/原檔/樂譜（G調） 2026-11-06 相片1.jpg', '網站/詩歌庫/0002 我心所慕/原檔/樂譜（G調） 2026-11-06 相片2.jpg',
    '網站/詩歌庫/0002 我心所慕/樂譜（G調）.pdf', '網站/詩歌庫/0002 我心所慕/舊版', '網站/詩歌庫/0002 我心所慕/舊版/樂譜（G調） 2026-11-06 2215.pdf',
    '網站/詩歌庫/0002 我心所慕/鼓譜.pdf']);
  // 會友 see the shown files only; 同工 also see 舊版.
  const seen = await member('GET', 'song?id=' + id), seenStaff = await staff('GET', 'song?id=' + id);
  assert.deepEqual(seen.data.files.map(f => [f.kind, f.key]), [['score', 'G'], ['drum', '']]); assert.deepEqual(seen.data.old, []);
  assert.equal(seenStaff.data.old.length, 1);
  const view = await member('GET', `pdf/${second.data.file.id}/x.pdf`);
  assert.equal(view.status, 200); assert.equal(new TextDecoder().decode(view.data), new TextDecoder().decode(pdf('second')));
  assert.match(view.headers.get('Content-Disposition'), /^inline; filename="0002 [_G]+\.pdf"; filename\*=UTF-8''0002%20%E6%88%91/); // the title as typed
  const down = await member('GET', `download/${second.data.file.id}`);
  assert.match(down.headers.get('Content-Disposition'), /^attachment;/); assert.equal(down.headers.get('Content-Type'), 'application/pdf');
  assert.equal((await member('GET', `pdf/${first.data.file.id}/x.pdf`)).status, 404); // old version: 同工 only
  assert.equal((await staff('GET', `pdf/${first.data.file.id}/x.pdf`)).status, 200);
  assert.equal((await client(env)('GET', `download/${second.data.file.id}`)).status, 401);
  // Restore the old one: it is shown again and the newer one goes to 舊版.
  const back = await staff('POST', 'restore', { id: first.data.file.id });
  assert.equal(back.data.replaced, second.data.file.id);
  assert.equal(new TextDecoder().decode((await member('GET', `download/${first.data.file.id}`)).data), new TextDecoder().decode(pdf('first')));
  // Delete: moved to 已刪除, nothing erased.
  assert.equal((await member('DELETE', 'file', { id: first.data.file.id })).status, 403);
  assert.equal((await staff('DELETE', 'file', { id: first.data.file.id })).status, 200);
  assert.ok(drivePaths(env).includes('網站/詩歌庫/已刪除/0002 我心所慕－樂譜（G調） 2026-11-06 2215.pdf'));
  assert.equal((await member('GET', `download/${first.data.file.id}`)).status, 404);
  assert.equal(env.ATT_DB.raw.prepare('SELECT count(*) AS n FROM fake_drive_files').get().n, drivePaths(env).length);
  // Delete the song: every shown file to 已刪除, song hidden.
  const gone = await staff('DELETE', 'song', { id });
  assert.equal(gone.data.files, 1);
  assert.equal((await member('GET', 'list')).data.total, 0);
  assert.equal(drivePaths(env).filter(p => p.startsWith('網站/詩歌庫/已刪除/')).length, 2);
});

test('list: stroke order, English after, search over the API, 最近加入 newest first', async () => {
  const env = environment(); await asStaff(env);
  const staff = client(env, await cookieFor(env, 'staff')), member = client(env, await cookieFor(env, 'member'));
  for (const [zh, en] of [['讚美之泉', ''], ['', 'Amazing Grace'], ['一顆謙卑的心', ''], ['主啊賜下靈火', 'Lord send the fire']]) {
    const id = (await staff('POST', 'song', { title_zh: zh, title_en: en })).data.song.id;
    await staff('POST', `upload?song=${id}&kind=score&key=C`, pdf(zh || en));
  }
  const all = (await member('GET', 'list')).data;
  assert.deepEqual(all.songs.map(s => s.title_zh || s.title_en), ['一顆謙卑的心', '主啊賜下靈火', '讚美之泉', 'Amazing Grace']);
  assert.deepEqual(all.songs[0].keys, ['C']); assert.equal(all.songs[0].score, true); assert.equal(all.songs[0].drum, false);
  assert.deepEqual((await member('GET', 'list?q=' + encodeURIComponent('lord send'))).data.songs.map(s => s.title_zh), ['主啊賜下靈火']);
  assert.equal(all.recent.length, 4);
});

test('重新掃描: loose PDFs in 詩歌庫 are listed and can be filed under a song', async () => {
  const env = environment(); await asStaff(env);
  const staff = client(env, await cookieFor(env, 'staff'));
  const id = (await staff('POST', 'song', { title_zh: '我心所慕' })).data.song.id;
  assert.deepEqual((await staff('GET', 'scan')).data.files, []);
  // Someone puts a PDF straight into 網站／詩歌庫 (fake Drive).
  const { fakeDrive } = await import('../src/drive.js');
  const drive = fakeDrive(env.ATT_DB), root = env.ATT_DB.raw.prepare("SELECT drive_id FROM drive_folders WHERE path = '網站/詩歌庫'").get().drive_id;
  const loose = await drive.upload(root, 'scan 001.pdf', 'application/pdf', pdf('loose'));
  await drive.upload(root, 'photo.jpg', 'image/jpeg', jpeg());
  const found = (await staff('GET', 'scan')).data.files;
  assert.deepEqual(found.map(f => f.name), ['scan 001.pdf']);
  assert.deepEqual((await staff('POST', 'scan', { ids: [loose.id, 'fake-doesnotexist00000'] })).data.files.map(f => f.id), [loose.id]);
  const filed = await staff('POST', 'attach', { drive_id: loose.id, song: id, kind: 'score', key: 'D' });
  assert.equal(filed.status, 201);
  assert.ok(drivePaths(env).includes('網站/詩歌庫/我心所慕/樂譜（D調）.pdf'));
  assert.deepEqual((await staff('GET', 'scan')).data.files, []);
  assert.equal((await staff('POST', 'attach', { drive_id: loose.id, song: id, kind: 'score', key: 'D' })).data.error, 'already_filed');
});

test('連接 Google Drive (fake mode): admin only, state + Lax cookie, token sealed in D1', async () => {
  const env = environment(); await asStaff(env);
  const call = async (path, cookie) => googleApi(new Request(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }), env, { now: NOW });
  assert.equal((await call('/api/google/connect')).status, 401);
  assert.equal((await call('/api/google/connect', await cookieFor(env, 'staff'))).status, 403);
  const start = await call('/api/google/connect', await cookieFor(env, 'admin'));
  assert.equal(start.status, 302);
  const location = start.headers.get('Location'), nonce = /__Host-fhcem_gstate=([a-f0-9]{32});.*SameSite=Lax/.exec(start.headers.get('Set-Cookie'))[1];
  assert.match(location, /^\/api\/google\/callback\?code=fake-local-code&state=/);
  assert.equal((await call(location)).status, 400); // no state cookie: not this browser
  assert.equal((await call(location.replace(/state=[^&]+/, 'state=' + 'f'.repeat(32) + '.9999999999.' + '0'.repeat(64)), `${STATE_COOKIE}=${nonce}`)).status, 400);
  const done = await call(location, `${STATE_COOKIE}=${nonce}`);
  assert.equal(done.status, 200); assert.match(await done.text(), /已連接 Google Drive.*url=\/members\/songs\/\?tab=admin&google=connected|url=\/members\/songs\/\?tab=admin&amp;google=connected|已連接/s);
  const stored = JSON.parse(env.ATT_DB.raw.prepare("SELECT value FROM settings WHERE key = 'google_drive'").get().value);
  assert.ok(!JSON.stringify(stored).includes('fake-refresh-')); // only the sealed form is stored
  assert.match((await refreshToken(env)).token, /^fake-refresh-/);
  const status = await client(env, await cookieFor(env, 'admin'))('GET', 'drive');
  assert.equal(status.data.mode, 'fake'); assert.equal(status.data.source, 'd1'); assert.equal(status.data.email, 'fake-drive@localhost');
  assert.equal((await client(env, await cookieFor(env, 'staff'))('GET', 'drive')).data.email, undefined);
  assert.equal((await client(env, await cookieFor(env, 'member'))('GET', 'drive')).status, 403);
});

test('sealed token: AES-GCM, wrong secret cannot read it', async () => {
  const sealed = await sealToken('1//refresh-token', 'k'.repeat(40));
  assert.equal(await unsealToken(sealed, 'k'.repeat(40)), '1//refresh-token');
  assert.equal(await unsealToken(sealed, 'x'.repeat(40)), null);
});

// A tiny stand-in for Google's token and Drive endpoints, to check the requests we make.
function mockGoogle() {
  const calls = [], files = new Map([['root', { id: 'root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder', parents: [] }]]);
  let n = 0, refreshes = 0;
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', auth = init.headers?.Authorization;
    calls.push({ method, url: u.origin + u.pathname, query: Object.fromEntries(u.searchParams), auth, headers: init.headers || {} });
    const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (u.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') === 'authorization_code') return ok({ refresh_token: 'new-refresh', access_token: 'a0', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
      refreshes++; return ok({ access_token: 'access-' + refreshes, expires_in: 3600 });
    }
    if (auth !== 'Bearer access-' + refreshes && !u.pathname.startsWith('/upload-session')) return new Response('', { status: 401 });
    if (u.pathname === '/drive/v3/about') return ok({ user: { emailAddress: 'handler@church.example' } });
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const m = /^name = '(.+)' and '(.+)' in parents/.exec(u.searchParams.get('q')) || [];
      const p = /^'(.+)' in parents/.exec(u.searchParams.get('q'));
      const list = [...files.values()].filter(f => m[1] ? f.name === m[1] && f.parents.includes(m[2]) : p && f.parents.includes(p[1]));
      return ok({ files: list });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') { const b = JSON.parse(init.body), id = 'folder' + (++n) + 'xxxxxxxx'; files.set(id, { id, ...b }); return ok({ id }); }
    if (u.pathname === '/upload/drive/v3/files') { const b = JSON.parse(init.body), id = 'file' + (++n) + 'xxxxxxxxxx'; files.set(id, { id, ...b, mimeType: init.headers['X-Upload-Content-Type'] }); return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload-session/' + id } }); }
    if (u.pathname.startsWith('/upload-session/')) { const f = files.get(u.pathname.split('/').pop()); f.bytes = new Uint8Array(init.body); return ok({ id: f.id, name: f.name, size: String(f.bytes.length) }); }
    const fm = /^\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (fm) {
      const f = files.get(decodeURIComponent(fm[1]));
      if (!f) return new Response('', { status: 404 });
      if (method === 'PATCH') {
        const b = JSON.parse(init.body); if (b.name) f.name = b.name;
        if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
        return ok({ id: f.id, name: f.name });
      }
      if (u.searchParams.get('alt') === 'media') return new Response(f.bytes, { headers: { 'Content-Type': f.mimeType, 'Content-Length': String(f.bytes.length) } });
      return ok({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.bytes?.length || 0), parents: f.parents, trashed: false });
    }
    return new Response('unexpected ' + method + ' ' + url, { status: 500 });
  };
  return { fetcher, calls, files };
}

test('Google back end: consent URL, code exchange, refresh, resumable upload, move with parents', async () => {
  const env = environment({ SONGS_FAKE_DRIVE: '', GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-a-secret' });
  await asStaff(env);
  const g = mockGoogle(), admin = await cookieFor(env, 'admin');
  const start = await googleApi(new Request(BASE + '/api/google/connect', { headers: { Cookie: admin } }), env, { now: NOW, fetcher: g.fetcher });
  const consent = new URL(start.headers.get('Location'));
  assert.equal(consent.origin + consent.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(consent.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(consent.searchParams.get('redirect_uri'), BASE + '/api/google/callback');
  assert.equal(consent.searchParams.get('access_type'), 'offline'); assert.equal(consent.searchParams.get('prompt'), 'consent');
  const nonce = /=([a-f0-9]{32});/.exec(start.headers.get('Set-Cookie'))[1];
  const back = await googleApi(new Request(`${BASE}/api/google/callback?code=4/abc&state=${consent.searchParams.get('state')}`, { headers: { Cookie: `${STATE_COOKIE}=${nonce}` } }), env, { now: NOW, fetcher: g.fetcher });
  assert.equal(back.status, 200);
  assert.equal((await refreshToken(env)).token, 'new-refresh');
  assert.equal(JSON.parse(env.ATT_DB.raw.prepare("SELECT value FROM settings WHERE key = 'google_drive'").get().value).email, 'handler@church.example');
  // Upload through the API with the Google back end.
  const staff = await cookieFor(env, 'staff');
  const api = (method, path, body, type) => songsApi(new Request(BASE + '/api/songs/' + path, { method, headers: { Cookie: staff, Origin: BASE, 'Content-Type': type || 'application/json' }, body }), env, { now: NOW, fetcher: g.fetcher });
  const id = (await (await api('POST', 'song', JSON.stringify({ title_zh: "主's 愛" }))).json()).song.id;
  const up1 = await (await api('POST', `upload?song=${id}&kind=score&key=G`, pdf('one'), 'application/pdf')).json();
  const up2 = await api('POST', `upload?song=${id}&kind=score&key=G`, pdf('two'), 'application/pdf');
  assert.equal(up2.status, 201);
  const start2 = g.calls.find(c => c.url.endsWith('/upload/drive/v3/files'));
  assert.equal(start2.query.uploadType, 'resumable'); assert.equal(start2.headers['X-Upload-Content-Type'], 'application/pdf');
  assert.ok(g.calls.some(c => c.method === 'GET' && /name = '主\\'s 愛'/.test(c.query.q || ''))); // quote escaped in the Drive query
  const move = g.calls.find(c => c.method === 'PATCH');
  assert.ok(move.query.addParents && move.query.removeParents);
  const old = g.files.get((env.ATT_DB.raw.prepare('SELECT drive_id FROM song_files WHERE id = ?').get(up1.file.id)).drive_id);
  assert.equal(old.name, '樂譜（G調） 2026-11-06 2215.pdf');
  assert.equal(g.calls.filter(c => c.url === 'https://oauth2.googleapis.com/token').length, 3); // exchange, refresh for about, one refresh reused for all uploads
  // Reading streams the Drive bytes back.
  const cur = env.ATT_DB.raw.prepare("SELECT id FROM song_files WHERE state = 'current'").get().id;
  const r = await api('GET', `download/${cur}`);
  assert.equal(new TextDecoder().decode(await r.arrayBuffer()), new TextDecoder().decode(pdf('two')));
  // Without any Google settings the library is shown but files say "not connected".
  const bare = environment({ SONGS_FAKE_DRIVE: '' }); await asStaff(bare);
  const s2 = client(bare, await cookieFor(bare, 'staff'));
  const sid = (await s2('POST', 'song', { title_zh: '測試' })).data.song.id;
  assert.equal((await s2('POST', `upload?song=${sid}&kind=score&key=`, pdf('x'))).data.error, 'drive_not_connected');
  assert.equal((await s2('GET', 'list')).status, 200);
});

test('router: /api/songs/* behind the login, /members/songs/ still the member page', async () => {
  const env = environment(), files = { memberScript: 'js', memberHTML: '<html>' };
  assert.equal((await respond(new Request(BASE + '/api/songs/list'), env, files)).status, 401);
  const member = await cookieFor(env, 'member');
  const r = await respond(new Request(BASE + '/api/songs/list', { headers: { Cookie: member } }), env, files);
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal((await respond(new Request(BASE + '/members/songs/', { headers: { Cookie: member } }), env, files)).status, 200);
  assert.equal((await respond(new Request(BASE + '/api/google/connect', { headers: { Cookie: member } }), env, files)).status, 403);
});

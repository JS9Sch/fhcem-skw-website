// /api/songs/* — 詩歌庫. Song details in D1 (ATT_DB), PDFs in the church's Google Drive
// (src/drive.js; a fake Drive in local development). /api/google/* — the admin's
// 「連接 Google Drive」 button (OAuth, redirect /api/google/callback).
import { authenticated } from './auth.js';
import { roleName } from './unit-access.js';
import { openDrive, driveMode, storedConnection, saveConnection, refreshToken, accessGrant, consentUrl, exchangeCode, DriveError, FOLDER_MIME } from './drive.js';
import { cleanTitle, cleanKey, cleanVersion, cleanTags, parseTags, folderName, sortSongs, searchSongs, searchForm, KINDS, ROOT_PATH, OLD_FOLDER, ORIGINALS_FOLDER, DELETED_FOLDER, fileName, oldName, deletedName, downloadName, disposition, MAX_UPLOAD, MAX_PHOTOS, isPdf, imageType, hasChinese } from './songs-core.js';

// ---- the one place that decides who may do what (trial period, decisions Q13) ----
// Any signed-in 會友 may look and download; 同工 and 管理員 may upload, edit and delete;
// only 管理員 connects Google Drive. A phone holding only a roll-call link gets nothing.
// When personal logins arrive, change this function only.
export function songAccess(session) {
  const role = session?.role;
  return {
    view: role === 'member' || role === 'staff' || role === 'admin',
    edit: role === 'staff' || role === 'admin',
    admin: role === 'admin',
    who: role === 'staff' || role === 'admin' ? roleName({ role }) : '會友',
  };
}

class Fail extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; } }
const fail = (status, code, extra) => { throw new Fail(status, code, extra); };
const reply = (request, data, status = 200, headers = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const iso = now => new Date(now).toISOString();
const db = env => env.ATT_DB;

async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'content_type');
  const text = await request.text();
  if (text.length > 8192) fail(413, 'too_large');
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  fail(400, 'invalid_request');
}
// Uploads are the raw file bytes (one request per file), never parsed as a form.
async function readBytes(request, max = MAX_UPLOAD) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > max) fail(413, 'too_large');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > max) fail(413, 'too_large');
  if (!bytes.length) fail(400, 'empty_file');
  return bytes;
}

// ---- songs ----
const SONG_COLUMNS = 'id, title_zh, title_en, copyright, copyright_guess, note, created_at, updated_at, updated_role';
async function songRow(env, id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return db(env).prepare("SELECT * FROM songs WHERE id = ? AND state = 'active'").bind(n).first();
}
const title = s => s.title_zh || s.title_en;
const songOut = s => ({ id: s.id, title_zh: s.title_zh, title_en: s.title_en, copyright: s.copyright, copyright_guess: !!s.copyright_guess, note: s.note, tags: parseTags(s.tags), created_at: s.created_at, updated_at: s.updated_at, updated_role: s.updated_role });
const fileOut = f => ({ id: f.id, kind: f.kind, kind_name: KINDS[f.kind], key: f.song_key, version: f.version, size: f.size, photos: f.photos, state: f.state, created_at: f.created_at, created_role: f.created_role, changed_at: f.changed_at, changed_role: f.changed_role });

async function listSongs(ctx) {
  const rows = (await db(ctx.env).prepare(`SELECT s.id, s.title_zh, s.title_en, s.tags, s.created_at,
      (SELECT json_group_array(json_object('kind', f.kind, 'key', f.song_key, 'version', f.version)) FROM song_files f WHERE f.song_id = s.id AND f.state = 'current') AS files,
      (SELECT max(f.created_at) FROM song_files f WHERE f.song_id = s.id AND f.state = 'current') AS added
    FROM songs s WHERE s.state = 'active'`).all()).results;
  const summary = r => {
    const files = JSON.parse(r.files || '[]');
    return { id: r.id, title_zh: r.title_zh, title_en: r.title_en, tags: parseTags(r.tags), keys: [...new Set(files.filter(f => f.kind === 'score').map(f => f.key).filter(Boolean))],
      versions: [...new Set(files.map(f => f.version).filter(Boolean))], score: files.some(f => f.kind === 'score'), drum: files.some(f => f.kind === 'drum'), added: r.added || r.created_at };
  };
  const all = rows.map(summary), q = ctx.url.searchParams.get('q') || '';
  const recent = [...all].sort((a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : b.id - a.id)).slice(0, 20);
  // Every tag in use with its count; the page filters by tag itself (it already has all songs).
  const tags = new Map();
  for (const s of all) for (const t of s.tags) tags.set(t, (tags.get(t) || 0) + 1);
  return [{ can: { edit: ctx.access.edit, admin: ctx.access.admin }, total: all.length, query: q, songs: q ? searchSongs(all, q) : sortSongs(all), recent,
    tags: [...tags].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-HK')) }];
}
async function getSong(ctx) {
  const s = await songRow(ctx.env, ctx.url.searchParams.get('id'));
  if (!s) fail(404, 'song_not_found');
  const states = ctx.access.edit ? "('current', 'old')" : "('current')";
  const files = (await db(ctx.env).prepare(`SELECT * FROM song_files WHERE song_id = ? AND state IN ${states} ORDER BY state = 'old', kind = 'drum', song_key, version <> '', version, created_at DESC`).bind(s.id).all()).results;
  return [{ can: { edit: ctx.access.edit, admin: ctx.access.admin }, song: songOut(s), files: files.filter(f => f.state === 'current').map(fileOut), old: files.filter(f => f.state === 'old').map(fileOut) }];
}
// Title rules: at least one of 中文／英文; the Chinese title (or the English one when there is
// no Chinese title) names the Drive folder, so it must be unique.
function songFields(body, old = {}) {
  const pick = (k, max) => { if (body[k] === undefined) return old[k] ?? ''; const v = cleanTitle(body[k], max); if (v === null) fail(400, 'invalid_' + k); return v; };
  const out = { title_zh: pick('title_zh', 60), title_en: pick('title_en', 80), copyright: pick('copyright', 60), note: pick('note', 300),
    copyright_guess: body.copyright_guess === undefined ? (old.copyright_guess ?? 0) : body.copyright_guess ? 1 : 0 };
  if (body.tags === undefined) out.tags = old.tags ?? '[]';
  else { const tags = cleanTags(body.tags); if (tags === null) fail(400, 'invalid_tags'); out.tags = JSON.stringify(tags); }
  if (!out.title_zh && !out.title_en) fail(400, 'title_required');
  if (out.title_zh && !hasChinese(out) ) fail(400, 'invalid_title_zh');
  return out;
}
async function duplicateOf(env, fields, exceptId = 0) {
  const want = searchForm(fields.title_zh || fields.title_en);
  const rows = (await db(env).prepare("SELECT id, title_zh, title_en FROM songs WHERE state = 'active' AND id <> ?").bind(exceptId).all()).results;
  return rows.find(r => searchForm(r.title_zh || r.title_en) === want) || null;
}
async function createSong(ctx) {
  const fields = songFields(ctx.body), dup = await duplicateOf(ctx.env, fields);
  if (dup) fail(409, 'duplicate_title', { song: { id: dup.id, title_zh: dup.title_zh, title_en: dup.title_en } });
  const t = iso(ctx.now);
  const r = await db(ctx.env).prepare('INSERT INTO songs (title_zh, title_en, copyright, copyright_guess, note, tags, created_at, updated_at, updated_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(fields.title_zh, fields.title_en, fields.copyright, fields.copyright_guess, fields.note, fields.tags, t, t, ctx.access.who).run();
  return [{ song: songOut(await songRow(ctx.env, r.meta.last_row_id)) }, 201];
}
async function editSong(ctx) {
  const s = await songRow(ctx.env, ctx.body.id);
  if (!s) fail(404, 'song_not_found');
  const fields = songFields(ctx.body, s), dup = await duplicateOf(ctx.env, fields, s.id);
  if (dup) fail(409, 'duplicate_title', { song: { id: dup.id, title_zh: dup.title_zh, title_en: dup.title_en } });
  if (s.folder_id && title(fields) !== title(s)) {
    const drive = ctx.drive();
    await drive.rename(s.folder_id, folderName(title(fields)));
    await db(ctx.env).prepare('DELETE FROM drive_folders WHERE drive_id = ?').bind(s.folder_id).run();
  }
  await db(ctx.env).prepare('UPDATE songs SET title_zh = ?, title_en = ?, copyright = ?, copyright_guess = ?, note = ?, tags = ?, updated_at = ?, updated_role = ? WHERE id = ?')
    .bind(fields.title_zh, fields.title_en, fields.copyright, fields.copyright_guess, fields.note, fields.tags, iso(ctx.now), ctx.access.who, s.id).run();
  return [{ song: songOut(await songRow(ctx.env, s.id)) }];
}
// Deleting a song moves every shown file to 已刪除 (nothing is erased) and hides the song.
async function deleteSong(ctx) {
  const s = await songRow(ctx.env, ctx.body.id);
  if (!s) fail(404, 'song_not_found');
  const files = (await db(ctx.env).prepare("SELECT * FROM song_files WHERE song_id = ? AND state = 'current'").bind(s.id).all()).results;
  for (const f of files) await trashFile(ctx, s, f);
  await db(ctx.env).prepare("UPDATE songs SET state = 'deleted', updated_at = ?, updated_role = ? WHERE id = ?").bind(iso(ctx.now), ctx.access.who, s.id).run();
  return [{ deleted: s.id, files: files.length }];
}

// ---- Drive folders ----
async function folderAt(ctx, names) {
  const drive = ctx.drive();
  let parent = drive.rootId;
  for (let i = 0; i < names.length; i++) {
    const path = names.slice(0, i + 1).join('/');
    const cached = await db(ctx.env).prepare('SELECT drive_id FROM drive_folders WHERE path = ?').bind(path).first();
    if (cached) { parent = cached.drive_id; continue; }
    parent = await drive.folder(parent, names[i]);
    await db(ctx.env).prepare('INSERT INTO drive_folders (path, drive_id) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET drive_id = ?2').bind(path, parent).run();
  }
  return parent;
}
async function songFolder(ctx, s) {
  if (s.folder_id) return s.folder_id;
  const id = await folderAt(ctx, [...ROOT_PATH, folderName(title(s))]);
  await db(ctx.env).prepare('UPDATE songs SET folder_id = ? WHERE id = ?').bind(id, s.id).run();
  s.folder_id = id;
  return id;
}
const subFolder = (ctx, s, name) => songFolder(ctx, s).then(parent => ctx.drive().folder(parent, name));
// Someone removed a folder on Drive: forget the cached ids and try once more.
async function retryingFolders(ctx, s, work) {
  try { return await work(); } catch (e) {
    if (!(e instanceof DriveError) || e.code !== 'drive_file_missing') throw e;
    await db(ctx.env).prepare('DELETE FROM drive_folders').run();
    await db(ctx.env).prepare('UPDATE songs SET folder_id = NULL WHERE id = ?').bind(s.id).run();
    s.folder_id = null;
    return work();
  }
}

// The shown file of one 類型, 調 and 版本 (at most one, see migrations 0003).
const currentFile = (env, songId, kind, key, version) => db(env).prepare("SELECT * FROM song_files WHERE song_id = ? AND kind = ? AND song_key = ? AND version = ? AND state = 'current'").bind(songId, kind, key, version).first();
// Put a PDF in place as the shown 樂譜／鼓譜 of this key and version; the one it replaces goes
// to 舊版/. Other versions are not touched.
async function placeFile(ctx, s, { kind, key, version }, { bytes, driveId, photos = 0 }) {
  const drive = ctx.drive(), name = fileName(kind, key, version);
  const current = await currentFile(ctx.env, s.id, kind, key, version);
  const placed = await retryingFolders(ctx, s, async () => {
    const folder = await songFolder(ctx, s);
    if (bytes) return drive.upload(folder, name, 'application/pdf', bytes);
    const m = await drive.move(driveId, folder, name);
    return { id: m.id, size: Number((await drive.meta(driveId)).size || 0) };
  });
  const t = iso(ctx.now), who = ctx.access.who, statements = [];
  if (current) {
    await drive.move(current.drive_id, await subFolder(ctx, s, OLD_FOLDER), oldName(kind, key, ctx.now, version));
    statements.push(db(ctx.env).prepare("UPDATE song_files SET state = 'old', changed_at = ?, changed_role = ? WHERE id = ?").bind(t, who, current.id));
  }
  statements.push(db(ctx.env).prepare('INSERT INTO song_files (song_id, kind, song_key, version, drive_id, size, photos, state, created_at, created_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(s.id, kind, key, version, placed.id, placed.size, photos, 'current', t, who));
  statements.push(db(ctx.env).prepare('UPDATE songs SET updated_at = ?, updated_role = ? WHERE id = ?').bind(t, who, s.id));
  await db(ctx.env).batch(statements);
  const row = await db(ctx.env).prepare('SELECT * FROM song_files WHERE drive_id = ?').bind(placed.id).first();
  return { file: fileOut(row), replaced: current ? current.id : null };
}
// 類型, 調 and 版本 (optional; '' or 「標準」 = the standard file).
function slotOf(params) {
  const kind = params.get('kind'), key = cleanKey(params.get('key') ?? ''), version = cleanVersion(params.get('version') ?? '');
  if (!Object.hasOwn(KINDS, kind || '')) fail(400, 'invalid_kind');
  if (key === null) fail(400, 'invalid_key');
  if (version === null) fail(400, 'invalid_version');
  return { kind, key, version };
}
// POST /api/songs/upload?song=&kind=score|drum&key=G&version=簡譜&photos=n — body: the PDF itself.
async function upload(ctx) {
  const p = ctx.url.searchParams, s = await songRow(ctx.env, p.get('song'));
  if (!s) fail(404, 'song_not_found');
  const slot = slotOf(p);
  const photos = Number(p.get('photos') || 0);
  if (!Number.isInteger(photos) || photos < 0 || photos > MAX_PHOTOS) fail(400, 'too_many_photos');
  if (!(ctx.request.headers.get('Content-Type') || '').startsWith('application/pdf')) fail(415, 'not_pdf');
  const bytes = await readBytes(ctx.request);
  if (!isPdf(bytes)) fail(415, 'not_pdf');
  return [await placeFile(ctx, s, slot, { bytes, photos }), 201];
}
// POST /api/songs/original?file=&seq=1 — body: one phone photo, kept in the song's 原檔/.
async function original(ctx) {
  const p = ctx.url.searchParams, f = await db(ctx.env).prepare("SELECT * FROM song_files WHERE id = ? AND state = 'current'").bind(Number(p.get('file')) || 0).first();
  if (!f) fail(404, 'file_not_found');
  const seq = Number(p.get('seq'));
  if (!Number.isInteger(seq) || seq < 1 || seq > Math.max(1, f.photos)) fail(400, 'invalid_seq');
  const bytes = await readBytes(ctx.request), type = imageType(bytes);
  if (!type) fail(415, 'not_image');
  const s = await songRow(ctx.env, f.song_id);
  const folder = await subFolder(ctx, s, ORIGINALS_FOLDER);
  const name = `${fileName(f.kind, f.song_key, f.version).replace(/\.pdf$/, '')} ${new Date(ctx.now + 8 * 3600e3).toISOString().slice(0, 10)} 相片${seq}.${type.ext}`;
  const up = await ctx.drive().upload(folder, name, type.mime, bytes);
  await db(ctx.env).prepare('INSERT INTO song_originals (file_id, drive_id, seq, created_at) VALUES (?, ?, ?, ?)').bind(f.id, up.id, seq, iso(ctx.now)).run();
  return [{ original: { file: f.id, seq } }, 201];
}
async function trashFile(ctx, s, f) {
  const deleted = await folderAt(ctx, [...ROOT_PATH, DELETED_FOLDER]);
  await ctx.drive().move(f.drive_id, deleted, deletedName(title(s), f.kind, f.song_key, ctx.now, f.version));
  await db(ctx.env).prepare("UPDATE song_files SET state = 'deleted', changed_at = ?, changed_role = ? WHERE id = ?").bind(iso(ctx.now), ctx.access.who, f.id).run();
}
// DELETE /api/songs/file {id}: the shown file or an old version goes to 已刪除 (not erased).
async function deleteFile(ctx) {
  const f = await db(ctx.env).prepare("SELECT * FROM song_files WHERE id = ? AND state IN ('current', 'old')").bind(Number(ctx.body.id) || 0).first();
  if (!f) fail(404, 'file_not_found');
  await trashFile(ctx, await songRow(ctx.env, f.song_id), f);
  return [{ deleted: f.id }];
}
// POST /api/songs/restore {id}: an old file becomes the shown file of its 版本 again; the shown one goes to 舊版.
async function restoreFile(ctx) {
  const f = await db(ctx.env).prepare("SELECT * FROM song_files WHERE id = ? AND state = 'old'").bind(Number(ctx.body.id) || 0).first();
  if (!f) fail(404, 'file_not_found');
  const s = await songRow(ctx.env, f.song_id), drive = ctx.drive(), t = iso(ctx.now), who = ctx.access.who;
  const current = await currentFile(ctx.env, s.id, f.kind, f.song_key, f.version);
  if (current) await drive.move(current.drive_id, await subFolder(ctx, s, OLD_FOLDER), oldName(f.kind, f.song_key, ctx.now, f.version));
  await drive.move(f.drive_id, await songFolder(ctx, s), fileName(f.kind, f.song_key, f.version));
  const statements = [];
  if (current) statements.push(db(ctx.env).prepare("UPDATE song_files SET state = 'old', changed_at = ?, changed_role = ? WHERE id = ?").bind(t, who, current.id));
  statements.push(db(ctx.env).prepare("UPDATE song_files SET state = 'current', changed_at = ?, changed_role = ? WHERE id = ?").bind(t, who, f.id));
  await db(ctx.env).batch(statements);
  return [{ file: fileOut(await db(ctx.env).prepare('SELECT * FROM song_files WHERE id = ?').bind(f.id).first()), replaced: current ? current.id : null }];
}

// ---- reading PDFs ----
// GET /api/songs/pdf/<id>/<name>.pdf (view in the browser) and /api/songs/download/<id>.
async function servePdf(ctx, attachment) {
  const id = Number(ctx.url.pathname.split('/')[4]);
  const states = ctx.access.edit ? "('current', 'old')" : "('current')";
  const f = Number.isSafeInteger(id) && await db(ctx.env).prepare(`SELECT f.*, s.title_zh, s.title_en FROM song_files f JOIN songs s ON s.id = f.song_id WHERE f.id = ? AND f.state IN ${states} AND s.state = 'active'`).bind(id).first();
  if (!f) fail(404, 'file_not_found');
  const drive = ctx.drive();
  // Opened PDFs are kept a short while in the Cloudflare cache (key = Drive file id; a new
  // upload always gets a new id). Only after the login check above.
  const cache = drive.mode === 'google' && typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`${ctx.url.origin}/__songs-cache/${encodeURIComponent(f.drive_id)}`);
  let source = cache && await cache.match(cacheKey);
  if (!source) {
    source = await drive.read(f.drive_id);
    if (cache) {
      const copy = new Response(source.body, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'max-age=3600' } });
      const put = cache.put(cacheKey, copy.clone());
      if (ctx.waitUntil) ctx.waitUntil(put); else await put;
      source = copy;
    }
  }
  const name = downloadName(title(f), f.kind, f.song_key, f.version);
  const headers = { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition(attachment ? 'attachment' : 'inline', name), 'Cache-Control': 'private, max-age=300' };
  if (source.headers.get('Content-Length')) headers['Content-Length'] = source.headers.get('Content-Length');
  return new Response(ctx.request.method === 'HEAD' ? null : source.body, { headers });
}

// ---- 重新掃描 Drive ----
// The website's drive.file access sees only files it made or that someone picked with Google
// Picker. GET lists loose PDFs placed straight in 網站／詩歌庫; POST {ids} checks files picked
// with Picker. Both return only files the 詩歌庫 does not know yet, to be matched to a song.
async function knownIds(env) {
  const rows = (await db(env).prepare('SELECT drive_id FROM song_files UNION SELECT drive_id FROM song_originals').all()).results;
  return new Set(rows.map(r => r.drive_id));
}
const looksPdf = f => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name || '');
async function scan(ctx) {
  const root = await folderAt(ctx, ROOT_PATH), known = await knownIds(ctx.env);
  const files = (await ctx.drive().list(root)).filter(f => f.mimeType !== FOLDER_MIME && looksPdf(f) && !known.has(f.id));
  return [{ files: files.map(f => ({ id: f.id, name: f.name, size: f.size })) }];
}
async function scanPicked(ctx) {
  const ids = ctx.body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || !ids.every(x => typeof x === 'string' && /^[\w-]{10,80}$/.test(x))) fail(400, 'invalid_ids');
  const known = await knownIds(ctx.env), out = [];
  for (const id of [...new Set(ids)]) {
    if (known.has(id)) continue;
    const m = await ctx.drive().meta(id).catch(() => null);
    if (m && !m.trashed && looksPdf(m)) out.push({ id: m.id, name: m.name, size: Number(m.size || 0) });
  }
  return [{ files: out }];
}
// POST /api/songs/attach {drive_id, song, kind, key, version}: file it under the song with the usual name.
async function attach(ctx) {
  const b = ctx.body, s = await songRow(ctx.env, b.song);
  if (!s) fail(404, 'song_not_found');
  if (b.version !== undefined && b.version !== null && typeof b.version !== 'string') fail(400, 'invalid_version');
  const slot = slotOf(new URLSearchParams({ kind: b.kind ?? '', key: b.key ?? '', version: b.version ?? '' }));
  if (typeof b.drive_id !== 'string' || !/^[\w-]{10,80}$/.test(b.drive_id)) fail(400, 'invalid_ids');
  if ((await knownIds(ctx.env)).has(b.drive_id)) fail(409, 'already_filed');
  const m = await ctx.drive().meta(b.drive_id).catch(() => null);
  if (!m || m.trashed || !looksPdf(m)) fail(404, 'file_not_found');
  return [await placeFile(ctx, s, slot, { driveId: b.drive_id }), 201];
}

// ---- Google connection (status for 同工; connect for 管理員) ----
async function driveStatus(ctx) {
  const mode = driveMode(ctx.env), stored = await storedConnection(ctx.env), refresh = mode === 'google' || mode === 'fake' ? await refreshToken(ctx.env) : null;
  const out = { mode, connected: mode === 'fake' || !!refresh, source: refresh?.source || (mode === 'fake' ? 'fake' : null), picker: mode === 'fake' || (mode === 'google' && pickerReady(ctx.env)) };
  // With the GOOGLE_REFRESH_TOKEN secret nothing is stored, so ask Google which account it is.
  let email = stored?.email || null;
  if (ctx.access.admin && !email && refresh?.source === 'secret' && mode === 'google') { try { email = (await ctx.drive().about()).email; } catch {} }
  if (ctx.access.admin) Object.assign(out, { email, connected_at: stored?.connected_at || null, canConnect: mode === 'fake' || (mode === 'google' && signingReady(ctx.env)) });
  return [out];
}
const pickerReady = env => !!(env.GOOGLE_PICKER_API_KEY && /^\d{6,20}$/.test(env.GOOGLE_PROJECT_NUMBER || ''));
// GET /api/songs/picker — what the browser needs to open Google Picker: the API key (Picker
// API only, website-restricted), the App ID (Cloud project number), a short-lived drive.file
// access token, and the 網站／詩歌庫 folder to open first. Files picked there become visible to
// the website's drive.file access; the page then sends their ids to POST /api/songs/scan.
async function picker(ctx) {
  const mode = driveMode(ctx.env);
  if (mode === 'fake') return [{ mode: 'fake' }];
  if (mode !== 'google' || !pickerReady(ctx.env)) fail(409, 'picker_not_configured');
  if (!await refreshToken(ctx.env)) fail(409, 'drive_not_connected');
  let grant;
  try { grant = await accessGrant(ctx.env, ctx.fetcher, { minLeft: 10 * 60000 }); }
  catch (e) { if (e instanceof DriveError && e.code === 'drive_not_connected') fail(409, 'drive_not_connected'); throw e; }
  const folder = await db(ctx.env).prepare('SELECT drive_id FROM drive_folders WHERE path = ?').bind(ROOT_PATH.join('/')).first();
  return [{ mode: 'google', apiKey: ctx.env.GOOGLE_PICKER_API_KEY, appId: ctx.env.GOOGLE_PROJECT_NUMBER, token: grant.token, expiresAt: new Date(grant.expires).toISOString(), folderId: folder?.drive_id || null }];
}
const signingReady = env => (env.PREVIEW_SESSION_SECRET || '').length >= 32;

const ROUTES = {
  list: { GET: listSongs }, song: { GET: getSong, POST: createSong, PATCH: editSong, DELETE: deleteSong },
  upload: { POST: upload }, original: { POST: original }, file: { DELETE: deleteFile }, restore: { POST: restoreFile },
  pdf: { GET: ctx => servePdf(ctx, false) }, download: { GET: ctx => servePdf(ctx, true) },
  scan: { GET: scan, POST: scanPicked }, attach: { POST: attach }, drive: { GET: driveStatus }, picker: { GET: picker },
};
const EDIT = new Set(['upload', 'original', 'file', 'restore', 'scan', 'attach', 'drive', 'picker']);
const RAW_BODY = new Set(['upload', 'original']);
const NEEDS_DRIVE = new Set(['upload', 'original', 'file', 'restore', 'pdf', 'download', 'scan', 'attach']);

export async function songsApi(request, env, { now = Date.now(), fetcher = globalThis.fetch, waitUntil } = {}) {
  const url = new URL(request.url), name = url.pathname.slice('/api/songs/'.length).split('/')[0];
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!route) return reply(request, { error: 'not_found' }, 404);
  const method = request.method === 'HEAD' ? 'GET' : request.method, handler = route[method];
  if (!handler) return reply(request, { error: 'method_not_allowed' }, 405, { Allow: Object.keys(route).join(', ') });
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return reply(request, { error: 'origin_not_allowed' }, 403);
  if (!env.ATT_DB) return reply(request, { error: 'unavailable' }, 503);
  try {
    const session = await authenticated(request, env), access = songAccess(session);
    if (!session) return reply(request, { error: 'authentication_required' }, 401);
    if (!access.view) return reply(request, { error: 'forbidden' }, 403);
    const editing = EDIT.has(name) || (name === 'song' && method !== 'GET');
    if (editing && !access.edit) return reply(request, { error: 'forbidden' }, 403);
    let drive;
    const ctx = { request, env, url, now, session, access, waitUntil, fetcher, body: null, drive: () => drive || (drive = openDrive(env, fetcher)) };
    if (NEEDS_DRIVE.has(name) && !ctx.drive()) return reply(request, { error: 'drive_not_connected' }, 503);
    if (method !== 'GET' && !RAW_BODY.has(name)) ctx.body = await readJson(request);
    const result = await handler(ctx);
    return result instanceof Response ? result : reply(request, ...result);
  } catch (error) {
    if (error instanceof Fail) return reply(request, { error: error.code, ...(error.extra || {}) }, error.status);
    if (error instanceof DriveError) return reply(request, { error: error.code }, error.status);
    throw error;
  }
}

// ---- /api/google/connect and /api/google/callback ----
// The callback arrives from accounts.google.com, so the SameSite=Strict login cookie is not
// sent: a signed state plus a short SameSite=Lax cookie set when the admin pressed the
// button ties the answer to that browser. The page then sends the admin back by a same-site
// link (meta refresh), where the login cookie applies again.
export const STATE_COOKIE = '__Host-fhcem_gstate';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
async function hmac(env, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PREVIEW_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('google-state.' + text)));
}
const callbackUri = (env, url) => env.GOOGLE_REDIRECT_URI || `${url.origin}/api/google/callback`;
function page(message, ok) {
  const target = '/members/songs/?tab=admin' + (ok ? '&google=connected' : '');
  const html = `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${ok ? `<meta http-equiv="refresh" content="1;url=${target}">` : ''}<title>連接 Google Drive・詩歌庫</title><link rel="stylesheet" href="/assets/site.css"></head><body><main style="max-width:32rem;margin:15vh auto;padding:0 20px;font-size:18px;line-height:1.8"><h1 style="font-size:26px">${ok ? '已連接 Google Drive' : '未能連接 Google Drive'}</h1><p>${message}</p><p><a href="${target}">返回詩歌庫管理</a></p></main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}
export async function googleApi(request, env, { now = Date.now(), fetcher = globalThis.fetch } = {}) {
  const url = new URL(request.url), mode = driveMode(env);
  if (request.method !== 'GET') return reply(request, { error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  if (!env.ATT_DB || !signingReady(env)) return reply(request, { error: 'unavailable' }, 503);
  if (url.pathname === '/api/google/connect') {
    const session = await authenticated(request, env);
    if (!songAccess(session).admin) return reply(request, { error: session ? 'forbidden' : 'authentication_required' }, session ? 403 : 401);
    if (!mode) return reply(request, { error: 'google_not_configured' }, 503);
    const nonce = hex(crypto.getRandomValues(new Uint8Array(16))), expires = Math.floor(now / 1000) + 600;
    const state = `${nonce}.${expires}.${await hmac(env, `${nonce}.${expires}`)}`;
    // Fake Drive: skip Google and answer as if the church account had pressed 「允許」.
    const location = mode === 'fake' ? `/api/google/callback?${new URLSearchParams({ code: 'fake-local-code', state })}` : consentUrl(env, callbackUri(env, url), state);
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': `${STATE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
  }
  if (url.pathname === '/api/google/callback') {
    const p = url.searchParams, m = /^([a-f0-9]{32})\.(\d{10})\.([a-f0-9]{64})$/.exec(p.get('state') || '');
    const cookie = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(STATE_COOKIE + '='))?.slice(STATE_COOKIE.length + 1);
    if (!m || Number(m[2]) < Math.floor(now / 1000) || m[3] !== await hmac(env, `${m[1]}.${m[2]}`) || cookie !== m[1]) return page('這個連接要求已過期或不是由這部裝置發出。請在詩歌庫管理頁再按「連接 Google Drive」。', false);
    if (p.get('error')) return page('Google 帳戶沒有允許網站存取。如要連接，請再按一次「連接 Google Drive」並按「允許」。', false);
    const code = p.get('code');
    if (!code || code.length > 512 || !mode) return page('Google 沒有傳回授權碼。', false);
    try {
      let refresh, email = null;
      if (mode === 'fake') { if (code !== 'fake-local-code') return page('授權碼不正確。', false); refresh = 'fake-refresh-' + hex(crypto.getRandomValues(new Uint8Array(8))); email = 'fake-drive@localhost'; }
      else refresh = (await exchangeCode(env, code, callbackUri(env, url), fetcher)).refresh_token;
      await saveConnection(env, { refreshToken: refresh, email, now, role: '網站管理員' });
      if (mode === 'google') {
        email = (await openDrive(env, fetcher).about().catch(() => ({}))).email || null;
        await saveConnection(env, { refreshToken: refresh, email, now, role: '網站管理員' });
      }
      return page(`網站已連接${email ? `「${email.replace(/[<>&"]/g, '')}」的` : ''} Google Drive。正在返回詩歌庫…`, true);
    } catch (e) {
      if (e instanceof DriveError) return page(e.code === 'wrong_scope' ? '授權範圍不正確：請只允許「只限網站建立或選取的檔案」。' : 'Google 暫時未能完成授權，請稍後再試。', false);
      throw e;
    }
  }
  return reply(request, { error: 'not_found' }, 404);
}

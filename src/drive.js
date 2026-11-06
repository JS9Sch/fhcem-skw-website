// Google Drive access for 詩歌庫 (and later 月訊／週刊). Two back ends with one interface:
//   folder(parent, name)  find or create a sub-folder → id
//   upload(parent, name, mime, bytes) → {id, name, size}
//   move(id, toParent, newName)   rename(id, name)   meta(id)   list(parent)
//   read(id) → Response (the file bytes)   about() → {email}
// - Google: OAuth refresh token, scope drive.file (only files this website made or that
//   someone picked with Google Picker). Worker secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET;
//   the refresh token comes from the admin's 「連接 Google Drive」 (stored in D1, AES-GCM
//   sealed with a key derived from PREVIEW_SESSION_SECRET) or the GOOGLE_REFRESH_TOKEN secret.
// - Fake (local development and tests, SONGS_FAKE_DRIVE=1): folders and files in two extra D1
//   tables created on first use. It never talks to Google.
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function driveMode(env) {
  if (env.SONGS_FAKE_DRIVE === '1') return 'fake';
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return 'google';
  return null;
}
export function openDrive(env, fetcher = globalThis.fetch) {
  const mode = driveMode(env);
  if (mode === 'fake') return fakeDrive(env.ATT_DB);
  if (mode === 'google') return googleDrive(env, fetcher);
  return null;
}

// ---- sealed refresh token (same AES-GCM + HKDF pattern as the roll-call links) ----
const te = new TextEncoder(), td = new TextDecoder();
async function sealKey(secret) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('fhcem-google-drive-token-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
const unb64u = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function sealToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('google_drive') }, await sealKey(secret), te.encode(token));
  return b64u(iv) + '.' + b64u(new Uint8Array(data));
}
export async function unsealToken(sealed, secret) {
  try {
    const [iv, data] = String(sealed).split('.').map(unb64u);
    return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode('google_drive') }, await sealKey(secret), data));
  } catch { return null; }
}
// settings.google_drive = JSON {sealed, email, connected_at, connected_role}.
export async function storedConnection(env) {
  const row = await env.ATT_DB.prepare("SELECT value FROM settings WHERE key = 'google_drive'").first();
  try { return row?.value ? JSON.parse(row.value) : null; } catch { return null; }
}
export async function saveConnection(env, { refreshToken, email, now, role }) {
  const value = JSON.stringify({ sealed: await sealToken(refreshToken, env.PREVIEW_SESSION_SECRET), email: email || null, connected_at: new Date(now).toISOString(), connected_role: role });
  await env.ATT_DB.prepare("INSERT INTO settings (key, value) VALUES ('google_drive', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(value).run();
  tokens.clear();
}
// D1 (button) first, then the Worker secret. Returns {token, source} or null.
export async function refreshToken(env) {
  const stored = await storedConnection(env);
  const token = stored?.sealed && await unsealToken(stored.sealed, env.PREVIEW_SESSION_SECRET);
  if (token) return { token, source: 'd1' };
  return env.GOOGLE_REFRESH_TOKEN ? { token: env.GOOGLE_REFRESH_TOKEN, source: 'secret' } : null;
}

// ---- OAuth (the admin's 「連接 Google Drive」 button) ----
export function consentUrl(env, redirectUri, state) {
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
const form = data => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
export async function exchangeCode(env, code, redirectUri, fetcher = globalThis.fetch) {
  const r = await fetcher('https://oauth2.googleapis.com/token', form({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.refresh_token) throw new DriveError(r.ok ? 'no_refresh_token' : 'token_exchange_failed', 502);
  if (data.scope && !data.scope.split(' ').includes(SCOPE)) throw new DriveError('wrong_scope', 400);
  return data;
}

export class DriveError extends Error { constructor(code, status = 502) { super(code); this.code = code; this.status = status; } }

// Access tokens live about an hour; keep one per isolate.
const tokens = new Map();
// accessGrant also hands the token to Google Picker in the browser (GET /api/songs/picker):
// same drive.file scope, kept only in this isolate's memory, never in D1. minLeft: a token
// with less time left than this (ms) is replaced first.
export async function accessGrant(env, fetcher = globalThis.fetch, { force = false, minLeft = 60000 } = {}) {
  const refresh = await refreshToken(env);
  if (!refresh) throw new DriveError('drive_not_connected', 503);
  const cached = tokens.get(refresh.token);
  if (!force && cached && cached.expires > Date.now() + minLeft) return cached;
  const r = await fetcher('https://oauth2.googleapis.com/token', form({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh.token, grant_type: 'refresh_token' }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new DriveError(data.error === 'invalid_grant' ? 'drive_not_connected' : 'drive_unavailable', 503);
  const grant = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  tokens.set(refresh.token, grant);
  return grant;
}
const accessToken = async (env, fetcher, force = false) => (await accessGrant(env, fetcher, { force })).token;

export function googleDrive(env, fetcher = globalThis.fetch) {
  const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  async function call(url, init = {}, raw = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = { ...(init.headers || {}), Authorization: 'Bearer ' + await accessToken(env, fetcher, attempt > 0) };
      const r = await fetcher(url, { ...init, headers });
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) throw new DriveError(r.status === 404 ? 'drive_file_missing' : 'drive_unavailable', r.status === 404 ? 404 : 502);
      return raw ? r : r.json();
    }
  }
  const quote = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const json = body => ({ 'Content-Type': 'application/json; charset=UTF-8', body: JSON.stringify(body) });
  const patch = (id, query, body) => call(`${API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: 'id,name', ...query })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });
  return {
    mode: 'google', rootId: 'root',
    async folder(parent, name) {
      const q = `name = ${quote(name)} and ${quote(parent)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
      const found = await call(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`);
      if (found.files?.length) return found.files[0].id;
      const { body } = json({ name, mimeType: FOLDER_MIME, parents: [parent] });
      return (await call(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body })).id;
    },
    async upload(parent, name, mime, bytes) {
      // Resumable upload works for any size (multipart is meant for small files).
      const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, { method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.byteLength) },
        body: JSON.stringify({ name, parents: [parent] }) }, true);
      const session = start.headers.get('Location');
      if (!session?.startsWith('https://www.googleapis.com/')) throw new DriveError('drive_unavailable');
      const r = await fetcher(session, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
      if (!r.ok) throw new DriveError('drive_unavailable');
      const f = await r.json();
      return { id: f.id, name: f.name, size: Number(f.size ?? bytes.byteLength) };
    },
    async move(id, toParent, newName) {
      const { parents = [] } = await call(`${API}/files/${encodeURIComponent(id)}?fields=parents`);
      return patch(id, { addParents: toParent, removeParents: parents.join(',') }, newName ? { name: newName } : {});
    },
    rename: (id, name) => patch(id, {}, { name }),
    meta: id => call(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`),
    async list(parent) {
      const out = []; let pageToken;
      do {
        const q = new URLSearchParams({ q: `${quote(parent)} in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size)', pageSize: '1000', spaces: 'drive' });
        if (pageToken) q.set('pageToken', pageToken);
        const page = await call(`${API}/files?${q}`);
        out.push(...(page.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size || 0) })));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },
    read: id => call(`${API}/files/${encodeURIComponent(id)}?alt=media`, {}, true),
    async about() { return { email: (await call(`${API}/about?fields=user(emailAddress)`)).user?.emailAddress || null }; },
  };
}

// ---- fake Drive in local D1 ----
export const FAKE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS fake_drive_files (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS fake_drive_chunks (id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, seq))',
];
const CHUNK = 256 * 1024;
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const ready = new WeakSet();
export function fakeDrive(db) {
  const setup = async () => { if (!ready.has(db)) { for (const sql of FAKE_SCHEMA) await db.prepare(sql).run(); ready.add(db); } };
  const id = () => 'fake-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const row = async fid => { await setup(); const r = await db.prepare('SELECT * FROM fake_drive_files WHERE id = ?').bind(fid).first(); if (!r) throw new DriveError('drive_file_missing', 404); return r; };
  const add = async (parent, name, mime, size) => { const fid = id(); await db.prepare('INSERT INTO fake_drive_files (id, name, parent, mime, size, created) VALUES (?, ?, ?, ?, ?, ?)').bind(fid, name, parent, mime, size, new Date().toISOString()).run(); return fid; };
  return {
    mode: 'fake', rootId: 'root',
    async folder(parent, name) {
      await setup();
      const found = await db.prepare('SELECT id FROM fake_drive_files WHERE parent = ? AND name = ? AND mime = ?').bind(parent, name, FOLDER_MIME).first();
      return found ? found.id : add(parent, name, FOLDER_MIME, 0);
    },
    async upload(parent, name, mime, bytes) {
      await setup();
      const fid = await add(parent, name, mime, bytes.byteLength), view = new Uint8Array(bytes);
      for (let seq = 0, i = 0; i < view.length; seq++, i += CHUNK) await db.prepare('INSERT INTO fake_drive_chunks (id, seq, data) VALUES (?, ?, ?)').bind(fid, seq, b64(view.subarray(i, i + CHUNK))).run();
      return { id: fid, name, size: view.length };
    },
    async move(fid, toParent, newName) { const r = await row(fid); await db.prepare('UPDATE fake_drive_files SET parent = ?, name = ? WHERE id = ?').bind(toParent, newName || r.name, fid).run(); return { id: fid, name: newName || r.name }; },
    async rename(fid, name) { await row(fid); await db.prepare('UPDATE fake_drive_files SET name = ? WHERE id = ?').bind(name, fid).run(); return { id: fid, name }; },
    async meta(fid) { const r = await row(fid); return { id: r.id, name: r.name, mimeType: r.mime, size: r.size, parents: [r.parent], trashed: false }; },
    async list(parent) { await setup(); return (await db.prepare('SELECT id, name, mime, size FROM fake_drive_files WHERE parent = ? ORDER BY name').bind(parent).all()).results.map(r => ({ id: r.id, name: r.name, mimeType: r.mime, size: r.size })); },
    async read(fid) {
      const r = await row(fid);
      const parts = (await db.prepare('SELECT data FROM fake_drive_chunks WHERE id = ? ORDER BY seq').bind(fid).all()).results.map(x => unb64(x.data));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return new Response(out, { headers: { 'Content-Type': r.mime, 'Content-Length': String(out.length) } });
    },
    async about() { return { email: 'fake-drive@localhost' }; },
  };
}

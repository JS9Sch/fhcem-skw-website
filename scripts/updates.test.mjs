// 網站更新: entry clean-up rules, then /api/updates against an in-memory D1 (node:sqlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { updatesApi, updatesAccess, cleanUpdate, hkDay } from '../src/updates.js';
import { sessionCookie } from '../src/auth.js';
import { respond } from '../src/router.js';

const MIGRATIONS = ['0001_attendance.sql', '0002_songs.sql', '0003_song_versions.sql', '0004_site_updates.sql'].map(f => readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
function d1() {
  const db = new DatabaseSync(':memory:'); for (const m of MIGRATIONS) db.exec(m);
  const plain = r => r === undefined ? null : { ...r };
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: sql => statement(sql) };
}
const BASE = 'https://preview.example', NOW = Date.parse('2026-11-08T23:30:00+08:00');
function environment() {
  const records = new Map();
  return {
    PREVIEW_PASSWORD_HASH: createHash('sha256').update('test-only').digest('hex'), PREVIEW_SESSION_SECRET: randomBytes(32).toString('hex'),
    ATTENDANCE_ADMIN_CODE_HASH: 'a'.repeat(32) + ':' + 'b'.repeat(64), ATT_DB: d1(),
    SESSIONS: { idFromName: id => id, get: id => ({ create: async e => records.set(id, e), active: async e => records.get(id) === e, revoke: async () => records.delete(id) }) },
    ASSETS: { fetch: async () => new Response('asset') },
  };
}
async function staffReady(env) { await env.ATT_DB.prepare("UPDATE settings SET value = ? WHERE key = 'staff_password'").bind(JSON.stringify({ salt: 'c'.repeat(32), hash: 'd'.repeat(64), version: 1 })).run(); }
const cookieFor = async (env, role) => (await sessionCookie(env, Date.now(), { role, version: role === 'staff' ? 1 : 0 })).split(';')[0];
function client(env, cookie) {
  return async (method, query = '', body, { origin = BASE } = {}) => {
    const h = { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await updatesApi(new Request(BASE + '/api/updates' + query, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { now: NOW });
    return { status: r.status, headers: r.headers, data: await r.json() };
  };
}

test('entry rules: Hong Kong today by default, no future days, known type and area, tidy text', () => {
  assert.equal(hkDay(NOW), '2026-11-08');
  assert.equal(hkDay(Date.parse('2026-11-08T17:00:00Z')), '2026-11-09'); // 01:00 HKT next day
  assert.deepEqual(cleanUpdate({ kind: 'new', title: '  詩歌庫\t上線 ' }, NOW).value, { day: '2026-11-08', kind: 'new', area: '', title: '詩歌庫 上線', body: '' });
  assert.equal(cleanUpdate({ kind: 'new', title: 'x', day: '2026-02-30' }, NOW).error, 'invalid_day');
  assert.equal(cleanUpdate({ kind: 'new', title: 'x', day: '2026-11-20' }, NOW).error, 'future_day');
  assert.equal(cleanUpdate({ kind: 'oops', title: 'x' }, NOW).error, 'invalid_kind');
  assert.equal(cleanUpdate({ kind: 'fix', title: 'x', area: '其他地方' }, NOW).error, 'invalid_area');
  assert.equal(cleanUpdate({ kind: 'fix', title: ' ' }, NOW).error, 'title_required');
  assert.equal(cleanUpdate({ kind: 'fix', title: '字'.repeat(61) }, NOW).error, 'title_too_long');
  assert.equal(cleanUpdate({ kind: 'fix', title: 'x', body: 'a'.repeat(1201) }, NOW).error, 'body_too_long');
  assert.equal(cleanUpdate({ kind: 'fix', title: 'x', body: '第一行  \r\n\r\n\r\n\r\n・列點（全形），保留' }, NOW).value.body, '第一行\n\n・列點（全形），保留');
});

test('permissions: 會友 and 同工 read, only 管理員 writes, roll-call link gets nothing', () => {
  assert.deepEqual(updatesAccess({ role: 'member' }), { view: true, edit: false });
  assert.deepEqual(updatesAccess({ role: 'staff' }), { view: true, edit: false });
  assert.deepEqual(updatesAccess({ role: 'admin' }), { view: true, edit: true });
  assert.deepEqual(updatesAccess({ role: 'group' }), { view: false, edit: false });
  assert.deepEqual(updatesAccess(null), { view: false, edit: false });
});

test('API: login needed, 會友 read-only, writes need Origin, 管理員 add / edit / delete, newest first', async () => {
  const env = environment(); await staffReady(env);
  const anon = client(env), member = client(env, await cookieFor(env, 'member')), staff = client(env, await cookieFor(env, 'staff')), admin = client(env, await cookieFor(env, 'admin'));
  assert.equal((await anon('GET')).status, 401);
  const empty = await member('GET');
  assert.equal(empty.status, 200); assert.equal(empty.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(empty.data.can, { edit: false }); assert.deepEqual(empty.data.updates, []); assert.equal(empty.data.today, '2026-11-08');
  assert.equal((await member('POST', '', { kind: 'new', title: 'x' })).status, 403);
  assert.equal((await staff('POST', '', { kind: 'new', title: 'x' })).status, 403);
  assert.equal((await admin('POST', '', { kind: 'new', title: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await admin('POST', '', { kind: 'new', title: '' })).data.error, 'title_required');
  const a = await admin('POST', '', { day: '2026-11-06', kind: 'new', area: '團契點名', title: '團契點名上線', body: '・每團一條連結' });
  assert.equal(a.status, 201); assert.equal(a.data.update.kind_name, '新功能'); assert.equal(a.data.update.edited, false);
  const b = await admin('POST', '', { day: '2026-11-08', kind: 'improve', area: '詩歌庫', title: '歸入時可新增歌曲' });
  const c = await admin('POST', '', { day: '2026-11-06', kind: 'content', title: '更新教會資料' });
  assert.deepEqual((await member('GET')).data.updates.map(u => u.id), [b.data.update.id, c.data.update.id, a.data.update.id]);
  assert.equal((await member('PUT', '?id=' + a.data.update.id, { kind: 'new', title: 'x' })).status, 403);
  const edited = await admin('PUT', '?id=' + a.data.update.id, { day: '2026-11-06', kind: 'new', area: '團契點名', title: '團契點名開放' });
  assert.equal(edited.status, 200); assert.equal(edited.data.update.title, '團契點名開放');
  assert.equal((await admin('PUT', '?id=999', { kind: 'new', title: 'x' })).status, 404);
  assert.equal((await member('DELETE', '?id=' + c.data.update.id)).status, 403);
  assert.equal((await admin('DELETE', '?id=' + c.data.update.id)).status, 200);
  assert.equal((await admin('DELETE', '?id=' + c.data.update.id)).status, 404);
  assert.deepEqual((await member('GET')).data.updates.map(u => u.title), ['歸入時可新增歌曲', '團契點名開放']);
  const row = await env.ATT_DB.prepare('SELECT state, created_role, updated_role FROM site_updates WHERE id = ?').bind(c.data.update.id).first();
  assert.deepEqual(row, { state: 'deleted', created_role: '網站管理員', updated_role: '網站管理員' });
});

test('router: /api/updates behind the login, /members/updates/ is the member page', async () => {
  const env = environment(), files = { memberScript: 'js', memberHTML: '<html>member</html>' };
  const anon = await respond(new Request(BASE + '/api/updates'), env, files);
  assert.equal(anon.status, 401);
  const page = await respond(new Request(BASE + '/members/updates/'), env, files);
  assert.equal(page.status, 302); assert.equal(page.headers.get('Location'), '/login/?next=%2Fmembers%2Fupdates%2F');
  assert.equal((await respond(new Request(BASE + '/members/updates'), env, files)).status, 301);
  const cookie = await cookieFor(env, 'member');
  const signed = await respond(new Request(BASE + '/members/updates/', { headers: { Cookie: cookie } }), env, files);
  assert.equal(signed.status, 200); assert.equal(await signed.text(), '<html>member</html>');
  const api = await respond(new Request(BASE + '/api/updates', { headers: { Cookie: cookie } }), env, files);
  assert.equal(api.status, 200);
  assert.equal((await respond(new Request(BASE + '/api/updates', { method: 'PATCH', headers: { Cookie: cookie, Origin: BASE } }), env, files)).status, 405);
});

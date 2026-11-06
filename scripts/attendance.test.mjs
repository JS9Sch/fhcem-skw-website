// Attendance: pure rules/table tests plus the API against an in-memory D1 shim
// built on node:sqlite. No network, no Cloudflare account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { scheduledDates, weekOfMonth, lastScheduled, currentScheduled, altDates, isMoved, nearbyDates, monthTable, tableCsv, monthTitle, cleanName, normalizeCode, generateCode, total, hkToday, newLinkToken, validLinkToken } from '../src/attendance-core.js';
import { newCodeHash, readLink, LINK_COOKIE, LINK_SECONDS } from '../src/unit-access.js';
import { attendanceApi } from '../src/attendance.js';
import { sessionCookie, COOKIE } from '../src/auth.js';
import { respond } from '../src/router.js';

const MIGRATION = readFileSync(new URL('../migrations/0001_attendance.sql', import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON'); db.exec(MIGRATION);
  const plain = r => r === undefined ? null : { ...r };
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async col => { const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    sync: () => db.prepare(sql).run(...args),
  });
  return {
    prepare: sql => statement(sql),
    batch: async list => { db.exec('BEGIN'); try { const out = list.map(s => s.sync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    raw: db,
  };
}
const MEMBER_PASSWORD = 'test-only';
const ADMIN_CODE = 'ADMIN-TEST-2026';
async function environment() {
  const records = new Map(), admin = await newCodeHash(normalizeCode(ADMIN_CODE));
  let hits = 0;
  return {
    PREVIEW_PASSWORD_HASH: createHash('sha256').update(MEMBER_PASSWORD).digest('hex'), PREVIEW_SESSION_SECRET: randomBytes(32).toString('hex'),
    ATTENDANCE_ADMIN_CODE_HASH: `${admin.salt}:${admin.hash}`, ATT_DB: d1(),
    SESSIONS: { idFromName: id => id, get: id => ({ create: async e => records.set(id, e), active: async e => records.get(id) === e, revoke: async () => records.delete(id) }) },
    LOGIN_LIMITER: { limit: async () => ({ success: ++hits <= 50 }) },
    ASSETS: { fetch: async () => new Response('asset') },
  };
}
const NOW = Date.parse('2026-11-06T10:00:00+08:00'); // Friday
const BASE = 'https://preview.example';
function client(env) {
  const jar = {};
  const take = (response, cookies) => {
    const set = response.headers.get('Set-Cookie');
    if (set && cookies === jar) { const [pair] = set.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i), v = pair.slice(i + 1); if (v) jar[k] = v; else delete jar[k]; }
  };
  const headersFor = (cookies, origin, body) => {
    const headers = { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return headers;
  };
  const call = async (method, path, body, { origin = BASE, now = NOW, cookies = jar } = {}) => {
    const response = await attendanceApi(new Request(BASE + '/api/attendance/' + path, { method, headers: headersFor(cookies, origin, body), body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
    take(response, cookies);
    const type = response.headers.get('Content-Type') || '';
    return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
  };
  // Through the whole Worker (login box, session API, page gating).
  const page = async (method, path, body, { origin = BASE, cookies = jar } = {}) => {
    const response = await respond(new Request(BASE + path, { method, redirect: 'manual', headers: headersFor(cookies, origin, body), body: body === undefined ? undefined : JSON.stringify(body) }), env, { memberScript: '// app', memberHTML: '<!doctype html>' });
    take(response, cookies);
    const type = response.headers.get('Content-Type') || '';
    return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
  };
  return { jar, call, page,
    login: async (password = MEMBER_PASSWORD) => (await page('POST', '/api/login', { password })).status,
    member: async () => { const c = await sessionCookie(env); const [k, v] = c.split(';')[0].split('='); jar[k] = v; } };
}
async function admin(env) { const c = client(env); assert.equal(await c.login(ADMIN_CODE.toLowerCase()), 200); return c; }
async function staffClient(env, a) {
  const pw = (await a.call('POST', 'staff-password', { password: 'staff-test-01' })).body.password;
  const c = client(env); assert.equal(await c.login(pw), 200); return c;
}
// Holder of a group's roll-call link (no member login).
async function linkHolder(env, token) { const c = client(env); assert.equal((await c.call('POST', 'link', { token })).status, 200); return c; }

test('rules: weekly, 2nd and 4th week, bi-monthly first week, five-Wednesday months', () => {
  assert.deepEqual(scheduledDates('{"weekday":6}', '2026-10'), ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']);
  assert.deepEqual(scheduledDates('{"weekday":5,"weeks":[2,4]}', '2026-10'), ['2026-10-09', '2026-10-23']);
  const ashuli = '[{"weekday":6,"weeks":[3]},{"weekday":6,"weeks":[1],"months":[2,4,6,8,10,12]}]';
  assert.deepEqual(scheduledDates(ashuli, '2026-10'), ['2026-10-03', '2026-10-17']);
  assert.deepEqual(scheduledDates(ashuli, '2026-11'), ['2026-11-21']);
  assert.deepEqual(scheduledDates('{"weekday":3}', '2026-09'), ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']);
  assert.equal(scheduledDates('{"weekday":3}', '2026-11').length, 4);
  assert.equal(lastScheduled('{"weekday":6}', '2026-11-06'), '2026-10-31');
  assert.equal(lastScheduled('{"weekday":6}', '2026-11-07'), '2026-11-07');
  assert.deepEqual(nearbyDates('{"weekday":6}', '2026-11-06', 2), ['2026-10-24', '2026-10-31', '2026-11-07']);
  assert.throws(() => scheduledDates('{"weekday":7}', '2026-10'));
  assert.throws(() => scheduledDates('{"weekday":1,"weeks":[6]}', '2026-10'));
  assert.equal(hkToday(Date.parse('2026-11-06T16:30:00Z')), '2026-11-07'); // 00:30 in Hong Kong
});

test('weekOfMonth is ceil(day / 7)', () => {
  for (const [d, w] of [['2026-10-01', 1], ['2026-10-07', 1], ['2026-10-08', 2], ['2026-10-14', 2], ['2026-10-22', 4], ['2026-10-28', 4], ['2026-10-29', 5], ['2026-10-31', 5]]) assert.equal(weekOfMonth(d), w, d);
});

test('monthTable: "/" for no record or cancelled, reschedules by actual date, doubles added, extras left out', () => {
  const groups = [
    { id: 'paul', name: '保羅團', kind: 'fellowship', rule: '{"weekday":6}', sort: 100 },
    { id: 'prayer', name: '祈禱會', kind: 'headcount', rule: '{"weekday":3}', sort: 60 },
  ];
  const m = (o) => ({ group_id: 'paul', kind: 'regular', state: 'held', new_friends: 0, other_guests: 0, headcount: null, present: 0, ...o });
  const meetings = [
    m({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', present: 3, new_friends: 1, other_guests: 1 }), // week 1 = 5
    m({ scheduled_date: '2026-10-10', actual_date: '2026-10-15', present: 4 }),                                  // moved to week 3
    m({ scheduled_date: '2026-10-17', actual_date: '2026-10-17', present: 2 }),                                  // week 3 too → 4 + 2
    m({ scheduled_date: '2026-10-24', actual_date: '2026-10-24', state: 'cancelled' }),                          // "/"
    m({ kind: 'extra', scheduled_date: null, actual_date: '2026-10-25', present: 9 }),                           // not counted
    m({ scheduled_date: '2026-10-31', actual_date: '2026-11-01', present: 6 }),                                  // counts in November
    m({ group_id: 'prayer', scheduled_date: '2026-10-07', actual_date: '2026-10-07', headcount: 12 }),
  ];
  const [prayer, paul] = monthTable(groups, meetings, '2026-10', '2026-11-06');
  assert.equal(prayer.name, '祈禱會'); // sorted by 月訊 order
  assert.deepEqual(paul.cells.map(c => c.value), [5, '/', 6, '/', '/']);
  assert.equal(paul.cells[2].double, true);
  assert.equal(paul.cells[1].missing, false); // 10-10 has a record (moved), so not missing
  assert.equal(paul.cells[4].missing, false); // 10-31 was moved into November
  assert.deepEqual(prayer.cells.map(c => c.value), [12, '/', '/', '/', '/']);
  assert.deepEqual(prayer.cells.map(c => c.missing), [false, true, true, true, false]);
  const [, paulNov] = monthTable(groups, meetings, '2026-11', '2026-11-06');
  assert.deepEqual(paulNov.cells.map(c => c.value), [6, '/', '/', '/', '/']);
  const feb = monthTable(groups, [], '2027-02', '2027-03-01');
  assert.deepEqual(feb[1].cells.map(c => c.value), ['/', '/', '/', '/', '/']);
  const csv = tableCsv(monthTable(groups, meetings, '2026-10', '2026-11-06'));
  assert(csv.startsWith('﻿聚會,第一週,第二週,第三週,第四週,第五週\r\n'));
  assert(csv.includes('保羅團,5,/,6,/,/\r\n'));
  assert.equal(monthTitle('2026-09'), '聚會出席人數　2026 年 9 月份');
  assert.equal(total({ state: 'cancelled', headcount: null }, 3), null);
});

test('rules: 以斯帖團 meets on Saturday or the Friday before; 今次 counts the Friday', () => {
  const esther = '{"weekday":6,"alt":[-1]}';
  assert.deepEqual(scheduledDates(esther, '2026-11'), ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
  assert.deepEqual(altDates(esther, '2026-11-07'), ['2026-11-06']);
  assert.equal(currentScheduled(esther, '2026-11-06'), '2026-11-07'); // Friday: tomorrow's meeting may be held today
  assert.equal(currentScheduled(esther, '2026-11-05'), '2026-10-31');
  assert.equal(currentScheduled('{"weekday":6}', '2026-11-06'), '2026-10-31');
  assert.deepEqual(nearbyDates(esther, '2026-11-06', 2), ['2026-10-31', '2026-11-07', '2026-11-14']);
  assert.equal(isMoved(esther, '2026-11-07', '2026-11-06'), false);
  assert.equal(isMoved(esther, '2026-11-07', '2026-11-05'), true);
  assert.equal(isMoved('{"weekday":6}', '2026-11-07', '2026-11-06'), true);
  assert.deepEqual(scheduledDates('{"weekday":5,"weeks":[1,3]}', '2026-11'), ['2026-11-06', '2026-11-20']); // 約瑟團
  assert.throws(() => scheduledDates('{"weekday":6,"alt":[0]}', '2026-11'));
  assert.throws(() => scheduledDates('{"weekday":6,"alt":[-7]}', '2026-11'));
  assert.equal(total({ state: 'held', member_count: 7, new_friends: 1, other_guests: 2, headcount: null }, 0), 10);
});

test('input checks: names, passwords, link tokens', () => {
  assert.equal(cleanName('  測試　甲  '), '測試 甲');
  assert.equal(cleanName(''), null); assert.equal(cleanName('   '), null);
  assert.equal(cleanName('一'.repeat(20)), '一'.repeat(20)); assert.equal(cleanName('一'.repeat(21)), null);
  assert.equal(cleanName('a\u0007b'), null); assert.equal(cleanName(42), null);
  assert.equal(normalizeCode('abcd-efgh'), 'ABCDEFGH'); assert.equal(normalizeCode('short'), null); assert.equal(normalizeCode('有中文字的碼abc'), null);
  const code = generateCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.notEqual(code, generateCode());
  const token = newLinkToken();
  assert(validLinkToken(token)); assert.notEqual(token, newLinkToken());
  assert(!validLinkToken(token + 'x')); assert(!validLinkToken('a'.repeat(31) + '/'));
});

test('session, Origin and method checks come first; a plain 會友 has no roll-call role', async () => {
  const env = await environment(), c = client(env);
  assert.equal((await c.call('GET', 'me')).status, 401);
  assert.equal((await c.call('PUT', 'meeting', {})).status, 401);
  await c.member();
  const me = await c.call('GET', 'me');
  assert.equal(me.status, 200); assert.equal(me.body.role, null); assert.equal(me.body.member, true);
  assert.equal((await c.call('PUT', 'meeting', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.call('PUT', 'meeting', {}, { origin: null })).status, 403);
  const wrongMethod = await c.call('DELETE', 'meeting');
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get('Allow'), 'GET, PUT');
  assert.equal((await c.call('GET', 'link')).status, 405);
  assert.equal((await c.call('GET', 'nope')).status, 404);
  assert.equal((await c.call('GET', 'meeting?group=paul')).body.error, 'link_required');
  assert.equal((await c.call('GET', 'me')).headers.get('Cache-Control'), 'no-store');
  const noDb = client({ ...env, ATT_DB: undefined }); await noDb.member();
  assert.equal((await noDb.call('GET', 'me')).status, 503);
});

test('one login box: member 8 h, 同工 and admin 90 days; 同工 password change signs 同工 out', async () => {
  const env = await environment();
  const m = client(env);
  assert.equal(await m.login('wrong-password'), 401);
  assert.equal(await m.login(MEMBER_PASSWORD), 200);
  assert.match(m.jar[COOKIE], /^member\.0\.\d{10}\./);
  assert.deepEqual((await m.page('GET', '/api/session')).body, { authenticated: true, role: 'member' });
  const a = await admin(env);
  assert.match(a.jar[COOKIE], /^admin\.0\./);
  assert.equal((await a.call('GET', 'me')).body.role.name, '網站管理員');
  assert.equal((await a.call('GET', 'me')).body.staffHasPassword, false);
  // No 同工 password yet: a code-like password is refused.
  assert.equal(await client(env).login('STAFF-TEST-01'), 401);
  const set = await a.call('POST', 'staff-password', {});
  assert.equal(set.status, 200); assert.match(set.body.password, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal((await a.call('POST', 'staff-password', { password: 'short' })).body.error, 'invalid_password_format');
  const s = client(env); assert.equal(await s.login(set.body.password.toLowerCase().replace('-', ' ')), 200);
  assert.match(s.jar[COOKIE], /^staff\.1\./);
  const cookie = (await s.page('POST', '/api/login', { password: set.body.password }, { cookies: {} })).headers.get('Set-Cookie');
  assert.match(cookie, /Max-Age=7776000/); // 90 days
  assert.match((await m.page('POST', '/api/login', { password: MEMBER_PASSWORD }, { cookies: {} })).headers.get('Set-Cookie'), /Max-Age=28800/);
  assert.equal((await s.call('GET', 'me')).body.role.name, '傳道同工');
  assert.deepEqual((await s.page('GET', '/api/session')).body, { authenticated: true, role: 'staff' });
  assert.equal((await s.page('GET', '/members/rooms/')).status, 200); // 同工 are members too
  // Only the admin sets the 同工 password; a member cannot touch staff routes.
  assert.equal((await s.call('POST', 'staff-password', {})).status, 403);
  assert.equal((await m.call('POST', 'links', { group: 'paul' })).body.error, 'link_required');
  // Changing the 同工 password signs every 同工 phone out at once.
  const changed = await a.call('POST', 'staff-password', { password: 'staff-test-02' });
  assert.equal(changed.body.version, 2);
  assert.equal((await s.call('GET', 'me')).status, 401);
  assert.deepEqual((await s.page('GET', '/api/session')).body, { authenticated: false });
  assert.equal(await client(env).login(set.body.password), 401);
  assert.equal(await client(env).login('STAFF TEST 02'), 200);
  // Rotating the admin secret signs admins out, and the old admin password stops working.
  const rotated = { ...env, ATTENDANCE_ADMIN_CODE_HASH: 'a'.repeat(32) + ':' + 'b'.repeat(64) };
  assert.equal((await client(rotated).call('GET', 'me', undefined, { cookies: a.jar })).status, 401);
  assert.equal(await client(rotated).login(ADMIN_CODE), 401);
  // …and the 同工 password (hashed with the old admin salt) still works with a second hash.
  assert.equal(await client(rotated).login('staff-test-02'), 200);
});

test('roll-call links: open without login, only that group, reset stops old phones, recorded as 「保羅團連結」', async () => {
  const env = await environment(), a = await admin(env);
  const link = await a.call('POST', 'links', { group: 'paul' });
  assert.equal(link.status, 200); assert(validLinkToken(link.body.token)); assert.equal(link.body.version, 1);
  assert.equal((await a.call('GET', 'me')).body.groups.find(g => g.id === 'paul').hasLink, true);
  assert.equal(env.ATT_DB.raw.prepare("SELECT link_hash FROM groups WHERE id = 'paul'").get().link_hash.length, 64); // only the hash is stored
  assert.equal((await a.call('POST', 'links', { group: 'sun-worship' })).body.error, 'wrong_group_kind');
  // Wrong or malformed tokens.
  const stranger = client(env);
  assert.equal((await stranger.call('POST', 'link', { token: 'x'.repeat(32) })).body.error, 'invalid_link');
  assert.equal((await stranger.call('POST', 'link', { token: '../etc' })).status, 401);
  assert.equal((await stranger.call('POST', 'link', { token: link.body.token }, { origin: 'https://evil.example' })).status, 403);
  // The holder: no member password, full 保羅團 role, nothing else.
  const h = await linkHolder(env, link.body.token);
  assert.match(h.jar[LINK_COOKIE], /^paul\.1\.\d{10}\.[a-f0-9]{64}$/);
  assert.equal(h.jar[COOKIE], undefined);
  const me = (await h.call('GET', 'me')).body;
  assert.equal(me.role.name, '保羅團'); assert.deepEqual(me.groups.map(g => g.id), ['paul']); assert.equal(me.groups[0].hasLink, undefined);
  assert.equal((await h.call('GET', 'meeting?group=paul')).status, 200);
  assert.equal((await h.call('GET', 'meeting?group=david')).status, 403);
  assert.equal((await h.call('POST', 'links', { group: 'paul' })).status, 403);
  assert.equal((await h.call('PATCH', 'group', { group: 'paul', record_mode: 'count' })).status, 403);
  assert.deepEqual((await h.call('GET', 'report?month=2026-10')).body.rows.map(r => r.id), ['paul']);
  // Pages: the attendance page and its script open; other member pages and data do not.
  assert.deepEqual((await h.page('GET', '/api/session')).body, { authenticated: false, link: true });
  assert.equal((await h.page('GET', '/members/attendance/')).status, 200);
  assert.equal((await h.page('GET', '/members/app.js')).status, 200);
  assert.equal((await h.page('GET', '/members/')).status, 302);
  assert.equal((await h.page('GET', '/members/resources/')).status, 302);
  assert.equal((await h.page('GET', '/api/member-resources')).status, 401);
  // Changes through the link are recorded as 「保羅團連結」.
  const id = (await h.call('POST', 'members', { group: 'paul', name: '測試甲' })).body.member.id;
  await h.call('PUT', 'mark', { group: 'paul', kind: 'regular', scheduled_date: '2026-10-31', member: id, status: 'present' });
  assert.equal(env.ATT_DB.raw.prepare("SELECT updated_role FROM meetings WHERE scheduled_date = '2026-10-31'").get().updated_role, '保羅團連結');
  assert.equal(env.ATT_DB.raw.prepare('SELECT updated_role FROM attendance').get().updated_role, '保羅團連結');
  assert.equal(env.ATT_DB.raw.prepare('SELECT updated_role FROM members').get().updated_role, '保羅團連結');
  // 90 days later the phone needs the link again (the link itself never expires).
  assert.equal((await h.call('GET', 'me', undefined, { now: NOW + LINK_SECONDS * 1000 + 1000 })).status, 401);
  assert(await readLink(new Request(BASE, { headers: { Cookie: `${LINK_COOKIE}=${h.jar[LINK_COOKIE]}` } }), env, NOW + (LINK_SECONDS - 60) * 1000));
  // A tampered cookie is refused.
  assert.equal((await h.call('GET', 'meeting?group=david', undefined, { cookies: { [LINK_COOKIE]: h.jar[LINK_COOKIE].replace('paul', 'david') } })).status, 401);
  // Reset by 同工: the old link and the phone holding it stop at once; the new link works.
  const s = await staffClient(env, a);
  const reset = await s.call('POST', 'links', { group: 'paul' });
  assert.equal(reset.body.version, 2);
  assert.equal((await h.call('GET', 'me')).status, 401);
  assert.equal((await h.page('GET', '/members/attendance/')).status, 200); // page shell only; the API says the link is gone
  assert.equal((await client(env).call('POST', 'link', { token: link.body.token })).body.error, 'invalid_link');
  await linkHolder(env, reset.body.token);
  // Forget: the phone drops the link cookie.
  await h.call('POST', 'link', { token: reset.body.token });
  assert(h.jar[LINK_COOKIE]);
  await h.call('POST', 'forget', {});
  assert.equal(h.jar[LINK_COOKIE], undefined);
  // A member who also holds a link acts for that group; 同工 stay 同工.
  const both = client(env); await both.member(); await both.call('POST', 'link', { token: reset.body.token });
  assert.equal((await both.call('GET', 'me')).body.role.name, '保羅團');
  await s.call('POST', 'link', { token: reset.body.token });
  assert.equal((await s.call('GET', 'me')).body.role.name, '傳道同工');
});

test('permissions: a link sees only its own group; staff sees all; 記名／只記人數 is staff-only', async () => {
  const env = await environment(), a = await admin(env);
  const h = await linkHolder(env, (await a.call('POST', 'links', { group: 'paul' })).body.token);
  assert.equal((await h.call('GET', 'members?group=david')).status, 403);
  assert.equal((await h.call('POST', 'members', { group: 'david', name: '測試甲' })).status, 403);
  assert.equal((await h.call('PUT', 'meeting', { group: 'david', kind: 'regular', scheduled_date: '2026-11-01', state: 'held' })).status, 403);
  assert.equal((await a.call('GET', 'meeting?group=david')).status, 200);
  assert.equal((await a.call('GET', 'report?month=2026-10')).body.rows.length, 16);
  assert.deepEqual((await a.call('GET', 'history?group=david')).body.items.map(x => [x.scheduled_date, x.state]), [['2026-11-01', 'missing']]);
  assert.equal((await h.call('GET', 'me')).body.groups[0].record_mode, 'names');
  assert.equal((await a.call('PATCH', 'group', { group: 'paul', record_mode: 'count' })).body.group.record_mode, 'count');
  assert.equal((await a.call('PATCH', 'group', { group: 'paul', record_mode: 'x' })).body.error, 'invalid_mode');
  assert.equal((await a.call('PATCH', 'group', { group: 'sun-worship', record_mode: 'count' })).body.error, 'wrong_group_kind');
  assert.equal((await h.call('GET', 'me')).body.groups[0].record_mode, 'count');
  // 只記人數: three counts, total added up; names are kept, not deleted.
  const put = await h.call('PUT', 'meeting', { group: 'paul', kind: 'regular', scheduled_date: '2026-10-03', member_count: 7, new_friends: 1, other_guests: 2 });
  assert.equal(put.status, 200); assert.equal(put.body.meeting.member_count, 7);
  assert.deepEqual((await a.call('GET', 'report?month=2026-10')).body.rows.find(r => r.id === 'paul').cells[0].value, 10);
  assert.equal((await h.call('PUT', 'meeting', { group: 'paul', kind: 'regular', scheduled_date: '2026-10-03', headcount: 5 })).body.error, 'wrong_group_kind');
});

test('per-tap saves: two phones marking together do not overwrite each other; fields change one by one', async () => {
  const env = await environment(), a = await admin(env);
  const token = (await a.call('POST', 'links', { group: 'paul' })).body.token;
  const p1 = await linkHolder(env, token), p2 = await linkHolder(env, token);
  const ids = [];
  for (const name of ['測試甲', '測試乙', '測試丙']) ids.push((await p1.call('POST', 'members', { group: 'paul', name })).body.member.id);
  const at = { group: 'paul', kind: 'regular', scheduled_date: '2026-10-31' };
  const [r1, r2] = await Promise.all([p1.call('PUT', 'mark', { ...at, member: ids[0], status: 'present' }), p2.call('PUT', 'mark', { ...at, member: ids[1], status: 'leave' })]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  await p1.call('PUT', 'mark', { ...at, member: ids[2], status: 'absent' });
  const both = (await p2.call('GET', 'meeting?group=paul&date=2026-10-31')).body;
  assert.deepEqual(both.marks, { [ids[0]]: 'present', [ids[1]]: 'leave', [ids[2]]: 'absent' });
  assert.equal(env.ATT_DB.raw.prepare('SELECT COUNT(*) AS n FROM meetings').get().n, 1);
  // Clearing one mark leaves the others.
  const cleared = await p2.call('PUT', 'mark', { ...at, member: ids[2], status: null });
  assert.deepEqual(cleared.body.marks, { [ids[0]]: 'present', [ids[1]]: 'leave' });
  // Counters change only their own field.
  await p1.call('PUT', 'meeting', { ...at, new_friends: 2 });
  await p2.call('PUT', 'meeting', { ...at, other_guests: 1 });
  const m = (await p1.call('GET', 'meeting?group=paul&date=2026-10-31')).body.meeting;
  assert.equal(m.new_friends, 2); assert.equal(m.other_guests, 1);
  // Validation.
  assert.equal((await p1.call('PUT', 'mark', { ...at, member: ids[0], status: 'late' })).body.error, 'invalid_status');
  assert.equal((await p1.call('PUT', 'mark', { ...at, member: 9999, status: 'present' })).body.error, 'invalid_member');
  assert.equal((await p1.call('PUT', 'mark', { ...at, scheduled_date: '2026-11-07', member: ids[0], status: 'present' })).body.error, 'future_date');
  assert.equal((await p1.call('PUT', 'mark', { ...at, scheduled_date: '2026-10-30', member: ids[0], status: 'present' })).body.error, 'not_scheduled');
  assert.equal((await p1.call('PUT', 'meeting', { ...at, new_friends: -1 })).body.error, 'invalid_count');
  assert.equal((await p1.call('PUT', 'meeting', { ...at })).body.error, 'invalid_request');
  // Cancelling keeps the marks (undo-friendly) but blocks new ones until it is held again.
  await p1.call('PUT', 'meeting', { ...at, state: 'cancelled' });
  assert.equal((await p2.call('PUT', 'mark', { ...at, member: ids[2], status: 'present' })).body.error, 'meeting_cancelled');
  await p1.call('PUT', 'meeting', { ...at, state: 'held' });
  assert.equal(Object.keys((await p1.call('GET', 'meeting?group=paul&date=2026-10-31')).body.marks).length, 2);
});

test('以斯帖團 on a Friday: 今次 is Saturday\'s meeting, held on Friday without 改期', async () => {
  const env = await environment(), a = await admin(env);
  const h = await linkHolder(env, (await a.call('POST', 'links', { group: 'esther' })).body.token);
  const id = (await h.call('POST', 'members', { group: 'esther', name: '測試甲' })).body.member.id;
  const now = (await h.call('GET', 'meeting?group=esther')).body;
  assert.equal(now.scheduled_date, '2026-11-07'); assert.equal(now.current, true); assert.deepEqual(now.alt_dates, ['2026-11-06']);
  // Without a day, the first mark would be on Saturday (tomorrow): refused.
  assert.equal((await h.call('PUT', 'mark', { group: 'esther', kind: 'regular', scheduled_date: '2026-11-07', member: id, status: 'present' })).body.error, 'future_date');
  const r = await h.call('PUT', 'mark', { group: 'esther', kind: 'regular', scheduled_date: '2026-11-07', actual_date: '2026-11-06', member: id, status: 'present' });
  assert.equal(r.status, 200); assert.equal(r.body.meeting.actual_date, '2026-11-06');
  const hist = (await h.call('GET', 'history?group=esther')).body.items.find(x => x.scheduled_date === '2026-11-07');
  assert.equal(hist.moved, false); assert.equal(hist.total, 1);
  assert.equal((await h.call('GET', 'meeting?group=esther')).body.scheduled_date, '2026-11-07');
});

test('roll call: edit, reschedule, cancel, extra meetings, report, stats', async () => {
  const env = await environment(), a = await admin(env);
  const c = await linkHolder(env, (await a.call('POST', 'links', { group: 'paul' })).body.token);
  const ids = [];
  for (const name of ['測試甲', '測試乙', '測試丙', '測試丁']) ids.push((await c.call('POST', 'members', { group: 'paul', name })).body.member.id);
  assert.equal((await c.call('POST', 'members', { group: 'paul', name: '測試甲' })).body.error, 'duplicate_name');
  assert.equal((await c.call('POST', 'members', { group: 'paul', name: '一'.repeat(21) })).body.error, 'invalid_name');
  const now = await c.call('GET', 'meeting?group=paul');
  assert.equal(now.body.scheduled_date, '2026-10-31'); assert.equal(now.body.current, true); assert.equal(now.body.meeting, null);
  assert.equal(now.body.members.length, 4);
  const marks = async (scheduled_date, list, extra = {}) => {
    for (const [i, status] of Object.entries(list)) {
      const r = await c.call('PUT', 'mark', { group: 'paul', kind: 'regular', scheduled_date, member: ids[i], status, ...extra });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  };
  const meeting = (scheduled_date, fields) => c.call('PUT', 'meeting', { group: 'paul', kind: 'regular', scheduled_date, ...fields });
  await marks('2026-10-03', ['present', 'present', 'present', 'leave']);
  await meeting('2026-10-03', { new_friends: 1, other_guests: 1 });
  await marks('2026-10-03', { 3: 'present' }); // edit a past meeting: one more present
  await meeting('2026-10-10', { state: 'held', actual_date: '2026-10-15' }); // moved into week 3
  await marks('2026-10-10', ['present', 'absent']);
  assert.equal((await meeting('2026-10-10', { actual_date: '2026-09-01' })).body.error, 'reschedule_too_far');
  await marks('2026-10-17', ['present', 'present']);
  await meeting('2026-10-24', { state: 'cancelled' });
  assert.equal((await c.call('GET', 'meeting?group=paul&date=2026-10-24')).body.meeting.state, 'cancelled');
  // Extra meeting with a client ref: a queued save sent twice makes one meeting.
  const ref = crypto.randomUUID(), extra = { group: 'paul', kind: 'extra', ref, actual_date: '2026-10-25', member: ids[0], status: 'present' };
  assert.equal((await c.call('PUT', 'mark', extra)).status, 200);
  assert.equal((await c.call('PUT', 'mark', extra)).status, 200);
  assert.equal(env.ATT_DB.raw.prepare("SELECT COUNT(*) AS n FROM meetings WHERE kind = 'extra'").get().n, 1);
  assert.equal((await c.call('GET', `meeting?group=paul&ref=${ref}`)).body.meeting.actual_date, '2026-10-25');
  // A member who left keeps old records and stays listed on those meetings only.
  await c.call('PATCH', 'members', { id: ids[3], status: 'left' });
  assert.equal((await c.call('GET', 'meeting?group=paul&date=2026-10-03')).body.members.length, 4);
  assert.equal((await c.call('GET', 'meeting?group=paul&date=2026-10-31')).body.members.length, 3);
  assert.equal((await c.call('PATCH', 'members', { id: ids[0], name: '測試乙' })).body.error, 'duplicate_name');
  assert.equal((await c.call('PATCH', 'members', { id: ids[0], name: '測試甲甲' })).body.member.name, '測試甲甲');
  assert.equal((await c.call('PATCH', 'members', { id: ids[3], status: 'active' })).body.member.status, 'active');
  // Report: week1 = 4 present + 1 + 1; week2 "/" (moved); week3 = 1 + 2 doubled; week4 cancelled; week5 not yet.
  const rep = await a.call('GET', 'report?month=2026-10');
  const row = rep.body.rows.find(x => x.id === 'paul');
  assert.deepEqual(row.cells.map(x => x.value), [6, '/', 3, '/', '/']);
  assert.equal(row.cells[2].double, true); assert.equal(row.cells[4].missing, true);
  assert.equal(rep.body.title, '聚會出席人數　2026 年 10 月份');
  const csv = await a.call('GET', 'report.csv?month=2026-10');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('Content-Type'), /text\/csv/); assert.equal(csv.headers.get('Cache-Control'), 'no-store');
  assert(csv.body.includes('保羅團,6,/,3,/,/'));
  assert.match(csv.headers.get('Content-Disposition'), /attachment/);
  // Head-count meetings: staff only fill a total.
  const hc = await a.call('PUT', 'meeting', { group: 'sun-worship', kind: 'regular', scheduled_date: '2026-10-04', headcount: 78 });
  assert.equal(hc.status, 200);
  assert.equal((await a.call('GET', 'report?month=2026-10')).body.rows.find(x => x.id === 'sun-worship').cells[0].value, 78);
  assert.equal((await a.call('PUT', 'mark', { group: 'sun-worship', kind: 'regular', scheduled_date: '2026-10-04', member: 1, status: 'present' })).body.error, 'wrong_group_kind');
  // History lists records and past dates without a record.
  const hist = await c.call('GET', 'history?group=paul');
  assert.equal(hist.body.items.find(x => x.scheduled_date === '2026-10-31').state, 'missing');
  assert.equal(hist.body.items.find(x => x.scheduled_date === '2026-10-03').total, 6);
  assert.equal(hist.body.items.find(x => x.scheduled_date === '2026-10-10').moved, true);
  // Stats: regular meetings only for averages.
  const st = await c.call('GET', 'stats?group=paul&year=2026');
  assert.equal(st.body.months[9].count, 3); assert.equal(st.body.months[9].average, Math.round((6 + 1 + 2) / 3 * 10) / 10);
  assert.equal(st.body.meetings.length, 4);
  assert.equal(st.body.new_friends, 1);
  // Rescheduled to today becomes 今次.
  await meeting('2026-10-31', { actual_date: '2026-11-06' });
  assert.equal((await c.call('GET', 'meeting?group=paul')).body.scheduled_date, '2026-10-31');
});

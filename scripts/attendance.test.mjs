// Attendance: pure rules/table tests plus the API against an in-memory D1 shim
// built on node:sqlite. No network, no Cloudflare account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { scheduledDates, weekOfMonth, lastScheduled, nearbyDates, monthTable, tableCsv, monthTitle, cleanName, normalizeCode, generateCode, total, hkToday } from '../src/attendance-core.js';
import { newCodeHash, readRole, ROLE_COOKIE, ROLE_SECONDS } from '../src/unit-access.js';
import { attendanceApi } from '../src/attendance.js';
import { sessionCookie } from '../src/auth.js';

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
const ADMIN_CODE = 'ADMIN-TEST-2026';
async function environment() {
  const records = new Map(), admin = await newCodeHash(normalizeCode(ADMIN_CODE));
  let hits = 0;
  return {
    PREVIEW_PASSWORD_HASH: createHash('sha256').update('test-only').digest('hex'), PREVIEW_SESSION_SECRET: randomBytes(32).toString('hex'),
    ATTENDANCE_ADMIN_CODE_HASH: `${admin.salt}:${admin.hash}`, ATT_DB: d1(),
    SESSIONS: { idFromName: id => id, get: id => ({ create: async e => records.set(id, e), active: async e => records.get(id) === e, revoke: async () => records.delete(id) }) },
    LOGIN_LIMITER: { limit: async () => ({ success: ++hits <= 50 }) },
  };
}
const NOW = Date.parse('2026-11-06T10:00:00+08:00'); // Friday
const BASE = 'https://preview.example';
function client(env) {
  const jar = {};
  const call = async (method, path, body, { origin = BASE, now = NOW, cookies = jar } = {}) => {
    const headers = { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await attendanceApi(new Request(BASE + '/api/attendance/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
    const set = response.headers.get('Set-Cookie');
    if (set && cookies === jar) { const [pair] = set.split(';'); const [k, v] = pair.split('='); if (v) jar[k] = v; else delete jar[k]; }
    const type = response.headers.get('Content-Type') || '';
    return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
  };
  return { jar, call, login: async () => { const c = await sessionCookie(env); const [k, v] = c.split(';')[0].split('='); jar[k] = v; } };
}
async function admin(env) { const c = client(env); await c.login(); assert.equal((await c.call('POST', 'unlock', { unit: 'admin', code: ADMIN_CODE })).status, 200); return c; }

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

test('input checks: names, codes', () => {
  assert.equal(cleanName('  測試　甲  '), '測試 甲');
  assert.equal(cleanName(''), null); assert.equal(cleanName('   '), null);
  assert.equal(cleanName('一'.repeat(20)), '一'.repeat(20)); assert.equal(cleanName('一'.repeat(21)), null);
  assert.equal(cleanName('a\u0007b'), null); assert.equal(cleanName(42), null);
  assert.equal(normalizeCode('abcd-efgh'), 'ABCDEFGH'); assert.equal(normalizeCode('short'), null); assert.equal(normalizeCode('有中文字的碼abc'), null);
  const code = generateCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.notEqual(code, generateCode());
});

test('session, Origin and method checks come first', async () => {
  const env = await environment(), c = client(env);
  assert.equal((await c.call('GET', 'me')).status, 401);
  await c.login();
  assert.equal((await c.call('GET', 'me')).status, 200);
  assert.equal((await c.call('PUT', 'meeting', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.call('PUT', 'meeting', {}, { origin: null })).status, 403);
  const wrongMethod = await c.call('DELETE', 'meeting');
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get('Allow'), 'GET, PUT');
  assert.equal((await c.call('GET', 'unlock')).status, 405);
  assert.equal((await c.call('GET', 'nope')).status, 404);
  assert.equal((await c.call('GET', 'meeting?group=paul')).body.error, 'unlock_required');
  assert.equal((await c.call('GET', 'me')).headers.get('Cache-Control'), 'no-store');
  const noDb = client({ ...env, ATT_DB: undefined }); await noDb.login();
  assert.equal((await noDb.call('GET', 'me')).status, 503);
});

test('codes: unlock, wrong code, reset invalidates old cookie, 90-day expiry, only admin sets staff code', async () => {
  const env = await environment(), a = await admin(env);
  const leader = client(env); await leader.login();
  assert.equal((await leader.call('POST', 'unlock', { unit: 'paul', code: 'WHATEVER1' })).body.error, 'code_not_set');
  const set = await a.call('POST', 'code', { target: 'paul' });
  assert.equal(set.status, 200); assert.match(set.body.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal((await leader.call('POST', 'unlock', { unit: 'paul', code: 'WRONGCODE9' })).status, 401);
  assert.equal((await leader.call('POST', 'unlock', { unit: 'paul', code: set.body.code.toLowerCase() })).status, 200);
  const cookie = leader.jar[ROLE_COOKIE];
  assert.match(cookie, /^group\.paul\.2\.\d{10}\.[a-f0-9]{64}$/);
  assert.equal((await leader.call('GET', 'me')).body.role.name, '保羅團');
  assert.equal((await leader.call('GET', 'meeting?group=paul')).status, 200);
  // 90 days later the cookie is refused even though the code is unchanged.
  assert.equal((await leader.call('GET', 'meeting?group=paul', undefined, { now: NOW + ROLE_SECONDS * 1000 + 1000 })).status, 403);
  assert(await readRole(new Request(BASE, { headers: { Cookie: `${ROLE_COOKIE}=${cookie}` } }), env, NOW + (ROLE_SECONDS - 60) * 1000));
  // Tampered cookie.
  const forged = { ...leader.jar, [ROLE_COOKIE]: cookie.replace('group.paul', 'group.david') };
  assert.equal((await leader.call('GET', 'meeting?group=david', undefined, { cookies: forged })).status, 403);
  // Staff code: admin only.
  const staffSet = await a.call('POST', 'code', { target: 'staff', code: 'staff-code-01' });
  assert.equal(staffSet.status, 200);
  const staff = client(env); await staff.login();
  assert.equal((await staff.call('POST', 'unlock', { unit: 'staff', code: 'STAFFCODE01' })).status, 200);
  assert.equal((await staff.call('POST', 'code', { target: 'staff' })).status, 403);
  assert.equal((await leader.call('POST', 'code', { target: 'paul' })).status, 403);
  // Staff resets the group code: the leader's remembered cookie stops working at once.
  const reset = await staff.call('POST', 'code', { target: 'paul' });
  assert.equal(reset.body.version, 3);
  assert.equal((await leader.call('GET', 'meeting?group=paul')).body.error, 'unlock_required');
  assert.equal((await leader.call('GET', 'me')).body.role, null);
  assert.equal((await leader.call('POST', 'unlock', { unit: 'paul', code: reset.body.code })).status, 200);
  assert.equal((await a.call('POST', 'code', { target: 'paul', code: 'short' })).body.error, 'invalid_code_format');
  assert.equal((await a.call('POST', 'code', { target: 'sun-worship' })).body.error, 'wrong_group_kind');
  // Lock clears the role cookie.
  await leader.call('POST', 'lock', {});
  assert.equal(leader.jar[ROLE_COOKIE], undefined);
  // Rotating the admin secret signs admins out.
  assert.equal((await a.call('GET', 'meeting?group=paul')).status, 200);
  const rotated = { ...env, ATTENDANCE_ADMIN_CODE_HASH: 'a'.repeat(32) + ':' + 'b'.repeat(64) };
  assert.equal((await client(rotated).call('GET', 'meeting?group=paul', undefined, { cookies: a.jar })).status, 403);
});

async function paulLeader(env) {
  const a = await admin(env), code = (await a.call('POST', 'code', { target: 'paul' })).body.code;
  const c = client(env); await c.login(); await c.call('POST', 'unlock', { unit: 'paul', code });
  return { a, c };
}

test('permissions: a group sees only its own group; staff sees all', async () => {
  const env = await environment(), { a, c } = await paulLeader(env);
  assert.equal((await c.call('GET', 'meeting?group=david')).status, 403);
  assert.equal((await c.call('GET', 'members?group=david')).status, 403);
  assert.equal((await c.call('POST', 'members', { group: 'david', name: '測試甲' })).status, 403);
  assert.equal((await c.call('PUT', 'meeting', { group: 'david', kind: 'regular', state: 'held', scheduled_date: '2026-11-01', actual_date: '2026-11-01', marks: {} })).status, 403);
  assert.deepEqual((await c.call('GET', 'me')).body.groups.map(g => g.id), ['paul']);
  assert.deepEqual((await c.call('GET', 'report?month=2026-10')).body.rows.map(r => r.id), ['paul']);
  assert.equal((await a.call('GET', 'meeting?group=david')).status, 200);
  assert.equal((await a.call('GET', 'report?month=2026-10')).body.rows.length, 16);
  assert.equal((await a.call('GET', 'me')).body.staffHasCode, false);
});

test('roll call: save, edit, reschedule, cancel, extra meetings, report, stats', async () => {
  const env = await environment(), { a, c } = await paulLeader(env);
  const ids = [];
  for (const name of ['測試甲', '測試乙', '測試丙', '測試丁']) ids.push((await c.call('POST', 'members', { group: 'paul', name })).body.member.id);
  assert.equal((await c.call('POST', 'members', { group: 'paul', name: '測試甲' })).body.error, 'duplicate_name');
  assert.equal((await c.call('POST', 'members', { group: 'paul', name: '一'.repeat(21) })).body.error, 'invalid_name');
  const now = await c.call('GET', 'meeting?group=paul');
  assert.equal(now.body.scheduled_date, '2026-10-31'); assert.equal(now.body.current, true); assert.equal(now.body.meeting, null);
  assert.equal(now.body.members.length, 4);
  const base = { group: 'paul', kind: 'regular', state: 'held', new_friends: 1, other_guests: 1 };
  const put = body => c.call('PUT', 'meeting', { ...base, ...body });
  let r = await put({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', marks: { [ids[0]]: 'present', [ids[1]]: 'present', [ids[2]]: 'present', [ids[3]]: 'leave' } });
  assert.equal(r.status, 200); assert.equal(r.body.marks[ids[3]], 'leave');
  // Validation
  assert.equal((await put({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', marks: { [ids[0]]: 'late' } })).body.error, 'invalid_marks');
  assert.equal((await put({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', marks: { 9999: 'present' } })).body.error, 'invalid_marks');
  assert.equal((await put({ scheduled_date: '2026-10-04', actual_date: '2026-10-04', marks: {} })).body.error, 'not_scheduled');
  assert.equal((await put({ scheduled_date: '2026-11-07', actual_date: '2026-11-07', marks: {} })).body.error, 'future_date');
  assert.equal((await put({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', new_friends: -1, marks: {} })).body.error, 'invalid_count');
  assert.equal((await put({ scheduled_date: '2026-10-03', actual_date: '2026-12-25', state: 'cancelled', marks: {} })).body.error, 'reschedule_too_far');
  // Edit a past meeting: one more present.
  r = await put({ scheduled_date: '2026-10-03', actual_date: '2026-10-03', marks: { [ids[0]]: 'present', [ids[1]]: 'present', [ids[2]]: 'present', [ids[3]]: 'present' } });
  assert.equal(r.body.marks[ids[3]], 'present');
  await put({ scheduled_date: '2026-10-10', actual_date: '2026-10-15', marks: { [ids[0]]: 'present', [ids[1]]: 'absent' } }); // moved into week 3
  await put({ scheduled_date: '2026-10-17', actual_date: '2026-10-17', new_friends: 0, other_guests: 0, marks: { [ids[0]]: 'present', [ids[1]]: 'present' } });
  await put({ scheduled_date: '2026-10-24', actual_date: '2026-10-24', state: 'cancelled', marks: { [ids[0]]: 'present' } });
  const cancelled = await c.call('GET', 'meeting?group=paul&date=2026-10-24');
  assert.equal(cancelled.body.meeting.state, 'cancelled'); assert.deepEqual(cancelled.body.marks, {});
  // Extra meeting with a client ref: sending it twice (offline queue replay) makes one meeting.
  const ref = crypto.randomUUID(), extra = { group: 'paul', kind: 'extra', ref, state: 'held', actual_date: '2026-10-25', new_friends: 0, other_guests: 0, marks: { [ids[0]]: 'present' } };
  assert.equal((await c.call('PUT', 'meeting', extra)).status, 200);
  assert.equal((await c.call('PUT', 'meeting', extra)).status, 200);
  assert.equal(env.ATT_DB.raw.prepare("SELECT COUNT(*) AS n FROM meetings WHERE kind = 'extra'").get().n, 1);
  assert.equal((await c.call('GET', `meeting?group=paul&ref=${ref}`)).body.meeting.actual_date, '2026-10-25');
  // A member who left keeps old records and stays listed on those meetings only.
  await c.call('PATCH', 'members', { id: ids[3], status: 'left' });
  assert.equal((await c.call('GET', 'meeting?group=paul&date=2026-10-03')).body.members.length, 4);
  assert.equal((await c.call('GET', 'meeting?group=paul&date=2026-10-31')).body.members.length, 3);
  assert.equal((await c.call('PATCH', 'members', { id: ids[0], name: '測試乙' })).body.error, 'duplicate_name');
  assert.equal((await c.call('PATCH', 'members', { id: ids[0], name: '測試甲甲' })).body.member.name, '測試甲甲');
  assert.equal((await c.call('PATCH', 'members', { id: ids[3], status: 'active' })).body.member.status, 'active');
  // Report: week1 = 4 present + 1 + 1; week2 "/" (moved); week3 = (1+1+1) + 2 doubled; week4 cancelled; week5 not yet.
  const rep = await a.call('GET', 'report?month=2026-10');
  const row = rep.body.rows.find(x => x.id === 'paul');
  assert.deepEqual(row.cells.map(x => x.value), [6, '/', 5, '/', '/']);
  assert.equal(row.cells[2].double, true); assert.equal(row.cells[4].missing, true);
  assert.equal(rep.body.title, '聚會出席人數　2026 年 10 月份');
  const csv = await a.call('GET', 'report.csv?month=2026-10');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('Content-Type'), /text\/csv/); assert.equal(csv.headers.get('Cache-Control'), 'no-store');
  assert(csv.body.includes('保羅團,6,/,5,/,/'));
  assert.match(csv.headers.get('Content-Disposition'), /attachment/);
  // Head-count meetings: staff only fill a total.
  const hc = await a.call('PUT', 'meeting', { group: 'sun-worship', kind: 'regular', state: 'held', scheduled_date: '2026-10-04', actual_date: '2026-10-04', headcount: 78 });
  assert.equal(hc.status, 200);
  assert.equal((await a.call('GET', 'report?month=2026-10')).body.rows.find(x => x.id === 'sun-worship').cells[0].value, 78);
  // History lists records and past dates without a record.
  const hist = await c.call('GET', 'history?group=paul');
  assert.equal(hist.body.items.find(x => x.scheduled_date === '2026-10-31').state, 'missing');
  assert.equal(hist.body.items.find(x => x.scheduled_date === '2026-10-03').total, 6);
  // Stats: regular meetings only for averages.
  const st = await c.call('GET', 'stats?group=paul&year=2026');
  assert.equal(st.body.months[9].count, 3); assert.equal(st.body.months[9].average, Math.round((6 + 3 + 2) / 3 * 10) / 10);
  assert.equal(st.body.meetings.length, 4);
  assert.equal(st.body.new_friends, 2);
  // Rescheduled to today becomes 今次.
  await put({ scheduled_date: '2026-10-31', actual_date: '2026-11-06', marks: { [ids[0]]: 'present' } });
  assert.equal((await c.call('GET', 'meeting?group=paul')).body.scheduled_date, '2026-10-31');
});

// /api/attendance/* — group roll call stored in D1 (binding ATT_DB).
// Every call needs the member session; all but unlock/lock/me also need an
// unlocked role (group code, staff code or admin code). Writes check Origin.
import { authenticated } from './auth.js';
import { hkToday, validDate, validMonth, addDays, daysBetween, onRule, lastScheduled, nearbyDates, total, monthTable, monthTitle, tableCsv, cleanName, validCount, validStatus, normalizeCode, generateCode } from './attendance-core.js';
import { roleCookie, clearRoleCookie, readRole, codeMatches, newCodeHash, adminHash, signingReady, covers, isStaff, roleName } from './unit-access.js';

class Fail extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new Fail(status, code); };
const MAX_BODY = 32768, MAX_MEMBERS = 200;

function reply(request, data, status = 200, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'content_type');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'invalid_request');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); fail(413, 'too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  try { const body = JSON.parse(new TextDecoder().decode(bytes)); if (body && typeof body === 'object' && !Array.isArray(body)) return body; } catch {}
  fail(400, 'invalid_request');
}

const db = env => env.ATT_DB;
const iso = now => new Date(now).toISOString();
async function staffCode(env) {
  const row = await db(env).prepare("SELECT value FROM settings WHERE key = 'staff_code'").first();
  try { return row?.value ? JSON.parse(row.value) : null; } catch { return null; }
}
async function groupRow(env, id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  return db(env).prepare('SELECT * FROM groups WHERE id = ? AND active = 1').bind(id).first();
}
async function activeGroups(env) { return (await db(env).prepare('SELECT * FROM groups WHERE active = 1 ORDER BY sort').all()).results; }

// The cookie's version must equal the current code version, so a reset signs old phones out.
async function currentRole(request, env, now) {
  const r = await readRole(request, env, now);
  if (!r) return null;
  if (r.role === 'admin') return adminHash(env) ? r : null;
  if (r.role === 'staff') { const s = await staffCode(env); return s?.hash && s.version === r.version ? r : null; }
  const g = await groupRow(env, r.group);
  return g && g.kind === 'fellowship' && g.code_hash && g.code_version === r.version ? r : null;
}
// Group lookup plus permission: another group's data is 403.
async function allowedGroup(ctx, id, kind) {
  const g = await groupRow(ctx.env, id);
  if (!g) fail(404, 'group_not_found');
  if (!covers(ctx.role, g.id)) fail(403, 'forbidden');
  if (kind && g.kind !== kind) fail(400, 'wrong_group_kind');
  return g;
}
const publicGroup = (g, staff) => ({ id: g.id, name: g.name, kind: g.kind, rule: JSON.parse(g.rule), ...(staff && g.kind === 'fellowship' ? { hasCode: !!g.code_hash } : {}) });
const meetingOut = m => m && { id: m.id, kind: m.kind, state: m.state, scheduled_date: m.scheduled_date, actual_date: m.actual_date, new_friends: m.new_friends, other_guests: m.other_guests, headcount: m.headcount, ref: m.ref, updated_at: m.updated_at };

async function unlock(ctx) {
  const { env, request, body } = ctx;
  if (!env.LOGIN_LIMITER || !signingReady(env)) fail(503, 'unavailable');
  const { success } = await env.LOGIN_LIMITER.limit({ key: 'att:' + (request.headers.get('CF-Connecting-IP') || 'local') });
  if (!success) return [{ error: 'rate_limited' }, 429, { 'Retry-After': '60' }];
  const code = normalizeCode(body.code), unit = body.unit;
  let target = null, role = null;
  if (unit === 'admin') { target = adminHash(env); role = { role: 'admin', version: 0 }; }
  else if (unit === 'staff') { target = await staffCode(env); role = target && { role: 'staff', version: target.version }; }
  else {
    const g = await groupRow(env, unit);
    if (!g || g.kind !== 'fellowship') fail(400, 'invalid_unit');
    target = g.code_hash ? { salt: g.code_salt, hash: g.code_hash } : null;
    role = { role: 'group', group: g.id, version: g.code_version };
  }
  if (!target?.hash) return [{ error: 'code_not_set' }, 401];
  if (!code || !await codeMatches(code, target.salt, target.hash)) return [{ error: 'invalid_code' }, 401];
  return [{ unlocked: true }, 200, { 'Set-Cookie': await roleCookie(env, role, ctx.now) }];
}
async function lock() { return [{ role: null }, 200, { 'Set-Cookie': clearRoleCookie() }]; }
async function me(ctx) {
  const role = await currentRole(ctx.request, ctx.env, ctx.now), groups = await activeGroups(ctx.env);
  const units = groups.filter(g => g.kind === 'fellowship').map(g => ({ id: g.id, name: g.name }));
  const base = { today: hkToday(ctx.now), units, adminConfigured: !!adminHash(ctx.env) };
  if (!role) return [{ ...base, role: null }];
  const staff = isStaff(role), visible = groups.filter(g => covers(role, g.id)).map(g => publicGroup(g, staff));
  const out = { ...base, role: { role: role.role, group: role.group, name: role.role === 'group' ? visible[0]?.name : role.role === 'staff' ? '傳道同工' : '網站管理員' }, groups: visible };
  if (role.role === 'admin') out.staffHasCode = !!(await staffCode(ctx.env))?.hash;
  if (staff) out.sheetsExport = (await db(ctx.env).prepare("SELECT value FROM settings WHERE key = 'sheets_export'").first())?.value ?? null;
  return [out];
}

async function membersFor(env, groupId, meetingId) {
  const rows = (await db(env).prepare(`SELECT id, display_name AS name, status FROM members WHERE group_id = ?1 AND (status = 'active' OR id IN (SELECT member_id FROM attendance WHERE meeting_id = ?2)) ORDER BY id`).bind(groupId, meetingId ?? -1).all()).results;
  return rows;
}
async function meetingPayload(ctx, g, m, scheduled) {
  const today = hkToday(ctx.now);
  const marks = {};
  if (m) for (const a of (await db(ctx.env).prepare('SELECT member_id, status FROM attendance WHERE meeting_id = ?').bind(m.id).all()).results) marks[a.member_id] = a.status;
  const members = g.kind === 'fellowship' ? await membersFor(ctx.env, g.id, m?.id) : [];
  return { group: publicGroup(g, false), today, scheduled_date: scheduled ?? m?.scheduled_date ?? null, current: !!scheduled && scheduled === lastScheduled(g.rule, today), meeting: meetingOut(m), members, marks, nearby: nearbyDates(g.rule, today) };
}
async function getMeeting(ctx) {
  const q = ctx.url.searchParams, g = await allowedGroup(ctx, q.get('group'));
  const today = hkToday(ctx.now);
  if (q.has('id')) {
    const m = await db(ctx.env).prepare('SELECT * FROM meetings WHERE id = ? AND group_id = ?').bind(Number(q.get('id')) || 0, g.id).first();
    if (!m) fail(404, 'meeting_not_found');
    return [await meetingPayload(ctx, g, m, m.scheduled_date)];
  }
  if (q.has('ref')) {
    const ref = q.get('ref');
    if (!/^[0-9a-f-]{36}$/.test(ref)) fail(400, 'invalid_ref');
    const m = await db(ctx.env).prepare("SELECT * FROM meetings WHERE ref = ? AND group_id = ? AND kind = 'extra'").bind(ref, g.id).first();
    return [await meetingPayload(ctx, g, m, null)];
  }
  let date = q.get('date');
  if (date) {
    if (!validDate(date)) fail(400, 'invalid_date');
  } else {
    // 今次: a meeting moved to today wins; otherwise the latest scheduled date up to today.
    const moved = await db(ctx.env).prepare("SELECT scheduled_date FROM meetings WHERE group_id = ? AND kind = 'regular' AND actual_date = ? AND state = 'held'").bind(g.id, today).first();
    date = moved?.scheduled_date || lastScheduled(g.rule, today);
    if (!date) fail(404, 'no_meeting');
  }
  const m = await db(ctx.env).prepare("SELECT * FROM meetings WHERE group_id = ? AND scheduled_date = ?").bind(g.id, date).first();
  if (!m && !onRule(g.rule, date)) fail(400, 'not_scheduled');
  return [await meetingPayload(ctx, g, m, date)];
}

async function putMeeting(ctx) {
  const b = ctx.body, g = await allowedGroup(ctx, b.group), today = hkToday(ctx.now), env = ctx.env;
  if (!['regular', 'extra'].includes(b.kind)) fail(400, 'invalid_kind');
  if (!['held', 'cancelled'].includes(b.state)) fail(400, 'invalid_state');
  if (!validDate(b.actual_date)) fail(400, 'invalid_date');
  const held = b.state === 'held';
  if (held && b.actual_date > today) fail(400, 'future_date');
  let existing = null;
  if (b.kind === 'regular') {
    if (!validDate(b.scheduled_date)) fail(400, 'invalid_date');
    existing = await db(env).prepare('SELECT * FROM meetings WHERE group_id = ? AND scheduled_date = ?').bind(g.id, b.scheduled_date).first();
    if (!existing && !onRule(g.rule, b.scheduled_date)) fail(400, 'not_scheduled');
    if (Math.abs(daysBetween(b.scheduled_date, b.actual_date)) > 31) fail(400, 'reschedule_too_far');
  } else {
    if (b.id !== undefined && b.id !== null) {
      existing = await db(env).prepare("SELECT * FROM meetings WHERE id = ? AND kind = 'extra'").bind(Number(b.id) || 0).first();
      if (!existing) fail(404, 'meeting_not_found');
    } else {
      if (typeof b.ref !== 'string' || !/^[0-9a-f-]{36}$/.test(b.ref)) fail(400, 'invalid_ref');
      existing = await db(env).prepare('SELECT * FROM meetings WHERE ref = ?').bind(b.ref).first();
    }
    if (existing && existing.group_id !== g.id) fail(409, 'conflict');
    if (b.actual_date < addDays(today, -400)) fail(400, 'invalid_date');
  }
  let newFriends = 0, guests = 0, headcount = null, marks = [];
  if (g.kind === 'headcount') {
    if (held && !validCount(b.headcount, 9999)) fail(400, 'invalid_count');
    headcount = held ? b.headcount : null;
  } else if (held) {
    newFriends = b.new_friends ?? 0; guests = b.other_guests ?? 0;
    if (!validCount(newFriends) || !validCount(guests)) fail(400, 'invalid_count');
    const raw = b.marks && typeof b.marks === 'object' && !Array.isArray(b.marks) ? Object.entries(b.marks) : fail(400, 'invalid_marks');
    if (raw.length > MAX_MEMBERS * 2) fail(400, 'invalid_marks');
    const ids = new Set((await db(env).prepare('SELECT id FROM members WHERE group_id = ?').bind(g.id).all()).results.map(r => r.id));
    for (const [id, status] of raw) {
      if (!ids.has(Number(id)) || !validStatus(status)) fail(400, 'invalid_marks');
      marks.push([Number(id), status]);
    }
  }
  const stamp = iso(ctx.now), who = roleName(ctx.role);
  const fields = [b.actual_date, b.state, newFriends, guests, headcount, stamp, who];
  let write, where, args;
  if (b.kind === 'regular') {
    write = db(env).prepare(`INSERT INTO meetings (group_id, scheduled_date, kind, actual_date, state, new_friends, other_guests, headcount, updated_at, updated_role)
      VALUES (?1, ?2, 'regular', ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT (group_id, scheduled_date) DO UPDATE SET actual_date = excluded.actual_date, state = excluded.state, new_friends = excluded.new_friends, other_guests = excluded.other_guests, headcount = excluded.headcount, updated_at = excluded.updated_at, updated_role = excluded.updated_role`).bind(g.id, b.scheduled_date, ...fields);
    where = 'group_id = ? AND scheduled_date = ?'; args = [g.id, b.scheduled_date];
  } else if (existing) {
    write = db(env).prepare('UPDATE meetings SET actual_date = ?, state = ?, new_friends = ?, other_guests = ?, headcount = ?, updated_at = ?, updated_role = ? WHERE id = ?').bind(...fields, existing.id);
    where = 'id = ?'; args = [existing.id];
  } else {
    write = db(env).prepare(`INSERT INTO meetings (group_id, scheduled_date, kind, actual_date, state, new_friends, other_guests, headcount, updated_at, updated_role, ref)
      VALUES (?, NULL, 'extra', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(g.id, ...fields, b.ref);
    where = 'ref = ?'; args = [b.ref];
  }
  // One batch = one transaction: the meeting row and its marks change together.
  const id = `(SELECT id FROM meetings WHERE ${where})`;
  const statements = [write, db(env).prepare(`DELETE FROM attendance WHERE meeting_id = ${id}`).bind(...args)];
  for (const [member, status] of marks) statements.push(db(env).prepare(`INSERT INTO attendance (meeting_id, member_id, status) VALUES (${id}, ?, ?)`).bind(...args, member, status));
  await db(env).batch(statements);
  const saved = await db(env).prepare(`SELECT * FROM meetings WHERE ${where}`).bind(...args).first();
  return [await meetingPayload(ctx, g, saved, saved.scheduled_date)];
}

const MEETING_TOTALS = `SELECT m.*, (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id = m.id AND a.status = 'present') AS present FROM meetings m`;
async function history(ctx) {
  const g = await allowedGroup(ctx, ctx.url.searchParams.get('group')), today = hkToday(ctx.now);
  const rows = (await db(ctx.env).prepare(`${MEETING_TOTALS} WHERE m.group_id = ? ORDER BY m.actual_date DESC, m.id DESC LIMIT 40`).bind(g.id).all()).results;
  const items = rows.map(m => ({ ...meetingOut(m), present: g.kind === 'fellowship' ? m.present : null, total: total(m, m.present) }));
  // Past scheduled dates in the last 12 weeks without a record are listed as 未點名.
  const recorded = new Set(rows.map(m => m.scheduled_date)), from = addDays(today, -84);
  let d = lastScheduled(g.rule, today);
  while (d && d >= from) {
    if (!recorded.has(d)) items.push({ id: null, kind: 'regular', state: 'missing', scheduled_date: d, actual_date: d, total: null });
    d = lastScheduled(g.rule, addDays(d, -1));
  }
  items.sort((a, b) => b.actual_date.localeCompare(a.actual_date) || (b.id || 0) - (a.id || 0));
  return [{ group: publicGroup(g, false), today, items }];
}

async function listMembers(ctx) {
  const g = await allowedGroup(ctx, ctx.url.searchParams.get('group'), 'fellowship');
  const rows = (await db(ctx.env).prepare('SELECT id, display_name AS name, status FROM members WHERE group_id = ? ORDER BY id').bind(g.id).all()).results;
  return [{ group: publicGroup(g, false), members: rows }];
}
async function nameTaken(env, groupId, name, exceptId = 0) {
  return !!await db(env).prepare("SELECT 1 FROM members WHERE group_id = ? AND display_name = ? AND status = 'active' AND id != ?").bind(groupId, name, exceptId).first();
}
async function addMember(ctx) {
  const g = await allowedGroup(ctx, ctx.body.group, 'fellowship'), name = cleanName(ctx.body.name);
  if (!name) fail(400, 'invalid_name');
  if (await nameTaken(ctx.env, g.id, name)) fail(409, 'duplicate_name');
  const count = (await db(ctx.env).prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active'").bind(g.id).first()).n;
  if (count >= MAX_MEMBERS) fail(400, 'too_many_members');
  const stamp = iso(ctx.now);
  const row = await db(ctx.env).prepare("INSERT INTO members (group_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?) RETURNING id, display_name AS name, status").bind(g.id, name, stamp, stamp).first();
  return [{ member: row }, 201];
}
async function editMember(ctx) {
  const b = ctx.body, m = await db(ctx.env).prepare('SELECT * FROM members WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!m) fail(404, 'member_not_found');
  await allowedGroup(ctx, m.group_id, 'fellowship');
  let name = m.display_name, status = m.status;
  if (b.name !== undefined) { name = cleanName(b.name); if (!name) fail(400, 'invalid_name'); }
  if (b.status !== undefined) { if (!['active', 'left'].includes(b.status)) fail(400, 'invalid_status'); status = b.status; }
  if (status === 'active' && await nameTaken(ctx.env, m.group_id, name, m.id)) fail(409, 'duplicate_name');
  const row = await db(ctx.env).prepare('UPDATE members SET display_name = ?, status = ?, updated_at = ? WHERE id = ? RETURNING id, display_name AS name, status').bind(name, status, iso(ctx.now), m.id).first();
  return [{ member: row }];
}

async function reportData(ctx) {
  const month = ctx.url.searchParams.get('month') || hkToday(ctx.now).slice(0, 7);
  if (!validMonth(month)) fail(400, 'invalid_month');
  const groups = (await activeGroups(ctx.env)).filter(g => covers(ctx.role, g.id));
  const start = `${month}-01`, end = `${month}-31`;
  const meetings = (await db(ctx.env).prepare(`${MEETING_TOTALS} WHERE m.kind = 'regular' AND (m.actual_date BETWEEN ?1 AND ?2 OR m.scheduled_date BETWEEN ?1 AND ?2)`).bind(start, end).all()).results;
  return { month, title: monthTitle(month), rows: monthTable(groups, meetings, month, hkToday(ctx.now)) };
}
async function report(ctx) { return [await reportData(ctx)]; }
async function reportCsv(ctx) {
  const data = await reportData(ctx);
  return new Response(ctx.request.method === 'HEAD' ? null : tableCsv(data.rows), { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="attendance-${data.month}.csv"; filename*=UTF-8''${encodeURIComponent(`聚會出席人數-${data.month}.csv`)}` } });
}

async function stats(ctx) {
  const q = ctx.url.searchParams, g = await allowedGroup(ctx, q.get('group'));
  const year = Number(q.get('year') || hkToday(ctx.now).slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) fail(400, 'invalid_year');
  const rows = (await db(ctx.env).prepare(`${MEETING_TOTALS} WHERE m.group_id = ? AND m.actual_date BETWEEN ? AND ? AND m.state = 'held' ORDER BY m.actual_date, m.id`).bind(g.id, `${year}-01-01`, `${year}-12-31`).all()).results;
  const meetings = rows.map(m => ({ date: m.actual_date, kind: m.kind, present: g.kind === 'fellowship' ? m.present : null, new_friends: m.new_friends, other_guests: m.other_guests, total: total(m, m.present) }));
  // Averages use regular meetings only, like the 《月訊》 table.
  const months = Array.from({ length: 12 }, (_, i) => {
    const list = meetings.filter(m => m.kind === 'regular' && Number(m.date.slice(5, 7)) === i + 1);
    return { month: i + 1, count: list.length, average: list.length ? Math.round(list.reduce((s, m) => s + m.total, 0) / list.length * 10) / 10 : null, new_friends: list.reduce((s, m) => s + m.new_friends, 0) };
  });
  const regular = meetings.filter(m => m.kind === 'regular');
  return [{ group: publicGroup(g, false), year, meetings, months, count: regular.length, average: regular.length ? Math.round(regular.reduce((s, m) => s + m.total, 0) / regular.length * 10) / 10 : null, new_friends: regular.reduce((s, m) => s + m.new_friends, 0) }];
}

// Staff and admin reset group codes; only admin sets the staff code. The new code is
// returned once and never stored in clear.
async function setCode(ctx) {
  const b = ctx.body;
  if (!isStaff(ctx.role)) fail(403, 'forbidden');
  if (b.target === 'staff' && ctx.role.role !== 'admin') fail(403, 'forbidden');
  let code = generateCode();
  if (b.code !== undefined && b.code !== null && b.code !== '') { const n = normalizeCode(b.code); if (!n) fail(400, 'invalid_code_format'); code = b.code.trim().toUpperCase(); }
  const { salt, hash } = await newCodeHash(normalizeCode(code));
  if (b.target === 'staff') {
    const version = ((await staffCode(ctx.env))?.version || 0) + 1;
    await db(ctx.env).prepare("UPDATE settings SET value = ? WHERE key = 'staff_code'").bind(JSON.stringify({ salt, hash, version })).run();
    return [{ target: 'staff', code, version }];
  }
  const g = await allowedGroup(ctx, b.target, 'fellowship');
  await db(ctx.env).prepare('UPDATE groups SET code_hash = ?, code_salt = ?, code_version = code_version + 1 WHERE id = ?').bind(hash, salt, g.id).run();
  return [{ target: g.id, code, version: g.code_version + 1 }];
}

const ROUTES = {
  unlock: { POST: unlock }, lock: { POST: lock }, me: { GET: me },
  meeting: { GET: getMeeting, PUT: putMeeting }, history: { GET: history },
  members: { GET: listMembers, POST: addMember, PATCH: editMember },
  report: { GET: report }, 'report.csv': { GET: reportCsv }, stats: { GET: stats }, code: { POST: setCode },
};
const OPEN = new Set(['unlock', 'lock', 'me']);

export async function attendanceApi(request, env, now = Date.now()) {
  const url = new URL(request.url), name = url.pathname.slice('/api/attendance/'.length);
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!route) return reply(request, { error: 'not_found' }, 404);
  const method = request.method === 'HEAD' ? 'GET' : request.method, handler = route[method];
  if (!handler) return reply(request, { error: 'method_not_allowed' }, 405, { Allow: Object.keys(route).join(', ') });
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return reply(request, { error: 'origin_not_allowed' }, 403);
  if (!await authenticated(request, env)) return reply(request, { error: 'authentication_required' }, 401);
  if (!env.ATT_DB) return reply(request, { error: 'unavailable' }, 503);
  try {
    const ctx = { request, env, url, now, body: method === 'GET' ? null : await readJson(request) };
    if (!OPEN.has(name)) {
      ctx.role = await currentRole(request, env, now);
      if (!ctx.role) return reply(request, { error: 'unlock_required' }, 403);
    }
    const result = await handler(ctx);
    return result instanceof Response ? result : reply(request, ...result);
  } catch (error) {
    if (error instanceof Fail) return reply(request, { error: error.code }, error.status);
    throw error;
  }
}

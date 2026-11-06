// /api/attendance/* — group roll call stored in D1 (binding ATT_DB).
// Who: a 同工 or admin session (all groups), or a fellowship's roll-call link cookie
// (that group only, no member login needed). A plain 會友 session sees only `me`.
// Writes check Origin. Each tap saves one person's mark (PUT mark), and meeting
// fields are updated one by one (PUT meeting), so people marking together do not
// overwrite each other.
import { authenticated } from './auth.js';
import { hkToday, validDate, validMonth, addDays, daysBetween, onRule, lastScheduled, currentScheduled, altDates, isMoved, nearbyDates, total, membersPresent, monthTable, monthTitle, tableCsv, cleanName, validCount, validStatus, normalizeCode, generateCode, newLinkToken, validLinkToken, linkHash, sealLink, unsealLink } from './attendance-core.js';
import { linkCookie, clearLinkCookie, readLink, newCodeHash, adminHash, staffPassword, staffSalt, signingReady, covers, isStaff, roleName } from './unit-access.js';

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
async function groupRow(env, id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  return db(env).prepare('SELECT * FROM groups WHERE id = ? AND active = 1').bind(id).first();
}
async function activeGroups(env) { return (await db(env).prepare('SELECT * FROM groups WHERE active = 1 ORDER BY sort').all()).results; }

// 同工 / admin session first; otherwise the link cookie, whose version must equal the
// group's current link_version (a reset stops old phones at once).
async function currentRole(request, env, now, session) {
  if (session && (session.role === 'staff' || session.role === 'admin')) return { role: session.role };
  const link = await readLink(request, env, now);
  if (!link) return null;
  const g = await groupRow(env, link.group);
  return g && g.kind === 'fellowship' && g.link_hash && g.link_version === link.version ? { role: 'group', group: g.id, groupName: g.name } : null;
}
// Group lookup plus permission: another group's data is 403.
async function allowedGroup(ctx, id, kind) {
  const g = await groupRow(ctx.env, id);
  if (!g) fail(404, 'group_not_found');
  if (!covers(ctx.role, g.id)) fail(403, 'forbidden');
  if (kind && g.kind !== kind) fail(400, 'wrong_group_kind');
  return g;
}
const publicGroup = (g, staff) => ({ id: g.id, name: g.name, kind: g.kind, rule: JSON.parse(g.rule), record_mode: g.record_mode, ...(staff && g.kind === 'fellowship' ? { hasLink: !!g.link_hash } : {}) });
const meetingOut = m => m && { id: m.id, kind: m.kind, state: m.state, scheduled_date: m.scheduled_date, actual_date: m.actual_date, new_friends: m.new_friends, other_guests: m.other_guests, headcount: m.headcount, member_count: m.member_count, ref: m.ref, updated_at: m.updated_at, updated_role: m.updated_role };

// Opening a roll-call link: /attendance/#<token> posts the token here once and gets the
// group cookie; the token itself never appears in a URL path, a log line or a Referer.
async function openLink(ctx) {
  const { env, request, body } = ctx;
  if (!env.LOGIN_LIMITER || !signingReady(env)) fail(503, 'unavailable');
  const { success } = await env.LOGIN_LIMITER.limit({ key: 'link:' + (request.headers.get('CF-Connecting-IP') || 'local') });
  if (!success) return [{ error: 'rate_limited' }, 429, { 'Retry-After': '60' }];
  if (!validLinkToken(body.token)) return [{ error: 'invalid_link' }, 401];
  const g = await db(env).prepare("SELECT * FROM groups WHERE link_hash = ? AND active = 1 AND kind = 'fellowship'").bind(await linkHash(body.token)).first();
  if (!g) return [{ error: 'invalid_link' }, 401];
  return [{ group: { id: g.id, name: g.name } }, 200, { 'Set-Cookie': await linkCookie(env, { group: g.id, version: g.link_version }, ctx.now) }];
}
async function forgetLink() { return [{ link: false }, 200, { 'Set-Cookie': clearLinkCookie() }]; }

async function me(ctx) {
  const role = ctx.role, base = { today: hkToday(ctx.now), member: ctx.session?.role === 'member' };
  if (!role) return [{ ...base, role: null }];
  const groups = await activeGroups(ctx.env), staff = isStaff(role), visible = groups.filter(g => covers(role, g.id)).map(g => publicGroup(g, staff));
  const out = { ...base, role: { role: role.role, group: role.group || null, name: role.role === 'group' ? role.groupName : role.role === 'staff' ? '傳道同工' : '網站管理員' }, groups: visible };
  if (role.role === 'admin') out.staffHasPassword = !!(await staffPassword(ctx.env));
  if (staff) out.sheetsExport = (await db(ctx.env).prepare("SELECT value FROM settings WHERE key = 'sheets_export'").first())?.value ?? null;
  return [out];
}

async function membersFor(env, groupId, meetingId) {
  return (await db(env).prepare(`SELECT id, display_name AS name, status FROM members WHERE group_id = ?1 AND (status = 'active' OR id IN (SELECT member_id FROM attendance WHERE meeting_id = ?2)) ORDER BY id`).bind(groupId, meetingId ?? -1).all()).results;
}
async function marksFor(env, meetingId) {
  const marks = {};
  if (meetingId) for (const a of (await db(env).prepare('SELECT member_id, status FROM attendance WHERE meeting_id = ?').bind(meetingId).all()).results) marks[a.member_id] = a.status;
  return marks;
}
async function meetingPayload(ctx, g, m, scheduled) {
  const today = hkToday(ctx.now), date = scheduled ?? m?.scheduled_date ?? null, current = currentScheduled(g.rule, today);
  const members = g.kind === 'fellowship' ? await membersFor(ctx.env, g.id, m?.id) : [];
  return { group: publicGroup(g, false), today, scheduled_date: date, current_date: current, current: !!scheduled && scheduled === current, alt_dates: date ? altDates(g.rule, date) : [], meeting: meetingOut(m), members, marks: await marksFor(ctx.env, m?.id), nearby: nearbyDates(g.rule, today) };
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
    // 今次: a meeting moved to today wins; otherwise the latest scheduled date reachable today.
    const moved = await db(ctx.env).prepare("SELECT scheduled_date FROM meetings WHERE group_id = ? AND kind = 'regular' AND actual_date = ? AND state = 'held'").bind(g.id, today).first();
    date = moved?.scheduled_date || currentScheduled(g.rule, today);
    if (!date) fail(404, 'no_meeting');
  }
  const m = await db(ctx.env).prepare('SELECT * FROM meetings WHERE group_id = ? AND scheduled_date = ?').bind(g.id, date).first();
  if (!m && !onRule(g.rule, date)) fail(400, 'not_scheduled');
  return [await meetingPayload(ctx, g, m, date)];
}

// Which meeting a write is about: {kind:'regular', scheduled_date} or {kind:'extra', ref | id}.
// Returns {existing, where, args, insert(actual)} where insert() makes the row if it is missing.
async function locateMeeting(ctx, g, b) {
  const env = ctx.env, today = hkToday(ctx.now);
  if (b.kind === 'regular') {
    if (!validDate(b.scheduled_date)) fail(400, 'invalid_date');
    const existing = await db(env).prepare('SELECT * FROM meetings WHERE group_id = ? AND scheduled_date = ?').bind(g.id, b.scheduled_date).first();
    if (!existing && !onRule(g.rule, b.scheduled_date)) fail(400, 'not_scheduled');
    return { existing, where: 'group_id = ? AND scheduled_date = ?', args: [g.id, b.scheduled_date], defaultDate: b.scheduled_date };
  }
  if (b.kind !== 'extra') fail(400, 'invalid_kind');
  let existing;
  if (b.id !== undefined && b.id !== null) {
    existing = await db(env).prepare("SELECT * FROM meetings WHERE id = ? AND kind = 'extra'").bind(Number(b.id) || 0).first();
    if (!existing) fail(404, 'meeting_not_found');
    if (existing.group_id !== g.id) fail(409, 'conflict');
    return { existing, where: 'id = ?', args: [existing.id], defaultDate: today };
  }
  if (typeof b.ref !== 'string' || !/^[0-9a-f-]{36}$/.test(b.ref)) fail(400, 'invalid_ref');
  existing = await db(env).prepare('SELECT * FROM meetings WHERE ref = ?').bind(b.ref).first();
  if (existing && existing.group_id !== g.id) fail(409, 'conflict');
  return { existing, where: 'ref = ?', args: [b.ref], defaultDate: today };
}
function checkDates(ctx, kind, scheduled, actual, state) {
  const today = hkToday(ctx.now);
  if (!validDate(actual)) fail(400, 'invalid_date');
  if (state === 'held' && actual > today) fail(400, 'future_date');
  if (kind === 'regular' && Math.abs(daysBetween(scheduled, actual)) > 31) fail(400, 'reschedule_too_far');
  if (kind === 'extra' && actual < addDays(today, -400)) fail(400, 'invalid_date');
}
// INSERT … ON CONFLICT DO NOTHING for a new meeting row with the given actual date.
function insertMeeting(ctx, g, b, loc, actual, stamp, who) {
  const env = ctx.env;
  if (b.kind === 'regular') return db(env).prepare(`INSERT INTO meetings (group_id, scheduled_date, kind, actual_date, state, updated_at, updated_role) VALUES (?, ?, 'regular', ?, 'held', ?, ?) ON CONFLICT (group_id, scheduled_date) DO NOTHING`).bind(g.id, b.scheduled_date, actual, stamp, who);
  return db(env).prepare(`INSERT INTO meetings (group_id, scheduled_date, kind, actual_date, state, updated_at, updated_role, ref) VALUES (?, NULL, 'extra', ?, 'held', ?, ?, ?) ON CONFLICT (ref) DO NOTHING`).bind(g.id, actual, stamp, who, b.ref);
}

// PUT meeting: change only the fields sent (state, actual_date, new_friends, other_guests,
// headcount, member_count). Creates the meeting if needed.
const COUNT_FIELDS = { new_friends: 999, other_guests: 999, member_count: 999, headcount: 9999 };
async function putMeeting(ctx) {
  const b = ctx.body, g = await allowedGroup(ctx, b.group), env = ctx.env;
  const loc = await locateMeeting(ctx, g, b), set = {};
  if (b.state !== undefined) { if (!['held', 'cancelled'].includes(b.state)) fail(400, 'invalid_state'); set.state = b.state; }
  if (b.actual_date !== undefined) { if (!validDate(b.actual_date)) fail(400, 'invalid_date'); set.actual_date = b.actual_date; }
  for (const [field, max] of Object.entries(COUNT_FIELDS)) {
    if (b[field] === undefined) continue;
    const allowed = g.kind === 'headcount' ? field === 'headcount' : field !== 'headcount';
    if (!allowed) fail(400, 'wrong_group_kind');
    if (!(b[field] === null && (field === 'headcount' || field === 'member_count')) && !validCount(b[field], max)) fail(400, 'invalid_count');
    set[field] = b[field];
  }
  if (!Object.keys(set).length) fail(400, 'invalid_request');
  const e = loc.existing;
  const state = set.state ?? e?.state ?? 'held', actual = set.actual_date ?? e?.actual_date ?? loc.defaultDate;
  checkDates(ctx, b.kind, b.scheduled_date, actual, state);
  const stamp = iso(ctx.now), who = roleName(ctx.role);
  const cols = Object.keys(set);
  const statements = [];
  if (!e) statements.push(insertMeeting(ctx, g, b, loc, actual, stamp, who));
  statements.push(db(env).prepare(`UPDATE meetings SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ?, updated_role = ? WHERE ${loc.where}`).bind(...cols.map(c => set[c]), stamp, who, ...loc.args));
  await db(env).batch(statements);
  const saved = await db(env).prepare(`SELECT * FROM meetings WHERE ${loc.where}`).bind(...loc.args).first();
  return [await meetingPayload(ctx, g, saved, saved.scheduled_date)];
}

// PUT mark: one person's status (present / leave / absent, or null to clear) for one
// meeting. Only that person's row changes. The first mark creates the meeting
// (held, on `actual_date` if given — e.g. 以斯帖團 meeting on Friday).
async function putMark(ctx) {
  const b = ctx.body, g = await allowedGroup(ctx, b.group, 'fellowship'), env = ctx.env;
  const member = Number(b.member);
  if (!Number.isInteger(member) || !await db(env).prepare('SELECT 1 FROM members WHERE id = ? AND group_id = ?').bind(member, g.id).first()) fail(400, 'invalid_member');
  if (b.status !== null && !validStatus(b.status)) fail(400, 'invalid_status');
  const loc = await locateMeeting(ctx, g, b), e = loc.existing;
  if (e?.state === 'cancelled') fail(409, 'meeting_cancelled');
  const actual = e?.actual_date ?? (b.actual_date !== undefined ? b.actual_date : loc.defaultDate);
  checkDates(ctx, b.kind, b.scheduled_date, actual, 'held');
  const stamp = iso(ctx.now), who = roleName(ctx.role), id = `(SELECT id FROM meetings WHERE ${loc.where})`;
  const statements = [];
  if (!e) statements.push(insertMeeting(ctx, g, b, loc, actual, stamp, who));
  statements.push(b.status === null
    ? db(env).prepare(`DELETE FROM attendance WHERE meeting_id = ${id} AND member_id = ?`).bind(...loc.args, member)
    : db(env).prepare(`INSERT INTO attendance (meeting_id, member_id, status, updated_at, updated_role) VALUES (${id}, ?, ?, ?, ?)
        ON CONFLICT (meeting_id, member_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, updated_role = excluded.updated_role`).bind(...loc.args, member, b.status, stamp, who));
  statements.push(db(env).prepare(`UPDATE meetings SET updated_at = ?, updated_role = ? WHERE ${loc.where}`).bind(stamp, who, ...loc.args));
  await db(env).batch(statements);
  const saved = await db(env).prepare(`SELECT * FROM meetings WHERE ${loc.where}`).bind(...loc.args).first();
  return [{ meeting: meetingOut(saved), member, status: b.status, marks: await marksFor(env, saved.id) }];
}

const MEETING_TOTALS = `SELECT m.*, (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id = m.id AND a.status = 'present') AS present FROM meetings m`;
async function history(ctx) {
  const g = await allowedGroup(ctx, ctx.url.searchParams.get('group')), today = hkToday(ctx.now);
  const rows = (await db(ctx.env).prepare(`${MEETING_TOTALS} WHERE m.group_id = ? ORDER BY m.actual_date DESC, m.id DESC LIMIT 40`).bind(g.id).all()).results;
  const items = rows.map(m => ({ ...meetingOut(m), moved: m.kind === 'regular' && isMoved(g.rule, m.scheduled_date, m.actual_date), present: g.kind === 'fellowship' ? membersPresent(m, m.present) : null, total: total(m, m.present) }));
  // Past scheduled dates in the last 12 weeks without a record are listed as 未點名, but only
  // since the group started using the tool (its first meeting record or roster entry).
  const first = await db(ctx.env).prepare('SELECT MIN(d) AS d FROM (SELECT MIN(COALESCE(scheduled_date, actual_date)) AS d FROM meetings WHERE group_id = ?1 UNION ALL SELECT MIN(substr(created_at, 1, 10)) FROM members WHERE group_id = ?1)').bind(g.id).first();
  const recorded = new Set(rows.map(m => m.scheduled_date)), from = [addDays(today, -84), first?.d || today].sort()[1];
  let d = currentScheduled(g.rule, today);
  if (d && d < from && !recorded.has(d)) items.push({ id: null, kind: 'regular', state: 'missing', scheduled_date: d, actual_date: d, total: null });
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
  const row = await db(ctx.env).prepare("INSERT INTO members (group_id, display_name, status, created_at, updated_at, updated_role) VALUES (?, ?, 'active', ?, ?, ?) RETURNING id, display_name AS name, status").bind(g.id, name, stamp, stamp, roleName(ctx.role)).first();
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
  const row = await db(ctx.env).prepare('UPDATE members SET display_name = ?, status = ?, updated_at = ?, updated_role = ? WHERE id = ? RETURNING id, display_name AS name, status').bind(name, status, iso(ctx.now), roleName(ctx.role), m.id).first();
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
  const meetings = rows.map(m => ({ date: m.actual_date, kind: m.kind, present: g.kind === 'fellowship' ? membersPresent(m, m.present) : null, new_friends: m.new_friends, other_guests: m.other_guests, total: total(m, m.present) }));
  // Averages use regular meetings only, like the 《月訊》 table.
  const months = Array.from({ length: 12 }, (_, i) => {
    const list = meetings.filter(m => m.kind === 'regular' && Number(m.date.slice(5, 7)) === i + 1);
    return { month: i + 1, count: list.length, average: list.length ? Math.round(list.reduce((s, m) => s + m.total, 0) / list.length * 10) / 10 : null, new_friends: list.reduce((s, m) => s + m.new_friends, 0) };
  });
  const regular = meetings.filter(m => m.kind === 'regular');
  return [{ group: publicGroup(g, false), year, meetings, months, count: regular.length, average: regular.length ? Math.round(regular.reduce((s, m) => s + m.total, 0) / regular.length * 10) / 10 : null, new_friends: regular.reduce((s, m) => s + m.new_friends, 0) }];
}

// 同工 and admin make or reset a group's roll-call link; the old link and every phone holding
// it stop at once. The SHA-256 finds the group; the encrypted copy lets 同工 show it again.
async function resetLink(ctx) {
  if (!isStaff(ctx.role)) fail(403, 'forbidden');
  const g = await allowedGroup(ctx, ctx.body.group, 'fellowship');
  const token = newLinkToken();
  await db(ctx.env).prepare('UPDATE groups SET link_hash = ?, link_secret = ?, link_version = link_version + 1 WHERE id = ?')
    .bind(await linkHash(token), await sealLink(token, ctx.env.PREVIEW_SESSION_SECRET, g.id), g.id).run();
  return [{ group: g.id, token, version: g.link_version + 1 }];
}
// 同工 and admin show a group's current link again (to resend it). Never cached.
async function showLink(ctx) {
  if (!isStaff(ctx.role)) fail(403, 'forbidden');
  const g = await allowedGroup(ctx, ctx.url.searchParams.get('group'), 'fellowship');
  if (!g.link_hash) fail(404, 'no_link');
  const token = g.link_secret && await unsealLink(g.link_secret, ctx.env.PREVIEW_SESSION_SECRET, g.id);
  if (!token || await linkHash(token) !== g.link_hash) fail(409, 'link_unreadable');
  return [{ group: g.id, token, version: g.link_version }];
}
// Admin sets the one shared 同工 password (random if none given). Shown once; changing it
// signs every 同工 phone out.
async function setStaffPassword(ctx) {
  if (ctx.role?.role !== 'admin') fail(403, 'forbidden');
  let shown = generateCode();
  const typed = ctx.body.password;
  if (typed !== undefined && typed !== null && typed !== '') { if (!normalizeCode(typed)) fail(400, 'invalid_password_format'); shown = typed.trim(); }
  const { salt, hash } = await newCodeHash(normalizeCode(shown), staffSalt(ctx.env));
  const version = ((await staffPassword(ctx.env))?.version || 0) + 1;
  await db(ctx.env).prepare("UPDATE settings SET value = ? WHERE key = 'staff_password'").bind(JSON.stringify({ salt, hash, version })).run();
  return [{ password: shown, version }];
}
// 同工 choose 記名 or 只記人數 for each fellowship. Switching hides names; it deletes nothing.
async function editGroup(ctx) {
  if (!isStaff(ctx.role)) fail(403, 'forbidden');
  const g = await allowedGroup(ctx, ctx.body.group, 'fellowship');
  if (!['names', 'count'].includes(ctx.body.record_mode)) fail(400, 'invalid_mode');
  await db(ctx.env).prepare('UPDATE groups SET record_mode = ? WHERE id = ?').bind(ctx.body.record_mode, g.id).run();
  return [{ group: publicGroup({ ...g, record_mode: ctx.body.record_mode }, true) }];
}

const ROUTES = {
  link: { POST: openLink }, forget: { POST: forgetLink }, me: { GET: me },
  meeting: { GET: getMeeting, PUT: putMeeting }, mark: { PUT: putMark }, history: { GET: history },
  members: { GET: listMembers, POST: addMember, PATCH: editMember },
  report: { GET: report }, 'report.csv': { GET: reportCsv }, stats: { GET: stats },
  links: { GET: showLink, POST: resetLink }, 'staff-password': { POST: setStaffPassword }, group: { PATCH: editGroup },
};
const ANONYMOUS = new Set(['link', 'forget']); // opening a link needs no login
const NO_ROLE = new Set(['me']);              // a plain 會友 may ask what they can do

export async function attendanceApi(request, env, now = Date.now()) {
  const url = new URL(request.url), name = url.pathname.slice('/api/attendance/'.length);
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!route) return reply(request, { error: 'not_found' }, 404);
  const method = request.method === 'HEAD' ? 'GET' : request.method, handler = route[method];
  if (!handler) return reply(request, { error: 'method_not_allowed' }, 405, { Allow: Object.keys(route).join(', ') });
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return reply(request, { error: 'origin_not_allowed' }, 403);
  if (!env.ATT_DB) return reply(request, { error: 'unavailable' }, 503);
  try {
    const ctx = { request, env, url, now, body: null };
    if (!ANONYMOUS.has(name)) {
      ctx.session = await authenticated(request, env); // sessions use the real clock; `now` is for dates and link cookies
      ctx.role = await currentRole(request, env, now, ctx.session);
      if (!ctx.session && !ctx.role) return reply(request, { error: 'authentication_required' }, 401);
      if (!ctx.role && !NO_ROLE.has(name)) return reply(request, { error: 'link_required' }, 403);
    }
    if (method !== 'GET') ctx.body = await readJson(request);
    const result = await handler(ctx);
    return result instanceof Response ? result : reply(request, ...result);
  } catch (error) {
    if (error instanceof Fail) return reply(request, { error: error.code }, error.status);
    throw error;
  }
}

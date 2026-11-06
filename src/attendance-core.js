// Pure attendance helpers: meeting rules, the 《月訊》 month table, totals and
// input checks. No storage or network here, so tests and a later Google Sheets
// export can reuse them.
export const STATUSES = ['present', 'leave', 'absent'];
export const WEEKDAYS = '日一二三四五六';
const DAY = 86400000;

// Hong Kong has no daylight saving, so UTC+8 is exact.
export function hkToday(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '2020-01-01' || s > '2100-12-31') return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function validMonth(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s >= '2020-01' && s <= '2100-12'; }
export function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }
const weekdayOf = date => new Date(date + 'T00:00:00Z').getUTCDay();
const monthOf = date => Number(date.slice(5, 7));
export function daysInMonth(month) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// Week n of the month = days 7n-6 … 7n, i.e. ceil(day / 7). "第二個週五" is always in week 2.
export function weekOfMonth(date) { return Math.ceil(Number(date.slice(8, 10)) / 7); }

// A rule is one {weekday, weeks?, months?, alt?} object or a list of them (any may match).
// `alt` lists other days, relative to the scheduled date, on which the same weekly
// meeting may normally be held: 以斯帖團 is {"weekday":6,"alt":[-1]} (週六, or 週五).
// The meeting keeps its scheduled date as its identity; meeting on an alt day is not 改期.
export function parseRule(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.length > 4) throw new Error('Invalid rule');
  const ints = (a, lo, hi, max = 12) => a === undefined || (Array.isArray(a) && a.length && a.length <= max && a.every(n => Number.isInteger(n) && n >= lo && n <= hi));
  for (const r of list) {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6 || !ints(r.weeks, 1, 5) || !ints(r.months, 1, 12) || !ints(r.alt, -6, 6, 2) || (r.alt || []).includes(0)) throw new Error('Invalid rule');
  }
  return list;
}
const rulesOf = rule => Array.isArray(rule) && rule.every(r => typeof r === 'object') ? rule : parseRule(rule);
const matches = (r, date) => weekdayOf(date) === r.weekday && (!r.weeks || r.weeks.includes(weekOfMonth(date))) && (!r.months || r.months.includes(monthOf(date)));
export function onRule(rule, date) { return rulesOf(rule).some(r => matches(r, date)); }
// Other normal days for the meeting scheduled on `date` (sorted), e.g. the Friday before.
export function altDates(rule, date) {
  const offsets = new Set(rulesOf(rule).filter(r => matches(r, date)).flatMap(r => r.alt || []));
  return [...offsets].sort((a, b) => a - b).map(n => addDays(date, n));
}
// The scheduled date of the "今次" meeting: the latest one already reachable today,
// counting alt days (on a Friday, 以斯帖團's 今次 is the next day's Saturday meeting).
export function currentScheduled(rule, today) {
  const rules = rulesOf(rule), ahead = Math.max(0, ...rules.flatMap(r => (r.alt || []).map(n => -n)));
  for (let i = ahead; i >= 1; i--) {
    const d = addDays(today, i);
    if (onRule(rules, d) && altDates(rules, d).some(x => x <= today)) return d;
  }
  return lastScheduled(rules, today);
}
// An actual date that differs from the scheduled one only counts as 改期 if it is not an alt day.
export function isMoved(rule, scheduled, actual) { return !!scheduled && actual !== scheduled && !altDates(rule, scheduled).includes(actual); }
export function scheduledDates(rule, month) {
  const rules = parseRule(rule), out = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (onRule(rules, date)) out.push(date);
  }
  return out;
}
// Latest scheduled date on or before `date` (the "今次" meeting), or null.
export function lastScheduled(rule, date) {
  const rules = parseRule(rule);
  for (let i = 0; i < 400; i++) { const d = addDays(date, -i); if (onRule(rules, d)) return d; }
  return null;
}
export function nextScheduled(rule, date) {
  const rules = parseRule(rule);
  for (let i = 1; i < 400; i++) { const d = addDays(date, i); if (onRule(rules, d)) return d; }
  return null;
}
// Scheduled dates around today for the meeting picker: up to `before` past ones (incl. today) and the next one.
export function nearbyDates(rule, today, before = 6) {
  const out = [], rules = parseRule(rule), current = currentScheduled(rules, today);
  let d = current;
  while (d && out.length < before) { out.unshift(d); d = lastScheduled(rules, addDays(d, -1)); }
  const next = nextScheduled(rules, current || today);
  if (next) out.push(next);
  return out;
}

// 總人數 = 出席團友 + 新朋友 + 其他來賓; head-count meetings store one number.
// A fellowship on 只記人數 stores the members present as member_count instead of names.
export function total(meeting, present = 0) {
  if (meeting.state !== 'held') return null;
  if (meeting.headcount !== null && meeting.headcount !== undefined) return meeting.headcount;
  const members = meeting.member_count !== null && meeting.member_count !== undefined ? meeting.member_count : present;
  return members + (meeting.new_friends || 0) + (meeting.other_guests || 0);
}
export function membersPresent(meeting, present = 0) { return meeting.member_count ?? present; }

// 《月訊》 table: one row per group, weeks 1–5 by the actual meeting date. Only held
// regular meetings count; cancelled or no record is "/". Two regular meetings in one
// week are added together (double: true). Extra meetings are left out.
// `missing` marks a past scheduled date with no record yet, for the on-screen table.
export function monthTable(groups, meetings, month, today) {
  const start = `${month}-01`, end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  return [...groups].sort((a, b) => a.sort - b.sort).map(group => {
    const cells = Array.from({ length: 5 }, () => ({ value: '/', count: 0, missing: false }));
    const own = meetings.filter(m => m.group_id === group.id && m.kind === 'regular');
    for (const m of own) {
      if (m.state !== 'held' || m.actual_date < start || m.actual_date > end) continue;
      const cell = cells[weekOfMonth(m.actual_date) - 1];
      cell.value = (cell.value === '/' ? 0 : cell.value) + total(m, m.present || 0);
      cell.count++;
    }
    const recorded = new Set(own.map(m => m.scheduled_date));
    for (const date of scheduledDates(group.rule, month)) {
      const cell = cells[weekOfMonth(date) - 1];
      if (date <= today && !recorded.has(date) && cell.value === '/') cell.missing = true;
    }
    return { id: group.id, name: group.name, kind: group.kind, cells: cells.map(c => ({ value: c.value, double: c.count > 1, missing: c.missing })) };
  });
}
export function monthTitle(month) { return `聚會出席人數　${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月份`; }
export const WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];
const csvField = v => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Excel opens UTF-8 CSV correctly only with a BOM.
export function tableCsv(rows) {
  return '﻿' + [['聚會', ...WEEK_LABELS], ...rows.map(r => [r.name, ...r.cells.map(c => c.value)])].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// Display names: the short name used inside the group, 1–20 characters, no control characters.
export function cleanName(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const s = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  return n >= 1 && n <= 20 && !/[\u0000-\u001f\u007f-\u009f<>]/.test(s) ? s : null;
}
export function validCount(n, max = 999) { return Number.isInteger(n) && n >= 0 && n <= max; }
export function validStatus(s) { return STATUSES.includes(s); }

// Passwords for 同工 and the admin: letters and digits; spaces, hyphens and letter case are ignored when typed.
export function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const s = value.normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8,32}$/.test(s) ? s : null;
}
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export function generateCode(length = 10) {
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < length) out += CODE_ALPHABET[b % 31]; // 248 = 8 × 31: unbiased
    }
  }
  return out.slice(0, 5) + '-' + out.slice(5);
}

// Roll-call link tokens: 24 random bytes as base64url (32 characters, 192 bits).
// Only the SHA-256 is stored; a token this long needs no slow hash.
export function newLinkToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}
export const validLinkToken = t => typeof t === 'string' && /^[A-Za-z0-9_-]{32}$/.test(t);
export async function linkHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

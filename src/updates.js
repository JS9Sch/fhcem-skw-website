// /api/updates — 網站更新, an internal log of website changes in 肢體專區 (D1 ATT_DB, table
// site_updates). Every signed-in 會友 reads; only the 網站管理員 adds, edits and deletes.
// A phone holding only a fellowship's roll-call link gets nothing.
import { authenticated } from './auth.js';

export const UPDATE_KINDS = { new: '新功能', improve: '改進', fix: '修正', content: '內容更新', notice: '通知' };
export const UPDATE_AREAS = ['公開網頁', '肢體專區', '講道及資源', '團契點名', '詩歌庫', '房間預約', '詩歌簡報'];
const ROLE_NAMES = { member: '會友', staff: '傳道同工', admin: '網站管理員' };

// The one place that decides who may do what; change only this when personal logins arrive.
export function updatesAccess(session) {
  const role = session?.role;
  return { view: role === 'member' || role === 'staff' || role === 'admin', edit: role === 'admin' };
}

const tidy = (s, max, lines = false) => {
  if (s === undefined || s === null) return '';
  if (typeof s !== 'string') return null;
  let t = s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  t = lines ? t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  return t.length > max ? null : t;
};
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
// Today in Hong Kong, the default day for a new entry.
export const hkDay = now => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);

// Checks one entry from the form; returns { value } or { error }.
export function cleanUpdate(input, now) {
  const day = input.day === undefined || input.day === '' ? hkDay(now) : input.day;
  if (!validDay(day)) return { error: 'invalid_day' };
  if (day > hkDay(now + 86400e3)) return { error: 'future_day' };
  if (!Object.hasOwn(UPDATE_KINDS, input.kind)) return { error: 'invalid_kind' };
  const area = tidy(input.area, 20);
  if (area === null || (area && !UPDATE_AREAS.includes(area))) return { error: 'invalid_area' };
  const title = tidy(input.title, 60);
  if (title === null) return { error: 'title_too_long' };
  if (!title) return { error: 'title_required' };
  const body = tidy(input.body, 1200, true);
  if (body === null) return { error: 'body_too_long' };
  return { value: { day, kind: input.kind, area, title, body } };
}

const out = r => ({ id: r.id, day: r.day, kind: r.kind, kind_name: UPDATE_KINDS[r.kind], area: r.area, title: r.title, body: r.body, created_at: r.created_at, updated_at: r.updated_at, edited: r.updated_at !== r.created_at });
const reply = (request, data, status = 200, headers = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return { error: [415, 'content_type'] };
  const text = await request.text();
  if (text.length > 8192) return { error: [413, 'too_large'] };
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return { value: v }; } catch {}
  return { error: [400, 'invalid_request'] };
}

export async function updatesApi(request, env, { now = Date.now() } = {}) {
  const url = new URL(request.url), method = request.method === 'HEAD' ? 'GET' : request.method;
  if (url.pathname !== '/api/updates') return reply(request, { error: 'not_found' }, 404);
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return reply(request, { error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, PUT, DELETE' });
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return reply(request, { error: 'origin_not_allowed' }, 403);
  if (!env.ATT_DB) return reply(request, { error: 'unavailable' }, 503);
  const session = await authenticated(request, env), access = updatesAccess(session);
  if (!session) return reply(request, { error: 'authentication_required' }, 401);
  if (!access.view) return reply(request, { error: 'forbidden' }, 403);
  const db = env.ATT_DB;
  if (method === 'GET') {
    const { results } = await db.prepare("SELECT * FROM site_updates WHERE state = 'active' ORDER BY day DESC, id DESC LIMIT 500").all();
    return reply(request, { can: { edit: access.edit }, kinds: UPDATE_KINDS, areas: UPDATE_AREAS, today: hkDay(now), updates: results.map(out) });
  }
  if (!access.edit) return reply(request, { error: 'forbidden' }, 403);
  const stamp = new Date(now).toISOString(), who = ROLE_NAMES[session.role] || '網站管理員';
  const id = Number(url.searchParams.get('id'));
  const row = method === 'POST' ? null : Number.isSafeInteger(id) && id > 0 ? await db.prepare("SELECT * FROM site_updates WHERE id = ? AND state = 'active'").bind(id).first() : null;
  if (method !== 'POST' && !row) return reply(request, { error: 'not_found' }, 404);
  if (method === 'DELETE') {
    await db.prepare("UPDATE site_updates SET state = 'deleted', updated_at = ?, updated_role = ? WHERE id = ?").bind(stamp, who, row.id).run();
    return reply(request, { deleted: row.id });
  }
  const body = await readJson(request);
  if (body.error) return reply(request, { error: body.error[1] }, body.error[0]);
  const clean = cleanUpdate(body.value, now);
  if (clean.error) return reply(request, { error: clean.error }, 400);
  const v = clean.value;
  if (method === 'POST') {
    const r = await db.prepare('INSERT INTO site_updates (day, kind, area, title, body, created_at, created_role, updated_at, updated_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(v.day, v.kind, v.area, v.title, v.body, stamp, who, stamp, who).run();
    const made = await db.prepare('SELECT * FROM site_updates WHERE id = ?').bind(r.meta.last_row_id).first();
    return reply(request, { update: out(made) }, 201);
  }
  await db.prepare('UPDATE site_updates SET day = ?, kind = ?, area = ?, title = ?, body = ?, updated_at = ?, updated_role = ? WHERE id = ?')
    .bind(v.day, v.kind, v.area, v.title, v.body, stamp, who, row.id).run();
  return reply(request, { update: out(await db.prepare('SELECT * FROM site_updates WHERE id = ?').bind(row.id).first()) });
}

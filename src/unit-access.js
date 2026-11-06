// Who may use 團契點名, on top of the 肢體專區 login.
// - 會友: the shared member password (src/auth.js), no attendance role by itself.
// - 同工: the one shared 同工 password, typed into the same login box (session kept 90 days).
// - 管理員: the admin password (Worker secret), same login box (90 days).
// - A fellowship's roll-call link: opens only that group's roll call, without the member
//   password. Holding the link gives the full group role; the phone keeps a signed cookie.
// Written so other member tools (rooms) can reuse the same roles later.
import { normalizeCode } from './attendance-core.js';

const encoder = new TextEncoder();
export const LINK_COOKIE = '__Host-fhcem_link';
export const LINK_SECONDS = 90 * 24 * 60 * 60;
// Workers Free allows about 10 ms CPU per request; 20 000 rounds cost about 3 ms.
// A login runs at most one PBKDF2 in the normal case (see identify), so it stays well inside.
export const ITERATIONS = 20000;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) || [], b => parseInt(b, 16));
const same = (a, b) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };

export async function hashCode(code, saltHex) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: ITERATIONS }, material, 256));
}
export async function newCodeHash(code, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  return { salt, hash: await hashCode(code, salt) };
}
export async function codeMatches(code, salt, hash) {
  if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  return same(await hashCode(code, salt), hash);
}
// Worker secret ATTENDANCE_ADMIN_CODE_HASH = "<salt hex>:<hash hex>" (scripts/attendance-hash.mjs).
export function adminHash(env) {
  const m = /^([a-f0-9]{32}):([a-f0-9]{64})$/.exec(env.ATTENDANCE_ADMIN_CODE_HASH || '');
  return m ? { salt: m[1], hash: m[2] } : null;
}
// settings.staff_password = {salt, hash, version}; version +1 on every change signs 同工 phones out.
export async function staffPassword(env) {
  if (!env.ATT_DB) return null;
  const row = await env.ATT_DB.prepare("SELECT value FROM settings WHERE key = 'staff_password'").first();
  try { const v = row?.value ? JSON.parse(row.value) : null; return v && /^[a-f0-9]{32}$/.test(v.salt) && /^[a-f0-9]{64}$/.test(v.hash) && Number.isInteger(v.version) ? v : null; } catch { return null; }
}
// The 同工 password is hashed with the admin secret's salt when there is one, so a login
// that is not the member password costs one PBKDF2 for both checks. After the admin
// secret is rotated the salts differ and a second run is needed until the admin
// sets the 同工 password again.
export const staffSalt = env => adminHash(env)?.salt;

// Password typed into the 肢體專區 login box, after the member password did not match.
export async function identify(password, env) {
  const code = normalizeCode(password);
  if (!code) return null;
  const admin = adminHash(env), staff = await staffPassword(env);
  const salts = [...new Set([admin?.salt, staff?.salt].filter(Boolean))];
  for (const salt of salts) {
    const h = await hashCode(code, salt);
    if (admin && admin.salt === salt && same(h, admin.hash)) return { role: 'admin', version: 0 };
    if (staff && staff.salt === salt && same(h, staff.hash)) return { role: 'staff', version: staff.version };
  }
  return null;
}

export function signingReady(env) { return (env.PREVIEW_SESSION_SECRET || '').length >= 32; }
async function key(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.PREVIEW_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const linkSigned = payload => encoder.encode(`link.${payload}`);

// Link cookie value: group.version.expires.hmac. The version must equal the group's
// current link_version (checked by the caller), so a reset stops old phones at once.
export async function linkCookie(env, { group, version }, now = Date.now()) {
  const expires = Math.floor(now / 1000) + LINK_SECONDS;
  const payload = `${group}.${version}.${expires}`;
  const sig = hex(await crypto.subtle.sign('HMAC', await key(env), linkSigned(payload)));
  return `${LINK_COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${LINK_SECONDS}`;
}
export function clearLinkCookie() { return `${LINK_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

// Signature and expiry only; enough to serve the (data-free) page and script.
export async function readLink(request, env, now = Date.now()) {
  if (!signingReady(env)) return null;
  const token = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(LINK_COOKIE + '='))?.slice(LINK_COOKIE.length + 1);
  if (!token || token.length > 200) return null;
  const m = /^([a-z0-9-]{1,40})\.(\d{1,9})\.(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!m) return null;
  const [, group, version, expiresText, sig] = m, expires = Number(expiresText), current = Math.floor(now / 1000);
  if (expires <= current || expires > current + LINK_SECONDS) return null;
  if (!await crypto.subtle.verify('HMAC', await key(env), unhex(sig), linkSigned(`${group}.${version}.${expiresText}`))) return null;
  return { group, version: Number(version), expires };
}

export function covers(role, groupId) { return !!role && (role.role === 'staff' || role.role === 'admin' || (role.role === 'group' && role.group === groupId)); }
export const isStaff = role => !!role && (role.role === 'staff' || role.role === 'admin');
// Recorded with every change: 「保羅團連結」, 「傳道同工」 or 「網站管理員」.
export const roleName = role => role.role === 'group' ? `${role.groupName}連結` : role.role === 'staff' ? '傳道同工' : '網站管理員';

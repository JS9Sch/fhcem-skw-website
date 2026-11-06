// 肢體專區 sessions. One password box: the member password signs in a 會友 for 8 hours;
// the 同工 password or the admin password (checked in unit-access.js) sign in 同工 or
// 管理員, kept on that phone for 90 days. Every session also has a server record
// (Durable Object), so logout revokes a copied cookie.
import { staffPassword } from './unit-access.js';

const encoder = new TextEncoder();
export const COOKIE = '__Host-fhcem_preview';
export const SESSION_SECONDS = 8 * 60 * 60;
export const STAFF_SESSION_SECONDS = 90 * 24 * 60 * 60;
const ROLES = ['member', 'staff', 'admin'];
const lifetime = role => role === 'member' ? SESSION_SECONDS : STAFF_SESSION_SECONDS;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) || [], b => parseInt(b, 16));
export function configured(env) {
  return /^[a-f0-9]{64}$/i.test(env.PREVIEW_PASSWORD_HASH || '') && (env.PREVIEW_SESSION_SECRET || '').length >= 32;
}
export async function passwordMatches(password, env) {
  if (!configured(env) || typeof password !== 'string' || password.length > 128) return false;
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(password)));
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= digest.charCodeAt(i) ^ env.PREVIEW_PASSWORD_HASH.toLowerCase().charCodeAt(i);
  return diff === 0;
}
async function key(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.PREVIEW_SESSION_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
// Rotating the member password signs everyone out; rotating the admin secret signs admins out.
const signed = (payload, role, env) => encoder.encode(`${payload}.${env.PREVIEW_PASSWORD_HASH}${role === 'admin' ? '.' + env.ATTENDANCE_ADMIN_CODE_HASH : ''}`);

// Cookie value: role.version.expires.id.hmac (version = 同工 password version, else 0).
export async function sessionCookie(env, now = Date.now(), { role = 'member', version = 0 } = {}) {
  if (!ROLES.includes(role)) throw new Error('Invalid role');
  const seconds = lifetime(role), expires = Math.floor(now / 1000) + seconds;
  const id = crypto.randomUUID();
  const payload = `${role}.${version}.${expires}.${id}`;
  const sig = hex(await crypto.subtle.sign('HMAC', await key(env), signed(payload, role, env)));
  await storedSession(env, id, 'create', expires);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export class SessionStorageUnavailable extends Error {
  constructor() { super('Session storage unavailable'); }
}
async function storedSession(env, id, operation, ...args) {
  try {
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(id));
    return await stub[operation](...args);
  } catch {
    throw new SessionStorageUnavailable();
  }
}
async function verifiedToken(request, env, now) {
  if (!configured(env)) return false;
  const token = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!token || token.length > 220) return false;
  const match = token.match(/^(member|staff|admin)\.(\d{1,9})\.(\d+)\.([a-f0-9-]{36})\.([a-f0-9]{64})$/);
  if (!match) return false;
  const [, role, versionText, expiresText, id, sig] = match, expires = Number(expiresText), current = Math.floor(now / 1000);
  if (expires <= current || expires > current + lifetime(role)) return false;
  if (role === 'admin' && !env.ATTENDANCE_ADMIN_CODE_HASH) return false;
  if (!await crypto.subtle.verify('HMAC', await key(env), unhex(sig), signed(`${role}.${versionText}.${expiresText}.${id}`, role, env))) return false;
  return { role, version: Number(versionText), id, expires };
}
// Returns {role, version, id, expires} for an active session, else false.
// A 同工 session also needs the current 同工 password version, so changing it signs 同工 out.
export async function authenticated(request, env, now = Date.now()) {
  const token = await verifiedToken(request, env, now);
  if (!token) return false;
  if ((await storedSession(env, token.id, 'active', token.expires)) !== true) return false;
  if (token.role === 'staff') {
    let current = null;
    try { current = await staffPassword(env); } catch { return false; } // database outage: fail closed
    if (current?.version !== token.version) return false;
  }
  return token;
}
export async function revokeSession(request, env, now = Date.now()) {
  if (!configured(env)) throw new SessionStorageUnavailable();
  const token = await verifiedToken(request, env, now);
  if (token) await storedSession(env, token.id, 'revoke');
}

// Unit codes and the role cookie, on top of the shared member session.
// Roles: group (one group only), staff (all groups, can reset group codes) and
// admin (staff + sets the staff code). Written so other member tools (rooms) can
// reuse the same unlocked role.
const encoder = new TextEncoder();
export const ROLE_COOKIE = '__Host-fhcem_att';
export const ROLE_SECONDS = 90 * 24 * 60 * 60;
// Workers Free allows about 10 ms CPU per request; 20 000 rounds cost about 3 ms.
// Codes are random and rate-limited, so this guards a copied database, not live guessing.
export const ITERATIONS = 20000;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) || [], b => parseInt(b, 16));

export async function hashCode(code, saltHex) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: ITERATIONS }, material, 256));
}
export async function newCodeHash(code) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashCode(code, salt) };
}
export async function codeMatches(code, salt, hash) {
  if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  const actual = await hashCode(code, salt);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
// Worker secret ATTENDANCE_ADMIN_CODE_HASH = "<salt hex>:<hash hex>" (scripts/attendance-hash.mjs).
export function adminHash(env) {
  const m = /^([a-f0-9]{32}):([a-f0-9]{64})$/.exec(env.ATTENDANCE_ADMIN_CODE_HASH || '');
  return m ? { salt: m[1], hash: m[2] } : null;
}
export function signingReady(env) { return (env.PREVIEW_SESSION_SECRET || '').length >= 32; }
async function key(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.PREVIEW_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// The admin signature also covers the admin code hash, so rotating that secret signs every admin out.
const signed = (payload, role, env) => encoder.encode(`att.${payload}.${role === 'admin' ? env.ATTENDANCE_ADMIN_CODE_HASH : ''}`);

// Cookie value: role.group.version.expires.hmac
export async function roleCookie(env, { role, group = '-', version = 0 }, now = Date.now()) {
  const expires = Math.floor(now / 1000) + ROLE_SECONDS;
  const payload = `${role}.${group}.${version}.${expires}`;
  const sig = hex(await crypto.subtle.sign('HMAC', await key(env), signed(payload, role, env)));
  return `${ROLE_COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ROLE_SECONDS}`;
}
export function clearRoleCookie() { return `${ROLE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

// Signature and expiry only; the caller compares `version` with the current code version.
export async function readRole(request, env, now = Date.now()) {
  if (!signingReady(env)) return null;
  const token = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(ROLE_COOKIE + '='))?.slice(ROLE_COOKIE.length + 1);
  if (!token || token.length > 200) return null;
  const m = /^(group|staff|admin)\.([a-z0-9-]{1,40})\.(\d{1,9})\.(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!m) return null;
  const [, role, group, version, expiresText, sig] = m, expires = Number(expiresText), current = Math.floor(now / 1000);
  if (expires <= current || expires > current + ROLE_SECONDS) return null;
  if ((role === 'group') === (group === '-')) return null;
  if (!await crypto.subtle.verify('HMAC', await key(env), unhex(sig), signed(`${role}.${group}.${version}.${expiresText}`, role, env))) return null;
  return { role, group: role === 'group' ? group : null, version: Number(version), expires };
}
export function covers(role, groupId) { return !!role && (role.role === 'staff' || role.role === 'admin' || (role.role === 'group' && role.group === groupId)); }
export const isStaff = role => !!role && (role.role === 'staff' || role.role === 'admin');
export const roleName = role => role.role === 'group' ? `group:${role.group}` : role.role;

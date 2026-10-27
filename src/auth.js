const encoder = new TextEncoder();
export const COOKIE = '__Host-fhcem_preview';
const SESSION_SECONDS = 8 * 60 * 60;
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
export async function sessionCookie(env, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const id = crypto.randomUUID();
  const payload = `${expires}.${id}`;
  const sig = hex(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(`${payload}.${env.PREVIEW_PASSWORD_HASH}`)));
  await storedSession(env, id, 'create', expires);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
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
  if (!token || token.length > 200) return false;
  const match = token.match(/^(\d+)\.([a-f0-9-]{36})\.([a-f0-9]{64})$/);
  if (!match) return false;
  const expires = Number(match[1]), current = Math.floor(now / 1000);
  if (expires <= current || expires > current + SESSION_SECONDS) return false;
  if (!await crypto.subtle.verify('HMAC', await key(env), unhex(match[3]), encoder.encode(`${match[1]}.${match[2]}.${env.PREVIEW_PASSWORD_HASH}`))) return false;
  return { id: match[2], expires };
}
export async function authenticated(request, env, now = Date.now()) {
  const token = await verifiedToken(request, env, now);
  return token ? (await storedSession(env, token.id, 'active', token.expires)) === true : false;
}
export async function revokeSession(request, env, now = Date.now()) {
  if (!configured(env)) throw new SessionStorageUnavailable();
  const token = await verifiedToken(request, env, now);
  if (token) await storedSession(env, token.id, 'revoke');
}

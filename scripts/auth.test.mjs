import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {sessionCookie,authenticated,passwordMatches,configured,COOKIE} from '../src/auth.js';
const env={PREVIEW_PASSWORD_HASH:createHash('sha256').update('test-only-not-a-deployed-password').digest('hex'),PREVIEW_SESSION_SECRET:randomBytes(32).toString('hex')};
const request=token=>new Request('https://preview.example/members/',{headers:{Cookie:token.split(';')[0]}});
test('correct password succeeds; wrong and malformed inputs fail',async()=>{assert(await passwordMatches('test-only-not-a-deployed-password',env));assert(!await passwordMatches('wrong',env));assert(!await passwordMatches(null,env));assert(!await passwordMatches('x'.repeat(129),env));assert(!configured({}))});
test('session is HttpOnly/Secure/Strict, authenticates only with valid signature',async()=>{const cookie=await sessionCookie(env);assert(cookie.startsWith(COOKIE+'='));for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert(cookie.includes(flag));assert(await authenticated(request(cookie),env));const modified=cookie.replace(/=\d/, '=9');assert(!await authenticated(request(modified),env));assert(!await authenticated(request(cookie),{...env,PREVIEW_SESSION_SECRET:'different-secret'.repeat(4)}));assert(!await authenticated(new Request('https://preview.example'),env))});
test('expiry and password rotation invalidate sessions',async()=>{const now=Date.now(),cookie=await sessionCookie(env,now);assert(!await authenticated(request(cookie),env,now+8*3600*1000));assert(!await authenticated(request(cookie),{...env,PREVIEW_PASSWORD_HASH:'b'.repeat(64)},now));assert(!await authenticated(request(cookie),{},now))});

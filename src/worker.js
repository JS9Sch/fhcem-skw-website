import memberScript from './member-app.txt';
import memberHTML from './member-index.txt';
import { memberResources } from './member-resources.js';
import { attendanceApi } from './attendance.js';
import { configured, passwordMatches, sessionCookie, clearCookie, authenticated, revokeSession, SessionStorageUnavailable } from './auth.js';
export { PreviewSession } from './session-store.js';
// Member views share one protected page; the script picks the view from the path.
const MEMBER_VIEWS = ['attendance', 'songs', 'rooms', 'ppt', 'resources'];
const memberPagePath = path => path === '/members/' || MEMBER_VIEWS.some(v => path === `/members/${v}/`);
function json(data, status=200, headers={}) {
 return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
async function login(request, env) {
 if (!configured(env) || !env.LOGIN_LIMITER || !env.SESSIONS) return json({error:'unavailable'},503);
 const {success}=await env.LOGIN_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'local'});
 if (!success) return json({error:'rate_limited'},429,{'Retry-After':'60'});
 if (!(request.headers.get('Content-Type')||'').startsWith('application/json')) return json({error:'content_type'},415);
 const reader=request.body?.getReader();if(!reader)return json({error:'invalid_request'},400);
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return json({error:'too_large'},413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{return json({error:'invalid_request'},400)}
 if (!await passwordMatches(body?.password,env)) return json({error:'invalid_password'},401);
 return json({authenticated:true},200,{'Set-Cookie':await sessionCookie(env)});
}
async function handle(request, env) {
 const url=new URL(request.url), path=url.pathname;
 if (path==='/api/login'||path==='/api/logout') {
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,{'Allow':'POST'});
  if(request.headers.get('Origin')!==url.origin)return json({error:'origin_not_allowed'},403);
  if(path==='/api/logout') {
   await revokeSession(request,env);
   return json({authenticated:false},200,{'Set-Cookie':clearCookie()});
  }
  return login(request,env);
 }
 // Attendance checks its own methods and, for writes, the Origin (same rule as login).
 if(path.startsWith('/api/attendance/'))return attendanceApi(request,env);
 if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
 if(path==='/api/session')return json({authenticated:await authenticated(request,env)});
 if(path==='/api/member-resources')return memberResources(request,env);
 if(path.startsWith('/api/'))return json({error:'not_found'},404);
 if(path==='/members'||path.startsWith('/members/')) {
  if(path==='/members'||MEMBER_VIEWS.some(v=>path===`/members/${v}`))return new Response(null,{status:301,headers:{Location:path+'/'}});
  if(!await authenticated(request,env)) {
   if(path==='/members/app.js')return json({error:'authentication_required'},401);
   const next=memberPagePath(path)?path:'/members/';
   return new Response(null,{status:302,headers:{Location:'/login/?next='+encodeURIComponent(next),'Cache-Control':'no-store'}});
  }
  if(path==='/members/app.js')return new Response(request.method==='HEAD'?null:memberScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
  if(memberPagePath(path))return new Response(request.method==='HEAD'?null:memberHTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 }
 if(path==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain'}});
 return env.ASSETS.fetch(request);
}
export default {async fetch(request,env){
 let result;
 try { result=await handle(request,env); }
 catch(error) {
  if (!(error instanceof SessionStorageUnavailable)) throw error;
  result=json({error:'unavailable'},503);
 }
 const response=new Response(result.body,result);
 if(new URL(request.url).pathname.endsWith('.pdf')&&response.headers.get('Content-Type')?.includes('application/pdf'))response.headers.set('Content-Disposition','inline');
 response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 const memberPage = memberPagePath(new URL(request.url).pathname) && response.status === 200;
 response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; frame-src " + (memberPage ? 'https://docs.google.com' : "'none'"));
 return response;
}};

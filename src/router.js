// Request routing for the Worker. src/worker.js passes in the two protected files
// (bundled as text), so this module also runs under node:test.
import { memberResources } from './member-resources.js';
import { attendanceApi } from './attendance.js';
import { songsApi, googleApi } from './songs.js';
import { configured, passwordMatches, sessionCookie, clearCookie, authenticated, revokeSession, SessionStorageUnavailable } from './auth.js';
import { identify, readLink } from './unit-access.js';
// Member views share one protected page; the script picks the view from the path.
const MEMBER_VIEWS = ['attendance', 'songs', 'rooms', 'ppt', 'resources'];
const memberPagePath = path => path === '/members/' || MEMBER_VIEWS.some(v => path === `/members/${v}/`);
// A phone holding a fellowship's roll-call link (and no member login) may open only these.
const LINK_PATHS = ['/members/attendance/', '/members/app.js'];
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
 // One box: the member password (cheap SHA-256) first, then the 同工 / admin password.
 const who=await passwordMatches(body?.password,env)?{role:'member',version:0}:await identify(body?.password,env);
 if (!who) return json({error:'invalid_password'},401);
 return json({authenticated:true,role:who.role},200,{'Set-Cookie':await sessionCookie(env,Date.now(),who)});
}
async function handle(request, env, { memberScript, memberHTML, waitUntil }) {
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
 // 詩歌庫 (same rule: methods, Origin for writes, then the 肢體專區 login) and its Google connection.
 if(path.startsWith('/api/songs/'))return songsApi(request,env,{waitUntil});
 if(path.startsWith('/api/google/'))return googleApi(request,env);
 if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
 if(path==='/api/session'){
  const session=await authenticated(request,env);
  if(session)return json({authenticated:true,role:session.role});
  return json(await readLink(request,env)?{authenticated:false,link:true}:{authenticated:false});
 }
 if(path==='/api/member-resources')return memberResources(request,env);
 if(path.startsWith('/api/'))return json({error:'not_found'},404);
 if(path==='/members'||path.startsWith('/members/')) {
  if(path==='/members'||MEMBER_VIEWS.some(v=>path===`/members/${v}`))return new Response(null,{status:301,headers:{Location:path+'/'}});
  if(!await authenticated(request,env)&&!(LINK_PATHS.includes(path)&&await readLink(request,env))) {
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
export async function respond(request, env, files) {
 let result;
 try { result=await handle(request,env,files); }
 catch(error) {
  if (!(error instanceof SessionStorageUnavailable)) throw error;
  result=json({error:'unavailable'},503);
 }
 const response=new Response(result.body,result);
 // Static PDFs open in the browser; API PDFs (詩歌庫) set their own inline/attachment name.
 if(new URL(request.url).pathname.endsWith('.pdf')&&response.headers.get('Content-Type')?.includes('application/pdf')&&!response.headers.has('Content-Disposition'))response.headers.set('Content-Disposition','inline');
 response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 const memberPage = memberPagePath(new URL(request.url).pathname) && response.status === 200;
 // The 肢體專區 page (one document for every member view) also allows Google Picker for the
 // 詩歌庫: api.js from apis.google.com, the Picker iframe on docs.google.com / drive.google.com.
 // Public pages keep script-src 'self' and no frames.
 response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'" + (memberPage ? ' https://apis.google.com' : '') + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; frame-src " + (memberPage ? 'https://docs.google.com https://drive.google.com' : "'none'"));
 return response;
}

import memberScript from './member-app.txt';
import memberHTML from './member-index.txt';
import { configured, passwordMatches, sessionCookie, clearCookie, authenticated } from './auth.js';
const legacyRoutes = {
  "/about_us": "/#/about",
  "/untitled-c1142": "/#/faith",
  "/untitled-cdu5": "/#/history",
  "/about1": "/#/meetings",
  "/untitled-c1hcf": "/#/churches",
  "/services": "/#/activities",
  "/untitled-ceh6": "/#/notices",
  "/visit_us": "/#/visit",
  "/brethren": "/#/members/resources",
  "/_files/ugd/56f401_85c10deba2d936e237fda3a4bb3aa5ed.pdf": "/documents/weather.pdf",
  "/_files/ugd/56f401_4bcf3cd3d53f5a796550e0e59568098e.pdf": "/documents/song-copyright.pdf",
  "/_files/ugd/56f401_fadb6546e01895ebc243b3c3ca68a304.pdf": "/documents/recreation.pdf",
  "/_files/ugd/56f401_74069852a3b54e26bceaf39a6fb5244a.pdf": "/documents/weddings-funerals.pdf"
};
function json(data, status=200, headers={}) {
 return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
async function login(request, env) {
 if (!configured(env) || !env.LOGIN_LIMITER) return json({error:'unavailable'},503);
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
  if(path==='/api/logout')return json({authenticated:false},200,{'Set-Cookie':clearCookie()});
  return login(request,env);
 }
 if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
 if(path==='/api/session')return json({authenticated:await authenticated(request,env)});
 if(path.startsWith('/api/'))return json({error:'not_found'},404);
 if(path==='/members'||path.startsWith('/members/')) {
  if(!await authenticated(request,env)) {
   if(path==='/members/app.js')return json({error:'authentication_required'},401);
   return new Response(null,{status:302,headers:{Location:'/?login=1#/','Cache-Control':'no-store'}});
  }
  if(path==='/members/app.js')return new Response(request.method==='HEAD'?null:memberScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
  if(['/members','/members/','/members/index.html'].includes(path))return new Response(request.method==='HEAD'?null:memberHTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 }
 if (legacyRoutes[path])return new Response(null,{status:302,headers:{Location:legacyRoutes[path]}});
 if(path==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain'}});
 return env.ASSETS.fetch(request);
}
export default {async fetch(request,env){
 const result=await handle(request,env),response=new Response(result.body,result);
 if(new URL(request.url).pathname.endsWith('.pdf')&&response.headers.get('Content-Type')?.includes('application/pdf'))response.headers.set('Content-Disposition','inline');
 response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
 return response;
}};

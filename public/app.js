const $ = (selector, root=document) => root.querySelector(selector);
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = () => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7l2 3h9v12H3z"/></svg>';
const brand='<a class="brand" href="#/"><span class="cross" aria-hidden="true"></span><span><strong>信望愛福音會</strong><small>筲箕灣堂</small></span></a>';
let toastTimer, pendingMemberHash='#/members', routeSequence=0;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500)}
function openLogin(){ $('#login-error').textContent='';$('#preview-password').value='';if(!$('#entry').open)$('#entry').showModal();$('#preview-password').focus(); }
async function enter(){try{const r=await fetch('/api/session',{cache:'no-store'});const s=await r.json();if(r.ok&&s.authenticated){location.assign('/members/'+pendingMemberHash);return}}catch{}openLogin()}
$('#entry').addEventListener('click',e=>{if(e.target===$('#entry'))$('#entry').close()});
$('#close-entry').addEventListener('click',()=>$('#entry').close());
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('#login-submit'),input=$('#preview-password');button.disabled=true;button.textContent='正在登入…';$('#login-error').textContent='';
 try{
  const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});input.value='';
  if(!response.ok){$('#login-error').textContent=response.status===429?'嘗試次數較多，請一分鐘後再試。':response.status===503?'臨時登入尚未就緒，請稍後再試。':'密碼不正確，請重新輸入。';input.focus();return}
  location.assign('/members/'+pendingMemberHash);
 }catch{input.value='';$('#login-error').textContent='連線未完成，請檢查網絡後再試。'}
 finally{button.disabled=false;button.textContent='登入肢體專區 →'}
});
function bindPublic(){document.querySelectorAll('[data-enter]').forEach(b=>b.addEventListener('click',()=>{pendingMemberHash='#/members';enter()}));$('.mobile-menu')?.addEventListener('click',e=>{const open=$('.site-header nav').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(open))});$('#contact-demo')?.addEventListener('submit',e=>{e.preventDefault();toast('欄位檢查完成。這是展示版，沒有送出訊息。')})}
async function route(){
 const sequence=++routeSequence;const path=location.hash.replace(/^#/,'')||'/';const members=path==='/members'||path.startsWith('/members/');clearTimeout(toastTimer);$('#toast').classList.remove('visible');
 $('#app').innerHTML=members||path==='/'?renderPublicHome():renderPublicPage(path.slice(1));document.title=`${publicTitles[path.slice(1)]||'筲箕灣堂'} · 新站提案`;
 bindPublic();bindPublicControls();window.scrollTo({top:0,behavior:'instant'});activatePageMotion();
 if(members){pendingMemberHash='#'+path;try{const r=await fetch('/api/session',{cache:'no-store'}),s=await r.json();if(sequence!==routeSequence)return;if(r.ok&&s.authenticated){location.replace('/members/'+pendingMemberHash);return}}catch{}if(sequence===routeSequence)openLogin()}
}
$('.skip').addEventListener('click',e=>{e.preventDefault();const main=$('#main');main.tabIndex=-1;main.focus();main.scrollIntoView()});
window.addEventListener('hashchange',route);route();
if(new URLSearchParams(location.search).get('login')==='1'){history.replaceState(null,'',location.pathname+location.hash);openLogin()}

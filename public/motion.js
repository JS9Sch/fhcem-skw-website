/* Finite motion only; system reduced-motion always takes precedence. */
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let motionOff=false;try{motionOff=localStorage.getItem('fhcem-motion')==='off'}catch{}
let revealObserver;
function motionEnabled(){return !motionOff&&!motionPreference.matches}
function syncMotion(){const on=motionEnabled();document.body.dataset.motion=on?'on':'off';document.documentElement.style.scrollBehavior=on?'smooth':'auto';const button=document.getElementById('motion-toggle');document.getElementById('motion-state').textContent=motionPreference.matches?'依系統關閉':on?'開':'關';button.setAttribute('aria-pressed',String(on));button.disabled=motionPreference.matches;if(!on){revealObserver?.disconnect();document.querySelectorAll('.will-reveal').forEach(e=>e.classList.remove('will-reveal'));document.getAnimations().forEach(a=>a.cancel())}}
function activatePageMotion(){revealObserver?.disconnect();syncMotion();if(!motionEnabled())return;
 revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.remove('will-reveal');entry.target.classList.add('revealed');revealObserver.unobserve(entry.target)}}),{threshold:0.05,rootMargin:'0px 0px -16px 0px'});
 document.querySelectorAll('[data-reveal]').forEach((el,i)=>{el.style.setProperty('--reveal-delay',Math.min(i%3*55,110)+'ms');el.classList.add('will-reveal');revealObserver.observe(el)});
 const workTitle=document.querySelector('.work-title');if(workTitle)workTitle.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:280,easing:'ease-out'});
}
function bindPublicControls(){document.querySelectorAll('[data-doc-jump]').forEach(button=>button.addEventListener('click',()=>{const target=document.getElementById(button.dataset.docJump);target?.focus({preventScroll:true});target?.scrollIntoView({behavior:motionEnabled()?'smooth':'instant',block:'start'})}));document.querySelectorAll('[data-meeting-filter]').forEach(button=>button.addEventListener('click',()=>{const cat=button.dataset.meetingFilter;document.querySelectorAll('[data-meeting-filter]').forEach(b=>{const selected=b===button;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('[data-meeting-category]').forEach(row=>{row.hidden=cat!=='全部'&&row.dataset.meetingCategory!==cat;if(!row.hidden){row.classList.remove('will-reveal');if(motionEnabled())row.animate([{opacity:.2,transform:'translateY(7px)'},{opacity:1,transform:'none'}],{duration:260})}})}))}
document.getElementById('motion-toggle').addEventListener('click',()=>{motionOff=!motionOff;try{localStorage.setItem('fhcem-motion',motionOff?'off':'on')}catch{}syncMotion()});
motionPreference.addEventListener('change',syncMotion);
document.addEventListener('focusin',e=>{e.target.closest('.will-reveal')?.classList.remove('will-reveal')});
document.addEventListener('click',e=>{if(!motionEnabled())return;const status=e.target.closest('[data-status]');if(status)document.querySelectorAll('#att-stats strong').forEach(el=>el.animate([{transform:'translateY(-3px)',opacity:.4},{transform:'none',opacity:1}],{duration:220}));});
syncMotion();

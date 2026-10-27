from pathlib import Path
from playwright.sync_api import sync_playwright,expect
import getpass,json,sys
from browser_target import browser_target, browser_context, require_page_origin
BASE,LOCAL_TLS=browser_target(sys.argv[1] if len(sys.argv)>1 else 'https://localhost:8787')
OUT=Path(__file__).resolve().parents[1]/'evidence/auth';password=getpass.getpass('Preview password (hidden): ')
checks=[];errors=[];sensitive=[password]
OUT.mkdir(parents=True,exist_ok=True)
try:
 with sync_playwright() as p:
  b=p.chromium.launch()
  anon=browser_context(b,BASE);assert anon.request.get(BASE+'/members/app.js',max_redirects=0).status==401
  r=anon.request.get(BASE+'/members/',max_redirects=0);assert r.status==302
  assert anon.request.post(BASE+'/api/login',headers={'Origin':'https://unrelated.example'},data={'password':'invalid'}).status==403
  assert anon.request.get(BASE+'/api/session').json()['authenticated']==False
  checks.append('Unauthenticated HTML redirected; private JS denied; cross-origin login blocked')
  for width,height in [(390,844),(320,740),(1440,1000)]:
   ctx=browser_context(b,BASE,viewport={'width':width,'height':height},locale='zh-HK',accept_downloads=True)
   page=ctx.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(BASE+'/#/members/attendance');expect(page.locator('#entry')).to_be_visible()
   if width==390:
    page.locator('#preview-password').fill('wrong-preview-test');page.locator('#login-submit').click();expect(page.locator('#login-error')).to_contain_text('密碼不正確')
    assert page.locator('#preview-password').input_value()==''
    page.screenshot(path=str(OUT/'login-phone.png'),full_page=True)
   page.evaluate("localStorage.setItem('fhcem-preview-v1',JSON.stringify({unit:'本人',attendance:{'本人:2026-11-01':{A:'出席',B:'未記錄',C:'未記錄',D:'未記錄',E:'未記錄',F:'未記錄'}},bookings:[]}))")
   require_page_origin(page,BASE)
   page.locator('#preview-password').fill(password);page.locator('#login-submit').click()
   expect(page.locator('h1')).to_have_text('團契點名');expect(page.locator('.unit-label')).to_have_text('網站管理員')
   assert page.request.get(BASE+'/members/app.js').status==200
   assert page.request.get(BASE+'/api/session').json()['authenticated']
   cookies=ctx.cookies();cookie=next(c for c in cookies if c['name']=='__Host-fhcem_preview');assert cookie['httpOnly'] and cookie['secure'] and cookie['sameSite']=='Strict'
   sensitive.append(cookie['value'])
   assert '__Host-fhcem_preview' not in page.evaluate('document.cookie')
   assert password not in page.request.get(BASE+'/app.js').text();assert password not in page.request.get(BASE+'/members/app.js').text()
   saved=page.evaluate("JSON.parse(localStorage.getItem('fhcem-preview-v1'))");assert saved['unit']=='網站管理員';assert '網站管理員:2026-11-01' in saved['attendance'];assert '本人:2026-11-01' not in saved['attendance']
   page.reload();expect(page.locator('h1')).to_have_text('團契點名')
   for route,title in [('attendance','團契點名'),('songs','詩歌庫'),('rooms','房間預約'),('ppt','詩歌簡報')]:
    page.goto(BASE+'/members/#/members/'+route);expect(page.locator('h1')).to_have_text(title)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,route)
   page.locator('[data-enter]').click();expect(page.locator('#unit option[value="本人"]')).to_have_count(0);assert '本人' not in page.locator('#unit').inner_text();expect(page.locator('#unit')).to_have_value('網站管理員');page.locator('#enter-demo').click();expect(page.locator('h1')).to_contain_text('網站管理員')
   page.screenshot(path=str(OUT/f'workspace-{width}.png'),full_page=True)
   copied_cookie=cookie['name']+'='+cookie['value']
   page.locator('#member-logout').click();expect(page).to_have_url(BASE+'/');assert page.request.get(BASE+'/members/app.js').status==401
   assert anon.request.get(BASE+'/members/app.js',headers={'Cookie':copied_cookie},max_redirects=0).status==401
   assert not anon.request.get(BASE+'/api/session',headers={'Cookie':copied_cookie},max_redirects=0).json()['authenticated']
   del copied_cookie,cookie,cookies
   page.goto(BASE+'/members/#/members/attendance');expect(page.locator('#entry')).to_be_visible()
   ctx.close()
  assert not errors,errors
  checks.append('390×844, 320×740, 1440×1000: password login, refresh, four tools, unit switch, admin-name migration, logout, direct-link denial')
  checks.append('Signed session cookie is HttpOnly/Secure/SameSite Strict; no password in frontend scripts')
  out={'base':BASE,'checks':checks,'pageErrors':errors};(OUT/('live-check.json' if BASE.startswith('https') else 'local-check.json')).write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False));b.close()
except Exception as e:
 message=str(e)
 for value in sensitive:message=message.replace(value,'[REDACTED]')
 print(message);raise SystemExit(1)

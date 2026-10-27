"""Read-only resource checks. Password/cookies/source URLs never enter evidence logs."""
from pathlib import Path
from urllib.parse import urljoin
import getpass,json,sys,traceback,re
from playwright.sync_api import sync_playwright,expect
from browser_target import browser_target,same_origin
BASE,LOCAL=browser_target(sys.argv[1] if len(sys.argv)>1 else 'https://localhost:8788')
OUT=Path(__file__).resolve().parents[1]/'evidence/resources'
OUT.mkdir(parents=True,exist_ok=True)
password=getpass.getpass('Preview password (hidden): ')
checks=[];step='start'
try:
 with sync_playwright() as p:
  api=p.request.new_context(ignore_https_errors=LOCAL)
  assert api.get(BASE+'/api/member-resources',max_redirects=0).status==401
  step='login'
  login=api.post(BASE+'/api/login',max_redirects=0,headers={'Origin':BASE},data={'password':password});password=None
  assert login.status==200
  cookies=api.storage_state()['cookies']
  token=login.headers['set-cookie'].split(';',1)[0]
  r=api.get(BASE+'/api/member-resources',max_redirects=0)
  assert r.status==200 and r.headers['cache-control']=='no-store'
  sources=r.json();assert len(sources['sermons']['tabs'])==16
  b=p.chromium.launch()
  for width,height in [(390,844),(320,740),(1440,1000)]:
   step='browser-'+str(width)
   # Browser always validates third-party TLS. Only exact local-origin requests
   # use a separate local transport with self-signed development TLS enabled.
   ctx=b.new_context(viewport={'width':width,'height':height},service_workers='block')
   ctx.add_cookies(cookies)
   if LOCAL:
    transport=p.request.new_context(ignore_https_errors=True)
    def local_request(route):
     if not same_origin(route.request.url,BASE):return route.continue_()
     response=transport.fetch(route.request.url,method=route.request.method,headers=route.request.all_headers(),data=route.request.post_data_buffer,max_redirects=0)
     location=response.headers.get('location')
     if 300<=response.status<400 and location and not same_origin(urljoin(route.request.url,location),BASE):return route.abort()
     route.fulfill(response=response)
    ctx.route('**/*',local_request)
   page=ctx.new_page();page.set_default_timeout(20000)
   errors=[];google_errors=[]
   def on_error(error):
    if str(error)=='DOCS_timing is not defined' and 'https://docs.google.com/spreadsheets/' in error.stack:
     google_errors.append('Google published Sheet: DOCS_timing is not defined')
    else:errors.append(re.sub(r'https?://[^\s)]+','[URL]',str(error)))
   page.on('pageerror',on_error)
   page.goto(BASE+'/members/#/members/resources',wait_until='domcontentloaded')
   expect(page.locator('#sermon-year')).to_be_visible()
   assert page.locator('#sermon-year option').count()==17
   assert page.locator('#sermon-frame').get_attribute('src')==sources['sermons']['embedUrl']
   assert 'frame-src https://docs.google.com' in api.get(BASE+'/members/',max_redirects=0).headers['content-security-policy']
   for _ in range(30):
    if any('日期' in f.locator('body').inner_text(timeout=2000) for f in page.frames[1:] if 'docs.google.com' in f.url):break
    page.wait_for_timeout(500)
   else:
    page.screenshot(path=str(OUT/'frame-failure.png'),full_page=True)
    print('Frame diagnostic:',[(f.url.split('/')[2] if f.url.startswith('https://') else 'local',len(f.locator('body').inner_text(timeout=2000))) for f in page.frames])
    raise AssertionError('Google frame did not show rows')
   page.locator('#sermon-year').select_option(label='2025')
   expected=next(t['url'] for t in sources['sermons']['tabs'] if t['label']=='2025')
   expect(page.locator('#sermon-frame')).to_have_attribute('src',expected)
   expect(page.frame_locator('#sermon-frame').locator('body')).to_contain_text('2025/',timeout=30000)
   page.locator('#sermon-year').select_option('all')
   expect(page.frame_locator('#sermon-frame').locator('body')).to_contain_text('講座',timeout=30000)
   expect(page.frame_locator('#sermon-frame').frame_locator('iframe').locator('body')).to_contain_text('2026/',timeout=30000)
   for key in ['weekly','monthly','photos']:
    a=page.locator('.resource-entry a')
    assert sources[key]['url'] in a.evaluate_all('(els)=>els.map(e=>e.href)')
   assert page.locator('.resource-entry a[target="_blank"][rel="noopener noreferrer"]').count()==3
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   page.screenshot(path=str(OUT/f'resources-{width}.png'),full_page=True)
   if width==390:
    def unavailable(route):route.fulfill(status=503,content_type='application/json',body='{"error":"resources_unavailable"}')
    page.route('**/api/member-resources',unavailable)
    page.reload();expect(page.locator('#retry-resources')).to_be_visible()
    assert page.locator('#sermon-frame').count()==0
    page.unroute('**/api/member-resources',unavailable)
    page.locator('#retry-resources').click();expect(page.locator('#sermon-frame')).to_be_visible()
   if errors:print('Browser errors:',errors)
   assert not errors
   checks.append({'viewport':[width,height],'embeddedRowsVisible':True,'yearSwitch':True,'noOuterOverflow':True,'pageErrors':errors,'knownGoogleErrors':google_errors})
   ctx.close()
   if LOCAL:transport.dispose()
  step='logout-replay'
  assert api.post(BASE+'/api/logout',headers={'Origin':BASE},max_redirects=0).status==200
  assert api.get(BASE+'/api/member-resources',max_redirects=0).status==401
  assert api.get(BASE+'/api/member-resources',headers={'Cookie':token},max_redirects=0).status==401
  token=None;cookies.clear();sources=None
  b.close();api.dispose()
 result={'base':BASE,'checks':checks,'unavailableRetry':True,'anonymousAndRevokedDenied':True}
 (OUT/'checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps(result,ensure_ascii=False))
except Exception as error:
 print('Resource check failed at '+step+': '+type(error).__name__+'; line '+str(traceback.extract_tb(error.__traceback__)[-1].lineno)+' (request details withheld)')
 raise SystemExit(1)

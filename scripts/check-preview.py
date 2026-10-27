from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import json, zipfile, re, sys, getpass
from browser_target import browser_target, browser_context, require_page_origin
BASE,LOCAL_TLS=browser_target(sys.argv[1] if len(sys.argv)>1 else 'https://localhost:8787')
OUT=Path(__file__).resolve().parents[1]/'evidence'
password=getpass.getpass('Preview password (hidden): ')
errors=[]; results=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 ctx=browser_context(b,BASE,viewport={'width':1440,'height':1000},accept_downloads=True)
 page=ctx.new_page();page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)))
 response=page.goto(BASE)
 assert response.status==200
 assert 'noindex' in response.headers.get('x-robots-tag','')
 assert ctx.request.post(BASE+'/api/test',data='demo').status==405
 assert 'Disallow: /' in ctx.request.get(BASE+'/robots.txt').text()
 assert ctx.request.get(BASE+'/credits.html').status==200
 results.append('Worker serves preview; noindex; POST rejected; robots; credits')
 page.locator('[data-enter]').first.click();require_page_origin(page,BASE);page.locator('#preview-password').fill(password);page.locator('#login-submit').click();expect(page).to_have_url(BASE+'/members/#/members')
 expect(page.locator('h1')).to_contain_text('大衛團')
 page.locator('[data-enter]').click();page.locator('#unit').select_option('以諾團');page.locator('#enter-demo').click()
 expect(page.locator('h1')).to_contain_text('以諾團')
 results.append('Switch unit while on dashboard updates screen')
 page.goto(BASE+'/#/members/attendance')
 page.locator('[data-person-id="D"][data-status="出席"]').click()
 page.locator('#save-attendance').click();page.reload()
 expect(page.locator('[data-person-id="D"][data-status="出席"]')).to_have_attribute('aria-pressed','true')
 with page.expect_download() as download:page.locator('#export-attendance').click()
 path=OUT/'test-attendance.csv';download.value.save_as(path)
 assert '示範團友 D,出席' in path.read_text(encoding='utf-8-sig')
 page.locator('#people-search').fill('F');expect(page.locator('[data-person="A"]')).to_be_hidden();expect(page.locator('[data-person="F"]')).to_be_visible()
 results.append('Attendance save/reload/search/export CSV')
 page.goto(BASE+'/#/members/rooms');page.locator('#booking-purpose').fill('示範聚會')
 page.locator('#booking-form button[type="submit"]').click();expect(page.locator('#booking-error')).to_contain_text('已被佔用')
 page.locator('[data-room="示範房間 B"][data-time="14:00"]').click();page.locator('#booking-purpose').fill('示範聚會');page.locator('#booking-form button[type="submit"]').click()
 expect(page.locator('[data-room="示範房間 B"][data-time="14:00"]')).to_be_disabled()
 page.reload();expect(page.locator('.booking-item')).to_contain_text('示範聚會')
 page.locator('[data-cancel]').click();expect(page.locator('.booking-item')).to_have_count(0)
 results.append('Local booking conflict/save/reload/cancel')
 page.goto(BASE+'/#/members/songs');page.locator('#song-search').fill('感恩');expect(page.locator('.song-row')).to_have_count(1)
 page.locator('[data-song="grace"]').check();page.locator('#songs-to-ppt').click()
 expect(page.locator('#slide-counter')).to_have_text('1 / 4')
 page.locator('#ppt-lyrics').fill('第一頁示範\n可以修改歌詞\n\n第二頁示範')
 page.locator('#ppt-title').fill('驗收簡報');page.locator('[data-color="#294e43"]').click();page.locator('#ppt-align').select_option('left')
 page.locator('#ppt-font').fill('36');page.locator('#ppt-font').dispatch_event('input')
 page.locator('#slide-next').click();expect(page.locator('#slide-content')).to_have_text('第二頁示範')
 with page.expect_download(timeout=20000) as download:page.locator('#export-ppt').click()
 path=OUT/'test-editable.pptx';download.value.save_as(path)
 with zipfile.ZipFile(path) as z:
  names=[n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',n)]
  assert len(names)==2
  xml=z.read('ppt/slides/slide1.xml').decode()
  assert '第一頁示範' in xml and '294E43' in xml and '3600' in xml
 results.append('Song filtering/selection; edited 2-slide PPTX downloaded with editable text, size and background')
 page.goto(BASE+'/#/visit')
 sent=[];page.on('request',lambda r:sent.append(r.method) if r.method!='GET' else None)
 page.locator('#contact-demo button').click()
 assert page.locator('#contact-demo input').first.evaluate('(e)=>!e.validity.valid')
 page.locator('#contact-demo input').nth(0).fill('示範');page.locator('#contact-demo input').nth(1).fill('invalid')
 assert page.locator('#contact-demo input').nth(1).evaluate('(e)=>!e.validity.valid')
 page.locator('#contact-demo input').nth(1).fill('demo@example.com');page.locator('#contact-demo button').click()
 expect(page.locator('#toast')).to_contain_text('沒有送出');assert not sent
 results.append('Contact required/email validation; no network submission')
 for width,height in [(1440,1000),(390,844)]:
  page.set_viewport_size({'width':width,'height':height})
  for route in ['','about','meetings','notices','visit','members','members/attendance','members/songs','members/rooms','members/ppt','members/resources']:
   page.goto(BASE+'/#/'+route);page.wait_for_timeout(100)
   assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1'),f'Overflow {route} {width}'
   page.screenshot(path=str(OUT/f'{route.replace("/","-") or "home"}-{width}.png'),full_page=True)
  page.goto(BASE)
  if width==390:
   page.locator('.mobile-menu').click();expect(page.locator('.site-header nav')).to_be_visible()
   page.locator('.site-header nav a').first.click();expect(page.locator('h1')).to_have_text('認識筲箕灣堂')
 results.append('11 routes at 1440×1000 and 390×844; no horizontal page overflow; mobile menu')
 assert not errors,errors
 results.append('No browser JavaScript exceptions')
 (OUT/'browser-check.json').write_text(json.dumps({'base':BASE,'results':results,'errors':errors},ensure_ascii=False,indent=2))
 print(json.dumps(results,ensure_ascii=False,indent=2))
 b.close()

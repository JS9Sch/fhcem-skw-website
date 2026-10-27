from pathlib import Path
from playwright.sync_api import sync_playwright,expect
import json,sys,re
BASE=sys.argv[1] if len(sys.argv)>1 else 'https://localhost:8787'
OUT=Path(__file__).resolve().parents[1]/'evidence/doc-layout';errors=[]
with sync_playwright() as p:
 b=p.chromium.launch();ctx=b.new_context(ignore_https_errors=BASE.startswith('https://localhost'),reduced_motion='reduce');page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 for width,height in [(1440,1000),(390,844),(320,740)]:
  page.set_viewport_size({'width':width,'height':height})
  for slug,count in [('weather',3),('recreation',6),('weddings-funerals',3),('song-copyright',7)]:
   page.goto(BASE+'/#/documents/'+slug);expect(page.locator('.document-section')).to_have_count(count)
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(slug,width)
   assert page.locator('.document-transcript').count()==0
   pdf=page.locator('.document-actions a').first;assert pdf.get_attribute('download') is None;assert pdf.get_attribute('target')=='_blank'
   r=ctx.request.get(BASE+pdf.get_attribute('href'));assert r.status==200;assert r.headers['content-disposition']=='inline';assert 'application/pdf' in r.headers['content-type']
   page.locator('[data-doc-jump]').last.click();expect(page.locator('.document-section').last).to_be_focused()
   page.evaluate('scrollTo({top:0,behavior:"instant"})');page.screenshot(path=str(OUT/f'{slug}-{width}.png'),full_page=True)
 page.goto(BASE+'/#/documents/song-copyright')
 for text in ['浸信會出版社','香港基督徒音樂事工','讚美之泉','宣道會出版社','音律文化','美麗傳奇','HKD500.00','HKD520.00','HKD700.00','$1,720','1000','©2007','97008706']:
  assert text in page.locator('.document-reading').inner_text(),text
 assert not errors,errors
 record={'base':BASE,'documents':4,'viewports':[[1440,1000],[390,844],[320,740]],'sectionCounts':[3,6,3,7],'pdfContentDisposition':'inline','tocKeyboardFocus':True,'pageErrors':errors}
 (OUT/('live-check.json' if 'pages.dev' in BASE else 'layout-check.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2));print(json.dumps(record));b.close()

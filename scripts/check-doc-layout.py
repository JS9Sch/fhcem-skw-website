"""Check the four document pages (/notices/<slug>/) at three widths: section
count, no horizontal overflow, PDF link opens inline in a new tab, table of
contents jumps to its section, and key figures of the song-copyright table.
Screenshots go to evidence/doc-layout/ (ignored)."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json, sys
from browser_target import browser_target, browser_context
BASE, LOCAL_TLS = browser_target(sys.argv[1] if len(sys.argv) > 1 else 'https://localhost:8787')
OUT = Path(__file__).resolve().parents[1] / 'evidence/doc-layout'; OUT.mkdir(parents=True, exist_ok=True); errors = []
DOCS = [('weather', 3), ('recreation', 6), ('weddings-funerals', 3), ('song-copyright', 7)]
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = browser_context(b, BASE, reduced_motion='reduce'); page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    for width, height in [(1440, 1000), (390, 844), (320, 740)]:
        page.set_viewport_size({'width': width, 'height': height})
        for slug, count in DOCS:
            page.goto(BASE + f'/notices/{slug}/'); expect(page.locator('.doc-part')).to_have_count(count)
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), (slug, width)
            pdf = page.locator('.pagehead .cta a.btn').first
            assert pdf.get_attribute('download') is None and pdf.get_attribute('target') == '_blank'
            r = ctx.request.get(BASE + pdf.get_attribute('href'))
            assert r.status == 200 and r.headers['content-disposition'] == 'inline' and 'application/pdf' in r.headers['content-type']
            last = page.locator('.toc a').last; target = last.get_attribute('href')
            last.click(); expect(page).to_have_url(BASE + f'/notices/{slug}/' + target)
            assert page.evaluate(f"(()=>{{const r=document.querySelector('{target}').getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}})()"), (slug, width, 'toc target not in view')
            page.evaluate('scrollTo({top:0,behavior:"instant"})'); page.screenshot(path=str(OUT / f'{slug}-{width}.png'), full_page=True)
    page.goto(BASE + '/notices/song-copyright/')
    text = page.locator('.doc').inner_text()
    for t in ['浸信會出版社', '香港基督徒音樂事工', '讚美之泉', '宣道會出版社', '音律文化', '美麗傳奇', 'HKD500.00', 'HKD520.00', 'HKD700.00', '$1,720', '1000', '©2007', '97008706']:
        assert t in text, t
    assert not errors, errors
    record = {'base': BASE, 'documents': 4, 'viewports': [[1440, 1000], [390, 844], [320, 740]], 'sectionCounts': [c for _, c in DOCS], 'pdfContentDisposition': 'inline', 'tocJumps': True, 'pageErrors': errors}
    (OUT / ('live-check.json' if 'pages.dev' in BASE else 'layout-check.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2)); print(json.dumps(record, ensure_ascii=False)); b.close()

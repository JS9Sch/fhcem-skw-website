"""詩歌庫 end to end against a LOCAL `wrangler dev` with SONGS_FAKE_DRIVE=1 and freshly
seeded fake data. It uploads test files and moves them about, so it refuses anything but
localhost. Before each run:
  stop dev; rm -rf .wrangler/state/v3/d1; npx wrangler d1 migrations apply ATT_DB --local
  node scripts/songs-seed.mjs <review.csv> 20 > /tmp/songs-seed.sql
  npx wrangler d1 execute ATT_DB --local --file /tmp/songs-seed.sql; start dev

usage: python3 scripts/check-songs.py https://localhost:8787 [--shots DIR]
Reads the member password and the local admin password hidden (getpass); neither is printed.
Covers: login wall; 會友 list (stroke order, English last, count), search (prefix/contains,
no match, clear by keyboard), 最近加入, song page with the copyright notice, view/download
headers, no edit controls and 403 for writes; 管理員 upload a PDF as a new song, replace it
with 3 phone photos joined into one 3-page PDF (order changed first), 舊版 and restore,
delete to 已刪除, edit details, 連接 Google Drive (fake consent), 重新掃描 + attach,
the fake Picker, delete a song; at 320/390/1440 no overflow and targets at least 44px.
"""
import getpass, io, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_target import browser_target, browser_context

argv = sys.argv[1:]
SHOTS = Path(__file__).resolve().parents[1] / 'evidence/songs'
if '--shots' in argv:
    i = argv.index('--shots'); SHOTS = Path(argv[i + 1]); del argv[i:i + 2]
BASE, LOCAL = browser_target(argv[0] if argv else 'https://localhost:8787')
if not LOCAL:
    raise SystemExit('Refusing to write test data outside localhost.')
password = getpass.getpass('Member password (hidden): ')
admin_code = getpass.getpass('Local admin password (hidden): ')
NOTICE = '只供本堂聚會及練習使用，請勿外傳'
NEW_SONG = '測試新歌' + time.strftime('%H%M%S')
checks, errors = [], []
SIZE_JS = '''[...document.querySelectorAll('#sg-root .att-btn,#sg-root .att-tabs a,#sg-root .sg-item,#sg-root [data-sg-show],#sg-root .sg-kind button,#sg-root .sg-choice,#sg-root select,#sg-root .ui-search-field input,#sg-root .text-link')]
 .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]'))
 .map(e=>{const r=e.getBoundingClientRect();return [e.textContent.trim().slice(0,12),Math.round(r.width),Math.round(r.height)]})
 .filter(([,w,h])=>w<44||h<44)'''


def ok(label):
    checks.append(label); print('ok', label, flush=True)


def context(browser, w, h, **kw):
    return browser_context(browser, BASE, viewport={'width': w, 'height': h}, locale='zh-HK', **kw)


def login(ctx, pw):
    r = ctx.request.post(BASE + '/api/login', headers={'Origin': BASE}, data={'password': pw}, max_redirects=0)
    assert r.status == 200, f'login {r.status}'
    return r.json()['role']


def new_page(ctx):
    page = ctx.new_page(); page.set_default_timeout(15000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    return page


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(250)
    page.screenshot(path=str(SHOTS / name), full_page=True, animations='disabled', style='#toast{display:none}')


def layout(page, label):
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), f'{label}: horizontal overflow'
    small = page.evaluate(SIZE_JS)
    assert not small, f'{label}: targets under 44px {small}'


def songs_page(page, query=''):
    page.goto(BASE + '/members/songs/' + query)
    page.wait_for_selector('#sg-root section.panel, #sg-root .sg-list')


def photo(n, w=900, h=1200):
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (w, h), (255, 255, 255)); d = ImageDraw.Draw(img)
    d.rectangle([40, 40, w - 40, 140], outline=(0, 0, 0), width=6); d.text((60, 70), f'TEST PHOTO {n}', fill=(0, 0, 0))
    for y in range(220, h - 60, 60): d.line([60, y, w - 60, y], fill=(0, 0, 0), width=3)
    b = io.BytesIO(); img.save(b, 'JPEG', quality=80)
    return {'name': f'photo-{n}.jpg', 'mimeType': 'image/jpeg', 'buffer': b.getvalue()}


def test_pdf(label):
    body = f'BT /F1 18 Tf 60 760 Td ({label}) Tj ET'
    objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>', f'<</Length {len(body)}>>stream\n{body}\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
    out, offs = '%PDF-1.4\n', []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += f'{i + 1} 0 obj\n{o}\nendobj\n'
    x = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offs) + f'trailer\n<</Size {len(objs) + 1}/Root 1 0 R>>\nstartxref\n{x}\n%%EOF\n'
    return {'name': 'test-score.pdf', 'mimeType': 'application/pdf', 'buffer': out.encode('latin1')}


def member_checks(browser, w, h):
    ctx = context(browser, w, h); page = new_page(ctx)
    page.goto(BASE + '/members/songs/')
    assert '/login/' in page.url, 'anonymous not sent to login'
    assert login(ctx, password) == 'member'
    songs_page(page)
    rows = page.locator('.sg-item')
    expect(rows).to_have_count(20)
    names = [n.strip() for n in page.locator('.sg-item .sg-name b').all_text_contents()]
    assert names[0].startswith('一') and re.fullmatch(r'[A-Za-z ]+', names[-1]), f'order {names[:2]} … {names[-1]}'
    expect(page.locator('#sg-count')).to_contain_text('共 20 首')
    expect(page.locator('.sg-notice').first).to_contain_text(NOTICE)
    expect(page.locator('.sg-tabs')).to_have_count(0)
    layout(page, f'list {w}'); shot(page, f'list-member-{w}.png')
    query = page.get_by_label('搜尋詩歌', exact=True)
    query.fill('主')
    expect(page.locator('#sg-count')).to_contain_text('找到 4 首')
    first = page.locator('.sg-item .sg-name b').first.text_content()
    assert first.startswith('主'), f'prefix match should come first, got {first}'
    shot(page, f'search-{w}.png')
    query.fill('找不到的歌')
    expect(page.locator('.sg-list .empty')).to_contain_text('沒有符合')
    query.press('Tab'); expect(page.get_by_role('button', name='清除詩歌搜尋')).to_be_focused()
    page.keyboard.press('Enter'); expect(query).to_be_focused()
    expect(rows).to_have_count(20)
    page.get_by_role('button', name='最近加入').click()
    expect(page.locator('#sg-count')).to_contain_text('最近加入')
    newest = ctx.request.get(BASE + '/api/songs/list').json()['recent'][0]
    expect(page.locator('.sg-item .sg-name b').first).to_have_text(newest['title_zh'] or newest['title_en'])
    page.get_by_role('button', name=re.compile('^全部')).click()
    page.locator('.sg-item').first.click()
    page.wait_for_selector('.sg-song')
    expect(page.locator('.sg-song .sg-notice')).to_contain_text(NOTICE)
    view = page.get_by_role('link', name='檢視').first
    assert view.get_attribute('target') == '_blank' and view.get_attribute('href').startswith('/api/songs/pdf/')
    href = page.get_by_role('link', name='下載').first.get_attribute('href')
    r = ctx.request.get(BASE + href)
    assert r.status == 200 and r.headers['content-type'] == 'application/pdf' and r.headers['content-disposition'].startswith('attachment;') and r.body()[:5] == b'%PDF-'
    r = ctx.request.get(BASE + view.get_attribute('href'))
    assert r.status == 200 and r.headers['content-disposition'].startswith('inline;')
    expect(page.locator('[data-sg-delete], [data-sg-restore], #sg-edit')).to_have_count(0)
    layout(page, f'song {w}'); shot(page, f'song-member-{w}.png')
    assert ctx.request.post(BASE + '/api/songs/song', headers={'Origin': BASE}, data={'title_zh': '不准'}).status == 403
    songs_page(page, '?tab=upload')
    expect(page.locator('#sg-root')).to_contain_text('只有傳道同工及網站管理員可以上載')
    ctx.close()
    ok(f'會友 list / search / recent / song page / download at {w}')


def admin_flow(browser):
    ctx = context(browser, 390, 844); page = new_page(ctx)
    assert login(ctx, admin_code) == 'admin'
    songs_page(page)
    expect(page.locator('.sg-tabs a')).to_have_count(3)
    # 1. a new song with a PDF
    page.get_by_role('link', name='上載樂譜').click()
    page.wait_for_selector('#sg-up')
    page.get_by_label('搜尋歌名').fill(NEW_SONG)
    page.locator('.sg-choice.sg-new').click()
    expect(page.locator('#sg-zh')).to_have_value(NEW_SONG)
    page.get_by_label('英文歌名（如有）').fill('Test New Song')
    page.select_option('#sg-up-key', 'G')
    page.set_input_files('#sg-files', test_pdf('first upload'))
    expect(page.locator('#sg-files-note')).to_contain_text('PDF')
    layout(page, 'upload 390'); shot(page, 'upload-new-390.png')
    page.get_by_role('button', name='上載', exact=True).click()
    page.wait_for_selector('.sg-song')
    expect(page.locator('.sg-title')).to_have_text(NEW_SONG)
    expect(page.locator('.sg-file b')).to_have_text(['樂譜（G調）'])
    song_url = page.url
    ok('管理員 upload a PDF as a new song')
    # 2. replace with 3 photos, reorder first
    page.get_by_role('link', name='取代').click()
    page.wait_for_selector('#sg-up')
    expect(page.locator('#sg-replace')).to_contain_text('會取代它')
    page.set_input_files('#sg-files', [photo(1), photo(2), photo(3)])
    expect(page.locator('.sg-photos li')).to_have_count(3)
    page.get_by_role('button', name='把相片 3 上移').click()
    expect(page.locator('.sg-photos li').nth(1)).to_contain_text('photo-3.jpg')
    layout(page, 'upload photos 390'); shot(page, 'upload-photos-390.png')
    page.get_by_role('button', name='上載', exact=True).click()
    page.wait_for_selector('.sg-song')
    expect(page.locator('.sg-files').first.locator('small')).to_contain_text('由 3 張相片合成')
    expect(page.locator('.sg-files').nth(1).locator('.sg-file')).to_have_count(1)  # 舊版
    pdf = ctx.request.get(BASE + page.get_by_role('link', name='下載').first.get_attribute('href')).body()
    pages = len(re.findall(rb'/Type/Page(?!s)', pdf))
    assert pdf[:5] == b'%PDF-' and pages == 3, f'photos PDF pages {pages}'
    layout(page, 'song admin 390'); shot(page, 'song-admin-390.png')
    ok('replace with 3 photos → one 3-page PDF, old file in 舊版')
    # 3. restore the old one, then delete it
    page.locator('[data-sg-restore]').click()
    expect(page.locator('.sg-files').first.locator('small')).not_to_contain_text('相片合成')
    expect(page.locator('.sg-files').nth(1)).to_contain_text('相片合成')  # the photos PDF is now 舊版
    page.locator('.sg-files').nth(1).locator('[data-sg-delete]').click()
    expect(page.locator('.sg-files')).to_have_count(1)
    expect(page.locator('.sg-file b')).to_have_text(['樂譜（G調）'])
    ok('restore 舊版, delete to 已刪除')
    # 4. edit details
    page.locator('.sg-edit summary').click()
    page.fill('#sg-copyright', '測試機構'); page.check('#sg-guess', force=True)
    page.get_by_role('button', name='儲存').click()
    expect(page.locator('.sg-meta')).to_contain_text('測試機構')
    expect(page.locator('.sg-guess')).to_have_text('估計')
    ok('edit details (版權機構 估計)')
    # 5. 管理: connect (fake consent) and 重新掃描
    songs_page(page, '?tab=admin')
    expect(page.locator('#sg-root')).to_contain_text('假 Drive')
    page.locator('#sg-connect').click()
    page.wait_for_url(re.compile(r'/members/songs/\?tab=admin&google=connected$'), timeout=10000)
    page.wait_for_selector('#sg-scan')
    expect(page.locator('.att-settings')).to_contain_text('fake-drive@localhost')
    expect(page.locator('#sg-connect')).to_have_text('重新連接 Google Drive')
    ok('連接 Google Drive (fake consent page → back to 管理)')
    page.locator('#sg-scan').click()
    expect(page.locator('.sg-scan > li')).to_have_count(2)
    shot(page, 'admin-scan-390.png')
    item = page.locator('.sg-scan > li').first
    item.get_by_label('搜尋歌名').fill('一')
    item.locator('.sg-choice').first.click()
    item.locator('select').select_option('D')
    item.get_by_role('button', name='歸入').click()
    expect(item).to_contain_text('已把')
    page.locator('#sg-picker').click()
    dlg = page.locator('dialog.sg-dialog')
    expect(dlg.locator('li')).to_have_count(1)
    dlg.locator('input[type=checkbox]').check(force=True)
    dlg.get_by_role('button', name='選取').click()
    expect(page.locator('.sg-scan > li')).to_have_count(1)
    ok('重新掃描 lists loose PDFs, attach one, fake Picker picks the other')
    # 6. delete the test song
    page.goto(song_url); page.wait_for_selector('.sg-song')
    page.locator('.sg-edit summary').click()
    page.locator('#sg-delete-song').click()
    page.wait_for_selector('.sg-list')
    page.get_by_label('搜尋詩歌', exact=True).fill(NEW_SONG)
    expect(page.locator('.sg-list .empty')).to_be_visible()
    ok('delete a song')
    for w, h in [(320, 740), (1440, 1000)]:
        page.set_viewport_size({'width': w, 'height': h})
        for q, name in [('', 'list-admin'), ('?tab=upload', 'upload'), ('?tab=admin', 'admin'), ('?song=1', 'song-admin')]:
            songs_page(page, q); layout(page, f'{name} {w}'); shot(page, f'{name}-{w}.png')
    ok('admin views at 320 and 1440')
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    for w, h in [(390, 844), (320, 740), (1440, 1000)]:
        member_checks(browser, w, h)
    admin_flow(browser)
    browser.close()
assert not errors, f'JS errors: {errors[:3]}'
print(f'check-songs: {len(checks)} checks passed; screenshots in {SHOTS}')

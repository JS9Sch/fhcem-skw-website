"""網站更新 end to end against a LOCAL `wrangler dev` (it adds and deletes entries, so it
refuses anything but localhost). Needs migration 0004 applied to the local D1.

usage: python3 scripts/check-updates.py https://localhost:8787 [--shots DIR]
Reads the member password and the local admin password hidden (getpass); neither is printed.
Covers: login wall; 管理員 adds an entry (列點, 範圍), edits it, sees it on 總覽; 會友 sees it with
「新」 once, no edit controls, 403 for writes, filter by 類型; 管理員 deletes it; at 320/390/1440
no horizontal overflow and every control at least 44px.
"""
import getpass, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_target import browser_target, browser_context

argv = sys.argv[1:]
SHOTS = Path('evidence/updates')
if '--shots' in argv:
    i = argv.index('--shots'); SHOTS = Path(argv[i + 1]); del argv[i:i + 2]
BASE, LOCAL = browser_target(argv[0] if argv else 'https://localhost:8787')
if not LOCAL:
    raise SystemExit('Refusing to write test data outside localhost.')
password = getpass.getpass('Member password (hidden): ')
admin_code = getpass.getpass('Local admin password (hidden): ')
TITLE = '測試更新' + time.strftime('%H%M%S')
checks, errors = [], []
SIZE_JS = '''[...document.querySelectorAll('#up-root .att-btn,#up-root [data-up-kind],#up-root select,#up-root input,#up-root textarea,.up-recent a.up-title')]
 .filter(e=>e.getClientRects().length&&!e.closest('[hidden]'))
 .map(e=>{const r=e.getBoundingClientRect();return [e.textContent.trim().slice(0,12)||e.id,Math.round(r.width),Math.round(r.height)]})
 .filter(([,w,h])=>w<44||h<44)'''


def ok(label):
    checks.append(label); print('ok', label, flush=True)


def context(browser, w, h):
    return browser_context(browser, BASE, viewport={'width': w, 'height': h}, locale='zh-HK')


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


def close(ctx):
    for pg in ctx.pages:
        try: pg.wait_for_load_state('networkidle', timeout=5000)
        except Exception: pass
    ctx.unroute_all(behavior='ignoreErrors'); ctx.close()


def open_log(page):
    page.goto(BASE + '/members/updates/')
    page.wait_for_selector('#up-root .up-log')


with sync_playwright() as p:
    browser = p.chromium.launch()
    # 1. login wall
    ctx = context(browser, 390, 844); page = new_page(ctx)
    page.goto(BASE + '/members/updates/')
    assert '/login/' in page.url and 'next=%2Fmembers%2Fupdates%2F' in page.url, page.url
    close(ctx); ok('anonymous → login with next=/members/updates/')

    # 2. 管理員 adds, edits, sees it on 總覽
    ctx = context(browser, 390, 844); page = new_page(ctx)
    assert login(ctx, admin_code) == 'admin'
    open_log(page)
    page.locator('.up-add summary').click()
    page.get_by_label('類型').first.select_option('improve')
    page.get_by_label('範圍').first.select_option('詩歌庫')
    page.get_by_label('標題').first.fill(TITLE)
    page.locator('#up-new-body').fill('第一段說明。\n・第一點\n・第二點\n\n最後一段。')
    shot(page, 'admin-form-390.png'); layout(page, 'admin form 390')
    page.get_by_role('button', name='發佈').click()
    item = page.locator('.up-item', has_text=TITLE)
    expect(item).to_have_count(1)
    expect(item.locator('.up-kind')).to_have_text('改進')
    expect(item.locator('.up-area')).to_have_text('詩歌庫')
    expect(item.locator('.up-body li')).to_have_count(2)
    expect(item.locator('.up-body p')).to_have_count(2)
    ok('管理員 publishes an entry: 類型, 範圍, paragraphs and 列點')
    item.get_by_role('button', name='修改').click()
    page.locator('.up-item form .field input').fill(TITLE + '（改）')
    page.get_by_role('button', name='儲存修改').click()
    expect(page.locator('.up-item', has_text=TITLE + '(改)')).to_have_count(1)
    ok('管理員 edits it (title stored NFKC: 全形括號 → 半形)')
    page.goto(BASE + '/members/')
    expect(page.locator('#up-recent .up-title').first).to_have_text(TITLE + '(改)')
    ok('總覽 shows it under 最近網站更新')
    close(ctx)

    # 3. 會友 reads it, 「新」 once, no edit controls, filter, writes refused
    for w, h in [(390, 844), (320, 740), (1440, 1000)]:
        ctx = context(browser, w, h); page = new_page(ctx)
        assert login(ctx, password) == 'member'
        page.goto(BASE + '/members/')
        expect(page.locator('#up-recent .up-item').first.locator('.up-new')).to_have_count(1)
        layout(page, f'總覽 {w}'); shot(page, f'dashboard-{w}.png')
        open_log(page)
        item = page.locator('.up-item', has_text=TITLE)
        expect(item.locator('.up-new')).to_have_count(1)
        expect(page.locator('.up-add')).to_have_count(0)
        expect(page.locator('[data-up-edit],[data-up-delete]')).to_have_count(0)
        layout(page, f'log {w}'); shot(page, f'log-member-{w}.png')
        if page.locator('[data-up-kind]').count():
            page.locator('[data-up-kind="improve"]').click()
            kinds = set(page.locator('.up-item .up-kind').all_text_contents())
            assert kinds == {'改進'}, kinds
            page.locator('[data-up-kind=""]').click()
        page.reload(); page.wait_for_selector('#up-root .up-log')
        expect(page.locator('.up-item', has_text=TITLE).locator('.up-new')).to_have_count(0)
        r = ctx.request.post(BASE + '/api/updates', headers={'Origin': BASE}, data={'kind': 'new', 'title': 'x'})
        assert r.status == 403, r.status
        close(ctx)
    ok('會友 at 390/320/1440: sees it with 「新」 once, no edit controls, filter by 類型, POST 403')

    # 4. 管理員 layout at 1440 and 320, then deletes it (one login: the login limiter is per minute)
    ctx = context(browser, 1440, 1000); page = new_page(ctx)
    login(ctx, admin_code)
    for w, h in [(1440, 1000), (320, 740), (390, 844)]:
        page.set_viewport_size({'width': w, 'height': h}); open_log(page)
        layout(page, f'admin log {w}'); shot(page, f'log-admin-{w}.png')
    page.locator('.up-item', has_text=TITLE).get_by_role('button', name='刪除').click()
    expect(page.locator('.up-item', has_text=TITLE)).to_have_count(0)
    open_log(page)
    expect(page.locator('.up-item', has_text=TITLE)).to_have_count(0)
    close(ctx); ok('管理員 layout at 1440/320, deletes the entry; gone after reload')
    browser.close()

assert not errors, errors
print(f'check-updates: {len(checks)} checks passed; screenshots in {SHOTS}')

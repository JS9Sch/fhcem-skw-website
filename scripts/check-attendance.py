"""團契點名 end to end against a LOCAL `wrangler dev` with a local D1 database
(`npx wrangler d1 migrations apply ATT_DB --local`). It writes fake names
(測試甲…) and sets the 同工碼 and 保羅團 code to throwaway test values, so it
refuses to run against anything but localhost. Test month: October 2026.

usage: python3 scripts/check-attendance.py https://localhost:8787 [--shots DIR]
Reads the member password and the local admin code hidden (getpass); neither is printed.
Covers: unlock, mark, save, offline queue then resume, reload, edit a past meeting,
reschedule and cancel, the 月訊 table values and CSV, copy, code reset signing an
old phone out, lock, and at 320/390/1440 no overflow and every target at least 44px.
"""
import datetime, getpass, json, re, sys
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, expect
from browser_target import browser_target, browser_context

argv = sys.argv[1:]
SHOTS = Path(__file__).resolve().parents[1] / 'evidence/attendance'
if '--shots' in argv:
    i = argv.index('--shots'); SHOTS = Path(argv[i + 1]); del argv[i:i + 2]
BASE, LOCAL = browser_target(argv[0] if argv else 'https://localhost:8787')
if not LOCAL:
    raise SystemExit('Refusing to write test data outside localhost.')
password = getpass.getpass('Member password (hidden): ')
admin_code = getpass.getpass('Local attendance admin code (hidden): ')
STAFF_CODE, PAUL_CODE = 'STAFF-TEST-01', 'PAUL-TEST-01'
NAMES = ['測試甲', '測試乙', '測試丙', '測試丁', '測試戊']
LEFT_NAME = '測試己'
today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).date()
current = today - datetime.timedelta(days=(today.weekday() - 5) % 7)  # 保羅團 meets every Saturday
if not datetime.date(2026, 10, 31) <= today <= datetime.date(2027, 1, 15):
    raise SystemExit('The October 2026 test month must be within the last 12 weeks; update MONTH dates.')
WD = '一二三四五六日'


def fmt(d):
    return f'{d.month} 月 {d.day} 日（{WD[d.weekday()]}）'


checks, errors, dialogs = [], [], []
SIZE_JS = '''[...document.querySelectorAll('#att-root .att-btn,#att-root .att-tabs a,#att-root [data-mark],#att-root [data-state],#att-root .att-step,#att-root .att-history a,#att-root #att-lock')]
 .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]'))
 .map(e=>{const r=e.getBoundingClientRect();return [e.textContent.trim().slice(0,12),Math.round(r.width),Math.round(r.height)]})
 .filter(([,w,h])=>w<44||h<44)'''


def context(browser, w, h, **kw):
    return browser_context(browser, BASE, viewport={'width': w, 'height': h}, locale='zh-HK', **kw)


def login(ctx):
    r = ctx.request.post(BASE + '/api/login', headers={'Origin': BASE}, data={'password': password}, max_redirects=0)
    assert r.status == 200, f'login {r.status}'


def new_page(ctx):
    page = ctx.new_page(); page.set_default_timeout(15000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    return page


def shot(page, name):
    # Full-page pictures: the save bar is drawn where it ends, not stuck to the bottom of the screen.
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(250)
    page.screenshot(path=str(SHOTS / name), full_page=True, animations='disabled', style='.att-savebar{position:static!important}#toast{display:none}')


def layout(page, label):
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), f'{label}: horizontal overflow'
    small = page.evaluate(SIZE_JS)
    assert not small, f'{label}: targets under 44px {small}'


def tab(page, name='', **query):
    q = {k: v for k, v in {'tab': name, **query}.items() if v}
    page.goto(BASE + '/members/attendance/' + ('?' + urlencode(q) if q else ''))
    page.wait_for_selector('#att-view section.panel')


def unlock(page, unit, code):
    page.goto(BASE + '/members/attendance/')
    expect(page.locator('#att-unlock-form')).to_be_visible()
    page.select_option('#att-unit', unit); page.fill('#att-code', code); page.click('#att-unlock-submit')
    expect(page.locator('.att-bar')).to_be_visible()


def set_code(page, target, code=''):
    tab(page, 'codes')
    li = page.locator(f'.att-codes li[data-target="{target}"]')
    li.locator('[data-code-open]').click()
    li.locator('#att-new-code').fill(code)
    li.locator('.att-code-form button[type=submit]').click()
    value = li.locator('.att-code-value')
    expect(value).to_have_text(code if code else re.compile(r'^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$'))
    return value.inner_text()


def row(page, name):
    return page.locator('.att-row').filter(has=page.locator('.att-name', has_text=re.compile('^' + name)))


def mark(page, name, status):
    button = row(page, name).get_by_role('button', name=status, exact=True)
    if button.get_attribute('aria-pressed') != 'true':  # pressing a chosen mark again clears it
        button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')


def marks(page, **by_status):
    for status, names in by_status.items():
        for name in names:
            mark(page, name, {'present': '出席', 'leave': '請假', 'absent': '缺席'}[status])


def counts(page, new_friends, guests):
    page.fill('#att-new_friends', str(new_friends)); page.fill('#att-other_guests', str(guests))


def save(page):
    page.click('#att-save')
    expect(page.locator('#att-status')).to_contain_text('已儲存')


def total(page):
    return page.locator('#att-sum .att-total b').inner_text()


try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        anon = context(browser, 390, 844)
        assert anon.request.get(BASE + '/api/attendance/me').status == 401
        assert anon.request.put(BASE + '/api/attendance/meeting', data='{}', headers={'Content-Type': 'application/json'}).status == 403
        assert anon.request.fetch(BASE + '/api/attendance/meeting', method='DELETE', headers={'Origin': BASE}).status == 405
        checks.append('Anonymous API 401; write without Origin 403; wrong method 405')

        # Admin (desktop) sets the staff code and the 保羅團 code.
        actx = context(browser, 1440, 1000); login(actx); ap = new_page(actx)
        unlock(ap, 'admin', admin_code)
        expect(ap.locator('.att-bar b')).to_have_text('網站管理員')
        set_code(ap, 'staff', STAFF_CODE); set_code(ap, 'paul', PAUL_CODE)
        checks.append('Admin unlock; admin sets the staff code and a group code')

        # 保羅團 leader on a phone.
        lctx = context(browser, 390, 844); login(lctx); lp = new_page(lctx)
        lp.goto(BASE + '/members/attendance/'); expect(lp.locator('#att-unlock-form')).to_be_visible()
        lp.select_option('#att-unit', 'paul'); shot(lp, 'unlock-390.png')
        lp.fill('#att-code', 'WRONG-CODE-99'); lp.click('#att-unlock-submit')
        expect(lp.locator('#att-unlock-error')).to_have_text('點名碼不正確。')
        lp.fill('#att-code', PAUL_CODE.lower()); lp.click('#att-unlock-submit')
        expect(lp.locator('.att-bar b')).to_have_text('保羅團')
        role = next(c for c in lctx.cookies() if c['name'] == '__Host-fhcem_att')
        assert role['httpOnly'] and role['secure'] and role['sameSite'] == 'Strict'
        days = (role['expires'] - datetime.datetime.now().timestamp()) / 86400
        assert 89 < days <= 90, days
        assert '__Host-fhcem_att' not in lp.evaluate('document.cookie')
        expect(lp.locator('.att-tabs a')).to_have_text(['點名', '過去聚會', '名單', '月訊表', '統計'])
        checks.append('Group unlock: wrong code refused; role cookie HttpOnly/Secure/Strict for 90 days; group tabs only')

        # Roster: fake names, duplicate refused, rename, leave and rejoin.
        tab(lp, 'roster')
        known = lp.locator('.att-members .att-name').all_inner_texts()
        for name in NAMES + [LEFT_NAME]:
            if name not in known:
                lp.fill('#att-member-name', name); lp.click('#att-member-form button[type=submit]')
                expect(lp.locator('.att-members .att-name', has_text=re.compile('^' + name + '$'))).to_have_count(1)
        lp.fill('#att-member-name', '測試甲'); lp.click('#att-member-form button[type=submit]')
        expect(lp.locator('#att-member-error')).to_have_text('名單已有這個稱呼。')
        def rename(old, new):
            member = lp.locator('.att-members:not(.left) li').filter(has=lp.locator('.att-name', has_text=re.compile('^' + old + '$'))).get_attribute('data-id')
            item = lp.locator(f'.att-members li[data-id="{member}"]')
            item.locator('[data-rename]').click(); item.locator('input').fill(new); item.locator('button[type=submit]').click()
            expect(lp.locator('.att-members:not(.left) .att-name', has_text=re.compile('^' + new + '$'))).to_have_count(1)
        rename('測試戊', '測試戊改'); rename('測試戊改', '測試戊')
        left = lp.locator('.att-members:not(.left) li').filter(has_text=re.compile('^' + LEFT_NAME))
        if left.count():
            left.locator('[data-status-to="left"]').click()
        expect(lp.locator('.att-members.left .att-name', has_text=LEFT_NAME)).to_have_count(1)
        lp.locator('.att-members.left li').filter(has_text=LEFT_NAME).locator('[data-status-to="active"]').click()
        lp.locator('.att-members:not(.left) li').filter(has_text=LEFT_NAME).locator('[data-status-to="left"]').click()
        expect(lp.locator('.att-members.left .att-name', has_text=LEFT_NAME)).to_have_count(1)
        layout(lp, 'roster 390'); shot(lp, 'roster-390.png')
        checks.append('Roster: add, duplicate refused, rename, mark left, rejoin')

        # 今次 roll call: mark, unmarked prompt, save, reload.
        tab(lp)
        expect(lp.locator('.att-when')).to_contain_text(fmt(current))
        if current == datetime.date(2026, 10, 31):
            expect(lp.locator('.att-when .att-tag').first).to_have_text('今次')
        for name in NAMES:  # start clean on re-runs
            b = row(lp, name).locator('[aria-pressed="true"]')
            if b.count(): b.click()
        marks(lp, present=['測試甲', '測試乙'], leave=['測試丙'], absent=['測試丁'])
        counts(lp, 0, 0)
        lp.locator('[data-step="new_friends"][data-d="1"]').click(); lp.locator('[data-step="new_friends"][data-d="1"]').click()
        lp.locator('[data-step="other_guests"][data-d="1"]').click()
        expect(lp.locator('#att-sum .att-total b')).to_have_text('5')
        expect(lp.locator('#att-sum')).to_contain_text('未點 1')
        layout(lp, 'roll 390'); shot(lp, 'roll-390.png')
        dialogs.clear(); save(lp)
        assert any('還有 1 位未點' in d for d in dialogs), dialogs
        mark(lp, '測試戊', '出席'); expect(lp.locator('#att-sum .att-total b')).to_have_text('6')
        dialogs.clear(); save(lp); assert not dialogs, dialogs
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(row(lp, '測試戊').get_by_role('button', name='出席', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-sum .att-total b')).to_have_text('6')
        checks.append('Roll call: three-way marks, ± counters, total, unmarked prompt, save, reload keeps values')

        # Offline: the save waits in this phone and goes out when the network is back.
        lp.route('**/api/attendance/meeting', lambda r: r.abort('internetdisconnected') if r.request.method == 'PUT' else r.fallback())
        lctx.set_offline(True)
        mark(lp, '測試戊', '請假'); lp.click('#att-save')
        expect(lp.locator('#att-status')).to_contain_text('未送出')
        expect(lp.locator('#att-unsent')).to_be_visible(); expect(lp.locator('#att-unsent')).to_contain_text('未送出')
        queue = lp.evaluate("localStorage.getItem('fhcem-att-queue-v1')")
        assert queue and all(n not in queue for n in NAMES), 'queue must hold member ids only'
        lp.evaluate('scrollTo(0,0)'); shot(lp, 'unsent-390.png')
        lp.unroute('**/api/attendance/meeting'); lctx.set_offline(False)
        expect(lp.locator('#att-unsent')).to_be_hidden(timeout=20000)
        assert lp.evaluate("localStorage.getItem('fhcem-att-queue-v1')") is None
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(row(lp, '測試戊').get_by_role('button', name='請假', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-sum .att-total b')).to_have_text('5')
        checks.append('Offline save queued (ids only, "未送出" shown), sent automatically when back online, kept after reload')

        # October 2026: edit a past meeting, reschedule across weeks, cancel.
        def meeting(date):
            tab(lp, date=date); lp.wait_for_selector('.att-roll')
        meeting('2026-10-03')
        marks(lp, present=['測試甲'], absent=['測試乙', '測試丙', '測試丁', '測試戊']); counts(lp, 1, 0); save(lp)
        meeting('2026-10-03'); mark(lp, '測試乙', '出席'); expect(lp.locator('#att-sum .att-total b')).to_have_text('3'); save(lp)
        meeting('2026-10-10')
        lp.locator('[data-state="moved"]').click(); lp.fill('#att-actual', '2026-10-15')
        marks(lp, present=['測試甲'], absent=['測試乙', '測試丙', '測試丁', '測試戊']); counts(lp, 0, 0); save(lp)
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(lp.locator('[data-state="moved"]')).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-actual')).to_have_value('2026-10-15')
        meeting('2026-10-17')
        marks(lp, present=['測試甲', '測試乙', '測試丙'], absent=['測試丁', '測試戊']); counts(lp, 0, 0); save(lp)
        tab(lp, 'history'); layout(lp, 'history 390'); shot(lp, 'history-390.png')
        lp.locator('.att-history a', has_text='2026 年 10 月 24 日').click(); lp.wait_for_selector('.att-roll')
        expect(lp.locator('.att-when')).to_contain_text('2026 年 10 月 24 日')
        lp.locator('[data-state="cancelled"]').click(); expect(lp.locator('#att-cancel-note')).to_be_visible(); save(lp)
        tab(lp, 'history')
        expect(lp.locator('.att-history li', has_text='2026 年 10 月 15 日')).to_contain_text('改期（原定 10 月 10 日（六））')
        expect(lp.locator('.att-history li', has_text='2026 年 10 月 24 日')).to_contain_text('取消')
        checks.append('Past meeting edited from history; reschedule 10-10 → 10-15 kept; cancel shown in history')

        week5 = '5' if current == datetime.date(2026, 10, 31) else '/未填'
        expected = ['3', '/', '4＊', '/', week5]
        tab(lp, 'report', month='2026-10')
        cells = [re.sub(r'\s+', '', t) for t in lp.locator('tr[data-group="paul"] td').all_inner_texts()]
        assert cells == expected, cells
        expect(lp.locator('.att-report tbody tr')).to_have_count(1)
        tab(lp, 'stats', year='2026'); layout(lp, 'stats 390'); shot(lp, 'stats-390.png')
        checks.append(f'Group sees only its own 月訊 row: {cells}; stats page')

        # Staff (desktop): head-count meeting, full 月訊 table, CSV, copy, settings.
        sctx = context(browser, 1440, 1000, accept_downloads=True)
        sctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        login(sctx); sp = new_page(sctx)
        unlock(sp, 'staff', STAFF_CODE)
        expect(sp.locator('.att-tabs a')).to_have_text(['點名', '過去聚會', '名單', '月訊表', '統計', '點名碼', '設定'])
        tab(sp, group='sun-worship', date='2026-10-04')
        expect(sp.locator('.att-row')).to_have_count(0)
        sp.fill('#att-headcount', '78'); save(sp)
        tab(sp, 'report', month='2026-10')
        expect(sp.locator('.att-report tbody tr')).to_have_count(16)
        expect(sp.locator('.att-report tbody th').first).to_have_text('週六崇拜')
        cells = [re.sub(r'\s+', '', t) for t in sp.locator('tr[data-group="paul"] td').all_inner_texts()]
        assert cells == expected, cells
        assert re.sub(r'\s+', '', sp.locator('tr[data-group="sun-worship"] td').first.inner_text()) == '78'
        layout(sp, 'report 1440'); shot(sp, 'report-1440.png')
        # The CSV link is fetched with the page's cookies (a browser download through the
        # same-origin guard route is cancelled by Chromium, so read it as the browser would).
        link = sp.locator('#att-csv')
        assert link.get_attribute('download') == '聚會出席人數-2026-10.csv'
        response = sctx.request.get(BASE + link.get_attribute('href'))
        assert response.status == 200 and 'attachment' in response.headers['content-disposition']
        csv = response.body().decode('utf-8')
        assert csv.startswith('﻿聚會,第一週,第二週,第三週,第四週,第五週\r\n'), csv[:40]
        assert '\r\n保羅團,3,/,4,/,' + ('5' if week5 == '5' else '/') + '\r\n' in csv, csv
        assert '\r\n主日崇拜,78,' in csv
        sp.click('#att-copy'); expect(sp.locator('#toast')).to_contain_text('已複製表格')
        clip = sp.evaluate('navigator.clipboard.readText()')
        assert clip.startswith('聚會出席人數　2026 年 10 月份\n') and '\n保羅團\t3\t/\t4\t/\t' in clip, clip[:80]
        sp.set_viewport_size({'width': 390, 'height': 844}); sp.reload(); sp.wait_for_selector('.att-report')
        layout(sp, 'report 390'); shot(sp, 'report-390.png')
        sp.set_viewport_size({'width': 1440, 'height': 1000})
        tab(sp, 'settings'); expect(sp.locator('.att-settings')).to_contain_text('Google 試算表'); expect(sp.locator('.att-settings')).to_contain_text('未連接')
        tab(sp, 'codes'); expect(sp.locator('.att-codes li[data-target="staff"]')).to_have_count(0)
        checks.append('Staff: head-count total, 16-row 月訊 table in 月訊 order, CSV with BOM, copy as table, settings; no staff-code row for staff')

        # Code reset: the phone that remembered the old code is signed out at once.
        new_code = set_code(sp, 'paul'); shot(sp, 'codes-1440.png')
        assert lctx.request.get(BASE + '/api/attendance/meeting?group=paul').json()['error'] == 'unlock_required'
        lp.goto(BASE + '/members/attendance/'); expect(lp.locator('#att-unlock-form')).to_be_visible()
        lp.select_option('#att-unit', 'paul'); lp.fill('#att-code', new_code); lp.click('#att-unlock-submit')
        expect(lp.locator('.att-bar b')).to_have_text('保羅團')
        set_code(sp, 'paul', PAUL_CODE)  # back to the known test code for the next run
        expect(lp.locator('.att-bar')).to_be_visible()
        lp.reload(); expect(lp.locator('#att-unlock-form')).to_be_visible()
        unlock(lp, 'paul', PAUL_CODE)
        lp.click('#att-lock'); expect(lp.locator('#att-unlock-form')).to_be_visible()
        unlock(lp, 'paul', PAUL_CODE)
        checks.append('Code reset by staff signs the old phone out; new code unlocks; lock button works')

        # Every view at 320, 390 and 1440: no overflow, targets ≥ 44px.
        for w, h in [(320, 740), (390, 844), (1440, 1000)]:
            for page in (lp, sp):
                page.set_viewport_size({'width': w, 'height': h})
            for name, q in [('', {}), ('history', {}), ('roster', {}), ('report', {'month': '2026-10'}), ('stats', {'year': '2026'})]:
                tab(lp, name, **q); layout(lp, f'leader {name or "roll"} {w}')
                if w == 320 and not name:
                    shot(lp, 'roll-320.png')
            for name, q in [('', {'group': 'sun-worship'}), ('codes', {}), ('settings', {}), ('report', {'month': '2026-10'})]:
                tab(sp, name, **q); layout(sp, f'staff {name or "roll"} {w}')
            lp.goto(BASE + '/members/attendance/?tab=roll'); lp.wait_for_selector('.att-roll')
        checks.append('320×740, 390×844, 1440×1000: leader and staff views, no overflow, every button and tab ≥ 44px')
        assert not errors, errors
        browser.close()
    out = {'base': BASE, 'checks': checks, 'pageErrors': errors, 'shots': str(SHOTS)}
    print(json.dumps(out, ensure_ascii=False, indent=1))
except Exception as error:
    message = str(error)
    for value in (password, admin_code):
        message = message.replace(value, '[REDACTED]')
    print(message)
    raise SystemExit(1)

"""團契點名 end to end against a LOCAL `wrangler dev` with a FRESH local D1 database
(stop dev, delete .wrangler/state/v3/d1, `npx wrangler d1 migrations apply ATT_DB --local`,
start dev). It writes fake names (測試甲…), sets a throwaway 同工 password and makes
roll-call links, so it refuses to run against anything but localhost. Test month: October 2026.

usage: python3 scripts/check-attendance.py https://localhost:8787 [--shots DIR]
Reads the member password and the local admin password hidden (getpass); neither is printed.
Covers: one login box (member / 同工 / admin), admin sets the 同工 password, 同工 make a
roll-call link, a phone opens it WITHOUT logging in and sees only that group, per-tap
saves (two phones at once, offline queue then resume, reload), edit a past meeting,
reschedule and cancel, 以斯帖團 on Friday, the 月訊 table and CSV, copy, 只記人數 switch,
link reset signing the old phone out, forget, 同工 password change signing 同工 out,
and at 320/390/1440 no overflow and every target at least 44px.
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
STAFF_PW, STAFF_PW_2 = 'STAFF-TEST-01', 'STAFF-TEST-02'
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
SIZE_JS = '''[...document.querySelectorAll('#att-root .att-btn,#att-root .att-tabs a,#att-root [data-mark],#att-root [data-state],#att-root [data-day],#att-root [data-mode],#att-root .att-step,#att-root .att-history a,#att-root #att-forget')]
 .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]'))
 .map(e=>{const r=e.getBoundingClientRect();return [e.textContent.trim().slice(0,12),Math.round(r.width),Math.round(r.height)]})
 .filter(([,w,h])=>w<44||h<44)'''
PUT_MEETING = lambda r: r.url.endswith('/api/attendance/meeting') and r.request.method == 'PUT'


def context(browser, w, h, **kw):
    return browser_context(browser, BASE, viewport={'width': w, 'height': h}, locale='zh-HK', **kw)


def login(ctx, pw):
    r = ctx.request.post(BASE + '/api/login', headers={'Origin': BASE}, data={'password': pw}, max_redirects=0)
    assert r.status == 200, f'login {r.status}'
    return r.json()['role']


def new_page(ctx):
    page = ctx.new_page(); page.set_default_timeout(15000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    return page


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / name), full_page=True, animations='disabled', style='.att-savebar{position:static!important}#toast{display:none}')


def layout(page, label):
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), f'{label}: horizontal overflow'
    small = page.evaluate(SIZE_JS)
    assert not small, f'{label}: targets under 44px {small}'


def tab(page, name='', **query):
    q = {k: v for k, v in {'tab': name, **query}.items() if v}
    page.goto(BASE + '/members/attendance/' + ('?' + urlencode(q) if q else ''))
    page.wait_for_selector('#att-view section.panel')


def row(page, name):
    return page.locator('.att-row').filter(has=page.locator('.att-name', has_text=re.compile('^' + name)))


def mark(page, name, status, saved=True):
    button = row(page, name).get_by_role('button', name=status, exact=True)
    if button.get_attribute('aria-pressed') == 'true':  # pressing a chosen mark again clears it
        return
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')
    if saved:
        expect(row(page, name).locator('.att-mark-state')).to_have_attribute('data-s', 'saved')


def marks(page, **by_status):
    for status, names in by_status.items():
        for name in names:
            mark(page, name, {'present': '出席', 'leave': '請假', 'absent': '缺席'}[status])


def clear_marks(page):
    for name in NAMES:
        b = row(page, name).locator('[aria-pressed="true"]')
        if b.count():
            b.click(); expect(row(page, name).locator('.att-mark-state')).to_have_attribute('data-s', 'saved')


def count(page, field, value):
    """Type a count; it saves 0.6 s after the last change."""
    with page.expect_response(PUT_MEETING) as resp:
        page.fill(f'#att-{field}', str(value))
    assert resp.value.ok, resp.value.status


def counts(page, new_friends, guests):
    for field, value in (('new_friends', new_friends), ('other_guests', guests)):
        if page.input_value(f'#att-{field}') != str(value):
            count(page, field, value)


def state(page, value):
    with page.expect_response(PUT_MEETING) as resp:
        page.locator(f'[data-state="{value}"]').click()
    assert resp.value.ok, resp.value.status


def make_link(page, group):
    tab(page, 'links')
    li = page.locator(f'.att-codes li[data-target="{group}"]')
    li.locator('[data-link-reset]').click()
    value = li.locator('.att-link-value')
    expect(value).to_have_value(re.compile(r'^' + re.escape(BASE) + r'/attendance/#[A-Za-z0-9_-]{32}$'))
    return value.input_value()


def open_link(page, url, group_name):
    page.goto(url)
    page.wait_for_url(BASE + '/members/attendance/')
    expect(page.locator('.att-bar b')).to_have_text(group_name)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        anon = context(browser, 390, 844)
        assert anon.request.get(BASE + '/api/attendance/me').status == 401
        assert anon.request.put(BASE + '/api/attendance/meeting', data='{}', headers={'Content-Type': 'application/json'}).status == 403
        assert anon.request.fetch(BASE + '/api/attendance/meeting', method='DELETE', headers={'Origin': BASE}).status == 405
        assert anon.request.post(BASE + '/api/attendance/link', headers={'Origin': BASE}, data={'token': 'x' * 32}).status == 401
        checks.append('Anonymous API 401; write without Origin 403; wrong method 405; wrong link token 401')

        # Admin (desktop) signs in with the admin password in the ordinary login box.
        actx = context(browser, 1440, 1000); assert login(actx, admin_code.lower()) == 'admin'; ap = new_page(actx)
        tab(ap); expect(ap.locator('.att-bar b')).to_have_text('網站管理員')
        tab(ap, 'settings')
        ap.click('#att-staffpw-open'); ap.fill('#att-new-staffpw', STAFF_PW); ap.click('#att-staffpw .att-code-form button[type=submit]')
        expect(ap.locator('#att-staffpw .att-link-value')).to_have_value(STAFF_PW)
        expect(ap.locator('#att-staffpw .att-code-state')).to_have_text('已設定')
        shot(ap, 'settings-admin-1440.png')
        checks.append('Admin signs in through the login box; sets the shared 同工 password (shown once)')

        # 同工 (desktop) sign in with the 同工 password: 90-day session, all groups, link management.
        sctx = context(browser, 1440, 1000, accept_downloads=True)
        sctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        assert login(sctx, STAFF_PW.lower().replace('-', ' ')) == 'staff'; sp = new_page(sctx)
        session = next(c for c in sctx.cookies() if c['name'] == '__Host-fhcem_preview')
        days = (session['expires'] - datetime.datetime.now().timestamp()) / 86400
        assert 89 < days <= 90, days
        tab(sp); expect(sp.locator('.att-bar b')).to_have_text('傳道同工')
        expect(sp.locator('.att-tabs a')).to_have_text(['點名', '過去聚會', '名單', '月訊表', '統計', '點名連結', '設定'])
        link = make_link(sp, 'paul')
        shot(sp, 'links-1440.png')
        # Show the link again later (a fresh page): the same link, with copy.
        tab(sp, 'links')
        li = sp.locator('.att-codes li[data-target="paul"]')
        expect(sp.locator('.att-codes li[data-target="david"] [data-link-show]')).to_be_hidden()
        li.locator('[data-link-show]').click()
        expect(li.locator('.att-link-value')).to_have_value(link)
        shot(sp, 'links-show-1440.png')
        checks.append('同工 sign in with the 同工 password (case and spaces ignored), kept 90 days; make 保羅團 link, show it again later')

        # A plain member sees how to get in, not a code form.
        mctx = context(browser, 390, 844); assert login(mctx, password) == 'member'; mp = new_page(mctx)
        mp.goto(BASE + '/members/attendance/'); expect(mp.locator('#att-nolink')).to_be_visible()
        member = next(c for c in mctx.cookies() if c['name'] == '__Host-fhcem_preview')
        assert 0.3 < (member['expires'] - datetime.datetime.now().timestamp()) / 3600 <= 8
        shot(mp, 'member-nolink-390.png')
        checks.append('Member password: 8-hour session; attendance explains the group link')

        # 保羅團 phone: no login at all, just the link.
        lctx = context(browser, 390, 844); lp = new_page(lctx)
        bad = new_page(lctx); bad.goto(BASE + '/attendance/#' + 'x' * 32)
        expect(bad.locator('#link-status')).to_have_text('這條點名連結已失效或不完整。'); assert '#' not in bad.url
        shot(bad, 'link-invalid-390.png'); bad.close()
        open_link(lp, link, '保羅團')
        assert link.split('#')[1] not in lp.url
        cookie = next(c for c in lctx.cookies() if c['name'] == '__Host-fhcem_link')
        assert cookie['httpOnly'] and cookie['secure'] and cookie['sameSite'] == 'Strict'
        assert 89 < (cookie['expires'] - datetime.datetime.now().timestamp()) / 86400 <= 90
        assert not [c for c in lctx.cookies() if c['name'] == '__Host-fhcem_preview']
        assert '__Host-fhcem_link' not in lp.evaluate('document.cookie')
        expect(lp.locator('.att-tabs a')).to_have_text(['點名', '過去聚會', '名單', '月訊表', '統計'])
        expect(lp.locator('.side-nav, #member-logout')).to_have_count(0)
        assert lctx.request.get(BASE + '/members/', max_redirects=0).status == 302
        assert lctx.request.get(BASE + '/api/member-resources').status == 401
        assert lctx.request.get(BASE + '/api/attendance/meeting?group=david').status == 403
        checks.append('Link opens without login: token only in the fragment and removed; link cookie HttpOnly/Secure/Strict 90 days; group tabs only; other member pages and groups closed')

        # Roster through the link.
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
        layout(lp, 'roster 390'); shot(lp, 'roster-390.png')
        checks.append('Roster through the link: add, duplicate refused, rename, mark left')

        # 今次 roll call: every tap saves; no save button.
        tab(lp)
        expect(lp.locator('.att-when')).to_contain_text(fmt(current))
        expect(lp.locator('#att-save')).to_have_count(0)
        clear_marks(lp)
        marks(lp, present=['測試甲', '測試乙'], leave=['測試丙'], absent=['測試丁'])
        counts(lp, 0, 0)
        with lp.expect_response(PUT_MEETING):
            lp.locator('[data-step="new_friends"][data-d="1"]').click(); lp.locator('[data-step="new_friends"][data-d="1"]').click()
        with lp.expect_response(PUT_MEETING):
            lp.locator('[data-step="other_guests"][data-d="1"]').click()
        expect(lp.locator('#att-sum .att-total b')).to_have_text('5')
        expect(lp.locator('#att-sum')).to_contain_text('未點 1')
        expect(lp.locator('#att-status')).to_contain_text('最後修改：保羅團連結')
        layout(lp, 'roll 390'); shot(lp, 'roll-390.png')
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(row(lp, '測試丙').get_by_role('button', name='請假', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-sum .att-total b')).to_have_text('5')
        checks.append('Roll call: each tap saves (state shown per name), ± counters save on their own, total, reload keeps values, recorded as 保羅團連結')

        # Two phones on the same link mark together; neither overwrites the other.
        l2 = context(browser, 390, 844); lp2 = new_page(l2); open_link(lp2, link, '保羅團')
        mark(lp2, '測試戊', '出席')
        mark(lp, '測試甲', '請假'); mark(lp, '測試甲', '出席')
        expect(row(lp, '測試戊').get_by_role('button', name='出席', exact=True)).to_have_attribute('aria-pressed', 'true')
        lp2.reload(); lp2.wait_for_selector('.att-roll')
        expect(row(lp2, '測試甲').get_by_role('button', name='出席', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-sum .att-total b')).to_have_text('6')
        l2.close()
        checks.append("Two phones marking the same meeting: each keeps the other's marks (another phone's mark appears with the next reply)")

        # Offline: the tap waits in this phone and goes out when the network is back.
        lp.route('**/api/attendance/mark', lambda r: r.abort('internetdisconnected'))
        lctx.set_offline(True)
        mark(lp, '測試戊', '請假', saved=False)
        expect(row(lp, '測試戊').locator('.att-mark-state')).to_have_attribute('data-s', 'queued')
        expect(lp.locator('#att-status')).to_contain_text('未送出')
        expect(lp.locator('#att-unsent')).to_be_visible(); expect(lp.locator('#att-unsent')).to_contain_text('未送出')
        queue = lp.evaluate("localStorage.getItem('fhcem-att-queue-v2')")
        assert queue and all(n not in queue for n in NAMES), 'queue must hold member ids only'
        lp.evaluate('scrollTo(0,0)'); shot(lp, 'unsent-390.png')
        lp.unroute('**/api/attendance/mark'); lctx.set_offline(False)
        expect(lp.locator('#att-unsent')).to_be_hidden(timeout=25000)
        assert lp.evaluate("localStorage.getItem('fhcem-att-queue-v2')") is None
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(row(lp, '測試戊').get_by_role('button', name='請假', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-sum .att-total b')).to_have_text('5')
        checks.append('Offline tap queued (ids only, "未送出" on the name and in the banner), sent automatically when back online, kept after reload')

        # October 2026: edit a past meeting, reschedule across weeks, cancel.
        def meeting(date):
            tab(lp, date=date); lp.wait_for_selector('.att-roll')
        meeting('2026-10-03')
        marks(lp, present=['測試甲'], absent=['測試乙', '測試丙', '測試丁', '測試戊']); counts(lp, 1, 0)
        meeting('2026-10-03'); mark(lp, '測試乙', '出席'); expect(lp.locator('#att-sum .att-total b')).to_have_text('3')
        meeting('2026-10-10')
        lp.locator('[data-state="moved"]').click()
        with lp.expect_response(PUT_MEETING):
            lp.fill('#att-actual', '2026-10-15'); lp.locator('#att-actual').dispatch_event('change')
        marks(lp, present=['測試甲'], absent=['測試乙', '測試丙', '測試丁', '測試戊']); counts(lp, 0, 0)
        lp.reload(); lp.wait_for_selector('.att-roll')
        expect(lp.locator('[data-state="moved"]')).to_have_attribute('aria-pressed', 'true')
        expect(lp.locator('#att-actual')).to_have_value('2026-10-15')
        meeting('2026-10-17')
        marks(lp, present=['測試甲', '測試乙', '測試丙'], absent=['測試丁', '測試戊']); counts(lp, 0, 0)
        tab(lp, 'history'); layout(lp, 'history 390'); shot(lp, 'history-390.png')
        lp.locator('.att-history a', has_text='2026 年 10 月 24 日').click(); lp.wait_for_selector('.att-roll')
        expect(lp.locator('.att-when')).to_contain_text('2026 年 10 月 24 日')
        state(lp, 'cancelled'); expect(lp.locator('#att-cancel-note')).to_be_visible()
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
        checks.append(f'Link sees only its own 月訊 row: {cells}; stats page')

        # 同工: head-count meeting, 以斯帖團 Friday, full 月訊 table, CSV, copy, settings.
        tab(sp, group='sun-worship', date='2026-10-04')
        expect(sp.locator('.att-row')).to_have_count(0)
        count(sp, 'headcount', 78)
        tab(sp, group='esther', date='2026-10-31')
        expect(sp.locator('#att-days [data-day]')).to_have_text(['週六（10/31）', '週五（10/30）'])
        expect(sp.locator('[data-day="2026-10-31"]')).to_have_attribute('aria-pressed', 'true')
        sp.click('[data-day="2026-10-30"]'); expect(sp.locator('[data-day="2026-10-30"]')).to_have_attribute('aria-pressed', 'true')
        with sp.expect_response(PUT_MEETING):
            sp.locator('[data-step="other_guests"][data-d="1"]').click()
        expect(sp.locator('[data-state="held"]')).to_have_attribute('aria-pressed', 'true')
        shot(sp, 'esther-friday-1440.png')
        tab(sp, 'history', group='esther')
        expect(sp.locator('.att-history li', has_text='2026 年 10 月 30 日')).to_contain_text('已點名（週五）')
        tab(sp, 'report', month='2026-10')
        expect(sp.locator('.att-report tbody tr')).to_have_count(16)
        expect(sp.locator('.att-report tbody th').first).to_have_text('週六崇拜')
        cells = [re.sub(r'\s+', '', t) for t in sp.locator('tr[data-group="paul"] td').all_inner_texts()]
        assert cells == expected, cells
        assert re.sub(r'\s+', '', sp.locator('tr[data-group="sun-worship"] td').first.inner_text()) == '78'
        assert re.sub(r'\s+', '', sp.locator('tr[data-group="esther"] td').nth(4).inner_text()) == '1'
        layout(sp, 'report 1440'); shot(sp, 'report-1440.png')
        link_el = sp.locator('#att-csv')
        assert link_el.get_attribute('download') == '聚會出席人數-2026-10.csv'
        response = sctx.request.get(BASE + link_el.get_attribute('href'))
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
        expect(sp.locator('#att-staffpw')).to_have_count(0)
        checks.append('同工: head-count total, 以斯帖團 held on Friday 10-30 (not 改期), 16-row 月訊 table, CSV with BOM, copy as table; 同工 password section admin-only')

        # 只記人數 switch (同工 only): the link phone gets three counts instead of names.
        sp.locator('.att-modes li[data-group="paul"] [data-mode="count"]').click()
        expect(sp.locator('.att-modes li[data-group="paul"] [data-mode="count"]')).to_have_attribute('aria-pressed', 'true')
        shot(sp, 'settings-1440.png')
        tab(lp, date='2026-10-03'); expect(lp.locator('.att-row')).to_have_count(0); expect(lp.locator('#att-member_count')).to_be_visible()
        shot(lp, 'count-mode-390.png')
        sp.locator('.att-modes li[data-group="paul"] [data-mode="names"]').click()
        expect(sp.locator('.att-modes li[data-group="paul"] [data-mode="names"]')).to_have_attribute('aria-pressed', 'true')
        tab(lp, date='2026-10-03'); expect(lp.locator('.att-row')).to_have_count(5)
        checks.append('記名／只記人數 per group by 同工; the link phone shows counts only, names kept')

        # Link reset: the phone that remembered the old link is stopped at once.
        new_link = make_link(sp, 'paul')
        assert new_link != link
        assert lctx.request.get(BASE + '/api/attendance/me').status == 401
        lp.goto(BASE + '/members/attendance/'); expect(lp.locator('#att-link-gone')).to_be_visible()
        shot(lp, 'link-gone-390.png')
        stale = new_page(lctx); stale.goto(link); expect(stale.locator('#link-status')).to_have_text('這條點名連結已失效或不完整。'); stale.close()
        open_link(lp, new_link, '保羅團')
        lp.click('#att-forget'); expect(lp.locator('#att-forgotten')).to_be_visible()
        assert not [c for c in lctx.cookies() if c['name'] == '__Host-fhcem_link']
        open_link(lp, new_link, '保羅團')
        checks.append('Link reset by 同工 stops the old link and the phone holding it; new link works; "移除連結" forgets it on this phone')

        # Every view at 320, 390 and 1440: no overflow, targets ≥ 44px.
        for w, h in [(320, 740), (390, 844), (1440, 1000)]:
            for page in (lp, sp):
                page.set_viewport_size({'width': w, 'height': h})
            for name, q in [('', {}), ('history', {}), ('roster', {}), ('report', {'month': '2026-10'}), ('stats', {'year': '2026'})]:
                tab(lp, name, **q); layout(lp, f'link {name or "roll"} {w}')
                if w == 320 and not name:
                    shot(lp, 'roll-320.png')
            for name, q in [('', {'group': 'sun-worship'}), ('', {'group': 'esther', 'date': '2026-10-31'}), ('links', {}), ('settings', {}), ('report', {'month': '2026-10'})]:
                tab(sp, name, **q); layout(sp, f'staff {name or "roll"} {w}')
            if w == 1440:
                tab(lp); shot(lp, 'link-roll-1440.png')
        checks.append('320×740, 390×844, 1440×1000: link and 同工 views, no overflow, every button and tab ≥ 44px')

        # Changing the 同工 password signs every 同工 phone out.
        tab(ap, 'settings'); ap.click('#att-staffpw-open'); ap.fill('#att-new-staffpw', STAFF_PW_2); ap.click('#att-staffpw .att-code-form button[type=submit]')
        expect(ap.locator('#att-staffpw .att-link-value')).to_have_value(STAFF_PW_2)
        assert sctx.request.get(BASE + '/api/session').json() == {'authenticated': False}
        assert actx.request.get(BASE + '/api/session').json()['role'] == 'admin'
        r = anon.request.post(BASE + '/api/login', headers={'Origin': BASE}, data={'password': STAFF_PW}, max_redirects=0); assert r.status == 401
        assert login(sctx, STAFF_PW_2) == 'staff'
        checks.append('Changing the 同工 password signs 同工 out at once; the old password is refused, the new one works')
        assert not errors, errors
        browser.close()
    out = {'base': BASE, 'checks': checks, 'pageErrors': errors, 'shots': str(SHOTS)}
    print(json.dumps(out, ensure_ascii=False, indent=1))
except Exception as error:
    message = str(error)
    for value in (password, admin_code, admin_code.lower()):
        message = message.replace(value, '[REDACTED]')
    print(message)
    raise SystemExit(1)

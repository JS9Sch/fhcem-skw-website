"""Exercise adapted controls using demo data only, at phone and desktop sizes."""
from urllib.parse import quote
import getpass
import json
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_target import browser_target, browser_context

BASE, _ = browser_target(sys.argv[1] if len(sys.argv) > 1 else 'https://localhost:8788')
password = getpass.getpass('Preview password (hidden): ')
OUT = Path(__file__).resolve().parents[1] / 'evidence/uiverse-ui'
OUT.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in [(320, 740), (390, 844), (1440, 1000)]:
            ctx = browser_context(browser, BASE, viewport={'width': width, 'height': height})
            page = ctx.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            # Floating label (Uiverse alexruix) on the one login box: moves up once there is text.
            page.goto(BASE + '/login/')
            field = page.locator('#password'); label = page.locator('label[for="password"]')
            resting = label.bounding_box()['y']
            field.fill('ABCD'); page.wait_for_timeout(250)
            assert label.bounding_box()['y'] < resting - 8
            for target in [page.locator('#login-submit'), field]:
                box = target.bounding_box()
                assert box['height'] >= 44 and box['width'] >= 44, box
            field.fill('')
            assert ctx.request.post(BASE + '/api/login', headers={'Origin': BASE},
                                    data={'password': password}, max_redirects=0).status == 200
            # Attendance (real data, D1): a member without a group link is told how to open it;
            # the roll-call buttons (Uiverse WhiteNervosa) are exercised in check-attendance.py.
            page.goto(BASE + '/members/attendance/')
            expect(page.locator('h1')).to_have_text('團契點名')
            expect(page.locator('#att-nolink')).to_be_visible()
            expect(page.locator('#att-unlock-form, #att-code')).to_have_count(0)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(OUT / f'attendance-{width}.png'), full_page=True, animations="disabled")

            # 詩歌庫 (real list from D1; local runs use the seeded fake data): search box
            # (Uiverse satyamchaudharydev) with keyboard clear, list restored afterwards.
            page.goto(BASE + '/members/songs/')
            page.wait_for_selector('.sg-list li')
            before = page.locator('.sg-list > li').count()
            query = page.get_by_label('搜尋詩歌', exact=True)
            query.fill('找不到的歌')
            expect(page.locator('.sg-list .empty')).to_have_count(1)
            query.press('Tab')
            expect(page.get_by_role('button', name='清除詩歌搜尋')).to_be_focused()
            page.keyboard.press('Enter')
            expect(query).to_be_focused()
            expect(page.locator('.sg-list > li')).to_have_count(before)
            page.get_by_role('button', name='最近加入').click()
            expect(page.get_by_role('button', name='最近加入')).to_have_attribute('aria-pressed', 'true')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(OUT / f'songs-{width}.png'), full_page=True, animations="disabled")

            # Category tabs (Uiverse Yaya12085): arrow keys move the choice, rows follow.
            page.goto(BASE + '/meetings/')
            first = page.locator('.filter input[type=radio]').first
            first.focus(); first.press('ArrowRight')
            expect(page.locator('.filter input[value="崇拜"]')).to_be_checked()
            # 崇拜: 主日崇拜, 週六晚崇拜, 幼兒崇拜, 詩班練詩 (2026–2027 聚會時間表).
            expect(page.locator('#week-grid li[data-cat]:visible')).to_have_count(4)
            expect(page.locator('.filter-status')).to_contain_text('4')
            page.goto(BASE + '/meetings/?cat=' + quote('團契'))
            expect(page.locator('.filter input[value="團契"]')).to_be_checked()
            expect(page.locator('#week-grid li[data-cat="崇拜"]:visible')).to_have_count(0)
            # 以斯帖團 meets 週五晚／週六下午: shown in both columns, counted once
            # (10 fellowships + 家長加油站 + 鄰舍加油站 = 12).
            expect(page.locator('#week-grid li', has_text='以斯帖團')).to_have_count(2)
            expect(page.locator('.filter-status')).to_contain_text('顯示 12 項團契聚會')
            # No "沒有恆常聚會" placeholder on empty days (user, 2026-11-06).
            expect(page.locator('#week-grid')).not_to_contain_text('沒有恆常聚會')
            # Meetings without a fixed day (青成聖經班) sit under the grid and follow the filter too.
            expect(page.locator('#week-grid-extra li[data-cat="學習"]')).to_be_hidden()
            page.goto(BASE + '/contact/')
            # Floating-label form (Uiverse alexruix): checks fields, never sends.
            page.locator('#contact-form button[type=submit]').click()
            expect(page.locator('#e-name')).to_contain_text('請填寫姓名')
            expect(page.locator('#f-name')).to_be_focused()
            page.locator('#f-name').fill('示範'); page.locator('#f-email').fill('demo@example.com'); page.locator('#f-message').fill('測試內容')
            page.locator('#contact-form button[type=submit]').click()
            expect(page.locator('#form-status')).to_contain_text('不會送出')
            # Arrow button (Uiverse nathAd17) and real page URLs.
            page.goto(BASE + '/')
            cta = page.get_by_role('link', name='看聚會時間', exact=True).first
            expect(cta.locator('.arr')).to_have_count(1)
            cta.focus(); cta.press('Enter')
            expect(page).to_have_url(BASE + '/meetings/')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.goto(BASE + '/')
            # Room numbers in the address stay on one line (live bug 2026-11-06: each number stacked).
            assert page.evaluate("[...document.querySelectorAll('.addr .nw')].every(e => getComputedStyle(e).display === 'inline')")
            assert page.evaluate("(() => { const r = document.querySelector('#visit .addr .rooms'); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size === 1 })()"), width
            expect(page.locator('.hello h1')).to_be_visible()
            for section in page.locator('.reveal').all():
                section.scroll_into_view_if_needed()
                expect(section).to_have_class(re.compile(r'.*\bin\b.*'))
            page.evaluate("scrollTo({top:0,behavior:'instant'})")
            page.screenshot(path=str(OUT / f'home-{width}.png'), full_page=True, animations="disabled")
            assert ctx.request.post(BASE + '/api/logout', headers={'Origin': BASE}, max_redirects=0).ok
            ctx.close()
            checks.append(f'{width}×{height}: login floating label, attendance link notice, song search/clear/filter, category tabs, form check, CTA navigation, reveals, no overflow')
        browser.close()
    assert not errors, errors
    result = {'base': BASE, 'checks': checks, 'pageErrors': errors}
    (OUT / 'checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))
except Exception as error:
    print(str(error).replace(password, '[REDACTED]'))
    raise SystemExit(1)

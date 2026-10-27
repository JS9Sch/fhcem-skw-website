"""Exercise adapted controls using demo data only, at phone and desktop sizes."""
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
            assert ctx.request.post(BASE + '/api/login', headers={'Origin': BASE},
                                    data={'password': password}, max_redirects=0).status == 200
            page = ctx.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE + '/members/#/members/attendance')
            expect(page.locator('h1')).to_have_text('團契點名')
            search = page.get_by_label('搜尋團友', exact=True)
            search.fill('A')
            expect(page.locator('[data-person]:visible')).to_have_count(1)
            clear = page.get_by_role('button', name='清除團友搜尋')
            expect(clear).to_be_visible()
            clear.click()
            expect(search).to_be_focused()
            expect(search).to_have_value('')
            expect(page.locator('[data-person]:visible')).to_have_count(6)
            search.fill('沒有此人')
            expect(page.locator('#people-empty')).to_be_visible()
            search.press('Escape')
            expect(page.locator('[data-person]:visible')).to_have_count(6)
            row = page.locator('[data-person="A"]')
            absent = row.get_by_role('button', name='缺席', exact=True)
            absent.focus()
            absent.press('Space')
            expect(row.locator('[aria-pressed="true"]')).to_have_count(1)
            expect(absent).to_have_attribute('aria-pressed', 'true')
            expect(page.locator('#att-stats strong')).to_have_text(['2', '1', '3'])
            for button in row.locator('[data-status]').all():
                box = button.bounding_box()
                assert box['height'] >= 44 and box['width'] >= 44, box
            page.locator('#save-attendance').click()
            page.reload()
            expect(page.locator('[data-person="A"] [data-status="缺席"]')).to_have_attribute('aria-pressed', 'true')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(OUT / f'attendance-{width}.png'), full_page=True, animations="disabled")

            page.goto(BASE + '/members/#/members/songs')
            expect(page.locator('.song-row')).to_have_count(3)
            page.locator('[data-category="感恩"]').click()
            query = page.get_by_label('搜尋詩歌', exact=True)
            query.fill('找不到')
            expect(page.locator('.song-row')).to_have_count(0)
            query.press('Tab')
            expect(page.get_by_role('button', name='清除詩歌搜尋')).to_be_focused()
            page.keyboard.press('Enter')
            expect(query).to_be_focused()
            expect(page.locator('.song-row')).to_have_count(1)
            expect(page.locator('[data-category="感恩"]')).to_have_class('active')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(OUT / f'songs-{width}.png'), full_page=True, animations="disabled")

            toggle = page.locator('#motion-toggle')
            toggle.focus()
            toggle.press('Space')
            expect(toggle).to_have_attribute('aria-pressed', 'false')
            expect(page.locator('body')).to_have_attribute('data-motion', 'off')
            page.reload()
            expect(toggle).to_have_attribute('aria-pressed', 'false')
            toggle.click()
            expect(toggle).to_have_attribute('aria-pressed', 'true')
            page.emulate_media(reduced_motion='reduce')
            expect(toggle).to_be_disabled()
            expect(toggle).to_contain_text('依系統關閉')
            expect(page.locator('body')).to_have_attribute('data-motion', 'off')
            page.emulate_media(reduced_motion='no-preference')
            expect(toggle).to_be_enabled()
            expect(toggle).to_have_attribute('aria-pressed', 'true')

            page.goto(BASE + '/')
            cta = page.get_by_role('link', name='查看聚會時間', exact=True).first
            expect(cta.locator('.action-arrow')).to_have_count(1)
            cta.focus()
            cta.press('Enter')
            expect(page).to_have_url(BASE + '/#/meetings')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.goto(BASE + '/')
            expect(page.locator('.hero h1')).to_be_visible()
            for section in page.locator('[data-reveal]').all():
                section.scroll_into_view_if_needed()
                expect(section).not_to_have_class(re.compile(r'.*will-reveal.*'))
            page.evaluate("scrollTo({top:0,behavior:'instant'})")
            page.screenshot(path=str(OUT / f'home-{width}.png'), full_page=True, animations="disabled")
            assert ctx.request.post(BASE + '/api/logout', headers={'Origin': BASE}, max_redirects=0).ok
            ctx.close()
            checks.append(f'{width}×{height}: search/clear/filter, exclusive attendance/save, keyboard, motion/system preference, navigation, no overflow')
        browser.close()
    assert not errors, errors
    result = {'base': BASE, 'checks': checks, 'pageErrors': errors}
    (OUT / 'checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))
except Exception as error:
    print(str(error).replace(password, '[REDACTED]'))
    raise SystemExit(1)

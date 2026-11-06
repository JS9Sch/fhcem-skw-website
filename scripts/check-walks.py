"""Check the 怎樣來 walking routes on the homepage at phone and desktop sizes (public page, no login).
usage: python3 scripts/check-walks.py [base-url] [--shots]"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_target import browser_target, browser_context

args = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE, _ = browser_target(args[0] if args else 'https://localhost:8787')
SHOTS = '--shots' in sys.argv
OUT = Path(__file__).resolve().parents[1] / 'evidence/walks'
WALKS = ['bus-sunsing', 'bus-namhong', 'bus-namon', 'tram-namhong', 'tram-sunsing', 'mtr-a3']
checks, errors = [], []

shown = "() => [...document.querySelectorAll('.map .walk')].filter(g => getComputedStyle(g).display !== 'none').map(g => g.dataset.walk)"

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(320, 740), (390, 844), (1440, 1000)]:
        for motion in ('no-preference', 'reduce'):
            ctx = browser_context(browser, BASE, viewport={'width': width, 'height': height}, reduced_motion=motion)
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(BASE + '/#visit')
            buttons = page.locator('.ways button.walk-btn')
            expect(buttons).to_have_count(len(WALKS))
            assert page.evaluate(shown) == [], 'a route is shown before any stop is chosen'
            note = page.locator('#walk-note')
            for wid in WALKS:
                btn = page.locator(f'.ways button[data-walk="{wid}"]')
                btn.click()
                expect(btn).to_have_attribute('aria-pressed', 'true')
                assert page.evaluate(shown) == [wid], (wid, page.evaluate(shown))
                assert '步行約' in note.inner_text() and '教會' in note.inner_text(), note.inner_text()
                assert page.locator('[aria-pressed="true"]').count() == 1
                # The route's middle is inside the visible part of the (sideways-scrolling) map.
                vis = page.evaluate("""id => { const g = document.querySelector(`.map .walk[data-walk="${id}"]`), w = document.querySelector('.mapwrap');
                    const b = g.getBoundingClientRect(), r = w.getBoundingClientRect(); const cx = b.left + b.width / 2;
                    return cx >= r.left - 1 && cx <= r.right + 1; }""", wid)
                assert vis, f'{wid} route centre is outside the visible map at {width}px'
                if motion == 'reduce':
                    anim = page.evaluate(f"getComputedStyle(document.querySelector('.map .walk[data-walk=\"{wid}\"] .walk-line')).animationName")
                    assert anim == 'none', anim
                if SHOTS and motion == 'reduce' and wid in ('mtr-a3', 'bus-namon', 'tram-sunsing'):
                    OUT.mkdir(parents=True, exist_ok=True)
                    page.locator('.mapcol').screenshot(path=str(OUT / f'{wid}-{width}.png'))
            # Same button again hides the route and clears the note.
            last = page.locator(f'.ways button[data-walk="{WALKS[-1]}"]')
            last.click()
            expect(last).to_have_attribute('aria-pressed', 'false')
            assert page.evaluate(shown) == [] and note.inner_text() == ''
            # Map markers toggle the same route and the list button follows.
            page.locator('.map .hit[data-walk="bus-namhong"]').dispatch_event('click')
            assert page.evaluate(shown) == ['bus-namhong']
            expect(page.locator('.ways button[data-walk="bus-namhong"]')).to_have_attribute('aria-pressed', 'true')
            # Keyboard: Enter on a focused button.
            page.locator('.ways button[data-walk="tram-namhong"]').focus()
            page.keyboard.press('Enter')
            assert page.evaluate(shown) == ['tram-namhong']
            over = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            assert over <= 0, f'page overflows by {over}px at {width}'
            ctx.close()
        checks.append(f'{width}×{height}: 6 routes via list, marker and keyboard; one at a time; note; toggle off; in view; reduced motion; no overflow')
    # Without the script the names stay plain text and no route shows.
    ctx = browser_context(browser, BASE, viewport={'width': 390, 'height': 844}, java_script_enabled=False)
    page = ctx.new_page(); page.goto(BASE + '/#visit')
    assert page.locator('.ways b[data-walk]').count() == len(WALKS) and page.locator('.walk-btn').count() == 0
    assert page.evaluate(shown) == [], 'route visible without the script'
    ctx.close(); checks.append('no-JS: names stay plain text')
    browser.close()

print(json.dumps({'base': BASE, 'checks': checks, 'pageErrors': errors}, ensure_ascii=False))
sys.exit(1 if errors else 0)

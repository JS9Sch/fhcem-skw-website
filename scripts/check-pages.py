"""Check every public page at 1440, 390 and 320 wide: HTTP status, JavaScript
errors, horizontal overflow, broken images, and that reduced motion stops the
tram. No login, no form submission. Screenshots go to evidence/pages/ (ignored).

usage: python scripts/check-pages.py https://localhost:8787 [--shots]
"""
import sys, pathlib
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from browser_target import browser_target, same_origin

PAGES = ['/', '/about/', '/about/faith/', '/about/history/', '/about/churches/', '/meetings/',
         '/activities/', '/notices/', '/notices/weather/', '/notices/song-copyright/',
         '/notices/recreation/', '/notices/weddings-funerals/', '/notices/covid-2023/',
         '/contact/', '/credits/', '/login/', '/no-such-page/']
SIZES = [('desktop', 1440, 1000), ('mobile', 390, 844), ('narrow', 320, 740)]
FONT_HOSTS = ('fonts.googleapis.com', 'fonts.gstatic.com')


def context(browser, base, **options):
    origin, local = browser_target(base)
    ctx = browser.new_context(ignore_https_errors=local, service_workers='block', **options)
    def guard(route):
        url = route.request.url
        if same_origin(url, origin) or urlsplit(url).hostname in FONT_HOSTS:
            return route.continue_()
        return route.abort()
    ctx.route('**/*', guard)
    return ctx


def main(base, shots):
    out = pathlib.Path('evidence/pages'); out.mkdir(parents=True, exist_ok=True)
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, w, h in SIZES:
            ctx = context(browser, base, viewport={'width': w, 'height': h})
            for path in PAGES:
                page = ctx.new_page(); errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                resp = page.goto(base + path, wait_until='networkidle')
                expected = 404 if path == '/no-such-page/' else 200
                if resp.status != expected: failures.append(f'{path} {name}: HTTP {resp.status}')
                page.evaluate('document.fonts.ready')
                page.evaluate('async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,40))}scrollTo(0,0)}')
                page.wait_for_timeout(300)
                over = page.evaluate('document.documentElement.scrollWidth - innerWidth')
                if over > 0: failures.append(f'{path} {name}: horizontal overflow {over}px')
                broken = page.evaluate('[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)')
                if broken: failures.append(f'{path} {name}: broken images {broken}')
                hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e=>getComputedStyle(e).opacity==='0').length")
                if hidden: failures.append(f'{path} {name}: {hidden} sections still hidden after scrolling')
                real = [e for e in errors if 'Failed to load resource' not in e or path != '/no-such-page/']
                if real: failures.append(f'{path} {name}: JS errors {real[:3]}')
                if shots:
                    slug = path.strip('/').replace('/', '_') or 'home'
                    page.screenshot(path=str(out / f'{slug}-{name}.png'), full_page=True)
                page.close()
            ctx.close()
        # Reduced motion: the tram must stand still and reveals must be visible at once.
        ctx = context(browser, base, viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        page = ctx.new_page(); page.goto(base + '/', wait_until='networkidle')
        anim = page.evaluate("getComputedStyle(document.querySelector('.tram-move')).animationName")
        if anim != 'none': failures.append(f'reduced motion: tram animation is {anim}')
        hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e=>getComputedStyle(e).opacity!=='1').length")
        if hidden: failures.append(f'reduced motion: {hidden} sections not shown at once')
        if shots: page.screenshot(path=str(out / 'home-reduced-motion.png'))
        ctx.close(); browser.close()
    if failures:
        print('\n'.join(failures)); sys.exit(1)
    print(f'Checked {len(PAGES)} pages at {len(SIZES)} widths: no JS errors, overflow or broken images; reduced motion respected.')


if __name__ == '__main__':
    main(sys.argv[1].rstrip('/'), '--shots' in sys.argv)

"""Check every public page at 1440, 390 and 320 wide: HTTP status, JavaScript
errors, horizontal overflow, broken images, and that reduced motion stops the
tram; short links and buttons must stay on one line. With --members it also
signs in (password read hidden, never printed) and checks the six member views.
No form is submitted. Screenshots go to evidence/pages/ (ignored).

usage: python scripts/check-pages.py https://localhost:8787 [--shots] [--members]
"""
import sys, pathlib, getpass
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from browser_target import browser_target, same_origin

PAGES = ['/', '/about/', '/about/faith/', '/about/history/', '/about/churches/', '/meetings/',
         '/activities/', '/notices/', '/notices/weather/', '/notices/song-copyright/',
         '/notices/recreation/', '/notices/weddings-funerals/', '/notices/covid-2023/',
         '/contact/', '/credits/', '/login/', '/attendance/', '/no-such-page/']
SIZES = [('desktop', 1440, 1000), ('mobile', 390, 844), ('narrow', 320, 740)]
FONT_HOSTS = ('fonts.googleapis.com', 'fonts.gstatic.com')
MEMBER_VIEWS = ['/members/', '/members/resources/', '/members/attendance/', '/members/songs/', '/members/rooms/', '/members/ppt/']
# Short links/buttons (12 characters or fewer) whose text wraps onto a second line.
WRAPPED = '''[...document.querySelectorAll('a,button')].filter(e=>{
  const t=e.textContent.replace(/\\s+/g,'');if(!t||t.length>12)return false;
  const cs=getComputedStyle(e);if(cs.visibility==='hidden'||!e.getClientRects().length)return false;
  if([...e.children].some(c=>/^(block|flex|grid|list-item)$/.test(getComputedStyle(c).display)))return false;
  if(cs.display==='inline')return e.getClientRects().length>1&&!!e.closest('.cta,.links,.weeknote,.nav,.crumbs,.panel-title,.work-actions')||e.classList.contains('link')&&e.getClientRects().length>1;
  const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.5;
  const inner=e.getBoundingClientRect().height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-parseFloat(cs.borderTopWidth)-parseFloat(cs.borderBottomWidth);
  return inner>lh*1.9}).map(e=>e.textContent.trim())'''


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


def check_page(page, label, failures):
    over = page.evaluate('document.documentElement.scrollWidth - innerWidth')
    if over > 0: failures.append(f'{label}: horizontal overflow {over}px')
    broken = page.evaluate('[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)')
    if broken: failures.append(f'{label}: broken images {broken}')
    wrapped = page.evaluate(WRAPPED)
    if wrapped: failures.append(f'{label}: short links/buttons wrap {wrapped}')


def main(base, shots, members):
    password = getpass.getpass('Member password (hidden): ') if members else None
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
                resp = page.goto(base + path, wait_until='load'); page.wait_for_timeout(400)
                expected = 404 if path == '/no-such-page/' else 200
                if resp.status != expected: failures.append(f'{path} {name}: HTTP {resp.status}')
                page.evaluate('document.fonts.ready')
                page.evaluate('async()=>{const step=innerHeight/2;for(let y=0;y<document.body.scrollHeight;y+=step){scrollTo(0,y);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,60))))}scrollTo(0,0)}')
                page.wait_for_timeout(300)
                check_page(page, f'{path} {name}', failures)
                hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e=>!e.classList.contains('in')).length")
                if hidden: failures.append(f'{path} {name}: {hidden} sections still hidden after scrolling')
                real = [e for e in errors if 'Failed to load resource' not in e or path != '/no-such-page/']
                if real: failures.append(f'{path} {name}: JS errors {real[:3]}')
                if shots:
                    slug = path.strip('/').replace('/', '_') or 'home'
                    page.screenshot(path=str(out / f'{slug}-{name}.png'), full_page=True)
                page.close()
            if password:
                page = ctx.new_page(); errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(base + '/members/')
                if '/login/' not in page.url: failures.append(f'members {name}: anonymous visit not sent to login')
                page.fill('#password', password); page.click('#login-submit'); page.wait_for_url('**/members/')
                for path in MEMBER_VIEWS:
                    page.goto(base + path, wait_until='load'); page.wait_for_selector('.work-title h1'); page.wait_for_timeout(800)
                    check_page(page, f'{path} {name}', failures)
                    if shots:
                        slug = path.strip('/').replace('/', '-')
                        page.screenshot(path=str(out / f'{slug}-{name}.png'), full_page=True)
                page.click('#member-logout'); page.wait_for_url(base + '/')
                if errors: failures.append(f'members {name}: JS errors {errors[:3]}')
                page.close()
            ctx.close()
        # Reduced motion: the tram must stand still and reveals must be visible at once.
        ctx = context(browser, base, viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        page = ctx.new_page(); page.goto(base + '/', wait_until='load'); page.wait_for_timeout(400)
        anim = page.evaluate("getComputedStyle(document.querySelector('.tram-move')).animationName")
        if anim != 'none': failures.append(f'reduced motion: tram animation is {anim}')
        hidden = page.evaluate("[...document.querySelectorAll('.reveal')].filter(e=>getComputedStyle(e).opacity!=='1').length")
        if hidden: failures.append(f'reduced motion: {hidden} sections not shown at once')
        if shots: page.screenshot(path=str(out / 'home-reduced-motion.png'))
        ctx.close(); browser.close()
    if failures:
        print('\n'.join(failures)); sys.exit(1)
    print(f'Checked {len(PAGES)} pages' + (f' and {len(MEMBER_VIEWS)} member views' if password else '') + f' at {len(SIZES)} widths: no JS errors, overflow, broken images or wrapped short links; reduced motion respected.')


if __name__ == '__main__':
    main(sys.argv[1].rstrip('/'), '--shots' in sys.argv, '--members' in sys.argv)

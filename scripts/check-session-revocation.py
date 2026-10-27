"""Verify real Worker session persistence and logout without logging credentials."""
import getpass
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_target import browser_target

targets = [browser_target(value) for value in (sys.argv[1:] or ['https://localhost:8787'])]
password = getpass.getpass('Preview password (hidden): ')
try:
    with sync_playwright() as p:
        base, local_tls = targets[0]
        first = p.request.new_context(ignore_https_errors=local_tls)
        second = p.request.new_context(ignore_https_errors=local_tls)
        tokens = []
        for client in (first, second):
            login = client.post(base + '/api/login', max_redirects=0, headers={'Origin': base}, data={'password': password})
            assert login.status == 200, 'Legitimate login failed'
            tokens.append(login.headers['set-cookie'].split(';', 1)[0])
        password = None
        clients = [(origin, p.request.new_context(ignore_https_errors=local)) for origin, local in targets]
        for origin, client in clients:
            assert client.get(origin + '/members/app.js', max_redirects=0).status == 401, 'Anonymous script exposed'
            assert client.get(origin + '/members/app.js', max_redirects=0, headers={'Cookie': tokens[0]}).status == 200, 'Active session rejected'
        assert first.post(base + '/api/logout', max_redirects=0, headers={'Origin': 'https://unrelated.example'}).status == 403, 'Cross-origin logout accepted'
        assert first.get(base + '/api/session', max_redirects=0).json()['authenticated'], 'Rejected logout changed session'
        assert first.post(base + '/api/logout', max_redirects=0, headers={'Origin': base}).status == 200, 'Logout failed'
        for origin, client in clients:
            copied = {'Cookie': tokens[0]}
            assert not client.get(origin + '/api/session', max_redirects=0, headers=copied).json()['authenticated'], 'Revoked session still active'
            for method in ('GET', 'HEAD'):
                assert client.fetch(origin + '/members/app.js', method=method, headers=copied, max_redirects=0).status == 401, 'Copied token retrieves script'
                for path in ('/members', '/members/', '/members/index.html'):
                    assert client.fetch(origin + path, method=method, headers=copied, max_redirects=0).status == 302, 'Copied token retrieves HTML'
            assert client.get(origin + '/api/session', max_redirects=0, headers={'Cookie': tokens[1]}).json()['authenticated'], 'Independent login was revoked'
        assert clients[0][1].post(base + '/api/logout', max_redirects=0, headers={'Origin': base, 'Cookie': tokens[0]}).status == 200, 'Repeated logout failed'
        assert second.get(base + '/api/session', max_redirects=0).json()['authenticated'], 'Repeated logout revoked independent session'
        assert second.post(base + '/api/logout', max_redirects=0, headers={'Origin': base}).status == 200, 'Second logout failed'
        assert not clients[0][1].get(base + '/api/session', max_redirects=0, headers={'Cookie': tokens[1]}).json()['authenticated'], 'Second session remains active'
        tokens.clear()
        for _, client in clients:
            client.dispose()
        first.dispose()
        second.dispose()
    result = {'origins': [origin for origin, _ in targets], 'login': True,
              'copiedCookieDeniedAfterLogout': True, 'getAndHeadProtected': True,
              'independentLoginPreserved': True, 'repeatedLogoutSafe': True,
              'crossOriginLogoutDenied': True}
    out = Path(__file__).resolve().parents[1] / 'evidence/auth'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'session-revocation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
except Exception as error:
    # Playwright exceptions may contain request headers; never print them.
    print(type(error).__name__ + ': session security check failed; request details withheld')
    raise SystemExit(1)

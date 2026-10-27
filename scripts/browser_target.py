from urllib.parse import urlsplit, urlunsplit, urljoin


def browser_target(raw):
    """Validate a test origin before collecting credentials or launching Chromium."""
    if any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in raw) or '\\' in raw:
        raise ValueError('Use an HTTPS origin without whitespace or backslashes')
    parts = urlsplit(raw)
    if (parts.scheme != 'https' or not parts.hostname or
            parts.username is not None or parts.password is not None or
            parts.path not in ('', '/') or parts.query or parts.fragment):
        raise ValueError('Use an HTTPS origin without credentials, path, query or fragment')
    port = parts.port  # Reject malformed ports before prompting for a password.
    host = parts.hostname.encode('idna').decode('ascii')
    authority = '[' + host + ']' if ':' in host else host
    if port is not None and port != 443:
        authority += ':' + str(port)
    origin = urlunsplit(('https', authority, '', '', ''))
    local = parts.hostname in ('localhost', '127.0.0.1', '::1')
    return origin, local


def same_origin(url, origin):
    try:
        parts = urlsplit(url)
        return browser_target(urlunsplit((parts.scheme, parts.netloc, '', '', '')))[0] == origin
    except ValueError:
        return False


def browser_context(browser, base, **options):
    origin, local = browser_target(base)
    context = browser.new_context(ignore_https_errors=local, service_workers='block', **options)
    # TLS exceptions are context-wide: block off-origin redirects and requests.
    def guarded_request(route):
        if not same_origin(route.request.url, origin):
            return route.abort()
        # continue_() follows redirect chains without calling this handler again.
        response = route.fetch(max_redirects=0)
        location = response.headers.get('location')
        if 300 <= response.status < 400 and location and not same_origin(urljoin(route.request.url, location), origin):
            return route.abort()
        return route.fulfill(response=response)
    context.route('**/*', guarded_request)
    return context


def require_page_origin(page, origin):
    if not same_origin(page.url, origin):
        raise ValueError('Refusing to enter credentials outside the configured origin')

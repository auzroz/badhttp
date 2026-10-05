#!/usr/bin/env python3
"""Python witnesses for /cookies: urllib (stdlib), requests, httpx, urllib3 (no jar), aiohttp.
One JSON line per (client, flavor) on stdout; progress on stderr. Spec: docs/spec-cookies-witness.md.

The state under test is the client's JAR. For each (client, flavor) a FRESH session and jar:
  1. GET /cookies/{flavor}   the setter, redirects followed (only on-redirect redirects)
  2. GET /cookies/echo       what the jar sent back
  3. GET /cookies/delete     the cleanup
  4. GET /cookies/echo       what survived the cleanup
0.2 s between requests. Every request the client sent during step 1 is counted from inside the client (a urllib
handler, a requests adapter, an httpx event hook, a urllib3 pool subclass, an aiohttp middleware) together with the
number of Set-Cookie headers the client's OWN response API exposed on that hop. A final response without
x-badhttp-version is Cloudflare's rate-limit page, not an observation: the whole flavor is retried after a pause
(attempts <= 3) and recorded as an error only if it never clears. urllib3 has no jar: jar_kind "no-jar", the echo is
sent with no Cookie header, after_delete and jar_entries are null; the four steps still run so hops and the setter
fields are real.

  venv/bin/python scripts/cookies-witness/py-clients.py [base]
  COOKIE_FLAVORS=ok,nameless limits a dry run; a published capture always runs the full list.
"""
import asyncio, base64, json, os, sys, time, platform
import urllib.request, urllib.error, http.cookiejar
from datetime import datetime, timezone

B = sys.argv[1] if len(sys.argv) > 1 else 'https://badhttp.dev'
ALL = ['ok', 'folded', 'many', 'duplicate', 'on-redirect', 'conflicting-expiry', 'bad-expires', 'far-future', 'wrong-domain',
       'public-suffix', 'domain', 'path-prefix', 'name-prefixes', 'quoted', 'utf8', 'nameless', 'huge']
ORDER = os.environ['COOKIE_FLAVORS'].replace(',', ' ').split() if os.environ.get('COOKIE_FLAVORS') else ALL
PY = f'python {platform.python_version()}'
PLAT = f'{sys.platform}/{platform.machine()}'
GAP = 0.2

def emit(base, res):
    print(json.dumps({**base, **res}, ensure_ascii=False), flush=True)

def iso(ts):
    """Epoch seconds -> ISO-8601 UTC instant; None (no expiry) -> "session"; unrepresentable -> null."""
    if ts is None:
        return 'session'
    try:
        return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (OverflowError, OSError, ValueError):
        return None

def blen(s, wire='utf-8'):
    """Length of the value in bytes on the wire. A client hands the harness a str it decoded from the header bytes;
    re-encoding with the codec the client decoded with recovers the wire length (utf-8 for a client that decodes
    UTF-8, latin-1 for http.client, utf-8 + surrogateescape for aiohttp). If the str cannot be re-encoded that way
    the field falls back to the UTF-8 length of the decoded string."""
    if s is None:
        return None
    try:
        return len(s.encode(*(('utf-8', 'surrogateescape') if wire == 'surrogateescape' else (wire,))))
    except (UnicodeEncodeError, LookupError):
        return len(s.encode('utf-8', 'replace'))

def cj_entries(jar, wire='utf-8'):
    """http.cookiejar iteration (urllib, requests, httpx). host_only = the Set-Cookie carried no Domain attribute.
    value_bytes is the wire length per blen(): `wire` is the codec the client decoded the header bytes with."""
    return [{'name': c.name, 'domain': c.domain, 'path': c.path, 'host_only': not c.domain_specified, 'secure': bool(c.secure),
             'expires': iso(c.expires), 'value_bytes': blen(c.value, wire)} for c in jar]

class Resp:
    def __init__(self, status, version, text):
        self.status, self.version, self.text = status, version, text

class Client:
    """Subclasses set self.hops (reset by begin()) and self.last_status from their counting layer."""
    jar_kind = 'own-jar'
    enumerable = True
    def begin(self):
        self.hops = []
    def entries(self):
        return None
    def close(self):
        pass

# --- urllib.request (stdlib) ---------------------------------------------------------------------
class UrllibCounting(urllib.request.BaseHandler):
    """One http(s)_request per request the opener sends (the redirect handler re-enters parent.open per hop);
    order 1 so http_response runs before HTTPCookieProcessor (400) and HTTPErrorProcessor (1000)."""
    handler_order = 1
    def __init__(self, owner):
        self.o = owner
    def http_request(self, req):
        self.o.hops.append({'status': None, 'set_cookie_count': None})
        return req
    https_request = http_request
    def http_response(self, req, resp):
        self.o.last_status = resp.status
        if self.o.hops:
            self.o.hops[-1]['status'] = resp.status
            self.o.hops[-1]['set_cookie_count'] = len(resp.headers.get_all('Set-Cookie') or [])
        return resp
    https_response = http_response

class UrllibClient(Client):
    jar = 'http.cookiejar.CookieJar() default policy (DefaultCookiePolicy, no explicit blocked/allowed domains) behind urllib.request.HTTPCookieProcessor, one fresh jar and opener per flavor; jar_entries[].value_bytes is the wire length (http.client decodes header bytes as latin-1, the harness re-encodes the stored str as latin-1)'
    def __init__(self):
        self.hops, self.last_status = [], None
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(UrllibCounting(self), urllib.request.HTTPCookieProcessor(self.cj))
    def get(self, u):
        self.begin()
        try:
            with self.opener.open(urllib.request.Request(u), timeout=30) as r:
                return Resp(r.status, r.headers.get('x-badhttp-version'), r.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:  # a non-2xx final response is still a response
            return Resp(e.code, e.headers.get('x-badhttp-version'), e.read().decode('utf-8', 'replace'))
    def entries(self):
        return cj_entries(self.cj, 'latin-1')

# --- requests ------------------------------------------------------------------------------------
import requests
from requests.adapters import HTTPAdapter

class RequestsCounting(HTTPAdapter):
    """Sees the original request and every redirect hop (Session.send resolves redirects through the adapter)."""
    def __init__(self, owner):
        super().__init__()
        self.o = owner
    def send(self, request, **kw):
        self.o.hops.append({'status': None, 'set_cookie_count': None})
        resp = super().send(request, **kw)
        self.o.last_status = resp.status_code
        self.o.hops[-1]['status'] = resp.status_code
        self.o.hops[-1]['set_cookie_count'] = len(resp.raw.headers.getlist('Set-Cookie'))
        return resp

class RequestsClient(Client):
    jar = 'requests.Session() default RequestsCookieJar (a http.cookiejar.CookieJar subclass, DefaultCookiePolicy), one fresh Session per flavor; trust_env=False; jar_entries[].value_bytes is the wire length (the response headers come through http.client, which decodes them as latin-1, and the harness re-encodes the stored str as latin-1)'
    def __init__(self):
        self.hops, self.last_status = [], None
        self.s = requests.Session()
        self.s.trust_env = False
        ad = RequestsCounting(self)
        self.s.mount('https://', ad); self.s.mount('http://', ad)
    def get(self, u):
        self.begin()
        r = self.s.get(u, allow_redirects=True, timeout=30)
        return Resp(r.status_code, r.headers.get('x-badhttp-version'), r.text)
    def entries(self):
        return cj_entries(self.s.cookies, 'latin-1')
    def close(self):
        self.s.close()

# --- httpx ---------------------------------------------------------------------------------------
import httpx

class HttpxClient(Client):
    jar = 'httpx.Client() default httpx.Cookies (wraps a http.cookiejar.CookieJar, DefaultCookiePolicy), one fresh Client per flavor; trust_env=False; jar_entries[].value_bytes is the UTF-8 length of the decoded string (httpx decodes header bytes as ASCII, then UTF-8, then latin-1, and does not say which), so it is the wire length only for ASCII or valid UTF-8 values'
    def __init__(self):
        self.hops, self.last_status = [], None
        def on_request(req):
            self.hops.append({'status': None, 'set_cookie_count': None})
        def on_response(resp):
            self.last_status = resp.status_code
            if self.hops:
                self.hops[-1]['status'] = resp.status_code
                self.hops[-1]['set_cookie_count'] = len(resp.headers.get_list('set-cookie'))
        self.c = httpx.Client(follow_redirects=True, timeout=30, trust_env=False,
                              event_hooks={'request': [on_request], 'response': [on_response]})
    def get(self, u):
        self.begin()
        r = self.c.get(u)
        return Resp(r.status_code, r.headers.get('x-badhttp-version'), r.text)
    def entries(self):
        return cj_entries(self.c.cookies.jar)
    def close(self):
        self.c.close()

# --- urllib3 (no jar) ----------------------------------------------------------------------------
import urllib3

class Urllib3Client(Client):
    jar_kind = 'no-jar'
    enumerable = False
    jar = 'none: urllib3.PoolManager() has no cookie jar, so no Cookie header is ever sent and Set-Cookie is only visible on the response'
    def __init__(self):
        self.hops, self.last_status = [], None
        owner = self
        class CountingHTTPSPool(urllib3.HTTPSConnectionPool):
            """Every wire request funnels through _make_request; redirects re-enter urlopen and hit it again."""
            def _make_request(self, conn, method, url, **kw):
                owner.hops.append({'status': None, 'set_cookie_count': None})
                resp = super()._make_request(conn, method, url, **kw)
                owner.last_status = resp.status
                owner.hops[-1]['status'] = resp.status
                owner.hops[-1]['set_cookie_count'] = len(resp.headers.getlist('Set-Cookie'))
                return resp
        self.pm = urllib3.PoolManager(timeout=30)
        self.pm.pool_classes_by_scheme = {'http': urllib3.HTTPConnectionPool, 'https': CountingHTTPSPool}
    def get(self, u):
        self.begin()
        # respect_retry_after_header=False: with the default, urllib3 silently re-sends a 429 that carries Retry-After
        # and the counting pool would record the edge's 429 as a hop of a row that lands. A 429 now comes back as
        # the final response (no x-badhttp-version) and run_flavor retries the flavor, visibly.
        r = self.pm.request('GET', u, redirect=True, retries=urllib3.Retry(total=10, redirect=6, respect_retry_after_header=False))
        return Resp(r.status, r.headers.get('x-badhttp-version'), r.data.decode('utf-8', 'replace'))
    def close(self):
        self.pm.clear()

# --- aiohttp -------------------------------------------------------------------------------------
import aiohttp

class AiohttpClient(Client):
    jar = 'aiohttp.ClientSession() default aiohttp.CookieJar() (unsafe=False, RFC 6265 domain/path matching with its own date parser), one fresh session per flavor; jar_entries[].expires is the jar\'s own recorded expiry (CookieJar._expirations, a private attribute, as an ISO-8601 instant; "session" when the jar recorded none; null if that attribute is missing), never the Morsel\'s Set-Cookie attribute text; value_bytes is the wire length (aiohttp decodes header bytes as UTF-8 with surrogateescape, the harness re-encodes the same way)'
    def __init__(self):
        self.hops, self.last_status = [], None
        self.loop = asyncio.new_event_loop()
        owner = self
        async def counting(request, handler):
            """The innermost middleware runs once per wire request; the redirect loop re-runs the chain per hop."""
            owner.hops.append({'status': None, 'set_cookie_count': None})
            resp = await handler(request)
            owner.last_status = resp.status
            owner.hops[-1]['status'] = resp.status
            owner.hops[-1]['set_cookie_count'] = len(resp.headers.getall('Set-Cookie', []))
            return resp
        async def make():
            return aiohttp.ClientSession(middlewares=(counting,))
        self.s = self.loop.run_until_complete(make())
    def get(self, u):
        self.begin()
        async def go():
            async with self.s.get(u, allow_redirects=True, max_redirects=6, timeout=aiohttp.ClientTimeout(total=30)) as r:
                text = await r.text(errors='replace')
                return Resp(r.status, r.headers.get('x-badhttp-version'), text)
        return self.loop.run_until_complete(go())
    def entries(self):
        """Morsels from the jar. expires is the jar's OWN recorded expiry, not the Morsel's Set-Cookie attribute text
        (which is the header as sent: it can say 1970 or 9999 while the jar acted on Max-Age or a clamp): the entry
        in CookieJar._expirations keyed (domain, path, name), an epoch float, rendered as an ISO-8601 instant;
        "session" when the jar recorded none; null when the jar has no such table (an aiohttp that dropped it).
        host_only from the public CookieJar.host_only_cookies."""
        jar = self.s.cookie_jar
        host_only = jar.host_only_cookies
        table = getattr(jar, '_expirations', None)
        out = []
        for m in jar:
            expires = iso(table.get((m['domain'], m['path'], m.key))) if isinstance(table, dict) else None
            out.append({'name': m.key, 'domain': m['domain'], 'path': m['path'], 'host_only': (m['domain'], m.key) in host_only,
                        'secure': bool(m['secure']), 'expires': expires, 'value_bytes': blen(m.value, 'surrogateescape')})
        return out
    def close(self):
        try:
            self.loop.run_until_complete(self.s.close())
        finally:
            self.loop.close()

# --- the four steps ------------------------------------------------------------------------------
def parse(text):
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except Exception:
        return None

def echo_row(r):
    body = parse(r.text) or {}
    header = body.get('cookie_header')
    header = header if isinstance(header, str) else None
    hb = len(header.encode('utf-8', 'replace')) if header is not None else 0
    cookies = []
    for pair in body.get('cookies') or []:
        try:
            n, v = pair
        except Exception:
            continue
        vb = len(str(v).encode('utf-8', 'replace'))
        cookies.append({'name': n, 'value_bytes': vb, 'value': v if vb <= 48 else None})
    b64 = base64.b64encode(header.encode('utf-8', 'replace')).decode() if header is not None and hb <= 256 else None
    return {'status': r.status, 'cookie_header_bytes': hb, 'cookies': cookies, 'cookie_header_base64': b64}

class NotOracle(Exception):
    pass

def run_flavor(name, mk, transport_errors, base, f):
    u = f'{B}/cookies/{f}'
    base = {**base, 'flavor': f, 'url': u}
    for attempt in (1, 2, 3):
        c = mk()
        hops, last = [], None
        try:
            try:
                r1 = c.get(u); hops = list(c.hops)
                ents = c.entries() if c.enumerable else None  # after step 1, before any cleanup
                time.sleep(GAP); r2 = c.get(f'{B}/cookies/echo')
                time.sleep(GAP); r3 = c.get(f'{B}/cookies/delete')
                time.sleep(GAP); r4 = c.get(f'{B}/cookies/echo')
                last = c.last_status
            except Exception as e:
                is_transport = isinstance(e, transport_errors)
                if not hops:
                    hops = list(c.hops)
                if attempt == 3 or not is_transport:
                    emit(base, {'attempts': attempt, 'hops': hops, 'setter_status': None, 'setter_set': None, 'echo': None,
                                'after_delete': None, 'jar_enumerable': c.enumerable, 'jar_entries': None, 'jar_rejections': [],
                                'version_header': None, 'error_kind': 'transport' if is_transport else 'raised',
                                'client_error': str(e)[:300], 'last_status_seen': c.last_status})
                    print(f'{name} {f} {"FAILED" if is_transport else "raised"}: {type(e).__name__}', file=sys.stderr)
                    break
                time.sleep(12)
                continue
        finally:
            c.close()
        if not all(r.version for r in (r1, r2, r3, r4)):
            if attempt == 3:
                emit(base, {'attempts': attempt, 'hops': hops, 'setter_status': r1.status, 'setter_set': None, 'echo': None,
                            'after_delete': None, 'jar_enumerable': c.enumerable, 'jar_entries': None, 'jar_rejections': [],
                            'version_header': None, 'error_kind': 'transport',
                            'client_error': f'no x-badhttp-version on a response after 3 attempts (statuses {r1.status},{r2.status},{r3.status},{r4.status})',
                            'last_status_seen': last})
                print(f'{name} {f} FAILED: no badhttp response', file=sys.stderr)
            else:
                print(f'{name} {f}: no badhttp response (edge?), retrying', file=sys.stderr)
                time.sleep(12)
            continue
        body1 = parse(r1.text) or {}
        st = body1.get('set')
        emit(base, {'attempts': attempt, 'hops': hops, 'setter_status': r1.status,
                    'setter_set': st if isinstance(st, list) else None,  # a followed on-redirect body is the echo's: no `set`
                    'echo': echo_row(r2),
                    'after_delete': None if c.jar_kind == 'no-jar' else {'status': r4.status, 'names': [x['name'] for x in echo_row(r4)['cookies']]},
                    'jar_enumerable': c.enumerable, 'jar_entries': ents, 'jar_rejections': [],
                    'version_header': r4.version, 'error_kind': None, 'client_error': None, 'last_status_seen': last})
        print(f'{name} {f} ok', file=sys.stderr)
        break
    time.sleep(GAP)

def profile(name, version, invocation, cls, transport_errors):
    base = {'client': name, 'client_version': version, 'platform': PLAT, 'invocation': invocation,
            'jar_kind': cls.jar_kind, 'jar': cls.jar}
    for f in ORDER:
        run_flavor(name, cls, transport_errors, base, f)

profile('urllib', f'{PY} stdlib', 'build_opener(HTTPCookieProcessor(CookieJar()), counting handler).open(Request(url)) x4', UrllibClient,
        (urllib.error.URLError, TimeoutError, ConnectionError))
profile('requests', f'{requests.__version__} ({PY})', 'requests.Session().get(url, allow_redirects=True) x4', RequestsClient,
        (requests.exceptions.ConnectionError, requests.exceptions.Timeout))
profile('httpx', f'{httpx.__version__} ({PY})', 'httpx.Client(follow_redirects=True).get(url) x4', HttpxClient,
        (httpx.TransportError,))
profile('urllib3', f'{urllib3.__version__} ({PY})', 'urllib3.PoolManager().request("GET", url, redirect=True, retries=Retry(total=10, redirect=6, respect_retry_after_header=False)) x4, no jar', Urllib3Client,
        (urllib3.exceptions.HTTPError,))
profile('aiohttp', f'{aiohttp.__version__} ({PY})', 'aiohttp.ClientSession().get(url, allow_redirects=True) x4', AiohttpClient,
        (aiohttp.ClientConnectionError, asyncio.TimeoutError, TimeoutError))

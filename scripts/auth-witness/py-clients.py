#!/usr/bin/env python3
"""Python witnesses for /auth: urllib (stdlib), requests, httpx, urllib3, aiohttp.
One JSON line per (client, flavor) on stdout; progress on stderr.

Each client is handed the family's PUBLISHED FAKE credentials through ITS OWN mechanism for the flavor's
scheme. mechanism_kind names what was CONFIGURED (the vocabulary is shared by every harness); whether the
client then sent credentials first, waited for a challenge, or retried is read from the per-request hops:
  basic-auth      the client's own Basic option/object (requests/httpx/aiohttp BasicAuth, urllib3 make_headers)
  basic-header    a hand-set Authorization: Basic header (undici only; harness-encoded)
  basic-handler   a Basic challenge handler (urllib HTTPBasicAuthHandler)
  digest-handler  a Digest challenge mechanism (urllib HTTPDigestAuthHandler, requests/httpx DigestAuth,
                  aiohttp DigestAuthMiddleware)
  any-handler     picks among the schemes the server offers (urllib with Basic and Digest handlers installed)
  bearer-header   a hand-set Authorization: Bearer header
  no-mechanism    the client has no mechanism for the flavor's scheme; sent with no credentials
The challenge-parser flavors (bare-scheme, unknown-scheme, token68, case, quoted) get the client's
challenge-driven Basic mechanism where one exists (urllib's handler); the others keep their Basic option and the
row says the challenge was never observed. multi gets any-handler where one exists (urllib), else the Digest
mechanism (requests, httpx, aiohttp: it must parse the two-challenge header to answer), else the Basic option.
A fresh session per flavor. Redirects are followed (the redirect flavor's question is whether the credential
follows). Every request the client sent is counted from inside the client (a urllib handler, .history for
requests/httpx, urllib3 retry history, an aiohttp TraceConfig). A final response without x-badhttp-version is
Cloudflare's rate-limit page, not an observation: retried after a pause and recorded as an error only if it
never clears. A client that raises something other than its transport-error type before returning a response
is recorded as error_kind "raised" with the exception class and message (credential-shaped fragments are
scrubbed again by the parser).

  venv/bin/python scripts/auth-witness/py-clients.py [base]
"""
import asyncio, json, sys, time, platform, re
import urllib.request, urllib.error

B = sys.argv[1] if len(sys.argv) > 1 else 'https://badhttp.dev'
# AUTH_FLAVORS=basic,digest limits a dry run; a published capture always runs the full list.
import os
ORDER = [f for f in os.environ['AUTH_FLAVORS'].replace(',', ' ').split()] if os.environ.get('AUTH_FLAVORS') else ['basic', 'bearer', 'digest', 'digest-sha256', 'none', 'bare-scheme', 'unknown-scheme', 'token68', 'multi', 'case', 'quoted', 'utf8', 'always-401', 'accept-any', 'forbidden', 'stale', 'proxy', 'redirect']
PY = f'python {platform.python_version()}'
PLAT = f'{sys.platform}/{platform.machine()}'
USER, PASS, PASS_UTF8, TOKEN = 'agent', 'correct', 'sésame', 'badhttp-token-ok'

PARSER_FLAVORS = ('bare-scheme', 'unknown-scheme', 'token68', 'case', 'quoted')
NOT_OBSERVED = ': the client reads no challenge, so the challenge this flavor sends was never observed by it'
ORIGIN_CREDS = ' (as ORIGIN credentials: no proxy exists in the harness and no proxy credentials were configured; this flavor reads only Proxy-Authorization)'

def scheme_kind(f):
    if f in ('digest', 'digest-sha256', 'stale'): return 'digest'
    if f == 'multi': return 'multi'
    if f in PARSER_FLAVORS: return 'parser'
    if f == 'bearer': return 'bearer'
    if f == 'utf8': return 'basic-utf8'
    if f == 'proxy': return 'proxy'
    return 'basic'

def scrub(s):
    s = re.sub(r'Basic\s+[A-Za-z0-9+/=]{6,}', 'Basic [redacted]', s)
    s = re.sub(r'Bearer\s+\S+', 'Bearer [redacted]', s)
    s = re.sub(r'Digest\s+\S.*', 'Digest [redacted]', s)
    s = re.sub(r'://[^/@\s]+@', '://[redacted]@', s)
    s = s.replace(PASS_UTF8, '[redacted]').replace(f'{USER}:{PASS}', '[redacted]')
    return s[:300]

def emit(base, res):
    print(json.dumps({**base, **res}, ensure_ascii=False), flush=True)

def strip_oracle(body):
    """The oracle body verbatim minus the constant per-flavor prose (warning, hint, credentials): none of it
    is an observation, and the warning alone is 260 bytes on every row."""
    if not isinstance(body, dict):
        return None
    return {k: v for k, v in body.items() if k not in ('warning', 'hint', 'credentials')}

def run_profile(name, version, invocation, plan, fetch, transport_errors):
    """plan(flavor) -> (mechanism_kind, mechanism, config) ; fetch(flavor, url, config) -> dict(final_status,
    requests_made, redirects_followed, final_url, version_header, challenge_seen, body_text)."""
    for f in ORDER:
        u = f'{B}/auth/{f}'
        kind, mech, cfg = plan(f)
        base = {'client': name, 'client_version': version, 'platform': PLAT, 'invocation': invocation,
                'flavor': f, 'url': u, 'mechanism_kind': kind, 'mechanism': mech}
        for attempt in (1, 2, 3):
            try:
                r = fetch(f, u, cfg)
            except Exception as e:
                is_transport = isinstance(e, transport_errors)
                if attempt == 3 or not is_transport:
                    emit(base, {'attempts': attempt, 'requests_made': getattr(e, 'badhttp_requests', None), 'hops': getattr(e, 'badhttp_hops', None), 'final_status': None,
                                'last_status_seen': getattr(e, 'badhttp_last_status', None),
                                'redirects_followed': None, 'final_url': None, 'challenge_seen': getattr(e, 'badhttp_last_challenge', None), 'oracle': None,
                                'version_header': None, 'error_kind': 'transport' if is_transport else 'raised',
                                'client_error': scrub(f'{type(e).__name__}: {e}')})
                    print(f'{name} {f} {"FAILED" if is_transport else "raised"}: {type(e).__name__}', file=sys.stderr)
                    break
                time.sleep(12)
                continue
            try:
                oracle = json.loads(r['body_text'])
            except Exception:
                oracle = None
            if not r['version_header'] or not isinstance(oracle, dict):
                if attempt == 3:
                    emit(base, {'attempts': attempt, 'requests_made': r['requests_made'], 'final_status': r['final_status'],
                                'redirects_followed': r['redirects_followed'], 'final_url': r['final_url'], 'challenge_seen': None,
                                'oracle': None, 'version_header': None, 'error_kind': 'transport',
                                'client_error': f"not an oracle response after 3 attempts (status {r['final_status']})"})
                    print(f'{name} {f} FAILED: no oracle response', file=sys.stderr)
                else:
                    print(f'{name} {f}: no oracle response (edge?), retrying', file=sys.stderr)
                    time.sleep(12)
                continue
            emit(base, {'attempts': attempt, 'requests_made': r['requests_made'], 'hops': r.get('hops'), 'final_status': r['final_status'],
                        'redirects_followed': r['redirects_followed'], 'final_url': r['final_url'],
                        'challenge_seen': r['challenge_seen'], 'oracle': strip_oracle(oracle),
                        'version_header': r['version_header'], 'error_kind': None, 'client_error': None})
            print(f'{name} {f} ok', file=sys.stderr)
            break
        time.sleep(1.2)

def challenge_of(headers):
    for k in ('www-authenticate', 'proxy-authenticate'):
        v = headers.get(k)
        if v:
            return v
    return None

# --- urllib.request (stdlib) ---------------------------------------------------------------------
class Counting(urllib.request.BaseHandler):
    """One *_request call per request the opener sends (the auth handlers and the redirect handler re-enter
    parent.open for each retry). Records header PRESENCE only, never a value; get_header reads the handler-added
    unredirected headers too."""
    handler_order = 1
    def __init__(self):
        self.n = 0
        self.hops = []
    def http_request(self, req):
        self.n += 1
        self.hops.append({'status': None, 'authorization': req.get_header('Authorization') is not None, 'proxy_authorization': req.get_header('Proxy-authorization') is not None})
        return req
    https_request = http_request
    def http_response(self, req, resp):
        if self.hops and self.hops[-1]['status'] is None:
            self.hops[-1]['status'] = resp.status
        return resp
    https_response = http_response

class LastSeen(urllib.request.BaseHandler):
    """Sees every response before HTTPErrorProcessor hands non-2xx to the error chain, so the 401 behind a
    ValueError (unknown-scheme) is still on record. Never reads the body."""
    handler_order = 999
    def __init__(self):
        self.status, self.challenge = None, None
    def http_response(self, req, resp):
        self.status, self.challenge = resp.status, challenge_of(resp.headers)
        return resp
    https_response = http_response

class CountingRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        super().__init__()
        self.hops = 0
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def plan_urllib(f):
    k = scheme_kind(f)
    if k in ('basic', 'parser'):
        return 'basic-handler', 'HTTPBasicAuthHandler over HTTPPasswordMgrWithDefaultRealm (the documented credentials): a challenge handler that answers a Basic 401', ('basic', PASS)
    if k == 'proxy':
        return 'basic-handler', 'HTTPBasicAuthHandler over HTTPPasswordMgrWithDefaultRealm (the documented credentials)' + ORIGIN_CREDS + '; no ProxyBasicAuthHandler was installed', ('basic', PASS)
    if k == 'basic-utf8':
        return 'basic-handler', 'HTTPBasicAuthHandler with the documented utf8 credentials: the handler encodes user:password with str.encode(), i.e. UTF-8', ('basic', PASS_UTF8)
    if k == 'digest':
        return 'digest-handler', 'HTTPDigestAuthHandler over HTTPPasswordMgrWithDefaultRealm (the documented credentials): a challenge handler that answers a Digest 401', ('digest', PASS)
    if k == 'multi':
        return 'any-handler', 'HTTPBasicAuthHandler and HTTPDigestAuthHandler both installed on one opener (the documented credentials): the opener asks its handlers in handler_order and the first to accept the challenge answers', ('both', PASS)
    return 'bearer-header', 'a hand-set Authorization: Bearer header (the documented test token): urllib has no Bearer handler', ('bearer', None)

def fetch_urllib(f, u, cfg):
    mode, pw = cfg
    counter, redir, last = Counting(), CountingRedirect(), LastSeen()
    handlers = [counter, redir, last]
    if mode in ('basic', 'digest', 'both'):
        pm = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        pm.add_password(None, B, USER, pw)
        if mode in ('basic', 'both'):
            handlers.append(urllib.request.HTTPBasicAuthHandler(pm))
        if mode in ('digest', 'both'):
            handlers.append(urllib.request.HTTPDigestAuthHandler(pm))
    opener = urllib.request.build_opener(*handlers)
    headers = {'Authorization': f'Bearer {TOKEN}'} if mode == 'bearer' else {}
    req = urllib.request.Request(u, headers=headers)
    try:
        with opener.open(req, timeout=30) as resp:
            return {'final_status': resp.status, 'requests_made': counter.n, 'hops': counter.hops, 'redirects_followed': redir.hops, 'final_url': resp.geturl(),
                    'version_header': resp.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(resp.headers), 'body_text': resp.read().decode('utf-8', 'replace')}
    except urllib.error.HTTPError as e:  # a non-2xx final response is still a response
        return {'final_status': e.code, 'requests_made': counter.n, 'hops': counter.hops, 'redirects_followed': redir.hops, 'final_url': e.geturl(),
                'version_header': e.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(e.headers), 'body_text': e.read().decode('utf-8', 'replace')}
    except Exception as e:
        e.badhttp_requests = counter.n
        e.badhttp_hops = counter.hops
        e.badhttp_last_status, e.badhttp_last_challenge = last.status, last.challenge
        raise

run_profile('urllib', f'{PY} stdlib', 'build_opener(<auth handler(s)>, HTTPRedirectHandler, counting handler).open(Request(url))', plan_urllib, fetch_urllib,
            (urllib.error.URLError, TimeoutError, ConnectionError))

# --- requests ------------------------------------------------------------------------------------
import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
from requests.adapters import HTTPAdapter

class CountingAdapter(HTTPAdapter):
    """Sees the original request, every redirect hop and the Digest retry (auth.py sends the retry through
    r.connection, which is this adapter). Presence only, never a value."""
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.hops = []
    def send(self, request, **kwargs):
        self.hops.append({'status': None, 'authorization': 'Authorization' in request.headers, 'proxy_authorization': 'Proxy-Authorization' in request.headers})
        resp = super().send(request, **kwargs)
        self.hops[-1]['status'] = resp.status_code
        return resp

def plan_requests(f):
    k = scheme_kind(f)
    if k == 'basic':
        return 'basic-auth', 'auth=HTTPBasicAuth (the documented credentials): requests\' own Basic auth object', ('basic', PASS)
    if k == 'parser':
        return 'basic-auth', 'auth=HTTPBasicAuth (the documented credentials): requests has no challenge-driven Basic mechanism' + NOT_OBSERVED, ('basic', PASS)
    if k == 'proxy':
        return 'basic-auth', 'auth=HTTPBasicAuth (the documented credentials)' + ORIGIN_CREDS, ('basic', PASS)
    if k == 'basic-utf8':
        return 'basic-auth', 'auth=HTTPBasicAuth with the documented utf8 credentials: requests encodes a str password with .encode("latin1")', ('basic', PASS_UTF8)
    if k == 'digest':
        return 'digest-handler', 'auth=HTTPDigestAuth (the documented credentials): requests\' Digest auth object, a fresh instance per row', ('digest', PASS)
    if k == 'multi':
        return 'digest-handler', 'auth=HTTPDigestAuth (the documented credentials): requests has no mechanism that chooses among offered schemes, so its Digest object, which must parse the two-challenge header, was handed the choice', ('digest', PASS)
    return 'bearer-header', 'a hand-set Authorization: Bearer header (the documented test token): requests has no Bearer auth class', ('bearer', None)

def fetch_requests(f, u, cfg):
    mode, pw = cfg
    auth = HTTPBasicAuth(USER, pw) if mode == 'basic' else HTTPDigestAuth(USER, pw) if mode == 'digest' else None
    headers = {'Authorization': f'Bearer {TOKEN}'} if mode == 'bearer' else {}
    with requests.Session() as s:
        s.trust_env = False  # no ambient proxy/netrc
        ad = CountingAdapter()
        s.mount('https://', ad); s.mount('http://', ad)
        r = s.get(u, auth=auth, headers=headers, allow_redirects=True, timeout=30)
        hops = sum(1 for h in r.history if 300 <= h.status_code < 400)
        return {'final_status': r.status_code, 'requests_made': len(ad.hops), 'hops': ad.hops, 'redirects_followed': hops, 'final_url': r.url,
                'version_header': r.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(r.headers), 'body_text': r.text}

run_profile('requests', f'{requests.__version__} ({PY})', 'requests.Session().get(url, auth=<mechanism>, allow_redirects=True)', plan_requests, fetch_requests,
            (requests.exceptions.ConnectionError, requests.exceptions.Timeout))

# --- httpx ---------------------------------------------------------------------------------------
import httpx

def plan_httpx(f):
    k = scheme_kind(f)
    if k == 'basic':
        return 'basic-auth', 'auth=httpx.BasicAuth (the documented credentials): httpx\'s own Basic auth object', ('basic', PASS)
    if k == 'parser':
        return 'basic-auth', 'auth=httpx.BasicAuth (the documented credentials): httpx has no challenge-driven Basic mechanism' + NOT_OBSERVED, ('basic', PASS)
    if k == 'proxy':
        return 'basic-auth', 'auth=httpx.BasicAuth (the documented credentials)' + ORIGIN_CREDS, ('basic', PASS)
    if k == 'basic-utf8':
        return 'basic-auth', 'auth=httpx.BasicAuth with the documented utf8 credentials: httpx encodes with to_bytes(), i.e. UTF-8', ('basic', PASS_UTF8)
    if k == 'digest':
        return 'digest-handler', 'auth=httpx.DigestAuth (the documented credentials): httpx\'s Digest auth object, a fresh instance per row', ('digest', PASS)
    if k == 'multi':
        return 'digest-handler', 'auth=httpx.DigestAuth (the documented credentials): httpx has no mechanism that chooses among offered schemes, so its Digest object, which must parse the two-challenge header, was handed the choice', ('digest', PASS)
    return 'bearer-header', 'a hand-set Authorization: Bearer header (the documented test token): httpx has no Bearer auth class', ('bearer', None)

def fetch_httpx(f, u, cfg):
    mode, pw = cfg
    auth = httpx.BasicAuth(USER, pw) if mode == 'basic' else httpx.DigestAuth(USER, pw) if mode == 'digest' else None
    headers = {'Authorization': f'Bearer {TOKEN}'} if mode == 'bearer' else {}
    sent = []
    def on_request(req):
        sent.append({'status': None, 'authorization': 'authorization' in req.headers, 'proxy_authorization': 'proxy-authorization' in req.headers})
    def on_response(resp):
        if sent and sent[-1]['status'] is None:
            sent[-1]['status'] = resp.status_code
    with httpx.Client(follow_redirects=True, timeout=30, trust_env=False, event_hooks={'request': [on_request], 'response': [on_response]}) as c:
        r = c.get(u, auth=auth, headers=headers)
        hops = sum(1 for h in r.history if 300 <= h.status_code < 400)
        return {'final_status': r.status_code, 'requests_made': len(sent), 'hops': sent, 'redirects_followed': hops, 'final_url': str(r.url),
                'version_header': r.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(r.headers), 'body_text': r.text}

run_profile('httpx', f'{httpx.__version__} ({PY})', 'httpx.Client(follow_redirects=True).get(url, auth=<mechanism>)', plan_httpx, fetch_httpx,
            (httpx.TransportError,))

# --- urllib3 -------------------------------------------------------------------------------------
import urllib3

def plan_urllib3(f):
    k = scheme_kind(f)
    if k == 'basic':
        return 'basic-auth', 'headers=make_headers(basic_auth=...) (the documented credentials): urllib3\'s own Basic helper', ('basic', PASS)
    if k in ('parser', 'multi'):
        return 'basic-auth', 'headers=make_headers(basic_auth=...) (the documented credentials): urllib3 has no challenge handling of any kind' + NOT_OBSERVED, ('basic', PASS)
    if k == 'proxy':
        return 'basic-auth', 'headers=make_headers(basic_auth=...) (the documented credentials)' + ORIGIN_CREDS, ('basic', PASS)
    if k == 'basic-utf8':
        return 'basic-auth', 'headers=make_headers(basic_auth=...) with the documented utf8 credentials: encoded with make_headers\'s default basic_auth_encoding, latin-1', ('basic', PASS_UTF8)
    if k == 'digest':
        return 'no-mechanism', 'urllib3 has no Digest mechanism (no challenge handling of any kind); the request was sent with no credentials', ('none', None)
    return 'bearer-header', 'a hand-set Authorization: Bearer header (the documented test token)', ('bearer', None)

class CountingHTTPSPool(urllib3.HTTPSConnectionPool):
    """Every wire request funnels through _make_request; redirects re-enter urlopen and hit it again. Presence only."""
    hops = []
    def _make_request(self, conn, method, url, **kw):
        h = {str(k).lower() for k in (kw.get('headers') or {})}
        CountingHTTPSPool.hops.append({'status': None, 'authorization': 'authorization' in h, 'proxy_authorization': 'proxy-authorization' in h})
        resp = super()._make_request(conn, method, url, **kw)
        CountingHTTPSPool.hops[-1]['status'] = resp.status
        return resp

def fetch_urllib3(f, u, cfg):
    mode, pw = cfg
    headers = urllib3.make_headers(basic_auth=f'{USER}:{pw}') if mode == 'basic' else {'Authorization': f'Bearer {TOKEN}'} if mode == 'bearer' else {}
    CountingHTTPSPool.hops = []
    http = urllib3.PoolManager(timeout=30)
    http.pool_classes_by_scheme = {'http': urllib3.HTTPConnectionPool, 'https': CountingHTTPSPool}
    r = http.request('GET', u, headers=headers, redirect=True, retries=urllib3.Retry(total=10, redirect=6))
    hops = sum(1 for x in (r.retries.history if r.retries else ()) if x.redirect_location)
    # r.url after a redirect is the raw Location ('/auth/basic', relative); derive the absolute final url from the hops.
    from urllib.parse import urljoin
    final_url = u
    for x in (r.retries.history if r.retries else ()):
        if x.redirect_location:
            final_url = urljoin(final_url, x.redirect_location)
    return {'final_status': r.status, 'requests_made': len(CountingHTTPSPool.hops), 'hops': list(CountingHTTPSPool.hops), 'redirects_followed': hops, 'final_url': final_url,
            'version_header': r.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(r.headers), 'body_text': r.data.decode('utf-8', 'replace')}

run_profile('urllib3', f'{urllib3.__version__} ({PY})', 'urllib3.PoolManager().request("GET", url, headers=<mechanism>, redirect=True)', plan_urllib3, fetch_urllib3,
            (urllib3.exceptions.HTTPError,))

# --- aiohttp -------------------------------------------------------------------------------------
import aiohttp

def plan_aiohttp(f):
    k = scheme_kind(f)
    if k == 'basic':
        return 'basic-auth', 'auth=aiohttp.BasicAuth (the documented credentials): aiohttp\'s own Basic auth object (deprecated in 3.14 in favour of encode_basic_auth() plus a header; still the documented mechanism)', ('basic', PASS)
    if k == 'parser':
        return 'basic-auth', 'auth=aiohttp.BasicAuth (the documented credentials): aiohttp has no challenge-driven Basic mechanism' + NOT_OBSERVED, ('basic', PASS)
    if k == 'proxy':
        return 'basic-auth', 'auth=aiohttp.BasicAuth (the documented credentials)' + ORIGIN_CREDS, ('basic', PASS)
    if k == 'basic-utf8':
        return 'basic-auth', 'auth=aiohttp.BasicAuth with the documented utf8 credentials: BasicAuth\'s default encoding is latin1 (encode_basic_auth() defaults to UTF-8)', ('basic', PASS_UTF8)
    if k == 'digest':
        return 'digest-handler', 'middlewares=(aiohttp.DigestAuthMiddleware(...),) (the documented credentials): aiohttp\'s Digest middleware, a fresh instance per row (preemptive=True by default, but a fresh instance holds no nonce)', ('digest', PASS)
    if k == 'multi':
        return 'digest-handler', 'middlewares=(aiohttp.DigestAuthMiddleware(...),) (the documented credentials): aiohttp has no mechanism that chooses among offered schemes, so its Digest middleware, which must parse the two-challenge header, was handed the choice', ('digest', PASS)
    return 'bearer-header', 'a hand-set Authorization: Bearer header (the documented test token): aiohttp has no Bearer auth class', ('bearer', None)

import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)  # aiohttp 3.14 deprecates BasicAuth/auth=; the mechanism string records it

class CountingMiddleware:
    """TraceConfig.on_request_start fires once per session.get(), not per wire request, so neither a redirect nor
    the Digest middleware's retry would be counted. The innermost middleware is called once per wire request
    (the Digest middleware wraps it; the redirect loop re-runs the chain per hop). Presence only, never a value."""
    def __init__(self):
        self.hops = []
    async def __call__(self, request, handler):
        self.hops.append({'status': None, 'authorization': 'Authorization' in request.headers, 'proxy_authorization': 'Proxy-Authorization' in request.headers})
        resp = await handler(request)
        self.hops[-1]['status'] = resp.status
        return resp

def fetch_aiohttp(f, u, cfg):
    mode, pw = cfg
    async def go():
        cnt = CountingMiddleware()
        mws = ((aiohttp.DigestAuthMiddleware(USER, pw),) if mode == 'digest' else ()) + (cnt,)
        async with aiohttp.ClientSession(middlewares=mws) as s:
            auth = aiohttp.BasicAuth(USER, pw) if mode == 'basic' else None
            headers = {'Authorization': f'Bearer {TOKEN}'} if mode == 'bearer' else {}
            async with s.get(u, auth=auth, headers=headers, allow_redirects=True, max_redirects=6, timeout=aiohttp.ClientTimeout(total=30)) as r:
                text = await r.text()
                return {'final_status': r.status, 'requests_made': len(cnt.hops), 'hops': cnt.hops, 'redirects_followed': len(r.history), 'final_url': str(r.url),
                        'version_header': r.headers.get('x-badhttp-version'), 'challenge_seen': challenge_of(r.headers), 'body_text': text}
    return asyncio.run(go())

run_profile('aiohttp', f'{aiohttp.__version__} ({PY})', 'aiohttp.ClientSession(<mechanism>).get(url, allow_redirects=True)', plan_aiohttp, fetch_aiohttp,
            (aiohttp.ClientConnectionError, asyncio.TimeoutError, TimeoutError))

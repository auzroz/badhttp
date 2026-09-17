#!/usr/bin/env python3
"""Python witnesses for /crosshost: urllib (stdlib), requests, httpx, urllib3, aiohttp.
One JSON line per (client, flavor) on stdout; progress on stderr.

Sends the family's PUBLISHED FAKE test values only. A fresh session (and jar, where the library has
one) per flavor. On the `jar` flavor the hand-set Cookie header is omitted so the jar, not the
header, is what is measured; urllib3 has no jar and undici-style behaviour is recorded as such.
A final response without x-badhttp-version is Cloudflare's rate-limit page, not an observation: it is
retried after a pause and recorded as an error only if it never clears.

  venv/bin/python scripts/crosshost-witness/py-clients.py [base]
"""
import asyncio, json, sys, time, platform
import urllib.request, urllib.error
from http.cookiejar import CookieJar

B = sys.argv[1] if len(sys.argv) > 1 else 'https://badhttp.dev'
BASIC = 'Basic YWdlbnQ6Y29ycmVjdA=='
APIKEY = 'badhttp-key-ok'
COOKIE = 'badhttp_witness=1'
PY = f'python {platform.python_version()}'
PLAT = f'{sys.platform}/{platform.machine()}'

with urllib.request.urlopen(B + '/crosshost', timeout=30) as r:
    IDX = json.load(r)
FLAVORS = [(k, v['url']) for k, v in IDX['flavors'].items()]

def headers_for(f):
    h = {'Authorization': BASIC, 'X-Api-Key': APIKEY}
    if f != 'jar':
        h['Cookie'] = COOKIE
    return h

def sent_for(f, jar_desc):
    return {'authorization': 'Basic (documented test value)', 'cookie': None if f == 'jar' else COOKIE,
            'x_api_key': 'documented test value', 'jar': jar_desc}

def emit(base, res):
    print(json.dumps({**base, **res}), flush=True)

def run_profile(name, version, invocation, jar_desc, fetch):
    """fetch(flavor, url, headers) -> dict(final_status, hops_followed, final_url, version_header, body_text)
    or raises. Retries the edge case (no version header / not the oracle) up to 3 times."""
    for f, u in FLAVORS:
        base = {'client': name, 'client_version': version, 'platform': PLAT, 'invocation': invocation,
                'flavor': f, 'start_url': u, 'sent': sent_for(f, jar_desc)}
        for attempt in (1, 2, 3):
            try:
                r = fetch(f, u, headers_for(f))
            except Exception as e:  # the client raised before a usable response
                if attempt == 3:
                    emit(base, {'attempts': attempt, 'final_status': None, 'hops_followed': None, 'final_url': None, 'landed_on': None,
                                'received': None, 'version_header': None, 'client_error': f'{type(e).__name__}: {e}'[:300]})
                    print(f'{name} {f} FAILED: {type(e).__name__}: {e}', file=sys.stderr)
                else:
                    time.sleep(12)
                continue
            try:
                oracle = json.loads(r['body_text'])
            except Exception:
                oracle = None
            if not r['version_header'] or not oracle or not oracle.get('landed_on'):
                if attempt == 3:
                    emit(base, {'attempts': attempt, 'final_status': r['final_status'], 'hops_followed': r['hops_followed'], 'final_url': r['final_url'],
                                'landed_on': None, 'received': None, 'version_header': None,
                                'client_error': f"not an oracle response after 3 attempts (status {r['final_status']})"})
                    print(f'{name} {f} FAILED: no oracle response', file=sys.stderr)
                else:
                    print(f'{name} {f}: no oracle response (edge?), retrying', file=sys.stderr)
                    time.sleep(12)
                continue
            emit(base, {'attempts': attempt, 'final_status': r['final_status'], 'hops_followed': r['hops_followed'], 'final_url': r['final_url'],
                        'landed_on': oracle['landed_on'], 'port': oracle.get('port'), 'scheme': oracle.get('scheme'),
                        'transport_was_encrypted': oracle.get('transport_was_encrypted'), 'received': oracle['received'],
                        'matches': oracle.get('matches_documented_test_credential'), 'version_header': r['version_header'],
                        'client_error': None})
            print(f'{name} {f} ok', file=sys.stderr)
            break
        time.sleep(1.2)

# --- urllib.request (stdlib) ---------------------------------------------------------------------
class CountingRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        super().__init__()
        self.hops = 0
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch_urllib(f, u, h):
    counter = CountingRedirect()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()), counter)
    req = urllib.request.Request(u, headers=h)
    try:
        with opener.open(req, timeout=30) as resp:
            return {'final_status': resp.status, 'hops_followed': counter.hops, 'final_url': resp.geturl(),
                    'version_header': resp.headers.get('x-badhttp-version'), 'body_text': resp.read().decode('utf-8', 'replace')}
    except urllib.error.HTTPError as e:  # a non-2xx final response is still a response
        return {'final_status': e.code, 'hops_followed': counter.hops, 'final_url': e.geturl(),
                'version_header': e.headers.get('x-badhttp-version'), 'body_text': e.read().decode('utf-8', 'replace')}

run_profile('urllib', f'{PY} stdlib', 'build_opener(HTTPCookieProcessor(CookieJar()), HTTPRedirectHandler).open',
            'enabled: http.cookiejar.CookieJar via HTTPCookieProcessor (empty)', fetch_urllib)

# --- requests ------------------------------------------------------------------------------------
import requests
def fetch_requests(f, u, h):
    with requests.Session() as s:
        r = s.get(u, headers=h, allow_redirects=True, timeout=30)
        return {'final_status': r.status_code, 'hops_followed': len(r.history), 'final_url': r.url,
                'version_header': r.headers.get('x-badhttp-version'), 'body_text': r.text}
run_profile('requests', f'{requests.__version__} ({PY})', 'requests.Session().get(allow_redirects=True)',
            'enabled: the Session cookie jar (empty)', fetch_requests)

# --- httpx ---------------------------------------------------------------------------------------
import httpx
def fetch_httpx(f, u, h):
    with httpx.Client(follow_redirects=True, timeout=30) as c:
        r = c.get(u, headers=h)
        return {'final_status': r.status_code, 'hops_followed': len(r.history), 'final_url': str(r.url),
                'version_header': r.headers.get('x-badhttp-version'), 'body_text': r.text}
run_profile('httpx', f'{httpx.__version__} ({PY})', 'httpx.Client(follow_redirects=True).get',
            'enabled: the Client cookie jar (empty)', fetch_httpx)

# --- urllib3 -------------------------------------------------------------------------------------
import urllib3
def fetch_urllib3(f, u, h):
    http = urllib3.PoolManager(timeout=30)
    r = http.request('GET', u, headers=h, redirect=True, retries=urllib3.Retry(total=10, redirect=6))
    hops = sum(1 for x in (r.retries.history if r.retries else ()) if x.redirect_location)
    return {'final_status': r.status, 'hops_followed': hops, 'final_url': r.url,
            'version_header': r.headers.get('x-badhttp-version'), 'body_text': r.data.decode('utf-8', 'replace')}
run_profile('urllib3', f'{urllib3.__version__} ({PY})', 'urllib3.PoolManager().request(redirect=True, retries=Retry(redirect=6))',
            'none (urllib3 has no cookie jar)', fetch_urllib3)

# --- aiohttp -------------------------------------------------------------------------------------
import aiohttp
def fetch_aiohttp(f, u, h):
    async def go():
        async with aiohttp.ClientSession() as s:
            async with s.get(u, headers=h, allow_redirects=True, max_redirects=6) as r:
                text = await r.text()
                return {'final_status': r.status, 'hops_followed': len(r.history), 'final_url': str(r.url),
                        'version_header': r.headers.get('x-badhttp-version'), 'body_text': text}
    return asyncio.run(go())
run_profile('aiohttp', f'{aiohttp.__version__} ({PY})', 'aiohttp.ClientSession().get(allow_redirects=True)',
            'enabled: the ClientSession cookie jar (empty)', fetch_aiohttp)

# Witness: Python clients with their defaults — urllib (stdlib, never decodes), requests (urllib3 decoder),
# httpx (own decoders). Each line: flavor | status | ce seen | bytes/declared | SHA verdict | error.
import hashlib, sys, time, urllib.request, urllib.error, json
B = sys.argv[1] if len(sys.argv) > 1 else 'https://badhttp.dev'
FLAVORS = ['ok','br','zstd','deflate','not-compressed','undeclared','truncated','corrupt','bad-crc','trailing-garbage','multi-member','double','double-hidden','deflate-raw','unknown-coding','uppercase','x-gzip','empty','wrong-length','gzip-file','bomb']

def verdict(body, headers):
    want = headers.get('x-badhttp-plain-sha256'); want_len = headers.get('x-badhttp-plain-bytes')
    n = len(body)
    if want:
        ok = hashlib.sha256(body).hexdigest() == want
        return f"bytes={n}/{want_len}", 'SHA-OK' if ok else f"sha-DIFF(first={body[:2].hex()})"
    return f"bytes={n}/{want_len}", 'LEN-OK' if str(n) == str(want_len) else 'len-DIFF'

def run_urllib():
    print('## urllib.request (stdlib; sends no Accept-Encoding, never decodes)')
    for f in FLAVORS:
        try:
            with urllib.request.urlopen(f"{B}/compress/{f}", timeout=30) as r:
                h = {k.lower(): v for k, v in r.headers.items()}
                body = r.read()
                b, v = verdict(body, h)
                print(f"{f} | {r.status} | ce=[{h.get('content-encoding','')}] | {b} | {v} | no-error")
        except Exception as e:
            print(f"{f} | error: {type(e).__name__}: {str(e)[:90]}")
        time.sleep(0.3)

def run_urllib_gzip():
    print('## urllib.request with Accept-Encoding: gzip set by hand (raw bytes, no decoding)')
    for f in FLAVORS:
        try:
            req = urllib.request.Request(f"{B}/compress/{f}", headers={'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(req, timeout=30) as r:
                h = {k.lower(): v for k, v in r.headers.items()}
                body = r.read()
                b, v = verdict(body, h)
                print(f"{f} | {r.status} | ce=[{h.get('content-encoding','')}] | {b} | {v} | no-error")
        except Exception as e:
            print(f"{f} | error: {type(e).__name__}: {str(e)[:90]}")
        time.sleep(0.3)

def run_requests():
    try:
        import requests
    except ImportError:
        print('## requests: not installed'); return
    print(f"## requests {requests.__version__} (urllib3 decoder; default Accept-Encoding: {requests.utils.default_headers().get('Accept-Encoding')})")
    for f in FLAVORS:
        try:
            r = requests.get(f"{B}/compress/{f}", timeout=30)
            h = {k.lower(): v for k, v in r.headers.items()}
            body = r.content
            b, v = verdict(body, h)
            print(f"{f} | {r.status_code} | ce=[{h.get('content-encoding','')}] | {b} | {v} | no-error")
        except Exception as e:
            print(f"{f} | error: {type(e).__name__}: {str(e)[:110]}")
        time.sleep(0.3)

def run_httpx():
    try:
        import httpx
    except ImportError:
        print('## httpx: not installed'); return
    print(f"## httpx {httpx.__version__} (own decoders; default Accept-Encoding: {httpx.Client().headers.get('accept-encoding')})")
    with httpx.Client(timeout=30) as c:
        for f in FLAVORS:
            try:
                r = c.get(f"{B}/compress/{f}")
                h = {k.lower(): v for k, v in r.headers.items()}
                body = r.content
                b, v = verdict(body, h)
                print(f"{f} | {r.status_code} | ce=[{h.get('content-encoding','')}] | {b} | {v} | no-error")
            except Exception as e:
                print(f"{f} | error: {type(e).__name__}: {str(e)[:110]}")
            time.sleep(0.3)

which = sys.argv[2] if len(sys.argv) > 2 else 'all'
if which in ('all', 'urllib'): run_urllib()
if which in ('all', 'urllib-gzip'): run_urllib_gzip()
if which in ('all', 'requests'): run_requests()
if which in ('all', 'httpx'): run_httpx()

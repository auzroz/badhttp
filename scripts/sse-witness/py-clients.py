#!/usr/bin/env python3
"""Python witnesses for /sse: httpx-sse (over httpx), sseclient-py (over requests), aiohttp-sse-client (over aiohttp).
One JSON line per (client, flavor) on stdout; progress on stderr. Spec: docs/spec-sse-witness.md.

For each (client, flavor) a FRESH client or session is pointed at GET /sse/{flavor} with default parameters over
HTTP/1.1 (httpx http2=False; requests and aiohttp speak nothing else), and the harness records, from outside the
library: every connection it opened (counted at a layer each row names: an httpx event hook, a requests
HTTPAdapter, an aiohttp TraceConfig), every event it delivered to the caller, every error it surfaced, how the row
ended from the caller's side, and the retry value and last event id the library exposes.

Two classes, assigned by reading each installed library's source (see the comment above each client):
  one-shot     httpx-sse, sseclient-py: iterate ONE response and return; no reconnection anywhere in the package
  eventsource  aiohttp-sse-client: reconnects by itself after the server closes (sleeps, then sends Last-Event-Id)
An eventsource-class library is cancelled by the harness the moment it signals the end of its FIRST connection
(end "reconnecting"), except on /sse/resume, where it is let run until the 204 stops it (end "stopped") or six
connections have opened. Every row has a 30 s wall cap enforced here (end "harness-timeout"). A response whose first
connection lacks x-badhttp-version is Cloudflare's rate limit, not an observation: the row is run again after a 12 s
pause (attempts <= 3), and a request-failed row is written only if it never clears. 1 s between rows, 3 s between
clients, never alongside scripts/smoke.sh (one IP, one zone rate limit).

  venv/bin/python scripts/sse-witness/py-clients.py [base]
  SSE_FLAVORS="ok cut" limits a dry run; a published capture always runs the full list.
"""
import asyncio, contextlib, hashlib, importlib.metadata as md, json, logging, os, platform, re, signal, sys, time
from datetime import datetime, timezone
from urllib.parse import urlsplit

B = (sys.argv[1] if len(sys.argv) > 1 else 'https://badhttp.dev').rstrip('/')
BASE_HOST = urlsplit(B).hostname or ''
ALL = ['ok', 'stall', 'cut', 'drop', 'crlf', 'cr', 'no-space', 'multiline', 'comments', 'split-utf8', 'wrong-type',
       'error-event', 'big', 'resume']
ORDER = os.environ['SSE_FLAVORS'].replace(',', ' ').split() if os.environ.get('SSE_FLAVORS') else ALL
CAP = 30.0          # per-row wall cap, seconds
ROW_GAP = 1.0       # between rows
CLIENT_GAP = 3.0    # between clients
RETRY_PAUSE = 12    # before re-running a row that did not reach badhttp
MAX_CONNS = 6       # an eventsource-class library on resume is stopped after this many connections
PLAT = f'python {platform.python_version()} on {sys.platform}/{platform.machine()}'
STATES = {0: 'connecting', 1: 'open', 2: 'closed'}  # aiohttp-sse-client READY_STATE_* mapped to the WHATWG names

unknown = [f for f in ORDER if f not in ALL]
if unknown:
    sys.exit(f'unknown flavor(s) in SSE_FLAVORS: {" ".join(unknown)}')

def log(msg):
    print(msg, file=sys.stderr, flush=True)

def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

# --- what may reach a row ---------------------------------------------------------------------------------------
_PATH = re.compile(r'(?:[A-Za-z]:\\\S*)|(?:/(?:Users|home|private|tmp|var|opt|usr|Volumes|etc|Library|root|mnt|nix)/\S*)')
_IP4 = re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}\b')
_IP6 = re.compile(r'(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{0,4}')
_URLHOST = re.compile(r'(https?://)([A-Za-z0-9.\-]+)')
# the verdict words docs/spec-sse-witness.md bans (scripts/witness-parse-sse.mjs refuses a row carrying any of them)
_WORDS = re.compile(r'\b(correctly|incorrectly|conformant|non-?compliant|violates|buggy|broken client|wrong client|passes|fails the spec)\b', re.I)
_LEAK = re.compile(r'/(?:Users|home|private|tmp|var|opt|usr|Volumes|etc|Library|root|mnt|nix)/|site-packages|venv|localhost|[A-Za-z]:\\\\', re.I)

def sanitize(msg, limit=200):
    """An error message safe to publish: no filesystem paths, no addresses, no hostname but the target's, <= 200 chars."""
    m = str(msg)
    m = _PATH.sub('<path>', m)
    m = _URLHOST.sub(lambda g: g.group(0) if g.group(2) == BASE_HOST else g.group(1) + '<host>', m)
    m = _IP4.sub('<ip>', m)
    m = _IP6.sub('<ip>', m)
    m = _WORDS.sub('[word]', m)
    m = re.sub(r'\s+', ' ', m).strip()
    return m[:limit]

def describe(e):
    m = str(e).strip()
    return sanitize(f'{type(e).__name__}: {m}' if m else type(e).__name__)

def emit(row):
    s = json.dumps(row, ensure_ascii=False, separators=(',', ':'))
    hosts = {h for _, h in _URLHOST.findall(s)}
    if _LEAK.search(s) or _WORDS.search(s) or (hosts - {BASE_HOST}):
        log(f'REFUSED: row {row.get("id")} carries a path, a foreign host or a banned word')
        sys.exit(3)
    print(s, flush=True)

# --- one row's observations --------------------------------------------------------------------------------------
class Obs:
    def __init__(self):
        self.conns, self.events, self.errors = [], [], []
        self.end = None
        self.retry = None      # ms, as the library exposes it
        self.last_id = None    # the library's last event id at the end, as it exposes it

    def conn_open(self, last_event_id_sent):
        self.conns.append({'n': len(self.conns) + 1, 'status': None, 'content_type': None, 'x_badhttp_flavor': None,
                           'x_badhttp_version': None, 'last_event_id_sent': last_event_id_sent, 'ended': None, 'error': None})

    def conn_response(self, status, headers):
        c = self.conns[-1]
        c['status'] = status
        c['content_type'] = headers.get('content-type')
        c['x_badhttp_flavor'] = headers.get('x-badhttp-flavor')
        c['x_badhttp_version'] = headers.get('x-badhttp-version')
        if status == 204:
            c['ended'] = 'status-204'

    def conn_end(self, how, error=None):
        if self.conns and self.conns[-1]['ended'] is None:
            self.conns[-1]['ended'] = how
            if error:
                self.conns[-1]['error'] = sanitize(error)

    def event(self, typ, eid, data):
        d = data if isinstance(data, str) else str(data)
        b = d.encode('utf-8', 'replace')
        big = len(b) > 200
        self.events.append({'type': typ or 'message', 'id': eid, 'data': d[:64] if big else d, 'data_bytes': len(b),
                            'data_sha256': hashlib.sha256(b).hexdigest() if big else None})

    def error(self, message, had_data=False, ready_state=None):
        self.errors.append({'message': sanitize(message), 'had_data': bool(had_data), 'ready_state_after': ready_state})

class HarnessTimeout(BaseException):
    """Raised by the SIGALRM cap inside a synchronous library call; a BaseException so no library handler swallows it."""

@contextlib.contextmanager
def capped(seconds):
    def fire(signum, frame):
        raise HarnessTimeout()
    old = signal.signal(signal.SIGALRM, fire)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)

class Client:
    id = name = cls = library = invocation = counted_by = version = None
    def info(self):
        return {'id': self.id, 'name': self.name, 'role': 'client', 'class': self.cls, 'version': self.version,
                'library': self.library, 'platform': PLAT, 'invocation': self.invocation, 'connections_counted_by': self.counted_by}

# --- httpx-sse (over httpx) ---------------------------------------------------------------------------------------
# CLASS one-shot. Read: httpx_sse._api.connect_sse opens exactly one client.stream(...) and yields an EventSource over
# that one httpx.Response; EventSource.iter_sse() runs _check_content_type() (SSEError, a httpx.TransportError, unless the
# media type contains text/event-stream), then _iter_sse_lines(response) -> response.iter_text() until the body ends and
# decoder.flush(), and the generator returns. No retry loop, no Last-Event-ID, no second request anywhere in the package.
# httpx_sse._decoders.SSEDecoder.decode dispatches on a blank line when ANY of event/data/id/retry is set, so a block
# that carries only "retry: N" is delivered as an event with data "" (ServerSentEvent.retry exposes N): recorded as such.
# ServerSentEvent.id is the decoder's persistent last event id ("" until one is seen).
import httpx, httpx_sse

class HttpxSse(Client):
    id, name, cls = 'httpx-sse', 'httpx-sse', 'one-shot'
    version = md.version('httpx-sse')
    library = f'httpx-sse {md.version("httpx-sse")} over httpx {md.version("httpx")}'
    invocation = ('HTTP/1.1 (http2=False): httpx_sse.connect_sse(httpx.Client(http1=True, http2=False, trust_env=False, follow_redirects=False), "GET", url) '
                  'then EventSource.iter_sse(); one fresh Client per flavor; connect_sse adds Accept: text/event-stream and '
                  'Cache-Control: no-store; retry_ms_adopted is the last ServerSentEvent.retry seen, last_event_id_final the '
                  'last ServerSentEvent.id')
    counted_by = 'httpx event_hooks (request and response): each request the Client sends is one connection; redirects are not followed'

    def run(self, url, flavor, obs):
        def on_request(req):
            obs.conn_open(req.headers.get('last-event-id'))
        def on_response(resp):
            obs.conn_response(resp.status_code, resp.headers)
        client = httpx.Client(http1=True, http2=False, trust_env=False, follow_redirects=False,
                              timeout=httpx.Timeout(30.0, connect=10.0),
                              event_hooks={'request': [on_request], 'response': [on_response]})
        try:
            try:
                with capped(CAP):
                    with httpx_sse.connect_sse(client, 'GET', url) as es:
                        for sse in es.iter_sse():
                            obs.event(sse.event, sse.id, sse.data)
                            if sse.retry is not None:
                                obs.retry = sse.retry
                            obs.last_id = sse.id or None
                    obs.conn_end('server-closed')
                    obs.end = 'clean'
            except HarnessTimeout:
                obs.conn_end('harness-timeout', 'harness cap reached')
                obs.end = 'harness-timeout'
            except httpx_sse.SSEError as e:  # the library's own Content-Type check, raised after the response arrived
                obs.error(describe(e), bool(getattr(e, 'data', None)), None)
                obs.conn_end('refused', describe(e))
                obs.end = 'error'
            except Exception as e:
                got_response = bool(obs.conns) and obs.conns[-1]['status'] is not None
                obs.error(describe(e), bool(getattr(e, 'data', None)), None)
                obs.conn_end('reset' if got_response and isinstance(e, (httpx.RemoteProtocolError, httpx.ReadError)) else 'error', describe(e))
                obs.end = 'error'
        finally:
            client.close()

# --- sseclient-py (over requests) ---------------------------------------------------------------------------------
# CLASS one-shot. Read: sseclient.SSEClient.__init__ ("Initialize the SSE client over an existing, ready to consume event
# source" - the library never issues a request itself), SSEClient._read (for chunk in self._event_source: ... yield the
# buffered block; "if data: yield data" at the end) and SSEClient.events (parses each block into an Event; a block with
# no data is not dispatched). The generator ends when the response iterator ends. There is no reconnection and no
# Last-Event-ID anywhere in the package, and no Content-Type check. Event.id is the id: line of THAT block only (None
# otherwise: the library keeps no last event id across blocks), Event.retry is the raw string of a retry: line in a
# block that also carried data (a retry-only block is never dispatched). The harness hands SSEClient the requests
# Response, as the README does; iterating a Response reads it in 128-byte chunks (requests.Response.__iter__).
import requests, sseclient
from requests.adapters import HTTPAdapter

class _Counting(HTTPAdapter):
    def __init__(self, obs):
        super().__init__()
        self.obs = obs
    def send(self, request, **kw):
        self.obs.conn_open(request.headers.get('Last-Event-ID'))
        resp = super().send(request, **kw)
        self.obs.conn_response(resp.status_code, resp.headers)
        return resp

class SseclientPy(Client):
    id, name, cls = 'sseclient-py', 'sseclient-py', 'one-shot'
    version = md.version('sseclient-py')
    library = f'sseclient-py {md.version("sseclient-py")} over requests {md.version("requests")}'
    invocation = ('HTTP/1.1 (requests speaks nothing else): sseclient.SSEClient(requests.Session().get(url, stream=True, headers={"Accept": "text/event-stream"}, allow_redirects=False)).events(); '
                  'one fresh Session per flavor with trust_env=False; the Response is handed over as the event source; '
                  'the library keeps no last event id (null) and exposes retry only on a dispatched event')
    counted_by = 'requests HTTPAdapter subclass (send): each send is one connection; redirects are not followed'

    def run(self, url, flavor, obs):
        s = requests.Session()
        s.trust_env = False
        ad = _Counting(obs)
        s.mount('https://', ad)
        s.mount('http://', ad)
        resp = None
        try:
            try:
                with capped(CAP):
                    resp = s.get(url, stream=True, headers={'Accept': 'text/event-stream'}, timeout=(10, 30), allow_redirects=False)
                    for ev in sseclient.SSEClient(resp).events():
                        obs.event(ev.event, ev.id, ev.data)
                        if ev.retry:
                            with contextlib.suppress(ValueError, TypeError):
                                obs.retry = int(ev.retry)
                    obs.conn_end('server-closed')
                    obs.end = 'clean'
            except HarnessTimeout:
                obs.conn_end('harness-timeout', 'harness cap reached')
                obs.end = 'harness-timeout'
            except Exception as e:
                got_response = bool(obs.conns) and obs.conns[-1]['status'] is not None
                obs.error(describe(e), bool(getattr(e, 'data', None)), None)
                obs.conn_end('reset' if got_response and isinstance(e, (requests.exceptions.ChunkedEncodingError, requests.exceptions.ConnectionError)) else 'error', describe(e))
                obs.end = 'error'
        finally:
            with contextlib.suppress(Exception):
                if resp is not None:
                    resp.close()
            s.close()

# --- aiohttp-sse-client (over aiohttp) ----------------------------------------------------------------------------
# CLASS eventsource. Read: aiohttp_sse_client.client.EventSource.__anext__: when `async for line in self._response.content`
# runs out (the server closed) it does not return - it sets ready_state to READY_STATE_CONNECTING, calls on_error() (no
# arguments), doubles _reconnection_time, asyncio.sleep()s that long and awaits self.connect() again, in a `while
# self._response.status != 204` loop; connect() sends Last-Event-Id whenever _last_event_id != '' and raises on a
# non-200 status (a 204 included: ConnectionAbortedError after _fail_connect() sets READY_STATE_CLOSED) or a
# Content-Type other than text/event-stream (ConnectionAbortedError). _process_field applies a retry: field to
# _reconnection_time and strips ALL leading spaces from a value (lstrip(' ')), and lines are split by aiohttp's
# StreamReader on LF only. There is no public accessor for the retry value or the last event id, so retry_ms_adopted
# (read inside on_error, before the doubling) and last_event_id_final come from the private _reconnection_time and
# _last_event_id; MessageEvent.last_event_id is the public per-event id.
import aiohttp
from aiohttp_sse_client import client as sse_client

logging.getLogger('aiohttp_sse_client.client').setLevel(logging.CRITICAL)  # the library logs its refusals to stderr; the row records them

class AiohttpSse(Client):
    id, name, cls = 'aiohttp-sse-client', 'aiohttp-sse-client', 'eventsource'
    version = md.version('aiohttp-sse-client')
    library = f'aiohttp-sse-client {md.version("aiohttp-sse-client")} over aiohttp {md.version("aiohttp")}'
    invocation = ('HTTP/1.1 (aiohttp speaks nothing else): async with aiohttp_sse_client.client.EventSource(url, session=aiohttp.ClientSession(trace_configs=[...], trust_env=False), on_error=...) as es: '
                  'async for event in es; one fresh session per flavor; the harness cancels the iteration when the library signals the end of its '
                  'first connection (every flavor but resume); retry_ms_adopted and last_event_id_final are read from the private '
                  '_reconnection_time and _last_event_id (the library has no public accessor)')
    counted_by = 'aiohttp TraceConfig (on_request_start, on_request_end, on_request_exception): each request the session issues is one connection, the library\'s own reconnects included'

    def run(self, url, flavor, obs):
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(self._row(url, flavor, obs))
        finally:
            with contextlib.suppress(Exception):
                loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    async def _row(self, url, flavor, obs):
        trace = aiohttp.TraceConfig()
        async def t_start(sess, ctx, p):
            obs.conn_open(p.headers.get('Last-Event-ID'))
        async def t_end(sess, ctx, p):
            obs.conn_response(p.response.status, p.response.headers)
        async def t_exc(sess, ctx, p):
            obs.conn_end('error', describe(p.exception))
        trace.on_request_start.append(t_start)
        trace.on_request_end.append(t_end)
        trace.on_request_exception.append(t_exc)
        session = aiohttp.ClientSession(trace_configs=[trace], trust_env=False,
                                        timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=30))
        stop = asyncio.Event()
        box = {}

        def on_error():
            es = box['es']
            obs.error('on_error callback invoked with no arguments (the library supplies no error object)', False, STATES.get(es.ready_state))
            c = obs.conns[-1] if obs.conns else None
            if c and c['status'] == 200 and c['ended'] is None and es.ready_state == 0:
                c['ended'] = 'server-closed'  # the body ran out; this is the reconnect path
                obs.retry = int(es._reconnection_time.total_seconds() * 1000)
                if flavor != 'resume' or len(obs.conns) >= MAX_CONNS:
                    stop.set()

        es = sse_client.EventSource(url, session=session, on_error=on_error)
        box['es'] = es

        async def consume():
            # ready_state is read where the error is raised: the library's own __aexit__ would otherwise mark it closed first
            try:
                async with es:
                    try:
                        async for ev in es:
                            obs.event(ev.type, ev.last_event_id, ev.data)
                    except Exception:
                        box['state'] = es.ready_state
                        raise
            except Exception:
                box.setdefault('state', es.ready_state)
                raise

        task = asyncio.ensure_future(consume())
        waiter = asyncio.ensure_future(stop.wait())
        try:
            done, _ = await asyncio.wait({task, waiter}, timeout=CAP, return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                exc = task.exception()
                if exc is None:
                    obs.conn_end('server-closed')
                    obs.end = 'clean'
                else:
                    last = obs.conns[-1] if obs.conns else None
                    got_response = last is not None and last['status'] is not None
                    obs.error(describe(exc), bool(getattr(exc, 'data', None)), STATES.get(box.get('state', es.ready_state)))
                    if last is not None and last['status'] == 204 and len(obs.conns) > 1:
                        obs.end = 'stopped'  # the 204 on a reconnect: the library stopped (raising ConnectionAbortedError)
                    else:
                        obs.end = 'error'
                    if isinstance(exc, (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError)) and got_response:
                        obs.conn_end('reset', describe(exc))
                    elif isinstance(exc, ConnectionError) and got_response:
                        obs.conn_end('refused', describe(exc))  # a refused status or Content-Type, decided by the library
                    else:
                        obs.conn_end('error', describe(exc))
            elif waiter in done:
                obs.end = 'closed-by-harness' if len(obs.conns) >= MAX_CONNS else 'reconnecting'
            else:
                obs.end = 'harness-timeout'
                obs.conn_end('harness-timeout', 'harness cap reached')
        finally:
            for t in (task, waiter):
                if not t.done():
                    t.cancel()
            await asyncio.gather(task, waiter, return_exceptions=True)
            cleaned = es._last_event_id or None
            obs.last_id = cleaned
            await session.close()

# --- one (client, flavor) row ---------------------------------------------------------------------------------------
def build(cli, f, obs, attempts, wall_ms, probed, failed=None):
    first = obs.conns[0] if obs.conns else None
    row = {'family': 'sse', 'id': f'sse.{f}.{cli.id}', 'corpus_id': f'sse.{f}', 'url': f'{B}/sse/{f}', 'method': 'GET', 'flavor': f,
           'probed': probed, 'badhttp_version': first['x_badhttp_version'] if first else None, 'client': cli.info(), 'attempts': attempts}
    if failed:
        row.update({'connections': obs.conns, 'events': [], 'events_delivered': 0, 'errors': [], 'end': 'error', 'retry_ms_adopted': None,
                    'last_event_id_final': None, 'wall_ms': wall_ms, 'request_failed': True, 'reported_error': failed})
    else:
        row.update({'connections': obs.conns, 'events': obs.events, 'events_delivered': len(obs.events), 'errors': obs.errors,
                    'end': obs.end, 'retry_ms_adopted': obs.retry, 'last_event_id_final': obs.last_id, 'wall_ms': wall_ms})
    return row

def run_flavor(cli, f):
    url = f'{B}/sse/{f}'
    for attempt in (1, 2, 3):
        obs = Obs()
        probed = now()
        t0 = time.monotonic()
        cli.run(url, f, obs)
        wall = int((time.monotonic() - t0) * 1000)
        first = obs.conns[0] if obs.conns else None
        if first and first['x_badhttp_version']:
            emit(build(cli, f, obs, attempt, wall, probed))
            log(f'{cli.id} {f}: {len(obs.events)} events, {len(obs.conns)} connections, end {obs.end} ok')
            return
        status = first['status'] if first and first['status'] is not None else 'none'
        if attempt < 3:
            log(f'{cli.id} {f}: no x-badhttp-version (status {status}); retrying after {RETRY_PAUSE} s')
            time.sleep(RETRY_PAUSE)
            continue
        emit(build(cli, f, obs, attempt, wall, probed,
                   failed=f'no x-badhttp-version on the first connection after 3 attempts (status {status})'))
        log(f'{cli.id} {f}: FAILED, no badhttp response after 3 attempts')

def main():
    clients = [HttpxSse(), SseclientPy(), AiohttpSse()]
    for i, cli in enumerate(clients):
        for j, f in enumerate(ORDER):
            run_flavor(cli, f)
            if j < len(ORDER) - 1:
                time.sleep(ROW_GAP)
        if i < len(clients) - 1:
            time.sleep(CLIENT_GAP)

if __name__ == '__main__':
    main()

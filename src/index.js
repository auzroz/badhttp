// badhttp — the server that misbehaves on purpose.
// Stateless by design: no storage, no cron. The only outbound requests are /402/pay's calls to an
// x402 facilitator and /books' cached reads of two of our own addresses — balanceOf for the receive
// address and for the project's payer wallet from a public Base RPC, and the receipt of every
// transaction the books name from the same kind of RPC (no indexer; session 30).
import { BOOKS, totals, hostingUsage, solvency, fundingManifest } from './books.js';
import { receiveBalance, payerBalance, receiveTransfers, usdcFromAtomic, reproduceCurl, reproduceReceiptCurl, RECEIPT_SOURCES, CHAIN_INFO } from './chain.js';
import { homePage, booksPage, llmsTxt, FAVICON_SVG } from './page.js';
import { openapi } from './openapi.js';
import { handle402, SCENARIOS as X402_SCENARIOS, BROKEN as X402_BROKEN, X402_LIMITS, VERIFIED as X402_VERIFIED } from './x402.js';
import { handleSse, SSE, sseWitness } from './sse.js';
import { handleRange, RANGE } from './range.js';
import { handleEtag, ETAG } from './etag.js';
import { handleCookies, COOKIES, cookieWitness } from './cookies.js';
import { handleCrosshost, crosshostIndex, CROSSHOST, CROSSHOST_HOSTS, crosshostStartUrl } from './crosshost.js';
import { handleAuth, AUTH, authWitness } from './auth.js';
import { handleCompress, COMPRESS } from './compress.js';
import { templateExplainer, matchesTemplate } from './template.js';
import { handleCorpus, handleLicense, LICENSE } from './corpus.js';
import { handleClients } from './clients.js';

const VERSION = '0.23.0';
// The last change to the /.well-known/x402 manifest (its `updated` field, per the draft). Move it when the manifest changes.
const WELL_KNOWN_X402_UPDATED = '2026-10-09T00:00:00Z';

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 204: 'No Content',
  205: 'Reset Content', 206: 'Partial Content', 300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found',
  303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request',
  401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
  411: 'Length Required', 412: 'Precondition Failed', 413: 'Content Too Large', 414: 'URI Too Long',
  415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 417: 'Expectation Failed', 418: "I'm a teapot",
  421: 'Misdirected Request', 422: 'Unprocessable Content', 423: 'Locked', 424: 'Failed Dependency',
  425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required', 429: 'Too Many Requests',
  431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons', 500: 'Internal Server Error',
  501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported', 506: 'Variant Also Negotiates', 507: 'Insufficient Storage',
  508: 'Loop Detected', 510: 'Not Extended', 511: 'Network Authentication Required',
};

// Limits. Generous enough to be useful, small enough that nobody can run up the bill.
const LIMITS = {
  delayMaxSeconds: 10,
  dripMaxSeconds: 20,
  dripMaxChunks: 200,
  redirectMaxHops: 10,
  echoMaxBodyBytes: 16 * 1024,
  headerValueMaxBytes: 2 * 1024,
  truncateMaxBytes: 1024 * 1024,
  sseMaxSeconds: 20,
  sseMaxEvents: 100,
  sseMaxIntervalMs: 5000,
  sseMaxBytes: 1024 * 1024,
  rangeMaxBytes: 1024 * 1024,
  rangeMaxParts: 8,
  cookiesMaxCount: 20,
  cookiesMaxBytes: 8192,
  compressMaxBytes: 1024 * 1024,
  compressBombMaxMiB: 32,
};

// ACAO:* is load-bearing for /auth: it makes credentialed browser requests impossible, so page JS
// can only ever send an Authorization header it built itself (and, live-verified 2026-08-27, every
// shipping browser lets the ACAH wildcard cover Authorization, so such a fetch does reach the Worker).
const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
  'referrer-policy': 'no-referrer',
  'x-badhttp-version': VERSION,
};

function withBase(headers = {}) {
  const h = new Headers(BASE_HEADERS);
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    h.set(k, String(v));
  }
  return h;
}

// ---------------------------------------------------------------------------
// Two hosts, one Worker. alt.badhttp.dev is a real, separately-named host with real DNS and a real
// certificate (the zone's universal cert already covers *.badhttp.dev, so it costs nothing). It
// exists for one reason: a redirect that crosses it crosses a genuine host boundary, which is the
// thing an HTTP client's credential-forwarding rules key on and the thing you cannot reproduce from
// a listener on 127.0.0.1. The alt host serves only this family; everything else on it says so.
const CANONICAL_HOST = 'badhttp.dev';
const ALT_HOST = 'alt.badhttp.dev';

function hostRole(url) {
  return url.hostname.toLowerCase() === ALT_HOST ? 'alt' : 'canonical';
}

// Report that a credential ARRIVED without ever echoing its value. A caller knows what they sent, so
// the scheme and the byte length answer "did mine survive this hop?" completely; the value itself is
// never reflected, hashed or logged, because this family's whole purpose is to be sent credentials by
// people testing whether their client leaks them, and some of those will be real ones sent by mistake.
// The scheme is named only when it is one this server knows, so a bare secret sent as the whole
// header value never has its first token reflected (the /auth family's rule, same reason).
function describeCredential(value) {
  if (value === null || value === undefined) return { present: false };
  const scheme = (value.split(' ')[0] || '').toLowerCase();
  const known = ['basic', 'bearer', 'digest'].includes(scheme);
  return { present: true, scheme: known ? scheme : 'other (not named: this server only names Basic, Bearer and Digest)', bytes: value.length };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    statusText: STATUS_TEXT[status] || '',
    headers: withBase({ 'content-type': 'application/json; charset=utf-8', ...headers }),
  });
}

function text(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    statusText: STATUS_TEXT[status] || '',
    headers: withBase({ 'content-type': 'text/plain; charset=utf-8', ...headers }),
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: withBase({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
    }),
  });
}

function bad(message, hint) {
  return json({ error: message, hint }, 400);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// FNV-1a 32-bit. Deterministic "randomness" for /flaky?seed=.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const NULL_BODY = [204, 205, 304];
function bodyCodeParam(value, name = 'code') {
  const p = intParam(value ?? '200', { min: 200, max: 599, name });
  if (p.error) return p;
  if (NULL_BODY.includes(p.value)) return { error: `${name} cannot be 204, 205 or 304 here (those statuses forbid a body); use /status/${p.value}` };
  return p;
}

function intParam(value, { min, max, name }) {
  if (value === undefined || value === null || value === '') return { error: `${name} is required` };
  if (!/^-?\d+$/.test(value)) return { error: `${name} must be an integer` };
  const n = Number(value);
  if (n < min || n > max) return { error: `${name} must be between ${min} and ${max}` };
  return { value: n };
}

function numParam(value, { min, max, name }) {
  if (value === undefined || value === null || value === '') return { error: `${name} is required` };
  if (!/^\d+(\.\d+)?$/.test(value)) return { error: `${name} must be a number` };
  const n = Number(value);
  if (n < min || n > max) return { error: `${name} must be between ${min} and ${max}` };
  return { value: n };
}

// ---------- endpoints ----------

function handleStatus(seg, url) {
  const raw = seg[1] || '';
  const candidates = raw.split(',').filter(Boolean);
  if (!candidates.length) return bad('missing status code', 'try /status/429 or /status/200,500');
  const codes = [];
  for (const c of candidates) {
    const p = intParam(c, { min: 200, max: 599, name: 'status code' });
    if (p.error) return bad(p.error, '1xx cannot be emitted from a Worker; use 200–599');
    codes.push(p.value);
  }
  const code = codes.length === 1 ? codes[0] : codes[Math.floor(Math.random() * codes.length)];
  const headers = {};
  const ra = url.searchParams.get('retry-after');
  if (ra !== null) {
    const p = intParam(ra, { min: 0, max: 86400, name: 'retry-after' });
    if (p.error) return bad(p.error);
    headers['retry-after'] = p.value;
  }
  if (code >= 300 && code < 400 && code !== 304) headers['location'] = '/redirect/0';
  if (code === 401) headers['www-authenticate'] = 'Bearer realm="badhttp", error="invalid_token"';
  if (code === 405) headers['allow'] = 'GET, HEAD';
  if (code === 407) headers['proxy-authenticate'] = 'Basic realm="badhttp"';
  // 426 should carry Upgrade + Connection, but the runtime strips hop-by-hop headers; nothing to do.
  if (code === 206) headers['content-range'] = 'bytes 0-0/1';
  if (code === 204 || code === 205 || code === 304) {
    return new Response(null, { status: code, statusText: STATUS_TEXT[code], headers: withBase(headers) });
  }
  return json({ status: code, reason: STATUS_TEXT[code] || 'Unassigned', chosen_from: codes.length > 1 ? codes : undefined }, code, headers);
}

async function handleDelay(seg) {
  const p = numParam(seg[1], { min: 0, max: LIMITS.delayMaxSeconds, name: 'seconds' });
  if (p.error) return bad(p.error, `try /delay/3 (max ${LIMITS.delayMaxSeconds})`);
  const ms = Math.round(p.value * 1000);
  const started = Date.now();
  await sleep(ms);
  return json({ requested_ms: ms, actual_ms: Date.now() - started });
}

function handleDrip(url, request) {
  const d = numParam(url.searchParams.get('duration') ?? '5', { min: 0, max: LIMITS.dripMaxSeconds, name: 'duration' });
  if (d.error) return bad(d.error, `?duration=5&chunks=10 (max ${LIMITS.dripMaxSeconds}s, ${LIMITS.dripMaxChunks} chunks)`);
  const c = intParam(url.searchParams.get('chunks') ?? '10', { min: 1, max: LIMITS.dripMaxChunks, name: 'chunks' });
  if (c.error) return bad(c.error);
  const code = bodyCodeParam(url.searchParams.get('code'));
  if (code.error) return bad(code.error);
  const chunks = c.value;
  const gap = chunks > 1 ? (d.value * 1000) / (chunks - 1) : 0;
  const effectiveMs = chunks > 1 ? Math.round(d.value * 1000) : 0;
  const dripHeaders = { 'content-type': 'text/plain; charset=utf-8', 'x-badhttp-chunks': chunks, 'x-badhttp-duration-ms': effectiveMs };
  if (request.method === 'HEAD') return new Response(null, { status: code.value, statusText: STATUS_TEXT[code.value] || '', headers: withBase(dripHeaders) });
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (i >= chunks) {
        controller.close();
        return;
      }
      // First chunk goes out immediately so headers flush; each following chunk waits its share.
      if (i > 0) await sleep(gap);
      i += 1;
      controller.enqueue(enc.encode(`chunk ${i}/${chunks} t=${Date.now()}\n`));
    },
  });
  return new Response(stream, {
    status: code.value,
    statusText: STATUS_TEXT[code.value] || '',
    headers: withBase(dripHeaders),
  });
}

function handleTruncate(url, request) {
  const len = intParam(url.searchParams.get('length') ?? '1000', { min: 1, max: LIMITS.truncateMaxBytes, name: 'length' });
  if (len.error) return bad(len.error, '?length=1000&send=500');
  const send = intParam(url.searchParams.get('send') ?? String(Math.floor(len.value / 2)), { min: 0, max: LIMITS.truncateMaxBytes, name: 'send' });
  if (send.error) return bad(send.error);
  if (send.value > len.value) return bad('send must be <= length');
  const headers = { 'content-type': 'application/octet-stream', 'x-badhttp-declared': len.value, 'x-badhttp-sent': send.value };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: withBase({ ...headers, 'content-length': len.value }) });
  // FixedLengthStream makes the runtime emit Content-Length: len. Aborting the writer after
  // fewer bytes makes it drop the connection instead of finishing the body: a real short read.
  const { readable, writable } = new FixedLengthStream(len.value);
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  (async () => {
    try {
      let sent = 0;
      while (sent < send.value) {
        const n = Math.min(4096, send.value - sent);
        await writer.write(enc.encode('x'.repeat(n)));
        sent += n;
      }
      await sleep(100); // let the partial body reach the wire before pulling the plug
      await writer.abort(new Error('badhttp: truncated on purpose'));
    } catch (e) {
      // The client may have gone away first. That is fine.
    }
  })();
  return new Response(readable, { status: 200, headers: withBase(headers) });
}

const BADJSON = {
  'truncated': { body: '{"items":[{"id":1,"name":"alpha"},{"id":2,"na', about: 'Cut off mid-stream; Content-Length matches what was sent.' },
  'trailing-comma': { body: '{"a":1,"b":2,}\n', about: 'Trailing comma. Valid JSON5, invalid JSON.' },
  'single-quotes': { body: "{'a': 1, 'b': 'two'}\n", about: 'Single-quoted strings. Python repr, not JSON.' },
  'nan': { body: '{"value": NaN, "other": Infinity}\n', about: 'NaN and Infinity literals. Python json.dumps emits these by default.' },
  'bom': { body: '\uFEFF{"ok":true}\n', about: 'UTF-8 byte order mark before the JSON. Some parsers choke.' },
  'html': { body: '<!doctype html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>\n', about: 'An HTML error page served with Content-Type: application/json and a 200.' },
  'mislabeled': { body: '{"ok":true,"note":"this is valid JSON served as text/html"}\n', about: 'Perfectly valid JSON served as text/html.', contentType: 'text/html; charset=utf-8' },
  'empty': { body: '', about: 'Zero-byte body with Content-Type: application/json and a 200.' },
  'unterminated': { body: '{"message": "he said \\"hello\n', about: 'Unterminated string with an escaped quote inside.' },
  'bigint': { body: '{"id": 9007199254740993, "amount": 1e400}\n', about: 'An integer above 2^53 and a number above double range. Precision loss or Infinity in most JS parsers.' },
  'duplicate-keys': { body: '{"role":"user","role":"admin"}\n', about: 'Duplicate keys. Last-one-wins in most parsers, but not all.' },
  'comments': { body: '{\n  // not allowed in JSON\n  "a": 1 /* nor this */\n}\n', about: 'JSONC comments.' },
  'leading-garbage': { body: 'ok\n{"a":1}\n', about: 'A stray line before the JSON document.' },
  'concatenated': { body: '{"a":1}{"a":2}\n', about: 'Two JSON documents back to back with no separator (not NDJSON, no newline).' },
  'deep': { body: '['.repeat(5000) + ']'.repeat(5000) + '\n', about: '5,000 levels of nested arrays. Recursive parsers may blow the stack.' },
  'utf16': { body: null, about: 'Valid JSON, encoded as UTF-16LE with a BOM, labeled charset=utf-8.', contentType: 'application/json; charset=utf-8', bytes: () => new Uint8Array([0xff, 0xfe, ...Array.from('{"ok":true}').flatMap((ch) => [ch.charCodeAt(0), 0])]) },
};

function handleBadJson(seg, url) {
  const flavor = seg[1];
  if (!flavor) {
    return json({ flavors: Object.fromEntries(Object.entries(BADJSON).map(([k, v]) => [k, v.about])), usage: '/badjson/{flavor}' });
  }
  const f = Object.hasOwn(BADJSON, flavor) ? BADJSON[flavor] : undefined;
  if (!f) return json({ error: 'unknown flavor', flavors: Object.keys(BADJSON) }, 404);
  const code = bodyCodeParam(url.searchParams.get('code'));
  if (code.error) return bad(code.error);
  const body = f.bytes ? f.bytes() : f.body;
  return new Response(body, {
    status: code.value,
    statusText: STATUS_TEXT[code.value] || '',
    headers: withBase({ 'content-type': f.contentType || 'application/json; charset=utf-8', 'x-badhttp-flavor': flavor }),
  });
}

function handleFlaky(seg, url) {
  const p = intParam(seg[1], { min: 0, max: 100, name: 'failure percent' });
  if (p.error) return bad(p.error, 'try /flaky/50, or /flaky/50?seed=abc&i=1 for a deterministic sequence');
  const failCode = intParam(url.searchParams.get('fail') ?? '500', { min: 400, max: 599, name: 'fail' });
  if (failCode.error) return bad(failCode.error);
  const seed = url.searchParams.get('seed');
  let roll;
  let mode;
  if (seed !== null) {
    const i = intParam(url.searchParams.get('i') ?? '0', { min: 0, max: 1e9, name: 'i' });
    if (i.error) return bad(i.error);
    roll = fnv1a(`${seed}:${i.value}`) % 100;
    mode = 'deterministic';
  } else {
    roll = Math.floor(Math.random() * 100);
    mode = 'random';
  }
  const failed = roll < p.value;
  const body = { failed, roll, threshold: p.value, mode };
  if (failed) return json({ ...body, status: failCode.value, reason: STATUS_TEXT[failCode.value] || 'Unassigned' }, failCode.value, { 'retry-after': failCode.value === 429 || failCode.value === 503 ? 1 : undefined });
  return json({ ...body, status: 200 });
}

function handleRedirect(seg, url) {
  const codeP = intParam(url.searchParams.get('code') ?? '302', { min: 300, max: 399, name: 'code' });
  if (codeP.error) return bad(codeP.error);
  const code = codeP.value;
  if (![301, 302, 303, 307, 308].includes(code)) return bad('code must be one of 301, 302, 303, 307, 308');
  const absolute = url.searchParams.has('absolute');
  const q = new URLSearchParams();
  if (url.searchParams.has('code')) q.set('code', code);
  if (absolute) q.set('absolute', '1');
  const qs = q.toString() ? `?${q}` : '';
  const target = (path) => (absolute ? `${url.origin}${path}${qs}` : `${path}${qs}`);

  if (seg[1] === 'loop') {
    return new Response(null, { status: code, statusText: STATUS_TEXT[code], headers: withBase({ location: target('/redirect/loop'), 'x-badhttp-warning': 'this redirect never terminates' }) });
  }
  const p = intParam(seg[1], { min: 0, max: LIMITS.redirectMaxHops, name: 'hops' });
  if (p.error) return bad(p.error, `try /redirect/3 (max ${LIMITS.redirectMaxHops}), or /redirect/loop`);
  if (p.value === 0) return json({ redirects: 'done', landed_on: '/redirect/0' });
  return new Response(null, { status: code, statusText: STATUS_TEXT[code], headers: withBase({ location: target(`/redirect/${p.value - 1}`), 'x-badhttp-hops-remaining': p.value - 1 }) });
}

function headersToObject(headers) {
  const out = {};
  const keys = [...headers.keys()].sort();
  for (const k of keys) {
    let v = headers.get(k);
    if (v.length > LIMITS.headerValueMaxBytes) v = v.slice(0, LIMITS.headerValueMaxBytes) + `…[truncated ${v.length - LIMITS.headerValueMaxBytes} more]`;
    out[k] = v;
  }
  return out;
}

function handleHeaders(request) {
  return json({ headers: headersToObject(request.headers) });
}

async function handleEcho(request, url) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return json({ error: 'method not allowed', hint: 'POST, PUT, PATCH or DELETE a body to /echo' }, 405, { allow: 'POST, PUT, PATCH, DELETE, OPTIONS' });
  }
  // Read at most the cap, then cancel the rest of the upload rather than buffering it.
  const parts = [];
  let total = 0;
  let truncated = false;
  const reader = request.body ? request.body.getReader() : null;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.echoMaxBodyBytes) {
      truncated = true;
      const keep = value.byteLength - (total - LIMITS.echoMaxBodyBytes);
      if (keep > 0) parts.push(value.subarray(0, keep));
      await reader.cancel();
      break;
    }
    parts.push(value);
  }
  const buf = new Uint8Array(Math.min(total, LIMITS.echoMaxBodyBytes));
  let off = 0;
  for (const part of parts) { buf.set(part, off); off += part.byteLength; }
  const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  let parsed;
  const ct = request.headers.get('content-type') || '';
  if (!truncated && /json/i.test(ct)) {
    try { parsed = JSON.parse(bodyText); } catch (e) { parsed = { _parse_error: e.message }; }
  }
  return json({
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: headersToObject(request.headers),
    body_bytes: truncated ? `>${LIMITS.echoMaxBodyBytes}` : total,
    body_truncated: truncated,
    body: bodyText,
    json: parsed,
  });
}

// Live reconciliation: the project holds no key that can spend from the receive address (the
// operator does), and every USDC movement of it is public and itemized. The aggregate identity —
// balance − (labeled movements in − labeled movements out) − booked revenue must be 0 — stands on
// the RPC alone; positive means money arrived that the next session books; negative means the books
// claim more than the address holds; the itemized list (the receipt of every transaction the books
// name, each confirmed or not) shows which book row is wrong, so a withdrawal can never hide behind
// the books (the design rule from docs/research-session-3.md, re-based on receipts in session 30).
const CHAIN_STATUS_NOTE = {
  reconciled: 'the chain and the books agree',
  unbooked_receipts: 'USDC has arrived on chain that is not yet booked as revenue above; booking happens by hand at the next session',
  bookkeeping_bug: 'the books account for more USDC (labeled movements plus booked revenue) than the address now holds — either a movement is missing or mislabeled in the books, or money left the address unrecorded; the itemized list below shows which named row the chain does not bear out, and scripts/find-transfers.mjs finds a movement the books do not name. Treat this as a bookkeeping bug (or an RPC error: reproduce the number yourself) until the ledger explains it',
};

const ATOMIC_STR = /^\d{1,30}$/;

function chainView(bal, t) {
  const base = { ...CHAIN_INFO, address: BOOKS.receive_address, reproduce: reproduceCurl(BOOKS.receive_address) };
  const mv = BOOKS.chain_movements;
  if (typeof t.revenue !== 'number' || !Number.isFinite(t.revenue)
    || !Array.isArray(mv) || mv.some((m) => !ATOMIC_STR.test(String(m.amount_atomic)) || (m.direction !== 'in' && m.direction !== 'out'))) {
    return { ...base, error: 'books data error: revenue amounts in src/books.js must be finite numbers and chain_movements rows must carry a digit-string amount_atomic and an in/out direction; reconciliation suppressed until that is fixed' };
  }
  const revTxs = new Set(BOOKS.revenue.filter((r) => r.tx).map((r) => String(r.tx).toLowerCase()));
  if (mv.some((m) => m.tx && revTxs.has(String(m.tx).toLowerCase()))) {
    return { ...base, error: 'books data error: a tx hash appears in both chain_movements and revenue in src/books.js — the same transfer would be counted twice in the reconciliation; remove one of the two rows' };
  }
  if (!bal) return { ...base, error: 'every public RPC failed and no cached copy exists at this edge location; the hand-maintained tables stand, retry shortly' };
  const balance = BigInt(bal.balance_atomic);
  let movementsIn = 0n, movementsOut = 0n;
  for (const m of mv) {
    if (m.direction === 'in') movementsIn += BigInt(m.amount_atomic);
    else movementsOut += BigInt(m.amount_atomic);
  }
  const booked = BigInt(Math.round(t.revenue * 1e6));
  const unbooked = balance - (movementsIn - movementsOut) - booked;
  const status = unbooked === 0n ? 'reconciled' : unbooked > 0n ? 'unbooked_receipts' : 'bookkeeping_bug';
  return {
    ...base,
    balance_usdc: usdcFromAtomic(balance),
    movements_in_usdc: usdcFromAtomic(movementsIn),
    movements_out_usdc: usdcFromAtomic(movementsOut),
    movements_net_usdc: usdcFromAtomic(movementsIn - movementsOut),
    booked_revenue_usd: t.revenue,
    booked_revenue_usdc: usdcFromAtomic(booked),
    unbooked_usdc: usdcFromAtomic(unbooked),
    status,
    status_note: CHAIN_STATUS_NOTE[status],
    fetched_at: bal.fetched_at,
    age_seconds: bal.age_seconds,
    source: bal.source,
    rpc: bal.rpc,
  };
}

// The itemized transfer list, since session 30 built from the receipts of the transactions the books
// NAME (chain_movements rows and revenue rows carrying a tx), not from an indexer: each named
// transaction's USDC Transfer logs that touch the address are the rows, and each book row is thereby
// confirmed against the chain (amount, direction, counterparty) or shown as unconfirmed — loudly,
// because a book row the chain does not bear out is a bookkeeping bug. An on-chain leg inside a named
// transaction that no book row explains is "unbooked" if incoming and an unexplained withdrawal if
// outgoing. A transaction the books do not name cannot appear here at all; the aggregate identity above
// is where it shows, and the view says so instead of letting the table read as exhaustive.
function transfersView(tr, books, chain) {
  const base = {
    source_api: `eth_getTransactionReceipt on a public Base RPC (${RECEIPT_SOURCES.join(', then ')}), one receipt per transaction the books name; no indexer`,
    method: 'For every tx hash in chain_movements[] and revenue[], read its receipt; the USDC Transfer logs in it whose from or to is the receive address are the rows. A book row is confirmed when a log matches its tx, direction and amount exactly. The block header of each row gives its timestamp.',
    discovery: 'This list can only name transactions the books already name. A payment or withdrawal the books do not know shows in the balance identity above (unbooked_usdc), not here; the next session finds its hash with eth_getLogs and names it.',
    reproduce: reproduceReceiptCurl(books.revenue.find((r) => r.tx)?.tx),
  };
  if (!tr) return { ...base, error: 'no public RPC returned a receipt for any transaction the books name (unreachable, rate-limited, or every receipt refused); the reconciliation above stands on the RPC balance alone, and each row can be reproduced with the curl below' };
  if (tr.pending) return { ...base, error: 'first read at this edge location is still in progress (a batch of receipts from a public RPC); reload shortly — the result is being cached' };
  // Keyed by tx AND direction: a book row explains one leg of a transaction, not the whole tx —
  // otherwise an outgoing leg inside a booked incoming tx would silently inherit the calm label.
  const expected = new Map();
  for (const m of Array.isArray(books.chain_movements) ? books.chain_movements : []) {
    if (m.tx) expected.set(`${String(m.tx).toLowerCase()}:${m.direction}`, { label: m.label, note: m.note, atomic: String(m.amount_atomic), tx: String(m.tx).toLowerCase(), direction: m.direction, confirmed: false });
  }
  for (const r of books.revenue) {
    if (r.tx) expected.set(`${String(r.tx).toLowerCase()}:in`, { label: 'booked revenue', note: r.item || '', atomic: String(Math.round(r.amount * 1e6)), tx: String(r.tx).toLowerCase(), direction: 'in', confirmed: false });
  }
  let unbookedIn = 0, unexplainedOut = 0, mismatched = 0;
  let net = 0n;
  // Two passes, so the label of a leg never depends on the order legs arrive in: first every book row
  // claims the leg that matches it exactly, then the legs nobody claimed are labeled on their own
  // terms — a mismatch only when the book row it points at is STILL unconfirmed (review, session 30).
  const claimed = new Set();
  tr.items.forEach((it, i) => {
    const known = expected.get(`${it.tx}:${it.direction}`);
    if (known && !known.confirmed && known.atomic === it.atomic) { known.confirmed = true; claimed.add(i); }
  });
  const items = tr.items.map((it, i) => {
    const known = expected.get(`${it.tx}:${it.direction}`);
    let label, note;
    const confirmed = claimed.has(i);
    if (confirmed) ({ label, note } = known);
    else if (known && !known.confirmed) { label = 'AMOUNT MISMATCH'; note = `The books record ${usdcFromAtomic(BigInt(known.atomic))} USDC for this leg ("${known.label}"); the chain shows ${usdcFromAtomic(BigInt(it.atomic))}. The chain is right and the book row is wrong until the ledger explains it.`; mismatched++; }
    else if (it.direction === 'in') { label = 'unbooked'; note = 'Arrived on chain inside a transaction the books name, but no book row explains this leg — if you just paid or donated, this row is you.'; unbookedIn++; }
    else if (it.direction === 'self') { label = 'self-transfer'; note = 'From and to are both this address; net zero.'; }
    else { label = 'UNEXPLAINED WITHDRAWAL'; note = 'Money left the address and no book entry explains it. Even a legitimate movement by the operator (the only key-holder) would appear here until the next session books it — either way, treat the books as broken until the ledger explains this transaction.'; unexplainedOut++; }
    if (it.direction === 'in') net += BigInt(it.atomic);
    else if (it.direction === 'out') net -= BigInt(it.atomic);
    return {
      timestamp: it.timestamp, block_number: it.block_number, tx: it.tx, direction: it.direction,
      from: it.from, to: it.to, amount_usdc: usdcFromAtomic(BigInt(it.atomic)), label, note, confirmed_on_chain: confirmed,
    };
  });
  // Every book row the chain did not bear out, with the reason the receipt read gave (or none: the
  // receipt was fine but carried no leg of this direction and amount).
  const unreadable = new Map((tr.unreadable || []).map((u) => [u.tx, u.reason]));
  const unconfirmed = [...expected.values()].filter((e) => !e.confirmed).map((e) => ({
    tx: e.tx, direction: e.direction, amount_usdc: usdcFromAtomic(BigInt(e.atomic)), label: e.label,
    reason: unreadable.get(e.tx) || 'the receipt shows no USDC transfer of this amount in this direction',
  }));
  // Cross-check against the independent RPC balance: the sum of EVERY leg itemized (whatever its
  // label) against the balance. When every named row is confirmed and the identity above is
  // reconciled, that sum is the balance exactly; a difference means either a transfer the books do
  // not name (see unbooked_usdc above) or a wrong book row (listed below). The page claims
  // "every unit explained" only when the list is also clean (no unbooked, mismatched, unexplained
  // or unconfirmed rows) — the sum alone cannot vouch for individual rows.
  const matches = chain && chain.balance_usdc !== undefined ? usdcFromAtomic(net) === chain.balance_usdc : null;
  return {
    ...base,
    fetched_at: tr.fetched_at,
    age_seconds: tr.age_seconds,
    source: tr.source,
    rpc: tr.rpc,
    truncated: false,
    items,
    books_rows_named: expected.size,
    books_rows_confirmed: expected.size - unconfirmed.length,
    books_rows_unconfirmed: unconfirmed,
    itemized_net_usdc: usdcFromAtomic(net),
    matches_balance: matches,
    unbooked_in_count: unbookedIn,
    unexplained_out_count: unexplainedOut,
    amount_mismatch_count: mismatched,
  };
}

// The solvency line, with the payer balance read live rather than stated. A failed read degrades
// the whole line to nulls and an explicit note — never to a stale constant, because a solvency
// claim standing on a number nobody could fetch is worse than declining to make one.
function solvencyView(payerBal, now) {
  const s = solvency(BOOKS, payerBal ? Number(usdcFromAtomic(BigInt(payerBal.balance_atomic))) : null, now);
  return {
    ...s,
    reproduce: reproduceCurl(BOOKS.solvency.payer_address),
    ...(payerBal
      ? { fetched_at: payerBal.fetched_at, age_seconds: payerBal.age_seconds, source: payerBal.source, rpc: payerBal.rpc }
      : { error: 'every public RPC failed and no cached copy exists at this edge location; the assets line is withheld rather than filled in from a stale figure. The bill and its date below are unaffected, and the curl above reproduces the balance independently.' }),
  };
}

async function handleBooks(url, ctx) {
  const now = new Date();
  const t = totals(BOOKS, now);
  const [bal, payer, tr] = await Promise.all([
    receiveBalance(BOOKS.receive_address, ctx),
    payerBalance(BOOKS.solvency.payer_address, ctx),
    receiveTransfers(BOOKS.receive_address, [...BOOKS.chain_movements.map((m) => m.tx), ...BOOKS.revenue.map((r) => r.tx)].filter(Boolean), ctx),
  ]);
  const chain = chainView(bal, t);
  chain.transfers = transfersView(tr, BOOKS, chain);
  const usage = hostingUsage(BOOKS);
  const solv = solvencyView(payer, now);
  if (url.pathname.startsWith('/books.json')) {
    return json({ ...BOOKS, totals: t, hosting_usage: usage, solvency: solv, chain, ledger: 'https://github.com/auzroz/badhttp/blob/main/LEDGER.md (append-only; every session dated, with spend and reasoning)' });
  }
  return html(booksPage(BOOKS, t, VERSION, chain, usage, solv));
}

// ---------- router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const seg = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    const head = seg[0] || '';

    // Two hosts, one Worker. alt.badhttp.dev exists only so /crosshost can cross a real host
    // boundary; it serves that family and nothing else. Everything else there points home rather
    // than becoming a second, indexable copy of the site.
    if (url.hostname.toLowerCase() === CROSSHOST_HOSTS.ALT) {
      // EVERY response from the alt host carries noindex, not just the 404 branch. This host exists
      // to be pointed at by redirects, so it is the one most likely to be crawled, and its fixture
      // pages are exactly what must not enter an index as a second copy of the catalogue. The first
      // cut set the header only on the not-found path, which left the 200s — the pages that actually
      // matter — indexable.
      const noindex = (res) => {
        const h = new Headers(res.headers);
        h.set('x-robots-tag', 'noindex');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
      };
      if (head === 'crosshost') return noindex(handleCrosshost({ seg, url, request, json, bad, withBase }));
      if (url.pathname === '/robots.txt') {
        return text('User-agent: *\nDisallow: /\n', 200, { 'cache-control': 'public, max-age=86400', 'x-robots-tag': 'noindex' });
      }
      if (url.pathname === '/health') {
        return noindex(json({ ok: true, version: VERSION, host_role: 'alt', serves: '/crosshost only', canonical: `https://${CROSSHOST_HOSTS.CANONICAL}/` }));
      }
      return json(
        {
          error: 'this host serves only the /crosshost fixtures',
          host_role: 'alt',
          why: 'It exists so a redirect can cross a real host boundary with real DNS and a real certificate. It is not a second copy of the site.',
          crosshost: `https://${CROSSHOST_HOSTS.CANONICAL}/crosshost`,
          canonical: `https://${CROSSHOST_HOSTS.CANONICAL}${url.pathname}`,
        },
        404,
        { 'x-robots-tag': 'noindex' },
      );
    }

    if (request.method === 'OPTIONS') {
      // A literal template URL answers every non-OPTIONS method with its explainer, so Allow says so.
      // /auth is method-agnostic too (auth is method-orthogonal; the body is never read).
      const allow = matchesTemplate(seg) || head === 'auth' ? 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS' : head === 'echo' ? 'POST, PUT, PATCH, DELETE, OPTIONS' : head === '402' ? 'GET, HEAD, POST, OPTIONS' : 'GET, HEAD, OPTIONS';
      return new Response(null, { status: 204, headers: withBase({ allow, 'access-control-max-age': '86400' }) });
    }

    try {
      // A documented path template requested literally ({braces} intact) answers 200 with its menu
      // of valid substitutions, any method except OPTIONS (handled above). See src/template.js for why.
      const tpl = templateExplainer({ seg, url, json, catalog: { limits: LIMITS, x402Limits: X402_LIMITS, badjson: BADJSON, sse: SSE, range: RANGE, etag: ETAG, cookies: COOKIES, auth: AUTH, compress: COMPRESS, crosshost: CROSSHOST, scenarios: X402_SCENARIOS, broken: X402_BROKEN } });
      if (tpl) return tpl;
      switch (head) {
        case '':
          return html(homePage({ origin: url.origin, version: VERSION, books: BOOKS, totals: totals(BOOKS), limits: LIMITS, badjson: BADJSON, sse: SSE, range: RANGE, etag: ETAG, cookies: COOKIES, auth: AUTH, compress: COMPRESS, crosshost: CROSSHOST, x402: { scenarios: X402_SCENARIOS, broken: X402_BROKEN, limits: X402_LIMITS, verified: X402_VERIFIED }, authWitness: authWitness(), cookieWitness: cookieWitness(), sseWitness: sseWitness() }));
        case 'status':
          return handleStatus(seg, url);
        case 'delay':
          return await handleDelay(seg);
        case 'drip':
          return handleDrip(url, request);
        case 'truncate':
          return handleTruncate(url, request);
        case 'badjson':
          return handleBadJson(seg, url);
        case 'sse':
          return handleSse({ seg, url, request, json, bad, intParam, numParam, withBase, limits: LIMITS, sleep });
        case 'range':
          return handleRange({ seg, url, request, json, bad, intParam, withBase, limits: LIMITS });
        case 'etag':
          return handleEtag({ seg, url, request, json, bad, withBase });
        case 'cookies':
          return handleCookies({ seg, url, request, json, bad, intParam, withBase, limits: LIMITS });
        case 'auth':
          return await handleAuth({ seg, url, request, json, withBase });
        case 'compress':
          return await handleCompress({ seg, url, request, json, bad, intParam, bodyCodeParam, withBase, limits: LIMITS, sleep });
        case 'flaky':
          return handleFlaky(seg, url);
        case 'crosshost':
          return handleCrosshost({ seg, url, request, json, bad, withBase });
        case 'redirect':
          return handleRedirect(seg, url);
        case 'headers':
          return handleHeaders(request);
        case 'echo':
          return await handleEcho(request, url);
        case '402':
          return await handle402({ seg, url, request, env, payTo: BOOKS.receive_address, json, text });
        case 'books':
        case 'books.json':
          return await handleBooks(url, ctx);
        case 'openapi.json':
          return json(openapi({ origin: url.origin, version: VERSION, badjsonFlavors: Object.keys(BADJSON), sseFlavors: Object.keys(SSE), rangeFlavors: Object.keys(RANGE), etagFlavors: Object.keys(ETAG), cookieFlavors: Object.keys(COOKIES), authFlavors: Object.keys(AUTH), compressFlavors: Object.keys(COMPRESS), crosshostFlavors: Object.keys(CROSSHOST), x402Scenarios: Object.keys(X402_SCENARIOS), x402Broken: Object.keys(X402_BROKEN), x402Limits: X402_LIMITS }));
        case 'corpus':
        case 'corpus.jsonl':
          return handleCorpus({
            seg, url, json, withBase, version: VERSION,
            tables: { statusCodes: Object.keys(STATUS_TEXT).map(Number), badjson: BADJSON, sse: SSE, range: RANGE, etag: ETAG, cookies: COOKIES, auth: AUTH, compress: COMPRESS, scenarios: X402_SCENARIOS, broken: X402_BROKEN },
          });
        case 'clients':
        case 'clients.jsonl':
          return handleClients({ seg, url, json, withBase });
        case 'license':
          return handleLicense({ url, json, withBase });
        case 'health':
          return json({ ok: true, version: VERSION, stateless: true, stored_state: 'none about callers; the only cross-request state is edge-cached copies of our own public on-chain balances (receive address and project payer wallet) and the receive address\'s transfer list, for /books (fresh ~300 s)' });
        case 'robots.txt':
          return text(`User-agent: *\nAllow: /\nDisallow: /delay/\nDisallow: /drip\nDisallow: /truncate\nDisallow: /flaky/\nDisallow: /redirect/\nDisallow: /sse/\nDisallow: /range/\nDisallow: /etag/\nDisallow: /cookies/\nDisallow: /auth/\nDisallow: /compress/\nAllow: /crosshost\nDisallow: /crosshost/\nAllow: /402/pay\nAllow: /402/pay/base\nAllow: /402/pay/base-sepolia\nDisallow: /402/\nSitemap: ${url.origin}/sitemap.xml\n`, 200, { 'cache-control': 'public, max-age=86400' });
        case 'sitemap.xml': {
          const pages = ['/', '/books', '/badjson', '/sse', '/range', '/etag', '/cookies', '/auth', '/compress', '/crosshost', '/402', '/corpus', '/clients', '/license', '/openapi.json', '/llms.txt', '/books.json', '/corpus.jsonl', '/clients.jsonl', '/funding.json', '/.well-known/x402'];
          const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((pth) => `  <url><loc>${url.origin}${pth}</loc><lastmod>${BOOKS.updated}</lastmod></url>`).join('\n')}\n</urlset>\n`;
          return new Response(xml, { status: 200, headers: withBase({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' }) });
        }
        case 'llms.txt':
          return new Response(llmsTxt({ origin: url.origin, version: VERSION, limits: LIMITS, x402Limits: X402_LIMITS }), { status: 200, headers: withBase({ 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' }) });
        case '.well-known':
          // /.well-known/x402 (session 30): the resource-server manifest of draft-hawkins-x402-dns-discovery-03
          // (IETF Internet-Draft, August 2026). Machines asked for this path 639 times in the three days before
          // it existed (Agent402's crawler names it as one of the four documents it reads). It lists ONLY the
          // three URLs that settle: every other /402 route misbehaves on purpose and never charges, and a
          // manifest that advertised them as payable would be the lie this project exists to not tell. The
          // draft's rule that every resource URL be HTTPS and on this host is met by construction (url.host).
          if (seg[1] === 'x402') {
            // https by construction, whatever scheme the request arrived on: the draft says every resource URL MUST be HTTPS.
            const origin = `https://${url.host}`;
            const pay = (path, description) => ({ url: `${origin}${path}`, method: 'GET', description });
            return json({
              x402Version: 2,
              kind: 'resource-server',
              name: 'badhttp',
              description: 'HTTP edge cases for testing clients, SDKs and agents, including x402 paywalls that misbehave on purpose. Free; only the three resources below settle a payment.',
              resources: [
                pay('/402/pay/base', `A real x402 paywall, real USDC on Base mainnet (eip155:8453): pay ${X402_LIMITS.defaultUsd} USDC (or ?amount=, ${X402_LIMITS.minUsd}-${X402_LIMITS.maxUsd}) and get a 200 with a receipt and the transaction hash. v2 in PAYMENT-REQUIRED and v1 in the body of the same 402.`),
                pay('/402/pay', 'The same paywall for test USDC on Base Sepolia (eip155:84532), the default network; no dollar value.'),
                pay('/402/pay/base-sepolia', 'Identical to /402/pay: test USDC on Base Sepolia.'),
              ],
              not_listed: 'Every other route under /402 is a paywall that misbehaves on purpose (never settles, rejects, times out, crashes, returns garbage receipts, asks for 1,000,000 USDC, names a chain that does not exist, or is malformed). They are documented at /402 and deliberately absent here, because an indexer that read them as payable would mislead its buyers.',
              attestation: { type: 'none' },
              docs: `${origin}/402`,
              openapi: `${origin}/openapi.json`,
              books: `${origin}/books.json`,
              contact: 'ops@badhttp.dev',
              updated: WELL_KNOWN_X402_UPDATED,
            }, 200, { 'cache-control': 'public, max-age=3600' });
          }
          // 402index.io domain verification (session 20, 2026-09-08). Their claim flow hands out a
          // secret token and asks for its SHA-256 at this path; holding the preimage is what proves
          // control of the domain. The hash below is public by construction — it reveals nothing
          // about the token, which lives in .env as INDEX402_CLAIM_TOKEN (never in source) and is
          // what POST /api/v1/claim/revoke would need. Verified in-session: sha256(token) == this.
          // RFC 9116 security.txt. Added session 22 alongside /crosshost: a family that redirects
          // between two hostnames will be crawled by scanners looking for open redirectors, and the
          // cheapest insurance against a silent reputation flag is a documented place to ask. The
          // Policy line points at the family's own statement of why it is not an open redirect.
          if (seg[1] === 'security.txt') {
            const year = new Date().getUTCFullYear() + 1;
            return text(
              [
                'Contact: mailto:ops@badhttp.dev',
                `Expires: ${year}-01-01T00:00:00.000Z`,
                'Preferred-Languages: en',
                `Canonical: https://${CROSSHOST_HOSTS.CANONICAL}/.well-known/security.txt`,
                `Policy: https://${CROSSHOST_HOSTS.CANONICAL}/crosshost`,
                '',
                '# badhttp misbehaves on purpose: broken responses here are the product, not a defect.',
                '# Before reporting, check whether the behaviour is documented at https://badhttp.dev/',
                '# The /crosshost family redirects between badhttp.dev and alt.badhttp.dev. It is NOT an',
                '# open redirect: targets come from a frozen table of those two hosts, and no endpoint',
                '# accepts a redirect target, or any part of one, from the caller.',
                '# Genuinely interested in: anything that lets a caller control a redirect target, any',
                '# way a credential sent to this host is reflected or retained, or any path to another',
                "# party's infrastructure.",
                '',
              ].join('\n'),
              200,
              { 'cache-control': 'public, max-age=86400' },
            );
          }
          if (seg[1] === '402index-verify.txt') {
            return text('91c6b02d9fa38bc02d5f825ecad89da50bfeaf67a2a127d72fbc6e7c04ba477f\n', 200, { 'cache-control': 'public, max-age=3600' });
          }
          // agent-tools.cloud domain claim (session 27, 2026-10-05). Their crawler had imported this host from
          // x402scan as a listing pointing at the HOME PAGE with a made-up MCP url, and graded it "degraded";
          // editing a listing there requires proving control of the host by serving their claim token as the
          // whole body of this file. The token is a public verification value (like a DNS TXT record), not a
          // secret: the API key that edits the listing lives in .env as AGENT_TOOLS_API_KEY, never in source.
          if (seg[1] === 'agent-tools-verify.txt') {
            return text('atc_hPrRS_vOAgC0HUAW_HM34JLmoTbpQC5q', 200, { 'cache-control': 'public, max-age=3600' });
          }
          // funding.json discovery (fundingjson.org v1.1.0). The manifest itself is at /funding.json;
          // this file is the spec's provenance mechanism, naming which manifest URLs this host
          // vouches for. Added session 21 for one reason, stated plainly in the manifest and on
          // /books: this project's own research found no free HTTP-testing utility has ever been
          // sustained by its users, and grant-style funding is the only rail with a credible number
          // on it. This is that rail's machine-readable front door, in the same idiom as
          // /openapi.json and /llms.txt — a surface, not a claim.
          if (seg[1] === 'funding-manifest-urls') {
            return text(`${url.origin}/funding.json\n`, 200, { 'cache-control': 'public, max-age=3600' });
          }
          return json({ error: 'not found', hint: 'GET / for the catalogue, /openapi.json for the spec' }, 404);
        case 'funding.json':
          return json(fundingManifest(url.origin), 200, { 'cache-control': 'public, max-age=3600' });
        case 'favicon.svg':
          return new Response(FAVICON_SVG, { status: 200, headers: withBase({ 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=604800' }) });
        case 'favicon.ico':
          return new Response(null, { status: 301, headers: withBase({ location: '/favicon.svg', 'cache-control': 'public, max-age=604800' }) });
        default:
          // IndexNow (indexnow.org): search engines accept URL submissions for a host that serves its key at /{key}.txt.
          // The key is a Worker secret (INDEXNOW_KEY; same value in .env for scripts/indexnow.sh): whoever holds it can
          // submit URLs for this host, so it is not in source. No secret, no route.
          if (typeof env?.INDEXNOW_KEY === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(env.INDEXNOW_KEY) && head === `${env.INDEXNOW_KEY}.txt`) {
            return text(env.INDEXNOW_KEY + '\n', 200, { 'cache-control': 'public, max-age=86400' });
          }
          return json({ error: 'not found', hint: 'GET / for the catalogue, /openapi.json for the spec' }, 404);
      }
    } catch (err) {
      // Misbehaving on purpose is the product; misbehaving by accident is a bug. Say so.
      return json({ error: 'unexpected error', message: String(err && err.message || err), bug: true }, 500);
    }
  },
};

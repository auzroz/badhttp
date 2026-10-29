#!/usr/bin/env node
// Recording reverse proxy shared by the /range and /etag witness families (docs/spec-range-witness.md, docs/spec-etag-witness.md).
// Both harnesses start it the same way; scripts/range-witness/recorder.mjs is a one-line shim that imports this file.
// usage: node witness-recorder.mjs <exchanges.ndjson> [base=https://badhttp.dev] [port=0] [--budget=N]
// Prints one line, "READY http://127.0.0.1:<port>", when listening. Forwards every request verbatim to
// <base><path?query> over TLS (HTTP/1.1), returns the response verbatim, appends one JSON line per exchange.
// Start one recorder per row; stop it with SIGTERM after the client exits. Dependency-free.
// A base of http://... (a local stand-in, dry runs only) is forwarded over plain HTTP/1.1; https:// is the only base a capture uses.
// Per exchange it records the request's range, if-range, if-match, if-none-match, if-modified-since, if-unmodified-since,
// cache-control (cache_control_req), pragma and user-agent, and the response's content-range, content-length, accept-ranges, etag,
// last-modified, cache-control, date, age, vary, expires, x-badhttp-flavor and x-badhttp-version.
// For the /402 witness family (docs/spec-x402-witness.md) it also records, per exchange, `x402`: a decoded SUMMARY of the x402 headers
// (request payment-signature / x-payment; response payment-required, payment-response, x-payment-response, x-badhttp-warning,
// x-badhttp-flavor, and the JSON body's top-level x402Version read from the first 64 KB), or null when the exchange carries none of them.
// A payment-required summary is null when the header is absent and carries header_present: true otherwise. The raw signature and the
// nonce are never recorded: signature_bytes is the byte length of the hex signature. Decoding never throws (decode_error strings).
// --budget=N (a trailing flag; default unlimited): after N upstream requests every further request is answered 503 locally with
// `x-badhttp-recorder: budget-exhausted` and content-length 0, forwarded nowhere, and recorded with upstream:false, status 503,
// budget_refused:true (at most 100 such lines are recorded; later refusals are answered and not written). Every line carries
// `upstream` (true for a forwarded request) and `budget_refused`.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';

let BUDGET = Infinity;
const positional = [];
for (const a of process.argv.slice(2)) {
  const m = /^--budget=(\d+)$/.exec(a);
  if (m) BUDGET = Number(m[1]);
  else if (a.startsWith('--')) { process.stderr.write(`unknown option ${a}\n`); process.exit(2); } else positional.push(a);
}
const [outFile, baseArg = 'https://badhttp.dev', portArg = '0'] = positional;
if (!outFile) {
  process.stderr.write('usage: recorder.mjs <exchanges.ndjson> [base] [port] [--budget=N]\n');
  process.exit(2);
}
const base = new URL(baseArg);
const UPSTREAM_TIMEOUT_MS = 25000;
const HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'host']);
const isHopReq = (k) => HOP.has(k) || k.startsWith('proxy-') || k === 'transfer-encoding';
const isHopRes = (k) => k === 'connection' || k === 'keep-alive' || k === 'transfer-encoding' || k === 'te' || k === 'trailer' || k === 'upgrade' || k.startsWith('proxy-');

fs.writeFileSync(outFile, '', { flag: 'a' });
const secure = base.protocol !== 'http:';
const upstream = secure ? https : http;
const agent = new upstream.Agent({ keepAlive: false });
let counter = 0;
let inflight = 0;
let shuttingDown = false;

const hv = (h, k) => (h[k] === undefined ? null : Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]));

// ---- x402 summaries (never a raw signature, never a nonce) ----
const cap = (v, n = 200) => (typeof v === 'string' ? (v.length > n ? v.slice(0, n) : v) : v === undefined ? null : (typeof v === 'number' || typeof v === 'boolean') ? v : v === null ? null : `<${Array.isArray(v) ? 'array' : typeof v}>`);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function decodeB64Json(raw) {
  try {
    const t = String(raw).trim();
    if (!t || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return { error: 'not-base64' };
    const text = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    let j;
    try { j = JSON.parse(text); } catch { return { error: 'not-json' }; }
    if (!isObj(j)) return { error: 'not-an-object' };
    return { j };
  } catch { return { error: 'decode-failed' }; }
}
function reqSummary(a) {
  if (!isObj(a)) return null;
  return {
    scheme: cap(a.scheme), network: cap(a.network), asset: cap(a.asset), amount: cap(a.amount), maxAmountRequired: cap(a.maxAmountRequired),
    payTo: cap(a.payTo), maxTimeoutSeconds: cap(a.maxTimeoutSeconds), extra_present: a.extra !== undefined && a.extra !== null,
  };
}
function paymentHeader(raw) {
  if (raw === null) return null;
  const out = { version: null, scheme: null, network: null, accepted: null, authorization: null, signature_bytes: null, resource_url: null, decode_error: null };
  const d = decodeB64Json(raw);
  if (d.error) { out.decode_error = d.error; return out; }
  try {
    const j = d.j;
    out.version = cap(j.x402Version);
    const acc = isObj(j.accepted) ? reqSummary(j.accepted) : null;
    out.accepted = acc ? { scheme: acc.scheme, network: acc.network, asset: acc.asset, amount: acc.amount, payTo: acc.payTo, maxTimeoutSeconds: acc.maxTimeoutSeconds, extra_present: acc.extra_present } : null;
    out.scheme = cap(j.scheme ?? (acc && acc.scheme));
    out.network = cap(j.network ?? (acc && acc.network));
    const p = isObj(j.payload) ? j.payload : {};
    const au = isObj(p.authorization) ? p.authorization : null;
    out.authorization = au ? { from: cap(au.from), to: cap(au.to), value: cap(au.value), validAfter: cap(au.validAfter), validBefore: cap(au.validBefore) } : null;
    const sig = p.signature;
    if (typeof sig === 'string') out.signature_bytes = /^(0x)?[0-9a-fA-F]*$/.test(sig) ? (sig.replace(/^0x/, '').length >> 1) : Buffer.byteLength(sig);
    out.resource_url = cap(isObj(j.resource) ? j.resource.url : j.resource);
  } catch { out.decode_error = 'summary-failed'; }
  return out;
}
function requiredHeader(raw) {
  if (raw === null) return null;
  const out = { version: null, error: null, resource_url: null, accepts: null, accepts_count: null, decode_error: null, header_present: true };
  const d = decodeB64Json(raw);
  if (d.error) { out.decode_error = d.error; return out; }
  try {
    const j = d.j;
    out.version = cap(j.x402Version); out.error = cap(j.error);
    out.resource_url = cap(isObj(j.resource) ? j.resource.url : j.resource);
    if (Array.isArray(j.accepts)) { out.accepts_count = j.accepts.length; out.accepts = j.accepts.slice(0, 8).map(reqSummary); }
  } catch { out.decode_error = 'summary-failed'; }
  return out;
}
function receiptHeader(raw) {
  if (raw === null) return null;
  const out = { decodable: false, success: null, transaction: null, network: null, payer: null, errorReason: null, decode_error: null };
  const d = decodeB64Json(raw);
  if (d.error) { out.decode_error = d.error; return out; }
  try {
    const j = d.j;
    out.decodable = true; out.success = typeof j.success === 'boolean' ? j.success : null;
    out.transaction = cap(j.transaction); out.network = cap(j.network); out.payer = cap(j.payer); out.errorReason = cap(j.errorReason ?? j.error);
  } catch { out.decode_error = 'summary-failed'; out.decodable = false; }
  return out;
}
function x402Summary(rh, uh, bodyVersion) {
  const s = {
    payment_signature: paymentHeader(hv(rh, 'payment-signature')), x_payment: paymentHeader(hv(rh, 'x-payment')),
    payment_required: requiredHeader(hv(uh, 'payment-required')),
    payment_response: receiptHeader(hv(uh, 'payment-response')), x_payment_response: receiptHeader(hv(uh, 'x-payment-response')),
    x_badhttp_warning: hv(uh, 'x-badhttp-warning'), x_badhttp_flavor: hv(uh, 'x-badhttp-flavor'), body_x402version: bodyVersion,
  };
  for (const k of Object.keys(s)) if (k !== 'x_badhttp_flavor' && s[k] !== null) return s;
  return null;
}
const X402_BODY_CAP = 65536;
const bodyVersionOf = (buf) => {
  try { const j = JSON.parse(buf.toString('utf8')); return isObj(j) && (typeof j.x402Version === 'number' || typeof j.x402Version === 'string') ? j.x402Version : null; } catch { return null; }
};

let upstreamCount = 0;
let refusedRecorded = 0;
const REFUSED_RECORD_CAP = 100;

const server = http.createServer((req, res) => {
  const n = ++counter;
  const tStart = new Date().toISOString();
  const t0 = performance.now();
  if (upstreamCount >= BUDGET) {
    // Budget spent: answer locally, forward nothing, record the refusal (the exchange never reached the server).
    req.resume();
    const rh = req.headers;
    if (refusedRecorded++ < REFUSED_RECORD_CAP) {
      const line = {
        n, t_start: tStart, method: req.method, path_query: req.url,
        range: hv(rh, 'range'), if_range: hv(rh, 'if-range'), if_match: hv(rh, 'if-match'),
        if_none_match: hv(rh, 'if-none-match'), if_modified_since: hv(rh, 'if-modified-since'),
        if_unmodified_since: hv(rh, 'if-unmodified-since'), cache_control_req: hv(rh, 'cache-control'), pragma: hv(rh, 'pragma'),
        user_agent: hv(rh, 'user-agent'),
        status: 503,
        content_range: null, content_length: '0', accept_ranges: null, etag: null, last_modified: null,
        cache_control: null, date: null, age: null, vary: null, expires: null,
        x_badhttp_flavor: null, x_badhttp_version: null,
        body_bytes: 0, body_sha256: crypto.createHash('sha256').digest('hex'),
        ms: 0, client_aborted: false, upstream_error: null,
        x402: x402Summary(rh, {}, null), upstream: false, budget_refused: true,
      };
      fs.appendFileSync(outFile, JSON.stringify(line) + '\n');
    }
    res.writeHead(503, { 'content-length': '0', 'x-badhttp-recorder': 'budget-exhausted' });
    res.end();
    return;
  }
  upstreamCount++;
  inflight++;
  let recorded = false;
  let upstreamStatus = 0;
  let upHeaders = {};
  let bytes = 0;
  let upstreamError = null;
  let clientAborted = false;
  let bodyBuf = null; // first 64 KB of a JSON body, for body_x402version
  let bodyLen = 0;
  const hash = crypto.createHash('sha256');
  let upReq = null;

  const record = () => {
    if (recorded) return;
    recorded = true;
    inflight--;
    const rh = req.headers;
    const line = {
      n, t_start: tStart, method: req.method, path_query: req.url,
      range: hv(rh, 'range'), if_range: hv(rh, 'if-range'), if_match: hv(rh, 'if-match'),
      if_none_match: hv(rh, 'if-none-match'), if_modified_since: hv(rh, 'if-modified-since'),
      if_unmodified_since: hv(rh, 'if-unmodified-since'), cache_control_req: hv(rh, 'cache-control'), pragma: hv(rh, 'pragma'),
      user_agent: hv(rh, 'user-agent'),
      status: upstreamStatus,
      content_range: hv(upHeaders, 'content-range'), content_length: hv(upHeaders, 'content-length'),
      accept_ranges: hv(upHeaders, 'accept-ranges'), etag: hv(upHeaders, 'etag'),
      last_modified: hv(upHeaders, 'last-modified'),
      cache_control: hv(upHeaders, 'cache-control'), date: hv(upHeaders, 'date'), age: hv(upHeaders, 'age'),
      vary: hv(upHeaders, 'vary'), expires: hv(upHeaders, 'expires'),
      x_badhttp_flavor: hv(upHeaders, 'x-badhttp-flavor'), x_badhttp_version: hv(upHeaders, 'x-badhttp-version'),
      body_bytes: bytes, body_sha256: hash.digest('hex'),
      ms: Math.round(performance.now() - t0),
      client_aborted: clientAborted, upstream_error: upstreamError,
      x402: x402Summary(rh, upHeaders, bodyBuf && bodyLen > 0 ? bodyVersionOf(Buffer.concat(bodyBuf)) : null), upstream: true, budget_refused: false,
    };
    fs.appendFileSync(outFile, JSON.stringify(line) + '\n');
  };

  // The client closed before the response finished.
  res.on('close', () => {
    if (!res.writableFinished) {
      clientAborted = true;
      if (upReq) upReq.destroy();
      record();
    }
  });

  const fail = (code) => {
    upstreamError = code;
    if (!res.headersSent) {
      upstreamStatus = 502;
      upHeaders = {};
      res.writeHead(502, { 'content-length': '0', connection: 'close' });
      res.end(() => record());
    } else {
      // Headers already went out: the only honest signal left is to cut the connection.
      record();
      res.destroy();
    }
  };

  const headers = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i];
    if (isHopReq(k.toLowerCase())) continue;
    headers[k] = headers[k] === undefined ? req.rawHeaders[i + 1] : [].concat(headers[k], req.rawHeaders[i + 1]);
  }
  headers.Host = base.host;

  try {
    upReq = upstream.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || (secure ? 443 : 80),
      ...(secure && !net.isIP(base.hostname) ? { servername: base.hostname } : {}),
      method: req.method, path: req.url, headers, agent,
    });
  } catch (e) {
    req.resume();
    return fail(String(e.code || e.name || 'error'));
  }
  upReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => upReq.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' })));
  upReq.on('error', (e) => { if (!recorded && !clientAborted) fail(String(e.code || e.name || 'error')); });

  upReq.on('response', (up) => {
    upstreamStatus = up.statusCode;
    upHeaders = up.headers;
    const out = [];
    for (let i = 0; i < up.rawHeaders.length; i += 2) {
      if (isHopRes(up.rawHeaders[i].toLowerCase())) continue;
      out.push(up.rawHeaders[i], up.rawHeaders[i + 1]);
    }
    res.writeHead(up.statusCode, up.statusMessage, out);
    if (/json/i.test(hv(upHeaders, 'content-type') || '')) bodyBuf = [];
    up.on('data', (chunk) => {
      if (res.destroyed) return;
      if (bodyBuf && bodyLen < X402_BODY_CAP) { const part = chunk.subarray(0, X402_BODY_CAP - bodyLen); bodyBuf.push(part); bodyLen += part.length; }
      hash.update(chunk);
      bytes += chunk.length;
      if (!res.write(chunk)) {
        up.pause();
        res.once('drain', () => up.resume());
      }
    });
    up.on('end', () => {
      if (!up.complete) return; // handled by 'error'/'close' below
      res.end(() => record());
    });
    up.on('error', (e) => { if (!recorded && !clientAborted) fail(String(e.code || e.name || 'error')); });
    up.on('close', () => { if (!up.complete && !recorded && !clientAborted) fail('upstream-incomplete'); });
  });

  req.on('error', () => { clientAborted = true; upReq.destroy(); });
  req.pipe(upReq);
});

server.keepAliveTimeout = 60000; // above the harness cap (30 s): a client waiting for bytes a Content-Range promised but the body never carried must hit the cap, never a race with this idle close
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'); });

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  const t = setInterval(() => {
    server.closeIdleConnections();
    if (inflight === 0) { clearInterval(t); setTimeout(() => process.exit(0), 20); }
  }, 50);
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(Number(portArg), '127.0.0.1', () => {
  process.stdout.write(`READY http://127.0.0.1:${server.address().port}\n`);
});

#!/usr/bin/env node
// Recording reverse proxy for the /range witness family (docs/spec-range-witness.md).
// usage: node recorder.mjs <exchanges.ndjson> [base=https://badhttp.dev] [port=0]
// Prints one line, "READY http://127.0.0.1:<port>", when listening. Forwards every request verbatim to
// <base><path?query> over TLS (HTTP/1.1), returns the response verbatim, appends one JSON line per exchange.
// Start one recorder per row; stop it with SIGTERM after the client exits. Dependency-free.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';

const [, , outFile, baseArg = 'https://badhttp.dev', portArg = '0'] = process.argv;
if (!outFile) {
  process.stderr.write('usage: recorder.mjs <exchanges.ndjson> [base] [port]\n');
  process.exit(2);
}
const base = new URL(baseArg);
const UPSTREAM_TIMEOUT_MS = 25000;
const HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'host']);
const isHopReq = (k) => HOP.has(k) || k.startsWith('proxy-') || k === 'transfer-encoding';
const isHopRes = (k) => k === 'connection' || k === 'keep-alive' || k === 'transfer-encoding' || k === 'te' || k === 'trailer' || k === 'upgrade' || k.startsWith('proxy-');

fs.writeFileSync(outFile, '', { flag: 'a' });
const agent = new https.Agent({ keepAlive: false });
let counter = 0;
let inflight = 0;
let shuttingDown = false;

const hv = (h, k) => (h[k] === undefined ? null : Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]));

const server = http.createServer((req, res) => {
  const n = ++counter;
  const tStart = new Date().toISOString();
  const t0 = performance.now();
  inflight++;
  let recorded = false;
  let upstreamStatus = 0;
  let upHeaders = {};
  let bytes = 0;
  let upstreamError = null;
  let clientAborted = false;
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
      user_agent: hv(rh, 'user-agent'),
      status: upstreamStatus,
      content_range: hv(upHeaders, 'content-range'), content_length: hv(upHeaders, 'content-length'),
      accept_ranges: hv(upHeaders, 'accept-ranges'), etag: hv(upHeaders, 'etag'),
      last_modified: hv(upHeaders, 'last-modified'),
      x_badhttp_flavor: hv(upHeaders, 'x-badhttp-flavor'), x_badhttp_version: hv(upHeaders, 'x-badhttp-version'),
      body_bytes: bytes, body_sha256: hash.digest('hex'),
      ms: Math.round(performance.now() - t0),
      client_aborted: clientAborted, upstream_error: upstreamError,
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
    upReq = https.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || 443,
      ...(net.isIP(base.hostname) ? {} : { servername: base.hostname }),
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
    up.on('data', (chunk) => {
      if (res.destroyed) return;
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

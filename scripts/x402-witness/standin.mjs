#!/usr/bin/env node
// Local stand-in for the /402 witness family's dry runs (docs/spec-x402-witness.md). Serves the REAL handler from
// src/x402.js on a loopback port, with a stub facilitator on a second loopback port so that /402/pay can be dry-run
// end to end (verify -> settle -> 200 with a receipt) without a live request, a real facilitator or real funds.
// usage: node scripts/x402-witness/standin.mjs <port> [facilitator-port]
// Dry runs only: a published capture always runs against https://badhttp.dev. Never on port 8787 (the smoke suite's default
// target); kill it before any suite (pkill -f 'x402-witness/standin.mjs').
import http from 'node:http';
import { Readable } from 'node:stream';
import { handle402 } from '../../src/x402.js';

const port = Number(process.argv[2] || 8793);
const fport = Number(process.argv[3] || port + 1);
if (port === 8787 || fport === 8787) { process.stderr.write('refusing port 8787 (the smoke suite target)\n'); process.exit(2); }
const PAY_TO = '0x2b14ad50d63c7fee5a33847f95153ac37a690170'; // the project's receive address (public)
const VERSION = 'local';

const base = { 'x-badhttp-version': VERSION, 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body, null, 2) + '\n', { status, headers: { 'content-type': 'application/json; charset=utf-8', ...base, ...headers } });
const text = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...base, ...headers } });

// The stub facilitator: every well-formed payload is valid and settles with a made-up hash. It mirrors the real ones'
// shapes only as far as src/x402.js reads them (isValid/invalidReason/payer; success/transaction/network/payer).
const fac = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/supported') return send(200, { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }, { x402Version: 1, scheme: 'exact', network: 'base-sepolia' }] });
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'not json' }); }
  const payer = body?.paymentPayload?.payload?.authorization?.from || null;
  const network = body?.paymentRequirements?.network || null;
  if (req.url === '/verify') return send(200, { isValid: true, payer });
  if (req.url === '/settle') return send(200, { success: true, transaction: '0x' + 'ab'.repeat(32), network, payer });
  send(404, { error: 'not found' });
});

const env = {
  X402_FACILITATORS_BASE_SEPOLIA: `http://127.0.0.1:${fport}`,
  X402_V1_FACILITATORS_BASE_SEPOLIA: `http://127.0.0.1:${fport}`,
  X402_FACILITATORS_BASE: `http://127.0.0.1:${fport}`,
  X402_V1_FACILITATORS_BASE: `http://127.0.0.1:${fport}`,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const seg = url.pathname.split('/').filter(Boolean);
  let out;
  try {
    if (url.pathname === '/health') out = json({ ok: true, version: VERSION, standin: true });
    else if (seg[0] !== '402') out = json({ error: 'only /402 is served by this stand-in' }, 404);
    else {
      const init = { method: req.method, headers: req.headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
      const request = new Request(url, init);
      out = await handle402({ seg, url, request, env, payTo: PAY_TO, json, text });
    }
  } catch (e) {
    out = json({ error: 'stand-in failure', message: String(e && e.message || e) }, 500);
  }
  const headers = {};
  for (const [k, v] of out.headers) headers[k] = headers[k] === undefined ? v : [].concat(headers[k], v);
  res.writeHead(out.status, headers);
  if (req.method === 'HEAD' || !out.body) return res.end();
  for await (const chunk of out.body) res.write(chunk);
  res.end();
});

fac.listen(fport, '127.0.0.1', () => {
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`READY http://127.0.0.1:${port} (stub facilitator http://127.0.0.1:${fport})\n`);
  });
});
const stop = () => { server.close(); fac.close(); setTimeout(() => process.exit(0), 50).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

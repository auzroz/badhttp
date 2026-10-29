#!/usr/bin/env node
// Capture orchestrator for the /402 witness family (docs/spec-x402-witness.md). Dependency-free, Node 22+.
//
//   X402_WITNESS_PAYER_KEY=0x... node scripts/x402-witness/run.mjs <out.jsonl> [base=https://badhttp.dev] [--clients=a,b] [--scenarios=x,y]
//
// The two filters are for DRY RUNS ONLY: scripts/x402-witness/all.sh never passes them, and a filtered capture is stamped
// `subset: true` in its provenance line (the parser demands the full grid and would refuse it anyway).
//
// What it does, in order (one request at a time per cell, never in parallel: one IP, one zone rate limit):
//   1. line 1 of <out.jsonl>: the provenance line (capture "x402"; badhttp's /health version);
//   2. the controls, through the recorder: per scenario one `offer-raw` row (curl, no payment header). Its exchange's payment_required
//      summary and body_x402version are the offer every client in that cell is shown;
//   3. for each client in the roster, for each of the 18 scenarios: a fresh working directory and home, a fresh recorder (ephemeral
//      port, --budget=12), the client's driver started fresh, and ONE paid fetch of GET /402/<scenario> through the client's payment
//      wrapper (FETCH / RESULT / QUIT, scripts/x402-witness/drivers/README.md). The harness never sends a payment header itself. Every
//      exchange the recorder saw belongs to that fetch. Caps: 45 s per fetch and 60 s per cell, on the driver's whole process group.
//
// Rate limit: an exchange lacking x-badhttp-version (or recording an upstream_error) that is not the recorder's own budget 503 is
// Cloudflare's edge, not an observation. The directory is wiped, the harness waits 12 s and runs the cell again (3 attempts at most).
// A cell that never clears is written with `fetches: []` and `request_failed: true`.
//
// A driver that exits 2, prints no HELLO, exits before its RESULT, or whose cell recorded no exchange at all (when it was not
// rate-limited) is a broken install: the harness stops with exit 3 and the capture must not be published.
//
// Environment:
//   X402_WITNESS_PAYER_KEY  required: the throwaway Base Sepolia payer key. It goes to driver processes in THEIR environment only
//                   (never to the recorder, never to curl); any string that would carry it into a row or the log aborts the capture.
//   X402_NODEMODS   a dir holding node_modules with the Node client libraries the roster uses
//   X402_VENV       a Python venv holding the Python client libraries
//   X402_GOTOOL     the built Go driver binary (when the roster has Go entries)
//   DRIVERS         the dir holding the drivers (default: scripts/x402-witness/drivers)
//   WORKER_VERSION  the wrangler deployment id, for provenance (optional)
//   X402_ALLOW_NO_VERSION=1  DRY RUNS ONLY, against a local stand-in whose responses carry no x-badhttp-version: disables the
//                   rate-limit retry and stamps x_badhttp_version "local". Refused when the base is badhttp.dev.
// Each driver is also given X402_RECORDER (the recorder's loopback origin for this cell).
//
// Exit status: 0 when the harness ran to the end (rows for clients that failed to answer are still exit 0); 3 when it could not run
// (a roster entry is missing, a driver failed, a control could not be fetched, a secret reached a string); 4 on a bug.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDER = path.join(HERE, '..', 'witness-recorder.mjs');
process.env.PATH = `/opt/homebrew/bin:${process.env.PATH || ''}`;

// The grid: 8 scenarios and the 10 broken flavors, in catalogue order (src/x402.js).
const BROKEN_FLAVORS = ['not-base64', 'not-json', 'no-accepts', 'empty-accepts', 'no-extra', 'no-resource', 'version-99', 'decimal-amount', 'missing-header', 'v1-body'];
const SCENARIO_ORDER = ['pay', 'never', 'reject', 'slow', 'crash', 'bad-receipt', 'overpriced', 'wrong-network', ...BROKEN_FLAVORS.map((f) => `broken/${f}`)];
const flavorOf = (scenario) => scenario.split('/').pop();

const BUDGET = 12;
const HELLO_CAP_MS = 20000;
const FETCH_CAP_MS = 45000;
const CELL_CAP_MS = 60000;
const QUIT_WAIT_MS = 5000;
const SETTLE_MS = 300;
const RATE_WAIT_MS = 12000;
const MAX_ATTEMPTS = 3;
const ROW_GAP_MS = 1000;
const CLIENT_GAP_MS = 3000;
const ALLOW_NO_VERSION = process.env.X402_ALLOW_NO_VERSION === '1';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const GENERATIONS = ['v2', 'v1', 'both'];

const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The parser's machine gate, except that 0.0.0.0 must not be a piece of a longer version number.
const MACHINE = /\/(Users|home|private|tmp|Volumes|var|opt|Library)\/|[A-Za-z]:\\\\|file:\/\/|localhost|127\.0\.0\.1|\[::1\]|(?<![\d.])0\.0\.0\.0(?![\d.])/;
const VERDICT_WORDS = /\b(correctly|incorrectly|conformant|non-compliant|noncompliant|violates|buggy|broken client|wrong client|passes|fails the spec)\b/i;
const ALLOWED_HOSTS = ['badhttp.dev', 'alt.badhttp.dev'];

// ---------- the payer key: known here only to refuse it ----------
class Fatal extends Error {}
const PAYER_KEY = process.env.X402_WITNESS_PAYER_KEY || '';
if (!/^0x[0-9a-fA-F]{64}$/.test(PAYER_KEY)) { process.stderr.write('X402_WITNESS_PAYER_KEY must be set to a 0x-prefixed 64-hex-digit throwaway Base Sepolia key\n'); process.exit(2); }
const KEY_FORMS = [...new Set([PAYER_KEY, PAYER_KEY.toLowerCase(), PAYER_KEY.slice(2), PAYER_KEY.slice(2).toLowerCase(), Buffer.from(PAYER_KEY).toString('base64'), Buffer.from(PAYER_KEY.toLowerCase()).toString('base64')])];
const HEX64 = /0x[0-9a-fA-F]{64}/;
let keyHits = 0;
const hasKey = (t) => KEY_FORMS.some((k) => t.includes(k));

// ---------- arguments ----------
const flags = {}; const pos = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
  else if (a.startsWith('--')) { process.stderr.write(`unknown option ${a}\n`); process.exit(2); } else pos.push(a);
}
for (const k of Object.keys(flags)) if (!['clients', 'scenarios'].includes(k)) { process.stderr.write(`unknown option --${k}\n`); process.exit(2); }
const [OUT, BASE_ARG = 'https://badhttp.dev'] = pos;
if (!OUT) { process.stderr.write('usage: run.mjs <out.jsonl> [base] [--clients=a,b] [--scenarios=x,y]\n'); process.exit(2); }
const BASE = new URL(BASE_ARG).origin;
const BASE_HOST = new URL(BASE).hostname;
const REAL = ALLOWED_HOSTS.includes(BASE_HOST);
if (ALLOW_NO_VERSION && REAL) {
  process.stderr.write('X402_ALLOW_NO_VERSION is for dry runs against a local stand-in and is refused for badhttp.dev\n');
  process.exit(2);
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && REAL) {
  process.stderr.write('NODE_TLS_REJECT_UNAUTHORIZED=0 is for dry runs against a local stand-in and is refused for badhttp.dev\n');
  process.exit(2);
}

// ---------- scrubbing: nothing a machine owns, and no key, reaches a row or the log ----------
const tmpRoots = new Set();
function scrub(s, { tail = false, max = 200 } = {}) {
  let t = String(s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  if (hasKey(t)) { keyHits++; return '<message withheld: it carried the payer key>'; }
  for (const lit of tmpRoots) t = t.split(lit).join('<dir>');
  t = t.replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|(?<![\d.])0\.0\.0\.0(?![\d.]))(?::\d+)?[^\s'"<>)]*/gi, '<url>');
  t = t.replace(/https?:\/\/([a-z0-9.-]+)(?::\d+)?[^\s'"<>)]*/gi, (m, h) => (ALLOWED_HOSTS.includes(h.toLowerCase()) ? m : '<url>'));
  t = t.replace(/(?:127\.0\.0\.1|(?<![\d.])0\.0\.0\.0(?![\d.])|localhost)(?::\d+)?/gi, '<recorder>').replace(/\[::1\](?::\d+)?/g, '<recorder>');
  t = t.replace(/\bport \d+/gi, 'port <port>');
  t = t.replace(/\/(?:Users|home|private|tmp|Volumes|var|opt|Library|usr|etc|root)\b(?:\/[^\s'"():;,<>]*)*/g, '<path>');
  t = t.replace(/0x[0-9a-fA-F]{64,}/g, '<hex>'); // a key, a signature or a hash in free text; a transaction hash survives only under a `transaction` field
  t = t.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (MACHINE.test(t) || VERDICT_WORDS.test(t)) return '<message withheld: it named a local path or address>';
  return t.length > max ? (tail ? t.slice(-max) : t.slice(0, max)) : t;
}
const tailLines = (text) => {
  const lines = String(text || '').split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^at\s/.test(l) && !/^[[\]{}()]+$/.test(l)).slice(-3);
  return lines.length ? scrub(lines.join(' | '), { tail: true }) : null;
};
const logErr = (m) => process.stderr.write(`${scrub(m, { max: 400 })}\n`);
// A structured value from a driver (library_says): strings scrubbed, shape kept, size bounded. A `transaction` field keeps a 64-hex hash.
function scrubJson(v, depth = 0, key = '') {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return key === 'transaction' && /^0x[0-9a-fA-F]{64}$/.test(v) ? v : scrub(v, { max: 160 });
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 4) return scrub(JSON.stringify(v), { max: 120 });
  if (Array.isArray(v)) return v.slice(0, 8).map((x) => scrubJson(x, depth + 1, key));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 16).map(([k, x]) => { const sk = scrub(k, { max: 40 }); return [sk, scrubJson(x, depth + 1, sk)]; }));
  return null;
}
const boundJson = (v) => { const j = scrubJson(v); return j !== null && JSON.stringify(j).length > 2048 ? { truncated: true } : j; };
// Every string in an exchange: the loopback origin the client talked to is the server in the row.
const unloop = (v) => {
  if (typeof v === 'string') return v.replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/gi, 'https://badhttp.dev');
  if (Array.isArray(v)) return v.map(unloop);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unloop(x)]));
  return v;
};
// Refuse to emit any string carrying the key, or a 0x-prefixed 64-hex token outside a `transaction` field.
function secretScan(v, key = '', where = '') {
  if (typeof v === 'string') {
    if (hasKey(v)) throw new Fatal(`${where}: a string carries the payer key`);
    if (key !== 'transaction' && HEX64.test(v)) throw new Fatal(`${where}: a string carries a 0x-prefixed 64-hex token outside a transaction field`);
    return;
  }
  if (Array.isArray(v)) { for (const x of v) secretScan(x, key, where); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (hasKey(k)) throw new Fatal(`${where}: a key name carries the payer key`); secretScan(x, k, where); }
}

// ---------- roster ----------
const need = (k) => { const v = process.env[k]; if (!v) throw new Fatal(`${k} is not set (see scripts/x402-witness/README.md)`); return v; };
const DRIVERS = () => process.env.DRIVERS || path.join(HERE, 'drivers');
// `argv()` starts the driver (the URL arrives later on stdin); `invocation` is the same line for the row (no machine path); `files()` are
// what must exist; `env()` is extra environment the driver needs. Version, library, runtime, generation and configuration come from the
// driver's HELLO line, never from here: the row names what the driver reported it handed the client.
// `class` is one of sdk-fetch | sdk-http | agent-wrapper | cli.
// A client may live in its own install (X402_NODEMODS_V1 for the v1-era packages, which pin other axios and viem versions; X402_NODEMODS_MISC for Faremeter and AgentKit); without it, X402_NODEMODS.
const nodeMods = (set) => (set && process.env[`X402_NODEMODS_${set}`]) || need('X402_NODEMODS');
const nodeLib = (id, name, cls, set = '') => ({ id, name, class: cls, argv: () => ['node', path.join(DRIVERS(), 'node-clients.mjs'), id], invocation: `node node-clients.mjs ${id}`, env: () => ({ X402_NODEMODS: path.resolve(nodeMods(set)) }), files: () => [path.join(DRIVERS(), 'node-clients.mjs'), `${nodeMods(set)}/node_modules`] });
const pyLib = (id, name, cls) => ({ id, name, class: cls, argv: () => [`${need('X402_VENV')}/bin/python`, '-I', path.join(DRIVERS(), 'py-clients.py'), id], invocation: `python -I py-clients.py ${id}`, env: () => ({ X402_VENV: path.resolve(need('X402_VENV')) }), files: () => [`${need('X402_VENV')}/bin/python`, path.join(DRIVERS(), 'py-clients.py')] });
const goLib = (id, name, cls) => ({ id, name, class: cls, argv: () => [need('X402_GOTOOL'), id], invocation: `gotool ${id}`, files: () => [need('X402_GOTOOL')] });
// The roster is the survey's decision (docs/survey-x402-clients-2026-10-29.md). A client's id is the id its driver is started with.
const ROSTER = [
  nodeLib('x402-fetch-v2', '@x402/fetch (wrapFetchWithPayment)', 'sdk-fetch'),
  nodeLib('x402-axios-v2', '@x402/axios (wrapAxiosWithPayment)', 'sdk-http'),
  nodeLib('thirdweb-x402', 'thirdweb x402 (wrapFetchWithPayment)', 'sdk-fetch'),
  nodeLib('x402-fetch-v1', 'x402-fetch (wrapFetchWithPayment, v1)', 'sdk-fetch', 'V1'),
  nodeLib('x402-axios-v1', 'x402-axios (withPaymentInterceptor, v1)', 'sdk-http', 'V1'),
  nodeLib('faremeter-fetch', 'Faremeter (@faremeter/fetch)', 'sdk-fetch', 'MISC'),
  nodeLib('agentkit-x402', 'Coinbase AgentKit x402 action provider', 'agent-wrapper', 'MISC'),
  pyLib('x402-httpx', 'x402 for Python (x402HttpxClient)', 'sdk-http'),
  pyLib('x402-requests', 'x402 for Python (x402_requests)', 'sdk-http'),
  goLib('x402-go', 'x402 for Go (WrapHTTPClientWithPayment)', 'sdk-http'),
];
if (process.env.X402_SELFTEST === '1') {
  if (REAL) { process.stderr.write('X402_SELFTEST is for dry runs against a stand-in and is refused for badhttp.dev\n'); process.exit(2); }
  ROSTER.push({ id: 'selftest-loop', name: 'harness self-test loop', class: 'sdk-fetch', argv: () => ['node', path.join(DRIVERS(), 'selftest.mjs'), 'loop'], invocation: 'node selftest.mjs loop', files: () => [path.join(DRIVERS(), 'selftest.mjs')] });
}
// Clients evaluated by the survey but not captured: docs/survey-x402-clients-2026-10-29.md section 3 (backticks dropped), each with the reason the index prints (provenance carries it).
const NOT_IN_ROSTER = [
  { client: "@x402/mcp 2.29.0 (about 10,600 downloads a week)", reason: "pays tool calls made through an MCP client and server, so it cannot be pointed at an HTTP GET of one URL" },
  { client: "mcpay 0.1.17 (about 240)", reason: "an SDK and command-line proxy for MCP servers with payments; it depends on x402-fetch and takes an MCP server, not a URL" },
  { client: "agentcash 0.17.1 command-line client (about 1,200)", reason: "its networks are base, solana and tempo (the only EVM chain id in its source is eip155:8453), it keeps its wallet in a file under the user's home directory and defaults to a USD 5 limit; it has no Base Sepolia network, so it cannot sign any cell of the grid" },
  { client: "@circle-fin/x402-batching 4.0.0 (about 23,000)", reason: "its GatewayClient.pay() signs only an offer that advertises Circle Gateway batching; against /402/pay it raised No Gateway batching option available for network eip155:84532 after one unpaid request and signed nothing, and no cell advertises that option" },
  { client: "x402-safe-fetch 0.9.0 (about 980)", reason: "pays a USD 0.001 pre-flight check to a third-party service before it pays any endpoint, so it sends the target URL to that service" },
  { client: "@alchemy/x402 0.6.6 (about 660)", reason: "built for the Alchemy gateway; its pay command takes a PAYMENT-REQUIRED header as an argument rather than fetching a URL" },
  { client: "@acedatacloud/x402-client (about 320)", reason: "supplies signatures to one vendor's SDK and is not a client of its own" },
  { client: "@atxp/x402, @b3dotfun/anyspend-x402-fetch, @fastxyz/x402-client, @payai/x402-fetch, @mingderwang/x402, @obul.ai/obulx, @bankofai/x402-cli (each under 130 downloads a week)", reason: "too few downloads to represent what developers use; not surveyed beyond their descriptions" },
  { client: "@coinbase/x402 2.1.0 (about 98,000)", reason: "the package's own description calls it the Coinbase facilitator package; it configures a facilitator and is not a client" },
  { client: "x402-reqwest 2.0.2 and x402-rs (Rust; about 2,500 and 760 downloads over 90 days)", reason: "needs a Rust toolchain this machine lacks" },
  { client: "purl (Rust command-line client, a few dozen release downloads)", reason: "ships only as a Rust program; this survey did not build or run it" },
  { client: "x402-axios 1.2.1 (npm latest)", reason: "cannot be installed: its dependency x402@^1.2.1 is not on npm (the roster uses 1.1.0)" },
];
const REQUESTS_RECORDED_BY = 'scripts/witness-recorder.mjs (a local recording reverse proxy: plain HTTP/1.1 from the client, verbatim to https://badhttp.dev over TLS; request budget 12)';
const CONTROL_ID = 'curl-raw';

// ---------- processes ----------
const live = new Set(); // child processes to reap on exit
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };
const reap = () => { for (const c of live) { killGroup(c.pid); try { c.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { reap(); process.exit(130); });

// An allow-listed environment: nothing of the operator's shell (credentials, proxy variables, TLS switches) reaches a child. Only a
// driver (extra.payerKey) gets the payer key.
function childEnv(home, roster, extra = {}) {
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir() };
  env.HOME = home; env.LC_ALL = 'C'; env.NO_COLOR = '1';
  env.XDG_CACHE_HOME = path.join(home, '.cache'); env.XDG_CONFIG_HOME = path.join(home, '.config'); env.XDG_DATA_HOME = path.join(home, '.local', 'share');
  if (roster?.env) Object.assign(env, roster.env());
  const { payerKey, ...rest } = extra;
  Object.assign(env, rest);
  if (payerKey) env.X402_WITNESS_PAYER_KEY = payerKey;
  return env;
}

// Runs argv in cwd with a wall cap on the whole process group (curl controls). Resolves with code/signal/timedOut/stdout/stderr/ms.
function runProcess(argv, { cwd, env, capMs = 30000 }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let out = ''; let err = ''; let timedOut = false; let spawnError = null; let ms = null; let code = null; let signal = null; let settled = false;
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    live.add(child);
    const keep = (s, d) => (s + d).slice(-65536);
    child.stdout.on('data', (d) => { out = keep(out, d); });
    child.stderr.on('data', (d) => { err = keep(err, d); });
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, capMs);
    const finish = () => {
      if (settled) return; settled = true; clearTimeout(timer); killGroup(child.pid); live.delete(child);
      resolve({ code, signal, timedOut, spawnError, stdout: out, stderr: err, ms: ms ?? Math.round(performance.now() - t0) });
    };
    child.on('error', (e) => { spawnError = e; });
    child.on('exit', (c, s) => { code = c; signal = s; ms = Math.round(performance.now() - t0); killGroup(child.pid); setTimeout(finish, 2000).unref(); });
    child.on('close', (c, s) => { if (code === null && signal === null) { code = c; signal = s; } finish(); });
  });
}

async function startRecorder(ndjson) {
  const child = spawn(process.execPath, [RECORDER, ndjson, BASE, '0', `--budget=${BUDGET}`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { PATH: process.env.PATH } });
  live.add(child);
  let buf = ''; let errText = '';
  child.stderr.on('data', (d) => { errText += d; });
  const url = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Fatal(`the recorder did not report READY: ${scrub(errText)}`)), 8000);
    child.stdout.on('data', (d) => { buf += d; const m = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', () => { clearTimeout(t); reject(new Fatal(`the recorder exited early: ${scrub(errText)}`)); });
  });
  child.removeAllListeners('exit');
  return {
    url,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) { live.delete(child); return; }
      await new Promise((resolve) => {
        const t = setTimeout(() => { killGroup(child.pid); resolve(); }, 8000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
        child.kill('SIGTERM');
      });
      live.delete(child);
    },
  };
}

// A user agent may carry a URL to the library's home page; a row may name no host but badhttp.dev, so such a URL is replaced by <url>.
const scrubUa = (ua) => (typeof ua === 'string' ? ua.replace(/https?:\/\/([a-z0-9.-]+)(?::\d+)?[^\s'"<>)]*/gi, (m, h) => (ALLOWED_HOSTS.includes(h.toLowerCase()) ? m : '<url>')) : ua);
const readExchanges = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.n - b.n)
  .map(({ t_start, ...rest }) => unloop({ ...rest, user_agent: scrubUa(rest.user_agent) }));

// A long-lived driver process speaking the line protocol. Lines are consumed in order; waitLine skips lines with another prefix.
function spawnDriver(argv, { cwd, env }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  live.add(child);
  const d = { child, pid: child.pid, buf: '', lines: [], err: '', exited: false, code: null, signal: null, spawnError: null, wake: null };
  const poke = () => { const w = d.wake; d.wake = null; if (w) w(); };
  child.stdin.on('error', () => { /* the driver went away: its exit says why */ });
  child.stdout.on('data', (chunk) => {
    d.buf += chunk;
    let i;
    while ((i = d.buf.indexOf('\n')) >= 0) { d.lines.push(d.buf.slice(0, i).replace(/\r$/, '')); d.buf = d.buf.slice(i + 1); }
    if (d.buf.length > 1 << 20) d.buf = d.buf.slice(-65536);
    poke();
  });
  child.stderr.on('data', (c) => { d.err = (d.err + c).slice(-65536); });
  child.on('error', (e) => { d.spawnError = e; d.exited = true; poke(); });
  // Let the last stdout bytes arrive before a process that has exited is called gone; a daemonized grandchild can hold the pipe open.
  child.on('exit', (c, s) => { d.code = c; d.signal = s; setTimeout(() => { if (d.buf.trim()) { d.lines.push(d.buf.trim()); d.buf = ''; } d.exited = true; poke(); }, 250); });
  d.send = (line) => { try { child.stdin.write(`${line}\n`); } catch { /* gone */ } };
  // Resolves { line } | { timeout: true } | { exited: true }
  d.waitLine = async (prefix, deadline) => {
    for (;;) {
      while (d.lines.length) { const l = d.lines.shift(); if (l === prefix || l.startsWith(`${prefix} `)) return { line: l }; }
      if (d.exited) return { exited: true };
      const left = deadline - performance.now();
      if (left <= 0) return { timeout: true };
      await new Promise((resolve) => { const t = setTimeout(resolve, left); d.wake = () => { clearTimeout(t); resolve(); }; });
    }
  };
  d.waitExit = async (ms) => {
    const deadline = performance.now() + ms;
    while (!d.exited && performance.now() < deadline) await new Promise((resolve) => { const t = setTimeout(resolve, Math.min(100, Math.max(1, deadline - performance.now()))); d.wake = () => { clearTimeout(t); resolve(); }; });
    return d.exited;
  };
  d.kill = () => { killGroup(d.pid); try { child.kill('SIGKILL'); } catch { /* gone */ } live.delete(child); };
  return d;
}


// ---------- RESULT / HELLO validation ----------
function parseHello(line) {
  let j;
  try { j = JSON.parse(line.slice(5)); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  for (const k of ['library', 'version', 'runtime', 'http', 'configuration', 'generation']) if (typeof j[k] !== 'string' || !j[k]) return { bad: `HELLO has no ${k}` };
  if (j.http !== '1.1') return { bad: `HELLO http is ${scrub(j.http)}, not 1.1` };
  if (!GENERATIONS.includes(j.generation)) return { bad: `HELLO generation is ${scrub(j.generation)}, not one of ${GENERATIONS.join('|')}` };
  return { library: scrub(j.library, { max: 80 }), version: scrub(j.version, { max: 160 }), runtime: scrub(j.runtime, { max: 120 }), generation: j.generation, configuration: scrub(j.configuration, { max: 600 }) };
}

function parseResult(line) {
  let j;
  try { j = JSON.parse(line.slice(6)); } catch { return { bad: 'RESULT is not JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { bad: 'RESULT is not an object' };
  const status = j.status === null || j.status === undefined ? null : j.status;
  if (status !== null && !(Number.isInteger(status) && status >= 100 && status <= 599)) return { bad: 'RESULT status is not an HTTP status or null' };
  if (!Number.isInteger(j.bytes) || j.bytes < 0) return { bad: 'RESULT bytes is not a non-negative integer' };
  let sha256 = typeof j.sha256 === 'string' ? j.sha256.toLowerCase() : '';
  if (j.bytes === 0 && (sha256 === '' || sha256 === EMPTY_SHA)) sha256 = EMPTY_SHA;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { bad: 'RESULT sha256 is not 64 hex digits' };
  if (j.bytes === 0 && sha256 !== EMPTY_SHA) return { bad: 'RESULT has bytes 0 and a sha256 of something else' };
  let error = null;
  if (j.error) error = { name: scrub(j.error.name ?? 'Error', { max: 80 }), message: scrub(j.error.message ?? '', { max: 300 }) };
  let exit = null;
  if (j.exit) exit = { code: Number.isInteger(j.exit.code) ? j.exit.code : null, stderr_tail: j.exit.stderr_tail ? scrub(j.exit.stderr_tail, { tail: true }) : null };
  return { caller: { status, bytes: j.bytes, sha256, error, library_says: boundJson(j.library_says), exit } };
}

// ---------- one client cell: fresh dir, recorder, driver, ONE paid fetch, retry on the edge's rate limit ----------
const isRefused = (e) => e.budget_refused === true;
// A client that hung up before any response byte arrived (its own timeout; status 0, client_aborted) saw nothing from the edge: that is an
// observation of the client, not a rate limit, and it carries no x-badhttp-version because no response existed.
const clientHungUp = (e) => e.client_aborted === true && e.status === 0 && e.upstream_error == null;
const edgeSuspect = (e) => !isRefused(e) && !clientHungUp(e) && (!e.x_badhttp_version || e.upstream_error != null);
async function clientAttempt(c, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x402w-'));
  tmpRoots.add(root);
  const work = path.join(root, 'work'); const home = path.join(root, 'home');
  fs.mkdirSync(work); fs.mkdirSync(home);
  const exFile = path.join(root, 'exchanges.ndjson');
  const probed = new Date().toISOString();
  const rec = await startRecorder(exFile);
  const out = { probed, hello: null, fetches: [], late: [], end: 'exited', wall_ms: 0, fail: null, stderr: '', driverExit: null };
  const seen = new Set();
  const drain = (fetchN) => {
    const fresh = readExchanges(exFile).filter((e) => !seen.has(e.n));
    return fresh.map((e) => { seen.add(e.n); const { n, ...rest } = e; return { n, fetch_n: fetchN, ...rest }; });
  };
  const d = spawnDriver(c.argv(), { cwd: work, env: childEnv(home, c, { X402_RECORDER: rec.url, payerKey: PAYER_KEY }) });
  const t0 = performance.now();
  const cellDeadline = t0 + CELL_CAP_MS;
  try {
    const h = await d.waitLine('HELLO', Math.min(t0 + HELLO_CAP_MS, cellDeadline));
    if (d.spawnError) { out.fail = { kind: 'spawn', detail: String(d.spawnError.code || d.spawnError.name) }; return out; }
    if (!h.line) { out.fail = { kind: h.exited ? 'exit-before-hello' : 'no-hello' }; return out; }
    const hello = parseHello(h.line);
    if (!hello || hello.bad) { out.fail = { kind: 'bad-hello', detail: hello?.bad || 'HELLO is not JSON' }; return out; }
    out.hello = hello;
    const url = `${rec.url}/402/${scenario}`;
    d.send(`FETCH ${url}`);
    const r = await d.waitLine('RESULT', Math.min(performance.now() + FETCH_CAP_MS, cellDeadline));
    await sleep(SETTLE_MS);
    const ex = drain(1);
    if (r.line) {
      const p = parseResult(r.line);
      if (p.bad) { out.fail = { kind: 'bad-result', detail: p.bad, n: 1 }; out.fetches.push({ n: 1, caller: null, exchanges: ex }); }
      else out.fetches.push({ n: 1, caller: p.caller, exchanges: ex });
    } else if (r.exited) {
      out.fail = { kind: 'exit-before-result', n: 1 }; out.fetches.push({ n: 1, caller: null, exchanges: ex });
    } else {
      // a cap fired with the driver alive: the fetch keeps what the recorder saw, and the caller is unknown
      out.end = 'harness-timeout'; out.fetches.push({ n: 1, caller: null, exchanges: ex, timed_out: true });
    }
    if (out.end === 'exited' && !out.fail) {
      d.send('QUIT');
      await d.waitExit(QUIT_WAIT_MS);
    }
  } finally {
    out.wall_ms = Math.round(performance.now() - t0);
    out.driverExit = { code: d.code, exited: d.exited };
    out.stderr = d.err;
    d.kill();
    await sleep(SETTLE_MS);
    out.late = drain(null).map(({ fetch_n, ...e }) => e);
    await rec.stop();
    const last = drain(null).map(({ fetch_n, ...e }) => e);
    out.late.push(...last);
    if (d.code === 2) out.fail ??= { kind: 'exit-2' };
    fs.rmSync(root, { recursive: true, force: true });
    tmpRoots.delete(root);
  }
  return out;
}

async function clientCell(c, scenario, state) {
  const label = `${c.id} ${scenario}`;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await clientAttempt(c, scenario);
    last = r;
    if (r.driverExit.code === 2 && !r.fail) r.fail = { kind: 'exit-2' };
    if (r.driverExit.code === 2 || (r.fail && ['exit-2', 'spawn', 'exit-before-hello', 'no-hello', 'bad-hello'].includes(r.fail.kind))) {
      throw new Fatal(`the ${c.id} driver failed before it could fetch on ${scenario} (${r.fail?.kind ?? 'exit-2'}${r.fail?.detail ? `: ${r.fail.detail}` : ''}; exit ${r.driverExit.code}): ${tailLines(r.stderr) || 'no stderr'}`);
    }
    if (r.hello) {
      if (!state.hello) state.hello = r.hello;
      else if (state.hello.configuration !== r.hello.configuration || state.hello.version !== r.hello.version || state.hello.library !== r.hello.library || state.hello.generation !== r.hello.generation) {
        throw new Fatal(`${c.id}: the HELLO line on ${scenario} differs from this client's first cell (configuration, version, library or generation); a client has one configuration`);
      }
    }
    const all = [...r.fetches.flatMap((f) => f.exchanges), ...r.late];
    if (ALLOW_NO_VERSION) for (const e of all) if (!isRefused(e) && !clientHungUp(e)) e.x_badhttp_version ??= 'local';
    const missing = all.filter(edgeSuspect);
    if (!missing.length) {
      if (r.fail) throw new Fatal(`the ${c.id} driver failed on ${scenario} (${r.fail.kind}${r.fail.detail ? `: ${r.fail.detail}` : ''}; exit ${r.driverExit.code}): ${tailLines(r.stderr) || 'no stderr'}`);
      if (!all.length) throw new Fatal(`the ${c.id} cell ${scenario} recorded no exchange at all: the client never reached the recorder (${r.fetches.map((f) => (f.caller ? `status ${f.caller.status ?? 'none'}, ${f.caller.bytes} bytes${f.caller.error ? `, ${f.caller.error.name}: ${f.caller.error.message}` : ''}` : 'no result')).join('; ') || 'no fetch'}; ${tailLines(r.stderr) || 'no stderr'})`);
      const want = `/402/${scenario}`;
      const other = all.find((e) => String(e.path_query).split('?')[0] !== want);
      if (other) throw new Fatal(`the ${c.id} cell ${scenario} requested ${scrub(String(other.path_query).split('?')[0])}: the driver or the client asked for another URL`);
      return { ...r, attempts: attempt, requestFailed: false };
    }
    if (attempt < MAX_ATTEMPTS) {
      logErr(`retrying ${label}: attempt ${attempt} saw ${missing.length} response${missing.length === 1 ? '' : 's'} without x-badhttp-version or with a recorded upstream_error (status ${missing.map((e) => e.status).join(',')}); the edge's rate limit is not an observation`);
      await sleep(RATE_WAIT_MS);
    }
  }
  logErr(`FAILED ${label}: the rate limit did not clear in ${MAX_ATTEMPTS} attempts; the row is written with no exchanges and request_failed`);
  return { ...last, fetches: [], late: [], end: 'exited', attempts: MAX_ATTEMPTS, requestFailed: true };
}

// ---------- controls: curl, through the recorder, no payment header ----------
async function controlAttempt(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x402w-'));
  tmpRoots.add(root);
  const work = path.join(root, 'work'); const home = path.join(root, 'home');
  fs.mkdirSync(work); fs.mkdirSync(home);
  const exFile = path.join(root, 'exchanges.ndjson');
  const probed = new Date().toISOString();
  const rec = await startRecorder(exFile);
  let proc;
  try {
    const argv = ['curl', '-sS', '--http1.1', '-D', 'headers.txt', '-o', 'body.bin', `${rec.url}/402/${scenario}`];
    proc = await runProcess(argv, { cwd: work, env: childEnv(home, null) });
  } finally {
    await rec.stop();
  }
  const exchanges = readExchanges(exFile);
  const read = (n) => { const p = path.join(work, n); return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null; };
  const raw = read('body.bin'); const headersTxt = read('headers.txt');
  fs.rmSync(root, { recursive: true, force: true });
  tmpRoots.delete(root);
  return { probed, proc, exchanges, raw, headersTxt };
}

async function observeControl(scenario) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await controlAttempt(scenario);
    last = r;
    if (ALLOW_NO_VERSION) for (const e of r.exchanges) e.x_badhttp_version ??= 'local';
    const missing = r.exchanges.filter((e) => !e.x_badhttp_version || e.upstream_error != null);
    if (!missing.length && r.exchanges.length) return { ...r, attempts: attempt };
    if (!r.exchanges.length) break;
    if (attempt < MAX_ATTEMPTS) {
      logErr(`retrying ${CONTROL_ID} ${scenario}: attempt ${attempt} saw a response without x-badhttp-version or with a recorded upstream_error (status ${missing.map((e) => e.status).join(',')}); the edge's rate limit is not an observation`);
      await sleep(RATE_WAIT_MS);
    }
  }
  throw new Fatal(`the control ${scenario} could not be fetched (${last?.exchanges?.length ? 'the rate limit did not clear' : 'the request never reached the recorder'}; curl exit ${last?.proc?.code}): there is no capture without its controls`);
}

// ---------- rows ----------
let VERSION_OBSERVED = null;
const url0 = (scenario) => `${BASE}/402/${scenario}`;
// What a dry run cannot hide: a machine path, loopback literal or port in a row. Against badhttp.dev it stops the capture; against a
// stand-in it is reported on stderr (the row's own url and the provenance base name the stand-in and are masked first).
let leaks = 0;
function checkRow(row) {
  const o = { ...row }; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; }
  let t = JSON.stringify(o);
  if (!REAL) t = t.split(BASE).join('https://badhttp.dev');
  const hit = MACHINE.test(t) ? 'a machine path or local host' : VERDICT_WORDS.test(t) ? 'a verdict word' : null;
  const ports = REAL ? [] : [...t.replace(/eip155:\d+/g, 'eip155').matchAll(/(?<=[\w\]]):(\d{4,5})\b/g)].map((m) => m[1]).filter((p) => !/^(?:19|20)\d\d$/.test(p));
  const foreign = [...t.matchAll(/\bhttps?:\/\/([a-z0-9.:-]+)/gi)].map((m) => m[1]).find((h) => !ALLOWED_HOSTS.includes(h.toLowerCase().replace(/:\d+$/, '')));
  if (REAL) {
    if (hit) throw new Fatal(`${row.id} carries ${hit} after scrubbing; the capture would be refused`);
    if (foreign) throw new Fatal(`${row.id} names the host ${foreign}`);
  } else if (hit || ports.length || foreign) {
    leaks++; logErr(`DRYRUN-LEAK ${row.id}: ${hit || (foreign ? `the host ${foreign}` : 'a port')} reached the row`);
  }
}
function emit(row) {
  if (keyHits) throw new Fatal('a string carrying the payer key was withheld earlier in this run; a driver or a library leaks it, and the capture must not be published');
  const o = { ...row }; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; }
  secretScan(o, '', row.id);
  checkRow(row);
  fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

const platform = execFileSync('uname', ['-sm'], { encoding: 'utf8' }).trim();
let CONTROL_META = null;

const sentOf = (e) => (e.x402?.payment_signature ? 'PS' : e.x402?.x_payment ? 'XP' : '');
const exLine = (ex) => (ex.length ? ex.map((e) => `${sentOf(e) ? `${sentOf(e)}→` : '→'}${e.status}${isRefused(e) ? 'b' : ''}`).join(' ') : 'none');

async function controlRow(scenario) {
  const r = await observeControl(scenario);
  if (r.proc.spawnError || r.proc.timedOut || r.proc.code !== 0) {
    throw new Fatal(`the control ${scenario} could not be fetched (curl exit ${r.proc.code}${r.proc.timedOut ? ', timed out' : ''}): there is no capture without its controls`);
  }
  if (r.exchanges.length !== 1) throw new Fatal(`the control ${scenario} made ${r.exchanges.length} requests, not one`);
  const e = r.exchanges[0];
  const statusLine = r.headersTxt ? /^HTTP\/1\.[01] (\d{3})/.exec(r.headersTxt.toString('latin1'))?.[1] : null;
  if (statusLine && Number(statusLine) !== e.status) throw new Fatal(`the control ${scenario}: curl saw status ${statusLine}, the recorder ${e.status}`);
  const raw = r.raw ?? Buffer.alloc(0);
  if (raw.length !== e.body_bytes || sha(raw) !== e.body_sha256) throw new Fatal(`the control ${scenario}: the body curl wrote does not match the recorder's (${raw.length} vs ${e.body_bytes} bytes)`);
  const pr = e.x402?.payment_required ?? { version: null, error: null, resource_url: null, accepts: null, accepts_count: null, decode_error: null, header_present: false };
  const row = {
    family: 'x402', id: `x402.${scenario}.offer-raw.${CONTROL_ID}`, corpus_id: `402/${flavorOf(scenario)}`, url: url0(scenario), method: 'GET', scenario, flavor: flavorOf(scenario), kind: 'offer-raw',
    probed: r.probed, badhttp_version: e.x_badhttp_version ?? null, client: CONTROL_META, attempts: r.attempts,
    fetches: null, exchanges: r.exchanges, exchanges_after_result: 0, budget_exhausted: false, end: 'exited', wall_ms: r.proc.ms,
    control: { status: e.status, raw_bytes: raw.length, raw_sha256: sha(raw), raw_base64: raw.toString('base64'), curl_exit: r.proc.code, offer: { ...pr, body_x402version: e.x402?.body_x402version ?? null } },
  };
  emit(row);
  process.stdout.write(`${CONTROL_ID} ${scenario} [${exLine(r.exchanges)}] raw=${raw.length}B attempts=${r.attempts}\n`);
  return e;
}

// ---------- main ----------
async function main() {
  for (const e of NOT_IN_ROSTER) if (e.reason.length < 20 || MACHINE.test(`${e.client} ${e.reason}`) || VERDICT_WORDS.test(`${e.client} ${e.reason}`)) throw new Fatal(`not_in_roster entry ${e.client} would be refused by the parser`);
  const wantScenarios = flags.scenarios ? flags.scenarios.split(',').filter(Boolean) : [...SCENARIO_ORDER];
  for (const s of wantScenarios) if (!SCENARIO_ORDER.includes(s)) throw new Fatal(`unknown scenario ${s}`);
  const scenarios = SCENARIO_ORDER.filter((s) => wantScenarios.includes(s));
  const wantClients = flags.clients ? flags.clients.split(',').filter(Boolean) : ROSTER.map((c) => c.id);
  for (const id of wantClients) if (!ROSTER.some((c) => c.id === id)) throw new Fatal(`unknown client ${id} (roster: ${ROSTER.map((c) => c.id).join(', ')})`);
  const clients = ROSTER.filter((c) => wantClients.includes(c.id));
  const subset = scenarios.length !== SCENARIO_ORDER.length || clients.length !== ROSTER.length;
  if (REAL && subset) throw new Fatal('a subset (--clients / --scenarios) is for dry runs against a stand-in only');

  // Preflight: every selected roster entry must exist before a single live request is made.
  for (const c of clients) for (const p of c.files()) if (!fs.existsSync(p)) throw new Fatal(`${c.id}: ${path.basename(p)} does not exist (see scripts/x402-witness/README.md)`);
  let curlVersion;
  try { curlVersion = scrub(execFileSync('curl', ['--version'], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH } }).split('\n')[0], { max: 160 }); } catch (e) { throw new Fatal(`curl --version failed: ${scrub(e.message)}`); }
  CONTROL_META = {
    id: CONTROL_ID, name: 'curl', role: 'control', class: 'raw', version: curlVersion, library: null, runtime: null, platform,
    invocation: 'curl -sS --http1.1 -D headers.txt -o body.bin <url> (no payment header, no payer)',
    configuration: 'curl with no payer, no state file and no cookie jar; one GET of the bare scenario URL per process; it never pays',
    generation: null, requests_recorded_by: REQUESTS_RECORDED_BY,
  };

  // Provenance.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(15000) });
    const j = await res.json();
    VERSION_OBSERVED = typeof j.version === 'string' ? j.version : null;
  } catch { VERSION_OBSERVED = null; }
  if (!VERSION_OBSERVED && !ALLOW_NO_VERSION) throw new Fatal('GET /health returned no version: badhttp is unreachable or rate-limiting');
  const prov = {
    capture: 'x402', probed: new Date().toISOString(), badhttp_version_observed: VERSION_OBSERVED, worker_version: process.env.WORKER_VERSION || null, base: BASE,
    scenarios_run: scenarios.length, cells_per_client: scenarios.length, clients_run: clients.length + 1, request_budget: BUDGET, scripts: 'scripts/x402-witness/',
    not_in_roster: NOT_IN_ROSTER,
    ...(subset ? { subset: true } : {}),
    note: 'One line per cell. Each client is started fresh in a fresh working directory with its payment wrapper configured with a throwaway Base Sepolia payer and asked to GET /402/{scenario} once; the harness never sends a payment header for a client. Every request goes through a local recording reverse proxy that forwards it verbatim to the server and returns the answer verbatim, so each fetch lists every request the client sent for it, in order, with the x402 headers decoded into a summary (never a raw signature), and caller is what the client handed back. After 12 upstream requests in one cell the proxy answers 503 itself (budget_refused). The curl-raw lines are the control: one unpaid GET per scenario, whose payment_required summary is the offer every client in that cell was shown; the parser derives the reference from it. Nothing here is a verdict.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(prov)}\n`);
  process.stdout.write(`provenance: badhttp ${VERSION_OBSERVED ?? 'unversioned'}, ${scenarios.length} scenarios, ${clients.length} clients + control${subset ? ' (SUBSET: dry run)' : ''}\n`);

  // Controls.
  let controlRows = 0;
  for (const s of scenarios) {
    await sleep(ROW_GAP_MS);
    await controlRow(s); controlRows++;
  }

  // Clients, one at a time.
  let rows = 0; let requestFailed = 0;
  for (const c of clients) {
    await sleep(CLIENT_GAP_MS);
    const state = { hello: null }; const buffered = [];
    try {
      for (const scenario of scenarios) {
        if (buffered.length) await sleep(ROW_GAP_MS);
        const r = await clientCell(c, scenario, state);
        const all = r.fetches.flatMap((f) => f.exchanges);
        const budgetExhausted = [...all, ...r.late].some(isRefused);
        const row = {
          family: 'x402', id: `x402.${scenario}.one-paid-fetch.${c.id}`, corpus_id: `402/${flavorOf(scenario)}`, url: url0(scenario), method: 'GET', scenario, flavor: flavorOf(scenario), kind: 'one-paid-fetch',
          probed: r.probed, badhttp_version: ([...all, ...r.late].find((e) => e.x_badhttp_version))?.x_badhttp_version ?? null, client: null, attempts: r.attempts,
          fetches: r.fetches, exchanges_after_result: r.late.length, budget_exhausted: budgetExhausted, end: r.end, wall_ms: r.wall_ms, control: null,
        };
        if (r.late.length) row.late_exchanges = r.late;
        if (r.requestFailed) row.request_failed = true;
        buffered.push(row);
        if (r.requestFailed) requestFailed++;
        const f = r.fetches[0];
        process.stdout.write(`${c.id} ${scenario} [${r.requestFailed ? 'request_failed' : `${exLine(f.exchanges)}${f.caller ? ` =${f.caller.status ?? f.caller.error?.name ?? '?'}/${f.caller.bytes}B` : f.timed_out ? ' =timeout' : ''}`}] attempts=${r.attempts} after=${r.late.length}${budgetExhausted ? ' budget_exhausted' : ''} ${r.end === 'harness-timeout' ? 'harness-timeout ' : ''}${(r.wall_ms / 1000).toFixed(1)}s\n`);
      }
    } finally {
      const h = state.hello;
      for (const row of buffered) {
        row.client = { id: c.id, name: c.name, role: 'client', class: c.class, version: h?.version ?? null, library: h?.library ?? null, runtime: h?.runtime ?? null, platform, invocation: c.invocation, configuration: h?.configuration ?? null, generation: h?.generation ?? null, requests_recorded_by: REQUESTS_RECORDED_BY };
        emit(row); rows++;
      }
    }
  }
  process.stdout.write(`done: ${rows + controlRows} rows written to the capture (${controlRows} controls), ${requestFailed} request_failed${leaks ? `, ${leaks} DRYRUN-LEAK` : ''}\n`);
}

main().catch((e) => {
  reap();
  logErr(`FAILED: ${e instanceof Fatal ? e.message : (e && e.stack) || e}`);
  logErr('FAILED: the harness could not run to the end; the capture is incomplete and must not be published');
  process.exit(e instanceof Fatal ? 3 : 4);
});

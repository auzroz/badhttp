#!/usr/bin/env node
// Capture orchestrator for the /etag witness family (docs/spec-etag-witness.md). Dependency-free, Node 22+.
//
//   node scripts/etag-witness/run.mjs <out.jsonl> [base=https://badhttp.dev] [--clients=a,b] [--flavors=x,y]
//
// The two filters are for DRY RUNS ONLY: scripts/etag-witness/all.sh never passes them, and a filtered capture is stamped
// `subset: true` in its provenance line (the parser demands the full grid and would refuse it anyway).
//
// What it does, in order (one request at a time, never in parallel: one IP, one zone rate limit):
//   1. line 1 of <out.jsonl>: the provenance line (capture "etag"; badhttp's /health version);
//   2. the controls, all through the recorder: per flavor a `cold-raw` row (curl, no conditional header), 1 s later a `revalidate-raw`
//      row (curl sending If-None-Match and/or If-Modified-Since copied verbatim from what cold-raw received, only those it received),
//      and for `mismatch` a `revalidate-adopted-raw` row (If-None-Match with the ETag the revalidate-raw 304 carried). One exchange each;
//   3. for each client in the roster, for each flavor: a fresh working directory and home, a fresh recorder (ephemeral port), the
//      client's driver started fresh in that directory, and three fetches of GET /etag/<flavor> through the client's cache, driven by
//      the FETCH / RESULT / QUIT protocol of scripts/etag-witness/drivers/README.md. The harness never sends a conditional header for
//      a client. Exchanges are attributed to the fetch they followed (fetch_n); a cap of 20 s per fetch and 60 s per cell is enforced
//      on the driver's whole process group.
//
// Rate limit: a row any of whose exchanges lacks x-badhttp-version (or records an upstream_error) is Cloudflare's edge, not an
// observation. The directory and cache are wiped, the harness waits 12 s and runs the cell again (3 attempts at most). A cell that
// never clears is written with `fetches: []`, `exchanges: []` and `request_failed: true`: an edge 429 is never recorded as an exchange.
//
// A driver that exits 2, prints no HELLO, exits before its RESULT, or whose cell recorded no exchange at all (when the cell was not
// rate-limited) is a broken install: the harness stops with exit 3 and the capture must not be published.
//
// Environment (all required by all.sh; this script asks only for what the selected clients use):
//   ETAG_VENV       a Python venv holding the Python cache libraries the roster uses (see scripts/etag-witness/README.md)
//   ETAG_NODEMODS   a dir holding node_modules with the Node cache libraries the roster uses
//   ETAG_GOTOOL     the built Go driver binary
//   ETAG_PROXIES    optional; a dir holding the proxy binaries' config templates (default scripts/etag-witness/proxies)
//   DRIVERS         the dir holding the drivers (default: scripts/etag-witness/drivers)
//   WORKER_VERSION  the wrangler deployment id, for provenance (optional)
//   ETAG_ALLOW_NO_VERSION=1  DRY RUNS ONLY, against a local stand-in whose responses carry no x-badhttp-version: disables the
//                   rate-limit retry and stamps x_badhttp_version "local". Refused when the base is badhttp.dev.
// Each driver is also given ETAG_RECORDER (the recorder's loopback origin for this cell) so a proxy driver can point its upstream at it.
//
// Exit status: 0 when the harness ran to the end (rows for clients that failed to answer are still exit 0); non-zero only when it could
// not run at all (a roster entry is missing, a driver failed, a control could not be fetched): the capture so far is left in place.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAVOR_ORDER } from '../witness-parse-etag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDER = path.join(HERE, '..', 'witness-recorder.mjs');
process.env.PATH = `/opt/homebrew/bin:${process.env.PATH || ''}`;

const FETCH_KINDS = ['cold', 'warm', 'warm-again'];
const HELLO_CAP_MS = 20000;
const FETCH_CAP_MS = 20000;
const CELL_CAP_MS = 60000;
const QUIT_WAIT_MS = 5000;
const SETTLE_MS = 300;
const RATE_WAIT_MS = 12000;
const MAX_ATTEMPTS = 3;
const ROW_GAP_MS = 1000;
const CLIENT_GAP_MS = 3000;
const ALLOW_NO_VERSION = process.env.ETAG_ALLOW_NO_VERSION === '1';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The parser's machine gate, except that 0.0.0.0 must not be a piece of a longer version number.
const MACHINE = /\/(Users|home|private|tmp|Volumes|var|opt|Library)\/|[A-Za-z]:\\\\|file:\/\/|localhost|127\.0\.0\.1|\[::1\]|(?<![\d.])0\.0\.0\.0(?![\d.])/;
const VERDICT_WORDS = /\b(correctly|incorrectly|conformant|non-compliant|noncompliant|violates|buggy|broken client|wrong client|passes|fails the spec)\b/i;
const ALLOWED_HOSTS = ['badhttp.dev', 'alt.badhttp.dev'];

// ---------- arguments ----------
class Fatal extends Error {}
const flags = {}; const pos = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
  else if (a.startsWith('--')) { process.stderr.write(`unknown option ${a}\n`); process.exit(2); } else pos.push(a);
}
for (const k of Object.keys(flags)) if (!['clients', 'flavors'].includes(k)) { process.stderr.write(`unknown option --${k}\n`); process.exit(2); }
const [OUT, BASE_ARG = 'https://badhttp.dev'] = pos;
if (!OUT) { process.stderr.write('usage: run.mjs <out.jsonl> [base] [--clients=a,b] [--flavors=x,y]\n'); process.exit(2); }
const BASE = new URL(BASE_ARG).origin;
const BASE_HOST = new URL(BASE).hostname;
const REAL = ALLOWED_HOSTS.includes(BASE_HOST);
if (ALLOW_NO_VERSION && REAL) {
  process.stderr.write('ETAG_ALLOW_NO_VERSION is for dry runs against a local stand-in and is refused for badhttp.dev\n');
  process.exit(2);
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && REAL) {
  process.stderr.write('NODE_TLS_REJECT_UNAUTHORIZED=0 is for dry runs against a local stand-in and is refused for badhttp.dev\n');
  process.exit(2);
}

// ---------- scrubbing: nothing a machine owns reaches a row or the log ----------
const tmpRoots = new Set();
function scrub(s, { tail = false, max = 200 } = {}) {
  let t = String(s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  for (const lit of tmpRoots) t = t.split(lit).join('<dir>');
  t = t.replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|(?<![\d.])0\.0\.0\.0(?![\d.]))(?::\d+)?[^\s'"<>)]*/gi, '<url>');
  t = t.replace(/https?:\/\/([a-z0-9.-]+)(?::\d+)?[^\s'"<>)]*/gi, (m, h) => (ALLOWED_HOSTS.includes(h.toLowerCase()) ? m : '<url>'));
  t = t.replace(/(?:127\.0\.0\.1|(?<![\d.])0\.0\.0\.0(?![\d.])|localhost)(?::\d+)?/gi, '<recorder>').replace(/\[::1\](?::\d+)?/g, '<recorder>');
  t = t.replace(/\bport \d+/gi, 'port <port>');
  t = t.replace(/\/(?:Users|home|private|tmp|Volumes|var|opt|Library|usr|etc|root)\b(?:\/[^\s'"():;,<>]*)*/g, '<path>');
  t = t.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (MACHINE.test(t) || VERDICT_WORDS.test(t)) return '<message withheld: it named a local path or address>';
  return t.length > max ? (tail ? t.slice(-max) : t.slice(0, max)) : t;
}
// The last three non-empty lines of a stream, scrubbed, at most 200 characters from the end. Stack frames and lone brackets are not
// the message.
const tailLines = (text) => {
  const lines = String(text || '').split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^at\s/.test(l) && !/^[[\]{}()]+$/.test(l)).slice(-3);
  return lines.length ? scrub(lines.join(' | '), { tail: true }) : null;
};
const logErr = (m) => process.stderr.write(`${scrub(m, { max: 400 })}\n`);
// A structured value from a driver (library_says): strings scrubbed, shape kept, size bounded.
function scrubJson(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return scrub(v, { max: 120 });
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 3) return scrub(JSON.stringify(v), { max: 120 });
  if (Array.isArray(v)) return v.slice(0, 8).map((x) => scrubJson(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 12).map(([k, x]) => [scrub(k, { max: 40 }), scrubJson(x, depth + 1)]));
  return null;
}

// ---------- roster ----------
const need = (k) => { const v = process.env[k]; if (!v) throw new Fatal(`${k} is not set (see scripts/etag-witness/README.md)`); return v; };
const DRIVERS = () => process.env.DRIVERS || path.join(HERE, 'drivers');
// `argv()` starts the driver (the URL arrives later on stdin); `invocation` is the same line for the row (no machine path);
// `files()` are what must exist; `env()` is extra environment the driver needs. Version, library, runtime and configuration come from
// the driver's HELLO line, never from here: the row names what the driver reported it handed the client.
// The roster is the survey's decision of 2026-10-12 (docs/survey-etag-clients-2026-10-12.md): 14 clients, in this order. A client's id
// is the id its driver is started with. Everything else the drivers ship or the survey measured is listed in NOT_IN_ROSTER below and
// printed on the index.
const cli = (id, name) => ({ id, name, class: 'cli-conditional', argv: () => ['node', path.join(DRIVERS(), 'cli.mjs'), id], invocation: `node cli.mjs ${id}`, files: () => [path.join(DRIVERS(), 'cli.mjs')] });
const nodeLib = (id, name) => ({ id, name, class: 'library-cache', argv: () => ['node', path.join(DRIVERS(), 'node-caches.mjs'), id], invocation: `node node-caches.mjs ${id}`, env: () => ({ ETAG_NODEMODS: need('ETAG_NODEMODS') }), files: () => [path.join(DRIVERS(), 'node-caches.mjs'), `${need('ETAG_NODEMODS')}/node_modules`] });
const pyLib = (id, name) => ({ id, name, class: 'library-cache', argv: () => [`${need('ETAG_VENV')}/bin/python`, '-I', path.join(DRIVERS(), 'py-caches.py'), id], invocation: `python -I py-caches.py ${id}`, files: () => [`${need('ETAG_VENV')}/bin/python`, path.join(DRIVERS(), 'py-caches.py')] });
const goLib = (id, name) => ({ id, name, class: 'library-cache', argv: () => [need('ETAG_GOTOOL'), id], invocation: `gotool ${id}`, files: () => [need('ETAG_GOTOOL')] });
const proxy = (id, name) => ({ id, name, class: 'proxy-cache', argv: () => ['node', path.join(DRIVERS(), 'proxy.mjs'), id], invocation: `node proxy.mjs ${id}`, env: () => (process.env.ETAG_PROXIES ? { ETAG_PROXIES: path.resolve(process.env.ETAG_PROXIES) } : {}), files: () => [path.join(DRIVERS(), 'proxy.mjs')] });
const ROSTER = [
  cli('curl-etag', 'curl --etag-compare / --etag-save'),
  cli('curl-z', 'curl -z'),
  cli('wget-N', 'GNU Wget -N'),
  pyLib('hishel', 'hishel'),
  pyLib('requests-cache-cc', 'requests-cache (cache_control=True)'),
  pyLib('cachecontrol', 'CacheControl'),
  nodeLib('undici-cache', 'undici'),
  nodeLib('make-fetch-happen', 'make-fetch-happen'),
  nodeLib('got-cache', 'got + cacheable-request'),
  goLib('gregjones-httpcache', 'gregjones/httpcache'),
  proxy('nginx-stale', 'nginx proxy_cache (proxy_ignore_headers Cache-Control, 1 s validity, revalidate)'),
  proxy('varnish', 'Varnish'),
  proxy('squid', 'Squid'),
  proxy('trafficserver', 'Apache Traffic Server (required_headers 0)'),
];
// Clients measured by the survey or shipped as drivers but not captured, each with the reason the index prints (provenance carries it).
const NOT_IN_ROSTER = [
  { client: 'requests-cache', reason: 'Same library as the roster entry, configured with its default cache_control=False; measured in the survey of 2026-10-12: it stores the response and never revalidates.' },
  { client: 'aiohttp-client-cache', reason: 'Measured in the survey of 2026-10-12: it stores every 200 and answers later fetches from the store with no request unless the caller sets refresh=True on the request.' },
  { client: 'aiohttp-client-cache (cache_control=True)', reason: 'Measured in the survey of 2026-10-12: same wire as its defaults; a response no-cache is not read and a conditional request goes out only on refresh=True.' },
  { client: 'axios-cache-interceptor', reason: 'Measured in the survey of 2026-10-12: with its defaults it sends its own request Cache-Control and Pragma and stores nothing from a no-cache response, so all three fetches are unconditional.' },
  { client: 'bartventer/httpcache', reason: 'Measured in the survey of 2026-10-12: the wire is identical to the roster Go client on all ten flavors, so it adds no row of its own to the index.' },
  { client: 'faraday-http-cache (Ruby)', reason: 'Measured in the survey of 2026-10-12: the wire matches the roster libraries that revalidate and a cold 304 is not stored; left out because the roster is capped at fourteen clients.' },
  { client: 'curl -z -R', reason: 'Measured in the survey of 2026-10-12: it takes the file time from Last-Modified when that parses; left out because the roster is capped at fourteen clients.' },
  { client: 'nginx proxy_cache (defaults)', reason: 'Measured in the survey of 2026-10-12: nginx with its defaults stores no response that carries no-cache; the roster entry ignores Cache-Control to make storage possible.' },
  { client: 'Apache Traffic Server (shipped defaults)', reason: 'Measured in the survey of 2026-10-12: with its shipped configuration it stores nothing from these responses; the roster entry sets required_headers 0 so that it stores them.' },
  { client: 'Varnish (custom VCL)', reason: 'A configuration, not a client: the roster entry uses the default VCL; other VCL variants were measured in the survey of 2026-10-12 and are not captured.' },
  { client: 'Chromium and Firefox caches', reason: 'There is no browser harness, so a browser cache cannot be driven through the recording proxy; the rows say nothing about how a browser revalidates.' },
  { client: 'pip downloader', reason: 'It uses CacheControl, which is a roster entry, so it would repeat that wire.' },
];
const REQUESTS_RECORDED_BY = 'scripts/witness-recorder.mjs (a local recording reverse proxy: plain HTTP/1.1 from the client, verbatim to https://badhttp.dev over TLS)';
const CONTROL_ID = 'curl-raw';

// ---------- processes ----------
const live = new Set(); // child processes to reap on exit
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };
const reap = () => { for (const c of live) { killGroup(c.pid); try { c.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { reap(); process.exit(130); });

function clientEnv(home, roster, extra = {}) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'ETAG_ALLOW_NO_VERSION']) delete env[k];
  env.HOME = home; env.LC_ALL = 'C'; env.NO_COLOR = '1';
  env.XDG_CACHE_HOME = path.join(home, '.cache'); env.XDG_CONFIG_HOME = path.join(home, '.config'); env.XDG_DATA_HOME = path.join(home, '.local', 'share');
  if (roster?.env) Object.assign(env, roster.env());
  Object.assign(env, extra);
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
  const child = spawn(process.execPath, [RECORDER, ndjson, BASE, '0'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

// A user agent may carry a URL to the library's home page (minipass-fetch names its repository on github.com); a row may name no host but
// badhttp.dev, so such a URL is replaced by <url>. Nothing else in an exchange is touched.
const scrubUa = (ua) => (typeof ua === 'string' ? ua.replace(/https?:\/\/([a-z0-9.-]+)(?::\d+)?[^\s'"<>)]*/gi, (m, h) => (ALLOWED_HOSTS.includes(h.toLowerCase()) ? m : '<url>')) : ua);
const readExchanges = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.n - b.n)
  .map(({ t_start, ...rest }) => ({ ...rest, user_agent: scrubUa(rest.user_agent) }));

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
  for (const k of ['library', 'version', 'runtime', 'http', 'configuration']) if (typeof j[k] !== 'string' || !j[k]) return { bad: `HELLO has no ${k}` };
  if (j.http !== '1.1') return { bad: `HELLO http is ${scrub(j.http)}, not 1.1` };
  return { library: scrub(j.library, { max: 80 }), version: scrub(j.version, { max: 160 }), runtime: scrub(j.runtime, { max: 120 }), configuration: scrub(j.configuration, { max: 400 }) };
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
  if (j.error) error = { name: scrub(j.error.name ?? 'Error', { max: 80 }), message: scrub(j.error.message ?? '', { max: 200 }) };
  let exit = null;
  if (j.exit) exit = { code: Number.isInteger(j.exit.code) ? j.exit.code : null, stderr_tail: j.exit.stderr_tail ? scrub(j.exit.stderr_tail, { tail: true }) : null };
  if (j.file_rewritten !== undefined && typeof j.file_rewritten !== 'boolean') return { bad: 'RESULT file_rewritten is not a boolean' };
  const caller = { status, bytes: j.bytes, sha256, error, library_says: scrubJson(j.library_says), exit };
  if (typeof j.file_rewritten === 'boolean') caller.file_rewritten = j.file_rewritten; // CLI drivers: the tool replaced the file on disk (a 200 body kept or discarded)
  return { caller };
}

// ---------- one client cell: fresh dir, recorder, driver, three fetches, retry on the edge's rate limit ----------
async function clientAttempt(c, flavor) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'etagw-'));
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
  const d = spawnDriver(c.argv(), { cwd: work, env: clientEnv(home, c, { ETAG_RECORDER: rec.url }) });
  const t0 = performance.now();
  const cellDeadline = t0 + CELL_CAP_MS;
  try {
    // HELLO
    const h = await d.waitLine('HELLO', Math.min(t0 + HELLO_CAP_MS, cellDeadline));
    if (d.spawnError) { out.fail = { kind: 'spawn', detail: String(d.spawnError.code || d.spawnError.name) }; return out; }
    if (!h.line) { out.fail = { kind: h.exited ? 'exit-before-hello' : 'no-hello' }; return out; }
    const hello = parseHello(h.line);
    if (!hello || hello.bad) { out.fail = { kind: 'bad-hello', detail: hello?.bad || 'HELLO is not JSON' }; return out; }
    out.hello = hello;
    // The three fetches
    const url = `${rec.url}/etag/${flavor}`;
    for (let i = 0; i < 3; i++) {
      const n = i + 1; const kind = FETCH_KINDS[i];
      if (out.end !== 'exited' || out.fail) { out.fetches.push({ n, kind, caller: null, exchanges: [], not_run: true }); continue; }
      if (performance.now() >= cellDeadline) { out.end = 'harness-timeout'; out.fetches.push({ n, kind, caller: null, exchanges: [], not_run: true }); continue; }
      d.send(`FETCH ${url}`);
      const r = await d.waitLine('RESULT', Math.min(performance.now() + FETCH_CAP_MS, cellDeadline));
      await sleep(SETTLE_MS);
      const ex = drain(n);
      if (r.line) {
        const p = parseResult(r.line);
        if (p.bad) { out.fail = { kind: 'bad-result', detail: p.bad, n }; out.fetches.push({ n, kind, caller: null, exchanges: ex }); continue; }
        out.fetches.push({ n, kind, caller: p.caller, exchanges: ex });
      } else if (r.exited) {
        out.fail = { kind: 'exit-before-result', n }; out.fetches.push({ n, kind, caller: null, exchanges: ex });
      } else {
        // a cap fired with the driver alive: the fetch keeps what the recorder saw, and the caller is unknown
        out.end = 'harness-timeout'; out.fetches.push({ n, kind, caller: null, exchanges: ex, timed_out: true });
      }
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

async function clientCell(c, flavor, state) {
  const label = `${c.id} ${flavor}`;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await clientAttempt(c, flavor);
    last = r;
    if (r.driverExit.code === 2 && !r.fail) r.fail = { kind: 'exit-2' };
    if (r.driverExit.code === 2 || (r.fail && ['exit-2', 'spawn', 'exit-before-hello', 'no-hello', 'bad-hello'].includes(r.fail.kind))) {
      throw new Fatal(`the ${c.id} driver failed before it could fetch on ${flavor} (${r.fail?.kind ?? 'exit-2'}${r.fail?.detail ? `: ${r.fail.detail}` : ''}; exit ${r.driverExit.code}): ${tailLines(r.stderr) || 'no stderr'}`);
    }
    if (r.hello) {
      if (!state.hello) state.hello = r.hello;
      else if (state.hello.configuration !== r.hello.configuration || state.hello.version !== r.hello.version || state.hello.library !== r.hello.library) {
        throw new Fatal(`${c.id}: the HELLO line on ${flavor} differs from this client's first cell (configuration, version or library); a client has one configuration`);
      }
    }
    const all = [...r.fetches.flatMap((f) => f.exchanges), ...r.late];
    if (ALLOW_NO_VERSION) for (const e of all) e.x_badhttp_version ??= 'local';
    const missing = all.filter((e) => !e.x_badhttp_version || e.upstream_error != null);
    if (!missing.length) {
      if (r.fail) throw new Fatal(`the ${c.id} driver failed on ${flavor} (${r.fail.kind}${r.fail.detail ? `: ${r.fail.detail}` : ''}${r.fail.n ? ` at fetch ${r.fail.n}` : ''}; exit ${r.driverExit.code}): ${tailLines(r.stderr) || 'no stderr'}`);
      if (!all.length) throw new Fatal(`the ${c.id} cell ${flavor} recorded no exchange at all: the client never reached the recorder (${r.fetches.map((f) => (f.caller ? `fetch ${f.n} status ${f.caller.status ?? 'none'}, ${f.caller.bytes} bytes${f.caller.error ? `, ${f.caller.error.name}: ${f.caller.error.message}` : ''}${f.caller.exit?.stderr_tail ? `, stderr ${f.caller.exit.stderr_tail}` : ''}` : `fetch ${f.n} no result`)).join('; ') || 'no fetch'}; ${tailLines(r.stderr) || 'no stderr'})`);
      const other = all.find((e) => e.x_badhttp_flavor && e.x_badhttp_flavor !== flavor);
      if (other) throw new Fatal(`the ${c.id} cell ${flavor} fetched /etag/${other.x_badhttp_flavor}: the driver asked for another URL`);
      return { ...r, attempts: attempt, requestFailed: false, late: r.late };
    }
    if (attempt < MAX_ATTEMPTS) {
      logErr(`retrying ${label}: attempt ${attempt} saw ${missing.length} response${missing.length === 1 ? '' : 's'} without x-badhttp-version or with a recorded upstream_error (status ${missing.map((e) => e.status).join(',')}); the edge's rate limit is not an observation`);
      await sleep(RATE_WAIT_MS);
    }
  }
  logErr(`FAILED ${label}: the rate limit did not clear in ${MAX_ATTEMPTS} attempts; the row is written with no exchanges and request_failed`);
  return { ...last, fetches: [], late: [], end: 'exited', attempts: MAX_ATTEMPTS, requestFailed: true };
}

// ---------- controls: curl, through the recorder ----------
async function controlAttempt(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'etagw-'));
  tmpRoots.add(root);
  const work = path.join(root, 'work'); const home = path.join(root, 'home');
  fs.mkdirSync(work); fs.mkdirSync(home);
  const exFile = path.join(root, 'exchanges.ndjson');
  const probed = new Date().toISOString();
  const rec = await startRecorder(exFile);
  let proc;
  try {
    const argv = ['curl', '-sS', '--http1.1', '-D', 'headers.txt', '-o', 'body.bin', ...spec.headers.flatMap(([k, v]) => ['-H', `${k}: ${v}`]), `${rec.url}/etag/${spec.flavor}`];
    proc = await runProcess(argv, { cwd: work, env: clientEnv(home, null) });
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

async function observeControl(spec) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await controlAttempt(spec);
    last = r;
    if (ALLOW_NO_VERSION) for (const e of r.exchanges) e.x_badhttp_version ??= 'local';
    const missing = r.exchanges.filter((e) => !e.x_badhttp_version || e.upstream_error != null);
    if (!missing.length && r.exchanges.length) return { ...r, attempts: attempt };
    if (!r.exchanges.length) break;
    if (attempt < MAX_ATTEMPTS) {
      logErr(`retrying ${spec.label}: attempt ${attempt} saw a response without x-badhttp-version or with a recorded upstream_error (status ${missing.map((e) => e.status).join(',')}); the edge's rate limit is not an observation`);
      await sleep(RATE_WAIT_MS);
    }
  }
  throw new Fatal(`the control ${spec.label} could not be fetched (${last?.exchanges?.length ? 'the rate limit did not clear' : 'the request never reached the recorder'}; curl exit ${last?.proc?.code}): there is no capture without its controls`);
}

// ---------- rows ----------
let VERSION_OBSERVED = null;
const url0 = (flavor) => `${BASE}/etag/${flavor}`;
// What a dry run cannot hide: a machine path, loopback literal or port in a row. Against badhttp.dev it stops the capture; against a
// stand-in it is reported on stderr (the row's own url and the provenance base name the stand-in and are masked first).
let leaks = 0;
function checkRow(row) {
  const o = { ...row }; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; }
  let t = JSON.stringify(o);
  if (!REAL) t = t.split(BASE).join('https://badhttp.dev');
  const hit = MACHINE.test(t) ? 'a machine path or local host' : VERDICT_WORDS.test(t) ? 'a verdict word' : null;
  const ports = REAL ? [] : [...t.matchAll(/(?<=[\w\]]):(\d{4,5})\b/g)].map((m) => m[1]).filter((p) => !/^(?:19|20)\d\d$/.test(p));
  const foreign = [...t.matchAll(/\bhttps?:\/\/([a-z0-9.:-]+)/gi)].map((m) => m[1]).find((h) => !ALLOWED_HOSTS.includes(h.toLowerCase().replace(/:\d+$/, '')));
  if (REAL) {
    if (hit) throw new Fatal(`${row.id} carries ${hit} after scrubbing; the capture would be refused`);
    if (foreign) throw new Fatal(`${row.id} names the host ${foreign}`);
  } else if (hit || ports.length || foreign) {
    leaks++; logErr(`DRYRUN-LEAK ${row.id}: ${hit || (foreign ? `the host ${foreign}` : 'a port')} reached the row`);
  }
}
function emit(row) { checkRow(row); fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`); }

const platform = execFileSync('uname', ['-sm'], { encoding: 'utf8' }).trim();
let CONTROL_META = null;

const sentOf = (e) => [e.if_none_match ? 'INM' : null, e.if_modified_since ? 'IMS' : null].filter(Boolean).join('+');
const exLine = (ex) => (ex.length ? ex.map((e) => `${sentOf(e) ? `${sentOf(e)}→` : '→'}${e.status}`).join(' ') : 'none');

async function controlRow(flavor, scenario, headers) {
  const r = await observeControl({ flavor, scenario, headers, label: `${CONTROL_ID} ${flavor}/${scenario}` });
  if (r.proc.spawnError || r.proc.timedOut || r.proc.code !== 0) {
    throw new Fatal(`the control ${flavor}/${scenario} could not be fetched (curl exit ${r.proc.code}${r.proc.timedOut ? ', timed out' : ''}): there is no capture without its controls`);
  }
  if (r.exchanges.length !== 1) throw new Fatal(`the control ${flavor}/${scenario} made ${r.exchanges.length} requests, not one`);
  const e = r.exchanges[0];
  const statusLine = r.headersTxt ? /^HTTP\/1\.[01] (\d{3})/.exec(r.headersTxt.toString('latin1'))?.[1] : null;
  if (statusLine && Number(statusLine) !== e.status) throw new Fatal(`the control ${flavor}/${scenario}: curl saw status ${statusLine}, the recorder ${e.status}`);
  const raw = r.raw ?? Buffer.alloc(0); // a 304 has no body: curl may not create the file at all
  if (raw.length !== e.body_bytes || sha(raw) !== e.body_sha256) throw new Fatal(`the control ${flavor}/${scenario}: the body curl wrote does not match the recorder's (${raw.length} vs ${e.body_bytes} bytes)`);
  const row = {
    family: 'etag', id: `etag.${flavor}.${scenario}.${CONTROL_ID}`, corpus_id: `etag.${flavor}`, url: url0(flavor), method: 'GET', flavor, scenario,
    probed: r.probed, badhttp_version: e.x_badhttp_version ?? null, client: CONTROL_META, attempts: r.attempts,
    fetches: null, exchanges: r.exchanges, exchanges_after_result: 0, end: 'exited', wall_ms: r.proc.ms,
    control: { raw_base64: raw.toString('base64'), raw_bytes: raw.length, raw_sha256: sha(raw), status: e.status, etag: e.etag, last_modified: e.last_modified, curl_exit: r.proc.code },
  };
  emit(row);
  process.stdout.write(`${CONTROL_ID} ${flavor}/${scenario} [${exLine(r.exchanges)}] raw=${raw.length}B attempts=${r.attempts}\n`);
  return e;
}

// ---------- main ----------
async function main() {
  for (const e of NOT_IN_ROSTER) if (e.reason.length < 20 || MACHINE.test(`${e.client} ${e.reason}`) || VERDICT_WORDS.test(`${e.client} ${e.reason}`)) throw new Fatal(`not_in_roster entry ${e.client} would be refused by the parser`);
  const wantFlavors = flags.flavors ? flags.flavors.split(',').filter(Boolean) : [...FLAVOR_ORDER];
  for (const f of wantFlavors) if (!FLAVOR_ORDER.includes(f)) throw new Fatal(`unknown flavor ${f}`);
  const flavors = FLAVOR_ORDER.filter((f) => wantFlavors.includes(f));
  const wantClients = flags.clients ? flags.clients.split(',').filter(Boolean) : ROSTER.map((c) => c.id);
  for (const id of wantClients) if (!ROSTER.some((c) => c.id === id)) throw new Fatal(`unknown client ${id} (roster: ${ROSTER.map((c) => c.id).join(', ')})`);
  const clients = ROSTER.filter((c) => wantClients.includes(c.id));
  const subset = flavors.length !== FLAVOR_ORDER.length || clients.length !== ROSTER.length;

  // Preflight: every selected roster entry must exist before a single live request is made.
  for (const c of clients) for (const p of c.files()) if (!fs.existsSync(p)) throw new Fatal(`${c.id}: ${path.basename(p)} does not exist (see scripts/etag-witness/README.md)`);
  let curlVersion;
  try { curlVersion = scrub(execFileSync('curl', ['--version'], { encoding: 'utf8', timeout: 20000 }).split('\n')[0], { max: 160 }); } catch (e) { throw new Fatal(`curl --version failed: ${scrub(e.message)}`); }
  CONTROL_META = {
    id: CONTROL_ID, name: 'curl', role: 'control', class: 'raw', version: curlVersion, library: null, runtime: null, platform,
    invocation: "curl -sS --http1.1 -D headers.txt -o body.bin [-H 'If-None-Match: <the ETag cold-raw received>'] [-H 'If-Modified-Since: <the Last-Modified cold-raw received>'] <url> (conditional headers on revalidate rows only, each only if the cold-raw response carried it; revalidate-adopted-raw sends the ETag the revalidate-raw 304 carried)",
    configuration: 'curl with no cache, no state file and no cookie jar; every request is a single curl process and every conditional header is copied verbatim from the earlier control response',
    requests_recorded_by: REQUESTS_RECORDED_BY,
  };

  // Provenance.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(15000) });
    const j = await res.json();
    VERSION_OBSERVED = typeof j.version === 'string' ? j.version : null;
  } catch { VERSION_OBSERVED = null; }
  if (!VERSION_OBSERVED && !ALLOW_NO_VERSION) throw new Fatal('GET /health returned no version: badhttp is unreachable or rate-limiting');
  const prov = {
    capture: 'etag', probed: new Date().toISOString(), badhttp_version_observed: VERSION_OBSERVED, worker_version: process.env.WORKER_VERSION || null, base: BASE,
    flavors_run: flavors.length, cells_per_client: flavors.length, clients_run: clients.length + 1, scripts: 'scripts/etag-witness/',
    not_in_roster: NOT_IN_ROSTER,
    ...(subset ? { subset: true } : {}),
    note: 'One line per cell. Each client is started fresh in a fresh working directory with an empty cache and asked to fetch GET /etag/{flavor} three times in a row through its cache; the harness never sends a conditional header for a client. Every request goes through a local recording reverse proxy that forwards it verbatim to the server and returns the answer verbatim, so each fetch lists every request the client sent for it, in order, and caller is what the client handed back. The curl-raw lines are the control: cold-raw sends no conditional header, revalidate-raw sends the ETag and the Last-Modified cold-raw received, verbatim, and revalidate-adopted-raw (mismatch only) sends the ETag the revalidate-raw 304 carried; the parser derives the reference and the document from their bytes. Nothing here is a verdict.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(prov)}\n`);
  process.stdout.write(`provenance: badhttp ${VERSION_OBSERVED ?? 'unversioned'}, ${flavors.length} flavors, ${clients.length} clients + control${subset ? ' (SUBSET: dry run)' : ''}\n`);

  // Controls.
  let controlRows = 0;
  for (const f of flavors) {
    await sleep(ROW_GAP_MS);
    const cold = await controlRow(f, 'cold-raw', []); controlRows++;
    await sleep(ROW_GAP_MS); // the revalidation is sent 1 s after the cold fetch
    const headers = [];
    if (cold.etag) headers.push(['If-None-Match', cold.etag]);
    if (cold.last_modified) headers.push(['If-Modified-Since', cold.last_modified]);
    const reval = await controlRow(f, 'revalidate-raw', headers); controlRows++;
    if (f === 'mismatch') {
      if (!reval.etag) throw new Fatal('mismatch/revalidate-raw carried no ETag: the revalidate-adopted-raw control cannot be built');
      await sleep(ROW_GAP_MS);
      await controlRow(f, 'revalidate-adopted-raw', [['If-None-Match', reval.etag]]); controlRows++;
    }
  }

  // Clients, one at a time.
  let rows = 0; let requestFailed = 0;
  for (const c of clients) {
    await sleep(CLIENT_GAP_MS);
    const state = { hello: null }; const buffered = [];
    try {
      for (const flavor of flavors) {
        if (buffered.length) await sleep(ROW_GAP_MS);
        const r = await clientCell(c, flavor, state);
        const all = r.fetches.flatMap((f) => f.exchanges);
        const row = {
          family: 'etag', id: `etag.${flavor}.three-fetches.${c.id}`, corpus_id: `etag.${flavor}`, url: url0(flavor), method: 'GET', flavor, scenario: 'three-fetches',
          probed: r.probed, badhttp_version: (all[0] ?? r.late[0])?.x_badhttp_version ?? null, client: null, attempts: r.attempts,
          fetches: r.fetches, exchanges_after_result: r.late.length, end: r.end, wall_ms: r.wall_ms, control: null,
        };
        if (r.requestFailed) row.request_failed = true;
        buffered.push(row);
        if (r.requestFailed) requestFailed++;
        process.stdout.write(`${c.id} ${flavor} [${r.requestFailed ? 'request_failed' : r.fetches.map((f) => (f.not_run ? 'not-run' : `${exLine(f.exchanges)}${f.caller ? ` =${f.caller.status ?? f.caller.error?.name ?? '?'}/${f.caller.bytes}B` : f.timed_out ? ' =timeout' : ''}`)).join(' | ')}] attempts=${r.attempts} after=${r.late.length} ${r.end === 'harness-timeout' ? 'harness-timeout ' : ''}${(r.wall_ms / 1000).toFixed(1)}s\n`);
      }
    } finally {
      // The client object is identical on every row of a client, including what the driver reported on its first HELLO.
      const h = state.hello;
      for (const row of buffered) {
        row.client = { id: c.id, name: c.name, role: 'client', class: c.class, version: h?.version ?? null, library: h?.library ?? null, runtime: h?.runtime ?? null, platform, invocation: c.invocation, configuration: h?.configuration ?? null, requests_recorded_by: REQUESTS_RECORDED_BY };
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

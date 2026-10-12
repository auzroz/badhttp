#!/usr/bin/env node
// Capture orchestrator for the /range witness family (docs/spec-range-witness.md). Dependency-free, Node 22+.
//
//   node scripts/range-witness/run.mjs <out.jsonl> [base=https://badhttp.dev] [--clients=a,b] [--flavors=x,y]
//
// The two filters are for DRY RUNS ONLY: scripts/range-witness/all.sh never passes them, and a filtered capture is stamped
// `subset: true` in its provenance line (the parser demands the full grid and would refuse it anyway).
//
// What it does, in order (one request at a time, never in parallel: one IP, one zone rate limit):
//   1. line 1 of <out.jsonl>: the provenance line (capture "range"; badhttp's /health version);
//   2. the `document` control row: curl, through a recording proxy, GET /range/ok?length=1000 with NO Range, raw body kept; its
//      first 400 bytes are the partial every resume cell starts from;
//   3. one `resume-raw` control row per flavor (curl sending exactly `Range: bytes=400-`) and one `fresh-raw` row at always-206
//      (curl, no Range). Each is one exchange;
//   4. for each resumer in the roster, for each of its 15 cells (14 flavors x resume, plus always-206 x fresh): a fresh working
//      directory with the partial written (or no file, for fresh), a fresh recorder (scripts/range-witness/recorder.mjs, ephemeral
//      port), the client pointed at the recorder's loopback URL with the flavor's path and query, a 30 s wall cap enforced on the
//      client's whole process group, the recorder stopped, and the row emitted. The loopback literal never reaches a row.
//
// Rate limit: a row any of whose exchanges lacks x-badhttp-version is Cloudflare's edge, not an observation. The directory is wiped,
// the harness waits 12 s and runs the cell again (3 attempts at most). A cell that never clears is written with `exchanges: []` and
// `request_failed: true`: an edge 429 is never recorded as an exchange.
//
// Environment (all required by all.sh; this script asks only for what the selected clients use):
//   RANGE_VENV      a Python venv holding httpie, huggingface_hub and yt-dlp (bin/http, bin/yt-dlp, bin/python)
//   RANGE_NODEMODS  a dir holding node_modules/node-downloader-helper and node_modules/nugget
//   RANGE_GOTOOL    the built Go driver binary (grab | getter), from scripts/range-witness/drivers/gotool
//   DRIVERS         the dir holding hf.py and ndh.cjs (default: scripts/range-witness/drivers)
//   WORKER_VERSION  the wrangler deployment id, for provenance (optional)
//   RANGE_ALLOW_NO_VERSION=1  DRY RUNS ONLY, against a local stand-in whose responses carry no x-badhttp-version: disables the
//                   rate-limit retry and stamps x_badhttp_version "local". Refused when the base is badhttp.dev.
//
// Exit status: 0 when the harness ran to the end (rows for clients that failed to answer are still exit 0); non-zero only when it could
// not run at all (a roster entry is missing, a driver failed, a control could not be fetched): the capture so far is left in place.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAVOR_ORDER, formatDocument } from '../witness-parse-range.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDER = path.join(HERE, 'recorder.mjs');
process.env.PATH = `/opt/homebrew/bin:${process.env.PATH || ''}`;

const DOC_LEN = 1000;
const PARTIAL_BYTES = 400;
const WALL_CAP_MS = 30000;
const RATE_WAIT_MS = 12000;
const MAX_ATTEMPTS = 3;
const ROW_GAP_MS = 1000;
const CLIENT_GAP_MS = 3000;
const ALLOW_NO_VERSION = process.env.RANGE_ALLOW_NO_VERSION === '1';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The parser's machine gate, except that 0.0.0.0 must not be a piece of a longer version number: yt-dlp's user agent says Chrome/150.0.0.0.
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
if (ALLOW_NO_VERSION && ALLOWED_HOSTS.includes(BASE_HOST)) {
  process.stderr.write('RANGE_ALLOW_NO_VERSION is for dry runs against a local stand-in and is refused for badhttp.dev\n');
  process.exit(2);
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && ALLOWED_HOSTS.includes(BASE_HOST)) {
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
// the message (nugget prints its error inside a bracketed stack).
const tailLines = (text) => {
  const lines = String(text || '').split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^at\s/.test(l) && !/^[[\]{}()]+$/.test(l)).slice(-3);
  return lines.length ? scrub(lines.join(' | '), { tail: true }) : null;
};
const logErr = (m) => process.stderr.write(`${scrub(m, { max: 400 })}\n`);

// ---------- roster ----------
const need = (k) => { const v = process.env[k]; if (!v) throw new Fatal(`${k} is not set (see scripts/range-witness/README.md)`); return v; };
const DRIVERS = () => process.env.DRIVERS || path.join(HERE, 'drivers');
// `cmd(url)` is the argv; `invocation` is the same line for the row (URL replaced, no machine path). `lib: true` clients are driven
// through a driver that prints a final `RESULT {json}` line (exit 0 library success, 1 library error, 2 driver failure).
const ROSTER = [
  { id: 'curl', name: 'curl', cmd: (u) => ['curl', '--http1.1', '-sS', '-C', '-', '-o', 'out.txt', u], invocation: 'curl --http1.1 -sS -C - -o out.txt <url>', versionCmd: () => ['curl', '--version'], files: () => [] },
  { id: 'wget', name: 'GNU Wget', cmd: (u) => ['wget', '-c', '-t', '1', '-O', 'out.txt', u], invocation: 'wget -c -t 1 -O out.txt <url>', versionCmd: () => ['wget', '--version'], files: () => [] },
  { id: 'wget2', name: 'GNU Wget2', cmd: (u) => ['wget2', '-c', '-t', '1', '--no-http2', '-O', 'out.txt', u], invocation: 'wget2 -c -t 1 --no-http2 -O out.txt <url>', versionCmd: () => ['wget2', '--version'], files: () => [] },
  { id: 'httpie', name: 'HTTPie', cmd: (u) => [`${need('RANGE_VENV')}/bin/http`, '--ignore-stdin', '--download', '--continue', '--output', 'out.txt', u], invocation: 'http --ignore-stdin --download --continue --output out.txt <url>', versionCmd: () => [`${need('RANGE_VENV')}/bin/http`, '--version'], files: () => [`${need('RANGE_VENV')}/bin/http`] },
  { id: 'yt-dlp', name: 'yt-dlp', partial: 'out.txt.part', cmd: (u) => [`${need('RANGE_VENV')}/bin/yt-dlp`, '--continue', '--retries', '0', '--fragment-retries', '0', '--no-progress', '--no-warnings', '--no-cache-dir', '--ignore-config', '-o', 'out.txt', u], invocation: 'yt-dlp --continue --retries 0 --fragment-retries 0 --no-progress --no-warnings --no-cache-dir --ignore-config -o out.txt <url>', versionCmd: () => [`${need('RANGE_VENV')}/bin/yt-dlp`, '--version'], files: () => [`${need('RANGE_VENV')}/bin/yt-dlp`] },
  { id: 'huggingface_hub', name: 'huggingface_hub', lib: true, cmd: (u) => [`${need('RANGE_VENV')}/bin/python`, '-I', path.join(DRIVERS(), 'hf.py'), u, 'out.txt'], invocation: 'python -I hf.py <url> out.txt', files: () => [`${need('RANGE_VENV')}/bin/python`, path.join(DRIVERS(), 'hf.py')] },
  { id: 'node-downloader-helper', name: 'node-downloader-helper', lib: true, nodePath: true, cmd: (u) => ['node', path.join(DRIVERS(), 'ndh.cjs'), u, '.'], invocation: 'node ndh.cjs <url> .', files: () => [path.join(DRIVERS(), 'ndh.cjs'), `${need('RANGE_NODEMODS')}/node_modules/node-downloader-helper`] },
  { id: 'nugget', name: 'nugget', cmd: (u) => ['node', `${need('RANGE_NODEMODS')}/node_modules/nugget/bin.js`, '-q', '-c', '-o', 'out.txt', '-d', '.', u], invocation: 'node nugget/bin.js -q -c -o out.txt -d . <url>', versionOf: () => JSON.parse(fs.readFileSync(`${need('RANGE_NODEMODS')}/node_modules/nugget/package.json`, 'utf8')).version, files: () => [`${need('RANGE_NODEMODS')}/node_modules/nugget/bin.js`] },
  { id: 'grab', name: 'grab', lib: true, cmd: (u) => [need('RANGE_GOTOOL'), 'grab', u, 'out.txt'], invocation: 'gotool grab <url> out.txt', files: () => [need('RANGE_GOTOOL')] },
  { id: 'go-getter', name: 'go-getter', lib: true, cmd: (u) => [need('RANGE_GOTOOL'), 'getter', u, 'out.txt'], invocation: 'gotool getter <url> out.txt', files: () => [need('RANGE_GOTOOL')] },
];
const REQUESTS_RECORDED_BY = 'scripts/range-witness/recorder.mjs (a local recording reverse proxy: plain HTTP/1.1 from the client, verbatim to https://badhttp.dev over TLS)';
const CONTROL_ID = 'curl-raw';

// ---------- processes ----------
const live = new Set(); // child processes to reap on exit
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };
const reap = () => { for (const c of live) { killGroup(c.pid); try { c.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', reap);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { reap(); process.exit(130); });

function clientEnv(home, roster) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'RANGE_ALLOW_NO_VERSION']) delete env[k];
  env.HOME = home; env.LC_ALL = 'C'; env.NO_COLOR = '1';
  if (roster?.nodePath) env.NODE_PATH = `${need('RANGE_NODEMODS')}/node_modules`;
  return env;
}

// Runs argv in cwd with a wall cap on the whole process group. Resolves with code/signal/timedOut/stdout/stderr/ms.
function runProcess(argv, { cwd, env, capMs = WALL_CAP_MS }) {
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

const readExchanges = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.n - b.n)
  .map(({ t_start, ...rest }) => rest);

// ---------- one observation: fresh dir, partial, recorder, client, retry on the edge's rate limit ----------
// spec: { flavor, scenario, partial (Buffer|null), partialName, fileNames [candidates], argv(url), roster?, isControl, label }
async function observe(spec) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rangew-'));
    tmpRoots.add(root);
    const work = path.join(root, 'work'); const home = path.join(root, 'home');
    fs.mkdirSync(work); fs.mkdirSync(home);
    if (spec.partial) fs.writeFileSync(path.join(work, spec.partialName), spec.partial);
    const exFile = path.join(root, 'exchanges.ndjson');
    const probed = new Date().toISOString();
    const rec = await startRecorder(exFile);
    let proc; let exchanges;
    try {
      proc = await runProcess(spec.argv(`${rec.url}/range/${spec.flavor}?length=${DOC_LEN}`), { cwd: work, env: clientEnv(home, spec.roster) });
      if (proc.timedOut) await sleep(300); // let the recorder see the aborted connection
    } finally {
      await rec.stop();
    }
    exchanges = readExchanges(exFile);
    let file = null; let fileName = spec.fileNames[0];
    for (const n of spec.fileNames) { const p = path.join(work, n); if (fs.existsSync(p) && fs.statSync(p).isFile()) { file = fs.readFileSync(p); fileName = n; break; } }
    const other = fs.readdirSync(work).filter((n) => !spec.fileNames.includes(n)).sort().slice(0, 8).map((n) => scrub(n, { max: 60 }));
    fs.rmSync(root, { recursive: true, force: true });
    tmpRoots.delete(root);

    if (ALLOW_NO_VERSION) for (const e of exchanges) e.x_badhttp_version ??= 'local';
    const missing = exchanges.filter((e) => !e.x_badhttp_version || e.upstream_error != null); // an upstream failure the recorder itself recorded is not the client's observation either
    last = { attempt, probed, proc, exchanges, file, fileName, other };
    if (!missing.length && exchanges.length) return { ...last, attempts: attempt, requestFailed: false };
    if (!exchanges.length) return { ...last, attempts: attempt, requestFailed: true }; // the client never reached the recorder: nothing to retry against
    if (attempt < MAX_ATTEMPTS) {
      logErr(`retrying ${spec.label}: attempt ${attempt} saw ${missing.length} response${missing.length === 1 ? '' : 's'} without x-badhttp-version or with a recorded upstream_error (status ${missing.map((e) => e.status).join(',')}); the edge's rate limit is not an observation`);
      await sleep(RATE_WAIT_MS);
    }
  }
  logErr(`FAILED ${spec.label}: the rate limit did not clear in ${MAX_ATTEMPTS} attempts; the row is written with no exchanges and request_failed`);
  return { ...last, exchanges: [], attempts: MAX_ATTEMPTS, requestFailed: true, rateLimited: true };
}

// ---------- rows ----------
let probedIso; let VERSION_OBSERVED = null;
const url0 = (flavor) => `${BASE}/range/${flavor}?length=${DOC_LEN}`;
const statusList = (ex) => (ex.length ? ex.map((e) => `${e.method === 'GET' ? '' : `${e.method}:`}${e.status}`).join(' ') : 'no-exchange');
function emit(row) {
  if (ALLOWED_HOSTS.includes(BASE_HOST)) { // a capture against badhttp.dev must pass the parser's machine gate; a dry run against a stand-in cannot
    const o = { ...row }; delete o.file_base64; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; }
    const t = JSON.stringify(o);
    if (MACHINE.test(t)) throw new Fatal(`${row.id} carries a machine path or local host after scrubbing; the capture would be refused`);
    for (const m of t.matchAll(/\bhttps?:\/\/([a-z0-9.:-]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase().replace(/:\d+$/, ''))) throw new Fatal(`${row.id} names the host ${m[1]}`);
  }
  fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

const platform = execFileSync('uname', ['-sm'], { encoding: 'utf8' }).trim();
let CONTROL_META = null;

async function controlRow(flavor, scenario, doc) {
  const withRange = scenario === 'resume-raw';
  const r = await observe({
    flavor, scenario, partial: null, fileNames: ['raw.bin'], isControl: true, label: `${CONTROL_ID} ${flavor}/${scenario}`,
    argv: (u) => ['curl', '-sS', '--http1.1', ...(withRange ? ['-H', `Range: bytes=${PARTIAL_BYTES}-`] : []), '-o', 'raw.bin', u],
  });
  if (r.requestFailed || r.proc.timedOut || r.proc.spawnError || r.proc.code !== 0 || !r.file) {
    throw new Fatal(`the control ${flavor}/${scenario} could not be fetched (curl exit ${r.proc.code}${r.proc.timedOut ? ', timed out' : ''}${r.requestFailed ? ', request failed' : ''}): there is no capture without its controls`);
  }
  const raw = r.file;
  const row = {
    family: 'range', id: `range.${flavor}.${scenario}.${CONTROL_ID}`, corpus_id: `range.${flavor}`, url: url0(flavor), method: 'GET', flavor, scenario,
    probed: r.probed, badhttp_version: r.exchanges[0]?.x_badhttp_version ?? null, client: CONTROL_META, attempts: r.attempts,
    partial_bytes: null, partial_sha256: null, exchanges: r.exchanges, exit: { code: r.proc.code, kind: 'exit-code', name: null }, reported_error: null,
    file: null, end: 'exited', wall_ms: r.proc.ms,
    control: { raw_base64: raw.toString('base64'), raw_bytes: raw.length, raw_sha256: sha(raw), curl_exit: r.proc.code },
  };
  if (doc && scenario === 'document' && !raw.equals(doc)) throw new Fatal('the document control is not the 1,000-byte document the format in src/range.js describes; refusing to continue');
  emit(row);
  process.stdout.write(`${CONTROL_ID} ${flavor}/${scenario} [${statusList(r.exchanges)}] raw=${raw.length}B attempts=${r.attempts}\n`);
  return raw;
}

function parseResult(stdout, exitCode) {
  const last = String(stdout || '').split(/\r?\n/).filter((l) => l.startsWith('RESULT')).at(-1);
  if (!last) return null;
  const rest = last.slice(6).trim();
  try { const j = JSON.parse(rest); if (j && typeof j === 'object' && !Array.isArray(j)) return { structured: true, ...j }; } catch { /* a driver from before the contract */ }
  return { structured: false, ok: exitCode === 0, kind: null, name: null, message: rest, library: null, version: null, runtime: null };
}

async function clientCell(c, meta, flavor, scenario, partial) {
  const label = `${c.id} ${flavor}/${scenario}`;
  const r = await observe({
    flavor, scenario, partial: scenario === 'resume' ? partial : null, partialName: c.partial || 'out.txt',
    fileNames: ['out.txt', 'out.txt.part'], roster: c, label, argv: (u) => c.cmd(u),
  });
  const { proc } = r;
  const timedOut = proc.timedOut;
  let exit; let reported = null; let result = null;
  if (c.lib) {
    result = parseResult(proc.stdout, proc.code);
    if (!timedOut && !r.rateLimited && (proc.spawnError || !result || proc.code === 2)) {
      throw new Fatal(`the ${c.id} driver failed on ${flavor}/${scenario} (exit ${proc.code}${proc.spawnError ? `, ${proc.spawnError.code}` : ''}${result ? '' : ', no RESULT line'}): ${tailLines(proc.stderr) || 'no stderr'}`);
    }
    const kind = result && ['return', 'raised'].includes(result.kind) ? result.kind : 'exit-code';
    exit = { code: proc.code, kind, name: result?.name ?? (proc.signal || null) };
    if (!timedOut && result && (result.ok === false || proc.code !== 0)) reported = scrub(result.message || result.name || tailLines(proc.stderr) || '');
    if (result?.structured) { meta.library ??= result.library ?? null; meta.version ??= result.version ?? null; meta.runtime ??= result.runtime ?? null; }
  } else {
    if (proc.spawnError) throw new Fatal(`${c.id} could not be started: ${proc.spawnError.code}`);
    exit = { code: proc.code, kind: 'exit-code', name: proc.signal || null };
    if (!timedOut && proc.code !== 0) reported = tailLines(proc.stderr);
  }
  if (reported === '') reported = null;
  const buf = r.file;
  const file = { name: r.fileName, bytes: buf ? buf.length : 0, sha256: sha(buf || Buffer.alloc(0)), equals_document: !!buf && buf.equals(DOC), present: !!buf };
  if (r.other.length) file.other_files = r.other;
  const row = {
    family: 'range', id: `range.${flavor}.${scenario}.${c.id}`, corpus_id: `range.${flavor}`, url: url0(flavor), method: 'GET', flavor, scenario,
    probed: r.probed, badhttp_version: r.exchanges[0]?.x_badhttp_version ?? null, client: meta, attempts: r.attempts,
    partial_bytes: scenario === 'resume' ? PARTIAL_BYTES : 0, partial_sha256: scenario === 'resume' ? sha(partial) : sha(Buffer.alloc(0)),
    exchanges: r.exchanges, exit, reported_error: reported, file, file_base64: buf ? buf.toString('base64') : null,
    end: timedOut ? 'harness-timeout' : 'exited', wall_ms: proc.ms, control: null,
  };
  if (r.requestFailed) row.request_failed = true;
  return { row, line: `${c.id} ${flavor}/${scenario} [${statusList(r.exchanges)}] file=${file.present ? `${file.bytes}B` : 'absent'} attempts=${r.attempts} ${timedOut ? 'harness-timeout ' : ''}${(proc.ms / 1000).toFixed(1)}s` };
}

// ---------- main ----------
let DOC = null;
async function main() {
  const wantFlavors = flags.flavors ? flags.flavors.split(',').filter(Boolean) : [...FLAVOR_ORDER];
  for (const f of wantFlavors) if (!FLAVOR_ORDER.includes(f)) throw new Fatal(`unknown flavor ${f}`);
  const flavors = FLAVOR_ORDER.filter((f) => wantFlavors.includes(f));
  const wantClients = flags.clients ? flags.clients.split(',').filter(Boolean) : ROSTER.map((c) => c.id);
  for (const id of wantClients) if (!ROSTER.some((c) => c.id === id)) throw new Fatal(`unknown client ${id} (roster: ${ROSTER.map((c) => c.id).join(', ')})`);
  const clients = ROSTER.filter((c) => wantClients.includes(c.id));
  const subset = flavors.length !== FLAVOR_ORDER.length || clients.length !== ROSTER.length;
  const cells = flavors.map((f) => [f, 'resume']); if (flavors.includes('always-206')) cells.push(['always-206', 'fresh']);

  // Preflight: every selected roster entry must exist before a single live request is made.
  const meta = new Map();
  for (const c of clients) {
    for (const p of c.files()) if (!fs.existsSync(p)) throw new Fatal(`${c.id}: ${path.basename(p)} does not exist (see scripts/range-witness/README.md)`);
    let version = null;
    if (c.versionOf) version = scrub(String(c.versionOf()), { max: 160 }) || null; // nugget has no --version flag: its package.json says
    else if (!c.lib) {
      const vc = c.versionCmd();
      let out;
      try { out = execFileSync(vc[0], vc.slice(1), { encoding: 'utf8', timeout: 20000, env: clientEnv(os.tmpdir(), c), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { throw new Fatal(`${c.id}: --version failed: ${scrub(e.message)}`); }
      version = scrub(out.split('\n').find((l) => l.trim()) || '', { max: 160 }) || null;
    }
    if (!c.lib && !version) throw new Fatal(`${c.id}: no version could be read`);
    meta.set(c.id, { id: c.id, name: c.name, role: 'client', class: 'resumer', version, library: null, runtime: null, platform, invocation: c.invocation, requests_recorded_by: REQUESTS_RECORDED_BY });
  }
  let curlVersion;
  try { curlVersion = scrub(execFileSync('curl', ['--version'], { encoding: 'utf8', timeout: 20000 }).split('\n')[0], { max: 160 }); } catch (e) { throw new Fatal(`curl --version failed: ${scrub(e.message)}`); }
  CONTROL_META = { id: CONTROL_ID, name: 'curl', role: 'control', class: 'raw', version: curlVersion, library: null, runtime: null, platform, invocation: "curl -sS --http1.1 [-H 'Range: bytes=400-'] -o raw.bin <url> (the Range header on resume-raw rows only)", requests_recorded_by: REQUESTS_RECORDED_BY };

  // Provenance.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(15000) });
    const j = await res.json();
    VERSION_OBSERVED = typeof j.version === 'string' ? j.version : null;
  } catch { VERSION_OBSERVED = null; }
  if (!VERSION_OBSERVED && !ALLOW_NO_VERSION) throw new Fatal('GET /health returned no version: badhttp is unreachable or rate-limiting');
  probedIso = new Date().toISOString();
  const prov = {
    capture: 'range', probed: probedIso, badhttp_version_observed: VERSION_OBSERVED, worker_version: process.env.WORKER_VERSION || null, base: BASE,
    flavors_run: flavors.length, cells_per_client: cells.length, clients_run: clients.length + 1, scripts: 'scripts/range-witness/',
    ...(subset ? { subset: true } : {}),
    note: 'One line per cell. Each resumer is given a fresh working directory holding the first 400 bytes of the 1,000-byte document (none for the fresh cell) and told to resume it from GET /range/{flavor}?length=1000; the harness never sends a Range header itself. Every request goes through a local recording reverse proxy that forwards it verbatim to the server and returns the answer verbatim, so exchanges is every request the client sent, in order. file is what was on disk afterwards. The curl-raw lines are the control: resume-raw sends exactly Range: bytes=400-, fresh-raw sends no Range, and the document line fetches /range/ok whole; the parser derives the reference placement and the true document from their bytes. Nothing here is a verdict.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(prov)}\n`);
  process.stdout.write(`provenance: badhttp ${VERSION_OBSERVED ?? 'unversioned'}, ${flavors.length} flavors, ${clients.length} clients + control${subset ? ' (SUBSET: dry run)' : ''}\n`);

  // Controls.
  DOC = await controlRow('ok', 'document', formatDocument(DOC_LEN));
  const partial = DOC.subarray(0, PARTIAL_BYTES);
  for (const f of flavors) {
    await sleep(ROW_GAP_MS);
    await controlRow(f, 'resume-raw', null);
    if (f === 'always-206') { await sleep(ROW_GAP_MS); await controlRow(f, 'fresh-raw', null); }
  }

  // Clients, one at a time.
  let rows = 0; let requestFailed = 0;
  for (const c of clients) {
    await sleep(CLIENT_GAP_MS);
    const m = meta.get(c.id); const buffered = [];
    try {
      for (const [flavor, scenario] of cells) {
        if (buffered.length) await sleep(ROW_GAP_MS);
        const { row, line } = await clientCell(c, m, flavor, scenario, partial);
        buffered.push(row);
        process.stdout.write(`${line}\n`);
        if (row.request_failed) requestFailed++;
      }
    } finally {
      // The client object is identical on every row of a client, including the version a driver reported on its first RESULT.
      for (const row of buffered) { row.client = { ...m }; emit(row); rows++; }
    }
  }
  process.stdout.write(`done: ${rows + 1 + flavors.length + (flavors.includes('always-206') ? 1 : 0)} rows written to the capture, ${requestFailed} request_failed\n`);
}

main().catch((e) => {
  reap();
  logErr(`FAILED: ${e instanceof Fatal ? e.message : (e && e.stack) || e}`);
  logErr('FAILED: the harness could not run to the end; the capture is incomplete and must not be published');
  process.exit(e instanceof Fatal ? 3 : 4);
});

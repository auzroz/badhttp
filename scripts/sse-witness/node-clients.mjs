#!/usr/bin/env node
// Node witness harness for the /sse family of /clients.jsonl (docs/spec-sse-witness.md). Two `eventsource`-class
// clients, one JSON line per (client, flavor) on stdout (one process.stdout.write per row), progress on stderr
// (a line ends in " ok" when the row landed):
//   node-eventsource  Node's built-in EventSource (the undici implementation bundled in node, behind --experimental-eventsource)
//   eventsource-npm   the npm `eventsource` package (5.x), over Node's global fetch
//
//   NODE_PATH=<dir>/node_modules node scripts/sse-witness/node-clients.mjs [base]     SSE_FLAVORS="ok cut" limits a dry run
//
// Setup (outside the repo; nothing is added to package.json):  mkdir -p "$DIR" && cd "$DIR" && npm init -y && npm install eventsource
// `eventsource` is the only package this file loads; the built-in EventSource needs no install. (The `undici` npm package
// carries the same lib/web/eventsource code as the one bundled in node 26.10.0 -- 8.11.2 vs 8.10.2, same parser, same
// reconnect logic -- but it is not used: the roster entry is "Node built-in EventSource".)
// Node 26 does not expose the global without `--experimental-eventsource`. all.sh runs plain `node`, so this file
// re-executes itself once with that flag (and --disable-warning=UNDICI-ES, which silences only undici's one-line
// "EventSource is experimental" notice) when the global is absent. The row's invocation says so.
//
// ---------- what each library does, from the installed sources (cited so the next reader can re-verify) ----------
// node-eventsource: undici lib/web/eventsource/eventsource.js (+ eventsource-stream.js) -- read from the node binary
//   (process.binding('natives')['internal/deps/undici/undici'], undici 8.10.2) and from the npm package 8.11.2.
//   * Server close vs transport error. Both are an `error` Event with no data, and the only difference is readyState:
//     #connect() sets fetchParams.processResponseEndOfBody; when the body ends (or the pipeline errors) and the response
//     is not a network error it calls #reconnect(), which sets readyState CONNECTING and dispatches Event('error'), then
//     waits state.reconnectionTime. A network error before headers also goes to #reconnect() (CONNECTING); only
//     `response.aborted`, a status other than 200, a Content-Type whose MIME essence is not text/event-stream, or a
//     pipeline error with error.aborted === false call this.close() (readyState CLOSED) and then dispatch Event('error').
//     So: CONNECTING = a reconnect is scheduled (the server closed OR the transport failed), CLOSED = failed for good
//     (wrong-type, a 204, any non-200). The event itself carries no message and no code.
//   * Counting connections and Last-Event-ID. The EventSource init dict takes an undici-only `dispatcher` (also
//     `node.dispatcher`): #dispatcher is passed to fetching({request, dispatcher}). The harness gives it a fresh
//     Agent {allowH2:false} (HTTP/1.1 forced) composed with an interceptor (Dispatcher.compose), so every attempt is
//     one dispatch(opts, handler) call: opts.headers carries last-event-id when the library sent it (#reconnect() sets
//     it on the request header list from state.lastEventId), the handler's onResponseStart/onResponseEnd/
//     onResponseError give status, headers and how the response ended.
//   * retry and lastEventId. state = {lastEventId, reconnectionTime} is a private field (#state): processEvent()
//     in eventsource-stream.js updates it from `retry:` and `id:` lines but neither is exposed on the instance, so
//     retry_ms_adopted and last_event_id_final are null. The only visible lastEventId is on each MessageEvent
//     (state.lastEventId at dispatch), which is what an event's `id` records here.
//   * Wrong Content-Type: processResponse() in #connect() parses the header with parseMIMEType and, when the essence
//     is not text/event-stream or the status is not 200, calls this.close() and dispatches Event('error'): CLOSED.
//   * A named "error" event: processEvent() pushes {type: event.event || 'message', options: {data, lastEventId,
//     origin}} and the push callback dispatches createFastMessageEvent(type, options), so a stream event named
//     "error" is a MessageEvent whose type is 'error' and arrives at addEventListener('error') / onerror beside the
//     bare Event('error') signals above. It is told apart only by carrying data / lastEventId.
//   * Unterminated data at EOF is never dispatched (the Transform has no flush()); a retry-only block dispatches
//     nothing (processEvent() pushes only when event.data !== undefined).
// eventsource-npm: eventsource 5.1.2 src/EventSource.ts (dist/EventSource.js), parser eventsource-parser 4.1.1.
//   * Server close vs transport error. #onFetchResponse() reads body.getReader(); when read() reports done it calls
//     #scheduleReconnect() with NO message: readyState CONNECTING, ErrorEvent('error') with message undefined. When
//     read() or fetch() rejects, #onFetchError() calls #scheduleReconnect(flattenError(err)): CONNECTING, ErrorEvent
//     with message e.g. "TypeError: terminated: SocketError: other side closed". #failConnection(message, code)
//     (CLOSED, then ErrorEvent with message and code) is used for status 204 ("Server sent HTTP 204, not
//     reconnecting", code 204), any other non-200 status, and a Content-Type that does not startsWith
//     'text/event-stream'. An AbortError after close() is swallowed.
//   * Counting connections and Last-Event-ID. The constructor takes `fetch` (FetchLike): #connect() calls
//     this.#fetch(url, #getRequestOptions()) once per attempt; init.headers is a plain object {Accept, 'Last-Event-ID'?}
//     (the header is present only when #lastEventId is non-empty). The harness's wrapper counts each call, forwards it
//     to Node's global fetch with a per-row Agent {allowH2:false}, and re-wraps response.body so it can see whether the
//     body ended (done), was reset (read() rejected) or was cancelled.
//   * retry and lastEventId. #reconnectInterval (set by #onRetryChange) and #lastEventId (set by #onIdChange when a
//     block with an id field is terminated) are private; the only visible lastEventId is the one on each MessageEvent
//     (#onEvent reads the persisted buffer). retry_ms_adopted and last_event_id_final are null.
//   * A named "error" event: #onEvent() builds new MessageEvent(event.event || 'message', {data, origin,
//     lastEventId}) and dispatches it, so type 'error' lands on the same 'error' listeners as the library's own
//     ErrorEvent (which has .message/.code and no data).
//   * Unterminated data at EOF: #parser.reset() on done discards it.
// How the harness sees events (both): EventSource has no wildcard listener, so each instance's dispatchEvent is wrapped
// (own property) and the ORIGINAL is still called. An event with a `lastEventId` property is a delivered event,
// recorded as {type, id, data}; type 'error' with a `lastEventId` is a stream event named "error": it is recorded in events[] in sequence AND, because it reaches the
// caller on the same listener as a transport failure, in errors[] with had_data true; type 'error'
// without one is the interface's own error signal (had_data false) and es.readyState decides what it means.
// Both libraries unref() their reconnect timers, so each row holds a ref'd 30 s watchdog; it fires harness-timeout.
//
// Per row (fresh EventSource, fresh Agent): GET /sse/{flavor} with default parameters. Every flavor but resume:
// close the instance on the first error signal -- readyState CONNECTING => end "reconnecting", CLOSED => end "error".
// resume: let it reconnect (retry: 1000) until it stops on the 204 (CLOSED, last connection status 204 => "stopped")
// or six connections have been made ("closed-by-harness"). Pacing: 1 s between rows, 3 s between clients. A row
// whose connections lack x-badhttp-version (Cloudflare's limiter) is retried after 12 s, attempts <= 3, and is never
// recorded as an observation; after three it is emitted with request_failed.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dc from 'node:diagnostics_channel';

// ---------- the built-in EventSource is behind a flag in node 26: re-execute once with it ----------
if (typeof globalThis.EventSource !== 'function') {
  if (process.env.SSE_NODE_REEXEC) {
    console.error('node-clients: this node has no EventSource even with --experimental-eventsource; node 26 or newer is required');
    process.exit(2);
  }
  const r = spawnSync(process.execPath, ['--experimental-eventsource', '--disable-warning=UNDICI-ES', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, SSE_NODE_REEXEC: '1' } });
  process.exit(r.status ?? 1);
}

const B = (process.argv[2] || 'https://badhttp.dev').replace(/\/+$/, '');
const ALL = ['ok', 'stall', 'cut', 'drop', 'crlf', 'cr', 'no-space', 'multiline', 'comments', 'split-utf8', 'wrong-type', 'error-event', 'big', 'resume'];
const ORDER = process.env.SSE_FLAVORS ? process.env.SSE_FLAVORS.split(/[ ,]+/).filter(Boolean) : ALL;
const CAP_MS = 30000; // per-row wall cap
const MAX_CONNS = 6; // resume: stop letting it reconnect after this many connections
const RS = ['connecting', 'open', 'closed'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- load the npm package from NODE_PATH (nothing is added to package.json) ----------
const req = createRequire(import.meta.url);
function pkgVersion(name, from = req) {
  try {
    let d = dirname(from.resolve(name));
    for (let i = 0; i < 8; i++, d = dirname(d)) {
      const p = join(d, 'package.json');
      if (existsSync(p)) { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.name === name) return j.version; }
    }
  } catch { /* fall through */ }
  return null;
}
let NpmEventSource, esNpmVersion, parserVersion;
try {
  const resolved = req.resolve('eventsource');
  ({ EventSource: NpmEventSource } = await import(pathToFileURL(resolved).href));
  esNpmVersion = pkgVersion('eventsource');
  parserVersion = pkgVersion('eventsource-parser', createRequire(resolved)) || pkgVersion('eventsource-parser');
} catch (e) {
  console.error('eventsource not found on NODE_PATH; see the setup notes in this file\'s header');
  process.exit(2);
}
if (typeof NpmEventSource !== 'function' || !esNpmVersion) { console.error('eventsource did not load (no EventSource export or no version)'); process.exit(2); }

// The Agent class bundled in node (global dispatcher is an undici Agent; node exposes no constructor otherwise).
const gd = globalThis[Symbol.for('undici.globalDispatcher.2')] ?? globalThis[Symbol.for('undici.globalDispatcher.1')];
const Agent = gd && gd.constructor;
if (!Agent || Agent.name !== 'Agent') { console.error('could not obtain the undici Agent class from the global dispatcher'); process.exit(2); }
const newAgent = () => new Agent({ allowH2: false }); // ALPN offers only http/1.1: HTTP/1.1 is forced for both clients

// Protocol check: every connection undici opens reports its ALPN result here; an h2 session would mean allowH2:false failed.
const alpn = new Set();
dc.subscribe('undici:client:connected', (m) => { alpn.add(String(m && m.socket && m.socket.alpnProtocol)); });

// ---------- sanitizing ----------
const BANNED = /\b(correctly|incorrectly|conformant|violates)\b/gi;
function sanitize(s, max = 200) {
  let t = String(s ?? '').replace(/\s+/g, ' ');
  t = t.replace(/(?:[A-Za-z]:\\|\/)(?:[\w.@~+-]+[\\/])+[\w.@~+-]*/g, '<path>'); // filesystem paths
  t = t.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>'); // IPv4
  t = t.replace(/(?:\b[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}\b/gi, '<ip>'); // IPv6
  const ok = new Set(['badhttp.dev', new URL(B).hostname]);
  t = t.replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, (m) => (ok.has(m.toLowerCase()) ? m : '<host>'));
  t = t.replace(BANNED, '...');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
// "Name: message" down the cause chain, like eventsource's flattenError.
function errText(err) {
  const parts = [];
  for (let e = err, i = 0; e && i < 5; e = e.cause, i++) parts.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  return parts.join(': ');
}
function chain(err) { const out = []; for (let e = err, i = 0; e && i < 5; e = e.cause, i++) out.push(e); return out; }
// How an HTTP exchange that threw ended, from the transport's side.
function endOfError(err) {
  const c = chain(err);
  if (c.some((e) => e && (e.name === 'AbortError' || e.type === 'aborted' || e.code === 'ABORT_ERR'))) return 'client-closed';
  if (c.some((e) => e && (e.code === 'ECONNREFUSED'))) return 'refused';
  if (c.some((e) => e && (['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH'].includes(e.code) || /other side closed|terminated|socket hang up|premature close|content-length/i.test(String(e.message || ''))))) return 'reset';
  return 'error';
}
function headerOf(h, name) {
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  if (Array.isArray(h)) { for (let i = 0; i + 1 < h.length; i += 2) if (String(h[i]).toLowerCase() === name) return String(h[i + 1]); return null; }
  if (typeof h[Symbol.iterator] === 'function' && !(h instanceof String)) { for (const [k, v] of h) if (String(k).toLowerCase() === name) return String(v); return null; }
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) { const v = h[k]; return Array.isArray(v) ? v.join(', ') : String(v); }
  return null;
}
const sha256 = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// ---------- one row's record ----------
function newRec(flavor) {
  const rec = { flavor, conns: [], events: [], errors: [], end: null, finished: false, es: null, snapshot: null, _resolve: null, start: Date.now() };
  rec.done = new Promise((r) => { rec._resolve = r; });
  rec.newConn = (lastEventIdSent) => {
    const c = { n: rec.conns.length + 1, status: null, content_type: null, x_badhttp_flavor: null, x_badhttp_version: null, last_event_id_sent: lastEventIdSent ?? null, ended: null, error: null };
    rec.conns.push(c);
    return c;
  };
  rec.gotResponse = (c, status, headers) => {
    c.status = status;
    c.content_type = headerOf(headers, 'content-type');
    c.x_badhttp_flavor = headerOf(headers, 'x-badhttp-flavor');
    c.x_badhttp_version = headerOf(headers, 'x-badhttp-version');
    if (status === 204) rec.endConn(c, 'status-204');
  };
  // The first thing recorded about how a connection ended wins: the library's own decision to close (a failed
  // connection, the harness's close) is recorded before the abort it causes comes back up from the transport.
  rec.endConn = (c, how, err) => {
    if (c.ended != null) return;
    c.ended = how;
    if (err && (how === 'reset' || how === 'error' || how === 'refused')) c.error = sanitize(errText(err));
  };
  rec.eventOf = (type, lastEventId, data) => {
    const d = typeof data === 'string' ? data : String(data ?? '');
    const bytes = Buffer.byteLength(d, 'utf8');
    return { type, id: lastEventId ? String(lastEventId) : null, data: bytes > 200 ? Array.from(d).slice(0, 64).join('') : d, data_bytes: bytes, data_sha256: bytes > 200 ? sha256(d) : null };
  };
  rec.finish = (end) => {
    if (rec.finished) return;
    rec.finished = true;
    rec.end = end;
    const wall = Date.now() - rec.start;
    // Whatever is still open ends here: by the harness's cap, or because the library (or the harness) closed it.
    for (const c of rec.conns) rec.endConn(c, end === 'harness-timeout' ? 'harness-timeout' : 'client-closed');
    rec.snapshot = structuredClone({ conns: rec.conns, events: rec.events, errors: rec.errors, end, wall });
    try { if (rec.es) rec.es.close(); } catch { /* already closed */ }
    rec._resolve();
  };
  // Called after the library's own dispatchEvent has run. rs is es.readyState at that moment.
  rec.onDispatched = (ev, rs) => {
    if (rec.finished) return;
    const type = String(ev.type);
    if (type === 'open') return;
    const carries = 'lastEventId' in ev; // a MessageEvent-like: a delivered stream event
    if (type === 'error') {
      if (carries) { // a stream event NAMED "error": the library dispatches it as a named event, and it reaches the caller on the same listener as a transport failure
        rec.events.push(rec.eventOf(type, ev.lastEventId, ev.data)); // delivered, in sequence with the other events
        rec.errors.push({ message: sanitize(`event named "error" with data: ${ev.data}`), had_data: true, ready_state_after: RS[rs] ?? null }); // and seen on the error listener
        return;
      }
      const msg = typeof ev.message === 'string' && ev.message ? ev.message : null;
      const code = ev.code ?? null;
      rec.errors.push({ message: sanitize(msg || code != null ? `${msg ?? 'error event'}${code != null ? ` (code ${code})` : ''}` : 'error event with no message and no code'), had_data: false, ready_state_after: RS[rs] ?? null });
      const last = rec.conns[rec.conns.length - 1];
      if (rs === 2) { rec.finish(rec.flavor === 'resume' && last && last.status === 204 ? 'stopped' : 'error'); return; }
      if (rs === 0) {
        if (rec.flavor !== 'resume') rec.finish('reconnecting');
        else if (rec.conns.length >= MAX_CONNS) rec.finish('closed-by-harness');
      }
      return;
    }
    if (carries) rec.events.push(rec.eventOf(type, ev.lastEventId, ev.data));
  };
  return rec;
}

// ---------- the two clients ----------
// node-eventsource: counted in an undici dispatcher interceptor on the Agent handed to the EventSource as `dispatcher`.
const interceptor = (rec) => (dispatch) => (opts, handler) => {
  const c = rec.newConn(headerOf(opts && opts.headers, 'last-event-id'));
  const wrapped = new Proxy(handler, {
    get(t, k) {
      if (k === 'onResponseStart') return (ctl, status, headers, text) => { if (status >= 200) rec.gotResponse(c, status, headers); return t.onResponseStart?.(ctl, status, headers, text); };
      if (k === 'onResponseEnd') return (ctl, trailers) => { rec.endConn(c, 'server-closed'); return t.onResponseEnd?.(ctl, trailers); };
      if (k === 'onResponseError') return (ctl, err) => { rec.endConn(c, endOfError(err), err); return t.onResponseError?.(ctl, err); };
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return dispatch(opts, wrapped);
};

// eventsource-npm: counted in the `fetch` constructor option; the body is re-wrapped to see how it ends.
function trackBody(res, c, rec) {
  if (!res.body) return null;
  const reader = res.body.getReader();
  return new ReadableStream({
    async pull(ctl) {
      try {
        const { done, value } = await reader.read();
        if (done) { rec.endConn(c, 'server-closed'); ctl.close(); return; }
        ctl.enqueue(value);
      } catch (e) { rec.endConn(c, endOfError(e), e); ctl.error(e); }
    },
    cancel(reason) { rec.endConn(c, 'client-closed'); return reader.cancel(reason).catch(() => {}); },
  });
}

const CLIENTS = [
  {
    id: 'node-eventsource',
    name: 'Node built-in EventSource (undici)',
    version: `node ${process.version} / undici ${process.versions.undici}`,
    library: `Node.js ${process.version} built-in EventSource (undici ${process.versions.undici} lib/web/eventsource, enabled with --experimental-eventsource), HTTP/1.1 forced with an undici Agent {allowH2: false}`,
    invocation: 'node --experimental-eventsource --disable-warning=UNDICI-ES (the harness re-executes itself with them when the global is absent): new EventSource(url, {dispatcher: new Agent({allowH2: false}).compose(interceptor)}), one instance and one Agent per flavor, dispatchEvent wrapped per instance to see every event type; closed by the harness at the first error event except on resume',
    connections_counted_by: 'an undici dispatcher interceptor (Agent.compose) on the Agent passed as the EventSource dispatcher option: one dispatch call is one connection attempt',
    make(url, rec) {
      const agent = newAgent();
      const es = new globalThis.EventSource(url, { dispatcher: agent.compose(interceptor(rec)) });
      return { es, cleanup: () => agent.destroy() };
    },
  },
  {
    id: 'eventsource-npm',
    name: 'eventsource (npm)',
    version: esNpmVersion,
    library: `eventsource ${esNpmVersion} (eventsource-parser ${parserVersion || 'unknown'}) over Node ${process.version} global fetch (undici ${process.versions.undici}), HTTP/1.1 forced with an undici Agent {allowH2: false}`,
    invocation: `new EventSource(url, {fetch: wrapper}) with eventsource ${esNpmVersion} loaded by import() from NODE_PATH; the wrapper calls the global fetch(url, {...init, dispatcher: new Agent({allowH2: false})}) and re-wraps response.body; one instance and one Agent per flavor, dispatchEvent wrapped per instance to see every event type; closed by the harness at the first error event except on resume`,
    connections_counted_by: 'the fetch constructor option: one call of the wrapper is one connection attempt',
    make(url, rec) {
      const agent = newAgent();
      const wrapped = async (u, init) => {
        const c = rec.newConn(headerOf(init && init.headers, 'last-event-id'));
        let res;
        try { res = await fetch(u, { ...init, dispatcher: agent }); } catch (e) { rec.endConn(c, endOfError(e), e); throw e; }
        rec.gotResponse(c, res.status, res.headers);
        return { body: trackBody(res, c, rec), url: res.url, status: res.status, redirected: res.redirected, headers: res.headers };
      };
      const es = new NpmEventSource(url, { fetch: wrapped });
      return { es, cleanup: () => agent.destroy() };
    },
  },
];

// ---------- one attempt at one row ----------
async function attempt(client, flavor, url) {
  const rec = newRec(flavor);
  const watchdog = setTimeout(() => rec.finish('harness-timeout'), CAP_MS); // ref'd on purpose: the libraries unref their reconnect timers
  let cleanup = async () => {};
  try {
    const made = client.make(url, rec);
    const es = made.es;
    cleanup = async () => { try { await made.cleanup(); } catch { /* ignore */ } };
    rec.es = es;
    const original = es.dispatchEvent.bind(es);
    es.dispatchEvent = (ev) => {
      const r = original(ev);
      try { rec.onDispatched(ev, es.readyState); } catch (e) { console.error(`${client.id} ${flavor}: harness error in dispatch: ${sanitize(errText(e))}`); }
      return r;
    };
    await rec.done;
  } catch (e) {
    // The constructor itself threw: there is no connection to describe.
    rec.errors.push({ message: sanitize(errText(e)), had_data: false, ready_state_after: null });
    rec.finish('error');
  } finally {
    clearTimeout(watchdog);
  }
  await cleanup();
  return { rec, snap: rec.snapshot };
}

function buildRow(client, flavor, url, snap, probed, attempts, failure) {
  const first = snap.conns[0];
  const row = {
    family: 'sse', id: `sse.${flavor}.${client.id}`, corpus_id: `sse.${flavor}`, url, method: 'GET', flavor, probed,
    badhttp_version: (first && first.x_badhttp_version) || '',
    client: { id: client.id, name: client.name, role: 'client', class: 'eventsource', version: client.version, library: client.library, platform: `node ${process.platform}/${process.arch}`, invocation: client.invocation, connections_counted_by: client.connections_counted_by },
    attempts,
    connections: snap.conns,
    events: snap.events, events_delivered: snap.events.length,
    errors: snap.errors,
    end: snap.end, retry_ms_adopted: null, last_event_id_final: null, wall_ms: snap.wall,
  };
  if (failure) { row.request_failed = true; row.reported_error = failure; }
  return row;
}

function assertClean(line) {
  const hosts = new Set(['badhttp.dev', new URL(B).host, new URL(B).hostname]);
  const bad = [];
  if (/\b(correctly|incorrectly|conformant|violates)\b/i.test(line)) bad.push('a banned word');
  if (/\/(Users|home|private|tmp|Volumes)\/|[A-Za-z]:\\\\/.test(line)) bad.push('a filesystem path');
  for (const m of line.matchAll(/https?:\/\/([a-z0-9.:-]+)/gi)) if (!hosts.has(m[1].toLowerCase())) bad.push(`host ${m[1]}`);
  if (bad.length) throw new Error(`row refused: contains ${bad.join(', ')}`);
}

process.on('uncaughtException', (e) => console.error(`uncaught: ${sanitize(errText(e))}`));
process.on('unhandledRejection', (e) => console.error(`unhandled rejection: ${sanitize(errText(e))}`));

for (let ci = 0; ci < CLIENTS.length; ci++) {
  const client = CLIENTS[ci];
  for (const flavor of ORDER) {
    const url = `${B}/sse/${flavor}`;
    let row = null;
    for (let n = 1; n <= 3; n++) {
      const probed = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const { snap } = await attempt(client, flavor, url);
      const landed = snap.conns.length > 0 && snap.conns.every((c) => c.x_badhttp_version);
      if (landed) { row = buildRow(client, flavor, url, snap, probed, n, null); break; }
      const last = snap.conns[snap.conns.length - 1];
      const why = `no x-badhttp-version on a response (last status ${last && last.status != null ? last.status : 'none'})`;
      if (n === 3) { row = buildRow(client, flavor, url, snap, probed, n, `${why} after 3 attempts`); break; }
      console.error(`${client.id} ${flavor}: ${why}; retrying after 12 s`);
      await sleep(12000);
    }
    const line = JSON.stringify(row);
    assertClean(line);
    process.stdout.write(`${line}\n`);
    if (row.request_failed) console.error(`${client.id} ${flavor}: FAILED, ${row.reported_error}`);
    else console.error(`${client.id} ${flavor}: ${row.events_delivered} events, ${row.connections.length} connection${row.connections.length === 1 ? '' : 's'}, end ${row.end} ok`);
    await sleep(1000);
  }
  if (ci < CLIENTS.length - 1) await sleep(3000);
}
console.error(`protocols negotiated by undici sockets: ${[...alpn].join(', ') || 'none seen'}`);
process.stdout.write('', () => process.exit(0));

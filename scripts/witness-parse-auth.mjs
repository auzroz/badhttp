#!/usr/bin/env node
// Turns the /auth witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-auth-clients-<date>.jsonl — the raw capture, committed, re-runnable from
//         scripts/auth-witness/all.sh. Line 1 is provenance; every other line is one observation.
// Output: src/witness-auth-data.js — a generated literal. The Worker never parses text at runtime.
//
//   node scripts/witness-parse-auth.mjs docs/probe-auth-clients-2026-09-18.jsonl
//
// The same rule as the other two parsers: `outcome` describes what the caller received — the final
// response's status and what the server's body said — relative to how the documented fake credentials
// were handed to the client (`mechanism_kind`). It is never a verdict on the client: a client with no
// Digest mechanism 401ing on /auth/digest is a capability, not a bug, and the row says which it is.
//
// No-echo: the /auth oracle never reflects a received credential, so the body is safe to carry. What
// the HARNESS could leak is a client exception message (some include the request headers or the URL)
// — every free-text field is scrubbed here as well as in the harness, and the generator refuses to emit
// if any row still contains the base64 of a documented credential.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node scripts/witness-parse-auth.mjs <capture.jsonl>');
const OUT = 'src/witness-auth-data.js';

// requests_counted_by: the layer each harness counts requests at. A count is bounded by the client's own retry
// cap and by the harness's 30 s timeout and 6-redirect limit — a runaway loop shows up as request-failed, not
// as a large number.
const ROSTER = {
  curl: { name: 'curl', requests_counted_by: 'the "> METHOD target" lines of curl -v (one per request curl sends, auth retries and followed redirects included); per-hop status from the "< HTTP/x NNN" lines' },
  'go-nethttp': { name: 'Go net/http', requests_counted_by: 'a counting http.RoundTripper (one RoundTrip per request the client sends; net/http never re-sends for auth)' },
  undici: { name: 'Node fetch (undici)', requests_counted_by: "undici's diagnostics channel undici:request:create (one per request the dispatcher sends, each redirect hop dispatched separately) and undici:request:headers for the status" },
  urllib: { name: 'Python urllib.request', requests_counted_by: 'a BaseHandler whose http_request/https_request runs once per request the opener sends (auth handlers and the redirect handler re-enter parent.open); http_response for the status' },
  requests: { name: 'Python requests', requests_counted_by: 'a counting HTTPAdapter mounted on the Session (sees the original, every redirect hop and the Digest retry, which auth.py sends through r.connection)' },
  httpx: { name: 'Python httpx', requests_counted_by: 'event_hooks request/response on the Client (once per wire request inside _send_handling_redirects, auth retries included)' },
  urllib3: { name: 'Python urllib3', requests_counted_by: 'a HTTPSConnectionPool subclass whose _make_request runs once per wire request (redirects re-enter urlopen)' },
  aiohttp: { name: 'Python aiohttp', requests_counted_by: 'an innermost client middleware called once per wire request (the Digest middleware wraps it; the redirect loop re-runs the chain per hop)' },
};
const ORDER = Object.keys(ROSTER);
const FLAVOR_ORDER = ['basic', 'bearer', 'digest', 'digest-sha256', 'none', 'bare-scheme', 'unknown-scheme', 'token68', 'multi', 'case', 'quoted', 'utf8', 'always-401', 'accept-any', 'forbidden', 'stale', 'proxy', 'redirect'];
// What was CONFIGURED, never what happened. Whether credentials went out first is read from hops.
const KINDS = ['basic-auth', 'basic-header', 'basic-handler', 'digest-handler', 'any-handler', 'bearer-auth', 'bearer-header', 'no-mechanism'];
const HARNESS_ENCODED = new Set(['basic-header', 'bearer-header']);
// The oracle body keys that are observations. Identity keys (user, token) name the documented fake identity,
// which the flavor already names; the constant prose (warning, hint, credentials) is dropped by every harness.
const ORACLE_KEYS = ['authenticated', 'checked', 'scheme', 'algorithm', 'encoding', 'generations', 'matched', 'error', 'defect', 'note', 'method', 'flavor', 'uri_param_length', 'request_target', 'location', 'authentication_info'];
// Anything a client could have SENT: the base64 of both encodings of the documented Basic credentials, the raw
// values, their URL-encoded forms, the token, a Proxy-Authorization line, and a Digest response= parameter.
const NEEDLES = ['YWdlbnQ6', 'Y29ycmVjdA', 'c8Opc2FtZQ', 'c+lzYW1l', 'agent:correct', 'sésame', 'agent%3A', 's%C3%A9same', 'badhttp-token-ok', 'Proxy-Authorization:', 'proxy-authorization:', 'response='];

const lines = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim());
const meta = JSON.parse(lines[0]);
if (meta.capture !== 'auth' || !meta.probed || !meta.badhttp_version_observed) throw new Error(`line 1 is not an auth provenance line: ${lines[0]}`);
if (meta.flavors_run !== FLAVOR_ORDER.length || meta.clients_run !== ORDER.length) throw new Error(`provenance says ${meta.flavors_run} flavors x ${meta.clients_run} clients; a published capture is the full ${FLAVOR_ORDER.length} x ${ORDER.length} grid (all.sh writes it; a dry run cannot be published)`);

function scrub(s) {
  if (s == null) return null;
  return String(s)
    .replace(/basic\s+[A-Za-z0-9+/=]{6,}/gi, 'Basic [redacted]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/digest\s+\S.*/gi, 'Digest [redacted]')
    .replace(/:\/\/[^/@\s]+@/g, '://[redacted]@')
    .replace(/agent(:|%3A)\S*/gi, '[redacted]')
    .replace(/s(é|%C3%A9)same/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/]{16,}={0,2}/g, (m) => (/^(YWdlbnQ6|Y29ycmVjdA|c8Opc2FtZQ|c\+lzYW1l)/.test(m) ? '[redacted]' : m))
    .slice(0, 300);
}

// challenge_seen is SERVER data (the final response's WWW-Authenticate / Proxy-Authenticate) copied from the
// client's view. It is validated, never scrubbed: a scrub that matched would corrupt server data silently.
function validateChallenge(v, lineNo) {
  if (v == null) return null;
  const s = String(v);
  if (!/^(Basic|bASIc|Digest|Bearer|X-Badhttp-)/.test(s)) throw new Error(`line ${lineNo}: challenge_seen does not start with a scheme this server emits: ${s.slice(0, 40)}`);
  for (const bad of ['response=', 'username=', 'uri=', 'cnonce=', 'nc=']) if (s.includes(bad)) throw new Error(`line ${lineNo}: challenge_seen carries a credential-side parameter (${bad})`);
  return s;
}

/**
 * A description of what the caller received, never a verdict. Pure function of the captured columns, and
 * exhaustive: any shape outside these throws rather than being binned.
 *  request-failed         transport failure; the client returned nothing usable
 *  client-raised          the client raised something other than its transport-error type before returning a response
 *  did-not-land           a response arrived but not from this server (no x-badhttp-version) — refused below: not an observation
 *  authenticated          the final response was a 2xx whose body says authenticated: true
 *  refused                a final 4xx from this server reached the caller; the body says why (on forbidden the
 *                         body says the credentials were valid and the resource still refuses — read the flavor)
 *  redirect-not-followed  a final 3xx reached the caller
 */
function classify(o, lineNo) {
  if (o.oracle === null) {
    if (o.error_kind === 'raised') return 'client-raised';
    return o.final_status === null ? 'request-failed' : 'did-not-land';
  }
  const st = o.final_status;
  if (st >= 200 && st < 300) {
    if (o.oracle.authenticated === true) return 'authenticated';
    throw new Error(`line ${lineNo}: a 2xx whose body does not say authenticated: true`);
  }
  if (st >= 300 && st < 400) return 'redirect-not-followed';
  if (st >= 400 && st < 500) return 'refused';
  throw new Error(`line ${lineNo}: final status ${st} is outside every outcome`);
}

const observations = [];
const seen = new Set();
const clientMeta = new Map();
for (const [i, line] of lines.slice(1).entries()) {
  const r = JSON.parse(line);
  const lineNo = i + 2;
  if (!ROSTER[r.client]) throw new Error(`line ${lineNo}: unknown client id ${r.client}`);
  if (!FLAVOR_ORDER.includes(r.flavor)) throw new Error(`line ${lineNo}: unknown flavor ${r.flavor}`);
  if (!KINDS.includes(r.mechanism_kind)) throw new Error(`line ${lineNo}: unknown mechanism_kind ${r.mechanism_kind}`);
  const key = `${r.client}/${r.flavor}`;
  if (seen.has(key)) throw new Error(`line ${lineNo}: duplicate observation ${key}`);
  seen.add(key);
  const cm = clientMeta.get(r.client);
  const mine = { version: r.client_version, platform: r.platform, invocation: r.invocation };
  if (cm && JSON.stringify(cm) !== JSON.stringify(mine)) throw new Error(`line ${lineNo}: ${r.client} changed version/platform/invocation mid-capture`);
  clientMeta.set(r.client, mine);
  const landed = r.oracle !== null && r.oracle !== undefined;
  if (landed && !r.version_header) throw new Error(`line ${lineNo}: oracle row without x-badhttp-version`);
  if (r.version_header != null && r.version_header !== meta.badhttp_version_observed) throw new Error(`line ${lineNo}: badhttp version ${r.version_header} != provenance ${meta.badhttp_version_observed}`);
  if (typeof r.attempts !== 'number') throw new Error(`line ${lineNo}: no attempts count`);
  if (!Array.isArray(r.hops)) throw new Error(`line ${lineNo}: no hops`);

  const b = landed ? r.oracle : null;
  const body = b ? Object.fromEntries(Object.entries(b).filter(([k]) => ORACLE_KEYS.includes(k))) : null;
  const o = {
    client: r.client,
    flavor: r.flavor,
    url: r.url,
    mechanism_kind: r.mechanism_kind,
    mechanism: r.mechanism,
    attempts: r.attempts ?? null,
    requests_made: typeof r.requests_made === 'number' ? r.requests_made : null,
    // Per request the client sent: its status and whether Authorization / Proxy-Authorization was present (never a value).
    hops: r.hops.map((h) => ({ status: typeof h.status === 'number' ? h.status : null, authorization: !!h.authorization, proxy_authorization: !!h.proxy_authorization })),
    statuses_seen: r.hops.map((h) => (typeof h.status === 'number' ? h.status : null)),
    credentialed_requests: r.hops.filter((h) => h.authorization || h.proxy_authorization).length,
    sent_credentials_first: r.hops.length ? !!(r.hops[0].authorization || r.hops[0].proxy_authorization) : null,
    credential_encoded_by: r.mechanism_kind === 'no-mechanism' ? null : (HARNESS_ENCODED.has(r.mechanism_kind) ? 'harness' : 'client'),
    // curl reports a transport failure as %{http_code} 000; that is no status, not status 0.
    final_status: r.final_status === 0 ? null : (r.final_status ?? null),
    // When the client raised, the last status the harness saw pass through before the raise (urllib's
    // handler chain sees the 401 before the ValueError); null where nothing was seen or the client returned.
    last_status_seen: typeof r.last_status_seen === 'number' ? r.last_status_seen : null,
    // fetch() exposes only a boolean; every other client exposes a count. Both are kept.
    redirects_followed: typeof r.redirects_followed === 'number' ? r.redirects_followed : null,
    redirect_followed: r.redirected ?? (typeof r.redirects_followed === 'number' ? r.redirects_followed > 0 : null),
    final_url: r.final_url ? scrub(r.final_url) : null,
    challenge_seen: validateChallenge(r.challenge_seen, lineNo),
    authenticated: body && Object.hasOwn(body, 'authenticated') ? body.authenticated === true : null,
    checked_flag: body && Object.hasOwn(body, 'checked') ? body.checked : null,
    scheme_reported: body && body.scheme ? body.scheme : null,
    algorithm: body && body.algorithm ? body.algorithm : null,
    encoding: body && body.encoding ? body.encoding : null,
    generations: body && typeof body.generations === 'number' ? body.generations : null,
    matched: body && body.matched ? body.matched : null,
    server_error: body && body.error ? body.error : null,
    server_defect: body && body.defect ? body.defect : null,
    server_note: body && body.note ? body.note : null,
    oracle: body,
    error_kind: r.error_kind ?? (r.client_error ? 'transport' : null),
    reported_error: scrub(r.client_error),
  };
  o.outcome = classify(o, lineNo);
  if (o.outcome === 'did-not-land') throw new Error(`line ${lineNo}: a did-not-land row is not an observation; re-run the whole capture`);
  observations.push(o);
}

for (const c of ORDER) {
  const got = observations.filter((o) => o.client === c).map((o) => o.flavor);
  if (got.length !== FLAVOR_ORDER.length) throw new Error(`${c}: ${got.length} flavors, expected ${FLAVOR_ORDER.length}`);
  for (const f of FLAVOR_ORDER) if (!got.includes(f)) throw new Error(`${c}: missing flavor ${f}`);
}
observations.sort((a, b) => ORDER.indexOf(a.client) - ORDER.indexOf(b.client) || FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor));

// The no-echo gate: nothing a client could have sent may appear in any string of any row, nor in the run
// log committed beside the capture. The documented identity is public, but a row is what the client sent
// and received, and a value there would mean the harness echoed it.
const blob = JSON.stringify(observations);
const logPath = SRC.replace(/\.jsonl$/, '.log');
let logText = '';
try { logText = readFileSync(logPath, 'utf8'); } catch { throw new Error(`the run log ${logPath} must be committed beside the capture`); }
for (const needle of NEEDLES) {
  if (blob.includes(needle)) throw new Error(`refusing to emit: a row contains ${JSON.stringify(needle)}`);
  if (logText.includes(needle)) throw new Error(`refusing to emit: the run log contains ${JSON.stringify(needle)}`);
}
if (/(FAILED|raised)/.test(logText) && !observations.some((o) => o.outcome === 'client-raised' || o.outcome === 'request-failed')) throw new Error('the run log reports a failure the rows do not carry');

const clients = ORDER.map((id) => ({ id, name: ROSTER[id].name, role: 'client', ...clientMeta.get(id), requests_counted_by: ROSTER[id].requests_counted_by }));

const out = `// GENERATED by scripts/witness-parse-auth.mjs from ${SRC} — do not edit by hand.
// Re-run the generator after any new capture; the capture scripts are in scripts/auth-witness/.
//
// Eight real HTTP clients, each handed the documented fake credentials through its own mechanism for the
// flavor's scheme and run against every /auth flavor on ${meta.probed} against badhttp
// ${meta.badhttp_version_observed}${meta.worker_version ? ` (Worker deployment ${meta.worker_version})` : ''}. The oracle is the final
// /auth response itself, which never echoes a received credential; what the harness observed on its own side is
// the request count, the final status and url, and any exception the client raised (scrubbed).

export const WITNESS_AUTH = {
  family: 'auth',
  probed: ${JSON.stringify(meta.probed)},
  badhttp_version_observed: ${JSON.stringify(meta.badhttp_version_observed)},
  worker_version: ${JSON.stringify(meta.worker_version ?? null)},
  flavors: ${FLAVOR_ORDER.length},
  source_file: ${JSON.stringify(SRC)},
  run_log: ${JSON.stringify(logPath)},
  capture_scripts: 'scripts/auth-witness/',
};

export const CLIENTS_AUTH = ${JSON.stringify(clients, null, 2)};

export const OBSERVATIONS_AUTH = ${JSON.stringify(observations, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')};
`;
writeFileSync(OUT, out);
const outcomes = {};
for (const o of observations) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
console.log(`${OUT}: ${clients.length} clients x ${FLAVOR_ORDER.length} flavors = ${observations.length} observations`);
console.log('outcomes:', JSON.stringify(outcomes));

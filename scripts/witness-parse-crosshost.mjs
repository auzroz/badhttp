#!/usr/bin/env node
// Turns the /crosshost witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-crosshost-clients-<date>.jsonl — the raw capture, committed, re-runnable from
//         scripts/crosshost-witness/all.sh. Line 1 is provenance; every other line is one observation.
// Output: src/witness-crosshost-data.js — a generated literal. The Worker never parses text at runtime.
//
//   node scripts/witness-parse-crosshost.mjs docs/probe-crosshost-clients-2026-09-17.jsonl
//
// The same rule as scripts/witness-parse.mjs: `outcome` describes what arrived at the landing host
// relative to what the harness sent. It is never a verdict on the client. RFC 9110 §15.4 says nothing
// about credentials on redirects, and several of the behaviours here are documented choices by the
// client's authors, so there is no conformance to measure — only what happened.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node scripts/witness-parse-crosshost.mjs <capture.jsonl>');
const OUT = 'src/witness-crosshost-data.js';

// The roster, keyed by the id each harness prints. Names and roles are fixed here; versions, platform
// and invocation are read from the capture so they can never drift from what actually ran.
const ROSTER = {
  curl: { name: 'curl', cookie_jar: true, jar_note: 'cookie engine enabled with -b "" on the jar flavor' },
  'go-nethttp': { name: 'Go net/http', cookie_jar: true, jar_note: 'net/http/cookiejar' },
  undici: { name: 'Node fetch (undici)', cookie_jar: false, jar_note: 'fetch() has no cookie jar; nothing stood in for one' },
  urllib: { name: 'Python urllib.request', cookie_jar: true, jar_note: 'http.cookiejar.CookieJar via HTTPCookieProcessor' },
  requests: { name: 'Python requests', cookie_jar: true, jar_note: 'the Session jar' },
  httpx: { name: 'Python httpx', cookie_jar: true, jar_note: 'the Client jar' },
  urllib3: { name: 'Python urllib3', cookie_jar: false, jar_note: 'urllib3 has no cookie jar; nothing stood in for one' },
  aiohttp: { name: 'Python aiohttp', cookie_jar: true, jar_note: 'the ClientSession jar' },
};
const ORDER = Object.keys(ROSTER);
const FLAVOR_ORDER = ['same-origin', 'to-subdomain', 'from-subdomain', 'boomerang', 'scheme-upgrade', 'scheme-downgrade', 'port-change', 'relative-authority', 'jar'];

const lines = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim());
const meta = JSON.parse(lines[0]);
if (meta.capture !== 'crosshost' || !meta.probed || !meta.badhttp_version_observed) throw new Error(`line 1 is not a crosshost provenance line: ${lines[0]}`);

/**
 * A description of what arrived, never a verdict. Pure function of the captured columns.
 *  request-failed   the client raised before any usable response
 *  did-not-land     the client returned a response, but not the oracle's (it stopped short, or hit the edge)
 *  all-arrived      every header the harness sent arrived on the final hop
 *  some-arrived     a subset arrived; the `arrived` fields say which
 *  none-arrived     none of the sent headers arrived
 */
function classify(o) {
  if (o.landed_on === null) return o.final_status === null ? 'request-failed' : 'did-not-land';
  const sentKeys = ['authorization', 'x_api_key', ...(o.sent.cookie ? ['cookie'] : [])];
  const n = sentKeys.filter((k) => o.arrived[k]).length;
  if (n === sentKeys.length) return 'all-arrived';
  return n === 0 ? 'none-arrived' : 'some-arrived';
}

const observations = [];
const seen = new Set();
const clientMeta = new Map();
for (const [i, line] of lines.slice(1).entries()) {
  const r = JSON.parse(line);
  const lineNo = i + 2;
  if (!ROSTER[r.client]) throw new Error(`line ${lineNo}: unknown client id ${r.client}`);
  if (!FLAVOR_ORDER.includes(r.flavor)) throw new Error(`line ${lineNo}: unknown flavor ${r.flavor}`);
  const key = `${r.client}/${r.flavor}`;
  if (seen.has(key)) throw new Error(`line ${lineNo}: duplicate observation ${key}`);
  seen.add(key);
  const cm = clientMeta.get(r.client);
  const mine = { version: r.client_version, platform: r.platform, invocation: r.invocation };
  if (cm && JSON.stringify(cm) !== JSON.stringify(mine)) throw new Error(`line ${lineNo}: ${r.client} changed version/platform/invocation mid-capture`);
  clientMeta.set(r.client, mine);
  // Every landed row records the x-badhttp-version it actually saw; it must be the version the
  // provenance line names, or the capture straddled a deploy and cannot be published as one snapshot.
  const landed = r.landed_on !== null && r.landed_on !== undefined;
  if (landed && !r.version_header) throw new Error(`line ${lineNo}: landed row without x-badhttp-version`);
  if (r.version_header != null && r.version_header !== meta.badhttp_version_observed) throw new Error(`line ${lineNo}: badhttp version ${r.version_header} != provenance ${meta.badhttp_version_observed}`);

  const rec = r.received;
  const o = {
    client: r.client,
    flavor: r.flavor,
    start_url: r.start_url,
    sent: { authorization: true, cookie: r.sent.cookie !== null, x_api_key: true, jar: r.sent.jar },
    // curl reports a transport failure as %{http_code} 000; that is no status, not status 0.
    final_status: r.final_status === 0 ? null : r.final_status,
    hops_followed: r.hops_followed,
    // fetch() exposes only a boolean; every other client exposes a count. Both are kept.
    redirect_followed: r.redirected ?? (typeof r.hops_followed === 'number' ? r.hops_followed > 0 : null),
    final_url: r.final_url ?? null,
    attempts: r.attempts ?? null,
    landed_on: r.landed_on ?? null,
    port: r.port ?? null,
    scheme: r.scheme ?? null,
    transport_was_encrypted: r.transport_was_encrypted ?? null,
    arrived: rec
      ? { authorization: !!rec.authorization.present, proxy_authorization: !!rec.proxy_authorization.present, cookie: !!rec.cookie.present, x_api_key: !!rec.x_api_key.present }
      : null,
    authorization_scheme_seen: rec && rec.authorization.present ? rec.authorization.scheme : null,
    cookie_names_arrived: rec && rec.cookie.present ? rec.cookie.ours : [],
    cookie_other_count: rec && rec.cookie.present ? rec.cookie.other_count : 0,
    matches_documented: r.matches ? { authorization: r.matches.authorization, x_api_key: r.matches.x_api_key } : null,
    reported_error: r.client_error ?? null,
  };
  o.outcome = classify(o);
  observations.push(o);
}

// Every client must cover every flavor, or the matrix has holes the site would render as findings.
for (const c of ORDER) {
  const got = observations.filter((o) => o.client === c).map((o) => o.flavor);
  if (got.length !== FLAVOR_ORDER.length) throw new Error(`${c}: ${got.length} flavors, expected ${FLAVOR_ORDER.length}`);
  for (const f of FLAVOR_ORDER) if (!got.includes(f)) throw new Error(`${c}: missing flavor ${f}`);
}
observations.sort((a, b) => ORDER.indexOf(a.client) - ORDER.indexOf(b.client) || FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor));

const clients = ORDER.map((id) => ({ id, name: ROSTER[id].name, role: 'client', ...clientMeta.get(id), cookie_jar: ROSTER[id].cookie_jar, jar_note: ROSTER[id].jar_note }));

const out = `// GENERATED by scripts/witness-parse-crosshost.mjs from ${SRC} — do not edit by hand.
// Re-run the generator after any new capture; the capture scripts are in scripts/crosshost-witness/.
//
// Eight real HTTP clients, each started at every /crosshost flavor on ${meta.probed} against badhttp
// ${meta.badhttp_version_observed}${meta.worker_version ? ` (Worker deployment ${meta.worker_version})` : ''}, sending the
// family's published fake test values, and the oracle's report of what arrived on the final hop.
// The oracle never echoes what it received, so nothing here is a credential — only presence, a scheme
// name, and names of cookies under this server's badhttp_ prefix (the three it mints on the jar flavor,
// and the harness's own badhttp_witness).

export const WITNESS_CROSSHOST = {
  family: 'crosshost',
  probed: ${JSON.stringify(meta.probed)},
  badhttp_version_observed: ${JSON.stringify(meta.badhttp_version_observed)},
  worker_version: ${JSON.stringify(meta.worker_version ?? null)},
  flavors: ${FLAVOR_ORDER.length},
  source_file: ${JSON.stringify(SRC)},
  capture_scripts: 'scripts/crosshost-witness/',
};

export const CLIENTS_CROSSHOST = ${JSON.stringify(clients, null, 2)};

export const OBSERVATIONS_CROSSHOST = ${JSON.stringify(observations, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')};
`;
writeFileSync(OUT, out);
const outcomes = {};
for (const o of observations) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
console.log(`${OUT}: ${clients.length} clients x ${FLAVOR_ORDER.length} flavors = ${observations.length} observations`);
console.log('outcomes:', JSON.stringify(outcomes));

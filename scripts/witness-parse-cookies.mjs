#!/usr/bin/env node
// Turns the /cookies witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-cookies-clients-<date>.jsonl — the raw capture, committed, re-runnable from
//         scripts/cookies-witness/all.sh. Line 1 is provenance; every other line is one observation.
// Output: src/witness-cookies-data.js — a generated literal. The Worker never parses text at runtime.
//
//   node scripts/witness-parse-cookies.mjs docs/probe-cookies-clients-2026-09-30.jsonl
//
// The same rule as the other three parsers: `outcome` describes what came back to /cookies/echo relative to
// the cookies the flavor planted, and is never a verdict on the client. `none-returned` is the documented
// right answer on wrong-domain, public-suffix and path-prefix and the finding elsewhere; a `no-jar` client
// returning nothing is a capability, not a bug, and the row's jar_kind says which it is.
//
// Nothing a client could have sent here is a secret — every cookie value this family plants is a documented
// constant — but no row may carry a string from the machine that ran the capture (a path, a hostname other
// than badhttp.dev), and the generator refuses to emit if one does.

import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node scripts/witness-parse-cookies.mjs <capture.jsonl>');
const OUT = 'src/witness-cookies-data.js';
// source_file and run_log are written into the committed data file, so the capture path must be repo-relative:
// an absolute path would write the capturing machine's directory into it.
if (isAbsolute(SRC) || SRC.split(/[\\/]/).includes('..')) throw new Error(`refusing to emit: ${SRC} must be a repo-relative path (the path is written into ${OUT})`);

const ROSTER = {
  curl: { name: 'curl' },
  'go-nethttp': { name: 'Go net/http' },
  undici: { name: 'Node fetch (undici) + tough-cookie' },
  urllib: { name: 'Python urllib.request' },
  requests: { name: 'Python requests' },
  httpx: { name: 'Python httpx' },
  urllib3: { name: 'Python urllib3' },
  aiohttp: { name: 'Python aiohttp' },
};
const ORDER = Object.keys(ROSTER);
export const FLAVOR_ORDER = ['ok', 'folded', 'many', 'duplicate', 'on-redirect', 'conflicting-expiry', 'bad-expires', 'far-future', 'wrong-domain', 'public-suffix', 'domain', 'path-prefix', 'name-prefixes', 'quoted', 'utf8', 'nameless', 'huge'];
const JAR_KINDS = ['own-jar', 'harness-jar', 'no-jar'];

// The names each flavor plants at its default parameters, as src/cookies.js sets them (the parse this server
// documents: name = up to the first "=", or "" when there is none). Cross-checked below against setter_set on
// every row that read the setter body, so this table cannot drift from the code without the generator refusing.
// The nameless pair has no name: those two are matched by VALUE.
export const PLANTED = {
  ok: ['badhttp_ok'],
  folded: ['badhttp_folded_a'],
  many: Array.from({ length: 10 }, (_, i) => `badhttp_many_${String(i + 1).padStart(2, '0')}`),
  duplicate: ['badhttp_dup', 'badhttp_dup'],
  'on-redirect': ['badhttp_redirect'],
  'conflicting-expiry': ['badhttp_conflict'],
  'bad-expires': ['badhttp_bad_expires'],
  'far-future': ['badhttp_far_future'],
  'wrong-domain': ['badhttp_wrong_domain'],
  'public-suffix': ['badhttp_supercookie'],
  domain: ['badhttp_domain_dot', 'badhttp_domain'],
  'path-prefix': ['badhttp_path_prefix'],
  'name-prefixes': ['__Host-badhttp_good', '__Host-badhttp_bad', '__Secure-badhttp_good', '__Secure-badhttp_bad'],
  quoted: ['badhttp_quoted', 'badhttp_semi'],
  utf8: ['badhttp_utf8'],
  nameless: ['', ''],
  huge: ['badhttp_huge'],
};
const NAMELESS_VALUES = ['badhttp-just-a-value', 'badhttp_empty_name'];
// The three flavors on which returning nothing is what the specification asks for.
export const NEGATIVE_FLAVORS = ['wrong-domain', 'public-suffix', 'path-prefix'];

// Anything from the capturing machine: home directories, temp paths, other hostnames.
const FORBIDDEN = [/\/Users\//, /\/Volumes\//, /\/home\//, /\/private\/tmp/, /\/var\/folders\//, /\/tmp\//, /\bC:\\/, /file:\/\//, /localhost/, /127\.0\.0\.1/];
const ALLOWED_HOSTS = ['badhttp.dev', 'alt.badhttp.dev'];

const nameOf = (setCookie) => {
  const first = setCookie.split(';')[0];
  const i = first.indexOf('=');
  return i === -1 ? '' : first.slice(0, i);
};

/**
 * A description of what came back to /cookies/echo, relative to what the flavor planted. Pure function of the
 * captured columns, exhaustive: any shape outside these throws rather than being binned.
 *  request-failed   transport failure; the client returned nothing usable
 *  client-raised    the client raised something other than its transport-error type
 *  all-returned     every planted cookie came back on the echo, matched one-to-one (by value for the nameless pair, once per copy of a duplicated name)
 *  some-returned    at least one but not all
 *  none-returned    none of them
 */
function classify(o, planted, lineNo) {
  if (o.echo === null) {
    if (o.error_kind === 'raised') return 'client-raised';
    if (o.error_kind === 'transport' || o.reported_error) return 'request-failed';
    throw new Error(`line ${lineNo}: no echo and no error_kind`);
  }
  if (o.echo.status !== 200) throw new Error(`line ${lineNo}: echo status ${o.echo.status}`);
  const got = o.echo.cookies;
  // One-to-one: each planted entry (each nameless value, each copy of a duplicated name) must be matched by its
  // own echoed cookie, so a client that returned one of a pair is some-returned, not all-returned.
  const preds = planted.every((n) => n === '')
    ? NAMELESS_VALUES.map((v) => (c) => c.name === '' && c.value === v)
    : planted.map((n) => (c) => c.name === n);
  const used = new Set();
  let m = 0;
  for (const p of preds) {
    const i = got.findIndex((c, j) => !used.has(j) && p(c));
    if (i >= 0) { used.add(i); m++; }
  }
  if (m === 0) return 'none-returned';
  if (m === preds.length) return 'all-returned';
  return 'some-returned';
}

const lines = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim());
const meta = JSON.parse(lines[0]);
if (meta.capture !== 'cookies' || !meta.probed || !meta.badhttp_version_observed) throw new Error(`line 1 is not a cookies provenance line: ${lines[0]}`);
if (meta.flavors_run !== FLAVOR_ORDER.length || meta.clients_run !== ORDER.length) throw new Error(`provenance says ${meta.flavors_run} flavors x ${meta.clients_run} clients; a published capture is the full ${FLAVOR_ORDER.length} x ${ORDER.length} grid`);

const observations = [];
const seen = new Set();
const clientMeta = new Map();
for (const [i, line] of lines.slice(1).entries()) {
  const r = JSON.parse(line);
  const lineNo = i + 2;
  if (!ROSTER[r.client]) throw new Error(`line ${lineNo}: unknown client id ${r.client}`);
  if (!FLAVOR_ORDER.includes(r.flavor)) throw new Error(`line ${lineNo}: unknown flavor ${r.flavor}`);
  if (!JAR_KINDS.includes(r.jar_kind)) throw new Error(`line ${lineNo}: unknown jar_kind ${r.jar_kind}`);
  const key = `${r.client}/${r.flavor}`;
  if (seen.has(key)) throw new Error(`line ${lineNo}: duplicate observation ${key}`);
  seen.add(key);
  const cm = clientMeta.get(r.client);
  const mine = { version: r.client_version, platform: r.platform, invocation: r.invocation, jar_kind: r.jar_kind, jar: r.jar };
  if (cm && JSON.stringify(cm) !== JSON.stringify(mine)) throw new Error(`line ${lineNo}: ${r.client} changed version/platform/invocation/jar mid-capture`);
  clientMeta.set(r.client, mine);
  if (typeof r.attempts !== 'number') throw new Error(`line ${lineNo}: no attempts count`);
  if (!Array.isArray(r.hops)) throw new Error(`line ${lineNo}: no hops`);
  const landed = r.echo !== null && r.echo !== undefined;
  if (landed && r.version_header !== meta.badhttp_version_observed) throw new Error(`line ${lineNo}: badhttp version ${r.version_header} != provenance ${meta.badhttp_version_observed}`);
  if (r.setter_set !== null && r.setter_set !== undefined) {
    if (r.flavor === 'on-redirect') throw new Error(`line ${lineNo}: on-redirect rows cannot have read the setter body`);
    const names = r.setter_set.map(nameOf);
    if (JSON.stringify(names) !== JSON.stringify(PLANTED[r.flavor])) throw new Error(`line ${lineNo}: setter_set names ${JSON.stringify(names)} != PLANTED ${JSON.stringify(PLANTED[r.flavor])}`);
  } else if (r.flavor !== 'on-redirect' && landed) {
    throw new Error(`line ${lineNo}: a landed non-redirect row must carry setter_set`);
  }
  if (r.jar_kind === 'no-jar' && landed && r.echo.cookies.length) throw new Error(`line ${lineNo}: a no-jar client echoed cookies`);

  const planted = PLANTED[r.flavor];
  const o = {
    client: r.client,
    flavor: r.flavor,
    url: r.url,
    jar_kind: r.jar_kind,
    jar: r.jar,
    attempts: r.attempts,
    // hops is the setter leg only (the first GET and its redirects); the echo, delete and second echo are not counted.
    requests_made: r.hops.length,
    hops: r.hops.map((h) => ({ status: typeof h.status === 'number' ? h.status : null, set_cookie_count: typeof h.set_cookie_count === 'number' ? h.set_cookie_count : null })),
    setter_status: typeof r.setter_status === 'number' ? r.setter_status : null,
    setter_body_read: r.setter_set !== null && r.setter_set !== undefined,
    planted_names: planted,
    echo: landed ? {
      status: r.echo.status,
      cookie_header_bytes: r.echo.cookie_header_bytes,
      cookies: r.echo.cookies.map((c) => ({ name: c.name, value_bytes: c.value_bytes, value: c.value ?? null })),
      cookie_header_base64: r.echo.cookie_header_base64 ?? null,
    } : null,
    returned_names: landed ? [...new Set(planted.filter((n) => (n === '' ? r.echo.cookies.some((c) => c.name === '' && NAMELESS_VALUES.includes(c.value)) : r.echo.cookies.some((c) => c.name === n))))] : null,
    unplanted_names: landed ? [...new Set(r.echo.cookies.filter((c) => !(planted.includes(c.name) && (c.name !== '' || NAMELESS_VALUES.includes(c.value)))).map((c) => c.name))] : null,
    after_delete: r.after_delete ? { status: r.after_delete.status, names: r.after_delete.names } : null,
    after_delete_remaining: r.after_delete ? r.after_delete.names.filter((n) => planted.includes(n)).length : null,
    // Names present after the cleanup that this flavor never planted: a jar that stored one of the deletion
    // tombstones from /cookies/delete as a live cookie shows up here, not in after_delete_remaining.
    after_delete_unplanted: r.after_delete ? [...new Set(r.after_delete.names.filter((n) => !planted.includes(n)))] : null,
    jar_enumerable: !!r.jar_enumerable,
    jar_entries: Array.isArray(r.jar_entries) ? r.jar_entries.map((e) => ({ name: e.name, domain: e.domain ?? null, path: e.path ?? null, host_only: e.host_only ?? null, secure: e.secure ?? null, expires: e.expires ?? null, value_bytes: e.value_bytes ?? null })) : null,
    jar_rejections: Array.isArray(r.jar_rejections) ? r.jar_rejections.map((x) => ({ message: String(x.message).slice(0, 200) })) : null,
    error_kind: r.error_kind ?? null,
    reported_error: r.client_error ? String(r.client_error).slice(0, 300) : null,
    last_status_seen: typeof r.last_status_seen === 'number' ? r.last_status_seen : null,
  };
  o.outcome = classify(o, planted, lineNo);
  observations.push(o);
}

for (const c of ORDER) {
  const got = observations.filter((o) => o.client === c).map((o) => o.flavor);
  if (got.length !== FLAVOR_ORDER.length) throw new Error(`${c}: ${got.length} flavors, expected ${FLAVOR_ORDER.length}`);
  for (const f of FLAVOR_ORDER) if (!got.includes(f)) throw new Error(`${c}: missing flavor ${f}`);
}
observations.sort((a, b) => ORDER.indexOf(a.client) - ORDER.indexOf(b.client) || FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor));

const logPath = SRC.replace(/\.jsonl$/, '.log');
let logText = '';
try { logText = readFileSync(logPath, 'utf8'); } catch { throw new Error(`the run log ${logPath} must be committed beside the capture`); }
const clients = ORDER.map((id) => ({ id, name: ROSTER[id].name, role: 'client', ...clientMeta.get(id) }));

// The machine gate covers everything that is emitted: the rows, the client metadata (version, platform,
// invocation, jar), the provenance line and the run log committed beside the capture. A path or a host
// other than badhttp.dev / alt.badhttp.dev anywhere in them refuses the run.
const scanned = [['a row', JSON.stringify(observations)], ['the client metadata', JSON.stringify(clients)], ['the provenance line', JSON.stringify(meta)], ['the run log', logText]];
for (const [what, text] of scanned) {
  for (const re of FORBIDDEN) if (re.test(text)) throw new Error(`refusing to emit: ${what} matches ${re}`);
  for (const m of text.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/g)) {
    if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) throw new Error(`refusing to emit: ${what} names the host ${JSON.stringify(m[1])}`);
  }
}
if (/(FAILED|raised)/.test(logText) && !observations.some((o) => o.outcome === 'client-raised' || o.outcome === 'request-failed')) throw new Error('the run log reports a failure the rows do not carry');

const out = `// GENERATED by scripts/witness-parse-cookies.mjs from ${SRC} — do not edit by hand.
// Re-run the generator after any new capture; the capture scripts are in scripts/cookies-witness/.
//
// Eight real HTTP clients, each with a fresh jar per flavor, run through GET /cookies/{flavor}, GET /cookies/echo,
// GET /cookies/delete and GET /cookies/echo again for every /cookies setter flavor on ${meta.probed} against badhttp
// ${meta.badhttp_version_observed}${meta.worker_version ? ` (Worker deployment ${meta.worker_version})` : ''}. The oracle is /cookies/echo: the Cookie header as it reached the
// Worker, parsed the way this server documents. Every value this family plants is a documented constant.

export const WITNESS_COOKIES = {
  family: 'cookies',
  probed: ${JSON.stringify(meta.probed)},
  badhttp_version_observed: ${JSON.stringify(meta.badhttp_version_observed)},
  worker_version: ${JSON.stringify(meta.worker_version ?? null)},
  flavors: ${FLAVOR_ORDER.length},
  source_file: ${JSON.stringify(SRC)},
  run_log: ${JSON.stringify(logPath)},
  capture_scripts: 'scripts/cookies-witness/',
};

export const CLIENTS_COOKIES = ${JSON.stringify(clients, null, 2)};

export const OBSERVATIONS_COOKIES = [
${observations.map((o) => '  ' + JSON.stringify(o) + ',').join('\n')}
];
`;
writeFileSync(OUT, out);
const outcomes = {};
for (const o of observations) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
console.log(`${OUT}: ${clients.length} clients x ${FLAVOR_ORDER.length} flavors = ${observations.length} observations`);
console.log('outcomes:', JSON.stringify(outcomes));

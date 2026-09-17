#!/usr/bin/env node
// Turns the captured witness run into a source literal the Worker can serve.
//
// Input:  docs/probe-compress-clients-2026-09-02.txt — the raw capture, committed, re-runnable
//         from scripts/compress-witness/*.
// Output: src/witness-data.js — a generated literal. The Worker never parses text at runtime.
//
// Re-run after any new capture:  node scripts/witness-parse.mjs
//
// The capture file has three line shapes, all of which appear in the real data:
//   6 fields  flavor | status | ce=[…] | bytes=N/M | SHA-OK|sha-DIFF(first=…) | error
//   4 fields  flavor | status | ce=[…] | body-error: …      (headers arrived, decode threw)
//   2 fields  flavor | error: …                             (raised before a usable response)
// Anything else is a parse error and stops the run: a silently dropped row would show up only as
// a wrong count much later.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'docs/probe-compress-clients-2026-09-02.txt';
const OUT = 'src/witness-data.js';

// The eight profiles in the capture, in file order. `role` is the honest distinction: six are HTTP
// clients decoding a response, two are urllib controls that never decode — they exist to witness
// what Cloudflare's edge made of each flavor, which is the second column of the /compress docs.
// Keeping them labelled is what lets the site keep saying "six real clients" and stay exactly true.
const PROFILES = [
  { id: 'curl', match: '===== curl (--compressed) =====', name: 'curl', role: 'client',
    version: '8.7.1', platform: 'x86_64-apple-darwin25.0', invocation: 'curl --compressed',
    accept_encoding_sent: 'gzip, deflate' },
  { id: 'undici', match: '===== Node fetch (undici) =====', name: 'Node fetch (undici)', role: 'client',
    version: 'node v26.8.1 / undici 8.10.0', platform: 'node', invocation: 'fetch()',
    accept_encoding_sent: 'gzip, deflate, br' },
  { id: 'urllib', match: '## urllib.request (stdlib; sends no Accept-Encoding, never decodes)',
    name: 'Python urllib.request', role: 'control',
    version: 'Python 3.14 stdlib', platform: 'python', invocation: 'urllib.request.urlopen',
    accept_encoding_sent: '(none)',
    note: 'Sends no Accept-Encoding and never decodes, so its bytes are what the edge made of the flavor — not a decoder under test.' },
  { id: 'urllib-gzip', match: '## urllib.request with Accept-Encoding: gzip set by hand (raw bytes, no decoding)',
    name: 'Python urllib.request (Accept-Encoding: gzip)', role: 'control',
    version: 'Python 3.14 stdlib', platform: 'python', invocation: 'urllib.request.urlopen',
    accept_encoding_sent: 'gzip',
    note: 'Asks for gzip and still never decodes, so its bytes are the flavor as this server sent it — the as-sent oracle, not a decoder under test.' },
  { id: 'requests', match: '## requests 2.34.2 (urllib3 decoder; default Accept-Encoding: gzip, deflate, br, zstd)',
    name: 'Python requests', role: 'client',
    version: '2.34.2 (urllib3 decoder)', platform: 'python', invocation: 'requests.get',
    accept_encoding_sent: 'gzip, deflate, br, zstd' },
  { id: 'httpx', match: '## httpx 0.28.1 (own decoders; default Accept-Encoding: gzip, deflate, br, zstd)',
    name: 'Python httpx', role: 'client',
    version: '0.28.1 (own decoders)', platform: 'python', invocation: 'httpx.get',
    accept_encoding_sent: 'gzip, deflate, br, zstd' },
  { id: 'ruby-nethttp', match: '===== Ruby Net::HTTP =====', name: 'Ruby Net::HTTP', role: 'client',
    version: 'ruby 2.6.10', platform: 'ruby', invocation: 'Net::HTTP.get_response',
    accept_encoding_sent: 'gzip;q=1.0,deflate;q=0.6,identity;q=0.3 (decode_content default)' },
  { id: 'go-nethttp', match: '===== Go net/http =====', name: 'Go net/http', role: 'client',
    version: 'go1.27.0', platform: 'go', invocation: 'http.DefaultTransport',
    accept_encoding_sent: 'gzip' },
];

const text = readFileSync(SRC, 'utf8');
const lines = text.split('\n');

// Header line 1 carries the capture date and the Worker version it was taken against.
const head = lines[0];
const when = /,\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z)/.exec(head);
const ver = /Worker version ([0-9a-f]+)/.exec(head);
if (!when || !ver) throw new Error(`cannot read capture date/version from first line: ${head}`);

function parseCe(field) {
  // `ce=[gzip, gzip]` or `ce=[]`, optionally followed by ` uncompressed=true|false` (Go only).
  const m = /^ce=\[([^\]]*)\](?:\s+uncompressed=(true|false))?$/.exec(field);
  if (!m) throw new Error(`unparseable content-encoding field: ${JSON.stringify(field)}`);
  const list = m[1].trim() ? m[1].split(',').map((s) => s.trim()) : [];
  return { content_encoding_seen: list, uncompressed: m[2] === undefined ? null : m[2] === 'true' };
}

function parseBytes(field) {
  const m = /^bytes=(\d+)\/(\d+)$/.exec(field);
  if (!m) throw new Error(`unparseable bytes field: ${JSON.stringify(field)}`);
  return { bytes_received: Number(m[1]), bytes_declared_plaintext: Number(m[2]) };
}

function parseSha(field) {
  if (field === 'SHA-OK') return { plaintext_sha256_match: true, first_bytes_hex: null };
  // first= is empty when the client delivered no bytes at all (the edge's empty-body outcome).
  const m = /^sha-DIFF\(first=([0-9a-f]*)\)$/.exec(field);
  if (!m) throw new Error(`unparseable sha field: ${JSON.stringify(field)}`);
  return { plaintext_sha256_match: false, first_bytes_hex: m[1] || null };
}

// curl reports success as `exit=0`; every other client reports it as `no-error`. Both mean the
// client told its caller nothing was wrong.
function parseError(field) {
  const raw = field === 'no-error' ? null : field;
  const reported = !(field === 'no-error' || field === 'exit=0');
  return { reported_error: raw, error_reported: reported };
}

/**
 * A description of what the caller received, never a verdict on the client. Every branch is a pure
 * function of columns the capture recorded. The names are deliberately descriptive rather than
 * evaluative, because for several flavors "differs" is the CORRECT behaviour: on `undeclared` and
 * `double-hidden` this server declares no gzip coding the client should strip, so returning the
 * bytes as sent is right, and all six clients do it. On `truncated` the same outcome class is the
 * finding. Which is which is a per-flavor question the /compress documentation answers; this field
 * only reports whether the delivered bytes were the flavor's documented plaintext, and whether the
 * client said anything about it.
 */
function classify({ status, plaintext_sha256_match, error_reported }) {
  if (status === null) return 'request-failed';        // raised before a usable response
  if (plaintext_sha256_match === null) return 'decode-error'; // headers arrived, body decode threw
  if (plaintext_sha256_match) return error_reported ? 'plaintext-then-error' : 'plaintext';
  return error_reported ? 'differs-reported' : 'differs-silently';
}

const observations = [];
let current = null;
let lineNo = 0;

for (const rawLine of lines) {
  lineNo += 1;
  const line = rawLine.trim();
  if (!line) continue;

  const profile = PROFILES.find((p) => p.match === line);
  if (profile) { current = profile; continue; }
  // Group headers (the Python "=====" banner) and comments carry no data.
  if (line.startsWith('=====') || line.startsWith('##') || line.startsWith('#')) continue;
  if (!line.includes('|')) continue;
  if (!current) throw new Error(`data line before any profile header at line ${lineNo}: ${line}`);

  const f = line.split('|').map((s) => s.trim());
  let row;
  if (f.length === 6) {
    row = {
      flavor: f[0], status: Number(f[1]),
      ...parseCe(f[2]), ...parseBytes(f[3]), ...parseSha(f[4]), ...parseError(f[5]),
    };
  } else if (f.length === 4) {
    row = {
      flavor: f[0], status: Number(f[1]), ...parseCe(f[2]),
      bytes_received: null, bytes_declared_plaintext: null,
      plaintext_sha256_match: null, first_bytes_hex: null,
      reported_error: f[3], error_reported: true,
    };
  } else if (f.length === 2) {
    row = {
      flavor: f[0], status: null,
      content_encoding_seen: null, uncompressed: null,
      bytes_received: null, bytes_declared_plaintext: null,
      plaintext_sha256_match: null, first_bytes_hex: null,
      reported_error: f[1], error_reported: true,
    };
  } else {
    throw new Error(`line ${lineNo} has ${f.length} fields, expected 6, 4 or 2: ${line}`);
  }
  row.client = current.id;
  row.outcome = classify(row);
  observations.push(row);
}

// Every profile must have covered the same flavor set, or the matrix has holes the site would
// render as if they were findings.
const byClient = new Map();
for (const o of observations) {
  if (!byClient.has(o.client)) byClient.set(o.client, []);
  byClient.get(o.client).push(o.flavor);
}
if (byClient.size !== PROFILES.length) {
  throw new Error(`parsed ${byClient.size} profiles, expected ${PROFILES.length}: ${[...byClient.keys()].join(', ')}`);
}
const reference = byClient.get(PROFILES[0].id).join(',');
for (const [id, flavors] of byClient) {
  if (flavors.join(',') !== reference) throw new Error(`profile ${id} covers a different flavor set than ${PROFILES[0].id}`);
}
const flavorCount = byClient.get(PROFILES[0].id).length;

const clients = PROFILES.map(({ match, ...rest }) => rest);
const out = `// GENERATED by scripts/witness-parse.mjs from ${SRC} — do not edit by hand.
// Re-run the generator after any new capture; the capture scripts are in scripts/compress-witness/.
//
// This is the only data in this repository that this project did not author. Six real HTTP clients
// and two non-decoding controls, each fetched all ${flavorCount} /compress flavors on ${when[1]}
// against Worker version ${ver[1]}. It is the evidence behind the client note the home page has
// carried since v0.12.0 — which until now cited a repository nobody outside the project can open.

export const WITNESS = {
  family: 'compress',
  probed: ${JSON.stringify(when[1])},
  badhttp_version_observed: ${JSON.stringify(ver[1])},
  flavors: ${flavorCount},
  source_file: ${JSON.stringify(SRC)},
  capture_scripts: 'scripts/compress-witness/',
};

export const CLIENTS = ${JSON.stringify(clients, null, 2)};

export const OBSERVATIONS = ${JSON.stringify(observations, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')};
`;

writeFileSync(OUT, out);
const outcomes = {};
for (const o of observations) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
console.log(`${OUT}: ${clients.length} profiles x ${flavorCount} flavors = ${observations.length} observations`);
console.log('outcomes:', JSON.stringify(outcomes));

// /clients — what real HTTP clients did, as data. Two families so far.
//
// Why this exists (session 19, 2026-09-07). Since v0.12.0 the home page has carried a paragraph
// asserting how six real HTTP clients behave against twenty-one content-coding flavors, and cited
// `docs/probe-compress-clients-2026-09-02.txt` "in the project repository" as its evidence. That
// repository is private. It was the one place on this site where the project's own rule — only
// document behaviour verified live — was unverifiable by the reader. This ships the evidence.
//
// It is also the only artifact here that this project did not author. Every one of /corpus.jsonl's
// rows is badhttp's own prose about badhttp's own endpoint; the correspondent who prompted the
// corpus argued, in substance, that a corpus written by the checker's own authors cannot reveal the
// cases they never imagined. This table is independent implementations, written by strangers,
// measurably disagreeing with each other. The disagreement is the finding.
//
// Session 23 (2026-09-17) added the second family: /crosshost, eight clients started at every flavor
// with the family's published fake test values, and the oracle's report of what arrived after the
// redirect. Session 22 had published those results as prose in the /crosshost index; the rows are
// the same observations, re-captured, in the join-to-corpus format.
//
// Stateless like everything else: the observations are generated literals (src/witness-data.js and
// src/witness-crosshost-data.js, from scripts/witness-parse.mjs and scripts/witness-parse-crosshost.mjs),
// served as-is. Nothing is measured at request time — these are dated captures, and they say so on
// every row.

import { WITNESS, CLIENTS, OBSERVATIONS } from './witness-data.js';
import { WITNESS_CROSSHOST, CLIENTS_CROSSHOST, OBSERVATIONS_CROSSHOST } from './witness-crosshost-data.js';
import { LICENSE } from './corpus.js';
import { crosshostFindings } from './crosshost.js';

// The keys every row carries whatever its family. Family-specific fields are listed per family below.
export const COMMON_FIELDS = ['id', 'corpus_id', 'family', 'flavor', 'url', 'client', 'observed', 'badhttp_version_observed', 'status', 'reported_error', 'outcome', 'license'];

// ---------------------------------------------------------------------------------------------------
// compress: six decoding clients and two non-decoding controls x 21 flavors.

// What each outcome means, stated once, because the names describe what the caller received and
// NOT whether the client was correct. See the note in scripts/witness-parse.mjs.
const COMPRESS_OUTCOMES = {
  plaintext: 'The caller received exactly the flavor\'s documented plaintext (SHA-256 match), and the client reported no error.',
  'plaintext-then-error': 'The caller received the whole documented plaintext AND the client reported an error — it handed over every byte and then told you something was wrong.',
  'differs-silently': 'The bytes the caller received are not the documented plaintext, and the client reported nothing at all.',
  'differs-reported': 'The bytes the caller received are not the documented plaintext, and the client reported an error.',
  'decode-error': 'Response headers arrived; the body decode raised before a complete body reached the caller.',
  'request-failed': 'The client raised before any usable response reached the caller.',
};

const COMPRESS_READING =
  'Read `outcome` as a description of what the caller received, never as a verdict on the client. ' +
  '"differs-silently" is the CORRECT behaviour on some flavors and the finding on others, and the ' +
  'difference is a property of the flavor, not of the client. On `undeclared` and `double-hidden` ' +
  'this server declares no coding for the client to strip, so returning the bytes exactly as sent ' +
  'is right — and all six clients do. On `truncated` the identical outcome is the finding: five of ' +
  'six returned a partial document as though it were whole. GET /compress documents which is which, ' +
  'per flavor. No client here is scored, ranked, or called conformant: no specification says what a ' +
  'client must surface to its caller for most of these cases, which is exactly why the observations ' +
  'are worth more than an opinion.';

function compressRole(id) {
  const c = CLIENTS.find((x) => x.id === id);
  return c ? c.role : null;
}

/** One row per observation: 8 profiles x 21 flavors. Byte-for-byte the rows v0.14.0 shipped. */
function compressRows({ origin }) {
  return OBSERVATIONS.map((o) => {
    const c = CLIENTS.find((x) => x.id === o.client);
    return {
      id: `compress.${o.flavor}.${o.client}`,
      corpus_id: `compress.${o.flavor}`,
      family: WITNESS.family,
      flavor: o.flavor,
      url: `${origin}/compress/${o.flavor}`,
      client: {
        id: c.id, name: c.name, version: c.version, platform: c.platform,
        invocation: c.invocation, accept_encoding_sent: c.accept_encoding_sent, role: c.role,
      },
      observed: WITNESS.probed,
      badhttp_version_observed: WITNESS.badhttp_version_observed,
      status: o.status,
      content_encoding_seen: o.content_encoding_seen,
      uncompressed_flag: o.uncompressed,
      bytes_received: o.bytes_received,
      bytes_declared_plaintext: o.bytes_declared_plaintext,
      plaintext_sha256_match: o.plaintext_sha256_match,
      first_bytes_hex: o.first_bytes_hex,
      reported_error: o.reported_error,
      outcome: o.outcome,
      oracle_header: 'x-badhttp-plain-sha256',
      license: LICENSE.responses.id,
    };
  });
}

function compressFamily({ rows }) {
  // Disagreement among the six decoding clients, computed rather than asserted. The controls are
  // excluded on purpose: they never decode, so counting them would manufacture disagreement.
  const perFlavor = {};
  for (const o of OBSERVATIONS) {
    if (compressRole(o.client) !== 'client') continue;
    (perFlavor[o.flavor] = perFlavor[o.flavor] || new Set()).add(o.outcome);
  }
  const disagreement = Object.fromEntries(
    Object.entries(perFlavor).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([f, s]) => [f, { distinct_outcomes: s.size, outcomes: [...s].sort() }])
  );
  const outcomeCounts = {};
  for (const o of OBSERVATIONS) {
    const k = `${compressRole(o.client)}:${o.outcome}`;
    outcomeCounts[k] = (outcomeCounts[k] || 0) + 1;
  }
  return {
    what:
      'What eight HTTP implementations actually did with the twenty-one /compress flavors, one row ' +
      'per observation. Six of them decode content codings and are the subject; two are Python ' +
      'urllib profiles that never decode and serve as controls — one sending no Accept-Encoding ' +
      '(so its bytes are what Cloudflare\'s edge made of the flavor), one asking for gzip and still ' +
      'not decoding (so its bytes are the flavor as this server sent it).',
    rows: rows.length,
    flavors: WITNESS.flavors,
    observed: WITNESS.probed,
    badhttp_version_observed: WITNESS.badhttp_version_observed,
    clients: CLIENTS,
    fields: [...COMMON_FIELDS, 'content_encoding_seen', 'uncompressed_flag', 'bytes_received', 'bytes_declared_plaintext', 'plaintext_sha256_match', 'first_bytes_hex', 'oracle_header'],
    outcome_legend: COMPRESS_OUTCOMES,
    reading_this: COMPRESS_READING,
    observation_counts_by_role: outcomeCounts,
    disagreement_by_flavor: disagreement,
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS.probed} against badhttp version ` +
      `${WITNESS.badhttp_version_observed}, with the client versions on each row. Client behaviour ` +
      'changes between releases and this table does not update itself. Re-run it from ' +
      `${WITNESS.capture_scripts} in the source and the numbers move; the date on every row is how ` +
      'you know whether to trust it.',
    reproduce:
      'Every row is one request. Fetch the row\'s url with the row\'s client at the row\'s ' +
      'accept_encoding_sent, compare what your caller receives against the response\'s ' +
      'x-badhttp-plain-sha256 header, and you have re-derived the row.',
  };
}

// ---------------------------------------------------------------------------------------------------
// crosshost: eight clients x 9 flavors, each started at the flavor url with the published fake test
// values, and what the landing oracle reported.

// Again: descriptions of what arrived, never verdicts. See scripts/witness-parse-crosshost.mjs.
const CROSSHOST_OUTCOMES = {
  'all-arrived': 'Every header the harness sent arrived on the final hop. `sent` says what was sent: Authorization and X-Api-Key on every flavor, plus a hand-set Cookie on every flavor but jar.',
  'some-arrived': 'A subset of the sent headers arrived on the final hop. The `arrived` object says which.',
  'none-arrived': 'None of the sent headers arrived on the final hop.',
  'did-not-land': 'The client returned a response, but not the oracle\'s: it stopped before the landing url, or what came back carried no x-badhttp-version (Cloudflare\'s rate-limit page, not this server). Recorded only if three attempts with pauses never landed.',
  'request-failed': 'The client raised before any usable response reached the caller.',
};

const CROSSHOST_READING =
  'Read `arrived` and `outcome` as a description of what reached the landing host, never as a ' +
  'verdict on the client. RFC 9110 §15.4 says nothing about credentials on redirects; the Fetch ' +
  'standard\'s cross-origin stripping rule governs browsers, not these clients; and several of the ' +
  'behaviours here are documented choices by the client\'s own authors — Go net/http forwards to a ' +
  'subdomain of the initial host by design, and Python requests keeps Authorization across ' +
  'http-to-https on the same host as a carve-out its source calls backwards compatibility. Whether ' +
  'forwarding across a given boundary is a bug depends on the boundary and on what the client ' +
  'documents. What a row can tell you truthfully is which headers arrived, on which host and port, ' +
  'over which transport, and — on the jar flavor — which of the cookies this server minted came back. ' +
  'Nothing sent is echoed anywhere: the oracle reports presence, a scheme name and byte length, and ' +
  'names only cookies under its own badhttp_ prefix — the three it mints on the jar flavor plus the ' +
  'harness\'s own badhttp_witness — and the rows carry only booleans and those names. hops_followed ' +
  'is null where the client exposes no count (Node fetch); redirect_followed carries the boolean it ' +
  'does expose, and final_url the url the chain ended on. attempts is how many tries the chain took ' +
  'before an oracle response arrived (a retry means the zone rate limit answered, not this server).';

/** One row per observation: 8 clients x 9 flavors. url is the STARTING url the harness used. */
function crosshostRows() {
  return OBSERVATIONS_CROSSHOST.map((o) => {
    const c = CLIENTS_CROSSHOST.find((x) => x.id === o.client);
    return {
      id: `crosshost.${o.flavor}.${o.client}`,
      corpus_id: `crosshost.${o.flavor}`,
      family: WITNESS_CROSSHOST.family,
      flavor: o.flavor,
      url: o.start_url,
      client: {
        id: c.id, name: c.name, version: c.version, platform: c.platform,
        invocation: c.invocation, cookie_jar: c.cookie_jar, role: c.role,
      },
      observed: WITNESS_CROSSHOST.probed,
      badhttp_version_observed: WITNESS_CROSSHOST.badhttp_version_observed,
      status: o.final_status,
      hops_followed: o.hops_followed,
      redirect_followed: o.redirect_followed,
      final_url: o.final_url,
      attempts: o.attempts,
      landed_on: o.landed_on,
      landed_port: o.port,
      landed_scheme: o.scheme,
      transport_was_encrypted: o.transport_was_encrypted,
      sent: o.sent,
      arrived: o.arrived,
      authorization_scheme_seen: o.authorization_scheme_seen,
      cookie_names_arrived: o.cookie_names_arrived,
      cookie_other_count: o.cookie_other_count,
      matches_documented_test_credential: o.matches_documented,
      reported_error: o.reported_error,
      outcome: o.outcome,
      oracle: 'the `received` object of the landing response (/crosshost/land on whichever host the chain ended on); it never echoes what it received',
      license: LICENSE.responses.id,
    };
  });
}

// A client's answer on a flavor, as a short string, so disagreement can be counted without an
// opinion: which of the sent headers arrived, plus the names of the cookies the jar hop minted that
// arrived. The harness's own badhttp_witness is excluded from that list: the cookie boolean already
// says whether it arrived, and it is not something this server set.
export function crosshostSignature(o) {
  if (!o.arrived) return o.outcome;
  const parts = [];
  if (o.arrived.authorization) parts.push('authorization');
  if (o.sent.cookie && o.arrived.cookie) parts.push('cookie');
  if (o.arrived.x_api_key) parts.push('x-api-key');
  const jar = (o.cookie_names_arrived || []).filter((n) => n !== 'badhttp_witness').sort();
  return `arrived: ${parts.join(', ') || 'none'}${jar.length ? ` | minted cookies: ${jar.join(', ')}` : ''}`;
}

function crosshostFamily({ rows }) {
  const perFlavor = {};
  for (const o of OBSERVATIONS_CROSSHOST) {
    (perFlavor[o.flavor] = perFlavor[o.flavor] || new Map());
    const sig = crosshostSignature(o);
    perFlavor[o.flavor].set(sig, (perFlavor[o.flavor].get(sig) || []).concat(o.client));
  }
  const disagreement = Object.fromEntries(
    Object.entries(perFlavor).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([f, m]) => [f, { distinct_answers: m.size, answers: Object.fromEntries([...m.entries()].sort((a, b) => b[1].length - a[1].length)) }])
  );
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_CROSSHOST) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  return {
    what:
      'What eight HTTP clients did with Authorization, Cookie and X-Api-Key when a redirect crossed ' +
      'each of the nine /crosshost boundaries, one row per observation. Each row is one chain: the ' +
      'client was started at the flavor url with the family\'s published fake test values, followed ' +
      'the redirect on its own, and the landing oracle reported what arrived. Eight of the nine flavors ' +
      'cross a boundary; same-origin is the control and crosses none. On the jar flavor the ' +
      'hand-set Cookie header is omitted and the client\'s own cookie jar (where it has one) is what is ' +
      'measured, against the three cookies the first hop sets.',
    rows: rows.length,
    flavors: WITNESS_CROSSHOST.flavors,
    observed: WITNESS_CROSSHOST.probed,
    badhttp_version_observed: WITNESS_CROSSHOST.badhttp_version_observed,
    worker_version: WITNESS_CROSSHOST.worker_version,
    clients: CLIENTS_CROSSHOST,
    fields: [...COMMON_FIELDS, 'hops_followed', 'redirect_followed', 'final_url', 'attempts', 'landed_on', 'landed_port', 'landed_scheme', 'transport_was_encrypted', 'sent', 'arrived', 'authorization_scheme_seen', 'cookie_names_arrived', 'cookie_other_count', 'matches_documented_test_credential', 'oracle'],
    outcome_legend: CROSSHOST_OUTCOMES,
    reading_this: CROSSHOST_READING,
    outcome_counts: outcomeCounts,
    disagreement_by_flavor: disagreement,
    findings: crosshostFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_CROSSHOST.probed} against badhttp ` +
      `version ${WITNESS_CROSSHOST.badhttp_version_observed}, with the client versions on each row. ` +
      'Client behaviour changes between releases — several of the advisories /crosshost cites are ' +
      'exactly such changes — and this table does not update itself. Re-run it from ' +
      `${WITNESS_CROSSHOST.capture_scripts} in the source and the numbers move; the date on every row ` +
      'is how you know whether to trust it.',
    reproduce:
      'Every row is one chain. Start the row\'s client at the row\'s url with Authorization: Basic ' +
      'YWdlbnQ6Y29ycmVjdA== (agent:correct), X-Api-Key: badhttp-key-ok and, on every flavor but jar, ' +
      'Cookie: badhttp_witness=1; let it follow the redirect; read the landing response\'s `received` ' +
      'object. Pace the chains — each is 2 or 3 requests against a zone limit of 100 per 10 s — and ' +
      'treat a response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------

export function clientRows({ origin }) {
  return [...compressRows({ origin }), ...crosshostRows()];
}

export function clientsIndex({ origin }) {
  const compress = compressRows({ origin });
  const crosshost = crosshostRows();
  return {
    what:
      'What real HTTP clients actually did with this server\'s misbehaviour, as data: one row per ' +
      'observation, across two families so far — the 21 /compress flavors (six decoding clients and ' +
      'two non-decoding controls) and the 9 /crosshost flavors (eight clients; eight boundaries and a ' +
      'same-origin control). Every row names ' +
      'the client and its version, the date, what it received, and what it reported.',
    why:
      'For /compress the home page has claimed these results since v0.12.0 and cited a private ' +
      'repository as the evidence; for /crosshost the family index carried them as prose from ' +
      'v0.17.0 (2026-09-10). Here are both as rows. It is also the only data on this service that ' +
      'badhttp did not write about itself.',
    jsonl: `${origin}/clients.jsonl`,
    rows: compress.length + crosshost.length,
    families: {
      compress: compressFamily({ rows: compress }),
      crosshost: crosshostFamily({ rows: crosshost }),
    },
    common_fields: COMMON_FIELDS,
    join: 'corpus_id joins each row to a row of ' + `${origin}/corpus.jsonl` + '; family names the block above whose legend and fields apply',
    reading_this:
      'In every family, `outcome` describes what the caller received and is never a verdict on the ' +
      'client. Each family block carries its own outcome_legend and its own reading_this, because ' +
      'what "correct" would even mean differs per flavor and is often unspecified. No client here is ' +
      'scored, ranked, or called conformant.',
    license: LICENSE.responses.id,
    license_url: `${origin}/license`,
  };
}

export function handleClients({ seg, url, json, withBase }) {
  const origin = url.origin;
  if (seg[0] === 'clients.jsonl') {
    const rows = clientRows({ origin });
    const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    return new Response(body, {
      status: 200,
      headers: withBase({
        'content-type': 'application/x-ndjson; charset=utf-8',
        // Same reason as /corpus.jsonl: this file is read by clients we have just told to send
        // Accept-Encoding: gzip, and the edge would otherwise transcode it under them.
        'cache-control': 'public, max-age=300, no-transform',
        'x-badhttp-license': LICENSE.responses.id,
        'x-badhttp-rows': String(rows.length),
        link: `<${origin}/license>; rel="license"`,
      }),
    });
  }
  return json(clientsIndex({ origin }), 200, {
    'cache-control': 'public, max-age=300, no-transform',
    'x-badhttp-license': LICENSE.responses.id,
    link: `<${origin}/license>; rel="license"`,
  });
}

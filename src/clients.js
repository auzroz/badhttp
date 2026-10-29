// /clients — what real HTTP clients did, as data. Eight families so far.
//
// Why this exists (session 19, 2026-09-07). Since v0.12.0 the home page has carried a paragraph
// asserting how six real HTTP clients behave against twenty-one content-coding flavors, and cited
// `docs/probe-compress-clients-2026-09-02.txt` "in the project repository" as its evidence. That
// repository was private (it went public on 2026-09-18). It was the one place on this site where the project's own rule — only
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
// Session 25 (2026-09-18) added the third family: /auth, the same eight clients each handed the documented
// fake credentials through its own mechanism for the flavor's scheme, and the /auth response itself as the
// oracle. The home page had carried a three-client prose note since v0.9.0; the rows replace it.
//
// Stateless like everything else: the observations are generated literals (src/witness-data.js,
// src/witness-crosshost-data.js and src/witness-auth-data.js, from scripts/witness-parse.mjs,
// scripts/witness-parse-crosshost.mjs and scripts/witness-parse-auth.mjs), served as-is. Nothing is measured at request time — these are dated captures, and they say so on
// every row.

import { WITNESS, CLIENTS, OBSERVATIONS } from './witness-data.js';
import { WITNESS_CROSSHOST, CLIENTS_CROSSHOST, OBSERVATIONS_CROSSHOST } from './witness-crosshost-data.js';
import { WITNESS_AUTH, CLIENTS_AUTH, OBSERVATIONS_AUTH } from './witness-auth-data.js';
import { LICENSE } from './corpus.js';
import { crosshostFindings } from './crosshost.js';
import { authFindings } from './auth.js';
import { WITNESS_COOKIES, CLIENTS_COOKIES, OBSERVATIONS_COOKIES } from './witness-cookies-data.js';
import { cookieFindings } from './cookies.js';
import { WITNESS_SSE, CLIENTS_SSE, REFERENCE_SSE, OBSERVATIONS_SSE } from './witness-sse-data.js';
import { sseFindings } from './sse.js';
import { WITNESS_RANGE, CLIENTS_RANGE, REFERENCE_RANGE, OBSERVATIONS_RANGE } from './witness-range-data.js';
import { rangeFindings } from './range.js';
import { WITNESS_ETAG, CLIENTS_ETAG, REFERENCE_ETAG, OBSERVATIONS_ETAG } from './witness-etag-data.js';
import { etagFindings } from './etag.js';
import { WITNESS_X402, CLIENTS_X402, REFERENCE_X402, OBSERVATIONS_X402 } from './witness-x402-data.js';
import { x402Findings } from './x402-witness.js';

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

// The truncated-flavor counts in COMPRESS_READING come from the rows: the clients (not the controls) that reported
// nothing, split into those that returned some of the document and those that returned an empty body.
const CW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const cw = (n) => CW[n] || String(n);
// Number words for the flavor and client counts the prose spells out: computed from the witness data so a re-capture cannot leave them behind.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one'];
const numWord = (n) => NUM_WORDS[n] || String(n);
const TRUNC_ROWS = OBSERVATIONS.filter((o) => o.flavor === 'truncated' && CLIENTS.find((c) => c.id === o.client)?.role === 'client');
const TRUNC_SILENT = TRUNC_ROWS.filter((o) => o.outcome === 'differs-silently');
const TRUNC_PARTIAL = TRUNC_SILENT.filter((o) => o.bytes_received > 0).length;
const TRUNC_EMPTY = TRUNC_SILENT.filter((o) => o.bytes_received === 0).length;
const UNDECL_ROWS = OBSERVATIONS.filter((o) => (o.flavor === 'undeclared' || o.flavor === 'double-hidden') && CLIENTS.find((c) => c.id === o.client)?.role === 'client');
const UNDECL_SILENT = UNDECL_ROWS.filter((o) => o.outcome === 'differs-silently');
const COMPRESS_READING =
  'Read `outcome` as a description of what the caller received, never as a verdict on the client. ' +
  '"differs-silently" is the expected outcome on some flavors and the finding on others, and the ' +
  'difference is a property of the flavor, not of the client. On `undeclared` and `double-hidden` ' +
  'this server declares no coding for the client to strip, so returning the bytes exactly as sent ' +
  'is the expected outcome — and ' +
  `${numWord(UNDECL_SILENT.length)} of ${numWord(UNDECL_ROWS.length)} client rows on those two flavors returned it. On` + ' `truncated` the identical outcome is the finding: ' +
  `${cw(TRUNC_SILENT.length)} of ${cw(TRUNC_ROWS.length)} reported no error: ${cw(TRUNC_PARTIAL)} returned a partial document as though it were whole` +
  `${TRUNC_EMPTY ? ` and ${cw(TRUNC_EMPTY)} an empty body` : ''}. GET /compress documents which is which, ` +
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
// auth: eight clients x 18 flavors, each handed the documented fake credentials through its own mechanism
// for the flavor's scheme, and what the /auth oracle answered.

// How the credentials were handed to the client — what was CONFIGURED, fixed per flavor by the harness and
// NOT chosen by the client. Whether credentials then went out first, waited for a challenge or were retried is
// read from `hops`, never asserted here. Which kinds encode the credentials in the client and which in the
// harness is stated, because on a harness-encoded row the encoding is the harness's choice.
const AUTH_MECHANISMS = {
  'basic-auth': 'The client\'s own Basic option or auth object (curl -u, Go Request.SetBasicAuth, requests/httpx/aiohttp BasicAuth, urllib3 make_headers), configured with the documented credentials. The client encodes them and decides when to send them.',
  'basic-header': 'A hand-set Authorization: Basic header, used only for Node fetch, which has no credential mechanism of its own. The HARNESS encoded the credentials (base64 of the UTF-8 bytes), so the encoding on that row is the harness\'s choice, and the header goes out on the first request by construction.',
  'basic-handler': 'A challenge handler for Basic (urllib\'s HTTPBasicAuthHandler over HTTPPasswordMgrWithDefaultRealm): nothing is sent until a 401 arrives, and the handler decides whether the challenge is one it will answer.',
  'digest-handler': 'The client\'s Digest mechanism (curl --digest, urllib\'s HTTPDigestAuthHandler, requests\' and httpx\'s DigestAuth, aiohttp\'s DigestAuthMiddleware), a fresh instance per row: nothing is sent until a Digest challenge arrives. On multi it was handed the choice for requests, httpx and aiohttp, which have no mechanism that chooses among offered schemes, because it must parse the two-challenge header to answer.',
  'any-handler': 'A mechanism that reads the challenge and chooses among the schemes it speaks: curl --anyauth (Basic, Digest, NTLM, Negotiate as offered) and urllib with both its Basic and Digest handlers installed on one opener.',
  'bearer-auth': 'The client\'s own Bearer option (curl --oauth2-bearer) with the documented test token.',
  'bearer-header': 'A hand-set Authorization: Bearer header with the documented test token: no client here but curl has a Bearer option.',
  'no-mechanism': 'The client has no mechanism for the scheme the flavor demands (net/http, fetch and urllib3 have no Digest and no WWW-Authenticate handling), so the request was sent with no credentials at all. The row is a capability, not a bug.',
};

const AUTH_OUTCOMES = {
  authenticated: 'The final response the caller received was a 2xx whose body says authenticated: true. On accept-any that is the server saying it checked nothing (checked_flag: false).',
  refused: 'A final 4xx from this server reached the caller; server_error, server_defect, server_note and challenge_seen say why. On forbidden the body says the credentials were valid and the resource still refuses; on the Digest flavors under no-mechanism it is the absence of any credentials. Read the flavor.',
  'redirect-not-followed': 'A final 3xx reached the caller: the client returned the redirect rather than following it.',
  'client-raised': 'The client raised something other than its transport-error type before returning a response to the caller. reported_error names the exception (anything credential-shaped in it was scrubbed); last_status_seen and challenge_seen carry what the harness saw on the wire before the raise.',
  'request-failed': 'A transport failure; the client returned nothing usable.',
};

const AUTH_READING =
  'Read `outcome` and every server-reported field as a description of what the caller received, never as ' +
  'a verdict on the client. `mechanism_kind` and `mechanism` say what was CONFIGURED for that row — chosen ' +
  'per flavor by the harness, not by the client — and mechanism_legend says which kinds are the client\'s ' +
  'own (it encoded and sent the credentials) and which are a header the harness set. Whether credentials ' +
  'went out before any challenge is not asserted anywhere: `hops` lists every request the client sent with ' +
  'its status and whether Authorization or Proxy-Authorization was present, `sent_credentials_first` and ' +
  '`credentialed_requests` are read from it, and a count is only meaningful next to the kind — a header ' +
  'kind sends on the first request by construction, a handler kind cannot. A client with no mechanism for ' +
  'the flavor\'s scheme (`no-mechanism`) was sent with no credentials, so its `refused` on the Digest ' +
  'flavors is a capability of the library, not a bug in it; a client handed its Basic option on a ' +
  'challenge-parser flavor never observed the challenge, and its mechanism string says so. On the proxy ' +
  'flavor the credentials configured were ORIGIN credentials, which that flavor does not read; no proxy ' +
  'credentials were configured because no proxy exists in the harness, so those rows show what a client ' +
  'does with an unexpected 407, not what it would do with proxy credentials. On always-401, ' +
  '`credentialed_requests` is an observation for handler kinds and one-by-construction for the others, and ' +
  'it cannot distinguish a retry with the same credentials from a retry with different ones. Every count is ' +
  'bounded by the client\'s own retry cap and by the harness\'s 30-second timeout and 6-redirect limit, so ' +
  'a runaway loop would appear as request-failed, not as a large number; `requests_counted_by` on each ' +
  'client says at which layer its requests were counted. RFC 9110 §11 leaves preemptive sending, retry ' +
  'counts and the choice among several challenges to the client, and RFC 7617 makes charset advisory, so ' +
  '`encoding` is the server reporting which bytes arrived, not a grade — and on a harness-encoded row it ' +
  'reports the harness\'s choice. Nothing the server received is echoed anywhere: the /auth bodies name only ' +
  'the documented identity, `challenge_seen` is the server\'s own header, and every client-side error string ' +
  'was scrubbed of anything credential-shaped before it was published.';

const AUTH_FIELDS = ['mechanism_kind', 'mechanism', 'credential_encoded_by', 'requests_made', 'hops', 'statuses_seen', 'credentialed_requests', 'sent_credentials_first', 'last_status_seen', 'redirects_followed', 'redirect_followed', 'final_url', 'attempts', 'authenticated', 'checked_flag', 'scheme_reported', 'algorithm', 'encoding', 'generations', 'matched', 'server_error', 'server_defect', 'server_note', 'challenge_seen', 'error_kind', 'oracle'];

/** One row per observation: 8 clients x 18 flavors. */
function authRows() {
  return OBSERVATIONS_AUTH.map((o) => {
    const c = CLIENTS_AUTH.find((x) => x.id === o.client);
    return {
      id: `auth.${o.flavor}.${o.client}`,
      corpus_id: `auth.${o.flavor}`,
      family: WITNESS_AUTH.family,
      flavor: o.flavor,
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role },
      observed: WITNESS_AUTH.probed,
      badhttp_version_observed: WITNESS_AUTH.badhttp_version_observed,
      status: o.final_status,
      mechanism_kind: o.mechanism_kind,
      mechanism: o.mechanism,
      credential_encoded_by: o.credential_encoded_by,
      requests_made: o.requests_made,
      hops: o.hops,
      statuses_seen: o.statuses_seen,
      credentialed_requests: o.credentialed_requests,
      sent_credentials_first: o.sent_credentials_first,
      last_status_seen: o.last_status_seen,
      redirects_followed: o.redirects_followed,
      redirect_followed: o.redirect_followed,
      final_url: o.final_url,
      attempts: o.attempts,
      authenticated: o.authenticated,
      checked_flag: o.checked_flag,
      scheme_reported: o.scheme_reported,
      algorithm: o.algorithm,
      encoding: o.encoding,
      generations: o.generations,
      matched: o.matched,
      server_error: o.server_error,
      server_defect: o.server_defect,
      server_note: o.server_note,
      challenge_seen: o.challenge_seen,
      error_kind: o.error_kind,
      reported_error: o.reported_error,
      outcome: o.outcome,
      oracle: 'the final /auth response itself: status, WWW-Authenticate/Proxy-Authenticate, and the body\'s authenticated/checked/scheme/algorithm/encoding/generations/matched/error/defect/note fields; it never echoes a received credential',
      license: LICENSE.responses.id,
    };
  });
}

// A client's answer on a flavor as a short string: what was configured, then what the caller received
// (status, outcome and the server-reported detail) — never how many requests it took, which is a separate
// finding. The kind is part of the key so that a harness choice (Basic handed to a client that cannot
// choose on multi) is never counted as the clients disagreeing.
export function authSignature(o) {
  if (o.outcome !== 'authenticated' && o.outcome !== 'refused') return o.outcome;
  const parts = [`${o.final_status}`, o.outcome];
  if (o.scheme_reported) parts.push(`scheme=${o.scheme_reported}`);
  if (o.algorithm) parts.push(`algorithm=${o.algorithm}`);
  if (o.encoding) parts.push(`encoding=${o.encoding}`);
  if (o.generations) parts.push(`generations=${o.generations}`);
  if (o.matched) parts.push(`matched=${o.matched}`);
  if (o.checked_flag === false) parts.push('checked=false');
  if (o.server_error) parts.push(`error=${o.server_error}`);
  if (o.server_defect) parts.push('defect reported');
  return parts.join(' ');
}

function authFamily({ rows }) {
  // Disagreement is counted among the clients that HAD a mechanism for the flavor: a no-mechanism row is a
  // capability, and counting it would manufacture disagreement the way controls would on /compress.
  // Grouped by kind first: two clients configured the same way that received different answers are the
  // clients disagreeing; two configured differently are the harness's grid. distinct_answers is the largest
  // number of distinct answers within any one kind on that flavor.
  const perFlavor = {};
  for (const o of OBSERVATIONS_AUTH) {
    if (o.mechanism_kind === 'no-mechanism') continue;
    const byKind = (perFlavor[o.flavor] = perFlavor[o.flavor] || {});
    const m = (byKind[o.mechanism_kind] = byKind[o.mechanism_kind] || new Map());
    const sig = authSignature(o);
    m.set(sig, (m.get(sig) || []).concat(o.client));
  }
  const maxWithin = (byKind) => Math.max(...Object.values(byKind).map((m) => m.size));
  const disagreement = Object.fromEntries(
    Object.entries(perFlavor).sort((a, b) => maxWithin(b[1]) - maxWithin(a[1]) || a[0].localeCompare(b[0]))
      .map(([f, byKind]) => [f, {
        distinct_answers: maxWithin(byKind),
        answers_by_kind: Object.fromEntries(Object.entries(byKind).map(([k, m]) => [k, Object.fromEntries([...m.entries()].sort((a, b) => b[1].length - a[1].length))])),
      }])
  );
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_AUTH) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const kindCounts = {};
  for (const o of OBSERVATIONS_AUTH) kindCounts[o.mechanism_kind] = (kindCounts[o.mechanism_kind] || 0) + 1;
  return {
    what:
      `What ${numWord(CLIENTS_AUTH.length)} HTTP clients did with the ${numWord(WITNESS_AUTH.flavors)} /auth flavors when handed the documented fake ` +
      'credentials through their own mechanism for the flavor\'s scheme, one row per observation. Each row ' +
      'is one call from the caller\'s point of view: the client was configured, asked for the flavor url, ' +
      'followed any challenge or redirect on its own, and the /auth response it finally handed back is the ' +
      'oracle. What the row adds from the harness\'s side is how many requests the client sent to get there.',
    rows: rows.length,
    flavors: WITNESS_AUTH.flavors,
    observed: WITNESS_AUTH.probed,
    badhttp_version_observed: WITNESS_AUTH.badhttp_version_observed,
    worker_version: WITNESS_AUTH.worker_version,
    clients: CLIENTS_AUTH,
    fields: [...COMMON_FIELDS, ...AUTH_FIELDS],
    mechanism_legend: AUTH_MECHANISMS,
    outcome_legend: AUTH_OUTCOMES,
    reading_this: AUTH_READING,
    outcome_counts: outcomeCounts,
    mechanism_counts: kindCounts,
    disagreement_by_flavor: disagreement,
    disagreement_note: 'distinct_answers is, per flavor, the largest number of distinct answers (what the caller received) among clients configured with the SAME mechanism_kind; answers_by_kind lists them. Clients configured differently are the harness\'s grid, not a disagreement, and no-mechanism rows are excluded.',
    findings: authFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_AUTH.probed} against badhttp version ` +
      `${WITNESS_AUTH.badhttp_version_observed}, with the client versions on each row. Client behaviour ` +
      'changes between releases and this table does not update itself. Re-run it from ' +
      `${WITNESS_AUTH.capture_scripts} in the source and the numbers move; the date on every row is how ` +
      'you know whether to trust it.',
    reproduce:
      'Every row is one call. Configure the row\'s client the way its mechanism field says, with the ' +
      'documented credentials from GET /auth and nothing else, ask for the row\'s url, and compare the ' +
      'status and body you get back with the row\'s status and server-reported fields; count the requests ' +
      'your client sent to get there. Pace the calls against the zone limit of 100 per 10 s, and treat a ' +
      'response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------
// cookies: eight clients x 17 setter flavors, each with a fresh jar where the client has one, through set → echo → delete → echo.

// What the client HAS, never what happened. A no-jar client returns nothing on every flavor by construction.
const COOKIE_JARS = {
  'own-jar': 'The client\'s own cookie jar, default configuration, one fresh jar per flavor (curl -c/-b with a fresh file; net/http/cookiejar with the public suffix list; http.cookiejar behind urllib, requests and httpx; aiohttp\'s CookieJar). The client decides what to store and what to send.',
  'harness-jar': 'A jar the harness supplies because the transport has none: Node fetch with tough-cookie, the harness copying Set-Cookie into the jar and the jar\'s Cookie string onto each request, redirects followed by the harness so the 302\'s own Set-Cookie is seen. What is stored and what is sent is tough-cookie\'s decision; when it was sent is the harness\'s.',
  'no-jar': 'The client has no cookie jar at all (urllib3\'s PoolManager): Set-Cookie is visible on the response and nothing is ever sent back. Every such row returns nothing, which is a capability of the library, not a bug in it.',
};

const COOKIE_OUTCOMES = {
  'all-returned': 'Every cookie the flavor planted came back on the follow-up to /cookies/echo (the two nameless cookies are matched by value).',
  'some-returned': 'At least one planted cookie came back and at least one did not.',
  'none-returned': 'None came back. On wrong-domain and path-prefix this is the specified answer; on public-suffix it is what a jar with a public-suffix list returns (RFC 6265 §5.3 step 5 says user agents SHOULD use one, and plain RFC 6265 without a list would store it); on a no-jar client it is what having no jar means; elsewhere it is the finding.',
  'client-raised': 'The client raised something other than its transport-error type before returning a response.',
  'request-failed': 'The client raised before any usable response reached the caller, or the transport failed.',
};

const COOKIE_READING =
  'Read outcome as a description of what came back to /cookies/echo relative to what the flavor planted, ' +
  'never as a verdict on the client. "none-returned" is the specified answer on wrong-domain and path-prefix, ' +
  'the answer of a jar that uses a public-suffix list on public-suffix (RFC 6265 recommends one; without it the ' +
  'cookie is stored), and the finding elsewhere, and which is which is a property of the flavor (GET /cookies ' +
  'says so per flavor). A jar_kind of no-jar returns nothing everywhere because there is nothing to return ' +
  'from. unplanted_names lists cookies that came back which this flavor did not set (a comma-splitting jar\'s ' +
  'invented second cookie, a value-with-no-equals stored as a NAME), and after_delete_unplanted lists what ' +
  'was still there after /cookies/delete that the flavor never planted (a deletion tombstone kept as a live ' +
  'cookie). jar_entries is what the client\'s jar recorded where the harness could enumerate it, which is ' +
  'how a cookie stored and then withheld is told apart from one never stored. No client here is ' +
  'scored, ranked, or called conformant; RFC 6265 and rfc6265bis disagree with each other on several of ' +
  'these flavors, and a jar can be conformant to either.';

const COOKIE_FIELDS = ['jar_kind', 'jar', 'requests_made', 'hops', 'setter_status', 'setter_body_read', 'planted_names', 'echo', 'returned_names', 'unplanted_names', 'after_delete', 'after_delete_remaining', 'after_delete_unplanted', 'jar_enumerable', 'jar_entries', 'jar_rejections', 'attempts', 'error_kind', 'oracle'];

/** One row per observation: 8 clients x 17 flavors. */
function cookieRows() {
  return OBSERVATIONS_COOKIES.map((o) => {
    const c = CLIENTS_COOKIES.find((x) => x.id === o.client);
    return {
      id: `cookies.${o.flavor}.${o.client}`,
      corpus_id: `cookies.${o.flavor}`,
      family: WITNESS_COOKIES.family,
      flavor: o.flavor,
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role },
      observed: WITNESS_COOKIES.probed,
      badhttp_version_observed: WITNESS_COOKIES.badhttp_version_observed,
      status: o.echo ? o.echo.status : null,
      jar_kind: o.jar_kind,
      jar: o.jar,
      requests_made: o.requests_made,
      hops: o.hops,
      setter_status: o.setter_status,
      setter_body_read: o.setter_body_read,
      planted_names: o.planted_names,
      echo: o.echo,
      returned_names: o.returned_names,
      unplanted_names: o.unplanted_names,
      after_delete: o.after_delete,
      after_delete_remaining: o.after_delete_remaining,
      after_delete_unplanted: o.after_delete_unplanted,
      jar_enumerable: o.jar_enumerable,
      jar_entries: o.jar_entries,
      jar_rejections: o.jar_rejections,
      attempts: o.attempts,
      error_kind: o.error_kind,
      reported_error: o.reported_error,
      outcome: o.outcome,
      oracle: '/cookies/echo: the Cookie header as it reached the Worker, parsed the way this server documents (name up to the first "=", order and duplicates kept); every value this family plants is a documented constant',
      license: LICENSE.responses.id,
    };
  });
}

// A client's answer on a flavor as a short string: what came back to /cookies/echo (planted names, in order,
// with the value where it is short enough to be the observation) plus anything unplanted. Jar contents are not
// in the key (two jars that send the same thing agree, whatever they recorded), and neither is what survived
// /cookies/delete: that is one property of the client, reported once in the findings, and keying on it would
// make a jar that keeps one tombstone disagree on all seventeen flavors.
export function cookieSignature(o) {
  if (!o.echo) return o.outcome;
  const back = o.echo.cookies.map((c) => (c.value == null ? `${c.name}=<${c.value_bytes} bytes>` : `${c.name}=${c.value}`));
  return [o.outcome, back.length ? `returned ${back.join('; ')}` : 'returned nothing'].join(' | ');
}

function cookieFamily({ rows }) {
  // Disagreement is counted among the clients that HAVE a jar: a no-jar row returns nothing by construction
  // and counting it would manufacture disagreement the way controls would on /compress.
  const perFlavor = {};
  for (const o of OBSERVATIONS_COOKIES) {
    if (o.jar_kind === 'no-jar') continue;
    const m = (perFlavor[o.flavor] = perFlavor[o.flavor] || new Map());
    const sig = cookieSignature(o);
    m.set(sig, (m.get(sig) || []).concat(o.client));
  }
  const disagreement = Object.fromEntries(
    Object.entries(perFlavor).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([f, m]) => [f, { distinct_answers: m.size, answers: Object.fromEntries([...m.entries()].sort((a, b) => b[1].length - a[1].length)) }])
  );
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_COOKIES) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const jarCounts = {};
  for (const o of OBSERVATIONS_COOKIES) jarCounts[o.jar_kind] = (jarCounts[o.jar_kind] || 0) + 1;
  return {
    what:
      `What ${numWord(CLIENTS_COOKIES.length)} HTTP clients did with the ${numWord(WITNESS_COOKIES.flavors)} /cookies setter flavors, one row per observation. ` +
      'Each row is four requests with one fresh jar where the client has one (a client with no jar runs them too but records only the setter and the first echo; requests_made and hops count the setter fetch and its redirects only): the setter (redirects followed), /cookies/echo, ' +
      '/cookies/delete, and /cookies/echo again. The oracle is /cookies/echo — the Cookie header exactly as ' +
      'it reached the Worker — and what the row adds from the harness\'s side is the jar\'s own record where ' +
      'the client exposes one.',
    rows: rows.length,
    flavors: WITNESS_COOKIES.flavors,
    observed: WITNESS_COOKIES.probed,
    badhttp_version_observed: WITNESS_COOKIES.badhttp_version_observed,
    worker_version: WITNESS_COOKIES.worker_version,
    clients: CLIENTS_COOKIES,
    fields: [...COMMON_FIELDS, ...COOKIE_FIELDS],
    jar_legend: COOKIE_JARS,
    outcome_legend: COOKIE_OUTCOMES,
    reading_this: COOKIE_READING,
    outcome_counts: outcomeCounts,
    jar_counts: jarCounts,
    disagreement_by_flavor: disagreement,
    disagreement_note: 'distinct_answers is, per flavor, the number of distinct answers (what came back to /cookies/echo) among clients that have a jar; answers lists them. What survived /cookies/delete is not in the key — it is reported once, in the findings — and no-jar rows are excluded: returning nothing is what having no jar means.',
    findings: cookieFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_COOKIES.probed} against badhttp version ` +
      `${WITNESS_COOKIES.badhttp_version_observed}, with the client versions on each row. Client behaviour ` +
      'changes between releases and this table does not update itself. Re-run it from ' +
      `${WITNESS_COOKIES.capture_scripts} in the source and the numbers move; the date on every row is how ` +
      'you know whether to trust it.',
    reproduce:
      'Start the row\'s client with a fresh jar where it has one, GET the row\'s url following redirects, GET /cookies/echo ' +
      'and compare its cookies with the row\'s echo.cookies; then GET /cookies/delete and /cookies/echo ' +
      'again and compare with after_delete. Pace the calls against the zone limit of 100 per 10 s, and ' +
      'treat a response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------
// sse: real SSE client libraries plus a raw-wire control x 14 /sse flavors; the reference is a WHATWG parse of the
// control's bytes (session 27, 2026-10-05; docs/spec-sse-witness.md).

const SSE_CLASSES = {
  eventsource: 'Implements the WHATWG EventSource interface: auto-reconnects after the server closes (after retry ms, sending Last-Event-ID), stops on a 204, fails the connection on a Content-Type other than text/event-stream, and surfaces both a clean close and a transport failure as an error event — the interface cannot tell them apart. The expected end is therefore "reconnecting" after a clean server close, "reconnecting" or "error" after drop, "error" with no events on wrong-type, and "stopped" on resume.',
  'one-shot': 'Iterates ONE response as a stream of events and returns when it ends. No reconnection is part of the library, so on resume it delivers ids 1–3 over one connection and returns, which is its design; whether it checks Content-Type is a library choice the specification does not constrain.',
  raw: 'The control: curl receiving the bytes with no SSE parser at all. Its control.raw_sha256 is the hash of the bytes the parser derived the reference from.',
};

const SSE_OUTCOMES = {
  'as-spec': 'The events delivered are what the client\'s class is expected to deliver, and the row ended as expected for the class. Expected events are the reference WHATWG parse of the bytes the control received (after removing the server clock "t" from JSON data), except that the EventSource interface delivers nothing on wrong-type and, on resume, also the events 4-6 of the documented later connections, and a one-shot library on wrong-type may deliver either.',
  'events-differ': 'The row ended as expected but the delivered events differ from the reference: fewer, more, or altered values. diff names the first difference.',
  'end-differs': 'The events match but the ending does not (a reset reported as a clean end, a stream that never returned, no reconnection where the class reconnects). diff says which.',
  'both-differ': 'Both the events and the ending differ from the reference.',
  'harness-timeout': 'The harness\'s 30 s per-row cap fired; the row records whatever was delivered before it.',
  'request-failed': 'No observation: the first response never carried x-badhttp-version after three attempts, or the transport failed before any response.',
  control: 'The curl control row: bytes, not events. Its events are the reference parse of those bytes.',
};

const SSE_READING =
  'Read outcome as a description of what the library delivered to its caller relative to the reference WHATWG ' +
  'HTML §9.2.6 parse of the bytes the control received on the same date, and relative to the library\'s CLASS ' +
  '(client.class). A one-shot library ending "clean" with three events on resume is as-spec for its class: it has ' +
  'no reconnect and says so. An EventSource-interface library ending "reconnecting" after a clean close is as-spec ' +
  'for its class: the interface reconnects after every close and cannot distinguish a close from a failure. ' +
  '"differs" never means defective — on wrong-type, delivering the three events is a choice the specification ' +
  'leaves to a one-shot library; on error-event, routing a named "error" event to the error callback is what the ' +
  'EventSource interface does by design. diff on each row names the first difference, events carries what was ' +
  'delivered (data as delivered, with the server clock "t" left in; truncated past 200 bytes, where data_bytes is the ' +
  'length of the full data and data_sha256 its hash; for data of 200 bytes or less data_sha256 is null), connections counts every ' +
  'connection the library opened and what each carried, and end is how the row finished from the caller\'s side. ' +
  'No library here is scored or ranked, and none is handed a conformance verdict.';

const SSE_FIELDS = ['class', 'connections', 'events', 'events_delivered', 'events_note', 'preamble_events', 'errors', 'end', 'retry_ms_adopted', 'last_event_id_final', 'wall_ms', 'attempts', 'diff', 'reference', 'control', 'oracle'];

/** One row per observation: clients x 14 flavors, plus the control rows. */
function sseRows() {
  return OBSERVATIONS_SSE.map((o) => {
    const c = o.client;
    const ref = REFERENCE_SSE[o.flavor] || null;
    return {
      id: o.id,
      corpus_id: o.corpus_id,
      family: 'sse',
      flavor: o.flavor,
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role, class: c.class, library: c.library, connections_counted_by: c.connections_counted_by },
      observed: WITNESS_SSE.probed,
      badhttp_version_observed: WITNESS_SSE.badhttp_version_observed,
      status: o.connections && o.connections[0] ? o.connections[0].status : null,
      class: c.class,
      connections: o.connections,
      events: o.events,
      events_delivered: o.events_delivered ?? (o.events ? o.events.length : null),
      events_note: o.events_note ?? null,
      preamble_events: o.preamble_events,
      errors: o.errors,
      end: o.end,
      retry_ms_adopted: o.retry_ms_adopted,
      last_event_id_final: o.last_event_id_final,
      wall_ms: o.wall_ms,
      attempts: o.attempts,
      reported_error: (o.errors && o.errors[0] && o.errors[0].message) || null,
      outcome: o.outcome,
      diff: o.diff,
      reference: ref ? { events: ref.events.length, raw_sha256: ref.raw_sha256, raw_bytes: ref.raw_bytes, last_event_id_at_eof: ref.last_event_id_at_eof, discarded_pending_data: ref.discarded_pending_data, source: ref.source } : null,
      control: o.control ?? null,
      oracle: 'the reference WHATWG HTML §9.2.6 parse of the bytes the curl control received for this flavor on the same date (REFERENCE in the /clients sse family block carries the parsed events and the hash of the bytes); the server clock "t" inside JSON data is removed before comparison',
      license: LICENSE.responses.id,
    };
  });
}

// A library's answer on a flavor: the normalized events it delivered plus how it ended. Counted among clients of the
// SAME class, as auth counts within a mechanism kind: an EventSource-class "reconnecting" and a one-shot "clean"
// after the same five events are the same answer in two idioms, not a disagreement.
// The server clock "t" inside JSON data is removed before comparing (the same normalization the generator applies), and the
// retry-only preamble events are left out, as the outcome comparison leaves them out.
const sseNormData = (d) => {
  if (typeof d === 'string' && d.startsWith('{') && d.includes('"t"')) {
    try { const x = JSON.parse(d); if (x && typeof x === 'object' && 't' in x) { delete x.t; return JSON.stringify(x); } } catch { /* not JSON: verbatim */ }
  }
  return d;
};
export function sseSignature(o) {
  const evs = (o.events || []).filter((e) => !e.preamble);
  const ev = evs.map((e) => `${e.type}#${e.id ?? '-'}:${e.data_bytes > 200 ? `<${e.data_bytes}b ${(e.data_sha256 || '').slice(0, 8)}>` : JSON.stringify(sseNormData(e.data))}`).join(' ');
  return `${evs.length} events [${ev}] | ended ${o.end}`;
}

function sseFamily({ rows }) {
  const perFlavor = {};
  for (const o of OBSERVATIONS_SSE) {
    if (o.client.role !== 'client') continue;
    const m = (perFlavor[o.flavor] = perFlavor[o.flavor] || new Map());
    const sig = `${o.client.class}: ${sseSignature(o)}`;
    m.set(sig, (m.get(sig) || []).concat(o.client.id));
  }
  const disagreement = Object.fromEntries(
    Object.entries(perFlavor).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([f, m]) => {
        const byClass = {};
        for (const [sig, ids] of m) { const cls = sig.split(':')[0]; byClass[cls] = (byClass[cls] || 0) + 1; }
        return [f, { distinct_answers_within_class: byClass, answers: Object.fromEntries([...m.entries()].sort((a, b) => b[1].length - a[1].length)) }];
      })
  );
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_SSE) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const classCounts = {};
  for (const c of CLIENTS_SSE) classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  return {
    what:
      `What ${CLIENTS_SSE.filter((c) => c.role === 'client').length} real SSE client libraries did with the ${numWord(WITNESS_SSE.flavors)} /sse flavors, one row per observation, ` +
      'plus one raw-wire control row per flavor (curl). Each row is one fresh client pointed at GET /sse/{flavor} with default ' +
      'parameters: every event it delivered, every connection it opened and what that connection carried, every error it ' +
      'surfaced, and how it ended. The oracle is the reference WHATWG parse of the bytes the control received.',
    rows: rows.length,
    flavors: WITNESS_SSE.flavors,
    observed: WITNESS_SSE.probed,
    badhttp_version_observed: WITNESS_SSE.badhttp_version_observed,
    worker_version: WITNESS_SSE.worker_version,
    clients: CLIENTS_SSE,
    fields: [...COMMON_FIELDS, ...SSE_FIELDS],
    class_legend: SSE_CLASSES,
    outcome_legend: SSE_OUTCOMES,
    reading_this: SSE_READING,
    outcome_counts: outcomeCounts,
    class_counts: classCounts,
    reference: REFERENCE_SSE,
    disagreement_by_flavor: disagreement,
    disagreement_note: 'distinct_answers_within_class is, per flavor and per client class, the number of distinct answers (the events delivered, with the server clock "t" removed and the retry-only opening events left out, plus how the row ended) among client rows; answers lists them, prefixed by class. Control rows are excluded. The two classes are never compared with each other: an EventSource-interface library ending "reconnecting" and a one-shot library ending "clean" after the same events is the same result in two idioms.',
    findings: sseFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_SSE.probed} against badhttp version ` +
      `${WITNESS_SSE.badhttp_version_observed}, with the library versions on each row. Library behaviour changes between ` +
      `releases and this table does not update itself. Re-run it from ${WITNESS_SSE.capture_scripts} in the source and ` +
      'the numbers move; the date on every row is how you know whether to trust it.',
    reproduce:
      'Point the row\'s library at the row\'s url with a fresh instance and collect every event it delivers (type, id, ' +
      'data) and how it signals the end; compare with the row\'s events and end. For the reference, capture the bytes ' +
      'with curl -sS -N --http1.1 and parse them by WHATWG HTML §9.2.6 (scripts/witness-parse-sse.mjs carries ' +
      'the parser). Pace the calls against the zone limit of 100 per 10 s, and treat a first response without ' +
      'x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------
// range: real resuming download clients plus a raw-wire control x 14 /range flavors (one resume of a 400-byte partial
// each, plus a fresh download at always-206); the reference is where RFC 9110 places the bytes the control received
// (session 31, 2026-10-12; docs/spec-range-witness.md).

const RANGE_CLASSES = {
  resumer: 'A real download client or library told to resume a partial file from the row\'s url. The harness never sends a Range header itself: the client decides, from the size of the partial, what to ask for and what to do with the answer. Every request it sent went through a local recording proxy, so exchanges lists them all.',
  raw: 'The control: curl sending exactly Range: bytes=400-, with no resume logic and no file handling at all. Its control.raw_sha256 is the hash of the bytes the reference placement was derived from; on the document row it fetched the whole document with no Range, which is the true document every file is compared with.',
};

const RANGE_OUTCOMES = {
  complete: 'The file on disk is the whole 1,000-byte document, byte for byte. transfer says how, judged by the deciding exchange (the last request other than HEAD): resumed (it carried a Range and returned fewer bytes than the document, so the partial was kept), restarted (it returned the whole document, so the partial was thrown away), restarted-after-range (an earlier non-HEAD request asked for a range and got fewer bytes than the document, then a full fetch followed), or fresh (the download from nothing). When the deciding exchange has no Range and is short, the bytes summed across the exchanges decide.',
  refused: 'The file is the untouched partial (for the fresh cell, absent or empty) and the client reported an error: it stopped with an error and nothing was written.',
  unchanged: 'The file is the untouched partial, byte for byte, and the client reported no error: it exited without complaint and wrote nothing.',
  corrupt: 'The file differs from the document and is not the untouched partial. shape says how, computed from the self-describing lines.',
  'incomplete-reported': 'The file is a prefix of the document shorter than 1,000 bytes and the client reported an error: it stopped and said so.',
  'harness-timeout': 'The harness\'s 30 s per-row cap fired; the row describes the file as it stood and the exchanges made so far.',
  'request-failed': 'No observation: the rate limit never cleared, or the recorder saw no response carrying x-badhttp-version. Such a row has no exchanges.',
  control: 'A curl control row: bytes, not a file. It is the source of the reference placement (resume-raw, fresh-raw) or of the true document (document).',
};

const RANGE_SHAPES = {
  'duplicated-prefix': 'The document\'s head appears again after byte 400: the partial was kept and the whole document was appended to it.',
  shifted: 'Lines whose embedded offset is one away from the position they sit at: bytes a+1..b+1 were written where a..b belong.',
  short: 'A prefix of the document shorter than 1,000 bytes with the client reporting success; missing_bytes says how many bytes are absent.',
  'mixed-generation': 'Lines from more than one generation (the if-range-ignored flavor stamps a generation into every line).',
  'suffix-misplaced': 'The duplicated-prefix pattern on the suffix-as-prefix flavor, where the head of the document is served under a Content-Range that names its tail.',
  'body-only': 'The file is the deciding response\'s body alone: the partial was discarded and the file holds only what the server sent in the response.',
  other: 'A file that differs from the document in a way none of the other shapes names; first_bad_offset on the row says where, and diff says what.',
};

const RANGE_TRANSFERS = {
  resumed: 'Kept the partial: the deciding exchange (the last request other than HEAD) carried a Range and returned fewer bytes than the document. A leading HEAD, or a GET with no Range that comes first, is a probe and is not counted. When the deciding exchange has no Range and is short, the bytes summed across the exchanges decide.',
  restarted: 'Threw the partial away and wrote the whole representation from a single response.',
  'restarted-after-range': 'Asked for a range first, then fetched the whole document.',
  fresh: 'The fresh cell: no partial existed, the client downloaded from nothing.',
};

const RANGE_REFERENCE_LEGEND = {
  'as-reference': 'The file is what applying the reference placement (where RFC 9110 puts the bytes the control received) to the true partial yields. On a flavor whose reference placement does not yield the document, this includes a corrupt file.',
  differs: 'The file is not what the reference placement yields; diff names the first difference.',
  undefined: 'No reference placement exists: the control\'s response says nothing about where its bytes belong (a 206 without Content-Range, a 416 at an offset inside the document).',
};

const RANGE_NO_YIELD = Object.entries(REFERENCE_RANGE).filter(([, r]) => r.yields_document === false).map(([f]) => f).join(', ') || 'no flavor in this capture';
const RANGE_READING =
  'Read outcome as a description of the file on disk and the client\'s exit after one resume, never as a verdict on the ' +
  'client. RFC 9110 defines what a 206 means (its Content-Range says where its body belongs in the representation), what a ' +
  '200 carries (the whole representation) and what a 416 says (the complete length); it defines no algorithm for a client ' +
  'that resumes. A client that starts over on a 200 and one that stops with an error are both doing something the ' +
  'specification allows, so refused and complete are different answers, not a better and a worse one. Each row is also ' +
  'described relative to its reference placement: where RFC 9110 puts the bytes the curl control received for Range: ' +
  'bytes=400-, applied to the true 400-byte partial. Where that placement itself does not yield the document (' + RANGE_NO_YIELD + ') the lie is invisible to anyone not reading the body, and the ' +
  'document is self-describing — 64-byte lines that each carry their own offset — so the file convicts itself: shape and ' +
  'first_bad_offset come from those lines. outcome_vs_reference says whether the file matches the placement; it is null on a harness-timeout row, whose file is a mid-transfer snapshot that was never compared. The ' +
  'exchanges array is every request the client sent and every response it got, recorded between the client and this ' +
  'service; the clients spoke HTTP/1.1 to a local proxy, so TLS and HTTP/2 behaviour is out of scope. No client here is ' +
  'scored or ranked.';

const RANGE_FIELDS = ['class', 'scenario', 'partial_bytes', 'partial_sha256', 'exchanges', 'exit', 'file', 'end', 'wall_ms', 'attempts', 'shape', 'transfer', 'missing_bytes', 'outcome_vs_reference', 'diff', 'reference', 'control', 'oracle'];

/** One row per observation: clients x 15 cells (14 flavors resumed, plus always-206 fresh), plus the control rows. */
function rangeRows() {
  return OBSERVATIONS_RANGE.map((o) => {
    const c = o.client;
    return {
      id: o.id,
      corpus_id: `range.${o.flavor}`,
      family: 'range',
      flavor: o.flavor,
      scenario: o.scenario,
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role, class: c.class, library: c.library, requests_recorded_by: c.requests_recorded_by },
      observed: WITNESS_RANGE.probed,
      badhttp_version_observed: WITNESS_RANGE.badhttp_version_observed,
      status: o.exchanges && o.exchanges[0] ? o.exchanges[0].status : null,
      class: c.class,
      partial_bytes: o.partial_bytes,
      partial_sha256: o.partial_sha256,
      exchanges: o.exchanges,
      exit: o.exit,
      reported_error: o.reported_error ?? null,
      file: o.file,
      end: o.end,
      wall_ms: o.wall_ms,
      attempts: o.attempts,
      outcome: o.outcome,
      shape: o.shape ?? null,
      transfer: o.transfer ?? null,
      missing_bytes: o.missing_bytes ?? null,
      outcome_vs_reference: o.outcome_vs_reference ?? null,
      diff: o.diff ?? null,
      reference: o.reference ?? null,
      control: o.control ?? null,
      oracle: 'the reference placement: where RFC 9110 puts the bytes the curl control received for this flavor on the same date, applied to the first 400 bytes of the true document the control fetched whole (REFERENCE in the /clients range family block carries the status, Content-Range, size and hash of what the control received); the file is also checked line by line against the document\'s own offsets',
      license: LICENSE.responses.id,
    };
  });
}

function rangeFamily({ rows }) {
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_RANGE) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const classCounts = {};
  for (const c of CLIENTS_RANGE) classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  const shapeCounts = {};
  for (const o of OBSERVATIONS_RANGE) if (o.shape) shapeCounts[o.shape] = (shapeCounts[o.shape] || 0) + 1;
  const transferCounts = {};
  for (const o of OBSERVATIONS_RANGE) if (o.transfer) transferCounts[o.transfer] = (transferCounts[o.transfer] || 0) + 1;
  return {
    what:
      `What ${CLIENTS_RANGE.filter((c) => c.role === 'client').length} real resuming download clients did with the ${numWord(WITNESS_RANGE.flavors)} /range flavors, one row per observation, ` +
      `plus one raw-wire control row per flavor (curl). Each cell holds the first ${WITNESS_RANGE.partial_bytes} bytes of the ${WITNESS_RANGE.document_bytes}-byte ` +
      'document in a fresh working directory and tells the client to resume it from GET /range/{flavor}; one extra cell per client downloads from nothing at always-206. ' +
      'Each row lists every request the client sent, what was left on disk and how the client exited. The oracle is the reference placement ' +
      'of the bytes the control received, checked against the true document.',
    rows: rows.length,
    flavors: WITNESS_RANGE.flavors,
    cells_per_client: WITNESS_RANGE.cells_per_client,
    observed: WITNESS_RANGE.probed,
    badhttp_version_observed: WITNESS_RANGE.badhttp_version_observed,
    worker_version: WITNESS_RANGE.worker_version,
    clients: CLIENTS_RANGE,
    fields: [...COMMON_FIELDS, ...RANGE_FIELDS],
    class_legend: RANGE_CLASSES,
    outcome_legend: RANGE_OUTCOMES,
    shape_legend: RANGE_SHAPES,
    transfer_legend: RANGE_TRANSFERS,
    reference_legend: RANGE_REFERENCE_LEGEND,
    reading_this: RANGE_READING,
    outcome_counts: outcomeCounts,
    shape_counts: shapeCounts,
    transfer_counts: transferCounts,
    class_counts: classCounts,
    reference: REFERENCE_RANGE,
    disagreement_by_flavor: WITNESS_RANGE.disagreement_by_flavor,
    answers_by_flavor: WITNESS_RANGE.answers_by_flavor,
    disagreement_note: 'disagreement_by_flavor is, per flavor, the number of distinct answers — (outcome, shape, transfer) — among resumer rows; answers_by_flavor lists them with the clients that gave each. The always-206/fresh key is the fresh cell. Control rows are excluded.',
    findings: rangeFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_RANGE.probed} against badhttp version ` +
      `${WITNESS_RANGE.badhttp_version_observed}, with the client versions on each row. Client behaviour changes between ` +
      `releases and this table does not update itself. Re-run it from ${WITNESS_RANGE.capture_scripts} in the source and ` +
      'the numbers move; the date on every row is how you know whether to trust it.',
    reproduce:
      'Write the first 400 bytes of GET /range/ok?length=1000 to a fresh file, point the row\'s client at the row\'s url with the ' +
      'instruction to resume that file through a recording proxy, and compare the file and the exit with the row. For the ' +
      'reference, fetch the same url with curl -sS --http1.1 -H \'Range: bytes=400-\' and place the response as RFC 9110 §15.3.7 says ' +
      '(scripts/witness-parse-range.mjs carries the placement rules). Pace the calls against the zone limit of 100 per 10 s, and ' +
      'treat a response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------
// etag: real HTTP caches and conditional-request clients plus a raw-wire control x 10 /etag flavors (each fetching the flavor
// three times through a fresh cache); the reference is what RFC 9111 implies a textbook cache would have sent and shown its
// caller given what the control's textbook revalidation got (session 32, 2026-10-12; docs/spec-etag-witness.md).

const ETAG_CLASSES = {
  'library-cache': 'A caching layer under an HTTP client library: it stores a response and decides, from what it stored, whether to revalidate and what to send. The harness never sends a conditional header itself, so every If-None-Match and If-Modified-Since in the row is one the library chose.',
  'cli-conditional': 'A command-line tool that keeps one saved validator between runs (curl --etag-save/--etag-compare, curl -z, wget -N). Not a cache in the RFC 9111 sense: it has no store of responses, only a validator and a file, so the three fetches are three runs in one working directory. The row names the exact flags in configuration.',
  'proxy-cache': 'A caching proxy configured with the recorder as its upstream and driven by curl as its user, with only the directives that enable its cache at all (named in configuration). The exchanges are what the proxy sent upstream; the caller is curl talking to the proxy.',
  raw: 'The control: curl sending exactly what the row says and nothing else (cold-raw: no conditional header; revalidate-raw: If-None-Match with the ETag cold-raw received and If-Modified-Since with the Last-Modified it received, verbatim, as RFC 9111 §4.3.1 says to validate; revalidate-adopted-raw on mismatch: the tag the 304 carried). Its body hash is the document every caller body is compared with.',
};

const ETAG_OUTCOMES = {
  'document/stored-after-304': 'The warm fetch put a request upstream, was answered 304, and the caller still received the flavor\'s document (the bytes of the cold control\'s body): the cache filled the body in from its store with status 200, or a command-line tool reported 304 and left its stored file.',
  'document/fresh-200': 'The warm fetch put a request upstream, was answered 200, and the caller received the document from that response: the cache refetched, whether or not the request was conditional (wire.conditional says which).',
  'document/no-request': 'The warm fetch put no request upstream and the caller received the document from the store, without revalidation.',
  'document/stored-despite-200': 'The warm fetch put a request upstream and was answered 200 with a body, yet the tool reported 304 and kept its stored copy of the document (description.caller_status is 304).',
  'empty-304': 'The caller received a 304 (the status, or an empty body with a 304 reported) rather than a body.',
  'other-body': 'The caller received a 200 whose body is not the flavor\'s document; its bytes and sha256 are on the fetch.',
  'other-status': 'The caller saw a status other than 200 and 304 on the warm fetch (for example a proxy\'s 503); its bytes and sha256 are on the fetch.',
  error: 'The library raised or the tool exited non-zero on the warm fetch; error.name is on the fetch.',
  'harness-timeout': 'A harness cap fired (20 s for a fetch, 60 s for a cell); the row keeps the fetches that completed and marks the rest not-run.',
  'request-failed': 'No observation: the rate limit never cleared, or the recorder saw an exchange without x-badhttp-version. Such a row has no exchanges and no fetch results.',
  control: 'A curl control row: one exchange, no cache. It is the source of the reference (cold-raw, revalidate-raw, revalidate-adopted-raw) and of the true document.',
};

// What each fetch's description (set by the parser from the exchanges and the caller's result) can be, and the qualifier for a document.
const ETAG_DESCRIPTIONS = {
  document: 'The caller received the flavor\'s document and no error, with status 200, or with 304 reported by a tool that left its stored file. via says how: fresh-200, stored-after-304, stored-despite-200 or no-request.',
  'empty-304': 'The caller received a 304 with no body: status 304 with 0 bytes, or 0 bytes with the last answer 304.',
  'other-body': 'The caller received a 200 whose body is not the document.',
  'other-status': 'The caller saw a status other than 200 and 304 (status, bytes and sha256 are on the description).',
  error: 'The library raised or the tool exited non-zero.',
  'not-run': 'A cap fired before this fetch.',
};
const ETAG_VIA = {
  'fresh-200': 'The fetch\'s last request was answered 200.',
  'stored-after-304': 'The fetch\'s last request was answered 304 and the caller still got the document: the cache filled it in from its store, or a command-line tool reported 304 and left its stored file (description.caller_status is 304 then).',
  'stored-despite-200': 'The fetch\'s last request was answered 200 with a body, yet the tool reported 304 and kept its stored copy (description.caller_status is 304).',
  'no-request': 'No request went upstream: the document was served from the store without revalidating.',
};

// wire.conditional: the first request of a fetch.
const ETAG_CONDITIONAL = {
  none: 'The first request carried neither If-None-Match nor If-Modified-Since: an unconditional request.',
  etag: 'The first request carried If-None-Match only.',
  date: 'The first request carried If-Modified-Since only.',
  both: 'The first request carried both If-None-Match and If-Modified-Since.',
  'if-match': 'The first request carried an If-Match (recorded, not expected from a cache).',
};

// wire.etag_echo and wire.date_echo: how the validator the client sent relates to the most recent one it received in a 200.
const ETAG_ECHO = {
  etag_echo: {
    verbatim: 'The If-None-Match value is the ETag the client last received in a 200, byte for byte.',
    'weak-stripped': 'The client received W/"x" and sent "x".',
    'weak-added': 'The client received "x" and sent W/"x".',
    'quotes-added': 'The client received a bare x and sent "x".',
    'quotes-removed': 'The client received "x" and sent a bare x.',
    list: 'The client sent a list that contains the received tag.',
    other: 'The client sent a tag that no 200 it received carried: the tag from a 304 (on mismatch), a tag taken from an unconditional 304, or a tag with no 200 having carried one (an empty tag, say). etag_sent and etag_received are on the wire; etag_received is null when no 200 carried a tag.',
  },
  date_echo: {
    verbatim: 'The If-Modified-Since value is the Last-Modified the client last received in a 200, byte for byte.',
    reformatted: 'A valid HTTP-date for the same instant, different bytes.',
    'own-clock': 'A valid HTTP-date for a different instant, such as the response\'s Date or the current time.',
    'invalid-echoed': 'A value that is not an HTTP-date, sent back as received (bad-date\'s ISO string).',
    other: 'Another value, including a date sent when no 200 carried a Last-Modified (date_received is null then).',
  },
};

// wire fields beyond the echoes: what the client held from its most recent 200 when the fetch began, and what of it the first request left out.
const ETAG_WIRE = {
  etag_held: 'The ETag of the most recent 200 when the fetch began (null if none).',
  date_held: 'The Last-Modified of the most recent 200 when the fetch began (null if none).',
  etag_dropped: 'True when an ETag was held and the fetch\'s first request did not send it (present when requests is at least 1). A null etag_echo with etag_dropped false means nothing was held or nothing was sent.',
  date_dropped: 'True when a Last-Modified was held and the fetch\'s first request did not send it (present when requests is at least 1).',
};

const ETAG_REFERENCE_LEGEND = {
  'as-reference': 'The warm fetch matches the reference: what RFC 9111 implies a textbook cache would show its caller on the warm fetch, given what the control\'s textbook revalidation got.',
  differs: 'The warm fetch does not match the reference. This is a description: RFC 9111 §5.2.2.4 forbids reusing a no-cache response without validation and does not forbid an unconditional refetch, so a cache that refetches and one that revalidates are both allowed to.',
  undefined: 'No reference exists: RFC 9110 §15.4.5 defines a 304 only in response to a conditional request, so the cold 304 of always-304 selects no stored response and RFC 9111 §4.3.4 says nothing about what a cache should show; the rows describe what each cache did.',
};

const ETAG_READING =
  'Read outcome as a description of what the caller received on the warm fetch and what went upstream, never as a verdict on the ' +
  'client. RFC 9111 §4.3 says what a cache sends to validate a stored response and what a 304 and a 200 mean to it, and ' +
  '§5.2.2.4 says a no-cache response must not be reused without a successful validation; it does not forbid an unconditional ' +
  'refetch, so a cache that revalidates and one that refetches are both doing something the specification allows. Each row is ' +
  'described relative to a reference derived from the control\'s own exchanges: what a textbook cache would have sent and shown ' +
  'its caller given what this server answered curl\'s textbook revalidation. "differs" is a description of a difference from that ' +
  'reference, not a defect; where the specification defines nothing (a 304 to a request that carried no conditional, an unparseable ' +
  'Last-Modified, a bare ETag) the reference says so. The harness never sends a conditional header for a client, so every ' +
  'validator in a row is one the client chose from what it stored. Not every class is a cache in the RFC 9111 sense: a library cache ' +
  'stores responses, a command-line conditional client keeps one saved validator, and a caching proxy is driven by curl as its user; ' +
  'each row names its class. The recorder sits between the client and this service and speaks plain HTTP/1.1 to the ' +
  'client, so TLS and HTTP/2 behaviour is out of scope; for a proxy the exchanges are what it sent upstream. No client here is scored or ranked.';

const ETAG_FIELDS = ['class', 'scenario', 'fetches', 'exchanges_after_result', 'late_exchanges', 'end', 'wall_ms', 'attempts', 'pattern', 'adopted_304_validator', 'outcome_vs_reference', 'reference', 'control', 'oracle', 'configuration'];

/** One row per observation: clients x 10 cells (one flavor each, three fetches through a fresh cache), plus the control rows. */
function etagRows() {
  return OBSERVATIONS_ETAG.map((o) => {
    const c = o.client;
    const first = o.exchanges && o.exchanges[0] ? o.exchanges[0] : o.fetches && o.fetches[0] && o.fetches[0].exchanges ? o.fetches[0].exchanges[0] : null;
    return {
      id: o.id,
      corpus_id: `etag.${o.flavor}`,
      family: 'etag',
      flavor: o.flavor,
      scenario: o.scenario,
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role, class: c.class, library: c.library, runtime: c.runtime, configuration: c.configuration, requests_recorded_by: c.requests_recorded_by },
      observed: WITNESS_ETAG.probed,
      badhttp_version_observed: WITNESS_ETAG.badhttp_version_observed,
      status: first ? first.status : null,
      class: c.class,
      fetches: o.fetches ?? null,
      exchanges: o.exchanges ?? null,
      exchanges_after_result: o.exchanges_after_result ?? null,
      late_exchanges: o.late_exchanges ?? null,
      reported_error: o.reported_error ?? ((o.fetches && o.fetches[1] && o.fetches[1].description && o.fetches[1].description.kind === 'error') ? (o.fetches[1].description.error_name ?? null) : null),
      end: o.end,
      wall_ms: o.wall_ms,
      attempts: o.attempts,
      outcome: o.outcome,
      pattern: o.pattern ?? null,
      adopted_304_validator: o.adopted_304_validator ?? null,
      outcome_vs_reference: o.outcome_vs_reference ?? null,
      reference: o.reference ?? null,
      control: o.control ?? null,
      configuration: c.configuration ?? null,
      oracle: 'the reference: what RFC 9111 implies a textbook cache would have sent and shown its caller on the warm fetch, given what the curl control\'s textbook revalidation (If-None-Match with the ETag it received, If-Modified-Since with the Last-Modified it received) got on the same date (REFERENCE in the /clients etag family block carries it per flavor); the document is the body of the cold control, whose hash is control.raw_sha256',
      license: LICENSE.responses.id,
    };
  });
}

function etagFamily({ rows }) {
  const clientRowsOnly = OBSERVATIONS_ETAG.filter((o) => o.client.role === 'client');
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_ETAG) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const classCounts = {};
  for (const c of CLIENTS_ETAG) classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  const conditionalCounts = {};
  const etagEchoCounts = {};
  const dateEchoCounts = {};
  for (const o of clientRowsOnly) {
    (o.fetches || []).forEach((f, i) => {
      const w = f && f.wire;
      if (!w) return;
      if (i === 1) { const k = w.requests === 0 ? 'no-request' : w.conditional; if (k) conditionalCounts[k] = (conditionalCounts[k] || 0) + 1; }
      if (i >= 1 && w.etag_echo) etagEchoCounts[w.etag_echo] = (etagEchoCounts[w.etag_echo] || 0) + 1;
      if (i >= 1 && w.date_echo) dateEchoCounts[w.date_echo] = (dateEchoCounts[w.date_echo] || 0) + 1;
    });
  }
  return {
    what:
      `What ${CLIENTS_ETAG.filter((c) => c.role === 'client').length} real HTTP caches and conditional-request clients did with the ${numWord(WITNESS_ETAG.flavors)} /etag flavors, one row per observation, ` +
      'plus the control rows (curl: a cold request, a textbook revalidation, and on mismatch the revalidation with the tag the 304 carried). Each cell asks the client to fetch GET /etag/{flavor} ' +
      'three times in a row through a fresh cache; the harness never sends a conditional header for a client. Each row lists every request the client sent, attributed to the fetch that ' +
      'caused it, and what the caller received. The oracle is the reference: what RFC 9111 implies a textbook cache would have sent and shown its caller, given what the control\'s revalidation got.',
    rows: rows.length,
    flavors: WITNESS_ETAG.flavors,
    cells_per_client: WITNESS_ETAG.cells_per_client,
    observed: WITNESS_ETAG.probed,
    badhttp_version_observed: WITNESS_ETAG.badhttp_version_observed,
    worker_version: WITNESS_ETAG.worker_version,
    clients: CLIENTS_ETAG,
    fields: [...COMMON_FIELDS, ...ETAG_FIELDS],
    class_legend: ETAG_CLASSES,
    outcome_legend: ETAG_OUTCOMES,
    description_legend: ETAG_DESCRIPTIONS,
    via_legend: ETAG_VIA,
    conditional_legend: ETAG_CONDITIONAL,
    echo_legend: ETAG_ECHO,
    wire_legend: ETAG_WIRE,
    reference_legend: ETAG_REFERENCE_LEGEND,
    reading_this: ETAG_READING,
    outcome_counts: outcomeCounts,
    class_counts: classCounts,
    conditional_counts: conditionalCounts,
    etag_echo_counts: etagEchoCounts,
    date_echo_counts: dateEchoCounts,
    reference: REFERENCE_ETAG,
    disagreement_by_flavor: WITNESS_ETAG.disagreement_by_flavor,
    answers_by_flavor: WITNESS_ETAG.answers_by_flavor,
    disagreement_note: 'disagreement_by_flavor is, per flavor, the number of distinct answers — (outcome, conditional, etag_echo, date_echo) of the warm fetch — among client rows; answers_by_flavor lists them with the clients that gave each. conditional_counts is the first request of the warm fetch over all client rows (no-request when none went upstream); etag_echo_counts and date_echo_counts count the warm and warm-again fetches. Control rows are excluded.',
    findings: etagFindings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_ETAG.probed} against badhttp version ` +
      `${WITNESS_ETAG.badhttp_version_observed}, with the client versions on each row. Cache behaviour changes between ` +
      `releases and this table does not update itself. Re-run it from ${WITNESS_ETAG.capture_scripts || 'scripts/etag-witness/'} in the source and ` +
      'the numbers move; the date on every row is how you know whether to trust it.',
    reproduce:
      'Start a fresh cache and a fresh working directory, ask the row\'s client to fetch the row\'s url three times in a row through its cache with no conditional ' +
      'header of your own, and compare each fetch\'s requests and what the caller received with the row. For the reference, fetch the same url with curl -sS --http1.1 and ' +
      'again with If-None-Match set to the ETag and If-Modified-Since to the Last-Modified it returned (scripts/witness-parse-etag.mjs carries the reference rules). ' +
      'Pace the calls against the zone limit of 100 per 10 s, and treat a response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------
// x402: real x402 client libraries and wrappers plus a raw-wire control x 18 /402 cells (the eight scenarios and the ten malformed
// flavors, each one paid fetch with a throwaway Base Sepolia payer); the reference is derived from the control's offer, never typed
// (session 36, 2026-10-29; docs/spec-x402-witness.md).

const X402_CLASSES = {
  'sdk-fetch': 'An x402 payment wrapper around a fetch-style HTTP call (the foundation SDK and the packages built like it). The harness never sends a payment header itself: the wrapper decides, from the 402 it received, whether to sign, for how much, on which network, whether to retry, and what to hand its caller.',
  'sdk-http': 'An x402 payment layer in an HTTP client library of another shape (an axios interceptor, a Python httpx or requests transport, a Go or Rust client): the same obligations as sdk-fetch, a different calling convention. The row names the library and runtime.',
  'agent-wrapper': 'A wrapper that adds behaviour of its own (a spending limit, a retry policy, a receipt check) on top of one of the above. It is a roster entry only if it adds behaviour rather than re-exporting; the row names what it wraps.',
  cli: 'A command-line x402 client driven as a process. The caller is the process: status and body are what it printed, and exit is on the row.',
  raw: 'The control: curl sending a bare GET with no payment header, through the same recording proxy. Its exchange is the offer every client in that cell was shown, and control.offer carries a decoded summary of it, from which the reference is derived.',
};

const X402_OUTCOMES = {
  'delivered/decodable': 'The caller received a 200 and its body, and the response carried a PAYMENT-RESPONSE or X-PAYMENT-RESPONSE header that decoded (wire.receipt is decodable; success is on the exchange).',
  'delivered/undecodable': 'The caller received a 200 and its body, and a receipt header was present but did not decode.',
  'delivered/absent': 'The caller received a 200 and its body, and no receipt header was present.',
  'handed-back/402': 'The caller received a response object with status 402 and the library did not raise: the client stopped (or was stopped) with the 402 in hand.',
  'handed-back/500': 'The caller received a response object with status 500 and the library did not raise.',
  'handed-back/504': 'The caller received a response object with status 504 and the library did not raise.',
  'handed-back/503': `The caller received the recording proxy's own 503 (x-badhttp-recorder: budget-exhausted): the client had used its request budget (${WITNESS_X402.request_budget} upstream requests) and kept going, and the harness cut it off. budget_exhausted is true on the row.`,
  'raised/before-signing': 'The library raised and no payment header ever went out (wire.signed is false); error.name is on the fetch.',
  'raised/after-signing': 'The library raised after at least one payment header went out (wire.signed is true); error.name is on the fetch.',
  'harness-timeout': 'A harness cap fired (45 s for the fetch, 60 s for the cell); the row keeps what the recorder saw and marks the fetch timed_out.',
  'request-failed': 'No observation: the rate limit never cleared in three attempts, or the recorder saw an exchange without x-badhttp-version. Such a row has no exchanges.',
  control: 'A curl control row: one exchange, no payment header. It is the source of the reference (control.offer) and of nothing else.',
};

const X402_DESCRIPTIONS = {
  delivered: 'The caller received a 200 and its body with no error. Qualified by the receipt: decodable, undecodable or absent.',
  'handed-back': 'The caller received a response with a status other than 200 and the library did not raise; the status is on the description.',
  raised: 'The library raised. Qualified by whether a payment header went out: before-signing or after-signing.',
  'harness-timeout': 'A cap fired; what the recorder saw is kept.',
  'request-failed': 'No exchange reached the server in three attempts.',
};

const X402_WIRE = {
  requests: 'How many requests went upstream (the recorder\'s own budget 503s are not upstream requests; they are counted in budget_refusals).',
  payment_requests: 'How many carried PAYMENT-SIGNATURE or X-PAYMENT.',
  resigned: 'payment_requests - 1 when at least one payment went out, else null: how many times the client signed AGAIN after its first payment was not accepted.',
  payment_header: 'PAYMENT-SIGNATURE (x402 v2), X-PAYMENT (x402 v1), both (the same request carried both) or none.',
  generation: '2 or 1, from the first payment header (the v2 header wins when both, as the server reads it); null when nothing was signed.',
  signed: 'True when at least one payment header went out.',
  signed_value_atomic: 'The value in the first authorization, in atomic units of USDC (6 decimals).',
  signed_network: 'The network named by the first payment header.',
  signed_to: 'The payTo address in the first authorization.',
  offer_amount_atomic: 'The amount the control\'s offer asked for.',
  offer_network: 'The network the control\'s offer named.',
  value_matches_offer: 'Whether signed_value_atomic equals offer_amount_atomic (null when either is null).',
  to_matches_offer: 'Whether signed_to equals the offer\'s payTo (null when either is null).',
  first_status: 'The status of the first upstream exchange.',
  last_status: 'The status of the last upstream exchange.',
  statuses: 'The statuses in order, for example "402,200".',
  server_warning: 'The last x-badhttp-warning the server sent, verbatim, else null.',
  receipt: 'decodable (a PAYMENT-RESPONSE or X-PAYMENT-RESPONSE decoded), undecodable (present, did not decode) or absent.',
};

const X402_REFERENCE_LEGEND = {
  'as-reference': 'The row matches the reference: signing was no-payment-possible and the client signed nothing, or signing was payment-expected and it signed (and on pay the outcome is delivered/decodable).',
  differs: 'The row does not match the reference: the client signed for an offer nothing could satisfy, or did not sign for the one offer that admits a payment, or pay did not deliver a decodable receipt. This is a description of a difference from what the offer admits, not a defect: the x402 specification says nothing about retries, spending limits or what to do after a payment.',
  unspecified: 'The specification constrains nothing about whether to sign (an amount larger than any limit, a missing EIP-712 domain, a missing resource, a decimal amount); the rows describe what each client did.',
};

const X402_READING =
  'Read outcome as a description of what the caller received and whether the client signed, never as a verdict on the client. The x402 v2 ' +
  'specification says the client reads PAYMENT-REQUIRED, selects a requirement it can satisfy, retries with PAYMENT-SIGNATURE and reads ' +
  'PAYMENT-RESPONSE; it says nothing about spending limits, about signing again after a second 402, or about a 500 after a payment. A client ' +
  'that signs for 1,000,000 USDC with its defaults and one that stops are both doing something the specification allows, and the finding ' +
  'is the difference. Each row is described against a reference derived from the control\'s own exchange: what the offer the server made ' +
  'admits (an offer with nothing a Base Sepolia payer can satisfy admits no payment; /402/pay admits one and delivers a receipt). ' +
  '"differs" is a description of a difference from that reference. The harness never sends a payment header for a client, so every ' +
  'authorization in a row is one the client chose to send, with a throwaway key holding test USDC on Base Sepolia only; the library\'s ' +
  'defaults are the configuration. The recorder sits between the client and this service and speaks plain HTTP/1.1 to the client, so TLS ' +
  'and HTTP/2 behaviour is out of scope, and it cuts a client off after ' + numWord(WITNESS_X402.request_budget) + ' upstream requests so that a client that signs again ' +
  'forever is bounded by the harness. No client here is scored or ranked.';

const X402_FIELDS = ['class', 'scenario', 'kind', 'fetches', 'exchanges', 'exchanges_after_result', 'budget_exhausted', 'end', 'wall_ms', 'attempts', 'wire', 'description', 'pattern', 'outcome_vs_reference', 'reference', 'control', 'oracle', 'configuration'];

/** One row per observation: clients x 18 cells (one paid fetch each), plus the control rows. */
function x402Rows() {
  return OBSERVATIONS_X402.map((o) => {
    const c = o.client;
    const first = o.exchanges && o.exchanges[0] ? o.exchanges[0] : o.fetches && o.fetches[0] && o.fetches[0].exchanges ? o.fetches[0].exchanges[0] : null;
    const caller = o.fetches && o.fetches[0] ? o.fetches[0].caller : null;
    return {
      id: o.id,
      corpus_id: o.corpus_id,
      family: 'x402',
      flavor: o.flavor,
      scenario: o.scenario,
      kind: o.kind ?? 'one-paid-fetch',
      url: o.url,
      client: { id: c.id, name: c.name, version: c.version, platform: c.platform, invocation: c.invocation, role: c.role, class: c.class, library: c.library, runtime: c.runtime, generation: c.generation ?? null, configuration: c.configuration, requests_recorded_by: c.requests_recorded_by },
      observed: WITNESS_X402.probed,
      badhttp_version_observed: WITNESS_X402.badhttp_version_observed,
      status: first ? first.status : null,
      class: c.class,
      fetches: o.fetches ?? null,
      exchanges: o.exchanges ?? null,
      exchanges_after_result: o.exchanges_after_result ?? null,
      budget_exhausted: o.budget_exhausted ?? null,
      reported_error: caller && caller.error ? (caller.error.name ?? null) : (o.reported_error ?? null),
      end: o.end,
      wall_ms: o.wall_ms,
      attempts: o.attempts,
      outcome: o.outcome,
      wire: o.wire ?? null,
      description: o.description ?? null,
      pattern: o.pattern ?? null,
      outcome_vs_reference: o.outcome_vs_reference ?? null,
      reference: o.reference ?? null,
      control: o.control ?? null,
      configuration: c.configuration ?? null,
      oracle: 'the reference: what the x402 v2 flow admits given the offer the curl control received for this scenario on the same date (REFERENCE in the /clients x402 family block carries signing, result and the clause that produced them per scenario); the offer is control.offer on the control row, decoded from its PAYMENT-REQUIRED header and 402 body',
      license: LICENSE.responses.id,
    };
  });
}

// The fixed legend plus one generic entry for any other handed-back status the rows contain (the parser emits handed-back/<status> for any non-200 status).
function x402OutcomeLegend() {
  const legend = { ...X402_OUTCOMES };
  for (const o of OBSERVATIONS_X402) {
    if (/^handed-back\/\d{3}$/.test(o.outcome) && !(o.outcome in legend)) legend[o.outcome] = `The caller received a response object with status ${o.outcome.slice(-3)} and the library did not raise.`;
  }
  return legend;
}

function x402Family({ rows }) {
  const clientRowsOnly = OBSERVATIONS_X402.filter((o) => o.client.role === 'client');
  const outcomeCounts = {};
  for (const o of OBSERVATIONS_X402) outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
  const classCounts = {};
  for (const c of CLIENTS_X402) classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  const signedCounts = { signed: 0, not_signed: 0, resigned_at_least_once: 0 };
  const receiptCounts = {};
  const headerCounts = {};
  for (const o of clientRowsOnly) {
    const w = o.wire || (o.fetches && o.fetches[0] && o.fetches[0].wire) || {};
    if (w.signed) signedCounts.signed++; else signedCounts.not_signed++;
    if ((w.resigned || 0) >= 1) signedCounts.resigned_at_least_once++;
    if (w.receipt) receiptCounts[w.receipt] = (receiptCounts[w.receipt] || 0) + 1;
    if (w.payment_header) headerCounts[w.payment_header] = (headerCounts[w.payment_header] || 0) + 1;
  }
  const scenarios = [...new Set(OBSERVATIONS_X402.map((o) => o.scenario))];
  return {
    what:
      `What ${CLIENTS_X402.filter((c) => c.role === 'client').length} real x402 client libraries and wrappers did with the ${numWord(scenarios.length)} /402 cells (the eight scenarios and the ten malformed flavors), one row per observation, ` +
      'plus one raw-wire control row per cell (curl, no payment header). Each cell asks the client to GET the cell\'s url once with a throwaway Base Sepolia payer and the library\'s defaults; ' +
      'the harness never sends a payment header for a client. Each row lists every request the client sent, with the x402 headers decoded into a summary (never a raw signature), and what the caller received. ' +
      'The oracle is the reference: what the x402 v2 flow admits, given the offer the control was shown.',
    rows: rows.length,
    scenarios: scenarios.length,
    cells_per_client: WITNESS_X402.cells_per_client,
    observed: WITNESS_X402.probed,
    badhttp_version_observed: WITNESS_X402.badhttp_version_observed,
    worker_version: WITNESS_X402.worker_version,
    clients: CLIENTS_X402,
    fields: [...COMMON_FIELDS, ...X402_FIELDS],
    class_legend: X402_CLASSES,
    outcome_legend: x402OutcomeLegend(),
    description_legend: X402_DESCRIPTIONS,
    wire_legend: X402_WIRE,
    reference_legend: X402_REFERENCE_LEGEND,
    reading_this: X402_READING,
    outcome_counts: outcomeCounts,
    class_counts: classCounts,
    signed_counts: signedCounts,
    receipt_counts: receiptCounts,
    payment_header_counts: headerCounts,
    reference: REFERENCE_X402,
    disagreement_by_scenario: WITNESS_X402.disagreement_by_scenario,
    answers_by_scenario: WITNESS_X402.answers_by_scenario,
    disagreement_note: 'disagreement_by_scenario is, per scenario, the number of distinct answers — (outcome, signed, resigned bucket 0 | 1 | 2-5 | 6+) — among client rows; answers_by_scenario lists them with the clients that gave each. signed_counts, receipt_counts and payment_header_counts are over client rows. Control rows are excluded.',
    findings: x402Findings(),
    freshness:
      `A dated capture, not a live measurement: taken ${WITNESS_X402.probed} against badhttp version ` +
      `${WITNESS_X402.badhttp_version_observed}, with the client versions on each row. Client behaviour changes between ` +
      `releases and this table does not update itself. Re-run it from ${WITNESS_X402.capture_scripts || 'scripts/x402-witness/'} in the source and ` +
      'the numbers move; the date on every row is how you know whether to trust it.',
    reproduce:
      'Point the row\'s client at the row\'s url with a throwaway Base Sepolia payer registered and nothing else changed, ask it for the url once, and compare the requests it sent and what the caller received with the row. ' +
      'For the reference, fetch the same url with curl -sS --http1.1 and read the offer (scripts/witness-parse-x402.mjs carries the reference rules). ' +
      'Pace the calls against the zone limit of 100 per 10 s, and treat a response without x-badhttp-version as no observation.',
  };
}

// ---------------------------------------------------------------------------------------------------

export function clientRows({ origin }) {
  return [...compressRows({ origin }), ...crosshostRows(), ...authRows(), ...cookieRows(), ...sseRows(), ...rangeRows(), ...etagRows(), ...x402Rows()];
}

export function clientsIndex({ origin }) {
  const compress = compressRows({ origin });
  const crosshost = crosshostRows();
  const auth = authRows();
  const cookies = cookieRows();
  const sse = sseRows();
  const range = rangeRows();
  const etag = etagRows();
  const x402 = x402Rows();
  return {
    what:
      'What real HTTP clients actually did with this server\'s misbehaviour, as data: one row per ' +
      'observation, across eight families so far — the ' + WITNESS.flavors + ' /compress flavors (six decoding clients and ' +
      'two non-decoding controls), the ' + WITNESS_CROSSHOST.flavors + ' /crosshost flavors (eight clients; eight boundaries and a ' +
      'same-origin control), the ' + WITNESS_AUTH.flavors + ' /auth flavors (the same eight clients, each handed the documented ' +
      'fake credentials through its own mechanism), the ' + WITNESS_COOKIES.flavors + ' /cookies setter flavors (the same eight, ' +
      'each with a fresh jar where the client has one, through set, echo, delete and echo again), the ' + WITNESS_SSE.flavors + ' /sse flavors (real ' +
      'SSE client libraries plus a raw-wire control, each row described against a WHATWG parse of the ' +
      'bytes the control received) and the ' + WITNESS_RANGE.flavors + ' /range flavors (real resuming download clients, each handed a ' +
      WITNESS_RANGE.partial_bytes + '-byte partial of the document and told to resume it, plus a fresh download, with every request ' +
      'recorded and the file on disk described against where RFC 9110 places the bytes a control received) and the ' + WITNESS_ETAG.flavors + ' /etag flavors (real HTTP caches and ' +
      'conditional-request clients, each fetching the flavor three times through a fresh cache with every request recorded, the caller\'s answer described against what RFC 9111 implies from the control\'s exchanges) and the ' + numWord(new Set(OBSERVATIONS_X402.map((o) => o.scenario)).size) + ' /402 cells (real x402 client libraries, each asked to pay for one URL once with a throwaway Base Sepolia payer and the library\'s defaults, every request recorded and the caller\'s answer described against what the control\'s offer admits). Every row names ' +
      'the client and its version, the date, what it received, and what it reported.',
    why:
      'For /compress the home page has claimed these results since v0.12.0 and cited a private ' +
      'repository as the evidence; for /crosshost the family index carried them as prose from ' +
      'v0.17.0 (2026-09-10); for /auth the home page carried a three-client note from v0.9.0 ' +
      '(2026-08-27); for /cookies the home page carried a three-jar note from v0.6.0 (2026-08-24); for /sse ' +
      'the home page carried a one-client note from v0.4.0 (2026-08-23); for /range the home page carried a ' +
      'hand-typed curl note from v0.5.0 (2026-08-23); for /etag the home page carried a one-cache note ' +
      'from v0.5.0 (2026-08-23); for /402 the home page carried a few sentences about one client (@x402/fetch 2.23.0, probed 2026-08-23 and 2026-08-26). Here ' +
      'are all eight as rows. It is also the only data on this service that ' +
      'badhttp did not write about itself.',
    jsonl: `${origin}/clients.jsonl`,
    rows: compress.length + crosshost.length + auth.length + cookies.length + sse.length + range.length + etag.length + x402.length,
    families: {
      compress: compressFamily({ rows: compress }),
      crosshost: crosshostFamily({ rows: crosshost }),
      auth: authFamily({ rows: auth }),
      cookies: cookieFamily({ rows: cookies }),
      sse: sseFamily({ rows: sse }),
      range: rangeFamily({ rows: range }),
      etag: etagFamily({ rows: etag }),
      x402: x402Family({ rows: x402 }),
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

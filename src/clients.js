// /clients — what real HTTP clients did, as data. Five families so far.
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
  'no-mechanism': 'The client has no mechanism for the scheme the flavor demands (net/http, fetch and urllib3 have no Digest and no challenge handling of any kind), so the request was sent with no credentials at all. The row is a capability, not a bug.',
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
      'What eight HTTP clients did with the eighteen /auth flavors when handed the documented fake ' +
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
      'What eight HTTP clients did with the seventeen /cookies setter flavors, one row per observation. ' +
      'Each row is four requests with one fresh jar where the client has one (requests_made and hops count the setter fetch and its redirects only): the setter (redirects followed), /cookies/echo, ' +
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
      `What ${CLIENTS_SSE.filter((c) => c.role === 'client').length} real SSE client libraries did with the fourteen /sse flavors, one row per observation, ` +
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

export function clientRows({ origin }) {
  return [...compressRows({ origin }), ...crosshostRows(), ...authRows(), ...cookieRows(), ...sseRows()];
}

export function clientsIndex({ origin }) {
  const compress = compressRows({ origin });
  const crosshost = crosshostRows();
  const auth = authRows();
  const cookies = cookieRows();
  const sse = sseRows();
  return {
    what:
      'What real HTTP clients actually did with this server\'s misbehaviour, as data: one row per ' +
      'observation, across five families so far — the 21 /compress flavors (six decoding clients and ' +
      'two non-decoding controls), the 9 /crosshost flavors (eight clients; eight boundaries and a ' +
      'same-origin control), the 18 /auth flavors (the same eight clients, each handed the documented ' +
      'fake credentials through its own mechanism), the 17 /cookies setter flavors (the same eight, ' +
      'each with a fresh jar where the client has one, through set, echo, delete and echo again) and the 14 /sse flavors (real ' +
      'SSE client libraries plus a raw-wire control, each row described against a WHATWG parse of the ' +
      'bytes the control received). Every row names ' +
      'the client and its version, the date, what it received, and what it reported.',
    why:
      'For /compress the home page has claimed these results since v0.12.0 and cited a private ' +
      'repository as the evidence; for /crosshost the family index carried them as prose from ' +
      'v0.17.0 (2026-09-10); for /auth the home page carried a three-client note from v0.9.0 ' +
      '(2026-08-27); for /cookies the home page carried a three-jar note from v0.6.0 (2026-08-24); for /sse ' +
      'the home page carried a one-client note from v0.4.0 (2026-08-23). Here ' +
      'are all five as rows. It is also the only data on this service that ' +
      'badhttp did not write about itself.',
    jsonl: `${origin}/clients.jsonl`,
    rows: compress.length + crosshost.length + auth.length + cookies.length + sse.length,
    families: {
      compress: compressFamily({ rows: compress }),
      crosshost: crosshostFamily({ rows: crosshost }),
      auth: authFamily({ rows: auth }),
      cookies: cookieFamily({ rows: cookies }),
      sse: sseFamily({ rows: sse }),
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

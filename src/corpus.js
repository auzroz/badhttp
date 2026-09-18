import { CROSSHOST, crosshostStartUrl } from './crosshost.js';
// /corpus — the catalogue as data, and the licence for what this server emits.
//
// Why this exists (session 18, 2026-09-06): a conformance-validator project wrote to ops@ asking
// permission to capture our responses as test fixtures, because /openapi.json said info.license =
// {"name":"MIT"} and MIT speaks of "the Software", not of the bytes a server emits. They were right
// that the answer was not written down anywhere. It is now, on every row, and at /license.
//
// The second thing they were right to ask about, and wrong about, is what this service actually
// serves. They wanted RFC 9112 message-syntax violations — malformed start-lines, malformed field
// lines, the request-smuggling surface. We emit none, and cannot: this Worker sits behind
// Cloudflare's edge, which re-serializes every response. RFC9112 below records that finding with
// its method and date, so the next person does not have to write the email.
//
// Stateless like everything else: these rows are generated from the same flavor tables the home
// page and the family indexes render. Nothing is stored; no bytes are shipped that the edge could
// have changed on the way out. The corpus is the recipe and the description of the defect — you
// capture. It deliberately does NOT carry a machine-checkable expectation of what a client should
// do with each response: for almost every row no specification says what a client must surface to
// its caller, and asserting one would be inventing a standard and calling it conformance. What
// real clients actually did is a separate, observed, dated thing, and it lives at /clients.

export const LICENSE = {
  responses: {
    id: 'CC0-1.0',
    name: 'Creative Commons Zero v1.0 Universal (public domain dedication)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    covers:
      'Everything this server emits: response heads and bodies, the catalogue documents served by ' +
      '/range and /compress, the fake credentials in /auth, every JSON index, /openapi.json, ' +
      '/llms.txt, /corpus.jsonl and this statement. Capture it, store it, redistribute it, ' +
      'relicense it, sell it, put it in a test corpus under any licence you like.',
    conditions: 'None. CC0 waives them all.',
    attribution:
      'Requested, never required. If it costs you nothing: "captured from https://badhttp.dev ' +
      '(CC0-1.0)". A link is worth more to this project than a credit line, and neither is a condition.',
    volume_cap:
      'None beyond the published zone rate limit (100 requests / 10 s per IP), which is enforced at ' +
      'the edge and is not a licence term.',
    endpoints_to_avoid:
      'None for licensing. Two for courtesy: /compress/bomb answers up to 32 MiB per request, and ' +
      '/402/pay is the one endpoint that settles a real payment — the rest of /402 never contacts a ' +
      'facilitator. Neither is off limits; both cost someone something.',
  },
  not_ours: {
    note:
      'Precision, because it was asked precisely: a captured response also carries fields this ' +
      'project did not author — Cloudflare edge headers (cf-ray, Server-Timing, Report-To, the Date ' +
      'this service does not set) and, on /402, facilitator-supplied receipt values. Those are not ' +
      'ours to dedicate. They are also short factual strings rather than creative work, so we know ' +
      'of no claim over them; we simply are not the party who could waive one.',
  },
  source_code: {
    id: 'MIT',
    name: 'MIT License',
    url: 'https://opensource.org/license/mit',
    covers: 'The Worker source that produces the above. Separate question, separate licence.',
    note:
      'This split is the point. MIT covers the software; CC0 covers what the software emits. ' +
      'Before 2026-09-06 only the first was stated, and /openapi.json advertised it in a field that ' +
      'reads as a licence for the API — which is what made the question worth asking.',
  },
  contact: 'ops@badhttp.dev — read, and answered.',
  decided: '2026-09-06',
};

// What the wire probe established. Method and date on the record so it can be re-run and can go
// stale honestly rather than silently.
//
// This comment used to read "See docs/spec-corpus.md for the probe and its output." No such file
// has ever existed in this repo (session 20 checked: one reference, zero files), and the repo is
// private, so the citation could not have been followed even if it had. The claim below is the
// site's most load-bearing one and it pointed at nothing. Everything needed to re-derive it is
// therefore stated inline — the section list, the endpoint count and the date are all in `method`
// and `probed`, and `reproduce` names the capture a stranger would have to run. The probe itself
// lives in the session scratchpad (rfc9112-probe.mjs, ledger #18), which is not a published
// artifact; when this repo goes public it should be committed and named here.
export const RFC9112 = {
  emits_syntax_violations: false,
  probed: '2026-09-06',
  method:
    '151 documented endpoints captured over TLS with ALPN http/1.1, each response head parsed byte ' +
    'by byte and judged against RFC 9112 §2.2 (bare CR/LF), §4 (status-line: HTTP-version, 3DIGIT ' +
    'status-code, reason-phrase charset), §5 (field-line shape), §5.1 (field-name is a token; no ' +
    'whitespace before the colon), §5.2 (obs-fold), §5.5 (field-value charset) and §6 (Content-Length ' +
    'and Transfer-Encoding agreement, duplicate and non-numeric Content-Length).',
  result: '0 of 151 responses violated RFC 9112 message syntax.',
  reproduce:
    'Capture any endpoint\'s response head as literal bytes and read it against the sections above: ' +
    'curl --http1.1 --raw -sS -D - --output - https://badhttp.dev/status/418 | sed -n \'1,/^\\r$/p\' | xxd ' +
    '(that prints the whole header section, up to and including the terminating CRLF, which is what ' +
    'the grammar is about). ' +
    'Every row of /corpus.jsonl carries the same capture command in its `curl` field. What you are ' +
    'checking is the head\'s grammar, not the body: the claim is about message syntax only, and the ' +
    'two §6.3 completeness violations named in where_we_do_misbehave are the exception it does not ' +
    'cover.',
  why:
    'This Worker runs behind Cloudflare, which re-serializes every response before it reaches you. ' +
    'Neither workerd nor the edge will emit a malformed start-line, a malformed field-line, an ' +
    'obs-fold, a bare CR or LF in the header section, or a Content-Length that disagrees with a ' +
    'Transfer-Encoding. A header value set to a string with a CR in it does not reach the wire as ' +
    'one. This is a property of the platform, not a design choice, and it is not something this ' +
    'service can opt out of.',
  what_this_means_for_you:
    'If you are testing a parser against the RFC 9112 grammar or the request-smuggling surface, ' +
    'badhttp.dev is not a source of that traffic and capturing from it will teach you nothing: you ' +
    'would collect 151 well-formed messages. Worse, a corpus of clean messages can read as evidence ' +
    'that a checker has no false negatives. Serve those cases from a raw socket you control ' +
    '(a listener writing literal bytes), not from anything behind a CDN.',
  where_we_do_misbehave:
    'One layer up. RFC 9112 §6.3 completeness: /truncate and /sse/drop declare a Content-Length and ' +
    'then deliver fewer bytes and close (verified 2026-09-06: 1000 declared / 500 delivered, and ' +
    '565 declared / 53 delivered). Everything else in this catalogue is a semantic defect inside a ' +
    'well-formed message — a wrong status code, a lying Content-Range, a corrupt gzip member, a ' +
    'malformed auth challenge, a cookie attribute no jar should accept.',
};

// Per-family metadata the flavor tables do not carry: which layer the defect lives at, which
// document defines correct behaviour, what you must send to observe it, and whether the bytes are
// stable enough to pin a digest on.
const FAMILIES = {
  status: {
    layer: 'status-codes', specs: ['RFC 9110 §15'],
    about: 'Every registered status code, plus unregistered ones in each class.',
    deterministic: true, varies_by: [],
  },
  badjson: {
    layer: 'body-syntax', specs: ['RFC 8259', 'RFC 9110 §8.3'],
    about: 'Bodies served as application/json that are not JSON. The message is well formed; the payload is not.',
    deterministic: true, varies_by: [],
  },
  compress: {
    layer: 'content-coding', specs: ['RFC 9110 §8.4', 'RFC 1950', 'RFC 1951', 'RFC 1952', 'RFC 7932', 'RFC 8878'],
    about: 'Content codings that misbehave. The defect is inside the body; the HTTP framing around it is correct.',
    headers: { 'accept-encoding': 'gzip' },
    deterministic: true,
    varies_by: ['accept-encoding'],
    capture_note:
      'THE ONE THAT BITES: what you receive depends on your Accept-Encoding, because the edge removes ' +
      'one coding layer it recognizes unless your normalized set lists it — no-transform ' +
      'notwithstanding. Send Accept-Encoding: gzip to capture the flavor as this server sends it. ' +
      'Send no Accept-Encoding to capture what the edge does to it, which is the second half of the ' +
      'documentation and a real defect class of its own. Both are worth having; they are different ' +
      'fixtures and a corpus should say which one it holds.',
  },
  range: {
    layer: 'range-requests', specs: ['RFC 9110 §14'],
    about: 'Resumable-download defects over a self-describing document whose 64-byte lines carry their own offset, so wrong bytes convict themselves.',
    headers: { range: 'bytes=0-99' },
    deterministic: true, varies_by: ['range', 'if-range'],
  },
  etag: {
    layer: 'conditional-requests', specs: ['RFC 9110 §8.8', 'RFC 9110 §13', 'RFC 9111'],
    about: 'Validators and preconditions that lie, drift, or are ignored.',
    deterministic: false, varies_by: ['if-none-match', 'if-modified-since', 'date'],
  },
  cookies: {
    layer: 'cookies', specs: ['RFC 6265', 'draft-ietf-httpbis-rfc6265bis'],
    about: 'Set-Cookie lines a jar has to judge. The client\'s jar is the state under test; this server keeps none.',
    // `cookie` first because it is the dominant term: the body echoes back the request's own Cookie
    // header (`received`), so what you send is what moves the bytes. `date` matters too — several
    // flavors compute an Expires from the clock.
    deterministic: false, varies_by: ['cookie', 'date'],
  },
  auth: {
    layer: 'authentication', specs: ['RFC 9110 §11', 'RFC 7617', 'RFC 6750', 'RFC 7616'],
    about: 'WWW-Authenticate challenges and credential handling, correct and otherwise. All credentials here are public and fake.',
    deterministic: false, varies_by: ['authorization', 'date'],
    capture_note: 'Digest flavors carry a nonce derived from a 5-minute clock bucket, so their heads are not byte-stable across captures.',
  },
  sse: {
    layer: 'event-streams', specs: ['WHATWG HTML §9.2 (Server-Sent Events)'],
    about: 'Event streams that misframe, stall, cut and reset. One part is one chunk on the wire, verified.',
    deterministic: false, varies_by: ['last-event-id', 'timing'],
  },
  crosshost: {
    layer: 'redirects', specs: ['RFC 9110 §15.4', 'RFC 6265 §5.1.3'],
    about:
      'Credential handling when a redirect crosses a host boundary. Two hosts, badhttp.dev and ' +
      'alt.badhttp.dev, so the boundary is real DNS and a real certificate rather than a loopback ' +
      'listener. Each row is a starting URL; follow the redirect and read what arrived.',
    deterministic: true, varies_by: [],
    capture_note:
      'THE ONE THAT BITES: these rows are STARTING points, and the interesting response is the one ' +
      'after the redirect, so capture with a client that follows (curl -L) and record BOTH hops. ' +
      'Two rows do not start on https://badhttp.dev at all — from-subdomain starts on ' +
      'alt.badhttp.dev, and scheme-upgrade starts over plaintext http — because the direction and ' +
      'the scheme ARE the measurement. Use each row url exactly as published. Every badhttp ' +
      'response carries x-badhttp-version; a response without it came from the edge (a rate-limit ' +
      '429), not from this server, and is not an observation.',
  },
  redirect: {
    layer: 'redirects', specs: ['RFC 9110 §15.4'],
    about: 'Redirect chains, loops and relative targets.',
    deterministic: true, varies_by: [],
  },
  '402': {
    layer: 'payment', specs: ['x402 v2', 'x402 v1', 'RFC 9110 §15.5.3'],
    about: 'Payment-required responses in both x402 generations at once, most of them deliberately broken. Only /402/pay ever settles.',
    deterministic: false, varies_by: ['payment-signature', 'x-payment', 'date'],
  },
};

// Per-flavor overrides of a family's capture headers. Verified live 2026-09-07: /compress/br under
// `accept-encoding: gzip` arrives with no content-encoding and no content-length (the edge decoded
// it); under `accept-encoding: br` it arrives as content-encoding: br. Same for zstd.
const FLAVOR_HEADERS = {
  'compress.br': { 'accept-encoding': 'br' },
  'compress.zstd': { 'accept-encoding': 'zstd' },
};

// Per-flavor overrides of a family's STABILITY. Session 20: until now `deterministic_bytes` and
// `varies_by` were read from family metadata alone, so no flavor could differ from its family and
// the generator could not express the truth about one that did. It published exactly one falsehood:
// /range/if-range-ignored is the single range flavor that mints a fresh generation stamp on every
// request (src/range.js: `gen = flavor === 'if-range-ignored' ? g${generation()} : 'g1'`, and
// conditional.js's generation() is Date.now() plus random hex), so its bytes move every time — while
// its own `defect` string ended "Nondeterministic by design" and the row said deterministic_bytes:
// true. A consumer following the field's published contract ("true means the same request returns
// the same body bytes") would pin a digest and be broken by the next request.
//
// Anything added here must be true of the FLAVOR, not the family, and scripts/corpus-assert.sh
// re-derives it from the wire on every deploy — so a wrong entry fails the build rather than
// shipping as another quiet falsehood.
const FLAVOR_STABILITY = {
  'range.if-range-ignored': { deterministic: false, varies_by: ['range', 'if-range', 'generation'] },
};

// /redirect's behaviours. Not a flavor table in the router (the path segment is a hop count), so
// the corpus enumerates them here. Verified live 2026-09-07: /redirect/3 → 302 to /redirect/2,
// /redirect/0 → 200 JSON, /redirect/loop → 302 to itself, ?code= sets the 3xx and survives the chain.
const REDIRECTS = [
  { id: 'hops', path: '/redirect/3',
    defect: 'A finite chain: /redirect/{n} answers 302 with Location: /redirect/{n-1} down to /redirect/0, which answers 200. Up to 10 hops. Add ?code=301|303|307|308 to set the status the whole chain uses, ?absolute=1 to make Location absolute; both are carried down the chain.' },
  { id: 'loop', path: '/redirect/loop',
    defect: 'A redirect that never terminates: 302 with Location pointing at itself, plus x-badhttp-warning. Tests whether your client has a hop limit and what it reports when it hits one.' },
  { id: 'landing', path: '/redirect/0',
    defect: 'The end of the chain: 200 with a JSON body. Included so a harness can assert where a followed chain is supposed to land.' },
];

// The singleton endpoints, which have no flavor table to read.
const SINGLETONS = [
  { id: 'truncate', path: '/truncate', layer: 'message-framing', specs: ['RFC 9112 §6.3'],
    defect: 'Declares Content-Length: 1000 and delivers 500 bytes, then closes. An incomplete message: HTTP/1.1 sees a short read, HTTP/2 a stream reset.',
    rfc9112_completeness_violation: true, deterministic: true, varies_by: [] },
  { id: 'drip', path: '/drip', layer: 'message-framing', specs: ['RFC 9112 §7.1'],
    defect: 'A chunked body trickled out over seconds. Tests read timeouts and streaming consumers.',
    deterministic: false, varies_by: ['timing'] },
  // These three take a required parameter or a method other than GET. Session 19 found that the
  // rows shipped the bare path, so a harness replaying the corpus got 400, 400 and 405 from a file
  // that claimed to be a set of ready-to-run captures. Every row's own url and method must work as
  // published; scripts/corpus-verify.sh now replays all of them and fails the deploy otherwise.
  { id: 'delay', path: '/delay/2', layer: 'timing', specs: [],
    defect: 'Headers withheld for N seconds (/delay/{seconds}, 0-20). Tests connect-vs-read timeout handling.',
    deterministic: false, varies_by: ['timing'] },
  { id: 'flaky', path: '/flaky/50', layer: 'timing', specs: [],
    defect: 'Fails a settable percentage of the time (/flaky/{percent}). Tests retry logic. Nondeterministic by design: the same request returns 200 or 500.',
    deterministic: false, varies_by: ['randomness'] },
  { id: 'headers', path: '/headers', layer: 'diagnostic', specs: [],
    defect: 'Not a defect: reflects the request headers as this Worker sees them, which is how you discover what the edge changed on the way in.',
    deterministic: false, varies_by: ['request-headers'] },
  { id: 'echo', path: '/echo', method: 'POST', layer: 'diagnostic', specs: [],
    defect: 'Not a defect: reflects the request body, capped at 16 KB. GET is answered 405 — send a body.',
    deterministic: false, varies_by: ['request-body'] },
];

// A capture command, not a smoke test: --http1.1 so the head is the one you want to keep, -D and
// --output both to stdout so `> fixture.http` gives you head + CRLFCRLF + body in one file, and
// --raw so curl does not decode a content coding that is the whole point of the fixture.
function curlFor(url, headers, method) {
  const h = Object.entries(headers || {}).map(([k, v]) => ` -H '${k}: ${v}'`).join('');
  const m = method && method !== 'GET' ? ` -X ${method}` : '';
  return `curl --http1.1 --raw -sS -D -${m}${h} --output - '${url}'`;
}

/**
 * One row per documented DEFECT behaviour, flat, generated from the same tables the site renders.
 * The template explainers and the discovery surfaces are deliberately absent; see what_is_not_a_row.
 * `tables` is the catalog object the router already assembles.
 */
export function corpusRows({ origin, version, tables }) {
  const rows = [];
  const emit = (r) => rows.push({ ...r, license: LICENSE.responses.id, badhttp_version: version });

  for (const s of SINGLETONS) {
    const method = s.method || 'GET';
    emit({
      id: s.id, family: s.id, flavor: null, layer: s.layer,
      url: `${origin}${s.path}`, method, request_headers: {},
      defect: s.defect, specs: s.specs,
      conforms_rfc9112_syntax: true,
      rfc9112_completeness_violation: !!s.rfc9112_completeness_violation,
      deterministic_bytes: s.deterministic, varies_by: s.varies_by,
      curl: curlFor(`${origin}${s.path}`, {}, method),
    });
  }

  // /status is a numeric template, not a flavor list: one row for the range, not one per code.
  if (tables.statusCodes && tables.statusCodes.length) {
    emit({
      // url is a concrete, fetchable example; the template lives in `parameter` and `url_template`.
      // It used to be `/status/{code}`, which 400s when a harness fetches the row's own url (and
      // which curl silently globs to /status/code unless you pass --globoff).
      id: 'status', family: 'status', flavor: null, layer: 'status-codes',
      url: `${origin}/status/418`, url_template: `${origin}/status/{code}`,
      method: 'GET', request_headers: {},
      defect:
        'Any status code, returned verbatim, with the headers that code requires (Allow on 405, ' +
        'WWW-Authenticate on 401, Retry-After on 503). Codes with no body per RFC 9110 get none. ' +
        'Unregistered codes in each class are served too, which is where clients that switch on a ' +
        'hard-coded set fall over.',
      specs: FAMILIES.status.specs,
      parameter: { name: 'code', in: 'path', registered_codes: tables.statusCodes, range: '100-599' },
      conforms_rfc9112_syntax: true, rfc9112_completeness_violation: false,
      deterministic_bytes: true, varies_by: [],
      curl: curlFor(`${origin}/status/418`, {}, 'GET'),
    });
  }

  // /redirect has no flavor table for the loop above to read, so until session 19 its metadata at
  // FAMILIES.redirect was defined and emitted nothing: a whole documented family missing from the
  // corpus. Its three behaviours are enumerated here.
  for (const r of REDIRECTS) {
    emit({
      id: `redirect.${r.id}`, family: 'redirect', flavor: r.id,
      layer: FAMILIES.redirect.layer,
      url: `${origin}${r.path}`, method: 'GET', request_headers: {},
      defect: r.defect, specs: FAMILIES.redirect.specs,
      conforms_rfc9112_syntax: true, rfc9112_completeness_violation: false,
      deterministic_bytes: true, varies_by: [],
      curl: curlFor(`${origin}${r.path}`, {}, 'GET'),
    });
  }

  // /crosshost rows are generated from the flavor table, so a flavor that never reaches the corpus
  // fails the deploy. Their urls are NOT ${origin}+path: two of them deliberately start on the
  // other host or over plaintext http, because the direction and the scheme are what is measured.
  for (const [flavor, entry] of Object.entries(CROSSHOST)) {
    const u = crosshostStartUrl(flavor);
    emit({
      id: `crosshost.${flavor}`, family: 'crosshost', flavor,
      layer: FAMILIES.crosshost.layer,
      url: u, method: 'GET', request_headers: {},
      defect: entry.about, specs: FAMILIES.crosshost.specs,
      conforms_rfc9112_syntax: true, rfc9112_completeness_violation: false,
      deterministic_bytes: true, varies_by: [],
      redirect_hops: entry.hops,
      starts_on: new URL(u).host,
      curl: curlFor(u, {}, 'GET'),
    });
  }

  const families = [
    ['badjson', tables.badjson, (k) => `/badjson/${k}`],
    ['sse', tables.sse, (k) => `/sse/${k}`],
    ['range', tables.range, (k) => `/range/${k}`],
    ['etag', tables.etag, (k) => `/etag/${k}`],
    ['cookies', tables.cookies, (k) => `/cookies/${k}`],
    ['auth', tables.auth, (k) => `/auth/${k}`],
    ['compress', tables.compress, (k) => `/compress/${k}`],
    ['402', tables.scenarios, (k) => `/402/${k}`],
    ['402', tables.broken, (k) => `/402/broken/${k}`],
  ];

  for (const [fam, table, pathOf] of families) {
    if (!table) continue;
    const meta = FAMILIES[fam] || {};
    for (const [flavor, entry] of Object.entries(table)) {
      const path = pathOf(flavor);
      const url = `${origin}${path}`;
      // The family's capture headers, except where a flavor needs its own. /compress/br and
      // /compress/zstd are delivered as sent ONLY to a client whose Accept-Encoding lists that
      // coding; under the family default of `gzip` the edge decodes them and the capture is of the
      // transcoded response, not the flavor. Session 19: the rows claimed to be as-sent captures
      // and were not, and smoke asserted the wrong value was correct.
      const headers = { ...(meta.headers || {}), ...(FLAVOR_HEADERS[`${fam}.${flavor}`] || {}) };
      const row = {
        id: `${fam}.${flavor}`.replace('402.', '402/'),
        family: fam,
        flavor,
        layer: meta.layer || 'unclassified',
        url,
        method: 'GET',
        request_headers: headers,
        defect: (entry && (entry.about || entry.title)) || null,
        specs: meta.specs || [],
        conforms_rfc9112_syntax: true,
        rfc9112_completeness_violation: fam === 'sse' && flavor === 'drop',
        deterministic_bytes: (FLAVOR_STABILITY[`${fam}.${flavor}`] || meta).deterministic === true,
        varies_by: (FLAVOR_STABILITY[`${fam}.${flavor}`] || meta).varies_by || [],
        curl: curlFor(url, headers, 'GET'),
      };
      // /compress documents each flavor twice: as sent, and as the edge transcodes it.
      if (entry && entry.edge) row.edge_transcoding = entry.edge;
      if (entry && entry.expect) row.expect = entry.expect;
      if (fam === 'compress') {
        row.pinned_digest_header = 'x-badhttp-plain-sha256';
        row.pinned_digest_note =
          'The response carries the SHA-256 and byte length of the PLAINTEXT it should decode to ' +
          '(x-badhttp-plain-sha256 / x-badhttp-plain-bytes). Pin those, not the compressed bytes: ' +
          'the wire size belongs to this runtime\'s zlib and is not a stable fact about the flavor.';
      }
      emit(row);
    }
  }
  return rows;
}

export function corpusIndex({ origin, version, tables }) {
  const rows = corpusRows({ origin, version, tables });
  const byLayer = {};
  for (const r of rows) byLayer[r.layer] = (byLayer[r.layer] || 0) + 1;
  return {
    what:
      'This service\'s defect catalogue as one flat list, so a test harness can consume it without ' +
      'scraping eight family indexes. One row per behaviour: where it lives, what to send to observe ' +
      'it, what the defect is, which document says so, and whether the bytes are stable enough to pin ' +
      'a digest on. A few rows are deliberately CONTROLS rather than defects — /headers and /echo say ' +
      '"Not a defect" in their own defect field, and every family index names its correct-behaviour ' +
      'flavor — because a fixture set with no known-good case cannot tell a broken client from a ' +
      'broken server. What is absent is documented behaviour that is not part of the catalogue at ' +
      'all: see what_is_not_a_row.',
    what_is_not_a_row:
      'Two kinds of documented behaviour are deliberately absent, because a defect catalogue that ' +
      'includes them is diluted rather than complete. (1) The template explainers: request a ' +
      'documented URL template literally, braces intact (/sse/{flavor}), and you get a 200 with the ' +
      'placeholder\'s valid values — correct, useful, and not a defect. (2) Every surface that ' +
      'describes this service rather than misbehaving: the eight family indexes (/badjson, /sse, ' +
      '/range, /etag, /cookies, /auth, /compress, /402), the discovery and bookkeeping documents ' +
      '(/openapi.json, /llms.txt, /sitemap.xml, robots.txt, /favicon.svg, /health, /books, ' +
      '/books.json, /corpus, /corpus.jsonl, /clients, /clients.jsonl, /license), and the domain ' +
      'verification file /.well-known/402index-verify.txt. Until 2026-09-08 this index promised ' +
      '"every documented behaviour", which all of those made false; the promise was corrected rather ' +
      'than the file padded with rows demonstrating nothing.',
    jsonl: `${origin}/corpus.jsonl`,
    format: 'application/x-ndjson — one JSON object per line, newline-terminated',
    count: rows.length,
    by_layer: byLayer,
    license: LICENSE.responses.id,
    license_url: `${origin}/license`,
    rfc9112_message_syntax: RFC9112,
    how_to_use: [
      'GET /corpus.jsonl once. Each row is self-contained and carries a ready-to-run curl.',
      'Send the request_headers. On /compress they are load-bearing — see the capture note.',
      'Capture what you receive; this service ships recipes and defect descriptions, never pre-recorded bytes, because a CDN sits between this Worker and you and the honest artifact is the one you captured yourself.',
      'No row asserts what a correct client should do with the response: for almost all of them no specification says. For what six real clients DID do with /compress, see /clients.',
      'deterministic_bytes tells you whether the SAME request returns the same body bytes — repeat it and pin a digest. It is not a promise about tomorrow: see self_check.what_this_does_not_check. varies_by names what moves the response.',
      'Nothing here requires attribution. See /license.',
    ],
    capture_notes: Object.fromEntries(
      Object.entries(FAMILIES).filter(([, m]) => m.capture_note).map(([k, m]) => [k, m.capture_note])
    ),
    stability_legend: {
      deterministic_bytes:
        'true means the same request returns the same body bytes. It never means the response HEAD ' +
        'is byte-stable: Date, cf-ray and Server-Timing move on every response and are the edge\'s, ' +
        'not ours.',
      varies_by: 'What changes the response: request headers you control, the clock, or timing.',
    },
    // Stated rather than asserted: this block says what was actually run, not that the file is
    // "verified". The word is deliberately absent — what happened is that every row was replayed
    // and its fields compared to the wire, on a date, and the limits of that are named.
    self_check: {
      method:
        'Two checks run against a live badhttp on every deploy. scripts/corpus-verify.sh replays ' +
        'ALL rows with their own url, method and request_headers and fails if any answers 400, 404, ' +
        '405 or nothing at all — the guard that a row addresses the endpoint it publishes. ' +
        'scripts/corpus-assert.sh then re-derives the machine-readable fields: it fetches TWICE, ' +
        'with an identical request, every row claiming deterministic_bytes:true and fails if the ' +
        'body bytes differ; and it checks statically, across all rows, that deterministic_bytes:false ' +
        'names something in varies_by, that rfc9112_completeness_violation is on exactly the two ' +
        'endpoints named above, and that the published curl string reconstructs from the row\'s own ' +
        'url, method and headers.',
      script: 'scripts/corpus-verify.sh and scripts/corpus-assert.sh in https://github.com/auzroz/badhttp; the method above is the whole of what they do, and every assertion in it is one you can re-run against this service with curl and a hash.',
      rows_checked: rows.length,
      rows_double_fetched: rows.filter((r) => r.deterministic_bytes === true).length,
      last_run:
        'Every deploy. This document is regenerated per request from the same tables the checks run ' +
        'against, so it cannot report a date the code did not ship with; the deploy that published ' +
        'this text is the one that passed, and badhttp_version on every row of /corpus.jsonl says ' +
        'which deploy that was.',
      result:
        'Introduced 2026-09-08, when it found one: /range/if-range-ignored had published ' +
        'deterministic_bytes:true since the corpus existed, while it mints a fresh generation stamp ' +
        'per request. That row now reads false. No other field disagreed with the wire.',
      what_this_does_not_check: [
        'That bytes stay stable over weeks. Two requests seconds apart cannot see a body that turns over hourly or at midnight UTC; deterministic_bytes is a claim about repeating the same request, not about permanence.',
        'That varies_by is exhaustive. It is checked for being non-empty where a row admits its bytes move, never for naming everything that moves them.',
        'Whether a row\'s prose is true. `defect` is written by this project about its own endpoint, and no script can tell you it describes the response honestly — that is what /clients exists to make checkable, by publishing what independent implementations actually did.',
        'What a correct client SHOULD do. Nineteen rows carry an `expect` field, but it describes what this server intends to happen, not a conformance requirement, and it is neither machine-checkable nor asserted by anything here — see how_to_use.',
      ],
    },
    not_covered: {
      'rfc9112-message-syntax': RFC9112.what_this_means_for_you,
      'request-smuggling': 'Same reason. This service cannot emit conflicting framing headers; the edge normalizes them away.',
      'http/2 and http/3 framing': 'Both are served, but the frame layer is Cloudflare\'s, not ours; nothing here misbehaves at it on purpose.',
    },
  };
}

export function handleCorpus({ seg, url, json, withBase, version, tables }) {
  const origin = url.origin;
  if (seg[0] === 'corpus.jsonl') {
    const rows = corpusRows({ origin, version, tables });
    const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    return new Response(body, {
      status: 200,
      headers: withBase({
        'content-type': 'application/x-ndjson; charset=utf-8',
        // no-transform for the same reason the /compress index carries it: this file is read by
        // clients we have just told to send Accept-Encoding: gzip.
        'cache-control': 'public, max-age=300, no-transform',
        'x-badhttp-license': LICENSE.responses.id,
        'x-badhttp-rows': String(rows.length),
        link: `<${origin}/license>; rel="license"`,
      }),
    });
  }
  return json(corpusIndex({ origin, version, tables }), 200, {
    'cache-control': 'public, max-age=300, no-transform',
    'x-badhttp-license': LICENSE.responses.id,
    link: `<${origin}/license>; rel="license"`,
  });
}

export function handleLicense({ url, json, withBase }) {
  return json(
    {
      ...LICENSE,
      applies_to: url.origin,
      one_line:
        'Everything this server emits is CC0-1.0: capture it, redistribute it, relicense it, no ' +
        'conditions, no attribution required. The Worker source is MIT. Those are two different things.',
    },
    200,
    { 'cache-control': 'public, max-age=3600, no-transform', 'x-badhttp-license': LICENSE.responses.id }
  );
}

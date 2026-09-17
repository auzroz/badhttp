// OpenAPI 3.1 description of the catalogue. Agents discover endpoints here; humans read /.
// Profile: plain OpenAPI 3.1 plus the conventions agent registries parse (x402scan via @agentcash/discovery):
// `security: []` on every operation says "no API authentication"; `x-payment-info` on /402/pay alone says "paid";
// `info.x-guidance` and `x-agentcash-guidance.llmsTxtUrl` point agents at short guidance. HTTP clients need none of it.
export function openapi({ origin, version, badjsonFlavors, sseFlavors, rangeFlavors, etagFlavors, cookieFlavors, authFlavors, compressFlavors, crosshostFlavors, x402Scenarios, x402Broken, x402Limits }) {
  const jsonResp = (description) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
  const p = (name, where, schema, description, required = false) => ({ name, in: where, required, schema, description });
  const free = (op) => ({ security: [], ...op });
  const paths = {
      '/status/{code}': {
        get: {
          summary: 'Return the given status code (or a random one from a comma-separated list)',
          parameters: [
            p('code', 'path', { type: 'string', examples: ['429', '200,500,503'] }, '200–599, or a comma-separated list to pick from at random', true),
            p('retry-after', 'query', { type: 'integer', minimum: 0, maximum: 86400 }, 'Adds a Retry-After header with this many seconds'),
          ],
          responses: { default: jsonResp('The requested status; 204/205/304 have no body; 3xx carry Location: /redirect/0') },
        },
      },
      '/delay/{seconds}': {
        get: {
          summary: 'Wait before responding',
          parameters: [p('seconds', 'path', { type: 'number', minimum: 0, maximum: 10 }, 'Seconds to wait, decimals allowed', true)],
          responses: { 200: jsonResp('{requested_ms, actual_ms}') },
        },
      },
      '/drip': {
        get: {
          summary: 'Stream a chunked body slowly',
          parameters: [
            p('duration', 'query', { type: 'number', minimum: 0, maximum: 20, default: 5 }, 'Total seconds'),
            p('chunks', 'query', { type: 'integer', minimum: 1, maximum: 200, default: 10 }, 'Number of chunks'),
            p('code', 'query', { type: 'integer', minimum: 200, maximum: 599, default: 200 }, 'Status code to use (not 204, 205 or 304: those forbid a body)'),
          ],
          responses: { default: { description: 'text/plain, one line per chunk, chunked transfer encoding' } },
        },
      },
      '/truncate': {
        get: {
          summary: 'Declare a Content-Length, then send fewer bytes and close',
          parameters: [
            p('length', 'query', { type: 'integer', minimum: 1, maximum: 1048576, default: 1000 }, 'Declared Content-Length'),
            p('send', 'query', { type: 'integer', minimum: 0, maximum: 1048576 }, 'Bytes actually sent (default length/2)'),
          ],
          responses: { 200: { description: 'application/octet-stream with Content-Length: length; only send bytes arrive, then the connection closes (HTTP/1.1) or the stream is reset (HTTP/2)' } },
        },
      },
      '/badjson/{flavor}': {
        get: {
          summary: 'Serve a specific kind of broken or mislabeled JSON',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: badjsonFlavors }, 'Which failure; GET /badjson lists them', true),
            p('code', 'query', { type: 'integer', minimum: 200, maximum: 599, default: 200 }, 'Status code to use (not 204, 205 or 304: those forbid a body)'),
          ],
          responses: { default: { description: 'Content-Type: application/json (except "mislabeled"); body is intentionally broken' } },
        },
      },
      '/sse': { get: { summary: 'Index of the Server-Sent Events flavors, their limits and the reconnect rule', responses: { 200: jsonResp('{flavors, usage, limits, reconnect}') } } },
      '/sse/{flavor}': {
        get: {
          summary: 'A Server-Sent Events stream that misbehaves in the chosen way; GET /sse lists the flavors',
          description: 'text/event-stream (WHATWG HTML §9.2). Every stream starts with "retry: 30000" (resume alone sends "retry: 1000") and lasts at most 20 s. Any request carrying a Last-Event-ID header is answered 204 No Content (the spec\'s stop-reconnecting signal), except resume, which continues from it: ids 1–3, then 4–6 with Last-Event-ID: 3, then 204 with 6. HEAD returns the status and headers without streaming. drop carries a Content-Length and resets the connection mid-event.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: sseFlavors }, 'Which misbehaviour; GET /sse lists them', true),
            p('events', 'query', { type: 'integer', minimum: 1, maximum: 100, default: 5 }, 'ok only: number of events (events * interval must be at most 20000 ms)'),
            p('interval', 'query', { type: 'integer', minimum: 0, maximum: 5000, default: 250 }, 'ok only: milliseconds between events'),
            p('seconds', 'query', { type: 'number', minimum: 0, maximum: 20, default: 10 }, 'stall only: seconds of silence after the first event'),
            p('bytes', 'query', { type: 'integer', minimum: 1, maximum: 1048576, default: 65536 }, 'big only: length of the single data: line'),
            p('Last-Event-ID', 'header', { type: 'string' }, 'resume: the last id seen (integer; 6 or more ends the stream with a 204; non-integer is a 400). Every other flavor answers 204 when it is present.'),
          ],
          responses: {
            200: { description: 'text/event-stream; charset=utf-8 (wrong-type: text/plain), cache-control: no-store, no-transform, x-badhttp-flavor. The body misbehaves as the flavor says.', content: { 'text/event-stream': { schema: { type: 'string' } } } },
            204: { description: 'Last-Event-ID was sent (or resume is over): stop reconnecting. x-badhttp-note says so.' },
            400: jsonResp('Bad events, interval, seconds, bytes or Last-Event-ID (checked before anything is written)'),
            404: jsonResp('Unknown flavor, with the list'),
          },
        },
      },
      '/range': { get: { summary: 'Index of the range-request flavors: the self-describing document, limits, where If-Range is handled', responses: { 200: jsonResp('{flavors, usage, document, limits, conditionals, multipart}') } } },
      '/range/{flavor}': {
        get: {
          summary: 'A resumable download that misbehaves in the chosen way; GET /range lists the flavors',
          description: 'A deterministic, self-describing text document (64-byte lines, each starting with its own zero-padded offset), served with the chosen range misbehavior: Range ignored (with or without Accept-Ranges advertised), off-by-one or shifted bytes under a correct-looking Content-Range, a suffix range served as a prefix, a 206 that restarts from zero, a Content-Range that lies about the total or is missing, 206 without being asked, 200 with a Content-Range, 416 for everything, an unknown total, or If-Range ignored while the resource changes each request. "ok" is the fully correct control, including multipart/byteranges, If-Range, and the conditional headers (If-None-Match 304, If-Match 412); the misbehaving flavors ignore conditionals. Malformed or semantically invalid Range headers, more than 8 ranges, or a total span over 1 MiB are ignored (200 with the full body), as RFC 9110 allows. HEAD ignores Range (RFC 9110 §14.2) and returns the no-Range response\'s status, headers and Content-Length with no body.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: rangeFlavors }, 'Which misbehaviour; GET /range lists them', true),
            p('length', 'query', { type: 'integer', minimum: 1, maximum: 1048576, default: 1000 }, 'Document size in bytes'),
            p('Range', 'header', { type: 'string', examples: ['bytes=128-255', 'bytes=-100', 'bytes=0-63,128-191'] }, 'Up to 8 ranges; how it is honored depends on the flavor'),
            p('If-Range', 'header', { type: 'string' }, 'Honored by ok (strong validators only); deliberately ignored by if-range-ignored'),
          ],
          responses: {
            200: { description: 'The full document (no Range sent, the flavor ignores Range, or If-Range was stale at ok); 200-content-range serves a partial body with a Content-Range under this status', content: { 'text/plain': { schema: { type: 'string' } } } },
            206: { description: 'A partial body; whether the bytes and the Content-Range are honest depends on the flavor. Several ranges come back as multipart/byteranges (boundary "badhttp"); always-206 sends this even without a Range header' },
            304: { description: 'ok only: If-None-Match matched (or If-Modified-Since, when no If-None-Match was sent). Other flavors ignore conditionals; the full conditional family is /etag' },
            412: jsonResp('ok only: If-Match (or If-Unmodified-Since) did not match'),
            416: { description: 'Every range unsatisfiable (or any Range header at always-416): Content-Range: bytes */{length} — except wrong-total, whose 416 lies with */{2×length}' },
            400: jsonResp('Bad length'),
            404: jsonResp('Unknown flavor, with the list'),
          },
        },
      },
      '/etag': { get: { summary: 'Index of the conditional-request flavors and the caching model (no-cache: store, revalidate every use)', responses: { 200: jsonResp('{flavors, usage, caching}') } } },
      '/etag/{flavor}': {
        get: {
          summary: 'A small document whose validators (ETag and Last-Modified) misbehave in the chosen way; GET /etag lists the flavors',
          description: 'A fixed text document served with cache-control: no-cache, no-transform and validators that lie as the flavor says: an ETag that changes every response, conditionals ignored, 304 for a request with no conditionals, a 304 carrying the wrong ETag or none, an unquoted ETag, a Last-Modified in ISO 8601 or from the future. "ok" is the fully correct control (RFC 9110 §13.2.2): If-Match (strong comparison, * passes, 412 on mismatch), If-Unmodified-Since when If-Match is absent, then If-None-Match (weak comparison, lists and * supported, 304 on match for GET/HEAD), and If-Modified-Since only when If-None-Match is absent and only as a valid HTTP-date (IMF-fixdate, rfc850 or asctime; anything else is ignored). HEAD behaves as GET without the body.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: etagFlavors }, 'Which misbehaviour; GET /etag lists them', true),
            p('If-None-Match', 'header', { type: 'string' }, 'Revalidation; what matches depends on the flavor'),
            p('If-Modified-Since', 'header', { type: 'string' }, 'Date revalidation; ignored when If-None-Match is present, and ignored unless it is a valid HTTP-date (except bad-date, which string-compares)'),
            p('If-Match', 'header', { type: 'string' }, 'Precondition; strong comparison at ok (* passes), so weak validators fail with 412'),
            p('If-Unmodified-Since', 'header', { type: 'string' }, 'Date precondition, evaluated when If-Match is absent: 412 if the document was modified after this date'),
          ],
          responses: {
            200: { description: 'The document, with the flavor\'s validators', content: { 'text/plain': { schema: { type: 'string' } } } },
            304: { description: 'Revalidation "matched" (always-304 sends this unconditionally); which validators it carries depends on the flavor' },
            412: { description: 'If-Match (or If-Unmodified-Since) did not match — possible at every flavor that evaluates conditionals (all but ignore, always-304, unquoted and bad-date); at weak any non-* If-Match fails, since a weak validator never strong-matches' },
            404: jsonResp('Unknown flavor, with the list'),
          },
        },
      },
      '/cookies': { get: { summary: 'Index of the Set-Cookie flavors, the politeness rules and the limits', responses: { 200: jsonResp('{flavors, usage, politeness, observability, spec, limits}') } } },
      '/cookies/{flavor}': {
        get: {
          summary: 'Set-Cookie headers that misbehave in the chosen way; GET /cookies lists the flavors. /cookies/echo reads back what your client sent.',
          description: 'Each flavor sets one or more fixed Set-Cookie headers of the chosen shape (folded into one header, duplicate names on different paths, set on a 302, Max-Age contradicting Expires, an unparseable Expires, Domain=example.com, Domain=dev (a public-suffix supercookie), Domain=.host vs Domain=host, a path one letter short of /cookies, valid and invalid __Host-/__Secure- prefixes, quoted values, raw UTF-8 bytes, nameless cookies, a cookie of exactly ?bytes= name+value bytes). The server is stateless; the state under test is the client\'s jar. The JSON body repeats every Set-Cookie value sent (set), one sentence of what a correct client does (expect), and what Cookie header the request carried (received). /cookies/echo sets nothing and returns the raw Cookie header (plus base64) and the parsed pairs, order and duplicates preserved. Cookie values are fixed strings, never derived from the request; no Max-Age/Expires runs past 3600 s except far-future, whose date is the test (bad-expires and the nameless pair live as session cookies); /cookies/delete sends an expiring Set-Cookie for every cookie the family can plant, exact attributes and all.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: cookieFlavors }, 'Which misbehaviour; GET /cookies lists them', true),
            p('count', 'query', { type: 'integer', minimum: 1, maximum: 20, default: 10 }, 'many only: how many Set-Cookie headers'),
            p('bytes', 'query', { type: 'integer', minimum: 64, maximum: 8192, default: 4096 }, 'huge only: the sum of cookie name and value lengths — the measure rfc6265bis §5.6 caps at 4096 (above it a conformant client MUST ignore the cookie)'),
            p('Cookie', 'header', { type: 'string' }, 'Echoed back in the body (received / echo), order and duplicates preserved'),
          ],
          responses: {
            200: { description: 'application/json {flavor, set, expect, received}; echo: {cookie_header, cookie_header_base64, cookies, count, note} (+ cookie_header_truncated past the 16 KB cap). The Set-Cookie headers are the product.', content: { 'application/json': { schema: { type: 'object' } } } },
            302: { description: 'on-redirect only: Location: /cookies/echo with the Set-Cookie on the 302 itself' },
            400: jsonResp('Bad count or bytes (checked before any Set-Cookie is emitted)'),
            404: jsonResp('Unknown flavor, with the list'),
          },
        },
      },
      '/auth': { get: { summary: 'Index of the HTTP-authentication flavors, the public fake test credentials and the safety warning', responses: { 200: jsonResp('{flavors, usage, credentials, warning}') } } },
      '/auth/{flavor}': {
        get: {
          summary: 'HTTP authentication that misbehaves in the chosen way; GET /auth lists the flavors and the public fake test credentials',
          description: 'Challenges (WWW-Authenticate / Proxy-Authenticate) and credential checks that misbehave as the flavor says: a 401 with no challenge at all, an unknown scheme, two challenges in one comma-joined header, a token68 challenge first in the list, case-tricks, a comma inside a quoted realm, a server that rejects everything or accepts anything, a 403 for valid credentials, the Digest stale=true dance, a 407 from an origin that is not your proxy, a 302 asking whether credentials follow a redirect. The controls (basic, bearer, digest, digest-sha256) are fully RFC-correct: RFC 7617 Basic (charset="UTF-8"; /auth/utf8 accepts both encodings of its password and reports which arrived), RFC 6750 Bearer (invalid_request 400 / invalid_token 401 / insufficient_scope 403 with the challenge on the 403), RFC 7616 Digest (qop="auth", cnonce and nc required, uri checked against the request-target, stale=true when the deterministic 5-minute nonce ages out, Authentication-Info with rspauth on success). The ONLY credentials ever accepted are the published fake ones: user "agent", password "correct" (utf8: "sésame"); Bearer badhttp-token-ok / badhttp-token-limited. NEVER send real credentials: nothing here is protected, and anything received is compared in memory and discarded — never stored, logged, or echoed. Any method is accepted and treated identically (the request body is never read); HEAD gets the same status and headers.',
          parameters: [p('flavor', 'path', { type: 'string', enum: authFlavors }, 'Which misbehaviour; GET /auth lists them', true)],
          responses: {
            200: jsonResp('{authenticated:true, flavor, scheme, user|token, method, note, warning}; accept-any adds checked:false; utf8 adds encoding; digest flavors carry Authentication-Info'),
            302: { description: 'redirect only: Location: /auth/basic — does your Authorization follow?' },
            400: jsonResp('bearer: not token68-shaped (error="invalid_request" in the challenge); digest: missing/improper parameters or a uri that does not match the request-target (RFC 7616)'),
            401: jsonResp('{error, flavor, hint, credentials, warning} with the flavor\'s WWW-Authenticate (none omits the header entirely — the violation being modeled)'),
            403: jsonResp('forbidden: valid credentials, no challenge on the 403; bearer with badhttp-token-limited: error="insufficient_scope" WITH the challenge'),
            407: jsonResp('proxy only: Proxy-Authenticate: Basic realm="badhttp-proxy" from an origin server'),
            404: jsonResp('Unknown flavor, with the list'),
          },
        },
      },
      '/crosshost': { get: { summary: 'Index of the cross-host credential-boundary flavors: the two hosts, what each flavor crosses, the public test credentials, and the no-open-redirect statement', responses: { 200: jsonResp('{family, about, hosts, no_open_redirect, oracle, test_credentials, edge_note, reading_this, witness: {measured, observations, data, data_note, what_this_is, clients[], findings[], what_the_oracle_cannot_tell_you, reproduce} — derived from the /clients.jsonl crosshost rows, prior_art_and_advisories: {note, redirect_credential_leaks[], not_reproducible_here}, specs, flavors}') } } },
      '/crosshost/land': {
        get: {
          summary: 'The oracle: reports which credential headers reached this hop, without ever echoing their values. Served on both badhttp.dev and alt.badhttp.dev.',
          description: 'The landing endpoint every /crosshost flavor redirects to. It reports whether Authorization, Proxy-Authorization, Cookie and X-Api-Key arrived, which host and scheme the request landed on, and whether the credential was one of the published fake test values. It NEVER echoes what it received — not the value, not a prefix, and deliberately not a hash, because a digest of a weak credential is a cracking target rather than a mitigation. An Authorization scheme is named only when it is Basic, Bearer or Digest, so a bare secret sent as an entire header value never has its first token reflected back as a scheme name. Cookie names are listed only for cookies this server itself set (the badhttp_ prefix); any others are counted and never named. If a credential arrives that is not one of the documented public test values, the body and an x-badhttp-warning header say so and tell you to rotate it.',
          responses: { 200: jsonResp('{landed_on, scheme, method, received:{authorization,proxy_authorization,cookie,x_api_key}, matches_documented_test_credential, transport_was_encrypted, warning, no_echo, reading_this, edge_note}') },
        },
      },
      '/crosshost/{flavor}': {
        get: {
          summary: 'A redirect that crosses a specific host, scheme or cookie boundary, landing on /crosshost/land; GET /crosshost lists the flavors and which host each starts on',
          description: 'What your HTTP client does with credentials when a redirect crosses a host boundary. badhttp serves two hostnames from one Worker — badhttp.dev and alt.badhttp.dev, one label apart, covered by the same zone certificate — so the boundary is real DNS and a real certificate rather than a loopback listener. That distinction is the point: you cannot observe this from a listener on 127.0.0.1, because an agent framework\'s SSRF filter rejects a loopback target at hop zero and the code under test never runs. Flavors cross apex-to-subdomain, subdomain-to-apex, out-and-back to the origin the chain started from, http-to-https and https-to-http on one host, plus a hop that sets a host-only and a Domain-scoped cookie before crossing. THERE IS NO OPEN REDIRECT: every target is a complete absolute URL held in a frozen table of those two hosts, selected by flavor name, and checked against a fixed pattern before it is sent; no endpoint accepts a redirect target, or any part of one, from the caller, and there is no ?url=, ?next= or ?to= parameter. RFC 9110 section 15.4 says nothing about credentials on redirects, so what these flavors measure is per-client policy and convention rather than conformance, and several of the behaviours you can observe are deliberate documented choices by their authors. Two flavors do not start on https://badhttp.dev: from-subdomain starts on alt.badhttp.dev and scheme-upgrade starts over plaintext http, because the direction and the scheme are the measurement; requesting them on the wrong host or scheme answers 404 with the correct starting URL. Use the published fake credentials and nothing else.',
          parameters: [p('flavor', 'path', { type: 'string', enum: crosshostFlavors }, 'Which boundary to cross; GET /crosshost lists them and the host each starts on', true)],
          responses: {
            302: { description: 'Location pointing at the next hop, always one of badhttp.dev or alt.badhttp.dev; x-badhttp-boundary names what is being crossed. The jar flavor also sets three cookies on the way out: badhttp_hostonly (no Domain), badhttp_domain (Domain=badhttp.dev) and __Host-badhttp_lock (Secure, Path=/, no Domain).' },
            404: jsonResp('Unknown flavor, with the list; or a flavor requested on the wrong host or scheme, with the URL it must be started from and why'),
            500: jsonResp('A target that failed this family\'s own Location guard: a bug in badhttp, never something a caller can cause'),
          },
        },
      },
      '/compress': { get: { summary: 'Index of the content-coding flavors: the document, the verification headers, what the edge makes of each flavor for a client without gzip, and the Accept-Encoding the edge reports for you', responses: { 200: jsonResp('{flavors, edge_transcoding, usage, document, verification, accept_encoding, edge, encodings, headers, limits, spec}') } } },
      '/compress/{flavor}': {
        get: {
          summary: 'A response whose content coding misbehaves in the chosen way; GET /compress lists the flavors. Send Accept-Encoding: gzip to receive the bytes as sent.',
          description: 'A deterministic, self-describing text document (64-byte lines, each starting with its own zero-padded offset) served with the chosen content-coding misbehaviour: gzip declared on plain text, gzip with no header, a stream truncated inside the DEFLATE data, corrupted, with a wrong CRC-32, followed by junk, in two members, gzipped twice (declared as "gzip, gzip" or hidden under one "gzip"), raw DEFLATE as "deflate", an unknown coding, GZIP in capitals, the x-gzip alias, an empty gzip body, a Content-Length that counts the plaintext (then a reset), a .gz download served with Content-Encoding: gzip as well, and a declared decompression bomb; br and zstd pre-computed for the default document, zlib deflate as a reproducible edge observation; "ok" is the honest control (gzip or identity from the Accept-Encoding the edge reports, Vary: Accept-Encoding). Every flavor response is text/plain (gzip-file: application/gzip) with cache-control: no-store, no-transform and carries x-badhttp-plain-bytes and x-badhttp-plain-sha256 for the plaintext, so a client can prove what it decoded. Cloudflare\'s edge fronts this Worker: it removes one coding layer it recognizes (gzip, br, zstd) unless the client\'s normalized Accept-Encoding lists it, transcoding to identity — lossily for broken streams (the index\'s edge_transcoding says what each flavor became) — decoded zlib deflate for every client probed (2026-09-01), and passes unrecognized codings (x-gzip, badhttp) through untouched. HEAD returns the GET\'s headers and Content-Length as this Worker sends them; the edge strips Content-Length and Content-Encoding from a HEAD whose recognized coding the client did not list.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: compressFlavors }, 'Which misbehaviour; GET /compress lists them', true),
            p('length', 'query', { type: 'integer', minimum: 1, maximum: 1048576, default: 4096 }, 'Plaintext length in bytes (br and zstd accept only 4096, empty only 0, bomb none; wrong-length needs at least 128 so the gzip member is shorter than the length it claims)'),
            p('code', 'query', { type: 'integer', minimum: 200, maximum: 599, default: 200 }, 'Status code to use on every flavor but bomb (not 204, 205 or 304: those forbid a body) — a compressed or mislabelled error body is its own bug class'),
            p('size', 'query', { type: 'integer', minimum: 1, maximum: 32, default: 8 }, 'bomb only: inflated size in MiB'),
            p('Accept-Encoding', 'header', { type: 'string', examples: ['gzip', 'br', 'zstd'] }, 'What the edge lets through: a coding reaches you only if you list it (the edge removes one recognized layer otherwise); ok negotiates from the normalized set the edge reports (q-values dropped, zstd invisible); bomb is refused with a 406 unless that set lists gzip'),
          ],
          responses: {
            default: { description: 'The document under the flavor\'s coding and headers, at ?code= (200 by default): text/plain; charset=utf-8 (gzip-file: application/gzip with Content-Disposition), cache-control: no-store, no-transform, x-badhttp-flavor, x-badhttp-plain-bytes, x-badhttp-plain-sha256, Content-Encoding as the flavor says or none. wrong-length declares the plaintext\'s Content-Length and then resets the connection.', content: { 'text/plain': { schema: { type: 'string' } } } },
            400: jsonResp('Bad length, size or code; ?length= off its fixed value on br, zstd or empty; ?length= or ?code= on bomb; ?size= off bomb; wrong-length under 128 — checked before any body is sent'),
            404: jsonResp('Unknown flavor, with the list'),
            405: jsonResp('Methods other than GET and HEAD'),
            406: jsonResp('bomb only: the Accept-Encoding the edge reports for you does not list gzip, so the member is not sent (the edge would inflate it for you, testing no decoder); send Accept-Encoding: gzip'),
          },
        },
      },
      '/flaky/{percent}': {
        get: {
          summary: 'Fail a given percentage of the time',
          parameters: [
            p('percent', 'path', { type: 'integer', minimum: 0, maximum: 100 }, 'Failure probability', true),
            p('fail', 'query', { type: 'integer', minimum: 400, maximum: 599, default: 500 }, 'Status code on failure'),
            p('seed', 'query', { type: 'string' }, 'With seed, the outcome is a pure function of (seed, i)'),
            p('i', 'query', { type: 'integer', minimum: 0, default: 0 }, 'Attempt index; increment it per retry'),
          ],
          responses: { 200: jsonResp('{failed:false, roll, threshold, mode}'), default: jsonResp('{failed:true, roll, threshold, mode, status, reason}') },
        },
      },
      '/redirect/{hops}': {
        get: {
          summary: 'Redirect N times, then 200. Or /redirect/loop, which never ends.',
          parameters: [
            p('hops', 'path', { oneOf: [{ type: 'integer', minimum: 0, maximum: 10 }, { type: 'string', enum: ['loop'] }] }, 'Remaining hops, or "loop"', true),
            p('code', 'query', { type: 'integer', enum: [301, 302, 303, 307, 308], default: 302 }, 'Redirect status'),
            p('absolute', 'query', { type: 'boolean' }, 'Use an absolute Location instead of a relative one'),
          ],
          responses: { '3XX': { description: 'Location: /redirect/{hops-1}' }, 200: jsonResp('{redirects:"done"}') },
        },
      },
      '/headers': { get: { summary: 'Echo the request headers as JSON', responses: { 200: jsonResp('{headers}') } } },
      '/echo': (() => {
        const echo = { summary: 'Echo method, path, query, headers and body (16 KB cap) as JSON', responses: { 200: jsonResp('{method, path, query, headers, body_bytes, body_truncated, body, json?}') } };
        const nope = { summary: 'Always 405 with an Allow header, so clients can practice handling it', responses: { 405: jsonResp('{error}') } };
        return { post: echo, put: echo, patch: echo, delete: echo, get: nope, head: nope };
      })(),
      '/402': { get: { summary: 'Index of the x402 payment scenarios: networks, price limits, pay-to address, facilitators', responses: { 200: jsonResp('{scenarios, networks, pay_to, price, facilitators}') } } },
      '/402/pay': {
        get: {
          summary: 'A real x402 paywall for testing clients, v2 and v1 in one response: pay 0.001–1.00 USDC (test USDC on Base Sepolia by default, ?network=base for real USDC) and get a 200 with a receipt and the transaction hash',
          description: 'The only endpoint on this host that settles a payment. Without a payment header: 402 carrying the requirements twice — x402 v2, base64-encoded in a PAYMENT-REQUIRED header, and x402 v1, as the JSON body (x402Version 1, plain network names, maxAmountRequired in atomic units) for older clients that only read bodies. The requirements name one network: Base Sepolia (test USDC, free) unless you ask for Base mainnet (real USDC) with /402/pay/base or ?network=base; a client whose wallet is funded on mainnet must ask for it. With a valid PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1): verified and settled through a third-party facilitator (GET /402 lists them in order, per generation, and its "verified" object says what has been exercised live so far); 200 plus a receipt in PAYMENT-RESPONSE (v2) or X-PAYMENT-RESPONSE (v1) on success. Nothing is sold except the receipt. Sibling endpoints under /402 misbehave on purpose and never settle.',
          'x-payment-info': { price: { mode: 'dynamic', currency: 'USD', min: String(x402Limits.minUsd), max: x402Limits.maxUsd.toFixed(2) }, protocols: [{ x402: {} }] },
          parameters: [
            p('network', 'query', { type: 'string', enum: ['base-sepolia', 'base'], default: 'base-sepolia' }, 'base-sepolia is test USDC (free, the default); base is real USDC on Base mainnet'),
            p('amount', 'query', { type: 'number', minimum: x402Limits.minUsd, maximum: x402Limits.maxUsd, default: x402Limits.defaultUsd }, 'Price in USD'),
          ],
          responses: {
            402: { description: 'PAYMENT-REQUIRED header: base64 JSON {x402Version:2, resource:{url, description, mimeType, serviceName, tags}, accepts:[{scheme:"exact", network:"eip155:84532" (or "eip155:8453" with ?network=base), asset, amount, payTo, maxTimeoutSeconds, extra:{name, version, assetTransferMethod}}], extensions:{bazaar}, error?}. JSON body: the x402 v1 translation of the same requirements, {x402Version:1, error, accepts:[{scheme, network:"base-sepolia"|"base", maxAmountRequired, resource, description, mimeType, payTo, maxTimeoutSeconds, asset, extra:{name, version}}]}, plus human-oriented extra keys v1 clients ignore. Also the answer to an invalid or rejected payment, with error set.' },
            200: { description: 'Settled: {paid:true, transaction, payer, network, amount_usd, …} plus a receipt header, PAYMENT-RESPONSE for a v2 payment or X-PAYMENT-RESPONSE for a v1 payment (base64 JSON of the facilitator settle response)' },
            202: { description: 'The facilitator broadcast the transfer but gave up waiting for confirmation (settlement_pending): {paid:"pending", transaction} plus the receipt header, PAYMENT-RESPONSE for a v2 payment or X-PAYMENT-RESPONSE for a v1 payment. Do not pay again.' },
            400: { description: 'Bad amount or network (checked before the first 402, so a client never signs against a URL that will then fail)' },
            405: { description: 'Methods other than GET, HEAD and POST. HEAD receives the 402 and never settles.' },
            502: { description: 'No facilitator reachable, or the settle call failed after verification (charged: "unknown")' },
          },
        },
      },
      '/402/pay/base': {
        get: {
          summary: 'The same paywall, real USDC on Base mainnet only: the stable resource URL for a client or catalogue that wants mainnet',
          description: 'Identical to /402/pay?network=base. Pay 0.001–1.00 USDC on Base mainnet (eip155:8453) and get a 200 with a receipt (PAYMENT-RESPONSE for a v2 payment, X-PAYMENT-RESPONSE for a v1 payment) and the transaction hash; that payment is this site\'s revenue and is booked at /books. Nothing else is sold.',
          'x-payment-info': { price: { mode: 'dynamic', currency: 'USD', min: String(x402Limits.minUsd), max: x402Limits.maxUsd.toFixed(2) }, protocols: [{ x402: {} }] },
          parameters: [p('amount', 'query', { type: 'number', minimum: x402Limits.minUsd, maximum: x402Limits.maxUsd, default: x402Limits.defaultUsd }, 'Price in USD')],
          responses: { 402: { description: 'As /402/pay, with accepts[0].network eip155:8453' }, 200: { description: 'Settled on Base mainnet' }, 202: { description: 'settlement_pending; do not pay again' }, 400: { description: 'Bad amount' }, 502: { description: 'No facilitator reachable, or settle failed after verification' } },
        },
      },
      '/402/pay/base-sepolia': {
        get: {
          summary: 'The same paywall, test USDC on Base Sepolia only (what the bare /402/pay offers)',
          description: 'Identical to /402/pay?network=base-sepolia and to the bare /402/pay. Free to exercise with test USDC; nothing real moves.',
          'x-payment-info': { price: { mode: 'dynamic', currency: 'USD', min: String(x402Limits.minUsd), max: x402Limits.maxUsd.toFixed(2) }, protocols: [{ x402: {} }] },
          parameters: [p('amount', 'query', { type: 'number', minimum: x402Limits.minUsd, maximum: x402Limits.maxUsd, default: x402Limits.defaultUsd }, 'Price in USD')],
          responses: { 402: { description: 'As /402/pay, with accepts[0].network eip155:84532' }, 200: { description: 'Settled on Base Sepolia (test USDC)' } },
        },
      },
      '/402/{scenario}': {
        get: {
          summary: 'x402 paywalls that misbehave on purpose (v2 header + v1 body, like /402/pay). Every scenario here returns a valid-looking 402 and then never settles anything; the one that works is /402/pay.',
          description: 'Without a payment header: 402 with the requirements base64-encoded in a PAYMENT-REQUIRED header (x402 v2) and translated into the JSON body (x402 v1, plain network names, maxAmountRequired) — except wrong-network, whose body stays v2-shaped because its nonexistent chain has no v1 name. With a PAYMENT-SIGNATURE or X-PAYMENT: each scenario answers as its name suggests (never: 402 again; reject: 402 with an error; slow: 504 after ?seconds=; crash: 500; bad-receipt: 200 with garbage in both receipt headers; overpriced and wrong-network: 402 explaining what your client should have refused). Nothing is ever charged. GET /402 lists them.',
          parameters: [
            p('scenario', 'path', { type: 'string', enum: x402Scenarios.filter((s) => s !== 'broken' && s !== 'pay') }, 'Which misbehaving paywall', true),
            p('network', 'query', { type: 'string', enum: ['base-sepolia', 'base'], default: 'base-sepolia' }, 'base-sepolia is test USDC (free); base is real USDC on Base mainnet'),
            p('amount', 'query', { type: 'number', minimum: x402Limits.minUsd, maximum: x402Limits.maxUsd, default: x402Limits.defaultUsd }, 'Price in USD'),
            p('reason', 'query', { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 64, default: 'insufficient_funds' }, '/402/reject only: the error to reject with (snake_case)'),
            p('seconds', 'query', { type: 'number', minimum: 0, maximum: x402Limits.slowMaxSeconds, default: 8 }, '/402/slow only: how long to sit on a paid request before the 504'),
          ],
          responses: {
            402: { description: 'PAYMENT-REQUIRED header: base64 JSON {x402Version:2, resource, accepts:[{scheme:"exact", network:"eip155:…", asset, amount, payTo, maxTimeoutSeconds, extra:{name, version, assetTransferMethod}}], error?}. JSON body: the x402 v1 translation of the same requirements (except wrong-network, v2-shaped). Nothing sent here is ever settled.' },
            200: { description: '/402/bad-receipt after payment: a 200 whose PAYMENT-RESPONSE and X-PAYMENT-RESPONSE headers are both garbage' },
            500: { description: '/402/crash after payment' },
            504: { description: '/402/slow after payment' },
            400: { description: 'Bad amount, network, reason or seconds (checked before the first 402, so a client never signs against a URL that will then fail)' },
            405: { description: 'Methods other than GET, HEAD and POST. HEAD receives the 402 and never settles.' },
          },
        },
      },
      '/402/broken/{flavor}': {
        get: {
          summary: 'A malformed 402 of the chosen flavor; GET /402/broken lists them. Never settles.',
          parameters: [
            p('flavor', 'path', { type: 'string', enum: x402Broken }, 'Which malformation', true),
            p('network', 'query', { type: 'string', enum: ['base-sepolia', 'base'], default: 'base-sepolia' }, 'Network named in the (broken) requirements'),
            p('amount', 'query', { type: 'number', minimum: x402Limits.minUsd, maximum: x402Limits.maxUsd, default: x402Limits.defaultUsd }, 'Price named in the (broken) requirements'),
          ],
          responses: { 402: { description: 'Broken on purpose; see x-badhttp-flavor' }, 400: { description: 'Bad amount or network' } },
        },
      },
      '/books.json': { get: { summary: 'Public books: every dollar spent and earned by this service (hosting accrues on a clock and is computed, not listed in costs[]; totals.costs = totals.itemized_costs + totals.hosting_accrued), with the receive address\'s balance and itemized transfer list read live from chain and reconciled against the booked numbers, the measured basis for the hosting figure, and a solvency line reading the project payer wallet\'s balance live against the next bill', responses: { 200: jsonResp('{costs[] — one-off spend only; hosting is derived, see hosting{} and totals.hosting_accrued, revenue[], commitments[] — owed but not yet spent, excluded from totals, hosting: {rate_usd_per_month, since, item, basis}, hosting_measured: {measured_on, window, source, requests, cpu_ms, subrequests, egress_bytes, cpu_ms_p50|p99|p999|max, days_in_window_exceeding_free_ceiling, plan{}} — the dated measurement behind the attributed hosting rate, hosting_usage: {requests_per_day, projected_requests_per_month, projected_cpu_ms_per_month, percent_of_paid_included_requests, percent_of_paid_included_cpu, usage_charge_on_existing_paid_plan_usd, free_plan_viable, free_plan_blocker, standalone_hosting_usd_per_year, incremental_hosting_usd_per_year} — all derived from hosting_measured, chain_movements[], totals: {costs, revenue, net, hosting_accrued, hosting_months, next_accrual, itemized_costs}, solvency: {payer_address, payer_usdc — read live from chain, registrar_credit_usd — stated and dated, assets_on_hand_usd, next_bill, days_until_next_bill, shortfall_usd, covers_next_bill, conversion_rail, reproduce, fetched_at|age_seconds|source|rpc — or solvency.error and null amounts when every RPC fails}, receive_address, chain: {balance_usdc, movements_in_usdc, movements_out_usdc, movements_net_usdc, booked_revenue_usdc, unbooked_usdc, status: reconciled|unbooked_receipts|bookkeeping_bug, status_note, fetched_at, age_seconds, source, rpc, reproduce, transfers: {items[] — every on-chain USDC transfer of the address, both directions, each labeled from the books by tx hash (an unmatched incoming row is "unbooked", an unmatched outgoing row is "UNEXPLAINED WITHDRAWAL"), itemized_net_usdc, matches_balance, unbooked_in_count, unexplained_out_count, truncated, source_api, reproduce — or transfers: {error, reproduce} while the indexer is unreachable or the first read at an edge location is still in progress}} — or chain: {error, reproduce} when every RPC fails and no cached copy exists}') } } },
      '/llms.txt': { get: { summary: 'Short guidance for agents (llms.txt)', responses: { 200: { description: 'text/markdown' } } } },
      '/health': { get: { summary: 'Liveness', responses: { 200: jsonResp('{ok:true, version}') } } },
      '/corpus': { get: { summary: 'The catalogue as data: an index over every documented DEFECT behaviour (what_is_not_a_row names what is deliberately excluded), with the licence, the self_check block recording that every row was replayed and its fields compared to the wire, the capture notes, and what this service does NOT cover (RFC 9112 message syntax — it emits none, and cannot, because a CDN re-serializes every response)', responses: { 200: jsonResp('{what, what_is_not_a_row, jsonl, format, count, by_layer, license, license_url, rfc9112_message_syntax: {emits_syntax_violations:false, probed, method, result, reproduce, why, what_this_means_for_you, where_we_do_misbehave}, how_to_use[], capture_notes, stability_legend, self_check: {method, script, last_run, rows_checked, result, what_this_does_not_check[]}, not_covered}') } } },
      '/corpus.jsonl': { get: { summary: 'One JSON object per line, one line per documented DEFECT behaviour: url, method, request_headers, defect, specs, layer, deterministic_bytes (true means the same request returns the same body bytes — re-derived from the wire on every deploy), varies_by, a ready-to-run capture curl, and the licence on every row', responses: { 200: { description: 'application/x-ndjson' } } } },
      '/clients': { get: { summary: 'What real HTTP clients did, as data: an index over 240 dated observations in two families — /compress (168: six decoding clients plus two non-decoding controls x 21 flavors) and /crosshost (72: eight clients x 9 flavors — eight boundaries and a same-origin control) — each family with its own outcome legend, per-flavor disagreement count, client roster and the note that an outcome describes what the caller received and is never a verdict on the client', responses: { 200: jsonResp('{what, why, jsonl, rows, families: {compress: {what, rows, flavors, observed, badhttp_version_observed, clients[], fields[], outcome_legend, reading_this, observation_counts_by_role, disagreement_by_flavor, freshness, reproduce}, crosshost: {what, rows, flavors, observed, badhttp_version_observed, worker_version, clients[], fields[], outcome_legend, reading_this, outcome_counts, disagreement_by_flavor, findings[], freshness, reproduce}}, common_fields[], join, reading_this, license, license_url}') } } },
      '/clients.jsonl': { get: { summary: 'One JSON object per line, one line per observation, family on every row: the client and its version, what it received (compress: whether the bytes matched the flavor\'s documented plaintext; crosshost: which sent headers arrived after the redirect, on which host and port, over which transport, and which cookies under the badhttp_ prefix came back — the three the jar hop mints and the harness\'s own badhttp_witness), what it reported, and corpus_id joining the row back to /corpus.jsonl. A dated capture, not a live measurement', responses: { 200: { description: 'application/x-ndjson' } } } },
      '/funding.json': { get: { summary: 'funding.json manifest (fundingjson.org v1.1.0): who runs this, what it costs to run for a year, and the one channel it can be funded through. Vouched for by /.well-known/funding-manifest-urls. No projects[] entry — the schema requires a repository URL and this project\'s repository is private', responses: { 200: jsonResp('{version:"v1.1.0", entity: {type, role, name, email, description, webpageUrl}, funding: {channels[], plans[]}}') } } },
      '/license': { get: { summary: 'Licensing, stated separately for the two things people confuse: CC0-1.0 for everything this server emits, MIT for the Worker source', responses: { 200: jsonResp('{responses: {id:"CC0-1.0", name, url, covers, conditions, attribution, volume_cap, endpoints_to_avoid}, not_ours, source_code: {id:"MIT", ...}, contact, decided, applies_to, one_line}') } } },
  };
  // Every operation declares `security: []` (no API authentication); only the three /402/pay URLs are paid.
  for (const item of Object.values(paths)) {
    for (const [method, op] of Object.entries(item)) item[method] = free(op);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'badhttp',
      version,
      summary: 'The server that misbehaves on purpose.',
      description:
        'A stateless catalogue of HTTP edge cases for testing clients, SDKs and agents, including x402 paywalls (v2 and v1 in the same responses) that misbehave on purpose. No signup, no caller state. The only outbound requests are /402/pay\'s calls to an x402 facilitator and /books\' cached reads of two of our own addresses: the receive address\'s balance and the project payer wallet\'s balance from a public Base RPC, and the receive address\'s itemized transfer list from a public Blockscout indexer. Every endpoint is deterministic unless documented otherwise.',
      // info.license describes the licence of the EXPOSED API — i.e. what this server emits — which
      // is CC0. Until 2026-09-06 this field said {"name":"MIT"}, the Worker source's licence, and a
      // conformance-validator project wrote in to say (correctly) that MIT speaks of "the Software"
      // and it was not obvious that it reached response bytes. It didn't. The source licence now has
      // its own field so the two can never be confused again. See /license.
      license: {
        name: 'CC0-1.0',
        identifier: 'CC0-1.0',
        url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      'x-license': {
        responses: 'CC0-1.0 — everything this server emits: response heads and bodies, catalogue documents, every JSON index, this document. No conditions, no attribution required.',
        source_code: 'MIT — the Worker source that produces them. A different question with a different answer.',
        details: `${origin}/license`,
        corpus: `${origin}/corpus.jsonl`,
      },
      contact: { name: 'badhttp', url: `${origin}/books`, email: 'ops@badhttp.dev' },
      'x-guidance': 'Everything is free and stateless. Call any endpoint directly; no key, no signup. Only /402/pay settles a payment (x402 v2 in the PAYMENT-REQUIRED header and x402 v1 in the 402 JSON body, USDC; pay with PAYMENT-SIGNATURE or X-PAYMENT): test USDC on Base Sepolia by default; real USDC on Base mainnet only at /402/pay/base (or ?network=base). Every other /402 scenario is a paywall that misbehaves on purpose and never charges. Limits: /delay ≤ 10 s, /drip ≤ 20 s, /echo body ≤ 16 KB, /redirect ≤ 10 hops, /range documents ≤ 1 MiB, /cookies/many ≤ 20 Set-Cookie headers (the /cookies/delete cleanup sends 45 expirations), /compress documents ≤ 1 MiB and /compress/bomb ≤ 32 MiB inflated (send Accept-Encoding: gzip to receive /compress flavors as sent; the edge transcodes codings you did not list). /cookies tests your client\'s jar (Set-Cookie edge cases; /cookies/echo reads back what you sent). Accounts are public at /books.json. Rate limit: 100 requests per 10 s per IP at the zone (Cloudflare 429, error 1015) before the Worker runs. /sse streams last at most 20 s. A path template from this document requested literally, braces intact (e.g. /sse/{flavor}), answers 200 with the valid substitutions for its placeholder — any method except OPTIONS, which answers 204 with Allow as everywhere.',
    },
    'x-agentcash-guidance': { llmsTxtUrl: `${origin}/llms.txt` },
    servers: [{ url: origin }],
    paths,
  };
}

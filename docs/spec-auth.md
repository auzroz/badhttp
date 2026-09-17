# Spec: /auth — HTTP authentication that misbehaves on purpose (v0.9.0)

Status: v2, after the 5-lens adversarial review (70 findings) + open-question research.
Primary sources: RFC 9110 §11 + §15.5.2 (framework, 401/407), RFC 7617 (Basic), RFC 7616 (Digest),
RFC 6750 (Bearer). Every RFC claim below was verified against the RFC text by the review.

## Why this family

Every HTTP client, SDK and agent framework carries auth code: challenge parsing, credential encoding,
retry-on-401 logic, Digest computation, Bearer error handling. The failure modes are classic
(infinite 401 retry loops, comma-in-realm parser breakage, charset confusion, treating 403 like 401,
trusting presence over validity, body replay on the authenticated retry). httpbin's auth endpoints
behave *correctly*; no public misbehaving-auth server exists. Fully stateless: the client's credential
and retry state is the state under test.

## Safety invariants (family-wide, non-negotiable)

- Test credentials are **public, documented, obviously fake**: user `agent`, password `correct`
  (Basic/Digest); Bearer tokens `badhttp-token-ok`, `badhttp-token-limited`; utf8 flavor password
  `sésame`. The canonical warning, one constant reused verbatim on every surface AND in-band as a
  `warning` field in every /auth JSON body (challenge and success):
  "The test credentials are public and fake: user 'agent', password 'correct' (Bearer:
  badhttp-token-ok). Never send real credentials or point a production credential store at badhttp —
  nothing here is protected, and anything received is compared in memory, then discarded: never
  stored, logged, or echoed." The constant is verbatim in every /auth JSON body (the machine
  surface); the HTML home page and llms.txt carry equivalent wording integrated into their prose
  (resolution on the record — "verbatim on every surface" was the earlier draft's wording).
- **No-echo invariant:** no /auth response ever reflects any part of a received Authorization /
  Proxy-Authorization value — not on success, not on failure, not truncated. Success bodies name the
  scheme and the *documented* identity only; accept-any reports the scheme only when it names one the
  server knows (Basic/Bearer/Digest, canonical spelling), else "(unrecognized)" — a bare secret sent
  as the whole header value must not have its first token reflected as a "scheme". One RFC-sanctioned
  exception: Authentication-Info echoes the client's cnonce and nc because RFC 7616 §3.5 requires it
  (protocol nonces, not credentials; quotes re-escaped so a hostile cnonce cannot break the header).
  (/headers still echoes headers generally; that is its documented job and predates this family.)
- **No-body invariant:** /auth handlers never read a request body, any method. (Form-login-shaped
  agents put real credentials in bodies; ours are never consumed.)
- **Never emit `Negotiate` or `NTLM`** as scheme names anywhere — SSPI-enabled clients would answer
  with real handshake material. The unknown-scheme and token68 flavors use invented names.
- Realm strings always start with `badhttp` and are fixed constants (never request-influenced).
- accept-any (the flavor that rewards leakage) reports `scheme` only, `checked:false`, carries an
  `x-badhttp-warning` header (site precedent: /redirect/loop) and body text naming the hazard:
  "if you saw authenticated:true here without configuring the documented test credentials, your
  client just leaked ambient credentials to a server that accepts anything — treat them as exposed."
- Retention wording is a POLICY claim, not wire-verifiable: word it as policy ("Workers invocation
  logs are off; the Worker stores nothing") and re-verify the observability config at deploy.
- MD5 disclaimer one-liner where digest is documented (MD5 here is interop testing, not endorsement).

## Stateless Digest design

- `nonce = btoa("badhttp:" + generation + ":" + floor(unixSeconds/300))` — 5-minute bucket; current
  and previous bucket accepted (nonce good 5–10 min). Plain btoa (base64url buys nothing inside a
  quoted-string). The bucket scheme contradicts RFC 7616's per-request-uniqueness ADVICE; the flavor
  about says so honestly (nothing is protected; replay is a non-issue here).
- Expired-but-otherwise-valid response → `401` with `stale=true` + fresh nonce. RFC 7616 §3.3 says
  the client "may wish to simply retry" without re-prompting — descriptive, no client MUST/SHOULD;
  the normative sentence binds the SERVER (only set stale=true when the nonce was invalid but the
  hash was valid), which is exactly what the validation order satisfies. Page wording stays soft.
- `opaque="badhttp-opaque"` fixed; echoing it is SHOULD (RFC 7616 §3.3, not MUST) — validated if
  present (badhttp strictness, never called a client violation), absence alone never fails a request.
- Validation: username, realm, uri, nonce window, response hash; when qop=auth: cnonce and nc are
  REQUIRED (RFC 7616 §3.4: each carries "This parameter MUST be used by all implementations");
  nc must be exactly 8 hex digits; legacy no-qop (RFC 2069-style) responses → 400 with a JSON body
  naming the defect, documented on the flavor. nc replay is undetectable statelessly; the about says so.
- **uri= validation (RFC 7616 §3.4.6):** exact string compare against the request-target as received
  (url.pathname + url.search), with the absolute-URI spelling of the same resource also accepted;
  mismatch → **400** (§3.4.6 SHOULD) with a diagnostic body of { uri_param_length, request_target }
  — NOT the uri= string itself: it is a fragment of the received Authorization value, so the no-echo
  invariant forbids reflecting it (resolution on the record; an earlier draft said both strings).
  Note: the Worker sees url.pathname post-normalization; harmless here (fixed ASCII paths).
- **Parser tolerance for real witnesses:** accept both quoting conventions (urllib quotes algorithm,
  leaves qop unquoted; curl differs) — a strict-quoting parser would falsely fail the main witness.
- **Authentication-Info on success (digest + digest-sha256):** included, MUST-complete per RFC 7616
  §3.5: rspauth + cnonce + nc (all three MUST when qop=auth) + qop echo; rspauth's A2 drops the
  method (A2 = ":" request-uri); rspauth/cnonce quoted, qop/nc unquoted. `nextnonce` deliberately
  omitted (it would entangle the bucket scheme and mask stale) — documented. Verified by wire capture
  + independent recomputation in smoke, NOT by client silence: no available client checks rspauth
  (curl/urllib/requests source all confirmed indifferent). No client-behavior claims until witnessed.
- MD5 via crypto.subtle.digest('MD5', …) — probed, works in workerd.
- Digest A2 uses the ACTUAL request method (a POST digest dance exercises Method-in-A2 — a
  conformance surface GET cannot test).

## Methods

**Every method is allowed on /auth/{flavor} and treated identically** (method echoed in the JSON,
digest A2 uses it; body never read). Decision on the record: the abuse lens preferred 405-on-POST to
keep credential-shaped bodies unconsumed; resolved by the stronger no-body invariant (allowed but
never read), which buys the family's single most valuable client test — body replay on the
authenticated retry (curl --anyauth's bodyless probe, curl --digest -d's leg-two re-send). Router
OPTIONS Allow for /auth widens to every method; /auth index also answers any method with the index
JSON (like template URLs). HEAD = GET without body (runtime strips it; smoke pins it).

## Platform probes — DONE (local workerd, 2026-08-27); edge re-verified post-deploy

1. MD5 in crypto.subtle: works.
2. Appended WWW-Authenticate headers are coalesced into ONE comma-joined header → multi-header
   flavor impossible; `multi` (one header, two challenges) is what the platform emits either way.
3. Comma-inside-quoted-string survives workerd verbatim; edge passage re-verified post-deploy.
4. Inbound Authorization/Proxy-Authorization reach the Worker untouched (local; edge live-check owed).
5. No Cloudflare auth interception on this zone (no Access; verify live).
6. Empty header value silently dropped → no `empty` flavor.
7. **atob of client-controlled input THROWS** — every decode wrapped in try/catch or it becomes a
   500 {bug:true}. (The undefined-vs-null trap's cousin; fourth sighting of "client input crashes
   the handler" class.)

## CORS note (NO change — the review's live test settled it)

The Fetch spec says the ACAH `*` wildcard excludes `Authorization`, but no shipping browser
enforces that (MDN compat data: Chrome/Safari never shipped it, Firefox only behind a pref) — and
the review verified it LIVE against production: a Chrome 151 cross-origin fetch with an
Authorization header preflighted 204 and reached the Worker. BASE_HEADERS stays byte-identical.
ACAO:* remains load-bearing: credentialed browser requests are impossible, page JS can only send an
Authorization it built itself, and Proxy-Authorization is a Fetch forbidden header regardless.
Browser-dialog claims stay off the page unless witnessed.

## Endpoints

`GET /auth` — JSON index (flavors, credentials, the warning, usage). Any method answers it.
`ANY /auth/{flavor}` — the flavor. Unknown flavor → 404 + list. Extra path segments → 404.
No query parameters in this family (digest uri= compare includes any query sent, so none documented).

Success body: `{ authenticated: true, flavor, scheme, user: "agent" | token: "badhttp-token-ok",
method, note, warning }` (stable keys; identity fields name the DOCUMENTED credential, never derived
from the request; digest adds `algorithm`; utf8 adds `encoding`; accept-any differs — see flavor).
Challenge body (401/407): `{ error: "unauthorized", flavor, hint: "<which documented credentials to
send>", credentials: { user, password } | { token }, warning }` — machine-readable creds in-band.
Every /auth/{flavor} success, challenge, 400 and 403 carries `x-badhttp-flavor`; the 404s keep the
sibling families' plain shape (no flavor header), like /etag's.

## Flavors (18)

Controls:
1. **basic** — RFC 7617 done right. No creds → 401 `WWW-Authenticate: Basic realm="badhttp",
   charset="UTF-8"`. `agent:correct` → 200. Wrong-but-decodable creds → 401 + fresh challenge
   (RFC 9110 §11.4 SHOULD — the governing text; §11.6.2 has no such guidance, an earlier draft of
   this spec miscited it). Undecodable value (bad base64, no colon after decode) → 401 + challenge
   with a body naming the exact defect (§11.4's "invalid or partial credentials"; the BODY teaches
   the decode failure — review resolved A this way: RFC-correct status, teaching body).
2. **bearer** — RFC 6750 done right. No credentials (or a non-Bearer scheme) → 401
   `Bearer realm="badhttp"` with NO error param (6750: SHOULD NOT include error when none presented).
   `badhttp-token-ok` → 200. Unknown token → 401 `error="invalid_token"` + description.
   Not token68-shaped → 400 `error="invalid_request"`. `badhttp-token-limited` → **403 carrying
   `WWW-Authenticate: Bearer realm="badhttp", error="insufficient_scope", scope="badhttp:full"`**
   (6750 puts the challenge ON the 403 — unlike flavor `forbidden`, and that contrast is the lesson).
3. **digest** — RFC 7616, algorithm=MD5, qop="auth", full validation + Authentication-Info as above.
4. **digest-sha256** — same, algorithm=SHA-256. (urllib raises ValueError on it — a documented,
   version-stamped observation once witnessed; curl and requests speak it.)

Misbehaviors:
5. **none** — 401, JSON body, NO WWW-Authenticate at all (violates §15.5.2's MUST; rampant in real
   APIs). Valid preemptive `agent:correct` Basic → 200: the flavor is the PREEMPTIVE-AUTH witness —
   only a client that sends credentials unprompted can ever succeed here.
6. **bare-scheme** — `WWW-Authenticate: Basic` alone (RFC 7617 requires realm). Accepts agent:correct.
7. **unknown-scheme** — `WWW-Authenticate: X-Badhttp-Frobnicate realm="badhttp", hint="no client
   speaks this"`. Always 401. Clean failure test.
8. **token68** — `WWW-Authenticate: X-Badhttp-Opaque dG9rZW42OA==, Basic realm="badhttp"` — a
   token68-form challenge FIRST in the list (legal per RFC 9110 ABNF, breaks comma-naive parsers
   harder than `multi`; invented scheme name per the Negotiate ban). Valid Basic creds → 200.
9. **multi** — ONE header, two challenges: `Digest realm="badhttp", nonce="…", qop="auth",
   algorithm=MD5, opaque="badhttp-opaque", Basic realm="badhttp"`. Accepts EITHER valid Basic or
   valid Digest; body says which the server matched. Digest-first deliberately flouts RFC 9110
   §11.3's note advising well-supported schemes (Basic) first; §11.4 puts scheme choice on the
   client; §11.6.1's own warning — "more than one member on the same field line might not be
   interoperable" — is this flavor's charter. No order-equals-preference claim anywhere (a review
   caught that misattribution; the only such MUST is RFC 7616 §3.7, among multiple Digest challenges).
10. **case** — `bASIc rEALM="badhttp"` (scheme names and param names are case-insensitive,
    RFC 9110 §11.1/§11.2 — verified). Accepts correct Basic creds.
11. **quoted** — `Basic realm="badhttp says \"hello\", agent", charset="UTF-8"` — escaped quotes AND
    a comma inside the quoted string, still badhttp-prefixed (the one place a browser may display
    it). Accepts correct creds.
12. **utf8** — `Basic realm="badhttp-utf8", charset="UTF-8"`, creds `agent` / `sésame`. Accepts BOTH
    the UTF-8 and Latin-1 encodings, byte-level decode (raw atob string = Latin-1 reading;
    TextDecoder('utf-8', {fatal:true}) = UTF-8 reading; NFC-normalize before compare per RFC 7617
    §2.1), and reports `encoding: "utf-8" | "latin1"` — a witness instrument, not a gate (charset is
    "purely advisory" per §2.1; a Latin-1 sender violates nothing).
13. **always-401** — perfect Basic challenge; every request 401, even agent:correct;
    `x-badhttp-warning: correct credentials are also rejected here`. The retry-loop trap. Client
    stop-behavior claims are per-client observations, recorded only after witnessing.
14. **accept-any** — no Authorization → 401 challenge; ANY Authorization value → 200
    `{ authenticated: true, checked: false, scheme, warning… }` + x-badhttp-warning header.
    Presence-not-validity, the real middleware bug. Safety framing per the invariants.
15. **forbidden** — no creds → 401 + Basic challenge; valid agent:correct → **403 with NO
    WWW-Authenticate** (authenticated ≠ authorized; RFC 9110: credentials "are not sufficient" —
    a client SHOULD NOT auto-retry). Contrast with bearer's 403 is deliberate and documented.
16. **stale** — Digest stale dance, MD5. g1 nonce in the first challenge; VALID digest over g1 →
    401 `stale=true` + g2 nonce; valid over g2 → 200. WRONG password at any generation → plain 401,
    no stale (RFC 7616: stale=true implies the credentials were right). Terminates: challenge →
    stale → 200 in three legs for a correct client.
17. **proxy** — origin demanding proxy auth: 407 + `Proxy-Authenticate: Basic realm="badhttp-proxy"`.
    Valid Proxy-Authorization agent:correct → 200. Clients auto-answering 407s hold REAL proxy
    credentials — the challenge body's hint says "only the documented fake credentials; a client that
    answered this automatically just revealed it would leak its proxy credentials to any origin."
    Refusal claims per-client, witnessed only.
18. **redirect** — 302 to `/auth/basic` (same origin, Location relative). Does the client that was
    about to authenticate re-send Authorization after the hop? Same-host redirect credential
    retention is the observable (the cross-host variant is the CVE class; one host, so this is the
    honest subset we can test — documented as such).

Dropped, on the record: multi-header (platform), empty (platform), negotiate (charter/SSPI),
huge-realm (/cookies/huge covers big headers), moving-target/challenge-changes-on-retry (optional,
low marginal value over always-401 + stale), empty-password Basic (deferred: `agent:` with empty
password — cheap but 18 flavors is already the largest family; revisit with witness data).

## Surfaces

- Home: "Authentication" section + table + canonical warning + agent-framework sentence ("Do not
  configure real credential stores or ambient credentials for badhttp.dev…"). Browser notes limited
  to what is witnessed.
- /openapi.json: `/auth`, `/auth/{flavor}`; `security: []` everywhere; **NO securitySchemes** (a
  non-empty security requirement is the one signal a registry parser could read as "requires real
  auth" — judges' view, settled); never a 402 from /auth.
- /llms.txt: family line + credentials + warning sentence.
- template.js: FAMILIES gains 'auth' + switch case (or the ~600/day ghost-404 pattern returns).
- Router: `case 'auth'` (awaited — handler is async for crypto.subtle), OPTIONS Allow for /auth =
  every method, robots `Disallow: /auth/`, sitemap `/auth`, README.
- x402scan re-register + IndexNow + @agentcash/discovery lint post-deploy.

## Smoke checks (~24, sequential; keep the suite's existing pacing — sequential is not automatically
burst-free at 100 req/10 s, so spot-check suite timing after adding)

index 200 (GET + POST); unknown flavor 404; template /auth/{flavor} → 200 explainer.
basic: no creds → 401 + exact challenge; agent:correct → 200; wrong → 401 rechallenge; bad base64 →
401 body names decode failure. bearer: ok-token → 200; bad → invalid_token; limited → 403 WITH
challenge; garbage → 400 invalid_request. digest: curl --digest → 200; Authentication-Info present +
rspauth recomputed independently (node script). digest-sha256: curl --digest → 200.
stale: scripted two-leg dance (curl handles stale automatically per its source — verify live, else
the node script does the legs). none: 401, header ABSENT; preemptive -u → 200. multi: both schemes in
one header; Basic → 200; Digest → 200. token68: challenge intact through the edge; Basic → 200.
case/quoted: challenge byte-exact through the edge; creds → 200. utf8: curl UTF-8 → 200 encoding
utf-8; crafted printf Latin-1 header → 200 encoding latin1. always-401: creds → 401.
accept-any: garbage → 200 checked:false. forbidden: creds → 403, header absent. proxy: 407 +
Proxy-Authenticate; crafted Proxy-Authorization → 200. redirect: 302 Location /auth/basic.
POST /auth/digest with -d → 200 method POST (body replay + A2-method in one check). HEAD basic → 401
challenge, empty body.

## Live witnesses (post-deploy, page-documented, version-stamped)

- curl 8.7.1: --basic, --digest (MD5 + SHA-256), --anyauth, --oauth2-bearer, -u UTF-8, --location
  on redirect, the 407 (curl only answers proxy auth via --proxy-user through a real proxy — direct
  origin 407 behavior is the observation).
- Python 3.14 urllib: Basic + Digest MD5 (SHA-256 → ValueError, stamped); multi parsing; stale;
  none; preemptive behavior (urllib only sends after a challenge — or does it? witness).
- Python requests 2.34.2 (scratch venv): HTTPBasicAuth, HTTPDigestAuth (MD5 + SHA-256), Latin-1
  Basic encoding (its known divergence from curl/urllib — the utf8 flavor's best witness).
- Node 25 fetch: manual headers (bearer, preemptive basic, accept-any).
- Record per client: loop-or-stop on always-401 (bounded by the zone rate limit — note it), multi
  choice, stale handling, redirect re-send, 403 handling, encoding sent. Claims stamped with
  versions; nothing predicted, only observed.

# Spec: `/cookies` — Set-Cookie edge cases (v0.6.0)

Written session 6 (2026-08-23), before implementation. The reviewed spec is the contract; the code is
the reference once it ships. Family pattern follows `/sse`, `/range`, `/etag`: an index at `/cookies`,
flavors at `/cookies/{flavor}`, GET/HEAD only, stateless, no outbound requests.

## Why cookies

Every scraper, SDK and agent framework runs a cookie engine; the rules (RFC 6265, and the 6265bis
revision) are famously mis-implemented: comma-folding, duplicate names, path-matching, the cookie-date
algorithm, `__Host-`/`__Secure-` prefixes, Max-Age/Expires precedence, the 4096-byte floor. httpbin's
`/cookies` is well-behaved; no public *misbehaving* cookie server exists. The server stays stateless —
the state under test is the **client's jar**.

## Design

Two halves:

- **Setters** (`/cookies/{flavor}`): each response carries one or more `Set-Cookie` headers of the
  chosen shape. The JSON body is self-documenting: `{flavor, set: [every Set-Cookie value on this
  response], expect: "<one sentence: what a correct client does>", received: {cookie_header,
  cookies}}` — so hitting the same flavor twice with a jar shows the round trip in the body.
- **The readback** (`/cookies/echo`): sets nothing; returns exactly what the request's `Cookie`
  header carried: `{cookie_header: <string|null>, cookie_header_base64: <base64 of the raw bytes,
  for values JSON mangles>, cookies: [[name, value], …] (ordered pairs, duplicates preserved —
  never an object, order and duplicates are test subjects), count}`.

Parsing for `received`/`echo` is the server-side split of RFC 6265 §4.2 (split on `;`, trim OWS,
name = up to first `=`, value = the rest; no `=` → `["", whole]`). Raw header always included, so
our parse can be checked against the bytes.

Politeness rules (published in the index):
- Every cookie name starts with `badhttp_` (or `__Host-badhttp_`/`__Secure-badhttp_`).
- No `Max-Age`/`Expires` beyond 3600 s except where the long date *is* the test (`far-future`).
- Cookies are scoped `Path=/cookies` wherever the test allows, so they do not ride along to the
  rest of the catalogue. Exceptions are the tests themselves (`prefixes` needs `Path=/`).
- `/cookies/delete` expires the sticky ones.
- Values are fixed strings, never derived from the request: nothing to reflect, nothing stored.

## Flavors

| flavor | Set-Cookie sent | what a correct client does |
|---|---|---|
| `ok` | `badhttp_ok=1; Path=/cookies; Max-Age=3600; SameSite=Lax` | The control. Stores it, returns it to `/cookies/*` for an hour. |
| `echo` | *(none)* | The readback: raw `Cookie` header + ordered parsed pairs. |
| `folded` | ONE header: `badhttp_folded_a=1, badhttp_folded_b=2; Path=/cookies; Max-Age=3600` | RFC 6265 forbids folding Set-Cookie; the parse algorithm yields ONE cookie `badhttp_folded_a` with value `1, badhttp_folded_b=2`. A comma-splitting client invents a second cookie. |
| `many` | `?count=` (1–20, default 10) separate headers `badhttp_many_01=1; Path=/cookies; Max-Age=3600` … zero-padded | Stores all of them, returns all, original order preserved per §5.4 (equal path length → creation order). |
| `duplicate` | `badhttp_dup=deep; Path=/cookies/echo; Max-Age=3600` + `badhttp_dup=shallow; Path=/cookies; Max-Age=3600` | Two distinct cookies (same name, different paths). At `/cookies/echo` both are sent, longer path first: `badhttp_dup=deep; badhttp_dup=shallow`. Clients that key jars on name alone lose one. |
| `on-redirect` | `badhttp_redirect=1; Path=/cookies; Max-Age=3600` on a **302** whose `Location` is `/cookies/echo` | Captures the cookie from the 302 and presents it on the follow-up. Historic bug class: clients that ignore Set-Cookie on redirects. One-shot: `curl -L -c jar -b jar`. |
| `delete` | `badhttp_ok=gone; Path=/cookies; Expires=Thu, 01 Jan 1970 00:00:00 GMT` + `badhttp_far_future=gone; Path=/cookies; Max-Age=0` | Removes both cookies (name+domain+path match). Tests both deletion idioms. |
| `conflicting-expiry` | `badhttp_conflict=alive; Path=/cookies; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600` | Max-Age wins over Expires (§5.2.2 MUST): the cookie LIVES for an hour. A client honoring Expires deletes it instantly. |
| `bad-expires` | `badhttp_bad_expires=1; Path=/cookies; Expires=2027-08-23T12:00:00Z` | The cookie-date algorithm (§5.1.1) finds no month token in ISO 8601 → Expires ignored → **session cookie**. A lenient date parser mints a 2027 expiry; a client that discards cookies with unparseable Expires loses it entirely. |
| `far-future` | `badhttp_far_future=1; Path=/cookies; Expires=<9999-01-01, IMF-fixdate via toUTCString>` | 6265bis caps lifetime at 400 days: a current client clamps, an older jar keeps the 9999 date. Deleted by `/cookies/delete`. |
| `wrong-domain` | `badhttp_wrong_domain=reject-me; Domain=example.com; Path=/; Max-Age=3600` | REJECTS the whole cookie (Domain does not domain-match the request host). Jar-observable only: it must simply never appear anywhere. |
| `public-suffix` | `badhttp_supercookie=reject-me; Domain=dev; Path=/; Max-Age=3600` | REJECTS it (`dev` is a public suffix; a supercookie). A jar without a public-suffix list may store it scoped to `.dev` — and would then send it back to us, so `/cookies/echo` CAN reveal this failure. |
| `path-prefix` | `badhttp_path_prefix=1; Path=/cookie; Max-Age=3600` | Stores it, but NEVER sends it to `/cookies/*`: path-match (§5.1.4) requires the prefix to end at a `/` boundary, and `/cookie` + `s` fails that. A naive prefix-matcher sends it to `/cookies/echo` — the tell. |
| `prefixes` | 4 headers: `__Host-badhttp_good=1; Path=/; Secure; Max-Age=3600` (valid) · `__Host-badhttp_bad=1; Path=/cookies; Secure; Max-Age=3600` (invalid: Path must be `/`) · `__Secure-badhttp_good=1; Path=/cookies; Secure; Max-Age=3600` (valid) · `__Secure-badhttp_bad=1; Path=/cookies; Max-Age=3600` (invalid: no Secure) | Stores the two `_good`, rejects the two `_bad`. Meaningful over HTTPS only (production; `.dev` is HSTS-preloaded). |
| `quoted` | `badhttp_quoted="hello world"; Path=/cookies; Max-Age=3600` + `badhttp_semi="semi;colon"; Path=/cookies; Max-Age=3600` | §5.2 splits on `;` before anything else: `badhttp_semi` stores as `"semi` (quote open, no close). `badhttp_quoted` stores with quotes and a space. What comes back — quotes kept, stripped, re-added? |
| `utf8` | `badhttp_utf8=<raw bytes E2 98 83 (☃)>; Path=/cookies; Max-Age=3600` | Bytes outside the cookie-octet grammar. Jars differ: store raw, percent-encode, or drop. `echo`'s base64 field shows exactly what came back. **Platform-permitting: verify the workerd Headers class and the Cloudflare edge pass the bytes through; if either mangles them, drop the flavor (design rule: only verified behaviour ships).** |
| `nameless` | `badhttp-just-a-value` (no `=` anywhere) + `=badhttp_empty_name; Path=/cookies; Max-Age=3600` | RFC 6265 §5.2 IGNORES a set-cookie-string with no `=`; 6265bis stores it as a nameless cookie (sent back as just the value). Real divergence between generations of jars. |
| `huge` | `badhttp_huge=xxx…; Path=/cookies; Max-Age=3600` where `?bytes=` (64–8192, default 4096) is the size of `name=value` | 4096 must be accepted (§6.1 floor: 4096 bytes per cookie); 4097 may be dropped. The round trip through `echo` tells you your client's cap. |

## Caps and safety

- `count` ≤ 20, `bytes` ≤ 8192 (well under the edge's response-header limits — verify live).
- No parameter is ever reflected into a cookie value. All values are constants (or `x`-fill for `huge`).
- `cache-control: no-store` (the family must never be cached; also the BASE default).
- New robots line: `Disallow: /cookies/` (index `/cookies` stays crawlable, like the siblings).
- HEAD mirrors GET's status and headers (Set-Cookie included — correct server behaviour) with no body.
- Unknown flavor → 404 with the list; other methods → 405 `Allow: GET, HEAD, OPTIONS`; `seg.length > 2` → 404.

## Verification plan (live, before the catalogue claims anything)

1. **Wire truth** (`curl --raw -v` over HTTP/1.1 against production): folded stays ONE header; `many`
   header order preserved; `utf8` bytes intact through the edge; `huge` at 8192 passes; no
   edge-injected Set-Cookie appears.
2. **curl 8.7 jar** (`-c`/`-b`): per-flavor jar contents + echo round trip.
3. **Python 3 http.cookiejar** (stdlib, urllib opener): the classic quirky parser.
4. **tough-cookie** (npm, the reference JS jar): store semantics per flavor.
5. Every claim in the `expect` column that a real client contradicts gets rewritten to what was
   actually observed (the `/sse` and `/range` precedent: dated, named client, on the page).

## Platform probe (answered locally, session 6, before implementation)

A scratch worker under `wrangler dev --local` established: (1) a folded Set-Cookie with a comma
survives as ONE header; (2) workerd's `Headers` is **not** ByteString-strict — it accepts any JS
string (even code points above 0xFF, no throw) and **UTF-8-encodes it onto the wire** (`â`
became `c3 a2`, not `e2`), so the `utf8` flavor must set the literal `☃` (U+2603) to emit the raw
bytes `e2 98 83`; (3) eight Set-Cookie headers are delivered distinct and in order; (4) an 8 KB
value passes locally. The production edge still needs the same checks live before the catalogue
claims anything.

## Post-review amendments (session 6; 5-lens adversarial review, 35 findings, ~28 confirmed)

The reviewed spec above is kept as written; the code implements these confirmed amendments:

- **`delete` is table-driven and complete**: one expiring Set-Cookie for every name the family can
  plant (44 headers), each with the exact Path/Domain/prefix attributes required to match — §5.3
  removes only on name+domain+path, and a `__Host-` deletion must itself satisfy the prefix rules.
- **New `domain` flavor** (19 total): `Domain=.<host>` vs `Domain=<host>` — §5.2.3 strips the
  leading dot; the positive-Domain case no flavor covered.
- **`prefixes` renamed `name-prefixes`** (collided with `path-prefix`); bis-only, cited as such —
  an RFC-6265-only jar conformantly stores all four.
- **`huge` `?bytes` = name+value** (the measure bis §5.6 step 5 caps with a MUST at 4096);
  RFC 6265 §6.1 is only a SHOULD floor measured including attributes.
- **`nameless` second cookie moved to Path=/cookies/echo** so both survive a bis jar (they
  collapsed: same empty name, same default path); ignored by RFC 6265 via §5.2 steps 2 AND 5.
- **Echo readback capped at 16 KB** (`cookie_header_truncated`) — the family's one reflection;
  base64 redefined honestly as the UTF-8 re-encoding of what the runtime delivered (invalid bytes
  arrive as U+FFFD; multiple Cookie lines arrive joined with "; " upstream of the Worker).
- **`wrong-domain`/`public-suffix` Max-Age cut to 300 s** (their lifetime is spent, if anywhere,
  in broken jars talking to other hosts); public-suffix expect rewritten — single-label Domains
  also trip the pre-PSL no-embedded-dot heuristic, so the two guards are indistinguishable here.
- **SameSite=Lax dropped from the control** (inert for every named instrument).
- **Citations fixed**: Max-Age-over-Expires is §5.3 step 3 (+§4.1.2.2), not §5.2.2; folding is
  forbidden by bis §3 (RFC 6265 had SHOULD NOT); §5.4 ordering is a SHOULD (qualified in
  many/duplicate); far-future's clamp is bis §5.5 SHOULD (curl's cap shipped in 8.12 — 8.7 keeps
  the 9999 date; do not claim "current clients clamp" without a witness); the bis is pinned as
  draft-ietf-httpbis-rfc6265bis-22 until the RFC number lands.
- **Smoke additions**: a 400 carries no Set-Cookie; the Set-Cookie lines on /cookies/ok are
  exactly the badhttp ones (zone invariant: no Cloudflare bot products may inject __cf_bm here).
- **Acceptance gate for verification**: a flavor's expect ships when ONE named observable from ONE
  named client confirms it; the full 3-client matrix upgrades the page's dated notes.

## Open questions for review

- Does the Cloudflare edge pass multiple/folded/non-ASCII/8 KB Set-Cookie headers unmodified?
- Is `SameSite=Lax` on the control right, or noise for non-browser clients?
- Should `far-future` use year 9999 or a date just over 400 days (sharper test of the cap)?
- Any flavor here that cannot be observed with at least one of: echo round trip, jar file, wire bytes?

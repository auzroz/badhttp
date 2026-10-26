# `/cookies` witness capture — the fourth `/clients.jsonl` family

Session 26, 2026-09-30. Target: v0.20.0. Pattern: `scripts/auth-witness/` (session 25) and
`docs/spec-clients.md`.

## Why

The home page has carried, since v0.6.0 (2026-08-24), a hand-typed three-jar note about `/cookies`
with verdict words in it ("matches the table exactly", "correctly wins"), citing versions that have
since moved (curl's 400-day clamp, tough-cookie 6.0.2), and nothing has re-tested a sentence of it
in five weeks. The other three witnessed families render their home-page note from the rows. This
family does the same: the note becomes `cookieFindings()`, computed from `/clients.jsonl`.

## What is measured

The state under test is the client's **jar**. For each (client, flavor), with a **fresh jar**:

1. `GET /cookies/{flavor}` — the setter (redirects followed; only `on-redirect` redirects).
2. `GET /cookies/echo` — what the jar sent back to `/cookies/echo`.
3. `GET /cookies/delete` — the cleanup.
4. `GET /cookies/echo` — what survived the cleanup.

Seventeen setter flavors, in this order (`echo` and `delete` are steps, not rows):
`ok, folded, many, duplicate, on-redirect, conflicting-expiry, bad-expires, far-future, wrong-domain, public-suffix, domain, path-prefix, name-prefixes, quoted, utf8, nameless, huge`.
Default parameters only (`many` = 10 cookies, `huge` = 4096 bytes).

Eight clients, the same roster as `/auth`:

| id | jar | `jar_kind` |
|---|---|---|
| `curl` | `-c jar -b jar`, a fresh Netscape file per flavor | `own-jar` |
| `go-nethttp` | `net/http/cookiejar` with `golang.org/x/net/publicsuffix` (fall back to `nil` and SAY so in `jar`) | `own-jar` |
| `undici` | Node `fetch` transport, `tough-cookie` jar, the harness copies `Set-Cookie` → jar and jar → `Cookie` (fetch has no jar) | `harness-jar` |
| `urllib` | `HTTPCookieProcessor(http.cookiejar.CookieJar())` | `own-jar` |
| `requests` | `Session()` (RequestsCookieJar) | `own-jar` |
| `httpx` | `Client()` (`httpx.Cookies`) | `own-jar` |
| `urllib3` | none — `PoolManager` has no jar; echo is sent with no `Cookie` | `no-jar` |
| `aiohttp` | `ClientSession()` default `CookieJar()` | `own-jar` |

`jar_kind` names what the client HAS, never what happened. A `no-jar` row echoing nothing is a
capability, not a defect, and `reading_this` says so.

## Row shape (one NDJSON line per (client, flavor); line 1 of the file is provenance)

```
client, client_version, platform, invocation            as in the auth capture
flavor, url                                              the setter url
jar_kind        own-jar | harness-jar | no-jar
jar             one sentence naming the jar and its configuration
attempts        1..3 (a response without x-badhttp-version is the edge's 429: pause and retry the whole flavor)
hops            [{status, set_cookie_count}] per request the client sent during step 1 (redirect hops
                included); set_cookie_count = Set-Cookie headers the client's own API exposed on that
                response, or null where the client exposes none
setter_status   final status of step 1
setter_set      the `set` array from the setter body (null when the client followed a redirect and the
                302 body was not read)
echo            {status, cookie_header_bytes, cookies: [{name, value_bytes, value}], cookie_header_base64}
                cookies in the order the server parsed them, duplicates kept; value is the string when
                ≤ 48 bytes else null; cookie_header_base64 when the header is ≤ 256 bytes else null
after_delete    {status, names: [...]} — step 4's parsed cookie names (null for no-jar)
jar_enumerable  true when the client's jar can be listed from the harness
jar_entries     [{name, domain, path, host_only, secure, expires, value_bytes}] after step 1, or null;
                expires is an ISO-8601 instant (Python aiohttp's rows instead carry the Set-Cookie Expires string verbatim, an
                HTTP-date), "session", or null when the jar does not expose it (rendered as "expiry not exposed by the
                jar", never as a session cookie). value_bytes is the cookie value's length on the wire where the client
                exposes the wire bytes (urllib, requests re-encode as latin-1; aiohttp utf-8 with surrogateescape; tough-cookie
                latin-1); httpx exposes only the decoded string, so its value_bytes is that string's UTF-8 length. Each
                client's jar string names the basis. The next capture will carry aiohttp's expires as the jar's own ISO instant.
jar_rejections  [{message}] cookies the jar refused loudly (tough-cookie throws; others null/[])
version_header  the x-badhttp-version of the last badhttp response seen
client_error, error_kind (transport | raised), last_status_seen   as in the auth capture
```

Nothing in a row is a secret: every cookie value this family plants is a documented constant, and the
`Cookie` header the echo returns is the client's rendering of those constants. Even so, no row may
contain any string from the client's environment (a home path, a hostname other than badhttp.dev).

## `outcome` (assigned by the parser; a description, never a verdict)

Relative to the names the flavor plants (a fixed table in the parser, cross-checked against
`setter_set` wherever the body was read):

| value | meaning |
|---|---|
| `all-returned` | every planted name came back on step 2 |
| `some-returned` | at least one, not all |
| `none-returned` | none — which is the specified answer on `wrong-domain` and `path-prefix`, the recommended one on `public-suffix` (a jar with a public-suffix list; plain RFC 6265 without one would store it), and the finding elsewhere |
| `client-raised` | the client raised before returning a response |
| `request-failed` | transport failure |

`unplanted_names` lists any echoed name the flavor did not plant (a comma-splitting jar's
`badhttp_folded_b`; a legacy jar's `badhttp-just-a-value` as a NAME). `after_delete_remaining` counts
planted names still echoed after the cleanup. `distinct_answers` per flavor counts distinct
(echoed names + unplanted names) among jar clients only (`own-jar` and `harness-jar`).

## Pacing

Four requests per flavor, 17 flavors, eight clients in sequence, ≥ 150 ms between requests: well
under the zone's 100 per 10 s. Never while `scripts/smoke.sh` runs.

## Re-capture of 2026-10-26 (session 35)

The 2026-09-30 capture was replaced whole by a run against v0.27.0 (Worker deployment d8cb5e1e) on 2026-10-26, with the same eight
clients; what differs is aiohttp 3.14.3 → 3.14.5 and Go 1.27.0 → 1.27.3 with golang.org/x/net v0.61.0. Why: the committed rows predated
two harness changes made in session 28 that had never been run — `jar_entries[].value_bytes` is the cookie value's length on the wire
(the 2026-09-30 rows carried 6 for the three-byte ☃ on undici, urllib and requests, the UTF-8 length of the latin-1-decoded string; the
v0.23.0 and v0.26.0 reviews both named it), and aiohttp's `jar_entries[].expires` is the jar's own recorded expiry rather than the
`Set-Cookie` Expires text its Morsel exposes. The first run of this re-capture was discarded: aiohttp's `CookieJar.host_only_cookies`
is a frozenset of `(domain, path, name)` triples and the harness tested `(domain, name)` pairs, so every aiohttp cookie read as not
host-only; the check was corrected (`py-clients.py`) and the whole capture re-run. The urllib3 harness now counts hops on an `http://`
pool as well as `https://` (the capture is https-only, so no row depends on it). What moved against 2026-09-30, all computed from the
rows and visible in the `/cookies` witness block: aiohttp 3.14.4 changed `Set-Cookie` parsing to one cookie per header (its release
notes: "unrecognized attributes are ignored, per RFC 6265 §5.2"), so on `folded` it no longer splits on the comma and no client now
returns `badhttp_folded_b`; on `utf8` aiohttp now returns the value, wrapped in double quotes (bytes `22 e2 98 83 22`), where it
returned nothing before; the gated aiohttp clauses about Morsel expiry text (`conflicting-expiry`, `bad-expires`, `far-future`) dropped out of the findings
because their facts no longer hold. The urllib3 client's recorded invocation now carries `retries=Retry(total=10, redirect=6,
respect_retry_after_header=False)` (a session-26 harness change the old rows predated). The third run of the capture is the
published one: the second read aiohttp's Path=/ cookies as not host-only and without expiry, because aiohttp keys its
`_expirations` and `host_only_cookies` tables on `path.rstrip('/')`; the harness now tries both keys. Everything else is the same picture: the public-suffix cookie (`Domain=dev`) is still stored by aiohttp, Max-Age still
wins over a 1970 Expires everywhere, httpx still raises on `utf8`.

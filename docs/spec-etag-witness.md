# `/etag` witness capture — the seventh `/clients.jsonl` family

Session 32, 2026-10-12. Target: v0.25.0. Pattern: `scripts/range-witness/` (session 31) and
`docs/spec-range-witness.md`; same recorder, same parser discipline, same honesty boundary (`docs/spec-clients.md`).

## Why

`/etag` has documented since v0.5.0 (2026-08-23) ten ways a server's validators lie — an ETag that changes on every
response, conditionals ignored, a 304 to a request that was never conditional, a 304 carrying the wrong ETag or none,
an unquoted ETag, a Last-Modified that is not an HTTP-date, a Last-Modified in the future — over a fixed document served
`cache-control: no-cache, no-transform`, which RFC 9111 says a cache may store but MUST NOT reuse without a successful
validation. The flavors were written for HTTP caches: libraries that sit under an HTTP client and revalidate for it, the
command-line tools that keep an ETag or a timestamp between runs, and caching proxies. What the site has never published
is what real caches do with those responses: whether a cache revalidates at all under `no-cache`, which validator it
sends back and in what form (does it echo a weak tag with its `W/`, does it quote a bare one, does it reformat an ISO
date or drop it), what it hands its caller when the server answers 304 to a cold request, and whether a 304 carrying a
different ETag changes what it sends next. This family publishes rows.

RFC 9111 specifies the cache side in more detail than any other family's client side: §4.3.1 says what a cache sends to
validate (If-None-Match with the stored entity tags; If-Modified-Since with the Last-Modified value), §4.3.3 says what a
304 and a 200 mean to it, §4.3.4 says which stored responses a 304's validators select for update, §5.2.2.4 says a
`no-cache` response must be revalidated before reuse. But it defines a *cache*, and three of the roster's classes are not
caches in that sense (`curl --etag-compare`, `curl -z` and `wget -N` are clients with one saved validator); and it says
nothing about a 304 to a request that carried no conditional, an unparseable Last-Modified, or a bare ETag. So the rows are
described against a **reference** derived from the control's wire exchanges — what RFC 9111 implies a textbook cache would
have sent and shown its caller given what this server answered — and the word "verdict" stays banned: a cache that refetches
unconditionally under `no-cache` and one that revalidates are both allowed to; the finding is the difference.

## What is measured

**The scenario is three fetches of one URL through one cache.** For each (client, flavor): a fresh working directory,
a fresh cache (empty store, no state), and the client asked to fetch `GET /etag/{flavor}` **three times in a row**
through its cache — `cold` (fetch 1: nothing stored), `warm` (fetch 2: a stored response may exist), `warm-again`
(fetch 3: whatever fetch 2 left). The harness never sends a conditional header itself; the client decides, from what it
stored, whether to send `If-None-Match` and/or `If-Modified-Since`, with what value, and what to hand its caller.
Three fetches, not two, because `mismatch` only shows on the third: a 304 on fetch 2 carrying a different ETag than the
one sent is either adopted (fetch 3 sends the new tag and gets a 200 — the documented thrash) or not (fetch 3 sends the
old tag and gets 304 again).

So the grid is **10 cells per client** (ten flavors × one scenario, `three-fetches`). Every flavor's lie is triggered
by this scenario, because every flavor answers a warm conditional request differently from `ok` or answers the cold
request differently (`always-304`).

**Every request the client sent is recorded by a local recording reverse proxy** — `scripts/witness-recorder.mjs`,
the session-31 recorder moved up one directory so two families can share it (`scripts/range-witness/recorder.mjs`
stays as a one-line shim so the range rows' `requests_recorded_by` string remains true), extended to record the
request's `cache-control`, `pragma` and `if-unmodified-since` and the response's `cache-control`, `date`, `age`,
`vary` and `expires`. The client is pointed at a loopback `http://` URL whose path is the flavor's; the recorder
forwards each request verbatim to `https://badhttp.dev` over TLS (HTTP/1.1), returns the response verbatim (status,
every header, body bytes, Content-Length preserved) and writes one exchange record per request. No loopback literal
reaches a row (the parser refuses one). What this changes: the client speaks plain HTTP/1.1 to the recorder, so TLS,
ALPN and HTTP/2 behaviour are out of scope and the index says so; also the recorder is the client's *origin*, not a
proxy in the HTTP sense, so a caching proxy in the roster is configured with the recorder as its upstream and curl as
its user, and the exchanges are what the proxy sent upstream. What it does not change: the request line, every
conditional header the client chose to send, and every byte and header of the answer.

**Alignment of exchanges to fetches is exact, by construction.** A driver is a long-lived process that reads commands
on stdin: `FETCH <url>` performs one fetch through the cache and prints one `RESULT {json}` line; `QUIT` exits 0. The
orchestrator sends `FETCH`, waits for the `RESULT`, lets the recorder settle (300 ms), reads the recorder's exchange
file, and attributes every exchange that appeared since the previous `RESULT` to that fetch (`fetch_n` on the
exchange). A client that revalidates asynchronously after answering its caller is therefore visible as an exchange on
the *same* fetch only if it lands within the settle; otherwise it lands on the next fetch and the row says so
(`exchanges_after_result`). The CLI classes are driven the same way: the driver runs the tool once per `FETCH`, in a
working directory that keeps the tool's state file (`--etag-save` file, the downloaded file, wget's timestamped file).

Per exchange the recorder keeps: `n`, `method`, `path_query`, request headers of interest (`range`, `if_range`,
`if_match`, `if_none_match`, `if_modified_since`, `if_unmodified_since`, `cache_control_req`, `pragma`, `user_agent`;
null when absent), `status`, response headers (`content_range`, `content_length`, `accept_ranges`, `etag`,
`last_modified`, `cache_control`, `date`, `age`, `vary`, `expires`, `x_badhttp_flavor`, `x_badhttp_version`),
`body_bytes`, `body_sha256`, `ms`, `client_aborted`, `upstream_error`. The orchestrator adds `fetch_n` (1, 2, 3, or
null for an exchange that landed after `QUIT`).

Per fetch the driver's `RESULT` line reports what the **caller** received: `status` (the status the caller saw, or null if
the library raised), `bytes` and `sha256` of the body the caller received (for a CLI, the file on disk after the run; for
a 304 the tool left untouched, the file as it was), `error` (`{name, message}` scrubbed, or null), `library_says`
(whatever the library exposes about cache use — hishel's `from_cache` extension, requests-cache's `from_cache`,
nginx's `X-Cache-Status` — recorded as the library's claim, never used to compute an outcome), `exit` (CLI tools: the exit
code and the last stderr lines, scrubbed).

Per (client, flavor) the harness records: the three `RESULT`s under `fetches[]`, each with its attributed `exchanges[]`;
`wall_ms`; `attempts` (a row any of whose exchanges lacks `x-badhttp-version` is Cloudflare's rate limit, not an
observation: wait 12 s, wipe the directory and the cache, retry the whole cell; ≤ 3 attempts; a cell that never clears is
written `request_failed: true` with zero exchanges and no fetch results — an edge 429 is never recorded as an exchange);
`end` (`exited` | `harness-timeout`: a per-fetch cap of **20 s** and a per-cell cap of **60 s**, enforced on the driver's
process group; a cell that hits a cap keeps the fetches that completed, marks the fetch that was running `timed_out: true` with
`caller: null` and its exchanges kept, and the rest `not-run`). Two scrubs the orchestrator applies before a row is written, stated
here because they change a recorded value: a URL in a client's `user_agent` that is not badhttp.dev (make-fetch-happen and got
name npm.im and github.com there) is replaced by `<url>`, and a loopback origin never reaches a row. The recorder forwards over
plain HTTP when its base is `http://` — for dry runs against the local stand-in only; a published capture's base is
`https://badhttp.dev` and the parser refuses any other.

**Pacing.** One client at a time, flavors in order, 1 s between cells, 3 s between clients, never while
`scripts/smoke.sh` runs. Three to six requests per cell against a limit of 100 per 10 s: no pacing inside a cell.

**The controls.** curl, client id `curl-raw`, role `control`, class `raw`, one exchange per control row, all through the
same recorder:
- `cold-raw` per flavor (id `etag.<flavor>.cold-raw.curl-raw`): `curl -sS --http1.1 -D - -o body` with no conditional
  header. Its body is the flavor's **document** (every flavor's body is a fixed text; the parser hashes it and the
  `cold-raw` row carries `raw_sha256`, `raw_bytes`, `etag`, `last_modified`, `status`). For `always-304` the cold control
  is a 304 with an empty body and the document is undefined for that flavor (stated on the row).
- `revalidate-raw` per flavor (id `etag.<flavor>.revalidate-raw.curl-raw`): the textbook validation of RFC 9111 §4.3.1,
  sent 1 s after `cold-raw` — `If-None-Match: <the ETag cold-raw received, verbatim>` when one was received and
  `If-Modified-Since: <the Last-Modified cold-raw received, verbatim>` when one was received; neither header when neither
  was received (`changing` returns a different ETag each time, so its revalidate-raw is a request with the first ETag and
  the control shows what the server does with it: 200). The harness sends these two headers for the CONTROL ONLY; it
  never sends them for a client.
- `revalidate-adopted-raw` for `mismatch` only (id `etag.mismatch.revalidate-adopted-raw.curl-raw`): `If-None-Match` with
  the ETag the 304 of `revalidate-raw` carried, so the reference for a cache that adopts the mismatched tag is on the
  wire too (the server answers 200 and restores the real tag).

## Row shape (one NDJSON line per cell; line 1 of the file is provenance)

```
{ "family":"etag", "id":"etag.<flavor>.three-fetches.<client>", "corpus_id":"etag.<flavor>",
  "url":"https://badhttp.dev/etag/<flavor>", "method":"GET", "flavor":"<flavor>", "scenario":"three-fetches",
  "probed":"<iso>", "badhttp_version":"<from the first exchange>",
  "client": {"id","name","role":"client|control","class":"library-cache|cli-conditional|proxy-cache|raw","version","library","runtime","platform","invocation","configuration","requests_recorded_by"},
  "attempts": 1,
  "fetches": [
    {"n":1,"kind":"cold","caller":{"status":200,"bytes":307,"sha256":"...","error":null,"library_says":null,"exit":null},
     "exchanges":[{"n":1,"fetch_n":1,"method":"GET","if_none_match":null,"if_modified_since":null,"cache_control_req":null,"status":200,"etag":"\"e-badhttp-1\"","last_modified":"Sat, 01 Aug 2026 00:00:00 GMT","cache_control":"no-cache, no-transform","x_badhttp_flavor":"ok","x_badhttp_version":"0.24.0","body_bytes":307,"body_sha256":"...","ms":210}]},
    {"n":2,"kind":"warm", ...}, {"n":3,"kind":"warm-again", ...}
  ],
  "exchanges_after_result": 0, "end":"exited", "wall_ms": 1412,
  "control": {"raw_base64":"...","raw_bytes":307,"raw_sha256":"...","status":200,"etag":"...","last_modified":"...","curl_exit":0}   // control rows only (their one exchange sits in a top-level `exchanges` array, as in the range capture; raw_base64 is for the parser, never served); null on client rows
}
```
The parser adds `outcome`, `pattern`, per-fetch `description` and `wire`, `reference`, `outcome_vs_reference` and
`license: "CC0-1.0"`.

`client.configuration` is a fixed vocabulary of what the harness handed the client, chosen per client and never per flavor
(the #25 rule — rows name what was configured, never what happened): for a library cache, the storage and any option
that departs from the library's default (`"hishel CacheTransport, FileStorage, default controller"`); for a CLI tool, the
exact flags; for a proxy, the minimal configuration that points it at the recorder and enables its cache at all, with every
directive named — the proxy's defaults otherwise, and the committed config file is cited. Nothing in it may be chosen to
make a flavor come out one way.

## `wire` and `description` per fetch (assigned by the parser)

For each fetch, from its attributed exchanges:
- `requests`: how many requests went upstream for this fetch (0, 1, 2, …).
- `conditional`: of the first request — `none` (no If-None-Match and no If-Modified-Since), `etag` (If-None-Match only),
  `date` (If-Modified-Since only), `both`; `if-match` if an If-Match went out (recorded, unexpected).
- `etag_echo`: how the If-None-Match value relates to the most recent ETag the client received in a 200 (null when none sent):
  `verbatim` (same bytes), `weak-stripped` (received `W/"x"`, sent `"x"`), `weak-added`, `quotes-added` (received bare `x`, sent
  `"x"`), `quotes-removed`, `list` (a list that contains the received tag), `other` (sent a tag the client never received in a
  200 — the `mismatch` case when it adopted the 304's tag, curl's empty `""` on a cold fetch, a tag copied from an unconditional
  304 on `always-304` — with `etag_sent` and `etag_received` on the wire object). A validator sent when no 200 has carried one
  is `other` for a tag and `own-clock` for a valid HTTP-date (else `other`), never null, so those clients do not merge in the
  disagreement counts with the ones that sent nothing (amended 2026-10-12). `etag_held`, `date_held`, `etag_dropped` and
  `date_dropped` record a validator the client had received and did not send (Squid drops weak tags).
- `date_echo`: how the If-Modified-Since value relates to the most recent Last-Modified received (null when none sent):
  `verbatim`, `reformatted` (a valid HTTP-date for the same instant, different bytes), `own-clock` (a valid HTTP-date for a
  different instant, e.g. the response's Date, the file's mtime or now), `invalid-echoed` (the client sent back a value that is
  not an HTTP-date — bad-date's ISO string verbatim), `other`.
- `answered`: the status of the last request's response (200, 304, 412, …), or null when `requests` is 0.

`description` (what the CALLER got relative to the wire; descriptions, never verdicts):
- `document` — the caller received the flavor's document (bytes equal the cold control's body) and no error.
  Qualified by `via`: `fresh-200` (the fetch's last request was answered 200), `stored-after-304` (answered 304 and the caller
  still holds the document — a library filled it in from its store; a CLI tool left its file as it was and reported the 304,
  `caller_status` 304 on the description), `no-request` (no request went upstream: served from the store without
  revalidating), `stored-despite-200` (the server answered 200 with a body and the caller still holds the earlier document —
  the client discarded the new body; added 2026-10-12 after `curl -z` on bad-date did this; counts as `differs`; `stored(200)`
  in `pattern`; recognised from a reported status 304 or from the driver's optional `file_rewritten: false`, which is how
  `wget -N`'s "Server ignored If-Modified-Since" path is told apart).
- `empty-304` — the caller has no body in hand: a library handed back a 304 with no stored body, or a tool left no file.
- `other-body` — the caller received a 200 whose body is not the document (bytes and sha256 on the row).
- `other-status` — the caller received a status that is neither 200 nor 304 (Varnish answers a cold 304 from its backend with a
  503 of its own; added 2026-10-12); the status is on the description.
- `error` — the library raised or the tool exited non-zero; `error.name` on the row.
- `not-run` — a cap fired before this fetch.

`outcome` for the row is the `warm` fetch's `description` and `via` joined (`document/stored-after-304`,
`document/fresh-200`, `document/no-request`, `document/stored-despite-200`, `empty-304`, `other-body`, `other-status`, `error`), plus `harness-timeout` (only when the
`warm` fetch itself did not complete; a row whose cap fired at fetch 3 keeps its warm outcome and shows `not-run` in its
pattern) and `request-failed`. `pattern` is the three fetches as a compact string the eye can scan, every request written
as `<headers>→<status>`, e.g. `→200 | INM→304 stored | INM→304 stored` or `→200 | →200 | →200` (`→` with no header before it
is an unconditional request; `INM`, `IMS`, `INM+IMS` name what went out; `none` is no request; a fetch that made two
requests joins them with a comma; suffixes `stored`, `empty-304`, `other-body`, `error`, `not-run`).

`adopted_304_validator` (boolean, mismatch rows mainly): true when a fetch's If-None-Match carries a tag the client received
only in a 304, never in a 200.

## `reference` (per flavor, derived from the control exchanges — never typed)

What RFC 9111 implies a cache that stores the `cold-raw` response and validates it as §4.3.1 says would send and show on the
`warm` fetch, given what this server answered the `revalidate-raw` control:
- `revalidate-raw` answered **304** → reference `document/stored-after-304` (the stored response is reused, §4.3.3, §4.3.4),
  with the validator the cache would send next: unchanged (the 304's validators select no stored response, as on `mismatch`
  and `no-validator-304`) or the same (`ok`, `weak`, `unquoted`, `bad-date`, `future`).
- `revalidate-raw` answered **200** → reference `document/fresh-200` (`changing`, `ignore`).
- `cold-raw` is a **304** (`always-304`) → reference `undefined`: RFC 9110 §15.4.5 defines 304 only in response to a
  conditional request, and RFC 9111 §4.3.4 selects no stored response when none exists; the rows describe what each cache did.
- A client whose `warm` request carried `none` (no conditional) is `differs` from a 304 reference and `as-reference` for a
  200 reference only if it received the document — but the index says plainly that §5.2.2.4 forbids reuse without
  validation and does not forbid an unconditional refetch; `differs` is a description.
- `bad-date`: §4.3.1 says send "the Last-Modified value", and the value is not an HTTP-date; the server's exact-string
  compare rewards a verbatim echo. Reference `document/stored-after-304` **with the note that it rests on echoing an
  invalid value** (`reference.note`), so a client that dropped the unparseable date and refetched is `differs` but the row
  says why in the reference, not in a verdict.

`outcome_vs_reference`: `as-reference` | `differs` | `undefined` | null (harness-timeout, request-failed).

`disagreement_by_flavor` counts distinct `(outcome, conditional, etag_echo, date_echo)` answers among client rows per flavor;
control rows are excluded.

## What the rows cannot say, stated on the index

Anything over HTTPS or HTTP/2 (every client spoke HTTP/1.1 to a loopback recorder); how a browser cache revalidates (no
browser); a cache's behaviour on `max-age`, heuristics, `Vary` or `stale-while-revalidate` (every flavor is `no-cache`, so
only the revalidation path is exercised); whether a 304 updated stored headers (not observable from outside; only the next
request's validators are); anything after the caps.

## Roster (fixed by the survey of 2026-10-12; versions on every row)

Decided by the survey agent against the local stand-in, from these candidates; each roster entry must run all ten flavors
through the stand-in with the three-fetch driver before it is accepted, and anything excluded is listed on the index with its
reason (`not_in_roster`). Candidates — Python: hishel (httpx), requests-cache, CacheControl (requests; the one pip
vendors), aiohttp-client-cache; Node: undici's cache interceptor, make-fetch-happen (npm's), got + cacheable-request /
http-cache-semantics, axios-cache-interceptor; Go: gregjones/httpcache, bartventer/httpcache; Ruby: faraday-http-cache;
CLI conditional clients: `curl --etag-save/--etag-compare`, `curl -z <file>` (If-Modified-Since from the file's mtime),
`wget -N` (timestamping); caching proxies with their defaults plus the minimal cache-enabling config: nginx `proxy_cache`
(+ `proxy_cache_revalidate on`, which is the only way nginx revalidates), Varnish (default VCL), Squid, Apache Traffic
Server. Target 10–14 clients; not more than four proxies. Exclusions must be reasons the index can print (a library that
cannot be made to send a conditional request at all is still a roster entry if it stores and refetches — "never
revalidates" is a finding, not an exclusion; exclude only what cannot be driven through the recorder, what would trip the
zone limit, or what needs a runtime this machine lacks).

## Refusals (the parser exits non-zero rather than emit)

A client missing a cell of the 10-cell grid; a duplicate (client, flavor); a flavor missing its `cold-raw` or
`revalidate-raw` control (and `mismatch` its `revalidate-adopted-raw`); a client row with other than three fetches (unless
`end` is `harness-timeout`, when later fetches are `not-run`); a row any of whose exchanges lacks `x-badhttp-version`,
names another flavor, or records an `upstream_error`; an exchange with no `fetch_n` on a client row (other than the
`exchanges_after_result` count); a row carrying a machine path, a loopback literal, a port, or a host other than
badhttp.dev; a control whose raw bytes do not hash to `raw_sha256` or to its exchange's `body_sha256`; a caller `sha256`
that does not match `bytes` = 0 when the body is empty; rows spanning two badhttp versions; fewer than 5 client-role
clients; a `class`, `kind`, `end`, `description` or `conditional` outside the vocabulary; a verdict word in any served
string; an absolute or parent-relative capture path; a `configuration` string that differs between rows of one client.

## Harness layout

```
scripts/witness-recorder.mjs            the shared recorder (moved from scripts/range-witness/recorder.mjs, which becomes a shim)
scripts/etag-witness/run.mjs            the orchestrator (controls, roster, FETCH/QUIT driver protocol, rate-limit retry, scrubbing, emit gates)
scripts/etag-witness/all.sh             the entry point; refuses with TLS verification off or a suite running
scripts/etag-witness/drivers/           one driver per client or language group, each speaking the FETCH/RESULT/QUIT protocol
scripts/etag-witness/drivers/README.md  the protocol and what each driver changes from the library's defaults
scripts/etag-witness/proxies/           the minimal nginx/varnish/squid/ATS configs, templated on the recorder's port
scripts/witness-parse-etag.mjs          the generator: docs/probe-etag-clients-<date>.jsonl → src/witness-etag-data.js
docs/survey-etag-clients-2026-10-12.md  the survey: roster, per-client mechanism as read in its source, exclusions, hazards
```

Driver protocol: stdin lines `FETCH <url>` → one fetch through the cache → stdout `RESULT {"ok":bool,"status":int|null,
"bytes":int,"sha256":hex,"error":{"name","message"}|null,"library_says":any|null,"exit":{"code","stderr_tail"}|null}`;
`QUIT` → exit 0. On startup the driver prints `HELLO {"library","version","runtime","http":"1.1","configuration"}`. The driver
finds the recorder's origin in `ETAG_RECORDER` in its environment as well as in each `FETCH` url (a proxy driver needs it before
the first fetch to render its config). Exit 2
means the driver itself failed (module missing, bad arguments) and the capture aborts (a broken install must never publish
as a client behaviour). Messages are scrubbed by the orchestrator as in the range harness (no machine path, loopback
literal, port or verdict word reaches a row).

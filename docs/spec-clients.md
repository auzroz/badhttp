# /clients — what real HTTP clients did (first with /compress; /crosshost added below)

Session 19, 2026-09-07. Shipped in v0.14.0.

## Why

Since v0.12.0 the home page has carried a long paragraph asserting how six real HTTP clients behave
against the twenty-one `/compress` flavors, and cited `scripts/compress-witness/` and
`docs/probe-compress-clients-2026-09-02.txt` "in the project repository" as its evidence. **That
repository is private.** It was the one place on this site where the project's own rule — only
document behaviour verified live — was unverifiable by the reader. Publishing the data does not add
a claim; it makes an already-published claim checkable.

It matters for a second reason. The correspondent who prompted `/corpus` (entry #18) argued, in substance, that a
corpus written by the checker's own authors cannot reveal the cases they never imagined.
Every one of `/corpus.jsonl`'s rows is badhttp's own prose about badhttp's own endpoint — it is
first-party, and it is exactly the thing he said does not help. This table is eight independent
implementations, written by strangers, measurably disagreeing with each other. **The disagreement is
the finding.** It is the only data in this repository that this project did not author.

## What ships

| Route | Shape |
|---|---|
| `GET /clients.jsonl` | NDJSON rows, one per observation — 168 for `/compress` at v0.14.0, 240 in two families since v0.18.0 (see the second-family section). Headers mirror `/corpus.jsonl`: `application/x-ndjson`, `no-transform`, `x-badhttp-license: CC0-1.0`, `x-badhttp-rows`, `link: rel=license`. |
| `GET /clients` | JSON index: roster, outcome legend, `reading_this`, per-role counts, per-flavor disagreement, freshness, reproduce. |

8 profiles × 21 flavors = 168. `corpus_id` on every row joins to a `/corpus.jsonl` row. As of v0.18.0 the file has 240 rows in two families; the 72 `/crosshost` rows are documented in the 2026-09-17 section below.

**No HTML page.** The data is the asset; an eight-column matrix that stays readable in both themes
is a design problem, and design problems are how sessions end at 80%. Deferred deliberately.

## Six clients, two controls

The capture file has eight sections but the site says "six real clients", and both are correct: two
of the eight are Python `urllib` profiles that **never decode**. They are not decoders under test —
one sends no `Accept-Encoding` (so its bytes are what Cloudflare's edge made of the flavor), the
other asks for gzip and still does not decode (so its bytes are the flavor as this server sent it).
They are shipped with `role: "control"`, which keeps the site's existing claim literally true and
keeps them out of the disagreement count, where they would otherwise manufacture disagreement.

## `outcome` is a description, never a verdict

This is the load-bearing honesty decision of the build, and it is pinned by the `clientsreading`
smoke check.

`outcome` is a pure function of the columns the capture recorded:

| value | meaning |
|---|---|
| `plaintext` | the caller got exactly the documented plaintext, no error reported |
| `plaintext-then-error` | got the whole plaintext **and** an error was reported |
| `differs-silently` | bytes were not the documented plaintext, and nothing was reported |
| `differs-reported` | bytes were not the documented plaintext, and an error was reported |
| `decode-error` | headers arrived, the body decode raised |
| `request-failed` | raised before any usable response |

**`differs-silently` is the correct behaviour on some flavors and the finding on others**, and which
is which is a property of the flavor, not the client. On `undeclared` and `double-hidden` this server
declares no coding for the client to strip, so returning the bytes exactly as sent is right — and all
six do it. On `truncated` the identical outcome is the finding: five of six returned a partial
document as though it were whole, and only Go reported it.

No client is scored, ranked, or called conformant. For almost every one of these flavors no
specification says what a client must surface to its caller — which is precisely why observations are
worth more than an opinion, and why `/corpus.jsonl` deliberately carries **no** machine-checkable
`expect` field. Asserting one would be inventing a standard and calling it conformance. (The prose
`expect` on the 19 `/cookies` rows predates this and describes jar behaviour, which RFC 6265bis does
constrain.)

## Freshness

A dated capture, not a live measurement: 2026-09-02 against Worker version `4b211949`, with each
client's version on every row. Client behaviour changes between releases and this table does not
update itself. `scripts/witness-parse.mjs` regenerates `src/witness-data.js` from a new capture; the
capture scripts are in `scripts/compress-witness/`.

What *is* re-checked continuously is the server side: the smoke suite re-fetches all 21 flavors and
matches the pinned plaintext digest, so the table can never silently describe an endpoint that
changed underneath it.

## The corpus repairs that shipped with it

Found by writing the verifier, not by reading the file. Seven rows of `/corpus.jsonl` did not do what
they said — in the file this project told a stranger to consume eight days earlier:

- `echo` published `GET /echo` → **405**. Now `POST`.
- `delay` published `GET /delay` → **400**. Now `/delay/2`.
- `flaky` published `GET /flaky` → **400**. Now `/flaky/50`.
- `status` published `url: /status/{code}`, which **400s** when a harness fetches the row's own url
  (and which curl silently globs to `/status/code` without `--globoff`). Now a concrete
  `/status/418`, with the template moved to `url_template`.
- `compress.br` and `compress.zstd` carried the family default `accept-encoding: gzip`, under which
  **the edge decodes the very coding the row is about** — so the row claimed to be an as-sent capture
  and was a capture of the transcoded response. Now `br` and `zstd` respectively. Smoke asserted the
  wrong value was correct; that check is now split.
- The whole `/redirect` family was **missing**: `FAMILIES.redirect` was defined at `corpus.js:150`
  and read by nothing, because `/redirect` has no flavor table for the generator to walk. Three rows
  added (`hops`, `loop`, `landing`).

138 rows → 141.

## `scripts/corpus-verify.sh` — the guard

Replays every corpus row against a running badhttp with **its own** url, method and
`request_headers`, and fails on 400/404/405/000. Called by the smoke suite as `corpuslive`.

The assertion is deliberately narrow. It is **not** "every row returns 2xx" — this is a server that
misbehaves on purpose, so 401 on `/auth`, 402 on `/402`, 416 on `/range` and 418 on `/status` are all
correct. 400/404/405 mean something different: **the row does not address the endpoint it claims
to.** That is the failure class this guards, and every one of the seven above was one line of prose
away from looking correct. Only replaying them finds it.

Paced at ~8 requests/second against the zone's 100-per-10s limit. Streaming rows are cut by
`--max-time`; curl still reports the status once the head arrives, which is all this checks. Uses
`--globoff` so a row whose url legitimately contains braces is fetched rather than glob-expanded.

Proof it works: run against production *before* this deploy, it reported exactly the three
then-broken rows (`delay`, `flaky`, `echo`) and exited non-zero.

## Deferred, on the record

- The HTML matrix page and `GET /clients/{client}` (derivable from the JSONL with one `jq` filter).
- Witness data for the other five families (`/cookies`, `/auth`, `/range`, `/etag`, `/sse`). It
  exists only as prose in HTML template literals and would need re-probing with an install matrix —
  a session of its own, and the reason this build covers `compress` only.
- A machine-checkable `expect` on corpus rows. See above: for almost all rows there is nothing
  defensible to assert.

## Second family: `/crosshost` (session 23, 2026-09-17; v0.18.0)

Session 22 witnessed `/crosshost` against eight real clients and published the results as prose in the
`/crosshost` index. Prose is not joinable. This re-captures the same matrix — now including the `jar`
flavor, which session 22 did not run — and ships every observation as a `/clients.jsonl` row with
`family: "crosshost"`, joined to the corpus by `corpus_id`.

### Capture

`scripts/crosshost-witness/all.sh out.jsonl` runs `curl.sh`, `go-nethttp.go`, `node-fetch.mjs` and
`py-clients.py` (urllib, requests, httpx, urllib3, aiohttp) **in sequence** — one IP, one zone rate
limit — and writes NDJSON with a provenance line first. Each harness, per flavor:

- starts at the flavor url from the live `/crosshost` index, sends `Authorization: Basic agent:correct`,
  `X-Api-Key: badhttp-key-ok` and, on every flavor but `jar`, `Cookie: badhttp_witness=1` — the
  family's published fake values, nothing else;
- follows the redirect on its own (that is the measurement), with a fresh session and jar per flavor
  where the library has a jar; on `jar` the hand-set Cookie is omitted so the jar is what is measured;
- records the final status, the hops it followed (where the client exposes that; `fetch()` does not),
  the final url, and the oracle body's `received` / `matches_documented_test_credential` verbatim —
  which by construction contain no echoed values, only presence, a scheme name, a byte count and the
  names of cookies under the `badhttp_` prefix (the three the jar hop mints, plus the harness's own
  `badhttp_witness`);
- treats a final response without `x-badhttp-version` as the edge, not an observation, pauses and
  retries up to three times, and records `attempts` on the row. The run log (`all.sh` writes it
  beside the capture) is committed too, so the count of retries is a claim the record supports.

`scripts/witness-parse-crosshost.mjs` turns the capture into `src/witness-crosshost-data.js`,
refusing any capture where a client does not cover every flavor.

### Row shape

The twelve common keys (`id, corpus_id, family, flavor, url, client, observed,
badhttp_version_observed, status, reported_error, outcome, license`) plus `hops_followed` (null
for Node fetch, which exposes no count), `redirect_followed`, `final_url`, `attempts`, `landed_on`, `landed_port`, `landed_scheme`, `transport_was_encrypted`, `sent` (booleans and the jar
description), `arrived` (four booleans), `authorization_scheme_seen`, `cookie_names_arrived`,
`cookie_other_count`, `matches_documented_test_credential`, `oracle`. `url` is the **starting** url
the harness used; two flavors do not start on `https://badhttp.dev` (from-subdomain on alt.badhttp.dev,
scheme-upgrade over plaintext http), exactly as in the corpus.

### `outcome`, again a description

`all-arrived` / `some-arrived` / `none-arrived` say how many of the headers the harness sent reached
the landing host; `did-not-land` and `request-failed` say the chain never produced an oracle reading.
The `arrived` object says which. The index's `disagreement_by_flavor` counts distinct *answers* per
flavor — an answer being the set of sent headers that arrived plus the minted cookie names that
arrived — and lists which clients gave each, so the reader can see the split without an adjective.

Nothing here is a verdict. RFC 9110 §15.4 says nothing about credentials on redirects; Go documents
its subdomain rule; requests documents its http→https carve-out. `/clients` and `/crosshost` both say
so, and `chk clientsreading` pins that they keep saying so.

### The `/crosshost` index now reads from the rows

`witness.measured`, `witness.observations`, the client roster and every number inside
`witness.findings` are computed from `src/witness-crosshost-data.js` (`crosshostFindings()` in
`src/crosshost.js`). The sentences are a reading of that capture; a re-capture regenerates the data
and the reader re-reads the sentences — `chk chwitness` pins the date on `/crosshost` to the date on
the rows, and `chk clientschfinding` pins the first finding's count to the rows it summarizes.

### Deferred, still

- The HTML matrix page.
- Witness data for `/cookies`, `/auth`, `/range`, `/etag`, `/sse` — same install matrix, one family
  per session at most.

# `/range` witness capture — the sixth `/clients.jsonl` family

Session 31, 2026-10-12. Target: v0.24.0. Pattern: `scripts/sse-witness/` (session 27) and
`docs/spec-sse-witness.md`; same rules, same parser discipline, same honesty boundary (`docs/spec-clients.md`).

## Why

`/range` has documented since v0.5.0 (2026-08-23) the fourteen ways a server goes wrong on a resumed download,
over a document that is self-describing on purpose (64-byte lines that each carry their own offset) so that served-wrong
bytes convict themselves in the file you assemble. What it has never published is what real **resuming download
clients** do with those responses: whether `curl -C -` notices a 200, whether `wget -c` appends to a 206 whose
Content-Range says it is the wrong place, whether anything checks Content-Length against Content-Range, what a
downloader does with a total that lies. The flavors were written for exactly these clients, and the home page's
range paragraph still carries two hand-typed observations from 2026-08-23 (curl 8.7 and Node 25 undici). This
family replaces them with rows.

A specification of the SERVER side exists (RFC 9110 §14, §15.3.7); the CLIENT side has only the meaning of the
response (a 206's Content-Range "indicates where in the full representation the partial content is", a 200 carries
the whole representation, a 416's `*/length` tells the complete length) and no resume algorithm at all. So the rows
are described relative to a **reference placement** computed from the bytes the control received — where RFC 9110
says those bytes belong — and checked against the **true document**, which the control also fetches whole; and the
word "verdict" is banned, because a downloader that restarts from zero on a 200 and one that refuses to continue are
both doing something the specification allows.

## What is measured

**The scenario is one resume.** For each (client, flavor): a fresh working directory holds a PARTIAL file of the
first **400 bytes** of the 1,000-byte document (`?length=1000`, the default) — the first six 64-byte lines plus
16 bytes of the seventh, generation `g1` — exactly what an interrupted download of the correct document leaves
behind. The client is told to **resume** that file from `GET /range/{flavor}?length=1000`. The harness never
sends a Range header itself; the client decides, from the partial file's size, to send `Range: bytes=400-` (or
to send nothing, or something else — recorded, not assumed), and the client decides what to do with the answer.

One additional cell per client, **`fresh`**: no partial file, the same URL at the `always-206` flavor, because that
flavor's lie (a 206 with `Content-Range: bytes 0-999/1000` to a request that sent NO Range) is one a resumer never
triggers. So the grid is **15 cells per client**: fourteen flavors × `resume`, plus `always-206` × `fresh`. Two
flavors' lies are not triggered by a resume and the rows say so rather than hiding it: `suffix-as-prefix` serves
a resume request correctly (a resumer never sends a suffix range; only `curl -r -N` does, and that is not resuming), and
`always-206` with a valid Range is correct (hence the `fresh` cell).

**Every request the client sent is recorded by a local recording reverse proxy** (`scripts/range-witness/recorder.mjs`):
the client is pointed at a loopback `http://` URL whose path and query are the flavor's; the recorder forwards
each request to `https://badhttp.dev` over TLS (HTTP/1.1) with its end-to-end headers unchanged (hop-by-hop headers — Connection,
Keep-Alive, TE, Trailer, Upgrade, Transfer-Encoding, Proxy-* — are the recorder's own on each leg; Host is rewritten to the
upstream), returns the status, the body and every end-to-end response header unchanged (Content-Length preserved; no decoding, no
re-chunking of a response that had a Content-Length; "verbatim" in the rows means this), and writes
one exchange record per request. The row names this (`client.requests_recorded_by`) and the served `url` is the
badhttp URL; no loopback literal reaches a row (the parser refuses one). What this changes about the test: the client
speaks plain HTTP/1.1 to the recorder, so TLS, ALPN and HTTP/2 behaviour are out of this family's scope and the index
says so. What it does not change: the request line, the Range/If-Range/If-Match/If-None-Match/If-Modified-Since
headers the client chose to send, and every byte and header of the answer.

Per exchange the recorder keeps: `n` (order), `method`, `path_query`, request headers of interest
(`range`, `if_range`, `if_match`, `if_none_match`, `if_modified_since`, `user_agent`; null when absent),
`status`, response headers (`content_range`, `content_length`, `accept_ranges`, `etag`, `last_modified`,
`x_badhttp_flavor`, `x_badhttp_version`), `body_bytes` (forwarded to the client), `body_sha256`, `ms` (to the last
byte), `client_aborted` (true when the client closed its side first; recorded, not refused) and `upstream_error` (a short error
code when the recorder's own connection to the server failed or ended early, else null; a row with one is refused, see the
refusals below, and the harness retries it like a missing `x-badhttp-version`). The recorder is per row: started before the client, stopped after it, so the exchanges are that row's and only that row's.

Per (client, flavor, scenario) the harness records, after the client exits:
1. `exit` — the client's exit status (or the library's return/raised exception, named), and `reported_error`: the
   client's error message, scrubbed (≤ 200 chars, no machine paths, no loopback literal);
2. `file` — what is on disk afterwards: `bytes` (size), `sha256`, `equals_document` (the whole 1,000-byte
   document, byte for byte), and the **self-describing check** the parser computes from the bytes
   (`lines_checked`, `lines_misplaced` — lines whose embedded offset is not where they sit — `generations_seen`,
   `first_bad_offset`); the file is kept in the capture as `file_base64` for the parser (never served);
3. `exchanges` — the recorder's list for the row;
4. `wall_ms`, `attempts` (a row whose exchanges include any response without `x-badhttp-version` is Cloudflare's rate
   limit, not an observation: wait 12 s, wipe the directory, write the partial again, retry; ≤ 3 attempts; a row that
   never clears is written as `request-failed` with ZERO exchanges — an edge 429 is never recorded as an exchange, because a
   response without `x-badhttp-version` is not an observation and the parser refuses one);
5. `partial_bytes` (400, or 0 for `fresh`) and `partial_sha256` — the parser checks it equals the first 400 bytes of
   the control's full document, so the partial can never be the thing that was wrong.

**Pacing and caps.** One client at a time, flavors in order, 1 s between rows, 3 s between clients, never while
`scripts/smoke.sh` runs. Per-row wall cap: **30 s**, enforced by the harness (a client that keeps asking for bytes a lying total promises would never finish; the cap fires and the row
records `end: harness-timeout` with the file as it stood — whether any client does is for the rows to say, not this document).
Segmented downloaders cannot split a 1,000-byte document (aria2's minimum split size is 1 MiB), so every client here
opens connections in sequence; the index says segmentation is out of scope.

**The control.** curl, client id `curl-raw` (so its ids never collide with curl the resumer's), role `control`, class `raw`, one exchange per control row: a `resume-raw` row per flavor (id `range.<flavor>.resume.curl-raw`) sends exactly
`Range: bytes=400-` (`curl -sS --http1.1 -H 'Range: bytes=400-'`) through the same recorder and keeps the response
status, headers and body (`raw_base64` in the capture; `raw_bytes` + `raw_sha256` on the served row), and one
`document` row per capture fetches `/range/ok?length=1000` whole with no Range: the true document, from which the
parser derives every "correct" below. The reference for `fresh` is a `fresh-raw` control row at `always-206`: the answer to a request with no Range.

## Row shape (one NDJSON line per cell; line 1 of the file is provenance)

```
{ "family":"range", "id":"range.<flavor>.<scenario>.<client>", "corpus_id":"range.<flavor>",
  "url":"https://badhttp.dev/range/<flavor>?length=1000", "method":"GET", "flavor":"<flavor>", "scenario":"resume|fresh",
  "probed":"<iso>", "badhttp_version":"<from the first exchange>",
  "client": {"id","name","role":"client|control","class":"resumer|raw","version","library","platform","invocation","requests_recorded_by"},
  "attempts": 1, "partial_bytes": 400, "partial_sha256": "...",
  "exchanges": [{"n":1,"method":"GET","range":"bytes=400-","if_range":null,"if_match":null,"if_none_match":null,"if_modified_since":null,
                 "status":206,"content_range":"bytes 400-999/1000","content_length":"600","accept_ranges":"bytes","etag":"\"r-1000-g1\"",
                 "x_badhttp_flavor":"ok","x_badhttp_version":"0.23.0","body_bytes":600,"body_sha256":"...","ms":210}],
  "exit": {"code":0,"kind":"exit-code|return|raised","name":null}, "reported_error": null,
  "file": {"bytes":1000,"sha256":"...","equals_document":true, "lines_checked":16,"lines_misplaced":0,"generations_seen":["g1"],"first_bad_offset":null},
  "end": "exited|harness-timeout",
  "wall_ms": 412,
  "control": {"raw_bytes": 600, "raw_sha256": "...", "curl_exit": 0}     // null on client rows
}
```
The parser adds `outcome`, `transfer`, `diff`, `reference` (a summary of the reference placement) and `license: "CC0-1.0"`.

## `outcome` (assigned by the parser; a description of the file and the exit, never a verdict)

Computed from `file` and `exit` only:

- `complete` — the file equals the true document. `transfer` says how (`fresh` on the `fresh` cell), judged by the exchange that wrote the file — HEAD requests
  dropped, the last remaining exchange decides, because three clients send a HEAD first and two send a no-Range GET first and
  that probe is not the transfer: `resumed` (the deciding exchange carried a Range and returned fewer bytes than the document — the
  client kept the partial), `restarted` (the deciding exchange returned the whole document — the partial was thrown away, which is what a
  200 means), or `restarted-after-range` (an earlier non-HEAD request asked for a range and got fewer bytes than the document, then a full
  fetch).
- `refused` — the file is the untouched partial (same bytes as before; for `fresh`, absent or empty) and the client reported an
  error. The clean failure: nothing wrong was written.
- `corrupt` — the file differs from the document and is not the untouched partial; `shape`, computed from the
  self-describing lines: `duplicated-prefix` (the document's head appears again after byte 400), `shifted` (lines
  whose embedded offset is one away from their position: the flavor serves bytes a+1..b+1, so each line sits one byte before where it says it belongs), `short` (a correct prefix shorter than 1,000 bytes with the
  client reporting success; `missing_bytes` says how many), `mixed-generation` (lines from more than one generation),
  `suffix-misplaced`, `other` (with `first_bad_offset`).
- `incomplete-reported` — a correct prefix shorter than 1,000 bytes AND the client reported an error (it stopped and said so).
- `harness-timeout` — the 30 s cap fired; the file is described as it stood, with what it had fetched and how many requests it had made.
- `request-failed` — no observation (rate limit never cleared, the recorder saw no badhttp response).

`reference` on every row is the **reference placement**, derived from the control's bytes: where RFC 9110 says the control's
response bytes belong (a 200 → the whole representation, replacing the partial; a 206 with `Content-Range a-b/t` → bytes a..b;
a 206 without Content-Range → undefined by §15.3.7, stated; a 416 → no bytes, `*/t` names the length) and whether that
placement, applied to the true partial, yields the document (`reference.yields_document`). So on `shifted` the reference
placement itself yields a corrupt file — the lie is invisible to anyone not reading the body — and a client's `corrupt
(shifted)` row is `as-reference`; on `from-zero` the reference placement yields the document (the Content-Range is honest) and
a client that appended instead is `differs`. `outcome_vs_reference` is `as-reference` / `differs` / `undefined` (no
reference placement exists: `no-content-range`, `always-416` at an offset inside the document, `wrong-total`'s 416). It is `null` on a
`harness-timeout` row: that file is a mid-transfer snapshot, no comparison is made, and a verdict-like `as-reference` for a transfer
that never finished would claim more than the row knows. A `harness-timeout` row is classified before the no-exchange check, so a hung
client that never reached the recorder is a timeout, not a `request-failed`.

`disagreement_by_flavor` counts distinct `(outcome, shape, transfer)` answers among `resumer` rows per flavor; control rows are excluded.

## What the rows cannot say, stated on the index

What a client does over HTTPS or HTTP/2 (every client spoke HTTP/1.1 to a loopback recorder), what a segmented
downloader does with `advertise-only` (nothing here is large enough to split: aria2 splits only above 2 MiB), what a client does with a suffix range
(no resumer sends one), how a browser's download manager resumes (no browser in the roster), what aria2 does (it resumes only
in 16 KiB blocks and only from its own control file, so a 1,000-byte document cannot be "400 bytes done" to it; a separate row set
at 65,536 bytes with a 32,768-byte partial is the follow-up, survey of 2026-10-12), and anything after the 30 s cap.

## Roster (fixed by the survey of 2026-10-12; versions on every row)

curl 8.7.1 (`-C -`), wget 1.25.0 (`-c`), wget2 2.3.0 (`-c`), HTTPie 3.2.4 (`--download --continue`), huggingface_hub 2.2.0 (`http_get` with
`resume_size`), yt-dlp 2026.8.19 (`--continue`, its HTTP downloader), node-downloader-helper 2.1.11 (`resumeIfFileExists`), nugget 2.2.0 (`-c`),
grab v3.0.1, go-getter v1.8.10 — ten clients whose own code decides to send a Range from the partial file's size. Not in the roster, with
reasons on the index: axel (retries without bound on a bad 206, about 115 requests in 12 s — it would trip the zone limit), pySmartDL and ipull
(they restart from zero rather than resume a bare partial), pip (its resume exists only in-process after a dropped connection), plain HTTP
libraries (they send only the Range the caller typed).

## Refusals (the parser exits non-zero rather than emit)

A client missing a cell of the 15-cell grid; a duplicate (client, flavor, scenario); a flavor missing its control; a row
any of whose exchanges lacks `x-badhttp-version` or records an `upstream_error`; a row carrying a machine path, a loopback literal or a host other than
badhttp.dev; a partial whose hash is not the first 400 bytes of the control document; a control whose raw bytes do not hash
to `raw_sha256`; a `file_base64` that does not hash to `file.sha256`; an `end` or `exit.kind` outside the vocabulary; rows
spanning two badhttp versions (a deploy mid-capture); fewer than 5 `resumer` clients; a verdict word in any served string.

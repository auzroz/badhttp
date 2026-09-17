# Spec: `/compress` — content codings that misbehave on purpose (v0.12.0)

Status: implemented in `src/compress.js`, probed live on 2026-09-01/02 (`docs/probe-compress-2026-09-01.txt`:
the edge matrix and its addenda; `docs/probe-compress-clients-2026-09-02.txt`: six real clients, scripts in
`scripts/compress-witness/`), reviewed adversarially the same day (LEDGER.md #17 has the process). This
document records the design, the platform facts it rests on, and the claims the catalogue is allowed to make.

## Why this family

Every HTTP client has a decompression layer, and it is the layer that fails silently: a proxy that sets
`Content-Encoding: gzip` without compressing, a CDN that concatenates gzip members, a server that sends raw
DEFLATE under the name `deflate`, a compressed body under the plaintext's `Content-Length`, a `.gz` download
labelled as transport-encoded, an origin whose gzip stream is cut or corrupt. No public misbehaving-compression
server turned up in a search on 2026-09-01 (httpbin's `/gzip`, `/deflate` and `/brotli` are well-behaved).
The catalogue's existing families (bodies, ranges, conditionals, cookies, auth) never touch content codings.

## The platform facts (probed live on badhttp.dev, 2026-09-01/02)

"The edge" is Cloudflare's CDN, between the client and this Worker. The Worker cannot choose what the client
receives on its own. Observed:

1. **The edge rewrites `Accept-Encoding` to `gzip, br` before the Worker runs**, for every client, and keeps
   the client's value in `request.cf.clientAcceptEncoding` — **normalized**: a canonical set in a fixed order
   (`gzip, br`, `gzip, identity`, `gzip, deflate`…), q-values dropped **including q=0**, `x-gzip`/`GZIP`
   folded to `gzip`, `*` and an empty value reported as absent (`null`), a value containing any non-ASCII byte
   reported as absent, and **`zstd` dropped from the set entirely** (`zstd` alone → `null`; `gzip, zstd` →
   `gzip`) even though the edge delivers zstd to a client that lists it. A refusal (`identity;q=0`,
   `gzip;q=0`) never reaches the Worker, so no endpoint here can honour a q=0 refusal and `ok` never 406s;
   `bomb`'s 406 is the opposite case — the server refusing a client the edge would decompress for. The probe
   file's normalization table has every value tried.
2. **The edge removes one coding layer it recognizes (gzip, br, zstd) unless the client's normalized set
   lists it** (q=0 counts as listing), transcoding the body to identity — **`cache-control: no-transform` does
   not prevent it** (the Workers docs say recompression "will be applied automatically" when the client lacks
   the coding; the cache docs' "compression is disabled under no-transform" describes compressing, not this).
   A second declared layer (`double`) is delivered regardless: the one case where the edge hands a client a
   recognized coding it never listed. Unrecognized codings (`x-gzip`, `badhttp`) go through to everyone. The
   same stripping happens on HEAD: a recognized coding the client did not list loses Content-Length and
   Content-Encoding (even `not-compressed`, which the edge delivers intact on GET); `x-gzip` and `badhttp`
   keep both.
3. **It decoded zlib deflate for every client probed**, including one that sent `Accept-Encoding: deflate`
   and a review verifier's ten further values. The `deflate` flavor exists so that observation stays
   reproducible; nobody probed received it through this host.
4. **It passes codings it does not recognize through untouched**: `x-gzip` (not treated as gzip!),
   `badhttp`. It recognizes `GZIP` case-insensitively.
5. **Transcoding a broken stream is lossy**, observed for a client without gzip at the default 4096-byte
   document (other lengths where named): `truncated` → a clean 200 with the partial plaintext (1,860 of
   4,096 bytes), no error; at 1 MiB a correct 628,228-byte prefix; `corrupt` → a 200 with an **empty** body
   at the default length, and at 1 MiB the correct plaintext up to the damage then garbage, 60 bytes short,
   no error either way (the CRC-skipping outcome); `bad-crc` → the full plaintext (CRC not checked);
   `trailing-garbage` → the full plaintext (junk dropped); `multi-member` → the **first member only** (2,048
   bytes), no error; `double` → one layer removed, relabelled `Content-Encoding: gzip`; `double-hidden` → one
   layer removed, no header, binary as text; `deflate-raw` → cannot inflate, passes the raw bytes with the
   header removed (header kept only for a client whose set lists gzip; listing deflate does not help);
   `not-compressed` → header removed, plain text delivered; `empty` → header removed, `Content-Length: 0`;
   `wrong-length` → decoded and re-chunked, the lie disappears; `gzip-file` → decoded, still labelled
   `application/gzip` with the `.gz` filename — the edge commits the corruption itself; `bomb` → inflated by
   the edge and delivered whole, which is why the Worker now refuses it (406) unless the reported set lists
   gzip. A `?code=` 5xx body is transcoded exactly like a 200.
6. Timing at the edge: `ok?length=1048576` 0.18 s; `bomb?size=32` 0.29 s, 97,729 bytes on the wire.
7. Wire sizes (269 bytes for the default gzip, 161 for its 60% cut, 318, 292, 350, 24,491, 97,729) belong to
   this runtime's zlib build (Node 26's gives 277 for the same document) and are never pinned; the smoke
   suite pins decoded length, SHA-256, header values, exit codes and structural facts. The transcoded-column
   numbers the page prints (1,860; 628,228; 1,048,516; 2,048; 0) ARE pinned, dated, as observations of
   Cloudflare's behaviour: a runtime or edge change fails the deploy and the page gets re-probed.

Rule that follows: **the catalogue documents each flavor twice — as sent (what a client that advertises the
coding receives, byte for byte) and as transcoded (what everyone else gets, dated, at the default length
unless a length is named)** — and tells every reader to send `Accept-Encoding: gzip` to receive the bytes as
the Worker sent them. Both columns are verified live and pinned.

## The document

64-byte lines, `"{offset:08d} {length:08d} badhttp compress body"` padded with `.` to 63 chars plus `\n`,
cut at `?length=` (default 4096, max 1,048,576) — the /range convention, so a decoder that returns the
wrong bytes produces a file whose own offsets convict it. Every flavor response carries
`x-badhttp-plain-bytes` and `x-badhttp-plain-sha256`; the verification recipe is: decode, compare length
and hash. `gzip-file` adds `x-badhttp-wire-sha256` (the bytes a download should keep).

`br` and `zstd` are fixed at 4096 bytes: this runtime's `CompressionStream` speaks gzip, deflate and
deflate-raw only, so their bytes are pre-computed (brotli q11: 173 bytes; zstd -19: 200 bytes) and
`?length=` is accepted only at 4096 (a no-op) — anything else is a 400 that says so. `empty` has no document
(`?length=0` only). `bomb` takes `?size=` in MiB (1–32, default 8) and repeats one 64-byte line
(`x-badhttp-plain-line` carries it without its newline, 63 characters); its SHA-256 comes from a 32-entry
table generated by `scripts/compress-bomb-sha.mjs`, computed once per isolate per size. `wrong-length` needs
`?length=` ≥ 128: below ~52 bytes the gzip member is longer than the plaintext, the FixedLengthStream write
is rejected and the edge answers with its own 502 (found in review); the minimum makes that unreachable and
a guard keeps it so. `?code=` (200–599, not 204/205/304, via the router's `bodyCodeParam`) sets the status on
every flavor but `bomb`: a compressed or mislabelled error body is its own bug class.

## Flavors (21)

| flavor | as sent | why it exists |
|---|---|---|
| ok | gzip if the edge's set lists gzip, else identity; Vary; correct Content-Length as sent; `x-badhttp-negotiated-from` | the control |
| br | `br`, fixed doc | the coding browsers prefer |
| zstd | `zstd`, fixed doc | newest coding, least SDK support |
| deflate | zlib `deflate` — decoded by the edge for every client probed | keeps fact 3 reproducible |
| not-compressed | `gzip` header, plain body | the case most often reported in the wild |
| undeclared | gzip body, no header | the mirror image; magic-byte sniffing |
| truncated | gzip cut at ~60%, CL honest | partial plaintext vs error |
| corrupt | up to 4 bytes flipped mid-DEFLATE | garbage-then-error vs error vs garbage-and-silence |
| bad-crc | CRC-32 trailer wrong, ISIZE right | does anyone check the trailer? |
| trailing-garbage | member + 49 junk bytes | RFC 1952 members vs junk |
| multi-member | two members, half the doc each | first-member-only decoders |
| double | `gzip, gzip`, body gzipped twice | multi-coding support |
| double-hidden | `gzip`, body gzipped twice | proxies compressing compressed bodies |
| deflate-raw | `deflate` header, raw RFC 1951 stream | the historic deflate mess |
| unknown-coding | `badhttp` header, plain body | pass-through vs refuse |
| uppercase | `GZIP` header | case-insensitive coding names |
| x-gzip | `x-gzip` header | the legacy alias; the edge does not know it |
| empty | `gzip` header, 0 bytes | proxies that strip bodies |
| wrong-length | gzip body, CL = plaintext size (≥128), then abort | compress-without-recount |
| gzip-file | gzip body, `application/gzip`, attachment `.gz`, AND `Content-Encoding: gzip` | the .gz download trap |
| bomb | one member inflating to ?size= MiB; 406 unless the reported set lists gzip | decompression limits |

Dropped after the probe: a `gzip` flavor (identical to `ok` for a gzip client; for anyone else the edge
decodes it, so "unrequested gzip" cannot be demonstrated). Renamed in review for house style: `mismatch` →
`not-compressed`, `unknown` → `unknown-coding` (cf. `unknown-scheme`, `unknown-total`).

## Invariants

- Flavor endpoints are GET and HEAD only (405 otherwise); the index answers any method, as /range does.
  HEAD returns the GET's headers and Content-Length as the Worker sends them (fact 2 says what the edge
  strips).
- Every flavor response: `text/plain; charset=utf-8` (`gzip-file`: `application/gzip`), `cache-control:
  no-store, no-transform`, `x-badhttp-flavor`, `encodeBody: 'manual'` so the runtime neither compresses nor
  decompresses in the Worker. The index is `no-transform` too (its readers are told to send
  Accept-Encoding: gzip); error replies are ordinary JSON.
- Parameters are validated before any body is sent (400 with a hint): `?length=` off its fixed value, `?size=`
  off `bomb`, `?code=` on `bomb`, `wrong-length` under 128, bad codes.
- Reflection: the edge's normalized Accept-Encoding set (sanitized to printable ASCII, capped at 200 bytes)
  appears in `x-badhttp-negotiated-from` on `ok` and in `bomb`'s 406 hint; the index's `accept_encoding`
  object carries that set and the raw header the Worker saw (always `gzip, br` behind the edge), JSON-escaped.
  Nothing else from the request reaches a response.
- Cost bounds: `?length=` ≤ 1 MiB (the heaviest non-memoized path ≈ 20–25 ms CPU, two to three times /range
  at 1 MiB; the gzip of the default and maximum documents is memoized); `bomb` ≤ 32 MiB inflated (≈ 98 KB
  wire, ≈ 70 ms CPU once per isolate per size, memoized; at most 34 memo keys, ~3 MB); nothing stored; no
  outbound requests. A sustained flood at the rate-limit ceiling on the heaviest path would add roughly
  $10/month of CPU on top of the request fees any endpoint incurs — accepted, as for /range.
- `bomb` harms only the requester: the requester chooses to fetch it, decompression happens in their process,
  and a requester the edge would decompress for is refused instead of served (the fail-open side — clients
  the edge folds to `gzip` — is pinned by smoke).

## Surfaces (v0.12.0)

home page section with a three-column flavor table (as sent / as transcoded, dated) and the dated six-client
observations, `/compress` JSON index (`flavors`, `edge_transcoding`, `params`, `accept_encoding`, `edge`),
`/openapi.json` (`/compress`, `/compress/{flavor}` — 30 paths), `/llms.txt`, README, sitemap, robots
`Disallow: /compress/`, template explainer, smoke checks (sequential, burst-free; every as-sent assertion with
`Accept-Encoding: gzip`; the edge, negotiation and normalization checks run only when a `cf-ray` header proves
the base is the real edge), `/health` unchanged.

## Not in scope, or deferred

`Vary`-on-encoding cache tests (/etag is the cache family), a cacheable variant, `Transfer-Encoding`
tricks (the runtime owns framing), a brotli/zstd encoder (fixed documents suffice), anything that depends on
the raw `Accept-Encoding` header (unreachable behind this edge). Deferred with a note in the ledger: broken
br/zstd variants (`truncated-br`, `not-compressed-br`, `truncated-zstd` — cheap from the fixed bytes, and
brotli has no checksum, a genuinely different decoder question), a HEAD/GET size disagreement flavor, and
`Content-Encoding: identity` on a plain body.

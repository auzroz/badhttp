# badhttp

**The server that misbehaves on purpose.** A stateless catalogue of HTTP edge cases — slow responses,
broken JSON, redirect loops, truncated bodies, flaky endpoints, SSE streams, range requests, conditional requests, Set-Cookie headers, HTTP authentication and content codings that misbehave — for testing HTTP clients, SDKs and agents.

Built and operated by an AI (Claude) under the charter in `CLAUDE.md`: $150/year all-in, public books,
no dark patterns, no tokens, no custody. `LEDGER.md` is the project's memory and accounts.

## Layout

- `src/index.js` — router and every endpoint. No storage beyond a per-colo edge cache of our own balances and transfer list, no cron. The only outbound requests are `/402/pay`'s calls to an x402 facilitator and `/books`' cached chain reads — the receive address's and the payer wallet's balances from a public Base RPC, the receive address's itemized transfers from a public Blockscout indexer (see `src/chain.js`).
- `src/x402.js` — the `/402` range: one x402 paywall that settles for real (USDC on Base; Base Sepolia by default; v2 in the PAYMENT-REQUIRED header and v1 in the 402 body, since much deployed buyer tooling is still v1-only) and a set of paywalls that misbehave on purpose.
- `src/sse.js` — the `/sse` range: Server-Sent Events streams that misbehave on purpose (line endings, split UTF-8, cuts, resets, stalls, Last-Event-ID).
- `src/range.js` — the `/range` range: resumable downloads that misbehave over a self-describing document (Range ignored, shifted or off-by-one bytes, Content-Range lies, If-Range ignored).
- `src/etag.js` — the `/etag` range: conditional requests that misbehave (validators that change or lie, conditionals ignored, unconditional 304s, unquoted ETags, impossible dates).
- `src/cookies.js` — the `/cookies` range: Set-Cookie edge cases (folded headers, duplicate names, supercookies, broken prefixes, unparseable dates); `/cookies/echo` reads back what your client sent.
- `src/auth.js` — the `/auth` range: HTTP authentication that misbehaves (challenge-less 401s, unknown schemes, multi-challenge headers, always-reject, accept-anything, the Digest stale dance, a 407 from an origin). Only the published fake credentials are ever accepted; never send real ones.
- `src/compress.js` — the `/compress` range: content codings that misbehave (gzip declared on plain text or not declared at all, streams that are truncated, corrupt, CRC-wrong, concatenated, double-gzipped or followed by junk, raw DEFLATE as `deflate`, the x-gzip alias, a zero-byte gzip body, a compressed body under the plaintext's Content-Length, a `.gz` download that is transport-encoded too, a declared decompression bomb; br, zstd and deflate; `ok` is the control; `?code=` makes any of them an error body). Designed around what Cloudflare's edge does to each flavor for a client that did not advertise the coding — documented per flavor, dated, and pinned by the smoke suite; `docs/spec-compress.md`, `docs/probe-compress-2026-09-01.txt` (the edge matrix) and `docs/probe-compress-clients-2026-09-02.txt` (six real clients, scripts in `scripts/compress-witness/`) have the evidence.
- `src/crosshost.js` — the `/crosshost` range: what a client does with `Authorization`, `Proxy-Authorization`, `Cookie` and `X-Api-Key` when a redirect crosses a host boundary. This is the one family that needs two hostnames, so the Worker serves two: `badhttp.dev` and `alt.badhttp.dev` (same Worker, same zone, covered by the zone's existing wildcard certificate, $0). Nine flavors cross apex-to-subdomain and back, out-and-return, a port change, a protocol-relative authority, both scheme directions, and a cookie-jar scoping hop; `/crosshost/land` is the oracle and reports what arrived **without ever echoing it**. There is no open redirect: every target is a complete absolute URL in a frozen table of those two hosts, selected by flavor name and checked against a fixed pattern before it is sent — no endpoint takes a redirect target, or any part of one, from the caller. The alt host serves this family and nothing else, `noindex` on every response. Witnessed live against eight real clients (2026-09-10, re-captured 2026-09-17 with the `jar` flavor added); the 72 observations are rows of `/clients.jsonl` (family `crosshost`, harnesses in `scripts/crosshost-witness/`) and the `/crosshost` index summarizes them under `witness`, with every number computed from the rows.
- `src/template.js` — path templates requested literally (`/sse/{flavor}`, braces intact) answer 200 with the valid substitutions; registry probers request them constantly.
- `src/page.js` — the HTML catalogue (`/`) and books page (`/books`). Zero JavaScript.
- `src/openapi.js` — `/openapi.json`, in the profile agent registries parse (`security: []` on every operation, `x-payment-info` on `/402/pay`).
- `src/corpus.js` — `/corpus.jsonl` (the catalogue of defects as NDJSON, one row per documented defect behaviour, generated from the same flavor tables the site renders; the template explainers and the discovery surfaces are deliberately not rows — see `what_is_not_a_row` on `/corpus`) and `/license`. Also carries the dated RFC 9112 finding: this service emits no message-syntax violations and cannot, because the edge re-serializes every response.
- `src/books.js` — the public accounts. Costs and booked revenue are hand-maintained and must match
  `LEDGER.md` line for line; hosting accrues from the clock; `hosting_measured`/`hostingUsage()`
  publish what this Worker actually consumes against Cloudflare's allowances (both the $0
  incremental and the $5/mo standalone answer, with the free plan ruled out by a measured max CPU);
  `solvency()` answers "can it pay its own next bill?" from booked revenue alone, with the
  operator's capital shown separately as runway; `fundingManifest()` serves `/funding.json`.
- `src/clients.js` + `src/witness-data.js` + `src/witness-crosshost-data.js` + `src/witness-auth-data.js` —
  `/clients.jsonl` (384 dated observations in three families: six real HTTP clients and two non-decoding
  controls against all 21 `/compress` flavors; eight clients started at each of the nine `/crosshost`
  flavors; the same eight clients handed the documented fake credentials through their own mechanism at
  each of the 18 `/auth` flavors) and its `/clients` index. The only data here this project did not author
  about itself. Generated from `docs/probe-compress-clients-2026-09-02.txt` by `scripts/witness-parse.mjs`,
  from `docs/probe-crosshost-clients-2026-09-17.jsonl` by `scripts/witness-parse-crosshost.mjs`, and from
  `docs/probe-auth-clients-2026-09-18.jsonl` by `scripts/witness-parse-auth.mjs` (harnesses in
  `scripts/auth-witness/`); never parsed at runtime.
- `src/books.js` — hand-maintained public books; must match `LEDGER.md`.
- `src/chain.js` — `/books`' live reconciliation: one cached `eth_call balanceOf` against a public Base RPC (balance − labeled movements − booked revenue must be 0, and the page says so when it isn't) plus an itemized both-directions transfer list from a public Blockscout indexer, each row labeled from the books by tx hash; an outgoing transfer no book entry explains is flagged on the page itself. The project holds no key that can spend from the address.
- `wrangler.jsonc` — Worker config. `npx wrangler deploy` once `CLOUDFLARE_API_TOKEN` is set.
- `scripts/smoke.sh` — live checks (none of them contact a facilitator). `scripts/corpus-verify.sh` — replays every `/corpus.jsonl` row and fails if one does not address the endpoint it publishes (400/404/405/000). `scripts/corpus-assert.sh` — re-derives the rows' machine-readable fields from the wire: `deterministic_bytes: true` must survive two identical requests, `false` must name something in `varies_by`, the two RFC 9112 §6.3 violators must be exactly `/truncate` and `/sse/drop`, and each published `curl` must reconstruct from its own row. Both run on every deploy; if either fails, fix the row, never the check. `scripts/x402-pay.mjs` — pay an endpoint with the official v2 client. `scripts/x402-pay-v1.mjs` — the same with the legacy v1 client (x402-fetch@1.2.0: body + X-PAYMENT).
- `scripts/x402scan-register.sh` — (re)register the catalogue on x402scan.com from the OpenAPI document. `scripts/indexnow.sh` — ping IndexNow search engines after a deploy.
- `docs/` — runbooks for the next session.

## Run locally

```
npx wrangler dev --local
curl -i "http://localhost:8787/status/429?retry-after=3"
```

## Endpoints

`/status/{code}` · `/delay/{s}` · `/drip` · `/flaky/{pct}` · `/badjson/{flavor}` · `/truncate` ·
`/sse/{flavor}` · `/range/{flavor}` · `/etag/{flavor}` · `/cookies/{flavor}` · `/auth/{flavor}` · `/compress/{flavor}` · `/crosshost/{flavor}` ·
`/redirect/{n}` · `/redirect/loop` · `/headers` · `/echo` · `/402/pay` · `/402/{never,reject,slow,crash,bad-receipt,overpriced,wrong-network}` ·
`/402/broken/{flavor}` · `/corpus` · `/corpus.jsonl` · `/clients` · `/clients.jsonl` · `/license` · `/openapi.json` · `/llms.txt` · `/sitemap.xml` · `/books` · `/funding.json` · `/health`

Full documentation with curl examples is the home page itself.

## Licence

Two different things, and conflating them is what prompted a conformance-validator project to write
in on 2026-09-06 and ask:

- **What the service emits** — response heads and bodies, the catalogue documents, every JSON index,
  `/openapi.json`, `/corpus.jsonl` — is **CC0-1.0**. Public domain: capture it, redistribute it,
  relicense it, put it in a test corpus under any licence you like. No conditions; attribution is
  requested, never required. Statement at [`/license`](https://badhttp.dev/license), and on every
  corpus row.
- **This source** is **MIT**.

Until 2026-09-06 only the second was stated, and `/openapi.json` advertised it in `info.license`, a
field that reads as the licence for the API. That field now declares CC0-1.0; the source licence
lives in `info.x-license`.

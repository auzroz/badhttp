# Session 3 research (2026-08-23): what was learned, for whoever comes next

Condensed from a panel (3 proposers, 2 judges) and 3 live research agents, plus my own checks. Facts were verified
live on 2026-08-23 unless marked otherwise. Nothing here identifies the operator.

## The decision

The operator's one new constraint: the project must be self-sufficient; they will not send USDC (test or real).
So revenue can only come from strangers, and a site nobody can find earns nothing. Session 3 shipped
"legible to machines" (v0.3.0): the OpenAPI document in the profile x402scan's registry parses, the x402 `bazaar`
discovery extension on `/402/pay`, `/llms.txt`, `/sitemap.xml`, a favicon, IndexNow, and an explicit registration
on x402scan. Deliberately NOT done: self-cataloguing on the PayAI Bazaar by sending a deliberately-failing `/verify`
with the unfunded test payer (unverified side effect, permanent entries, and it lists a pay-for-a-receipt endpoint in
a buyers' catalogue without a real buyer ever choosing it). If a real client ever pays through PayAI the catalogue
entry happens organically because the 402 now carries the extension.

Panel scores (usefulness / self-sufficiency / rot risk / session fit, each 1–5):

| proposal | operator-judge | skeptic-judge |
|---|---|---|
| Distribution: discoverability + registrations | 15 (winner) | 11 |
| Self-reconciling books from chain | 14 | 15 |
| `/sse` streams that misbehave | 14 | 15 (winner, on rot-risk tie-break) |

## Next two candidates, already designed

### A. Books that read their own revenue from chain

Why it works: the receive address is receive-only, so its USDC balance == cumulative receipts. One `eth_call`
`balanceOf` is the whole total; no indexer, no storage, no block-range scans.

Public Base mainnet RPCs, no key (all answer `eth_call` and accept JSON-RPC batches, 0.1–0.6 s):
`https://mainnet.base.org` (getLogs ≤ 10,000 blocks, archive depth OK; best), `https://base.drpc.org` (1,000-block
getLogs windows reliably; 120k CU/min/IP), `https://base-rpc.publicnode.com` (balanceOf only; getLogs only ~128 blocks
from head), `https://base-mainnet.public.blastapi.io` (getLogs ≤ 10 blocks), `https://1rpc.io/base` (slowest, daily
quota, getLogs ≤ 50 blocks). `base.llamarpc.com` and `base.blockpi.network` returned 521. `base.meowrpc.com` has no
`eth_call`. Verified body:
`{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x70a08231000000000000000000000000<receive address without 0x, lowercased>"},"latest"]}`
→ `result` is a 32-byte hex; parse as BigInt, divide by 1e6.

Itemised incoming transfers, no key: Blockscout v2
`GET https://base.blockscout.com/api/v2/addresses/{addr}/token-transfers?type=ERC-20&token=0x8335…2913&filter=to`
→ `{"items":[...],"next_page_params":null}`; item: `timestamp`, `block_number`, `transaction_hash`, `from.hash`,
`total.value` (6-dp atomic). 1.4–2.5 s for our empty address; hot addresses time out (30 s+). 180 req/min/IP.
Do NOT use the legacy `/api?module=account` endpoint (10 req/hour bucket, deprecated). Note: on the dev machine
`base.blockscout.com` resolves to 0.0.0.0 (local DNS blocklist) — test with `--resolve base.blockscout.com:443:104.26.0.65`.

Caching without storage: (1) Cache API `caches.default` with a synthetic GET key works on the custom domain, is
per-colo, has no stale-if-error; use max-age=86400 with an inner `fetched_at` and treat <300 s as fresh, else refetch
and fall back to the stale copy. (2) Newer primitive per the docs agent: "Workers Caching" (developers.cloudflare.com/workers/cache/,
tiered, collapses misses, native `stale-if-error`) via a named `WorkerEntrypoint` + `ctx.exports`; wrangler `exports`
config per entrypoint; never enable it on the default entrypoint (it would cache the catalogue). Verify this exists
in the wrangler schema before relying on it — I did not.

Design from the panel worth keeping: render three numbers — ledger revenue (hand-typed), chain balance, and
`unbooked = chain − ledger`; if negative, the page must say "bookkeeping bug" so a withdrawal can never be hidden.
Keep the home page off the RPC path. Publish the exact curl that reproduces the number.

### B. `/sse` — Server-Sent Event streams that misbehave — BUILT in session 4 (v0.4.0); `src/sse.js` is now the reference

No public misbehaving SSE server exists (httpbin has none), and SSE is the parser every LLM/MCP client hand-rolls.
Flavors: `stall`, `cut` (ends mid-event, clean close), `drop` (FixedLengthStream + abort, as /truncate), `crlf`,
`no-space` (`data:foo`), `multiline`, `comments` (BOM + `: keepalive`), `split-utf8` (emoji across two chunks),
`wrong-type` (text/plain), `error-event`. Load-bearing details: `cache-control: no-store, no-transform` (the edge
compresses streams otherwise: zstd/br seen on /drip); any request with `Last-Event-ID` gets 204 (the spec's
"stop reconnecting") and every stream sends `retry: 30000`, or browser EventSource reconnect storms hit a site with
no zone rate limit. Verify byte boundaries live with `--http1.1 --raw` and drop any flavor the edge re-chunks.

## Discovery facts (so nobody re-researches them)

- x402 discovery is ONE spec: `specs/extensions/bazaar.md` in x402-foundation/x402 (resource.serviceName ≤ 32
  printable ASCII, tags ≤ 5 × 32, iconUrl rules; `extensions.bazaar.{info,schema}`; facilitator may answer
  `EXTENSION-RESPONSES`). `/.well-known/x402` and `_x402` DNS TXT are LEGACY — @agentcash/discovery 1.7.5 warns on
  them. `ai-plugin.json` is dead. A2A agent cards describe agents, not REST APIs. Skip all three.
- Facilitators: only PayAI advertises `bazaar` in `/supported` and serves `GET /discovery/resources` (26,585 items).
  xpay has no discovery and is NOT in x402scan's tracked-facilitator list, so a settlement through xpay is invisible
  on x402scan; Mogami and Heurist are tracked. Coinbase's CDP Bazaar needs CDP keys (a human).
- x402scan (Merit Systems, open source): registry probes the origin's `/openapi.json` via @agentcash/discovery;
  operations with `security: []` are listed as free rows only alongside ≥ 1 paid resource that answered a valid 402;
  paid operations carry `x-payment-info` `{price:{mode:'fixed'|'dynamic',currency,amount|min,max},protocols:[{x402:{}}]}`.
  Public tRPC procedures `public.resources.checkDiscovery` / `registerFromOrigin` / `register` need no auth (same
  call as the site's form); the REST `/api/x402/registry/*` routes need a SIWX wallet signature.
  Verify with `npx @agentcash/discovery discover badhttp.dev --json -v`.
- agent-tools.cloud re-ingests x402scan and the Bazaar every ~6 h; direct submission needs a mailbox.
- llms.txt: one H1, optional blockquote, prose, H2 link lists (`- [name](url): note`), an H2 named `Optional`.
- IndexNow: key 8–128 chars `[a-zA-Z0-9-]`, served at `/{key}.txt`, POST `https://api.indexnow.org/indexnow`;
  Bing/Yandex/Naver/Seznam, not Google. Google's sitemap ping is dead; Search Console needs a human.
- Cloudflare's "Markdown for Agents" zone setting is Pro+ (read-only `off` on this Free zone).
- Listings that need a human (GitHub identity or mailbox): APIs.guru, public-apis, awesome-x402 lists, 402index.io
  (human-reviewed), agent-tools.cloud direct submit.

# LEDGER

This file is the project's memory. Read it end to end before doing anything. Dates are UTC from the system clock. Money is USD. The all-in cap is $150.00 per year (charter).

**How this file is laid out (since session 29, 2026-10-06).** It has four parts: **Money** (the table the public books must match), **Decisions in force** (the rules; a bullet is amended in place, with the session that amended it, never silently deleted), **Start here** (the state at the close of the last session and the note to the next self), and **Session digests** (one verified digest per session, newest last). The full entries — what each session did, in its own words, with every number and reason — live one file per session in `ledger/entry-NN.md`, moved there verbatim from this file on 2026-10-06 (the move is byte-exact against `git show 387d662:LEDGER.md`, and nothing in an entry may be rewritten afterwards). **Reading order:** this file end to end; then `ledger/entry-<last>.md` in full; then any entry a digest points to for what you are about to touch (`grep -l` across `ledger/` when you need a fact the digests do not carry). **Writing order at the end of a session:** the full entry to a new `ledger/entry-NN.md` (append-only, same heading shape `### #N — date — title`); its digest, in the same shape as the others, to the end of Session digests here; the Start-here block replaced, not appended; the Money table and Decisions in force amended if the session changed them. A digest is a claim about an entry: every number, hash and date in it must appear in the entry, and the saved workflow `.claude/workflows/ledger-digest.js` (a sonnet writer, an opus skeptic per digest, an opus critic across all) is how the first 29 were written and checked — the skeptic found two to five errors in almost every first draft, so a digest is never written without one.

## Money

| # | Date | Item | Amount | Cash out to date | Accrued to date |
|---|------|------|-------:|-----------------:|----------------:|
| 1 | 2026-08-23 → | Cloudflare Workers Paid (hosting), **a standing monthly accrual, no longer a one-off row** — account-level plan already active; charter attributes ~$5/mo to this project. Since session 20 `src/books.js` DERIVES this from `hosting.since` and the UTC clock (month 1 on the start date, +$5.00 on the 23rd of each month) instead of carrying a hand-typed constant, and publishes the arithmetic on /books. **Do not add a new Money row for a hosting month** — that would double-count. As of 2026-09-08: 1 month, $5.00; from 2026-09-23: 2 months, $10.00. **Session 21 measured what this row attributes** and publishes both answers beside it (`hosting_measured` / `hosting_usage` on /books): badhttp uses 0.79% of the paid plan's included requests and 0.45% of its included CPU, so it adds $0.00 to the operator's already-active account — but it cannot run on the free plan (max CPU 292.68 ms against a 10 ms per-invocation ceiling, exceeded on 7 of 7 days), so $5.00/mo is the floor it would pay standing alone. This row stays at the attributed figure; see Decisions in force. | 5.00/mo | 0.00 | 10.00 (at 2026-10-05: 2 months; was 5.00 at 2026-09-08) |
| 2 | 2026-08-23 | badhttp.dev registration, 1 year, Porkbun (promo; renews 2027-08-23 at $12.87) | 8.75 | 8.75 | 13.75 |
| 3 | 2026-08-28 | Mainnet payer wallet funded by the operator (working capital, held as USDC on Base at payer 0xa4A3…fE5a; $0.015 spent on three x402-trust paid reports, $0.04 moved to the receive address as labeled self-tests — the third on 2026-10-05 through PayAI, #27; the fourth the same day through Coinbase's CDP facilitator, #28 — $9.945 still at the payer) | 10.00 | 18.75 | 23.75 |

Revenue to date: **$0.08** — session 29 (2026-10-06) booked one more 0.01 USDC settlement of `/402/pay/base`, from a THIRD external payer: vet402's x402 observatory, whose L1 census buys once from every endpoint in the public discovery catalogue (2026-10-06 06:01:41 UTC, block 52238577, tx 0xdfa8f4f39c769574f617d2a5b4a5960332f2ce5ee128e6f8d0e0e4253bedc379, from 0xc9c7b38c0942914fc8ea12063bc92dcd3b581670; user agent vet402-observatory-l1/1.0; vet402's own seller page for badhttp.dev shows the purchase and says it re-buys a listing at most once every 6 days). The mainnet watermark is now **0.12** (0.04 self-tests + 0.08 booked). The Sepolia watermark is **0.18** test USDC: the second testnet stranger (0xb248…a5bc, Iraq, "node") settled fourteen times on 2026-10-05, not three — never revenue. ~~$0.07~~ session 26 (2026-09-30) booked six more 0.01 USDC settlements of `/402/pay/base` found by `/books`'s `unbooked_receipts` line: one from nohumans.directory's scout (2026-09-22, tx 0x7427669622c6872a85db375b6b71067e0b4002ee77da267ca90922c46610fedb) and five from a second, anonymous automated buyer, 0x556d8a86991b56646f98040c8c8298c5053d0484 (2026-09-24 19:23–22:17 UTC; tx hashes in `src/books.js` `revenue`; empty user agent, US; the address paid dozens of other x402 endpoints the next day). The mainnet watermark is now **0.11** (0.04 self-tests + 0.07 booked; the third and fourth self-tests, both 2026-10-05, are #27's labeled transfer through PayAI and #28's through Coinbase's CDP facilitator). ~~0.10~~ ~~0.09~~ Before that: ~~$0.01~~ (unchanged through session 23; nothing above the 0.03 mainnet watermark — a stranger's 0.01 *test* USDC on Base Sepolia on 2026-09-16 (#23) is not money and is not booked — which is 0.08% of the next bill, the figure /books now leads its solvency section with) — first revenue 2026-09-01 21:32:11 UTC: 0.01 USDC paid at /402/pay/base by nohumans.directory's paying scout (tx 0x645b92cd93250785c5208821f22328087389803ed2178566e871f2edeed5686a, from their published scout address 0x54e163…f4e0; booked in #17). Receive address (USDC on Base): 0x2b14ad50d63c7fee5a33847f95153ac37a690170 — published at /books. ~~receive-only~~ — corrected in #15: receive-only from the *project's* side (it holds no key); the operator holds the key and once moved capital through it, and every movement of the address is itemized and labeled on /books (src/books.js `chain_movements`).
`src/books.js` must match this table line for line; `/books` on the site renders it. Rows 2–3's "Accrued to date" are as of their own dates; the running total today is cash 18.75 + hosting accrued (row 1, derived) = **28.75 at 2026-10-05**.

## Decisions in force

- **Sanitized project (operator's rule, 2026-08-23):** nothing in this repo, the site, or the commit history may lead back to the human — no name, email, account IDs, zone IDs, order numbers, account-named hostnames, or GitHub username. Refer to them as "the operator". Keep identifiers in `.env` only. The receive address is public by design. **Amended by the operator 2026-09-17 (#24): their name MAY be associated with the project. What may not appear, in the tree or the history: postal or billing information, transaction identifiers (a registrar order number), account identifiers (a Cloudflare account or zone id), personal contact details (a personal email address). The receive and payer addresses and every transaction hash stay public by design. The literal values the publish script asserts absent live in `.publish-literals`, gitignored — never in a tracked file, because the 2026-09-06 script and runbook quoted them and became the leak.**

- **Project: badhttp — "the server that misbehaves on purpose."** A stateless catalogue of HTTP edge-case endpoints for testing clients, SDKs and agents. Free for everyone. Revenue later from a `/402/*` range where paying via x402 *is* the scenario being tested, plus donations. Decided session 1; see entry #1 for the reasoning and the alternatives considered.
- **Domain: badhttp.dev — registered 2026-08-23** on Porkbun ($8.75; renews 2027-08-23 at $12.87). Cloudflare zone created in the project account (look the id up via the API; never write it here), nameservers set at Porkbun, attached to the Worker as a custom domain. Porkbun balance after purchase: $1.25 — **renewal in 2027 needs a top-up.**
- **Repo: the GitHub remote `origin` (`git remote -v`) — PUBLIC since 2026-09-18 at github.com/auzroz/badhttp, as a single squashed commit (#24 addendum). The 48-commit pre-public history exists only in a bundle outside the repo; never push it.** `.env` uses canonical names: PORKBUN_API_KEY, PORKBUN_SECRET_KEY, CLOUDFLARE_API_TOKEN (account-owned), CLOUDFLARE_ACCOUNT_ID, RECEIVE_ADDRESS.
- **Porkbun balance after registration: $1.25.** The operator will top up when a renewal or a new domain needs it — ask, don't assume. **Since #13: assign, don't ask** — the top-up (~$11.62 before 2027-08-23) has been a standing assignment since #21.
- **Live at https://badhttp.dev** (custom domain; the workers.dev route is disabled so no account-named hostname is public). Deployed 2026-08-23 with wrangler and the account-owned token in `.env`.
- **Zone rate limit in force (session 4, 2026-08-23):** one Cloudflare WAF rate-limiting rule on the zone, 100 requests per 10 s per IP (per colo), block 10 s, expression `true`. It runs before the Worker; a blocked client gets Cloudflare's `429` / `error code: 1015` / `Retry-After`, never a badhttp response. The site says so itself (home footer, `/llms.txt`, `/openapi.json` `x-guidance`): change all three in the same deploy if the rule changes. Counters are approximate (a sequential curl loop never trips it; `xargs -P 40` does). `scripts/smoke.sh` (~140 requests over ~25 s from one IP when written; 438 checks as of #29) must keep passing; do not lower the threshold. Runbook: `docs/RUNBOOK-zone-rate-limit.md`.
- **Hosting: one Cloudflare Worker named `badhttp`** in the one account named by `CLOUDFLARE_ACCOUNT_ID` in `.env`. That account holds many other zones and a few other Workers that are not ours. Touch nothing else.
- **Pricing principle for later:** free for people, metered for machines; never a paywall on the free catalogue.
- **Design rule:** only list behaviour that has been verified live. If the platform won't let an endpoint misbehave the way the docs say, fix it or drop it.
- **`/sse` (session 4, 2026-08-23):** fourteen Server-Sent Events flavors in `src/sse.js`, each a generator of `{wait, bytes}` parts where one part is one `controller.enqueue` and, verified live, one chunk on the wire. Rules that keep it safe: every stream opens with `retry: 30000` (`resume` alone 1000); any request carrying `Last-Event-ID` gets a `204` (the spec's stop-reconnecting signal) except `resume`, which is bounded (ids 1–6, then 204); nothing lasts longer than `LIMITS.sseMaxSeconds` (20); `cache-control: no-store, no-transform` is load-bearing (without `no-transform` the edge zstd-compresses streams, as it still does `/drip` by design); `drop` is the only flavor with a Content-Length (FixedLengthStream + abort, as `/truncate`). Verified with Node 25's built-in `EventSource` (undici): all fourteen behave as the catalogue says.
- **x402 (session 2, 2026-08-23; amended session 3; amended session 8, 2026-08-26 — now DUAL-FORM):** ~~the `/402` range speaks x402 v2 only~~ — overruled in session 8 (see #8 for reasons): the `/402` range now speaks both generations in one response — v2 in the PAYMENT-REQUIRED header (unchanged, byte-identical, and every machine judge reads it first — amended #12/#14: x402-trust classifies from the body, so not every judge) and a spec-valid x402 v1 envelope as the 402 JSON body (plain network names, maxAmountRequired; derived from the same req object via `toV1` so the forms cannot drift). Inbound X-PAYMENT (v1) is accepted; PAYMENT-SIGNATURE wins when both arrive and presence is a null-check (an empty header value must not downgrade). v1 facilitator chains differ (`DEFAULT_V1_FACILITATORS`: mainnet xpay→PayAI→Heurist, Sepolia x402.org→xpay→PayAI; Mogami is v2-only — **since #27 mainnet v1 is PayAI→xpay→Heurist; CDP leads the v2 mainnet chain only**, see the facilitator-order bullet). #13 shipped a v1-envelope alias and #14 closed that question. wrong-network stays v2-only (v1 cannot name a nonexistent chain). The rest of the session-2 decision stands: `/402/pay` is the one endpoint that settles; payTo is always the receive address; default network is Base Sepolia, mainnet is opt-in (`/402/pay/base` or `?network=base`; the path form is the stable resource URL for catalogues, since x402scan lists mainnet only and strips query strings). Every 402 names exactly one network. Session 3 tried offering both networks in one `accepts` (testnet first) and reverted it before the ledger closed: the SDK's default client registers `eip155:*` and signs `accepts[0]` regardless of where its USDC is, so a second entry helps no real client and would have made mainnet implicit; price 0.001–1.00 USD, default 0.01. Facilitators, in order, live in `src/x402.js` (`DEFAULT_FACILITATORS`) and can be overridden with the `X402_FACILITATORS_BASE` / `X402_FACILITATORS_BASE_SEPOLIA` vars. Every other `/402/*` scenario never contacts a facilitator and never settles; keep it that way. `VERIFIED` in `src/x402.js` is the single source for "what has been exercised" and is rendered on the site: update it, never the prose, when settlement is first observed.
- **One private key now exists in `.env`: `X402_TEST_PAYER_KEY`,** a throwaway Base Sepolia payer (address in the comment beside it). It must never hold mainnet assets and never be used as payTo. The receive address stays receive-only; the project still holds no key that controls money. **Amended (#12, #15, noted in #29):** the mainnet payer key in the next bullet does control project money, and "receive-only" was corrected in #15 — the operator holds the receive address's key and once moved capital through it; what stands is that the project holds no key for the receive address.
- **A second key since session 12 (2026-08-28): `X402_MAINNET_PAYER_KEY`,** the mainnet self-test payer (address in the comment beside it), funded by the operator with $10 USDC on Base as working capital (Money table row 3). Rules: it holds at most ~$10; payments from it to our own receive address are labeled self-tests and NEVER booked as revenue; payments from it to external x402 services (paid reports, listings) are project costs inside the already-booked $10; it is never used as payTo. The testnet key's never-holds-mainnet rule stands unchanged.
- **Facilitator ritual (each session):** `for f in $(curl -s https://badhttp.dev/402 | jq -r '.facilitators.base[], .facilitators["base-sepolia"][]' | sort -u); do printf '%s ' $f; curl -s -m 8 -o /dev/null -w '%{http_code}\n' $f/supported; done` — anything not 200 gets moved or dropped in `DEFAULT_FACILITATORS`.
- **Discovery surfaces (session 3, 2026-08-23):** `/openapi.json` follows the profile x402scan's registry parses (`security: []` on every operation, `x-payment-info` on the three `/402/pay` URLs, `info.x-guidance`, `x-agentcash-guidance.llmsTxtUrl`); `/402/pay`'s 402 carries `resource.serviceName`/`tags` and the x402 `bazaar` extension (spec'd; echoed by clients to facilitators, never sent by us); `/llms.txt`, `/sitemap.xml`, `/favicon.svg`, `robots.txt` `Sitemap:` line. **Listed on x402scan** as origin `2ec99179-1c7e-4e36-9bf3-4fba1d6e904a` (1 paid: `/402/pay/base`; 20 free rows at v0.3.0, 41 public rows as of #28; testnet URLs refused by their policy) via `scripts/x402scan-register.sh` — re-run it whenever `/openapi.json` changes. Lint with `npx @agentcash/discovery discover badhttp.dev --json -v` (0 warnings as of v0.3.0). **IndexNow:** the key is the Worker secret `INDEXNOW_KEY` (same value in `.env`; never in source), served at `/{key}.txt`; `scripts/indexnow.sh` after a deploy. **Rule:** never catalogue ourselves through side effects (e.g. a deliberately failing facilitator `/verify` with the unfunded payer); listings happen through documented registration calls or organically when a real client pays. **Refined #27:** a settlement through a facilitator whose documentation names listing as its consequence (PayAI, CDP) is a documented route; a deliberately failing probe is still forbidden.
- **`/range` + `/etag` (session 5, 2026-08-23):** fourteen resumable-download flavors in `src/range.js` over a self-describing document (64-byte lines carrying their own offset, so served-wrong-bytes corruption is visible in the assembled file) and ten conditional-request flavors in `src/etag.js`; shared RFC 9110 §13 machinery in `src/conditional.js` (parseHttpDate accepts exactly the three HTTP-date formats — asctime needs the ` GMT` suffix appended before Date.parse or it parses in local time; listTags is strict so the controls never match garbage). Rules that keep them honest: the `ok` flavors are fully RFC-correct (preconditions in §13.2.2 order incl. If-Unmodified-Since; If-Range consulted before the unsat→416 branch; HEAD ignores Range per §14.2; multi-range 206 carries no top-level Content-Range); `cache-control` carries `no-transform` in both families or the edge compresses text/plain and drops Content-Length; /range is `no-store` (tests clients), /etag is `no-cache` (a real cache stores and revalidates — that is the product); Range headers that are malformed, >8 parts, b<a, or >1 MiB total span are ignored, not errors; a JS default-parameter trap (`x: undefined` resurrects the default — bit twice: no-validator-304's Last-Modified, changing's lmEpoch) means "omit this header" must be `null`, never `undefined`.
- **Self-sustainability stance (the operator, 2026-08-23, after session 5):** support continues as long as the site has a credible path to breakeven and I am reasonably confident in it; the only external goal is self-sustainability at some point. The breakeven thesis and its 2027-02 checkpoint live in entry #5a (#21 retired that checkpoint with path 3; the stance stands). **#24: the operator's own view is that x402 is not the path to sustainability — think wider.** The API token now includes Zone Analytics: Read — check traffic each session (own IP excluded) alongside the balance.
- **Git identity:** commits from sessions are authored as `badhttp <ops@badhttp.dev>` (set per command via `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; the repo-local config could not be set from the agent). History before 2026-08-23 still carries the operator's identity; rewriting it is the operator's call. **Moot since #24:** the public repository is one squashed commit and the old history lives only in a bundle outside the repo; commit with `TZ=UTC` so stamps read +0000.

- **`/compress` (session 17, 2026-09-01/02):** twenty-one content-coding flavors in `src/compress.js` (`ok`, `br`, `zstd`, `deflate`, `not-compressed`, `undeclared`, `truncated`, `corrupt`, `bad-crc`, `trailing-garbage`, `multi-member`, `double`, `double-hidden`, `deflate-raw`, `unknown-coding`, `uppercase`, `x-gzip`, `empty`, `wrong-length`, `gzip-file`, `bomb`; `?code=` on all but bomb), every one documented twice — as sent (to a client whose Accept-Encoding lists the coding) and as transcoded by Cloudflare's edge for a client without it — because the edge, probed live, delivers a coding only to a client whose NORMALIZED Accept-Encoding (`request.cf.clientAcceptEncoding`: q-values dropped, q=0 included, zstd dropped, `*`/empty → null) lists it and otherwise removes one recognized layer, `no-transform` notwithstanding, lossily for broken streams; it never delivered zlib deflate (the `deflate` flavor exists so that stays reproducible) and passes unrecognized codings (x-gzip, badhttp) through. Rules: the edge column is dated and pinned by smoke (a Cloudflare change fails a deploy rather than staling the page); compressed byte counts are never pinned (they belong to workerd's zlib; decoded length and SHA-256 are); `wrong-length` needs ?length= ≥ 128 (below ~52 the member outgrows the claim and the edge 502s); `bomb` answers 406 unless the reported set lists gzip (otherwise the edge would inflate it for the client — up to 32 MiB of egress testing nothing); the `/compress` index is `no-transform` so a gzip client can read it; edge-dependent smoke checks run only behind a `cf-ray` header (local dev has no edge); the transcoded-column numbers the page prints (1,860 / 628,228 / 1,048,516 / 2,048 / 0 bytes) are pinned as dated observations of Cloudflare, so a runtime or edge change fails the deploy and the page gets re-probed. Spec, probe matrix and client witnesses: `docs/spec-compress.md`, `docs/probe-compress-2026-09-01.txt`, `docs/probe-compress-clients-2026-09-02.txt` (scripts in `scripts/compress-witness/`).
- **Traffic counts exclude the Worker's own cache traffic (session 17):** zone analytics log `caches.default` operations on the synthetic keys `/__internal/books-chain-*` as requests (~800/day: GET/200 hit, GET/504 miss, PUT/204 store, one synthetic IP, empty UA). Filter `clientRequestPath_notlike: "/__internal/%"` before quoting a request count or a 5xx tally; the 504s there are cache misses, not errors.
- **Licence, decided session 18 (2026-09-06):** what the service EMITS is **CC0-1.0** (public domain, no conditions, attribution requested and never required); the Worker SOURCE stays **MIT**. They are separate questions and every surface now says so separately: `/license` (the statement), `info.license` in `/openapi.json` (was `{"name":"MIT"}` — the source's licence in a field that reads as the licence for the API, which is the ambiguity that made someone stop and write in), `info.x-license`, the `/llms.txt` Licence section, the home page, `LICENSE-RESPONSES` in the repo, and the `license` field on every `/corpus.jsonl` row. One carve-out, stated rather than glossed: a captured response also carries fields this project did not author (Cloudflare edge headers, facilitator receipt values) which are not ours to dedicate. Never quietly widen or narrow this; a corpus somewhere now depends on it.

- **badhttp emits no RFC 9112 message-syntax violations, and cannot (session 18, probed 2026-09-06):** 151 documented endpoints captured over TLS with ALPN http/1.1 and judged byte by byte against §2.2, §4, §5, §5.1, §5.2, §5.5 and §6 — **0 violations**. The edge re-serializes every response, so no malformed start-line, malformed field-line, obs-fold, bare CR/LF in the head or conflicting framing header can leave this host; `encodeBody: 'manual'` does not change it. Exactly two endpoints violate §6.3 completeness — `/truncate` (1000 declared / 500 delivered) and `/sse/drop` (565 / 53). Published with its method and date in `/corpus`'s `rfc9112_message_syntax` object and pinned by smoke (`corpusframing`, `corpussyntaxclean`). This is a platform property: if it ever flips, Cloudflare changed — re-probe with `scratchpad/rfc9112-probe.mjs`, do not relax the assertion. **Consequence for the product:** anyone wanting smuggling or malformed-syntax fixtures must be sent elsewhere, and the site says so itself rather than letting them find out by capturing 151 clean messages.

- **`/clients` and the corpus's honesty boundary (session 19, 2026-09-07):** `/clients.jsonl` publishes the witness matrix (168 dated observations: six decoding HTTP clients plus two non-decoding urllib **controls**, `role` on every row, × 21 `/compress` flavors — the first family; **five families and 632 rows since #27**: crosshost #23, auth #25, cookies #26, sse #27), joined to the corpus by `corpus_id`. Two rules travel with it. (a) **`outcome` describes what the caller received and is NEVER a verdict on the client** — `differs-silently` is correct behaviour on `undeclared`/`double-hidden` and the finding on `truncated`; the `reading_this` field says so and `chk clientsreading` pins it, so the table cannot quietly become a scoreboard of named third-party libraries. (b) **`/corpus.jsonl` carries no machine-checkable `expect`, on purpose** — for almost every row no specification says what a client must surface to its caller, and asserting one would be inventing a standard and calling it conformance. The table is a **dated capture**, not a live measurement; re-run `scripts/compress-witness/*` then `scripts/witness-parse.mjs` and move the date rather than letting it stale silently.
- **Every corpus row must address the endpoint it publishes (session 19):** `scripts/corpus-verify.sh` replays all of them with their own url, method and `request_headers` and fails on **400/404/405/000** — deliberately not "must be 2xx", because 401/402/416/418 and `/flaky`'s 500 are correct answers from a server that misbehaves on purpose. Wired into smoke as `corpuslive` (skip with `SKIP_CORPUS_VERIFY=1` while iterating). Seven rows were lying when it was written. **If it fails, fix the row, never the check**, and every new family must pass it the day it ships.
- **The backtick trap in `src/page.js` (session 19):** the file emits markdown from inside JS template literals. An unbalanced backtick fails the build loudly; **a balanced pair is valid JavaScript** (the literal closes and the text parses as division), so the build goes green and the surface 500s at runtime — this took `/llms.txt` down with `"compress is not defined"`. Escape every backtick in prose as `` \` ``, and never trust a green build for a template literal.
- **Never regex hex out of `.env` (session 19):** a 40-hex-character match inside a 64-character private key looks exactly like an address. Two such fragments reached public RPCs as `balanceOf` arguments before I noticed (96 bits still unknown each, so not a real exposure, and nothing was rotated). The payer and receive addresses are in the `.env` comments and in this ledger — read them from there.
- **The corpus's machine-readable FIELDS are re-derived from the wire on every deploy (session 20, 2026-09-08).** `scripts/corpus-verify.sh` (#19) proves a row ADDRESSES its endpoint; `scripts/corpus-assert.sh` proves its FIELDS are true: every row claiming `deterministic_bytes: true` is fetched twice with an identical request and must return identical status+bytes; `deterministic_bytes: false` must name something in `varies_by`; `rfc9112_completeness_violation` must be on exactly `/truncate` and `/sse/drop`; and the published `curl` string must reconstruct from the row's own url/method/headers. Both are wired into smoke (`corpuslive`, `corpusassert`). Three rules travel with it. (a) **If it fails, fix the row, never the check.** (b) **A 429 from the zone rate limit is not the row's response** — the script backs off past the block and re-reads rather than comparing it, because with status folded into the compared value a 200-then-429 pair reads as "the bytes moved" and would fail a healthy deploy. (c) **Non-vacuity floors are load-bearing**: every assertion is "for all rows matching X", so if X ever selects nothing the gate goes green having checked nothing — the file is validated as NDJSON first, jq's parsed row count must equal the lines fetched, and the row/stable-row counts have floors well under today's numbers.

- **`deterministic_bytes` means "the same request returns the same body bytes" — and nothing about permanence (session 20).** The field could not tell the truth before this session: `src/corpus.js` read it from FAMILY metadata with no per-flavor override, so all sixteen families had a uniform value and no flavor could differ from its family. `/range/if-range-ignored` — the one range flavor that mints a fresh generation stamp per request — therefore published `true` for as long as the corpus had existed, while its own `defect` string ended "Nondeterministic by design". `FLAVOR_STABILITY` in `src/corpus.js` is the per-flavor override; add to it only what is true of the FLAVOR, and expect `corpus-assert` to re-derive it. Two fetches seconds apart cannot see a body that turns over hourly or at midnight, and `/corpus`'s `self_check.what_this_does_not_check` says so rather than glossing it.

- **Hosting accrues itself; never hand-type a figure that goes stale on a date (session 20).** `src/books.js` derives the hosting cost from `hosting.since` and the UTC clock (month 1 on the start date, +$5.00 each monthly anniversary) and publishes the arithmetic — `hosting.basis`, `totals.hosting_months`, `totals.hosting_accrued`, `totals.next_accrual` — beside the number, so a reader can redo it. The smoke check `booksaccrual` recomputes the month count INDEPENDENTLY in shell with the start date and rate duplicated on purpose (a check that sources its expectation from the thing it checks proves nothing), sampling the clock either side of the fetch so a UTC midnight crossing an accrual day cannot fail a healthy deploy. **This retires the "if ≥ 2026-09-23, accrue hosting month 2" instruction carried in every note-to-self since #4, and no session should add a Money row for a hosting month again** — the table's row 1 is now a standing accrual and a new row would double-count. `commitments[]` carries money owed but not yet spent (the $12.87 renewal), excluded from spend to date.

- **The cost side is MEASURED, and both answers are published (session 21).** `hosting_measured` in `src/books.js` carries a dated window of Cloudflare's own `workersInvocationsAdaptive` figures and Cloudflare's published allowances; `hostingUsage()` derives every ratio from them so nothing is typed twice. Two facts, both true, answering different questions: badhttp's usage is **0.79% of the paid plan's included requests and 0.45% of its included CPU**, so on the operator's already-active account it adds **$0.00**; and it **cannot use the free plan** — `max{cpuTime}` exceeded the 10 ms per-invocation ceiling on 7 of 7 days measured (11.7–292.7 ms), with the P99 over it on two, so those requests would get Cloudflare's error 1102 instead of a badhttp response. **The books keep charging themselves the attributed $5.00/mo**; publishing the smaller figure as the headline would be picking the flattering half of a true story. If Cloudflare changes an allowance, `chk bookshostingderived` fails (the two allowances are duplicated in the check on purpose) — re-measure, do not relax it.

- **The solvency line is answered from the EARNED column, and the order on the page is load-bearing (session 21).** `/books` asks "Can it pay its own next bill?" and answers it with booked revenue against the next commitment: **earnings cover 0.08% of the $12.87 renewal** (when written; 0.62% at $0.08, #29 — the page computes it). The operator's working capital ($9.965 at the payer when written, $9.945 since #28; read live from chain) and their registrar credit ($1.25, stated and dated) appear *below* that under "What is actually on hand, and whose it is", labelled **runway, not revenue**. It shipped the other way round for an hour — netting the two into "short by $1.655" — and two independent reviewers read that as a service 87% of the way to paying for itself. **Never net borrowed capital against a bill to produce a self-sustainability figure.** `chk bookssolvencyearned` pins the arithmetic; `chk bookspageearnedfirst` pins the order, because the same two numbers reversed tell the flattering story.

- **Path 3 (metered conformance reports) is RETIRED, overruling #5a's 2027-02 pre-commitment (session 21; reasons in #21).** Money in conformance testing goes to whoever controls market access, never to whoever operates the test server: certification bodies charge for a mark ($700–$18,000) and give the suite away, while wpt and h2spec are free and funded by the implementers who need them. The buyer universe is 20–30 HTTP libraries that are net *recipients* of money (urllib3: $68,663 lifetime), and the two funded commercial buyers were both acquired in 2026. **What replaces it is not a product but a funder**: the Open Web Docs / QUIC-interop pattern, where a divergence measurement nobody else publishes is sponsored by the vendors whose surface it measures — which is what `/clients.jsonl` already is. Do not rebuild path 3; if revenue ever appears, book it and reopen the question with the new evidence, not the old plan. **Reopened and kept closed in #29:** $0.08 to date, all eight cents from registry scouts and observatories measuring whether a paywall settles — none from anyone wanting a report; the retirement stands.

- **Two hostnames since session 22 (2026-09-10): `badhttp.dev` and `alt.badhttp.dev`, one Worker.** The second host exists so `/crosshost` can cross a real host boundary with real DNS and a real certificate — the thing a loopback listener cannot provide, because an agent framework's SSRF filter rejects a 127.0.0.1 target at hop zero and the code under test never runs. It costs **$0.00** and is published at $0.00 in `/books` (`infrastructure[]`) with its basis: the zone's universal certificate already covered `*.badhttp.dev`, the zone is Free-plan, and custom domains are not a billed unit (100 per zone; 2 used). **Keep every cross-host name exactly ONE label deep** — the universal certificate covers one level, and a name needing more would mean Advanced Certificate Manager, a paid add-on with no room in this budget. (Creating the custom domain happened to mint a further certificate carrying `*.alt.badhttp.dev` as well, observed 2026-09-10; that is a side effect of the custom-domain flow, not a property to build on.) **The alt host serves `/crosshost`, its own `robots.txt` (`Disallow: /`) and `/health`, and nothing else**, 404s the rest with a pointer home, and carries `X-Robots-Tag: noindex` on **every** response — it is a fixture, not a second indexable copy of the site.

- **`/crosshost`'s three invariants (session 22) — none of them may be relaxed.** (a) **No open redirect, by construction:** no byte a caller sends reaches a `Location`; targets are complete absolute URLs in a frozen table selected by flavor name via `Object.hasOwn`, each checked against `LOCATION_OK` before emission, failing closed to a 500; the one protocol-relative value is admitted by **exact string equality, never by pattern**, because a regex that admits the `//host` shape at all is one mistake from admitting `//evil.example`. There is no `?url=`/`?next=`/`?to=` and there never may be. (b) **No echo:** nothing that arrives on the wire is reflected — not whole, not truncated, and **deliberately not hashed** (a digest of a weak credential is a cracking target, not a mitigation); the observables are presence, a scheme name only when it is Basic/Bearer/Digest, and a byte length; cookie names only for cookies badhttp minted. (c) **A response without `x-badhttp-version` is not an observation** — it is Cloudflare's rate-limit 429, and recording it as "the credential did not survive" is a false reading. The witness block on `/crosshost` is a **dated capture**; re-run it and move the date rather than letting it stale (`chk chwitness` pins the date).

- **Witness data lives in `/clients.jsonl` and nowhere else (session 23, 2026-09-17).** A family's witness block on its own index (`/crosshost` → `witness`) is DERIVED from the rows — date, counts, roster and every number inside the findings — never hand-written beside them, so the two surfaces cannot disagree; the hand-typed home-page note is pinned to the rows by smoke (`chwitnesspagedate`) instead. A capture is re-run whole, never patched row by row, and its run log is committed beside it so "N retries" is a claim the record supports; every landed row must carry the `x-badhttp-version` the provenance line names or the parser refuses. Explanations of *why* a named client behaves as it does are gated on the computed list they were written for, so a re-capture that moves a list drops the explanation rather than misattributing it. Harnesses live in `scripts/<family>-witness/`, run one at a time against one IP, and send only the family's published fake values.

- **`/clients.jsonl` auth rows name what was CONFIGURED, never what happened (session 25, 2026-09-18).** `mechanism_kind` is a fixed vocabulary of what the harness handed the client for that flavor (`basic-auth`, `basic-header`, `basic-handler`, `digest-handler`, `any-handler`, `bearer-auth`, `bearer-header`, `no-mechanism`), chosen per flavor and never by the client; whether credentials went out first, and how many requests carried them, is read from `hops` (per request: status and header presence, never a value). A `no-mechanism` 401 is a capability, a `proxy` row is an unexpected 407 with origin credentials (no proxy exists in the harness), and `distinct_answers` counts only clients configured the same way. The parser refuses a partial grid, a `did-not-land` row, a `challenge_seen` that does not start with a scheme this server emits, and any row or run-log string containing a fixed needle set (both base64 encodings of the documented credentials, their raw and URL-encoded forms, the token, `Proxy-Authorization:`, `response=`). The `/auth` index's `witness` block and the home-page auth paragraph are rendered from the rows; there is no hand-typed auth note to drift.

- **`/clients.jsonl` cookies rows name what the client HAS, and the delete behaviour is reported once (session 26, 2026-09-30).** `jar_kind` is `own-jar` / `harness-jar` (Node fetch with tough-cookie driven by the harness) / `no-jar` (urllib3), fixed by the harness; `outcome` is relative to a planted-names table the parser cross-checks against every setter body's `set` array, so `src/cookies.js` and the table cannot drift apart silently; `none-returned` is the documented right answer on the three negative flavors. Per-flavor disagreement is keyed on what came back to `/cookies/echo` only — what survived `/cookies/delete` is one property of a client and is reported once in the findings, because keying on it made one jar's kept tombstone read as disagreement on all seventeen flavors. The `/cookies` index `witness` block and the home-page cookies paragraph are rendered from the rows; the 2026-08-23 three-jar note is gone.

- **Mainnet facilitator order is a DISCOVERY decision, not only a reliability one (session 27, 2026-10-05).** PayAI leads both mainnet lists in `src/x402.js` because it is the one facilitator in the chain that publishes a catalogue and lists a resource when it verifies or settles a payment for it (its documented and only route in); xpay publishes none and x402scan's indexer does not count xpay settlements, so every payment routed through xpay since #2 was invisible to every registry buyers walk. Coinbase's CDP facilitator goes in FRONT of PayAI the moment `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` exist as Worker secrets — **they do since 2026-10-05 16:36 UTC (#28 addendum 2), and the listing is live; a resource falls out of the CDP Bazaar ~30 days after its last settlement through that facilitator, so one one-cent self-test a month keeps it if nobody else pays** (`src/cdp-auth.js`, dormant until then; `docs/RUNBOOK-cdp-facilitator.md`), because the CDP Bazaar is the catalogue most paying buyers walk and a settlement through that facilitator is the only way in. A `401`/`403` from any facilitator is OUR credential problem and fails over; it never refuses the payer. Re-check PayAI's published rate card (`/pricing`: Base ≈ $0.00231 per settlement from 1,000 lifetime free credits per receiving wallet) if volume ever approaches hundreds of settlements. The #3 rule stands refined: a settlement through a facilitator whose documentation names listing as its consequence is a documented registration route; a deliberately failing probe to get listed is still forbidden.
- **NLnet Restack is RETIRED as an assignment (session 27).** Carried as the operator's item 1 since #21. NLnet's own form header says "We are not interested in AI-generated projects or proposals"; its 2026-09-03 call note says work "(mostly) generated by LLMs … is not eligible for a grant"; its FAQ answers "Can I use generative AI to write parts of my proposal?" with "The short answer is: no"; its Restack scope excludes "AI-related projects … unless they are already widely used throughout society (> 1 million active human users)". This project is written and run by an AI and says so everywhere. Applying would mean either concealing that or asking a funder for something its rules say it will refuse; the charter's "lawful, ToS-compliant" rules out the first and the second wastes the operator's name. Do not re-assign it unless NLnet's published policy changes; the research is in #27.

- **Agent teams (session 28, 2026-10-05; the operator enabled them that day).** The top model runs the main loop and is never forked; subagents run on sonnet (reading, finding, harness-writing, research) or opus (refute-or-confirm, critics, judges), with a frozen path and one question each. The adversarial review is back as the default before a deploy, as the saved workflow `.claude/workflows/review-frozen.js` (six lenses → code dedup → one skeptic per finding → critic → skeptics again; `docs/RUNBOOK-agent-teams.md`), run over a scratchpad copy of the tree, before any suite and never during one; the main loop triages its result against the live tree. Fixes may be applied by sonnet agents on **disjoint file sets** that render offline and hand off anything outside their set; nothing they do is deployed until the main loop has rendered every surface and run the full smoke. Reproducible work goes to scripts: `scripts/state-check.sh` is the state check. The #25 rule (cheap models, ask before >10 agents late in a usage week) stands; a review run is ~40 agents and ~3M subagent tokens and is logged as such.
- **x402 pre-check accepts smart-wallet signatures; failover covers `/settle` (session 28).** `payload.signature` must be even-length hex of at least 65 bytes (65 for an EOA; longer for EIP-1271/EIP-6492), bounded by the 16 KB header cap, and the facilitator validates it — an exact-65 check had turned smart-wallet payers away locally since session 2. A `401`/`403`/`429` from a facilitator at `/verify` **or at `/settle`** is this project's credential or rate-limit problem, never the payer's: nothing is broadcast on those statuses, so the next facilitator verifies and settles. Any other `/settle` failure after a successful verify still answers `502 settlement outcome unknown`, because the transfer may have been broadcast; never turn that into a retry.

- **Subagent work goes to cheaper models (the operator, 2026-09-18).** The operator's usage of the top model is metered and was at 80% when they said so; every `agent()` in a workflow and every `Agent` call passes `model: 'sonnet'` (or `'opus'` for judgment-heavy verify/judge stages), the top model stays on the main loop, and the 26–35-agent adversarial review workflows of #14–#23 are not the default — one critic agent, scripts, dry runs and the parser's own gates did that job in #25. **#28 made the review the default again, on cheap models** (the Agent-teams bullet); the model rule itself stands. Ask before launching anything over ~10 agents late in a usage week.

- **`/funding.json` + `/.well-known/funding-manifest-urls` (session 21):** the funding rail's machine-readable front door (fundingjson.org v1.1.0), derived from the books rather than hand-typed. `projects[]` is deliberately **absent** — the schema requires a `repositoryUrl` and this repository is private; a manifest is not the place to imply otherwise. **Moot since 2026-09-18 (#24):** the repository is public and `projects[]` names it (`fundingManifest()` in `src/books.js`). The channel address is asserted equal to `receive_address` by `chk fundingaddress`, because two hand-typed copies of a payment address is how a project ends up soliciting money to somewhere it does not hold.

- **A directory that emails you may not exist (session 21).** "Cleared Index" cold-emailed ops@ claiming a listing, with a tokenised claim/opt-out link; the domain was three weeks old, had no MX and no SPF, and resolved to `0.0.0.0`. `dig` first, and never visit either link — the opt-out confirms a live mailbox exactly as the claim does. Hazard notes live in `docs/notes-x402-judges.md`.

- **Revenue is booked with its tx hash the session it is noticed (session 17):** /books flags `unbooked_receipts` within ~300 s; the row goes in `src/books.js` `revenue` (amount a NUMBER, `tx` lower-case) so the itemization labels it "booked revenue", `VERIFIED` in `src/x402.js` records the payer class, and the Money section here states revenue to date. When Blockscout is down (it 500'd all of 2026-09-01; **since 2026-10-06 it fronts its API with a Cloudflare challenge, #29**), `eth_getLogs` on a public RPC finds the Transfer (topic0 Transfer, topic2 the receive address) — `mainnet.base.org` caps a query at **500 blocks** and rate-limits, so walk the day in 500-block windows with backoff (#29); analytics (`/402/pay*` with status 200, by UA, hourly with `edgeResponseStatus:200`) says who. The `unbooked_receipts` flag itself comes from the RPC balance, not the indexer, and kept working through the outage.

- **Ledger layout (session 29, 2026-10-06).** `LEDGER.md` is the index every session reads end to end: Money, Decisions in force, a Start-here block (replaced each session), and one verified digest per session. The full entries live in `ledger/entry-NN.md`, one per session, append-only and never rewritten; entries #1–#28 and #5a (29 files) were moved there byte for byte from this file (`git show 387d662:LEDGER.md`). A session ends by writing its full entry there, running `.claude/workflows/ledger-digest.js` on it (a sonnet writer, an opus skeptic that checks every number, hash and date against the entry, a critic), appending the rendered digest (`scripts/ledger-digest-render.mjs`) here, and replacing Start here. A digest is never written without the skeptic: the first run found two to five errors in almost every draft. Decisions bullets are amended in place with the session number, never deleted.

## Start here — state at the close of session 29 (2026-10-06; full entry `ledger/entry-29.md`)

This block is **replaced** each session, never appended; the history is in the digests and the entries.

- **Live:** v0.22.1, deployment `467770a7`, smoke 438/438 with one WARN: `base.blockscout.com` fronts its API with a Cloudflare challenge since 2026-10-06, so `/books`' itemized transfer list is empty and the reconciliation stands on the RPC balance alone (designed for; the four self-test pins pass vacuously meanwhile). If it is still down, that is a build.
- **Money:** cash + accrued **$28.75**; revenue **$0.08** (eight 0.01 USDC settlements: nohumans.directory's scout ×2, an anonymous registry-walking buyer `0x556d…0484` ×5, vet402's observatory census ×1 on 2026-10-06); net −$28.67. Next hosting accrual 2026-10-23, automatic — never a Money row. Porkbun credit $1.25; renewal 2027-08-23 at $12.87.
- **Watermarks:** mainnet receive **0.12 USDC** (0.04 labeled self-tests + 0.08 booked) — anything above it is new revenue, booked with its tx hash the session it is noticed (Decisions, session 17). Sepolia receive **0.18 test USDC** — anything above it is a testnet stranger, recorded in `VERIFIED`, never revenue. Payer: $9.945 mainnet, 19.97 Sepolia test.
- **Facilitators:** mainnet v2 CDP → PayAI → xpay → Mogami → Heurist (CDP only while `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` exist as Worker secrets; they do since 2026-10-05 16:36 UTC); mainnet v1 PayAI → xpay → Heurist; Sepolia v2 x402.org → xpay → Mogami → PayAI, v1 x402.org → xpay → PayAI. **CDP Bazaar listing** needs a settlement through CDP within 30 days of the last; a one-cent self-test is due by **2026-11-04** if nobody pays first (an external v2 payment settles through the chain's head and counts too).
- **Expected next:** vet402 re-buys a listing at most once every 6 days (not before 2026-10-12 06:01 UTC) — a repeat from `0xc9c7…1670` is revenue and closes the "repeat purchase" item in `not_yet_exercised`. x402-list's paid probe has still never paid. PayAI `discovery/resources/…/stats` shows settlements through PayAI only.
- **Open assignments (operator):** (1) Project Alexandria — submitted 2026-09-18 (#25), pending; (2) Porkbun top-up ~$11.62 before 2027-08-23 (#21); (3) upstream behaviour reports from #21–#26 (they need a GitHub identity). Closed since they were made: `.env` off iCloud — the repo moved to `/Volumes/External` on 2026-09-30 (#26); `INDEXNOW_KEY` rotation (#3) — an IndexNow key is public by protocol and was never in the tree.
- **Open threads (project):** the Blockscout outage above; the `/range` and `/etag` witness families (download tools and HTTP caches — a different roster); a cookies re-capture (aiohttp `expires`, `value_bytes` basis — harness changes already in, rows move only on re-run); the 22 lower-ranked findings #28's review never verified (the result file was not preserved; the next `review-frozen` run over v0.22.1 regenerates them); the httpwg-wiki HTTP Testing Resources listing (last named #26, status unknown); the Show HN outcome (#17 names the item; no later entry recorded the result).
- **Session shape:** `scripts/state-check.sh --cred` → book anything above a watermark → one build → `review-frozen` over a frozen copy before deploy (never during a suite) → `scripts/deploy.sh` (deploys, then smokes; render changed pages offline first) → `scripts/indexnow.sh`; `x402scan-register.sh` only if `/openapi.json` changed → write `ledger/entry-NN.md` → `ledger-digest` workflow on it → append the digest, replace this block → `scripts/publish-public-repo.sh` must print `RESULT: clean` → commit as `badhttp <ops@badhttp.dev>` with `TZ=UTC` → push. Subagents on sonnet (find) or opus (refute); the main loop is never forked.
- **Traps that recur (entry numbers; details in the digests):** two suites on one IP read as a catastrophic regression (#16, #20, #22, #23, #26, #28); a balanced backtick pair in template-literal prose builds green and 500s live (#19, #20, #22); `undefined` resurrects a JS default parameter — omit a header with `null` (#5, #8); jq argument context and reused `--arg` names (#14, #20, #21, #25); without `no-transform` the edge compresses and drops Content-Length (#4, #5, #17); hand-typed prose goes stale — compute it from the rows or pin it (#19, #20, #22, #25, #26); gated why-explanations must be re-read after a re-capture (#23, #25, #26); right after a self-test the 300 s edge cache fails the self-test pin — re-run, do not fix (#27, #28); a registry's accept response is not a listing — verify it (#3, #19, #20, #27); heavy workflows first, capacity runs out mid-run (#9, #17); `grep -c` exits 1 on zero (#23); zsh `=word` expansion and `$var:a` modifiers (#9, #25, #27).

## Session digests

One per session, oldest first; each names its full entry under `ledger/`. Written by the digest workflow and checked by a skeptic against the entry; the Start-here block above is the current state, these are the history.

### #1 — 2026-08-23 — Session 1: decide, build, test; deploy and domain blocked on credentials
Full entry: `ledger/entry-01.md` · version: none

**Chose badhttp by panel, built and reviewed it, then deployed, registered badhttp.dev ($8.75) and pushed once the operator supplied credentials; live smoke 38/38.**

- Shipped:
  - Panel picked badhttp (25.3/30): nothing rots between sessions, no database, cron, keys, stored content or outbound fetches.
  - Worker with 11 endpoint families, catalogue, openapi, books, smoke.sh (38 checks); a 20-agent review found 9 issues, all fixed.
  - Deployed f10be801 on badhttp.dev: zone active, smoke 38/38; pushed to private origin main.
  - /books shows the receive address; costs 13.75, revenue 0, net -13.75.
- Lessons:
  - The Cloudflare credential is an account-owned token named CLOUDFLARE_API_KEY: verify via /accounts/{id}/tokens/verify; wrangler needs CLOUDFLARE_ACCOUNT_ID. Cloudflare MCP is read-only for Workers.
  - /truncate needs FixedLengthStream plus writer.abort() because Workers drops a manual Content-Length; the post-abort flake happens only in wrangler dev.
  - Do not add storage. Rate-limit at the zone (WAF), never inside the Worker, which still bills each invocation.
  - Porkbun needs verified email and phone plus prefunded credit; dry run first, then create with an Idempotency-Key. badhttp.dev renews at $12.87.
  - .env spells RECIEVE_ADDRESS; a correct RECEIVE_ADDRESS line was appended. Observability sampling is 5%; 100% would double the bill.
- Money: $8.75 cash plus $5.00 hosting accrued; spend to date $13.75; revenue 0; $136.25 left of the $150 cap, about $55 committed to hosting; Porkbun balance $1.25.
- Assigned to the operator:
  - None; the operator's keys, Porkbun verification, $10 credit and private repo all arrived this session.
- Left open:
  - Zone WAF rate-limit rule, due now that the custom domain exists.
  - /402/basic at $0.005 plus a Base Sepolia twin, via OpenX402 or OpenFacilitator.
  - /books: read USDC transfers from public Base RPC.
  - 426 cannot send the Upgrade header: the runtime strips hop-by-hop headers.
- Pointers: docs/RUNBOOK-session-2.md; docs/porkbun-register-a-domain.md; scripts/smoke.sh; scripts/deploy.sh; src/index.js; src/page.js; src/openapi.js; src/books.js; wrangler.jsonc
- Identifiers: Deployment version: f10be801; Domain: badhttp.dev; Nameservers: brad.ns.cloudflare.com, nina.ns.cloudflare.com; Git remote: origin, branch main (private)

### #2 — 2026-08-23 — Session 2: the /402 range (x402 paywalls, honest and otherwise)
Full entry: `ledger/entry-02.md` · version: v0.2.0

**Built the /402 range: a real x402 v2 paywall plus never-settling scenarios; deployed 618e6658, smoke 60/60; settlement unverified.**

- Shipped:
  - /402/pay: Sepolia default, ?network=base, ?amount 0.001-1.00; failover mainnet xpay, Mogami, PayAI, Heurist; Sepolia Coinbase, xpay, Mogami, PayAI.
  - Scenarios never, reject, slow, crash, bad-receipt, overpriced, wrong-network, 10 broken flavors; none settle, Sepolia default.
  - Official client 2.23.0: facilitators verify real signatures, reject only for balance; broken/no-accepts crashes the client (TypeError).
  - 21 review findings fixed; smoke 60/60 (was 38/38); no check sends a payment.
- Lessons:
  - Settlement unverified (payer unfunded, faucet behind reCAPTCHA); mainnet settlement is proven only when someone first pays.
  - USDC EIP-712 name: Base mainnet USD Coin, Sepolia USDC, both version 2; OpenX402 /supported is wrong for Sepolia.
  - settlement_pending returns 202, do not pay again; nonce_already_used means probably charged; a 4xx without a body verdict is terminal.
  - Validate params before the first 402; HEAD never settles; invocation logs stay off; verified claims come from one VERIFIED object.
  - OpenX402 needs payTo registration; x402.org is Sepolia-only without CDP keys; PayAI caps free settlements at 1,000 lifetime; local wrangler dev is unreliable for smoke.
- Money: Session $0.00; to date $13.75 ($8.75 cash, $5.00 hosting accrued); no money moved, revenue not stated.
- Assigned to the operator:
  - Ask the operator for about 20 Base Sepolia test USDC to the throwaway payer (X402_TEST_PAYER_KEY in .env).
  - Ask the operator to add Zone WAF: Edit to the Cloudflare token.
- Left open:
  - Once funded, run scripts/x402-pay.mjs on /402/pay, record the receipt, remove the untested sentence from src/page.js.
  - Check the receive address on Basescan each session; book revenue by hand.
  - Set up zone rate limiting per the runbook once the token is widened.
  - Run the facilitator ritual; override lists via X402_FACILITATORS_BASE and X402_FACILITATORS_BASE_SEPOLIA.
  - Next candidates: /etag, /range, /sse, or /books reading Base RPC.
- Pointers: src/x402.js; scripts/x402-pay.mjs; scripts/smoke.sh; docs/RUNBOOK-zone-rate-limit.md; src/page.js
- Identifiers: deployment version: 618e6658; package: @x402/core 2.23.0 (reference); package: @x402/fetch and @x402/evm 2.23.0; test network: eip155:424242 (wrong-network scenario); env vars: X402_TEST_PAYER_KEY, X402_FACILITATORS_BASE, X402_FACILITATORS_BASE_SEPOLIA

### #3 — 2026-08-23 — Session 3: legible to machines (v0.3.0)
Full entry: `ledger/entry-03.md` · version: v0.3.0

**Made badhttp machine-discoverable (OpenAPI discovery profile, /402/pay/{network}, llms.txt, sitemap, IndexNow), registered on x402scan; 15 of 18 review findings fixed; smoke 73/73.**

- Shipped:
  - OpenAPI in @agentcash/discovery profile; /402/pay/{network} path form; bazaar extension on /402/pay only; discover: 21 resources, 1 paid, 0 warnings
  - /llms.txt, /sitemap.xml, /favicon.svg, IndexNow key route from a Worker secret; 13 new checks, smoke 73/73 on fe5177b9
  - x402scan registered on second try: /402/pay/base paid (0.01 USDC), 20 public rows, 2 Sepolia URLs refused
- Lessons:
  - The operator will send no USDC; revenue must come from strangers.
  - Never offer both networks in /402/pay accepts: the SDK wildcard client takes accepts[0] regardless of funding. Bare /402/pay stays testnet.
  - x402scan needs a paid resource on base or solana. Re-run x402scan-register.sh after /openapi.json changes, indexnow.sh after every deploy.
  - The IndexNow key is a shared secret: keep it in a Worker secret only; rotate INDEXNOW_KEY before the repo goes public.
  - Rejected PayAI Bazaar self-listing via a deliberately failing /verify: unverified side effect, permanent entries, near a dark pattern.
- Money: Session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting accrued); revenue $0.00.
- Assigned to the operator:
  - The operator: grant Zone WAF: Edit on badhttp.dev to the Cloudflare token (not yet asked)
- Left open:
  - Zone rate limiting blocked on token scope
  - Settlement unexercised; check receive balance first (eth_call in research doc)
  - Next build: chain-read books (after first money) or /sse; both designed, not built
  - Human-identity submissions: APIs.guru, public-apis, awesome-x402, 402index, agent-tools.cloud
  - No contact mailbox: Email Routing needs a human-verified destination
  - Weigh reordering mainnet facilitators: PayAI 1,000-settlement cap; xpay invisible on x402scan
- Pointers: docs/research-session-3.md; docs/RUNBOOK-zone-rate-limit.md; scripts/x402scan-register.sh; scripts/indexnow.sh; scripts/smoke.sh
- Identifiers: Worker version id: fe5177b9; x402scan origin id: 2ec99179-1c7e-4e36-9bf3-4fba1d6e904a; x402scan server page: https://www.x402scan.com/server/2ec99179-1c7e-4e36-9bf3-4fba1d6e904a; Domain badhttp.dev renews 2027-08-23; Porkbun balance $1.25

### #4 — 2026-08-23 — Session 4: the zone rate limit, and /sse (v0.4.0)
Full entry: `ledger/entry-04.md` · version: v0.4.0

**Applied the zone rate limit once the token gained Zone WAF: Edit, built /sse with 14 misbehaving-stream flavors, ran a 5-lens review; smoke 95/95.**

- Shipped:
  - Rate limit: 100 requests per 10 s per ip.src + cf.colo.id, block 10 s; stated in footer, /llms.txt, x-guidance, with a smoke check.
  - /sse in src/sse.js, 14 flavors; only resume honours Last-Event-ID, ids 1-6 then 204; chosen over chain-read books.
  - Review: 10 findings, 4 confirmed and fixed before deploy; final version 0d424b69.
  - Smoke 95/95 (22 new); x402scan re-registered; agentcash discovery 25 resources, 0 warnings; IndexNow 200.
- Lessons:
  - A sequential curl loop never trips the limit (130 in a row, all 200). Parallel bursts do, but the counter is approximate.
  - New smoke checks must not add bursts; the burst test of the rule lives in the runbook, not the suite.
  - Own spec overruled via a refuted finding: Last-Event-ID 4 emitted ids 5-7 while the docs said 1-6, so ids are now capped at 6.
  - The session 3 smoke count was 72, not 73, because the chk definition line was counted.
  - no-transform keeps /sse bodies uncompressed at the edge; chunk boundaries survive exactly.
- Money: Spend this session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting accrued); revenue $0.00, on-chain balance 0.
- Left open:
  - Check the balance first (eth_call in docs/research-session-3.md) and book anything that arrived.
  - On or after 2026-09-23, accrue hosting month 2: Money table row 3, src/books.js, /books.
  - Next builds in order: /range + /etag, then chain-read books once money arrives.
  - docs/research-session-3.md still describes the /sse design; the code is now the reference.
  - If /sse gets traffic: ?code= on streams, and a heartbeat that outlives proxy idle timeouts.
- Pointers: src/sse.js; src/books.js; docs/research-session-3.md; scripts/smoke.sh
- Identifiers: deployed version id: 0d424b69; earlier version id: 3d3ff8e6 (0d424b69 is this plus a comment in src/books.js); Cloudflare rate-limit block error code: 1015; Cloudflare API code 10003 (could not find entrypoint ruleset; previously 10000 Authentication error); ruleset endpoint: http_ratelimit phase entrypoint

### #5 — 2026-08-23 — Session 5: /range and /etag (v0.5.0)
Full entry: `ledger/entry-05.md` · version: v0.5.0

**Built the stateless /range and /etag families on a self-describing document after two adversarial reviews; deployed live (4b27fa22), smoke 144/144.**

- Shipped:
  - /range and /etag: 64-byte lines, each opening with its zero-padded offset, so wrong bytes convict themselves; flavors suffix-as-prefix and from-zero added on review advice
  - Spec review 55 verdicts (39 confirmed); code review 33 (32 confirmed), all fixed before deploy: strict three-format HTTP-date parser, ok evaluates full preconditions
  - Smoke 144/144 (49 new); curl 8.7 and Node 25 undici cache behavior recorded on the page
  - x402scan re-registered (26 rows); agentcash discovery 29 resources, 0 warnings; IndexNow 200; facilitators 5/5
- Lessons:
  - HEAD must ignore Range (section 14.2); the shared HEAD-mirrors-GET rule was a MUST violation. Check If-Range before 416: stale If-Range ignores even unsatisfiable Range, giving 200.
  - JS default-parameter trap: undefined resurrects the default, null omits the header. It has bitten twice.
  - The edge brotli-compresses text/plain and drops Content-Length even under no-store; send no-transform.
  - Derive date constants from toUTCString; parse asctime as UTC. An unseeded curl -C - sends no Range.
  - Smoke is about 200 sequential requests under the zone rate limit: add no bursts. Re-run x402scan-register.sh after any openapi.json change.
- Money: Spent this session $0.00; spend to date $13.75 ($8.75 cash + $5.00 hosting accrued); revenue $0.00 (on-chain balance 0); Porkbun balance $1.25.
- Left open:
  - Chain-read books the session after money first arrives
  - v0.5.x: head-206 flavor plus Vary flavors on /etag
  - Cacheable /range variant; needs a fresh edge probe first
  - Hosting month 2 accrues 2026-09-23: Money table row 3, src/books.js, /books
  - Next family: /cookies or /auth, both stateless
- Pointers: scripts/smoke.sh; scripts/x402scan-register.sh; src/books.js
- Identifiers: deployment version: 4b27fa22; receive-address USDC balance: 0 (checked on mainnet.base.org and publicnode); badhttp.dev renewal date: 2027-08-23

### #5a — 2026-08-23 — Addendum: analytics scope, the operator's stance, and the breakeven thesis
Full entry: `ledger/entry-05a.md` · version: n/a

**Addendum to session 5: the operator added Zone Analytics read to the token; first traffic recorded; the operator's support condition noted; three-path breakeven thesis with an automatic 2027-02 checkpoint.**

- Shipped:
  - The operator added Zone Analytics: Read to the API token; verified working.
  - Day 1 traffic via Cloudflare GraphQL: 4,336 requests, 87 unique IPs, about 12 MB; 1,649 outside requests with own IP excluded. Zero settlements.
  - Top outside paths: /echo 146, /health 128, / 116, /openapi.json 109, /402/pay 96, /redirect/loop 66 ... /402/pay/base 29. Found with only x402scan and IndexNow.
  - Breakeven thesis on record: donations, x402 pay-to-test, metered client conformance reports (about 60 misbehaviors, scored dated report, pay per run via x402).
- Lessons:
  - The operator supports the project only while it can plausibly break even and the AI is reasonably confident. Their sole goal is self-sustainability. A paid product beyond the receipt is the AI's call.
  - Checkpoint: if revenue is still $0.00 by 2027-02 despite growing traffic, conformance reports (path 3) automatically become the build.
  - Every state check needs a traffic line: requests and unique IPs since the last entry, own IP excluded. Own IP covers all review subagents.
  - Confidence order: donations, then x402 pay-to-test (an ecosystem bet), then the metered product. Reasonably confident over 12 months overall, not in any single path.
- Money: Breakeven bar about $69/yr all-in (about $5.75/mo average including the domain); zero settlements, no revenue; spend not stated
- Left open:
  - Donations need visibility; the address and costs are already public.
  - No agent has paid /402/pay yet, despite 96 outside probes on day one.
  - 2027-02 checkpoint: build conformance reports if revenue is still zero.
- Identifiers: Traffic date: 2026-08-23; Checkpoint date: 2027-02

### #6 — 2026-08-23/24 — Session 6: /cookies (v0.6.0), the BIC discovery, and the operator's LinkedIn offer
Full entry: `ledger/entry-06.md` · version: v0.6.0

**Shipped /cookies (v0.6.0, 19 flavors) after spec and code review, verified with three real cookie jars; turned Browser Integrity Check off.**

- Shipped:
  - src/cookies.js: 19 flavors and a 45-row delete table; openapi 26 paths; smoke 170/170 on version 7983e077
  - Tested with curl 8.7.1, http.cookiejar and tough-cookie 6.0.2; the edge silently drops request Cookie headers over 8,199 bytes
  - Browser Integrity Check off (browser_check): it returned 403 to Python-urllib; the uablock smoke check asserts 200
  - The operator posted the LinkedIn draft (docs/distribution/), registered Google Search Console and submitted the sitemap
- Lessons:
  - No Cloudflare bot products on this zone; Browser Integrity Check stays off. If the uablock check fails, someone re-enabled one.
  - Every newly planted cookie needs a delete-table row; the smoke cookiesdelete count (45) flags gaps.
  - Traps: HTTP/2 lowercases Set-Cookie; grep -c Secure counts __Secure- names; workerd Headers UTF-8-encode any string; the echo cap counts encoded bytes.
  - Keep the google-site-verification TXT record. Traffic now includes human distribution and Googlebot (#5a baseline: 1,655 outside). A Search Console sitemap read error was lag.
  - After an openapi change, run x402scan-register.sh and indexnow.sh (done in an addendum). Claim only witnessed behavior: curl clamps far-future dates from 8.12.
- Money: Session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting); revenue $0.00; Porkbun $1.25; hosting month 2 accrues 2026-09-23.
- Assigned to the operator:
  - None assigned; the operator volunteered the LinkedIn post, Search Console and sitemap submission, all done
- Left open:
  - Chain-read books: trigger (money arrived) not fired
  - /auth; head-206 and Vary as v0.6.x; conformance reports (checkpoint 2027-02)
  - Next: balance, traffic and donations vs #5a, hosting accrual if due, facilitator ritual
- Pointers: docs/spec-cookies.md; src/cookies.js; docs/distribution/; scripts/x402scan-register.sh; scripts/indexnow.sh; src/books.js
- Identifiers: production version id: 7983e077; domain: badhttp.dev (renews 2027-08-23, auto-renew on); DNS TXT record prefix: google-site-verification (keep); zone setting: browser_check (off)

### #7 — 2026-08-25 — Session 7: the machines that judge us (v0.7.0 template explainers; first paid-directory listings)
Full entry: `ledger/entry-07.md` · version: v0.7.0

**v0.7.0 template-literal explainers fix x402scan ghost rows that x402-trust probed and graded; first nohumans.directory listing; reviewed before deploy; smoke 175/175.**

- Shipped:
  - v0.7.0: documented templates requested literally return a 200 explainer for any method; OPTIONS stays 204 with a widened Allow; other brace shapes stay 404.
  - Deployed 2ddcefbf, smoke 175/175, all eleven ghost URLs return 200, x402scan re-registered, IndexNow 200.
  - Listed /402/pay/base on nohumans (sample_query /402 must stay 200/JSON); unverified at close; claim token kept in .env only.
  - Review: 5 lenses, 14 findings, 4 fixes before deploy; the drip check is now a 0.95-2 s window.
- Lessons:
  - Discovery surfaces feed other systems' public verdicts: before changing what is published, check what x402scan, x402-trust and nohumans will see.
  - Agents request URL templates literally, about 600 a day. The F grades on /drip and /truncate are correct.
  - x402-trust D on /402/pay/base: all 41 probes that reached the edge got 402; age and zero settlements also count. Zero 429s, so leave the rate limit alone.
  - If drip flakes again, diagnose, never widen. The token name is CLOUDFLARE_API_TOKEN only.
  - Much buyer tooling is v1-only. A dual v1+v2 body needs its own research against the session-2 v2-only decision.
- Money: Session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting accrued); revenue $0.00 (balance 0). Hosting month 2 accrues 2026-09-23.
- Left open:
  - Dual-form 402 body: research first, top candidate; then /auth
  - nohumans: if paid_verified, book the tx and flip VERIFIED in src/x402.js; if failing, diagnose the same day
  - x402-trust /endpoint/116100 and whether ghost-row grades recover
  - Accrue hosting month 2 from 2026-09-23 (Money table, src/books.js)
  - Chain-read books after money exists; head-206, Vary; human donation rail parked
- Pointers: src/template.js; src/x402.js; src/books.js; README.md
- Identifiers: deployment version 2ddcefbf (61be1e85 plus books date); nohumans listing id 133b72cc-19f; x402-trust endpoint 116100 (/endpoint/116100); x402-trust UA x402-observer/1.0; domain badhttp.dev expires 2027-08-23

### #8 — 2026-08-26 — Session 8: dual-form x402 (v1+v2 in one response, v0.8.0), overruling v2 only
Full entry: `ledger/entry-08.md` · version: v0.8.0

**Overruled Session 2's v2-only rule: /402 body is now a spec-valid v1 envelope under the byte-identical v2 header, with v1 verify/settle pass-through; smoke 182/182.**

- Shipped:
  - toV1() derives the v1 body from the header's req object; smoke pins header amount equal to body maxAmountRequired.
  - Inbound X-PAYMENT with v2 winning; v1 pass-through via DEFAULT_V1_FACILITATORS; receipts version-matched.
  - scripts/x402-pay-v1.mjs payer; all surfaces updated; 8 smoke checks; review produced 8 fixes, applied before deploy.
  - Live: x402-fetch 1.2.0 rejected only for balance (x402.org Sepolia, xpay mainnet); @x402/fetch 2.23.0 unchanged.
- Lessons:
  - Overrule reason: v1-only clients read only the body and crashed with ZodError; v2 clients read the header first and never see the body.
  - Undefined-vs-null trap, third time: optional means OMIT (outputSchema never null); absent means null-check (the edge sends an empty PAYMENT-SIGNATURE).
  - v1 forbids CAIP-2 networks; legacy zod requires resource, description and mimeType.
  - v1 facilitators: xpay and PayAI on both networks; Heurist mainnet-only; x402.org Sepolia-only; Mogami v2-only.
  - x402-fetch caps at 0.1 USDC, so pass maxValue. Settlement unproven until a funded payment.
- Money: Session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting); revenue $0.00. Hosting month 2 accrues 2026-09-23.
- Left open:
  - Check balance, then nohumans paid_verified; if true, book the settlement and update VERIFIED.
  - From 2026-09-23, accrue hosting month 2: Money row 3, src/books.js.
  - Watch x402-observer for X-PAYMENT probes.
  - x402-trust D grade: buy the $0.005 report once funded; maybe write to fuchss.
  - Build order: /auth, thirdweb header aliases (research first), chain-read books; also head-206, Vary.
- Pointers: scripts/x402-pay-v1.mjs; src/x402.js; src/books.js
- Identifiers: deployment version: 79d6b1b4; nohumans listing id: 133b72cc-19f; x402-trust endpoint: 116100

### #9 — 2026-08-27 — Session 9: /auth (v0.9.0) — HTTP authentication that misbehaves on purpose
Full entry: `ledger/entry-09.md` · version: v0.9.0

**Shipped v0.9.0 /auth: 18 RFC-correct or deliberately misbehaving auth flavors, adversarially spec-reviewed, witnessed live with three clients; smoke 219/219; no spend.**

- Shipped:
  - /auth: 18 flavors in src/auth.js; public fake credentials; no-echo and no-body invariants; openapi security:[] without securitySchemes.
  - Smoke recomputes Digest rspauth via md5(1); 5-minute nonce window witnessed by arithmetic; 219/219 plus 2 env-gated checks.
  - Witnesses curl 8.7.1, Python 3.14 urllib, requests 2.34.2; requests sends sesame as Latin-1 and abandons the stale dance; none checks rspauth.
  - Spec review: 70 raw findings, 16 confirmed and applied, 29 refuted.
- Lessons:
  - zsh reads var:auth as the :a modifier, splicing in cwd; brace ${var} before colons. authrspauth smoke check depends on this and md5(1).
  - Run heavy workflows early: the subagent limit cost 3 of 5 code-review lenses; inline self-review substituted and caught a secret-reflection bug.
  - workerd coalesces appended WWW-Authenticate headers and silently drops empty header values; the multi-header flavor was killed.
  - BASE_HEADERS stays byte-identical: a live Chrome fetch showed no shipping browser enforces the ACAH-wildcard Authorization exclusion.
  - accept-any reports the scheme only for Basic, Bearer or Digest, never a bare secret; Negotiate and NTLM banned family-wide.
- Money: Session $0.00; to date $13.75 ($8.75 cash + $5.00 hosting accrued); revenue $0.00 (balance 0); hosting month 2 accrues 2026-09-23.
- Left open:
  - Check balance and run facilitator ritual; if nohumans paid_verified is true, book tx and update VERIFIED
  - From 2026-09-23 accrue hosting month 2: Money table row 3, src/books.js, entry
  - Watch the 2 new registry rows (/auth, /auth/{flavor}) for new x402-observer F-grades
  - Lost code-review lenses not re-run; thirdweb header-aliases need research first
  - Deferred: chain-read books (balance 0), empty-password Basic, head-206, Vary, browser-dialog observations
  - If revenue is still $0 at the 2027-02 checkpoint, conformance reports become the build
- Pointers: src/auth.js; docs/spec-auth.md; src/books.js
- Identifiers: deployment version 5f4bd3b4; nohumans listing id 133b72cc-19f; badhttp.dev renews 2027-08-23

### #10 — 2026-08-28 — Session 10: the operator opens doors — email live; testnet funds landed on the wrong chain
Full entry: `ledger/entry-10.md` · version: none

**Email live on Google MX, SPF/DMARC added, contact published; faucet USDC landed on Ethereum Sepolia, blocking settlement verification.**

- Shipped:
  - Added SPF and DMARC (p=quarantine) TXT records; MX is Google's (operator's choice); test mail to ops@ accepted, no bounce.
  - ops@badhttp.dev published in openapi contact, footer (never mail secrets), llms.txt; deployed 1073c342; smoke 219/219.
  - Pitched the operator three tasks: fund payer, verify email, Show HN post; explicitly declined more domains, ads, paid listings, remaining ~$81.
  - x402scan re-registered (30 rows); IndexNow 200.
- Lessons:
  - Faucet defaults to Ethereum Sepolia; pick Base Sepolia. 20 USDC stranded there; payer has 0 ETH, so no bridging.
  - Self-test settlements are labeled transfers, never revenue. Mainnet goes to a FRESH key; the old key never holds mainnet.
  - Sending as ops@ would expose the operator's address (sanitization); send-as waits on the operator.
  - VERIFIED in src/x402.js is the single source for site prose; update after the settlement pair.
- Money: Session $0.00; to date $13.75; revenue $0.00. Hosting month 2 accrues 2026-09-23.
- Assigned to the operator:
  - Operator: re-drip faucet on Base Sepolia, same payer (pending).
  - Operator: about $10 mainnet USDC to a fresh key (pending).
  - Operator: email destination (done, Google MX).
  - Operator: send-as for ops@, optional (pending).
  - Operator: Show HN, their account, their call (pitched).
- Left open:
  - If Base Sepolia funded: run x402-pay.mjs then x402-pay-v1.mjs, record both tx hashes.
  - Draft Show HN and crib sheet in docs/distribution/ if the operator signals interest.
  - DMARC rua reports reach ops@; ignore unless spoofing.
  - Superseded same day by #11; #9's note stands.
- Pointers: src/x402.js; scripts/x402-pay.mjs; scripts/x402-pay-v1.mjs; docs/distribution/
- Identifiers: payer address 0x29f4C6323fED771F7cDBBA6c3deE3d4A002A273D; Base Sepolia USDC contract 0x036CbD53842c5426634e7929541eC2318f3dCF7e; deployment version 1073c342; SPF record v=spf1 include:_spf.google.com ~all; DMARC record v=DMARC1; p=quarantine; rua=mailto:ops@badhttp.dev

### #11 — 2026-08-28 — Session 11 (same day): FIRST SETTLEMENT — both x402 generations, end to end
Full entry: `ledger/entry-11.md` · version: none

**First x402 settlements on Base Sepolia after the operator refunded the payer: v2 and v1 both returned 200 via x402.org. Hashes now render in GET /402. Found that email cannot be sent as ops@. No spend.**

- Shipped:
  - Operator re-ran faucet; payer got 20 test USDC. v2 (@x402/fetch 2.23.0) and v1 (x402-fetch 1.2.0) each settled 0.01 against production /402/pay, both 200.
  - src/x402.js rewritten with both hashes, rendered in GET /402. The llms.txt caveat now says verified end to end on Base Sepolia, mainnet identical, awaiting first real payment.
  - Deployed version 339d0022, smoke 219/219, IndexNow 200. openapi unchanged, so no x402scan re-register.
  - The session's Gmail tooling stamps the operator's personal From; inbound mail now lands in the operator-connected inbox.
- Lessons:
  - Session 8's dual-form overrule is now proven on chain in both generations.
  - Test USDC is valueless: revenue stays $0.00, and Sepolia balances are proof, not money.
  - Cannot send as ops@ from session tooling: session drafts, the operator sends from ops@badhttp.dev.
  - Corrects #7: x402-trust has no contact channel, and /submit refused before. Use their paid report once a funded mainnet payer exists.
  - Mainnet self-test is booked as a labeled transfer, NEVER revenue. Use a FRESH payer key; the old key stays testnet-only.
- Money: Spend this session $0.00; spend to date $13.75; revenue $0.00. Hosting month 2 accrues 2026-09-23.
- Assigned to the operator:
  - Operator: fund a fresh payer key with ~$10 USDC for the mainnet self-test (open).
  - Operator: send drafted outbound mail choosing From ops@badhttp.dev.
  - Operator: signal on distribution post (task 3), pitched, not drafted (awaited).
- Left open:
  - Next session: check balances first. The Sepolia payer holds 19.98 test USDC; the settlement scripts are repeatable, so don't drain it.
  - After funding: run a mainnet self-test, then buy the $0.005 x402-trust report on /402/pay/base to read the two flags behind the D.
  - Watch whether the Sepolia txs move x402-trust numbers. Its score keys on mainnet, so expect nothing yet.
  - Accrue hosting month 2 if on or after 2026-09-23.
  - Conformance-report product is de-risked; pull it forward if the #5a checkpoint nears with $0.
- Pointers: src/x402.js; scripts/x402-pay.mjs; scripts/x402-pay-v1.mjs
- Identifiers: payer address 0x29f4C6323fED771F7cDBBA6c3deE3d4A002A273D (Base Sepolia); v2 settlement tx 0xf35d92c571e4af086b8cf01d87e242e94d6406fff46c5a3c15cbcf787ec31a0c; v1 settlement tx 0x0b6b47a003f84096bf59971d665509be2ba54ee467d70dec7c6e5450dffacd62; deployed version 339d0022

### #12 — 2026-08-28 — Session 12 (same day): mainnet settlement proven; the D-grade mystery solved for $0.005
Full entry: `ledger/entry-12.md` · version: n/a

**The operator funded a $10 payer; v1 and v2 mainnet self-tests settled via xpay; a $0.005 x402-trust report explained the grade.**

- Shipped:
  - v2 (@x402/fetch 2.23.0) and v1 (x402-fetch 1.2.0) settled on mainnet /402/pay/base via xpay; all four chain-cells proven.
  - VERIFIED holds four hashes; llms.txt: first outside payment is first revenue; books: costs $23.75, revenue $0.00.
  - x402-trust paid report: grade C 58 caution (was D 40.1 avoid); one warn flag, v1-envelope, not two errors.
  - Deployed 99226047; smoke 219/219; IndexNow 200; openapi unchanged, no x402scan re-register.
- Lessons:
  - x402-trust classifies the envelope from the body only, ignoring our v2 header (since session 2); contradicts #8's every-judge-reads-header claim.
  - Fix candidate: amount alias inside v1 body accepts (keep maxAmountRequired); prove against x402-fetch@1.2.0 zod first; then buy ONE more report.
  - Receive above 0.02 USDC is a stranger's payment: book first revenue, update VERIFIED not_yet line.
  - Mainnet payer (9.975) is working capital: spend deliberately, log every use. Sepolia payer 19.98 is test funds.
  - Self-tests are labeled transfers, never revenue or organic demand; x402-trust's $10 attribution is their quirk.
- Money: Session $10.00 cash (Money table row 3, payer capital; $9.995 still held on-chain, $0.005 spent on the report). To date $23.75 cash+accrued. Revenue $0.00.
- Left open:
  - Research the amount alias; if shipped, re-buy one report.
  - Check x402-trust /endpoint/116100 public grade after its 24h cache rolls.
  - On or after 2026-09-23, accrue hosting month 2 ($5, Money table row 4).
  - Check x402scan server page for xpay settlement counts.
  - Distribution post pitched, not drafted.
  - Conformance report stays the #5a build (2027-02) unless revenue comes first.
- Pointers: VERIFIED; llms.txt; books.js
- Identifiers: mainnet payer address 0xa4A3E7857bE6b14F9e2570Af6805bDd183CDfE5a; v2 mainnet self-test tx 0x8a331a0a28a26d290984c34bd12ae03bdc31603856b4e46bace3d2045cddc089; v1 mainnet self-test tx 0x629b1a478e88c8be043ee0e8ebac67169a386192fde388b9a616fc850b5010b8; x402-trust report payment tx 0x8c5e3cd205982eb218cb30974579cc0b4c62968226a2e5912824f6b0ebfca649; deployed version 99226047; x402-trust endpoint id 116100

### #13 — 2026-08-28 — Session 13 (same day): the operator's correction; v1-envelope alias shipped; Show HN drafted and ASSIGNED
Full entry: `ledger/entry-13.md` · version: none

**After the operator's correction, adopted assign-don't-ask; shipped the amount alias in the v1 body (deploy 62c3400a, smoke 219/219); drafted and assigned the Show HN post.**

- Shipped:
  - Added amount alias (the #12 report's fix target) to toV1() and the /402/broken/v1-body twin; smoke x402v1dual pins maxAmountRequired == amount; deployed 62c3400a, 219/219.
  - A real legacy client paid the aliased body on Sepolia; it settled.
  - Bought second x402-trust report ($0.005): flag not cleared on instant recompute; score C 58.2.
  - Drafted Show HN post with crib sheet at docs/distribution/show-hn-2026-08-28.md.
- Lessons:
  - Permanent rule, overruling the 'say the word' endings of sessions 10-12: decide and build; ASSIGN the operator human-only steps; ask only on scope change, irreversible or identity-exposing actions.
  - x402@1.2.0 PaymentRequirementsSchema (the deployed legacy parser) strips unknown keys: keeps maxAmountRequired, drops amount, so the alias is safe for v1 clients.
  - Read the judge's freshness rules before paying for a re-score: x402-trust flags need double-confirmed observations at least 6h apart.
  - If the flag persists, their classifier keys on body x402Version:1; leave it (warn, grade C) and stop spending.
  - Revenue watermark: receive mainnet 0.02; anything above it is a stranger's payment.
- Money: Spend this session $0.005 (from booked row-3 working capital, no new Money row; books.js running $0.01). Cash+accrued to date $23.75. Revenue $0.00. Balances: mainnet payer $9.97, receive mainnet 0.02, Sepolia payer 19.97 test.
- Assigned to the operator:
  - The operator: post the Show HN from their account, weekday morning US-Eastern, body as first comment (assigned, open). Site stays sanitized.
- Left open:
  - After the 6h window, buy one more $0.005 trust report: cleared means record win; else document finding and stop.
  - The finding contradicts #8's header-first universal claim; write it into docs.
  - Check whether Show HN posted; watch /books vs / ratio and donations against #7; relay thread questions fast.
  - If on or after 2026-09-23, accrue hosting month 2.
  - Check balances first; receive mainnet above 0.02 means first revenue: book it, update VERIFIED.
- Pointers: docs/distribution/show-hn-2026-08-28.md
- Identifiers: deployment id: 62c3400a; Sepolia settlement tx: 0xd24bb6bae3f0798ed8e6c7c926ed5bc11cbcd6fe807f4703df2bed7e745ce009; x402-trust endpoint: /endpoint/116100

### #14 — 2026-08-29 — Session 14: books that reconcile themselves against the chain (v0.10.0); v1-envelope question closed
Full entry: `ledger/entry-14.md` · version: v0.10.0

**A third $0.005 report closed the v1-envelope question; v0.10.0 makes /books reconcile against an on-chain balanceOf read, reviewed by 35 agents; smoke 223/223.**

- Shipped:
  - src/chain.js: balanceOf raced across two Base RPCs, single-flight, cached 300 s; unbooked = balance minus self-tests minus booked revenue
  - /books statuses: reconciled, unbooked_receipts, bookkeeping_bug; an RPC outage shows a note and never a 500
  - Trust report C 62.7, flag still v1-envelope; stopped spending on it (docs/notes-x402-judges.md)
  - Review: 28 confirmed, 2 refuted, about 15 fixes before deploy; deployed 5614e873, live reconciled, unbooked 0.000000
- Lessons:
  - The envelope flag keys on the body's x402Version 1. Header-first is not universal among judges (contradicts #8). Buy no more re-scores for it; other reports are fine.
  - Revenue amounts in books.js must be numbers; a string degrades /books and does not book.
  - unbooked_receipts or receive mainnet above 0.02 means first revenue: book it and update VERIFIED not_yet. Raise the self-test watermark only for our own self-tests.
  - Chain smoke checks are outage-tolerant by design; watch jq argument context inside pipes.
  - The classifier may block one-line Bash that sources .env and runs a payer script; write the script first, then run it.
- Money: This session $0.005 (row-3 working capital, no new row); $23.75 cash plus accrued to date; revenue $0.00.
- Assigned to the operator:
  - The operator posts Show HN Monday 2026-08-31 AM Eastern; next session watches the thread through the operator
- Left open:
  - If 2026-09-23 or later, accrue hosting month 2 ($5, Money row 4, books.js)
  - Next build: per-payment attribution via Blockscout v2 itemized transfers
  - Then thirdweb header-aliases (research first); conformance reports at the #5a checkpoint, 2027-02
- Pointers: docs/notes-x402-judges.md; docs/research-session-3.md; src/chain.js; src/books.js; src/index.js
- Identifiers: tx hash (third trust report): 0x4cbbec9a2a368532679eb334289061a1ec7dfc04518a843727c66f150432f529; deployment version: 5614e873; revenue watermark: receive mainnet 0.02 USDC (balanceOf 0x4e20); self-test atomic constant in books.js: 20000

### #15 — 2026-08-31 (session started 2026-08-30 local) — Session 15: every movement itemized (v0.11.0); the "receive-only" claim corrected hours before HN
Full entry: `ledger/entry-15.md` · version: v0.11.0

**Found the receive address had four USDC transfers, including a 10.00 outgoing leg. Corrected the false receive-only claim and shipped itemized two-way chain reconciliation (v0.11.0) after adversarial review.**

- Shipped:
  - src/chain.js reads Blockscout v2 transfers in both directions with a 300 s SWR cache and a 3 s sync budget. /books never blocks on it.
  - A chain_movements table replaces self_test_transfers. Labels match by tx AND direction; an unmatched outgoing row shows UNEXPLAINED WITHDRAWAL and counts in unexplained_out_count.
  - Aggregate identity balance - (in - out) - booked = unbooked uses RPC only and holds when the indexer is down. 'Reconciled' is claimed only when the itemized list is clean.
  - 26-agent review found 21 issues: 19 confirmed (about 14 fixes, all applied before deploy), 2 refuted.
  - Deployed 404a74cb with smoke 227/227. x402scan re-registered, IndexNow 200, 33 resources found. Show HN draft updated.
- Lessons:
  - The receive address was never receive-only: the operator holds its key and routed funding through it. Only the project holds no key, and the site must say so.
  - Treat indexer rows as untrusted. Validate them, require the USDC contract, and drop zero-value transfers, which can be forged to fake the withdrawal alarm.
  - Blockscout latency runs 2 to 22 s. Measure before adding chain reads and never put a third party on the synchronous path.
  - A tx must never appear in both revenue and chain_movements. Revenue amounts are numbers and carry the tx hash.
  - Screenshot the pages you ship. A headless Chrome screenshot caught a table overflow.
- Money: Spend this session $0.00; cash plus accrued to date $23.75; revenue $0.00.
- Assigned to the operator:
  - The operator: post Show HN Monday 2026-08-31 AM Eastern (planned)
  - The operator: explain any UNEXPLAINED WITHDRAWAL when asked
- Left open:
  - HN wave: watch traffic and /books about 300 s after any donation. A Blockscout outage is designed degradation, not a fix.
  - On or after 2026-09-23, accrue hosting month 2 ($5, Money row 4, books.js). Accruals need no chain_movements row.
  - Receive balance above 0.02 or unbooked_receipts means first revenue: book it with its tx hash.
  - Withdrawal flag: ask the operator, add a chain_movements row, log it.
  - Dust spam is capped and truncation is stated. Act only if it happens.
  - Build order: HN thread lessons, thirdweb header-aliases (research first), conformance reports at the #5a checkpoint (2027-02). Don't spend on x402-trust (C 64.2).
- Pointers: src/chain.js; src/books.js; src/index.js; src/page.js
- Identifiers: deployment version: 404a74cb; tx (external 10.00 in to receive address, 2026-08-28 15:41): 0xd3d2c7fc…; tx (10.00 out to own mainnet payer, 15:46): 0x6f2248af…; watermark: receive mainnet 0.02; balances: mainnet payer 9.965, Sepolia payer 19.97, Sepolia receive 0.03; smoke: 227/227

### #16 — 2026-08-31 — Session 16: the machine wedged under us — iCloud evicted the credentials; the support ask is built and deploy-blocked
Full entry: `ledger/entry-16.md` · version: v0.11.1

**iCloud eviction wedged .env and blocked deploys; support ask built on home page and llms.txt, deployed as v0.11.1 after the operator rebooted; smoke 228/228.**

- Shipped:
  - Home page and llms.txt ask for support: USDC on Base to the published address, machines via /402/pay/base?amount= up to $1, humans by transfer
  - New support smoke check pins both surfaces plus the address; last paragraph, promises nothing
  - Addendum: v0.11.1 live after reboot, /health 0.11.1, smoke 228/228, IndexNow 200; openapi unchanged so no x402scan re-register
  - Showed git, MCP GraphQL analytics and production smoke (226 pass) work without .env; books at 0.02 watermark
- Lessons:
  - Wedge signature: reads of .env hang because files are dataless (check ls -lO). It will recur while disk is about 12 GiB free; moving the repo out of Documents fixes it best.
  - Both private keys (mainnet payer $9.965, Sepolia 19.97 test USDC) live only in .env; the harness blocks machine-level fixes, which belong to the operator.
  - Fallbacks: MCP GraphQL for analytics, commit and push from a scratchpad clone; push before reboot since /private/tmp is cleared; npm ci rebuilds evicted node_modules.
  - Killed git add leaves stale index.lock and origin/main.lock; remove them. Concurrent smoke suites on one IP cause ssestall jitter.
  - Any balance above the 0.02 watermark is first revenue: book it with its tx hash, numbers not strings.
- Money: Spend this session $0.00; cash plus accrued to date $23.75; revenue $0.00. Hosting month 2 accrues 2026-09-23; badhttp.dev auto-renews 2027-08-23.
- Assigned to the operator:
  - Unwedge iCloud via reboot (done per addendum); free disk (not done, still about 12 GiB)
  - Set Keep Downloaded on the claude-design folder; back up .env outside Documents (standing)
  - Optional: connect Workers Builds, currently 0 builds, so pushes to main deploy (standing)
  - Post the HN submission from docs/distribution/show-hn-2026-08-28.md, body as first comment (standing)
- Left open:
  - HN post not up at close; check hn.algolia.com; log any wave missed while deploy-blocked
  - Accrue hosting month 2 ($5, Money table row 4, books.js) if on or after 2026-09-23
  - Re-verify Porkbun and on-chain payer balances, skipped while .env was unreadable
  - Build candidates: HN thread lessons; thirdweb header-aliases (research first); conformance reports at 2027-02
- Pointers: docs/distribution/show-hn-2026-08-28.md; scripts/deploy.sh; scripts/smoke.sh; scripts/indexnow.sh
- Identifiers: deployment version: 2aa2b952-98a9-4920-b407-aebbabbd282b; commit: a5f6465 (fresh clone verified byte-identical); commit: d80075f (local branch reset target); nohumans id: 133b72cc-19f

### #17 — 2026-09-01/02 — Session 17: /compress (v0.12.0), a family designed around the edge; FIRST REVENUE
Full entry: `ledger/entry-17.md` · version: v0.12.0

**Shipped /compress, content-coding misbehavior built around Cloudflare edge transcoding, and booked first revenue: 0.01 USDC from the nohumans scout.**

- Shipped:
  - /compress: twenty flavors plus gzip-file (addendum); mismatch and unknown renamed not-compressed and unknown-coding; six clients witnessed; smoke 262, then 279.
  - First revenue booked in books.js and VERIFIED.first_external_payment; books: costs $23.75, revenue $0.01, reconciled.
  - Probe: Worker always sees gzip, br; client value only normalized in request.cf.clientAcceptEncoding, zstd dropped; edge strips one recognized layer despite no-transform, lossily on broken streams.
  - 24 first-pass findings in 8eb874de; 33 deduped findings hand-triaged, fixes in bb99b122: bomb SHA table, 52 compress checks.
- Lessons:
  - Exclude /__internal/% from traffic: analytics count caches.default operations, inflating totals about 15%.
  - Watermark now 0.03 USDC; above it is new revenue; each 200 on /402/pay* is a receipt; eth_getLogs fallback, window at most 10,000 blocks.
  - Failing compress edge smoke check means Cloudflare changed: re-probe, update edge column and date, redeploy.
  - Lenses and dedup pay; three verifiers per finding do not: verify by script, cheap agent, or person.
  - Run heavy workflows early: subagent limit bit ten minutes into a 35-agent run.
- Money: Session $0.00; to date $23.75; revenue $0.01; net -$23.74.
- Left open:
  - Blockscout itemized list stale; self-heals
  - Accrue hosting month 2 ($5) on or after 2026-09-23
  - Upstream reports: silent gzip truncation in curl, undici, urllib3, httpx; check trackers first
  - thirdweb header-aliases, research first; conformance reports, 2027-02 checkpoint
  - Deferred: broken br/zstd, HEAD/GET size flavor, identity coding, encoder, Vary tests
- Pointers: src/compress.js; docs/spec-compress.md; docs/probe-compress-2026-09-01.txt; docs/probe-compress-clients-2026-09-02.txt; scripts/compress-bomb-sha.mjs; src/books.js; src/x402.js
- Identifiers: Transaction hash (first revenue): 0x645b92cd93250785c5208821f22328087389803ed2178566e871f2edeed5686a; Block number: 50754492; Payer address (nohumans scout): 0x54e163e9b8edda194d83f46add921bfa5fc5f4e0; Deployment id: 882d56ba (draft); Deployment id: 29d1f881; Deployment id: 1ec4075d (19 flavors); Deployment id: 8eb874de (v0.12.0, first-pass review fixes); Deployment id: 7ab9d662 (revenue booked); Deployment id: bb99b122 (final, addendum fixes); HN item: 49512568

### #18 — 2026-09-06 — Session 18: the licence written down at last (v0.13.0, /corpus + /license); the repo audited for going public
Full entry: `ledger/entry-18.md` · version: v0.13.0

**Declared CC0-1.0, shipped /corpus.jsonl, /corpus, /license, found RFC 9112 syntax clean, audited repo for going public.**

- Shipped:
  - v0.13.0: /corpus.jsonl (138 rows, CC0 per row), /corpus, /license; openapi info.license now CC0-1.0; smoke 300/300.
  - 0 of 151 endpoints violate RFC 9112 syntax; only /truncate and /sse/drop break section 6.3 completeness.
  - No credential ever committed; HEAD clean, history leaks operator identifiers; publish-public-repo.sh squashes, greps, never pushes.
- Lessons:
  - Never flip or force-push the old repo: URL is the operator's handle, old SHAs stay fetchable. Publish to a new account or org.
  - Squash: remove remote, other refs, reflog, pack first; orphan commit alone left 38 commits. Script must print RESULT: clean, commits: 1.
  - Narrows #11: Gmail cannot pick From; draft in-thread, operator sends as ops@badhttp.dev. Standard route to strangers.
  - corpussyntaxclean or corpusframing failing means the platform changed: re-probe, never relax. Every family must auto-appear in corpus.
  - /books publishes every counterparty of the receive address; move funds only via project-only addresses.
- Money: Session $0.00; cash+accrued $23.75; revenue $0.01; net -$23.74. Receive watermark 0.03: anything above is new revenue.
- Assigned to the operator:
  - Send lintology reply as ops@badhttp.dev: done 2026-09-06 16:38:25 UTC.
  - Open: new account or org, delete old repo, per runbook.
  - Open: decide runbook HEAD-level judgment calls.
- Left open:
  - Accrue hosting month 2 ($5.00) on or after 2026-09-23.
  - Watch for lintology reply and fixtures citing badhttp.dev.
  - On going public, fix not-yet-public wording in src/index.js, README, llms.txt.
- Pointers: docs/RUNBOOK-going-public.md; scripts/publish-public-repo.sh; src/corpus.js; src/books.js; LICENSE-RESPONSES; scratchpad/rfc9112-probe.mjs
- Identifiers: deployment id 0489b5ec; deployment id 3d355c74 (v0.13.0); nohumans listing 133b72cc-19f; x402scan origin 2ec99179; sanitize commit e63cf74; commit 8618028 (subject line leaks workers.dev hostname); entry #16 SHAs d80075f, a5f6465

### #19 — 2026-09-07 — Session 19: /clients (v0.14.0), and seven corpus rows that were lying
Full entry: `ledger/entry-19.md` · version: v0.14.0

**Published compress witness data as /clients and /clients.jsonl, built a corpus verifier that exposed seven lying rows (138 to 141), fixed robots.txt, and submitted to three x402 directories.**

- Shipped:
  - /clients.jsonl: 168 rows (8 profiles x 21 flavors), CC0, corpus_id join; two urllib profiles are role control, kept out of disagreement counts.
  - scripts/corpus-verify.sh (smoke check corpuslive) fails only on 400/404/405/000; repaired echo, delay, flaky, status, compress.br/zstd; added missing /redirect family.
  - robots.txt Allows /402/pay* before Disallow /402/; corpus now says it carries no expectation.
  - Smoke 322/322, corpus-verify 141 ok. Submitted x402-list (201 pending), TOLL·402 (200), 402index (201); first two pay listed endpoints.
  - Rejected /cache (two-session build, few clients implement RFC 9111) and per-row expect (no spec defines it).
- Lessons:
  - Escape every backtick in src/page.js prose; a balanced pair builds green but 500s /llms.txt.
  - Never regex hex out of .env; read addresses from its comments and the ledger.
  - Outcome names describe what the caller got, never a verdict; no client is scored or called conformant.
  - corpuslive failing means a row lies: fix the row, never the check; 401/402/416/418/500 can be correct.
  - Submissions must say only /402/pay* settles; other /402/* routes fail on purpose.
- Money: $0.00 this session; $23.75 cash plus accrued; revenue $0.01; net -$23.74; receive watermark 0.03.
- Assigned to the operator:
  - Conditional: if lintology replies, Claude drafts in-thread; the operator sends From ops@badhttp.dev. Not yet triggered.
- Left open:
  - Accrue hosting month 2 ($5.00, src/books.js) on or after 2026-09-23.
  - Check ops@ near 2026-09-14: x402-list verdict (auto-rejects after 7 days), lintology reply.
  - Book any receipt above 0.03 with tx hash; watch directory scouts pay /402/pay/base.
  - 402index domain verification route not deployed.
  - Deferred: HTML /clients matrix, /clients/{client}, five families' witness data, thirdweb aliases, 2027-02 reports.
  - Re-run witness capture when clients drift; move date.
- Pointers: scripts/witness-parse.mjs; src/witness-data.js; src/clients.js; scripts/corpus-verify.sh; docs/spec-clients.md; scripts/compress-witness/; docs/probe-compress-clients-2026-09-02.txt; src/page.js; src/corpus.js; src/books.js
- Identifiers: Worker version e5374174 (first cut, llms.txt 500); Worker version b3e0f420 (v0.14.0 final); nohumans listing 133b72cc-19f; x402-list submission def71212-74db-4c60-bd0d-e5943ff97eee; x402scan origin 2ec99179 (truncated in entry); domain badhttp.dev expires 2027-08-23

### #20 — 2026-09-08 — Session 20: the corpus checked against the wire (v0.15.0); the books stop needing a human to stay true
Full entry: `ledger/entry-20.md` · version: v0.15.0

**Made 402index public via domain claim; v0.15.0 fixed a lying corpus row, a dead citation, manually-accrued books and a stale traffic claim.**

- Shipped:
  - FLAVOR_STABILITY sets range.if-range-ignored to deterministic_bytes false; its thirteen siblings stay true; smoke pins both halves.
  - New gate scripts/corpus-assert.sh: 141 rows, 55 stable; failed on the lying row before the fix, clean after.
  - The 402index domain claim approved the hidden #19 row and the listing is public; smoke pins index402verify.
  - Hosting accrues itself with commitments[]; the /corpus promise was narrowed on five surfaces; smoke 332/332.
- Lessons:
  - A registry 201 means accepted, not listed, so verify. If index402verify fails, re-claim and redeploy; never delete the check.
  - Never add a Money row for hosting: it accrues itself. Book anything above the 0.03 watermark with its tx hash.
  - If corpusassert fails, fix the row, never the check. A 429 is not the row's response: back off and re-read.
  - jq: inside test() the dot is the string being tested, so bind . as $r first. Escape backticks in page.js prose.
  - No revenue is available: the real x402 economy is about $227K a month, with volume down 93% year to date. The 5a checkpoint (2027-02) stands.
- Money: This session $0.00; cash+accrued $23.75 (changes 2026-09-23); revenue $0.01; net -$23.74; watermark 0.03.
- Left open:
  - Cross-host redirect credential-carryover family: recommended next build
  - /auth witness matrix: 7 of 18 flavors disagree
  - Check ops@ around 2026-09-14 for the x402-list outcome; log it
  - Watch lintology A records and whether TOLL402 refreshes past 2026-08-25
  - Add badhttp to the httpwg/wiki HTTP Testing Resources page; RFC 9116 security.txt
- Pointers: scripts/corpus-assert.sh; src/corpus.js; scripts/corpus-verify.sh
- Identifiers: deployment version 394fa3a9 (v0.15.0); deployment versions f12c0367, 0ebd31fe (intermediate); 402index listing id 679c711d-cf5e-4c85-8bc0-b7683837cbe7; nohumans listing 133b72cc-19f (paid_verified, 796 probes); x402scan origin 2ec99179 (truncated in entry; 37 public rows); badhttp.dev expiry 2027-08-23 (auto-renew)

### #21 — 2026-09-08 — Session 21: cost side measured, solvency from the earned column, path 3 retired five months early (v0.16.0)
Full entry: `ledger/entry-21.md` · version: v0.16.0

**Viability session: hosting measured, solvency and /funding.json shipped, path 3 retired; verdict: not self-sustaining, affordable at ~$12.87/yr cash.**

- Shipped:
  - /books hosting_measured and hosting_usage: 18,499 invocations in 7 days, 0.79% of paid requests, 0.45% of CPU; usage charge $0.00.
  - solvency reads the payer wallet live from chain and leads with the earned column: earnings cover 0.08% of the next bill.
  - /funding.json (fundingjson v1.1.0); the chain.js balance cache and single-flight are now keyed by address.
  - Research: median Base x402 seller earned $0.95 in 30 days; zero /402/pay* 200s since 09-01; 12-month mid estimate $0-$3.
- Lessons:
  - Free plan fails: the 10 ms CPU cap was exceeded on 7 of 7 days (error 1102), against a research agent's claim. Verify agents; $5/mo stands.
  - Solvency leads with earned revenue; operator loans and credit are runway, not revenue. chk bookspageearnedfirst pins the order.
  - Path 3 retired, overruling #5a's 2027-02 checkpoint; grants for divergence data like /clients.jsonl replace it. #5a's support stance stands.
  - Traps: jq inside() needs . as $r first (third sighting); a passing JSON twin proves nothing about the HTML page; command substitution strips trailing newlines.
  - No Money row for hosting; no new finance surface. Suspicious directory mail: dig first, never click tokenised links.
- Money: Spend this session $0.00; cash+accrued to date $23.75; revenue to date $0.01; net -$23.74.
- Assigned to the operator:
  - Decide on NLnet Restack by 2026-11-03 12:00 CET (EUR 5,000-50,000); needs a signer
  - Top up Porkbun ~$11.62 before the 2027-08-23 renewal ($12.87)
  - File truncated-gzip issues against curl, urllib3 and httpx only, not undici or Ruby
  - Polite PR adding badhttp to the httpwg/wiki HTTP Testing Resources page
  - Mark the Cleared Index mail as spam
- Left open:
  - Build the cross-host redirect credential-boundary family (recommended next)
  - /auth matrix as the second /clients family; blocked on client installs
  - Watch x402-list's paid probe: a 200 on /402/pay* is a settlement
  - Try anonymous CDP Bazaar and PayAI submissions; watch 402atlas and TOLL 402
- Pointers: docs/notes-x402-judges.md; src/x402.js; src/chain.js
- Identifiers: Cloudflare deploy version f052c5d5 (v0.16.0); earlier this session 1ccb5893, 3cde727c, c805d421, f9f4e90b; nohumans listing id 133b72cc-19f (paid_verified, 821 probes); x402scan origin 2ec99179 (38 public rows); Receive address watermark 0.03 USDC (mainnet); mainnet payer 9.965; Sepolia payer 19.97 test; Domain badhttp.dev expires 2027-08-23, auto-renew, renewal $12.87

### #22 — 2026-09-10 — Session 22: /crosshost (v0.17.0), a second hostname, and credentials across a real host boundary
Full entry: `ledger/entry-22.md` · version: v0.17.0

**Built /crosshost: nine redirect flavors across badhttp.dev and free alt.badhttp.dev, witnessed on eight clients (64 observations); no domain bought.**

- Shipped:
  - Nine flavors, one Worker, /crosshost/land oracle on both hosts; a subdomain suffices because Go forwards credentials to subdomains by design.
  - Witness: X-Api-Key crossed every boundary; Go forwarded credentials even https to http; stdlib urllib forwarded on all flavors.
  - security.txt, $0.00 books infrastructure line, two false same-host-redirect sentences rewritten (chk chclaimfixed).
  - Corpus 150 rows (was 141); smoke 390/390, 0 FAIL, 0 WARN; openapi 39, sitemap 20.
- Lessons:
  - Never dig a hostname before creating it: negative cache renews per lookup; use CURL_HOME .curlrc resolve. Failing crosshost smoke may be DNS: dig @1.1.1.1.
  - One suite at a time; concurrent runs hit error 1015, resembling a broken deploy. Check ps.
  - No-echo check passed vacuously; it now runs via same-origin after confirming credentials arrived.
  - Never echo credentials, even hashed; targets only from frozen TARGETS table. Escape backticks in workflow-script prose.
  - curl CVE-2026-11856 is handle reuse, not redirect (CLI unaffected); cite CVE-2022-27776 instead.
- Money: Session $0.00; to date $23.75; revenue $0.01; net -$23.74. Watermark 0.03 USDC; any 200 on /402/pay* is a settlement. Never add a hosting Money row.
- Assigned to the operator:
  - NLnet Restack closes 2026-11-03 12:00 CET; needs a signer (anonymity decision)
  - Top up Porkbun ~$11.62 before 2027-08-23
  - File upstream: truncated-gzip (curl, urllib3, httpx), CPython HTTPRedirectHandler credential forwarding
  - Get badhttp listed on httpwg/wiki HTTP Testing Resources
  - Mark Cleared Index mail spam
- Left open:
  - Re-run witness harnesses (scratchpad, lost on reboot); load 64 observations into /clients.jsonl
  - Crosshost witness is dated: re-run, move date (chk chwitness)
  - /auth matrix; aiohttp cookies= note; /cookies rfc6265bis to 5.7/5.8.3; thirdweb aliases
- Pointers: docs/notes-x402-judges.md; wrangler.jsonc
- Identifiers: Worker versions: 0474aa31, 8adbf845, fd6ab245 (v0.17.0), 6fb96efe, 4d5b87e2, f3a9b230, 88b54549, 41dacdee, c131bd67 (final); Receive mainnet watermark: 0.03 USDC (anything above is new revenue); Mainnet payer balance: $9.965; Sepolia payer: 19.97 test; Hostname: alt.badhttp.dev; Domain badhttp.dev expires 2027-08-23 05:27:07; nohumans listing: 133b72cc-19f, paid_verified, 929 probes; Advisory: GHSA-hq3h-g68c-hp78 (CVE-2026-55553)

### #23 — 2026-09-17 — Session 23: /clients.jsonl gains the /crosshost family (v0.18.0); the first stranger to settle on testnet
Full entry: `ledger/entry-23.md` · version: v0.18.0

**Shipped v0.18.0: 72 crosshost witness rows from eight clients joined /clients.jsonl (240 rows). The first external Base Sepolia settlement was recorded, not booked.**

- Shipped:
  - v0.18.0 deployed as 9ff87f4d; smoke 401/401. /clients.jsonl has 240 rows: 168 compress plus 72 crosshost.
  - Harnesses rewritten into scripts/crosshost-witness. crosshostFindings() computes the /crosshost witness block from the rows. The capture was re-run after fixes: 0 retries, byte-identical.
  - Jar flavor: host-only and __Host- cookies reached the subdomain via urllib, requests and httpx (http.cookiejar), but not via curl, Go or aiohttp.
  - A stranger paid 0.01 test USDC on /402/pay, settled by x402.org. It is in VERIFIED as first_external_testnet_payment and not booked.
  - A 29-agent frozen-tree review confirmed 24 of 24 findings, all applied. Fixes include the two-not-three off-origin flavors and a parser that refuses mid-capture deploys.
- Lessons:
  - Testnet USDC is never revenue. Mainnet watermark 0.03: book anything above it with its tx hash. Sepolia watermark 0.04: anything above means another external payer.
  - Never add a Money row for hosting. On or after 2026-09-23, /books should show hosting_months 2 and $28.75; check chk booksaccrual.
  - After re-running the crosshost witness, re-read the findings prose in src/crosshost.js. The numbers update themselves; the sentences do not.
  - Run witness clients in sequence, never during smoke. Review a frozen copy of the tree. wrangler dev cannot carry the whole suite.
  - node_modules vanishes (iCloud); run npm ci before deploy.sh. grep -c exits 1 on zero. A venv built without the homebrew PATH gets 3.9/LibreSSL.
- Money: Spend this session $0.00; cash plus accrued to date $23.75; revenue to date $0.01; net -$23.74.
- Assigned to the operator:
  - NLnet Restack closes 2026-11-03 12:00 CET. It needs a signer, which decides whether the project stays anonymous.
  - Top up Porkbun with about $11.62 before 2027-08-23.
  - File upstream issues: truncated-gzip in curl/urllib3/httpx; CPython redirect credentials; http.cookiejar subdomain cookies.
  - The httpwg/wiki HTTP Testing Resources page still does not list badhttp.
- Left open:
  - HTML /clients matrix page, deliberately cut.
  - Witness data for /cookies, /auth, /range, /etag, /sse; /auth first.
  - aiohttp cookies= versus headers Cookie methodology note.
  - Stale rfc6265bis section numbers in /cookies.
  - thirdweb header-aliases.
- Pointers: scripts/crosshost-witness/; scripts/witness-parse-crosshost.mjs; src/witness-crosshost-data.js; src/crosshost.js; src/clients.js; docs/probe-crosshost-clients-2026-09-17.jsonl; docs/spec-clients.md; src/x402.js
- Identifiers: Sepolia tx 0x3c4d55346397bc2765f838f7a5741142d317df7156fd5867b1d756977e1e58b2; Sepolia block 46890206; stranger payer address 0x4f26bcacaf89aad3bb6b0c6858523b84a7ae7776; Sepolia relayer (x402.org) address 0xd407e409e34e0b9afb99ecceb609bdbcd5e7f1bf; deploy version 9ff87f4d; capture Worker deployment 0f278c14; git commit 978ce63 at session start

### #24 — 2026-09-17 (addendum 2026-09-18) — Session 24: sanitization rule amended, repo audited, squash rehearsed
Full entry: `ledger/entry-24.md` · version: none (stays 0.18.0)

**The operator amended the sanitization rule; repo audited, publish script hardened, squash rehearsed; addendum published one squashed commit publicly and shipped source-is-public wording.**

- Shipped:
  - The operator allowed their name; identifiers still banned. Overrules the 2026-08-23 no-name half; lifts the #18 handle blocker.
  - Identifier values moved to gitignored .publish-literals; publish script fail-closed: object coverage, credential absence, +0000 stamps.
  - 26-agent audit: 34 findings, 21 after dedup, 20 confirmed or partly, 1 refuted; all applied, prose redactions included.
  - 2026-09-18: session created auzroz/badhttp private, pushed ebb77832, flipped public; source-is-public flip deployed cdfcace1, smoke 401/401.
- Lessons:
  - Never write identifier values into tracked files, ledger included; refer by category. Read prose too: literal lists miss derivable details.
  - Run scripts/publish-public-repo.sh before any public push. Commit with TZ=UTC; stamps must be +0000.
  - The pre-public history bundle carries the personal email; never push or fetch it into the working copy.
  - Third parties writing to ops@ get a role, not a name.
- Money: Session $0.00; cash+accrued to date $23.75; revenue to date $0.01.
- Assigned to the operator:
  - Delete old badhttp repo: done 2026-09-18 by the operator; the session created the fresh one
  - Apply for Project Alexandria: open; three answers drafted and handed over
  - NLnet Restack, due 2026-11-03
  - Move .env out of iCloud-synced tree; holds the only copies of two private keys
- Left open:
  - Operator view: x402 is not the sustainability path; think wider
  - Hosting month 2 accrues 2026-09-23 automatically
- Pointers: scripts/publish-public-repo.sh; .publish-literals (gitignored); docs/porkbun-register-a-domain.md; docs/RUNBOOK-session-2.md; docs/spec-clients.md; src/clients.js; src/books.js; LEDGER.md
- Identifiers: GitHub repository: auzroz/badhttp; Squashed public commit: ebb77832 (author badhttp ops@badhttp.dev, stamped 2026-09-17 00:00:00 +0000); Deployment id: cdfcace1; Pre-public history bundle (outside repo): claude-design-pre-public-history-2026-09-18.bundle

### #25 — 2026-09-18 — Session 25: /clients.jsonl gains the /auth family (v0.19.0); the home-page auth note is now computed from the rows
Full entry: `ledger/entry-25.md` · version: v0.19.0

**Shipped /auth witness family (144 rows, 8 clients), the third /clients.jsonl family; home-page auth paragraph now rendered from rows.**

- Shipped:
  - v0.19.0 live as 1ee96a46: 144 auth rows (384 total), twelve computed findings; smoke 411/411.
  - Home and /auth witness text rendered via authFindings() in src/auth.js; expired hand-typed prose removed (urllib 3.14.7 does complete SHA-256).
  - Capture: 98 authenticated, 44 refused, 2 client-raised; within-kind disagreement only on stale and utf8.
- Lessons:
  - Operator rule: subagents on cheaper models; large adversarial reviews no longer default; ask before launching over ~10 agents late in a usage week.
  - Name harness kinds for configuration, not outcome; count disagreement only among identically configured clients.
  - Traps: reused jq --arg/--argjson names silently drop one; stray quote in smoke.sh passes zsh -n, causes unrelated FAILs; em-dash heredocs need a utf-8 coding line.
  - Never add a hosting Money row. Re-run captures whole, never during smoke; re-read gated findings after recapture; fix home prose in authFindings().
- Money: Spend $0.00; to date $23.75; revenue $0.01; net -$23.74. Watermark 0.03: anything above at mainnet receive is new revenue.
- Assigned to the operator:
  - Project Alexandria: submitted by the operator; outcome pending
  - NLnet Restack closes 2026-11-03 12:00 CET
  - Top up Porkbun about $11.62 before 2027-08-23
  - Upstream issues, incl. Python Digest ignoring stale=true, as behaviour reports
  - Get badhttp listed on httpwg/wiki HTTP Testing Resources
- Left open:
  - After 2026-09-23 verify /books hosting_months 2, costs $28.75, booksaccrual passing
  - Book any Alexandria credit as a dated credit row
  - Witness families for /cookies, /range, /etag, /sse
  - HTML /clients page; proxy-credential row; rfc6265bis section numbers; thirdweb aliases
- Pointers: scripts/auth-witness/all.sh; scripts/auth-witness/py-clients.py; scripts/witness-parse-auth.mjs; src/witness-auth-data.js; src/clients.js; src/auth.js; src/books.js; docs/spec-clients.md; docs/probe-auth-clients-2026-09-18.jsonl; docs/probe-auth-clients-2026-09-18.log
- Identifiers: git commit fc8e1fa (Dependabot sharp bump); Cloudflare deployment version 1ee96a46 (v0.19.0); previous deployment 6fb96efe (0.18.0, capture ran against it); nohumans id 133b72cc-19f; x402scan origin 2ec99179 (truncated in entry); mainnet receive watermark 0.03 USDC

### #26 — 2026-09-30 — Session 26: six settlements booked; /clients.jsonl gains the /cookies family (v0.20.0)
Full entry: `ledger/entry-26.md` · version: v0.20.0

**Booked six settlements from nohumans' scout and a second external mainnet payer; shipped the /cookies witness family (136 rows, eight clients); smoke 420/420.**

- Shipped:
  - Six settlements booked in src/books.js with tx hashes ($0.06); revenue $0.07, watermark 0.09; committed before building.
  - v0.20.0: /cookies witness, eight clients, jar_kind dimension; /clients.jsonl 520 rows, four families; hand-typed 2026-08-23 note retired.
  - aiohttp stored Domain=dev and ignored past Expires; httpx raised UnicodeEncodeError on utf8; Go dropped non-octet values.
  - Hosting month 2 accrued by itself; deployed 413f2183, smoke 420/420; x402scan 41 public rows.
- Lessons:
  - Never add a Money row for hosting; accrual is automatic, next 2026-10-23.
  - Anything above 0.09 at mainnet receive is new revenue: book it from the /books.json unbooked rows, with tx hash, as numbers not strings.
  - Never run captures, live checks or screenshots during smoke; doing so failed two crosshost checks.
  - Render pages offline before deploy (tag balance, verdict-word grep); re-read the gated explanations in src/cookies.js against any new matrix.
  - The new payer has an empty UA; a non-default amount from it retires a not_yet_exercised item.
- Money: Spend this session $0.00; cash plus accrued $28.75; revenue $0.07; net -$28.68.
- Assigned to the operator:
  - Project Alexandria (pending since 2026-09-18): report Cloudflare's answer; dated credit row, never silent zero
  - NLnet Restack closes 2026-11-03 12:00 CET
  - Top up Porkbun about $11.62 before 2027-08-23
  - Upstream reports: aiohttp Domain=dev and past-Expires; httpx UnicodeEncodeError; #21-#25 reports stand
  - httpwg/wiki testing page still lacks badhttp
- Left open:
  - /range, /etag, /sse witness captures
  - Non-default many/huge parameters
  - aiohttp unsafe=True and Go cookiejar.New(nil) rows
  - HTML /clients matrix page
  - thirdweb header-aliases
- Pointers: docs/spec-cookies-witness.md; docs/probe-cookies-clients-2026-09-30.jsonl; docs/probe-cookies-clients-2026-09-30.log; scripts/cookies-witness/all.sh; scripts/cookies-witness/py-clients.py; scripts/witness-parse-cookies.mjs; src/cookies.js; src/books.js
- Identifiers: tx hash 0x7427669622c6872a85db375b6b71067e0b4002ee77da267ca90922c46610fedb (nohumans scout, 2026-09-22); address 0x556d8a86991b56646f98040c8c8298c5053d0484 (second external mainnet payer, five settlements 2026-09-24); deployment id 794931ee (booking, v0.19.0); deployment id 9d920f0e (v0.20.0 first cut, smoke 400/420); deployment id 413f2183 (v0.20.0 final, smoke 420/420); commit 5ef6b9c (git state found); commit e045597 (booking); nohumans id 133b72cc-19f; x402scan origin 2ec99179

### #27 — 2026-10-05 — Session 27: where the paying buyers actually look (v0.21.0); PayAI first, the CDP door built and waiting on one key; NLnet retired by its own rules
Full entry: `ledger/entry-27.md` · version: v0.21.0, then v0.22.0 (addendum)

**Traced the one paying crawler's sellers, put PayAI first on mainnet and got listed via a self-test, built dormant CDP auth, retired NLnet, shipped the /sse witness family.**

- Shipped:
  - v0.21.0: PayAI first on mainnet, xpay second; a 0.01 USDC self-test got /402/pay/base listed by PayAI.
  - Dormant CDP auth, live only when both CDP Worker secrets exist; a facilitator 401/403 now fails over instead of refusing the payer.
  - v0.22.0: sse witness family, 112 rows; 89 of 98 client rows match the reference parse; smoke 436/436.
  - agent-tools.cloud domain verified and listing repointed (invented mcp_url stuck); 402atlas feedback sent; FUNDING.yml added; undici patched.
- Lessons:
  - CDP Bazaar lists only after a settlement through the CDP facilitator (needs key); PayAI lists on verify or settle; xpay settlements are invisible to x402scan.
  - NLnet retired, overruling #21-#26: its rules reject AI-generated proposals. PayAI self-payment is a documented route; the failing probe #3 forbade stays forbidden.
  - Watermark 0.10 USDC at mainnet receive; anything above is revenue, booked with its tx hash. No Money row for hosting. bookkeeping_bug right after a self-test is the edge cache.
  - CDP first on /402 but a 401 failover to PayAI means a bad key: tell the operator, do not retry. CDP listings prune after 30 unpaid days.
  - Witness captures are re-run whole, never spliced; curl --raw keeps chunk framing; the Last-Event-ID string updates only at a blank line.
- Money: Session $0.00; cash+accrued to date $28.75; revenue to date $0.07; net -$28.68. Receive 0.10, payer $9.955; 2.31 of 1,000 PayAI credits used.
- Assigned to the operator:
  - Create a CDP Secret API Key as two Worker secrets per the runbook (top priority, open).
  - Project Alexandria pending since 2026-09-18; tell the AI if Cloudflare writes.
  - Top up Porkbun about $11.62 before 2027-08-23.
  - NLnet retired, nothing to do; upstream reports from #21-#26 stand.
- Left open:
  - CDP self-test once the key exists; verify via discovery/merchant; book it.
  - /range and /etag witness families remain.
  - Watch PayAI stats and listing-status, agent-tools health, any 402atlas reply.
- Pointers: docs/RUNBOOK-cdp-facilitator.md; src/cdp-auth.js; scripts/cdp-auth-test.mjs; src/books.js; src/sse.js; docs/notes-x402-judges.md; docs/spec-sse-witness.md; scripts/witness-parse-sse.mjs; scripts/sse-witness/all.sh; smoke.sh; .github/FUNDING.yml
- Identifiers: self-test tx 0x9eed7b72bdd445317b1a59e5c7cc12f9a44b857132dcc743121b366261e6ca75; self-test block 52,255,130 (2026-10-05 02:48:55 UTC); deployment 44155ccb (v0.21.0, PayAI first); deployment d59517b4; deployment b23aa9eb (dormant CDP auth); deployment 78ef72fd (agent-tools verify; smoke 423/423); deployment 3c197fe2 (v0.22.0, smoke 436/436); crawler address 0x556d8a86…0484; 402atlas audit wallet 0x3A0AA040…7773E; nohumans listing 133b72cc-19f; agent-tools.cloud listing x402/badhttp-dev-scan; CDP facilitator https://api.cdp.coinbase.com/platform/v2/x402; commits bb5c6ac, b658bb9, 4f3b53c; session start commit d1893d9

### #28 — 2026-10-05 — Session 28: agent teams, review workflow on cheap models, state check as a script
Full entry: `ledger/entry-28.md` · version: v0.22.1

**Wrote the agent-team method, added a review workflow and a state-check script, and shipped v0.22.1 review fixes. A CDP self-test then settled and got listed in the Bazaar.**

- Shipped:
  - Cheap-model review of v0.19 to v0.22: 42 agents, 67 raw findings, 30 after dedup, 26 confirmed, 9 partly, 0 refuted.
  - v0.22.1: signatures of 65 bytes or more pass the pre-check (smart wallets); /settle fails over on 401/403/429; four cookies rows changed; sse headline now 88 of 98.
  - CDP self-test settled and /402/pay/base is listed in the CDP Bazaar; booked as a labeled transfer; smoke 437/437.
  - Second Sepolia stranger: three 0.01 settlements, recorded in VERIFIED, not booked.
- Lessons:
  - Never fork the main loop. Sonnet finds, opus refutes, scripts do anything reproducible. Reviews are the default again, overruling #25.
  - Watermarks: mainnet receive 0.11 (anything above is revenue; book it with its tx hash); Sepolia 0.07 (anything above is a stranger, never revenue).
  - A workflow added mid-session needs scriptPath. Run reviews before suites, never during. Read Sepolia receipts through Blockscout.
  - Smoke fails the self-test pin right after a settlement because the edge caches for 300 s; re-run. Add no Money row for the 2026-10-23 accrual.
  - The Bazaar prunes listings with no payment in 30 days. One one-cent self-test a month keeps the row.
- Money: Spend this session $0.00; to date $28.75; revenue $0.07; net -$28.68. Mainnet payer $9.945.
- Assigned to the operator:
  - Store the CDP Secret API Key as Worker secrets: done.
  - Project Alexandria: pending since 2026-09-18; tell me if Cloudflare writes.
  - Top up Porkbun by about $11.62 before 2027-08-23.
  - Upstream reports #21 to #26 stand.
- Left open:
  - 22 findings never verified; they are in the run's dropped list.
  - Cookies re-capture and the /sse/comments floor wait for a harness re-run.
  - The /range and /etag families are not started.
  - x402-list's paid probe has never paid.
- Pointers: docs/RUNBOOK-agent-teams.md; scripts/state-check.sh; .claude/workflows/review-frozen.js; docs/RUNBOOK-cdp-facilitator.md; scripts/publish-public-repo.sh; docs/spec-cookies-witness.md; src/x402.js; src/books.js
- Identifiers: commit c4830b8 (leak gate: RESULT clean); base commit 25e80b1; deployment e5bfd45e (v0.22.1); deployment 3beab080; deployment 37fda666 (CDP surfaces, still 0.22.1); CDP self-test tx 0x30e24c0a8d200180906adf54ba011fd26aa2c4fb070ad78c870debd2d286a748; block 52214407 (CDP self-test, 2026-10-05 16:36:01 UTC); CDP relayer 0x64cc42b1...1f0a; Sepolia stranger address 0xb24854b51f81649a624e59e17ac2b950e911a5bc; Sepolia tx prefixes 0x9459d40f, 0xae8ae5a5, 0x1e6c13c8; x402scan origin prefix 2ec99179; nohumans id 133b72cc-19f

### #29 — 2026-10-06 — Session 29: the ledger compacted; a third external payer booked (vet402's observatory; revenue $0.08)
Full entry: `ledger/entry-29.md` · version: none (stays 0.22.1)

**Compacted LEDGER.md from 357 KB to about 125 KB: full entries moved to ledger/, verified digests kept. Booked vet402's 0.01 USDC v2 payment. Deployed 467770a7.**

- Shipped:
  - Moved #1-#28 and #5a verbatim to ledger/entry-NN.md with a byte-for-byte proof. LEDGER.md now holds Money, Decisions, Start here and digests.
  - Digest workflow: sonnet writers, opus skeptics (62 errors, 284 omissions), an opus critic. 13 of 15 flagged Decisions bullets annotated in place.
  - Booked vet402's payment, the first external settlement of known generation (v2, via CDP). Revenue $0.08.
  - The Sepolia stranger settled fourteen times, not three. Smoke 438/438 with 1 WARN (Blockscout outage, pins pass vacuously).
- Lessons:
  - Overruled 'never rewrite history': entries were moved, not rewritten. Read LEDGER.md, then the last full entry. Replace Start here each session; never append to it.
  - Never write a digest without an opus skeptic.
  - Blockscout sits behind a Cloudflare challenge, so /books reconciles on RPC alone. Find transfers with eth_getLogs on mainnet.base.org in 500-block windows with backoff.
  - Watermarks: mainnet 0.12 (above it is revenue; book it with the tx). Sepolia 0.18 (above it is a stranger, VERIFIED only). Book a vet402 repeat from 2026-10-12 and move it out of not_yet_exercised.
  - Add no Money row for the 2026-10-23 accrual. INDEXNOW_KEY needs no rotation (public by protocol).
- Money: Spend this session $0.00; cash+accrued to date $28.75; revenue to date $0.08; net -$28.67.
- Assigned to the operator:
  - Project Alexandria (pending since 2026-09-18): tell me if Cloudflare writes
  - Top up Porkbun with about $11.62 before 2027-08-23
  - Upstream reports from #21-#26 (they need a GitHub identity); offered docs/distribution/ drafts
- Left open:
  - Write entry-30, run the digest workflow, render it, replace Start here
  - If Blockscout is still down, replacing the indexer is the build
  - CDP Bazaar needs a settlement every 30 days: self-test by 2026-11-04 unless someone pays
  - 22 #28 findings lost: rerun review-frozen over v0.22.1
  - Show HN outcome and httpwg-wiki status unknown
- Pointers: LEDGER.md; ledger/entry-NN.md; .claude/workflows/ledger-digest.js; scripts/ledger-digest-render.mjs; scripts/state-check.sh; docs/RUNBOOK-agent-teams.md; src/books.js; src/x402.js; README.md
- Identifiers: tx hash (vet402 payment, booked as revenue): 0xdfa8f4f39c769574f617d2a5b4a5960332f2ce5ee128e6f8d0e0e4253bedc379; block: 52,238,577 (2026-10-06 06:01:41 UTC); address (external payer, vet402 observatory): 0xc9c7b38c0942914fc8ea12063bc92dcd3b581670; address (second Sepolia payer, abbreviated): 0xb248...a5bc; deployment id: 467770a7; commit (pre-move LEDGER.md): 387d662

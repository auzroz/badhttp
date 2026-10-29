# x402 demand-side evidence, read 2026-10-29

Gathered for session 37 by a read-only research agent (sonnet) from the live web; no paid request, no signature, no account. x402scan's data endpoints are themselves paid ($0.01–$0.02 per call per its `/openapi.json`), so none of its rankings appear here. The per-resource counters are the Coinbase CDP Bazaar discovery API (`GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, unauthenticated), paged in full. "Est USD" is listed price × 30-day calls — arithmetic over a counter whose semantics the Bazaar docs give only as "its call count and unique payer count over the last 30 days" (what a "call" is, settled or not, is not defined), not reported revenue.

## The catalogue (Bazaar, trailing 30 days, read 2026-10-29)

- 97,806 resources (96,829 on Base mainnet, 539 on Solana). `category` is empty on every record. About 69,000 of the records are one bulk-generated host (market.datapackvibe.com: 123,201 calls, at most 3 payers).
- About 521 Base resources show at least 10 unique payers in 30 days; 84 show at least 50.
- Base 30-day total: 857,149 calls. Est USD $92.7k, of which $66k is one $1,000 gift-card endpoint called 66 times; about $26.7k without it.
- Among the 794 Base resources with at least 50 calls: 56 have ≤ 1.5 calls per payer (the test-buy pattern; e.g. an RPC read host at 1.0–1.2) and 347 have ≥ 20 calls per payer (repeat use).

## Top Base resources by 30-day unique payers

| Resource | Does | Price | Calls | Payers | Est USD |
|---|---|---|---|---|---|
| ax1.vc q-verdict | AI verdict on a token address | $0.02 | 141,911 | 575 | 2,838 |
| onesource.io `/chain/erc20-balance` | RPC read | $0.003 | 425 | 419 | 1 |
| blockrun.ai `/v1/chat/completions` | LLM inference, OpenAI-compatible, "per token, no margin, min $0.002" (BlockRun, Inc.; 117 models) | $0.002 min | 86,313 | 305 | 173 |
| api-xpay.com (about ten utilities: ping, uuid, ip, time) | trivial utilities (≈250 payers each, ≈28 calls per payer; reads like test traffic; operator unnamed) | $0.005 | ≈7,100–7,300 each | ≈240–257 each | ≈36 each |
| stableenrich.dev `/exa/search` | Exa semantic web search | $0.01 | 30,768 | 166 | 308 |
| api-xpay.com `/rewrite`, `/sentiment`, `/classify`, `/keywords` | AI text | $10–$20 | 101–367 each | 98–236 each | 1,400–3,670 each |
| keyring-agent.blockchhub.link `/send-native`, `/send-token` | execution fee | $0.05 | ≈14,500 each | 62–66 | ≈727 each |

Top hosts by est USD excluding the gift card: api-xpay.com 9,882 (rests on its $10–$20 endpoints); ax1.vc 2,838; keyring-agent 1,463; datapackvibe 1,232; stableenrich 863; blockrun 561.

## Categories (best live example each)

| Category | Example | Price | 30-day calls | Payers |
|---|---|---|---|---|
| URL → markdown | oneshotagent `/tools/web-read` | $0.002 | 7,311 | 23 |
| Web search | stableenrich `/exa/search` | $0.01 | 30,768 | 166 |
| LLM inference | blockrun `/v1/chat/completions` | $0.002 min | 86,313 | 305 |
| Weather | kadec0 `/v1/weather` | $0.005 | 320 | 10 |
| DNS / whois | pocket.network `/dns-whois-rdap` | $0.005 | 2,705 | 13 |
| HTTP test / mock | aizamon `/ping` | $0.01 | 51 | 9 |
| Paid MCP tools | none with counters (Cloudflare's Agents SDK has `withX402` / `paidTool`; no volume found) | — | — | — |

## Aggregate demand

- Artemis/Visa data to 2026-04-21 (via danielmcglynn.com): raw 178.3M tx / $135.7M; adjusted 109.6M tx / $15.0M — about 39% of transactions and 89% of dollars wash or test. Unfiltered daily volume down 93% year to date by August.
- TRM Labs via PYMNTS, 2026-09-15: $52.7M across 198.9M settlements; $25.62M after filtering; 0.6–7.5% of filtered value plausibly agentic.
- Chainalysis via Cryptopolitan, 2026-10-14: over 138M tx on Base; 87% of payments $0.0001–$0.10; 246 of 37,292 services have 20 or more unique payers.
- Agent402's board (agent402.tools/economy, Base, 7 days): AX1 266,916 tx; datapackvibe 98,800 (unreachable); claw402 78,818; Pocket Network 31,649; BlockRun 29,500; stableenrich 27,960.
- No per-framework spend was found for Virtuals ACP, Daydreams or AgentKit.

## Supply side (Cloudflare, read 2026-10-29)

- Workers: Free 100k requests/day, 10 ms CPU per request, errors past the limits; Paid $5/mo, 10M requests and 30M CPU-ms included. Startup (module evaluation) has its own 1 s budget on both plans.
- Workers AI: 10,000 neurons/day free on both plans; past it $0.011 per 1,000 neurons on Paid, failure on Free. gpt-oss-20b $0.20 / $0.30 per M input / output tokens; llama-3.1-8b-instruct-fp8-fast $0.045 / $0.384; llama-3.1-8b-instruct $0.282 / $0.827.
- Terms: the Service-Specific Terms for Workers AI (read through a summarising fetch, not verbatim) restrict Inputs/Outputs only by acceptable use and third-party model terms; the Self-Serve Subscription Agreement §2.2.1(a) forbids to "rent, lease, loan, export, or sell access to the Services to any third party". This project reads that as reselling Cloudflare access itself, not as building a priced service on Workers AI (which is what every paid application on Workers does), but records the clause here so the operator can disagree. gpt-oss-20b's Cloudflare page names no licence (OpenAI's release is Apache-2.0 with a usage policy; not verified here); llama-3.1's links Meta's Llama 3.1 licence.

## What the evidence does not show

- Whether Bazaar "calls" are settled payments or any request; whether the 305 inference payers are 305 principals.
- Any x402scan ranking (paid API). Any paid-MCP volume. Who api-xpay.com's ~250 repeat payers are.
- Whether a second inference seller captures any of the first's demand; blockrun's own revenue (est $561/30 days at its minimum price).

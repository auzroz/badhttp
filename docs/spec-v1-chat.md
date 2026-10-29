# `/v1/chat/completions` — the one thing on badhttp.dev that is for sale (session 37, 2026-10-29; v0.31.0)

## Why this exists

Thirty-six sessions of a free HTTP test fixture earned $0.12, all of it from machines that measure x402 sellers. On 2026-10-29 the operator answered the standing decision (#30) with a fourth option: continue, with breakeven as the mandate and the original concept negotiable. The demand-side evidence read the same day (Coinbase Bazaar counters for the trailing 30 days, Base mainnet; `docs/research-x402-demand-2026-10-29.md`) shows where repeat x402 demand actually is: LLM inference (one seller: 86,313 calls from 305 distinct payers at a $0.002 minimum), web search (30,768 calls, 166 payers at $0.01), and little else outside wash and test traffic. Inference is the one category this project can supply from the infrastructure it already pays for: Workers AI bills per token at a fraction of those prices and includes 10,000 neurons a day free on either Workers plan, and the x402 settlement path (two protocol generations, facilitator failover, CDP first) has been live since session 2.

So this is a paid, OpenAI-compatible chat-completions endpoint, priced flat per request in USDC on Base, settled through x402, served by Workers AI. It is honest about being a resale: the model names are Cloudflare's, the price is published beside the cost, and nothing about it misbehaves. It is also, deliberately, the first `/402`-family resource whose paid content has value to anyone but a measurer.

## Contract

| | |
|---|---|
| `POST /v1/chat/completions` | The paid resource. Body: OpenAI chat-completions JSON (`model`, `messages`, optional `max_tokens`, `temperature`, `top_p`, `seed`). |
| `GET /v1/models` | Free. The two model ids, their prices per request, and their caps. OpenAI `list` shape. |
| `GET /v1` | Free. This contract as JSON (price, caps, how to pay, what is logged, the cost basis). |
| `GET /v1/chat/completions` | 405 with the how-to; never a 402 (a GET cannot carry a chat). |
| Price | **0.002 USDC per request** (`2000` atomic units), flat, whatever the token count up to the caps. Network **Base mainnet, `eip155:8453`**, by default. |
| Sandbox | `?network=base-sepolia` offers the same request for test USDC (`eip155:84532`): model forced to `llama-3.1-8b-instruct-fp8-fast`, content capped at 2,000 bytes and `max_tokens` at 64, so test money buys at most about $0.0001 of compute per call. **On the sandbox the test payment settles before the model runs** (test USDC costs its holder nothing, and settling first is what stops faucet money from buying unpaid compute through parallel authorizations); on mainnet the model runs first. For client developers; documented as such. |
| Models | `gpt-oss-20b` (default; alias `@cf/openai/gpt-oss-20b`) and `llama-3.1-8b-instruct-fp8-fast` (alias `@cf/meta/llama-3.1-8b-instruct-fp8-fast`). Anything else: 400, free. |
| Caps | 1–64 messages, roles `system`/`user`/`assistant`, string `content` only; total `content` ≤ **8,000 UTF-8 bytes** (bytes, not characters: a character can be one token or three); `max_tokens` default 512, maximum 1,024; `temperature` 0–2; `top_p` 0.001–1; `seed` 1–9999999999; `stream` must be absent or `false` (a streamed body cannot be settled after delivery); no `tools`, `functions`, `response_format`, `n` > 1. Body ≤ 64 KiB. Over a cap: 400, free. |
| Order of operations | Validate the body (400s are free and never ask for a signature) → no payment: 402 → payment: facilitator `/verify` → **run the model** → facilitator `/settle` → 200. A model failure after a valid verify answers 502 with `charged: false` and nothing is settled; an **empty** completion (a reasoning model that spent its budget thinking) is a failure, not a product. A settlement failure after the model answered is answered as `/402/pay` answers it (`502 settlement outcome unknown`, `202` pending with the hash, or the 402 with the facilitator's reason), with the completion included (`delivered`) whenever the caller may have been charged. |
| 402 | Both generations, as `/402/pay`: v2 `PAYMENT-REQUIRED` header (one `accepts` entry, `exact`/EIP-3009, `maxTimeoutSeconds` as `/402/pay`) with the `bazaar` extension describing the POST body; v1 `accepts` in the JSON body (`maxAmountRequired: "2000"`, plain network name). `resource.url` is the exact request URL (query included). |
| Brakes | What the project can be made to pay for is bounded twice (review finding, session 37): **one request in flight per payer** (a facilitator's `/verify` checks each authorization's balance alone, so one balance could otherwise sign many; per isolate, and per colo through the Cache API; 30 s soft lock released on settle; a second concurrent request from the same payer gets 409, free), and **a ceiling on each isolate's estimated model spend per rolling hour** ($0.25, from the usage the model reports), past which it answers 503 with `Retry-After` before asking anyone for a signature. Both are published on `GET /v1`. |
| 200 | OpenAI `chat.completion`: `id`, `object`, `created`, `model` (the Cloudflare id), `choices[0].message.content`, `finish_reason`, `usage` (prompt/completion/total tokens as Workers AI reports them, or `null` when it does not), plus an `x402` object: `paid`, `network`, `amount_usd`, `transaction`, `explorer`, `facilitator`, `failed_over_from`, `payer`, `charged_for: 'one request, flat'`. Receipt in `PAYMENT-RESPONSE` (v2) or `X-PAYMENT-RESPONSE` (v1). `cache-control: private, no-store`. |
| Logging | None by this Worker (invocation logs are off; prompts and completions are not retained by it). The prompt is processed by Cloudflare Workers AI under Cloudflare's terms; the x402 payload goes to the facilitator as on `/402/pay`. Cloudflare's edge keeps sampled request metadata as for every route. |
| Cost basis (published on `/v1` and `/books`) | Workers AI list prices read 2026-10-29: gpt-oss-20b $0.20 / $0.30 per million input / output tokens; llama-3.1-8b-instruct-fp8-fast $0.045 / $0.384. Worst case at the caps, counting 0.75 tokens per byte (emoji): a gpt-oss-20b request costs about $0.0015, three quarters of the price; English text (about 0.25 tokens per byte) about $0.0007. The first 10,000 neurons a day are included in the plan. |

## Discovery

`/openapi.json` (path, `x-payment-info` as on `/402/pay`), `/.well-known/x402` (a POST resource beside the three GET ones), `/llms.txt`, one paragraph on the home page, `for_sale` on `GET /402`, `/v1` in the sitemap, `Allow: /v1` in robots. The CDP Bazaar lists a resource when a payment for it settles through that facilitator (session 28); one 0.002 USDC mainnet self-test from the project payer, booked as a labeled transfer, is the documented route in. x402scan is re-registered after the OpenAPI change.

## Rules

- Never settle before the model has answered. Never run the model before a facilitator has verified. The two are the whole correctness argument of a paid API.
- Testnet money buys the sandbox shape only. Mainnet money buys the real one. Nothing is free except validation errors, `/v1` and `/v1/models`.
- The price is a product price, published with its cost basis; it is not set to any observatory's ceiling (the #30 rule stands).
- Revenue here is booked exactly as `/402/pay` revenue is: by transaction hash, the session it is noticed, into the earned column.
- The endpoint behaves. It is excluded from the corpus and from every witness family: it is not an edge case.

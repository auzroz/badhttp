# How the x402 ecosystem's judges actually parse a 402 (findings on the record)

Facts established empirically by this project, 2026-08-25 → 2026-08-29. Written down because they
contradict reasonable assumptions (including one this project's own research made in LEDGER.md #8)
and future integrators should not have to re-buy the lesson.

## Header-first is NOT universal

Session 8's research established that the v2 reference client (@x402/fetch), x402scan's probe, and
nohumans.directory's scout all read the `PAYMENT-REQUIRED` header first and consult the 402 body only
when the header is absent. That is true of those three — but **x402-trust (x402.fuchss.app) classifies
the payment envelope from the 402 BODY alone**, ignoring the header entirely.

Evidence: badhttp has emitted the x402 v2 `PAYMENT-REQUIRED` header on `/402/pay/base` since session 2,
byte-identical and smoke-pinned, alongside (since session 8) a spec-valid x402 v1 JSON body for legacy
clients. x402-trust's paid report flags the endpoint `v1-envelope` (warn severity) with the advice
"also emit a v2 envelope (PAYMENT-REQUIRED header + `amount` field)" — i.e. exactly what we already
emit. Three paid reports across three days (2026-08-28 ×2, 2026-08-29; the third bought after their
documented ≥6h double-confirmation window, and after we additionally added an `amount` alias inside
the v1 body's accepts entries) all carry the identical flag. Conclusion: their classifier keys on the
body's `x402Version: 1` and no body-side change can clear the flag without dropping the v1 body —
which would break the actual deployed v1 clients the body exists to serve (x402-fetch ≤1.2.0 and
python x402<2 read ONLY the body; the v1 `x402` npm package alone did 385k downloads/week as of
session 8's research).

**Decision (session 14): live with the warn flag.** Dual-form is provably correct on the wire (all
four cells of {v1,v2}×{Sepolia,mainnet} settled on chain; hashes in `GET /402`), it maximizes who can
actually pay, and the flag is warn-severity under a C grade that has been drifting UP as the dual-form
era dominates their 30-day window (D 40.1 → C 58 → C 61.6 → C 62.7). Any dual-form seller should
expect the same permanent flag from x402-trust and can cite this file.

## Other judge behaviors worth knowing (established earlier, collected here)

- **x402scan** stores OpenAPI path templates as literal URLs (`/sse/%7Bflavor%7D`), and monitors then
  probe those ghost URLs at scale (~600/day here). Fix that worked: answer documented brace-literal
  templates with a 200 machine-readable explainer (session 7; `src/template.js`). Their registry is
  mainnet-only and strips query strings — hence the `/402/pay/base` path form.
- **x402-trust** probes from a single EU vantage; part of their "uptime" number is their own network
  weather (verified against edge analytics in session 7: every probe that reached Cloudflare got a
  correct answer). Their settlement indexer watches the payTo address and once attributed an inbound
  funding transfer ($10 to our payer) as endpoint volume. Their free endpoint page is a cached
  snapshot (≤24h); flag details are paid-report-only; flags change only on double-confirmed
  observations ≥6h apart — read their freshness rules BEFORE paying for a re-score.
- **nohumans.directory** requires a listing's `sample_query` URL to keep answering 200/JSON; their
  scout pays listed endpoints real USDC from a published address (paid verification with an on-chain
  tx as proof). Listing here: verified, not yet paid-verified.
- The undefined-vs-null / omit-vs-empty family of traps has bitten this project four times (LEDGER
  #5, #8 ×2, #12); in x402 specifically: legacy zod requires `outputSchema` be OMITTED (never null),
  and an empty `PAYMENT-SIGNATURE` header must be treated as absent via a null-check, never
  truthiness.

## Session 21 (2026-09-08) — directory additions, and a directory that does not exist

**x402-list.com — approved, and it pays.** The #19 submission was approved 2026-09-08 07:20 UTC.
Read their API rather than their email: `GET /api/v1/services/badhttp` →
`status online, payment_ready true, verified false`, uptime 100% on all four windows (33 checks),
3 endpoints, `risk_level clean`, avg 229 ms / p95 453 ms, `traction` all zero. Their
`/methodology` states the tier rules plainly: **`verified` is earned only by a real paid call** —
"we paid this endpoint and it delivered" — the fee covers their probe cost, an undelivered call
still costs them the fee, and the badge cannot be bought. So they are the second paying scout this
project has ever been in front of. `payment_ready` is granted automatically to any endpoint
returning a well-formed 402; it is not a payment.

**402atlas.com — a fourth paying directory, and badhttp is not in it.** Their `/llms.txt` reports
495+ paid calls for ~$5.25 total (~$0.0106 each, i.e. they pay the endpoint's own quoted price) and
a 138-service verified catalogue with no badhttp row. Submissions go through an anonymous
unauthenticated POST to `/api/feedback`. Realistic yield: one payment of $0.01, once.

**The two catalogues paying agents actually query, where badhttp is absent.** The Coinbase CDP
x402 Bazaar (`api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, 14,430 resources) and
PayAI's facilitator discovery (`facilitator.payai.network/discovery/resources`, 28,320) — both
unauthenticated reads, both with zero `badhttp` hits, and PayAI is one of our own configured
facilitators. These are a bigger discovery gap than any web-form directory.

**TOLL·402 — still frozen.** The #19 submission never appeared; `?q=badhttp.dev&mode=resources`
returns 0 against a 3,917-provider control, and their resource index `generatedAt` has been
2026-08-25 since #20. Treat as dormant.

**"Cleared Index" — a cold email for a listing that cannot exist.** From a role mailbox at `clearedindex.com`,
2026-09-08 07:31 UTC, eleven minutes after the x402-list approval: claimed to have indexed
badhttp.dev on a "trust layer agents hit before they pay x402", supplied a listing URL and a
**tokenised claim/opt-out link** (both the same token). Established in about thirty seconds:
domain registered 2026-08-19 (three weeks old, DreamHost, Vercel nameservers), **A record
`0.0.0.0`, AAAA `::`, no MX, no SPF, no TXT** — nothing is served and nothing can be. Neither link
was visited: they share one token, so the opt-out confirms a live, monitored mailbox exactly as
the claim does.

**The generalisable lesson.** Being listed in real directories makes a project's published contact
a target for fake ones, and the check is cheap: `dig +short <domain> A` and look for `0.0.0.0`, then
`dig MX` and `dig TXT`. Note that `0.0.0.0` means *abandoned* at least as often as *fraudulent* —
`mockbin.org`, a formerly real Kong service, resolves to exactly the same address today.

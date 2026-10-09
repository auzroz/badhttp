# Runbook: putting badhttp into the Coinbase CDP Bazaar

Written 2026-10-05 (LEDGER.md #27). Status: **code deployed and dormant; waiting on one human step.**

## Why

The CDP Bazaar (`GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, 34,325 resources on
2026-10-05) is the catalogue the official x402 SDKs query for discovery, and it is where paying buyers look: of the
92 sellers the anonymous automated buyer of 2026-09-24 paid in two days, 66 are in it. A resource enters the Bazaar
in exactly one way — a payment for it **settled through the CDP facilitator** while the 402 carried the `bazaar`
extension (which badhttp's `/402/pay` has carried since v0.3.0). Coinbase's docs: "There is no registration form or
separate API call." Resources with no settlement for 30 days are removed.

The CDP facilitator needs a CDP API key (`401 Unauthorized` on every route without one, including `/supported`).
Creating that key means a Coinbase Developer Platform account, which is a human step and the operator's call.
Pricing (docs.cdp.coinbase.com/x402/seller/facilitator, 2026-10-05): the first 1,000 on-chain transactions each
month are free, then $0.001 each; verification is free. At this project's volume the cost is $0.00.

## What is already in place

- `src/cdp-auth.js` builds the bearer token with Web Crypto: header `{alg, kid, typ, nonce}`, claims
  `{sub, iss: "cdp", uris: ["POST api.cdp.coinbase.com/platform/v2/x402/verify"], iat, nbf, exp: +120 s}` —
  byte-for-byte the shape `@coinbase/cdp-sdk` 1.57.1 produces (`scripts/cdp-auth-test.mjs` proves it against the
  SDK with throwaway keys of both formats the portal issues: Ed25519 → `EdDSA`, P-256 PKCS#8 PEM → `ES256`).
- `src/x402.js` puts `https://api.cdp.coinbase.com/platform/v2/x402` FIRST in the Base-mainnet v2 facilitator chain
  **only when** `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are present in the Worker's environment; otherwise the chain
  is unchanged (PayAI, xpay, Mogami, Heurist). A `401`/`403` (or `429`) from any facilitator is treated as the project's
  credential problem (or its rate limit), not the payer's, and fails over to the next facilitator at `/verify` and,
  since session 28, at `/settle` too (nothing is broadcast when a facilitator answers `/settle` with one of those three
  statuses, so the next facilitator verifies and settles instead). Any other `/settle` failure after a successful
  `/verify` still answers `502 settlement outcome unknown`, because the transfer may have been broadcast.
- `GET /402` shows the live chain under `facilitators.base`, so the change is visible the moment the secrets land.

## The operator's step (minutes)

1. Create a Secret API Key at https://portal.cdp.coinbase.com (Ed25519 is their default). Copy the key **ID** and
   the key **secret** once; the portal shows the secret once. No wallet secret is needed for the facilitator.
   **Permissions (checked against docs.cdp.coinbase.com, 2026-10-05):** the facilitator "authenticates with your CDP API
   key ID and secret" and nothing else — a Secret API Key proves project ownership; a *Wallet Secret* is for signing
   wallet transactions and is not used here (settlement is relayed by Coinbase, not from any wallet of ours). So:
   leave the optional "Permission restrictions" at their default (the facilitator needs no trade/transfer rights);
   do **not** set an IP allowlist (the Worker calls from Cloudflare's egress addresses, which are not ours to pin);
   keep the default Ed25519 algorithm (`src/cdp-auth.js` handles P-256 too). The key can be revoked in the portal at
   any time; a revoked or wrong key costs nothing but a failover to PayAI. The only trace on a successful `/402/pay/base`
   response is its `facilitator` field (PayAI's URL instead of CDP's) and, since v0.23.0, `failed_over_from` naming the
   facilitators that refused with their status; `details` appears only on the 502 when every facilitator fails. Check it
   with a self-test (`scripts/x402-pay.mjs`) and read `facilitator` in the body.
2. From the repository directory, with `.env` loaded (`set -a; source .env; set +a; export PATH=/opt/homebrew/bin:$PATH`):

       ./node_modules/.bin/wrangler secret put CDP_API_KEY_ID
       ./node_modules/.bin/wrangler secret put CDP_API_KEY_SECRET

   Paste each value when prompted. Secrets survive deploys; nothing is committed. **Never put either value in
   `.env`'s tracked neighbours, the ledger, or a commit.** Keep a copy in the password manager with the other keys.
3. Tell the AI it is done (or just leave the secrets in place): the next session verifies it.

## The AI's step, next session

**Done 2026-10-05 16:36 UTC (LEDGER.md #28 addendum 2):** `/402` showed the CDP URL first; one self-test settled with `facilitator` = CDP (tx `0x30e24c0a8d200180906adf54ba011fd26aa2c4fb070ad78c870debd2d286a748`, block 52214407); the merchant-discovery read listed `/402/pay/base` within the minute; `validate` returned the bazaar extension; booked. Repeat the four steps whenever the key is rotated. **Keep it listed:** CDP prunes a resource ~30 days after its last settlement through that facilitator, so if nobody else pays, one one-cent self-test a month holds the row (a maintenance cost, logged each time).

1. `curl -s https://badhttp.dev/402 | jq .facilitators.base` must start with the CDP URL.
2. One self-test settlement with the project's mainnet payer (LEDGER.md row 3 working capital; labeled transfer,
   never revenue): `X402_TEST_PAYER_KEY=$X402_MAINNET_PAYER_KEY node scripts/x402-pay.mjs https://badhttp.dev/402/pay/base eip155:8453`
   — the body's `facilitator` field must be the CDP URL and the receipt must carry a transaction hash.
3. `curl -s 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x2b14ad50d63c7fee5a33847f95153ac37a690170'`
   (public, no key) must list `https://badhttp.dev/402/pay/base`. Also `POST …/x402/validate` with
   `{"resource":"https://badhttp.dev/402/pay/base","method":"GET"}` (public dry run) should report `valid: true`.
4. Book the self-test in `src/books.js` `chain_movements`, update `VERIFIED.catalogues`, log it in the ledger.
5. The Bazaar drops a resource after 30 days without a settlement. Real payments keep it listed; if none arrive in a
   month, one self-test a month (one cent, between project addresses) is the documented maintenance cost — note it.

## If it fails

- `facilitator_rejected_payload` with the CDP URL in `facilitator`: the JWT was accepted but the payload was not —
  read the `detail`. A `401` never reaches the payer: whether it arrives at `/verify` or at `/settle`, the payment fails over to PayAI and still settles.
- To disable without touching secrets: `wrangler secret delete CDP_API_KEY_ID` restores the previous chain.

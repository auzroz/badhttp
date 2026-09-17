# Registering a domain at Porkbun by API — what this project learned

Porkbun publishes its own end-to-end guide for autonomous agents (see the links below); read that
for the flow. An earlier version of this file reproduced it verbatim, which is not ours to
relicense under MIT, so this file now keeps only what this project added from doing it (LEDGER.md #1).

## The five things the guide does not stress enough

1. **Carry the quote forward.** `checkDomain` returns the price in USD; `domain/create` wants the
   cost in integer US cents and rejects a mismatch. `badhttp.dev` was 875.
2. **Check `getRegistrationRequirements/<tld>` before anything else.** Some TLDs are website-only and
   the API cannot submit them; discovering that from a failed create wastes the rehearsal.
3. **Rehearse with `dryRun`, then create with an `Idempotency-Key`.** The dry run reports
   `wouldSucceed`, `cost` and `balance`; the real call with the same key is safe to retry.
4. **The account's email and phone must be verified before the first registration**, or the API
   answers `VERIFICATION_REQUIRED`. That is a human step, and it blocked session 1 for an hour.
5. **`INSUFFICIENT_FUNDS` means exactly that.** Registration needs the full price as account credit;
   the operator tops up, the project asks (LEDGER.md, Decisions in force). Renewal comes out of the
   same credit, and auto-renew is on for `badhttp.dev`.

## Guardrails this project relies on

- The API settings page can cap monthly API spend, alert on a low balance and auto top-up; a
  registration that would breach the cap fails with `MONTHLY_SPEND_LIMIT_EXCEEDED` rather than
  going through. This project keeps its balance small on purpose (LEDGER.md, Money table) and the
  operator tops it up for a renewal, so the cap is a second guard, not the first.
- A key can be limited to named domains and source addresses; this project's key is used from one
  machine for one domain.

## Links (Porkbun's own material)

Related:

- [Getting started](https://porkbun.com/llms/guides/getting-started) · [Dynamic DNS](https://porkbun.com/llms/guides/dynamic-dns)
- Domain endpoints: https://porkbun.com/llms/domain


More:

- Guides (how-tos): https://porkbun.com/llms/guides
- Topic index: https://porkbun.com/llms
- Full reference (one file): https://porkbun.com/llms-full.txt
- OpenAPI spec (full schemas): https://porkbun.com/api/json/v3/spec
- Short overview: https://porkbun.com/llms.txt
- Official MCP server: https://github.com/oborseth/Porkbun-MCP (`npx -y @porkbunllc/mcp-server`)
- Create API keys: https://porkbun.com/account/api

# Runbook: register badhttp.dev and attach it (session 2)

Pre-reqs in `.env`: `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY`, `CLOUDFLARE_API_TOKEN`.
Load them with `set -a; source .env; set +a`.

## 1. Register the domain (Porkbun)

```bash
A='{"apikey":"'$PORKBUN_API_KEY'","secretapikey":"'$PORKBUN_SECRET_KEY'"'
curl -s -X POST https://api.porkbun.com/api/json/v3/ping -H 'Content-Type: application/json' -d "$A}"
curl -s -X POST https://api.porkbun.com/api/json/v3/domain/checkDomain/badhttp.dev -H 'Content-Type: application/json' -d "$A}"
#   -> confirm available, read price. If premium or > $15, fall back to badhttp.com (then keptbooks.fyi / publicbooks.fyi are NOT the product name; don't).
curl -s "https://api.porkbun.com/api/json/v3/domain/getRegistrationRequirements/dev" -H "X-API-Key: $PORKBUN_API_KEY" -H "X-Secret-API-Key: $PORKBUN_SECRET_KEY"
#   -> apiRegisterable must be true
COST=875   # integer US cents, must equal the quote from checkDomain
curl -s -X POST https://api.porkbun.com/api/json/v3/domain/create/badhttp.dev -H 'Content-Type: application/json' -d "$A,\"cost\":$COST,\"agreeToTerms\":\"yes\",\"dryRun\":true}"
#   -> wouldSucceed:true, sufficientFunds:true
curl -s -X POST https://api.porkbun.com/api/json/v3/domain/create/badhttp.dev -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d "$A,\"cost\":$COST,\"agreeToTerms\":\"yes\"}"
```

Log the exact charge in LEDGER.md immediately.

## 2. Create the zone on Cloudflare and point nameservers at it

```bash
npx wrangler whoami
# create zone in $CLOUDFLARE_ACCOUNT_ID, type full
curl -s -X POST https://api.cloudflare.com/client/v4/zones -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"badhttp.dev\",\"account\":{\"id\":\"$CLOUDFLARE_ACCOUNT_ID\"},\"type\":\"full\"}"
#   -> read result.name_servers (two *.ns.cloudflare.com)
curl -s -X POST https://api.porkbun.com/api/json/v3/domain/updateNs/badhttp.dev -H 'Content-Type: application/json' -d "$A,\"ns\":[\"NS1\",\"NS2\"]}"
```

## 3. Attach the Worker to the domain

Add to `wrangler.jsonc`: `"routes": [{ "pattern": "badhttp.dev", "custom_domain": true }]` then `npx wrangler deploy`.
Verify: `curl -sI https://badhttp.dev/status/418`.

## 4. Don't forget

- Touch only the `badhttp.dev` zone and the `badhttp` Worker. The account holds other zones and Workers that are not ours.
- Update `/books` (src/books.js) with the registration charge, redeploy, and append LEDGER.md entry #2.

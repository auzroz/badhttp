# Runbook: the one zone-level rate-limit rule (APPLIED 2026-08-23, session 4)

Why: the Worker has no rate limiting on purpose (an in-Worker limiter still bills the invocation). The right place is
the zone's WAF, which runs before the Worker. Budget exposure is real only if the URL gets hammered: Workers Paid
includes 10M requests/month, then $0.30 per million; `/delay`, `/drip`, `/sse` and `/402/slow` cost wall time, not CPU.

## What is in force

One rule in the zone's `http_ratelimit` phase (Free plan allows exactly one; period must be 10 s, characteristics must be
`ip.src` + `cf.colo.id`, mitigation timeout 10 s):

| field | value |
|---|---|
| expression | `true` (every request to the zone) |
| counting | per client IP, per Cloudflare colo, 10 s window |
| threshold | 100 requests per 10 s |
| action | block for 10 s |
| what the client sees | `429`, `content-type: text/plain`, body `error code: 1015`, `retry-after: N`, `server: cloudflare`; the Worker never runs |

Applied 2026-08-23 after the operator widened the token with Zone WAF: Edit (the first sign was the error changing from
`10000 Authentication error` to `10003 could not find entrypoint ruleset`). Look the rule id up via the API; do not write it here.

Observed on apply: a sequential curl loop cannot trip it (a fresh TLS handshake per request keeps one IP under ~10 req/s);
`seq 400 | xargs -P 40 curl` → 63 × 200, 337 × 429 in 1.3 s; the counter is approximate (Cloudflare counts per server within
a colo), so the first 429 can land anywhere between ~100 and ~160 requests. The block clears within 10 s. `scripts/smoke.sh`
(72 checks, ~90 requests over ~13 s from one IP) passes twice back-to-back with the rule in place.

The site documents the rule itself (home page footer, `/llms.txt`, `/openapi.json` `x-guidance`): it is not a scenario, and a
client hitting it should treat it as real.

## Read / change it

```bash
set -a; source .env; set +a
ZID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=badhttp.dev" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
# read
curl -s "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_ratelimit/entrypoint" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result.rules'
# replace (idempotent: PUT the whole rule list)
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' -d '{
  "rules": [{
    "description": "badhttp: per-IP ceiling. 100 requests per 10 s is far above any honest test loop.",
    "expression": "true",
    "action": "block",
    "ratelimit": { "characteristics": ["ip.src", "cf.colo.id"], "period": 10, "requests_per_period": 100, "mitigation_timeout": 10 }
  }]
}' | jq '{success, errors, rules: (.result.rules | length)}'
```

Verify: `seq 1 300 | xargs -P 30 -I{} curl -s -o /dev/null -w '%{http_code}\n' https://badhttp.dev/health | sort | uniq -c`
should show 429s; then wait 12 s and `scripts/smoke.sh https://badhttp.dev` must still pass. Do not go lower than 100/10 s:
the smoke suite alone makes ~90 requests in ~13 s and must keep passing from one IP. If the threshold or the text of the
rule ever changes, change the three places on the site that describe it in the same deploy.

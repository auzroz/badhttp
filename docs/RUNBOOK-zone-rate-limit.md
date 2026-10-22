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

## The custom rule (2026-10-22, LEDGER.md #33): `/compress/bomb` blocked for browser user agents

From 2026-10-15 ~02:00 UTC the zone received 2 to 6.5 million requests a day for `/compress/bomb?size=32` — one or two
per address through millions of distinct addresses (so the per-IP rule above never engaged), a fixed rotation of fake
desktop-browser user agents, 99.8% of all traffic. Every one reached the Worker and was billed: 36.3 million invocations
between 2026-10-01 and 2026-10-22 against 99,760 in all of September, an estimated $7.93 of request overage on the
operator's October bill (the books carry it). Cloudflare mitigated none of it. On 2026-10-22 19:11 UTC this rule went in
(phase `http_request_firewall_custom`, the zone's first custom rule; the Free plan allows five):

```
action: block
expression: (http.request.uri.path eq "/compress/bomb" and http.user_agent contains "Mozilla/")
```

A blocked request is answered by the edge (403, Cloudflare's block page, ~1.8 KB) and is not a Worker invocation. The rule
matches the claimed User-Agent, not the client: a browser, a browser driver (Playwright, Selenium) or a tool whose
default user agent contains `Mozilla/` (yt-dlp's does) must send another one to reach this one flavor — the surfaces
say so; curl, python, node, Go and every witness harness keep their own user agents and are served. The 200s stopped within four minutes of the rule's creation. The
three surfaces that describe the rate limit (home footer, `/llms.txt`, `/openapi.json` `x-guidance`) describe this
block too, pinned by `chk wafnote`; change all three in the same deploy if the rule changes.

```bash
set -a; source .env; set +a
ZID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=badhttp.dev" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
# read
curl -s "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_request_firewall_custom/entrypoint" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result.rules'
# replace (idempotent: PUT the whole rule list; an empty list removes every custom rule)
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' -d '{
  "rules": [{
    "description": "badhttp: /compress/bomb flood (2026-10-15 onward): millions of fake-browser user agents through residential proxies, one request per IP, each billed as a Worker invocation. A browser has no use for a gzip bomb; curl-like clients are unaffected.",
    "expression": "(http.request.uri.path eq \"/compress/bomb\" and http.user_agent contains \"Mozilla/\")",
    "action": "block"
  }]
}' | jq '{success, errors, rules: (.result.rules | length)}'
```

Verify: `curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/145.0.0.0' -H 'Accept-Encoding: gzip' https://badhttp.dev/compress/bomb`
prints 403 and the same request with curl's own user agent prints 200 (`chk bombwaf` in the smoke suite does both, against
the edge only). **Watch it each session**: `scripts/state-check.sh --cred` prints `bomb=`, `r403=` and `worker=` per day;
`worker` in the tens of thousands means the flood changed its user agent and the rule needs a new expression (note
`contains` is case-sensitive: a lower-case `mozilla/` would pass; `lower(http.user_agent) contains "mozilla/"` closes that) — the
candidates, in order of what they would break: block `/compress/bomb` for HTTP/2 desktop clients (breaks nothing
documented; the witness harnesses speak HTTP/1.1); require an explicit opt-in header for `?size=` above 8 MiB (changes
the documented interface); lower `compressBombMaxMiB` (changes what is tested). The Worker cannot defend itself: a
Worker-side 4xx is still a billed invocation. Nothing here uses a bot product, a challenge, or anything that would
refuse a non-browser client — that rule (session 6) stands.

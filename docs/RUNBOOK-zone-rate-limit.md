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

## The custom rules (2026-10-22 and 2026-10-23, LEDGER.md #33 and #34): `/compress/bomb` blocked for browser user agents, and above 8 MiB without an opt-in header

From 2026-10-15 ~02:00 UTC the zone received 2 to 9 million requests a day for `/compress/bomb?size=32` — one or two
per address through millions of distinct addresses (so the per-IP rule above never engaged), a fixed rotation of fake
desktop-browser user agents, 99.8% of all traffic. Every one reached the Worker and was billed: 36.3 million invocations
between 2026-10-01 and 2026-10-22 against 99,760 in all of September, an estimated $7.93 of request overage on the
operator's October bill (the books carry it). Cloudflare mitigated none of it. The zone now carries two custom rules in
phase `http_request_firewall_custom` (the Free plan allows five), both `action: block`; the canonical list is
`docs/waf-custom-rules.json` and the PUT below replaces the whole list with it:

```
1. (http.request.uri.path eq "/compress/bomb" and lower(http.user_agent) contains "mozilla/")
   — 2026-10-22 19:11 UTC; case-insensitive since 2026-10-23 (the first form was `http.user_agent contains "Mozilla/"`).
2. (http.request.uri.path eq "/compress/bomb" and any(http.request.uri.args.names[*] == "size")
    and not all(http.request.uri.args["size"][*] in {"1" "2" "3" "4" "5" "6" "7" "8"})
    and not any(http.request.headers["x-badhttp-bomb"][*] == "accept"))
   — 2026-10-23: any explicit ?size= whose values are not all among the exact strings 1–8 (`08`, `abc`, `33` and an
   empty value included, since the edge compares strings) needs the documented header `x-badhttp-bomb: accept`,
   whatever the user agent and whatever the method (an OPTIONS for such a URL is blocked too). The flood's URL is ?size=32, so a change of browser string alone no longer reaches the Worker; the
   default bomb and ?size= 1–8 are untouched. The Worker enforces the same contract itself (403 `opt-in required`),
   so local dev and anything the edge lets through behave the same.
```

A blocked request is answered by the edge (403, Cloudflare's block page, ~1.8 KB) and is not a Worker invocation. Rule 1
matches the claimed User-Agent, not the client: a browser, a browser driver (Playwright, Selenium) or a tool whose
default user agent contains `Mozilla/` (yt-dlp's does) must send another one to reach this one flavor — the surfaces
say so; curl, python, node, Go and every witness harness keep their own user agents and are served. Rule 2 asks a
client that wants more than the default 8 MiB to say so with one header, which the surfaces document. The 200s stopped
within four minutes of rule 1's creation; on 2026-10-23 the flood ran at 8.9 million requests a day into rule 1 with
the Worker at its baseline (14,742 invocations). The three surfaces that describe the rate limit (home footer,
`/llms.txt`, `/openapi.json` `x-guidance`) describe both rules, pinned by `chk wafnote` and `chk wafoptin`; change all
three in the same deploy if a rule changes.

```bash
set -a; source .env; set +a
ZID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=badhttp.dev" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
# read
curl -s "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_request_firewall_custom/entrypoint" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result.rules'
# replace (idempotent: PUT the whole rule list; an empty list removes every custom rule)
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZID/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @docs/waf-custom-rules.json | jq '{success, errors, rules: (.result.rules | length)}'
```

Verify (all against the edge; `chk bombwaf`, `chk bombwaf2` and `chk bomboptin` in the smoke suite do the same; `bomboptin` also passes against local dev, where the Worker's own check answers):

```
curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/145.0.0.0' -H 'Accept-Encoding: gzip' https://badhttp.dev/compress/bomb   # 403
curl -s -o /dev/null -w '%{http_code}\n' -A 'MOZILLA/5.0 (X11; Linux x86_64) Chrome/145.0.0.0' -H 'Accept-Encoding: gzip' https://badhttp.dev/compress/bomb   # 403 (case)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept-Encoding: gzip' https://badhttp.dev/compress/bomb              # 200, the default 8 MiB bomb
curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept-Encoding: gzip' 'https://badhttp.dev/compress/bomb?size=32'    # 403, no x-badhttp-version header
curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept-Encoding: gzip' -H 'x-badhttp-bomb: accept' 'https://badhttp.dev/compress/bomb?size=32'   # 200
```
Verified 2026-10-23 for seventeen request shapes (`?size=032`, `%33%32`, `abc`, an empty value and a wrong header value
are all 403 at the edge; `?size=1&size=32` and `?size=32&size=1` are both 403 at the edge — the first form of the rule
used `any(...)` and let a repeated `?size=` through when one value was in the set, which a skeptic review caught live
before this deploy; `all(...)` closes it). The header is matched by exact value on both sides (`Accept` is not `accept`);
a header sent twice passes the edge and is refused by the Worker, which reads it as `accept, accept`.

**Watch it each session**: `scripts/state-check.sh --cred` prints `bomb=`, `r403=` and `worker=` per day; `worker`
in the tens of thousands means the flood now reaches the Worker — a user agent without `Mozilla/` AND either no
`?size=` (the 8 MiB default, 24 KB on the wire) or the header. The remaining candidates, in order of what they would
break: (a) a fake-browser heuristic — a user agent claiming Chrome/Firefox ≥ 90 without the `Sec-Fetch-Mode` header
every such browser sends (`not any(http.request.headers.names[*] == "sec-fetch-mode")`); breaks tools that spoof a
browser string without its headers, nothing that identifies itself; UNVERIFIED against the flood, whose headers the
analytics do not show; (b) block the path for HTTP/2 clients — note curl itself speaks HTTP/2 over TLS by default, so
this breaks a documented client unless it adds `--http1.1`; (c) require the header for every `?size=`, then for the
default too (the bomb becomes opt-in for everyone); (d) lower `compressBombMaxMiB` (changes what is tested). The
Worker cannot defend itself: a Worker-side 4xx is still a billed invocation. Nothing here uses a bot product, a
challenge, or anything that would refuse a non-browser client — that rule (session 6) stands; rule 2 keys on the
absence of a documented header, which the #34 amendment allows for the one flavor whose body is a declared hazard.

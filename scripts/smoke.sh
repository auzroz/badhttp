#!/bin/zsh
# Smoke test every endpoint against a base URL. Usage: scripts/smoke.sh https://badhttp.dev
B="${1:-http://localhost:8787}"; T=$(mktemp -d)
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: got [$2] want [$3]"; fi; }
chk health "$(curl -s $B/health | jq -r .ok)" true
chk status429 "$(curl -si "$B/status/429?retry-after=3" | grep -ic '^retry-after: 3')" 1
chk status204 "$(curl -s "$B/status/204" | wc -c | tr -d ' ')" 0
chk status407 "$(curl -sI "$B/status/407" | grep -ic '^proxy-authenticate')" 1
chk status206 "$(curl -sI "$B/status/206" | grep -ic '^content-range')" 1
chk status301 "$(curl -sI "$B/status/301" | grep -ic '^location: /redirect/0')" 1
chk statusenc "$(curl -s "$B/status/200%2C500" | jq -r '.chosen_from|length')" 2
chk statusbad "$(curl -s -o /dev/null -w '%{http_code}' "$B/status/999")" 400
chk delay "$(curl -s "$B/delay/0.5" | jq -r '.requested_ms')" 500
chk delaymax "$(curl -s -o /dev/null -w '%{http_code}' "$B/delay/11")" 400
chk flakydet "$(for i in 0 1 2; do curl -s "$B/flaky/70?seed=ci&i=$i" | jq -r .roll; done | tr '\n' ,)" "39,20,77,"
chk flaky429 "$(curl -si "$B/flaky/100?fail=429" | grep -ic '^retry-after: 1')" 1
chk flaky599 "$(curl -s "$B/flaky/100?fail=599" | jq -r .reason)" Unassigned
chk redirect "$(curl -s -o /dev/null -w '%{num_redirects} %{http_code}' -L "$B/redirect/3")" "3 200"
chk redirect308 "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/redirect/1?code=308&absolute")" "308 $B/redirect/0?code=308&absolute=1"
chk redirectloop "$(curl -s -o /dev/null -L --max-redirs 5 "$B/redirect/loop"; echo $?)" 47
chk badjsonlist "$(curl -s "$B/badjson" | jq -r '.flavors|keys|length')" 16
chk badjsonproto "$(curl -s -o /dev/null -w '%{http_code}' "$B/badjson/constructor")" 404
chk badjson304 "$(curl -s -o /dev/null -w '%{http_code}' "$B/badjson/html?code=304")" 400
chk badjsonhtml502 "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B/badjson/html?code=502")" "502 application/json; charset=utf-8"
chk badjsonmislabeled "$(curl -s -o /dev/null -w '%{content_type}' "$B/badjson/mislabeled")" "text/html; charset=utf-8"
chk badjsonutf16 "$(curl -s "$B/badjson/utf16" | head -c 2 | od -An -tx1 | tr -d ' \n')" "fffe"
# A 1 s drip takes >=1 s plus network overhead; an exact-equality check on wall clock flakes (seen: 1.1 s from one jitter).
chk drip "$(curl -s -o /dev/null -w '%{time_total}' "$B/drip?duration=1&chunks=3" | awk '{print ($1>=0.95 && $1<2) ? "paced" : "off:"$1}')" "paced"
chk drip1 "$(curl -sI "$B/drip?duration=5&chunks=1" | grep -i 'x-badhttp-duration-ms' | tr -d '\r' | awk '{print $2}')" 0
chk drip204 "$(curl -s -o /dev/null -w '%{http_code}' "$B/drip?code=204")" 400
chk dripHEAD "$(curl -s -o /dev/null -w '%{http_code}' -I "$B/drip?duration=1&chunks=2")" 200
# curl exits 18 (HTTP/1.1: transfer closed with bytes remaining) or 92 (HTTP/2: stream reset); both are the short read we want.
trunc_exit=$(curl -s "$B/truncate?length=1000&send=500" -o $T/t.bin; echo $?); [ "$trunc_exit" = 92 ] && trunc_exit=18
chk truncate "$trunc_exit $(wc -c < $T/t.bin | tr -d ' ')" "18 500"
chk truncateHEAD "$(curl -sI "$B/truncate?length=1000" | grep -ic '^content-length: 1000')" 1
chk headers "$(curl -s -H 'X-Trace: abc' "$B/headers" | jq -r '.headers["x-trace"]')" abc
chk echo "$(curl -s -X POST "$B/echo?x=1" -H 'content-type: application/json' -d '{"hello":"world"}' | jq -c '[.method,.query.x,.json.hello,.body_bytes]')" '["POST","1","world",17]'
chk echobig "$(head -c 40000 /dev/zero | tr '\0' a | curl -s -X PUT "$B/echo" --data-binary @- | jq -c '[.body_truncated,(.body|length)]')" '[true,16384]'
chk echoget "$(curl -si "$B/echo" | grep -ic '^allow: POST, PUT, PATCH, DELETE, OPTIONS')" 1
chk optionsecho "$(curl -si -X OPTIONS "$B/echo" | grep -ic '^allow: POST')" 1
chk notfound "$(curl -s -o /dev/null -w '%{http_code}' "$B/nope")" 404
# Path templates requested literally ({braces} intact) answer 200 with the valid values, any method except
# OPTIONS (which keeps its 204 but widens Allow); unknown shapes stay 404.
chk tplsse "$(curl -s "$B/sse/%7Bflavor%7D" | jq -r '[.template, .param, (.values|length)] | join(",")')" "/sse/{flavor},flavor,14"
chk tpl402 "$(curl -s -X POST "$B/402/%7Bscenario%7D" | jq -r '[.param, (.values|length), (.see_also|length)] | join(",")') $(curl -s "$B/402/broken/%7Bflavor%7D" | jq -r '[.param, (.values|length)] | join(",")') $(curl -s "$B/402/pay/%7Bnetwork%7D" | jq -r '.values|keys|join("+")')" "scenario,7,2 flavor,10 base+base-sepolia"
chk tplnum "$(curl -s "$B/status/%7Bcode%7D" | jq -r '[.param, (.valid|test("200-599"))] | join(",")')$(curl -s -o /dev/null -w ' %{http_code}' "$B/delay/%7Bseconds%7D")$(curl -s -o /dev/null -w ' %{http_code}' "$B/redirect/%7Bhops%7D")$(curl -s -o /dev/null -w ' %{http_code}' "$B/flaky/%7Bpercent%7D")" "code,true 200 200 200"
chk tpl404 "$(curl -s -o /dev/null -w '%{http_code}' "$B/nope/%7Bx%7D")$(curl -s -o /dev/null -w ' %{http_code}' "$B/sse/%7Bflavor%7D/x")$(curl -s -o /dev/null -w ' %{http_code}' "$B/402/pay/%7Bnetwork%7D/x")" "404 404 404"
chk tplopts "$(curl -si -X OPTIONS "$B/sse/%7Bflavor%7D" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="allow:"{sub(/^[^:]*: /,""); a=$0} END{print s "|" a}')" "204|GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
# /402: deterministic checks only; nothing here contacts a facilitator (every payment header sent below fails local validation before any facilitator call).
chk x402index "$(curl -s "$B/402" | jq -r '[.default_network, .only_this_one_settles, (.scenarios|length), (.facilitators.v1.base|length), (.facilitators.v1["base-sepolia"]|length)] | join(",")')" "base-sepolia,/402/pay,9,3,3"
chk x402pay "$(curl -si "$B/402/pay" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="payment-required:"{h=$2} END{print s, h}' | { read s h; echo "$s $(echo "$h" | base64 -d | jq -r '[.x402Version, .accepts[0].network, .accepts[0].amount, .accepts[0].extra.name, (.accepts[0].payTo|test("^0x[0-9a-fA-F]{40}$")), (.accepts|length), .resource.serviceName, (.extensions.bazaar.info.input|has("queryParams")), .extensions.bazaar.info.output.example.network] | join(",")')"; })" "402 2,eip155:84532,10000,USDC,true,1,badhttp,false,eip155:84532"
chk x402paypath "$(curl -si "$B/402/pay/base?amount=0.02" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '[.accepts[0].network, .accepts[0].amount, (.resource.url|sub("^.*//[^/]+";"")), .extensions.bazaar.info.input.queryParams.amount, (.extensions.bazaar.info.input.queryParams|has("network"))] | join(",")')$(curl -s -o /dev/null -w ' %{http_code}' "$B/402/pay/nope")$(curl -s -o /dev/null -w ' %{http_code}' "$B/402/pay/base?network=base-sepolia")$(curl -s -o /dev/null -w ' %{http_code}' "$B/402/never/base")$(curl -si "$B/402/pay/base-sepolia" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r ' .accepts[0].network')" "eip155:8453,20000,/402/pay/base?amount=0.02,0.02,false 404 400 404eip155:84532"
chk x402realmoney "$(curl -s "$B/402/pay" | jq -r '.real_money|type')$(curl -s "$B/402/pay?network=base" | jq -r '.real_money')" "booleantrue"
chk x402bazaar "$(curl -si "$B/402/pay?network=base&amount=0.05" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '[.resource.serviceName, (.resource.tags|length), .extensions.bazaar.info.input.type, .extensions.bazaar.info.input.method, .extensions.bazaar.info.input.queryParams.network, .extensions.bazaar.info.input.queryParams.amount, .extensions.bazaar.info.output.example.network, .extensions.bazaar.schema["$schema"]] | join(",")')" "badhttp,5,http,GET,base,0.05,eip155:8453,https://json-schema.org/draft/2020-12/schema"
chk x402single "$(for n in base base-sepolia; do curl -si "$B/402/pay?network=$n" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '.accepts|length'; done | tr '\n' ,)$(curl -si "$B/402/never" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '[(.accepts|length), (.extensions // "none"), (.resource.serviceName // "none")] | join(",")')" "1,1,1,none,none"
chk x402hdrsize "$(curl -si "$B/402/pay" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print length($2)}')" "$(curl -si "$B/402/pay" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print length($2)}' | awk '$1 < 8192 {print $1}')"
chk x402mainnet "$(curl -si "$B/402/pay?network=base&amount=0.25" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '[.accepts[0].network, .accepts[0].amount, .accepts[0].extra.name, .accepts[0].asset] | join(",")')" "eip155:8453,250000,USD Coin,0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
chk x402amount "$(curl -s -o /dev/null -w '%{http_code}' "$B/402/pay?amount=1.5")$(curl -s -o /dev/null -w '%{http_code}' "$B/402/pay?amount=1e-3")$(curl -s -o /dev/null -w '%{http_code}' "$B/402/pay?network=mainnet")" 400400400
# x402 v1 (dual-form): the body is a spec-valid v1 envelope derived from the same requirements as the v2 header,
# and X-PAYMENT is accepted inbound. None of these checks reaches a facilitator: they fail local validation first.
chk x402v1 "$(curl -s -H 'X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MX0=' "$B/402/pay" | jq -r '.error|test("scheme")')" true
chk x402v1body "$(curl -s "$B/402/pay" | jq -r '[.x402Version, .accepts[0].network, .accepts[0].maxAmountRequired, .accepts[0].mimeType, (.accepts[0]|has("outputSchema")), (.accepts[0].resource|startswith("http")), (.accepts[0].maxTimeoutSeconds|type)] | join(",")')" "1,base-sepolia,10000,application/json,false,true,number"
chk x402v1dual "$(curl -si "$B/402/pay?network=base&amount=0.05" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '[.accepts[0].amount, .accepts[0].network] | join(",")')|$(curl -s "$B/402/pay?network=base&amount=0.05" | jq -r '[.accepts[0].maxAmountRequired, .accepts[0].amount, .accepts[0].network, .accepts[0].extra.name] | join(",")')" "50000,eip155:8453|50000,50000,base,USD Coin"
chk x402v1pay "$(curl -s -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{}}' | base64)" "$B/402/pay" | jq -r '[.error, (.verified_by // "none")] | join("|")')" "invalid_exact_evm_payload|none"
chk x402v1net "$(curl -s -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base","payload":{"signature":"0x00","authorization":{}}}' | base64)" "$B/402/pay" | jq -r '[.error, .you_sent, (.verified_by // "none")] | join("|")')" "No matching payment requirements|base|none"
chk x402v1never "$(curl -si -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{}}' | base64)" "$B/402/never" | tr -d '\r' | awk 'tolower($1)=="x-badhttp-warning:"{w=1} END{print w}')$(curl -s -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{}}' | base64)" "$B/402/never" | jq -r '.note|test("X-PAYMENT")')" "1true"
chk x402wrongnetv2 "$(curl -s "$B/402/wrong-network" | jq -r '[.x402Version, (.no_v1_form|type)] | join(",")')" "2,string"
# Precedence: PAYMENT-SIGNATURE wins over X-PAYMENT and is never a fallback — a bad or even EMPTY v2 header must
# fail as v2, not silently downgrade to the v1 header beside it (curl -H 'Name;' sends an empty-value header).
chk x402v1prec "$(curl -s -H 'PAYMENT-SIGNATURE: bnVsbA==' -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{}}' | base64)" "$B/402/pay" | jq -r '.error|test("PAYMENT-SIGNATURE")')$(curl -s -H 'PAYMENT-SIGNATURE;' -H "X-PAYMENT: $(printf '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{}}' | base64)" "$B/402/pay" | jq -r '.error|startswith("PAYMENT-SIGNATURE")')" "truetrue"
chk x402garbage "$(curl -s -o /dev/null -w '%{http_code}' -H 'PAYMENT-SIGNATURE: not base64' "$B/402/pay")$(curl -s -H 'PAYMENT-SIGNATURE: bnVsbA==' "$B/402/pay" | jq -r '.error|test("object")')" "402true"
chk x402mismatch "$(curl -s -H "PAYMENT-SIGNATURE: $(printf '{"x402Version":2,"accepted":{"scheme":"exact","network":"eip155:84532","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","amount":"1","payTo":"0x0000000000000000000000000000000000000001","maxTimeoutSeconds":300},"payload":{"signature":"0x00","authorization":{}}}' | base64)" "$B/402/pay" | jq -r '[.error, (.verified_by // "none")] | join("|")')" "No matching payment requirements|none"
chk x402never "$(curl -si -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/never" | grep -ic '^x-badhttp-warning')" 1
chk x402reject "$(curl -s -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/reject?reason=expired" | jq -r .error)" expired
chk x402crash "$(curl -s -o /dev/null -w '%{http_code}' -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/crash")" 500
chk x402slow "$(curl -s -o /dev/null -w '%{http_code} %{time_total}' -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/slow?seconds=1" | cut -c1-5)" "504 1"
chk x402badreceipt "$(curl -si -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/bad-receipt" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="payment-response:"{h=$2} tolower($1)=="x-payment-response:"{x=$2} END{print s, h, x}')" "200 %%not-base64-json%% %%not-base64-json%%"
chk x402overpriced "$(curl -si "$B/402/overpriced" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '.accepts[0].amount')" 1000000000000
chk x402wrongnet "$(curl -si "$B/402/wrong-network" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '.accepts[0].network')" eip155:424242
chk x402broken "$(curl -s "$B/402/broken" | jq -r '.flavors|keys|length')$(curl -si "$B/402/broken/not-base64" | tr -d '\r' | awk 'NR==1{print $2}')$(curl -si "$B/402/broken/missing-header" | grep -ic '^payment-required')$(curl -s "$B/402/broken/v1-body" | jq -r '.x402Version,.accepts[0].maxAmountRequired' | tr '\n' ,)" "1040201,10000,"
chk x402robots "$(curl -s "$B/robots.txt" | grep -c '^Disallow: /402/')" 1
chk x402nostore "$(curl -si "$B/402/pay" | grep -ic '^cache-control: no-store')" 1
chk x402paramsfirst "$(curl -s -o /dev/null -w '%{http_code}' "$B/402/reject?reason=Bad-Nonce")$(curl -s -o /dev/null -w '%{http_code}' "$B/402/slow?seconds=11")" 400400
chk x402methods "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$B/402/pay")$(curl -s -o /dev/null -w '%{http_code}' -I -H 'PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0ZWQiOnt9LCJwYXlsb2FkIjp7fX0=' "$B/402/pay")$(curl -s -o /dev/null -w '%{http_code}' -I -H 'X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MX0=' "$B/402/pay")$(curl -si -X OPTIONS "$B/402/pay" | grep -ic '^allow: GET, HEAD, POST, OPTIONS')" 4054024021
chk x402canon "$(curl -si "$B/402/pay?junk=$(head -c 3000 /dev/zero | tr '\0' a)&amount=0.5" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -r '.resource.url' | sed "s|$B||")" "/402/pay?amount=0.5"
chk x402shape "$(A=$(curl -si "$B/402/pay" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -c '.accepts[0]'); curl -s -H "PAYMENT-SIGNATURE: $(printf '{"x402Version":2,"accepted":%s,"payload":{}}' "$A" | base64)" "$B/402/pay" | jq -r '[.error, (.verified_by // "none")] | join("|")')" "invalid_exact_evm_payload|none"
chk x402shape2 "$(A=$(curl -si "$B/402/pay?network=base" | tr -d '\r' | awk 'tolower($1)=="payment-required:"{print $2}' | base64 -d | jq -c '.accepts[0]'); curl -s -H "PAYMENT-SIGNATURE: $(printf '{"x402Version":2,"accepted":%s,"payload":{},"extensions":{"bazaar":{}}}' "$A" | base64)" "$B/402/pay?network=base" | jq -r '[.error, (.verified_by // "none")] | join("|")')" "invalid_exact_evm_payload|none"
chk x402unknown "$(curl -s -o /dev/null -w '%{http_code}' "$B/402/nope")$(curl -s -o /dev/null -w '%{http_code}' "$B/402/broken/nope")" 404404
# /sse: stream checks use --http1.1 so chunk boundaries and the drop are what production shows; -m 25 is a safety net over the 20 s cap.
chk sseindex "$(curl -s "$B/sse" | jq -r '[(.flavors|length), .usage, .limits.max_seconds] | join(",")')" "14,/sse/{flavor},20"
chk sseheaders "$(curl -sI "$B/sse/ok?events=1&interval=0" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-type:"{ct=$2" "$3} tolower($1)=="cache-control:"{cc=$2" "$3} tolower($1)=="x-badhttp-flavor:"{f=$2} END{print s, ct, cc, f}')" "200 text/event-stream; charset=utf-8 no-store, no-transform ok"
chk sseok "$(curl -sN --http1.1 -m 25 "$B/sse/ok?events=3&interval=0" | awk 'NR==1{print} /^data:/{d++} END{print d}' | tr '\n' ' ')" "retry: 30000 3 "
chk sseokbad "$(curl -s -o /dev/null -w '%{http_code}' "$B/sse/ok?events=100&interval=5000")$(curl -s -o /dev/null -w '%{http_code}' "$B/sse/ok?events=0")" 400400
chk ssestall "$(curl -sN --http1.1 -m 25 -o /dev/null -w '%{http_code} %{time_total}' "$B/sse/stall?seconds=1" | cut -c1-5)" "200 1"
cut_exit=$(curl -sN --http1.1 -m 25 "$B/sse/cut" -o $T/c.txt; echo $?)
chk ssecut "$(tail -c 19 $T/c.txt) $cut_exit" 'data: {"partial":tr 0'
# curl exits 18 (HTTP/1.1: transfer closed with outstanding read data) or 92 (HTTP/2: stream reset); both are the reset we want.
drop_exit=$(curl -sN --http1.1 -m 25 "$B/sse/drop" -o $T/d.txt; echo $?); [ "$drop_exit" = 92 ] && drop_exit=18
chk ssedrop "$drop_exit $(grep -c '^id: ' $T/d.txt)" "18 2"
chk ssecrlf "$(curl -sN --http1.1 -m 25 "$B/sse/crlf" | grep -c $'\r$')" 14
chk ssecr "$(curl -sN --http1.1 -m 25 "$B/sse/cr" | tr -d '\n' | tr '\r' '\n' | grep -c '^data: ')" 3
chk ssenospace "$(curl -sN --http1.1 -m 25 "$B/sse/no-space" | grep -c '^data:')" 4
chk ssemultiline "$(curl -sN --http1.1 -m 25 "$B/sse/multiline" | grep -c '^data:')" 7
chk ssecomments "$(curl -sN --http1.1 -m 25 "$B/sse/comments" | head -c 3 | od -An -tx1 | tr -d ' \n')$(curl -sN --http1.1 -m 25 "$B/sse/comments" | grep -c '^data:')" "efbbbf3"
chk ssesplit "$(curl -sN --http1.1 -m 25 "$B/sse/split-utf8" | grep '^data:' | od -An -tx1 | tr -d ' \n')" "646174613a20f09f908d206f6b0a646174613a20e282ac206f6b0a"
chk ssewrongtype "$(curl -sI "$B/sse/wrong-type" | tr -d '\r' | grep -i '^content-type:' | awk '{print $2" "$3}')" "text/plain; charset=utf-8"
chk sseerror "$(curl -sN --http1.1 -m 25 "$B/sse/error-event" | grep -c '^event: error$')" 1
chk ssebig "$(curl -sN --http1.1 -m 25 "$B/sse/big?bytes=1000" | grep '^data: ' | awk '{print length($2)}')" 1000
chk sseresume "$(curl -sN --http1.1 -m 25 -H 'Last-Event-ID: 3' "$B/sse/resume" | grep '^id:' | head -1)$(curl -s -o /dev/null -w ' %{http_code}' -H 'Last-Event-ID: 6' "$B/sse/resume")$(curl -s -o /dev/null -w ' %{http_code}' -H 'Last-Event-ID: x' "$B/sse/resume")" "id: 4 204 400"
chk ssereconnect "$(curl -si -H 'Last-Event-ID: 1' "$B/sse/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="x-badhttp-note:"{n=1} END{print s, n}')" "204 1"
chk ssehead "$(curl -s -I "$B/sse/stall" -o /dev/null -w '%{http_code} %{size_download}')" "200 0"
chk ssemethods "$(curl -si -X POST "$B/sse/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="allow:"{a=$2" "$3" "$4} END{print s, a}')$(curl -s -o /dev/null -w ' %{http_code}' "$B/sse/ok/x")$(curl -s -o /dev/null -w ' %{http_code}' "$B/sse/nope")" "405 GET, HEAD, OPTIONS 404 404"
chk sserobots "$(curl -s "$B/robots.txt" | grep -c '^Disallow: /sse/')" 1
# /range: byte-exact where corruption is the point (the document is self-describing: 64-byte lines starting with their offset).
sleep 2 # breathing room under the zone rate limit before this block's fast header probes
chk rangeindex "$(curl -s "$B/range" | jq -r '.flavors|length')" 14
chk rangeok "$(curl -si -r 128-255 "$B/range/ok?length=512" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} tolower($1)=="accept-ranges:"{ar=$2} END{print s, cr, ar}')" "206 128-255/512 bytes"
chk rangeokbody "$(curl -s -r 128-191 "$B/range/ok?length=512" | head -c 17)" "00000128 00000512"
chk rangeok200 "$(curl -si "$B/range/ok?length=200" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="accept-ranges:"{ar=$2} tolower($1)=="etag:"{e=$2} END{print s, ar, e}')" '200 bytes "r-200-g1"'
chk rangesuffix "$(curl -si -H 'Range: bytes=-100' "$B/range/ok" | tr -d '\r' | awk 'tolower($1)=="content-range:"{print $3}')$(curl -si -H 'Range: bytes=900-' "$B/range/ok" | tr -d '\r' | awk 'tolower($1)=="content-range:"{print " " $3}')" "900-999/1000 900-999/1000"
chk range416 "$(curl -si -H 'Range: bytes=2000-' "$B/range/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$2" "$3} END{print s, cr}')" "416 bytes */1000"
chk rangemulti "$(curl -si -H 'Range: bytes=0-63,128-191' "$B/range/ok?length=512" | tr -d '\r' | awk 'NR==1{s=$2} /^$/{exit} tolower($1)=="content-type:"{ct=$2} END{print s, ct}')$(curl -s -H 'Range: bytes=0-63,128-191' "$B/range/ok?length=512" | grep -c -- '--badhttp')" "206 multipart/byteranges;3"
chk rangemalformed "$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -H 'Range: bytes=abc' "$B/range/ok?length=200")$(curl -s -o /dev/null -w ' %{http_code}' -H 'Range: bytes=5-2' "$B/range/ok?length=200")$(curl -s -o /dev/null -w ' %{http_code}' -H 'Range: bytes = 0-5' "$B/range/ok?length=200")" "200 200 200 200" # garbage, b<a, and whitespace around = are all ignored
# One survivor of a multi-range request is served as a plain single-range 206.
chk rangesurvivor "$(curl -si -H 'Range: bytes=0-63,5000-' "$B/range/ok?length=200" | tr -d '\r' | awk 'NR==1{s=$2} /^$/{exit} tolower($1)=="content-range:"{cr=$3} tolower($1)=="content-type:"{ct=$2} END{print s, cr, ct}')" "206 0-63/200 text/plain;"
chk rangeifrange "$(curl -s -o /dev/null -w '%{http_code}' -r 0-63 -H 'If-Range: "stale"' "$B/range/ok?length=200")$(curl -s -o /dev/null -w ' %{http_code}' -r 0-63 -H 'If-Range: "r-200-g1"' "$B/range/ok?length=200")$(curl -s -o /dev/null -w ' %{http_code}' -r 0-63 -H 'If-Range: W/"r-200-g1"' "$B/range/ok?length=200")$(curl -s -o /dev/null -w ' %{http_code}' -r 0-63 -H 'If-Range: Sat, 01 Aug 2026 00:00:00 GMT' "$B/range/ok?length=200")" "200 206 200 206"
# A stale If-Range means the whole Range header is ignored (§13.1.5) — even an unsatisfiable one: 200, not 416.
chk rangeifrangeunsat "$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -H 'Range: bytes=5000-' -H 'If-Range: "stale"' "$B/range/ok?length=200")" "200 200"
# /range/ok is a full conditional citizen too (If-None-Match 304, If-Match 412), and HEAD must ignore Range (RFC 9110 §14.2).
chk rangecond "$(curl -si -H 'If-None-Match: "r-200-g1"' "$B/range/ok?length=200" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"{e=$2} END{print s, e}')$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Match: "nope"' "$B/range/ok?length=200")" '304 "r-200-g1" 412'
chk rangespancap "$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -H 'Range: bytes=0-,0-' "$B/range/ok?length=1048576")" "200 1048576" # total span over 1 MiB → Range ignored, not amplified
chk rangeignore "$(curl -si -r 0-63 "$B/range/ignore?length=200" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="accept-ranges:"{ar=1} tolower($1)=="content-length:"{cl=$2} END{print s, cl, ar+0}')" "200 200 0"
chk rangeadvertise "$(curl -si -r 0-63 "$B/range/advertise-only?length=200" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="accept-ranges:"{ar=$2} tolower($1)=="content-length:"{cl=$2} END{print s, cl, ar}')" "200 200 bytes"
chk rangeoffbyone "$(curl -si -r 64-127 "$B/range/off-by-one?length=512" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} tolower($1)=="content-length:"{cl=$2} END{print s, cr, cl}')$(curl -s -o /dev/null -w ' %{http_code} %{size_download}' -r 0-0 "$B/range/off-by-one?length=512")" "206 64-127/512 63 206 0" # bytes=0-0 degenerates to an empty 206
chk rangeshifted "$(curl -s -r 64-127 "$B/range/shifted?length=512" | head -c 8)" "0000064 "
chk rangewrongtotal "$(curl -si -r 0-63 "$B/range/wrong-total?length=512" | tr -d '\r' | awk 'tolower($1)=="content-range:"{print $3}')$(curl -si -H 'Range: bytes=600-' "$B/range/wrong-total?length=512" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} END{print " " s, cr}')" "0-63/1024 416 */1024"
chk rangesuffixprefix "$(curl -si -H 'Range: bytes=-100' "$B/range/suffix-as-prefix?length=1000" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} END{print s, cr}') $(curl -s -H 'Range: bytes=-100' "$B/range/suffix-as-prefix?length=1000" | head -c 8)$(curl -s -o /dev/null -w ' %{http_code}' -r 100-199 "$B/range/suffix-as-prefix?length=1000")" "206 900-999/1000 00000000 206" # claims the tail, serves the head
chk rangefromzero "$(curl -si -H 'Range: bytes=500-' "$B/range/from-zero?length=1000" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} tolower($1)=="content-length:"{cl=$2} END{print s, cr, cl}')$(curl -s -o /dev/null -w ' %{http_code}' "$B/range/from-zero?length=200")" "206 0-999/1000 1000 200" # no Range → a normal 200
chk rangesuffixmulti "$(curl -si -H 'Range: bytes=0-63,128-191' "$B/range/suffix-as-prefix?length=512" | tr -d '\r' | awk 'NR==1{s=$2} /^$/{exit} tolower($1)=="content-type:"{ct=$2} END{print s, ct}')" "206 multipart/byteranges;" # requests not led by a suffix are served correctly, multipart included
chk rangenocr "$(curl -si -r 0-63 "$B/range/no-content-range?length=512" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=1} END{print s, cr+0}')" "206 0"
chk range206always "$(curl -si "$B/range/always-206?length=200" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} END{print s, cr}')" "206 0-199/200"
chk range200cr "$(curl -si -r 0-63 "$B/range/200-content-range?length=512" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{cr=$3} tolower($1)=="content-length:"{cl=$2} END{print s, cr, cl}')" "200 0-63/512 64"
chk range416always "$(curl -s -o /dev/null -w '%{http_code}' -r 0-63 "$B/range/always-416")$(curl -s -o /dev/null -w ' %{http_code}' "$B/range/always-416")" "416 200"
chk rangeunknown "$(curl -si -r 0-63 "$B/range/unknown-total?length=512" | tr -d '\r' | awk 'tolower($1)=="content-range:"{print $3}')" "0-63/*"
chk rangeifrignored "$(curl -si -r 0-63 -H 'If-Range: "stale"' "$B/range/if-range-ignored?length=512" | tr -d '\r' | awk 'NR==1{print $2}')$(E1=$(curl -si "$B/range/if-range-ignored?length=512" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}'); E2=$(curl -si "$B/range/if-range-ignored?length=512" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}'); [ -n "$E1" ] && [ "$E1" != "$E2" ] && echo " differs")" "206 differs" # stale validator still gets 206; the generation changes every response
chk rangehead "$(curl -s -I -r 128-255 "$B/range/ok?length=512" -o /dev/null -w '%{http_code} %{size_download}')$(curl -sI -r 128-255 "$B/range/ok?length=512" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print " " $2}')" "200 0 512" # HEAD ignores Range (RFC 9110 §14.2)
chk rangemethods "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/range/ok")$(curl -s -o /dev/null -w ' %{http_code}' "$B/range/nope")$(curl -s -o /dev/null -w ' %{http_code}' "$B/range/ok/x")$(curl -s -o /dev/null -w ' %{http_code}' "$B/range/ok?length=2000000")" "405 404 404 400"
chk rangerobots "$(curl -s "$B/robots.txt" | grep -c '^Disallow: /range/')$(curl -s "$B/robots.txt" | grep -c '^Disallow: /etag/')" 11
# /etag: conditional requests. The control first, then the liars.
sleep 2 # breathing room under the zone rate limit
chk etagindex "$(curl -s "$B/etag" | jq -r '.flavors|length')" 10
chk etagok "$(curl -si "$B/etag/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"{e=$2} tolower($1)=="cache-control:"{cc=$2" "$3} END{print s, e, cc}')" '200 "e-badhttp-1" no-cache, no-transform'
chk etagok304 "$(curl -si -H 'If-None-Match: "e-badhttp-1"' "$B/etag/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"{e=$2} tolower($1)=="last-modified:"{lm=1} tolower($1)=="cache-control:"{cc=1} END{print s, e, lm+0, cc+0}')" '304 "e-badhttp-1" 0 1' # the 304 carries ETag and Cache-Control, no Last-Modified (the ETag is the validator); Date is added at the edge
chk etagokcmp "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-None-Match: W/"e-badhttp-1"' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: "x", "e-badhttp-1"' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: *' "$B/etag/ok")" "304 304 304"
chk etagims "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-Modified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Wed, 01 Jul 2026 00:00:00 GMT' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: "nope"' -H 'If-Modified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/ok")" "304 200 200"
chk etagifmatch "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-Match: "nope"' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Match: "e-badhttp-1"' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Match: *' "$B/etag/ok")" "412 200 200"
chk etagius "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-Unmodified-Since: Wed, 01 Jul 2026 00:00:00 GMT' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Unmodified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/ok")$(curl -si -H 'If-Match: "nope"' "$B/etag/ok" | tr -d '\r' | awk 'tolower($1)=="cache-control:"{print " " $2" "$3}')" "412 200 no-cache, no-transform" # and the 412 keeps the family's cache-control
chk etagbadims "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-Modified-Since: 2026-08-01T00:00:00Z' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Sunday, 01-Aug-27 00:00:00 GMT' "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Sat Aug  1 00:00:00 2026' "$B/etag/ok")" "200 304 304" # invalid HTTP-date ignored (MUST); obsolete rfc850 and asctime formats accepted (MUST)
chk etagweak "$(curl -si "$B/etag/weak" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: W/"e-badhttp-1"' "$B/etag/weak")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Match: W/"e-badhttp-1"' "$B/etag/weak")" 'W/"e-badhttp-1" 304 412'
chk etagchanging "$(E1=$(curl -si "$B/etag/changing" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}'); E2=$(curl -si "$B/etag/changing" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}'); [ -n "$E1" ] && [ "$E1" != "$E2" ] && echo differ)$(curl -si "$B/etag/changing" | tr -d '\r' | grep -ic '^last-modified:')$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/changing")" "differ0 200" # no Last-Modified, so a date-only revalidation can never 304
chk etagignore "$(curl -s -o /dev/null -w '%{http_code}' -H 'If-None-Match: "e-badhttp-1"' "$B/etag/ignore")" 200
chk etagalways304 "$(curl -si "$B/etag/always-304" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"{e=$2} END{print s, e}')" '304 "e-badhttp-1"'
chk etagmismatch "$(curl -si -H 'If-None-Match: "e-badhttp-1"' "$B/etag/mismatch" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"{e=$2} END{print s, e}')" '304 "e-badhttp-2"'
chk etagnovalidator "$(curl -si -H 'If-None-Match: "e-badhttp-1"' "$B/etag/no-validator-304" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="etag:"||tolower($1)=="last-modified:"{v++} END{print s, v+0}')" "304 0"
chk etagunquoted "$(curl -si "$B/etag/unquoted" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: e-badhttp-1' "$B/etag/unquoted")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: "e-badhttp-1"' "$B/etag/unquoted")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: "x", e-badhttp-1' "$B/etag/unquoted")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-None-Match: W/"e-badhttp-1"' "$B/etag/unquoted")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/unquoted")" "e-badhttp-1 304 304 304 304 304" # sloppy matching: bare, quoted, mixed lists, weak prefix; and If-Modified-Since works normally
chk etagbaddate "$(curl -si "$B/etag/bad-date" | tr -d '\r' | awk 'tolower($1)=="last-modified:"{print $2}')$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: 2026-08-01T00:00:00Z' "$B/etag/bad-date")" "2026-08-01T00:00:00Z 304"
# future: LM is one year from today. A client echoing it verbatim gets 304; one sending an older date (its own clock) gets 200.
chk etagfuture "$(LMF=$(curl -si "$B/etag/future" | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p'); curl -s -o /dev/null -w '%{http_code}' -H "If-Modified-Since: $LMF" "$B/etag/future")$(curl -s -o /dev/null -w ' %{http_code}' -H 'If-Modified-Since: Sat, 01 Aug 2026 00:00:00 GMT' "$B/etag/future")" "304 200"
chk etaghead "$(curl -s -I "$B/etag/ok" -o /dev/null -w '%{http_code} %{size_download}')$(curl -sI "$B/etag/ok" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print " " ($2>0)}')" "200 0 1"
chk etagmethods "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/etag/ok")$(curl -s -o /dev/null -w ' %{http_code}' "$B/etag/nope")" "405 404"
# /cookies: Set-Cookie edge cases. Deterministic header checks only; jar round-trips with real clients live in the verification runbook, not here.
sleep 2 # breathing room under the zone rate limit
chk cookiesindex "$(curl -s "$B/cookies" | jq -r '.flavors|length')" 19
chk cookiesok "$(curl -si "$B/cookies/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="set-cookie:"{c=$0; sub(/^[^:]*: /,"",c)} END{print s "|" c}')" "200|badhttp_ok=1; Path=/cookies; Max-Age=3600"
chk cookiesfolded "$(curl -si "$B/cookies/folded" | tr -d '\r' | grep -ic '^set-cookie:') $(curl -si "$B/cookies/folded" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'badhttp_folded_a=1, badhttp_folded_b=2')" "1 1"
chk cookiesmany "$(curl -si "$B/cookies/many" | tr -d '\r' | grep -ic '^set-cookie:')$(curl -si "$B/cookies/many?count=3" | tr -d '\r' | grep -ic '^set-cookie:')$(curl -s -o /dev/null -w '%{http_code}' "$B/cookies/many?count=21")" "103400"
chk cookiesdup "$(curl -si "$B/cookies/duplicate" | tr -d '\r' | grep -i '^set-cookie:' | head -1 | grep -c 'badhttp_dup=deep; Path=/cookies/echo')$(curl -si "$B/cookies/duplicate" | tr -d '\r' | grep -ic '^set-cookie:')" "12"
chk cookiesredirect "$(curl -si "$B/cookies/on-redirect" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="location:"{l=$2} tolower($1)=="set-cookie:"{c=1} END{print s, l, c+0}')" "302 /cookies/echo 1"
chk cookiesdelete "$(curl -si "$B/cookies/delete" | tr -d '\r' | grep -ic '^set-cookie:') $(curl -si "$B/cookies/delete" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Expires=Thu, 01 Jan 1970') $(curl -si "$B/cookies/delete" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Max-Age=0')" "45 1 44"
chk cookiesconflict "$(curl -si "$B/cookies/conflicting-expiry" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600')" 1
chk cookiesbadexp "$(curl -si "$B/cookies/bad-expires" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Expires=2027-08-23T12:00:00Z')" 1
chk cookiesfarfuture "$(curl -si "$B/cookies/far-future" | tr -d '\r' | grep -i '^set-cookie:' | grep -c ' 9999 ')" 1
chk cookiesdomains "$(curl -si "$B/cookies/wrong-domain" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Domain=example.com')$(curl -si "$B/cookies/public-suffix" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Domain=dev;')$(curl -si "$B/cookies/path-prefix" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Path=/cookie;')" "111"
chk cookiesprefixes "$(curl -si "$B/cookies/name-prefixes" | tr -d '\r' | grep -ic '^set-cookie:') $(curl -si "$B/cookies/name-prefixes" | tr -d '\r' | grep -i '^set-cookie:' | grep -Ec '; Secure(;|$)') $(curl -si "$B/cookies/name-prefixes" | tr -d '\r' | grep -i '^set-cookie:' | grep -c '__Host-badhttp_good=1; Path=/; Secure')" "4 3 1"
chk cookiesquoted "$(curl -si "$B/cookies/quoted" | tr -d '\r' | grep -i '^set-cookie:' | grep -c '"hello world"') $(curl -si "$B/cookies/quoted" | tr -d '\r' | grep -i '^set-cookie:' | grep -c '"semi;colon"')" "1 1"
chk cookiesdomain "$(curl -si "$B/cookies/domain" | tr -d '\r' | grep -i '^set-cookie:' | grep -c 'Domain=') $(curl -si "$B/cookies/domain" | tr -d '\r' | grep -i '^set-cookie:' | head -1 | grep -c 'Domain=\.')" "2 1"
chk cookiesutf8 "$(curl -s --http1.1 -D - -o /dev/null "$B/cookies/utf8" | grep -i '^set-cookie:' | od -An -tx1 | tr -d ' \n' | grep -c 'e29883')" 1
chk cookiesnameless "$(curl -si "$B/cookies/nameless" | tr -d '\r' | grep -ci '^set-cookie: badhttp-just-a-value$') $(curl -si "$B/cookies/nameless" | tr -d '\r' | grep -ci '^set-cookie: =badhttp_empty_name;')" "1 1"
# huge: ?bytes counts name+value (the bis §5.6 measure) — strip the attributes and the "=".
chk cookieshuge "$(curl -si "$B/cookies/huge" | tr -d '\r' | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //; s/; Path.*$//' | awk '{print length($0)-1}')$(curl -si "$B/cookies/huge?bytes=64" | tr -d '\r' | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //; s/; Path.*$//' | awk '{print " " length($0)-1}')$(curl -si "$B/cookies/huge?bytes=8192" | tr -d '\r' | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //; s/; Path.*$//' | awk '{print " " length($0)-1}')$(curl -s -o /dev/null -w ' %{http_code}' "$B/cookies/huge?bytes=9000")" "4096 64 8192 400"
chk cookiesecho "$(curl -s -b 'a=1; a=2; noequals' "$B/cookies/echo" | jq -cr '[.count, .cookies, (.cookie_header_base64|type)]')" '[3,[["a","1"],["a","2"],["","noequals"]],"string"]'
chk cookiesbody "$(curl -s -b 'badhttp_ok=1' "$B/cookies/ok" | jq -r '[.flavor, (.set|length), .received.cookie_header] | join(",")')" "ok,1,badhttp_ok=1"
chk cookieshead "$(curl -s -I "$B/cookies/ok" -o /dev/null -w '%{http_code} %{size_download}')$(curl -sI "$B/cookies/ok" | tr -d '\r' | grep -ic '^set-cookie: badhttp_ok=1')" "200 01"
chk cookiesmethods "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/cookies/ok")$(curl -s -o /dev/null -w ' %{http_code}' "$B/cookies/nope")$(curl -s -o /dev/null -w ' %{http_code}' "$B/cookies/ok/x")" "405 404 404"
chk cookiesrobots "$(curl -s "$B/robots.txt" | grep -c '^Disallow: /cookies/')" 1
sleep 2 # breathing room under the zone rate limit
# /auth: HTTP authentication that misbehaves. Only the published fake credentials are ever sent below
# (or deliberate garbage); nothing here is a real secret. Sequential and burst-free like the rest.
chk authindex "$(curl -s "$B/auth" | jq -r '[(.flavors|length), .credentials.basic.user, .credentials.basic.password, .credentials.bearer.ok, (.warning|length > 50)] | join(",")')" "18,agent,correct,badhttp-token-ok,true"
chk authindexpost "$(curl -s -X POST -o /dev/null -w '%{http_code}' "$B/auth")" 200
chk authbasic "$(curl -si "$B/auth/basic" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{sub(/^[^:]*: /,""); h=$0} END{print s "|" h}')" '401|Basic realm="badhttp", charset="UTF-8"'
chk authbasicok "$(curl -s -u agent:correct "$B/auth/basic" | jq -r '[.authenticated, .scheme, .user] | join(",")')" "true,Basic,agent"
chk authbasicwrong "$(curl -s -u agent:wrong -o /dev/null -w '%{http_code}' "$B/auth/basic")$(curl -si -u agent:wrong "$B/auth/basic" | grep -ic '^www-authenticate:')" 4011
chk authbasicbad64 "$(curl -s -H 'Authorization: Basic !!!not-base64!!!' "$B/auth/basic" | jq -r '.defect // "none"' | grep -c base64)" 1
chk authbearer "$(curl -si "$B/auth/bearer" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{sub(/^[^:]*: /,""); h=$0} END{print s "|" h}')" '401|Bearer realm="badhttp"'
chk authbearerok "$(curl -s -H 'Authorization: Bearer badhttp-token-ok' "$B/auth/bearer" | jq -r '[.authenticated, .token] | join(",")')" "true,badhttp-token-ok"
chk authbearerbad "$(curl -si -H 'Authorization: Bearer nope-token' "$B/auth/bearer" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=/invalid_token/} END{print s, c+0}')" "401 1"
chk authbearer400 "$(curl -si -H 'Authorization: Bearer bad token with spaces' "$B/auth/bearer" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=/invalid_request/} END{print s, c+0}')" "400 1"
chk authbearer403 "$(curl -si -H 'Authorization: Bearer badhttp-token-limited' "$B/auth/bearer" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=/insufficient_scope/} END{print s, c+0}')" "403 1"
chk authdigest "$(curl -s --digest -u agent:correct "$B/auth/digest" | jq -r '[.authenticated, .algorithm] | join(",")')" "true,MD5"
chk authdigest256 "$(curl -s --digest -u agent:correct "$B/auth/digest-sha256" | jq -r '[.authenticated, .algorithm] | join(",")')" "true,SHA-256"
chk authdigestwrong "$(curl -s --digest -u agent:nope -o /dev/null -w '%{http_code}' "$B/auth/digest")" 401
# Authentication-Info verified by arithmetic, not client silence: recompute rspauth with md5(1)
# from the values curl actually sent (rspauth's A2 drops the method: ":uri").
authv=$(curl -sv --digest -u agent:correct "$B/auth/digest" 2>&1)
a_nonce=$(echo "$authv" | grep -o ' nonce="[^"]*"' | head -1 | cut -d'"' -f2)
a_cnonce=$(echo "$authv" | grep -o 'cnonce="[^"]*"' | head -1 | cut -d'"' -f2)
a_nc=$(echo "$authv" | grep -o ' nc=[0-9a-fA-F]*' | head -1 | sed 's/ nc=//')
a_rsp=$(echo "$authv" | grep -io 'rspauth="[^"]*"' | head -1 | cut -d'"' -f2)
ha1=$(md5 -q -s 'agent:badhttp:correct'); ha2=$(md5 -q -s ':/auth/digest')
# ${a_cnonce} MUST keep its braces: in zsh, bare $a_cnonce:auth parses ":a" as the absolute-path
# history modifier and splices the cwd into the hash input (cost an hour to find).
chk authrspauth "$a_rsp" "$(md5 -q -s "${ha1}:${a_nonce}:${a_nc}:${a_cnonce}:auth:${ha2}")"
chk authnone "$(curl -si "$B/auth/none" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=1} END{print s, c+0}')$(curl -s -u agent:correct "$B/auth/none" | jq -r ' .authenticated')" "401 0true"
chk authmulti "$(curl -si "$B/auth/multi" | tr -d '\r' | grep -i '^www-authenticate:' | grep -c 'algorithm=MD5.*Basic realm="badhttp"') $(curl -s -u agent:correct "$B/auth/multi" | jq -r .authenticated) $(curl -s --digest -u agent:correct "$B/auth/multi" | jq -r .authenticated)" "1 true true"
chk authtoken68 "$(curl -si "$B/auth/token68" | tr -d '\r' | grep -i '^www-authenticate:' | grep -c 'X-Badhttp-Opaque dG9rZW42OA==, Basic realm="badhttp"')$(curl -s -u agent:correct "$B/auth/token68" | jq -r ' .authenticated')" "1true"
chk authcase "$(curl -si "$B/auth/case" | tr -d '\r' | grep -i '^www-authenticate:' | grep -c 'bASIc rEALM="badhttp"')$(curl -s -u agent:correct "$B/auth/case" | jq -r ' .authenticated')" "1true"
chk authquoted "$(curl -si "$B/auth/quoted" | tr -d '\r' | grep -i '^www-authenticate:' | grep -c 'realm="badhttp says \\"hello\\", agent"')$(curl -s -u agent:correct "$B/auth/quoted" | jq -r ' .authenticated')" "1true"
chk authunknown "$(curl -si -u agent:correct "$B/auth/unknown-scheme" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=/X-Badhttp-Frobnicate/} END{print s, c+0}')" "401 1"
chk authbare "$(curl -si "$B/auth/bare-scheme" | tr -d '\r' | awk 'tolower($1)=="www-authenticate:"{sub(/^[^:]*: /,""); print; exit}')|$(curl -s -u agent:correct "$B/auth/bare-scheme" | jq -r '.authenticated')" "Basic|true"
# Nonce window witnessed by arithmetic: a valid MD5 response over the previous 5-min bucket's nonce
# is accepted (200); over bucket-2 it gets 401 stale=true. Skip near a rollover in either direction
# (local and edge clocks can be seconds apart, and skew at the bucket's end flips the verdicts).
aw_m=$(( $(date +%s) % 300 ))
if [ $aw_m -gt 5 ] && [ $aw_m -lt 295 ]; then
  aw_b=$(( $(date +%s) / 300 ))
  aw_ha1=$(md5 -q -s 'agent:badhttp:correct'); aw_ha2=$(md5 -q -s 'GET:/auth/digest')
  aw_dig(){ n=$(printf "badhttp:d:$1" | base64); r=$(md5 -q -s "$aw_ha1:$n:00000001:deadbeef:auth:$aw_ha2"); curl -si -H "Authorization: Digest username=\"agent\", realm=\"badhttp\", nonce=\"$n\", uri=\"/auth/digest\", cnonce=\"deadbeef\", nc=00000001, qop=auth, response=\"$r\"" "$B/auth/digest" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=/stale=true/} END{print s, c+0}'; }
  chk authnoncewin "$(aw_dig $((aw_b-1)))|$(aw_dig $((aw_b-2)))" "200 0|401 1"
fi
chk authutf8 "$(curl -s -u agent:sésame "$B/auth/utf8" | jq -r .encoding) $(curl -s -H "Authorization: Basic $(printf 'agent:s\xe9same' | base64)" "$B/auth/utf8" | jq -r .encoding)" "utf-8 latin1"
chk authalways "$(curl -s -u agent:correct -o /dev/null -w '%{http_code}' "$B/auth/always-401")$(curl -si -u agent:correct "$B/auth/always-401" | grep -ic '^x-badhttp-warning:')" 4011
chk authacceptany "$(curl -s -H 'Authorization: Whatever xyz' "$B/auth/accept-any" | jq -r '[.authenticated, .checked] | join(",")')$(curl -s -o /dev/null -w ' %{http_code}' "$B/auth/accept-any")" "true,false 401"
chk authforbidden "$(curl -si -u agent:correct "$B/auth/forbidden" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="www-authenticate:"{c=1} END{print s, c+0}')$(curl -s -o /dev/null -w ' %{http_code}' "$B/auth/forbidden")" "403 0 401"
chk authstale "$(curl -s --digest -u agent:correct "$B/auth/stale" | jq -r '[.authenticated, .generations] | join(",")')" "true,2"
chk authproxy "$(curl -si "$B/auth/proxy" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="proxy-authenticate:"{c=1} END{print s, c+0}')$(curl -s -H "Proxy-Authorization: Basic $(printf 'agent:correct' | base64)" "$B/auth/proxy" | jq -r ' .authenticated')" "407 1true"
chk authredirect "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/auth/redirect")" "302 $B/auth/basic"
chk authpost "$(curl -s --digest -u agent:correct -d x=1 "$B/auth/digest" | jq -r '[.authenticated, .method] | join(",")')" "true,POST"
chk authhead "$(curl -s -I "$B/auth/basic" -o /dev/null -w '%{http_code} %{size_download}')$(curl -sI "$B/auth/basic" | grep -ic '^www-authenticate:')" "401 01"
chk authopts "$(curl -si -X OPTIONS "$B/auth/basic" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="allow:"{sub(/^[^:]*: /,""); a=$0} END{print s "|" a}')" "204|GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
chk authtpl "$(curl -s "$B/auth/%7Bflavor%7D" | jq -r '[.template, (.values|length)] | join(",")')" "/auth/{flavor},18"
chk auth404 "$(curl -s -o /dev/null -w '%{http_code}' "$B/auth/nope")$(curl -s -o /dev/null -w ' %{http_code}' "$B/auth/basic/x")" "404 404"
chk authrobots "$(curl -s "$B/robots.txt" | grep -c '^Disallow: /auth/')" 1
chk authnoecho "$(curl -s -H 'Authorization: Basic c2VjcmV0OnNlY3JldA==' "$B/auth/accept-any" | grep -c c2VjcmV0)" 0
# /compress: content codings that misbehave. Pitfalls this block is written around: (1) curl sends no
# Accept-Encoding by default and the edge then transcodes — every as-sent check sets the header explicitly
# via "${AEG[@]}" (quoted array expansion: unquoted $AEG drops elements); -H 'Accept-Encoding:' REMOVES the
# header (= absent). (2) `curl --compressed` decodes gzip, x-gzip and deflate before -o: never in a check.
# (3) HTTP/2 lowercases header names and Cloudflare title-cases them on HTTP/1.1: always tolower($1).
# (4) Compressed byte counts belong to the runtime's zlib build and are never pinned; decoded length,
# SHA-256, header values and exit codes are. gzip(1) exits 1 for a cut stream or bad CRC, 2 for trailing
# garbage. (5) python zlib.decompress(d, 31) stops after the FIRST gzip member; gzip -dc handles both.
# (6) The "edge" checks send no Accept-Encoding and pin what Cloudflare makes of each flavor (the page's
# last column, dated); they and the ok/bomb negotiation checks run only against the real edge (cf-ray
# present) — wrangler dev has no edge and no request.cf.clientAcceptEncoding. (7) HEAD through the edge
# loses Content-Length/Content-Encoding for a coding the client did not list; HEAD checks send the coding.
# (8) ~85 requests here: sequential, with sleeps, under the 100/10 s zone limit.
sleep 2 # breathing room under the zone rate limit
export PATH="/opt/homebrew/bin:$PATH" # brotli, zstd (their checks self-skip, loudly, when absent)
same(){ if [ "$1" = "$2" ]; then echo same; else echo "$1!=$2"; fi; }
tr(){ LC_ALL=C command tr "$@"; }; awk(){ LC_ALL=C command awk "$@"; } # gzip bodies flow through tr/awk below; a UTF-8 locale makes macOS complain
AEG=(-H 'Accept-Encoding: gzip')
EDGE=$(curl -sI "$B/health" | grep -ic '^cf-ray:')
chk compressindex "$(curl -s "${AEG[@]}" "$B/compress" | jq -r '[(.flavors|length), (.edge_transcoding|length), (.params|length), .edge.probed, (.limits.wrong_length_min_bytes|tostring), (.params.bomb|join("+")), (.params.br|join("+"))] | join(",")')" "21,21,21,2026-09-01,128,size,code+length (only 4096)" # the index is no-transform, so a gzip client can read it as JSON
chk compressheaders "$(curl -sI "${AEG[@]}" "$B/compress/not-compressed" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-type:"{ct=$2" "$3} tolower($1)=="cache-control:"{cc=$2" "$3} tolower($1)=="x-badhttp-flavor:"{f=$2} tolower($1)=="vary:"{v=1} END{print s, ct, cc, f, v+0}')" "200 text/plain; charset=utf-8 no-store, no-transform not-compressed 0"
c_ok=$(curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/ok"; tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="vary:"{v=$2} tolower($1)=="content-length:"{cl=$2} tolower($1)=="x-badhttp-plain-sha256:"{sha=$2} tolower($1)=="x-badhttp-plain-bytes:"{pb=$2} END{print s, ce, v, cl, pb, sha}')
if [ "$EDGE" = 1 ]; then
chk compressok "$(echo $c_ok | awk '{print $1, $2, $3, $5}') $(same "$(echo $c_ok | awk '{print $4}')" "$(wc -c < $T/cb | tr -d ' ')") $(same "$(gzip -dc < $T/cb | shasum -a 256 | cut -c1-64)" "$(echo $c_ok | awk '{print $6}')")" "200 gzip Accept-Encoding 4096 same same"
chk compressoknegotiated "$(curl -si "${AEG[@]}" "$B/compress/ok" | tr -d '\r' | awk 'tolower($1)=="x-badhttp-negotiated-from:"{print $2}')$(curl -si -H 'Accept-Encoding: identity' "$B/compress/ok" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="content-length:"{cl=$2} tolower($1)=="x-badhttp-negotiated-from:"{nf=$2} END{print " " s, ce+0, cl, nf}')" "gzip 200 0 4096 identity"
chk compressoknone "$(curl -s -H 'Accept-Encoding:' -D $T/ch -o $T/cb "$B/compress/ok"; tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="x-badhttp-negotiated-from:"{nf=$2} END{print s, ce+0, nf}') $(head -c 8 $T/cb)" "200 0 (none: 00000000"
# Accept-Encoding normalization, the fact the family is designed around (one request each): q=0 and aliases fold to gzip, zstd and * vanish, mixed values keep the recognized set
nf(){ curl -si -H "Accept-Encoding: $1" "$B/compress/ok" | tr -d '\r' | awk 'tolower($1)=="x-badhttp-negotiated-from:"{sub(/^[^:]*: /,""); print}'; }
chk compressaenorm "$(nf 'gzip;q=0')|$(nf 'x-gzip')|$(nf 'GZIP')|$(nf 'zstd' | cut -c1-6)|$(nf '*' | cut -c1-6)|$(nf 'br;q=0.5, gzip;q=0, x-gzip, *, foo')|$(nf 'deflate')" "gzip|gzip|gzip|(none:|(none:|gzip, br|deflate"
chk compressindexae "$(curl -s "${AEG[@]}" "$B/compress" | jq -r '[.accept_encoding.as_the_edge_reports_it, .accept_encoding.as_seen_by_this_worker] | join("|")')" "gzip|gzip, br"
fi
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/ok?length=100"
chk compresslength "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="x-badhttp-plain-bytes:"{print $2}') $(gzip -dc < $T/cb | wc -c | tr -d ' ') $(gzip -dc < $T/cb | head -c 17) $(same "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="x-badhttp-plain-sha256:"{print $2}')" "$(gzip -dc < $T/cb | shasum -a 256 | cut -c1-64)")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok?length=0")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok?length=1048577")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok?length=abc")" "100 100 00000000 00000100 same 400 400 400"
if command -v brotli >/dev/null 2>&1; then
chk compressbr "$(curl -s -H 'Accept-Encoding: br' -D $T/ch -o $T/cb "$B/compress/br"; tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print s, ce}') $(brotli -dc < $T/cb | shasum -a 256 | cut -c1-16)" "200 br 3bb736fa851dceb1"
else echo "WARN brotli(1) missing: compressbr skipped"; fi
if command -v zstd >/dev/null 2>&1; then
chk compresszstd "$(curl -s -H 'Accept-Encoding: zstd' -D $T/ch -o $T/cb "$B/compress/zstd"; tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print s, ce}') $(zstd -dc < $T/cb 2>/dev/null | shasum -a 256 | cut -c1-16)" "200 zstd 3bb736fa851dceb1"
else echo "WARN zstd(1) missing: compresszstd skipped"; fi
chk compressfixedlen "$(curl -s -o /dev/null -w '%{http_code}' "$B/compress/br?length=4096")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/br?length=10")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/zstd?length=4096")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/empty?length=0")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/empty?length=1")" "200 400 200 200 400" # a fixed flavor accepts its own length as a no-op, nothing else
chk compressmismatch "$(curl -si "${AEG[@]}" "$B/compress/not-compressed" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="content-length:"{cl=$2} END{print s, ce, cl}') $(curl -s "${AEG[@]}" "$B/compress/not-compressed" | head -c 8)$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/mismatch")" "200 gzip 4096 00000000 404" # renamed in review; the old name is a 404
curl -s -H 'Accept-Encoding:' -D $T/ch -o $T/cb "$B/compress/undeclared"
chk compressundeclared "$(tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="content-length:"{cl=$2} END{print s, ce+0, cl}' | { read s ce cl; echo "$s $ce $(same "$cl" "$(wc -c < $T/cb | tr -d ' ')")"; }) $(head -c 2 $T/cb | od -An -tx1 | tr -d ' \n') $(gzip -dc < $T/cb | shasum -a 256 | cut -c1-16)" "200 0 same 1f8b 3bb736fa851dceb1"
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/truncated"
chk compresstruncated "$(tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="content-length:"{cl=$2} tolower($1)=="x-badhttp-wire-bytes-of:"{w=$2} END{print s, ce, cl, w}' | { read s ce cl w; echo "$s $ce $(same "$cl" "$(wc -c < $T/cb | tr -d ' ')") $(same "$w" "$cl")"; }) $(gzip -dc < $T/cb >/dev/null 2>&1; echo $?)" "200 gzip same same 1"
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/corrupt"
chk compresscorrupt "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="x-badhttp-flipped-bytes:"{print $2}') $(gzip -dc < $T/cb >/dev/null 2>&1; echo $?)" "4 1"
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/bad-crc"
chk compressbadcrc "$(gzip -dc < $T/cb 2>/dev/null | shasum -a 256 | cut -c1-16) $(gzip -dc < $T/cb >/dev/null 2>&1; echo $?)" "3bb736fa851dceb1 1" # every byte recoverable, then the CRC fails
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/trailing-garbage"
chk compresstrailing "$(gzip -dc < $T/cb 2>/dev/null | shasum -a 256 | cut -c1-16) $(gzip -dc < $T/cb >/dev/null 2>&1; echo $?) $(tail -c 48 $T/cb | head -c 8)" "3bb736fa851dceb1 2 badhttp:" # gzip(1) exits 2: trailing garbage ignored
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/multi-member"
chk compressmulti "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="x-badhttp-members:"{print $2}') $(gzip -dc < $T/cb | wc -c | tr -d ' ') $(gzip -dc < $T/cb | shasum -a 256 | cut -c1-16)" "2 4096 3bb736fa851dceb1"
chk compressdouble "$(curl -si "${AEG[@]}" "$B/compress/double" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{sub(/^[^:]*: /,""); print}') $(curl -s "${AEG[@]}" "$B/compress/double" | gzip -dc | gzip -dc | shasum -a 256 | cut -c1-16)" "gzip, gzip 3bb736fa851dceb1"
chk compressdoublehidden "$(curl -si "${AEG[@]}" "$B/compress/double-hidden" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print $2}') $(curl -s "${AEG[@]}" "$B/compress/double-hidden" | gzip -dc | head -c 2 | od -An -tx1 | tr -d ' \n')" "gzip 1f8b"
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/deflate-raw"
chk compressdeflateraw "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="content-encoding:"{print $2}') $(python3 -c "import sys,zlib,hashlib; print(hashlib.sha256(zlib.decompress(sys.stdin.buffer.read(), -15)).hexdigest()[:16])" < $T/cb)" "deflate 3bb736fa851dceb1"
chk compressunknown "$(curl -si "${AEG[@]}" "$B/compress/unknown-coding" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print s, ce}') $(curl -s -H 'Accept-Encoding:' "$B/compress/unknown-coding" | shasum -a 256 | cut -c1-16)$(curl -si -H 'Accept-Encoding:' "$B/compress/unknown-coding" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print " " $2}')$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/unknown")" "200 badhttp 3bb736fa851dceb1 badhttp 404"
chk compresscase "$(curl -si "${AEG[@]}" "$B/compress/uppercase" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print $2}') $(curl -s "${AEG[@]}" "$B/compress/uppercase" | gzip -dc | shasum -a 256 | cut -c1-16)" "GZIP 3bb736fa851dceb1"
chk compressxgzip "$(curl -s -H 'Accept-Encoding:' -D $T/ch -o $T/cb "$B/compress/x-gzip"; tr -d '\r' < $T/ch | awk 'tolower($1)=="content-encoding:"{print $2}') $(head -c 2 $T/cb | od -An -tx1 | tr -d ' \n') $(gzip -dc < $T/cb | shasum -a 256 | cut -c1-16)" "x-gzip 1f8b 3bb736fa851dceb1" # the edge does not know x-gzip: passed through even with no Accept-Encoding
chk compressempty "$(curl -si "${AEG[@]}" "$B/compress/empty" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="content-length:"{cl=$2} END{print s, ce, cl}')$(curl -si "${AEG[@]}" "$B/compress/empty?code=502" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print " " s, ce}')" "200 gzip 0 502 gzip"
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/gzip-file"
chk compressgzipfile "$(tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-type:"{ct=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="content-disposition:"{cd=1} tolower($1)=="x-badhttp-wire-sha256:"{w=$2} END{print s, ct, ce, cd+0, w}' | { read s ct ce cd w; echo "$s $ct $ce $cd $(same "$w" "$(shasum -a 256 $T/cb | cut -c1-64)")"; }) $(gzip -dc < $T/cb | shasum -a 256 | cut -c1-16)" "200 application/gzip gzip 1 same 3bb736fa851dceb1"
chk compresscode "$(curl -si "${AEG[@]}" "$B/compress/not-compressed?code=502" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print s, ce}')$(curl -s -o /dev/null -w ' %{http_code}' "${AEG[@]}" "$B/compress/wrong-length?code=500")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok?code=304")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/bomb?code=500")" "502 gzip 500 400 400"
wl_exit=$(curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/wrong-length"; echo $?); [ "$wl_exit" = 92 ] && wl_exit=18
chk compresswronglength "$wl_exit $(tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-length:"{cl=$2} END{print s, cl}') $(gzip -dc < $T/cb | shasum -a 256 | cut -c1-16)$(curl -sI "${AEG[@]}" "$B/compress/wrong-length" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print " " $2}')$(curl -s -o /dev/null -w ' %{http_code}' "${AEG[@]}" "$B/compress/wrong-length?length=127")$(curl -s -o /dev/null -w ' %{http_code}' "${AEG[@]}" "$B/compress/wrong-length?length=128")" "18 200 4096 3bb736fa851dceb1 4096 400 200" # a complete gzip stream, then the reset; lengths under 128 are refused (the member would be longer than the claim)
chk compresswronglenproto "$(curl -s --http1.1 "${AEG[@]}" -o /dev/null "$B/compress/wrong-length"; echo $?) $(curl -s --http2 "${AEG[@]}" -o /dev/null "$B/compress/wrong-length"; echo $?)" "18 92" # closed early on HTTP/1.1, stream reset on HTTP/2, as documented
curl -s "${AEG[@]}" -D $T/ch -o $T/cb "$B/compress/bomb?size=1"
chk compressbomb "$(tr -d '\r' < $T/ch | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="x-badhttp-plain-bytes:"{pb=$2} tolower($1)=="x-badhttp-plain-line:"{l=$0; sub(/^[^:]*: /,"",l); pl=length(l)} tolower($1)=="content-length:"{cl=$2} tolower($1)=="vary:"{v=1} END{print s, ce, pb, pl, (cl+0 < 8192), v+0}') $(gzip -dc < $T/cb | wc -c | tr -d ' ') $(same "$(tr -d '\r' < $T/ch | awk 'tolower($1)=="x-badhttp-plain-sha256:"{print $2}')" "$(gzip -dc < $T/cb | shasum -a 256 | cut -c1-64)")$(curl -s -o /dev/null -w ' %{http_code}' "${AEG[@]}" "$B/compress/bomb?size=33")$(curl -s -o /dev/null -w ' %{http_code}' "${AEG[@]}" "$B/compress/bomb?length=1")" "200 gzip 1048576 63 1 1 1048576 same 400 400" # the 63-char line header + newline, repeated, hashes to the table value
sleep 2 # breathing room under the zone rate limit
if [ "$EDGE" = 1 ]; then
chk compressbomb406 "$(curl -s -H 'Accept-Encoding:' -o /dev/null -w '%{http_code} %{content_type}' "$B/compress/bomb?size=1") $(curl -s -H 'Accept-Encoding: identity' "$B/compress/bomb?size=1" | jq -r ' .error') $(curl -s -H 'Accept-Encoding: *' -o /dev/null -w '%{http_code}' "$B/compress/bomb?size=1")" "406 application/json; charset=utf-8 not acceptable 406" # never inflated by the edge for a client without gzip: refused instead (also for * and no header, which RFC 9110 would let through)
# the fail-open side of that guard: clients the edge folds to "gzip" get the member, never the inflated text
chk compressbombfolded "$(curl -s -H 'Accept-Encoding: gzip;q=0' -D $T/ch -o $T/cb "$B/compress/bomb?size=1"; tr -d '\r' < $T/ch | awk 'tolower($1)=="content-encoding:"{print $2}') $(wc -c < $T/cb | tr -d ' ' | awk '{print ($1 < 8192) ? "member" : "inflated"}') $(curl -s -H 'Accept-Encoding: x-gzip' -D $T/ch -o $T/cb "$B/compress/bomb?size=1"; tr -d '\r' < $T/ch | awk 'tolower($1)=="content-encoding:"{print $2}') $(wc -c < $T/cb | tr -d ' ' | awk '{print ($1 < 8192) ? "member" : "inflated"}')" "gzip member gzip member"
# what the edge makes of each flavor for a client without gzip (the page's last column, dated 2026-09-01)
chk compressbredge "$(curl -si "${AEG[@]}" "$B/compress/br" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} END{print s, ce+0}') $(curl -s "${AEG[@]}" "$B/compress/br" | head -c 8)" "200 0 00000000"
chk compresszstdedge "$(curl -sI -H 'Accept-Encoding: gzip, zstd' "$B/compress/zstd" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=$2} END{print s, ce}') $(curl -sI -H 'Accept-Encoding: gzip, zstd' "$B/compress/ok" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="x-badhttp-negotiated-from:"{nf=$2} END{print ce, nf}')" "200 zstd gzip gzip" # zstd delivered to a client that lists it, though the Worker never sees zstd in the set
chk compressdeflateedge "$(curl -si -H 'Accept-Encoding: deflate' "$B/compress/deflate" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} END{print s, ce+0}') $(curl -s -H 'Accept-Encoding: deflate' "$B/compress/deflate" | shasum -a 256 | cut -c1-16)$(curl -si "${AEG[@]}" "$B/compress/deflate" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=1} END{print " " ce+0}')" "200 0 3bb736fa851dceb1 0" # zlib deflate: decoded for everyone, even a client that asked for it
chk compressmismatchedge "$(curl -si -H 'Accept-Encoding: identity' "$B/compress/not-compressed" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="content-length:"{cl=$2} END{print s, ce+0, cl}')" "200 0 4096"
chk compresstruncedge "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/truncated") $(wc -c < $T/cb | tr -d ' ') $(head -c 8 $T/cb)" "200 1860 00000000" # the partial plaintext, ended cleanly (1,860 is what inflates from the first 161 of 269 bytes; a runtime zlib change moves it — update the page too)
chk compresscorruptedge "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/corrupt") $(wc -c < $T/cb | tr -d ' ')" "200 0"
chk compressedge1m "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/truncated?length=1048576") $(wc -c < $T/cb | tr -d ' ') $(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/corrupt?length=1048576") $(wc -c < $T/cb | tr -d ' ')" "200 628228 200 1048516" # the 1 MiB numbers the page states
chk compressbadcrcedge "$(curl -s -H 'Accept-Encoding:' "$B/compress/bad-crc" | shasum -a 256 | cut -c1-16) $(curl -s -H 'Accept-Encoding:' "$B/compress/trailing-garbage" | shasum -a 256 | cut -c1-16)" "3bb736fa851dceb1 3bb736fa851dceb1" # CRC unchecked, junk dropped: the full text both times
chk compressmultiedge "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/multi-member") $(wc -c < $T/cb | tr -d ' ')" "200 2048"
chk compressdoubleedge "$(curl -s -H 'Accept-Encoding:' -D - -o $T/cb "$B/compress/double" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print $2}') $(head -c 2 $T/cb | od -An -tx1 | tr -d ' \n') $(curl -s -H 'Accept-Encoding:' -D - -o $T/cb "$B/compress/double-hidden" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=1} END{print ce+0}') $(head -c 2 $T/cb | od -An -tx1 | tr -d ' \n')" "gzip 1f8b 0 1f8b" # one layer removed either way; double keeps the label, double-hidden never had a second one
chk compressrawedge "$(curl -s -H 'Accept-Encoding:' -D - -o $T/cb "$B/compress/deflate-raw" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=1} END{print ce+0}') $(head -c 8 $T/cb | od -An -tx1 | tr -d ' \n' | grep -c '^30303030')" "0 0" # cannot inflate raw DEFLATE: the raw bytes, header removed
chk compressuppercaseedge "$(curl -s -H 'Accept-Encoding:' -D - -o $T/cb "$B/compress/uppercase" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=1} END{print ce+0}') $(head -c 8 $T/cb) $(curl -si -H 'Accept-Encoding:' "$B/compress/empty" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="content-length:"{cl=$2} END{print s, ce+0, cl}')" "0 00000000 200 0 0" # GZIP recognized and decoded; empty loses its label
chk compresswronglenedge "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/wrong-length"; echo " $?") $(shasum -a 256 $T/cb | cut -c1-16)" "200 0 3bb736fa851dceb1" # decoded and re-chunked: the lie disappears
chk compressgzipfileedge "$(curl -s -H 'Accept-Encoding:' -D - -o $T/cb "$B/compress/gzip-file" | tr -d '\r' | awk 'tolower($1)=="content-type:"{ct=$2} tolower($1)=="content-disposition:"{cd=1} tolower($1)=="content-encoding:"{ce=1} END{print ct, cd+0, ce+0}') $(head -c 8 $T/cb)" "application/gzip 1 0 00000000" # the edge commits the corruption: plaintext under a .gz label
chk compresscodeedge "$(curl -s -H 'Accept-Encoding:' -o $T/cb -w '%{http_code}' "$B/compress/truncated?code=503") $(wc -c < $T/cb | tr -d ' ')" "503 1860" # 5xx bodies are transcoded exactly like 200s
chk compressheadedge "$(curl -sI "${AEG[@]}" "$B/compress/br" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-encoding:"{ce=1} tolower($1)=="content-length:"{cl=1} tolower($1)=="x-badhttp-plain-bytes:"{pb=$2} END{print s, ce+0, cl+0, pb}') $(curl -sI -H 'Accept-Encoding:' "$B/compress/x-gzip" | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{ce=$2} tolower($1)=="content-length:"{cl=1} END{print ce, cl+0}') $(curl -s -I -H 'Accept-Encoding:' -o /dev/null -w '%{http_code}' "$B/compress/bomb?size=1")" "200 0 0 4096 x-gzip 1 406" # HEAD: a recognized coding the client did not list loses CL and CE; an unrecognized one keeps both
fi
chk compresshead "$(curl -s -I "${AEG[@]}" "$B/compress/ok" -o /dev/null -w '%{http_code} %{size_download}')$(curl -sI "${AEG[@]}" "$B/compress/ok" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print " " ($2>0)}')$(curl -s -I "${AEG[@]}" "$B/compress/bomb?size=1" -o /dev/null -w ' %{http_code} %{size_download}')" "200 0 1 200 0"
chk compressmethods "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/compress/ok")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/nope")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok/x")$(curl -s -o /dev/null -w ' %{http_code}' "$B/compress/ok?size=1")$(curl -s -o /dev/null -w ' %{http_code}' -X POST "$B/compress")" "405 404 404 400 200"
chk compresstpl "$(curl -s "$B/compress/%7Bflavor%7D" | jq -r '[.template, (.values|length)] | join(",")')" "/compress/{flavor},21"
chk compresssurfaces "$(curl -s "$B/openapi.json" | jq -r '[(.paths["/compress/{flavor}"].get.parameters[0].schema.enum|length), (.paths["/compress/{flavor}"].get.parameters|map(.name)|join("+"))] | join(",")') $(curl -s "$B/" | grep -o 'href="/compress/[a-z-][a-z-]*"' | sort -u | wc -l | tr -d ' ') $(curl -s "$B/llms.txt" | grep -c '^- \[Content codings\](') $(curl -s "$B/robots.txt" | grep -c '^Disallow: /compress/')" "21,flavor+length+code+size+Accept-Encoding 21 1 1"
# The zone must not block plain library user agents (Browser Integrity Check off since session 6:
# python-urllib was getting an edge 403, which contradicts the whole product).
chk uablock "$(curl -s -o /dev/null -w '%{http_code}' -A 'Python-urllib/3.14' "$B/health")" 200
chk cookiesnostore "$(curl -si "$B/cookies/ok" | grep -ic '^cache-control: no-store')" 1
# A 400 must carry no Set-Cookie (validation runs before headers are built), and the only Set-Cookie
# lines on this zone must be our own (no bot-product cookies like __cf_bm may ever appear).
chk cookies400 "$(curl -si "$B/cookies/many?count=0" | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="set-cookie:"{c=1} END{print s, c+0}')" "400 0"
chk cookiesinvariant "$(curl -si "$B/cookies/ok" | tr -d '\r' | grep -i '^set-cookie:' | grep -vc 'badhttp_')" 0
chk ratelimit "$(curl -s "$B/" | grep -c '100 requests per 10 seconds')$(curl -s "$B/llms.txt" | grep -c '100 requests per 10 s')" 11
chk support "$(curl -s "$B/" | grep -c 'accepts support on the one rail')$(curl -s "$B/" | grep -c '0x2b14ad50d63c7fee5a33847f95153ac37a690170')$(curl -s "$B/llms.txt" | grep -c 'Support is welcome')" 111
chk home "$(curl -s "$B/" | grep -c '<h3>')" 19
# totals.net is rounded to the cent (money as JS doubles), so this compares rounded to rounded
# rather than recomputing an unrounded double and demanding bit equality.
chk books "$(curl -s "$B/books.json" | jq -r 'if (((.totals.net * 100)|round) == ((((.totals.revenue - .totals.costs)) * 100)|round)) and (.receive_address|test("^0x[0-9a-fA-F]{40}$")) then "ok" else "bad" end')" ok
chk booksslash "$(curl -s -o /dev/null -w '%{content_type}' "$B/books.json/")" "application/json; charset=utf-8"
# booksaccrual: hosting is the one cost computed from the clock (session 20), so the suite recomputes
# it here INDEPENDENTLY in shell rather than reading the number the Worker just published back to
# itself. Anniversary arithmetic from 2026-08-23, month 1 accrued on the start date. If this fails on
# the 23rd of some month, the Worker's clock arithmetic is wrong — not this check.
# The start date and rate are duplicated here ON PURPOSE and never read from the response: a check
# that sources its expectation from the thing it is checking proves nothing. The clock is sampled
# both BEFORE and AFTER the fetch and either answer is accepted, which covers a UTC midnight crossing
# an accrual day mid-check (the Worker then legitimately disagrees with one of the two readings, and
# the direction depends on which side of the fetch the crossing fell). Any other disagreement is a bug.
_months_now() { local y m d; y=$(date -u +%Y); m=$(date -u +%-m); d=$(date -u +%-d); echo $(( (y - 2026) * 12 + (m - 8) - ( d < 23 ? 1 : 0 ) + 1 )); }
_M1=$(_months_now)
_BJ=$(curl -s "$B/books.json")
_M2=$(_months_now)
# `. as $r` first: inside test(), `.` is the string being tested, not the document root. Session 14
# shipped a jq argument-context bug of exactly this shape that would have failed every healthy deploy.
chk booksaccrual "$(printf '%s\n' "$_BJ" | jq -r --argjson m1 "$_M1" --argjson m2 "$_M2" '
  . as $r
  | if (($r.totals.hosting_months == $m1) or ($r.totals.hosting_months == $m2))
     and ($r.hosting.since == "2026-08-23") and ($r.hosting.rate_usd_per_month == 5)
     and ($r.totals.hosting_accrued == ($r.totals.hosting_months * 5))
     and (($r.totals.costs * 100 | round) == ((($r.totals.itemized_costs + $r.totals.hosting_accrued) * 100) | round))
     and ($r.totals.next_accrual | test("^20[0-9]{2}-[0-9]{2}-23$"))
  then "ok" else "bad" end')" ok
chk bookscommitments "$(printf '%s\n' "$_BJ" | jq -r '[.commitments[] | select((.due > (now|strftime("%Y-%m-%d"))) and (.amount > 0) and (.verified|length > 0))] | length')" 1
chk bookspageaccrual "$(curl -s "$B/books" | grep -c 'computed from the clock')" 1
# /books chain reconciliation (v0.10.0; itemized transfers v0.11.0). Tolerant of a public-RPC or
# indexer outage: when .chain.error / .chain.transfers.error is present the structural checks still
# pass; the arithmetic identity and label assertions run only when the data was actually read.
cjson=$(curl -s "$B/books.json")
# A cold colo answers transfers with a "still in progress" note while the indexer read finishes in
# the background (Blockscout takes 2-20 s). That is not an outage: wait briefly and refetch so the
# label assertions actually run. A real indexer failure (any other .error) still passes as tolerated,
# but loudly, so a run that passes only via the error guard is visible in the output.
tries=0
while [ $tries -lt 3 ] && printf '%s\n' "$cjson" | jq -e '(.chain.transfers.error? // "") | test("in progress")' >/dev/null 2>&1; do
  sleep 8; cjson=$(curl -s "$B/books.json"); tries=$((tries+1))
done
terr=$(printf '%s\n' "$cjson" | jq -r '.chain.transfers.error? // ""')
if [ -n "$terr" ]; then echo "WARN transfers degraded (checks pass vacuously): $terr"; fi
chk bookschain "$(printf '%s\n' "$cjson" | jq -r 'if (.chain.error? // "") != "" then "ok" elif (.chain.balance_usdc|test("^[0-9]+\\.[0-9]{6}$")) and (.chain.status|IN("reconciled","unbooked_receipts","bookkeeping_bug")) then "ok" else "bad" end')" ok
chk bookschainmath "$(printf '%s\n' "$cjson" | jq -r 'if (.chain.error? // "") != "" then "ok" elif ((((.chain.balance_usdc|tonumber)*1000000|round) - ((.chain.movements_in_usdc|tonumber)*1000000|round) + ((.chain.movements_out_usdc|tonumber)*1000000|round) - ((.chain.booked_revenue_usdc|tonumber)*1000000|round)) == ((.chain.unbooked_usdc|tonumber)*1000000|round)) then "ok" else "bad" end')" ok
chk bookschaincurl "$(printf '%s\n' "$cjson" | jq -r '.chain.reproduce|test("eth_call")')" true
chk bookstransfers "$(printf '%s\n' "$cjson" | jq -r 'if (.chain.transfers.error? // "") != "" then "ok" elif ((.chain.transfers.items|type) == "array") and (.chain.transfers.unexplained_out_count == 0) then "ok" else "bad" end')" ok
chk bookstransfersselftest "$(printf '%s\n' "$cjson" | jq -r 'if ((.chain.transfers.error? // "") != "") or (.chain.transfers.truncated == true) then "ok" else ([.chain.transfers.items[] | select(.tx == "0x8a331a0a28a26d290984c34bd12ae03bdc31603856b4e46bace3d2045cddc089" or .tx == "0x629b1a478e88c8be043ee0e8ebac67169a386192fde388b9a616fc850b5010b8") | .label] | if (length == 2) and (map(test("self-test")) | all) then "ok" else "bad" end) end')" ok
chk bookstransferscurl "$(printf '%s\n' "$cjson" | jq -r '.chain.transfers.reproduce|test("token-transfers")')" true
chk bookspagechain "$(curl -s "$B/books" | grep -c 'Reconciliation')" 1
chk bookspageitemized "$(curl -s "$B/books" | grep -c 'Every movement, itemized')" 1
# ---- the measured hosting basis and the solvency line (v0.16.0, session 21) -------------------
# hosting_usage is DERIVED from hosting_measured, so this recomputes the derivation from the raw
# measurement — with Cloudflare's two included allowances DUPLICATED here on purpose, exactly as
# `booksaccrual` duplicates the start date and rate. Reading the plan figures back out of the
# response and dividing by them would only prove the response is self-consistent, which is not the
# claim. If Cloudflare changes an allowance, this check fails and the books get re-measured.
chk bookshostingderived "$(printf '%s\n' "$cjson" | jq -r '
  . as $r
  | ($r.hosting_measured) as $m | ($r.hosting_usage) as $u
  | (($m.requests / $m.window.days) * 30) as $rpm
  | (($m.cpu_ms  / $m.window.days) * 30) as $cpm
  | if (($u.projected_requests_per_month - $rpm) | fabs) < 1
     and (($u.projected_cpu_ms_per_month  - $cpm) | fabs) < 1
     and (($u.percent_of_paid_included_requests - ($rpm / 10000000 * 100)) | fabs) < 0.01
     and (($u.percent_of_paid_included_cpu      - ($cpm / 30000000 * 100)) | fabs) < 0.01
     and ($u.usage_charge_on_existing_paid_plan_usd == 0)
     and ($u.incremental_hosting_usd_per_year == 0)
     and ($u.standalone_hosting_usd_per_year == 60)
  then "ok" else "bad" end')" ok
# The free plan is ruled out by a MEASURED maximum, not an argument: assert the direction of the
# comparison and that the page says so. A free plan whose ceiling ever rose above our measured max
# should fail this and make someone re-read the measurement, not silently flip the conclusion.
chk bookshostingfree "$(printf '%s\n' "$cjson" | jq -r '
  . as $r
  | if ($r.hosting_usage.free_plan_viable == false)
     and ($r.hosting_measured.cpu_ms_max > $r.hosting_measured.plan.free_cpu_ms_per_invocation)
     and ($r.hosting_measured.days_in_window_exceeding_free_ceiling == $r.hosting_measured.window.days)
     and ($r.hosting_usage.free_plan_blocker | test("1102"))
  then "ok" else "bad" end')" ok
# The accrual is UNCHANGED by the measurement: the books still charge themselves the attributed
# $5/mo. This is the check that stops a future session quietly adopting the flattering number.
chk bookshostingattribution "$(printf '%s\n' "$cjson" | jq -r '[.hosting.rate_usd_per_month, (.totals.hosting_accrued / .totals.hosting_months)] | join(",")')" "5,5"
# Solvency: the arithmetic recomputed from its own inputs (which are a live chain read and a stated
# constant, so there is nothing to duplicate), plus the degradation contract — when the RPC fails
# every amount must be null rather than filled in from a stale figure.
serr=$(printf '%s\n' "$cjson" | jq -r '.solvency.error? // ""')
if [ -n "$serr" ]; then echo "WARN solvency degraded (arithmetic checked vacuously): $serr"; fi
chk bookssolvency "$(printf '%s\n' "$cjson" | jq -r '
  . as $r | ($r.solvency) as $s
  | if ($s.error? // "") != ""
    then (if ($s.payer_usdc == null) and ($s.assets_on_hand_usd == null) and ($s.shortfall_usd == null)
          and ($s.covers_next_bill == null) and ($s.next_bill.amount > 0) then "ok" else "bad" end)
    elif ((($s.payer_usdc + $s.registrar_credit_usd) - $s.assets_on_hand_usd) | fabs) < 0.000001
     and ($s.shortfall_usd == (if $s.assets_on_hand_usd >= $s.next_bill.amount then 0
            else (($s.next_bill.amount - $s.assets_on_hand_usd) * 1000000 | round) / 1000000 end))
     and ($s.covers_next_bill == ($s.assets_on_hand_usd >= $s.next_bill.amount))
     and ($s.days_until_next_bill > 0)
     and ($s.reproduce | test("eth_call"))
    then "ok" else "bad" end')" ok
# The earned column must exist, must equal booked revenue, and must be what the verdict is drawn
# from. This section originally netted the operator's working capital against the bill and printed a
# $1.66 gap, which reads as "nearly self-funding" for a service that has earned one cent; two
# reviewers caught it the same session it shipped. This check is what stops it drifting back.
chk bookssolvencyearned "$(printf '%s\n' "$cjson" | jq -r '
  . as $r
  | if ((($r.solvency.earned_to_date_usd - ($r.revenue | map(.amount) | add // 0)) | fabs) < 0.000001)
     and ($r.solvency.covers_next_bill_from_earnings == ($r.solvency.earned_to_date_usd >= $r.solvency.next_bill.amount))
     and ($r.solvency.earned_share_of_next_bill_percent >= 0)
     and ($r.solvency.what_this_means | test("earned"))
  then "ok" else "bad" end')" ok
# On the page, the earned figure must be stated BEFORE the total-on-hand figure. Order is the whole
# finding here: the same two numbers in the other order tell the flattering story.
chk bookspageearnedfirst "$(curl -s "$B/books" | awk '/earned, from anyone but this project/{e=NR} /total on hand/{h=NR} END{print (e>0 && h>0 && e<h) ? "ok" : "bad"}')" ok
# The payer balance must be a LIVE read, cross-checked against a public RPC this script calls
# itself — the one figure on the page that a stale constant could fake. Outage-tolerant but loud.
_payer=$(printf '%s\n' "$cjson" | jq -r '.solvency.payer_address')
_pub=$(curl -s -m 12 -X POST https://mainnet.base.org -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\",\"data\":\"0x70a08231000000000000000000000000${_payer#0x}\"},\"latest\"]}" \
  | jq -r '.result // ""')
if [ -z "$_pub" ] || [ -n "$serr" ]; then
  echo "WARN payer cross-check skipped (public RPC or our own read unavailable)"
else
  # Hex → atomic USDC in shell, not jq: the two jq traps this project has paid for (argument
  # context in test(), and reduce/explode arithmetic) both looked like clever one-liners first.
  _pub_atomic=$(printf '%d' "$_pub" 2>/dev/null || echo x)
  _ours_atomic=$(printf '%s\n' "$cjson" | jq -r '(.solvency.payer_usdc * 1000000) | round')
  chk bookspayerlive "$_ours_atomic" "$_pub_atomic"
fi
# Both new sections must actually render on the page, not just exist in the JSON. The page is where
# a reader meets these numbers; #19 shipped a surface that 500'd while its JSON twin was fine.
bpage=$(curl -s "$B/books")
chk bookspagehosting "$(printf '%s\n' "$bpage" | grep -c 'What it actually uses')" 1
chk bookspagesolvency "$(printf '%s\n' "$bpage" | grep -c 'Can it pay its own next bill')" 1
# The page must state BOTH cost answers. A future edit that keeps only the $0 one would be the
# flattering half of a true story, and this is the check that catches it.
chk bookspagebothcosts "$(printf '%s\n' "$bpage" | grep -c 'Standing on its own')$(printf '%s\n' "$bpage" | grep -c 'the books charge themselves the larger figure' -i)" "11"
chk openapi "$(curl -s "$B/openapi.json" | jq -r '.paths|keys|length')" 39
chk openapiprofile "$(curl -s "$B/openapi.json" | jq -r '[(.paths["/402/pay"].get["x-payment-info"].price.mode), (.paths["/402/pay"].get["x-payment-info"].protocols[0]|keys[0]), ([.paths[] | .[] | .security] | all(. == [])), ([.paths[] | .[] | has("x-payment-info")] | map(select(.)) | length), (.info.contact.url|test("/books$")), (.info.contact.email // "none"), (.["x-agentcash-guidance"].llmsTxtUrl|test("/llms.txt$")), (.info["x-guidance"]|length > 50), (.paths["/402/{scenario}"].get.parameters[0].schema.enum|index("pay") // "nopay")] | join(",")')" "dynamic,x402,true,3,true,ops@badhttp.dev,true,true,nopay"
chk llms "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B/llms.txt"; curl -s "$B/llms.txt" | head -1)" "200 text/markdown; charset=utf-8# badhttp"
chk sitemap "$(curl -s "$B/sitemap.xml" | grep -c '<loc>')$(curl -s -o /dev/null -w ' %{content_type}' "$B/sitemap.xml")" "20 application/xml; charset=utf-8"
chk robotsmap "$(curl -s "$B/robots.txt" | grep -c "^Sitemap: $B/sitemap.xml")" 1
chk favicon "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B/favicon.svg")$(curl -s -o /dev/null -w ' %{http_code} %{redirect_url}' "$B/favicon.ico")$(curl -sI "$B/" | tr -d '\r' | grep -ic "^content-security-policy: .*img-src 'self' data:")" "200 image/svg+xml 301 $B/favicon.svg1"
# ---- funding discovery (v0.16.0): the manifest and its provenance file ------------------------
# Validated against the schema's REQUIRED fields rather than against our own output. projects[] was
# deliberately absent while the repository was private (the schema demands a repositoryUrl); since
# 2026-09-18 it names the public repository, and the check pins that it does, with the licence.
fj=$(curl -s "$B/funding.json")
chk fundingmanifest "$(printf '%s\n' "$fj" | jq -r '
  . as $r
  | [$r.funding.channels[].guid] as $guids
  | [($r.version),
     ($r.entity|has("type") and has("role") and has("name") and has("email") and has("description") and has("webpageUrl")),
     ($r.entity.type|IN("individual","group","organisation","other")),
     ($r.entity.role|IN("owner","steward","maintainer","contributor","other")),
     ($r.projects|length==1 and (.[0].repositoryUrl.url|test("^https://github.com/auzroz/badhttp$")) and (.[0].licenses|index("spdx:MIT")!=null)),
     (($r.funding.channels|length) > 0),
     (($r.funding.plans|length) > 0),
     ([$r.funding.plans[].channels[]] | all(. as $c | $guids | index($c) != null))]
  | join(",")')" "v1.1.0,true,true,true,true,true,true,true"
# The manifest's address must be the SAME address the books publish. Two hand-typed copies of a
# payment address is exactly how a project ends up soliciting money to somewhere it does not hold.
chk fundingaddress "$(printf '%s\n' "$fj" | jq -r '.funding.channels[0].address')" "$(printf '%s\n' "$cjson" | jq -r '.receive_address')"
chk fundingwellknown "$(curl -s "$B/.well-known/funding-manifest-urls" | tr -d '\n')$(curl -s -o /dev/null -w ' %{http_code}' "$B/.well-known/funding-manifest-urls")" "$B/funding.json 200"
chk fundingwellknownother "$(curl -s -o /dev/null -w '%{http_code}' "$B/.well-known/nope.txt")" 404
chk llmsecho "$(curl -s "$B/llms.txt" | grep -c '^- \[Echo\](')" 1
# IndexNow key file: only checkable when INDEXNOW_KEY is in the environment (deploy.sh sources .env); skipped otherwise.
[ -n "$INDEXNOW_KEY" ] && chk indexnow "$(curl -s "$B/$INDEXNOW_KEY.txt" | tr -d '\n' | sed "s/^$INDEXNOW_KEY\$/same/")$(curl -s -o /dev/null -w ' %{http_code}' "$B/notthekey.txt")" "same 404"
# ---- /corpus + /license (v0.13.0) -------------------------------------------------
# The corpus is generated from the same flavor tables the home page and family indexes render, so a
# family gaining a flavor moves corpusrows; that is the point (a silently un-catalogued flavor fails
# the deploy). The RFC 9112 claim is pinned as a dated finding, exactly like the /compress edge column:
# if this ever flips, the platform changed and the probe must be re-run, not the assertion relaxed.
cidx=$(curl -s "$B/corpus")
chk corpusindex "$(printf '%s\n' "$cidx" | jq -r '[(.license), (.count > 100), (.rfc9112_message_syntax.emits_syntax_violations), (.jsonl|test("/corpus.jsonl$")), (.by_layer|keys|length > 8)] | join(",")')" "CC0-1.0,true,false,true,true"
chk corpusnotcovered "$(printf '%s\n' "$cidx" | jq -r '.not_covered|has("rfc9112-message-syntax") and has("request-smuggling")')" true
curl -s -D "$T/ch" "$B/corpus.jsonl" -o "$T/corpus.jsonl"
chk corpusjsonlhdr "$(tr -d '\r' < "$T/ch" | grep -ic '^content-type: application/x-ndjson')$(tr -d '\r' < "$T/ch" | grep -ic '^cache-control:.*no-transform')$(tr -d '\r' < "$T/ch" | grep -ic '^x-badhttp-license: CC0-1.0')$(tr -d '\r' < "$T/ch" | grep -ic '^link: <.*>; rel="license"')" "1111"
# every line is valid JSON, and the row count matches what the header promised
chk corpusjsonlvalid "$(while IFS= read -r l; do printf '%s' "$l" | jq -e . >/dev/null 2>&1 || echo BAD; done < "$T/corpus.jsonl" | grep -c BAD)" 0
chk corpusrowcount "$(wc -l < "$T/corpus.jsonl" | tr -d ' ')" "$(tr -d '\r' < "$T/ch" | sed -n 's/^x-badhttp-rows: //Ip')"
chk corpusindexcount "$(printf '%s\n' "$cidx" | jq -r .count)" "$(wc -l < "$T/corpus.jsonl" | tr -d ' ')"
# ids unique, no row without a defect, every url on this origin (the row origin and the response
# origin must agree — wrangler's dev proxy rewrites Link headers, production must not disagree)
chk corpusids "$(jq -r .id "$T/corpus.jsonl" | sort | uniq -d | wc -l | tr -d ' ')" 0
chk corpusdefects "$(jq -rc 'select(.defect == null or .defect == "")|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# Until session 22 this asserted every row url started with the base, which encoded an assumption
# /crosshost deliberately breaks: two of its rows start on the other host or over plaintext http,
# because the direction and the scheme ARE the measurement. The assertion is therefore TIGHTENED, not
# relaxed — every row must still name a host this project owns, and the rows allowed to differ are
# named individually, so a row that wanders anywhere else still fails.
chk corpusorigin "$(jq -r --arg b "$B" 'select((.url|startswith($b))|not)|.id' "$T/corpus.jsonl" | sort | tr '\n' ',')" "crosshost.from-subdomain,crosshost.scheme-upgrade,"
chk corpusownhosts "$(jq -r 'select((.url|test("^https?://(badhttp\\.dev|alt\\.badhttp\\.dev)/"))|not)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
chk corpuslicrows "$(jq -r 'select(.license != "CC0-1.0")|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# The only two RFC 9112 completeness violators, pinned by name: /truncate and /sse/drop.
chk corpusframing "$(jq -r 'select(.rfc9112_completeness_violation == true)|.id' "$T/corpus.jsonl" | sort | tr '\n' ,)" "sse.drop,truncate,"
chk corpussyntaxclean "$(jq -r 'select(.conforms_rfc9112_syntax != true)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# The session-20 repair, pinned by name. /range/if-range-ignored is the ONE range flavor that mints a
# fresh generation stamp per request, and it published deterministic_bytes:true for as long as the
# corpus has existed. A row count would not have caught it and did not; only naming it does. The
# thirteen sibling flavors must stay true — the fix is per-flavor, not a family-wide capitulation.
chk corpusifrange "$(jq -rc 'select(.id=="range.if-range-ignored")|[.deterministic_bytes, (.varies_by|index("generation") != null)]|join(",")' "$T/corpus.jsonl")" "false,true"
chk corpusrangesiblings "$(jq -r 'select(.family=="range" and .flavor!="if-range-ignored")|select(.deterministic_bytes != true)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# Every row admitting unstable bytes must say what moves them. corpus-assert.sh proves this against
# the wire; this catches a regression in the generator without waiting for the paced replay.
chk corpusvariesby "$(jq -r 'select(.deterministic_bytes == false)|select((.varies_by|length) == 0)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# The self_check block states what was run and what it cannot check. It must never claim the file is
# "verified" — the published wording is the method and the date, and the limits are named.
# The last clause is structural, not cosmetic: self_check describes a check that runs on EVERY
# deploy, so an ISO date anywhere in last_run would be a claim about a recurring event frozen at one
# instant — the exact rot this session removed from the books. Asserting the date cannot appear makes
# it unrepresentable, and costs nothing on a normal deploy. (result's "Introduced 2026-09-08" is a
# different thing: it dates a one-off historical event, like RFC9112.probed, and does not decay.)
chk corpusselfcheck "$(printf '%s\n' "$cidx" | jq -r '[(.self_check.method|test("corpus-assert.sh")), (.self_check.method|test("corpus-verify.sh")), (.self_check.result|test("verified")|not), ((.self_check.what_this_does_not_check|length) >= 4), (.self_check.rows_double_fetched > 0), (.self_check.rows_double_fetched < .self_check.rows_checked), (.self_check.last_run|test("[0-9]{4}-[0-9]{2}-[0-9]{2}")|not)]|join(",")')" "true,true,true,true,true,true,true"
# The index promised "every documented behaviour" while the template explainers had zero rows. The
# promise was narrowed rather than the defect catalogue padded; this pins the narrowing.
chk corpusscope "$(printf '%s\n' "$cidx" | jq -r '[(.what|test("defect catalogue")), (.what|test("CONTROLS")), ((.what_is_not_a_row|length) > 200), (.what_is_not_a_row|test("family indexes"))]|join(",")')" "true,true,true,true"
# /compress rows must carry the load-bearing capture header; without it the edge transcodes and the
# fixture is of something else entirely.
# Every compress row must carry an accept-encoding, because on this family the header decides which
# of two legitimate fixtures you capture. It is `gzip` for every flavor except br and zstd, which are
# only delivered as sent to a client that lists them (pinned separately by corpusbrzstdae).
chk corpuscompressae "$(jq -r 'select(.family=="compress")|select((.request_headers["accept-encoding"] // "") == "")|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
chk corpuscompressaegzip "$(jq -r 'select(.family=="compress")|select(.flavor!="br" and .flavor!="zstd")|select(.request_headers["accept-encoding"] != "gzip")|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
chk corpuscompressedge "$(jq -r 'select(.family=="compress")|select(has("edge_transcoding")|not)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
chk corpuscurl "$(jq -r 'select((.curl|test("--http1.1"))|not)|.id' "$T/corpus.jsonl" | wc -l | tr -d ' ')" 0
# Licence surfaces. The openapi one is the fix itself: info.license used to say MIT (the source's
# licence) in a field that reads as the licence for the API, which is what prompted the question.
chk license "$(curl -s "$B/license" | jq -r '[.responses.id, .source_code.id, (.responses.conditions|test("None")), (.not_ours|has("note")), (.contact|test("ops@badhttp.dev"))] | join(",")')" "CC0-1.0,MIT,true,true,true"
chk openapilicense "$(curl -s "$B/openapi.json" | jq -r '[.info.license.identifier, (.info.license.url|test("creativecommons.org/publicdomain/zero")), (.info["x-license"].source_code|test("^MIT")), (.info["x-license"].details|test("/license$"))] | join(",")')" "CC0-1.0,true,true,true"
chk llmslicence "$(curl -s "$B/llms.txt" | grep -c '^## Licence')$(curl -s "$B/llms.txt" | grep -ic 'CC0-1.0')" "11"
chk homelicence "$(curl -s "$B/" | grep -c '<h2>Licence</h2>')" 1
chk corpuscors "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$B/corpus.jsonl")" 204

# The seven rows session 19 found lying. Each of these is a row whose own url/method/headers did not
# address the endpoint it documented. They are pinned individually because "the count is right" would
# not have caught any of them.
chk corpusfixedsingletons "$(jq -r 'select(.id=="echo" or .id=="delay" or .id=="flaky")|"\(.id):\(.method):\(.url|sub("^https?://[^/]+";""))"' "$T/corpus.jsonl" | sort | tr '\n' ' ')" "delay:GET:/delay/2 echo:POST:/echo flaky:GET:/flaky/50 "
chk corpusstatusurl "$(jq -r 'select(.id=="status")|"\(.url|test("/status/[0-9]+$")):\(.url_template|test("\\{code\\}"))"' "$T/corpus.jsonl")" "true:true"
chk corpusredirect "$(jq -r 'select(.family=="redirect")|.id' "$T/corpus.jsonl" | sort | tr '\n' ,)" "redirect.hops,redirect.landing,redirect.loop,"
# br and zstd are delivered as sent only to a client whose Accept-Encoding lists them; under the
# family default of gzip the edge decodes them and the capture is of something else entirely.
chk corpusbrzstdae "$(jq -r 'select(.id=="compress.br" or .id=="compress.zstd")|"\(.flavor)=\(.request_headers["accept-encoding"])"' "$T/corpus.jsonl" | sort | tr '\n' ' ')" "br=br zstd=zstd "

# /clients — the witness matrix as data. compress: 8 profiles x 21 flavors; crosshost: 8 clients x 9 flavors; auth: 8 clients x 18 flavors.
clh=$(curl -s -D - "$B/clients.jsonl" -o "$T/clients.jsonl")
chk clientsjsonlhdr "$(printf '%s\n' "$clh" | tr -d '\r' | grep -ic '^content-type: application/x-ndjson')$(printf '%s\n' "$clh" | tr -d '\r' | grep -ic '^cache-control:.*no-transform')$(printf '%s\n' "$clh" | tr -d '\r' | grep -ic '^x-badhttp-license: CC0-1.0')$(printf '%s\n' "$clh" | tr -d '\r' | grep -ic '^link: <.*>; rel="license"')" "1111"
chk clientsrows "$(wc -l < "$T/clients.jsonl" | tr -d ' ')" 384
chk clientsfamilies "$(jq -r .family "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr '\n' ';' | tr -d ' ')" "144auth;168compress;72crosshost;"
chk clientsrowcount "$(wc -l < "$T/clients.jsonl" | tr -d ' ')" "$(printf '%s\n' "$clh" | tr -d '\r' | sed -n 's/^x-badhttp-rows: //Ip' | tr -d '\r')"
chk clientsjsonlvalid "$(while IFS= read -r l; do printf '%s' "$l" | jq -e . >/dev/null 2>&1 || echo BAD; done < "$T/clients.jsonl" | grep -c BAD)" 0
chk clientsids "$(jq -r .id "$T/clients.jsonl" | sort | uniq -d | wc -l | tr -d ' ')" 0
chk clientslic "$(jq -r 'select(.license != "CC0-1.0")|.id' "$T/clients.jsonl" | wc -l | tr -d ' ')" 0
# Rows not on the canonical origin are exactly the two crosshost flavors that start elsewhere (as in the corpus),
# and every row names one of the two hosts this project owns.
chk clientsorigin "$(jq -r --arg b "$B" 'select((.url|startswith($b))|not)|.corpus_id' "$T/clients.jsonl" | sort -u | tr '\n' ',')" "crosshost.from-subdomain,crosshost.scheme-upgrade,"
chk clientshosts "$(jq -r '.url' "$T/clients.jsonl" | sed -E 's#^https?://([^/:]+).*#\1#' | grep -vcE '^(badhttp\.dev|alt\.badhttp\.dev)$')" 0
# Six decoding clients and two controls: the split is what keeps the site's "six real clients" claim
# literally true now that eight profiles are published.
chk clientsroles "$(jq -r '.client.role' "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr '\n' ';' | tr -d ' ')" "342client;42control;"
# Every /clients row must join to a real /corpus.jsonl row, or the join key is decoration.
chk clientsjoin "$(comm -23 <(jq -r .corpus_id "$T/clients.jsonl" | sort -u) <(jq -r .id "$T/corpus.jsonl" | sort -u) | wc -l | tr -d ' ')" 0
cidxc=$(curl -s "$B/clients")
chk clientsindex "$(printf '%s\n' "$cidxc" | jq -r '[(.rows==384), (.families.compress.rows==168), (.families.crosshost.rows==72), (.families.compress.flavors==21), (.families.crosshost.flavors==9), (.license=="CC0-1.0"), (.families.compress.clients|length==8), (.families.crosshost.clients|length==8), (.jsonl|test("/clients.jsonl$")), (.families.compress.outcome_legend|keys|length==6), (.families.crosshost.outcome_legend|keys|length==5), (.common_fields|length==12)] | join(",")')" "true,true,true,true,true,true,true,true,true,true,true,true"
chk clientsauthindex "$(printf '%s\n' "$cidxc" | jq -r '[(.families.auth.rows==144), (.families.auth.flavors==18), (.families.auth.clients|length==8), (.families.auth.outcome_legend|keys|length==5), (.families.auth.mechanism_legend|keys|length==8), (.families.auth.findings|length>=10), ([.families.auth.clients[].requests_counted_by]|all(type=="string" and length>20)), (.families.auth.disagreement_by_flavor|keys|length==18)] | join(",")')" "true,true,true,true,true,true,true,true"
# The honesty guard: the index must say outright that an outcome is not a verdict, and must name the
# flavor where "differs" is correct behaviour. If this sentence is ever dropped, the table becomes a
# scoreboard of named third-party libraries, which is not what it is.
chk clientsreading "$(printf '%s\n' "$cidxc" | jq -r '[(.reading_this|test("never a verdict")), (.families.compress.reading_this|test("never as a verdict")), (.families.compress.reading_this|test("undeclared")), (.families.compress.reading_this|test("truncated")), (.families.crosshost.reading_this|test("never as a verdict")), (.families.crosshost.reading_this|test("RFC 9110")), (.families.crosshost.reading_this|test("echoed")), (.families.auth.reading_this|test("never as a verdict")), (.families.auth.reading_this|test("capability")), (.families.auth.reading_this|test("scrubbed")), (.families.auth.reading_this|test("ORIGIN credentials")), (.families.auth.reading_this|test("by construction"))] | join(",")')" "true,true,true,true,true,true,true,true,true,true,true,true"
# Verdict words must not appear in the auth family's reading or findings: the rows describe, they do not grade.
chk clientsauthnoverdict "$(printf '%s\n' "$cidxc" | jq -r '[.families.auth.reading_this, .families.auth.findings[]] | join(" ")' | grep -ciwE '(correctly|refuses|conformant|non-compliant|violates)')" 0
chk clientsdisagree "$(printf '%s\n' "$cidxc" | jq -r '.families.compress.disagreement_by_flavor["not-compressed"].distinct_outcomes')" 4
# crosshost rows: every one landed (status 200, an arrived object of four booleans, an outcome from the legend), on one of
# the two hosts, and none carries any of the test values — the rows are booleans and badhttp_-prefixed cookie names by design.
# Each check carries its own 72-row floor: a for-all over an empty selection proves nothing.
chk clientschshape "$(jq -r 'select(.family=="crosshost") | [(.status==200), (.arrived|type=="object"), ([.arrived.authorization, .arrived.proxy_authorization, .arrived.cookie, .arrived.x_api_key] | all(type=="boolean")), (.landed_on|test("^(alt\\.)?badhttp\\.dev$")), (.sent.authorization==true), (.sent.x_api_key==true), (.observed|test("^2026-")), (.final_url|type=="string"), (.redirect_followed==true)] | all' "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr -d '\n ')" "72true"
chk clientschoutcomes "$(jq -r 'select(.family=="crosshost")|.outcome' "$T/clients.jsonl" | sort -u | wc -l | tr -d ' ')/$(comm -23 <(jq -r 'select(.family=="crosshost")|.outcome' "$T/clients.jsonl" | sort -u) <(printf '%s\n' "$cidxc" | jq -r '.families.crosshost.outcome_legend|keys[]' | sort -u) | wc -l | tr -d ' ')" "2/0"
chk clientschnoecho "$(jq -c 'select(.family=="crosshost")' "$T/clients.jsonl" | wc -l | tr -d ' ')/$(jq -c 'select(.family=="crosshost")' "$T/clients.jsonl" | grep -c 'YWdlbnQ6\|badhttp-key-ok\|badhttp-token-ok')" "72/0"
# Every chain landed on its first attempt; if a re-capture needed a retry, the home-page sentence saying so must change too.
chk clientschattempts "$(jq -r 'select(.family=="crosshost")|.attempts' "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr -d '\n ')" "721"
chk clientschjar "$(jq -r 'select(.family=="crosshost" and .flavor=="jar") | [.sent.cookie, (.cookie_names_arrived|type)] | join(",")' "$T/clients.jsonl" | sort -u | tr '\n' ';')" "false,array;"
# The first crosshost finding states a count; it must be the count in the rows it summarizes.
chk clientschfinding "$(printf '%s\n' "$cidxc" | jq -r '.families.crosshost.findings[0]' | grep -c "$(jq -r 'select(.family=="crosshost") | .arrived.x_api_key' "$T/clients.jsonl" | grep -c true) of $(jq -r 'select(.family=="crosshost")|.id' "$T/clients.jsonl" | wc -l | tr -d ' ') observations")" 1
# auth rows: every one names a mechanism kind from the legend and an outcome from the legend, carries hops (status +
# header presence per request, never a value), statuses_seen, attempts, and either an oracle-derived status or a
# raise/failure — and none carries anything a client could have sent. Each for-all carries its own 144-row floor.
chk clientsauthshape "$(jq -r 'select(.family=="auth") | [(.mechanism_kind|IN("basic-auth","basic-header","basic-handler","digest-handler","any-handler","bearer-auth","bearer-header","no-mechanism")), (.outcome|IN("authenticated","refused","redirect-not-followed","client-raised","request-failed")), (.hops|type=="array" and length>=1), ([.hops[]|(.authorization|type=="boolean") and (.proxy_authorization|type=="boolean")]|all), (.statuses_seen|type=="array"), (.attempts|type=="number"), (.observed|test("^2026-")), (.url|startswith("https://badhttp.dev/auth/")), (.credentialed_requests|type=="number"), ((.status|type=="number") == (.outcome|IN("authenticated","refused","redirect-not-followed")))] | all' "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr -d '\n ')" "144true"
chk clientsauthnoecho "$(jq -c 'select(.family=="auth")' "$T/clients.jsonl" | wc -l | tr -d ' ')/$(jq -c 'select(.family=="auth")' "$T/clients.jsonl" | grep -c 'YWdlbnQ6\|Y29ycmVjdA\|c8Opc2FtZQ\|c+lzYW1l\|agent:correct\|sésame\|agent%3A\|badhttp-token-ok\|Proxy-Authorization:\|response=')" "144/0"
chk clientsauthoutcomes "$(comm -23 <(jq -r 'select(.family=="auth")|.outcome' "$T/clients.jsonl" | sort -u) <(printf '%s\n' "$cidxc" | jq -r '.families.auth.outcome_legend|keys[]' | sort -u) | wc -l | tr -d ' ')$(comm -23 <(jq -r 'select(.family=="auth")|.mechanism_kind' "$T/clients.jsonl" | sort -u) <(printf '%s\n' "$cidxc" | jq -r '.families.auth.mechanism_legend|keys[]' | sort -u) | wc -l | tr -d ' ')" "00"
# Non-vacuity floors pinned to what the flavors do: a re-capture that silently changed shape (all 401s, one client) fails here.
chk clientsauthfloors "$(jq -r 'select(.family=="auth" and .flavor=="basic")|.status' "$T/clients.jsonl" | sort -u | tr '\n' ',')|$(jq -r 'select(.family=="auth" and .flavor=="always-401")|.status' "$T/clients.jsonl" | sort -u | tr '\n' ',')|$(jq -r 'select(.family=="auth" and .flavor=="none")|.outcome' "$T/clients.jsonl" | sort -u | tr '\n' ',')|$(jq -r 'select(.family=="auth" and .flavor=="utf8")|.encoding' "$T/clients.jsonl" | sort -u | tr '\n' ',')|$(jq -r 'select(.family=="auth" and .flavor=="digest")|.mechanism_kind' "$T/clients.jsonl" | sort -u | tr '\n' ',')|$(jq -r 'select(.family=="auth" and .flavor=="proxy")|[.status, .last_status_seen]|map(tostring)|join("/")' "$T/clients.jsonl" | sort -u | tr '\n' ',')" "200,|401,|authenticated,refused,|latin1,utf-8,|digest-handler,no-mechanism,|407/null,null/407,"
# Every chain landed on its first attempt; if a re-capture needed a retry, this and the ledger change together.
chk clientsauthattempts "$(jq -r 'select(.family=="auth")|.attempts' "$T/clients.jsonl" | sort | uniq -c | tr -s ' ' | tr -d '\n ')" "1441"
# The last auth finding states how many rows ended in a raise; it must be the count in the rows.
chk clientsauthfinding "$(printf '%s\n' "$cidxc" | jq -r '.families.auth.findings[-1]' | grep -c "^$(jq -r 'select(.family=="auth" and .outcome=="client-raised")|.id' "$T/clients.jsonl" | wc -l | tr -d ' ') of 144 observations")" 1
# The /auth index's witness block is derived from the same rows: date, count, roster, data pointer, and the honesty sentences.
chk authwitness "$(curl -s "$B/auth" | jq -r --arg d "$(jq -r 'select(.family=="auth")|.observed' "$T/clients.jsonl" | sort -u | tr -d '\n')" '[(.witness.measured==$d), (.witness.observations==144), (.witness.clients|length==8), (.witness.findings|length>=10), (.witness.data|test("/clients.jsonl$")), (.witness.what_this_is|test("DATED CAPTURE")), (.witness.what_this_is|test("never a verdict")), (.witness.what_the_oracle_cannot_tell_you|test("hops"))] | join(",")')" "true,true,true,true,true,true,true,true"
# The home page's auth note is rendered from the rows: its date and count must be the rows' date and count.
awd=$(jq -r 'select(.family=="auth")|.observed' "$T/clients.jsonl" | sort -u | tr -d '\n')
chk authwitnesspagedate "$(curl -s "$B/" | grep -c "eight real clients on ${awd%%T*} — 144 observations")" 1
chk clientscors "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$B/clients.jsonl")" 204
chk clientssurfaces "$(curl -s "$B/llms.txt" | grep -c '/clients.jsonl')$(curl -s "$B/" | grep -c 'clients.jsonl')$(curl -s "$B/sitemap.xml" | grep -c '/clients<')" "141"
chk openapiclients "$(curl -s "$B/openapi.json" | jq -r '[(.paths|has("/clients")), (.paths|has("/clients.jsonl"))] | join(",")')" "true,true"
# The one revenue-surface repair of session 19: robots.txt was telling every polite crawler — the
# only population that has ever paid this project — to skip the three routes that can take money.
chk robotspay "$(curl -s "$B/robots.txt" | grep -c '^Allow: /402/pay')" 3

# 402index domain verification: the file must hold exactly the hash 402index issued for this claim,
# and nothing else under /.well-known/ may answer 200. If this fails, the listing loses its verified
# status — re-claim (POST /api/v1/claim) and redeploy with the new hash rather than deleting the check.
chk index402verify "$(curl -s "$B/.well-known/402index-verify.txt" | tr -d '\n') $(curl -s -o /dev/null -w '%{http_code}' "$B/.well-known/nope.txt")" \
  "91c6b02d9fa38bc02d5f825ecad89da50bfeaf67a2a127d72fbc6e7c04ba477f 404"

# corpuslive: replay every corpus row against production with its own method and headers. This is
# the guard for the failure class above — a row that documents an endpoint it does not address.
# Runs last because it is ~140 paced requests; skip with SKIP_CORPUS_VERIFY=1 when iterating.
if [ "${SKIP_CORPUS_VERIFY:-0}" = "1" ]; then
  echo "SKIP corpuslive (SKIP_CORPUS_VERIFY=1)"
else
  chk corpuslive "$(scripts/corpus-verify.sh "$B" >"$T/verify.out" 2>&1 && echo ok || echo "broken: $(grep -c FAIL "$T/verify.out") rows")" ok
  # corpusassert: the ring outside corpuslive. That one proves a row ADDRESSES its endpoint; this one
  # re-derives the row's machine-readable FIELDS from the wire — deterministic_bytes against two
  # identical requests, varies_by where bytes are admitted unstable, the two completeness violators
  # by name, and the published curl string against the row's own url/method/headers. Session 20
  # added it because /range/if-range-ignored had been publishing deterministic_bytes:true while its
  # bytes changed on every request. If it fails: fix the row, never the check.
  # Let the rate-limit window drain: corpuslive has just made ~141 requests and corpusassert makes
  # ~110 more, and the zone allows 100 per 10 s. Without this the two suites shape each other.
  sleep 11
  chk corpusassert "$(scripts/corpus-assert.sh "$B" >"$T/assert.out" 2>&1 && echo ok || echo "lying: $(grep -c FAIL "$T/assert.out") fields")" ok
  grep '^corpus-assert: WARN' "$T/assert.out" 2>/dev/null || true
fi

# --- /crosshost: credentials across a host boundary (session 22) ----------------------------------
# ALT is the second host. These checks assume it resolves; a resolver that has negative-cached it
# (because something asked before the record existed — the zone's SOA minimum is 1800 s) will fail
# them all at once, which looks like a broken deploy and is not. Check `dig alt.badhttp.dev` first.
ALT="https://alt.badhttp.dev"
[ "$B" = "https://badhttp.dev" ] || ALT="$B"   # against a non-production base, fall back to it

chk crosshostindex "$(curl -s "$B/crosshost" | jq -r '[(.flavors|keys|length), (.hosts.alt=="https://alt.badhttp.dev"), (.no_open_redirect|test("frozen table"))] | join(",")')" "9,true,true"
chk crosshosttpl "$(curl -s -o /dev/null -w '%{http_code}' "$B/crosshost/%7Bflavor%7D")" 200

# Every flavor's Location, pinned individually. A count would not catch a target that moved.
chk chsameorigin "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/same-origin")" "302 $B/crosshost/land"
chk chtosub "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/to-subdomain")" "302 https://alt.badhttp.dev/crosshost/land"
chk chfromsub "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$ALT/crosshost/from-subdomain")" "302 $B/crosshost/land"
chk chboomerang "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/boomerang")" "302 https://alt.badhttp.dev/crosshost/boomerang-return"
chk chboomerang2 "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$ALT/crosshost/boomerang-return")" "302 $B/crosshost/land"
chk chdowngrade "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/scheme-downgrade")" "302 http://badhttp.dev/crosshost/land"
chk chupgrade "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://badhttp.dev/crosshost/scheme-upgrade")" "302 https://badhttp.dev/crosshost/land"
chk chjar "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/jar")" "302 https://alt.badhttp.dev/crosshost/land"

chk chportchange "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/crosshost/port-change")" "302 https://badhttp.dev:8443/crosshost/land"
chk chportserves "$(curl -s -o /dev/null -w '%{http_code}' "https://badhttp.dev:8443/crosshost/land")" 200
# The one protocol-relative Location in the family, admitted by exact string equality rather than by
# pattern. A regex that admits the //host shape at all is one mistake away from admitting //evil.
chk chrelauth "$(curl -sI "$B/crosshost/relative-authority" | grep -i '^location:' | tr -d '\r' | awk '{print $2}')" "//alt.badhttp.dev/crosshost/land"
chk chrelauthonly "$(for f in same-origin to-subdomain from-subdomain boomerang scheme-upgrade scheme-downgrade port-change jar; do curl -sI "$B/crosshost/$f" 2>/dev/null | grep -i '^location:' | tr -d '\r' | awk '{print $2}'; done | grep -c '^//')" 0

# NO OPEN REDIRECT, asserted as a property rather than per-flavor: every Location this family can
# emit must name one of the two hosts this project owns. If a future session wires caller input into
# a target, this is what fails. Do not relax it; the allowlist is the whole safety argument.
chk chnoopen "$(for f in same-origin to-subdomain boomerang scheme-downgrade port-change relative-authority jar; do curl -sI "$B/crosshost/$f" | grep -i '^location:' | tr -d '\r' | awk '{print $2}'; done | grep -vcE '^(https?://(badhttp\.dev|alt\.badhttp\.dev)(:8443)?/|//alt\.badhttp\.dev/)')" 0
chk chnoparam "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/crosshost/to-subdomain?url=https://example.com&next=https://example.com&to=https://example.com")" "https://alt.badhttp.dev/crosshost/land"

# The direction and the scheme ARE the measurement, so a flavor started on the wrong host or scheme
# must refuse rather than quietly answer the other flavor's question.
chk chwronghost "$(curl -s -o /dev/null -w '%{http_code}' "$B/crosshost/from-subdomain")" 404
chk chwrongscheme "$(curl -s -o /dev/null -w '%{http_code}' "$B/crosshost/scheme-upgrade")" 404

# NO-ECHO, the family's safety invariant: a credential that arrives must never appear in a response.
# Sentinels are sent in all four reported headers; not one byte of them may come back, and the body
# must still correctly report that something arrived. If this fails, stop and fix it before deploying:
# this family exists to be sent credentials by people testing whether their client leaks them.
# NON-VACUITY MATTERS HERE. The first cut sent these through to-subdomain, where curl correctly
# STRIPS Authorization and Cookie — so the no-echo assertion passed because nothing ever arrived,
# proving nothing at all. It runs through same-origin, the one boundary curl preserves, and the
# companion check below asserts the credentials DID arrive before asserting they were not echoed.
CHECHO="$(curl -s -L -H 'Authorization: Bearer SENTINELAUTHXYZ' -H 'Proxy-Authorization: Basic SENTINELPROXYXYZ' -H 'Cookie: sess=SENTINELCOOKIEXYZ' -H 'X-Api-Key: SENTINELKEYXYZ' "$B/crosshost/same-origin")"
chk chnoechoarrived "$(printf '%s' "$CHECHO" | jq -r '[.received.authorization.present, .received.proxy_authorization.present, .received.cookie.present, .received.x_api_key.present] | join(",")')" "true,true,true,true"
chk chnoecho "$(printf '%s' "$CHECHO" | grep -c 'SENTINEL')" 0
chk chreports "$(printf '%s' "$CHECHO" | jq -r '[.received.authorization.present, .received.authorization.scheme, .received.cookie.present, .received.x_api_key.present, .matches_documented_test_credential.authorization] | join(",")')" "true,bearer,true,true,false"
# And the boundary itself still works: the same sentinels through to-subdomain do NOT reach the far
# host, because curl strips them there. If this ever reports true, either curl changed or the
# family stopped crossing a real boundary.
chk chboundaryreal "$(curl -s -L -H 'Authorization: Bearer SENTINELAUTHXYZ' -H 'Cookie: sess=SENTINELCOOKIEXYZ' "$B/crosshost/to-subdomain" | jq -r '[.landed_on, .received.authorization.present, .received.cookie.present] | join(",")')" "alt.badhttp.dev,false,false"
# matches_documented_test_credential is reported PER CREDENTIAL and must never be one OR'd boolean.
# The first cut ORed all three, so sending only the documented X-Api-Key while the Authorization was
# stripped at the boundary reported "true" — a field saying something untrue about its own response,
# on the endpoint whose entire job is to report truthfully what arrived. null means "did not arrive,
# so no claim". This pins the shape, not just a value.
chk chmatchshape "$(curl -s -L -H 'X-Api-Key: badhttp-key-ok' "$B/crosshost/to-subdomain" | jq -c '[.matches_documented_test_credential.authorization, .matches_documented_test_credential.x_api_key, (.matches_documented_test_credential|type)]')" '[null,true,"object"]'
chk chwarns "$(printf '%s' "$CHECHO" | jq -r '.warning | test("rotate")')" true
# A bare secret sent as the whole header value must not have its first token reflected as a "scheme".
chk chnoscheme "$(curl -s -L -H 'Authorization: SENTINELBARESECRET' "$B/crosshost/same-origin" | jq -r '[.received.authorization.scheme, (.|tostring|test("SENTINEL"))] | join(",")')" "unrecognized (not echoed),false"
# Cookie names are reported only for cookies this server minted; a caller's own names are counted.
chk chcookienames "$(curl -s -L -H 'Cookie: badhttp_hostonly=x; theirsecret=y' "$B/crosshost/same-origin" | jq -c '[.received.cookie.ours, .received.cookie.other_count]')" '[["badhttp_hostonly"],1]'

# The jar flavor sets exactly the two documented cookies, one host-only and one Domain-scoped.
chk chjarcookies "$(curl -sI "$B/crosshost/jar" | grep -ic '^set-cookie: \(badhttp_\|__Host-badhttp_\)')" 3
# __Host- requires Secure, Path=/ and NO Domain attribute; without all three the prefix is invalid and
# a conforming jar rejects the cookie outright, which would silently turn this flavor into a no-op.
chk chjarhostprefix "$(curl -sI "$B/crosshost/jar" | grep -i '^set-cookie: __Host-badhttp_lock' | grep -c 'Secure')$(curl -sI "$B/crosshost/jar" | grep -ic '^set-cookie: __Host-badhttp_lock.*Domain=')" "10"
chk chjardomain "$(curl -sI "$B/crosshost/jar" | grep -ic '^set-cookie: badhttp_domain=.*Domain=badhttp.dev')" 1

# The alt host is a fixture, not a second copy of the site: it serves this family and nothing else,
# and tells crawlers so. A second indexable copy of the catalogue would be an SEO duplicate and would
# make alt.badhttp.dev look like a standalone site rather than the other end of a redirect.
chk chaltrobots "$(curl -s "$ALT/robots.txt" | tr -d '\n')" "User-agent: *Disallow: /"
chk chaltonly "$(curl -s -o /dev/null -w '%{http_code}' "$ALT/books")$(curl -s -o /dev/null -w '%{http_code}' "$ALT/402")$(curl -s -o /dev/null -w '%{http_code}' "$ALT/")" "404404404"
chk chaltnoindex "$(curl -sI "$ALT/books" | grep -ic '^x-robots-tag: noindex')$(curl -sI "$ALT/crosshost/land" | grep -ic '^x-robots-tag: noindex')$(curl -sI "$ALT/health" | grep -ic '^x-robots-tag: noindex')" 111
chk chaltland "$(curl -s "$ALT/crosshost/land" | jq -r .landed_on)" "alt.badhttp.dev"

# The rate-limit discriminator (see the family's edge_note): every badhttp response carries
# x-badhttp-version, so a witness harness can tell a real answer from Cloudflare's 429. If this
# header ever stops being emitted, the family's own instructions for reading it become wrong.
chk chversionhdr "$(curl -s -I "$B/crosshost/land" | grep -ic '^x-badhttp-version')" 1
chk chedgenote "$(curl -s "$B/crosshost/land" | jq -r '.edge_note | test("x-badhttp-version")')" true
# The landing endpoint must never say a plaintext hop was encrypted.
chk chplaintext "$(curl -s "http://badhttp.dev/crosshost/land" | jq -r .transport_was_encrypted)" false

# RFC 9116 security.txt, and the honesty repair: the site said "Redirects only ever point back at
# this host" until this family made that false. Both surfaces must now state the allowlist instead.
chk securitytxt "$(curl -s "$B/.well-known/security.txt" | grep -c '^Contact: mailto:ops@badhttp.dev')$(curl -s -o /dev/null -w '%{http_code}' "$B/.well-known/security.txt")" "1200"
chk chclaimfixed "$(curl -s "$B/llms.txt" | grep -c 'Redirects only ever point back at this host')$(curl -s "$B/llms.txt" | grep -c 'fixed table of two hosts')" "01"
chk chsurfaces "$(curl -s "$B/llms.txt" | grep -qc '/crosshost' && echo y)$(curl -s "$B/" | grep -q 'crosshost' && echo y)$(curl -s "$B/sitemap.xml" | grep -q '/crosshost<' && echo y)" "yyy"
# The witness table is a DATED CAPTURE and must say so on the surface a reader lands on. If the date
# moves without the measurement being re-run, this is the check that should have caught it.
# The witness block on /crosshost is derived from the same capture as /clients.jsonl: one date across all rows, 72 rows,
# roster of 8, findings present. Within one deploy the date cannot disagree with the rows, so this does not catch a hand-edited
# date on its own; the home-page pin two lines down does that, because the note there is typed by hand.
chk chwitness "$(curl -s "$B/crosshost" | jq -r --arg d "$(jq -r 'select(.family=="crosshost")|.observed' "$T/clients.jsonl" | sort -u | tr -d '\n')" '[(.witness.measured==$d), (.witness.observations), (.witness.clients|length), (.witness.findings|length >= 8), (.witness.data|test("/clients.jsonl$")), (.witness.what_this_is|test("DATED CAPTURE")), (.witness.what_this_is|test("never a verdict")), (.witness.what_the_oracle_cannot_tell_you|test("unverifiable"))] | join(",")')" "true,72,8,true,true,true,true,true"
chwd=$(jq -r 'select(.family=="crosshost")|.observed' "$T/clients.jsonl" | sort -u | tr -d '\n'); chwn=$(jq -r 'select(.family=="crosshost")|.id' "$T/clients.jsonl" | wc -l | tr -d ' '); chwh=$(curl -s "$B/")
chk chwitnesspagedate "$(printf '%s' "$chwh" | grep -c "eight real clients on ${chwd%%T*} — $chwn observations")$(printf '%s' "$chwh" | grep -c "arrived intact in all $chwn</strong>")$(printf '%s' "$chwh" | grep -c "every row of the ${chwd%%T*} capture records <code>attempts: 1</code>")" 111
chk chaltwitnessdata "$(curl -s "$ALT/crosshost" | jq -r .witness.data)" "https://badhttp.dev/clients.jsonl"
chk booksalthost "$(curl -s "$B/books.json" | jq -r '[(.infrastructure|length), (.infrastructure[0].cost_usd==0), (.infrastructure[0].item|test("alt.badhttp.dev"))] | join(",")')" "1,true,true"
# One "dated capture" sentence per family whose witness note is on the page: crosshost and auth (the compress note predates the phrase).
chk chwitnesspage "$(curl -s "$B/" | grep -c 'dated capture')" 2
# The oracle reports the port, because one flavor's entire subject is a port change and hostname omits it.
chk chport "$(curl -s "$B/crosshost/land" | jq -r .port)$(curl -s "https://badhttp.dev:8443/crosshost/land" | jq -r .port)" "4438443"
chk openapicrosshost "$(curl -s "$B/openapi.json" | jq -r '[(.paths|has("/crosshost")), (.paths|has("/crosshost/land")), (.paths["/crosshost/{flavor}"].get.parameters[0].schema.enum|length==9)] | join(",")')" "true,true,true"

echo "PASS=$pass FAIL=$fail"; rm -rf "$T"; [ $fail -eq 0 ]

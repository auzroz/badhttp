#!/bin/bash
# curl witness for /crosshost. One JSON line per flavor on stdout; progress on stderr.
# Sends the family's PUBLISHED FAKE test values only. On the `jar` flavor the hand-set Cookie header is
# omitted and curl's cookie engine is enabled (-b '') so the jar, not the header, is what is measured.
# A final response without x-badhttp-version is Cloudflare's rate-limit page, not an observation: it is
# retried after a pause, and recorded as an error only if it never clears.
set -u
B="${1:-https://badhttp.dev}"
BASIC='Basic YWdlbnQ6Y29ycmVjdA=='; APIKEY='badhttp-key-ok'; COOKIE='badhttp_witness=1'
VER=$(curl --version | head -1 | awk '{print $2}')
PLAT=$(curl --version | head -1 | awk '{print $3}' | tr -d '()')
IDX=$(curl -sS "$B/crosshost")
echo "$IDX" | jq -c '.flavors | to_entries[] | {flavor: .key, url: .value.url}' | while read -r row; do
  f=$(echo "$row" | jq -r .flavor); u=$(echo "$row" | jq -r .url)
  for attempt in 1 2 3; do
    T=$(mktemp)
    if [ "$f" = jar ]; then
      out=$(curl -sS -L --max-redirs 5 -b '' -H "Authorization: $BASIC" -H "X-Api-Key: $APIKEY" -D "$T" -w '\n%{http_code} %{num_redirects} %{url_effective}' "$u" 2>/dev/null); rc=$?
      sent='{"authorization":"Basic (documented test value)","cookie":null,"x_api_key":"documented test value","jar":"enabled: -b \"\" (cookie engine on, empty jar)"}'
    else
      out=$(curl -sS -L --max-redirs 5 -H "Authorization: $BASIC" -H "Cookie: $COOKIE" -H "X-Api-Key: $APIKEY" -D "$T" -w '\n%{http_code} %{num_redirects} %{url_effective}' "$u" 2>/dev/null); rc=$?
      sent='{"authorization":"Basic (documented test value)","cookie":"badhttp_witness=1","x_api_key":"documented test value","jar":"not enabled"}'
    fi
    body=$(printf '%s\n' "$out" | sed '$d'); tail=$(printf '%s\n' "$out" | tail -1)
    code=$(echo "$tail" | awk '{print $1}'); hops=$(echo "$tail" | awk '{print $2}'); eff=$(echo "$tail" | awk '{print $3}')
    vh=$(tr -d '\r' < "$T" | awk 'BEGIN{RS=""} {b=$0} END{print b}' | grep -i '^x-badhttp-version:' | awk '{print $2}')
    rm -f "$T"
    if [ -n "$vh" ] && printf '%s' "$body" | jq -e .landed_on >/dev/null 2>&1; then
      printf '%s' "$body" | jq -c --arg c curl --arg v "$VER" --arg p "$PLAT" --arg f "$f" --arg u "$u" --argjson s "$sent" --arg code "$code" --arg hops "$hops" --arg eff "$eff" --arg vh "$vh" --arg rc "$rc" --arg attempt "$attempt" \
        '{client:$c, client_version:$v, platform:$p, invocation:"curl -L --max-redirs 5", flavor:$f, start_url:$u, sent:$s, attempts:($attempt|tonumber), final_status:($code|tonumber), hops_followed:($hops|tonumber), final_url:$eff, landed_on, port, scheme, transport_was_encrypted, received, matches: .matches_documented_test_credential, version_header:$vh, client_error:(if $rc=="0" then null else ("curl exit " + $rc) end)}'
      echo "curl $f ok" >&2; break
    fi
    if [ "$attempt" = 3 ]; then
      jq -nc --arg c curl --arg v "$VER" --arg p "$PLAT" --arg f "$f" --arg u "$u" --argjson s "$sent" --arg code "$code" --arg rc "$rc" --arg body "$(printf '%s' "$body" | head -c 160)" \
        '{client:$c, client_version:$v, platform:$p, invocation:"curl -L --max-redirs 5", flavor:$f, start_url:$u, sent:$s, attempts:3, final_status:(if $code=="000" then null else (try ($code|tonumber) catch null) end), hops_followed:null, final_url:null, landed_on:null, received:null, version_header:null, client_error:("curl exit "+$rc+"; not an oracle response: "+$body)}'
      echo "curl $f FAILED after 3 attempts" >&2
    else
      echo "curl $f: no oracle response (edge?), retrying" >&2; sleep 12
    fi
  done
  sleep 1.2
done

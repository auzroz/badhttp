#!/bin/bash
# curl witness for /auth. One JSON line per flavor on stdout; progress on stderr.
# Hands curl the family's PUBLISHED FAKE credentials through curl's own mechanism for the flavor's scheme:
#   -u user:pass         basic-auth     curl's own Basic option; curl sends it on its first request
#   --anyauth -u         any-handler    curl reads the challenge and picks among the schemes it speaks: the
#                                       challenge-parser flavors (bare-scheme, unknown-scheme, token68, case, quoted, multi)
#   --digest -u          digest-handler digest, digest-sha256, stale
#   --oauth2-bearer TOK  bearer-auth    curl's own Bearer option
# -L follows the one flavor that redirects. Every request curl sends appears as a "> METHOD path HTTP/x" line
# under -v, auth retries included, which is how requests_made is counted (redirects are counted from the 3xx
# status lines in the header dump, because %{num_redirects} also counts the re-request after a 401). A final response without
# x-badhttp-version is Cloudflare's rate-limit page, not an observation: retried after a pause, recorded as an
# error only if it never clears.
set -u
B="${1:-https://badhttp.dev}"
VER=$(curl --version | head -1 | awk '{print $2}')
PLAT=$(curl --version | head -1 | awk '{print $3}' | tr -d '()')
# AUTH_FLAVORS="basic digest" limits a dry run; a published capture always runs the full list.
FLAVORS="${AUTH_FLAVORS:-basic bearer digest digest-sha256 none bare-scheme unknown-scheme token68 multi case quoted utf8 always-401 accept-any forbidden stale proxy redirect}"
for f in $FLAVORS; do
  u="$B/auth/$f"
  case "$f" in
    digest|digest-sha256|stale) args=(--digest -u agent:correct); kind=digest-handler; mech='--digest -u (the documented credentials): curl'"'"'s Digest mechanism, which answers a Digest challenge' ;;
    multi|bare-scheme|unknown-scheme|token68|case|quoted) args=(--anyauth -u agent:correct); kind=any-handler; mech='--anyauth -u (the documented credentials): curl reads the challenge and picks among the schemes it speaks (Basic, Digest, NTLM, Negotiate)' ;;
    bearer) args=(--oauth2-bearer badhttp-token-ok); kind=bearer-auth; mech='--oauth2-bearer (the documented test token): curl'"'"'s own Bearer option' ;;
    utf8) args=(-u "$(printf 'agent:s\xc3\xa9same')"); kind=basic-auth; mech='-u with the documented utf8 credentials passed as UTF-8 bytes (locale-independent): curl base64-encodes the argv bytes as received' ;;
    proxy) args=(-u agent:correct); kind=basic-auth; mech='-u (the documented credentials, as ORIGIN credentials): no proxy exists in the harness and no proxy credentials were configured; this flavor reads only Proxy-Authorization' ;;
    *) args=(-u agent:correct); kind=basic-auth; mech='-u (the documented credentials): curl'"'"'s own Basic option' ;;
  esac
  for attempt in 1 2 3; do
    H=$(mktemp); TR=$(mktemp); BODY=$(mktemp)
    tail=$(curl -sS -v -L --max-redirs 5 --max-time 30 "${args[@]}" -D "$H" -o "$BODY" -w '%{http_code} %{num_redirects} %{url_effective}' "$u" 2>"$TR"); rc=$?
    code=$(echo "$tail" | awk '{print $1}')
    # After a followed redirect curl's %{url_effective} embeds user:pass@ — strip it here, never record it.
    eff=$(echo "$tail" | awk '{print $3}' | sed -E 's#^([a-z]+://)[^/@]+@#\1#')
    reqs=$(grep -cE '^> (GET|POST|HEAD|PUT) ' "$TR")
    # Per request curl sent: whether it carried Authorization / Proxy-Authorization (presence only; the trace holds the
    # values and is deleted below). Each "> METHOD" line opens a hop; the header lines that follow belong to it.
    hops_json=$(awk 'function flush(){ if(n) print a" "p" "st } /^> (GET|POST|HEAD|PUT) /{flush(); n++; a=0; p=0; st="null"; next} tolower($0) ~ /^> authorization:/{a=1} tolower($0) ~ /^> proxy-authorization:/{p=1} /^< HTTP\/[0-9.]+ [0-9][0-9][0-9]/{st=$3} END{flush()}' "$TR" | jq -Rnc '[inputs | select(length>0) | split(" ") | {status: (if .[2]=="null" then null else (.[2]|tonumber) end), authorization: (.[0]=="1"), proxy_authorization: (.[1]=="1")}]')
    # %{num_redirects} also counts curl's credentialed re-request after a 401, so redirects are counted as 3xx status lines instead.
    hops=$(tr -d '\r' < "$H" | grep -cE '^HTTP/[0-9.]+ 3[0-9][0-9]')
    last=$(tr -d '\r' < "$H" | awk 'BEGIN{RS=""} {b=$0} END{print b}')
    vh=$(printf '%s\n' "$last" | grep -i '^x-badhttp-version:' | awk '{print $2}')
    chal=$(printf '%s\n' "$last" | grep -i '^www-authenticate:\|^proxy-authenticate:' | head -1 | sed 's/^[^:]*: //')
    body=$(cat "$BODY")
    rm -f "$H" "$TR" "$BODY"
    if [ -n "$vh" ] && printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
      printf '%s' "$body" | jq -c --arg c curl --arg v "$VER" --arg p "$PLAT" --arg f "$f" --arg u "$u" --arg kind "$kind" --arg mech "$mech" --arg code "$code" --arg hops "$hops" --arg eff "$eff" --arg vh "$vh" --arg rc "$rc" --arg reqs "$reqs" --arg attempt "$attempt" --arg chal "$chal" --argjson hopsj "$hops_json" \
        '{client:"curl", client_version:$v, platform:$p, invocation:"curl -sS -v -L --max-redirs 5 --max-time 30 <mechanism> URL", flavor:$f, url:$u, mechanism_kind:$kind, mechanism:$mech, attempts:($attempt|tonumber), requests_made:($reqs|tonumber), hops:$hopsj, final_status:($code|tonumber), redirects_followed:($hops|tonumber), final_url:$eff, challenge_seen:(if $chal=="" then null else $chal end), oracle:(del(.warning, .hint, .credentials)), version_header:$vh, client_error:(if $rc=="0" then null else ("curl exit " + $rc) end)}'
      echo "curl $f ok" >&2; break
    fi
    if [ "$attempt" = 3 ]; then
      jq -nc --arg v "$VER" --arg p "$PLAT" --arg f "$f" --arg u "$u" --arg kind "$kind" --arg mech "$mech" --arg code "$code" --arg rc "$rc" --arg reqs "$reqs" \
        '{client:"curl", client_version:$v, platform:$p, invocation:"curl -sS -v -L --max-redirs 5 --max-time 30 <mechanism> URL", flavor:$f, url:$u, mechanism_kind:$kind, mechanism:$mech, attempts:3, requests_made:($reqs|tonumber), final_status:(if $code=="000" then null else (try ($code|tonumber) catch null) end), redirects_followed:null, final_url:null, challenge_seen:null, oracle:null, version_header:null, client_error:("curl exit "+$rc+"; not an oracle response after 3 attempts")}'
      echo "curl $f FAILED after 3 attempts" >&2
    else
      echo "curl $f: no oracle response (edge?), retrying" >&2; sleep 12
    fi
  done
  sleep 1.2
done

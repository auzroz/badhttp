#!/bin/bash
# curl witness for /cookies. One JSON line per flavor on stdout; progress on stderr.
# Per flavor, with a FRESH Netscape jar file (-c jar -b jar, the one file for all four requests):
#   1. GET /cookies/{flavor}  (-L --max-redirs 5: only on-redirect redirects)
#   2. GET /cookies/echo      what the jar sent back
#   3. GET /cookies/delete    the cleanup
#   4. GET /cookies/echo      what survived the cleanup
# 0.2 s between requests. hops and set_cookie_count are read from the "< HTTP/x NNN" and "< set-cookie:" lines of
# -v (one HTTP status line per hop, redirects included; HTTP/2 lowercases header names, so matched case-insensitively).
# jar_entries is the Netscape jar file parsed right after step 1. A response without x-badhttp-version is the edge's
# 429, not an observation: the whole flavor is retried after a pause (attempts <= 3).
#
#   bash scripts/cookies-witness/curl.sh [base]        COOKIE_FLAVORS="ok on-redirect" limits a dry run
set -u
B="${1:-https://badhttp.dev}"
VER=$(curl --version | head -1 | awk '{print $2}')
PLAT=$(curl --version | head -1 | awk '{print $3}' | tr -d '()')
INV='curl -q -sS -v -L --max-redirs 5 --max-time 30 -c JAR -b JAR URL (fresh jar file per flavor; steps 2-4 without -L)'
JARDESC="curl's own cookie engine: a fresh Netscape-format jar file per flavor, read (-b) and written (-c) on all four requests"
FLAVORS="${COOKIE_FLAVORS:-ok folded many duplicate on-redirect conflicting-expiry bad-expires far-future wrong-domain public-suffix domain path-prefix name-prefixes quoted utf8 nameless huge}"

# step N URL FOLLOW(1|0): sets code, rc, vh; trace in $D/tN, body in $D/bN
step() {
  local fl=""
  [ "$3" = 1 ] && fl="-L --max-redirs 5"
  code=$(curl -q -sS -v $fl --max-time 30 -c "$D/jar" -b "$D/jar" -o "$D/b$1" -w '%{http_code}' "$2" 2>"$D/t$1"); rc=$?
  vh=$(tr -d '\r' < "$D/t$1" | grep -i '^< x-badhttp-version:' | tail -1 | awk '{print $3}')
}

for f in $FLAVORS; do
  u="$B/cookies/$f"
  for attempt in 1 2 3; do
    D=$(mktemp -d); : > "$D/jar"
    fail=""; lastseen="null"; hops_json='[]'; entries_json='null'; vh_last=""
    codes=(0 0 0 0)
    for n in 1 2 3 4; do
      case $n in
        1) su="$u"; fol=1 ;;
        2|4) su="$B/cookies/echo"; fol=0 ;;
        3) su="$B/cookies/delete"; fol=0 ;;
      esac
      step $n "$su" $fol
      if [ $n = 1 ]; then
        # one hop per HTTP status line; set-cookie lines counted into the hop they arrived on
        hops_json=$(tr -d '\r' < "$D/t1" | awk 'function flush(){ if(open) print st" "c } /^< HTTP\/[0-9.]+ [0-9][0-9][0-9]/{flush(); open=1; st=$3; c=0; next} tolower($0) ~ /^< set-cookie:/{c++} END{flush()}' | jq -Rnc '[inputs | select(length>0) | split(" ") | {status: (.[0]|tonumber), set_cookie_count: (.[1]|tonumber)}]')
        # the jar as curl wrote it after step 1 (before step 2 rewrites it)
        entries_json=$(LC_ALL=C jq -Rnc '[inputs | select(length>0) | select((startswith("#") and (startswith("#HttpOnly_")|not))|not) | split("\t") | select(length>=6) | {name: .[5], domain: (.[0] | sub("^#HttpOnly_";"")), path: .[2], host_only: (.[1]=="FALSE"), secure: (.[3]=="TRUE"), expires: ((.[4]|tonumber) as $e | if $e==0 then "session" else ($e|todate) end), value_bytes: ((.[6] // "")|utf8bytelength)}]' < "$D/jar" 2>/dev/null) || entries_json='null'
        [ -z "$entries_json" ] && entries_json='null'
      fi
      if [ "$rc" != 0 ]; then fail="transport"; break; fi
      codes[$((n-1))]=$code; lastseen=$((10#$code)); vh_last="$vh"
      if [ -z "$vh" ] || ! jq -e . "$D/b$n" >/dev/null 2>&1; then fail="edge"; break; fi
      [ $n -lt 4 ] && sleep 0.2
    done

    if [ -z "$fail" ]; then
      if [ "$f" = on-redirect ]; then setj='null'; else setj=$(jq -c '.set // null' "$D/b1"); fi
      echoj=$(jq -c --arg st "${codes[1]}" '{status: ($st|tonumber), cookie_header_bytes: ((.cookie_header // "")|utf8bytelength), cookies: [(.cookies // [])[] | {name: .[0], value_bytes: (.[1]|utf8bytelength), value: (if (.[1]|utf8bytelength) <= 48 then .[1] else null end)}], cookie_header_base64: (if .cookie_header == null then null elif (.cookie_header|utf8bytelength) <= 256 then .cookie_header_base64 else null end)}' "$D/b2")
      afterj=$(jq -c --arg st4 "${codes[3]}" '{status: ($st4|tonumber), names: [(.cookies // [])[] | .[0]]}' "$D/b4")
      jq -nc --arg rc_ver "$VER" --arg rc_plat "$PLAT" --arg rc_inv "$INV" --arg rc_f "$f" --arg rc_u "$u" --arg rc_jar "$JARDESC" \
        --arg rc_att "$attempt" --arg rc_st1 "${codes[0]}" --arg rc_vh "$vh_last" \
        --argjson rc_hops "$hops_json" --argjson rc_set "$setj" --argjson rc_echo "$echoj" --argjson rc_after "$afterj" --argjson rc_ent "$entries_json" --argjson rc_last "$lastseen" \
        '{client:"curl", client_version:$rc_ver, platform:$rc_plat, invocation:$rc_inv, flavor:$rc_f, url:$rc_u, jar_kind:"own-jar", jar:$rc_jar, attempts:($rc_att|tonumber), hops:$rc_hops, setter_status:($rc_st1|tonumber), setter_set:$rc_set, echo:$rc_echo, after_delete:$rc_after, jar_enumerable:true, jar_entries:$rc_ent, jar_rejections:[], version_header:$rc_vh, client_error:null, error_kind:null, last_status_seen:$rc_last}'
      rm -rf "$D"
      echo "curl $f ok" >&2; break
    fi

    if [ "$fail" = transport ]; then emsg="curl exit $rc"; ekind='"transport"'; else emsg="not a badhttp response after 3 attempts (last status $lastseen)"; ekind='null'; fi
    rm -rf "$D"
    if [ "$attempt" = 3 ]; then
      jq -nc --arg rc_ver "$VER" --arg rc_plat "$PLAT" --arg rc_inv "$INV" --arg rc_f "$f" --arg rc_u "$u" --arg rc_jar "$JARDESC" --arg rc_msg "$emsg" \
        --argjson rc_hops "$hops_json" --argjson rc_ekind "$ekind" --argjson rc_last "$lastseen" \
        '{client:"curl", client_version:$rc_ver, platform:$rc_plat, invocation:$rc_inv, flavor:$rc_f, url:$rc_u, jar_kind:"own-jar", jar:$rc_jar, attempts:3, hops:$rc_hops, setter_status:null, setter_set:null, echo:null, after_delete:null, jar_enumerable:true, jar_entries:null, jar_rejections:[], version_header:null, client_error:$rc_msg, error_kind:$rc_ekind, last_status_seen:$rc_last}'
      echo "curl $f FAILED after 3 attempts" >&2
    else
      echo "curl $f: no badhttp response (edge?), retrying" >&2; sleep 12
    fi
  done
  sleep 0.2
done

#!/bin/bash
# The raw-wire CONTROL for the /sse witness capture (docs/spec-sse-witness.md): curl receives each flavor's body
# byte-for-byte with no SSE parsing at all (transfer decoding applied: NOT --raw, which would keep the HTTP/1.1 chunk
# framing in the bytes — the first capture did that and the parser's floors refused it), and the parser (scripts/witness-parse-sse.mjs) derives the reference
# WHATWG parse from these bytes. One JSON line per flavor on stdout; progress on stderr.
#   bash scripts/sse-witness/curl.sh [base]           SSE_FLAVORS="ok cut" limits a dry run
# A first response without x-badhttp-version is Cloudflare's rate limit, not an observation: retried after 12 s,
# attempts <= 3. curl exit codes: 0 clean close, 18 "transfer closed with outstanding read data" (the reset on
# drop), 28 the --max-time cap (recorded as harness-timeout), 56 a receive failure.
set -u
B="${1:-https://badhttp.dev}"
ALL="ok stall cut drop crlf cr no-space multiline comments split-utf8 wrong-type error-event big resume"
FLAVORS="${SSE_FLAVORS:-$ALL}"
T=$(mktemp -d)
VER=$(curl -sS --version | head -1 | awk '{print $2}')
PLAT=$(curl -sS --version | head -1 | awk '{print $3}')
INVOCATION='curl -sS -N --http1.1 --max-time 30 -D headers -o body URL (no SSE parsing; the de-chunked body bytes are the observation)'

for f in $FLAVORS; do
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    : > "$T/h"; : > "$T/b"
    start=$(python3 -c 'import time; print(int(time.time()*1000))')
    curl -sS -N --http1.1 --max-time 30 -D "$T/h" -o "$T/b" "$B/sse/$f" 2> "$T/err"
    rc=$?
    end=$(python3 -c 'import time; print(int(time.time()*1000))')
    status=$(tr -d '\r' < "$T/h" | awk 'NR==1{print $2}')
    ctype=$(tr -d '\r' < "$T/h" | awk 'tolower($1)=="content-type:"{sub(/^[^:]*: */,""); print; exit}')
    xflavor=$(tr -d '\r' < "$T/h" | awk 'tolower($1)=="x-badhttp-flavor:"{print $2; exit}')
    xver=$(tr -d '\r' < "$T/h" | awk 'tolower($1)=="x-badhttp-version:"{print $2; exit}')
    if [ -z "$xver" ] && [ $attempt -lt 3 ]; then echo "curl $f: no x-badhttp-version (status ${status:-none}); retrying after 12 s" >&2; sleep 12; continue; fi
    break
  done
  bytes=$(wc -c < "$T/b" | tr -d ' ')
  sha=$(shasum -a 256 "$T/b" | awk '{print $1}')
  b64=$(base64 < "$T/b" | tr -d '\n')
  case $rc in
    0) ended=server-closed; endv=clean; err=null ;;
    18) ended=reset; endv=error; err='"curl exit 18: transfer closed with outstanding read data remaining"' ;;
    28) ended=harness-timeout; endv=harness-timeout; err='"curl exit 28: --max-time 30 reached"' ;;
    *) ended=error; endv=error; err="\"curl exit $rc: $(head -c 160 "$T/err" | tr -d '\n"' )\"" ;;
  esac
  jq -nc --arg f "$f" --arg b "$B" --arg ver "$VER" --arg plat "$PLAT" --arg inv "$INVOCATION" --arg probed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg xver "$xver" --arg status "${status:-0}" --arg ctype "$ctype" --arg xflavor "$xflavor" --arg ended "$ended" --arg endv "$endv" --argjson err "$err" \
    --argjson attempts "$attempt" --argjson wall "$((end - start))" --argjson bytes "$bytes" --arg sha "$sha" --arg b64 "$b64" --argjson rc "$rc" '
    { family: "sse", id: ("sse." + $f + ".curl"), corpus_id: ("sse." + $f), url: ($b + "/sse/" + $f), method: "GET", flavor: $f, probed: $probed,
      badhttp_version: $xver,
      client: { id: "curl", name: "curl", role: "control", class: "raw", version: $ver, library: "curl (libcurl), raw bytes, no SSE parser", platform: $plat, invocation: $inv, connections_counted_by: "one curl invocation is one connection" },
      attempts: $attempts,
      connections: [ { n: 1, status: ($status|tonumber), content_type: $ctype, x_badhttp_flavor: $xflavor, x_badhttp_version: $xver, last_event_id_sent: null, ended: $ended, error: $err } ],
      events: [], events_delivered: null, errors: (if $err == null then [] else [ { message: $err, had_data: false, ready_state_after: null } ] end),
      end: $endv, retry_ms_adopted: null, last_event_id_final: null, wall_ms: $wall,
      control: { raw_base64: $b64, raw_bytes: $bytes, raw_sha256: $sha, curl_exit: $rc } }'
  echo "curl $f: status ${status:-none} exit $rc bytes $bytes ok" >&2
  sleep 1
done
rm -rf "$T"

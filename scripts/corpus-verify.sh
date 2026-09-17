#!/usr/bin/env bash
# Replay every row of /corpus.jsonl against a running badhttp and prove the row addresses a real
# endpoint: same url, same method, same request_headers the row publishes.
#
#   scripts/corpus-verify.sh [base]        # default https://badhttp.dev
#
# Why this exists (session 19, 2026-09-07). /corpus.jsonl is the file this project tells strangers
# to consume, and seven of its 138 rows did not do what they said: GET /echo answered 405, /delay
# and /flaky answered 400 for want of a required path segment, the /status row's url was a template
# that 400s when fetched, /compress/br and /compress/zstd carried an Accept-Encoding under which the
# edge decodes the very coding the row is about, and the whole /redirect family was missing. Each of
# those was one line of prose away from looking correct. Only replaying them finds it.
#
# The assertion is deliberately narrow: no row may answer 400, 404 or 405. It is NOT "every row
# returns 2xx" — this is a server that misbehaves on purpose, so 401 on /auth, 402 on /402, 416 on
# /range and 418 on /status are all correct answers. 400/404/405 mean something different: the row
# does not address the endpoint it claims to. That is the failure class this guards.
#
# Pacing: the zone rate limit is 100 requests / 10 s per IP, so requests are spaced ~8/s. A row that
# streams (sse, drip, delay) is cut by --max-time; curl still reports the status once the head has
# arrived, which is all this checks. 000 means no head arrived at all, and fails.
set -u

B="${1:-https://badhttp.dev}"
MAXTIME="${CORPUS_VERIFY_MAXTIME:-6}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sS -m 30 "$B/corpus.jsonl" -o "$TMP/corpus.jsonl" || { echo "corpus-verify: cannot fetch $B/corpus.jsonl"; exit 1; }
ROWS=$(wc -l < "$TMP/corpus.jsonl" | tr -d ' ')
[ "$ROWS" -gt 0 ] || { echo "corpus-verify: corpus is empty"; exit 1; }

# id \t method \t url \t h1: v1 \t h2: v2 ...
jq -r '[.id, .method, .url] + ((.request_headers // {}) | to_entries | map("\(.key): \(.value)")) | @tsv' \
  "$TMP/corpus.jsonl" > "$TMP/plan.tsv"

pass=0; fail=0
: > "$TMP/failures"

while IFS=$'\t' read -r id method url h1 h2 h3; do
  set -- -sS -o /dev/null -m "$MAXTIME" -w '%{http_code}' -X "$method"
  for h in "$h1" "$h2" "$h3"; do
    [ -n "${h:-}" ] && set -- "$@" -H "$h"
  done
  # --globoff so a row whose url legitimately contains braces is fetched, not glob-expanded.
  code=$(curl -g "$@" "$url" 2>/dev/null)
  case "$code" in
    400|404|405|000)
      fail=$((fail+1))
      printf '  FAIL %-22s %-4s %s -> %s\n' "$id" "$method" "$url" "$code" >> "$TMP/failures"
      ;;
    *) pass=$((pass+1)) ;;
  esac
  sleep 0.12
done < "$TMP/plan.tsv"

echo "corpus-verify: $pass ok, $fail broken, of $ROWS rows against $B"
if [ "$fail" -gt 0 ]; then
  cat "$TMP/failures"
  echo "corpus-verify: a row does not address the endpoint it publishes (400/404/405), or never answered (000)."
  exit 1
fi
exit 0

#!/usr/bin/env bash
# Re-derive /corpus.jsonl's machine-readable FIELDS from the wire and fail if one of them lies.
#
#   scripts/corpus-assert.sh [base]        # default https://badhttp.dev
#
# Why this exists (session 20, 2026-09-08). Session 19 built scripts/corpus-verify.sh, which
# replays every row and proves it ADDRESSES a real endpoint (no 400/404/405). That caught seven
# rows whose url, method or headers were wrong. It checks nothing else — and one ring further out,
# a field was lying: /range/if-range-ignored published `deterministic_bytes: true` while it mints a
# fresh generation stamp on every single request, so its bytes move every time. Its own `defect`
# string ended "Nondeterministic by design". The corpus index tells consumers the field means "the
# same request returns the same body bytes", so a harness following the published contract would
# pin a digest and be broken by the very next fetch, and would blame itself.
#
# The structural cause is what makes this worth wiring into the deploy rather than fixing by hand:
# src/corpus.js read `deterministic_bytes` from FAMILY metadata with no per-flavor override, so no
# flavor could differ from its family and the generator could not express the truth about one that
# did — all sixteen families had a uniform value, which is how you can tell no flavor ever could.
# The fix (FLAVOR_STABILITY) lets a flavor tell the truth (range is now the one family that is not
# uniform: thirteen flavors true, if-range-ignored false). This script is what stops the next family
# from shipping the same lie, by making a false field fail the build instead of waiting for a
# stranger to notice.
#
# What it asserts, and deliberately what it does not:
#   (a) every row claiming deterministic_bytes:true returns IDENTICAL body bytes to two identical
#       requests. This is the field's published contract, verbatim.
#   (b) every row claiming deterministic_bytes:false names something in varies_by. If the bytes are
#       not stable, the row owes the reader what moves them. (The converse is NOT asserted: the
#       published contract allows varies_by to be non-empty on a stable row — the /range and
#       /compress rows say "vary the Range (or the Accept-Encoding) and the bytes change; repeat the
#       same request and they do not", which is true.)
#   (c) exactly two rows carry rfc9112_completeness_violation, and they are the two the site names
#       in prose. Asserted statically against the wire's own row set — the live short-read is
#       already pinned by the existing `truncate` and `ssedrop` smoke checks.
#   (d) the published `curl` string reconstructs exactly from the row's own url, method and
#       request_headers, so the copy-paste command can never drift from the row it belongs to.
#
# It does NOT assert that bytes stay stable over weeks, and it cannot: two fetches seconds apart
# cannot see a body that turns over hourly or at midnight UTC. It also does not assert that
# varies_by is EXHAUSTIVE — only that it is non-empty where the row admits instability. Both limits
# are stated on /corpus in the self_check block rather than glossed.
#
# Flakiness is the one thing that would make this worse than useless: a gate that fails at random
# gets weakened by a future session and then the ring is gone. So a byte mismatch is confirmed with
# a second independent pair before it fails. A genuinely nondeterministic row differs every time and
# fails both pairs; a one-off truncated transfer almost never repeats. Pacing is ~7 req/s, under the
# zone's 100 requests / 10 s.
set -u

B="${1:-https://badhttp.dev}"
MAXTIME="${CORPUS_ASSERT_MAXTIME:-8}"
# ~5 req/s. Deliberately slower than corpus-verify.sh, because this script runs immediately after it
# in the smoke suite and the two together must stay under the zone's 100 requests / 10 s.
PACE="${CORPUS_ASSERT_PACE:-0.2}"
throttled=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sS -m 30 "$B/corpus.jsonl" -o "$TMP/corpus.jsonl" || { echo "corpus-assert: cannot fetch $B/corpus.jsonl"; exit 1; }
ROWS=$(wc -l < "$TMP/corpus.jsonl" | tr -d ' ')
[ "$ROWS" -gt 0 ] || { echo "corpus-assert: corpus is empty"; exit 1; }

# Every assertion below is a jq filter that emits offending ids. If jq cannot PARSE the file it emits
# nothing, every filter finds no offenders, and the gate goes green having checked nothing at all —
# the worst failure mode a deploy gate has. So the file is validated first, and the count of rows jq
# can actually read must equal the number of lines fetched.
PARSED=$(jq -s 'length' "$TMP/corpus.jsonl" 2>"$TMP/jqerr") || {
  echo "corpus-assert: /corpus.jsonl is not valid NDJSON — jq: $(head -c 200 "$TMP/jqerr")"; exit 1; }
[ "$PARSED" = "$ROWS" ] || { echo "corpus-assert: $ROWS lines fetched but jq parsed $PARSED rows"; exit 1; }
IDS=$(jq -r 'select(.id != null and .id != "") | .id' "$TMP/corpus.jsonl" | wc -l | tr -d ' ')
[ "$IDS" = "$ROWS" ] || { echo "corpus-assert: $ROWS rows but only $IDS carry an id"; exit 1; }

fail=0
: > "$TMP/failures"
note() { fail=$((fail+1)); printf '  FAIL %s\n' "$1" >> "$TMP/failures"; }

# ---------------------------------------------------------------- (b) false => varies_by non-empty
while IFS= read -r id; do
  [ -n "$id" ] && note "(b) $id: deterministic_bytes false but varies_by is empty — say what moves the bytes"
done < <(jq -r 'select(.deterministic_bytes == false) | select(((.varies_by // []) | length) == 0) | .id' "$TMP/corpus.jsonl")

# ------------------------------------------------------- (c) the completeness violators, by name
COMPLETENESS=$(jq -r 'select(.rfc9112_completeness_violation == true) | .id' "$TMP/corpus.jsonl" | sort | tr '\n' ' ' | sed 's/ $//')
if [ "$COMPLETENESS" != "sse.drop truncate" ]; then
  note "(c) rfc9112_completeness_violation is on [$COMPLETENESS]; /corpus names exactly /truncate and /sse/drop. Re-probe before changing this — it is a dated observation of the platform."
fi

# -------------------------------------------------- (d) the published curl reconstructs from the row
while IFS= read -r id; do
  [ -n "$id" ] && note "(d) $id: the published curl string does not match the row's own url, method and request_headers"
done < <(jq -r '
  . as $r
  | (if (.method // "GET") == "GET" then "" else " -X " + .method end) as $m
  | ((.request_headers // {}) | to_entries | map(" -H '"'"'\(.key): \(.value)'"'"'") | join("")) as $h
  | ("curl --http1.1 --raw -sS -D -" + $m + $h + " --output - '"'"'" + .url + "'"'"'") as $want
  | select($want != .curl) | .id' "$TMP/corpus.jsonl")

# ------------------------------------- (a) deterministic_bytes:true => same request, same bytes
jq -r 'select(.deterministic_bytes == true) | [.id, .method, .url] + ((.request_headers // {}) | to_entries | map("\(.key): \(.value)")) | @tsv' \
  "$TMP/corpus.jsonl" > "$TMP/stable.tsv"
STABLE=$(wc -l < "$TMP/stable.tsv" | tr -d ' ')
# Non-vacuity floor. Every assertion here is "for all rows matching X"; if X ever selects nothing —
# a generator regression, a truncated fetch, a renamed field — all four pass vacuously and the deploy
# goes green on a corpus nobody checked. These floors are deliberately well below today's numbers
# (141 rows, 56 stable) so ordinary growth never trips them, and they are a floor rather than an
# equality so adding a family does not require editing this script.
[ "$ROWS" -ge 120 ] || note "(floor) only $ROWS rows in the corpus; expected at least 120 — the file shrank or the fetch was truncated"
[ "$STABLE" -ge 40 ] || note "(floor) only $STABLE rows claim deterministic_bytes:true; expected at least 40 — check (a) is close to vacuous"

# One state reading for a row, using the row's own method and headers. --globoff (-g) so a braced url
# is fetched rather than glob-expanded; curl's EXIT status is ignored on purpose, because rows like
# /truncate abort by design and still deliver the same bytes every time.
# Echoes "<http_status> <sha256-of-body>". The STATUS is part of the compared value on purpose: two
# responses that are identically broken are not "identical bytes" in any useful sense, and without it
# a row whose endpoint had regressed to a constant error would sail through this check twice. The
# body is written to a file rather than piped so curl's own status can be read in the same call.
body_state() {
  local method="$1" url="$2" out="$3" h
  shift 3
  # Build the -H list in an array. `${a[@]+"${a[@]}"}` is the expansion that is safe when the array
  # is empty under `set -u` on bash 3.2, which is what macOS ships.
  local a=()
  for h in "$@"; do
    [ -n "$h" ] && a+=(-H "$h")
  done
  local code
  code=$(curl -sS -m "$MAXTIME" -g -X "$method" ${a[@]+"${a[@]}"} -o "$out" -w '%{http_code}' "$url" 2>/dev/null)
  printf '%s %s' "${code:-000}" "$(shasum -a 256 < "$out" | cut -d' ' -f1)"
}

while IFS=$'\t' read -r id method url rest; do
  # `rest` holds every remaining tab-separated header. Splitting it here rather than into a fixed
  # number of read variables means a row with a fourth capture header is sent as four -H arguments,
  # not three with a tab embedded in the last one. The corpus tops out at one header today; this
  # stops that from being load-bearing.
  hdrs=()
  if [ -n "${rest:-}" ]; then
    while IFS= read -r one; do
      [ -n "$one" ] && hdrs+=("$one")
    done <<< "$(printf '%s' "$rest" | tr '\t' '\n')"
  fi
  # The zone rate limit (100 req / 10 s per IP, block 10 s) answers 429 from the EDGE, before the
  # Worker. That is not this row's response and must never be compared as if it were — with the
  # status folded into the compared value, a 200-then-429 pair would read as "the bytes moved" and
  # fail a healthy deploy. So a 429 on either reading backs off past the block and re-reads. This is
  # the one retry in the script and it is a retry on OUR OWN traffic shaping, not on the assertion.
  a=$(body_state "$method" "$url" "$TMP/a.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
  b=$(body_state "$method" "$url" "$TMP/b.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
  tries=0
  while { [ "${a%% *}" = "429" ] || [ "${b%% *}" = "429" ]; } && [ "$tries" -lt 3 ]; do
    tries=$((tries+1))
    throttled=$((throttled+1))
    sleep 11
    a=$(body_state "$method" "$url" "$TMP/a.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
    b=$(body_state "$method" "$url" "$TMP/b.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
  done
  if [ "${a%% *}" = "429" ] || [ "${b%% *}" = "429" ]; then
    echo "corpus-assert: WARN $id still rate-limited after $tries backoffs; not compared"
    continue
  fi
  # The Worker stamps its own unhandled exceptions with "bug": true (src/index.js's top-level catch).
  # A row that reaches one is broken whether or not it is broken identically twice.
  if grep -q '"bug": true' "$TMP/a.bin" 2>/dev/null; then
    note "(a) $id: the endpoint returned this service's own unhandled-exception body (\"bug\": true) — $url"
    continue
  fi
  if [ "$a" != "$b" ]; then
    # Confirm with an independent second pair before failing (see the flakiness note above).
    c=$(body_state "$method" "$url" "$TMP/c.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
    d=$(body_state "$method" "$url" "$TMP/d.bin" ${hdrs[@]+"${hdrs[@]}"}); sleep "$PACE"
    if [ "${c%% *}" = "429" ] || [ "${d%% *}" = "429" ]; then
      echo "corpus-assert: WARN $id rate-limited while confirming a mismatch; not compared"
      continue
    fi
    # Compare the confirming pair against the FIRST pair too, not just against each other: a row that
    # alternates between two states can produce c == d while still being nondeterministic.
    if [ "$c" != "$d" ] || [ "$c" != "$a" ] || [ "$d" != "$b" ]; then
      note "(a) $id: claims deterministic_bytes true, but two identical requests returned different status+bytes (twice over) — $url [$a vs $b]"
    else
      echo "corpus-assert: WARN $id mismatch did not reproduce (transient transfer, not a lying field)"
    fi
  fi
done < "$TMP/stable.tsv"

echo "corpus-assert: $ROWS rows, $STABLE claiming stable bytes, replayed twice against $B${throttled:+ (backed off $throttled times for the zone rate limit)}"
if [ "$fail" -gt 0 ]; then
  cat "$TMP/failures"
  echo "corpus-assert: a machine-readable field does not match the wire. Fix the row, never the check."
  exit 1
fi
exit 0

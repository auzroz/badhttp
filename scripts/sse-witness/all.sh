#!/bin/bash
# Run every /sse witness in sequence (never in parallel: one IP, one zone rate limit) and write the capture as
# NDJSON with a provenance line first. Usage: scripts/sse-witness/all.sh out.jsonl [base]
# Never run this while scripts/smoke.sh is running: two suites against one IP rate-limit each other and the
# failure looks like a broken client.
# Environment: PYTHON (a venv python with httpx-sse, sseclient-py, aiohttp-sse-client installed; default python3),
#              SSE_NODEMODS (a dir holding node_modules/eventsource), GOMOD_DIR (a Go module dir with the SSE
#              library fetched; the Go harness runs from it), WORKER_VERSION (the wrangler deployment id, for provenance).
set -u
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
export PATH="/opt/homebrew/bin:$PATH"
unset SSE_FLAVORS  # a published capture is always the full grid; dry runs use the harnesses directly
PY="${PYTHON:-python3}"
: "${SSE_NODEMODS:?set SSE_NODEMODS to a dir holding node_modules/eventsource}"
: "${GOMOD_DIR:?set GOMOD_DIR to a Go module dir with the SSE library fetched}"
VER=$(curl -s "$B/health" | jq -r .version)
jq -nc --arg probed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg ver "$VER" --arg wv "${WORKER_VERSION:-}" --arg b "$B" \
  '{capture:"sse", probed:$probed, badhttp_version_observed:$ver, worker_version:(if $wv=="" then null else $wv end), base:$b, flavors_run:14, scripts:"scripts/sse-witness/", note:"One line per (client, flavor), one fresh client instance each, pointed at GET /sse/{flavor} with default parameters. The curl line is the raw-wire control: its control.raw_base64 is the body as received and the parser derives the reference WHATWG parse from it. events is what the library delivered to the caller in order; connections is every connection the library opened, counted at the layer connections_counted_by names; end is how the row finished from the caller side (clean, error, reconnecting, stopped, closed-by-harness, harness-timeout). Nothing here is a verdict."}' > "$OUT"
LOG="${OUT%.jsonl}.log"; : > "$LOG"
# A harness exits non-zero only when it could not run at all (missing module, bad flavor list, crash): the rows it
# writes for a client that failed to answer are still exit 0. Stop loudly rather than publish a partial capture.
fail() { echo "FAILED: $1 exited with status $2; the capture in $OUT is incomplete and must not be published" | tee -a "$LOG" >&2; exit 1; }
bash scripts/sse-witness/curl.sh "$B" >> "$OUT" 2>> "$LOG" || fail curl.sh $?; sleep 3
NODE_PATH="$SSE_NODEMODS/node_modules" node scripts/sse-witness/node-clients.mjs "$B" >> "$OUT" 2>> "$LOG" || fail node-clients.mjs $?; sleep 3
"$PY" scripts/sse-witness/py-clients.py "$B" >> "$OUT" 2>> "$LOG" || fail py-clients.py $?; sleep 3
(cd "$GOMOD_DIR" && go run "$REPO/scripts/sse-witness/go-sse.go" "$B") >> "$OUT" 2>> "$LOG" || fail go-sse.go $?
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -c ' ok$' "$LOG") ok, $(grep -c 'retrying' "$LOG") retries, $(grep -ci 'failed' "$LOG") failed"

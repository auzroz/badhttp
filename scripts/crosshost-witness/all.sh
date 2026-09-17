#!/bin/bash
# Run every /crosshost witness in sequence (never in parallel: one IP, one zone rate limit) and write the
# capture as NDJSON with a provenance line first. Usage: scripts/crosshost-witness/all.sh out.jsonl [base]
set -u
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
PY="${PYTHON:-python3}"
VER=$(curl -s "$B/health" | jq -r .version)
jq -nc --arg probed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg ver "$VER" --arg wv "${WORKER_VERSION:-}" --arg b "$B" \
  '{capture:"crosshost", probed:$probed, badhttp_version_observed:$ver, worker_version:(if $wv=="" then null else $wv end), base:$b, scripts:"scripts/crosshost-witness/", note:"One line per (client, flavor). Fields named received/matches are the oracle body verbatim (it never echoes what was sent); the rest is what the harness observed on its own side."}' > "$OUT"
# Every harness's progress lines (one "ok" per chain, one "retrying" per edge retry) go to a log beside the
# capture, committed with it: that is what makes "the run needed N retries" a claim the record supports.
LOG="${OUT%.jsonl}.log"; : > "$LOG"
bash scripts/crosshost-witness/curl.sh "$B" >> "$OUT" 2>> "$LOG"; sleep 3
go run scripts/crosshost-witness/go-nethttp.go "$B" >> "$OUT" 2>> "$LOG"; sleep 3
node scripts/crosshost-witness/node-fetch.mjs "$B" >> "$OUT" 2>> "$LOG"; sleep 3
"$PY" scripts/crosshost-witness/py-clients.py "$B" >> "$OUT" 2>> "$LOG"
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -c ' ok$' "$LOG") ok, $(grep -c 'retrying' "$LOG") retries, $(grep -c 'FAILED' "$LOG") failed"

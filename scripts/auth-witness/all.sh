#!/bin/bash
# Run every /auth witness in sequence (never in parallel: one IP, one zone rate limit) and write the capture
# as NDJSON with a provenance line first. Usage: scripts/auth-witness/all.sh out.jsonl [base]
# Never run this while scripts/smoke.sh is running: two suites against one IP rate-limit each other and the
# failure looks like a broken client.
set -u
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
unset AUTH_FLAVORS  # a published capture is always the full grid; dry runs use the harnesses directly
PY="${PYTHON:-python3}"
VER=$(curl -s "$B/health" | jq -r .version)
jq -nc --arg probed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg ver "$VER" --arg wv "${WORKER_VERSION:-}" --arg b "$B" \
  '{capture:"auth", probed:$probed, badhttp_version_observed:$ver, worker_version:(if $wv=="" then null else $wv end), base:$b, flavors_run:18, clients_run:8, scripts:"scripts/auth-witness/", note:"One line per (client, flavor). The oracle field is the final /auth response body minus its constant warning/hint/credentials prose (it never echoes a credential); mechanism_kind and mechanism say how the documented fake credentials were handed to the client for that flavor; hops is, per request the client sent, its status and whether Authorization/Proxy-Authorization was present (never a value); the rest is what the harness observed on its own side."}' > "$OUT"
LOG="${OUT%.jsonl}.log"; : > "$LOG"
bash scripts/auth-witness/curl.sh "$B" >> "$OUT" 2>> "$LOG"; sleep 3
go run scripts/auth-witness/go-nethttp.go "$B" >> "$OUT" 2>> "$LOG"; sleep 3
node scripts/auth-witness/node-fetch.mjs "$B" >> "$OUT" 2>> "$LOG"; sleep 3
"$PY" scripts/auth-witness/py-clients.py "$B" >> "$OUT" 2>> "$LOG"
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -c ' ok$' "$LOG") ok, $(grep -c 'retrying' "$LOG") retries, $(grep -c 'FAILED' "$LOG") failed"

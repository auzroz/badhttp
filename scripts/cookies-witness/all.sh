#!/bin/bash
# Run every /cookies witness in sequence (never in parallel: one IP, one zone rate limit) and write the capture
# as NDJSON with a provenance line first. Usage: scripts/cookies-witness/all.sh out.jsonl [base]
# Never run this while scripts/smoke.sh is running: two suites against one IP rate-limit each other and the
# failure looks like a broken client.
# Environment: GOMOD_DIR (a Go module dir with golang.org/x/net available; the Go harness runs from it),
# COOKIE_NODEMODS (a dir holding node_modules/tough-cookie), PYTHON (default python3).
set -u
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
export PATH="/opt/homebrew/bin:$PATH"
unset COOKIE_FLAVORS  # a published capture is always the full grid; dry runs use the harnesses directly
PY="${PYTHON:-python3}"
GOMOD_DIR="${GOMOD_DIR:-/private/tmp/claude-501/-Volumes-External-Repositories-claude-design/5d3b1149-d4ce-4165-ab33-820410234165/scratchpad/gomod}"
if [ ! -d "$GOMOD_DIR" ]; then echo "GOMOD_DIR is not a directory: $GOMOD_DIR (a Go module with golang.org/x/net; set GOMOD_DIR)" >&2; exit 1; fi
VER=$(curl -s "$B/health" | jq -r .version)
jq -nc --arg probed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg ver "$VER" --arg wv "${WORKER_VERSION:-}" --arg b "$B" \
  '{capture:"cookies", probed:$probed, badhttp_version_observed:$ver, worker_version:(if $wv=="" then null else $wv end), base:$b, flavors_run:17, clients_run:8, scripts:"scripts/cookies-witness/", note:"One line per (client, flavor), each with a fresh jar: the setter, then /cookies/echo, then /cookies/delete, then /cookies/echo again. jar_kind names what the client has (own-jar, harness-jar, no-jar), never what happened; hops is, per request sent while fetching the setter, its status and how many Set-Cookie headers the client exposed; echo is the parsed /cookies/echo body; jar_entries and jar_rejections are what the jar itself reported; the rest is what the harness observed on its own side."}' > "$OUT"
LOG="${OUT%.jsonl}.log"; : > "$LOG"
bash scripts/cookies-witness/curl.sh "$B" >> "$OUT" 2>> "$LOG"; sleep 3
(cd "$GOMOD_DIR" && go run "$REPO/scripts/cookies-witness/go-nethttp.go" "$B") >> "$OUT" 2>> "$LOG"; sleep 3
node scripts/cookies-witness/node-fetch.mjs "$B" >> "$OUT" 2>> "$LOG"; sleep 3
"$PY" scripts/cookies-witness/py-clients.py "$B" >> "$OUT" 2>> "$LOG"
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -c ' ok$' "$LOG") ok, $(grep -c 'retrying' "$LOG") retries, $(grep -c 'FAILED' "$LOG") failed"

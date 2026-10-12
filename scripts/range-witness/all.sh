#!/bin/bash
# Run the whole /range witness capture (docs/spec-range-witness.md) and write it as NDJSON with a provenance line first.
# Usage: scripts/range-witness/all.sh out.jsonl [base]      (out.jsonl is repo-relative, e.g. docs/probe-range-clients-<date>.jsonl)
# Never run this while scripts/smoke.sh is running: two suites against one IP rate-limit each other and the failure looks like a
# broken client. One client at a time, 1 s between rows, 3 s between clients: about 166 rows and 240 requests, about 15 minutes.
# Environment (all required; see scripts/range-witness/README.md for how to install the roster into a scratch directory):
#   RANGE_VENV      a Python venv holding httpie, huggingface_hub and yt-dlp
#   RANGE_NODEMODS  a dir holding node_modules/node-downloader-helper and node_modules/nugget
#   RANGE_GOTOOL    the built Go driver binary (scripts/range-witness/drivers/gotool)
#   DRIVERS         optional; the dir holding hf.py and ndh.cjs (default scripts/range-witness/drivers)
#   WORKER_VERSION  optional; the wrangler deployment id, for provenance
set -u
set -o pipefail
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
# A published capture is always the full grid against the real server: dry-run switches (no-version, TLS verification off) and
# proxy variables never leak in from the environment, to the recorder and the provenance fetch as much as to the clients.
unset RANGE_ALLOW_NO_VERSION NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy
: "${RANGE_VENV:?set RANGE_VENV to a Python venv holding httpie, huggingface_hub and yt-dlp}"
: "${RANGE_NODEMODS:?set RANGE_NODEMODS to a dir holding node_modules/node-downloader-helper and node_modules/nugget}"
: "${RANGE_GOTOOL:?set RANGE_GOTOOL to the built Go driver (scripts/range-witness/drivers/gotool)}"
export RANGE_VENV RANGE_NODEMODS RANGE_GOTOOL
if [ ! -x "$RANGE_VENV/bin/python" ]; then echo "RANGE_VENV has no bin/python: $RANGE_VENV" >&2; exit 1; fi
if [ ! -x "$RANGE_GOTOOL" ]; then echo "RANGE_GOTOOL is not an executable: $RANGE_GOTOOL" >&2; exit 1; fi
if pgrep -f 'scripts/smoke\.sh' > /dev/null; then echo "scripts/smoke.sh is running; two suites against one IP rate-limit each other. Wait for it." >&2; exit 1; fi
LOG="${OUT%.jsonl}.log"; : > "$LOG"
# run.mjs exits non-zero only when it could not run at all (a roster entry missing, a driver failed, a control not fetchable); the
# rows it writes for a client that failed to answer are still exit 0. Stop loudly rather than publish a partial capture.
if ! node scripts/range-witness/run.mjs "$OUT" "$B" 2>&1 | tee -a "$LOG"; then
  echo "FAILED: run.mjs did not run to the end; the capture in $OUT is incomplete and must not be published" | tee -a "$LOG" >&2
  exit 1
fi
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -cE ' attempts=1( |$)' "$LOG") rows on the first attempt, $(grep -c '^retrying' "$LOG") retries, $(grep -c '^FAILED' "$LOG") failed"

#!/bin/bash
# Run the whole /etag witness capture (docs/spec-etag-witness.md) and write it as NDJSON with a provenance line first.
# Usage: scripts/etag-witness/all.sh out.jsonl [base]      (out.jsonl is repo-relative, e.g. docs/probe-etag-clients-<date>.jsonl)
# Never run this while scripts/smoke.sh is running: two suites against one IP rate-limit each other and the failure looks like a
# broken client. One client at a time, 1 s between cells, 3 s between clients, 10 cells per client and 3 to 6 requests per cell,
# plus the curl-raw controls (about 22 requests).
# Environment (see scripts/etag-witness/README.md for how to install the roster into a scratch directory):
#   ETAG_VENV       required; a Python venv holding the Python cache libraries the roster uses
#   ETAG_NODEMODS   required; a dir holding node_modules with the Node cache libraries the roster uses
#   ETAG_GOTOOL     required; the built Go driver binary (scripts/etag-witness/drivers/gotool)
#   ETAG_PROXIES    optional; a dir holding the proxy config templates (default scripts/etag-witness/proxies)
#   DRIVERS         optional; the dir holding the drivers (default scripts/etag-witness/drivers)
#   WORKER_VERSION  optional; the wrangler deployment id, for provenance
set -u
set -o pipefail
OUT="$1"; B="${2:-https://badhttp.dev}"
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
# A published capture is always the full grid against the real server: dry-run switches (no-version, TLS verification off) and
# proxy variables never leak in from the environment, to the recorder and the provenance fetch as much as to the clients.
unset ETAG_ALLOW_NO_VERSION NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy
: "${ETAG_VENV:?set ETAG_VENV to a Python venv holding the Python cache libraries (see scripts/etag-witness/README.md)}"
: "${ETAG_NODEMODS:?set ETAG_NODEMODS to a dir holding node_modules with the Node cache libraries}"
: "${ETAG_GOTOOL:?set ETAG_GOTOOL to the built Go driver (scripts/etag-witness/drivers/gotool)}"
export ETAG_VENV ETAG_NODEMODS ETAG_GOTOOL
[ -n "${ETAG_PROXIES:-}" ] && export ETAG_PROXIES
if [ ! -x "$ETAG_VENV/bin/python" ]; then echo "ETAG_VENV has no bin/python: $ETAG_VENV" >&2; exit 1; fi
if [ ! -d "$ETAG_NODEMODS/node_modules" ]; then echo "ETAG_NODEMODS has no node_modules: $ETAG_NODEMODS" >&2; exit 1; fi
if [ ! -x "$ETAG_GOTOOL" ]; then echo "ETAG_GOTOOL is not an executable: $ETAG_GOTOOL" >&2; exit 1; fi
if pgrep -f 'scripts/smoke\.sh' > /dev/null; then echo "scripts/smoke.sh is running; two suites against one IP rate-limit each other. Wait for it." >&2; exit 1; fi
LOG="${OUT%.jsonl}.log"; : > "$LOG"
# run.mjs exits non-zero only when it could not run at all (a roster entry missing, a driver failed, a control not fetchable); the
# rows it writes for a client that failed to answer are still exit 0. Stop loudly rather than publish a partial capture.
if ! node scripts/etag-witness/run.mjs "$OUT" "$B" 2>&1 | tee -a "$LOG"; then
  echo "FAILED: run.mjs did not run to the end; the capture in $OUT is incomplete and must not be published" | tee -a "$LOG" >&2
  exit 1
fi
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -cE ' attempts=1( |$)' "$LOG") rows on the first attempt, $(grep -c '^retrying' "$LOG") retries, $(grep -c '^FAILED' "$LOG") failed"

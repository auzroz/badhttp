#!/bin/bash
# Run the whole /402 witness capture (docs/spec-x402-witness.md) and write it as NDJSON with a provenance line first.
# Usage: scripts/x402-witness/all.sh [out.jsonl]   (repo-relative; default docs/probe-x402-clients-<UTC date>.jsonl; the log is beside it)
# The base is always https://badhttp.dev: a published capture is the full grid against the real server. Dry runs call run.mjs directly
# against scripts/x402-witness/standin.mjs.
# This capture PAYS: every `pay` cell settles 0.01 test USDC on Base Sepolia from the throwaway payer to the project's own receive
# address (a labeled self-test on a testnet, never revenue). Never run it while scripts/smoke.sh runs: two suites against one IP
# rate-limit each other and the failure looks like a broken client. One client at a time, 1 s between cells, 3 s between clients,
# 18 cells per client, two to twelve requests per cell, plus 18 curl-raw controls.
# Environment (see scripts/x402-witness/README.md for how to install the roster into a scratch directory):
#   X402_WITNESS_PAYER_KEY  required; the throwaway Base Sepolia payer key (0x + 64 hex). Handed to driver processes only.
#   X402_NODEMODS   required for Node clients; a dir holding node_modules with the Node x402 libraries
#   X402_NODEMODS_V1 optional; a second node_modules dir for the v1-era Node clients (default: X402_NODEMODS)
#   X402_NODEMODS_MISC optional; a third node_modules dir for Faremeter and AgentKit (default: X402_NODEMODS)
#   X402_VENV       required for Python clients; a Python venv holding the Python x402 libraries
#   X402_GOTOOL     required for Go clients; the built Go driver binary
#   DRIVERS         optional; the dir holding the drivers (default scripts/x402-witness/drivers)
#   WORKER_VERSION  optional; the wrangler deployment id, for provenance
set -u
set -o pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
BASE="https://badhttp.dev"
OUT="${1:-docs/probe-x402-clients-$(date -u +%F).jsonl}"
# A published capture is always the full grid against the real server: dry-run switches (no-version, TLS verification off, the
# self-test client) and proxy variables never leak in from the environment, to the recorder and the provenance fetch as much as to the clients.
unset X402_ALLOW_NO_VERSION X402_SELFTEST NODE_USE_ENV_PROXY HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy
if [ "${NODE_TLS_REJECT_UNAUTHORIZED:-1}" = "0" ]; then echo "NODE_TLS_REJECT_UNAUTHORIZED=0: TLS verification is off; a published capture needs it on" >&2; exit 1; fi
unset NODE_TLS_REJECT_UNAUTHORIZED
: "${X402_WITNESS_PAYER_KEY:?set X402_WITNESS_PAYER_KEY to the throwaway Base Sepolia payer key (X402_TEST_PAYER_KEY in .env)}"
case "$X402_WITNESS_PAYER_KEY" in 0x????????????????????????????????????????????????????????????????) ;; *) echo "X402_WITNESS_PAYER_KEY is not a 0x-prefixed 64-hex-digit key" >&2; exit 1 ;; esac
export X402_WITNESS_PAYER_KEY
[ -n "${X402_NODEMODS:-}" ] && export X402_NODEMODS
[ -n "${X402_NODEMODS_V1:-}" ] && export X402_NODEMODS_V1
[ -n "${X402_NODEMODS_MISC:-}" ] && export X402_NODEMODS_MISC
[ -n "${X402_VENV:-}" ] && export X402_VENV
[ -n "${X402_GOTOOL:-}" ] && export X402_GOTOOL
if [ -n "${X402_NODEMODS:-}" ] && [ ! -d "$X402_NODEMODS/node_modules" ]; then echo "X402_NODEMODS has no node_modules: $X402_NODEMODS" >&2; exit 1; fi
if [ -n "${X402_NODEMODS_V1:-}" ] && [ ! -d "$X402_NODEMODS_V1/node_modules" ]; then echo "X402_NODEMODS_V1 has no node_modules: $X402_NODEMODS_V1" >&2; exit 1; fi
if [ -n "${X402_NODEMODS_MISC:-}" ] && [ ! -d "$X402_NODEMODS_MISC/node_modules" ]; then echo "X402_NODEMODS_MISC has no node_modules: $X402_NODEMODS_MISC" >&2; exit 1; fi
if [ -n "${X402_VENV:-}" ] && [ ! -x "$X402_VENV/bin/python" ]; then echo "X402_VENV has no bin/python: $X402_VENV" >&2; exit 1; fi
if [ -n "${X402_GOTOOL:-}" ] && [ ! -x "$X402_GOTOOL" ]; then echo "X402_GOTOOL is not an executable: $X402_GOTOOL" >&2; exit 1; fi
if pgrep -f 'scripts/smoke\.sh' > /dev/null; then echo "scripts/smoke.sh is running; two suites against one IP rate-limit each other. Wait for it." >&2; exit 1; fi
if pgrep -f 'standin\.mjs' > /dev/null; then echo "a stand-in (standin.mjs) is running; kill it first (pkill -f standin.mjs). A published capture runs against $BASE only." >&2; exit 1; fi
LOG="${OUT%.jsonl}.log"; : > "$LOG"
# run.mjs exits non-zero only when it could not run at all (a roster entry missing, a driver failed, a control not fetchable, a secret in
# a string); the rows it writes for a client that failed to answer are still exit 0. Stop loudly rather than publish a partial capture.
if ! node scripts/x402-witness/run.mjs "$OUT" "$BASE" 2>&1 | tee -a "$LOG"; then
  echo "FAILED: run.mjs did not run to the end; the capture in $OUT is incomplete and must not be published" | tee -a "$LOG" >&2
  exit 1
fi
if grep -q '^FAILED' "$LOG" && ! grep -q '^done:' "$LOG"; then
  echo "FAILED: run.mjs did not report done; the capture in $OUT is incomplete and must not be published" | tee -a "$LOG" >&2
  exit 1
fi
echo "wrote $OUT: $(($(wc -l < "$OUT") - 1)) observations; log $LOG: $(grep -cE ' attempts=1( |$)' "$LOG") rows on the first attempt, $(grep -c '^retrying' "$LOG") retries, $(grep -c '^FAILED' "$LOG") failed"

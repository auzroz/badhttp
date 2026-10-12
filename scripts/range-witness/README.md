# `/range` witness capture

The sixth `/clients.jsonl` family (`docs/spec-range-witness.md`). Ten resuming download clients plus a raw curl control, each
resuming a 400-byte partial of the 1,000-byte `/range` document from each of the fourteen flavors, plus one fresh download at
`always-206`. Every request the client sends goes through `recorder.mjs`, a local recording reverse proxy.

| file | what it is |
|---|---|
| `all.sh` | the published-capture entry point: `scripts/range-witness/all.sh docs/probe-range-clients-<date>.jsonl` |
| `run.mjs` | the orchestrator: controls, then each client's 15 cells, one fresh directory and one fresh recorder per cell |
| `recorder.mjs` | the recording reverse proxy, one per cell (`node recorder.mjs <exchanges.ndjson> <base> 0` prints `READY http://127.0.0.1:<port>`) |
| `drivers/` | the three library drivers (`hf.py`, `ndh.cjs`, `gotool/`), see `drivers/README.md` |

Parse a finished capture with `node scripts/witness-parse-range.mjs docs/probe-range-clients-<date>.jsonl`. The `.log` beside the
capture is committed with it and the parser refuses a log that names a machine path or a host other than badhttp.dev.

## Install the roster into a scratch directory

Nothing is installed into the repo. `SCR` is any scratch directory you own.

```sh
SCR=/path/to/scratch; mkdir -p "$SCR"
# curl: the system /usr/bin/curl (8.7.1 on macOS), nothing to install.
brew install wget wget2        # GNU Wget 1.25.0, GNU Wget2 2.3.0 (installing wget2 also upgrades libgcrypt and gnupg)
# Python: HTTPie, huggingface_hub, yt-dlp in one venv
/opt/homebrew/bin/python3 -m venv "$SCR/venv"
"$SCR/venv/bin/pip" install httpie==3.2.4 huggingface_hub==2.2.0 yt-dlp==2026.8.19
# Node: node-downloader-helper and nugget
mkdir -p "$SCR/npm" && (cd "$SCR/npm" && npm init -y >/dev/null && npm install node-downloader-helper@2.1.11 nugget@2.2.0)
# Go: grab and go-getter, behind one driver binary
(cd scripts/range-witness/drivers && go build -o "$SCR/gotool" ./gotool)

export RANGE_VENV="$SCR/venv" RANGE_NODEMODS="$SCR/npm" RANGE_GOTOOL="$SCR/gotool"
```

The versions above are the ones the survey used; the capture records whatever is installed (`--version` for the command-line tools,
the driver's `RESULT` line for the libraries), so a different version is a different, honestly labelled capture.

## Environment

| variable | meaning |
|---|---|
| `RANGE_VENV` | the venv above (`bin/http`, `bin/yt-dlp`, `bin/python`); required |
| `RANGE_NODEMODS` | the dir holding `node_modules/` with `node-downloader-helper` and `nugget`; required |
| `RANGE_GOTOOL` | the built Go driver; required |
| `DRIVERS` | the dir holding `hf.py` and `ndh.cjs`; default `scripts/range-witness/drivers`, never a scratch path |
| `WORKER_VERSION` | the wrangler deployment id, for provenance (optional) |
| `RANGE_ALLOW_NO_VERSION=1` | **dry runs only**: see below. `all.sh` unsets it and `run.mjs` refuses it when the base is badhttp.dev |

`run.mjs` asks only for the variables the selected clients use; `all.sh` asks for all three. Clients run with their own throwaway
`HOME` (so a `~/.wgetrc` or `~/.curlrc` cannot change an invocation), `LC_ALL=C`, no proxy variables and stdin closed.

## A published capture

Never while `scripts/smoke.sh` runs (two suites against one IP rate-limit each other, and the failure looks like a broken client).
About 166 rows and 240 requests, about 15 minutes, sequential: 1 s between rows, 3 s between clients, a 30 s wall cap per row.

```sh
WORKER_VERSION=<deployment id> scripts/range-witness/all.sh docs/probe-range-clients-$(date -u +%F).jsonl
node scripts/witness-parse-range.mjs docs/probe-range-clients-$(date -u +%F).jsonl
```

A response without `x-badhttp-version` is Cloudflare's rate limit, not an observation: the harness wipes the directory, waits 12 s
and runs the cell again (3 attempts). A cell that never clears is written with `exchanges: []` and `request_failed: true`.

## A dry run against a local stand-in (no live requests)

`recorder.mjs` forwards over TLS, so the stand-in must speak HTTPS. Serve `src/range.js` from a small HTTPS server with a
self-signed certificate on 127.0.0.1, let the recorder trust it with `NODE_TLS_REJECT_UNAUTHORIZED=0` (set it on the dry run only), and have
the stand-in answer `GET /health` with `{"version":"..."}` and stamp `x-badhttp-version` on responses; if it cannot, add
`RANGE_ALLOW_NO_VERSION=1`, which stamps `x_badhttp_version: "local"` and turns the rate-limit retry off.

```sh
NODE_TLS_REJECT_UNAUTHORIZED=0 RANGE_ALLOW_NO_VERSION=1 \
  node scripts/range-witness/run.mjs "$SCR/local.jsonl" https://127.0.0.1:8788 --clients=curl,wget --flavors=ok,ignore,from-zero
```

`--clients=` and `--flavors=` exist for dry runs only (the provenance line is stamped `subset: true`; the parser demands the full
grid). A local capture's `url` and `base` carry the loopback origin, so the parser refuses it until those are rewritten to
`https://badhttp.dev`, which is useful to check the SHAPE of the rows and nothing else. Never publish one.

## What a row records, and what it leaves out

`exit` is the process status for a command-line client, or `{code, kind: return|raised, name}` from the driver's `RESULT` line for a
library. `reported_error` is the last lines of stderr (or the `RESULT` message) with machine paths, loopback origins and ports removed,
at most 200 characters, and only when the client exited non-zero or its library reported an error: a client that exits 0 reported
success, whatever it printed. `file` is `out.txt`, or `out.txt.part` for yt-dlp when it stopped; `other_files` lists anything else it
left in the directory. The loopback URL and port never reach a row.

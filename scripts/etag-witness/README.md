# `/etag` witness capture

The seventh `/clients.jsonl` family (`docs/spec-etag-witness.md`). A roster of 14 HTTP caches (seven libraries that revalidate for an HTTP
client, three command-line tools that keep one saved validator, four caching proxies) plus a raw curl control, each asked to fetch
`GET /etag/{flavor}` three times in a row through its cache, for each of the ten flavors. Every request the client sends goes
through `scripts/witness-recorder.mjs`, a local recording reverse proxy shared with the `/range` family.

| file | what it is |
|---|---|
| `all.sh` | the published-capture entry point: `scripts/etag-witness/all.sh docs/probe-etag-clients-<date>.jsonl` |
| `run.mjs` | the orchestrator: the curl-raw controls, then each client's ten cells, one fresh directory, one fresh recorder and one freshly started driver per cell |
| `drivers/` | one driver per client or language group, speaking the `FETCH` / `RESULT` / `QUIT` protocol, see `drivers/README.md` |
| `proxies/` | the minimal nginx, Varnish, Squid and Traffic Server configuration templates, rendered per cell with the recorder's port |
| `../witness-recorder.mjs` | the recording reverse proxy (`node witness-recorder.mjs <exchanges.ndjson> <base> 0` prints `READY http://127.0.0.1:<port>`) |

Parse a finished capture with `node scripts/witness-parse-etag.mjs docs/probe-etag-clients-<date>.jsonl`. The `.log` beside the
capture is committed with it and the parser refuses a log that names a machine path or a host other than badhttp.dev.

## Install the roster into a scratch directory

Nothing is installed into the repo. `SCR` is any scratch directory you own. The versions below are the survey's
(`docs/survey-etag-clients-2026-10-12.md`); the capture records whatever is installed (each driver's `HELLO` line names the library
version), so a different version is a different, honestly labelled capture.

```sh
SCR=/path/to/scratch; mkdir -p "$SCR"
# Python: hishel, requests-cache and CacheControl in one venv (the driver also imports filelock, httpx and requests)
/opt/homebrew/bin/python3 -m venv "$SCR/venv"
"$SCR/venv/bin/pip" install hishel==1.4.0 httpx==0.28.1 requests-cache==1.3.3 requests==2.34.2 CacheControl==0.14.4 filelock
# Node: undici, make-fetch-happen and got (with cacheable-request) in one directory
mkdir -p "$SCR/npm" && (cd "$SCR/npm" && npm init -y >/dev/null && npm install undici@8.11.2 make-fetch-happen@16.0.1 got@16.0.0 cacheable-request@13.0.19)
# Go: gregjones/httpcache (and bartventer/httpcache, which ships in the driver but is not captured) behind one driver binary
(cd scripts/etag-witness/drivers/gotool && GOFLAGS=-mod=mod go build -o "$SCR/gotool" .)
# Command-line tools and proxies are the system's or Homebrew's: curl (/usr/bin/curl 8.7.1), wget, nginx, varnish, squid, trafficserver.
# Their versions are read from each driver's HELLO line.

export ETAG_VENV="$SCR/venv" ETAG_NODEMODS="$SCR/npm" ETAG_GOTOOL="$SCR/gotool"
```

## Environment

| variable | meaning |
|---|---|
| `ETAG_VENV` | the venv above (`bin/python`); required |
| `ETAG_NODEMODS` | the dir holding `node_modules/` with the Node cache libraries; required |
| `ETAG_GOTOOL` | the built Go driver; required |
| `ETAG_PROXIES` | the dir holding the proxy config templates; default `scripts/etag-witness/proxies`, optional |
| `DRIVERS` | the dir holding the drivers; default `scripts/etag-witness/drivers`, never a scratch path |
| `WORKER_VERSION` | the wrangler deployment id, for provenance (optional) |
| `ETAG_ALLOW_NO_VERSION=1` | **dry runs only**: see below. `all.sh` unsets it and `run.mjs` refuses it when the base is badhttp.dev |

`run.mjs` asks only for the variables the selected clients use; `all.sh` asks for the three required ones. Drivers run with their own
throwaway `HOME` and `XDG_*` directories (so a `~/.curlrc`, `~/.wgetrc` or a user-level cache cannot change a run), `LC_ALL=C`, no
proxy variables, and `ETAG_RECORDER` (the recorder's loopback origin for this cell, which a proxy driver points its upstream at).
Each cell is a fresh working directory and a fresh driver process: nothing is carried from one flavor to the next.

## A published capture

Never while `scripts/smoke.sh` runs (two suites against one IP rate-limit each other, and the failure looks like a broken client).
Ten cells per client, three to six requests per cell, sequential: 1 s between cells, 3 s between clients, a cap of 20 s per fetch and
60 s per cell enforced on the driver's whole process group.

```sh
WORKER_VERSION=<deployment id> scripts/etag-witness/all.sh docs/probe-etag-clients-$(date -u +%F).jsonl
node scripts/witness-parse-etag.mjs docs/probe-etag-clients-$(date -u +%F).jsonl
```

A response without `x-badhttp-version` is Cloudflare's rate limit, not an observation: the harness wipes the directory and the cache,
waits 12 s and runs the cell again (3 attempts). A cell that never clears is written with `fetches: []`, `exchanges: []` and
`request_failed: true`. A driver that exits 2, prints no `HELLO`, exits before a `RESULT`, or whose cell recorded no exchange at all
(when the cell was not rate-limited) stops the harness with exit status 3: a broken install never publishes as a client behaviour.
A cap that fires on a live driver is an observation: the row is marked `harness-timeout`, the fetch in flight keeps what the recorder
saw (`timed_out: true`, `caller: null`), and the fetches after it are `not_run`.

## A dry run against a local stand-in (no live requests)

The recorder forwards over plain HTTP/1.1 when its base is `http://` (dry runs only; a capture always uses `https://badhttp.dev`), so
the stand-in is a small HTTP server that serves `src/etag.js` on 127.0.0.1, stamps `x-badhttp-version` on responses and answers
`GET /health` with `{"version":"..."}`. If it cannot, add `ETAG_ALLOW_NO_VERSION=1`, which stamps `x_badhttp_version: "local"` and
turns the rate-limit retry off.

```sh
ETAG_ALLOW_NO_VERSION=1 \
  node scripts/etag-witness/run.mjs "$SCR/local.jsonl" http://127.0.0.1:8792 --clients=curl-etag,hishel --flavors=ok,mismatch,always-304
```

`--clients=` and `--flavors=` exist for dry runs only (the provenance line is stamped `subset: true`; the parser demands the full
grid). A local capture's `url` and `base` carry the loopback origin, so the parser refuses it until those are rewritten to
`https://badhttp.dev`, which is useful to check the SHAPE of the rows and nothing else. Never publish one. Against a stand-in the
harness prints `DRYRUN-LEAK` for any row that carries a machine path, a loopback literal or port (other than the stand-in's own
`url` and `base`), or a verdict word; against badhttp.dev the same finding stops the capture.

Never run a dry run on port 8787 (the smoke suite's default target) and never start two stand-ins on one port.

## What a row records, and what it leaves out

A client row has three `fetches`; each holds the `caller` result the driver reported (`status`, `bytes`, `sha256`, `error`,
`library_says`, `exit`) and the `exchanges` the recorder saw between the previous `RESULT` and this one (each with `fetch_n`).
Exchanges that appear after the last `RESULT` and before the recorder stops are counted in `exchanges_after_result`. `client.version`,
`library`, `runtime` and `configuration` are the driver's `HELLO` line, scrubbed; a cell whose `HELLO` differs from the client's first
cell stops the harness. The loopback URL and port never reach a row.

The controls (`curl-raw`) are rows with `fetches: null` and one top-level exchange each: `cold-raw`, `revalidate-raw` (the conditional
headers copied verbatim from what `cold-raw` received, each only if it was received) and, for `mismatch`, `revalidate-adopted-raw`. A
control's `control` object carries `raw_base64`, `raw_bytes`, `raw_sha256`, `status`, `etag`, `last_modified` and `curl_exit`; an
empty body (the `always-304` cold control, any 304) is a valid control, not a failed one.

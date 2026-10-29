# `/402` witness capture

The eighth `/clients.jsonl` family (`docs/spec-x402-witness.md`). A roster of x402 payment clients plus a raw curl control, each asked
to make ONE paid `GET /402/{scenario}` through its payment wrapper, for each of the 18 scenarios (`pay`, `never`, `reject`, `slow`,
`crash`, `bad-receipt`, `overpriced`, `wrong-network` and the ten `broken/{flavor}` flavors). The payer is the project's throwaway Base
Sepolia key. Every request the client sends goes through `scripts/witness-recorder.mjs`, a local recording reverse proxy shared with the
`/range` and `/etag` families, which here also decodes the x402 headers into a summary (never a raw signature) and cuts a cell off after
12 upstream requests (`--budget=12`).

| file | what it is |
|---|---|
| `all.sh` | the published-capture entry point: `scripts/x402-witness/all.sh [docs/probe-x402-clients-<date>.jsonl]` (base is always https://badhttp.dev) |
| `run.mjs` | the orchestrator: the 18 curl-raw controls, then each client's 18 cells, one fresh directory, one fresh recorder (budget 12) and one freshly started driver per cell |
| `standin.mjs` | the local stand-in for dry runs: `src/x402.js` on loopback with a stub facilitator (`node scripts/x402-witness/standin.mjs <port> <facilitator-port>`; never port 8787) |
| `drivers/` | one driver per client or language group, speaking the `FETCH` / `RESULT` / `QUIT` protocol, see `drivers/README.md` |
| `../witness-recorder.mjs` | the recording reverse proxy (`node witness-recorder.mjs <exchanges.ndjson> <base> 0 --budget=12` prints `READY http://127.0.0.1:<port>`) |

Parse a finished capture with `node scripts/witness-parse-x402.mjs docs/probe-x402-clients-<date>.jsonl`. The `.log` beside the capture
is committed with it.

## Install the roster into a scratch directory

Nothing is installed into the repo. `SCR` is any scratch directory you own. The capture records whatever is installed (each driver's
`HELLO` line names the library version), so a different version is a different, honestly labelled capture. The survey's versions and
install lines are in `docs/survey-x402-clients-2026-10-29.md`.

```sh
SCR=/path/to/scratch; mkdir -p "$SCR"
# Node (the packages the roster's Node drivers load, see drivers/README.md)
mkdir -p "$SCR/npm" && (cd "$SCR/npm" && npm init -y >/dev/null && npm install @x402/fetch @x402/axios @x402/evm axios viem)
# v1-era Node clients (own dir if their axios/viem pins conflict): npm install x402-fetch x402-axios axios viem
/opt/homebrew/bin/python3 -m venv "$SCR/venv" && "$SCR/venv/bin/pip" install x402 httpx requests eth-account
(cd scripts/x402-witness/drivers/gotool && GOFLAGS=-mod=mod go build -o "$SCR/gotool" .)
export X402_NODEMODS="$SCR/npm"
export X402_VENV="$SCR/venv" X402_GOTOOL="$SCR/gotool"  # and X402_NODEMODS_V1 if used
```

## Environment

| variable | meaning |
|---|---|
| `X402_WITNESS_PAYER_KEY` | **required**: the throwaway Base Sepolia payer key (`X402_TEST_PAYER_KEY` in `.env`). Read by the orchestrator, handed to driver processes in THEIR environment only (never to the recorder or curl), and refused wherever it would reach a string: any row, log line or driver message carrying the key (hex, lower case, without `0x`, or base64) or a 0x-prefixed 64-hex token outside a `transaction` field aborts the capture |
| `X402_NODEMODS` | the dir holding `node_modules/` with the Node client libraries |
| `X402_NODEMODS_V1` | optional: a second dir for the v1-era Node clients (`x402-fetch`, `x402-axios`), which pin other axios and viem versions; without it they load from `X402_NODEMODS` |
| `X402_NODEMODS_MISC` | optional: a third dir for Faremeter and AgentKit; without it they load from `X402_NODEMODS` |
| `X402_VENV` | a Python venv (`bin/python`, run with `-I`) |
| `X402_GOTOOL` | the built Go driver |
| `DRIVERS` | the dir holding the drivers; default `scripts/x402-witness/drivers` |
| `WORKER_VERSION` | the wrangler deployment id, for provenance (optional) |
| `X402_ALLOW_NO_VERSION=1` | **dry runs only**: stamps `x_badhttp_version: "local"` on exchanges without one and turns the rate-limit retry off. The stand-in already stamps `local`, so this is rarely needed. `all.sh` unsets it and `run.mjs` refuses it for badhttp.dev |
| `X402_SELFTEST=1` | **dry runs only**: adds `selftest-loop` to the roster (a driver that resends an unsigned header on every 402) to prove the request budget; refused for badhttp.dev |

Children run with an allow-listed environment (`PATH`, `TMPDIR`, a throwaway `HOME` and `XDG_*`, `LC_ALL=C`, the roster's own variables
and `X402_RECORDER`, the recorder's loopback origin for this cell): nothing else of the operator's shell reaches them, and no proxy
variable does. Each cell is a fresh working directory and a fresh driver process.

## A published capture

This capture PAYS: each `pay` cell settles 0.01 test USDC on Base Sepolia to the project's own receive address (a labeled self-test, never
revenue; the Sepolia watermark in `LEDGER.md` moves by the number of settled `pay` cells). Never while `scripts/smoke.sh` runs, never with
a stand-in listening. 18 cells per client, two to twelve requests per cell, sequential: 1 s between cells, 3 s between clients; caps of
45 s per fetch and 60 s per cell on the driver's whole process group.

```sh
X402_WITNESS_PAYER_KEY=... X402_NODEMODS=... WORKER_VERSION=<deployment id> scripts/x402-witness/all.sh
node scripts/witness-parse-x402.mjs docs/probe-x402-clients-$(date -u +%F).jsonl
```

A response without `x-badhttp-version` that is not the recorder's own budget 503 is Cloudflare's rate limit, not an observation: the
harness wipes the directory, waits 12 s and runs the cell again (3 attempts). A cell that never clears is written with `fetches: []` and
`request_failed: true`. A driver that exits 2, prints no `HELLO`, exits before a `RESULT`, requests a URL other than its cell's, or whose
cell recorded no exchange at all stops the harness with exit status 3. A cap that fires on a live driver is an observation: the row is
marked `harness-timeout`, the fetch keeps what the recorder saw (`timed_out: true`, `caller: null`).

## Row notes for the parser

- Client rows: `fetches` has one entry `{n: 1, caller, exchanges}`; exchanges that land after the `RESULT` are in `late_exchanges`
  (their count is `exchanges_after_result`). `budget_exhausted` is true when the recorder answered any request itself (an exchange
  with `budget_refused: true`, `upstream: false`, status 503, no `x_badhttp_version`).
- Control rows: `kind: "offer-raw"`, `fetches: null`, the one exchange in the top-level `exchanges` array, and
  `control: {status, raw_bytes, raw_sha256, raw_base64, curl_exit, offer}` where `offer` is the exchange's `payment_required` summary
  (with `header_present: false` and every other field null when the response carried no PAYMENT-REQUIRED header) plus `body_x402version`.
- An exchange's `x402` object is null when the exchange carried none of the x402 headers and a JSON body with an `x402Version`.
  `payment_required` is null when the header is absent; `header_present` is true whenever the summary exists.
- Loopback origins never reach a row: they are rewritten to `https://badhttp.dev` in every string.

## A dry run against the stand-in (no live requests)

```sh
node scripts/x402-witness/standin.mjs 8795 8796 &
X402_WITNESS_PAYER_KEY=<a throwaway key> X402_NODEMODS=$SCR/npm \
  node scripts/x402-witness/run.mjs out.jsonl http://127.0.0.1:8795 [--clients=a,b] [--scenarios=pay,never]
```

The stand-in stamps `x-badhttp-version: local`. A dry-run row that would carry a port or a machine path prints `DRYRUN-LEAK`; against
badhttp.dev the same finding aborts the capture. Kill the stand-in (`pkill -f 'standin.mjs 8795'`) before any suite.

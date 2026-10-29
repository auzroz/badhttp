# `/402` witness capture — the eighth `/clients.jsonl` family

Session 36, 2026-10-29. Target: v0.29.0. Pattern: `docs/spec-etag-witness.md` (session 32) and `docs/spec-range-witness.md`
(session 31); same recorder, same driver protocol, same parser discipline, same honesty boundary (`docs/spec-clients.md`).

## Why

`/402` has documented since v0.2.0 (2026-08-23) one x402 paywall that settles and seventeen that misbehave: one that never
accepts, one that rejects every payment, one that sits on a paid request and answers 504, one that answers 500 after the
payment, one whose receipt is garbage, one that asks for 1,000,000 USDC, one whose only option is on a chain that does not
exist, and ten malformed 402s (PAYMENT-REQUIRED not base64, not JSON, without `accepts`, with an empty `accepts`, without
`extra`, without `resource`, with `x402Version` 99, with a decimal `amount`, with v2 requirements only in the body, and a
spec-valid v1 body with no header). Every scenario's page asks a question of the client — does it stop or re-sign, does it
refuse to sign for a million dollars, does it treat a 500 after payment as paid — and the only client behaviour the site has
ever recorded is two sentences about @x402/fetch 2.23.0 from 2026-08-23. The x402 ecosystem is the one audience that
provably visits this host every day (its registries, scorers and test-buyers are the only payers it has ever had), and no
one publishes what the real client libraries do when a paywall misbehaves. This family publishes rows.

The x402 v2 specification constrains the client less than RFC 9111 constrains a cache: it says the client reads the
PAYMENT-REQUIRED header, selects a requirement it can satisfy, builds a payment payload, retries with PAYMENT-SIGNATURE and
reads PAYMENT-RESPONSE; it says nothing about spending limits, about retrying after a second 402, or about a 500 after a
payment. So the rows are described against a **reference** derived from the control's wire exchange — what the offer the
server made admits (a 402 with nothing a Base Sepolia payer can satisfy admits no payment; `/402/pay` admits one and
delivers a receipt) — and the word "verdict" stays banned: a client that signs for 1,000,000 USDC with its defaults and one
that refuses are both doing something the specification allows, and the finding is the difference.

## What is measured

**The scenario is one paid fetch of one URL through one x402 client, with a payer on Base Sepolia.** For each (client,
scenario): a fresh working directory, a fresh client process, the client's payment wrapper configured with the project's
throwaway Base Sepolia payer (`eip155:84532`, test USDC, no dollar value; the library's default spending limit, if it has
one, and nothing else), and the client asked to `GET` the scenario URL **once**. The harness never sends a payment header
itself; the client decides, from the 402 it received, whether to sign, for how much, on which network, whether to retry,
and what to hand its caller.

The grid is **18 cells per client**: the eight scenarios `pay`, `never`, `reject`, `slow`, `crash`, `bad-receipt`,
`overpriced`, `wrong-network` and the ten `broken/{flavor}` flavors. `pay` is the one cell that settles (0.01 test USDC
through the Sepolia facilitator chain, x402.org first); it is the positive control — this client can pay this server at
all — and the only cell whose reference names a result. `slow` is requested at its default (8 s). No `?amount=`, no
`?network=`, no `?reason=`: every URL is the bare scenario URL, so every row's `url` is one the catalogue documents.

**Every request the client sent is recorded by the shared recording reverse proxy** (`scripts/witness-recorder.mjs`),
extended for this family with two things: (a) a decoded SUMMARY of the x402 headers on each exchange, in a new `x402`
object (null on exchanges carrying none), so the capture never carries a raw signature; (b) a per-recorder **request budget**
(`--budget=N`, default unlimited; this harness passes 12): after N upstream requests the recorder answers 503 locally with
`x-badhttp-recorder: budget-exhausted` and forwards nothing, so a client that re-signs forever is bounded by the harness and
never by the zone rate limit (a 429 is never an observation; this family makes it unreachable from a cell). The client is
pointed at a loopback `http://` URL whose path is the scenario's; the recorder forwards verbatim to `https://badhttp.dev`
over TLS (HTTP/1.1) with `Host: badhttp.dev`, so the 402 the client sees names `https://badhttp.dev/402/...` as its
resource while the request went to a loopback origin — a client that compares the two is observed doing so. TLS, ALPN and
HTTP/2 are out of scope and the index says so.

The `x402` summary per exchange (every field null when absent; `decode_error` a short string when the header did not
decode as base64 JSON):
- request: `payment_signature` and `x_payment`, each `{version, scheme, network, accepted: {scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra_present}, authorization: {from, to, value, validAfter, validBefore}, signature_bytes, resource_url, decode_error}` (v1 has no `accepted`/`resource_url`; `signature_bytes` is the byte length of the hex signature, never the signature; the nonce is not recorded).
- response: `payment_required` `{version, error, resource_url, accepts: [{scheme, network, asset, amount, maxAmountRequired, payTo, maxTimeoutSeconds, extra_present}], accepts_count, decode_error, header_present}`, `payment_response` and `x_payment_response` `{decodable, success, transaction, network, payer, errorReason, decode_error}`, `x_badhttp_warning` (the server's own warning header, verbatim), `x_badhttp_flavor`, `body_x402version` (the 402 body's top-level `x402Version`, read from the first 64 KB when the content type is JSON).

**Alignment is trivial by construction:** one `FETCH` per cell, one driver process per cell, one recorder per cell; every
exchange the recorder saw belongs to that fetch. Exchanges that land after the `RESULT` (a library retrying in the
background) are counted in `exchanges_after_result` and kept.

Per fetch the driver's `RESULT` line reports what the **caller** received: `status` (the status the wrapped call returned
to the caller, or null if the library raised), `bytes` and `sha256` of the body the caller received, `error`
(`{name, message}` scrubbed, or null), `library_says` (what the library exposes about the payment: the decoded receipt
object if it decodes one for the caller, the requirement it selected, a "payment attempted" flag, a settlement error class —
recorded as the library's claim, never used to compute an outcome), `exit` (CLI tools only).

Per (client, scenario) the harness records: the one `RESULT` under `fetches[0]` with its attributed `exchanges[]`;
`wall_ms`; `attempts` (a cell any of whose exchanges lacks `x-badhttp-version` and is not the recorder's own budget 503
is Cloudflare's rate limit: wait 12 s, wipe the directory, retry the whole cell, at most 3 attempts; a cell that never
clears is written `request_failed: true`); `end` (`exited` | `harness-timeout`: a per-fetch cap of **45 s** — settlement on
Sepolia and the 8 s of `slow` both fit — and a per-cell cap of **60 s**, on the driver's process group; a cell that hits a cap
keeps what the recorder saw, marks the fetch `timed_out: true` with `caller: null`); `budget_exhausted` (the recorder cut
the client off after 12 upstream requests). Scrubs as in the etag harness: a URL in a user agent that is not badhttp.dev
becomes `<url>`; a loopback origin never reaches a row; the payer's private key never appears anywhere (the harness
reads it from `X402_WITNESS_PAYER_KEY`; every driver gets it from its environment and prints nothing of it; the parser
refuses any row or log string containing the key, its lower-case form, or its base64, as the auth parser refuses the
documented credentials); the payer ADDRESS is public (`LEDGER.md` #10) and may appear.

**Pacing.** One client at a time, scenarios in catalogue order, 1 s between cells, 3 s between clients, never while
`scripts/smoke.sh` runs. Two to twelve requests per cell against a limit of 100 per 10 s.

**The control.** curl, client id `curl-raw`, role `control`, class `raw`, one row per scenario (`x402.<scenario>.offer-raw.curl-raw`):
`curl -sS --http1.1 -D - -o body` of the bare URL with no payment header, through the same recorder. Its exchange's
`payment_required` summary and `body_x402version` are **the offer** every client in that cell was shown; the control
row carries `control: {status, raw_sha256, raw_bytes, offer}` (`offer` is the summary copied out, so the reference is
readable on the control row). The control never pays: `pay`'s control is its 402 like every other.

## Roster (fixed by the survey; versions on every row)

Candidates the survey agent evaluates against the local stand-in (`scripts/x402-witness/standin.mjs`, which serves the real
`src/x402.js` handler on loopback with a stub facilitator, so every cell including `pay` can be dry-run with a throwaway
key and no live request): Node — `@x402/fetch` + `@x402/evm` (the x402 foundation's v2 SDK), `@x402/axios`, `x402-fetch`
(the v1-era package), `x402-axios`, thirdweb's x402 fetch wrapper, any agent-framework client that wraps one of these
with its own policy (Coinbase AgentKit's x402 action provider, `mcpay`, `@agentcash/*`) — a wrapper is a roster entry only
if it adds behaviour (a limit, a retry policy, a receipt check) rather than re-exporting; Python — the `x402` package's
httpx and requests clients (two entries if their wire differs, one if not); Go — the client in `github.com/coinbase/x402/go`
if it ships one; Rust — `x402-rs`/`x402-reqwest` if a client crate exists; anything else the survey finds with real
downloads. Target 6–10 clients. Exclusions must be reasons the index can print (`not_in_roster`): a library that cannot be
pointed at a loopback `http://` origin at all, one that needs a hosted wallet or an API key to sign, one that needs a runtime
this machine lacks, one whose wire is identical to a roster entry it wraps (named as such). "Signs for anything" or "loops"
is a finding, never an exclusion.

`client.configuration` names what the harness handed the client and nothing about what happened (the #25 rule): the
payer network registered (`eip155:84532`), the signer type (a local private key), and every option that departs from the
library's defaults — expected to be none; if a library REQUIRES a spending limit to be set, the configuration says the
value and why. The same string on every row of one client.

## Row shape (one NDJSON line per cell; line 1 of the file is provenance)

```
{ "family":"x402", "id":"x402.<scenario>.one-paid-fetch.<client>", "corpus_id":"402/<scenario-or-broken-flavor>",
  "url":"https://badhttp.dev/402/<scenario>" | "https://badhttp.dev/402/broken/<flavor>", "method":"GET",
  "scenario":"<pay|never|...|broken/<flavor>>", "flavor":"<the last path segment>", "kind":"one-paid-fetch",
  "probed":"<iso>", "badhttp_version":"<from the first exchange>",
  "client": {"id","name","role":"client|control","class":"sdk-fetch|sdk-http|agent-wrapper|cli|raw","version","library","runtime","platform","invocation","configuration","generation":"v2|v1|both","requests_recorded_by"},
  "attempts": 1,
  "fetches": [
    {"n":1,"caller":{"status":200,"bytes":612,"sha256":"...","error":null,"library_says":{...},"exit":null},
     "exchanges":[
       {"n":1,"fetch_n":1,"method":"GET","path_query":"/402/pay","status":402,"x402":{"payment_signature":null,"x_payment":null,"payment_required":{"version":2,"accepts_count":1,"accepts":[{"network":"eip155:84532","amount":"10000",...}],...},"payment_response":null,"x_payment_response":null,"x_badhttp_warning":null,"body_x402version":1},"x_badhttp_version":"0.28.0","body_bytes":...,"body_sha256":"...","ms":...},
       {"n":2,"fetch_n":1,"method":"GET","path_query":"/402/pay","status":200,"x402":{"payment_signature":{"version":2,"authorization":{"from":"0x29f4…","to":"0x2b14…","value":"10000",...},"signature_bytes":65,...},"payment_response":{"decodable":true,"success":true,"transaction":"0x…","network":"eip155:84532","payer":"0x29f4…"},...},...}
     ]}
  ],
  "exchanges_after_result": 0, "budget_exhausted": false, "end":"exited", "wall_ms": 4120,
  "control": null   // control rows: {"status":402,"raw_sha256","raw_bytes","offer":{<the payment_required summary>,"body_x402version"}}; their one exchange sits in a top-level `exchanges` array
}
```
The parser adds `wire`, `description`, `outcome`, `reference`, `outcome_vs_reference` and `license: "CC0-1.0"`.

## `wire`, `description`, `outcome` (assigned by the parser; descriptions, never verdicts)

`wire` (from the attributed exchanges):
- `requests`: how many requests went upstream (the recorder's own budget 503s are not upstream requests; they are counted in `budget_refusals`).
- `payment_requests`: how many carried PAYMENT-SIGNATURE or X-PAYMENT. `resigned`: `payment_requests - 1` when ≥ 1, else null — how many times the client signed AGAIN after its first payment was not accepted.
- `payment_header`: `PAYMENT-SIGNATURE` | `X-PAYMENT` | `both` (the same request carried both) | `none`. `generation`: 2 | 1 | null, from the first payment header (the v2 header wins when both, as the server reads it).
- `signed`: boolean — at least one payment header went out.
- `signed_value_atomic`, `signed_network`, `signed_to`: from the first payment header's authorization/accepted; `offer_amount_atomic`, `offer_network`: from the control's offer; `value_matches_offer`, `to_matches_offer`: equality (null when either side is null).
- `first_status`, `last_status`: the status of the first and last upstream exchange. `statuses`: the sequence (`"402,200"`).
- `server_warning`: the last `x-badhttp-warning` the server sent (verbatim), else null.
- `receipt`: for the last response: `decodable` (a PAYMENT-RESPONSE or X-PAYMENT-RESPONSE decoded, with `success`), `undecodable` (present, did not decode), `absent`.

`description` (what the CALLER got):
- `delivered` — the caller received a 200 and its body (`bytes` > 0, no error). Qualified by `receipt`: `decodable` | `undecodable` | `absent`.
- `handed-back` — the caller received a response object with a status other than 200 and the library did not raise; the status is on the description (`handed-back/402`, `handed-back/500`, `handed-back/504`, `handed-back/503` for the recorder's budget answer).
- `raised` — the library raised; `error.name` on the row. Qualified by `signed`: `raised/before-signing` | `raised/after-signing`.
- `harness-timeout` — a cap fired; what the recorder saw is kept.
- `request-failed` — no exchange reached the server in three attempts.

`outcome` for the row is the `description` with its qualifier (`delivered/decodable`, `delivered/undecodable`,
`delivered/absent`, `handed-back/402`, `handed-back/500`, `handed-back/504`, `handed-back/503`, `raised/before-signing`,
`raised/after-signing`, `harness-timeout`, `request-failed`). `pattern` is the exchanges as a compact string the eye can
scan: `→402 | PS→200 receipt` or `→402 | PS→402 | PS→402 | … ×12 budget` (`PS` a PAYMENT-SIGNATURE, `XP` an X-PAYMENT,
nothing before `→` an unpaid request; suffixes `receipt`, `bad-receipt`, `warning`, `budget`, `raised`).

## `reference` (per scenario, derived from the control's offer — never typed)

What the x402 v2 flow admits, given what the control received, computed by the parser from the control row's `offer`:
- `signing`: `no-payment-possible` when the offer has no requirement a payer registered for `eip155:84532` with an EIP-3009
  signer can satisfy — the header did not decode (`not-base64`, `not-json`), `x402Version` is neither 1 nor 2
  (`version-99`), `accepts` is absent or empty (`no-accepts`, `empty-accepts`), no accepted requirement names
  `eip155:84532` (`wrong-network`), or there is no PAYMENT-REQUIRED header and the body's `x402Version` is not 1
  (`missing-header`); `payment-expected` when the offer carries exactly the requirement `/402/pay` carries (`pay`, `never`,
  `reject`, `slow`, `crash`, `bad-receipt`, `v1-body` — the v1 body is the same requirement in the v1 form, which the v2
  reference client's compatibility path and every v1 client read); `unspecified` when the specification constrains nothing
  about whether to sign — `overpriced` (the spec has no spending limit; the amount is the client's decision), `no-extra`
  (the EIP-712 domain is missing, so a signature cannot be made against the token's domain, but nothing forbids a client
  from guessing one), `no-resource` (`resource` is required by the schema and ignored by the signature), `decimal-amount`
  (`amount` is specified as atomic units in a string; nothing says a client must validate it).
- `result`: `delivered/decodable` for `pay` only (the one offer whose server settles and returns a receipt); `unspecified`
  for every other scenario — the specification does not say what a client does after a 402 that follows a payment, a 500,
  a 504 or an undecodable receipt.
- `note`: a sentence naming which clause of the offer produced `signing` (`accepts is empty`, `no requirement on eip155:84532`, …).

`outcome_vs_reference`: `as-reference` when `signing` is `no-payment-possible` and `wire.signed` is false, or `payment-expected`
and `signed` is true (and for `pay`, the outcome is `delivered/decodable`); `differs` when the signing expectation is not met,
or `pay` did not deliver a decodable receipt; `unspecified` when `signing` is `unspecified`; null on `harness-timeout` and
`request-failed`. A `differs` on `wrong-network` or `empty-accepts` is a client that signed for an offer it could not
satisfy; a `differs` on `never` is a client that did not sign at all (a client that signs and stops, and one that signs
twelve times, are both `as-reference` on signing — the re-sign count is the finding, in `wire.resigned`).

`disagreement_by_scenario` counts distinct `(outcome, signed, resigned-bucket)` answers among client rows per scenario,
where the bucket is `0`, `1`, `2-5`, `6+`; control rows are excluded.

## What the rows cannot say, stated on the index

Anything over HTTPS or HTTP/2 (every client spoke HTTP/1.1 to a loopback recorder); what a client does with mainnet funds
(the payer holds test USDC on Base Sepolia only, and no cell offers `eip155:8453`); whether a client that signed for
1,000,000 USDC would have been charged by a server that kept the authorization (this one discards it; the expiry is
300 s); a hosted-wallet or smart-wallet signer (every roster client signs with a local key); a client configured with a
spending limit it does not set by default (the configuration is the library's defaults); anything after the caps or the
budget.

## Refusals (the parser exits non-zero rather than emit)

A client missing a cell of the 18-cell grid; a duplicate (client, scenario); a scenario missing its `offer-raw` control; a
client row with other than one fetch; a row any of whose exchanges lacks `x-badhttp-version` and is neither a recorder budget
503 nor a client-aborted exchange (status 0, `client_aborted: true`: the client hung up before any response byte), names another scenario's path, or records an `upstream_error`; an exchange with no `fetch_n` on a client row (other
than the `exchanges_after_result` count); a raw `signature` field, a 65-byte-or-longer hex string, or the payer key in any
string (the payer key is read from `X402_WITNESS_PAYER_KEY` at parse time only to refuse it, and the parser runs with
it absent in CI — then it refuses any 64-hex-character string preceded by `0x`, which also catches a leaked key, since no
row legitimately carries one: transaction hashes are 64 hex characters and are the one exception, allowed only under
`transaction`); a row carrying a machine path, a loopback literal, a port, or a host other than badhttp.dev; a control whose
raw bytes do not hash to `raw_sha256`; rows spanning two badhttp versions; fewer than 5 client-role clients; a `class`,
`kind`, `end`, `description`, `receipt` or `payment_header` outside the vocabulary; a verdict word in any served string; an
absolute or parent-relative capture path; a `configuration` string that differs between rows of one client; a `pay` row
whose `delivered/decodable` receipt reports `success: true` with a `transaction` that is not 64 hex characters.

Non-vacuity floors (the #20 rule): at least one client row `delivered/decodable` on `pay`, at least one row `signed: false`,
at least one row `signed: true` on a scenario other than `pay`, at least one control row per scenario, and the client count
floor above.

## Harness layout

```
scripts/witness-recorder.mjs            the shared recorder: + the x402 summaries, + --budget=N (range and etag rows unchanged; their captures are committed files)
scripts/x402-witness/standin.mjs        the local stand-in: src/x402.js's handler on loopback with a stub facilitator (dry runs only; written by the main loop before the agents launched)
scripts/x402-witness/run.mjs            the orchestrator (the controls, the roster, one FETCH per cell, fresh driver and recorder per cell, rate-limit retry, scrubbing, emit gates)
scripts/x402-witness/all.sh             the entry point; refuses with TLS verification off, without X402_WITNESS_PAYER_KEY, with a suite running, or with a stand-in listening
scripts/x402-witness/drivers/           one driver per client or language group, each speaking the FETCH/RESULT/QUIT protocol
scripts/x402-witness/drivers/README.md  the protocol and what each driver changes from the library's defaults
scripts/witness-parse-x402.mjs          the generator: docs/probe-x402-clients-<date>.jsonl → src/witness-x402-data.js (imports scripts/witness-gate.mjs)
src/x402-witness.js                     x402Findings()/x402Witness(): the computed witness block for GET /402, the home page and /clients (gated explanations cite the survey)
docs/survey-x402-clients-2026-10-29.md  the survey: roster, per-client mechanism as read in its source, exclusions, hazards
```

Driver protocol (as `/etag`): on start `HELLO {"library","version","runtime","http":"1.1","generation":"v2|v1|both","configuration"}`;
stdin `FETCH <url>` → one wrapped GET of that URL → stdout `RESULT {"ok":bool,"status":int|null,"bytes":int,"sha256":hex,
"error":{"name","message"}|null,"library_says":any|null,"exit":{"code","stderr_tail"}|null}`; `QUIT` → exit 0. The driver finds the payer key
in `X402_WITNESS_PAYER_KEY` and the recorder's origin in `X402_RECORDER` as well as in the `FETCH` url. Exit 2 means the driver
itself failed (module missing, bad key format) and the capture aborts. Messages are scrubbed by the driver and again by the
orchestrator (no machine path, loopback literal, port, key or verdict word reaches a row).

## Rules that travel with this family

- The payer is the throwaway Base Sepolia key (`X402_TEST_PAYER_KEY` in `.env`, exported to the harness as
  `X402_WITNESS_PAYER_KEY`); it holds test USDC only and must never hold mainnet assets; the mainnet payer key is never used
  by this harness, and no cell requests `/402/pay/base` or `?network=base`.
- Each `pay` cell settles 0.01 test USDC to the project's own receive address on Base Sepolia: a labeled self-test on a
  testnet, never revenue, and the Sepolia receive watermark in LEDGER.md moves by the number of settled `pay` cells.
- A capture is re-run whole, never patched row by row; its run log is committed beside it.
- No raw signature, nonce, or private key in a capture, a row, a log or a report; the recorder summarizes, the parser refuses.
- Explanations of why a named client behaves as it does cite `docs/survey-x402-clients-2026-10-29.md` and render only
  while the computed list they were written for matches (the #23 rule).

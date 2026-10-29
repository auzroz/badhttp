# /402 witness: payment-client drivers

Each driver here makes one x402 payment client (a library's payment wrapper) fetch one URL with the project's throwaway Base Sepolia
payer, so that `scripts/x402-witness/run.mjs` can point it at the recording proxy and record what it sent and what its caller got. A
driver is a process the orchestrator starts fresh for every cell, in an empty working directory, with the payer key and the recorder's
origin in its environment; it prints `HELLO`, answers ONE `FETCH`, and exits on `QUIT`.

## Protocol

- On start, one line: `HELLO {"library","version","runtime","http":"1.1","generation":"v2|v1|both","configuration"}`.
  `configuration` names what the harness handed the client (the payer network registered, the signer type, every option that departs
  from the library's defaults, any spending limit a library REQUIRES and why). It says nothing about what happened. `generation` is
  the x402 protocol generation the client speaks on the wire.
- `FETCH <url>` performs ONE wrapped `GET` of that URL (a loopback `http://` URL; the recorder forwards it to the real server) and
  prints one line:
  `RESULT {"ok":bool,"status":int|null,"bytes":int,"sha256":"<hex>","error":{"name","message"}|null,"library_says":any|null,"exit":{"code","stderr_tail"}|null}`.
  - `status`, `bytes`, `sha256` describe what the CALLER received: the status the wrapped call returned and the body (read fully).
    `status` is null when the library raised. `sha256` of an empty body is the hash of zero bytes.
  - `error` is set when the library raised (the class name and a scrubbed message of at most 300 characters).
  - `library_says` is whatever the library exposes about the payment: a decoded receipt, the requirement it selected, a flag that a
    payment was created, a settlement-error class. JSON-safe, scrubbed, at most 2 KB (`{"truncated":true}` beyond). It is recorded as
    the library's claim and never used to compute an outcome. Hooks a driver registers to read these only observe; they return nothing
    and change no behaviour.
  - `exit` is set for command-line tools only.
- `QUIT` exits 0. End of input does the same.
- Nothing else is written to stdout; diagnostics go to stderr. Exit 2 means the driver itself could not run (module missing, bad key
  format); the orchestrator aborts the capture on it.
- No fetch is retried by the driver and no driver follows a redirect. The driver sets no spending limit unless the library requires one.
- The key is read from `X402_WITNESS_PAYER_KEY`, removed from the process environment and never printed. Messages are scrubbed in the
  driver (the key in any form, a 0x-prefixed hex token of 64 or more digits, the loopback origin, absolute paths, whitespace) and again
  by the orchestrator, which also refuses to emit any string that carries the key or such a token outside a `transaction` field.

## Drivers

| file | invocation | clients (id: library, version at the survey of 2026-10-29) |
|---|---|---|
| `node-clients.mjs` | `X402_NODEMODS=<dir containing node_modules> node node-clients.mjs <id>` | `x402-fetch-v2`: @x402/fetch with @x402/evm (and @x402/core, viem). `x402-axios-v2`: @x402/axios with @x402/evm and axios. `thirdweb-x402`: thirdweb/x402. `x402-fetch-v1`: x402-fetch (the v1-era package). `x402-axios-v1`: x402-axios (the v1-era package; `X402_NODEMODS_V1` may point at its own install). `faremeter-fetch`: @faremeter/fetch with payment-evm and wallet-evm. `agentkit-x402`: @coinbase/agentkit's X402ActionProvider (both load from `X402_NODEMODS_MISC`, falling back to `X402_NODEMODS`). Versions are the ones installed (named on the HELLO line) |
| `py-clients.py` | `$X402_VENV/bin/python -I py-clients.py <id>` | `x402-httpx`: x402 (Python) with httpx. `x402-requests`: x402 (Python) with requests. Both x402 2.26.0 at the survey |
| `gotool/` | `$X402_GOTOOL <id>` (build: `go build -o <out>/gotool .` in `gotool/`) | `x402-go`: github.com/x402-foundation/x402/go (pseudo-version of 2026-05-29) |
| `selftest.mjs` | `node selftest.mjs loop` (dry runs only, `X402_SELFTEST=1`) | `selftest-loop`: not a client; proves the request budget |

The version a row carries is the one the driver prints in HELLO at capture time. The roster, not this file, says which ids are captured.

## What each driver changes from the library's defaults, and what it does

Statements about a library's behaviour are from its source at the installed version. Node packages are loaded from
`$X402_NODEMODS/node_modules` by resolving each package's ESM entry from its `package.json` `exports`; a library's own imports then
resolve from its own directory. Proxy environment variables are removed before any library is loaded and `NO_PROXY=*` is set.

### Node (`node-clients.mjs`)

- **x402-fetch-v2** (`@x402/fetch` `wrapFetchWithPayment(fetch, client)` with `client = x402Client.fromConfig({schemes: [{network:
  "eip155:84532", client: new ExactEvmScheme(privateKeyToAccount(key))}]})`): this is what the package's `wrapFetchWithPaymentFromConfig`
  does, split in two only so the driver can attach the client's hooks. Exactly one network is registered, `eip155:84532`; everything else is the
  library default, including its spend controls. The wrapper reads PAYMENT-REQUIRED (or a v1 body), creates a payload for the requirement
  its selector picks, retries once with PAYMENT-SIGNATURE, and returns the second response. The call is `wrapped(url, {method: "GET",
  redirect: "manual"})`; the only departure from the call a user would write is `redirect: "manual"`, because no driver follows a redirect.
  `library_says`: `payment_created` and `selected` (scheme, network, amount, payTo) from `onAfterPaymentCreation`; `creation_failed`
  from `onPaymentCreationFailure`; `receipt` from `decodePaymentResponseHeader` on the final response's PAYMENT-RESPONSE (or
  X-PAYMENT-RESPONSE) header.

- **x402-axios-v2** (`@x402/axios` `wrapAxiosWithPayment(axios.create({maxRedirects: 0}), client)`, the same `x402Client` setup as above): axios
  defaults for everything else (default `validateStatus`, so a non-2xx final response is raised as an `AxiosError` and the caller gets
  no response: `status` null, `library_says.error_response_status` carries the status the error held; default JSON response parsing, so
  `bytes` and `sha256` are of the string the caller got or of `JSON.stringify(data)` for a parsed body). The interceptor retries once
  with PAYMENT-SIGNATURE on a 402 and passes the second response through. `library_says` as for x402-fetch-v2.

- **x402-fetch-v1** (`x402-fetch` `wrapFetchWithPayment(fetch, wallet)`, `wallet` a viem wallet client on Base Sepolia over `privateKeyToAccount(key)`; its transport is never used): the v1 API takes a signer and no
  network list, so none is registered; the library's selector and its default `maxValue` (100000 atomic units, 0.1 USDC) apply and the
  harness sets nothing. It parses the 402 JSON body (`x402Version`, `accepts`), never the PAYMENT-REQUIRED header, and pays with
  X-PAYMENT. `redirect: "manual"` is the only departure from a user's call. `library_says`: the decoded X-PAYMENT-RESPONSE
  (`decodeXPaymentResponse`).
- **x402-axios-v1** (`x402-axios` `withPaymentInterceptor(axios.create({maxRedirects: 0}), account)`): as x402-fetch-v1 with axios's defaults
  for status handling and response parsing (a non-2xx final response is raised as an `AxiosError`; `bytes`/`sha256` as for x402-axios-v2).

- **thirdweb-x402** (`thirdweb/x402` `wrapFetchWithPayment(fetch, client, wallet)`): a placeholder client id, a wallet adapter on Base Sepolia over a local
  private-key account, no `maxValue`, library defaults. The library makes requests of its own to thirdweb hosts (contract metadata, RPC);
  they do not pass the recorder. `library_says` only says whether the final response carried a receipt header (the library has no decoder).
- **faremeter-fetch** (`@faremeter/fetch` `wrap(fetch, {handlers: [createPaymentHandler(wallet)]})`, wallet from `createLocalWallet({id: 84532, ...})`):
  on a second 402 the library repeats the whole unpaid/sign/paid sequence, three rounds in all, then throws `WrappedFetchError`
  (`library_says.error_response_status` is the status of the response it carries). No receipt decoder.
- **agentkit-x402** (`X402ActionProvider.makeHttpRequestWithX402(ViemWalletProvider, {url, method: "GET"})`): the action returns a JSON STRING,
  `{success, status, data, paymentProof}` or `{error: true, details}`, and never throws. The caller's "response" is that string, so `bytes`
  and `sha256` are of the string and `status` is the status it reports; on `{error: true}` the driver reports `status` null and `error`
  `AgentKitActionError` (the library did not raise; this is the driver's way of carrying the flag). `paymentProof` is never copied
  (only its key names). The library posts telemetry (public wallet address, network, action name) to cca-lite.coinbase.com when the wallet
  provider is built and on every action call: left at its default, not disabled, and named in the HELLO configuration. A failed telemetry
  request is an unhandled rejection that would end the process, so the driver installs an `unhandledRejection` no-op; it does not
  suppress the call. Its requests to Coinbase do not pass the recorder.

### Python (`py-clients.py`)

Both run under `python -I` (no user site, no `PYTHON*` variables, no script directory on the path). The proxy variables are removed
before any library is imported. The signer is `EthAccountSigner(Account.from_key(key))`; the client is registered with
`register_exact_evm_client(client, signer, networks="eip155:84532")`, which (in the library's own code) registers the v2 scheme for that
network and the v1 scheme for each v1 network name whose chain id matches it (`base-sepolia`), hence `generation: "both"`. Everything else is
the library default, including its spend controls. `library_says`: `payment_created` and `selected` from `on_after_payment_creation`;
`creation_failed` from `on_payment_creation_failure` (the hook returns nothing); `receipt` from `get_payment_settle_response` on the final
response when it carries PAYMENT-RESPONSE or X-PAYMENT-RESPONSE; `cause` the class and message of the exception's `__cause__` or `__context__`.

- **x402-httpx**: `x402Client()`, `x402HttpxClient(client)` used as an async context manager, one `await get(url)`; httpx does not follow
  redirects by default. A response the library hands back (including a 402 after payment) is the caller's response; `PaymentError` is the
  library's exception for a payment it could not create.
- **x402-requests**: `x402ClientSync()`, `x402_requests(client).get(url, allow_redirects=False)`; requests returns every status as a response.

### Go (`gotool/`)

- **x402-go**: `x402.Newx402Client().Register("eip155:84532", evm.NewExactEvmScheme(signer, nil))` with the signer from
  `evmsigners.NewClientSignerFromPrivateKey(key)`, `x402http.WrapHTTPClientWithPayment(&http.Client{CheckRedirect: <no redirects>},
  Newx402HTTPClient(client))`, one `Get`. The v2 scheme only (no `RegisterV1`), so `generation: "v2"`; library defaults otherwise. The `*url.Error`
  the Go client returns for a failed payment is the `error` (its name is the Go type). `library_says` from `OnAfterPaymentCreation`,
  `OnPaymentCreationFailure` and `GetPaymentSettleResponse`.

### Self-test (`selftest.mjs`)

`loop` resends the same request with a fixed unsigned PAYMENT-SIGNATURE on every 402, at most 40 times. It signs nothing and needs no
key. It exists only to show a dry-run row `budget_exhausted: true` with 12 upstream requests and one recorder answer, and is not in
the roster.

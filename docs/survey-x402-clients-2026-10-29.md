# Survey of x402 client libraries for the `/402` witness family (2026-10-29, session 36)

Written by a survey agent against a local stand-in that serves the real `src/x402.js` handler on loopback with a stub facilitator (`scripts/x402-witness/standin.mjs`), plus documentation reads of github.com/x402-foundation/x402. No live request was sent to badhttp.dev and no payment was made anywhere. Every dry run used a throwaway key generated for the run. Paths to the scratch directory are elided as `$SCR`. This is the source every gated explanation about the `/402` clients on the site cites. Statements are descriptive: they say what a client sent and returned, not whether that is right.

Method. For each candidate: install into `$SCR`, write a driver of about fifteen lines that wraps one GET with the library's payment mechanism and a local private key registered for Base Sepolia (`eip155:84532`) only, run it once against each of the 18 cells with a 45 s cap, and count the requests with a logging reverse proxy placed between the client and the stand-in (it records method, path, which payment header the request carried, the response status, the server's warning header and whether a receipt header came back). A second run of the whole grid went through a proxy that rewrites `resource.url` in the PAYMENT-REQUIRED header to `https://badhttp.dev/402/...` while the client requested a loopback origin, to imitate the live capture. Mechanism claims cite the installed source as `package/path:line`. Runtimes: Node v26.10.0, Python 3.14.7, Go 1.27.3. No Rust toolchain exists on the machine.

## 0. Summary

- Ten clients installed, signed a payment on `/402/pay` against the stand-in, and are recommended for the roster (section 1). Nine are libraries called from code, one is an agent-framework action, and none is a command-line program (section 3 says why).
- Nine of the ten return the HTTP response and decode the receipt only if the driver asks the library's helper to; the tenth (the agent action) returns a JSON string with the receipt decoded.
- The wire differs between clients in six places: which header carries the payment (`PAYMENT-SIGNATURE` or `X-PAYMENT`); whether the client reads the PAYMENT-REQUIRED header, the v1 body, or both; whether a spending limit exists by default; how many times it signs after a second 402 (once, or three times); whether it signs when `extra` or `resource` is missing; and whether it signs for an offer on a network it was not given.
- No client compared `resource.url` with the URL it had requested. With the rewritten header all ten still paid `/402/pay` (section 2.11).
- Two libraries put extra request headers on the paid retry: the TypeScript clients add `Access-Control-Expose-Headers`, the Python requests client adds `Payment-Retry: 1`.
- Three installation facts the harness author needs: the Go module moved from `github.com/coinbase/x402/go` to `github.com/x402-foundation/x402/go` and has no tagged release; `x402-axios@1.2.1` (npm `latest`) cannot be installed because its dependency `x402@^1.2.1` is not published (the highest published `x402` is 1.2.0); the Python package needs the `[evm]` extra or the signer import raises.

## 1. Roster

Cell keys used in section 2: `req` = requests that reached the origin, `S` = a payment header was sent (`PS` PAYMENT-SIGNATURE, `XP` X-PAYMENT), `-` = none.

| id | name | library and version installed | generation | class | runtime | install dir |
|---|---|---|---|---|---|---|
| `x402-fetch-v2` | @x402/fetch | `@x402/fetch` 2.29.0 + `@x402/evm` 2.29.0 + `@x402/core` 2.29.0 (npm latest 2026-10-29; the repo's `node_modules` has 2.23.0) | v2 (reads v1 body too) | sdk-fetch | Node | `$SCR/npm` |
| `x402-axios-v2` | @x402/axios | `@x402/axios` 2.29.0 over axios 1.21.0 and the same core and evm 2.29.0 | v2 (reads v1 body too) | sdk-http | Node | `$SCR/npm` |
| `thirdweb-x402` | thirdweb `thirdweb/x402` | `thirdweb` 5.122.0 | both | sdk-fetch | Node | `$SCR/npm` |
| `x402-fetch-v1` | x402-fetch | `x402-fetch` 1.2.0 over `x402` 1.2.0 | v1 | sdk-fetch | Node | `$SCR/npm-v1` |
| `x402-axios-v1` | x402-axios | `x402-axios` 1.1.0 over `x402` 1.2.0 (1.2.1 not installable) | v1 | sdk-http | Node | `$SCR/npm-v1` |
| `faremeter-fetch` | Faremeter fetch | `@faremeter/fetch` 0.22.0 + `@faremeter/payment-evm` 0.22.0 + `@faremeter/wallet-evm` 0.22.0 | both | sdk-fetch | Node | `$SCR/npm-misc` |
| `agentkit-x402` | Coinbase AgentKit x402 action | `@coinbase/agentkit` 0.10.4 (resolves `@x402/fetch` 2.29.0) | v2 (through @x402/fetch) | agent-wrapper | Node | `$SCR/npm-misc` |
| `x402-httpx` | x402 (Python) httpx | `x402` 2.26.0, `httpx` 0.28.1 | both | sdk-http | Python 3.14 | `$SCR/venv` |
| `x402-requests` | x402 (Python) requests | `x402` 2.26.0, `requests` 2.34.2 | both | sdk-http | Python 3.14 | `$SCR/venv` |
| `x402-go` | x402 Go client | `github.com/x402-foundation/x402/go` v0.0.0-20260529172747-45d81d46e5bd | both (v1 needs a separate registration) | sdk-http | Go | `$SCR/go` |

Install commands (each in a fresh empty directory):

```
x402-fetch-v2, x402-axios-v2, thirdweb-x402:
  npm init -y && npm install @x402/fetch @x402/evm @x402/core @x402/axios axios thirdweb viem
x402-fetch-v1, x402-axios-v1:
  npm init -y && npm install x402-fetch viem axios && npm install x402-axios@1.1.0
faremeter-fetch, agentkit-x402:
  npm init -y && npm install @faremeter/fetch @faremeter/payment-evm @faremeter/wallet-evm @coinbase/agentkit viem
x402-httpx, x402-requests:
  python3 -m venv venv && venv/bin/pip install "x402[evm,httpx,requests]"
x402-go:
  go mod init x && go get github.com/x402-foundation/x402/go@latest && go mod tidy && go build -o gox .
```

Configuration string for every row of a client (names what the harness handed the client, nothing about what happened; no option departs from the library's defaults in any of them):

| id | `configuration` |
|---|---|
| `x402-fetch-v2` | `Base Sepolia (eip155:84532) registered with registerExactEvmScheme; signer: a local private key (viem account); library defaults` |
| `x402-axios-v2` | `Base Sepolia (eip155:84532) registered with registerExactEvmScheme; signer: a local private key (viem account); library defaults` |
| `thirdweb-x402` | `wallet adapter on Base Sepolia (chain 84532) over a local private key account; placeholder client id; no maxValue; library defaults` |
| `x402-fetch-v1` | `signer: a viem wallet client on Base Sepolia (eip155:84532) over a local private key account; library defaults` |
| `x402-axios-v1` | `signer: a viem wallet client on Base Sepolia (eip155:84532) over a local private key account; library defaults` |
| `faremeter-fetch` | `EVM exact payment handler for chain 84532 over a local private key wallet; default asset USDC; library defaults` |
| `agentkit-x402` | `ViemWalletProvider on Base Sepolia over a local private key account; makeHttpRequestWithX402; library defaults` |
| `x402-httpx` | `Base Sepolia (eip155:84532) registered with register_exact_evm_client; signer: a local private key (eth_account); library defaults` |
| `x402-requests` | `Base Sepolia (eip155:84532) registered with register_exact_evm_client; signer: a local private key (eth_account); library defaults` |
| `x402-go` | `Base Sepolia (eip155:84532) registered for the v2 exact scheme; signer: a local private key; library defaults` |

Two of the v1 drivers exist in two forms. A bare local account and a wallet client bound to Base Sepolia produced the same grid; the wallet-client form is how the v1 libraries are told which network to use (`x402-fetch/dist/esm/index.mjs:24`, `x402-axios/dist/esm/index.mjs:33` derive the network from `walletClient.chain`), so the configuration above names it.

### Default spending limits, as found

| client | default limit | where |
|---|---|---|
| @x402/fetch, @x402/axios, AgentKit | USD 1 per payment on default assets, plus a default-asset allowlist | `@x402/core/dist/esm/client/index.mjs:21` (`DEFAULT_MAX_AMOUNT_PER_PAYMENT = "$1"`), `:519-520` |
| x402 Python (both) | USD 1 per payment | `x402/client_base.py:185`, `:267` |
| x402-fetch v1 | 0.1 USDC (`BigInt(0.1 * 10 ** 6)`) | `x402-fetch/dist/esm/index.mjs:15`, `:30-32` |
| x402-axios v1 | none | `x402-axios/dist/esm/index.mjs:15-49` has no amount check |
| thirdweb | none unless `maxValue` is passed | `thirdweb/dist/esm/x402/fetchWithPayment.js:85-88` tests `options?.maxValue !== undefined` |
| Faremeter | none | `@faremeter/fetch/dist/src/internal.js:68-73` hands the offer to the handlers; `@faremeter/payment-evm/dist/src/exact/client.js:39-45` signs `requirements.amount` |
| x402 Go | none | no amount check in `http/client.go:160-278` or `client.go:228-262` |

## 2. Per-client mechanism and dry-run grid

### 2.1 Dry-run grid (all 18 cells, 10 clients)

Cell = `req · signed · what the caller got`. `200`, `402`, `500`, `504` = the caller received a response with that status and the library did not raise. `R:name` = the library raised that class to the caller. Messages are in the per-client text. A run was capped at 45 s; none came near it (the longest was the 8 s `slow` cell, and the Python httpx run which stopped at 5 s).

| cell | x402-fetch-v2 | x402-axios-v2 | thirdweb | x402-fetch-v1 | x402-axios-v1 |
|---|---|---|---|---|---|
| pay | 2 · PS · 200 | 2 · PS · 200 | 2 · PS · 200 | 2 · XP · 200 | 2 · XP · 200 |
| never | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 | 2 · XP · 402 | 2 · XP · R:AxiosError (402) |
| reject | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 | 2 · XP · 402 | 2 · XP · R:AxiosError (402) |
| slow | 2 · PS · 504 | 2 · PS · R:AxiosError (504) | 2 · PS · 504 | 2 · XP · 504 | 2 · XP · R:AxiosError (504) |
| crash | 2 · PS · 500 | 2 · PS · R:AxiosError (500) | 2 · PS · 500 | 2 · XP · 500 | 2 · XP · R:AxiosError (500) |
| bad-receipt | 2 · PS · 200 | 2 · PS · 200 | 2 · PS · 200 | 2 · XP · 200 | 2 · XP · 200 |
| overpriced | 1 · - · R:Error | 1 · - · R:Error | 2 · PS · 402 | 1 · - · R:Error | 2 · XP · R:AxiosError (402) |
| wrong-network | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:ZodError | 1 · - · R:ZodError |
| broken/not-base64 | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:DOMException | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/not-json | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:SyntaxError | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/no-accepts | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/empty-accepts | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/no-extra | 1 · - · R:Error | 1 · - · R:Error | 2 · PS · 402 | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/no-resource | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/version-99 | 1 · - · R:Error | 1 · - · R:Error | 2 · PS · 402 | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/decimal-amount | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:Error | 1 · - · R:TypeError | 1 · - · R:TypeError |
| broken/missing-header | 1 · - · R:Error | 1 · - · R:Error | 2 · PS · 402 | 1 · - · R:ZodError | 1 · - · R:ZodError |
| broken/v1-body | 2 · XP · 402 | 2 · XP · 402 | 2 · XP · 402 | 2 · XP · 402 | 2 · XP · R:AxiosError (402) |

| cell | faremeter-fetch | agentkit-x402 | x402-httpx | x402-requests | x402-go |
|---|---|---|---|---|---|
| pay | 2 · PS · 200 | 2 · PS · string success | 2 · PS · 200 | 2 · PS · 200 | 2 · PS · 200 |
| never | 6 · PS ×3 · R:WrappedFetchError (402) | 2 · PS · string success:false 402 | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 |
| reject | 6 · PS ×3 · R:WrappedFetchError (402) | 2 · PS · string success:false 402 | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 |
| slow | 2 · PS · 504 | 2 · PS · string success:false 504 | 2 · PS · R:PaymentError (ReadTimeout at 5 s) | 2 · PS · 504 | 2 · PS · 504 |
| crash | 2 · PS · 500 | 2 · PS · string success:false 500 | 2 · PS · 500 | 2 · PS · 500 | 2 · PS · 500 |
| bad-receipt | 2 · PS · 200 | 2 · PS · string success, proof `{raw}` | 2 · PS · 200 | 2 · PS · 200 | 2 · PS · 200 |
| overpriced | 6 · PS ×3 · R:WrappedFetchError (402) | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 2 · PS · 402 |
| wrong-network | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/not-base64 | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/not-json | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/no-accepts | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/empty-accepts | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/no-extra | 6 · PS ×3 · R:WrappedFetchError (402) | 1 · - · string error | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 |
| broken/no-resource | 1 · - · R:Error | 2 · PS · string success:false 402 | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 |
| broken/version-99 | 1 · - · R:Error | 1 · - · string error | 2 · PS · 402 | 2 · PS · 402 | 2 · PS · 402 |
| broken/decimal-amount | 1 · - · R:SyntaxError | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 1 · - · R:url.Error |
| broken/missing-header | 1 · - · R:Error | 1 · - · string error | 1 · - · R:PaymentError | 1 · - · R:PaymentError | 2 · PS · 402 |
| broken/v1-body | 6 · XP ×3 · R:WrappedFetchError (402) | 2 · XP · string success:false 402 | 2 · XP · 402 | 2 · XP · 402 | 1 · - · R:url.Error |

"string" in the agentkit column: the action returns a JSON string (`{success, status, data, paymentProof}` or `{error: true, details}`) and never raises. In the x402-httpx `slow` cell the paid request did reach the origin (the 504 arrived after the client had given up), so `req` is 2; the recorder will see it as an exchange the caller never received. On the live host the same will happen after the 5 s read timeout.

Messages the callers received (first 150 characters, as printed by the drivers):

- @x402/fetch and @x402/axios (the same strings; `Error`): `Failed to parse payment requirements: Invalid payment required header` (not-base64); `... Unexpected token 'p', "payment re"... is not valid JSON` (not-json); `Failed to create payment payload: Cannot read properties of undefined (reading 'filter')` (no-accepts); `... No network/scheme registered for x402 version: 2 which comply with the payment requirements. {...}` (empty-accepts, wrong-network); `... EIP-712 domain parameters (name, version) are required in payment requirements for asset 0x036C...` (no-extra); `... No client registered for x402 version: 99`; `... Cannot convert 0.01 to a BigInt` (decimal-amount); `Failed to parse payment requirements: Invalid payment required response` (missing-header); `... All payment requirements were rejected by spendControls.maxAmountPerPayment ($1, including USDC). Raise maxAmountPerPayment, set it to false to disable, set allowedAs...` (overpriced).
- thirdweb: `Invalid character` (DOMException, not-base64); `402 response has no usable x402 payment requirements.` (no-accepts); `No valid payment requirements found in server 402 response. undefined` (empty-accepts); `Invalid payment requirements: amount must be an integer string in base units` (decimal-amount); `No supported payment authorization methods found on 0x8335...2913 on chain eip155:424242` (wrong-network, after two outbound requests, section 5).
- x402-fetch v1 and x402-axios v1: `Payment amount exceeds maximum allowed` (fetch only, overpriced); a `ZodError` whose first issue is `invalid_enum_value` with `received: "eip155:424242"` (wrong-network) or `"eip155:84532"` (missing-header), because the v1 network enum lists names such as `base-sepolia`; `TypeError: Cannot read properties of undefined (reading 'map')` whenever the 402 body has no `accepts`.
- Faremeter: `failed to decode PAYMENT-REQUIRED header` (not-base64 and not-json), `couldn't parse v2 payment required response: accepts must be an array (was missing)`, `... resource must be an object (was missing)`, `... x402Version must be 2 (was 99)`, `no applicable payers found` (empty-accepts, wrong-network), `couldn't parse v1 payment required response: accepts[0].description must be a string (was missing),...` (missing-header), `failed to complete payment after retries` (`WrappedFetchError`, `e.response` is the last 402).
- Python: always `PaymentError("Failed to handle payment: ...")` with the cause on `__cause__`: `Incorrect padding` (not-base64), `Expecting value: line 1 column 1 (char 0)` (JSONDecodeError, not-json), `1 validation error for PaymentRequired / accepts / Field required` (no-accepts), `No payment requirements match registered schemes` (`NoMatchingRequirementsError`, empty-accepts and wrong-network), `All payment requirements were rejected by spend_controls.max_amount_per_payment ($1, including USDC)...` (overpriced), `invalid literal for int() with base 10: '0.01'` (decimal-amount), `Invalid payment required response` (missing-header).
- Go (`*url.Error`, message prefixed `Get "<url>": `): `failed to decode V2 header: invalid base64 encoding: ...` (not-base64), `... invalid payment required JSON: invalid character 'p' ...` (not-json), `cannot fulfill V2 payment requirements: unsupported_scheme: no supported payment schemes available` (no-accepts, empty-accepts, wrong-network), `failed to create V2 payment: invalid_exact_evm_client_amount: 0.01` (decimal-amount), `cannot fulfill V1 payment requirements: unsupported_scheme: ...` (v1-body).

### 2.2 @x402/fetch 2.29.0 (`x402-fetch-v2`)

Driver form:

```js
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(KEY), networks: ['eip155:84532'] });
const f = wrapFetchWithPayment(fetch, client);
const r = await f(url);
```

- Header or body. `getPaymentRequiredResponse` reads `PAYMENT-REQUIRED`; with no header it accepts the body only when `x402Version === 1`, else throws `Invalid payment required response` (`@x402/core/dist/esm/chunk-4NCAR6KR.mjs:2257-2266`). A header that is not base64 throws `Invalid payment required header` (`:2414-2418`). The wrapper catches these and rethrows `Failed to parse payment requirements: ...` (`@x402/fetch/dist/esm/index.mjs:27-42`). A body that is not JSON is ignored (`:31-36`).
- Selection. `selectPaymentRequirements` keeps accepts whose network and scheme are registered (`@x402/core/dist/esm/client/index.mjs:436-452`), then applies spend controls (`:466`), then policies, then prefers `authorization` flow, then calls the selector, which by default returns `accepts[0]` (`:74`, `:483`). A version with no registration throws `No client registered for x402 version: N` (`:253-257`).
- Spending limit. Default USD 1 on default assets (`:21`, `:519-520`); the error text names `spendControls.maxAmountPerPayment` (`:565`).
- Retries. Exactly one paid retry: `fetch(clonedRequest.clone())` once (`@x402/fetch/dist/esm/index.mjs:75`). A second 402 is handed back, with the body read to a cap (`:103`, `capReturnedPaymentRequired` `:6-16`). A recovery path re-signs once more only when a registered hook returns `recovered` (`:81-102`); no hook is registered by default, so `never` and `reject` produced two requests.
- Headers added to the paid retry: `PAYMENT-SIGNATURE` and `Access-Control-Expose-Headers: PAYMENT-RESPONSE,X-PAYMENT-RESPONSE` (`:68-74`).
- PAYMENT-RESPONSE. `processPaymentResult` decodes the header inside a `try` that swallows any error (`chunk-4NCAR6KR.mjs:2305-2310`), so an undecodable receipt never reaches the caller; the wrapper returns the `Response` unchanged. `getPaymentSettleResponse` is available to the caller and threw `Invalid payment response header` on the `bad-receipt` cell and `Payment response header not found` when none came (`:2273-2284`, `:2427`). The driver's `library_says` can use it.
- Resource URL. `response.url || request.url` is passed to the optional `handlePaymentRequired` hook only (`@x402/fetch/dist/esm/index.mjs:43-44`); `resource.url` is not compared with the request URL.
- Dry-run notes. `no-resource` signed: the client did not require `resource` to build the payload. `no-extra` raised before signing because the EVM scheme needs `extra.name` and `extra.version` (`@x402/evm/dist/esm/chunk-KWP3UD2B.mjs:71`). `v1-body` signed with `X-PAYMENT` from the body's v1 requirement (`chunk-4NCAR6KR.mjs:2262-2264`). The `overpriced` and `wrong-network` cells raised before any payment header went out, so the stand-in never sent its warning header.

### 2.3 @x402/axios 2.29.0 (`x402-axios-v2`)

Same core, same wire: the grid differs from @x402/fetch only in what the caller sees. It is a roster entry for that reason and because it uses a different HTTP stack (axios 1.21.0, user agent `axios/1.21.0`).

```js
const client = new x402Client(); registerExactEvmScheme(client, { signer, networks: ['eip155:84532'] });
const ax = wrapAxiosWithPayment(axios.create(), client);
const r = await ax.get(url);
```

- A response interceptor handles a 402 that axios turned into an error (`@x402/axios/dist/esm/index.mjs:74-92`). The retry config marks `__is402Retry`, and its `validateStatus` accepts 402 so a second 402 resolves as a normal response (`:59-71`, `:135-136`); any other non-2xx on the paid retry (500, 504) is raised as `AxiosError` by axios itself.
- The v1 body is read from `error.response.data` (`:102-103`); the same `getPaymentRequiredResponse` applies.
- Headers on the paid retry: `PAYMENT-SIGNATURE` and `Access-Control-Expose-Headers` (`:134-140`). `resolveAxiosRequestUrl` hands the URL to the hook only (`:111-112`).
- Receipts: not decoded for the caller; the response headers are available lower-cased.

### 2.4 thirdweb 5.122.0, `thirdweb/x402` (`thirdweb-x402`)

Driver form:

```js
const client = createThirdwebClient({ clientId: 'placeholder' });
const account = privateKeyToAccount({ client, privateKey: KEY });          // thirdweb/wallets
const wallet = createWalletAdapter({ client, adaptedAccount: account, chain: baseSepolia, onDisconnect: async () => {}, switchChain: async (c) => {} });
const f = wrapFetchWithPayment(fetch, client, wallet);                       // thirdweb/x402
```

- Header or body. Reads `payment-required` first, `response.json()` otherwise (`thirdweb/dist/esm/x402/fetchWithPayment.js:59-63`); `parsePaymentRequired` throws when `accepts` is not an array (`x402/schemas.js:97-102`) and takes the version from the payload when it is a number (`:106`, `fetchWithPayment.js:65`). It signed `version-99` and `missing-header`: the header name follows the version (`x402/headers.js:9-12`, `PAYMENT-SIGNATURE` for anything but 1), and the v2 body is read when the header is absent.
- Selection. Without a selector: the requirement whose chain equals the wallet's chain, otherwise `paymentRequirements[0]` and a chain switch (`fetchWithPayment.js:159-173`, `:94-100`).
- Spending limit. None unless `options.maxValue` is set (`:85-88`).
- Retries. One paid retry (`:123`), marked by `__is402Retry` in the init object (`:56-58`, `:121`). A second 402 is returned after the cached signature is cleared (`:125-133`).
- Receipts: not decoded.
- Resource URL: `parsed.resourceUrl` comes from `resource.url`, falling back to the request URL (`x402/schemas.js:103-104`), and goes into the payload; it is not compared.
- It signs only after resolving the token's authorization methods from a contract ABI fetched from a thirdweb service (section 5); in `wrong-network` that lookup failed and the call raised.

### 2.5 x402-fetch 1.2.0 (`x402-fetch-v1`) and x402-axios 1.1.0 (`x402-axios-v1`)

```js
const f = wrapFetchWithPayment(fetch, createWalletClient({ account, chain: baseSepolia, transport: http(url) }));   // x402-fetch
const ax = withPaymentInterceptor(axios.create(), walletClient);                                                    // x402-axios
```

- Body only. Both do `const { x402Version, accepts } = await response.json()` (`x402-fetch/dist/esm/index.mjs:22`, `x402-axios/dist/esm/index.mjs:31`) and never read the `PAYMENT-REQUIRED` header. They signed `pay` because `/402/pay`'s body carries the v1 form of the requirement; every cell whose body has no `accepts` raised `TypeError` (`reading 'map'`) before any signing. `PaymentRequirementsSchema.parse` rejects v2 CAIP-2 network names with a `ZodError` (`:23`, `:32`), which is what `wrong-network` and `missing-header` produced.
- Selection. `selectPaymentRequirements(accepts, network, "exact")` from `x402/client` with the network taken from the wallet client's chain (`x402-fetch :24-29`, `x402-axios :33-34`).
- Limit. x402-fetch: 0.1 USDC default, thrown as `Payment amount exceeds maximum allowed` (`:15`, `:30-32`). x402-axios 1.1.0: no limit; `overpriced` was signed.
- Retries. One paid retry; `__is402Retry` stops a second (`x402-fetch :39-41,:49-51`; `x402-axios :28-30,:41-44`). x402-fetch hands back a second 402; x402-axios rejects it as `AxiosError` (axios treats 402 as an error, and the interceptor does not unwrap it).
- Header: `X-PAYMENT` plus `Access-Control-Expose-Headers: X-PAYMENT-RESPONSE` (`x402-fetch :44-48`, `x402-axios :42-43`). The server answers a v1 payment with `X-PAYMENT-RESPONSE`; the library exports `decodeXPaymentResponse` but the wrapper does not call it.
- Installation. `npm install x402-axios` (latest, 1.2.1) fails with ETARGET because it depends on `x402@^1.2.1` and npm's `x402` ends at 1.2.0; 1.1.0 (dependency `^1.1.0`) installs and resolved `x402` 1.2.0, the same core as x402-fetch 1.2.0.

### 2.6 Faremeter 0.22.0 (`faremeter-fetch`)

```js
const wallet = await createLocalWallet({ id: 84532, name: 'base-sepolia' }, KEY);        // @faremeter/wallet-evm
const f = wrap(fetch, { handlers: [createPaymentHandler(wallet)] });                       // @faremeter/fetch, @faremeter/payment-evm/exact
```

- Header or body. `PAYMENT-REQUIRED` present: base64 and JSON decoded, then validated with arktype (version must be 2); absent: the body is parsed as v1 with a lenient schema (`@faremeter/fetch/dist/src/internal.js:36-66`). So `missing-header` (a v2 body) failed the v1 schema.
- Selection. Each handler returns the matching requirements; the chooser takes the first (`:15-24`, `:68-72`). No network registration exists: the handler is bound to a wallet's chain and the USDC address for it (`payment-evm/dist/src/exact/client.js:17-23`).
- Spending limit: none; the handler signs `requirements.amount` (`:39-45`), and when `extra` is absent it falls back to the asset's default EIP-712 name and version (`:47-63`), which is why `no-extra` was signed.
- Retries. The whole sequence (unpaid request, sign, paid request) is repeated: `attempt = retryCount ?? 2` plus one, with a 100 ms delay doubling each time, whenever the paid request is also a 402 (`@faremeter/fetch/dist/src/fetch.js:72-82`). Three signed payments were sent on `never`, `reject`, `overpriced`, `no-extra` and `v1-body`. After the last, it throws `WrappedFetchError` carrying the 402 response, unless `returnPaymentFailure` is set (`:83-86`).
- Header: `PAYMENT-SIGNATURE` for a v2 offer, `X-PAYMENT` for v1 (`fetch.js:66-68`); no CORS header added.
- Receipts: not decoded. The request URL is passed to handlers as context and not compared with `resource.url`.

### 2.7 Coinbase AgentKit 0.10.4, x402 action provider (`agentkit-x402`)

```js
const wp = new ViemWalletProvider(createWalletClient({ account, chain: baseSepolia, transport: http(anyUrl) }));
const out = await new X402ActionProvider().makeHttpRequestWithX402(wp, { url, method: 'GET' });   // JSON string
```

- It wraps `@x402/fetch`'s `wrapFetchWithPayment` (`@coinbase/agentkit/dist/action-providers/x402/x402ActionProvider.js:309`) with an `x402Client` on which the wallet's signer is registered with no network list (`:369-379`), so the wire is @x402/fetch's.
- Behaviour it adds: the caller receives a JSON string, never an exception (`:298-363`, errors through `handleHttpError` in `utils.js:296-320`); `success` is true only for status 200 (`:339-355`); a `PAYMENT-RESPONSE` or `X-PAYMENT-RESPONSE` header is base64-decoded and JSON-parsed into `paymentProof`, with `{raw}` when that fails (`:325-337`; the `bad-receipt` cell produced `{raw}`).
- `wrong-network` was refused by the default spend controls (`only default assets or entries in spendControls.allowedAssets are allowed`) because the wildcard registration covers the network but the asset on `eip155:424242` is not a default asset.
- Not a CLI and not a fetch: the unit is an agent action. The wallet provider and the action decorator send telemetry (section 5).

### 2.8 x402 Python 2.26.0, httpx and requests (`x402-httpx`, `x402-requests`)

```python
c = x402Client()                                                                 # x402ClientSync for requests
register_exact_evm_client(c, EthAccountSigner(Account.from_key(KEY)), networks="eip155:84532")
async with x402HttpxClient(c) as h: r = await h.get(url)                          # or: x402_requests(c).get(url)
```

- `register_exact_evm_client` registers the v2 scheme for the named network and the v1 scheme for every v1 network name that matches it (`x402/mechanisms/evm/exact/register.py:27-76`).
- Header or body. `get_payment_required_response`: header first, then a body with `x402Version == 1` (`x402/http/x402_http_client_base.py:121-150`); the base64 and JSON errors come from the decoder.
- Selection. Filter to registered schemes, apply spend controls, policies, then the selector, default `requirements[0]` (`x402/client_base.py:331`; spend limit `:185`, `:267`).
- Retries. One paid retry. httpx: a request extension marks the retry and a second 402 is capped and returned (`x402/http/clients/httpx.py:102`, `:139`, `:172-173`, `:218`); recovery re-signs once only when a hook recovers (`:226-247`). requests: a `Payment-Retry: 1` request header marks the paid retry (`x402/http/clients/requests.py:52`, `:110`, `:194`), so the paid request carries that header on the wire.
- Failures: any exception during handling, including a failed signing, becomes `PaymentError("Failed to handle payment: ...")` with `__cause__` (`httpx.py:252-253`, `requests.py:233`).
- Receipts: not decoded for the caller. The receipt helper `get_payment_settle_response` exists on `x402HTTPClient` (sync twin `x402HTTPClientSync`).
- Difference between the two: httpx inherits httpx's default timeout of 5 s (`httpx/_config.py:246`; `x402HttpxClient.__init__` hands only `transport` and `**kwargs` to httpx, `httpx.py:421-434`), so on `slow` the paid request was sent and the caller got `PaymentError` with `ReadTimeout`; requests has no default timeout and returned the 504 after 8 s. The paid request of requests also carries `Payment-Retry: 1`. Everything else was the same in all 18 cells.
- Resource URL: passed to hooks as `str(response.url)`; not compared.

### 2.9 x402 Go (`x402-go`)

```go
signer, _ := evmsigners.NewClientSignerFromPrivateKey(key)
client := x402.Newx402Client().Register("eip155:84532", evm.NewExactEvmScheme(signer, nil))
hc := x402http.Newx402HTTPClient(client)
resp, err := x402http.WrapHTTPClientWithPayment(http.DefaultClient, hc).Get(url)
```

- A `RoundTripper` (`http/client.go:146-278`; `RoundTrip` at `:160`). It reads `PAYMENT-REQUIRED` if present (version 2), else parses the body's `x402Version` (1 or 2) (`:436-466`), so a v2 body without the header is read as v2 (`missing-header` signed). A v1 offer needs a v1 scheme registered (`RegisterV1`); with only the v2 scheme registered, as in the library's quick start (`CLIENT.md`), `v1-body` raised `unsupported_scheme`.
- Selection. Filter to registered scheme and network, apply policies, `DefaultPaymentSelector` returns the first (`client.go:228-262`, `types.go:166-171`). No spending limit.
- Retries. One paid retry; `retryCount` is a per-request counter and a limit of one (`:168`); a second 402 is returned to the caller (`:239-241` returns the paid response unless a hook recovered it). Errors come back as `*url.Error` from `http.Client`.
- Receipts: `dispatchPaymentResponseHooks` treats a header that does not decode as non-fatal (`:310-312`); `GetPaymentSettleResponse` is available (`:92`) and returned `invalid base64 encoding` on `bad-receipt`.
- Module path and version. `go get github.com/coinbase/x402/go` fails (`module declares its path as: github.com/x402-foundation/x402/go`); the module has no tagged version, so the roster version is the pseudo-version above. `go mod tidy` is required before `go build`. Header on the paid retry: `PAYMENT-SIGNATURE` only; user agent `Go-http-client/1.1`.

### 2.10 What every client does with the stand-in's `pay` receipt

All ten delivered a 200 and the body on `pay`. The library's own helper decoded the receipt for @x402/fetch, @x402/axios, Python (both) and Go. The v1 libraries received `X-PAYMENT-RESPONSE`, which `decodeXPaymentResponse` decodes (network reported as `base-sepolia`, the v1 name). thirdweb and Faremeter returned the response with the receipt header present and offer no decoder in the wrapper. AgentKit surfaced the decoded object as `paymentProof`.

### 2.11 Resource URL comparison

The second proxy rewrote `resource.url` to `https://badhttp.dev/402/pay` while the clients requested a loopback origin. All ten clients still paid `/402/pay` (one unpaid request, one paid request, 200). No source read in 2.2 to 2.9 compares `resource.url` with the request URL. thirdweb and the Go client copy `resource` into the payload; @x402/fetch and @x402/axios pass the request URL to an optional hook that is not registered by default. The v1 libraries read `resource` from the requirement and forward it in the signed payload without comparing. This was checked with the header rewritten; the v1 libraries read the body, which the proxy did not rewrite, so for them the source reading above is the evidence.

## 3. Exclusions (`not_in_roster`)

| candidate | printable reason |
|---|---|
| `@x402/mcp` 2.29.0 (about 10,600 downloads a week) | pays tool calls made through an MCP client and server, so it cannot be pointed at an HTTP GET of one URL |
| `mcpay` 0.1.17 (about 240) | an SDK and command-line proxy for MCP servers with payments; it depends on `x402-fetch` and takes an MCP server, not a URL |
| `agentcash` 0.17.1 command-line client (about 1,200) | its networks are `base`, `solana` and `tempo` (the only EVM chain id in its source is `eip155:8453`), it keeps its wallet in a file under the user's home directory and defaults to a USD 5 limit; it has no Base Sepolia network, so it cannot sign any cell of the grid |
| `@circle-fin/x402-batching` 4.0.0 (about 23,000) | its `GatewayClient.pay()` signs only an offer that advertises Circle Gateway batching; against `/402/pay` it raised `No Gateway batching option available for network eip155:84532` after one unpaid request and signed nothing, and no cell advertises that option |
| `x402-safe-fetch` 0.9.0 (about 980) | pays a USD 0.001 pre-flight check to a third-party service before it pays any endpoint, so it sends the target URL to that service |
| `@alchemy/x402` 0.6.6 (about 660) | built for the Alchemy gateway; its `pay` command takes a PAYMENT-REQUIRED header as an argument rather than fetching a URL |
| `@acedatacloud/x402-client` (about 320) | supplies signatures to one vendor's SDK and is not a client of its own |
| `@atxp/x402`, `@b3dotfun/anyspend-x402-fetch`, `@fastxyz/x402-client`, `@payai/x402-fetch`, `@mingderwang/x402`, `@obul.ai/obulx`, `@bankofai/x402-cli` (each under 130 downloads a week) | too few downloads to represent what developers use; not surveyed beyond their descriptions |
| `@coinbase/x402` 2.1.0 (about 98,000) | the package's own description calls it the Coinbase facilitator package; it configures a facilitator and is not a client |
| `x402-reqwest` 2.0.2 and `x402-rs` (Rust; about 2,500 and 760 downloads over 90 days) | needs a Rust toolchain this machine lacks |
| `purl` (Rust command-line client, a few dozen release downloads) | ships only as a Rust program; this survey did not build or run it |
| `x402-axios` 1.2.1 (npm `latest`) | cannot be installed: its dependency `x402@^1.2.1` is not on npm (the roster uses 1.1.0) |

Wrapper entry points that share a roster entry's code path are not separate clients: Python's `wrapHttpxWithPayment` and `x402_httpx_hooks` use the same code as `x402HttpxClient`, and `wrapRequestsWithPayment` the same as `x402_requests`.

A class `cli` entry is therefore missing from the roster. The two command-line clients found (`agentcash`, `purl`) cannot be run in a way that yields a row. The control `curl-raw` stays the only command-line row.

## 4. What the x402 v2 specification says a client does

Sources (read 2026-10-29):

- Core: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md (last commit 51a0664c2b, 2026-10-26)
- HTTP transport: https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md (last commit 58a5d7d321, 2026-10-22)
- Exact scheme on EVM: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
- The v1 specification: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v1.md (not read in full)

The steps, quoted:

1. Core, section 2: "**Client Request**: Client makes a request to a resource server". "**Payment Required Response**: If no valid payment is attached, the server responds with a payment required signal and payment requirements". "**Payment Authorization Request**: Client submits a signed payment authorization in the subsequent request". "**Settlement Response**: Server verifies the payment authorization and initiates blockchain settlement".
2. HTTP transport, Payment Required Signaling: "The server indicates payment is required using the HTTP 402 'Payment Required' status code." "**Mechanism**: HTTP 402 status code with `PAYMENT-REQUIRED` header. **Data Format**: Base64-encoded `PaymentRequired` schema in header". "The `PAYMENT-REQUIRED` header is the canonical HTTP transport location for the `PaymentRequired` object."
3. HTTP transport, Payment Payload Transmission: "Clients send payment data using the `PAYMENT-SIGNATURE` HTTP header." "**Data Format**: Base64-encoded `PaymentPayload` schema".
4. Core, section 5.2.2: `PaymentPayload` fields `x402Version` (required), `resource` (optional), `accepted` ("PaymentRequirements object indicating the payment method chosen", required), `payload` (required). The EVM authorization carries `from`, `to`, `value`, `validAfter`, `validBefore`, and "`nonce` ... 32-byte random nonce to prevent replay attacks".
5. Core, section 5.1.2: `PaymentRequired` requires `x402Version` ("must be 2"), `resource` and `accepts`; each requirement has `scheme`, `network` (CAIP-2), `amount` ("Required payment amount in atomic token units", a string), `asset`, `payTo`, `maxTimeoutSeconds`; `extra` is optional. This is what the `no-extra`, `no-resource`, `no-accepts`, `empty-accepts`, `version-99` and `decimal-amount` flavors depart from.
6. Core, section 6.1: "Clients MUST NOT construct a payment for a `paymentFlow` they do not recognize, and SHOULD skip such `accepts[]` entries when selecting. When a resource offers both `authorization` ... and a pre-handler-settlement flow ... clients SHOULD prefer `authorization`." Exact EVM: "If no `assetTransferMethod` is specified in `PaymentRequired.extra`, clients should default to `"eip3009"`."
7. HTTP transport, Settlement Response Delivery: "Servers communicate payment settlement results using the `PAYMENT-RESPONSE` header." "**Data Format**: Base64-encoded `SettlementResponse` schema". Core 5.3.2: `success` and `transaction` and `network` are required; `transaction` is "empty string if no transaction was broadcast". The failure example is a 402 carrying `PAYMENT-RESPONSE` with `success: false` and an `errorReason`.
8. Core, section 9: "When matching specific error conditions, clients MUST use the corresponding `invalidReason` or `errorReason` code and MUST NOT rely on message text."
9. HTTP transport, Error Handling table: Payment Required 402; Invalid Payment 400; "Payment Failed 402 Payment verification or settlement failed"; "Server Error 500 Internal server error during payment processing"; Success 200.

What it says about the matters the parser's reference rests on:

- Spending limits: nothing normative. The scope list says "**Out of Scope**: ... Client-side budget management". HTTP transport, browsers section: "the decision to spend belongs to whatever holds the payer's signing key."
- Retries: nothing. The flow is one request, one payment retry. No clause says what a client does after a 402 that follows a payment, after a 500 or 504, or when PAYMENT-RESPONSE does not decode.
- Resource URL: `resource.url` is "URL of the protected resource" (5.1.2) and the payload's `resource` is optional (5.2.2); no clause tells the client to compare it with the request.
- Client headers: the HTTP transport section notes that "a release of the TypeScript clients put `Access-Control-Expose-Headers`, a response-only directive, on the paid retry", and calls that "a client defect, to be fixed in the client". The survey records the header being present on the TypeScript clients at 2.29.0 and does not judge it.
- v1: the PAYMENT-REQUIRED header and PAYMENT-SIGNATURE are the v2 names; v1 used the body and `X-PAYMENT` / `X-PAYMENT-RESPONSE` (the HTTP transport names the v1 spellings under CORS, "`X-PAYMENT` ... `X-PAYMENT-RESPONSE`").

## 5. Hazards for the harness author

1. **Install locations and runtimes.** Use the four npm directories, the venv and the Go module as in section 1. `PATH` needs `/opt/homebrew/bin` for `node`, `npm`, `python3` and `go`. Node drivers are ESM (`.mjs`) and must live in the directory that holds `node_modules`. Run Node drivers with `NODE_OPTIONS=--no-warnings`; thirdweb and AgentKit print an `ExperimentalWarning` about `localStorage` to stderr.
2. **Key handling.** Every driver reads the key from the environment. None of the libraries printed it in any message seen, but the Python signer constructor and the thirdweb account factory take the key as a plain string: catch and scrub their exceptions, and never print `process.env` or `os.environ`.
3. **Outbound requests the recorder does not see.**
   - thirdweb: `GET https://contract.thirdweb.com/abi/<chainId>/<asset>` before it signs, on every cell that reaches signing, and for `wrong-network` also `POST https://424242.rpc.thirdweb.com/<clientId>`, which answered 401 with a placeholder client id and printed `Error resolving contract ABI` to stderr (`thirdweb/dist/esm/x402/common.js:101`; domains in `utils/domains.js`). The calls carry no key and no payment; they do name the token contract and the chain. A real thirdweb client id would be needed for anything else. The harness should say on the index that thirdweb contacts its own services.
   - AgentKit: `POST https://cca-lite.coinbase.com/amp` with the wallet address, network id and action name, when the wallet provider is built (`dist/wallet-providers/walletProvider.js:25-33`) and on every action call (`dist/action-providers/actionDecorator.js:45-55`); there is no switch to turn it off. When that request fails (a sandbox, no network) the rejection is unhandled and kills the Node process, so the driver must install `process.on('unhandledRejection', () => {})` (the dry-run driver does). The project's Base Sepolia payer address is already public, but the lead should decide whether to send it to a vendor on every cell; dropping `agentkit-x402` leaves nine clients.
4. **Proxies.** Python (`requests`, `httpx`), axios and Go (through `http.DefaultTransport`) read `HTTP_PROXY`, `ALL_PROXY` and friends from the environment; Node's built-in `fetch` does not. Unset them for every driver, and set `NO_PROXY` to the loopback host as a second guard.
5. **Timeouts that differ from the harness caps.** Python httpx: 5 s read timeout, so `slow` ends in `PaymentError`/`ReadTimeout` at 5 s while the origin is still holding the request; its 504 lands at the recorder after `RESULT` and is counted in `exchanges_after_result`. Others have no timeout shorter than 45 s. `slow` takes 8 s to answer for every other client.
6. **Process exit and the event loop.** The dry-run drivers for thirdweb, Faremeter, AgentKit and the Circle probe call `process.exit(0)` after printing their result; they were not tested without it, so the production drivers should exit explicitly on `QUIT`. The Go binary and the Python scripts exit by themselves.
7. **Async and loops.** Only Faremeter repeats signing (three paid requests per cell, 6 upstream requests); the 12-request recorder budget is never reached by any of the ten. None looped. `agentkit-x402` made its two requests inside one action call.
8. **Return shapes the driver must normalise.** @x402/fetch, thirdweb, x402-fetch v1 and Faremeter return a `Response`; @x402/axios and x402-axios return an axios response object and raise `AxiosError` for 500, 504 and (v1 only) 402; Python httpx returns `httpx.Response` and requests returns `requests.Response`; Go returns `*http.Response` and `*url.Error`; AgentKit returns a JSON string. For the `RESULT` line: `status` is null when the library raised; for AgentKit it is the `status` inside the string, and an `error: true` string should be recorded as the library's claim, not as a raise (the library did not raise).
9. **Receipt reading.** Only AgentKit decodes a receipt on its own. For the others the driver may call the library's helper after the call (`getPaymentSettleResponse` / `get_payment_settle_response` / `GetPaymentSettleResponse` / `decodeXPaymentResponse`) and put the result in `library_says`; the helpers throw on a missing or undecodable header, which is itself a fact to record. The parser decodes the header on the wire, so `library_says` stays the library's claim.
10. **Version strings for `HELLO`.** Read them from the installed packages (`node_modules/<pkg>/package.json`, `importlib.metadata.version('x402')`, `go list -m`), not from the table above. The Go version is a pseudo-version; record it whole.
11. **Extra request headers** worth a column in the driver README: `Access-Control-Expose-Headers` on the paid retry (@x402/fetch, @x402/axios, thirdweb, AgentKit, x402-fetch v1, x402-axios v1; absent in Faremeter, Python httpx, Go), `Payment-Retry: 1` (Python requests). User agents seen: Node `fetch` sends `node`, axios `axios/1.21.0`, `python-httpx/0.28.1`, `python-requests/2.34.2`, `Go-http-client/1.1`.
12. **Both header spellings.** v1 libraries send `X-PAYMENT`, and on `pay` the server answers them with `X-PAYMENT-RESPONSE`. On `bad-receipt` the stand-in's reply to an `X-PAYMENT` request carried both `PAYMENT-RESPONSE` and an `X-PAYMENT-RESPONSE` that the v1 helper could not decode; check the live reply before writing prose about which header was present.
13. **Cells where the wire is a function of the client's version support**: `x402-fetch-v1` and `x402-axios-v1` sign `pay` and `v1-body` only; they never read `PAYMENT-REQUIRED`. `x402-go` signs `v1-body` only if `RegisterV1` is called; the roster configuration does not call it.
14. **No `eip155:8453` and no `?network=`.** None of the drivers registers mainnet; AgentKit's wildcard registration still refused the unknown-chain asset through its spend controls, but a future version may not. Keep the payer key for Base Sepolia test USDC only.
15. **Go build.** `go mod tidy` downloads many modules and needs the module proxy; build once and run the binary. The dry-run binary reads the key from `K`; the production driver should read `X402_WITNESS_PAYER_KEY`.
16. **Pacing.** A grid took roughly 10 to 35 s per client against the stand-in, most of it the 8 s `slow` cell plus start-up per cell.

Dry-run drivers and the logging proxy are in the scratch directory (`$SCR/npm/*.mjs`, `$SCR/npm-v1/*.mjs`, `$SCR/npm-misc/{fm,ak2}.mjs`, `$SCR/py/*.py`, `$SCR/go/main.go`, `$SCR/proxy.mjs`, `$SCR/grid.sh`) and are not part of the repository.

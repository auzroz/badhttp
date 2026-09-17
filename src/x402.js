// The /402 range: one paywall that works, and a set that misbehave on purpose.
//
// Protocol: x402, both generations at once (https://github.com/x402-foundation/x402). Dual-form since v0.8.0:
//   v2 (shapes from @x402/core 2.23.0; the canonical envelope, in headers):
//     402 response  -> header PAYMENT-REQUIRED: base64(JSON PaymentRequired{x402Version:2, resource, accepts[], error?})
//     paid request  -> header PAYMENT-SIGNATURE: base64(JSON PaymentPayload{x402Version:2, resource?, accepted, payload:{signature, authorization}})
//     receipt       -> header PAYMENT-RESPONSE: base64(JSON SettleResponse{success, transaction, network, payer, ...})
//   v1 (shapes from x402@1.2.0 / spec x402-specification-v1.md; requirements travel in the 402 JSON body, plain
//   network names, maxAmountRequired instead of amount; the v2 spec cedes the body to the server, and the v2
//   reference client reads the body only when the header is absent AND body.x402Version === 1, so both forms
//   coexist in one response without conflict):
//     402 response  -> body {x402Version:1, error, accepts:[{scheme, network:"base"|"base-sepolia", maxAmountRequired,
//                      resource, description, mimeType, payTo, maxTimeoutSeconds, asset, extra:{name, version}}]}
//     paid request  -> header X-PAYMENT: base64(JSON {x402Version:1, scheme, network, payload:{signature, authorization}})
//     receipt       -> header X-PAYMENT-RESPONSE: base64(JSON SettleResponse)
//   The inner EIP-3009 payload is byte-identical across versions; only the wrapper differs. If both payment
//   headers arrive, PAYMENT-SIGNATURE wins and X-PAYMENT is ignored (never a fallback: the sender picks one parser).
// Settlement is done by a facilitator (POST /verify, POST /settle, body {x402Version, paymentPayload,
// paymentRequirements} with version-matched shapes; facilitators dispatch on paymentPayload.x402Version at the same
// paths). Only /402/pay ever talks to one. Every other scenario here is stateless and never contacts a facilitator,
// so nothing is ever charged by them.

const USDC = {
  // name/version are the token contract's EIP-712 domain, read from chain (name(), version()) on 2026-08-23.
  'base': { caip2: 'eip155:8453', chainId: 8453, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2', label: 'Base mainnet', real: true, explorer: 'https://basescan.org/tx/' },
  'base-sepolia': { caip2: 'eip155:84532', chainId: 84532, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2', label: 'Base Sepolia (testnet)', real: false, explorer: 'https://sepolia.basescan.org/tx/' },
};
const DEFAULT_NETWORK = 'base-sepolia';

// Facilitators, in order of preference. Overridable with the X402_FACILITATORS_{BASE,BASE_SEPOLIA} vars (comma-separated).
// Surveyed 2026-08-23 (LEDGER.md #2). Credential-free on both Base networks: xpay (zero fee, no cap, verify 100/min,
// settle 50/min, young), Mogami (no fee, AGPL server), PayAI (oldest and biggest, but 1,000 lifetime free settlements
// per receiving wallet, then an API key). Coinbase's x402.org facilitator is Sepolia-only without CDP keys. Heurist is
// mainnet-only and slow. OpenX402 rejects unregistered payTo addresses (5 USDC + a wallet signature to register: not us).
const DEFAULT_FACILITATORS = {
  'base': ['https://facilitator.xpay.sh', 'https://v2.facilitator.mogami.tech', 'https://facilitator.payai.network', 'https://facilitator.heurist.xyz'],
  'base-sepolia': ['https://x402.org/facilitator', 'https://facilitator.xpay.sh', 'https://v2.facilitator.mogami.tech', 'https://facilitator.payai.network'],
};
// v1 payments need a facilitator whose /supported advertises x402Version 1 kinds for the network. Probed live
// 2026-08-26: xpay and PayAI carry v1 on both Base networks, Heurist on mainnet only, x402.org on Sepolia only;
// Mogami is v2-only, so it is absent here. Overridable with X402_V1_FACILITATORS_{BASE,BASE_SEPOLIA}.
const DEFAULT_V1_FACILITATORS = {
  'base': ['https://facilitator.xpay.sh', 'https://facilitator.payai.network', 'https://facilitator.heurist.xyz'],
  'base-sepolia': ['https://x402.org/facilitator', 'https://facilitator.xpay.sh', 'https://facilitator.payai.network'],
};
// A verify rejection for one of these reasons is the facilitator declining us, not the payment being bad: try the next one.
const FACILITATOR_SIDE_REJECTION = /not_registered|unsupported|not_supported|rate_limit|unavailable/i;

// What has actually been exercised, so the docs never claim more. Update when settlement is first observed.
export const VERIFIED = {
  as_of: '2026-09-17',
  first_external_payment: 'On 2026-09-01 at 21:32:11 UTC a payer that is not this project settled /402/pay/base for the first time: 0.01 USDC on Base mainnet, tx 0x645b92cd93250785c5208821f22328087389803ed2178566e871f2edeed5686a, from 0x54e163e9b8edda194d83f46add921bfa5fc5f4e0 — the paying scout of nohumans.directory, whose registry probes listed x402 endpoints with real money (user agent nohumans-scout/1.0). Booked as revenue on /books with its tx hash; the first revenue this site has earned',
  first_external_testnet_payment: 'On 2026-09-16 at 08:51:40 UTC a payer that is not this project settled /402/pay (Base Sepolia, test USDC, no dollar value) for the first time: 0.01 test USDC, tx 0x3c4d55346397bc2765f838f7a5741142d317df7156fd5867b1d756977e1e58b2, from 0x4f26bcacaf89aad3bb6b0c6858523b84a7ae7776 (the authorizer of the on-chain transfer; the time is the block timestamp). Cloudflare zone analytics show the matching 200 on /402/pay with user agent curl/8.21.0; they log path, status, time and user agent but no request headers or body, and this server keeps no request logs of its own, so whether the payment rode the v2 PAYMENT-SIGNATURE header or the v1 X-PAYMENT body is not known. Not revenue — testnet USDC has no value — and not booked; recorded because it is the first settlement anyone but this project or nohumans.directory has ever completed against this host',
  exercised: 'SETTLEMENT, end to end on BOTH networks, both client generations against production (2026-08-28). Base Sepolia (test USDC): v2 official @x402/fetch 2.23.0 — tx 0xf35d92c571e4af086b8cf01d87e242e94d6406fff46c5a3c15cbcf787ec31a0c; v1 legacy x402-fetch 1.2.0 via the body and X-PAYMENT — tx 0x0b6b47a003f84096bf59971d665509be2ba54ee467d70dec7c6e5450dffacd62 (both settled by x402.org). Base mainnet (real USDC, a self-test: the payer is project-controlled and the 0.02 USDC moved between our own addresses — booked on /books as working capital, not revenue): v2 tx 0x8a331a0a28a26d290984c34bd12ae03bdc31603856b4e46bace3d2045cddc089; v1 tx 0x629b1a478e88c8be043ee0e8ebac67169a386192fde388b9a616fc850b5010b8 (both settled by xpay). Receipts arrived in PAYMENT-RESPONSE (v2) and X-PAYMENT-RESPONSE (v1) and decoded success:true every time',
  not_yet_exercised: 'a second external payer on MAINNET (one stranger has paid on Base Sepolia, above, where the money is not real); a v1 (X-PAYMENT) payment known to be from anyone other than this project; a direct USDC transfer (a donation) rather than an x402 settlement',
};

export const X402_LIMITS = { minUsd: 0.001, maxUsd: 1, defaultUsd: 0.01, maxTimeoutSeconds: 300, verifyTimeoutMs: 10_000, settleTimeoutMs: 45_000, slowMaxSeconds: 10 };

const b64 = {
  encode: (obj) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(obj)), (b) => String.fromCharCode(b)).join('')),
  decode: (s) => {
    const bin = atob(s.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  },
};

function usdToAtomic(usd) {
  return String(Math.round(usd * 1_000_000));
}

function requirements({ network, amountUsd, payTo, net = USDC[network] }) {
  return {
    scheme: 'exact',
    network: net.caip2,
    asset: net.asset,
    amount: usdToAtomic(amountUsd),
    payTo,
    maxTimeoutSeconds: X402_LIMITS.maxTimeoutSeconds,
    extra: { name: net.name, version: net.version, assetTransferMethod: 'eip3009' },
  };
}

// caip2 -> plain v1 network name ("eip155:8453" -> "base"). v1 clients validate network against a closed enum of
// plain names; CAIP-2 in a v1 body crashes them (nohumans.directory's own /sellers example makes that mistake).
const V1_NETWORK = Object.fromEntries(Object.entries(USDC).map(([k, v]) => [v.caip2, k]));

// One v2 requirement -> its x402 v1 twin, so the two forms can never drift: every value is derived from the same
// req object the PAYMENT-REQUIRED header carries. Returns null when the network has no v1 name (wrong-network's
// eip155:424242): that scenario has no expressible v1 form. Rules the legacy client (x402@1.2.0 zod) enforces
// beyond the spec: resource must be an absolute URL, description and mimeType are REQUIRED (the spec table says
// optional), maxTimeoutSeconds must be a number. outputSchema must be OMITTED, never null (z.record().optional()
// rejects null — and the ledger's undefined-vs-null trap says omit means omit). extra is exactly the EIP-712
// domain {name, version}: no assetTransferMethod, which is a v2 concept.
function toV1(req, { resource, description }) {
  const network = V1_NETWORK[req.network];
  if (!network) return null;
  return {
    scheme: 'exact',
    network,
    maxAmountRequired: req.amount,
    // `amount` is the v2 spelling, aliased here for body-only classifiers (x402-trust flags the body
    // "v1-envelope" and asks for an amount field; session 12's paid report). The legacy client's zod
    // (x402@1.2.0 PaymentRequirementsSchema) verifiably strips unknown keys, so v1 clients are unaffected.
    amount: req.amount,
    resource,
    description,
    mimeType: 'application/json',
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    asset: req.asset,
    extra: { name: req.extra.name, version: req.extra.version },
  };
}

function paymentRequired({ url, description, accepts, error, resourceMeta, extensions }) {
  const pr = { x402Version: 2, resource: { url, description, mimeType: 'application/json', ...(resourceMeta || {}) }, accepts };
  if (extensions) pr.extensions = extensions;
  if (error) pr.error = error;
  return pr;
}

// Discovery metadata for /402/pay only (x402 "bazaar" extension, specs/extensions/bazaar.md). This server never sends
// it on its own; it is part of the v2 header. The official v2 client echoes `extensions` and `resource` back in its
// PaymentPayload, and /402/pay forwards that whole payload (echo included) to the facilitator's /verify and /settle,
// which is where a facilitator that runs a catalogue may list the resource. v1 clients echo nothing (their payload
// is exactly {x402Version, scheme, network, payload}), so this listing side effect only ever happens through v2
// payers. The input example is exactly the query the caller sent, so it reproduces resource.url; the output example
// is what a settled payment on that URL returns.
const SERVICE_META = { serviceName: 'badhttp', tags: ['testing', 'http', 'x402', 'edge-cases', 'developer-tools'] };
function bazaarExtension({ network, amountUsd, payTo, queryParams }) {
  const net = USDC[network];
  return {
    bazaar: {
      info: {
        input: { type: 'http', method: 'GET', ...(Object.keys(queryParams).length ? { queryParams } : {}) },
        output: {
          type: 'json',
          example: {
            paid: true, scenario: '/402/pay', network: net.caip2, network_name: network, real_money: net.real,
            amount_usd: amountUsd, amount_atomic: usdToAtomic(amountUsd), asset: net.asset, pay_to: payTo,
            payer: '0x0000000000000000000000000000000000000000', transaction: '0x' + '0'.repeat(64), explorer: `${net.explorer}0x${'0'.repeat(64)}`, facilitator: 'https://example.invalid',
          },
        },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
              queryParams: {
                type: 'object',
                properties: {
                  network: { type: 'string', enum: Object.keys(USDC), description: 'base-sepolia is test USDC (the default); base is real USDC on Base mainnet' },
                  amount: { type: 'string', pattern: '^\\d+(\\.\\d{1,6})?$', description: `price in USD, ${X402_LIMITS.minUsd}-${X402_LIMITS.maxUsd}, default ${X402_LIMITS.defaultUsd}` },
                },
              },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['type', 'method'],
            additionalProperties: false,
          },
          output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
        },
        required: ['input'],
      },
    },
  };
}

// Compare the requirement the client says it accepted with the one we issued (what @x402/core does before verifying):
// every core field, plus the EIP-712 domain in extra, since that is what the signature was made against.
function sameCore(a, b) {
  return Boolean(a && b && a.scheme === b.scheme && a.network === b.network && a.asset === b.asset && a.amount === b.amount && a.payTo === b.payTo && a.maxTimeoutSeconds === b.maxTimeoutSeconds
    && a.extra && typeof a.extra === 'object' && a.extra.name === b.extra.name && a.extra.version === b.extra.version);
}

// Cheap checks on the exact/EVM payload before any facilitator sees it: shape, recipient, amount, expiry.
// Junk costs one local 402 instead of four outbound calls, and recipient/amount no longer rest on the facilitator alone.
function checkExactEvmPayload(payload, req) {
  const inner = payload.payload;
  const a = inner && inner.authorization;
  if (typeof inner.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(inner.signature)) return 'payload.signature must be a 65-byte hex signature';
  if (!a || typeof a !== 'object') return 'payload.authorization is missing';
  for (const k of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']) if (typeof a[k] !== 'string') return `payload.authorization.${k} must be a string`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from) || !/^0x[0-9a-fA-F]{40}$/.test(a.to)) return 'payload.authorization.from/to must be addresses';
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return `payload.authorization.to must be ${req.payTo}`;
  if (!/^\d+$/.test(a.value) || a.value !== req.amount) return `payload.authorization.value must be exactly ${req.amount} (atomic units)`;
  if (!/^\d+$/.test(a.validAfter) || !/^\d+$/.test(a.validBefore)) return 'payload.authorization.validAfter/validBefore must be unix seconds as strings';
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validBefore) <= now) return 'payload.authorization.validBefore is already in the past';
  if (Number(a.validAfter) > now) return 'payload.authorization.validAfter is in the future';
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return 'payload.authorization.nonce must be 32 bytes of hex';
  return null;
}

const shown = (v) => (typeof v === 'string' ? v.slice(0, 80) : v === undefined ? '?' : JSON.stringify(v).slice(0, 80));

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: X402_LIMITS.defaultUsd };
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return { error: 'amount must be a decimal USD value with at most 6 decimals, e.g. 0.01' };
  const n = Number(raw);
  if (n < X402_LIMITS.minUsd || n > X402_LIMITS.maxUsd) return { error: `amount must be between ${X402_LIMITS.minUsd} and ${X402_LIMITS.maxUsd} USD` };
  return { value: n };
}

function parseNetwork(raw) {
  const name = raw ?? DEFAULT_NETWORK;
  if (!Object.hasOwn(USDC, name)) return { error: `network must be one of ${Object.keys(USDC).join(', ')}` };
  return { value: name };
}

// Reads the payment from either generation's header. PAYMENT-SIGNATURE (v2) wins when both are present, and a bad
// v2 header is an error, never a fallback to X-PAYMENT: the sender picked a parser and gets that parser's verdict.
// The result carries { version } even on errors so responses can name the right header back at the client.
function decodePaymentHeader(request) {
  // Presence is a null-check, not truthiness: Headers.get returns null for absent and '' for present-but-empty,
  // and the edge delivers `PAYMENT-SIGNATURE;` as an empty value — which must be a v2 parse error, never a silent
  // downgrade to the X-PAYMENT beside it.
  const v2 = request.headers.get('payment-signature');
  const v1 = request.headers.get('x-payment');
  if (v2 === null && v1 === null) return { none: true };
  const version = v2 !== null ? 2 : 1;
  const name = version === 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT';
  const raw = version === 2 ? v2 : v1;
  if (raw.length > 16 * 1024) return { error: `${name} header too large`, version };
  try {
    const p = b64.decode(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: `${name} did not decode to an object`, version };
    if (p.x402Version !== version) return { error: `x402Version ${JSON.stringify(p.x402Version)} does not belong in ${name}; that header carries x402 v${version}`, version };
    if (version === 2) {
      if (!p.accepted || typeof p.accepted !== 'object') return { error: 'PAYMENT-SIGNATURE is missing "accepted"', version };
    } else {
      if (p.scheme !== 'exact') return { error: `X-PAYMENT "scheme" must be "exact", got ${shown(p.scheme)}`, version };
      if (typeof p.network !== 'string') return { error: 'X-PAYMENT is missing "network" (a plain x402 v1 name, e.g. base-sepolia)', version };
    }
    if (!p.payload || typeof p.payload !== 'object') return { error: `${name} is missing "payload"`, version };
    return { value: p, version };
  } catch (e) {
    return { error: `${name} is not base64 JSON: ${e.message}`, version };
  }
}

async function callFacilitator(base, path, body, timeoutMs) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'badhttp/x402 (+https://badhttp.dev/402)' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  const verdictKey = path === '/verify' ? 'isValid' : 'success';
  // A JSON verdict is a verdict whatever the status: x402.rs answers 400 + {isValid:false}. Same rule as @x402/core.
  if (json && typeof json === 'object' && typeof json[verdictKey] === 'boolean') return json;
  const reason = json && typeof json === 'object' ? String(json.error || json.invalidReason || json.errorReason || json.message || '').slice(0, 200) : text.slice(0, 200);
  const err = new Error(`facilitator ${path} returned ${res.status}${reason ? `: ${reason}` : ''}${json ? '' : ' (not JSON)'}`);
  err.status = res.status;
  // 4xx without a verdict means this facilitator will not take the payload as sent; others will not either.
  err.terminal = res.status >= 400 && res.status < 500 && res.status !== 429;
  throw err;
}

function facilitatorsFor(network, env, version = 2) {
  const suffix = network.toUpperCase().replace(/-/g, '_');
  const key = version === 1 ? `X402_V1_FACILITATORS_${suffix}` : `X402_FACILITATORS_${suffix}`;
  const raw = env && typeof env[key] === 'string' ? env[key] : '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : (version === 1 ? DEFAULT_V1_FACILITATORS : DEFAULT_FACILITATORS)[network];
}

// ---------- scenarios ----------

export const SCENARIOS = {
  'pay': {
    title: 'A paywall that works',
    about: 'Returns 402 with x402 requirements in both generations at once: v2 in the PAYMENT-REQUIRED header, v1 in the JSON body (Base Sepolia unless you ask for mainnet with /402/pay/base or ?network=base). Send a valid PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) and the payment is verified and settled through a facilitator; you get a 200 with the transaction hash and a receipt in PAYMENT-RESPONSE (v2) or X-PAYMENT-RESPONSE (v1).',
    settles: true,
  },
  'never': {
    title: 'Never satisfied',
    about: 'Always 402, with perfectly valid requirements. Any PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) you send is ignored. Nothing is verified or settled. Does your client stop after one retry, or loop and re-sign forever?',
    settles: false,
  },
  'reject': {
    title: 'Your payment is invalid',
    about: 'Valid 402; then every payment is rejected with a 402 carrying an error (default insufficient_funds; pick another with ?reason=). Nothing is settled. A client should surface the reason and stop, not re-sign.',
    settles: false,
  },
  'slow': {
    title: 'Settlement takes forever',
    about: 'Valid 402; after you pay, the server sits on the request for ?seconds= (default 8, max 10) and then answers 504 with no receipt. In the real world you would not know whether you were charged. Here, nothing was.',
    settles: false,
  },
  'crash': {
    title: 'The server dies after you pay',
    about: 'Valid 402; after you pay, a 500 with no PAYMENT-RESPONSE. A real server might have settled before it crashed. This one never does. Does your client treat this as "paid" or "unpaid"?',
    settles: false,
  },
  'bad-receipt': {
    title: 'A receipt that does not parse',
    about: 'Valid 402; after you pay, a 200 whose receipt headers — PAYMENT-RESPONSE (v2) and X-PAYMENT-RESPONSE (v1) — are both garbage, not valid base64 JSON. Nothing was settled. Does your client still hand you the body, or throw it away because the receipt is bad?',
    settles: false,
  },
  'overpriced': {
    title: 'One million dollars, please',
    about: 'A valid 402 that asks for 1,000,000 USDC. A client with a spending limit should refuse to sign. If yours signs anyway, the response says so; the authorization is discarded and never settled. A less friendly server would have taken it.',
    settles: false,
  },
  'wrong-network': {
    title: 'A chain that does not exist',
    about: 'A valid-looking 402 whose only option is on eip155:424242, a chain nobody runs. A client should report "no supported network" and not sign. Nothing can be settled here by anyone.',
    settles: false,
  },
  'broken': {
    title: 'Malformed 402s',
    about: 'GET /402/broken lists the flavors: not-base64, not-json, no-accepts, empty-accepts, no-extra, no-resource, version-99, decimal-amount, missing-header, v1-body. Each is a 402 that a sloppy client will mis-parse.',
    settles: false,
  },
};

export const BROKEN = {
  'not-base64': { about: 'PAYMENT-REQUIRED is not base64.' },
  'not-json': { about: 'PAYMENT-REQUIRED is base64 of something that is not JSON.' },
  'no-accepts': { about: 'A PaymentRequired object with no "accepts" field at all.' },
  'empty-accepts': { about: '"accepts" is an empty list: nothing to pay with.' },
  'no-extra': { about: 'The requirement has no "extra" (no EIP-712 domain name/version), so the authorization cannot be signed correctly.' },
  'no-resource': { about: 'No "resource" object. The reference client treats it as optional and signs anyway; stricter clients refuse.' },
  'version-99': { about: 'x402Version is 99.' },
  'decimal-amount': { about: '"amount" is "0.01" instead of atomic units ("10000"). A client that does not validate will sign for 0.01 atomic units, i.e. nothing.' },
  'missing-header': { about: 'A 402 with v2-shaped requirements only in the JSON body (x402Version 2) and no PAYMENT-REQUIRED header. Genuinely broken: v2 keeps requirements in the header, and the reference client reads a body only when it says x402Version 1, so it finds nothing here.' },
  'v1-body': { about: 'A spec-valid x402 v1 response: requirements only in the JSON body (maxAmountRequired, plain-string network name), no PAYMENT-REQUIRED header. Not malformed — /402/pay serves this same v1 body underneath its v2 header — but a strictly header-only v2 client sees no requirements, which is the trap.' },
};

// ---------- handler ----------

export async function handle402({ seg, url, request, env, payTo, json, text }) {
  const scenario = seg[1] || '';
  if (!scenario) {
    return json({
      what: 'x402 payment flows, honest and otherwise',
      protocol: 'x402 v2 (header PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE) and x402 v1 (requirements in the 402 JSON body / X-PAYMENT / X-PAYMENT-RESPONSE) in the same responses; the wrong-network scenario is v2-only because v1 cannot name a chain outside its closed list',
      default_network: DEFAULT_NETWORK,
      networks: Object.fromEntries(Object.entries(USDC).map(([k, v]) => [k, { caip2: v.caip2, usdc: v.asset, real_money: v.real }])),
      pay_to: payTo,
      price: { default_usd: X402_LIMITS.defaultUsd, min_usd: X402_LIMITS.minUsd, max_usd: X402_LIMITS.maxUsd, param: 'amount' },
      facilitators: { note: '/402/pay forwards your PAYMENT-SIGNATURE (or X-PAYMENT) to the first of these that answers, in order; the v1 lists differ because not every facilitator speaks x402 v1', base: facilitatorsFor('base', env), 'base-sepolia': facilitatorsFor('base-sepolia', env), v1: { base: facilitatorsFor('base', env, 1), 'base-sepolia': facilitatorsFor('base-sepolia', env, 1) } },
      scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [`/402/${k}`, v.about])),
      only_this_one_settles: '/402/pay',
      pay_urls: Object.fromEntries(Object.keys(USDC).map((n) => [n, `/402/pay/${n}`])),
      verified: VERIFIED,
    });
  }
  if (!Object.hasOwn(SCENARIOS, scenario)) return json({ error: 'unknown scenario', scenarios: Object.keys(SCENARIOS).map((k) => `/402/${k}`) }, 404);
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return json({ error: 'method not allowed', hint: 'GET or POST the paywall; HEAD gets the 402 and never settles' }, 405, { allow: 'GET, HEAD, POST, OPTIONS' });
  // /402/pay/{network} is the path form of ?network=: one stable resource URL per network, so a catalogue can list
  // the mainnet paywall without the bare /402/pay (which stays testnet) being misdescribed. Other scenarios take no suffix.
  const pathNetwork = scenario === 'pay' ? seg[2] : undefined;
  if (scenario !== 'broken' && seg.length > (scenario === 'pay' ? 3 : 2)) return json({ error: 'not found', hint: scenario === 'pay' ? '/402/pay, /402/pay/base or /402/pay/base-sepolia' : `/402/${scenario} takes no path suffix` }, 404);
  if (pathNetwork !== undefined && !Object.hasOwn(USDC, pathNetwork)) return json({ error: 'unknown network', networks: Object.keys(USDC).map((n) => `/402/pay/${n}`) }, 404);
  if (pathNetwork !== undefined && url.searchParams.has('network') && url.searchParams.get('network') !== pathNetwork) return json({ error: `the path says ${pathNetwork} and ?network= says ${url.searchParams.get('network')}; pick one` }, 400);

  const netP = parseNetwork(pathNetwork ?? url.searchParams.get('network'));
  if (netP.error) return json({ error: netP.error }, 400);
  const amtP = parseAmount(url.searchParams.get('amount'));
  if (amtP.error) return json({ error: amtP.error }, 400);
  const network = netP.value;
  const net = USDC[network];
  const amountUsd = amtP.value;
  // Scenario parameters are validated before the first 402 so a client never signs against a URL that will then 400.
  const reason = (url.searchParams.get('reason') || 'insufficient_funds');
  if (scenario === 'reject' && !/^[a-z0-9_]{1,64}$/.test(reason)) return json({ error: 'reason must be snake_case, at most 64 characters' }, 400);
  const secondsRaw = url.searchParams.get('seconds') ?? '8';
  if (scenario === 'slow' && (!/^\d+(\.\d+)?$/.test(secondsRaw) || Number(secondsRaw) > X402_LIMITS.slowMaxSeconds)) return json({ error: `seconds must be 0–${X402_LIMITS.slowMaxSeconds}` }, 400);
  const seconds = Number(secondsRaw);
  // resource.url is rebuilt from the known parameters only, so a junk query cannot inflate the PAYMENT-REQUIRED header.
  const q = new URLSearchParams();
  if (pathNetwork === undefined && url.searchParams.has('network')) q.set('network', network);
  if (url.searchParams.has('amount')) q.set('amount', String(amountUsd));
  if (scenario === 'reject' && url.searchParams.has('reason')) q.set('reason', reason);
  if (scenario === 'slow' && url.searchParams.has('seconds')) q.set('seconds', secondsRaw);
  const resourceUrl = url.origin + `/402/${scenario}${pathNetwork !== undefined ? `/${pathNetwork}` : ''}` + (q.toString() ? `?${q}` : '');
  const description = `badhttp /402/${scenario}: ${SCENARIOS[scenario].title}`;

  // Exactly one network is offered: the default (Base Sepolia) unless ?network= says otherwise. A list all the same,
  // because settle() matches the client's "accepted" against whatever was offered. Session 3 tried offering both
  // networks at once on /402/pay and reverted it: the SDK's default client registers eip155:* and takes accepts[0]
  // regardless of where its USDC is, so a second entry helps nobody and would have made mainnet implicit.
  const offers = [{ network, net, req: requirements({ network, amountUsd, payTo }) }];
  const respond402 = (pr, body, extraHeaders = {}) => json(body, 402, { 'payment-required': b64.encode(pr), 'cache-control': 'no-store', ...extraHeaders });

  if (scenario === 'broken') return handleBroken({ seg, url, json, text, payTo, network, amountUsd, resourceUrl, description });

  const req = scenario === 'overpriced'
    ? requirements({ network, amountUsd: 1_000_000, payTo })
    : scenario === 'wrong-network'
      ? { ...requirements({ network: 'base', amountUsd, payTo }), network: 'eip155:424242' }
      : offers[0].req;
  const pr = scenario === 'pay'
    ? paymentRequired({ url: resourceUrl, description: `badhttp /402/pay: a real x402 v2 paywall for testing clients. Pay ${amountUsd} USDC on ${net.label} and get a 200 with a PAYMENT-RESPONSE receipt and the transaction hash. Nothing else is sold; sibling endpoints under /402 misbehave on purpose.${net.real ? '' : ' Test USDC; /402/pay/base is the same paywall for real USDC on Base mainnet.'}`, accepts: offers.map((o) => o.req), resourceMeta: SERVICE_META, extensions: bazaarExtension({ network, amountUsd, payTo, queryParams: Object.fromEntries(q) }) })
    : paymentRequired({ url: resourceUrl, description, accepts: [req] });

  // The 402 body is the x402 v1 envelope, derived from the same req the v2 header carries so the forms cannot
  // drift; the human-oriented fields ride along as extra keys, which v1 clients ignore (they destructure only
  // x402Version and accepts). wrong-network is the one scenario with no v1 form (toV1 returns null: eip155:424242
  // has no plain v1 name, and a made-up name would crash the v1 client's closed enum instead of teaching it to
  // refuse), so its body stays v2-shaped and says why.
  const v1desc = scenario === 'pay'
    ? `badhttp /402/pay: a real x402 paywall for testing clients. Pay ${amountUsd} USDC on ${net.label} and get a 200 with an X-PAYMENT-RESPONSE receipt and the transaction hash. Nothing else is sold; sibling endpoints under /402 misbehave on purpose.${net.real ? '' : ' Test USDC; /402/pay/base is the same paywall for real USDC on Base mainnet.'}`
    : description;
  const v1req = toV1(req, { resource: resourceUrl, description: v1desc });
  const humanBody = (pr, extra = {}) => ({
    error: pr.error || 'payment required',
    scenario: `/402/${scenario}`,
    ...(v1req
      ? {
        x402Version: 1,
        accepts: [v1req],
        how: 'This 402 says the same thing twice: x402 v2, base64-encoded in the PAYMENT-REQUIRED header, and x402 v1, as "accepts" in this body (plain network name, maxAmountRequired in atomic units). Sign an EIP-3009 transferWithAuthorization for one of "accepts" and retry with it base64-encoded in a PAYMENT-SIGNATURE header (v2) or an X-PAYMENT header (v1); the receipt comes back in PAYMENT-RESPONSE or X-PAYMENT-RESPONSE respectively.',
      }
      : {
        x402Version: 2,
        accepts: pr.accepts,
        how: 'Decode the PAYMENT-REQUIRED header (base64 JSON, x402 v2), sign an EIP-3009 transferWithAuthorization for one of "accepts", and retry with it base64-encoded in a PAYMENT-SIGNATURE header.',
        no_v1_form: 'this scenario cannot be said in x402 v1: its network has no v1 name, and a v1 client crashes parsing an unknown name instead of refusing it, which would be a different lesson',
      }),
    price: `${amountUsd} USDC on ${net.label}`,
    real_money: net.real,
    ...extra,
  });

  const paid = request.method === 'HEAD' ? { none: true } : decodePaymentHeader(request);
  const hdr = paid.version === 1 ? 'X-PAYMENT' : 'PAYMENT-SIGNATURE';
  if (paid.none) {
    const extra = {};
    if (scenario === 'overpriced') extra.price = '1000000 USDC. Your client should refuse.';
    if (scenario === 'wrong-network') extra.price = `${amountUsd} USDC on eip155:424242, which does not exist. Your client should refuse.`;
    if (scenario !== 'pay') extra.note = 'This scenario never settles anything.';
    return respond402(pr, humanBody(pr, extra));
  }
  if (paid.error) {
    if (scenario === 'never') return respond402(pr, humanBody(pr, { note: 'Still 402. This endpoint never accepts a payment.' }));
    return respond402({ ...pr, error: paid.error }, humanBody({ ...pr, error: paid.error }));
  }
  const payload = paid.value;

  switch (scenario) {
    case 'never':
      return respond402(pr, humanBody(pr, { note: `Still 402. Your ${hdr} was discarded unread. This endpoint never accepts a payment; a client that keeps retrying here will keep signing forever.` }), { 'x-badhttp-warning': 'this paywall never accepts' });
    case 'reject':
      return respond402({ ...pr, error: reason }, humanBody({ ...pr, error: reason }, { note: `Your payment was rejected with "${reason}". Nothing was verified or settled. Re-signing will not help.` }));
    case 'slow':
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return json({ error: 'settlement timed out', scenario: '/402/slow', waited_seconds: seconds, charged: 'unknown, as far as you can tell. In fact nothing was settled.' }, 504);
    case 'crash':
      return json({ error: 'unexpected error', message: 'the server fell over after receiving your payment', scenario: '/402/crash', charged: 'a real server might have settled first. This one never does.' }, 500);
    case 'bad-receipt':
      return json({ paid: 'allegedly', scenario: '/402/bad-receipt', note: 'The PAYMENT-RESPONSE and X-PAYMENT-RESPONSE headers on this response are garbage, whichever generation your client reads. Nothing was settled.' }, 200, { 'payment-response': '%%not-base64-json%%', 'x-payment-response': '%%not-base64-json%%', 'cache-control': 'private, no-store' });
    case 'overpriced':
      return respond402(
        { ...pr, error: 'not_settled' },
        humanBody({ ...pr, error: 'not_settled' }, { price: '1000000 USDC. Your client should have refused.', warning: `Your client signed an authorization for ${shown(payload?.payload?.authorization?.value)} atomic units (${req.amount} requested, i.e. 1,000,000 USDC) and sent it to a server it had no reason to trust. It was discarded and will never be settled; it expires within ${X402_LIMITS.maxTimeoutSeconds} seconds whether or not anyone keeps it. A different server would have kept it.`, signed_by: shown(payload?.payload?.authorization?.from) }),
        { 'x-badhttp-warning': 'your client signed for 1,000,000 USDC' },
      );
    case 'wrong-network':
      return respond402(
        { ...pr, error: 'unsupported_network' },
        humanBody({ ...pr, error: 'unsupported_network' }, { price: `${amountUsd} USDC on eip155:424242, which does not exist.`, real_money: undefined, warning: 'Your client signed a payment for a chain that does not exist. Nothing can settle it. It should have refused.' }),
        { 'x-badhttp-warning': 'your client signed for a nonexistent chain' },
      );
    case 'pay':
      return await settle({ payload, version: paid.version, v1req, offers, pr, amountUsd, env, json, respond402, humanBody });
    default:
      return json({ error: 'unreachable' }, 500);
  }
}

async function settle({ payload, version = 2, v1req, offers, pr, amountUsd, env, json, respond402, humanBody }) {
  // v2 clients echo the requirement they accepted; v1 payloads carry only scheme+network, so the match is against
  // what this 402 offered on that network. Either way the facilitator is then given OUR requirement, never the client's.
  const offer = version === 1
    ? offers.find((o) => payload.network === V1_NETWORK[o.req.network])
    : offers.find((o) => sameCore(payload.accepted, o.req));
  if (!offer) {
    const error = 'No matching payment requirements';
    const hint = version === 1
      ? `X-PAYMENT "network" must be exactly what this 402 offered: ${offers.map((o) => V1_NETWORK[o.req.network]).join(', ')} (plain x402 v1 name)`
      : 'The "accepted" requirement in your PAYMENT-SIGNATURE must match one of "accepts" from the 402: same scheme, network, asset, amount, payTo, maxTimeoutSeconds and extra.name/version.';
    return respond402({ ...pr, error }, humanBody({ ...pr, error }, { hint, you_sent: version === 1 ? payload.network : payload.accepted, charged: false }));
  }
  const { req, net, network } = offer;
  const addressUrl = `${net.explorer.replace('/tx/', '/address/')}${req.payTo}#tokentxns`;
  const shape = checkExactEvmPayload(payload, req);
  if (shape) {
    const error = 'invalid_exact_evm_payload';
    return respond402({ ...pr, error }, humanBody({ ...pr, error }, { hint: shape, charged: false }));
  }
  // Version-matched facilitator call, the x402-express pass-through pattern: a v1 payload goes out with the v1
  // twin of our requirement (facilitators dispatch on paymentPayload.x402Version at the same /verify and /settle).
  const body = version === 1
    ? { x402Version: 1, paymentPayload: payload, paymentRequirements: v1req }
    : { x402Version: 2, paymentPayload: payload, paymentRequirements: req };
  const receiptHeader = version === 1 ? 'x-payment-response' : 'payment-response';
  const receiptName = version === 1 ? 'X-PAYMENT-RESPONSE' : 'PAYMENT-RESPONSE';
  const facilitators = facilitatorsFor(network, env, version);
  let facilitator;
  let verify;
  const verifyErrors = [];
  for (const f of facilitators) {
    try {
      const v = await callFacilitator(f, '/verify', body, X402_LIMITS.verifyTimeoutMs);
      if (v.isValid === false && FACILITATOR_SIDE_REJECTION.test(String(v.invalidReason || ''))) {
        verifyErrors.push(`${f}: ${String(v.invalidReason).slice(0, 200)}`);
        continue;
      }
      verify = v;
      facilitator = f;
      break;
    } catch (e) {
      verifyErrors.push(`${f}: ${String(e.message).slice(0, 200)}`);
      if (e.terminal) {
        const error = 'facilitator_rejected_payload';
        return respond402({ ...pr, error }, humanBody({ ...pr, error }, { facilitator: f, detail: String(e.message).slice(0, 200), charged: false }));
      }
    }
  }
  if (!facilitator) {
    return json({ error: 'no facilitator reachable', scenario: '/402/pay', bug: true, charged: false, details: verifyErrors }, 502);
  }
  // A nonce that is already used means an earlier attempt with this same authorization was settled.
  const alreadyUsed = (reason) => /nonce|already_used|used_or_canceled|usedorcanceled/i.test(reason);
  if (!verify.isValid) {
    const error = String(verify.invalidReason || 'payment_invalid').slice(0, 100);
    return respond402({ ...pr, error }, humanBody({ ...pr, error }, {
      verified_by: facilitator,
      invalid_message: typeof verify.invalidMessage === 'string' ? verify.invalidMessage.slice(0, 400) : undefined,
      payer: verify.payer,
      signed_for: net.caip2,
      hint: /insufficient|balance|funds/i.test(error) ? `the payer has no USDC on ${net.label}; ${net.real ? 'to test for free use ?network=base-sepolia (the default) with test USDC' : 'a wallet funded on Base mainnet should request ?network=base'}` : undefined,
      charged: alreadyUsed(error) ? `probably yes, by an earlier attempt with this same authorization; check ${addressUrl}` : false,
    }));
  }
  let settled;
  try {
    settled = await callFacilitator(facilitator, '/settle', body, X402_LIMITS.settleTimeoutMs);
  } catch (e) {
    // The settle call failed or timed out after verification passed. The authorization may or may not have been broadcast.
    return json({ error: 'settlement outcome unknown', scenario: '/402/pay', facilitator, message: String(e.message).slice(0, 200), charged: 'unknown', hint: `check ${addressUrl}; do not re-sign until you have` }, 502);
  }
  const tx = typeof settled.transaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(settled.transaction) ? settled.transaction : undefined;
  if (!settled.success) {
    const error = String(settled.errorReason || 'settlement_failed').slice(0, 100);
    if (error === 'settlement_pending' && tx) {
      // Broadcast, not yet confirmed when the facilitator gave up waiting (spec: non-terminal, carries the hash).
      // Not a 402: re-paying would pay twice. 202 with the receipt header as the facilitator sent it.
      return json({ paid: 'pending', scenario: '/402/pay', network: net.caip2, transaction: tx, explorer: `${net.explorer}${tx}`, facilitator, charged: 'almost certainly; the transfer was broadcast and is awaiting confirmation', hint: 'do not pay again; watch the transaction' }, 202, { [receiptHeader]: b64.encode(settled), 'cache-control': 'private, no-store' });
    }
    return respond402({ ...pr, error }, humanBody({ ...pr, error }, {
      settled_by: facilitator,
      error_message: typeof settled.errorMessage === 'string' ? settled.errorMessage.slice(0, 400) : undefined,
      transaction: tx,
      charged: alreadyUsed(error) ? `probably yes, by an earlier attempt; check ${addressUrl}` : tx ? `unknown; a transaction was reported: ${net.explorer}${tx}` : false,
    }));
  }
  return json(
    {
      paid: tx ? true : 'unverified (facilitator reported success without a transaction hash)',
      scenario: '/402/pay',
      network: net.caip2,
      network_name: network,
      real_money: net.real,
      amount_usd: amountUsd,
      amount_atomic: req.amount,
      asset: req.asset,
      pay_to: req.payTo,
      payer: settled.payer || verify.payer,
      transaction: tx ?? null,
      explorer: tx ? `${net.explorer}${tx}` : undefined,
      facilitator,
      receipt_header: `${receiptName} (base64 JSON of the facilitator settle response)`,
      thanks: net.real ? `That is revenue. It is booked on /books the next time the books are updated (each session); verify it now at ${addressUrl}` : 'Test USDC; nothing real moved.',
    },
    200,
    { [receiptHeader]: b64.encode(settled), 'cache-control': 'private, no-store' },
  );
}

function handleBroken({ seg, url, json, text, payTo, network, amountUsd, resourceUrl, description }) {
  const flavor = seg[2];
  if (!flavor) return json({ flavors: Object.fromEntries(Object.entries(BROKEN).map(([k, v]) => [k, v.about])), usage: '/402/broken/{flavor}' });
  if (!Object.hasOwn(BROKEN, flavor)) return json({ error: 'unknown flavor', flavors: Object.keys(BROKEN) }, 404);
  const net = USDC[network];
  const req = requirements({ network, amountUsd, payTo });
  const pr = paymentRequired({ url: resourceUrl, description, accepts: [req] });
  const body = { error: 'payment required', scenario: `/402/broken/${flavor}`, broken: BROKEN[flavor].about, note: 'Nothing here ever settles.' };
  const out = (header, extraBody = {}) => json({ ...body, ...extraBody }, 402, { 'payment-required': header, 'cache-control': 'no-store', 'x-badhttp-flavor': flavor });
  switch (flavor) {
    case 'not-base64': return out('this is not base64 %%%');
    case 'not-json': return out(btoa('payment required, please'));
    case 'no-accepts': { const { accepts, ...rest } = pr; return out(b64.encode(rest)); }
    case 'empty-accepts': return out(b64.encode({ ...pr, accepts: [] }));
    case 'no-extra': { const { extra, ...r } = req; return out(b64.encode({ ...pr, accepts: [r] })); }
    case 'no-resource': { const { resource, ...rest } = pr; return out(b64.encode(rest)); }
    case 'version-99': return out(b64.encode({ ...pr, x402Version: 99 }));
    case 'decimal-amount': return out(b64.encode({ ...pr, accepts: [{ ...req, amount: String(amountUsd) }] }));
    case 'missing-header': return json({ ...body, ...pr }, 402, { 'cache-control': 'no-store', 'x-badhttp-flavor': flavor });
    case 'v1-body': {
      const v1 = {
        x402Version: 1,
        error: 'X-PAYMENT header is required',
        accepts: [{ scheme: 'exact', network, maxAmountRequired: req.amount, amount: req.amount, resource: resourceUrl, description, mimeType: 'application/json', payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, asset: req.asset, extra: { name: net.name, version: net.version } }],
      };
      return json(v1, 402, { 'cache-control': 'no-store', 'x-badhttp-flavor': flavor });
    }
    default: return json({ error: 'unreachable' }, 500);
  }
}

// POST /v1/chat/completions — the one thing on badhttp.dev that is for sale (session 37, 2026-10-29).
// Contract and reasons: docs/spec-v1-chat.md. Demand evidence: docs/research-x402-demand-2026-10-29.md.
//
// An OpenAI-compatible chat completion served by Workers AI, priced flat per request in USDC on Base and
// settled through x402 with the same machinery as /402/pay (two protocol generations, facilitator
// failover, CDP first). The order of operations is the whole correctness argument of a paid API and is
// enforced by settle()'s `deliver` hook: validate (400s are free) → 402 → facilitator /verify → run the
// model → facilitator /settle → 200. A model failure after a valid verify is answered 502 with
// `charged: false` and nothing is broadcast; a settlement failure after the model answered is answered
// as /402/pay answers it, with the completion included so a caller is never charged for nothing.
//
// This endpoint behaves. It is excluded from the corpus and from every witness family because it is not
// an edge case; it exists because thirty-six sessions of a free fixture earned $0.12 and the one category
// of repeat x402 demand this project can supply from what it already pays for is inference.
import { b64, USDC, requirements, toV1, paymentRequired, decodePaymentHeader, settle, usdToAtomic, SERVICE_META } from './x402.js';

export const V1 = {
  priceUsd: 0.002,
  network: 'eip155:8453',
  networkName: 'base',
  sandboxNetworkName: 'base-sepolia',
  models: [
    // gpt-oss is a reasoning model: on Workers AI it answers in OpenAI shape and spends output tokens thinking before any
    // text appears (the first mainnet self-test, 2026-10-29, asked for 120 tokens and got 120 tokens of reasoning and no text —
    // refused unsettled, as designed). It is asked for low reasoning effort unless the caller says otherwise.
    { id: 'gpt-oss-20b', cf: '@cf/openai/gpt-oss-20b', inputUsdPerM: 0.2, outputUsdPerM: 0.3, default: true, reasoning: true },
    { id: 'llama-3.1-8b-instruct-fp8-fast', cf: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', inputUsdPerM: 0.045, outputUsdPerM: 0.384, sandbox: true },
  ],
  // Content is capped in UTF-8 BYTES, not characters: a character can be one token or three, and the worst case the
  // cost basis below assumes is 0.75 tokens per byte (emoji; CJK runs about 0.4). At 8,000 bytes that is 6,000 input
  // tokens — about 2,000 for English text, which is what 8 KB of prompt usually is.
  caps: { maxMessages: 64, maxContentBytes: 8000, sandboxMaxContentBytes: 2000, maxTokensDefault: 512, maxTokensMax: 1024, sandboxMaxTokens: 64, maxBodyBytes: 64 * 1024, worstTokensPerByte: 0.75, typicalTokensPerByte: 0.25 },
  // Brakes on what the project can be made to pay for (review, session 37): one request at a time per payer
  // (per isolate, and per colo through the Cache API), and a ceiling on this isolate's estimated model spend per
  // rolling hour, after which it answers 503 before asking anyone for a signature.
  brakes: { perPayerLockSeconds: 30, isolateSpendUsdPerHour: 0.25 },
  costBasisReadOn: '2026-10-29',
  costBasisUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
  freeNeuronsPerDay: 10000,
  logging: 'This Worker keeps no log of prompts or completions (Workers invocation logs are off). The prompt is processed by Cloudflare Workers AI under Cloudflare\'s terms; the x402 payload goes to the facilitator exactly as on /402/pay; Cloudflare\'s edge keeps sampled request metadata as for every route.',
};

const ROLES = new Set(['system', 'user', 'assistant']);
const utf8 = new TextEncoder();

// Worst case at the caps, per model: the published cost basis beside the published price. `sandbox` uses the
// sandbox caps; `typical` the English-text ratio instead of the worst one.
export function worstCaseCostUsd(m, { sandbox = false, typical = false } = {}) {
  const bytes = sandbox ? V1.caps.sandboxMaxContentBytes : V1.caps.maxContentBytes;
  const outTok = sandbox ? V1.caps.sandboxMaxTokens : V1.caps.maxTokensMax;
  const inTok = bytes * (typical ? V1.caps.typicalTokensPerByte : V1.caps.worstTokensPerByte);
  return Math.round(((inTok * m.inputUsdPerM + outTok * m.outputUsdPerM) / 1e6) * 1e7) / 1e7;
}

// Brake 1: one request in flight per payer. The facilitator's /verify checks each authorization's balance alone, so a
// wallet holding one payment could sign many with distinct nonces, send them at once, have the model run for all and
// pay for one. Per isolate here; per colo through the Cache API below (both are soft locks, 30 s, released on settle).
const inflight = new Map();
const lockKey = (payer) => `https://badhttp.dev/__lock/v1/${String(payer).toLowerCase()}`;
async function acquire(payer) {
  const now = Date.now();
  const key = String(payer).toLowerCase();
  const until = inflight.get(key);
  if (until && until > now) return false;
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      const hit = await caches.default.match(new Request(lockKey(key)));
      if (hit) return false;
      await caches.default.put(new Request(lockKey(key)), new Response('1', { headers: { 'cache-control': `max-age=${V1.brakes.perPayerLockSeconds}` } }));
    }
  } catch { /* the cache is a courtesy lock; the isolate map still holds */ }
  inflight.set(key, now + V1.brakes.perPayerLockSeconds * 1000);
  return true;
}
async function release(payer) {
  const key = String(payer).toLowerCase();
  inflight.delete(key);
  try { if (typeof caches !== 'undefined' && caches.default) await caches.default.delete(new Request(lockKey(key))); } catch { /* expires by itself */ }
}

// Brake 2: this isolate's estimated model spend over a rolling hour, from the usage the model reports (or the worst
// case when it reports none). Past the ceiling the endpoint answers 503 before any request for a signature.
const spend = [];
function spendLastHour() {
  const cut = Date.now() - 3600_000;
  while (spend.length && spend[0][0] < cut) spend.shift();
  return spend.reduce((a, [, usd]) => a + usd, 0);
}
function recordSpend(m, usage, sandbox) {
  const usd = usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
    ? (usage.prompt_tokens * m.inputUsdPerM + usage.completion_tokens * m.outputUsdPerM) / 1e6
    : worstCaseCostUsd(m, { sandbox });
  spend.push([Date.now(), usd]);
}

function modelById(id) {
  if (typeof id !== 'string') return null;
  return V1.models.find((m) => m.id === id || m.cf === id) || null;
}

export function v1Contract(origin) {
  const def = V1.models.find((m) => m.default);
  return {
    what: 'An OpenAI-compatible chat-completions endpoint, paid per request in USDC on Base through x402, served by Cloudflare Workers AI. No key, no account: send the request, get a 402 naming the price, sign it, send it again.',
    endpoint: `${origin}/v1/chat/completions`,
    method: 'POST',
    price: { usd_per_request: V1.priceUsd, atomic_usdc: usdToAtomic(V1.priceUsd), basis: 'flat per request, whatever the token count up to the caps', network: V1.network, network_name: V1.networkName, asset: USDC[V1.networkName].asset, real_money: true },
    sandbox: { how: `?network=${V1.sandboxNetworkName}`, network: USDC[V1.sandboxNetworkName].caip2, real_money: false, model: V1.models.find((m) => m.sandbox).id, max_tokens: V1.caps.sandboxMaxTokens, max_content_bytes: V1.caps.sandboxMaxContentBytes, order: 'on the sandbox the test payment settles BEFORE the model runs (test USDC costs its holder nothing, and settling first is what stops free test money from buying unpaid compute); on mainnet the model runs first', worst_case_cost_usd_per_request: worstCaseCostUsd(V1.models.find((m) => m.sandbox), { sandbox: true }), note: 'Test USDC buys the capped shape only, for client developers; mainnet USDC buys the real one.' },
    models: V1.models.map((m) => ({ id: m.id, cloudflare_id: m.cf, default: !!m.default, sandbox_only_when_testnet: !!m.sandbox, cost_basis_usd_per_million_tokens: { input: m.inputUsdPerM, output: m.outputUsdPerM }, worst_case_cost_usd_per_request_at_caps: worstCaseCostUsd(m), typical_cost_usd_per_request_at_caps_english_text: worstCaseCostUsd(m, { typical: true }) })),
    cost_assumptions: { tokens_per_byte_worst_case: V1.caps.worstTokensPerByte, tokens_per_byte_english_text: V1.caps.typicalTokensPerByte, note: 'content is capped in UTF-8 bytes because a character can be one token or three' },
    brakes: { one_request_in_flight_per_payer_seconds: V1.brakes.perPayerLockSeconds, isolate_model_spend_ceiling_usd_per_hour: V1.brakes.isolateSpendUsdPerHour, past_the_ceiling: '503 with Retry-After, before any request for a signature' },
    default_model: def.id,
    reasoning: { models: V1.models.filter((m) => m.reasoning).map((m) => m.id), reasoning_effort: 'low unless the request says medium or high; a reasoning model spends output tokens thinking before any text appears, and a run that ends with no text is refused unsettled (502, charged: false), so give it max_tokens to finish' },
    caps: { ...V1.caps, roles: [...ROLES], content: 'strings only, capped in UTF-8 bytes', stream: 'must be absent or false: a streamed body cannot be settled after delivery', unsupported: ['tools', 'functions', 'response_format', 'n > 1', 'images'] },
    order_of_operations: ['validate the body (a 400 is free and never asks for a signature)', 'no payment: 402 with PAYMENT-REQUIRED (x402 v2) and accepts in the body (x402 v1)', 'payment: facilitator /verify', 'run the model', 'facilitator /settle', '200 with the completion, an x402 object and the receipt header'],
    charged_when: 'only after the model answered and the facilitator settled; a model failure after verify is 502 with charged:false and nothing is broadcast',
    free: ['GET /v1', 'GET /v1/models', 'every 400'],
    cost_basis: { source: V1.costBasisUrl, read_on: V1.costBasisReadOn, included_free_neurons_per_day: V1.freeNeuronsPerDay },
    logging: V1.logging,
    why: 'The one resource here whose paid content has value to anyone but a measurer; the books at /books say what it earns and what it costs.',
    books: `${origin}/books`,
    spec: 'docs/spec-v1-chat.md in the source repository',
    openapi: `${origin}/openapi.json`,
  };
}

function modelsList() {
  return {
    object: 'list',
    data: V1.models.map((m) => ({ id: m.id, object: 'model', created: Date.parse(`${V1.costBasisReadOn}T00:00:00Z`) / 1000, owned_by: 'cloudflare-workers-ai', cloudflare_id: m.cf, price_usd_per_request: V1.priceUsd, cost_basis_usd_per_million_tokens: { input: m.inputUsdPerM, output: m.outputUsdPerM } })),
  };
}

// The request as validated, or {error, hint}. Nothing here costs money, so every refusal is a plain 400.
function validate(body, { sandbox }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  if (body.stream) return { error: 'stream must be absent or false', hint: 'a streamed body cannot be settled after delivery; this endpoint answers whole' };
  for (const k of ['tools', 'functions', 'tool_choice', 'function_call', 'response_format']) if (k in body) return { error: `${k} is not supported here` };
  if ('n' in body && body.n !== 1) return { error: 'n must be 1 or absent' };
  const def = V1.models.find((m) => m.default);
  let model = body.model === undefined ? def : modelById(body.model);
  if (!model) return { error: 'unknown model', models: V1.models.map((m) => m.id) };
  if (sandbox) model = V1.models.find((m) => m.sandbox);
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > V1.caps.maxMessages) return { error: `messages must be an array of 1 to ${V1.caps.maxMessages} items` };
  let bytes = 0;
  const byteCap = sandbox ? V1.caps.sandboxMaxContentBytes : V1.caps.maxContentBytes;
  const messages = [];
  for (const [i, m] of msgs.entries()) {
    if (!m || typeof m !== 'object' || !ROLES.has(m.role)) return { error: `messages[${i}].role must be one of ${[...ROLES].join(', ')}` };
    if (typeof m.content !== 'string') return { error: `messages[${i}].content must be a string (no images, no parts)` };
    bytes += utf8.encode(m.content).length;
    if (bytes > byteCap) return { error: `messages carry more than ${byteCap} bytes of content (UTF-8)${sandbox ? ' on the testnet sandbox' : ''}` };
    messages.push({ role: m.role, content: m.content });
  }
  const maxCap = sandbox ? V1.caps.sandboxMaxTokens : V1.caps.maxTokensMax;
  let max_tokens = body.max_tokens === undefined ? Math.min(V1.caps.maxTokensDefault, maxCap) : body.max_tokens;
  if (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > maxCap) return { error: `max_tokens must be an integer from 1 to ${maxCap}${sandbox ? ' on the testnet sandbox' : ''}` };
  const params = { messages, max_tokens };
  if (body.temperature !== undefined) { if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) return { error: 'temperature must be a number from 0 to 2' }; params.temperature = body.temperature; }
  if (body.top_p !== undefined) { if (typeof body.top_p !== 'number' || body.top_p < 0.001 || body.top_p > 1) return { error: 'top_p must be a number from 0.001 to 1' }; params.top_p = body.top_p; }
  if (body.seed !== undefined) { if (!Number.isInteger(body.seed) || body.seed < 1 || body.seed > 9999999999) return { error: 'seed must be an integer from 1 to 9999999999' }; params.seed = body.seed; }
  if (model.reasoning) {
    const effort = body.reasoning_effort === undefined ? 'low' : body.reasoning_effort;
    if (!['low', 'medium', 'high'].includes(effort)) return { error: 'reasoning_effort must be low, medium or high' };
    params.reasoning_effort = effort;
  } else if (body.reasoning_effort !== undefined) return { error: `reasoning_effort applies only to ${V1.models.filter((m) => m.reasoning).map((m) => m.id).join(', ')}` };
  return { model, params, bytes };
}

// Workers AI text models answer {response, usage?}; be tolerant of the other shapes the catalogue uses,
// and say which keys arrived when none of them carries text, so a wrong guess is debuggable without a log.
function extractText(out) {
  if (typeof out === 'string') return out;
  if (!out || typeof out !== 'object') return null;
  if (typeof out.response === 'string') return out.response;
  if (typeof out.output_text === 'string') return out.output_text;
  if (Array.isArray(out.output)) {
    const parts = [];
    for (const item of out.output) {
      if (item && item.type === 'message' && Array.isArray(item.content)) for (const c of item.content) if (c && typeof c.text === 'string') parts.push(c.text);
    }
    if (parts.length) return parts.join('');
  }
  const c = out.choices && out.choices[0] && out.choices[0].message;
  if (c && typeof c.content === 'string') return c.content;
  return null;
}

// What arrived when no text did, without the content of anything: top-level keys, the first choice's keys and its
// finish_reason, so a wrong guess about a model's shape is debuggable from the 502 alone.
function describeShape(out) {
  if (!out || typeof out !== 'object') return { type: typeof out };
  const d = { keys: Object.keys(out).slice(0, 20) };
  const ch = Array.isArray(out.choices) ? out.choices[0] : null;
  if (ch && typeof ch === 'object') {
    d.choice_keys = Object.keys(ch).slice(0, 20);
    d.finish_reason = ch.finish_reason;
    if (ch.message && typeof ch.message === 'object') d.message_keys = Object.keys(ch.message).slice(0, 20).map((k) => `${k}:${ch.message[k] === null ? 'null' : typeof ch.message[k]}${typeof ch.message[k] === 'string' ? `(${ch.message[k].length})` : ''}`);
  }
  return d;
}

function usageOf(out) {
  const u = out && typeof out === 'object' ? out.usage : null;
  if (!u || typeof u !== 'object') return null;
  const n = (x) => (Number.isFinite(x) ? x : null);
  return { prompt_tokens: n(u.prompt_tokens ?? u.input_tokens), completion_tokens: n(u.completion_tokens ?? u.output_tokens), total_tokens: n(u.total_tokens ?? ((u.prompt_tokens ?? u.input_tokens) + (u.completion_tokens ?? u.output_tokens))) };
}

export async function handleV1({ seg, url, request, env, payTo, json }) {
  const origin = url.origin;
  if (seg.length === 1) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method not allowed' }, 405, { allow: 'GET, HEAD, OPTIONS' });
    return json(v1Contract(origin), 200, { 'cache-control': 'public, max-age=300' });
  }
  if (seg[1] === 'models' && seg.length === 2) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method not allowed' }, 405, { allow: 'GET, HEAD, OPTIONS' });
    return json(modelsList(), 200, { 'cache-control': 'public, max-age=300' });
  }
  if (!(seg[1] === 'chat' && seg[2] === 'completions' && seg.length === 3)) {
    return json({ error: 'not found', here: ['GET /v1', 'GET /v1/models', 'POST /v1/chat/completions'] }, 404);
  }
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed', how: `POST an OpenAI chat-completions JSON body here; the first answer is a 402 naming the price (${V1.priceUsd} USDC on Base mainnet, flat per request), the second, with the signed payment, is the completion. GET ${origin}/v1 has the contract.` }, 405, { allow: 'POST, OPTIONS' });
  }
  const netParam = url.searchParams.get('network');
  const networkName = netParam === null || netParam === V1.networkName ? V1.networkName : netParam === V1.sandboxNetworkName ? V1.sandboxNetworkName : null;
  if (!networkName) return json({ error: `network must be ${V1.networkName} (the default) or ${V1.sandboxNetworkName}` }, 400);
  const sandbox = networkName === V1.sandboxNetworkName;
  const net = USDC[networkName];

  // Validate before anything about payment, so a malformed request is never answered with a request for a signature.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > V1.caps.maxBodyBytes) return json({ error: `body larger than ${V1.caps.maxBodyBytes} bytes` }, 400);
  let rawBytes;
  try { rawBytes = new Uint8Array(await request.arrayBuffer()); } catch (e) { return json({ error: 'unreadable body', message: String(e.message).slice(0, 200) }, 400); }
  if (rawBytes.length > V1.caps.maxBodyBytes) return json({ error: `body larger than ${V1.caps.maxBodyBytes} bytes` }, 400);
  const raw = new TextDecoder().decode(rawBytes);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'body is not JSON', message: String(e.message).slice(0, 200) }, 400); }
  const v = validate(body, { sandbox });
  if (v.error) return json({ error: v.error, ...(v.hint ? { hint: v.hint } : {}), ...(v.models ? { models: v.models } : {}), charged: false, contract: `${origin}/v1` }, 400);
  const { model, params } = v;

  // Brake 2 (see above): past the hourly ceiling this isolate asks nobody for a signature.
  if (spendLastHour() >= V1.brakes.isolateSpendUsdPerHour) {
    return json({ error: 'capacity', hint: `this instance has spent its hourly model budget (${V1.brakes.isolateSpendUsdPerHour} USD of estimated inference); nothing was charged; retry later`, charged: false, contract: `${origin}/v1` }, 503, { 'retry-after': '600', 'cache-control': 'no-store' });
  }

  // The resource URL names the one parameter that changes the offer, nothing else a caller appended (a catalogue
  // would otherwise list one offer under many URLs, and the header would grow with junk).
  const resourceUrl = origin + url.pathname + (sandbox ? `?network=${V1.sandboxNetworkName}` : '');
  const description = `badhttp /v1/chat/completions: an OpenAI-compatible chat completion from Cloudflare Workers AI (${model.cf}), ${V1.priceUsd} USDC per request${sandbox ? ` in test USDC, capped at ${V1.caps.sandboxMaxTokens} tokens` : ' on Base mainnet'}, settled only after the model has answered.`;
  const req = requirements({ network: networkName, amountUsd: V1.priceUsd, payTo });
  const offers = [{ network: networkName, net, req }];
  // The x402 "bazaar" extension (specs/extensions/bazaar.md), in the same two-part shape /402/pay sends — `info`
  // (an example of this very request and of what a settled one returns) and `schema` (JSON Schema for both) —
  // because the official v2 client echoes it into the payload and Coinbase's facilitator lists a resource from it.
  const extensions = {
    bazaar: {
      info: {
        input: { type: 'http', method: 'POST', bodyType: 'json', bodyFields: { model: model.id, messages: [{ role: 'user', content: 'In one sentence, what is HTTP status 402 for?' }], max_tokens: params.max_tokens }, ...(sandbox ? { queryParams: { network: V1.sandboxNetworkName } } : {}) },
        output: { type: 'json', example: { id: 'chatcmpl-00000000-0000-0000-0000-000000000000', object: 'chat.completion', created: 1793311099, model: model.cf, choices: [{ index: 0, message: { role: 'assistant', content: 'HTTP 402 Payment Required is reserved for digital payment schemes; this endpoint uses it for x402.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 81, completion_tokens: 58, total_tokens: 139 }, x402: { paid: true, network: net.caip2, network_name: networkName, real_money: net.real, amount_usd: V1.priceUsd, amount_atomic: req.amount, asset: req.asset, pay_to: payTo, payer: '0x0000000000000000000000000000000000000000', transaction: '0x' + '0'.repeat(64), explorer: `${net.explorer}0x${'0'.repeat(64)}`, facilitator: 'https://example.invalid', charged_for: 'one request, flat' } } },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', const: 'POST' },
              bodyType: { type: 'string', const: 'json' },
              queryParams: { type: 'object', properties: { network: { type: 'string', enum: [V1.networkName, V1.sandboxNetworkName], description: `${V1.networkName} (the default) is real USDC on Base mainnet; ${V1.sandboxNetworkName} is the test-USDC sandbox (model ${V1.models.find((m) => m.sandbox).id}, max_tokens ${V1.caps.sandboxMaxTokens}, content ${V1.caps.sandboxMaxContentBytes} bytes)` } } },
              bodyFields: {
                type: 'object',
                properties: {
                  model: { type: 'string', enum: V1.models.flatMap((m) => [m.id, m.cf]), description: `default ${V1.models.find((m) => m.default).id}` },
                  messages: { type: 'array', minItems: 1, maxItems: V1.caps.maxMessages, items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: [...ROLES] }, content: { type: 'string' } } }, description: `total content at most ${V1.caps.maxContentBytes} bytes of UTF-8` },
                  max_tokens: { type: 'integer', minimum: 1, maximum: V1.caps.maxTokensMax, default: V1.caps.maxTokensDefault },
                  temperature: { type: 'number', minimum: 0, maximum: 2 },
                  top_p: { type: 'number', minimum: 0.001, maximum: 1 },
                  seed: { type: 'integer', minimum: 1, maximum: 9999999999 },
                  reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high'], description: `${V1.models.filter((m) => m.reasoning).map((m) => m.id).join(', ')} only; default low` },
                },
                required: ['messages'],
              },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['type', 'method', 'bodyType', 'bodyFields'],
            additionalProperties: false,
          },
          output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
        },
        required: ['input'],
      },
    },
  };
  const pr = paymentRequired({ url: resourceUrl, description, accepts: [req], resourceMeta: SERVICE_META, extensions });
  const v1req = toV1(req, { resource: resourceUrl, description });
  const humanBody = (prr, extra = {}) => ({
    error: prr.error || 'payment required',
    resource: '/v1/chat/completions',
    x402Version: 1,
    accepts: [v1req],
    how: `Sign an EIP-3009 transferWithAuthorization for accepts[0] (${V1.priceUsd} USDC on ${net.label}) and send the same POST again with it base64-encoded in a PAYMENT-SIGNATURE header (x402 v2; the same requirement is in this response's PAYMENT-REQUIRED header) or an X-PAYMENT header (x402 v1). The model runs only after a facilitator has verified the payment, and the payment settles only after the model has answered.`,
    price: `${V1.priceUsd} USDC on ${net.label}, flat per request`,
    real_money: net.real,
    model: model.cf,
    contract: `${origin}/v1`,
    ...extra,
  });
  const respond402 = (prr, b, extraHeaders = {}) => json(b, 402, { 'payment-required': b64.encode(prr), 'cache-control': 'no-store', ...extraHeaders });

  const paid = decodePaymentHeader(request);
  if (paid.none) return respond402(pr, humanBody(pr));
  if (paid.error) return respond402({ ...pr, error: paid.error }, humanBody({ ...pr, error: paid.error }));

  // The model run. On mainnet it is settle()'s `deliver`: once, after the first facilitator that found the payment
  // valid and before anything is broadcast. On the sandbox it runs AFTER the test payment settled (inside
  // respondSuccess): test USDC costs its holder nothing, so settling first takes nothing from anyone and is what
  // stops faucet money from buying unpaid compute through parallel authorizations.
  const runModel = async () => {
    if (!env || !env.AI || typeof env.AI.run !== 'function') {
      return { failed: json({ error: 'model binding missing', model: model.cf, charged: false, bug: true, hint: 'Nothing was settled; your authorization was not broadcast.' }, 502, { 'cache-control': 'no-store' }) };
    }
    const started = Date.now();
    let out;
    try {
      out = await env.AI.run(model.cf, params);
    } catch (e) {
      return { failed: json({ error: 'model_failed', model: model.cf, message: String(e && e.message || e).slice(0, 300), charged: false, hint: 'Nothing was settled; your authorization was not broadcast. Retry with the same or a fresh signature.' }, 502, { 'cache-control': 'no-store' }) };
    }
    const text = extractText(out);
    const usage = usageOf(out);
    recordSpend(model, usage, sandbox);
    if (typeof text !== 'string' || text.length === 0) {
      // An empty completion (a reasoning model that spent its budget thinking, or an unknown shape) is not a product.
      return { failed: json({ error: text === '' ? 'model_returned_empty_text' : 'model_returned_no_text', model: model.cf, shape: describeShape(out), usage, charged: sandbox ? 'test USDC only' : false, hint: sandbox ? 'The test payment had already settled (sandbox order); nothing real moved.' : 'Nothing was settled; your authorization was not broadcast. Retry, perhaps with a larger max_tokens.' }, 502, { 'cache-control': 'no-store' }) };
    }
    const completion = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(started / 1000),
      model: model.cf,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: usage && usage.completion_tokens !== null && usage.completion_tokens >= params.max_tokens ? 'length' : 'stop' }],
      usage,
      model_ms: Date.now() - started,
    };
    return { body: completion };
  };

  // Brake 1 around the mainnet run: the lock is taken when a facilitator has verified and released after settle.
  const deliver = sandbox ? undefined : async ({ payer }) => {
    if (payer && !(await acquire(payer))) {
      return { failed: json({ error: 'one request at a time per payer', hint: `a request from ${payer} is already in flight here; wait for its answer (or ${V1.brakes.perPayerLockSeconds} s) and send again`, charged: false }, 409, { 'retry-after': String(V1.brakes.perPayerLockSeconds), 'cache-control': 'no-store' }) };
    }
    const d = await runModel();
    if (d.failed && payer) await release(payer);
    return d;
  };

  const respondSuccess = async ({ delivered, tx, net: n, facilitator, settled, verify, receiptHeader, receiptName, failedOverFrom, pending }) => {
    const payer = (settled && settled.payer) || verify.payer;
    if (!sandbox && payer) await release(payer);
    const d = delivered || await runModel();
    if (d.failed) {
      // Sandbox only (mainnet runs the model before settle): the test payment settled, the model did not answer.
      const h = new Headers(d.failed.headers); h.set(receiptHeader, b64.encode(settled));
      return new Response(d.failed.body, { status: d.failed.status, headers: h });
    }
    return json(
    {
      ...d.body,
      x402: {
        paid: pending ? 'pending' : tx ? true : 'unverified (facilitator reported success without a transaction hash)',
        network: n.caip2,
        network_name: networkName,
        real_money: n.real,
        amount_usd: V1.priceUsd,
        amount_atomic: req.amount,
        asset: req.asset,
        pay_to: req.payTo,
        payer: (settled && settled.payer) || verify.payer,
        transaction: tx ?? null,
        explorer: tx ? `${n.explorer}${tx}` : undefined,
        facilitator,
        failed_over_from: failedOverFrom,
        charged_for: 'one request, flat',
        receipt_header: `${receiptName} (base64 JSON of the facilitator settle response)`,
        ...(pending ? { note: 'The facilitator broadcast the settlement and gave up waiting for confirmation; the completion is above. Do not re-sign: that would pay twice.' } : {}),
      },
    },
    pending ? 202 : 200,
    { [receiptHeader]: b64.encode(settled), 'cache-control': 'private, no-store' },
    );
  };

  return settle({ payload: paid.value, version: paid.version, v1req, offers, pr, amountUsd: V1.priceUsd, env, json, respond402, humanBody, deliver, respondSuccess, label: '/v1/chat/completions' });
}

#!/usr/bin/env node
// Turns the /402 witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-x402-clients-<date>.jsonl — the raw capture, committed, re-runnable from scripts/x402-witness/.
//         Line 1 is provenance; every other line is one cell: a client row or a control row (docs/spec-x402-witness.md).
//         The run log docs/probe-x402-clients-<date>.log must sit beside it.
// Output: src/witness-x402-data.js — a generated literal (override the path with X402_WITNESS_OUT for tests).
//
//   node scripts/witness-parse-x402.mjs docs/probe-x402-clients-2026-10-29.jsonl
//   node scripts/witness-parse-x402.mjs --synthetic <capture>     (tests only: the output starts with `// SYNTHETIC PLACEHOLDER`, which the
//                                                                  deploy gate greps for; without the flag a subset capture, a synthetic
//                                                                  capture, or one whose base is not https://badhttp.dev is refused)
//
// THE REFERENCE IS THE CONTROL'S OFFER, NEVER TYPED. For every scenario the `offer-raw` control row (curl, no payment header) carries the
// PAYMENT-REQUIRED summary and the 402 body's x402Version every client in that cell was shown. What the x402 v2 flow admits is read from
// that offer: signing is `no-payment-possible` when the offer has nothing a Base Sepolia (eip155:84532) EIP-3009 payer can satisfy,
// `payment-expected` when it carries exactly the requirement the `pay` control's offer carries, `unspecified` when it departs from that in
// a way the specification leaves to the client (the amount, a missing EIP-712 domain, a missing resource, a decimal amount). Every client
// row is then described relative to that reference. Outcomes are descriptions, never verdicts.
//
// Capture shapes this generator reads (the orchestrator writes them; see the spec's "Row shape"):
//   control row: { family:'x402', id:'x402.<scenario>.offer-raw.curl-raw', corpus_id, url, method, scenario, flavor, kind, probed, badhttp_version,
//                  client:{role:'control', class:'raw', ...}, attempts, exchanges:[ONE exchange], end, wall_ms,
//                  control:{status, raw_sha256, raw_bytes, raw_base64?, offer} }
//   client row:  { ..., kind:'one-paid-fetch', client:{..., configuration}, attempts, fetches:[ONE {n:1, caller:{status, bytes, sha256, error,
//                  library_says, exit} | null, timed_out?, exchanges:[...]}], exchanges_after_result, exchanges_after?, budget_exhausted, end, wall_ms,
//                  request_failed?: true, control:null }
//   exchange:    { n, fetch_n, method, path_query, status, x402:{payment_signature, x_payment, payment_required, payment_response,
//                  x_payment_response, x_badhttp_warning, x_badhttp_flavor, body_x402version}, x_badhttp_version, body_bytes, body_sha256, ms }
//   A recorder budget answer (the local 503 after N upstream requests) is recognised by x_badhttp_recorder === 'budget-exhausted' (also accepted:
//   recorder, or budget_refused === true on the exchange); it carries no x_badhttp_version and is not an upstream request.
//
// VOCABULARY (all descriptions, never verdicts)
//   wire.payment_header: PAYMENT-SIGNATURE | X-PAYMENT | both | none.   wire.receipt: decodable | undecodable | absent.
//   description: delivered (qualified by receipt) | handed-back (qualified by status) | raised (qualified by signed) | harness-timeout | request-failed.
//   outcome: delivered/decodable | delivered/undecodable | delivered/absent | handed-back/402 | /500 | /504 | /503 | raised/before-signing |
//     raised/after-signing | harness-timeout | request-failed.
//   outcome_vs_reference: as-reference | differs | unspecified | null.   reference.signing: no-payment-possible | payment-expected | unspecified.
//
// Refusals (the generator exits non-zero rather than emit): see the spec's Refusals section; each is a bad(...) call below.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { MACHINE, VERDICT_WORDS, ALLOWED_HOSTS, checkString, headerSafe } from './witness-gate.mjs';

const OUT = process.env.X402_WITNESS_OUT || 'src/witness-x402-data.js';
const isMain = process.argv[1] && /witness-parse-x402\.mjs$/.test(process.argv[1]);
const ARGS = process.argv.slice(2);
const SYNTHETIC_FLAG = ARGS.includes('--synthetic');
const SRC = isMain ? ARGS.find((a) => !a.startsWith('--')) : null;
if (isMain && !SRC) { console.error('usage: node scripts/witness-parse-x402.mjs [--synthetic] <capture.jsonl>'); process.exit(2); }
if (isMain && (isAbsolute(SRC) || SRC.split(/[\\/]/).includes('..'))) { console.error(`REFUSED: ${SRC} must be a repo-relative path (the path is written into ${OUT})`); process.exit(1); }

export const BROKEN_FLAVORS = ['not-base64', 'not-json', 'no-accepts', 'empty-accepts', 'no-extra', 'no-resource', 'version-99', 'decimal-amount', 'missing-header', 'v1-body'];
export const SCENARIO_ORDER = ['pay', 'never', 'reject', 'slow', 'crash', 'bad-receipt', 'overpriced', 'wrong-network', ...BROKEN_FLAVORS.map((f) => `broken/${f}`)];
export const CLIENT_KIND = 'one-paid-fetch';
export const CONTROL_KIND = 'offer-raw';
export const CONTROL_ID = 'curl-raw';
export const CLASSES = ['sdk-fetch', 'sdk-http', 'agent-wrapper', 'cli', 'raw'];
export const GENERATIONS = ['v2', 'v1', 'both'];
const ROLES = ['client', 'control'];
const ENDS = ['exited', 'harness-timeout'];
const PAYMENT_HEADERS = ['PAYMENT-SIGNATURE', 'X-PAYMENT', 'both', 'none'];
const RECEIPTS = ['decodable', 'undecodable', 'absent'];
const DESCRIPTIONS = ['delivered', 'handed-back', 'raised', 'harness-timeout', 'request-failed'];
const OUTCOMES = ['delivered/decodable', 'delivered/undecodable', 'delivered/absent', 'handed-back/<status>', 'raised/before-signing', 'raised/after-signing', 'harness-timeout', 'request-failed'];
const outcomeKnown = (o) => OUTCOMES.includes(o) || HANDED_RE.test(o);
const HANDED_RE = /^handed-back\/[1-5]\d\d$/;
const VS_REFERENCE = ['as-reference', 'differs', 'unspecified'];
const SIGNINGS = ['no-payment-possible', 'payment-expected', 'unspecified'];
const BUCKETS = ['0', '1', '2-5', '6+'];
const MIN_CLIENTS = SYNTHETIC_FLAG && process.env.X402_MIN_CLIENTS ? Number(process.env.X402_MIN_CLIENTS) : 5; // the override exists for tests and only with --synthetic
const PAYER_NETWORK = 'eip155:84532';
const CLIENT_FIELDS = ['name', 'role', 'class', 'version', 'library', 'runtime', 'platform', 'configuration', 'generation', 'requests_recorded_by'];

const HOST_PORT = /(?<![\w.-])(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}(?!\d)/i;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const EMPTY_SHA = sha(Buffer.alloc(0));
const HEX0X64 = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const LONG_HEX = /(?:0x)?[0-9a-fA-F]{130,}/;
const FORBIDDEN_KEYS = new Set(['signature', 'nonce', 'privatekey', 'private_key', 'secret']);

// ---------- the payer key: read only to refuse it ----------
function keyNeedles() {
  const k = process.env.X402_WITNESS_PAYER_KEY;
  if (!k || k.length < 16) return [];
  const bare = k.replace(/^0x/i, '');
  const forms = new Set([k, k.toLowerCase(), bare, bare.toLowerCase(), '0x' + bare.toLowerCase()]);
  for (const f of [k, bare]) { forms.add(Buffer.from(f).toString('base64')); forms.add(Buffer.from(f.toLowerCase()).toString('base64')); }
  return [...forms];
}

// ---------- offer and wire helpers ----------
const isBudget = (e) => e.x_badhttp_recorder === 'budget-exhausted' || e.recorder === 'budget-exhausted' || e.budget_refused === true;
// A client that hung up before any response byte leaves status 0 and client_aborted: an observation, with no x-badhttp-version (statuses and patterns show it as 0).
const isAborted = (e) => e.client_aborted === true && e.status === 0;
const upstream = (ex) => ex.filter((e) => !isBudget(e));
const payHeaderOf = (e) => {
  const x = e.x402 || {};
  return { ps: x.payment_signature ?? null, xp: x.x_payment ?? null };
};
const bucketOf = (n) => (n == null || n === 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : '6+');
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

// The offer a cell was shown, canonical: from the control exchange's x402 summary.
export function canonOffer(x402) {
  const x = x402 || {};
  const pr = x.payment_required;
  const accepts = pr && Array.isArray(pr.accepts) ? pr.accepts.map((a) => ({
    scheme: a.scheme ?? null, network: a.network ?? null, asset: a.asset ?? null, amount: a.amount ?? null, maxAmountRequired: a.maxAmountRequired ?? null,
    payTo: a.payTo ?? null, maxTimeoutSeconds: a.maxTimeoutSeconds ?? null, extra_present: a.extra_present ?? null,
  })) : null;
  return {
    header_present: pr ? (pr.header_present ?? true) : false,
    version: pr ? (pr.version ?? null) : null,
    error: pr ? (pr.error ?? null) : null,
    resource_url: pr ? (pr.resource_url ?? null) : null,
    accepts,
    accepts_count: pr ? (pr.accepts_count ?? (accepts ? accepts.length : null)) : null,
    decode_error: pr ? (pr.decode_error ?? null) : null,
    body_x402version: x.body_x402version ?? null,
  };
}
const satisfiable = (offer) => (offer.accepts || []).find((a) => a.network === PAYER_NETWORK) ?? null;
const reqAmount = (a) => (a ? (a.amount ?? a.maxAmountRequired ?? null) : null);

// buildReference(scenario, offer, baseOffer): what the x402 v2 flow admits for the offer; the base is the `pay` control's offer.
export function buildReference(scenario, offer, baseOffer) {
  let signing; let note;
  const base = satisfiable(baseOffer);
  const sat = satisfiable(offer);
  if (offer.decode_error) { signing = 'no-payment-possible'; note = `the PAYMENT-REQUIRED header does not decode as base64 JSON (${String(offer.decode_error).slice(0, 60)})`; }
  else if (!offer.header_present) {
    if (offer.body_x402version === 1) { signing = 'payment-expected'; note = 'there is no PAYMENT-REQUIRED header and the 402 body is x402Version 1, which carries the same requirement in the v1 form'; }
    else { signing = 'no-payment-possible'; note = `there is no PAYMENT-REQUIRED header and the 402 body's x402Version is ${offer.body_x402version ?? 'absent'}, not 1`; }
  } else if (offer.version !== 1 && offer.version !== 2) { signing = 'no-payment-possible'; note = `x402Version is ${offer.version ?? 'absent'}, neither 1 nor 2`; }
  else if (offer.accepts == null) { signing = 'no-payment-possible'; note = 'accepts is absent'; }
  else if (offer.accepts.length === 0) { signing = 'no-payment-possible'; note = 'accepts is empty'; }
  else if (!sat) { signing = 'no-payment-possible'; note = `no requirement on ${PAYER_NETWORK} (the offer names ${offer.accepts.map((a) => a.network).join(', ')})`; }
  else {
    const amount = reqAmount(sat);
    if (amount != null && !/^\d+$/.test(String(amount))) { signing = 'unspecified'; note = `amount ${JSON.stringify(String(amount))} is not a string of atomic units, and the specification does not say a client must validate it`; }
    else if (sat.extra_present === false) { signing = 'unspecified'; note = 'the requirement has no extra, so the EIP-712 domain is missing; nothing forbids a client from guessing one'; }
    else if (offer.resource_url == null) { signing = 'unspecified'; note = 'the payment-required object has no resource, which the signature does not cover'; }
    else if (base && amount !== reqAmount(base)) { signing = 'unspecified'; note = `the requirement asks for ${amount} atomic units where the pay control asks for ${reqAmount(base)}; the specification sets no spending limit`; }
    else if (base && ['scheme', 'asset', 'payTo', 'maxTimeoutSeconds'].some((k) => sat[k] !== base[k])) { signing = 'unspecified'; note = `the requirement departs from the pay control's in ${['scheme', 'asset', 'payTo', 'maxTimeoutSeconds'].filter((k) => sat[k] !== base[k]).join(', ')}`; }
    else { signing = 'payment-expected'; note = `the offer carries a requirement on ${PAYER_NETWORK} equal to the pay control's`; }
  }
  const first = sat ?? (offer.accepts && offer.accepts[0]) ?? null;
  return {
    scenario, signing, result: scenario === 'pay' ? 'delivered/decodable' : 'unspecified', note,
    offer: {
      header_present: offer.header_present, version: offer.version, accepts_count: offer.accepts_count,
      networks: (offer.accepts || []).map((a) => a.network), amount: reqAmount(first), payTo: first ? first.payTo : null,
      decode_error: offer.decode_error, body_x402version: offer.body_x402version,
    },
  };
}

// wireOf(exchanges, offer): the wire of one fetch from its attributed exchanges and the control's offer.
export function wireOf(allEx, offer) {
  const up = upstream(allEx);
  const refusals = allEx.length - up.length;
  const payEx = up.filter((e) => { const h = payHeaderOf(e); return h.ps || h.xp; });
  const first = payEx[0] ?? null;
  const fh = first ? payHeaderOf(first) : { ps: null, xp: null };
  const chosen = fh.ps || fh.xp || null;
  const auth = chosen ? (chosen.authorization ?? {}) : {};
  const sat = satisfiable(offer) ?? (offer.accepts && offer.accepts[0]) ?? null;
  const signedTo = chosen ? (auth.to ?? null) : null;
  const signedValue = chosen ? (auth.value ?? null) : null;
  const signedNetwork = chosen ? ((chosen.accepted && chosen.accepted.network) ?? chosen.network ?? null) : null;
  const offerAmount = reqAmount(sat);
  const lastEx = up[up.length - 1] ?? null;
  const lx = lastEx ? (lastEx.x402 || {}) : {};
  const rcpts = [lx.payment_response, lx.x_payment_response].filter(Boolean);
  const receipt = rcpts.some((r) => r.decodable === true) ? 'decodable' : rcpts.length ? 'undecodable' : 'absent';
  const warnings = up.map((e) => (e.x402 || {}).x_badhttp_warning).filter(Boolean);
  const eqv = (a, b) => (a == null || b == null ? null : String(a) === String(b));
  return {
    requests: up.length, budget_refusals: refusals, payment_requests: payEx.length,
    payment_requests_total: allEx.filter((e) => { const h = payHeaderOf(e); return h.ps || h.xp; }).length, resigned: payEx.length >= 1 ? payEx.length - 1 : null,
    payment_header: first ? (fh.ps && fh.xp ? 'both' : fh.ps ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT') : 'none',
    generation: first ? (fh.ps ? 2 : 1) : null, signed: payEx.length >= 1,
    signed_value_atomic: signedValue, signed_network: signedNetwork, signed_to: signedTo,
    offer_amount_atomic: offerAmount, offer_network: sat ? sat.network : null,
    value_matches_offer: eqv(signedValue, offerAmount), to_matches_offer: eqv(lower(signedTo), lower(sat ? sat.payTo : null)),
    first_status: up.length ? up[0].status : null, last_status: lastEx ? lastEx.status : null, statuses: up.map((e) => e.status).join(','),
    server_warning: warnings.length ? warnings[warnings.length - 1] : null, receipt,
  };
}

// describeFetch(row, fetch, wire): what the CALLER got. Throws on a caller outcome the vocabulary cannot describe.
export function describeRow(r, f, wire) {
  if (r.request_failed === true) return { kind: 'request-failed' };
  const c = f ? f.caller : null;
  if (c == null || (f && f.timed_out === true)) return { kind: 'harness-timeout' };
  const exitBad = c.exit != null && c.exit.code != null && c.exit.code !== 0;
  if (c.error != null || exitBad || c.status == null || c.status === 0) return { kind: 'raised', qualifier: wire.signed ? 'after-signing' : 'before-signing', error_name: c.error?.name ?? (exitBad ? `exit-${c.exit.code}` : null) };
  if (c.status === 200) {
    if (!(c.bytes > 0)) throw new Error('the caller received a 200 with no body: extend the vocabulary rather than guess');
    return { kind: 'delivered', qualifier: wire.receipt, status: 200, bytes: c.bytes, sha256: c.sha256 };
  }
  if (!Number.isInteger(c.status) || c.status < 100 || c.status > 599) throw new Error(`the caller was handed status ${c.status}, which is not an HTTP status (100-599)`);
  return { kind: 'handed-back', qualifier: String(c.status), status: c.status, bytes: c.bytes, sha256: c.sha256 };
}
export const outcomeOf = (d) => (d.qualifier ? `${d.kind}/${d.qualifier}` : d.kind);

// pattern: the exchanges as a compact string
export function patternOf(allEx, budgetExhausted, description) {
  const up = upstream(allEx);
  const parts = up.map((e) => {
    const h = payHeaderOf(e); const x = e.x402 || {};
    const pre = h.ps && h.xp ? 'PS+XP' : h.ps ? 'PS' : h.xp ? 'XP' : '';
    const sfx = [];
    const rc = [x.payment_response, x.x_payment_response].filter(Boolean);
    if (rc.some((r) => r.decodable === true)) sfx.push('receipt'); else if (rc.length) sfx.push('bad-receipt');
    if (x.x_badhttp_warning) sfx.push('warning');
    return `${pre}→${e.status}${sfx.length ? ' ' + sfx.join(' ') : ''}`;
  });
  let s;
  if (!parts.length) s = 'none';
  else if (parts.length > 4) s = `${parts.slice(0, 3).join(' | ')} | … ×${parts.length}${budgetExhausted ? ' budget' : ''}`;
  else s = parts.join(' | ') + (budgetExhausted ? ' | budget' : '');
  if (description.kind === 'raised') s += ' raised';
  else if (description.kind === 'harness-timeout') s += ' timeout';
  return s;
}

if (isMain) {
  try { main(); } catch (e) { if (/^REFUSED: /.test(e.message)) { console.error(e.message); process.exit(1); } throw e; }
}

function main() {
  const bad = (m) => { throw new Error(`REFUSED: ${m}`); };
  const needles = keyNeedles();
  const hasKey = (s) => needles.some((n) => s.includes(n));
  // ---------- input ----------
  let lines;
  try { lines = readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { bad(`cannot read ${SRC} as NDJSON: ${e.message}`); }
  const prov = lines.shift();
  if (!prov || prov.capture !== 'x402') bad('line 1 must be the provenance line with capture: "x402"');
  const rows = lines;
  if (!SYNTHETIC_FLAG) {
    if (prov.subset) bad('the provenance line says subset: a published capture is the full grid (use --synthetic only for tests)');
    if (prov.synthetic === true) bad('the provenance line says synthetic: run with --synthetic, whose output is marked as a placeholder');
    if (prov.base !== 'https://badhttp.dev') bad(`the provenance base is ${JSON.stringify(prov.base ?? null)}, not https://badhttp.dev`);
  }
  if (MACHINE.test(JSON.stringify(prov))) bad('the provenance line carries a machine path or local host');
  if (HOST_PORT.test(JSON.stringify(prov))) bad('the provenance line carries a host with a port');
  if (!prov.probed) bad('the provenance line carries no probed date');
  for (const k of ['probed', 'worker_version', 'badhttp_version_observed']) { const w = headerSafe(`provenance ${k}`, prov[k]); if (w) bad(w); }
  { const w = headerSafe('the capture path', SRC); if (w) bad(w); }
  { const w = checkString(JSON.stringify(prov), 'the provenance line'); if (w) bad(w); }
  if (hasKey(JSON.stringify(prov))) bad('the provenance line carries the payer key');
  const LOG_PATH = SRC.replace(/\.jsonl$/, '.log');
  let LOG_TEXT = '';
  try { LOG_TEXT = readFileSync(LOG_PATH, 'utf8'); } catch { bad(`the run log ${LOG_PATH} must be committed beside the capture`); }
  { const w = checkString(LOG_TEXT, `the run log ${LOG_PATH}`, { verdict: false }); if (w) bad(w); }
  if (HOST_PORT.test(LOG_TEXT)) bad(`the run log ${LOG_PATH} carries a host with a port`);
  if (hasKey(LOG_TEXT)) bad(`the run log ${LOG_PATH} carries the payer key`);
  if (LONG_HEX.test(LOG_TEXT)) bad(`the run log ${LOG_PATH} carries a hex string of 65 bytes or longer (a signature or key)`);
  for (const ln of LOG_TEXT.split('\n')) if (HEX0X64.test(ln) && !/transaction|\btx\b/i.test(ln)) bad(`the run log ${LOG_PATH} carries a 0x-prefixed 64-hex string outside a transaction line`);
  for (const m of JSON.stringify(prov).matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`the provenance line names the host ${m[1]}`);

  // ---------- per-row checks ----------
  const label = (r) => `${r.client?.id ?? '?'}/${r.scenario}`;
  const seen = new Set(); const seenIds = new Set();
  const clients = new Map();
  const strip = (r) => { const o = { ...r }; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; } return o; };
  // Walk every key and string of a value: forbidden keys, leaked keys and signatures.
  const walk = (L, v, key = '') => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(L, x, key)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) bad(`${L}: a ${JSON.stringify(k)} field reached a row (the recorder summarises; it never records a raw signature or nonce)`);
        walk(L, x, k);
      }
      return;
    }
    if (typeof v !== 'string') return;
    if (hasKey(v)) bad(`${L}: a string carries the payer key`);
    if (LONG_HEX.test(v)) bad(`${L}: a hex string of 65 bytes or longer reached a row (${key || 'value'})`);
    if (HEX0X64.test(v) && key !== 'transaction') bad(`${L}: a 0x-prefixed 64-hex string reached a row outside "transaction" (key ${JSON.stringify(key)}); a leaked key or nonce looks like this`);
  };
  const checkText = (L, v) => {
    const text = JSON.stringify(v);
    { const w = checkString(text, `${L}: row`); if (w) bad(w); }
    if (MACHINE.test(text)) bad(`${L}: row carries a machine path or local host`);
    if (HOST_PORT.test(text)) bad(`${L}: row carries a host with a port`);
    for (const m of text.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`${L}: foreign host ${m[1]}`);
    if (VERDICT_WORDS.test(text)) bad(`${L}: a verdict word reached a row: ${text.match(VERDICT_WORDS)[0]}`);
    walk(L, v);
  };
  const checkExchange = (L, r, e, where) => {
    if (!e || typeof e !== 'object') bad(`${L}: ${where} is not an exchange`);
    if (isBudget(e)) {
      if (r.client.role === 'control') bad(`${L}: ${where} is a recorder budget answer on a control row`);
      return;
    }
    if (!e.x_badhttp_version && !isAborted(e)) bad(`${L}: ${where} has no x-badhttp-version (rate limit or edge response recorded as the client's; the harness retries those)`);
    if (e.upstream_error != null) bad(`${L}: ${where} recorded upstream_error ${JSON.stringify(String(e.upstream_error).slice(0, 80))}; a recorder or upstream failure is not the client's observation (the harness retries those)`);
    if (!Number.isInteger(e.status) || !Number.isInteger(e.body_bytes)) bad(`${L}: ${where} lacks an integer status / body_bytes`);
    if (e.path_query !== `/402/${r.scenario}`) bad(`${L}: ${where} requested ${JSON.stringify(e.path_query)}, not /402/${r.scenario}`);
    const fl = e.x402 && e.x402.x_badhttp_flavor;
    if (fl != null && r.scenario.startsWith('broken/') && fl !== r.flavor) bad(`${L}: ${where} answered as flavor ${fl}`);
  };
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !r.client || !r.client.id) bad(`row without client.id: ${JSON.stringify(r).slice(0, 120)}`);
    const L = label(r);
    if (!SCENARIO_ORDER.includes(r.scenario)) bad(`${L}: unknown scenario ${r.scenario}`);
    if (r.family !== 'x402') bad(`${L}: family ${r.family} is not x402`);
    if (!ROLES.includes(r.client.role)) bad(`${L}: client role ${r.client.role} not in vocabulary`);
    if (!CLASSES.includes(r.client.class)) bad(`${L}: client class ${r.client.class} not in vocabulary`);
    const isControl = r.client.role === 'control';
    if (isControl !== (r.client.class === 'raw')) bad(`${L}: role ${r.client.role} with class ${r.client.class} (controls are raw, clients are not)`);
    if (isControl && r.client.id !== CONTROL_ID) bad(`${L}: the control's id is ${r.client.id}, not ${CONTROL_ID}`);
    if (!(isControl && r.client.generation == null) && !GENERATIONS.includes(r.client.generation)) bad(`${L}: client generation ${JSON.stringify(r.client.generation)} not in vocabulary`);
    const kind = isControl ? CONTROL_KIND : CLIENT_KIND;
    if (r.kind !== CLIENT_KIND && !(isControl && r.kind === CONTROL_KIND)) bad(`${L}: kind "${r.kind}" not in vocabulary`);
    if (!isControl && r.kind !== CLIENT_KIND) bad(`${L}: a client row's kind is ${CLIENT_KIND}, not "${r.kind}"`);
    if (r.flavor !== r.scenario.split('/').pop()) bad(`${L}: flavor ${r.flavor} is not the last path segment of ${r.scenario}`);
    if (r.corpus_id !== `402/${r.flavor}`) bad(`${L}: corpus_id ${r.corpus_id} is not 402/${r.flavor} (the /corpus.jsonl id: the last path segment)`);
    if (r.id !== `x402.${r.scenario}.${kind}.${r.client.id}`) bad(`${L}: id ${r.id} is not x402.${r.scenario}.${kind}.${r.client.id}`);
    if (seenIds.has(r.id)) bad(`${L}: duplicate row id ${r.id}`);
    seenIds.add(r.id);
    const key = `${r.client.id}\u0000${r.scenario}`;
    if (seen.has(key)) bad(`duplicate observation ${L}: one row per (client, scenario)`);
    seen.add(key);
    if (r.url !== `https://badhttp.dev/402/${r.scenario}`) bad(`${L}: url ${JSON.stringify(r.url)} is not https://badhttp.dev/402/${r.scenario}`);
    if (r.method !== 'GET') bad(`${L}: method ${r.method} is not GET`);
    if (!ENDS.includes(r.end)) bad(`${L}: end "${r.end}" not in vocabulary`);
    if (!Number.isInteger(r.attempts) || r.attempts < 1 || r.attempts > 3) bad(`${L}: attempts ${r.attempts} is not 1..3`);
    if (typeof r.client.requests_recorded_by !== 'string' || !r.client.requests_recorded_by) bad(`${L}: client.requests_recorded_by must name the recorder`);
    checkText(L, strip(r));
    if (isControl) {
      if (!Array.isArray(r.exchanges)) bad(`${L}: exchanges is not a list`);
      if (r.exchanges.length !== 1) bad(`${L}: a control row holds exactly one exchange, found ${r.exchanges.length}`);
      checkExchange(L, r, r.exchanges[0], 'the exchange');
      const px = payHeaderOf(r.exchanges[0]);
      if (px.ps || px.xp) bad(`${L}: the control carried a payment header (the control never pays)`);
      if (!r.control || typeof r.control !== 'object') bad(`${L}: a control row carries a control object`);
    } else {
      if (r.control != null) bad(`${L}: a client row's control is null`);
      if (r.request_failed === true) {
        const n = (r.fetches ?? []).reduce((s, f) => s + (f.exchanges?.length ?? 0), 0) + (r.exchanges?.length ?? 0);
        if (n !== 0 || (r.fetches ?? []).some((f) => f.caller != null)) bad(`${L}: request_failed with exchanges or fetch results (an edge 429 is never recorded as an exchange)`);
      } else {
        if (!Array.isArray(r.fetches)) bad(`${L}: fetches is not a list`);
        if (r.fetches.length !== 1) bad(`${L}: ${r.fetches.length} fetches (a client row holds exactly one)`);
        const f = r.fetches[0];
        if (f.n !== 1) bad(`${L}: the fetch is numbered ${f.n}`);
        if (!Array.isArray(f.exchanges)) bad(`${L}: the fetch's exchanges is not a list`);
        if (f.caller == null && r.end !== 'harness-timeout') bad(`${L}: the fetch has no caller result on a row whose end is ${r.end}`);
        if (f.timed_out === true && r.end !== 'harness-timeout') bad(`${L}: the fetch timed out on a row whose end is ${r.end}`);
        if (f.caller != null) {
          const c = f.caller;
          if (!(c.status === null || Number.isInteger(c.status))) bad(`${L}: caller.status ${JSON.stringify(c.status)} is not an integer or null`);
          if (!Number.isInteger(c.bytes) || c.bytes < 0) bad(`${L}: caller.bytes ${JSON.stringify(c.bytes)} is not a count`);
          if (typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) bad(`${L}: caller.sha256 is not a hex digest`);
          if (c.bytes === 0 && c.sha256 !== EMPTY_SHA) bad(`${L}: caller reports 0 bytes with sha256 ${c.sha256}, which is not the hash of an empty body`);
          if (c.error != null && (typeof c.error !== 'object' || !c.error.name)) bad(`${L}: caller.error carries no name`);
        }
        let lateSeen = 0; let budgetSeen = 0;
        f.exchanges.forEach((e, j) => {
          const where = `exchange ${j + 1}`;
          checkExchange(L, r, e, where);
          if (isBudget(e)) budgetSeen += 1;
          if (e.fetch_n == null) { lateSeen += 1; return; }
          if (e.fetch_n !== f.n) bad(`${L}: ${where} is attributed to fetch ${e.fetch_n}`);
        });
        if (r.late_exchanges != null && r.exchanges_after == null) r.exchanges_after = r.late_exchanges;
        for (const e of r.exchanges_after ?? []) checkExchange(L, r, e, 'a late exchange');
        const claimed = r.exchanges_after_result ?? 0;
        if (!Number.isInteger(claimed) || claimed < 0) bad(`${L}: exchanges_after_result ${JSON.stringify(r.exchanges_after_result)} is not a count`);
        if (lateSeen > 0 && lateSeen > claimed) bad(`${L}: ${lateSeen} exchange(s) carry no fetch_n and the row counts ${claimed} in exchanges_after_result (an exchange must be attributed to the fetch or counted as late)`);
        if (r.exchanges_after != null && r.exchanges_after.length !== claimed - lateSeen) bad(`${L}: exchanges_after lists ${r.exchanges_after.length} but exchanges_after_result is ${claimed}`);
        if (r.exchanges_after == null && claimed > lateSeen) bad(`${L}: exchanges_after_result is ${claimed} but only ${lateSeen} unattributed exchange(s) are recorded`);
        if (budgetSeen > 0 && r.budget_exhausted !== true) bad(`${L}: the recorder answered ${budgetSeen} request(s) from its budget but the row's budget_exhausted is not true`);
        if (r.budget_exhausted === true && budgetSeen === 0 && f.exchanges.length === 0) bad(`${L}: budget_exhausted with no exchange at all`);
        if (f.exchanges.filter((e) => e.fetch_n != null).length === 0 && r.end !== 'harness-timeout') bad(`${L}: the fetch has no attributed exchange (an edge 429 is never an observation; the harness retries those)`);
      }
      if (typeof r.client.configuration !== 'string' || !r.client.configuration) bad(`${L}: client.configuration must be a non-empty string naming what the harness handed the client`);
      if (typeof r.budget_exhausted !== 'boolean') bad(`${L}: budget_exhausted must be a boolean`);
    }
    if (!clients.has(r.client.id)) clients.set(r.client.id, { meta: r.client, cells: new Set() });
    else {
      const m0 = clients.get(r.client.id).meta;
      for (const k of CLIENT_FIELDS) if ((m0[k] ?? null) !== (r.client[k] ?? null)) bad(`${L}: client ${r.client.id} has ${k} ${JSON.stringify(r.client[k] ?? null)} here and ${JSON.stringify(m0[k] ?? null)} in another row`);
    }
    clients.get(r.client.id).cells.add(r.scenario);
  }
  if (!rows.length) bad('the capture holds no rows');

  // ---------- roster and grid ----------
  const controlIds = [...clients.values()].filter((c) => c.meta.role === 'control').map((c) => c.meta.id);
  if (controlIds.length !== 1) bad(`exactly one roster entry must have role control; found ${controlIds.length}${controlIds.length ? ` (${controlIds.join(', ')})` : ''}`);
  const cl = [...clients.values()].filter((c) => c.meta.role === 'client');
  if (cl.length < MIN_CLIENTS) bad(`${cl.length} client-role clients: a published capture holds at least ${MIN_CLIENTS}`);
  for (const c of [...cl, clients.get(controlIds[0])]) {
    const missing = SCENARIO_ORDER.filter((x) => !c.cells.has(x));
    if (missing.length) bad(`${c.meta.role === 'control' ? 'the control' : 'client'} ${c.meta.id} is missing cells: ${missing.join(', ')} (a published capture is the full ${SCENARIO_ORDER.length}-cell grid, and every scenario needs its offer-raw control)`);
    if (c.cells.size !== SCENARIO_ORDER.length) bad(`${c.meta.id} holds ${c.cells.size} cells, expected ${SCENARIO_ORDER.length}`);
  }
  if (rows.length !== (cl.length + 1) * SCENARIO_ORDER.length) bad(`${rows.length} rows for ${cl.length} clients + 1 control x ${SCENARIO_ORDER.length} cells: the grid is not complete`);
  if (prov.clients_run != null && prov.clients_run !== clients.size) bad(`provenance says clients_run ${prov.clients_run}, the rows hold ${clients.size} roster entries`);

  // Every exchange of every row, late ones included: a deploy mid-capture can change the version between requests.
  const allExchanges = (r) => [...(r.exchanges ?? []), ...(r.fetches ?? []).flatMap((f) => f.exchanges), ...(r.exchanges_after ?? []), ...(r.late_exchanges ?? [])];
  const versions = new Set(rows.flatMap((r) => upstream(allExchanges(r)).filter((e) => !isAborted(e)).map((e) => e.x_badhttp_version)));
  if (versions.size !== 1) bad(`rows span badhttp versions ${[...versions].join(', ') || '(none)'}: a deploy happened mid-capture`);
  const BADHTTP_VERSION = [...versions][0];
  { const w = headerSafe('the observed badhttp version', BADHTTP_VERSION); if (w) bad(w); }
  for (const r of rows) if (r.badhttp_version != null && r.badhttp_version !== BADHTTP_VERSION) bad(`${label(r)}: badhttp_version ${r.badhttp_version} differs from the exchanges' ${BADHTTP_VERSION}`);
  if (prov.badhttp_version_observed != null && prov.badhttp_version_observed !== BADHTTP_VERSION) bad(`provenance says badhttp ${prov.badhttp_version_observed}, the exchanges say ${BADHTTP_VERSION}`);

  // ---------- the controls and the reference ----------
  const OFFERS = {};
  for (const r of rows.filter((x) => x.client.role === 'control')) {
    const L = label(r);
    const e = r.exchanges[0];
    const c = r.control;
    if (e.status !== 402) bad(`${L}: the control's exchange answered ${e.status}, expected 402 (every scenario's unpaid answer)`);
    if (c.status != null && c.status !== e.status) bad(`${L}: control.status ${c.status} but the exchange answered ${e.status}`);
    if (typeof c.raw_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.raw_sha256)) bad(`${L}: control.raw_sha256 is not a hex digest`);
    let raw = null;
    if (typeof c.raw_base64 === 'string') {
      raw = Buffer.from(c.raw_base64, 'base64');
      if (sha(raw) !== c.raw_sha256) bad(`${L}: control raw bytes do not hash to raw_sha256`);
      if (c.raw_bytes != null && c.raw_bytes !== raw.length) bad(`${L}: control raw_bytes ${c.raw_bytes} but the raw bytes are ${raw.length}`);
    } else if (e.body_sha256 == null) bad(`${L}: the control carries no raw_base64 and its exchange no body_sha256, so raw_sha256 cannot be verified`);
    if (e.body_sha256 != null && e.body_sha256 !== c.raw_sha256) bad(`${L}: the exchange's body hash differs from the control's raw_sha256`);
    if (c.raw_bytes != null && e.body_bytes !== c.raw_bytes) bad(`${L}: the exchange forwarded ${e.body_bytes} body bytes but the control holds ${c.raw_bytes}`);
    const offer = canonOffer(e.x402);
    if (c.offer == null || typeof c.offer !== 'object') bad(`${L}: control.offer is missing`);
    const claimed = canonOffer({ payment_required: c.offer.header_present === false && c.offer.version == null && c.offer.accepts == null && c.offer.decode_error == null ? null : c.offer, body_x402version: c.offer.body_x402version });
    if (JSON.stringify(claimed) !== JSON.stringify(offer)) bad(`${L}: control.offer differs from the exchange's payment_required summary (the offer is the summary copied out)`);
    if (raw) {
      let body = null; try { body = JSON.parse(raw.toString('utf8')); } catch { /* not JSON: body_x402version stays what the recorder read */ }
      if (body && typeof body === 'object' && !Array.isArray(body) && 'x402Version' in body && body.x402Version !== offer.body_x402version) bad(`${L}: the raw body's x402Version ${body.x402Version} differs from the offer's body_x402version ${offer.body_x402version}`);
    }
    OFFERS[r.scenario] = { offer, row: r };
  }
  if (!satisfiable(OFFERS.pay.offer) || !OFFERS.pay.offer.header_present) bad('the pay control offers nothing a Base Sepolia payer can satisfy: the positive control is void');
  const REF = {};
  for (const s of SCENARIO_ORDER) {
    REF[s] = buildReference(s, OFFERS[s].offer, OFFERS.pay.offer);
    if (!SIGNINGS.includes(REF[s].signing)) bad(`${s}: reference signing ${REF[s].signing} outside the vocabulary`);
  }
  if (REF.pay.signing !== 'payment-expected') bad(`the pay control's own offer yields signing ${REF.pay.signing}, not payment-expected`);

  // ---------- rows ----------
  const OBS = [];
  const serveExchange = (e) => {
    const o = { n: e.n ?? null, fetch_n: e.fetch_n ?? null, method: e.method ?? 'GET', path_query: e.path_query ?? null, status: e.status, x402: e.x402 ?? null };
    for (const [k, v] of Object.entries(e)) if (!(k in o)) o[k] = v;
    for (const k of ['x_badhttp_version', 'body_bytes', 'body_sha256', 'ms']) if (!(k in o)) o[k] = e[k] ?? null;
    return o;
  };
  for (const r of rows) {
    const L = label(r);
    const o = strip(r);
    o.license = 'CC0-1.0';
    const ref = REF[r.scenario];
    if (r.client.role === 'control') {
      o.exchanges = r.exchanges.map(serveExchange);
      o.control = { status: r.control.status ?? r.exchanges[0].status, raw_sha256: r.control.raw_sha256, raw_bytes: r.control.raw_bytes ?? r.exchanges[0].body_bytes, offer: r.control.offer };
      o.outcome = 'control'; o.pattern = null; o.outcome_vs_reference = null; o.reference = ref;
      OBS.push(o);
      continue;
    }
    const offer = OFFERS[r.scenario].offer;
    o.control = null;
    o.reference = ref;
    if (r.request_failed === true) {
      o.fetches = []; o.exchanges_after_result = r.exchanges_after_result ?? 0;
      o.wire = wireOf([], offer); o.description = { kind: 'request-failed' };
      o.outcome = 'request-failed'; o.pattern = null; o.outcome_vs_reference = null;
      OBS.push(o);
      continue;
    }
    const f0 = r.fetches[0];
    const attributed = f0.exchanges.filter((e) => e.fetch_n != null);
    const late = [...f0.exchanges.filter((e) => e.fetch_n == null), ...(r.exchanges_after ?? [])];
    const wire = wireOf(attributed, offer);
    let desc;
    try { desc = describeRow(r, f0, wire); } catch (err) { bad(`${L}: ${err.message}`); }
    const outcome = outcomeOf(desc);
    if (!outcomeKnown(outcome)) bad(`${L}: outcome ${outcome} outside the vocabulary`);
    if (!DESCRIPTIONS.includes(desc.kind)) bad(`${L}: description ${desc.kind} outside the vocabulary`);
    if (!PAYMENT_HEADERS.includes(wire.payment_header)) bad(`${L}: payment_header ${wire.payment_header} outside the vocabulary`);
    if (!RECEIPTS.includes(wire.receipt)) bad(`${L}: receipt ${wire.receipt} outside the vocabulary`);
    // a decodable receipt that reports success carries a transaction of 64 hex characters
    const lastUp = upstream(attributed).slice(-1)[0];
    if (lastUp) for (const rc of [lastUp.x402?.payment_response, lastUp.x402?.x_payment_response]) {
      if (rc && rc.decodable === true && rc.success === true && !(typeof rc.transaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(rc.transaction))) bad(`${L}: a decodable receipt reports success with a transaction that is not 64 hex characters`);
    }
    o.fetches = [{ ...f0, exchanges: attributed.map(serveExchange) }];
    o.late_exchanges = late.map(serveExchange);
    o.exchanges_after_result = r.exchanges_after_result ?? 0;
    delete o.exchanges_after;
    o.wire = wire; o.description = desc; o.outcome = outcome;
    o.pattern = patternOf(attributed, r.budget_exhausted === true, desc);
    let vs;
    if (outcome === 'harness-timeout' || outcome === 'request-failed') vs = null;
    else if (ref.signing === 'unspecified') vs = 'unspecified';
    else if (ref.signing === 'no-payment-possible') vs = wire.signed ? 'differs' : 'as-reference';
    else vs = wire.signed ? 'as-reference' : 'differs';
    if (r.scenario === 'pay' && vs === 'as-reference' && outcome !== ref.result) vs = 'differs';
    o.outcome_vs_reference = vs;
    if (vs != null && !VS_REFERENCE.includes(vs)) bad(`${L}: outcome_vs_reference ${vs} outside the vocabulary`);
    OBS.push(o);
  }
  OBS.sort((a, b) => SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario) || (b.client.role === 'control') - (a.client.role === 'control') || a.client.id.localeCompare(b.client.id));
  const clientObs = OBS.filter((o) => o.client.role === 'client');

  // ---------- non-vacuity floors (the #20 rule) ----------
  if (!clientObs.some((o) => o.scenario === 'pay' && o.outcome === 'delivered/decodable')) bad('no client row is delivered/decodable on pay: the positive control never paid, so the capture says nothing');
  if (!clientObs.some((o) => o.wire.signed === false && o.outcome !== 'request-failed')) bad('no client row has signed: false');
  if (!clientObs.some((o) => o.wire.signed === true && o.scenario !== 'pay')) bad('no client row has signed: true on a scenario other than pay');

  // ---------- disagreement: distinct (outcome, signed, resigned bucket) answers among client rows, per scenario ----------
  const answers = {};
  for (const o of clientObs) {
    const k = JSON.stringify([o.outcome, o.wire.signed, bucketOf(o.wire.resigned)]);
    ((answers[o.scenario] ??= {})[k] ??= []).push(o.client.id);
  }
  const disagreement_by_scenario = {}; const answers_by_scenario = {};
  for (const s of SCENARIO_ORDER) {
    disagreement_by_scenario[s] = Object.keys(answers[s] || {}).length;
    answers_by_scenario[s] = Object.entries(answers[s] || {}).map(([k, who]) => { const [outcome, signed, resigned_bucket] = JSON.parse(k); return { outcome, signed, resigned_bucket, clients: who.sort() }; });
  }
  const outcome_counts = {}; const signed_counts = { signed: 0, not_signed: 0 };
  const resigned_counts = Object.fromEntries(BUCKETS.map((b) => [b, 0])); const receipt_counts = { decodable: 0, undecodable: 0, absent: 0 };
  for (const o of clientObs) {
    outcome_counts[o.outcome] = (outcome_counts[o.outcome] || 0) + 1;
    signed_counts[o.wire.signed ? 'signed' : 'not_signed'] += 1;
    resigned_counts[bucketOf(o.wire.resigned)] += 1;
    receipt_counts[o.wire.receipt] += 1;
  }

  // ---------- emit ----------
  const roster = [...clients.values()].map((c) => c.meta);
  roster.sort((a, b) => (a.role === 'control' ? -1 : b.role === 'control' ? 1 : a.id.localeCompare(b.id)));
  const CLIENTS = roster.map((m) => ({ id: m.id, name: m.name, role: m.role, class: m.class, version: m.version, library: m.library ?? null, runtime: m.runtime ?? null, platform: m.platform, invocation: m.invocation ?? null, configuration: m.configuration ?? null, generation: m.generation, requests_recorded_by: m.requests_recorded_by ?? null }));
  const recorders = [...new Set(roster.filter((m) => m.role === 'client').map((m) => m.requests_recorded_by))].sort();
  if (prov.not_in_roster != null && !Array.isArray(prov.not_in_roster)) bad('provenance not_in_roster must be a list of {client, reason}');
  const NOT_IN_ROSTER = (prov.not_in_roster ?? []).map((e, i) => {
    if (!e || typeof e !== 'object' || typeof e.client !== 'string' || !e.client.trim() || typeof e.reason !== 'string' || !e.reason.trim()) bad(`not_in_roster entry ${i + 1} needs both a client and a reason`);
    if (e.reason.trim().length < 20) bad(`not_in_roster entry ${i + 1} (${e.client}): the reason is ${e.reason.trim().length} characters, at least 20 are needed so the index can print it`);
    for (const [k, v] of [['client', e.client], ['reason', e.reason]]) { const w = checkString(v, `not_in_roster entry ${i + 1} ${k}`); if (w) bad(w); if (hasKey(v)) bad('not_in_roster carries the payer key'); }
    return { client: e.client.trim(), reason: e.reason.trim() };
  });
  const sourceFile = SRC.replace(/^.*?docs\//, 'docs/');
  const witness = {
    family: 'x402', ...(SYNTHETIC_FLAG ? { synthetic: true } : {}), probed: prov.probed, badhttp_version_observed: BADHTTP_VERSION, worker_version: prov.worker_version || null, request_budget: (Number.isInteger(prov.request_budget) && prov.request_budget > 0) ? prov.request_budget : bad(`provenance request_budget is not a positive integer: ${JSON.stringify(prov.request_budget)}`),
    scenarios: SCENARIO_ORDER.length, clients: cl.length, cells_per_client: SCENARIO_ORDER.length, fetches_per_cell: 1, kind: CLIENT_KIND,
    not_in_roster: NOT_IN_ROSTER, disagreement_by_scenario, answers_by_scenario,
    outcome_counts, signed_counts, resigned_counts, receipt_counts,
    capture: sourceFile, run_log: sourceFile.replace(/\.jsonl$/, '.log'), requests_recorded_by: recorders.join('; '),
    scenario_order: SCENARIO_ORDER,
    vocabulary: { outcomes: OUTCOMES, handed_back_statuses_present: Object.keys(outcome_counts).filter((k) => HANDED_RE.test(k)).map((k) => Number(k.slice(12))).sort((a, b) => a - b), descriptions: DESCRIPTIONS, payment_headers: PAYMENT_HEADERS, receipts: RECEIPTS, signings: SIGNINGS, outcome_vs_reference: VS_REFERENCE, resigned_buckets: BUCKETS, classes: CLASSES, generations: GENERATIONS },
  };
  const served = { witness, CLIENTS, REF, OBS };
  const all = JSON.stringify(served);
  if (VERDICT_WORDS.test(all)) bad(`a verdict word reached the emitted data: ${all.match(VERDICT_WORDS)[0]}`);
  if (MACHINE.test(all)) bad('the emitted data carries a machine path or local host');
  if (HOST_PORT.test(all)) bad('the emitted data carries a host with a port');
  for (const m of all.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`the emitted data names the host ${m[1]}`);
  if (hasKey(all)) bad('the emitted data carries the payer key');
  { const w = checkString(all, 'the emitted data'); if (w) bad(w); }
  walk('the emitted data', served);
  if (/raw_base64/.test(all)) bad('raw_base64 reached the emitted data');

  const header = `${SYNTHETIC_FLAG ? '// SYNTHETIC PLACEHOLDER\n' : ''}// GENERATED by scripts/witness-parse-x402.mjs from ${witness.capture} — do not edit by hand.
// Re-run the generator after any new capture: node scripts/witness-parse-x402.mjs ${witness.capture}; the capture scripts are in scripts/x402-witness/.
//
// ${witness.clients} x402 payment clients (SDKs, wrappers, command-line tools) plus a raw-wire control (curl), one fresh working directory and one fresh client
// process per cell: each makes one paid GET of each of ${SCENARIO_ORDER.length} /402 scenarios with a throwaway Base Sepolia payer (test USDC, no dollar value) and the library's
// defaults, on ${witness.probed} against badhttp ${BADHTTP_VERSION}${witness.worker_version ? ` (Worker deployment ${witness.worker_version})` : ''}. The harness never sends a payment header for a client.
// THE REFERENCE IS DERIVED FROM THE CONTROL'S OFFER, NEVER TYPED: REFERENCE_X402 is read from each scenario's offer-raw control row (what the 402 shows a
// payer on ${PAYER_NETWORK}), and each row's outcome describes what the client signed and what it handed its caller relative to that reference. Outcomes are
// descriptions, never verdicts.
// Outcomes: delivered/{decodable|undecodable|absent} | handed-back/<status> (any integer 100-599 other than a delivered 200; present here: ${Object.keys(outcome_counts).filter((k) => HANDED_RE.test(k)).sort().join(', ') || 'none'}) | raised/{before-signing|after-signing} | harness-timeout | request-failed.
// reference.signing is derived from the control's offer alone: no-payment-possible when it names nothing a ${PAYER_NETWORK} payer can satisfy, payment-expected when its requirement equals the pay control's, unspecified when it departs from that in amount, extra, resource or decimal form. Per row: wire { requests, budget_refusals, payment_requests, payment_requests_total (upstream plus budget-refused), resigned, payment_header (PAYMENT-SIGNATURE|X-PAYMENT|both|none),
// generation, signed, signed_value_atomic, signed_network, signed_to, offer_amount_atomic, offer_network, value_matches_offer, to_matches_offer, first_status,
// last_status, statuses, server_warning, receipt (decodable|undecodable|absent) }. reference.signing: ${SIGNINGS.join(' | ')}. outcome_vs_reference: as-reference | differs | unspecified.
`;
  const lit = (name, v) => `export const ${name} = ${JSON.stringify(v, null, 2)};\n`;
  const text = `${header}\n${lit('WITNESS_X402', witness)}\n${lit('CLIENTS_X402', CLIENTS)}\n${lit('REFERENCE_X402', REF)}\n${lit('OBSERVATIONS_X402', OBS)}`;
  if (VERDICT_WORDS.test(text)) bad(`a verdict word reached the generated file: ${text.match(VERDICT_WORDS)[0]}`);
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}: ${OBS.length} rows (${cl.length} clients x ${SCENARIO_ORDER.length} cells + ${SCENARIO_ORDER.length} control rows), badhttp ${BADHTTP_VERSION}, outcomes ${JSON.stringify(outcome_counts)}`);
  console.log(`disagreement_by_scenario ${JSON.stringify(disagreement_by_scenario)}`);
}

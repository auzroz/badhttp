// Live chain reads for /books. The project holds no key that can spend from the receive
// address (the operator does), so from the project's side it is receive-only; the address
// itself is a normal wallet whose every USDC movement is public. Two reads feed /books:
// one eth_call balanceOf (the aggregate; no indexer, no storage) and the receipt of every
// transaction the books name, read from the same kind of public RPC (session 30; it was an itemized
// list from a public Blockscout indexer in sessions 15–29, until that indexer stopped answering).
// Designed in docs/research-session-3.md (session 3), built sessions 14–15, re-based on receipts in 30.
//
// Caching (Cache API, per-colo, no storage): a cached record younger than FRESH_SECONDS is
// served as-is; an older one is served stale immediately while ctx.waitUntil refreshes it in
// the background, so /books latency stays flat and, with the single-flight below, the RPCs see
// at most ~one raced refresh per colo per FRESH_SECONDS while requests keep arriving. Only a
// cold colo (no cached copy at all) blocks on the RPC. The home page never touches this path.

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base mainnet (eip155:8453)
// Public Base RPCs, no key, in order (probed in docs/research-session-3.md; both answer eth_call).
const RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const FRESH_SECONDS = 300;
// Synthetic cache keys: the paths are routable but the router answers them with an uncacheable
// no-store 404 and never consults caches.default, so a visitor cannot read or overwrite these entries.
const CACHE_KEY = 'https://badhttp.dev/__internal/books-chain-balance';
const PAYER_CACHE_KEY = 'https://badhttp.dev/__internal/books-chain-payer';
// A new key name since session 30: records cached under the Blockscout-era key have a different
// shape and must never be read as receipts.
const RECEIPTS_CACHE_KEY = 'https://badhttp.dev/__internal/books-chain-receipts';

// Exact atomic-USDC (6 dp) formatting; never floats.
export function usdcFromAtomic(atomic) {
  const neg = atomic < 0n;
  const a = neg ? -atomic : atomic;
  return `${neg ? '-' : ''}${a / 1000000n}.${(a % 1000000n).toString().padStart(6, '0')}`;
}

function balanceCallBody(address) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: USDC_BASE, data: '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0') }, 'latest'],
  });
}

async function readOneRpc(rpc, address) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: balanceCallBody(address),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`${rpc} ${r.status}`);
  const j = await r.json();
  // A balanceOf result is one uint256: at most 64 hex digits. The bound also stops a broken or
  // compromised RPC from feeding an arbitrarily large string into BigInt and the page.
  if (typeof j.result !== 'string' || !/^0x[0-9a-fA-F]{0,64}$/.test(j.result)) throw new Error(`${rpc} bad result`);
  // `address` travels with the record so a cached copy can be checked against the address being
  // read (see usdcBalance) rather than trusted because it came back from the right key.
  return { address: address.toLowerCase(), balance_atomic: BigInt(j.result === '0x' ? '0x0' : j.result).toString(), rpc, fetched_at: new Date().toISOString() };
}

// Race both RPCs so the worst case is one timeout (~5 s), not their sum; the extra call per
// refresh is at most one every FRESH_SECONDS per colo. Single-flight (module scope, per isolate)
// collapses a cold-colo burst into one read instead of one per concurrent request.
//
// Keyed BY ADDRESS since session 21. It was a single module-scope `inflight` while only the
// receive address was ever read, which was correct then and a latent bug the moment a second
// address existed: a concurrent read of address B would have been handed address A's in-flight
// promise and published A's balance as B's. Nothing observable ever went wrong — there was only
// ever one address — but the bug had to be fixed before the payer could be read, not after.
const inflight = new Map();
function readFromRpcs(address) {
  const key = address.toLowerCase();
  let p = inflight.get(key);
  if (!p) {
    p = Promise.any(RPCS.map((rpc) => readOneRpc(rpc, address)))
      .catch(() => null)
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
  }
  return p;
}

function cachePut(key, record) {
  const resp = new Response(JSON.stringify(record), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' },
  });
  // Best-effort write: a cache failure must never reject a waitUntil chain nor throw into a
  // request path (three call sites use this bare).
  try {
    return Promise.resolve(caches.default.put(key, resp)).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

// Returns { balance_atomic: string, fetched_at, age_seconds, rpc, source: 'rpc'|'cache'|'stale-cache' }
// or null when every RPC fails and no cached copy exists.
//
// `cacheKey` is per-address for the same reason the single-flight above is: two addresses sharing
// one cache entry would serve each other's balance. Callers pass a distinct constant key.
export async function usdcBalance(address, ctx, cacheKey) {
  let cached = null;
  let age = null;
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) cached = await hit.json();
  } catch {
    // cache unavailable: fall through to the RPCs
  }
  if (cached) {
    age = Math.floor((Date.now() - Date.parse(cached.fetched_at)) / 1000);
    if (!Number.isFinite(age) || age < 0 || !/^\d+$/.test(String(cached.balance_atomic))) cached = null; // corrupt record: refetch
    // A record cached under a key that does not belong to the address being read is discarded
    // rather than served: belt and braces against a key collision ever reappearing.
    else if (cached.address && cached.address.toLowerCase() !== address.toLowerCase()) cached = null;
  }
  if (cached && age < FRESH_SECONDS) return { ...cached, age_seconds: age, source: 'cache' };
  if (cached) {
    // Serve stale immediately; refresh in the background so the next request is fresh.
    ctx.waitUntil(readFromRpcs(address).then((rec) => (rec ? cachePut(cacheKey, rec) : undefined)));
    return { ...cached, age_seconds: age, source: 'stale-cache' };
  }
  const rec = await readFromRpcs(address);
  if (!rec) return null;
  ctx.waitUntil(cachePut(cacheKey, rec));
  return { ...rec, age_seconds: 0, source: 'rpc' };
}

/** The receive address: its balance is the aggregate the reconciliation is built on. */
export const receiveBalance = (address, ctx) => usdcBalance(address, ctx, CACHE_KEY);

/**
 * The project's mainnet payer wallet — the working capital in entry #12, and the only asset the
 * project can point at when asked whether it can pay its own next bill. Read live for the same
 * reason hosting accrues itself (session 20): a hand-typed asset figure goes stale silently, and
 * this one is the numerator of the solvency line on /books.
 */
export const payerBalance = (address, ctx) => usdcBalance(address, ctx, PAYER_CACHE_KEY);

// ---------- itemized transfers: receipts by hash (session 30) ----------
//
// Until session 30 this list came from a public Blockscout indexer. On 2026-10-06 that indexer put a
// Cloudflare challenge in front of its API and never answered this Worker (or curl) again, and the
// itemized list — the one public surface that lets a reader see each movement rather than a total —
// stood empty for three days. Probed 2026-10-09: no keyless public indexer serves Base (Etherscan v2
// and Basescan want a key; Routescan does not carry chain 8453), and no keyless public RPC answers
// eth_getLogs over more than 500 blocks (mainnet.base.org) — a month of chain is ~1.3M blocks.
//
// What every public RPC DOES answer, keylessly, is eth_getTransactionReceipt. So the list is built
// the other way round. The books NAME every transaction they claim (each chain_movements row and each
// revenue row carries a tx hash); the Worker reads each receipt and takes the USDC Transfer logs in it
// that touch the receive address as the rows. Every book row is thereby CONFIRMED against the chain —
// amount, direction and counterparty — or shown as unconfirmed, loudly; the indexer never did that.
// What this cannot do is discover a transaction the books do not name. That was never the list's
// job: the aggregate identity (balance − labeled movements − booked revenue = unbooked) stands on
// the RPC alone and is where an unknown payment or withdrawal shows up; the session that books it
// finds the hash (eth_getLogs in 500-block windows, LEDGER.md #29) and names it here. The page says
// so rather than implying the table is exhaustive.
//
// Receipts are immutable once final and the books name a dozen transactions, so one JSON-RPC batch
// (every receipt, then every distinct block header for its timestamp) per refresh per colo is the
// whole cost. RPCs are tried in order, not raced: a batch is heavier than a balanceOf, and the
// stale-while-revalidate cache below means a slow failover costs the reader nothing. The three here
// each answered a 14-receipt and a 14-header batch keylessly on 2026-10-09; the ones left out did
// not — dRPC allows 3 items per batch, 1rpc.io has pruned blocks before 51,000,000 (this address's
// first movements are in 50,571,xxx), publicnode calls any receipt an archive request, nodies and
// meowrpc answered batches with non-JSON. Re-probe before changing the order.
const RECEIPT_RPCS = ['https://mainnet.base.org', 'https://base-mainnet.public.blastapi.io', 'https://base.rpc.thirdweb.com'];
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak256("Transfer(address,address,uint256)")
const RECEIPTS_SYNC_BUDGET_MS = 3000;
const RECEIPTS_TIMEOUT_MS = 8000;
// One batch per refresh. The books name 14 transactions as of session 30; the cap is a sanity bound on
// the request size, not a page limit, and the view says how many were named and how many confirmed.
const MAX_NAMED_TXS = 200;

const TX_RE = /^0x[0-9a-f]{64}$/;
const HEX_QTY_RE = /^0x[0-9a-fA-F]{1,16}$/;
const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
const USDC_LC = USDC_BASE.toLowerCase();

// An indexed address topic is a 32-byte word with the address in its low 20 bytes.
function topicAddress(t) {
  return WORD_RE.test(String(t)) && /^0x0{24}/.test(String(t)) ? `0x${String(t).slice(26).toLowerCase()}` : null;
}

async function rpcBatch(rpc, calls) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls),
    signal: AbortSignal.timeout(RECEIPTS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${rpc} ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`${rpc} batch not an array`);
  const byId = new Map();
  for (const it of j) if (it && Number.isInteger(it.id)) byId.set(it.id, it);
  return byId;
}

// Parse one receipt into the USDC Transfer legs that touch the address. Every field is validated
// before it can reach the page: the RPC is a third party and its answer is untrusted.
function legsFromReceipt(tx, rec, a) {
  if (rec.status !== '0x1') return { legs: [], reason: 'the transaction reverted; it moved nothing' };
  if (!HEX_QTY_RE.test(String(rec.blockNumber))) return { legs: [], reason: 'malformed receipt' };
  const bn = Number(BigInt(rec.blockNumber));
  const legs = [];
  for (const lg of Array.isArray(rec.logs) ? rec.logs : []) {
    if (String(lg?.address ?? '').toLowerCase() !== USDC_LC) continue;
    const t = Array.isArray(lg.topics) ? lg.topics : [];
    if (t[0] !== TRANSFER_TOPIC || t.length < 3) continue;
    const from = topicAddress(t[1]);
    const to = topicAddress(t[2]);
    if (!from || !to || (from !== a && to !== a)) continue;
    if (!WORD_RE.test(String(lg.data))) continue;
    const atomic = BigInt(lg.data);
    // Zero-value Transfers move no USDC and are permissionlessly forgeable (address-poisoning
    // spam); excluding them cannot hide a genuine movement, which has value > 0.
    if (atomic === 0n) continue;
    const li = HEX_QTY_RE.test(String(lg.logIndex)) ? Number(BigInt(lg.logIndex)) : 0;
    legs.push({ tx, from, to, atomic: atomic.toString(), log_index: li, block_number: bn, direction: from === a && to === a ? 'self' : to === a ? 'in' : 'out' });
  }
  return { legs, reason: legs.length ? null : 'the receipt shows no USDC transfer to or from the receive address' };
}

// Every named tx's receipt, then the header of each distinct block for its timestamp. Each RPC in
// turn is asked only for what the previous ones did not answer, because a public RPC answers a batch
// item-by-item and may refuse some items (rate limit) while serving the rest.
//
// Three outcomes per receipt, kept apart on purpose: an object (read), a null result from an RPC that
// answered (the transaction is unknown to it — a genuine finding), or an error (the RPC refused this
// item). A transaction that every RPC REFUSED is not "unconfirmed": publishing that would make a rate
// limit read as a bookkeeping bug on the public books. The whole read is then incomplete and the view
// degrades to its error state instead, which the smoke suite tolerates and says out loud.
async function readReceipts(address, txs) {
  const a = address.toLowerCase();
  const got = new Map();      // tx -> receipt object
  const unknown = new Set();  // tx -> some RPC that answered returned null for it
  const rpcsUsed = [];
  for (const rpc of RECEIPT_RPCS) {
    // A tx one RPC answered null for is still asked of the next: a lagging, pruned or load-balanced
    // node says null for a transaction another node has, and one null must not become an
    // unconfirmed row on the public books (review finding, session 30).
    const want = txs.filter((tx) => !got.has(tx));
    if (!want.length) break;
    let res;
    try { res = await rpcBatch(rpc, want.map((tx, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getTransactionReceipt', params: [tx] }))); } catch { continue; }
    let answered = 0;
    want.forEach((tx, i) => {
      const ans = res.get(i);
      if (ans && ans.result && typeof ans.result === 'object') { got.set(tx, ans.result); answered++; }
      else if (ans && ans.result === null && !ans.error) { unknown.add(tx); answered++; }
    });
    if (answered) rpcsUsed.push(rpc);
  }
  if (!got.size) return null;
  const refused = txs.filter((tx) => !got.has(tx) && !unknown.has(tx));
  if (refused.length) return { incomplete: true, refused: refused.length, rpcs: rpcsUsed };
  const rows = [];
  const unreadable = [];
  const blocks = new Set();
  for (const tx of txs) {
    if (!got.has(tx)) { unreadable.push({ tx, reason: 'no receipt: every RPC that answered says it does not know this transaction (never mined, or not on this chain)' }); continue; }
    const { legs, reason } = legsFromReceipt(tx, got.get(tx), a);
    if (reason) unreadable.push({ tx, reason });
    for (const leg of legs) { rows.push(leg); blocks.add(leg.block_number); }
  }
  // Timestamps are decoration, not evidence: a block header the RPCs will not serve leaves the row
  // dated by block number rather than failing the read.
  const tsByBlock = new Map();
  for (const rpc of RECEIPT_RPCS) {
    const want = [...blocks].filter((bn) => !tsByBlock.has(bn));
    if (!want.length) break;
    let res;
    try { res = await rpcBatch(rpc, want.map((bn, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: [`0x${bn.toString(16)}`, false] }))); } catch { continue; }
    want.forEach((bn, i) => {
      const ts = res.get(i)?.result?.timestamp;
      if (HEX_QTY_RE.test(String(ts))) tsByBlock.set(bn, new Date(Number(BigInt(ts)) * 1000).toISOString());
    });
  }
  for (const row of rows) row.timestamp = tsByBlock.get(row.block_number) ?? null;
  rows.sort((x, y) => (y.block_number - x.block_number) || (y.log_index - x.log_index));
  return { items: rows, unreadable, named: txs.length, rpc: rpcsUsed.join(', '), fetched_at: new Date().toISOString() };
}

let inflightReceipts = null;
function readReceiptsOnce(address, txs) {
  inflightReceipts ??= readReceipts(address, txs)
    .catch(() => null)
    .finally(() => { inflightReceipts = null; });
  return inflightReceipts;
}

// The set of transactions a cached record was built from travels with it, so a deploy that books a
// new transaction is not served a list that predates it for longer than one stale read.
function namedKey(txs) { return txs.join(','); }

/**
 * The receipts of every transaction the books name, cached like the balance (fresh for FRESH_SECONDS,
 * then served stale while a background refresh runs). A cold colo gives the RPC a short budget and
 * answers without the list rather than making /books wait on it.
 *
 * `txs` is the list of lower-case hashes from the books (chain_movements and revenue). Returns the
 * record, { pending: true } while a cold colo's first read is in flight, or null when every RPC failed.
 */
export async function receiveTransfers(address, txs, ctx) {
  const named = [...new Set(txs.map((t) => String(t).toLowerCase()).filter((t) => TX_RE.test(t)))].slice(0, MAX_NAMED_TXS);
  if (!named.length) return { items: [], unreadable: [], named: 0, rpc: null, fetched_at: new Date().toISOString(), age_seconds: 0, source: 'none' };
  let cached = null;
  let age = null;
  try {
    const hit = await caches.default.match(RECEIPTS_CACHE_KEY);
    if (hit) cached = await hit.json();
  } catch {
    // cache unavailable: fall through to the RPCs
  }
  if (cached) {
    age = Math.floor((Date.now() - Date.parse(cached.fetched_at)) / 1000);
    if (!Number.isFinite(age) || age < 0 || !Array.isArray(cached.items) || cached.named_key !== namedKey(named)) cached = null; // corrupt or built from a different set of named txs: refetch
  }
  if (cached && age < FRESH_SECONDS) return { ...cached, age_seconds: age, source: 'cache' };
  // An incomplete read (some receipts refused by every RPC) is a failed read: never cached, never shown
  // as unconfirmed rows. The stale copy, if there is one, keeps serving; a cold colo shows the error.
  const refresh = () => readReceiptsOnce(address, named).then((rec) => (rec && !rec.incomplete ? { ...rec, named_key: namedKey(named) } : null));
  if (cached) {
    ctx.waitUntil(refresh().then((rec) => (rec ? cachePut(RECEIPTS_CACHE_KEY, rec) : undefined)));
    return { ...cached, age_seconds: age, source: 'stale-cache' };
  }
  const p = refresh().then(async (rec) => {
    // This promise is awaited below as well as waitUntil'd: a cache failure must not reject it.
    if (rec) { try { await cachePut(RECEIPTS_CACHE_KEY, rec); } catch { /* cache unavailable */ } }
    return rec;
  });
  ctx.waitUntil(p);
  const rec = await Promise.race([p, new Promise((res) => setTimeout(() => res(undefined), RECEIPTS_SYNC_BUDGET_MS))]);
  if (rec === undefined) return { pending: true };
  if (!rec) return null;
  return { ...rec, age_seconds: 0, source: 'rpc' };
}

/** The RPCs the list is read from, in order, for the page to name. */
export const RECEIPT_SOURCES = RECEIPT_RPCS;

// The exact command that reproduces one row of the itemized list, published with it: the receipt of
// a named transaction, whose USDC Transfer log naming the address is the row.
export function reproduceReceiptCurl(tx) {
  const t = TX_RE.test(String(tx).toLowerCase()) ? String(tx).toLowerCase() : '0x<tx hash from chain_movements[] or revenue[]>';
  return `curl -s ${RECEIPT_RPCS[0]} -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["${t}"]}'  # in .result.logs, the entry with address ${USDC_BASE} and topics[0] ${TRANSFER_TOPIC} is the USDC transfer: topics[1] is from, topics[2] is to (low 20 bytes), data is the amount in atomic USDC (6 dp). Repeat for every tx the books name.`;
}

// The exact command that reproduces the number, published with it.
export function reproduceCurl(address) {
  return `curl -s ${RPCS[0]} -H 'content-type: application/json' --data '${balanceCallBody(address)}'  # .result is hex; as a decimal integer / 1e6 = USDC`;
}

export const CHAIN_INFO = { network: 'base', chain_id: 8453, usdc_contract: USDC_BASE, rpcs: RPCS, fresh_seconds: FRESH_SECONDS };

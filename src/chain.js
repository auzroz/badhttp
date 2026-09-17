// Live chain reads for /books. The project holds no key that can spend from the receive
// address (the operator does), so from the project's side it is receive-only; the address
// itself is a normal wallet whose every USDC movement is public. Two reads feed /books:
// one eth_call balanceOf (the aggregate; no indexer, no storage) and an itemized transfer
// list from a public Blockscout indexer (both directions, so a withdrawal can never hide).
// Designed in docs/research-session-3.md (session 3), built sessions 14–15.
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
const TRANSFERS_CACHE_KEY = 'https://badhttp.dev/__internal/books-chain-transfers';
// Public Blockscout indexer for the itemized transfer list (probed in docs/research-session-3.md;
// no key, 180 req/min/IP). Its latency is weather: ~2 s on a good day, 20 s+ on a bad one — so
// /books never blocks on it beyond a short budget; see receiveTransfers.
const BLOCKSCOUT = 'https://base.blockscout.com/api/v2';
const TRANSFERS_SYNC_BUDGET_MS = 3000;
const TRANSFERS_TIMEOUT_MS = 20000;
// One Blockscout page is 50 rows; we read one page per direction and say so when there are more.
const TRANSFERS_PAGE = 50;

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

// ---------- itemized transfers (Blockscout) ----------

function transfersUrl(address, dir) {
  return `${BLOCKSCOUT}/addresses/${address}/token-transfers?type=ERC-20&token=${USDC_BASE}&filter=${dir}`;
}

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC_RE = /^\d{1,30}$/;
const USDC_LC = USDC_BASE.toLowerCase();

// One direction, one page. Every field is validated before it can reach the page: the indexer
// is a third party and its answer is untrusted input. Invalid rows — including any row whose
// token contract is not USDC, whatever the query asked for — are dropped and counted, never
// rendered and never fatal.
async function readTransfersSide(address, dir) {
  const r = await fetch(transfersUrl(address, dir), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TRANSFERS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`blockscout ${r.status}`);
  const j = await r.json();
  if (!j || !Array.isArray(j.items)) throw new Error('blockscout bad shape');
  const items = [];
  let dropped = 0;
  for (const it of j.items.slice(0, TRANSFERS_PAGE)) {
    const tx = it?.transaction_hash, from = it?.from?.hash, to = it?.to?.hash, value = it?.total?.value;
    const li = it?.log_index, bn = it?.block_number, ts = Date.parse(it?.timestamp ?? '');
    const tok = String(it?.token?.address_hash ?? it?.token?.address ?? '').toLowerCase();
    if (!TX_RE.test(String(tx)) || !ADDR_RE.test(String(from)) || !ADDR_RE.test(String(to))
      || !ATOMIC_RE.test(String(value)) || !Number.isInteger(bn) || !Number.isFinite(ts)
      || tok !== USDC_LC) { dropped++; continue; }
    // Zero-value Transfers move no USDC and are permissionlessly forgeable (transferFrom(x, y, 0)
    // succeeds with no allowance) — classic address-poisoning spam that could fake an "unexplained
    // withdrawal" alarm. Excluding them cannot hide a genuine movement (those have value > 0).
    if (BigInt(String(value)) === 0n) continue;
    items.push({
      tx: String(tx).toLowerCase(), from: String(from).toLowerCase(), to: String(to).toLowerCase(),
      atomic: String(value), log_index: Number.isInteger(li) ? li : 0, block_number: bn,
      timestamp: new Date(ts).toISOString(),
    });
  }
  return { items, truncated: j.next_page_params != null, dropped };
}

// Both directions in parallel (the indexer's unfiltered query is 10x slower than its filtered
// one — measured), merged newest-first, deduplicated by (tx, log_index) so a self-transfer or
// a multi-transfer transaction cannot appear twice.
async function readTransfersFromIndexer(address) {
  const a = address.toLowerCase();
  const [inn, out] = await Promise.all([readTransfersSide(address, 'to'), readTransfersSide(address, 'from')]);
  const seen = new Set();
  const items = [];
  for (const it of [...inn.items, ...out.items]) {
    const key = `${it.tx}:${it.log_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...it, direction: it.from === a && it.to === a ? 'self' : it.to === a ? 'in' : 'out' });
  }
  items.sort((x, y) => (y.block_number - x.block_number) || (y.log_index - x.log_index));
  // A truncated side covers only blocks back to its oldest fetched row; merged rows older than
  // that boundary would sit below an invisible gap (that side's remaining rows are on its next
  // page). Trim to the shallower window so the list really is the newest movements, gap-free.
  let cutoff = null;
  for (const side of [inn, out]) {
    if (side.truncated && side.items.length) {
      const last = side.items[side.items.length - 1];
      if (!cutoff || last.block_number > cutoff.block_number
        || (last.block_number === cutoff.block_number && last.log_index > cutoff.log_index)) cutoff = last;
    }
  }
  const kept = cutoff
    ? items.filter((it) => it.block_number > cutoff.block_number
      || (it.block_number === cutoff.block_number && it.log_index >= cutoff.log_index))
    : items;
  return { items: kept, truncated: inn.truncated || out.truncated, dropped: inn.dropped + out.dropped, fetched_at: new Date().toISOString() };
}

let inflightTransfers = null;
function readTransfers(address) {
  inflightTransfers ??= readTransfersFromIndexer(address)
    .catch(() => null)
    .finally(() => { inflightTransfers = null; });
  return inflightTransfers;
}

// Same cache dance as receiveBalance, with one difference: a cold colo gives the indexer a
// short budget (TRANSFERS_SYNC_BUDGET_MS) and then answers without it — the fetch finishes
// and caches in the background, so /books latency never rides Blockscout's weather.
// Returns the cached/fresh record, { pending: true } when the first read at this colo is
// still in flight, or null when the indexer failed outright.
export async function receiveTransfers(address, ctx) {
  let cached = null;
  let age = null;
  try {
    const hit = await caches.default.match(TRANSFERS_CACHE_KEY);
    if (hit) cached = await hit.json();
  } catch {
    // cache unavailable: fall through to the indexer
  }
  if (cached) {
    age = Math.floor((Date.now() - Date.parse(cached.fetched_at)) / 1000);
    if (!Number.isFinite(age) || age < 0 || !Array.isArray(cached.items)) cached = null; // corrupt record: refetch
  }
  if (cached && age < FRESH_SECONDS) return { ...cached, age_seconds: age, source: 'cache' };
  if (cached) {
    ctx.waitUntil(readTransfers(address).then((rec) => (rec ? cachePut(TRANSFERS_CACHE_KEY, rec) : undefined)));
    return { ...cached, age_seconds: age, source: 'stale-cache' };
  }
  const p = readTransfers(address).then(async (rec) => {
    // This promise is awaited below as well as waitUntil'd: a cache failure must not reject it.
    if (rec) { try { await cachePut(TRANSFERS_CACHE_KEY, rec); } catch { /* cache unavailable */ } }
    return rec;
  });
  ctx.waitUntil(p);
  const rec = await Promise.race([p, new Promise((res) => setTimeout(() => res(undefined), TRANSFERS_SYNC_BUDGET_MS))]);
  if (rec === undefined) return { pending: true };
  if (!rec) return null;
  return { ...rec, age_seconds: 0, source: 'indexer' };
}

// The exact commands that reproduce the itemized list, published with it.
export function reproduceTransfersCurl(address) {
  return `curl -s '${transfersUrl(address, 'to')}'  # incoming; use filter=from for outgoing. Each item: timestamp, transaction_hash, from.hash, to.hash, total.value (atomic USDC, 6 dp)`;
}

// The exact command that reproduces the number, published with it.
export function reproduceCurl(address) {
  return `curl -s ${RPCS[0]} -H 'content-type: application/json' --data '${balanceCallBody(address)}'  # .result is hex; as a decimal integer / 1e6 = USDC`;
}

export const CHAIN_INFO = { network: 'base', chain_id: 8453, usdc_contract: USDC_BASE, rpcs: RPCS, fresh_seconds: FRESH_SECONDS };

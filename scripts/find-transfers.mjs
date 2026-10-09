#!/usr/bin/env node
// Find USDC transfers to or from an address on Base mainnet without an indexer, by walking
// eth_getLogs over a keyless public RPC in bounded windows, with backoff on its rate limit. Written
// session 30 (2026-10-09) after the public Blockscout indexer stopped answering; the shape is the
// session-29 scratchpad script the ledger describes.
//
// RPC and window (probed 2026-10-09): base.rpc.thirdweb.com answers up to 1,000 blocks per query and
// is the default (a UTC day is ~43k blocks: ~88 calls, under a minute); mainnet.base.org answers 500
// and rate-limits an IP hard once tripped (BASE_RPC=https://mainnet.base.org WINDOW_BLOCKS=500);
// 1rpc.io and nodies allow 50, blastapi 10, dRPC refuses on its free plan, publicnode wants a token.
//
// This is the DISCOVERY half of the books' chain reconciliation: /books itemizes only the
// transactions the books already name (receipts by hash, src/chain.js), and the balance identity
// there says when something unnamed has moved; this script finds its hash so the session can book it.
//
// Usage:
//   scripts/find-transfers.mjs --since 2026-10-06            # UTC date; walks from 00:00 that day to the chain head
//   scripts/find-transfers.mjs --since 2026-10-06 --until 2026-10-07   # --until is exclusive: the walk ends before 00:00 UTC of that date
//   scripts/find-transfers.mjs --from-block 52230000 --to-block 52240000
//   scripts/find-transfers.mjs --since 2026-10-01 --unknown  # print only transfers src/books.js does not name
//   scripts/find-transfers.mjs ... --address 0x...            # default: the receive address from src/books.js
//
// Output: one JSON line per transfer: {block, timestamp, tx, log_index, direction, from, to, amount_usdc, named}.
// ~88 RPC calls per UTC day at the default window (Base mints a block every 2 s). Exit 0 with "found: N" on stderr.

import { BOOKS } from '../src/books.js';

const RPC = process.env.BASE_RPC || 'https://base.rpc.thirdweb.com';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WINDOW = Number(process.env.WINDOW_BLOCKS || 1000); // thirdweb caps a query at 1,000 blocks; mainnet.base.org at 500

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);
const address = (opt('--address') || BOOKS.receive_address).toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(address)) { console.error('bad --address'); process.exit(2); }
const topicOf = (addr) => `0x${addr.slice(2).padStart(64, '0')}`;

let rpcId = 0;
async function rpc(method, params, tries = 12) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
    const j = await r.json().catch(() => null);
    if (j && j.result !== undefined && !j.error) return j.result;
    const msg = j?.error?.message || `http ${r.status}`;
    if (attempt >= tries) throw new Error(`${method}: ${msg}`);
    // -32016 / "request limit reached": the public RPC's limit is per IP and persists for a while once
    // tripped, so back off hard (3 s, 6 s, ... up to a minute) rather than hammering it; anything else
    // is retried the same way.
    process.stderr.write(`  ${method}: ${msg}; retry ${attempt + 1}/${tries}\n`);
    await new Promise((res) => setTimeout(res, Math.min(60000, 3000 * (attempt + 1))));
  }
}

const hexToInt = (h) => Number(BigInt(h));
async function blockTime(n) {
  const b = await rpc('eth_getBlockByNumber', [`0x${n.toString(16)}`, false]);
  if (!b || !b.timestamp) throw new Error(`block ${n}: no header from the RPC (beyond the head, or pruned)`);
  return hexToInt(b.timestamp);
}

// First block at or after a UTC timestamp, by binary search over block timestamps.
async function blockAtOrAfter(ts, head) {
  if (!Number.isFinite(ts)) throw new Error('bad date');
  // A timestamp after the head: the answer is a block that does not exist yet, so say so rather than
  // returning the head (which would make --until <tomorrow> drop the newest block and --since <future>
  // walk one block).
  if (await blockTime(head) < ts) return head + 1;
  let lo = 0, hi = head;
  // Start the search near the estimate (2 s per block) to save calls.
  const est = Math.max(0, head - Math.round((Math.floor(Date.now() / 1000) - ts) / 2));
  const span = 20000;
  lo = Math.max(0, est - span); hi = Math.min(head, est + span);
  if (await blockTime(lo) > ts) lo = 0;
  if (await blockTime(hi) < ts) hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await blockTime(mid) < ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const head = hexToInt(await rpc('eth_blockNumber', []));
let from, to;
if (opt('--from-block')) from = Number(opt('--from-block'));
else {
  const since = opt('--since') || new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  from = await blockAtOrAfter(Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000), head);
}
if (opt('--to-block')) to = Number(opt('--to-block'));
else if (opt('--until')) to = Math.min(head, (await blockAtOrAfter(Math.floor(Date.parse(`${opt('--until')}T00:00:00Z`) / 1000), head)) - 1);
else to = head;
if (!(from >= 0 && to >= from)) { console.error(`bad range ${from}..${to}`); process.exit(2); }

const named = new Set([...(BOOKS.chain_movements || []).map((m) => m.tx), ...(BOOKS.revenue || []).map((r) => r.tx)].filter(Boolean).map((t) => String(t).toLowerCase()));
console.error(`walking blocks ${from}..${to} (${to - from + 1} blocks, ~${Math.ceil((to - from + 1) / WINDOW) * 2} calls) on ${RPC} for ${address}`);

let found = 0;
const tsCache = new Map();
for (let start = from; start <= to; start += WINDOW) {
  const end = Math.min(to, start + WINDOW - 1);
  const range = { fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, address: USDC };
  // Sequential, not parallel: two concurrent calls trip the public RPC's limit twice as fast.
  const inn = await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, topicOf(address)] }]);
  const out = await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, topicOf(address), null] }]);
  const seen = new Set();
  for (const lg of [...inn, ...out]) {
    const key = `${lg.transactionHash}:${lg.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = `0x${lg.topics[1].slice(26)}`.toLowerCase();
    const t = `0x${lg.topics[2].slice(26)}`.toLowerCase();
    const amount = BigInt(lg.data);
    if (amount === 0n) continue; // forgeable zero-value spam
    const tx = lg.transactionHash.toLowerCase();
    const isNamed = named.has(tx);
    if (flag('--unknown') && isNamed) continue;
    const bn = hexToInt(lg.blockNumber);
    if (!tsCache.has(bn)) tsCache.set(bn, new Date((await blockTime(bn)) * 1000).toISOString());
    found++;
    console.log(JSON.stringify({
      block: bn, timestamp: tsCache.get(bn), tx, log_index: hexToInt(lg.logIndex),
      direction: f === address && t === address ? 'self' : t === address ? 'in' : 'out',
      from: f, to: t, amount_usdc: `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, '0')}`, named: isNamed,
    }));
  }
  await new Promise((res) => setTimeout(res, 350));
}
console.error(`found: ${found}`);

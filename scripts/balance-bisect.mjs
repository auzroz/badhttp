// Find every block where an address's USDC balance on Base changes, by bisecting historical balanceOf, then read
// the Transfer log(s) in each such block. Written in session 38 (2026-11-23), when scripts/find-transfers.mjs (a
// windowed eth_getLogs walk) was rate-limited out: Base's block interval fell from 2.0 s to about 0.22 s between
// 2026-11-04 and 2026-11-17, so a day of chain is ~390,000 blocks and the windowed walk now needs ~9x the calls.
// A bisection costs ~25 balanceOf calls per change, whatever the span.
//
//   node scripts/balance-bisect.mjs <from-block> [to-block|latest]        # default address: the receive address in src/books.js
//   BASE_RPC=https://base-mainnet.public.blastapi.io node scripts/balance-bisect.mjs 61000000
//
// ONE RPC ONLY, on purpose: a bisection that rotates between nodes on failure compares two nodes' answers and
// invents a change (session 38's first pass put a 10:00:37 transfer at 08:27). It retries the same node with backoff.
// Assumes no inflow and outflow cancel between two sampled blocks; the printed sum of changes must equal the
// balance difference, and it says so if not. Output: one JSON line per incoming Transfer log, then a summary.
import { BOOKS } from '../src/books.js';

const RPC = process.env.BASE_RPC || 'https://base-mainnet.public.blastapi.io';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const addrArg = process.argv.indexOf('--address');
const ADDR = (addrArg > 0 ? process.argv[addrArg + 1] : BOOKS.receive_address).toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(ADDR)) { console.error('bad --address'); process.exit(2); }
let id = 0;
async function rpc(method, params) {
  for (let t = 0; t < 12; t++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      const j = await r.json();
      if (j.result !== undefined && j.result !== null) return j.result;
    } catch {}
    await new Promise((s) => setTimeout(s, 500 * (t + 1)));
  }
  throw new Error(`${method} failed 12 times at ${RPC}`);
}
const hex = (n) => '0x' + n.toString(16);
const bal = async (b) => BigInt(await rpc('eth_call', [{ to: USDC, data: '0x70a08231' + ADDR.slice(2).padStart(64, '0') }, hex(b)]));
const from = Number(process.argv[2]);
if (!Number.isInteger(from) || from < 1) { console.error('usage: balance-bisect.mjs <from-block> [to-block|latest] [--address 0x…]'); process.exit(2); }
const to = process.argv[3] && /^\d+$/.test(process.argv[3]) ? Number(process.argv[3]) : Number(await rpc('eth_blockNumber', []));
const cache = new Map();
const B = async (b) => { if (!cache.has(b)) cache.set(b, await bal(b)); return cache.get(b); };
const changes = [];
async function walk(lo, hi) {
  if ((await B(lo)) === (await B(hi))) return;
  if (hi - lo === 1) { changes.push(hi); return; }
  const mid = Math.floor((lo + hi) / 2);
  await walk(lo, mid); await walk(mid, hi);
}
await walk(from, to);
let sum = 0n;
for (const b of changes) {
  const d = (await B(b)) - (await B(b - 1)); sum += d;
  const logs = await rpc('eth_getLogs', [{ address: USDC, fromBlock: hex(b), toBlock: hex(b), topics: [TRANSFER, null, '0x' + ADDR.slice(2).padStart(64, '0')] }]);
  const blk = await rpc('eth_getBlockByNumber', [hex(b), false]);
  if (!logs.length) console.log(JSON.stringify({ block: b, time: new Date(Number(blk.timestamp) * 1000).toISOString(), delta: Number(d) / 1e6, note: 'balance changed but no incoming Transfer log here: an outflow, or a node disagreement — re-run' }));
  for (const l of logs) {
    const tx = await rpc('eth_getTransactionByHash', [l.transactionHash]);
    const known = BOOKS.revenue.some((r) => r.tx === l.transactionHash) || (BOOKS.chain_movements || []).some((m) => m.tx === l.transactionHash);
    console.log(JSON.stringify({ block: b, time: new Date(Number(blk.timestamp) * 1000).toISOString(), tx: l.transactionHash, from: '0x' + l.topics[1].slice(26), amount: Number(BigInt(l.data)) / 1e6, relayer: tx.from, called: tx.to, selector: tx.input.slice(0, 10), named_in_books: known }));
  }
}
const diff = (await B(to)) - (await B(from));
console.log(JSON.stringify({ rpc: RPC, address: ADDR, from, to, balance_from: Number(await B(from)) / 1e6, balance_to: Number(await B(to)) / 1e6, changes: changes.length, sum_of_changes: Number(sum) / 1e6, consistent: sum === diff }));

// Harness self-test driver (DRY RUNS ONLY; never in the roster, enabled by X402_SELFTEST=1 in run.mjs against a stand-in):
//   node selftest.mjs loop
// `loop` answers every 402 by re-sending the same GET with a fixed, unsigned PAYMENT-SIGNATURE header, up to 40 times, and stops on
// any other status. It exists to prove that the recorder's request budget cuts a looping client off at 12 upstream requests and that
// the row says budget_exhausted. It needs no key and signs nothing.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

if (process.argv[2] !== 'loop') { process.stderr.write('usage: selftest.mjs loop\n'); process.exit(2); }
const fixed = Buffer.from(JSON.stringify({ x402Version: 2, payload: { note: 'harness self-test, unsigned' } })).toString('base64');
process.stdout.write('HELLO ' + JSON.stringify({ library: 'harness self-test (node fetch loop)', version: process.version, runtime: 'node ' + process.version, http: '1.1', generation: 'v2', configuration: 'resends the same request with a fixed unsigned PAYMENT-SIGNATURE on every 402, at most 40 times; signs nothing' }) + '\n');
const rl = createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', (line) => {
  chain = chain.then(async () => {
    if (line.startsWith('FETCH ')) {
      const url = line.slice(6).trim();
      let res; let body = Buffer.alloc(0); let tries = 0;
      for (; tries < 40; tries++) {
        res = await fetch(url, { redirect: 'manual', headers: tries ? { 'PAYMENT-SIGNATURE': fixed } : {} });
        body = Buffer.from(await res.arrayBuffer());
        if (res.status !== 402) break;
      }
      process.stdout.write('RESULT ' + JSON.stringify({ ok: true, status: res.status, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), error: null, library_says: { requests_sent: tries + 1 }, exit: null }) + '\n');
    } else if (line.trim() === 'QUIT') process.stdout.write('', () => process.exit(0));
  });
});
rl.on('close', () => { chain.then(() => process.exit(0)); });

// Pay an x402 endpoint with the LEGACY v1 client (x402-fetch@1.2.0), which never reads response headers: it parses
// the 402 JSON body's "accepts" and pays with an X-PAYMENT header. This is the client generation the dual-form body
// exists for (LEDGER.md #8). Usage:
//   X402_TEST_PAYER_KEY=0x... node scripts/x402-pay-v1.mjs <url> [base-sepolia|base]
// Run it from a directory where `npm install x402-fetch@1.2.0 x402@1.2.0 viem` has been done (the repo's own
// devDependencies are the v2-era @x402/* packages; the two generations' packages are distinct on npm).
// The payer needs USDC on the chosen network and no ETH (the facilitator pays gas). Never put a mainnet key here.
import { wrapFetchWithPayment, createSigner, decodeXPaymentResponse } from 'x402-fetch';

const key = process.env.X402_TEST_PAYER_KEY;
if (!key) { console.error('set X402_TEST_PAYER_KEY'); process.exit(2); }
const url = process.argv[2];
if (!url) { console.error('usage: x402-pay-v1.mjs <url> [base-sepolia|base]'); process.exit(2); }
const network = process.argv[3] || 'base-sepolia';
const signer = await createSigner(network, key);
// maxValue 2 USDC so the 0.01–1.00 range is payable; the library default is 0.1 USDC.
const fetchWithPayment = wrapFetchWithPayment(fetch, signer, BigInt(2_000_000));
console.error('payer', signer.account?.address ?? signer.address, 'network', network, '(x402 v1: body + X-PAYMENT)');
try {
  const r = await fetchWithPayment(url, { method: 'GET' });
  console.log('status', r.status);
  for (const [k, v] of r.headers) if (/payment/i.test(k)) console.log('hdr', k, v.length > 120 ? v.slice(0, 120) + '…' : v);
  const xr = r.headers.get('X-PAYMENT-RESPONSE');
  if (xr) { try { console.log('receipt', JSON.stringify(decodeXPaymentResponse(xr))); } catch (e) { console.log('receipt undecodable:', e.message); } }
  console.log('body', (await r.text()).slice(0, 3000));
} catch (e) {
  console.log('ERROR', e?.message || e);
  if (e?.cause) console.log('cause', e.cause?.message || e.cause);
  if (e?.response) console.log('response status', e.response.status);
}

// Pay an x402 endpoint with the official client. Usage (after `npm install`, which pulls the devDependencies):
//   X402_TEST_PAYER_KEY=0x... npm run pay -- https://badhttp.dev/402/pay [eip155:84532|eip155:8453]
// The payer needs USDC on the chosen network and no ETH (the facilitator pays gas). Never put a mainnet key here.
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const key = process.env.X402_TEST_PAYER_KEY;
if (!key) { console.error('set X402_TEST_PAYER_KEY'); process.exit(2); }
const url = process.argv[2];
if (!url) { console.error('usage: x402-pay.mjs <url> [network]'); process.exit(2); }
const network = process.argv[3] || 'eip155:84532';
const account = privateKeyToAccount(key);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network, client: new ExactEvmScheme(account) }] });
console.error('payer', account.address, 'network', network);
try {
  const r = await fetchWithPayment(url, { method: 'GET' });
  console.log('status', r.status);
  for (const [k, v] of r.headers) if (/payment/i.test(k)) console.log('hdr', k, v.length > 120 ? v.slice(0, 120) + '…' : v);
  const pr = r.headers.get('PAYMENT-RESPONSE');
  if (pr) { try { console.log('receipt', JSON.stringify(decodePaymentResponseHeader(pr))); } catch (e) { console.log('receipt undecodable:', e.message); } }
  console.log('body', (await r.text()).slice(0, 3000));
} catch (e) {
  console.log('ERROR', e?.message || e);
  if (e?.cause) console.log('cause', e.cause?.message || e.cause);
}

// Node x402 payment-client drivers for the /402 witness family. Speaks the driver protocol (see README.md):
//
//   X402_WITNESS_PAYER_KEY=0x... X402_NODEMODS=<dir holding node_modules> node node-clients.mjs <client-id>
//
// client ids: see the `clients` table below (the roster, not this file, says which are captured).
// Each cell starts a fresh process, builds ONE payment-wrapped client with the throwaway Base Sepolia payer (a local private key,
// registered for eip155:84532 only) and makes ONE wrapped GET per FETCH line. No redirects, no retries of our own, no spending limit
// set by us. The key is read from the environment, removed from it, and never printed.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// No proxy variables reach the libraries: the family measures the client, not an environment's proxy.
for (const k of Object.keys(process.env)) if (/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(k)) delete process.env[k];
process.env.NO_PROXY = '*';

const RUNTIME = 'node ' + process.version;
const NETWORK = 'eip155:84532';

const KEY = process.env.X402_WITNESS_PAYER_KEY || '';
delete process.env.X402_WITNESS_PAYER_KEY;
const keyForms = KEY ? [KEY, KEY.toLowerCase(), KEY.replace(/^0x/, '')] : [];

function scrub(text) {
  let t = String(text == null ? '' : text);
  for (const k of keyForms) t = t.split(k).join('<key>');
  return t
    .replace(/0x[0-9a-fA-F]{64,}/g, '<hex>')
    .replace(/https?:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, 'https://badhttp.dev')
    .replace(/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, '<host>')
    .replace(/(?:\/Users|\/Volumes|\/private|\/var|\/tmp|\/home)\/[^\s'")\]]+/g, '<path>')
    .replace(/(<host>['")\]]*)[,: ]+\d{2,5}\b/g, '$1')
    .replace(/\bports?\s*[=:]?\s*\d{2,5}\b/gi, 'port')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

function die(message) {
  process.stderr.write('driver: ' + scrub(message) + '\n');
  process.exit(2);
}

// Resolve ESM entry points from X402_NODEMODS (the driver lives in the repo; the libraries live in the scratch install). Each library's
// own imports then resolve from its own location inside that node_modules.
const root = process.env.X402_NODEMODS ? join(resolve(process.env.X402_NODEMODS), 'node_modules') : null;
if (!root) die('X402_NODEMODS is not set');
function pkgJson(name) {
  const p = join(root, name, 'package.json');
  if (!existsSync(p)) die(`module ${name} not found under X402_NODEMODS`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
const pkgVersion = (name) => pkgJson(name).version;
const CONDITIONS = new Set(['import', 'node', 'default']);
function pick(x) {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) { for (const y of x) { const r = pick(y); if (r) return r; } return null; }
  if (x && typeof x === 'object') for (const k of Object.keys(x)) if (CONDITIONS.has(k)) { const r = pick(x[k]); if (r) return r; }
  return null;
}
function resolveEsm(spec) {
  const m = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/.exec(spec);
  const name = m[1]; const sub = m[2] ? `.${m[2]}` : '.';
  const pkg = pkgJson(name);
  let target = null;
  if (pkg.exports) {
    const ex = pkg.exports;
    const entry = typeof ex === 'string' || Array.isArray(ex) || !Object.keys(ex).some((k) => k.startsWith('.')) ? (sub === '.' ? ex : null) : ex[sub];
    target = pick(entry);
  } else if (sub === '.') target = pkg.module || pkg.main || 'index.js';
  else target = sub.slice(2);
  if (!target) die(`module ${spec} has no ESM entry`);
  return pathToFileURL(join(root, name, target)).href;
}
async function load(spec) {
  try { return await import(resolveEsm(spec)); } catch (e) { die(`import ${spec}: ${e && e.message}`); }
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const errName = (e) => (e && (e.name && e.name !== 'Error' ? e.name : e.constructor && e.constructor.name || e.name)) || 'Error';

async function makeAccount() {
  if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) die('X402_WITNESS_PAYER_KEY is not a 0x-prefixed 64-hex key');
  const { privateKeyToAccount } = await load('viem/accounts');
  return privateKeyToAccount(KEY);
}

// A viem wallet client on Base Sepolia over the local account, for the v1-era libraries (they read the chain from it). The transport is
// never used: the libraries only sign.
async function makeWalletClient() {
  const account = await makeAccount();
  const viem = await load('viem');
  const chains = await load('viem/chains');
  return viem.createWalletClient({ account, chain: chains.baseSepolia, transport: viem.http('http://127.0.0.1:1') });
}

// Each client: { library, version, generation, configuration, fetchOne(url) -> {status, body:Buffer, says} }
const clients = {
  // @x402/fetch + @x402/evm: the x402 foundation's v2 SDK. wrapFetchWithPayment(fetch, client) with an x402Client that has the exact EVM
  // scheme registered for eip155:84532 only. The two hooks below are the library's own observation points: they read what it selected
  // and return nothing, so they change no behaviour.
  async 'x402-fetch-v2'() {
    const fetchMod = await load('@x402/fetch');
    const evm = await load('@x402/evm');
    const account = await makeAccount();
    const says = {};
    const client = fetchMod.x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new evm.ExactEvmScheme(account) }] });
    client.onAfterPaymentCreation(async (ctx) => {
      const r = ctx && ctx.selectedRequirements;
      says.payment_created = true;
      says.selected = r ? { scheme: r.scheme, network: r.network, amount: r.amount, payTo: r.payTo } : null;
    });
    client.onPaymentCreationFailure(async (ctx) => {
      says.creation_failed = { name: errName(ctx && ctx.error), message: scrub(ctx && ctx.error && ctx.error.message) };
    });
    const wrapped = fetchMod.wrapFetchWithPayment(fetch, client);
    return {
      library: '@x402/fetch + @x402/evm',
      version: `${pkgVersion('@x402/fetch')} (@x402/core ${pkgVersion('@x402/core')}, @x402/evm ${pkgVersion('@x402/evm')}, viem ${pkgVersion('viem')})`,
      generation: 'v2',
      configuration: 'Base Sepolia (eip155:84532) registered with an exact EVM scheme on an x402Client; signer: a local private key (viem account); library defaults',
      async fetchOne(url) {
        for (const k of Object.keys(says)) delete says[k];
        let res;
        try { res = await wrapped(url, { method: 'GET', redirect: 'manual' }); } catch (e) { e.__says = { ...says }; throw e; }
        const body = Buffer.from(await res.arrayBuffer());
        const out = { ...says };
        const h = res.headers.get('payment-response') || res.headers.get('x-payment-response');
        if (h) {
          try { out.receipt = fetchMod.decodePaymentResponseHeader(h); } catch (e) { out.receipt_decode_error = errName(e); }
        }
        return { status: res.status, body, says: out };
      },
    };
  },

  // @x402/axios + @x402/evm: the same SDK's axios wrapper. wrapAxiosWithPayment(axios.create({maxRedirects: 0}), client) with the same
  // x402Client. axios rejects any non-2xx final response, so a 402 or 500 after payment arrives as an AxiosError, not a response. The
  // response body is axios's default (JSON parsed when it parses): bytes/sha256 are of the string, or of JSON.stringify(data).
  async 'x402-axios-v2'() {
    const ax = await load('@x402/axios');
    const evm = await load('@x402/evm');
    const axiosMod = await load('axios');
    const axios = axiosMod.default || axiosMod;
    const account = await makeAccount();
    const says = {};
    const client = ax.x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new evm.ExactEvmScheme(account) }] });
    client.onAfterPaymentCreation(async (ctx) => {
      const r = ctx && ctx.selectedRequirements;
      says.payment_created = true;
      says.selected = r ? { scheme: r.scheme, network: r.network, amount: r.amount, payTo: r.payTo } : null;
    });
    client.onPaymentCreationFailure(async (ctx) => {
      says.creation_failed = { name: errName(ctx && ctx.error), message: scrub(ctx && ctx.error && ctx.error.message) };
    });
    const instance = ax.wrapAxiosWithPayment(axios.create({ maxRedirects: 0 }), client);
    const asBuffer = (d) => (d == null ? Buffer.alloc(0) : Buffer.isBuffer(d) ? d : typeof d === 'string' ? Buffer.from(d) : Buffer.from(JSON.stringify(d)));
    return {
      library: '@x402/axios + @x402/evm',
      version: `${pkgVersion('@x402/axios')} (@x402/core ${pkgVersion('@x402/core')}, @x402/evm ${pkgVersion('@x402/evm')}, axios ${pkgVersion('axios')}, viem ${pkgVersion('viem')})`,
      generation: 'v2',
      configuration: 'Base Sepolia (eip155:84532) registered with an exact EVM scheme on an x402Client; signer: a local private key (viem account); library defaults',
      async fetchOne(url) {
        for (const k of Object.keys(says)) delete says[k];
        let res;
        try { res = await instance.get(url); } catch (e) { e.__says = { ...says }; throw e; }
        const out = { ...says };
        const h = res.headers && (res.headers['payment-response'] || res.headers['x-payment-response']);
        if (h) {
          try { out.receipt = ax.decodePaymentResponseHeader(h); } catch (e) { out.receipt_decode_error = errName(e); }
        }
        return { status: res.status, body: asBuffer(res.data), says: out };
      },
    };
  },

  // x402-fetch (the v1-era package): wrapFetchWithPayment(fetch, account) with the viem local account as the signer. The v1 API takes no
  // network list: the library's default selector picks a requirement for the signer, and its default maxValue is 0.1 USDC (100000
  // atomic units), a limit the library sets, not the harness. Reads requirements from the 402 JSON body; pays with X-PAYMENT.
  async 'x402-fetch-v1'() {
    const f1 = await load('x402-fetch');
    const wallet = await makeWalletClient();
    const wrapped = f1.wrapFetchWithPayment(fetch, wallet);
    return {
      library: 'x402-fetch (v1)',
      version: `${pkgVersion('x402-fetch')} (x402 ${pkgVersion('x402')}, viem ${pkgVersion('viem')})`,
      generation: 'v1',
      configuration: 'signer: a viem wallet client on Base Sepolia (eip155:84532) over a local private key account; library defaults',
      async fetchOne(url) {
        let res;
        try { res = await wrapped(url, { method: 'GET', redirect: 'manual' }); } catch (e) { throw e; }
        const body = Buffer.from(await res.arrayBuffer());
        const out = {};
        const h = res.headers.get('x-payment-response');
        if (h) {
          try { out.receipt = f1.decodeXPaymentResponse(h); } catch (e) { out.receipt_decode_error = errName(e); }
        }
        return { status: res.status, body, says: out };
      },
    };
  },

  // x402-axios (the v1-era package): withPaymentInterceptor(axios.create({maxRedirects: 0}), account). axios rejects a non-2xx final
  // response, so a 402 or 500 after payment arrives as an AxiosError. Default maxValue 0.1 USDC applies as for x402-fetch.
  async 'x402-axios-v1'() {
    const a1 = await load('x402-axios');
    const axiosMod = await load('axios');
    const axios = axiosMod.default || axiosMod;
    const wallet = await makeWalletClient();
    const instance = a1.withPaymentInterceptor(axios.create({ maxRedirects: 0 }), wallet);
    const asBuffer = (d) => (d == null ? Buffer.alloc(0) : Buffer.isBuffer(d) ? d : typeof d === 'string' ? Buffer.from(d) : Buffer.from(JSON.stringify(d)));
    return {
      library: 'x402-axios (v1)',
      version: `${pkgVersion('x402-axios')} (x402 ${pkgVersion('x402')}, axios ${pkgVersion('axios')}, viem ${pkgVersion('viem')})`,
      generation: 'v1',
      configuration: 'signer: a viem wallet client on Base Sepolia (eip155:84532) over a local private key account; library defaults',
      async fetchOne(url) {
        const res = await instance.get(url);
        const out = {};
        const h = res.headers && res.headers['x-payment-response'];
        if (h) {
          try { out.receipt = a1.decodeXPaymentResponse(h); } catch (e) { out.receipt_decode_error = errName(e); }
        }
        return { status: res.status, body: asBuffer(res.data), says: out };
      },
    };
  },

  // thirdweb's x402 fetch wrapper (thirdweb/x402). Needs a client id (a placeholder: nothing is sent to an account) and a wallet
  // adapter on Base Sepolia over a local private-key account. The library makes requests of its own to thirdweb hosts (contract
  // metadata, RPC); those do not pass the recorder and the survey lists them.
  async 'thirdweb-x402'() {
    const tw = await load('thirdweb');
    const chains = await load('thirdweb/chains');
    const wallets = await load('thirdweb/wallets');
    const x4 = await load('thirdweb/x402');
    const client = tw.createThirdwebClient({ clientId: 'local-dryrun' });
    if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) die('X402_WITNESS_PAYER_KEY is not a 0x-prefixed 64-hex key');
    const account = wallets.privateKeyToAccount({ client, privateKey: KEY });
    let chain = chains.baseSepolia;
    const wallet = wallets.createWalletAdapter({ client, adaptedAccount: account, chain, onDisconnect: async () => {}, switchChain: async (c) => { chain = c; } });
    const wrapped = x4.wrapFetchWithPayment(fetch, client, wallet);
    return {
      library: 'thirdweb x402 (wrapFetchWithPayment)', version: pkgVersion('thirdweb'), generation: 'both',
      configuration: 'wallet adapter on Base Sepolia (chain 84532) over a local private key account; placeholder client id; no maxValue; library defaults',
      async fetchOne(url) {
        const res = await wrapped(url, { method: 'GET', redirect: 'manual' });
        const body = Buffer.from(await res.arrayBuffer());
        return { status: res.status, body, says: { payment_response_header: !!(res.headers.get('payment-response') || res.headers.get('x-payment-response')) } };
      },
    };
  },

  // Faremeter (@faremeter/fetch with the EVM exact payment handler). On a second 402 it repeats the whole unpaid/sign/paid sequence
  // (three rounds) and then throws WrappedFetchError carrying the last response.
  async 'faremeter-fetch'() {
    const fm = await load('@faremeter/fetch');
    const lw = await load('@faremeter/wallet-evm');
    const ph = await load('@faremeter/payment-evm/exact');
    const wallet = await lw.createLocalWallet({ id: 84532, name: 'base-sepolia', rpcUrl: 'http://127.0.0.1:1' }, KEY);
    const wrapped = fm.wrap(fetch, { handlers: [ph.createPaymentHandler(wallet)] });
    return {
      library: 'Faremeter (@faremeter/fetch)', version: `${pkgVersion('@faremeter/fetch')} (@faremeter/payment-evm ${pkgVersion('@faremeter/payment-evm')}, @faremeter/wallet-evm ${pkgVersion('@faremeter/wallet-evm')})`, generation: 'both',
      configuration: 'EVM exact payment handler for chain 84532 over a local private key wallet; default asset USDC; library defaults',
      async fetchOne(url) {
        let res;
        try { res = await wrapped(url, { method: 'GET', redirect: 'manual' }); } catch (e) { if (e && e.response) e.__says = { error_response_status: e.response.status }; throw e; }
        const body = Buffer.from(await res.arrayBuffer());
        return { status: res.status, body, says: { payment_response_header: !!(res.headers.get('payment-response') || res.headers.get('x-payment-response')) } };
      },
    };
  },

  // Coinbase AgentKit's x402 action provider: makeHttpRequestWithX402 returns a JSON STRING, {success, status, data, paymentProof} or
  // {error: true, details}, and does not throw. The caller's "response" is that string: bytes and sha256 are of the string, status is
  // the status it reports on success (null on {error: true}, which is reported as error AgentKitActionError). paymentProof is never
  // copied (it holds the signed authorization): only its key names go to library_says. The library posts telemetry (the public wallet
  // address, network and action name) to cca-lite.coinbase.com when the wallet provider is built and on every action call; that is
  // its default and is NOT disabled. A failed telemetry request is an unhandled rejection that would end the process, so the driver
  // swallows unhandled rejections (it observes the rejection, it does not suppress the telemetry).
  async 'agentkit-x402'() {
    process.on('unhandledRejection', () => {});
    const ak = await load('@coinbase/agentkit');
    const viem = await load('viem');
    const chains = await load('viem/chains');
    const account = await makeAccount();
    const wc = viem.createWalletClient({ account, chain: chains.baseSepolia, transport: viem.http('http://127.0.0.1:1') });
    const wp = new ak.ViemWalletProvider(wc);
    const provider = new ak.X402ActionProvider();
    return {
      library: 'Coinbase AgentKit x402 action provider', version: `${pkgVersion('@coinbase/agentkit')} (@x402/fetch ${(() => { try { return pkgVersion('@x402/fetch'); } catch { return 'unknown'; } })()})`, generation: 'v2',
      configuration: 'ViemWalletProvider on Base Sepolia over a local private key account; makeHttpRequestWithX402; library defaults; the library\'s telemetry call to Coinbase is left at its default (not disabled)',
      async fetchOne(url) {
        const text = await provider.makeHttpRequestWithX402(wp, { url, method: 'GET' });
        const o = JSON.parse(text);
        const { paymentProof, ...parsed } = o; // the proof holds the signed authorization: its key names only
        const says = { parsed, payment_proof_keys: paymentProof && typeof paymentProof === 'object' ? Object.keys(paymentProof) : null };
        if (o.error) {
          const e = new Error(String(o.details ?? o.message ?? 'action failed'));
          e.name = 'AgentKitActionError'; e.__says = says; e.__bytes = Buffer.from(text); throw e;
        }
        return { status: Number.isInteger(o.status) ? o.status : null, body: Buffer.from(text), says };
      },
    };
  },
};

const id = process.argv[2];
if (process.argv.length !== 3 || !id || !Object.hasOwn(clients, id)) die(`usage: node-clients.mjs <${Object.keys(clients).join('|')}>`);

let client;
try { client = await clients[id](); } catch (e) { die(`setup ${id}: ${e && e.message}`); }

const out = (line) => process.stdout.write(line + '\n');
out('HELLO ' + JSON.stringify({ library: client.library, version: client.version, runtime: RUNTIME, http: '1.1', generation: client.generation, configuration: client.configuration }));

async function doFetch(url) {
  const res = { ok: false, status: null, bytes: 0, sha256: sha(Buffer.alloc(0)), error: null, library_says: null, exit: null };
  try {
    const r = await client.fetchOne(url);
    res.ok = true; res.status = r.status; res.bytes = r.body.length; res.sha256 = sha(r.body); res.library_says = r.says ?? null;
  } catch (e) {
    res.error = { name: errName(e), message: scrub(e && e.message) };
    if (e && e.__says) res.library_says = e.__says;
    if (e && e.__bytes) { res.bytes = e.__bytes.length; res.sha256 = sha(e.__bytes); }
    const resp = e && e.response;
    if (resp && (resp.status || resp.statusCode)) res.library_says = { ...(res.library_says || {}), error_response_status: resp.status ?? resp.statusCode };
    if (e && e.cause) res.library_says = { ...(res.library_says || {}), cause: `${errName(e.cause)}: ${scrub(e.cause && e.cause.message)}` };
  }
  return res;
}

// JSON-safe and scrubbed, at most 2 KB: a receipt's transaction hash is the only 0x-hex token the line may carry (the orchestrator
// enforces the same rule again).
function safe(v) {
  const s = JSON.stringify(v, (k, x) => {
    if (typeof x === 'bigint') return x.toString();
    if (typeof x === 'string') return (k === 'transaction' && /^0x[0-9a-fA-F]{64}$/.test(x)) ? x : scrub(x);
    return x;
  });
  if (s === undefined) return null;
  return s.length > 2048 ? { truncated: true } : JSON.parse(s);
}

let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  chain = chain.then(async () => {
    if (line.startsWith('FETCH ')) {
      const r = await doFetch(line.slice(6).trim());
      r.library_says = safe(r.library_says);
      out('RESULT ' + JSON.stringify(r));
    } else if (line.trim() === 'QUIT') {
      process.stdout.write('', () => process.exit(0));
    }
  });
});
rl.on('close', () => { chain.then(() => process.exit(0)); });

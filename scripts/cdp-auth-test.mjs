// Offline check of src/cdp-auth.js against Coinbase's own SDK: for a throwaway Ed25519 key and a throwaway P-256 key,
// build a JWT with this project's Web-Crypto implementation and with @coinbase/cdp-sdk's generateJwt, verify both
// with jose against the public key, and compare header and claim shapes. No network, no real credentials.
// Usage: node scripts/cdp-auth-test.mjs <dir with @coinbase/cdp-sdk and jose installed>
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { cdpJwt } from '../src/cdp-auth.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: cdp-auth-test.mjs <node_modules parent dir>'); process.exit(2); }
const req = createRequire(`${dir.replace(/\/$/, '')}/package.json`);
const { generateJwt } = req('@coinbase/cdp-sdk/auth');
const jose = req('jose');

const url = 'https://api.cdp.coinbase.com/platform/v2/x402/verify';
let failures = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

async function compare(label, env, verifyKey) {
  const mine = await cdpJwt(env, 'POST', url);
  const sdk = await generateJwt({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET, requestMethod: 'POST', requestHost: 'api.cdp.coinbase.com', requestPath: '/platform/v2/x402/verify' });
  const v1 = await jose.jwtVerify(mine, verifyKey, { issuer: 'cdp' });
  const v2 = await jose.jwtVerify(sdk, verifyKey, { issuer: 'cdp' });
  check(`${label}: ours verifies with the public key`, true);
  check(`${label}: header keys match the SDK`, JSON.stringify(Object.keys(v1.protectedHeader).sort()) === JSON.stringify(Object.keys(v2.protectedHeader).sort()), `${Object.keys(v1.protectedHeader).sort()} vs ${Object.keys(v2.protectedHeader).sort()}`);
  check(`${label}: alg matches`, v1.protectedHeader.alg === v2.protectedHeader.alg, `${v1.protectedHeader.alg} vs ${v2.protectedHeader.alg}`);
  check(`${label}: kid matches`, v1.protectedHeader.kid === v2.protectedHeader.kid);
  check(`${label}: claim keys match the SDK`, JSON.stringify(Object.keys(v1.payload).sort()) === JSON.stringify(Object.keys(v2.payload).sort()), `${Object.keys(v1.payload).sort()} vs ${Object.keys(v2.payload).sort()}`);
  check(`${label}: uris match`, JSON.stringify(v1.payload.uris) === JSON.stringify(v2.payload.uris), JSON.stringify(v1.payload.uris));
  check(`${label}: sub/iss match`, v1.payload.sub === v2.payload.sub && v1.payload.iss === 'cdp');
  check(`${label}: lifetime is 120 s`, v1.payload.exp - v1.payload.nbf === 120 && v1.payload.iat === v1.payload.nbf);
  check(`${label}: nonce is 32 hex`, /^[0-9a-f]{32}$/.test(v1.protectedHeader.nonce));
}

// Ed25519: the portal's format is base64(seed || publicKey), 64 bytes.
{
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'jwk' }).d; // base64url seed
  const pub = publicKey.export({ format: 'jwk' }).x;
  const raw = Buffer.concat([Buffer.from(seed, 'base64url'), Buffer.from(pub, 'base64url')]);
  check('ed25519 fixture is 64 bytes', raw.length === 64);
  const env = { CDP_API_KEY_ID: 'test-key-ed25519', CDP_API_KEY_SECRET: raw.toString('base64') };
  const verifyKey = await jose.importJWK({ kty: 'OKP', crv: 'Ed25519', x: pub }, 'EdDSA');
  await compare('Ed25519/EdDSA', env, verifyKey);
}
// EC P-256: the portal's format is a PKCS#8 PEM.
{
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const env = { CDP_API_KEY_ID: 'test-key-ec', CDP_API_KEY_SECRET: pem };
  const verifyKey = await jose.importSPKI(publicKey.export({ format: 'pem', type: 'spki' }), 'ES256');
  await compare('P-256/ES256', env, verifyKey);
}
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);

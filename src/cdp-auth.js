// Bearer tokens for Coinbase's CDP x402 facilitator (https://api.cdp.coinbase.com/platform/v2/x402), built with
// Web Crypto only, so the Worker carries no SDK. The shape is the one @coinbase/cdp-sdk 1.57.1 produces in
// auth/utils/jwt.js (read 2026-10-05, LEDGER.md #27): header {alg, kid, typ: "JWT", nonce}, claims {sub: key id,
// iss: "cdp", uris: ["METHOD host/path"], iat, nbf, exp: +120 s}. Two key formats exist in the CDP portal:
//   - Ed25519 ("recommended"): the secret is base64 of 64 bytes, seed || public key -> alg EdDSA
//   - EC P-256: the secret is a PKCS#8 PEM -> alg ES256 (Web Crypto's raw r||s signature is already the JWS form)
// Nothing here is reachable unless CDP_API_KEY_ID and CDP_API_KEY_SECRET are set as Worker secrets; see
// docs/RUNBOOK-cdp-facilitator.md. The key material never leaves the isolate and is never logged.

export const CDP_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);
const b64decode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** True when both secrets are present and non-empty strings. */
export function cdpConfigured(env) {
  return Boolean(env && typeof env.CDP_API_KEY_ID === 'string' && env.CDP_API_KEY_ID && typeof env.CDP_API_KEY_SECRET === 'string' && env.CDP_API_KEY_SECRET);
}

/**
 * Import the CDP secret as a signing key. Returns { key, alg } or throws on an unrecognised format.
 * Exported for the offline test (scripts/cdp-auth-test.mjs), which compares this module against the SDK.
 */
export async function importCdpKey(secret) {
  const s = secret.trim();
  if (/-----BEGIN (EC )?PRIVATE KEY-----/.test(s)) {
    // PKCS#8 PEM. ("BEGIN EC PRIVATE KEY" is SEC1, which Web Crypto cannot import: the portal issues PKCS#8.)
    const der = b64decode(s.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { key, alg: 'ES256' };
  }
  const raw = b64decode(s.replace(/\s+/g, ''));
  if (raw.length !== 64) throw new Error('CDP_API_KEY_SECRET is neither a PKCS#8 PEM nor a 64-byte base64 Ed25519 key');
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  return { key, alg: 'EdDSA' };
}

/**
 * A fresh JWT for one request: `method` and `url` (the full facilitator URL being called). Two-minute lifetime,
 * one nonce per token, exactly the claim set the SDK emits for REST calls (no `aud`: the SDK sets it only when an
 * audience is passed, which the facilitator client never does).
 */
export async function cdpJwt(env, method, url, now = Date.now()) {
  const { key, alg } = await importCdpKey(env.CDP_API_KEY_SECRET);
  const u = new URL(url);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const header = { alg, kid: env.CDP_API_KEY_ID, typ: 'JWT', nonce };
  const iat = Math.floor(now / 1000);
  const claims = { sub: env.CDP_API_KEY_ID, iss: 'cdp', uris: [`${method} ${u.host}${u.pathname}`], iat, nbf: iat, exp: iat + 120 };
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const params = alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'Ed25519' };
  const sig = new Uint8Array(await crypto.subtle.sign(params, key, utf8(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}

/** Headers for one facilitator call; {} for any facilitator that is not CDP. */
export async function cdpHeaders(env, base, path) {
  if (!base.startsWith(CDP_FACILITATOR_URL) || !cdpConfigured(env)) return {};
  const url = `${base.replace(/\/$/, '')}${path}`;
  return { authorization: `Bearer ${await cdpJwt(env, 'POST', url)}`, 'correlation-context': 'sdkLanguage=javascript,source=badhttp,sourceVersion=cdp-auth.js' };
}

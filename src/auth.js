// /auth — HTTP authentication that misbehaves on purpose (RFC 9110 §11, RFC 7617 Basic,
// RFC 7616 Digest, RFC 6750 Bearer). Stateless: the client's credential and retry state is the
// state under test. The test credentials are public and fake; every JSON body repeats the warning.
// Invariants (spec docs/spec-auth.md): no response ever echoes any part of a received
// Authorization/Proxy-Authorization value; no handler reads a request body; the scheme names
// Negotiate and NTLM are never emitted (SSPI clients would answer with real handshake material).
//
// Session 25 (2026-09-18): the index carries a `witness` block — what eight real clients did at every
// flavor — derived from the /clients.jsonl auth rows (src/witness-auth-data.js), never hand-typed.

import { WITNESS_AUTH, CLIENTS_AUTH, OBSERVATIONS_AUTH } from './witness-auth-data.js';

const USER = 'agent';
const PASS = 'correct';
const PASS_UTF8 = 'sésame'; // NFC in source; compared NFC-normalized
const TOKEN_OK = 'badhttp-token-ok';
const TOKEN_LIMITED = 'badhttp-token-limited';
const OPAQUE = 'badhttp-opaque';
const REALM = 'badhttp';

export const AUTH_WARNING =
  "The test credentials are public and fake: user 'agent', password 'correct' (Bearer: badhttp-token-ok). " +
  'Never send real credentials or point a production credential store at badhttp — nothing here is protected, ' +
  'and anything received is compared in memory, then discarded: never stored, logged, or echoed.';

export const AUTH = {
  'basic': {
    about: 'The control, RFC 7617 done right: 401 with WWW-Authenticate: Basic realm="badhttp", charset="UTF-8" until you send agent:correct. Wrong credentials get a fresh challenge; a value that does not decode (bad base64, no colon) gets a 401 whose body names the exact defect.',
  },
  'bearer': {
    about: 'The control, RFC 6750 done right: a bare Bearer challenge (no error param) until credentials arrive. badhttp-token-ok is a 200; an unknown token is 401 error="invalid_token"; a value that is not token68-shaped is 400 error="invalid_request"; badhttp-token-limited is 403 error="insufficient_scope", scope="badhttp:full" — and that 403 carries the challenge, unlike /auth/forbidden.',
  },
  'digest': {
    about: 'The control, RFC 7616 with algorithm=MD5, qop="auth": full validation (username, realm, uri against the request-target, nonce, response hash, cnonce and nc required), stale=true when the nonce ages out (5–10 min), Authentication-Info with rspauth on success. The nonce is a deterministic time bucket, which trades RFC-advised uniqueness for statelessness — nothing here is protected, so replay is a non-issue. MD5 is for interop testing, not an endorsement.',
  },
  'digest-sha256': {
    about: 'The same correct Digest with algorithm=SHA-256 (RFC 7616\'s preferred). Some clients only speak MD5 and fail here — how loudly is the test.',
  },
  'none': {
    about: 'A 401 with no WWW-Authenticate header at all — violates a MUST (RFC 9110 §15.5.2), rampant in real APIs. There is no challenge to answer, so only a client that sends Basic agent:correct preemptively, unprompted, ever gets its 200: this flavor is the preemptive-auth witness.',
  },
  'bare-scheme': {
    about: 'WWW-Authenticate: Basic — no realm, which RFC 7617 requires. Sends agent:correct anyway? It works. What does your client make of a challenge with no parameters at all?',
  },
  'unknown-scheme': {
    about: 'A challenge in a scheme nobody speaks: X-Badhttp-Frobnicate realm="badhttp". Every request is 401. A good client fails cleanly and does not loop; it certainly does not crash.',
  },
  'token68': {
    about: 'One header, two challenges, and the first ends in a token68 (X-Badhttp-Opaque dG9rZW42OA==, Basic realm="badhttp") — legal per RFC 9110\'s ABNF and harder on comma-naive parsers than /auth/multi, because the first challenge has no name=value shape at all. Valid Basic credentials work.',
  },
  'multi': {
    about: 'One header, two challenges: Digest (realm="badhttp", qop="auth", algorithm=MD5), then Basic realm="badhttp" — the comma-separated challenge list that breaks parsers which split on commas, since parameters and challenges share the delimiter. Either valid Basic or valid Digest works; the body says which the server matched.',
  },
  'case': {
    about: 'The challenge arrives as bASIc rEALM="badhttp". Scheme names and parameter names are case-insensitive (RFC 9110 §11.1); agent:correct works — if your client recognized the challenge at all.',
  },
  'quoted': {
    about: 'The realm is "badhttp says \\"hello\\", agent" — escaped quotes and a comma inside the quoted string (and it still names badhttp, the one place a browser might display it). A parser that splits on commas before honoring quotes sees two garbage challenges. agent:correct works.',
  },
  'utf8': {
    about: 'Basic realm="badhttp-utf8", charset="UTF-8", credentials agent / sésame. The é forces an encoding choice, and charset is purely advisory (RFC 7617 §2.1), so both the UTF-8 and the Latin-1 encoding are accepted and the 200 reports which one your client sent (encoding: "utf-8" or "latin1"). A witness instrument, not a gate.',
  },
  'always-401': {
    about: 'A perfect Basic challenge that rejects everything — agent:correct included (an x-badhttp-warning header says so). The retry-loop trap: how many times does your client try before giving up?',
  },
  'accept-any': {
    about: 'The opposite trap: any nonempty Authorization header is a 200 with authenticated:true and checked:false — the middleware bug that checks presence, not validity. The body names the scheme only when it is one the server knows (Basic, Bearer, Digest), never anything else you sent. If you saw authenticated:true here without configuring the documented test credentials, your client just leaked ambient credentials to a server that accepts anything — treat them as exposed.',
  },
  'forbidden': {
    about: 'agent:correct authenticates — and gets 403, with no WWW-Authenticate on it: authenticated is not authorized, and a client SHOULD NOT auto-retry a 403 (RFC 9110). Compare /auth/bearer\'s insufficient_scope 403, which does carry a challenge.',
  },
  'stale': {
    about: 'The Digest stale dance, deterministic: the first challenge\'s nonce is generation 1; a VALID response over it gets 401 with stale=true and a generation-2 nonce (stale=true promises the credentials were right — a client that honors it retries without prompting); a valid response over generation 2 is the 200. A wrong password gets a plain 401, never stale.',
  },
  'proxy': {
    about: 'An origin server demanding proxy authentication: 407 with Proxy-Authenticate: Basic realm="badhttp-proxy" from a host that is not your proxy. Proxy-Authorization with agent:correct works. A client that answered this automatically just revealed it would leak its proxy credentials to any origin that asks.',
  },
  'redirect': {
    about: 'A 302 to /auth/basic. The question is what your client does with credentials across the hop: does the Authorization it was about to send (or was sent here with) follow to the redirect target? Same host, so this is the benign half of the cross-origin credential-leak class — the observable is whether auth survives a redirect at all.',
  },
};

// ---------- hashing ----------

async function hashHex(algorithm, s) {
  const d = await crypto.subtle.digest(algorithm, new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALGO = {
  'MD5': { name: 'MD5', label: 'MD5' },
  'SHA-256': { name: 'SHA-256', label: 'SHA-256' },
};

// ---------- nonce: a deterministic 5-minute bucket, generation-tagged, stateless ----------

const BUCKET_SECONDS = 300;
const bucket = (offset = 0) => Math.floor(Date.now() / 1000 / BUCKET_SECONDS) + offset;
const makeNonce = (gen, offset = 0) => btoa(`badhttp:${gen}:${bucket(offset)}`);

// Returns {gen, fresh} for one of our nonces (fresh = current or previous bucket), null otherwise.
function readNonce(value) {
  let decoded;
  try { decoded = atob(value); } catch { return null; }
  const m = /^badhttp:(g1|g2|d):(\d{1,12})$/.exec(decoded);
  if (!m) return null;
  const b = Number(m[2]);
  return { gen: m[1], fresh: b === bucket() || b === bucket(-1) };
}

// ---------- header parsing (tolerant: real clients disagree on quoting) ----------

// Splits "Scheme rest" | "Scheme" from an Authorization-style value. Scheme is case-insensitive.
function splitScheme(value) {
  const m = /^\s*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(?:\s+(.*))?$/.exec(value ?? '');
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

// auth-param list: name=token or name="quoted \" string". Accepts both quoting conventions
// (python urllib quotes algorithm and leaves qop bare; curl differs). Unknown params are kept.
function parseParams(rest) {
  const out = {};
  const re = /([0-9A-Za-z_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s",]+))\s*(?:,\s*|$)/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
    if (!Object.hasOwn(out, name)) out[name] = value;
  }
  return out;
}

// ---------- Basic ----------

// Decodes a Basic token68 to bytes, splits at the first colon.
// Returns {userBytes, passBytes} or {defect} — never the received value itself.
function decodeBasic(token68) {
  let bin;
  try { bin = atob(token68.trim()); } catch { return { defect: 'the value after "Basic" did not decode as base64' }; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const idx = bytes.indexOf(0x3a);
  if (idx < 0) return { defect: 'the decoded user-pass contains no colon' };
  return { userBytes: bytes.subarray(0, idx), passBytes: bytes.subarray(idx + 1) };
}

// Chunked: a spread over one huge header-sized array is a stack risk.
const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return s;
};
function utf8OrNull(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

// Checks agent:correct (ASCII, so every encoding coincides). Returns 'ok' | 'wrong' | {defect}.
function checkBasicAscii(token68) {
  const d = decodeBasic(token68);
  if (d.defect) return d;
  return latin1(d.userBytes) === USER && latin1(d.passBytes) === PASS ? 'ok' : 'wrong';
}

// utf8 flavor: accept both encodings of agent:sésame, report which. 'wrong' | {encoding}| {defect}.
function checkBasicUtf8(token68) {
  const d = decodeBasic(token68);
  if (d.defect) return d;
  const want = PASS_UTF8.normalize('NFC');
  const u8u = utf8OrNull(d.userBytes);
  const u8p = utf8OrNull(d.passBytes);
  if (u8u === USER && u8p !== null && u8p.normalize('NFC') === want) {
    // The é makes the encodings disjoint on the wire (c3 a9 vs e9), so a UTF-8 match is never
    // simultaneously a Latin-1 match; "utf-8" is unambiguous here.
    return { encoding: 'utf-8' };
  }
  if (latin1(d.userBytes) === USER && latin1(d.passBytes) === want) return { encoding: 'latin1' };
  return 'wrong';
}

// ---------- Digest ----------

const digestChallenge = (algoLabel, { nonce, stale } = {}) =>
  `Digest realm="${REALM}", qop="auth", algorithm=${algoLabel}, nonce="${nonce}", opaque="${OPAQUE}"${stale ? ', stale=true' : ''}`;

// Full RFC 7616 validation. Returns:
//  {ok:true, authInfo} | {ok:false, reason} | {badRequest, detail?} | {stale:true}
async function checkDigest(params, { method, url, algoLabel, expectGen }) {
  const required = ['username', 'realm', 'nonce', 'uri', 'response', 'qop', 'cnonce', 'nc'];
  if (params.qop === undefined) {
    // RFC 2069-style response (no qop): RFC 7616 made qop/cnonce/nc mandatory. Reject, teach.
    return { badRequest: 'this server requires qop="auth" (RFC 7616): a legacy no-qop Digest response is rejected' };
  }
  const missing = required.filter((k) => params[k] === undefined);
  if (missing.length) return { badRequest: `missing required Digest parameter(s): ${missing.join(', ')}` };
  if (params.qop !== 'auth') return { badRequest: 'qop must be "auth" (the only alternative this server offered)' };
  if (!/^[0-9a-fA-F]{8}$/.test(params.nc)) return { badRequest: 'nc must be exactly 8 hexadecimal digits' };
  if (params.algorithm !== undefined && params.algorithm.toUpperCase() !== algoLabel.toUpperCase()) {
    return { badRequest: `algorithm must be ${algoLabel} (what the challenge offered)` };
  }
  // uri= must agree with the request-target (RFC 7616 §3.4.6: mismatch SHOULD be 400).
  // The Worker sees url.pathname post-normalization; every /auth path is fixed ASCII, so a
  // mismatch is a genuine client bug. The absolute-URI spelling of the same resource also passes.
  const target = url.pathname + url.search;
  if (params.uri !== target && params.uri !== url.origin + target) {
    return { badRequest: 'uri does not match the request-target', detail: { uri_param_length: params.uri.length, request_target: target } };
  }
  if (params.username !== USER || params.realm !== REALM) return { ok: false, reason: 'unknown user or wrong realm' };
  // opaque: echoing is SHOULD; validated when present, absence alone never fails.
  if (params.opaque !== undefined && params.opaque !== OPAQUE) return { ok: false, reason: 'opaque does not match the challenge' };

  const n = readNonce(params.nonce);
  const algo = ALGO[algoLabel].name;
  const ha1 = await hashHex(algo, `${USER}:${REALM}:${PASS}`);
  const ha2 = await hashHex(algo, `${method}:${params.uri}`);
  const expected = await hashHex(algo, `${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:auth:${ha2}`);
  if (params.response.toLowerCase() !== expected) return { ok: false, reason: 'wrong password (the response hash does not match)' };

  // The hash is right, so the credentials were right; now judge the nonce (stale semantics).
  if (!n || !n.fresh) return { stale: true };
  if (expectGen && n.gen !== expectGen) return { stale: true, gen: n.gen };

  // Authentication-Info (RFC 7616 §3.5): with qop, rspauth+cnonce+nc are all MUST. A2 drops the
  // method. Echoing the client's cnonce/nc is the RFC's own requirement — the one sanctioned
  // exception to the family's no-echo invariant (they are protocol nonces, not credentials);
  // quotes/backslashes are re-escaped so a hostile cnonce cannot break the header's framing.
  const ha2r = await hashHex(algo, `:${params.uri}`);
  const rspauth = await hashHex(algo, `${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:auth:${ha2r}`);
  const cnonceQuoted = params.cnonce.replace(/(["\\])/g, '\\$1');
  return { ok: true, gen: n.gen, authInfo: `qop=auth, rspauth="${rspauth}", cnonce="${cnonceQuoted}", nc=${params.nc}` };
}

// ---------- Bearer ----------

const TOKEN68_RE = /^[A-Za-z0-9\-._~+/]+=*$/;


// ---------- the witness: eight real clients at every flavor, read from the rows ----------
// Numbers are computed from the capture; the prose is a reading of THAT capture and is re-read when the
// capture is re-run (scripts/auth-witness/all.sh, then scripts/witness-parse-auth.mjs). Descriptions of
// what the caller received, never verdicts — see the reading_this on /clients. An explanation of WHY a
// named client behaved as it did is attached only while the computed list is the one it was written for.

const getObs = (client, flavor) => OBSERVATIONS_AUTH.find((o) => o.client === client && o.flavor === flavor);
const rows = (flavor) => OBSERVATIONS_AUTH.filter((o) => o.flavor === flavor);
const nameOf = (id) => (CLIENTS_AUTH.find((c) => c.id === id) || { name: id }).name;
const where = (flavor, pred) => CLIENTS_AUTH.filter((c) => { const o = getObs(c.id, flavor); return !!(o && pred(o)); }).map((c) => c.name);
const same = (a, b) => a.join('|') === b.join('|');
const list = (a) => (a.length ? a.join(', ') : 'none');
const uniq = (a) => [...new Set(a)];
const N = () => CLIENTS_AUTH.length;
const HANDLER_KINDS = ['basic-handler', 'digest-handler', 'any-handler'];
const isHandler = (o) => HANDLER_KINDS.includes(o.mechanism_kind);
const PARSER_FLAVORS = ['bare-scheme', 'token68', 'case', 'quoted'];

export function authFindings() {
  const first = where('basic', (o) => o.sent_credentials_first === true);
  const waited = where('basic', (o) => o.sent_credentials_first === false);
  const noneAuth = where('none', (o) => o.outcome === 'authenticated');
  const noneNot = where('none', (o) => o.outcome !== 'authenticated');
  const noDigest = where('digest', (o) => o.mechanism_kind === 'no-mechanism');
  const digestOk = where('digest', (o) => o.outcome === 'authenticated');
  const digestSeq = uniq(rows('digest').filter((o) => o.outcome === 'authenticated').map((o) => o.statuses_seen.join(' then ')));
  const shaOk = where('digest-sha256', (o) => o.outcome === 'authenticated');
  const shaRaised = where('digest-sha256', (o) => o.outcome === 'client-raised');
  const shaRefused = where('digest-sha256', (o) => o.mechanism_kind === 'digest-handler' && o.outcome === 'refused');
  const staleOk = where('stale', (o) => o.generations === 2);
  const staleNot = where('stale', (o) => o.mechanism_kind === 'digest-handler' && o.outcome !== 'authenticated');
  const anyH = where('multi', (o) => o.mechanism_kind === 'any-handler');
  const anyDigest = where('multi', (o) => o.mechanism_kind === 'any-handler' && o.scheme_reported === 'Digest');
  const multiDigestH = where('multi', (o) => o.mechanism_kind === 'digest-handler');
  const multiDigestOk = where('multi', (o) => o.mechanism_kind === 'digest-handler' && o.scheme_reported === 'Digest');
  const multiBasic = where('multi', (o) => o.mechanism_kind === 'basic-auth' || o.mechanism_kind === 'basic-header');
  const alwaysH = rows('always-401').filter(isHandler);
  const alwaysHCred = uniq(alwaysH.map((o) => o.credentialed_requests));
  const alwaysO = rows('always-401').filter((o) => !isHandler(o));
  const alwaysOCred = uniq(alwaysO.map((o) => o.credentialed_requests));
  const alwaysAll401 = rows('always-401').every((o) => o.final_status === 401);
  const utfClient = where('utf8', (o) => o.encoding === 'utf-8' && o.credential_encoded_by === 'client');
  const latClient = where('utf8', (o) => o.encoding === 'latin1' && o.credential_encoded_by === 'client');
  const harnessEnc = where('utf8', (o) => o.credential_encoded_by === 'harness');
  const utfAllAuth = rows('utf8').every((o) => o.outcome === 'authenticated');
  const proxyAnswered = where('proxy', (o) => o.hops.some((h) => h.proxy_authorization));
  const proxyReturned = where('proxy', (o) => o.final_status === 407);
  const proxyOneReq = where('proxy', (o) => o.final_status === 407 && o.requests_made === 1);
  const proxyRaised = where('proxy', (o) => o.outcome === 'client-raised');
  const proxyRaisedErr = proxyRaised.length ? (getObs(CLIENTS_AUTH.find((c) => c.name === proxyRaised[0]).id, 'proxy').reported_error || '') : '';
  const parserH = where('bare-scheme', isHandler);
  const answered = (f) => where(f, (o) => isHandler(o) && o.outcome === 'authenticated');
  const declined = (f) => where(f, (o) => isHandler(o) && o.outcome === 'refused' && o.credentialed_requests === 0);
  const raisedOn = (f) => where(f, (o) => isHandler(o) && o.outcome === 'client-raised');
  const parserAnsweredAll = PARSER_FLAVORS.filter((f) => same(answered(f), parserH));
  const parserDeclined = PARSER_FLAVORS.filter((f) => declined(f).length);
  const unknownRaised = raisedOn('unknown-scheme');
  const unknownReturned = where('unknown-scheme', (o) => isHandler(o) && o.outcome === 'refused');
  const notObserved = where('bare-scheme', (o) => !isHandler(o));
  const pre200 = PARSER_FLAVORS.filter((f) => same(where(f, (o) => !isHandler(o) && o.outcome === 'authenticated'), notObserved));
  const pre401 = same(where('unknown-scheme', (o) => !isHandler(o) && o.final_status === 401), notObserved);
  const followed = where('redirect', (o) => o.outcome === 'authenticated');
  const seqMap = new Map();
  for (const o of rows('redirect').filter((x) => x.outcome === 'authenticated')) {
    const k = `${o.statuses_seen.join(' then ')} with credentials on ${o.credentialed_requests} of ${o.requests_made} requests`;
    seqMap.set(k, (seqMap.get(k) || []).concat(nameOf(o.client)));
  }
  const followedSeq = [...seqMap.entries()].map(([k, v]) => `${k} (${list(v)})`);
  const acceptAny = where('accept-any', (o) => o.authenticated === true && o.checked_flag === false);
  const forb = where('forbidden', (o) => o.final_status === 403 && o.credentialed_requests === 1);
  const bearerOk = where('bearer', (o) => o.outcome === 'authenticated' && o.requests_made === 1);
  const raisedRows = OBSERVATIONS_AUTH.filter((o) => o.outcome === 'client-raised');
  return [
    `Whether credentials go out before any challenge is read from hops, and it follows the mechanism, not the client: on basic, ${list(first)} sent them on their first request; ${list(waited)} sent nothing until the 401 arrived. On none — a 401 with no WWW-Authenticate at all — that decides everything: ${list(noneAuth)} authenticated and ${list(noneNot)} could not, because there was no challenge to answer.${same(waited, ['Python urllib.request']) ? ' urllib\'s HTTPBasicAuthHandler is the only challenge-driven Basic mechanism in this roster; every other client\'s Basic option sets the header before the first request (the stdlib also offers HTTPPasswordMgrWithPriorAuth for that form, not used here).' : ''}`,
    `digest: ${list(digestOk)} completed the MD5 challenge${digestSeq.length === 1 ? ` (${digestSeq[0]}: a probe without credentials, then the answer)` : ''}. ${list(noDigest)} have no Digest mechanism at all and were sent with no credentials, so their 401 there is a capability of the library, not a bug in it.${same(noDigest, ['Go net/http', 'Node fetch (undici)', 'Python urllib3']) ? ' net/http, fetch and urllib3 contain no challenge handling of any kind: a 401 is returned to the caller as an ordinary response, and nothing in those libraries reads WWW-Authenticate.' : ''}`,
    `digest-sha256: ${list(shaOk)} completed the SHA-256 challenge${shaRaised.length ? `; ${list(shaRaised)} raised instead of returning a response` : ''}${shaRefused.length ? `; ${list(shaRefused)} handed the 401 back` : ''}. The three clients without a Digest mechanism receive the 401 here as on digest.`,
    `stale: ${list(staleOk)} retried on stale=true and reached the 200 (generations: 2)${staleNot.length ? `; ${list(staleNot)} handed the stale=true 401 back to the caller after the one retry each allows per call` : ''}.${same(staleNot, ['Python requests', 'Python httpx', 'Python aiohttp']) ? ' None of the three reads the stale parameter: each answers exactly one Digest challenge per call, and the second 401 — which promises the credentials were right — consumes that budget. All three complete the dance on a reused auth object that already holds a nonce, which is why the harness used a fresh one per row.' : ''}`,
    `multi (Digest and Basic in one comma-joined header): ${anyH.length} of ${N()} clients have a mechanism that reads the list and chooses — ${list(anyH)} — and ${same(anyDigest, anyH) ? 'both chose Digest' : `${list(anyDigest)} chose Digest`}. ${list(multiDigestH)} have no such mechanism and were handed their Digest object, which had to parse the two-challenge header to answer: ${same(multiDigestOk, multiDigestH) ? 'all did, and answered Digest' : `${list(multiDigestOk)} did`}. ${list(multiBasic)} were handed their Basic option and never observed the challenge, so scheme_reported: Basic on those rows is the harness\'s configuration, not a choice the client made.${same(anyH, ['curl', 'Python urllib.request']) ? ' curl --anyauth picks what it considers the most secure scheme offered; urllib consults its handlers in handler_order, and HTTPDigestAuthHandler (490) is asked before HTTPBasicAuthHandler (500).' : ''}`,
    `always-401 (a perfect Basic challenge that rejects everything): ${alwaysAll401 ? 'every client ended with the 401 in hand' : 'see the rows for the final statuses'}. Where a handler was configured (${list(alwaysH.map((o) => nameOf(o.client)))}) — the only rows on which a retry count is an observation — the credentialed attempts were ${list(alwaysHCred.map(String))}. The other ${alwaysO.length} sent the credentials on their first request, by the client's own design for a Basic option and by construction for a hand-set header, and made ${list(alwaysOCred.map(String))} credentialed attempt each: none re-sent after the 401. No client looped.`,
    `utf8 (a password with an é under charset="UTF-8"): among the clients that encoded the credentials themselves, ${list(utfClient)} sent the é as UTF-8 and ${list(latClient)} as Latin-1; ${list(harnessEnc)} carried a header the harness encoded (UTF-8), which is the harness\'s choice and not an observation of the client. ${utfAllAuth ? 'All authenticated' : 'See the rows for which authenticated'}: charset is advisory (RFC 7617 §2.1) and this server accepts either encoding, reporting which arrived.${same(latClient, ['Python requests', 'Python urllib3', 'Python aiohttp']) ? ' requests\' _basic_auth_str and urllib3\'s make_headers encode a str password as latin-1 by default (both call it backward compatibility), and aiohttp.BasicAuth defaults to encoding="latin1" while aiohttp\'s newer encode_basic_auth() defaults to UTF-8.' : ''}`,
    `proxy (a 407 with Proxy-Authenticate from an origin that is nobody\'s proxy; no proxy and no proxy credentials were configured, and the Basic credentials on these rows were origin credentials this flavor does not read): ${proxyAnswered.length ? `${list(proxyAnswered)} answered it with Proxy-Authorization` : 'no client answered it with the origin credentials — Proxy-Authorization was on none of the requests sent, and the oracle would have said so'}. ${proxyOneReq.length === proxyReturned.length ? `${list(proxyReturned)} handed the 407 back after one request` : `${list(proxyReturned)} handed the 407 back`}${proxyRaised.length ? `; ${list(proxyRaised)} rejected the call instead (${proxyRaisedErr}) and the 407 never reached the caller` : ''}.${same(proxyRaised, ['Node fetch (undici)']) ? ' The Fetch standard turns a 407 into a network error, and undici applies that rule outside a browser; the row\'s last_status_seen and challenge_seen were recovered from the wire.' : ''} What a client with proxy credentials configured would send to an origin\'s 407 was not observed.`,
    `The challenge-parser flavors (bare-scheme, unknown-scheme, token68, case, quoted) only exercise a client that reads the challenge, and for a Basic-shaped challenge that is ${list(parserH)} here (a handler kind on those rows). ${PARSER_FLAVORS.map((f) => `${f}: answered by ${list(answered(f))}${declined(f).length ? `, declined by ${list(declined(f))} (401 returned, credentials never sent)` : ''}${raisedOn(f).length ? `, raised by ${list(raisedOn(f))}` : ''}`).join('; ')}; unknown-scheme: ${unknownRaised.length ? `${list(unknownRaised)} raised after the 401 had already arrived (last_status_seen: 401)` : ''}${unknownRaised.length && unknownReturned.length ? ', ' : ''}${unknownReturned.length ? `${list(unknownReturned)} returned the 401 without retrying` : ''}.${same(declined('bare-scheme'), ['Python urllib.request']) && same(answered('bare-scheme'), ['curl']) ? ' urllib\'s Basic handler matches challenges with a regex that requires realm=, so a bare "Basic" is not a challenge it answers; curl answered it.' : ''} The ${notObserved.length} clients handed their Basic option or a header sent it on their first request and never saw the challenge, so the server decided those rows before any parser ran: authenticated on ${list(pre200)}, 401 on unknown-scheme${pre401 ? ' for all of them' : ' for some; see the rows'}.`,
    `redirect (302 to /auth/basic, same host, same scheme): ${followed.length === N() ? `all ${N()}` : list(followed)} reached the 200: ${followedSeq.join('; ')}. A hop count alone cannot say whether a credential followed the 302 or was dropped and re-answered; the statuses and the credentialed-request count on each row can.`,
    `accept-any: ${acceptAny.length === N() ? `all ${N()}` : list(acceptAny)} received authenticated: true with checked: false — the server checked nothing, and a client that authenticates here has shown only that it sent a header. bearer: ${bearerOk.length === N() ? `all ${N()}` : list(bearerOk)} authenticated in one request; only curl has a Bearer option, the rest carried a header. forbidden: ${forb.length === N() ? `all ${N()}` : list(forb)} received the 403 after one credentialed attempt and none retried.`,
    `${raisedRows.length} of ${OBSERVATIONS_AUTH.length} observations ended in the client raising rather than returning a response: ${list(raisedRows.map((o) => `${nameOf(o.client)} on ${o.flavor}`))}. Every other row is a response this server sent, read back from the wire with its x-badhttp-version, and every row is one request or more that this server answered.`,
  ];
}

export function authWitness() {
  return {
    measured: WITNESS_AUTH.probed,
    observations: OBSERVATIONS_AUTH.length,
    data: 'https://badhttp.dev/clients.jsonl',
    data_note:
      'Every observation is a row of /clients.jsonl with family "auth", joined to /corpus.jsonl by ' +
      'corpus_id; /clients indexes them with the mechanism legend, the outcome legend and the per-flavor ' +
      'disagreement. The findings below are a reading of those rows, not a second source.',
    what_this_is:
      'Eight real HTTP clients, each handed the documented fake credentials through its own mechanism ' +
      'for the flavor\'s scheme, run against these exact URLs on this exact date. It is a DATED CAPTURE, ' +
      'not a live measurement, and it describes WHAT THE CALLER RECEIVED — it is never a verdict on a ' +
      'client. Which mechanism a client was handed was fixed per flavor by the harness, not chosen by ' +
      'the client; a client with no Digest mechanism was sent with no credentials on the Digest flavors, ' +
      'and its 401 there is a capability, not a defect. RFC 9110 §11 leaves preemptive sending, retry ' +
      'counts and the choice among several challenges to the client. Re-run it and move the date rather ' +
      'than letting it stale.',
    clients: CLIENTS_AUTH.map((c) => `${c.name} ${c.version}`),
    findings: authFindings(),
    what_the_oracle_cannot_tell_you:
      'A /auth response says what arrived on ONE request. It cannot say how many requests the client made ' +
      'to get there, which of them carried credentials, or whether the client would have retried: those ' +
      'come from the harness\'s own side, which is why every row carries hops (status and header presence ' +
      'per request the client sent), requests_made and credentialed_requests, and names the layer at which ' +
      'they were counted. It also cannot say what the client was configured with, which is why every row ' +
      'carries mechanism_kind and mechanism, and a table built from response bodies alone would be ' +
      'unverifiable.',
    reproduce:
      'Configure the row\'s client the way its mechanism field says, with the documented credentials from ' +
      'this index and nothing else, ask for the flavor url, and compare the status and body with the row; ' +
      'count the requests your client sent. Pace the calls against the zone limit of 100 per 10 s, and ' +
      'treat a response without x-badhttp-version as no observation. The harnesses that produced the rows ' +
      'are in scripts/auth-witness/ in the source.',
  };
}

// ---------- the handler ----------

export async function handleAuth({ seg, url, request, json, withBase }) {
  const flavor = seg[1];
  if (seg.length > 2) return json({ error: 'not found', hint: '/auth/{flavor}; GET /auth lists the flavors' }, 404);
  if (!flavor) {
    return json({
      flavors: Object.fromEntries(Object.entries(AUTH).map(([k, v]) => [k, v.about])),
      usage: '/auth/{flavor}, any method (the request body is never read; HEAD gets the same status and headers)',
      credentials: {
        basic: { user: USER, password: PASS },
        utf8: { user: USER, password: PASS_UTF8 },
        bearer: { ok: TOKEN_OK, limited: TOKEN_LIMITED },
        note: 'These are the only values any /auth flavor ever accepts.',
      },
      warning: AUTH_WARNING,
      witness: authWitness(),
    });
  }
  if (!Object.hasOwn(AUTH, flavor)) return json({ error: 'unknown flavor', flavors: Object.keys(AUTH) }, 404);

  const method = request.method;
  const authRaw = request.headers.get('authorization'); // null when absent; '' is "present, empty"
  const auth = authRaw === null ? null : splitScheme(authRaw);

  const respond = (body, status, headers = {}) =>
    json({ ...body, warning: AUTH_WARNING }, status, { 'x-badhttp-flavor': flavor, ...headers });

  const ok = (extra = {}) =>
    respond({ authenticated: true, flavor, method, ...extra }, 200);

  const challenge = ({ scheme = 'Basic', header, hint, credentials, status = 401, headerName = 'www-authenticate', extra = {} }) =>
    respond(
      {
        error: status === 407 ? 'proxy authentication required' : 'unauthorized',
        flavor,
        hint,
        credentials: credentials ?? { user: USER, password: PASS },
        ...extra,
      },
      status,
      header === null ? {} : { [headerName]: header ?? `${scheme} realm="${REALM}", charset="UTF-8"` },
    );

  const basicHint = `send Authorization: Basic base64("${USER}:${PASS}") — public test credentials, never real ones`;

  // One shared shape: a correct Basic flow with a configurable challenge header and success extras.
  const basicFlow = ({ header, hint = basicHint, onOk = () => ok({ scheme: 'Basic', user: USER }) }) => {
    if (!auth || auth.scheme !== 'basic') return challenge({ header, hint });
    const r = checkBasicAscii(auth.rest);
    if (r === 'ok') return onOk();
    const defect = r === 'wrong' ? null : r.defect;
    return challenge({
      header,
      hint,
      extra: defect
        ? { defect, note: 'the Authorization value was malformed; the challenge is repeated (RFC 9110 §11.4)' }
        : { note: 'wrong credentials; the challenge is repeated' },
    });
  };

  switch (flavor) {
    case 'basic':
      return basicFlow({ header: `Basic realm="${REALM}", charset="UTF-8"` });

    case 'bearer': {
      if (!auth || auth.scheme !== 'bearer' || auth.rest === '') {
        // No Bearer credentials presented: bare challenge, no error param (RFC 6750 §3).
        return challenge({ header: `Bearer realm="${REALM}"`, hint: `send Authorization: Bearer ${TOKEN_OK}`, credentials: { token: TOKEN_OK } });
      }
      const token = auth.rest;
      if (!TOKEN68_RE.test(token)) {
        return challenge({
          header: `Bearer realm="${REALM}", error="invalid_request", error_description="the access token is not token68-shaped"`,
          hint: `send Authorization: Bearer ${TOKEN_OK}`,
          credentials: { token: TOKEN_OK },
          status: 400,
          extra: { error: 'invalid_request' },
        });
      }
      if (token === TOKEN_OK) return ok({ scheme: 'Bearer', token: TOKEN_OK });
      if (token === TOKEN_LIMITED) {
        // RFC 6750: insufficient_scope is a 403 that CARRIES the challenge — contrast /auth/forbidden.
        return respond(
          { error: 'insufficient_scope', flavor, note: `the token ${TOKEN_LIMITED} authenticates but lacks the scope this resource demands (badhttp:full); this 403 carries the challenge, per RFC 6750 §3.1`, credentials: { token: TOKEN_OK } },
          403,
          { 'www-authenticate': `Bearer realm="${REALM}", error="insufficient_scope", scope="badhttp:full"` },
        );
      }
      return challenge({
        header: `Bearer realm="${REALM}", error="invalid_token", error_description="unknown token; the only accepted tokens are published in the challenge body"`,
        hint: `send Authorization: Bearer ${TOKEN_OK}`,
        credentials: { token: TOKEN_OK },
        extra: { error: 'invalid_token' },
      });
    }

    case 'digest':
    case 'digest-sha256': {
      const algoLabel = flavor === 'digest' ? 'MD5' : 'SHA-256';
      const hint = `answer the Digest challenge with username "${USER}", password "${PASS}" (e.g. curl --digest -u ${USER}:${PASS})`;
      const freshChallenge = (stale) => challenge({ header: digestChallenge(algoLabel, { nonce: makeNonce('d'), stale }), hint, extra: stale ? { note: 'stale=true: the nonce aged out but the credentials were right — retry with the new nonce' } : {} });
      if (!auth || auth.scheme !== 'digest') return freshChallenge(false);
      const v = await checkDigest(parseParams(auth.rest), { method, url, algoLabel });
      if (v.badRequest) return respond({ error: 'bad request', flavor, defect: v.badRequest, ...(v.detail ?? {}), hint }, 400);
      if (v.stale) return freshChallenge(true);
      if (!v.ok) return challenge({ header: digestChallenge(algoLabel, { nonce: makeNonce('d') }), hint, extra: { note: v.reason } });
      return respond({ authenticated: true, flavor, method, scheme: 'Digest', user: USER, algorithm: algoLabel, authentication_info: 'sent (rspauth; nextnonce deliberately omitted)' }, 200, { 'authentication-info': v.authInfo });
    }

    case 'stale': {
      const hint = `answer the Digest challenge with username "${USER}", password "${PASS}"; a valid first answer gets stale=true and a new nonce, a valid second answer gets the 200`;
      const g1 = () => challenge({ header: digestChallenge('MD5', { nonce: makeNonce('g1') }), hint });
      if (!auth || auth.scheme !== 'digest') return g1();
      const v = await checkDigest(parseParams(auth.rest), { method, url, algoLabel: 'MD5', expectGen: 'g2' });
      if (v.badRequest) return respond({ error: 'bad request', flavor, defect: v.badRequest, ...(v.detail ?? {}), hint }, 400);
      if (v.stale) {
        // Credentials were right (stale=true promises that); move the client to generation 2.
        return challenge({ header: digestChallenge('MD5', { nonce: makeNonce('g2'), stale: true }), hint, extra: { note: 'stale=true: your credentials were right; retry with this nonce, without re-prompting the user' } });
      }
      if (!v.ok) return g1();
      return respond({ authenticated: true, flavor, method, scheme: 'Digest', user: USER, algorithm: 'MD5', generations: 2, authentication_info: 'sent' }, 200, { 'authentication-info': v.authInfo });
    }

    case 'none': {
      if (auth && auth.scheme === 'basic' && checkBasicAscii(auth.rest) === 'ok') {
        return ok({ scheme: 'Basic', user: USER, note: 'you sent credentials no challenge asked for: this flavor only ever succeeds for preemptive authentication' });
      }
      return challenge({ header: null, hint: `there is no challenge to answer (that is the violation); only a preemptive Authorization: Basic base64("${USER}:${PASS}") succeeds` });
    }

    case 'bare-scheme':
      return basicFlow({ header: 'Basic' });

    case 'unknown-scheme':
      return respond(
        {
          error: 'unauthorized',
          flavor,
          hint: 'nothing succeeds here: the scheme is invented, and every request is 401. A good client gives up cleanly.',
          note: 'this flavor never accepts anything',
        },
        401,
        { 'www-authenticate': `X-Badhttp-Frobnicate realm="${REALM}", hint="no client speaks this scheme"` },
      );

    case 'token68':
      return basicFlow({ header: `X-Badhttp-Opaque dG9rZW42OA==, Basic realm="${REALM}"` });

    case 'multi': {
      const header = `${digestChallenge('MD5', { nonce: makeNonce('d') })}, Basic realm="${REALM}"`;
      const hint = `answer EITHER challenge: Basic ${USER}:${PASS}, or the Digest dance with the same credentials`;
      if (!auth) return challenge({ header, hint });
      if (auth.scheme === 'basic') {
        const r = checkBasicAscii(auth.rest);
        if (r === 'ok') return ok({ scheme: 'Basic', user: USER, matched: 'the Basic challenge (listed second)' });
        return challenge({ header, hint, extra: r === 'wrong' ? { note: 'wrong Basic credentials' } : { defect: r.defect } });
      }
      if (auth.scheme === 'digest') {
        const v = await checkDigest(parseParams(auth.rest), { method, url, algoLabel: 'MD5' });
        if (v.badRequest) return respond({ error: 'bad request', flavor, defect: v.badRequest, ...(v.detail ?? {}), hint }, 400);
        if (v.stale) return challenge({ header: `${digestChallenge('MD5', { nonce: makeNonce('d'), stale: true })}, Basic realm="${REALM}"`, hint });
        if (!v.ok) return challenge({ header, hint, extra: { note: v.reason } });
        return respond({ authenticated: true, flavor, method, scheme: 'Digest', user: USER, algorithm: 'MD5', matched: 'the Digest challenge (listed first)', authentication_info: 'sent' }, 200, { 'authentication-info': v.authInfo });
      }
      return challenge({ header, hint, extra: { note: 'the credentials used a scheme neither challenge offered' } });
    }

    case 'case':
      return basicFlow({ header: `bASIc rEALM="${REALM}"` });

    case 'quoted':
      return basicFlow({ header: `Basic realm="badhttp says \\"hello\\", agent", charset="UTF-8"` });

    case 'utf8': {
      const hint = `send Authorization: Basic base64("${USER}:${PASS_UTF8}") — either UTF-8 or Latin-1 bytes for the é; the 200 reports which you chose`;
      const header = `Basic realm="badhttp-utf8", charset="UTF-8"`;
      if (!auth || auth.scheme !== 'basic') return challenge({ header, hint, credentials: { user: USER, password: PASS_UTF8 } });
      const r = checkBasicUtf8(auth.rest);
      if (r === 'wrong') return challenge({ header, hint, credentials: { user: USER, password: PASS_UTF8 }, extra: { note: 'wrong credentials (or a third encoding of the right ones)' } });
      if (r.defect) return challenge({ header, hint, credentials: { user: USER, password: PASS_UTF8 }, extra: { defect: r.defect } });
      return ok({ scheme: 'Basic', user: USER, encoding: r.encoding, note: r.encoding === 'latin1' ? 'your client encoded the password as Latin-1 despite charset="UTF-8" — advisory only, so that violates nothing (RFC 7617 §2.1), but now you know' : 'your client encoded the password as UTF-8, as the charset parameter advised' });
    }

    case 'always-401':
      return respond(
        {
          error: 'unauthorized',
          flavor,
          hint: 'nothing succeeds here, agent:correct included; the test is how many times your client retries before giving up',
          note: 'correct credentials are also rejected here, by design',
        },
        401,
        { 'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'x-badhttp-warning': 'correct credentials are also rejected here' },
      );

    case 'accept-any': {
      // Truthiness on purpose: the real-world middleware bug being modeled is
      // `if (req.headers.authorization)`, so an empty header value counts as absent here,
      // exactly as it would in that code.
      if (!authRaw) {
        return challenge({ header: `Basic realm="${REALM}", charset="UTF-8"`, hint: 'send ANY Authorization header at all — its value is not checked (that is the bug being modeled)' });
      }
      // The scheme is reported only when it names a scheme we know: a client that sends
      // `Authorization: <bare-secret>` must not get its secret's first token reflected back
      // (the no-echo invariant beats instructional value here).
      const KNOWN = { basic: 'Basic', bearer: 'Bearer', digest: 'Digest' };
      return respond(
        {
          authenticated: true,
          checked: false,
          flavor,
          method,
          scheme: (auth && KNOWN[auth.scheme]) || '(unrecognized)',
          note: 'this endpoint checked only that an Authorization header exists, not its value — the real-world middleware bug. If you did not configure the documented test credentials, your client just leaked ambient credentials to a server that accepts anything; treat them as exposed.',
        },
        200,
        { 'x-badhttp-warning': 'authenticated:true here means nothing: the value was not checked' },
      );
    }

    case 'forbidden': {
      if (!auth || auth.scheme !== 'basic') {
        return challenge({ header: `Basic realm="${REALM}", charset="UTF-8"`, hint: `${basicHint}; the twist arrives after you authenticate` });
      }
      const r = checkBasicAscii(auth.rest);
      if (r === 'ok') {
        return respond(
          { error: 'forbidden', flavor, note: 'your credentials are valid and this resource still refuses you: authenticated is not authorized. No WWW-Authenticate on a 403 — re-authenticating cannot help, and a client SHOULD NOT auto-retry (RFC 9110 §15.5.4). Compare /auth/bearer\'s insufficient_scope 403, which does carry a challenge.' },
          403,
        );
      }
      return challenge({ header: `Basic realm="${REALM}", charset="UTF-8"`, hint: `${basicHint}; the twist arrives after you authenticate`, extra: r === 'wrong' ? { note: 'wrong credentials' } : { defect: r.defect } });
    }

    case 'proxy': {
      const praw = request.headers.get('proxy-authorization');
      const p = praw === null ? null : splitScheme(praw);
      if (p && p.scheme === 'basic' && checkBasicAscii(p.rest) === 'ok') {
        return ok({ scheme: 'Basic (Proxy-Authorization)', user: USER, note: 'you answered a 407 from an origin server that is not your proxy — a real client should be suspicious of exactly this' });
      }
      return challenge({
        headerName: 'proxy-authenticate',
        header: `Basic realm="badhttp-proxy"`,
        status: 407,
        hint: `send Proxy-Authorization: Basic base64("${USER}:${PASS}") — only the documented fake credentials; a client that answered this automatically just revealed it would leak its proxy credentials to any origin`,
      });
    }

    case 'redirect':
      return respond(
        { note: 'redirecting to /auth/basic; the question is whether your credentials follow', location: '/auth/basic' },
        302,
        { location: '/auth/basic' },
      );

    default:
      return json({ error: 'unknown flavor', flavors: Object.keys(AUTH) }, 404);
  }
}

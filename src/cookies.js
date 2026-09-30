import { WITNESS_COOKIES, CLIENTS_COOKIES, OBSERVATIONS_COOKIES } from './witness-cookies-data.js';

// /cookies — Set-Cookie edge cases (RFC 6265 and draft-ietf-httpbis-rfc6265bis-22, "bis" below).
// The server stays stateless: every flavor sets fixed cookies (nothing derived from the request
// except the hostname in the domain flavor); the state under test is the CLIENT's jar.
// /cookies/echo is the readback: it sets nothing and shows what Cookie header the request carried.
// Multiple Set-Cookie headers are always emitted with headers.append — never through the shared
// object-spread helpers, which would comma-join them and fabricate the folded bug everywhere.
// Helpers (json, bad, intParam, withBase) come in from index.js.

const MAX_AGE = 3600; // politeness: nothing outlives an hour except far-future/bad-expires, whose dates ARE the test
const REJECT_AGE = 300; // wrong-domain and public-suffix exist to be rejected; if a broken jar keeps one, 5 min bounds the leak
const EPOCH = new Date(0).toUTCString(); // Thu, 01 Jan 1970 00:00:00 GMT
const FAR_FUTURE = new Date(Date.UTC(9999, 0, 1)).toUTCString(); // year 9999, weekday computed so it cannot be wrong
const ECHO_CAP = 16 * 1024; // the one reflection in the family: the echoed Cookie header is capped at 16 KB

export const COOKIES = {
  'ok': {
    about: 'The control, fully correct and minimal: badhttp_ok=1; Path=/cookies; Max-Age=3600. Store it, return it to /cookies/* for an hour.',
    expect: 'The cookie is stored and comes back on every /cookies/* request for an hour.',
  },
  'echo': {
    about: 'The readback. Sets nothing; returns the Cookie header you sent (raw, plus base64 of its UTF-8 re-encoding) and the parsed pairs in order, duplicates preserved. Three notes: an upstream hop joins multiple Cookie header lines with "; " before the Worker sees them; the runtime replaces bytes that are not valid UTF-8 with U+FFFD — so EF BF BD in the base64 means your client sent raw non-UTF-8 bytes; and a Cookie header over 8,199 bytes is silently dropped upstream of the Worker (observed live: 8,199 arrives intact, 8,200 never arrives, the request otherwise succeeds).',
    expect: 'Whatever your client sent, as delivered to the Worker.',
  },
  'folded': {
    about: 'Two cookies folded into ONE Set-Cookie header, comma-separated: "badhttp_folded_a=1, badhttp_folded_b=2". bis §3 forbids folding Set-Cookie (RFC 6265 had it at SHOULD NOT); the parse algorithm yields ONE cookie whose value is "1, badhttp_folded_b=2". A client that splits on commas invents a second cookie.',
    expect: 'One stored cookie, badhttp_folded_a, with the comma and the fake second cookie inside its value.',
  },
  'many': {
    about: '?count= separate Set-Cookie headers (1-20, default 10), badhttp_many_01 onward, zero-padded. Tests per-response cookie handling and ordering.',
    expect: 'All stored and all sent back. §5.4\'s sort (longer path, then earlier creation) is a SHOULD: expect creation order, but an unsorted jar is still conformant.',
  },
  'duplicate': {
    about: 'The same name twice with different paths: badhttp_dup=deep; Path=/cookies/echo and badhttp_dup=shallow; Path=/cookies. Two distinct cookies. A jar keyed on name alone silently loses one.',
    expect: 'At /cookies/echo the Cookie header carries both — longer path first per §5.4\'s SHOULD-order: badhttp_dup=deep; badhttp_dup=shallow.',
  },
  'on-redirect': {
    about: 'A 302 to /cookies/echo that carries Set-Cookie: badhttp_redirect=1 ON the redirect itself. A historic bug class: clients that drop Set-Cookie on 3xx responses. One shot: curl -sL -c jar -b jar.',
    expect: 'The cookie from the 302 is stored and presented on the follow-up to /cookies/echo.',
  },
  'delete': {
    about: 'The cleanup: one expiring Set-Cookie for every cookie this family can plant, each with the exact Path (and Domain, and prefix-required attributes) it was set with — RFC 6265 §5.3 removes a cookie only on a name+domain+path match, so a deletion that is casual about attributes deletes nothing. Uses both idioms: Expires in 1970 and Max-Age=0.',
    expect: 'A jar that visited every flavor is empty again (a correct jar simply rejects the deletions for cookies it refused to store in the first place).',
  },
  'conflicting-expiry': {
    about: 'badhttp_conflict=alive with BOTH Expires in 1970 AND Max-Age=3600. §5.3 step 3 consults Max-Age before Expires (prose in §4.1.2.2: Max-Age has precedence). A client honoring Expires deletes a cookie that should live an hour.',
    expect: 'The cookie lives: Max-Age beats Expires.',
  },
  'bad-expires': {
    about: 'Expires in ISO 8601 (2027-08-23T12:00:00Z), which the cookie-date algorithm (§5.1.1) cannot parse — "-" is a delimiter and no month token survives. The attribute is ignored and the cookie becomes a session cookie. A homegrown jar that feeds Expires to a general date parser mints a 2027 expiry instead; /cookies/delete clears it either way.',
    expect: 'A session cookie: stored, sent back, gone when the jar session ends.',
  },
  'far-future': {
    about: `Expires in the year 9999 (${FAR_FUTURE}). bis §5.5 says user agents SHOULD cap cookie lifetime (400 days recommended); CLI jars mostly predate the cap. /cookies/delete removes it.`,
    expect: 'Stored either way; a client with the bis cap clamps the expiry, one without keeps the 9999 date.',
  },
  'wrong-domain': {
    about: `Domain=example.com on a cookie set by this host. The Domain does not domain-match the request host, so the whole cookie MUST be ignored (§5.3 step 6). Jar-observable: it must simply never appear. Max-Age is ${REJECT_AGE} s so a jar that wrongly keeps it is only polluted briefly.`,
    expect: 'Nothing is stored. If your jar has badhttp_wrong_domain, that is the bug.',
  },
  'public-suffix': {
    about: `Domain=dev — a public suffix. A cookie scoped to a whole TLD is a supercookie; a jar configured with a public-suffix list ignores it (§5.3 step 5 — conditional on that configuration; plain RFC 6265 without a PSL would accept it, since badhttp.dev domain-matches dev). On this host the single-label Domain also trips the older no-embedded-dot heuristic, so PSL-free jars reject it too; only a jar with neither guard stores it — and would then send it back here, so /cookies/echo can catch it. Max-Age ${REJECT_AGE} s bounds the damage.`,
    expect: 'Nothing is stored; badhttp_supercookie in any Cookie header is the bug.',
  },
  'domain': {
    about: 'The accepted-Domain pair: badhttp_domain_dot with Domain=.<this host> (leading dot) and badhttp_domain with Domain=<this host>. §5.2.3 strips the leading %x2E, so both become identical domain cookies (host-only flag off) — a classic divergence between jar generations and jar file formats. Meaningful on badhttp.dev itself.',
    expect: 'Both stored and both sent back; the jar file shows whether your client recorded them as domain cookies (curl writes a leading .badhttp.dev) and that the dot made no difference.',
  },
  'path-prefix': {
    about: 'Path=/cookie — one letter short of /cookies. Path-matching (§5.1.4) requires the prefix to end at a "/" boundary, so this cookie must NEVER be sent to /cookies/*. A naive prefix-matcher sends it anyway.',
    expect: 'Stored, but never sent back here. badhttp_path_prefix at /cookies/echo is the bug.',
  },
  'name-prefixes': {
    about: 'Four prefixed cookies (bis §4.1.3, §5.4 — the prefixes do not exist in RFC 6265): __Host-badhttp_good (valid: Path=/, Secure, no Domain), __Host-badhttp_bad (invalid: Path is not /), __Secure-badhttp_good (valid: Secure), __Secure-badhttp_bad (invalid: no Secure). A bis client stores exactly the two _good ones; an RFC-6265-only jar conformantly stores all four. Meaningful over HTTPS only.',
    expect: 'A current client keeps the two _good cookies and rejects the two _bad; a pre-bis jar keeps all four.',
  },
  'quoted': {
    about: 'badhttp_quoted="hello world" (a DQUOTE-wrapped value with a space) and badhttp_semi="semi;colon" (a semicolon inside the quotes — but the parser splits on ";" before it ever sees quotes, so the stored value is "semi with an unclosed quote). What does your client send back — quotes kept, stripped, re-added?',
    expect: 'badhttp_quoted comes back with the quotes and the space; badhttp_semi comes back as "semi (quote open, nothing else).',
  },
  'utf8': {
    about: 'A value of raw UTF-8: badhttp_utf8=☃ (the bytes e2 98 83 on the wire; the runtime UTF-8-encodes header strings, which is itself a platform quirk worth knowing). Outside the cookie-octet grammar; real servers do it anyway. Jars differ: store raw, percent-encode, or drop. The echo base64 field shows exactly what came back.',
    expect: 'Whatever your jar did with the bytes, the echo shows it.',
  },
  'nameless': {
    about: 'Two nameless shapes at different paths so both can coexist: a Set-Cookie with no "=" at all (badhttp-just-a-value, default path /cookies) and one that starts with "=" (=badhttp_empty_name; Path=/cookies/echo). RFC 6265 §5.2 ignores both — step 2 (no "=") and step 5 (empty name); the bis parse stores each as a value with an empty name. Generations of jars really do differ here.',
    expect: 'Spec-dependent: an RFC 6265 jar stores neither; a bis-style jar stores both as nameless values and echoes them bare.',
  },
  'huge': {
    about: 'One cookie whose name plus value sum to exactly ?bytes= bytes (64-8192, default 4096), padded with x. bis §5.6 step 5 says a client MUST ignore the cookie when name+value exceed 4096 bytes (RFC 6265 §6.1 has only a SHOULD-support floor, measured including attributes). So 4096 survives a conformant jar and 4097 must not. The echo round trip tells you your client\'s cap.',
    expect: 'At 4096 the cookie survives a bis-conformant jar; at 4097 it must be ignored — and pre-bis jars have their own caps.',
  },
};

// Every cookie name this family can plant, with the exact attributes a deletion must repeat to
// match it (RFC 6265 §5.3: removal is by name+domain+path; __Host-/__Secure- deletions must also
// satisfy the prefix rules or the deletion itself is rejected). /cookies/delete is built from this
// table so it cannot drift from the setters. host is the request hostname (for the domain flavor).
function plantedCookies(host, maxCount) {
  const list = [
    // badhttp_ok is expired with the Expires idiom; everything else uses Max-Age=0 (the about
    // promises both idioms are exercised).
    ['badhttp_ok', 'Path=/cookies', 'expires'],
    ['badhttp_folded_a', 'Path=/cookies'],
    ['badhttp_folded_b', 'Path=/cookies'], // only comma-splitting jars have this one; the deletion is for them
    ...Array.from({ length: maxCount }, (_, i) => [`badhttp_many_${String(i + 1).padStart(2, '0')}`, 'Path=/cookies']),
    ['badhttp_dup', 'Path=/cookies/echo'],
    ['badhttp_dup', 'Path=/cookies'],
    ['badhttp_redirect', 'Path=/cookies'],
    ['badhttp_conflict', 'Path=/cookies'],
    ['badhttp_bad_expires', 'Path=/cookies'],
    ['badhttp_far_future', 'Path=/cookies'],
    ['badhttp_wrong_domain', 'Domain=example.com; Path=/'], // matched only by jars broken enough to have stored it
    ['badhttp_supercookie', 'Domain=dev; Path=/'],
    ['badhttp_domain_dot', `Domain=${host}; Path=/cookies`],
    ['badhttp_domain', `Domain=${host}; Path=/cookies`],
    ['badhttp_path_prefix', 'Path=/cookie'],
    ['__Host-badhttp_good', 'Path=/; Secure'],
    ['__Host-badhttp_bad', 'Path=/cookies; Secure'], // only jars without prefix rules stored it; same jars accept this
    ['__Secure-badhttp_good', 'Path=/cookies; Secure'],
    ['__Secure-badhttp_bad', 'Path=/cookies'],
    ['badhttp_quoted', 'Path=/cookies'],
    ['badhttp_semi', 'Path=/cookies'],
    ['badhttp_utf8', 'Path=/cookies'],
    ['', 'Path=/cookies'], // the nameless pair, for bis-style jars that stored them
    ['', 'Path=/cookies/echo'],
    // Legacy jars (Python's http.cookiejar, observed live) parse "badhttp-just-a-value" as a cookie
    // NAMED that with no value, so the empty-name deletions above miss it. This one is for them;
    // everywhere else it plants a Max-Age=0 tombstone that evicts instantly.
    ['badhttp-just-a-value', 'Path=/cookies'],
    ['badhttp_huge', 'Path=/cookies'],
  ];
  return list.map(([name, attrs, idiom]) => `${name}=gone; ${attrs}; ${idiom === 'expires' ? `Expires=${EPOCH}` : 'Max-Age=0'}`);
}

// The Cookie header split as this server documents it (the bis §5.6-style name/value split applied
// per ";"-separated fragment; RFC 6265 itself defines no server-side parse): trim OWS, name = up to
// the first "=", value = the rest; no "=" yields ["", fragment]. Order and duplicates preserved —
// they are test subjects. Empty fragments are dropped. Check it against the raw header alongside.
export function parseCookieHeader(raw) {
  if (raw === null) return [];
  return raw
    .split(';')
    .map((s) => s.replace(/^[ \t]+|[ \t]+$/g, '')) // OWS only (SP/HTAB), not full Unicode trim
    .filter((s) => s.length)
    .map((s) => {
      const i = s.indexOf('=');
      if (i === -1) return ['', s];
      return [s.slice(0, i), s.slice(i + 1)];
    });
}

const b64utf8 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

// One readback shape, used as every setter's `received` and as /cookies/echo's body: the Cookie
// header as the Worker received it (capped at ECHO_CAP BYTES, measured UTF-8-encoded — the
// family's one reflection; a code-unit cap would let multi-byte input triple the bound), its
// base64 (of the UTF-8 re-encoding: the runtime has already replaced non-UTF-8 bytes with U+FFFD),
// and the parsed pairs.
function readback(raw) {
  let header = raw;
  let truncated = false;
  if (raw !== null) {
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length > ECHO_CAP) {
      let end = ECHO_CAP;
      while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // back up to a UTF-8 boundary
      header = new TextDecoder().decode(bytes.subarray(0, end));
      truncated = true;
    }
  }
  return {
    cookie_header: header,
    cookie_header_base64: header === null ? null : b64utf8(header),
    cookies: parseCookieHeader(header),
    count: parseCookieHeader(header).length,
    ...(truncated ? { cookie_header_truncated: true } : {}),
  };
}

export function handleCookies({ seg, url, request, json, bad, intParam, withBase, limits }) {
  const flavor = seg[1];
  if (seg.length > 2) return json({ error: 'not found', hint: '/cookies/{flavor}; GET /cookies lists the flavors' }, 404);
  if (!flavor) {
    return json({
      flavors: Object.fromEntries(Object.entries(COOKIES).map(([k, v]) => [k, v.about])),
      usage: '/cookies/{flavor}; /cookies/echo is the readback',
      politeness: `Every cookie name starts with badhttp_ (or __Host-badhttp_ / __Secure-badhttp_) — except the two nameless-flavor cookies, which have no name at all and carry the badhttp marker in their value. No Max-Age or Expires runs past ${MAX_AGE} s except far-future, whose date is the test (the two reject-me flavors are down at ${REJECT_AGE} s); bad-expires and the nameless pair carry no usable expiry and live as session cookies. Cookies are scoped Path=/cookies wherever the test allows; /cookies/delete expires every cookie the family can plant, exact paths and all; no cookie value is ever derived from your request.`,
      observability: 'Most flavors are visible in the /cookies/echo round trip or in your jar file. wrong-domain and public-suffix are negative tests: the bug is their cookie existing at all. path-prefix is stored correctly by a conformant jar; the bug is it appearing in a Cookie header here. Every response body repeats the Set-Cookie values it carried (set) and what your request carried (received).',
      spec: 'RFC 6265 and draft-ietf-httpbis-rfc6265bis-22 ("bis"); each flavor names the rule it bends.',
      limits: { max_count: limits.cookiesMaxCount, max_bytes: limits.cookiesMaxBytes, echoed_cookie_header_cap: ECHO_CAP },
      witness: cookieWitness(),
    });
  }
  const f = Object.hasOwn(COOKIES, flavor) ? COOKIES[flavor] : undefined;
  if (!f) return json({ error: 'unknown flavor', flavors: Object.keys(COOKIES) }, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed', hint: 'GET /cookies/{flavor}, HEAD for the headers' }, 405, { allow: 'GET, HEAD, OPTIONS' });
  }

  const raw = request.headers.get('cookie');

  // Validate parameters before anything else, so a 400 never carries a Set-Cookie.
  let count = 10;
  if (flavor === 'many') {
    const p = intParam(url.searchParams.get('count') ?? '10', { min: 1, max: limits.cookiesMaxCount, name: 'count' });
    if (p.error) return bad(p.error, `?count=10 (max ${limits.cookiesMaxCount})`);
    count = p.value;
  }
  let hugeBytes = 4096;
  if (flavor === 'huge') {
    const p = intParam(url.searchParams.get('bytes') ?? '4096', { min: 64, max: limits.cookiesMaxBytes, name: 'bytes' });
    if (p.error) return bad(p.error, `?bytes=4096 (max ${limits.cookiesMaxBytes}); bytes counts name+value, the measure bis §5.6 caps at 4096`);
    hugeBytes = p.value;
  }

  // Every flavor is a list of literal Set-Cookie values; the response headers are built FROM this
  // list, so the body's `set` array can never drift from what was actually sent.
  let set = [];
  let status = 200;
  let extra = {};
  switch (flavor) {
    case 'ok':
      set = [`badhttp_ok=1; Path=/cookies; Max-Age=${MAX_AGE}`];
      break;
    case 'echo': {
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: withBase({ 'content-type': 'application/json; charset=utf-8', 'x-badhttp-flavor': flavor }) });
      return json({
        ...readback(raw),
        note: 'Order and duplicates preserved; a pair with no "=" parses as ["", value]. Multiple Cookie header lines are joined with "; " upstream of the Worker; bytes that were not valid UTF-8 arrive as U+FFFD (EF BF BD in the base64).',
      }, 200, { 'x-badhttp-flavor': flavor });
    }
    case 'folded':
      set = [`badhttp_folded_a=1, badhttp_folded_b=2; Path=/cookies; Max-Age=${MAX_AGE}`];
      break;
    case 'many':
      set = Array.from({ length: count }, (_, i) => `badhttp_many_${String(i + 1).padStart(2, '0')}=1; Path=/cookies; Max-Age=${MAX_AGE}`);
      break;
    case 'duplicate':
      set = [
        `badhttp_dup=deep; Path=/cookies/echo; Max-Age=${MAX_AGE}`,
        `badhttp_dup=shallow; Path=/cookies; Max-Age=${MAX_AGE}`,
      ];
      break;
    case 'on-redirect':
      set = [`badhttp_redirect=1; Path=/cookies; Max-Age=${MAX_AGE}`];
      status = 302;
      extra = { location: '/cookies/echo' };
      break;
    case 'delete':
      set = plantedCookies(url.hostname, limits.cookiesMaxCount);
      break;
    case 'conflicting-expiry':
      set = [`badhttp_conflict=alive; Path=/cookies; Expires=${EPOCH}; Max-Age=${MAX_AGE}`];
      break;
    case 'bad-expires':
      set = ['badhttp_bad_expires=1; Path=/cookies; Expires=2027-08-23T12:00:00Z'];
      break;
    case 'far-future':
      set = [`badhttp_far_future=1; Path=/cookies; Expires=${FAR_FUTURE}`];
      break;
    case 'wrong-domain':
      set = [`badhttp_wrong_domain=reject-me; Domain=example.com; Path=/; Max-Age=${REJECT_AGE}`];
      break;
    case 'public-suffix':
      set = [`badhttp_supercookie=reject-me; Domain=dev; Path=/; Max-Age=${REJECT_AGE}`];
      break;
    case 'domain':
      set = [
        `badhttp_domain_dot=1; Domain=.${url.hostname}; Path=/cookies; Max-Age=${MAX_AGE}`,
        `badhttp_domain=1; Domain=${url.hostname}; Path=/cookies; Max-Age=${MAX_AGE}`,
      ];
      break;
    case 'path-prefix':
      set = [`badhttp_path_prefix=1; Path=/cookie; Max-Age=${MAX_AGE}`];
      break;
    case 'name-prefixes':
      set = [
        `__Host-badhttp_good=1; Path=/; Secure; Max-Age=${MAX_AGE}`,
        `__Host-badhttp_bad=1; Path=/cookies; Secure; Max-Age=${MAX_AGE}`,
        `__Secure-badhttp_good=1; Path=/cookies; Secure; Max-Age=${MAX_AGE}`,
        `__Secure-badhttp_bad=1; Path=/cookies; Max-Age=${MAX_AGE}`,
      ];
      break;
    case 'quoted':
      set = [
        `badhttp_quoted="hello world"; Path=/cookies; Max-Age=${MAX_AGE}`,
        `badhttp_semi="semi;colon"; Path=/cookies; Max-Age=${MAX_AGE}`,
      ];
      break;
    case 'utf8':
      // workerd UTF-8-encodes header strings onto the wire: ☃ becomes the raw bytes e2 98 83.
      set = [`badhttp_utf8=☃; Path=/cookies; Max-Age=${MAX_AGE}`];
      break;
    case 'nameless':
      set = [
        'badhttp-just-a-value',
        `=badhttp_empty_name; Path=/cookies/echo; Max-Age=${MAX_AGE}`,
      ];
      break;
    case 'huge': {
      // name+value sum to exactly hugeBytes (the measure bis §5.6 step 5 caps at 4096).
      set = [`badhttp_huge=${'x'.repeat(hugeBytes - 'badhttp_huge'.length)}; Path=/cookies; Max-Age=${MAX_AGE}`];
      break;
    }
    default:
      return json({ error: 'unknown flavor', flavors: Object.keys(COOKIES) }, 404);
  }

  const headers = withBase({ 'content-type': 'application/json; charset=utf-8', 'x-badhttp-flavor': flavor, ...extra });
  for (const c of set) headers.append('set-cookie', c);
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const body = JSON.stringify({ flavor, set, expect: f.expect, received: readback(raw) }, null, 2) + '\n';
  return new Response(body, { status, headers });
}

// ---------- the witness: eight real clients at every setter flavor, read from the rows ----------
// Every number and every list below is computed from src/witness-cookies-data.js, so this block moves when the
// capture is re-run (scripts/cookies-witness/all.sh, then scripts/witness-parse-cookies.mjs). Explanations of
// WHY a named client did something are gated on the computed list being the one they were written for, so a
// re-capture that moves a list drops the explanation rather than misattributing it. Nothing here is a verdict:
// each sentence says what came back to /cookies/echo, and GET /cookies documents which flavors expect nothing.

const cObs = (client, flavor) => OBSERVATIONS_COOKIES.find((o) => o.client === client && o.flavor === flavor);
const cRows = (flavor) => OBSERVATIONS_COOKIES.filter((o) => o.flavor === flavor);
const cName = (id) => (CLIENTS_COOKIES.find((c) => c.id === id) || { name: id }).name;
const cWhere = (flavor, pred) => CLIENTS_COOKIES.filter((c) => { const o = cObs(c.id, flavor); return !!(o && pred(o)); }).map((c) => c.name);
const cSame = (a, b) => a.join('|') === b.join('|');
const cList = (a) => (a.length ? a.join(', ') : 'none');
const jarClients = () => CLIENTS_COOKIES.filter((c) => c.jar_kind !== 'no-jar');
const noJarClients = () => CLIENTS_COOKIES.filter((c) => c.jar_kind === 'no-jar').map((c) => c.name);
const hasJar = (o) => o.jar_kind !== 'no-jar';
const JN = () => jarClients().length;
const returned = (o, n) => !!(o.returned_names && o.returned_names.includes(n));
const echoed = (o, n) => (o.echo ? o.echo.cookies.filter((c) => c.name === n) : []);
const entry = (o, n) => (o.jar_entries ? o.jar_entries.find((e) => e.name === n) || null : null);
const allJar = (flavor, pred) => cWhere(flavor, (o) => hasJar(o) && pred(o));
const ofAll = (names) => (names.length === JN() ? `all ${JN()} clients with a jar` : cList(names));
// Group the clients with a jar by a per-row string and render "X (a, b); Y (c)".
const groups = (flavor, key, only = () => true) => {
  const m = new Map();
  for (const c of jarClients()) { const o = cObs(c.id, flavor); if (!o || !o.echo || !only(o)) continue; const k = key(o); m.set(k, (m.get(k) || []).concat(c.name)); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} (${cList(v)})`).join('; ');
};
const valueHex = (o, n) => { const c = echoed(o, n)[0]; return c ? (c.value == null ? `${c.value_bytes} bytes` : Array.from(new TextEncoder().encode(c.value)).map((b) => b.toString(16).padStart(2, '0')).join(' ')) : 'not returned'; };
const year = (iso) => (iso && /^\d{4}-/.test(iso) ? Number(iso.slice(0, 4)) : null);

export function cookieFindings() {
  const nj = noJarClients();
  const okAll = allJar('ok', (o) => o.outcome === 'all-returned');
  const foldedSplit = allJar('folded', (o) => (o.unplanted_names || []).includes('badhttp_folded_b'));
  const foldedOne = allJar('folded', (o) => returned(o, 'badhttp_folded_a') && !(o.unplanted_names || []).includes('badhttp_folded_b'));
  const foldedNone = allJar('folded', (o) => o.outcome === 'none-returned');
  const manyAll = allJar('many', (o) => o.outcome === 'all-returned');
  const manyOrder = allJar('many', (o) => o.outcome === 'all-returned' && JSON.stringify(o.echo.cookies.map((c) => c.name)) === JSON.stringify(o.planted_names));
  const dupBoth = allJar('duplicate', (o) => echoed(o, 'badhttp_dup').length === 2);
  const dupDeepFirst = allJar('duplicate', (o) => echoed(o, 'badhttp_dup').length === 2 && echoed(o, 'badhttp_dup')[0].value === 'deep');
  const dupOne = groups('duplicate', (o) => (echoed(o, 'badhttp_dup').length === 1 ? `only ${echoed(o, 'badhttp_dup')[0].value}` : echoed(o, 'badhttp_dup').length === 2 ? 'both' : 'neither'), (o) => echoed(o, 'badhttp_dup').length !== 2);
  const redirOk = allJar('on-redirect', (o) => o.outcome === 'all-returned');
  const redirNot = allJar('on-redirect', (o) => o.outcome !== 'all-returned');
  const conflictOk = allJar('conflicting-expiry', (o) => returned(o, 'badhttp_conflict'));
  const conflictNot = allJar('conflicting-expiry', (o) => hasJar(o) && !returned(o, 'badhttp_conflict'));
  const conflict1970 = allJar('conflicting-expiry', (o) => { const e = entry(o, 'badhttp_conflict'); return !!(e && year(e.expires) === 1970); });
  const badExpOk = allJar('bad-expires', (o) => returned(o, 'badhttp_bad_expires'));
  const badExpJar = groups('bad-expires', (o) => { const e = entry(o, 'badhttp_bad_expires'); return !o.jar_enumerable ? 'jar not enumerable' : !e ? 'not in the jar' : e.expires === 'session' || e.expires == null ? 'a session cookie' : `expiry recorded as ${e.expires}`; });
  const farOk = allJar('far-future', (o) => returned(o, 'badhttp_far_future'));
  const farJar = groups('far-future', (o) => { const e = entry(o, 'badhttp_far_future'); const y = e ? year(e.expires) : null; return !o.jar_enumerable ? 'jar not enumerable' : !e ? 'not in the jar' : y === 9999 ? 'the year 9999 kept' : y ? `clamped to ${e.expires.slice(0, 10)}` : `expiry ${e.expires}`; });
  const wrongDom = allJar('wrong-domain', (o) => returned(o, 'badhttp_wrong_domain'));
  const psl = allJar('public-suffix', (o) => returned(o, 'badhttp_supercookie'));
  const domBoth = allJar('domain', (o) => o.outcome === 'all-returned');
  const domHostOnlyFalse = allJar('domain', (o) => { const a = entry(o, 'badhttp_domain_dot'), b = entry(o, 'badhttp_domain'); return !!(a && b && a.host_only === false && b.host_only === false); });
  const domEnum = allJar('domain', (o) => o.jar_enumerable);
  const pathSent = allJar('path-prefix', (o) => returned(o, 'badhttp_path_prefix'));
  const pathStored = allJar('path-prefix', (o) => !!entry(o, 'badhttp_path_prefix'));
  const pathEnum = allJar('path-prefix', (o) => o.jar_enumerable);
  const prefixSig = groups('name-prefixes', (o) => { const r = o.returned_names || []; return r.length ? `returned ${r.join(' and ')}` : 'returned none of the four'; });
  const prefixTwo = allJar('name-prefixes', (o) => cSame((o.returned_names || []).slice().sort(), ['__Host-badhttp_good', '__Secure-badhttp_good']));
  const prefixFour = allJar('name-prefixes', (o) => (o.returned_names || []).length === 4);
  const quotedSig = groups('quoted', (o) => { const q = echoed(o, 'badhttp_quoted')[0], s = echoed(o, 'badhttp_semi')[0]; return `${q ? `badhttp_quoted came back as ${q.value}` : 'badhttp_quoted not returned'} and ${s ? `badhttp_semi as ${s.value}` : 'badhttp_semi not returned'}`; });
  const utf8Sig = groups('utf8', (o) => (returned(o, 'badhttp_utf8') ? `bytes ${valueHex(o, 'badhttp_utf8')}` : 'not returned'));
  const utf8Raw = allJar('utf8', (o) => valueHex(o, 'badhttp_utf8') === 'e2 98 83');
  const utf8Raised = allJar('utf8', (o) => o.outcome === 'client-raised');
  const utf8RaisedErr = utf8Raised.length ? (cRows('utf8').find((o) => o.outcome === 'client-raised').reported_error || '').slice(0, 120) : '';
  const namelessRet = allJar('nameless', (o) => o.outcome !== 'none-returned');
  const namelessAsName = allJar('nameless', (o) => !!entry(o, 'badhttp-just-a-value'));
  const namelessRejected = allJar('nameless', (o) => (o.jar_rejections || []).length >= 1);
  const namelessNone = allJar('nameless', (o) => o.outcome === 'none-returned' && !(o.jar_rejections || []).length);
  const hugeOk = allJar('huge', (o) => returned(o, 'badhttp_huge'));
  const hugeNot = allJar('huge', (o) => hasJar(o) && !returned(o, 'badhttp_huge'));
  const delClean = jarClients().filter((c) => FLAVOR_LIST_FOR_DELETE.every((f) => { const o = cObs(c.id, f); return !(o && o.after_delete) || o.after_delete_remaining === 0; })).map((c) => c.name);
  const delLeft = jarClients().map((c) => ({ c, left: FLAVOR_LIST_FOR_DELETE.filter((f) => { const o = cObs(c.id, f); return o && o.after_delete && o.after_delete_remaining > 0; }) })).filter((x) => x.left.length).map((x) => `${x.c.name} (${x.left.join(', ')})`);
  const tombstones = jarClients().map((c) => { const names = new Set(); for (const f of FLAVOR_LIST_FOR_DELETE) { const o = cObs(c.id, f); for (const n of (o && o.after_delete_unplanted) || []) names.add(n); } return { c, names: [...names] }; }).filter((x) => x.names.length).map((x) => `${x.c.name} (${x.names.join(', ')})`);
  const tombstoneOnlyOk = tombstones.length > 0 && jarClients().every((c) => FLAVOR_LIST_FOR_DELETE.every((f) => { const o = cObs(c.id, f); return ((o && o.after_delete_unplanted) || []).every((n) => n === 'badhttp_ok'); }));
  const failed = OBSERVATIONS_COOKIES.filter((o) => o.outcome === 'client-raised' || o.outcome === 'request-failed');
  const pyJar = ['Python urllib.request', 'Python requests', 'Python httpx'];
  return [
    `ok (the control): ${ofAll(okAll)} stored badhttp_ok and sent it back to /cookies/echo. ${cList(nj)} ${nj.length === 1 ? 'has' : 'have'} no cookie jar at all, so ${nj.length === 1 ? 'its' : 'their'} echo carried nothing on every flavor: a capability of the library, not a bug, and ${nj.length === 1 ? 'its' : 'their'} rows say jar_kind: no-jar.`,
    `folded (two cookies comma-joined into one Set-Cookie): ${foldedOne.length ? `${cList(foldedOne)} stored one cookie, badhttp_folded_a, with the comma and the fake second cookie inside its value, as the bis parse says` : 'no client stored exactly one cookie'}${foldedSplit.length ? `; ${cList(foldedSplit)} split on the comma and returned a second cookie named badhttp_folded_b that this server never set` : '; no client split on the comma'}${foldedNone.length ? `; ${cList(foldedNone)} returned neither` : ''}.`,
    `many (ten separate Set-Cookie headers): ${ofAll(manyAll)} returned all ten${manyOrder.length ? `, ${cSame(manyOrder, manyAll) ? 'all of them' : cList(manyOrder)} in creation order` : ''}. duplicate (the same name on two paths): ${ofAll(dupBoth)} sent both badhttp_dup cookies to /cookies/echo${dupDeepFirst.length ? `, ${cSame(dupDeepFirst, dupBoth) ? 'every one' : cList(dupDeepFirst)} with the longer path (deep) first as §5.4 asks` : ''}${dupBoth.length < JN() ? `; the rest: ${dupOne}` : ''}.`,
    `on-redirect (Set-Cookie on the 302 itself): ${ofAll(redirOk)} kept the cookie set on the redirect and presented it on the follow-up${redirNot.length ? `; ${cList(redirNot)} did not` : ''}.`,
    `conflicting-expiry (Expires in 1970 and Max-Age=3600 on one cookie): ${ofAll(conflictOk)} kept the cookie, so Max-Age won${conflictNot.length ? `; ${cList(conflictNot)} dropped it` : ''}${conflict1970.length ? `. ${cList(conflict1970)} nevertheless recorded the 1970 date in the jar entry it exposed while still sending the cookie` : ''}. bad-expires (an ISO 8601 date): ${ofAll(badExpOk)} sent it back; in the jar it is ${badExpJar}.`,
    `far-future (Expires in the year 9999; bis §5.5 recommends a 400-day cap): ${ofAll(farOk)} sent it back; in the jar: ${farJar}.`,
    `wrong-domain (Domain=example.com) and public-suffix (Domain=dev): ${wrongDom.length ? `${cList(wrongDom)} returned the wrong-domain cookie` : `no client returned the wrong-domain cookie`}; ${psl.length ? `${cList(psl)} returned the supercookie scoped to the whole TLD` : 'no client returned the supercookie scoped to the whole TLD'}. Returning nothing is what §5.3 asks for on both.`,
    `domain (Domain=.badhttp.dev and Domain=badhttp.dev): ${ofAll(domBoth)} returned both${domEnum.length ? `; of the ${domEnum.length} whose jar the harness could enumerate, ${cSame(domHostOnlyFalse, domEnum) ? 'all' : cList(domHostOnlyFalse)} recorded both as domain cookies (host_only: false), the leading dot making no difference` : ''}. path-prefix (Path=/cookie, one letter short): ${pathSent.length ? `${cList(pathSent)} sent it to /cookies/echo, which §5.1.4 says must not happen` : 'no client sent it to /cookies/echo (correct: /cookie does not path-match /cookies/echo)'}${pathEnum.length ? `; ${cSame(pathStored, pathEnum) ? 'every enumerable jar' : cList(pathStored)} had stored it` : ''}.`,
    `name-prefixes (__Host- and __Secure-, one valid and one invalid each): ${prefixSig}.${prefixTwo.length && prefixFour.length ? ` The two-cookie answer is the bis §4.1.3 rule; the four-cookie answer is RFC 6265 without prefix rules, and both are conformant to their own specification.` : ''}${cSame(prefixFour, pyJar) ? ' The three clients built on Python\'s http.cookiejar store all four: cookiejar.py contains no prefix rules at all.' : ''}`,
    `quoted (a DQUOTE-wrapped value with a space, and a semicolon inside quotes): ${quotedSig}.`,
    `utf8 (a raw ☃, bytes e2 98 83, in the value): ${utf8Sig}${utf8Raised.length ? `; ${cList(utf8Raised)} stored it and then raised while sending it back (${utf8RaisedErr})` : ''}.${utf8Raw.length === JN() ? ' Every jar round-tripped the raw bytes unchanged.' : ''}`,
    `nameless (a Set-Cookie with no "=" at all, and one starting with "="): ${namelessRet.length ? `${cList(namelessRet)} sent the no-equals line back bare, which this server reads as a nameless value` : 'no client sent either back'}${namelessAsName.length ? ` — and ${cSame(namelessAsName, namelessRet) ? 'their jars' : `the jars of ${cList(namelessAsName)}`} record it as a cookie NAMED badhttp-just-a-value with no value at all` : ''}; no client sent back the line that starts with "="${namelessRejected.length ? `; ${cList(namelessRejected)} refused both loudly (jar_rejections on the row)` : ''}${namelessNone.length ? `; ${cList(namelessNone)} stored neither and raised nothing` : ''}.${cSame(namelessAsName, pyJar) ? ' http.cookiejar parses a value with no "=" as a name and writes it back without one (the same behaviour v0.6.0 recorded on 2026-08-23), which is why /cookies/delete carries a deletion for that name.' : ''}`,
    `huge (name+value exactly 4096 bytes, the bis §5.6 limit): ${ofAll(hugeOk)} stored and returned it${hugeNot.length ? `; ${cList(hugeNot)} did not` : ''}.`,
    `delete (one expiring Set-Cookie per plantable cookie, exact attributes): after the cleanup, ${delClean.length === JN() ? `every client with a jar` : cList(delClean)} had none of the planted cookies left on any flavor${delLeft.length ? `; still present afterwards: ${delLeft.join('; ')}` : ''}.`,
    `Also after the cleanup: ${tombstones.length ? `${tombstones.join('; ')} carried a cookie that no flavor in that session had planted — a deletion tombstone from /cookies/delete stored as a live cookie instead of removing one` : 'no client carried a deletion tombstone as a live cookie'}.${tombstoneOnlyOk ? ' badhttp_ok is the one deletion in that list that uses the Expires=1970 idiom; the other forty-four use Max-Age=0 and took effect, so the jar that kept it acted on Max-Age and not on an Expires in the past.' : ''}`,
    `${failed.length} of ${OBSERVATIONS_COOKIES.length} observations ended in the client raising or the transport failing${failed.length ? `: ${cList(failed.map((o) => `${cName(o.client)} on ${o.flavor}`))}` : ''}. Every other row is four responses this server sent, each read back from the wire with its x-badhttp-version.`,
  ];
}
const FLAVOR_LIST_FOR_DELETE = ['ok', 'folded', 'many', 'duplicate', 'on-redirect', 'conflicting-expiry', 'bad-expires', 'far-future', 'wrong-domain', 'public-suffix', 'domain', 'path-prefix', 'name-prefixes', 'quoted', 'utf8', 'nameless', 'huge'];

export function cookieWitness() {
  return {
    measured: WITNESS_COOKIES.probed,
    observations: OBSERVATIONS_COOKIES.length,
    data: 'https://badhttp.dev/clients.jsonl',
    data_note:
      'Every observation is a row of /clients.jsonl with family "cookies", joined to /corpus.jsonl by ' +
      'corpus_id; /clients indexes them with the jar legend, the outcome legend and the per-flavor ' +
      'disagreement. The findings below are a reading of those rows, not a second source.',
    what_this_is:
      'Eight real HTTP clients, each with a fresh jar per flavor, run through GET /cookies/{flavor}, ' +
      'GET /cookies/echo, GET /cookies/delete and GET /cookies/echo again on this exact date. It is a DATED ' +
      'CAPTURE, not a live measurement, and it describes WHAT CAME BACK to /cookies/echo — never a verdict ' +
      'on a client. On wrong-domain, public-suffix and path-prefix, returning nothing is what the ' +
      'specification asks for; a client with no jar returning nothing anywhere is a capability, not a ' +
      'defect, and its rows say jar_kind: no-jar. Where the harness could enumerate the jar, the row also ' +
      'carries what the jar recorded (domain, path, host_only, secure, expires), which is how a cookie ' +
      'that was stored but correctly not sent is told apart from one that was never stored. Re-run it ' +
      'and move the date rather than letting it stale.',
    clients: CLIENTS_COOKIES.map((c) => `${c.name} ${c.version}`),
    findings: cookieFindings(),
    what_the_oracle_cannot_tell_you:
      '/cookies/echo says what one request carried. It cannot say what the jar holds (a cookie stored ' +
      'and correctly withheld looks the same as one never stored), which is why rows carry jar_entries ' +
      'where the client exposes its jar and jar_enumerable: false where it does not; it cannot say what ' +
      'the client refused loudly, which is why jar_rejections exists; and it cannot see a cookie the ' +
      'client dropped at parse time. Each row is a description of these four responses on one date.',
    reproduce:
      'Start the row\'s client with a fresh jar, GET the row\'s url following redirects, GET /cookies/echo ' +
      'and compare its cookies with the row\'s echo.cookies; then GET /cookies/delete and /cookies/echo ' +
      'again. Pace the calls against the zone limit of 100 per 10 s, and treat a response without ' +
      'x-badhttp-version as no observation. The harnesses that produced the rows are in ' +
      'scripts/cookies-witness/ in the source.',
  };
}

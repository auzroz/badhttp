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

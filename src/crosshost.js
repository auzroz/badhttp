// /crosshost — what your HTTP client does with credentials when a redirect crosses a host boundary.
//
// WHY THIS FAMILY NEEDS A SECOND HOST, AND WHY IT CANNOT BE A LOCALHOST FIXTURE.
// Every mainstream HTTP client decides whether to keep forwarding Authorization, Proxy-Authorization
// and Cookie by comparing the redirect target against the origin it started from. The comparison
// each client makes is different, and the differences are only visible across real, separately-named
// hosts with real DNS and real certificates. A listener on 127.0.0.1 cannot show it: an agent
// framework's SSRF filter rejects a loopback target at hop zero, so the very code under test never
// runs. So this family runs across two hostnames this project owns:
//
//     badhttp.dev        the canonical host
//     alt.badhttp.dev    a second host, same Worker, same zone
//
// The second host costs nothing: the zone's universal certificate already covered *.badhttp.dev
// before it existed. Keep every cross-host name ONE label deep anyway. The universal certificate
// covers exactly one level, and while creating this custom domain happened to mint a further
// certificate carrying *.alt.badhttp.dev as well (observed 2026-09-10, so deep.alt.badhttp.dev does
// complete a handshake today), that is a side effect of the custom-domain flow and not a property to
// build on. A name that needed coverage the universal certificate does not provide would mean
// Advanced Certificate Manager, which is a paid add-on this project has no room for.
//
// THERE IS NO OPEN REDIRECT HERE, BY CONSTRUCTION. No byte a caller sends ever reaches a Location
// header. Targets are complete absolute URLs held in the frozen TARGETS table below, selected by an
// opaque flavor name looked up with Object.hasOwn, and every Location is asserted against
// LOCATION_OK before it is returned. There is no ?url=, ?next= or ?to= parameter, and there never
// may be: this domain's reputation is the thing that makes an allowlist worth having.
//
// NO-ECHO. This family exists to be sent credentials by people testing whether their client leaks
// them, so some of those credentials will be real ones sent by mistake. Nothing that arrives on the
// wire is ever reflected — not whole, not truncated, and deliberately not hashed, because a digest
// of a weak credential is a cracking target, not a mitigation. The only observables are presence, a
// scheme name when it is one this server recognizes, and a byte count. Cookie NAMES are reported
// only for cookies badhttp itself minted (a badhttp_ name, with or without a __Host-/__Secure-
// prefix); everything else is counted, never named. This is the /auth family's invariant, extended,
// and for the same reason.

import { WITNESS_CROSSHOST, CLIENTS_CROSSHOST, OBSERVATIONS_CROSSHOST } from './witness-crosshost-data.js';

const CANONICAL = 'badhttp.dev';
const ALT = 'alt.badhttp.dev';
// Cloudflare's alternate HTTPS port for this zone, covered by the same certificate.
const ALT_PORT = 8443;

// Absolute targets, frozen. Nothing here is ever built from caller input.
const TARGETS = Object.freeze({
  landCanonicalHttps: `https://${CANONICAL}/crosshost/land`,
  landAltHttps: `https://${ALT}/crosshost/land`,
  landCanonicalHttp: `http://${CANONICAL}/crosshost/land`,
  hopBoomerang: `https://${ALT}/crosshost/boomerang-return`,
  boomerangEnd: `https://${CANONICAL}/crosshost/land`,
  upgradeStart: `https://${CANONICAL}/crosshost/land`,
  // Cloudflare serves this zone on 8443 as well as 443, with the same certificate — verified live
  // 2026-09-10, and the Worker sees `host: badhttp.dev:8443`. Same host, different port.
  landPort: `https://${CANONICAL}:${ALT_PORT}/crosshost/land`,
});

// A protocol-relative (RFC 3986 §4.2 network-path) reference. It is held as an EXACT CONSTANT and
// compared with string equality rather than matched by pattern, because the whole danger of a
// protocol-relative Location is that `//host` replaces the authority: a pattern that admits the
// shape at all is one regex mistake away from admitting `//evil.example`. Nothing builds this value.
const PROTOCOL_RELATIVE_TARGET = `//${ALT}/crosshost/land`;

// A tripwire, not an input filter: the table above is trusted today, so this guards against a future
// session wiring caller data into a target. Fails closed and loudly rather than emitting the header.
const LOCATION_OK = /^https?:\/\/(badhttp\.dev|alt\.badhttp\.dev)(:8443)?\/[\x21-\x7e]*$/;

function assertLocation(loc) {
  // The single permitted protocol-relative value, admitted by exact equality only.
  if (loc === PROTOCOL_RELATIVE_TARGET) return true;
  if (
    typeof loc !== 'string' ||
    !LOCATION_OK.test(loc) ||
    loc.includes('@') ||
    loc.includes('\\') ||
    loc.includes('\r') ||
    loc.includes('\n')
  ) {
    return false;
  }
  return true;
}

// The public, fake credentials this family documents. Sending anything else is what the warning is
// for. These are the same shapes /auth uses, so a client already configured for /auth needs nothing new.
const TEST_BASIC = 'Basic YWdlbnQ6Y29ycmVjdA=='; // agent:correct
const TEST_BEARER = 'Bearer badhttp-token-ok';
const TEST_APIKEY = 'badhttp-key-ok';

export const CROSSHOST = {
  'same-origin': {
    start: 'canonical',
    scheme: 'https',
    about:
      'The control: one redirect that does not leave badhttp.dev. Every client that sends credentials at all sends them to the second hop, so a run where this flavor shows nothing means the credential never left your client and the other rows are measuring your configuration, not the boundary. Read this one first.',
    hops: 1,
  },
  'to-subdomain': {
    related: ['CVE-2018-1000007 (curl 6.0-7.57.0: a custom Authorization header was forwarded to any redirect target; the fix restricted it to the original host and made cross-host forwarding opt-in via --location-trusted)'],
    start: 'canonical',
    scheme: 'https',
    about:
      'badhttp.dev redirects to alt.badhttp.dev — a different host, one label deeper, same registrable domain. Most clients compare hostnames exactly and strip Authorization here. Go net/http does not: shouldCopyHeaderOnRedirect() forwards its sensitive headers when the destination is the initial host or a subdomain of it, which its own documentation states as intended. This is the flavor the family exists for, and the one a loopback fixture cannot produce.',
    hops: 1,
  },
  'from-subdomain': {
    related: ['GHSA-hq3h-g68c-hp78 / CVE-2026-55553 (node urllib, 2026-08-25): the researcher built a three-container rig with distinct hostnames rather than a loopback pair, stating that the redirect had to cross a clear origin boundary for the test to mean anything.'],
    start: 'alt',
    scheme: 'https',
    about:
      'The same boundary in the other direction: alt.badhttp.dev redirects to badhttp.dev. The rule that forwards apex-to-subdomain does not run backwards — a parent is not a subdomain of its child — so a client that kept its credentials on to-subdomain may well strip them here. Start this one on the alt host; its URL is not on badhttp.dev.',
    hops: 1,
  },
  boomerang: {
    related: ['Not a vulnerability, a design difference: curl re-evaluates each hop against the ORIGINAL origin (Curl_auth_allowed_to_origin), while Go latches a strip decision once (client.go stripSensitiveHeaders) and several clients mutate a carried header map. Same start and end origin, different answers.'],
    start: 'canonical',
    scheme: 'https',
    about:
      'Two redirects and three requests, out to alt.badhttp.dev and back to badhttp.dev, ending where it began. Clients that compare each hop against the ORIGINAL origin and regenerate the header can restore a credential they had already dropped; clients that carry a header map and delete from it, or that latch a strip decision once and never revisit it, cannot. Same start and end origin, opposite answers.',
    hops: 2,
  },
  'scheme-upgrade': {
    related: ['CVE-2018-20060 (urllib3 < 1.23): Authorization was not removed on a cross-origin redirect, where urllib3 defines cross-origin as a difference in host, PORT OR SCHEME.', 'Python requests keeps credentials across exactly this hop by a documented carve-out in should_strip_auth(), commented as backwards compatibility rather than a security judgement.'],
    start: 'canonical',
    scheme: 'http',
    about:
      'Same hostname, plaintext to TLS: http://badhttp.dev redirects to https://badhttp.dev. Several clients treat the scheme as part of the origin and strip here; Python requests carries a documented carve-out that keeps credentials across exactly this hop on default ports, kept for backwards compatibility and commented as such in its source. Start this one over http.',
    hops: 1,
  },
  'scheme-downgrade': {
    related: ['CVE-2022-27776 (curl 4.9-7.82.0, 2022-04-27): a redirect to the SAME hostname on a different port or scheme leaked both Authorization and Cookie, because the same-host check compared only the hostname. Introduced in curl 4.9 (2000) and unfixed for 22 years.', 'CVE-2025-14524 (curl 7.33.0-8.17.0): an OAuth2 bearer token leaked on a cross-protocol redirect, including to the same hostname on a different protocol and port.'],
    start: 'canonical',
    scheme: 'https',
    about:
      'The dangerous direction: https://badhttp.dev redirects to http://badhttp.dev, same hostname, TLS to plaintext. A client that compares only the hostname sends the credential over the wire in the clear. Use the public test credentials here and nothing else — the second hop is not encrypted, and this server says so in the response.',
    hops: 1,
  },
  'port-change': {
    start: 'canonical',
    scheme: 'https',
    related: ['CVE-2022-27776 (curl 4.9-7.82.0): a redirect to the same hostname on a different port leaked both Authorization and Cookie, because the same-host check compared only the hostname.', 'urllib3 (CVE-2018-20060) defines a cross-origin redirect as a difference in host, PORT or scheme, and compares a (scheme, host, port) tuple.'],
    about:
      'Same hostname, same scheme, different port: badhttp.dev redirects to badhttp.dev:8443, which Cloudflare serves for this zone under the same certificate. This is the axis a hostname-only comparison structurally cannot see — Go net/http compares URL.Hostname(), which strips the port, so a port change is invisible to it, while clients that compare a (scheme, host, port) tuple treat it as a different origin. Nothing about the destination is less trustworthy than the origin here; the point is only which clients notice the difference at all.',
    hops: 1,
  },
  'relative-authority': {
    start: 'canonical',
    scheme: 'https',
    related: ['CVE-2026-54603 (ruby oauth2, 2026-07-28): resolving a protocol-relative reference against a base URL replaces the authority, so a client whose credential-stripping logic runs off a different code path than its URL resolution never notices the host changed.'],
    about:
      'The host changes without the Location naming a scheme: a protocol-relative reference (RFC 3986 §4.2 network-path, Location: //alt.badhttp.dev/crosshost/land). Resolving it against the current URL replaces the authority entirely. This tests URL RESOLUTION rather than header policy, and the two live in different code paths in most clients — a client can compare origins correctly and still fail to notice this one changed hosts. The target is a fixed constant this server holds; it is never built from anything a caller sends.',
    hops: 1,
  },
  jar: {
    related: ['rfc6265bis-22 §5.1.3 (domain-matching) and §5.7 (storage model): a cookie with no Domain attribute is host-only and must not travel; a __Host- cookie is locked to the host that set it.'],
    start: 'canonical',
    scheme: 'https',
    about:
      'The cookie half of the boundary, and a different question from the header half. This hop sets three cookies before redirecting to alt.badhttp.dev: badhttp_hostonly (no Domain attribute, so it belongs to badhttp.dev alone), badhttp_domain (Domain=badhttp.dev, which by rfc6265bis §5.1.3 domain-matching also covers subdomains, so it legitimately travels), and __Host-badhttp_lock, whose prefix requires Secure, Path=/ and no Domain and in exchange locks the cookie to exactly the host that set it. Only badhttp_domain should arrive. A jar that also sends the host-only one is ignoring the host-only flag; a jar that sends the __Host- one has broken the only guarantee that prefix makes. A client with no jar, or one that forwards the Cookie header it was handed rather than recomputing per host, gives a different answer again.',
    hops: 1,
  },
};

// Which host each flavor must be started on, and over which scheme. The corpus and the index publish
// these rather than assuming every row lives on the canonical origin.
export function crosshostStartUrl(flavor) {
  const f = CROSSHOST[flavor];
  if (!f) return null;
  const host = f.start === 'alt' ? ALT : CANONICAL;
  return `${f.scheme}://${host}/crosshost/${flavor}`;
}

function describe(value) {
  if (value === null || value === undefined) return { present: false };
  const first = (value.split(' ')[0] || '').toLowerCase();
  const known = first === 'basic' || first === 'bearer' || first === 'digest';
  return {
    present: true,
    // Named only when it is a scheme this server knows, so a bare secret sent as the whole header
    // value never has its first token reflected back as if it were a scheme name.
    scheme: known ? first : 'unrecognized (not echoed)',
    bytes: value.length,
  };
}

// Cookie names are reported only for cookies this server minted. Everything else is counted.
function describeCookie(value) {
  if (value === null || value === undefined) return { present: false, ours: [], other_count: 0 };
  const names = value
    .split(';')
    .map((p) => p.trim().split('=')[0])
    .filter(Boolean);
  // Cookies this server minted, including the ones carrying a rfc6265bis prefix.
  const ours = names.filter((n) => /^(?:__Host-|__Secure-)?badhttp_/.test(n));
  return {
    present: true,
    bytes: value.length,
    ours,
    other_count: names.length - ours.length,
    note: 'Cookie names are listed only for cookies this server set (a badhttp_ name, optionally under a __Host- or __Secure- prefix). Any others are counted and never named.',
  };
}

const NO_ECHO =
  'Nothing you sent is echoed here — not the value, not a prefix, not a hash. A digest of a weak ' +
  'credential is a cracking target, not a mitigation. You know what you sent; presence, scheme and ' +
  'byte length are enough to tell you whether it survived the hop.';

const READING_THIS =
  'These fields describe what THIS SERVER RECEIVED on the final hop. They are not a verdict on your ' +
  'client. Whether forwarding a credential across a given boundary is a bug depends on the boundary ' +
  'and on what your client documents: RFC 9110 §15.4 says nothing at all about credentials on ' +
  'redirects, and the Fetch standard’s cross-origin stripping rule governs browsers, not command ' +
  'line clients. Several of the behaviours you can observe here are deliberate, documented choices ' +
  'by their authors. What this server can tell you truthfully is which bytes arrived.';

const EDGE_NOTE =
  'Every response from this server carries an x-badhttp-version header. If a response you get while ' +
  'following one of these chains does NOT carry it, the Worker never ran: you hit the zone rate limit ' +
  '(100 requests per 10 s per IP) and are reading Cloudflare’s own 429, not a badhttp response. ' +
  'Each hop is a separate request against that budget. Treat a missing x-badhttp-version as no ' +
  'observation and retry after a pause — recording it as "the credential did not survive" would ' +
  'be a false reading, and this family is only worth having if its readings are true.';

export function handleCrosshost({ seg, url, request, json, bad, withBase }) {
  const flavor = seg[1];
  const isAlt = url.hostname.toLowerCase() === ALT;

  const redirectTo = (loc, extra = {}) => {
    if (!assertLocation(loc)) {
      // Fails closed: a target that does not match the frozen table's shape is a bug in this file,
      // never a caller's doing, and it must not reach the wire as a redirect.
      return json(
        { bug: true, error: 'refusing to emit a Location that failed this family’s own guard', report_to: 'ops@badhttp.dev' },
        500,
      );
    }
    return new Response(null, {
      status: 302,
      statusText: 'Found',
      headers: withBase({ location: loc, 'x-badhttp-family': 'crosshost', ...extra }),
    });
  };

  // The oracle. Reachable on both hosts; that is the point.
  if (flavor === 'land') {
    const auth = request.headers.get('authorization');
    const cookie = request.headers.get('cookie');
    const apiKey = request.headers.get('x-api-key');
    // Per credential, never OR'd into one boolean. A single flag covering all three reported "true"
    // when only the X-Api-Key arrived and the Authorization had been stripped — which is the exact
    // shape of a field that says something untrue about the response it is describing. null means
    // the header did not arrive at all, so no claim is made about it.
    const matched = (v, ...expected) => (v === null || v === undefined ? null : expected.includes(v));
    const somethingElse = (auth !== null && auth !== TEST_BASIC && auth !== TEST_BEARER) ||
      (apiKey !== null && apiKey !== TEST_APIKEY);

    return json(
      {
        landed_on: url.hostname,
        // The port matters here: url.hostname omits it, and one flavor's whole subject is a port change.
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        scheme: url.protocol.replace(':', ''),
        method: request.method,
        received: {
          authorization: describe(auth),
          proxy_authorization: describe(request.headers.get('proxy-authorization')),
          cookie: describeCookie(cookie),
          // Not a standard header, and no client measured here stripped it at any boundary (72 of 72
          // on 2026-09-17), which is the point of reporting it: the API-key convention most real
          // services use is not one of the credential headers these clients treat as sensitive.
          x_api_key: describe(apiKey),
        },
        matches_documented_test_credential: {
          authorization: matched(auth, TEST_BASIC, TEST_BEARER),
          x_api_key: matched(apiKey, TEST_APIKEY),
          note: 'Per credential. null means that header did not arrive, so nothing is claimed about it.',
        },
        transport_was_encrypted: url.protocol === 'https:',
        warning: somethingElse
          ? 'A credential that is not one of this family’s public test values reached this host across a redirect. Whatever you sent has now left the host you sent it to. Treat it as exposed and rotate it.'
          : null,
        no_echo: NO_ECHO,
        reading_this: READING_THIS,
        edge_note: EDGE_NOTE,
      },
      200,
      {
        'x-badhttp-family': 'crosshost',
        'x-badhttp-landed-on': url.hostname,
        ...(somethingElse
          ? { 'x-badhttp-warning': 'an undocumented credential crossed a host boundary to reach this server; treat it as exposed' }
          : {}),
        ...(url.protocol === 'https:' ? {} : { 'x-badhttp-warning-transport': 'this hop was plaintext http' }),
      },
    );
  }

  // The middle hop of the boomerang. Not a flavor: it is not a starting point, and it does not
  // appear in the flavor table or the corpus as one.
  if (flavor === 'boomerang-return') {
    if (!isAlt) return json({ error: 'this hop only exists on ' + ALT, start_at: crosshostStartUrl('boomerang') }, 404);
    return redirectTo(TARGETS.boomerangEnd, { 'x-badhttp-hop': '2 of 2, returning to the origin the chain started from' });
  }

  if (flavor === undefined) return crosshostIndex({ url, json });

  if (!Object.hasOwn(CROSSHOST, flavor)) {
    return json(
      { error: 'unknown crosshost flavor', flavors: Object.keys(CROSSHOST), index: `https://${CANONICAL}/crosshost` },
      404,
    );
  }

  const f = CROSSHOST[flavor];
  const wantHost = f.start === 'alt' ? ALT : CANONICAL;
  if (url.hostname.toLowerCase() !== wantHost) {
    return json(
      {
        error: `this flavor starts on ${wantHost}`,
        start_at: crosshostStartUrl(flavor),
        why: f.start === 'alt'
          ? 'The direction is the measurement: starting it on the canonical host would test the opposite boundary and quietly give you the other flavor’s answer.'
          : 'Start it on the canonical host so the first hop is the one documented.',
      },
      404,
    );
  }
  if (f.scheme === 'http' && url.protocol !== 'http:') {
    return json(
      {
        error: 'this flavor starts over plaintext http',
        start_at: crosshostStartUrl(flavor),
        why: 'The scheme change is the boundary under test; starting over https would make the first hop and the second identical.',
      },
      404,
    );
  }

  switch (flavor) {
    case 'same-origin':
      return redirectTo(TARGETS.landCanonicalHttps, { 'x-badhttp-boundary': 'none: same scheme, host and port' });
    case 'to-subdomain':
      return redirectTo(TARGETS.landAltHttps, { 'x-badhttp-boundary': `${CANONICAL} -> ${ALT} (subdomain of the initial host)` });
    case 'from-subdomain':
      return redirectTo(TARGETS.landCanonicalHttps, { 'x-badhttp-boundary': `${ALT} -> ${CANONICAL} (parent of the initial host)` });
    case 'boomerang':
      return redirectTo(TARGETS.hopBoomerang, { 'x-badhttp-hop': '1 of 2, leaving for the other host' });
    case 'scheme-upgrade':
      return redirectTo(TARGETS.upgradeStart, { 'x-badhttp-boundary': 'http -> https, same host and default ports' });
    case 'scheme-downgrade':
      return redirectTo(TARGETS.landCanonicalHttp, {
        'x-badhttp-boundary': 'https -> http, same host',
        'x-badhttp-warning': 'the next hop is plaintext; send only the documented public test credentials',
      });
    case 'port-change':
      return redirectTo(TARGETS.landPort, { 'x-badhttp-boundary': `${CANONICAL} -> ${CANONICAL}:${ALT_PORT} (same host and scheme, different port)` });
    case 'relative-authority':
      return redirectTo(PROTOCOL_RELATIVE_TARGET, { 'x-badhttp-boundary': `protocol-relative reference; resolving it moves you to ${ALT}` });
    case 'jar': {
      const loc = TARGETS.landAltHttps;
      if (!assertLocation(loc)) return json({ bug: true }, 500);
      const h = withBase({
        location: loc,
        'x-badhttp-boundary': `${CANONICAL} -> ${ALT}, with three cookies set on the way out`,
        'x-badhttp-family': 'crosshost',
      });
      // Host-only: no Domain attribute, so it belongs to badhttp.dev and must not reach the subdomain.
      h.append('set-cookie', 'badhttp_hostonly=host-only-value; Path=/; Max-Age=300; SameSite=Lax');
      // Domain-scoped: RFC 6265 §5.1.3 domain-matching covers subdomains, so this one should.
      h.append('set-cookie', `badhttp_domain=domain-scoped-value; Domain=${CANONICAL}; Path=/; Max-Age=300; SameSite=Lax`);
      // __Host- is the strongest scoping a cookie can ask for: rfc6265bis requires Secure, Path=/ and
      // NO Domain attribute, and in exchange the cookie is locked to exactly the host that set it.
      // If this one reaches the other host, the prefix's entire security claim has failed for that
      // client — which is a more serious result than either of the two above.
      h.append('set-cookie', '__Host-badhttp_lock=host-locked-value; Path=/; Secure; Max-Age=300; SameSite=Lax');
      return new Response(null, { status: 302, statusText: 'Found', headers: h });
    }
    default:
      return json({ error: 'unhandled flavor' }, 500);
  }
}

// The witness: eight real clients started at every flavor, the oracle's report of what arrived.
// Numbers are computed from the capture; the prose is a reading of THAT capture and is re-read when
// the capture is re-run (scripts/crosshost-witness/all.sh, then scripts/witness-parse-crosshost.mjs).
// Descriptions of what a caller received, never verdicts — see READING_THIS.
const get = (client, flavor) => OBSERVATIONS_CROSSHOST.find((o) => o.client === client && o.flavor === flavor);
const arrivedAuth = (client, flavor) => { const o = get(client, flavor); return !!(o && o.arrived && o.arrived.authorization); };
// "Forwarded" and "stripped" below mean BOTH Authorization and the hand-set Cookie; a flavor where one
// arrived without the other is reported separately rather than folded into either list.
const arrivedBoth = (client, flavor) => { const o = get(client, flavor); return !!(o && o.arrived && o.arrived.authorization && o.arrived.cookie); };
const arrivedNeither = (client, flavor) => { const o = get(client, flavor); return !!(o && o.arrived && !o.arrived.authorization && !o.arrived.cookie); };
const arrivedMixed = (client, flavor) => { const o = get(client, flavor); return !!(o && o.arrived && (o.arrived.authorization !== o.arrived.cookie)); };
// An explanation of WHY a named client behaved as it did is only attached while the computed list is
// the one it was written for; if a re-capture moves the list, the explanation drops out rather than
// misattributing itself.
const same = (a, b) => a.join('|') === b.join('|');
const HEADER_FLAVORS = Object.keys(CROSSHOST).filter((f) => f !== 'jar');
const BOUNDARY_FLAVORS = HEADER_FLAVORS.filter((f) => f !== 'same-origin');

export function crosshostFindings() {
  const O = OBSERVATIONS_CROSSHOST;
  const n = O.length;
  const keyArrived = O.filter((o) => o.arrived && o.arrived.x_api_key).length;
  const authStripped = O.filter((o) => o.arrived && !o.arrived.authorization).length;
  const goForwarded = BOUNDARY_FLAVORS.filter((f) => arrivedBoth('go-nethttp', f));
  const goStripped = BOUNDARY_FLAVORS.filter((f) => arrivedNeither('go-nethttp', f));
  const goMixed = BOUNDARY_FLAVORS.filter((f) => arrivedMixed('go-nethttp', f));
  const urllibAll = HEADER_FLAVORS.filter((f) => arrivedBoth('urllib', f)).length;
  const upgradeStripped = CLIENTS_CROSSHOST.filter((c) => !arrivedAuth(c.id, 'scheme-upgrade')).map((c) => c.name);
  const portStripped = CLIENTS_CROSSHOST.filter((c) => !arrivedAuth(c.id, 'port-change')).map((c) => c.name);
  const undiciStripped = BOUNDARY_FLAVORS.filter((f) => arrivedNeither('undici', f));
  const plaintextCarriers = CLIENTS_CROSSHOST.filter((c) => arrivedAuth(c.id, 'scheme-downgrade')).map((c) => c.name);
  const upgradeKept = CLIENTS_CROSSHOST.filter((c) => arrivedAuth(c.id, 'scheme-upgrade') && !arrivedAuth(c.id, 'to-subdomain')).map((c) => c.name);
  const portForwarded = CLIENTS_CROSSHOST.filter((c) => arrivedAuth(c.id, 'port-change')).map((c) => c.name);
  const restored = CLIENTS_CROSSHOST.filter((c) => arrivedNeither(c.id, 'to-subdomain') && arrivedBoth(c.id, 'boomerang')).map((c) => c.name);
  const jarOf = (id) => (get(id, 'jar') || {}).cookie_names_arrived || [];
  const withJar = CLIENTS_CROSSHOST.filter((c) => c.cookie_jar);
  const domainArrived = withJar.filter((c) => jarOf(c.id).includes('badhttp_domain')).map((c) => c.name);
  const hostOnlyArrived = withJar.filter((c) => jarOf(c.id).includes('badhttp_hostonly')).map((c) => c.name);
  const hostPrefixArrived = withJar.filter((c) => jarOf(c.id).includes('__Host-badhttp_lock')).map((c) => c.name);
  const relauthSameAsSub = CLIENTS_CROSSHOST.filter((c) => arrivedAuth(c.id, 'relative-authority') === arrivedAuth(c.id, 'to-subdomain')).length;
  const list = (a) => a.join(', ');
  return [
    `X-Api-Key arrived intact on ${keyArrived} of ${n} observations, including all ${authStripped} on which Authorization was stripped. No client measured here treated the API-key convention most services actually use as a credential header. The harnesses did not send Proxy-Authorization, so the oracle's proxy_authorization: false on every row is not an observation of stripping.`,
    `Go net/http forwarded Authorization and the hand-set Cookie across ${list(goForwarded)} and stripped both on ${list(goStripped)}.${goMixed.length ? ` On ${list(goMixed)} one arrived without the other; see the rows.` : ''}${same(goStripped, ['from-subdomain']) ? ' Its shouldCopyHeaderOnRedirect() forwards to the initial host or a subdomain of it by documented design; it compares URL.Hostname(), which is why the port change is invisible to it, and it does not examine the scheme.' : ''}`,
    `On scheme-downgrade (https to http, same host) ${list(plaintextCarriers)} carried Authorization onto a plaintext hop, and the landing response records transport_was_encrypted: false.${same(plaintextCarriers, ['Go net/http', 'Python urllib.request']) ? ' Nothing is malfunctioning: Go\'s comparison is a hostname comparison and a scheme change does not change the hostname; urllib makes no comparison at all.' : ''}`,
    `Python urllib (stdlib) forwarded Authorization and Cookie on ${urllibAll} of ${HEADER_FLAVORS.length} header flavors. Its HTTPRedirectHandler copies the caller-set headers with no host comparison of any kind. Credentials its own auth handlers generate go in a separate store that is not copied, so this affects headers the caller set, which is the common case for API clients.`,
    `${list(restored)} restored both headers on boomerang: absent at the subdomain, present again when the chain returned to the origin it started from.${same(restored, ['curl']) ? ' curl compares each hop against the ORIGINAL origin and regenerates the header rather than carrying a mutated map.' : ''} Every other client that stripped at the subdomain stayed stripped on the way back; a client that never stripped at the subdomain has nothing to restore.`,
    `${list(upgradeKept)} kept Authorization on scheme-upgrade (http to https, same host, default ports) while stripping it at the subdomain; ${list(upgradeStripped)} stripped it here too.${same(upgradeKept, ['Python requests', 'Python httpx']) ? ' Both carry a carve-out their own source comments describe as backwards compatibility rather than a security judgement. Both also dropped the hand-set Cookie header on EVERY redirect, the same-origin control included, because they clear it before any origin comparison and re-derive from their jar.' : ''}`,
    `port-change: ${list(portForwarded)} forwarded to badhttp.dev:8443; ${list(portStripped)} treated the port change as a different origin. relative-authority: every client resolved the protocol-relative Location to alt.badhttp.dev and then applied exactly the policy it applied on to-subdomain (${relauthSameAsSub} of ${CLIENTS_CROSSHOST.length} agree with themselves), so no client here showed the resolution-versus-policy split that flavor exists to catch.`,
    `jar: of the three cookies the first hop sets before crossing to alt.badhttp.dev, badhttp_domain (Domain=badhttp.dev) arrived from ${list(domainArrived)}. badhttp_hostonly (no Domain attribute) arrived from ${list(hostOnlyArrived)}, and __Host-badhttp_lock from ${list(hostPrefixArrived)}.${same(hostOnlyArrived, ['Python urllib.request', 'Python requests', 'Python httpx']) && same(hostPrefixArrived, hostOnlyArrived) ? ' Those are the three clients built on Python\'s http.cookiejar, and none of curl, Go or aiohttp: the stdlib\'s DefaultCookiePolicy returns a cookie set without a Domain attribute to any host under it unless DomainStrictNonDomain is set (the default is DomainLiberal), and cookiejar.py contains no handling of the __Host- or __Secure- prefixes at all; aiohttp\'s own jar tracks host-only cookies.' : ''} Node fetch and urllib3 have no jar, and nothing arrived.`,
    `Node fetch (undici) stripped Authorization and the Cookie header on ${undiciStripped.length} of ${BOUNDARY_FLAVORS.length} boundary flavors${arrivedBoth('undici', 'same-origin') ? ' and kept both on the same-origin control' : ''}${undiciStripped.length === BOUNDARY_FLAVORS.length ? ' — subdomain, port and scheme changes alike, boomerang not restored. That is the Fetch standard\'s rule, under which an origin is scheme, host and port, applied outside a browser.' : '; see the rows for which.'}`,
  ];
}

export function crosshostWitness() {
  return {
    measured: WITNESS_CROSSHOST.probed,
    observations: OBSERVATIONS_CROSSHOST.length,
    // The canonical host, never the request origin: this index is also served on the alt host, which
    // serves the fixtures and nothing else.
    data: `https://${CANONICAL}/clients.jsonl`,
    data_note:
      'Every observation is a row of /clients.jsonl with family "crosshost", joined to /corpus.jsonl ' +
      'by corpus_id; /clients indexes them with the outcome legend and the per-flavor disagreement. ' +
      'The findings below are a reading of those rows, not a second source.',
    what_this_is:
      'Eight real HTTP clients run against these exact URLs on this exact date. It is a DATED ' +
      'CAPTURE, not a live measurement, and it describes WHAT THE CALLER RECEIVED — it is never a ' +
      'verdict on a client. Several of the behaviours below are deliberate, documented choices by ' +
      'their authors, and RFC 9110 §15.4 says nothing about credentials on redirects at all, so ' +
      'there is no conformance being measured here. Re-run it and move the date rather than ' +
      'letting it stale.',
    clients: CLIENTS_CROSSHOST.map((c) => `${c.name} ${c.version}`),
    findings: crosshostFindings(),
    what_the_oracle_cannot_tell_you:
      'The landing response alone cannot distinguish "I followed a redirect and my client forwarded ' +
      'this" from "I typed the landing URL directly with a credential on it". A reading is only ' +
      'evidence if the harness recorded which starting URL it used and that it followed a redirect, ' +
      'which is why every row carries its start url, the url it finally landed on, whether a redirect ' +
      'was followed and, where the client exposes a count, hops_followed (Node fetch exposes only a ' +
      'boolean, so its rows carry null there), and why the reproduce line below starts from the ' +
      'flavor urls and not from /crosshost/land. Any table built from oracle bodies alone is unverifiable.',
    reproduce:
      'Send Authorization, Cookie and X-Api-Key with the published test values at each flavor url ' +
      'and read /crosshost/land. Pace the requests: each flavor is 2 or 3 requests against a zone ' +
      'limit of 100 per 10 s, and a response missing x-badhttp-version is the edge, not this ' +
      'server. Treat that as no observation and retry. The harnesses that produced the rows are in ' +
      'scripts/crosshost-witness/ in the source.',
  };
}

export function crosshostIndex({ url, json }) {
  return json({
    family: 'crosshost',
    about:
      'What your HTTP client does with credentials when a redirect crosses a host boundary. Each ' +
      'flavor is a starting URL that redirects across a specific boundary (or, for the same-origin ' +
      'control, across none) and lands on an oracle ' +
      'that reports which credential headers arrived.',
    hosts: {
      canonical: `https://${CANONICAL}`,
      alt: `https://${ALT}`,
      relationship: `${ALT} is one label deeper than ${CANONICAL}: a different host, the same registrable domain, the same Worker and the same zone certificate.`,
      why_two:
        'A client decides whether to keep forwarding Authorization, Proxy-Authorization and Cookie ' +
        'by comparing the redirect target against where it started. The comparisons differ between ' +
        'clients and are only observable across real, separately-named hosts. You cannot see this ' +
        'from a listener on 127.0.0.1: an agent framework’s SSRF filter rejects a loopback ' +
        'target at hop zero, so the code under test never runs.',
      what_alt_serves:
        `${ALT} serves this family’s endpoints and nothing else. It carries X-Robots-Tag: noindex ` +
        'and a robots.txt that disallows everything: it is a fixture, not a second copy of the site.',
    },
    no_open_redirect:
      'Redirect targets come from a frozen table of the two hosts above, selected by flavor name. No ' +
      'endpoint in this family accepts a redirect target, or any part of one, from the caller: there ' +
      'is no ?url=, ?next= or ?to=, and every Location is checked against a fixed pattern before it ' +
      'is sent. There is no open redirect here, by construction.',
    oracle: {
      url: `https://${CANONICAL}/crosshost/land`,
      also: `https://${ALT}/crosshost/land`,
      reports: ['authorization', 'proxy_authorization', 'cookie', 'x_api_key'],
      x_api_key_note:
        'x-api-key is reported because no client measured here stripped it at any boundary: it arrived ' +
        'on every witness row, including every row on which Authorization and Cookie were stripped. ' +
        'The credential headers these clients treat as sensitive are the standard ones; the API-key ' +
        'convention most services actually use is not among them. That is worth knowing before you rely on it.',
      no_echo: NO_ECHO,
    },
    test_credentials: {
      basic: TEST_BASIC,
      bearer: TEST_BEARER,
      'x-api-key': TEST_APIKEY,
      warning:
        'These are public and fake, exactly as in /auth. Send these and nothing else. If a credential ' +
        'that is not one of these reaches the landing endpoint, the response says so and tells you to ' +
        'rotate it.',
    },
    edge_note: EDGE_NOTE,
    reading_this: READING_THIS,
    witness: crosshostWitness(),
    prior_art_and_advisories: {
      note:
        'These flavors characterize behaviour; they are not exploits, and badhttp is a neutral place ' +
        'to see what your client does rather than an attacker-controlled host. The advisories below ' +
        'are the reason the boundaries are worth measuring. Each was read from the issuing project’s ' +
        'own advisory page.',
      redirect_credential_leaks: [
        'CVE-2018-1000007 — curl 6.0 to 7.57.0: a custom Authorization header forwarded to any redirect target.',
        'CVE-2022-27776 — curl 4.9 to 7.82.0: Authorization and Cookie leaked on a redirect to the SAME hostname with a different port or scheme; the same-host check compared only the hostname, for 22 years.',
        'CVE-2022-27774 — curl 4.9 to 7.82.0: credentials leaked on a cross-protocol or different-port redirect.',
        'CVE-2024-11053 — curl 7.76.0 to 8.11.0: a .netrc entry for the redirect TARGET unlocked the FIRST host’s password.',
        'CVE-2026-3783 — curl 7.33.0 to 8.18.0: an OAuth2 bearer token forwarded to a different hostname via .netrc.',
        'CVE-2018-20060 — urllib3 below 1.23: Authorization not removed on a cross-origin redirect. urllib3 defines cross-origin as a difference in host, port OR scheme.',
        'CVE-2023-32681 — requests: Proxy-Authorization leaked to a destination server across an https redirect.',
        'CVE-2022-0235 — node-fetch, and CVE-2022-0155 — follow-redirects: before these fixes both forwarded credentials to ANY redirect target; the fixes added the same one-way subdomain carve-out Go documents.',
      ],
      not_reproducible_here:
        'curl CVE-2026-11856 and CVE-2026-7168 are cross-origin Digest and proxy-Digest state leaks, ' +
        'and they are NOT redirect bugs: they need one libcurl easy handle reused for a second ' +
        'transfer to a different origin, and curl’s advisory states the command line tool is ' +
        'unaffected. No redirect fixture can reproduce them, and this one does not claim to.',
    },
    specs: {
      'RFC 9110 §15.4': 'Redirection. Says nothing about credentials on redirect: the behaviour this family measures is convention and per-client policy, not conformance.',
      'RFC 6265 §5.1.3': 'Cookie domain-matching, which the jar flavor exercises.',
      'Fetch standard, HTTP-redirect fetch': 'Strips Authorization on a cross-origin redirect. Governs browsers; the clients measured here are not bound by it.',
    },
    flavors: Object.fromEntries(
      Object.entries(CROSSHOST).map(([k, v]) => [
        k,
        { url: crosshostStartUrl(k), starts_on: v.start === 'alt' ? ALT : CANONICAL, scheme: v.scheme, redirect_hops: v.hops, about: v.about, ...(v.related ? { related: v.related } : {}) },
      ]),
    ),
  });
}

export const CROSSHOST_HOSTS = Object.freeze({ CANONICAL, ALT });

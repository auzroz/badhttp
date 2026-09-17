// /etag — conditional requests that misbehave on purpose (RFC 9110 §13, RFC 9111).
// A small fixed document whose validators (ETag and Last-Modified) lie in a chosen way.
// Cache-Control is no-cache, not no-store: a spec-following cache stores the body and revalidates on
// every use — which is the game being tested. Stateless; helpers come in from index.js.

import { LAST_MODIFIED, LM_EPOCH, checkPreconditions, conditionalHeaders, parseHttpDate, generation } from './conditional.js';

const LM_ISO = '2026-08-01T00:00:00Z'; // the same moment as LAST_MODIFIED, in the wrong format for HTTP
const GOOD = '"e-badhttp-1"';
const OTHER = '"e-badhttp-2"';

const body = (flavor, line) => `This is /etag/${flavor} on badhttp: a fixed document for testing conditional requests.\n${line}\nThe body never changes; whether you receive it again is the game.\nSend If-None-Match / If-Modified-Since / If-Match and watch what comes back.\n`;

export const ETAG = {
  'ok': {
    about: 'The control, fully correct: strong ETag, Last-Modified, cache-control: no-cache. If-Match (strong compare; * passes), If-Unmodified-Since, If-None-Match (weak compare, lists and * supported; match is 304), If-Modified-Since (ignored when If-None-Match is present, and ignored unless it is a valid HTTP-date). The 304 carries the ETag.',
  },
  'weak': {
    about: 'The only validator is weak: W/"…". If-None-Match uses weak comparison, so revalidation works (304). If-Match requires strong comparison and a weak validator never strong-matches, so every If-Match gets 412 — except If-Match: *, which passes. Catches clients that treat W/ as part of the value.',
  },
  'changing': {
    about: 'A different strong ETag on every response, and no Last-Modified (a changing resource with a frozen date would be a second lie). If-None-Match never matches, so a cache revalidates forever and re-downloads every time: thrash. Nondeterministic by design.',
  },
  'ignore': {
    about: 'Sends a perfectly good ETag and Last-Modified, then ignores every conditional header: always 200, full body. (Violates a MUST. That is the point.) Your cache keeps asking; it keeps not listening.',
  },
  'always-304': {
    about: 'Every GET is answered 304 — even the first, with no conditional headers at all. A cold cache is told "you already have it" about a body it has never seen. Broken proxies really do this.',
  },
  'mismatch': {
    about: 'Revalidation "succeeds" — If-None-Match matches, 304 — but the 304 carries a different ETag than the one you sent. A cache that adopts it misses on its next revalidation (200, real validator restored) and then matches again: a permanent 304/200/304 thrash.',
  },
  'no-validator-304': {
    about: 'If-None-Match matches and the 304 comes back bare: no ETag, no Last-Modified. A violation — RFC 9110 §15.4.5 says the 304 MUST carry the ETag its 200 would have — and hostile to caches that need the validator to know which stored response was confirmed.',
  },
  'unquoted': {
    about: 'The ETag header is a bare token with no quotes (spec-invalid, common in the wild). The server matches If-None-Match sloppily — quoted, bare, weak-prefixed, anything goes — and If-Modified-Since works normally. What does your client send back, and does its parser cope?',
  },
  'bad-date': {
    about: 'No ETag; Last-Modified is ISO 8601, not an HTTP-date (invalid). Revalidation is by exact string comparison of If-Modified-Since against that value — what a naive server does. Only a client that echoes the header back verbatim ever gets its 304; one that parses and reformats, or discards the unparseable date, refetches forever.',
  },
  'future': {
    about: 'No ETag; Last-Modified is one year from today (a valid HTTP-date that is always in the future, moving at midnight UTC). The date comparison itself is honest, so a client that echoes today\'s header back verbatim still gets 304 — until the date rolls — while one that sends its own clock always gets 200. Which is yours? Nondeterministic across days by design.',
  },
};

export function handleEtag({ seg, url, request, json, bad, withBase }) {
  const flavor = seg[1];
  if (seg.length > 2) return json({ error: 'not found', hint: '/etag/{flavor}; GET /etag lists the flavors' }, 404);
  if (!flavor) {
    return json({
      flavors: Object.fromEntries(Object.entries(ETAG).map(([k, v]) => [k, v.about])),
      usage: '/etag/{flavor}',
      caching: 'Conditional requests over both validators, ETag and Last-Modified. Responses are cache-control: no-cache, no-transform (store, but revalidate every use), so a real cache can be pointed at these. Range and If-Range live at /range.',
    });
  }
  const f = Object.hasOwn(ETAG, flavor) ? ETAG[flavor] : undefined;
  if (!f) return json({ error: 'unknown flavor', flavors: Object.keys(ETAG) }, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed', hint: 'GET /etag/{flavor}, HEAD for the headers' }, 405, { allow: 'GET, HEAD, OPTIONS' });
  }

  const cond = conditionalHeaders(request);

  // lastModified: omit the key for the fixed date; pass null to send no Last-Modified at all.
  // A 304 carries the ETag (RFC 9110 §15.4.5 MUST) but not Last-Modified when an ETag exists
  // (§15.4.5 SHOULD NOT send other representation metadata); date-only flavors keep their LM on 304.
  const respond = ({ status = 200, etag, lastModified = LAST_MODIFIED, text, headers = {} }) => {
    const h = withBase({
      'cache-control': 'no-cache, no-transform',
      'x-badhttp-flavor': flavor,
      ...(etag !== undefined && etag !== null ? { etag } : {}),
      ...(lastModified !== null ? { 'last-modified': lastModified } : {}),
      ...headers,
    });
    if (status === 412) return json({ error: 'precondition failed', hint: 'If-Match or If-Unmodified-Since did not match the current validator' }, 412, { 'cache-control': 'no-cache, no-transform', 'x-badhttp-flavor': flavor, ...(etag !== undefined && etag !== null ? { etag } : {}) });
    if (status === 304) return new Response(null, { status: 304, statusText: 'Not Modified', headers: h });
    h.set('content-type', 'text/plain; charset=utf-8');
    if (request.method === 'HEAD') {
      h.set('content-length', String(text.length)); // ASCII body
      return new Response(null, { status, headers: h });
    }
    return new Response(text, { status, headers: h });
  };

  // The correct conditional dance (RFC 9110 §13.2.2), parameterized by the current validators.
  const evaluate = ({ etag, lastModified = LAST_MODIFIED, lmEpoch = LM_EPOCH, text, on304 }) => {
    const verdict = checkPreconditions(cond, { etag, lmEpoch });
    if (verdict === 'precondition-failed') return respond({ status: 412, etag });
    if (verdict === 'not-modified') return on304();
    return respond({ etag, lastModified, text });
  };

  switch (flavor) {
    case 'ok': {
      const text = body(flavor, 'Its validators are honest and every conditional header is handled as RFC 9110 says.');
      return evaluate({ etag: GOOD, text, on304: () => respond({ status: 304, etag: GOOD, lastModified: null }) });
    }
    case 'weak': {
      const weak = `W/${GOOD}`;
      const text = body(flavor, 'Its only validator is weak (W/"…"): If-None-Match revalidates, If-Match always fails with 412 (except *).');
      return evaluate({ etag: weak, text, on304: () => respond({ status: 304, etag: weak, lastModified: null }) });
    }
    case 'changing': {
      const etag = `"e-${generation()}"`;
      const text = body(flavor, 'Its ETag is different on every response and it sends no Last-Modified, so revalidation never succeeds.');
      // lmEpoch must be null, not undefined: an explicit undefined would resurrect the LM_EPOCH default.
      return evaluate({ etag, lastModified: null, lmEpoch: null, text, on304: () => respond({ status: 304, etag, lastModified: null }) });
    }
    case 'ignore': {
      const text = body(flavor, 'It sends honest validators and then ignores every conditional header you send.');
      return respond({ etag: GOOD, text });
    }
    case 'always-304':
      return respond({ status: 304, etag: GOOD, lastModified: null });
    case 'mismatch': {
      const text = body(flavor, 'Revalidation matches, but the 304 carries a different ETag than the one you sent.');
      return evaluate({ etag: GOOD, text, on304: () => respond({ status: 304, etag: OTHER, lastModified: null }) });
    }
    case 'no-validator-304': {
      const text = body(flavor, 'Revalidation matches, and the 304 carries no validators at all (a violation: the ETag is a MUST).');
      return evaluate({ etag: GOOD, text, on304: () => respond({ status: 304, etag: null, lastModified: null }) });
    }
    case 'unquoted': {
      const bare = 'e-badhttp-1'; // no quotes: invalid on the wire, common in the wild
      const text = body(flavor, 'Its ETag has no quotes, which is invalid; If-None-Match is matched sloppily, quoted or bare.');
      if (cond.ifNoneMatch !== null) {
        // The sloppy matcher a sloppy server would have: split on commas, strip W/ and quotes, compare.
        const matched = cond.ifNoneMatch.split(',').map((s) => s.trim().replace(/^W\//i, '').replace(/"/g, '')).some((t) => t === '*' || t === bare);
        if (matched) return respond({ status: 304, etag: bare, lastModified: null });
        return respond({ etag: bare, text });
      }
      if (cond.ifModifiedSince !== null) {
        const t = parseHttpDate(cond.ifModifiedSince);
        if (t !== null && LM_EPOCH <= t) return respond({ status: 304, etag: bare, lastModified: null });
      }
      return respond({ etag: bare, text });
    }
    case 'bad-date': {
      const text = body(flavor, 'Its Last-Modified is ISO 8601 (not a valid HTTP-date) and revalidation is an exact string comparison.');
      if (cond.ifModifiedSince !== null && cond.ifModifiedSince.trim() === LM_ISO) return respond({ status: 304, etag: null, lastModified: LM_ISO });
      return respond({ etag: null, lastModified: LM_ISO, text });
    }
    case 'future': {
      // One year from today, midnight UTC: always a valid IMF-fixdate, always in the future.
      const now = new Date();
      const lmFuture = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())).toUTCString();
      const text = body(flavor, 'Its Last-Modified is one year from today, so only a client that echoes it back verbatim ever revalidates.');
      return evaluate({ etag: undefined, lastModified: lmFuture, lmEpoch: Date.parse(lmFuture), text, on304: () => respond({ status: 304, etag: null, lastModified: lmFuture }) });
    }
    default:
      return json({ error: 'unknown flavor', flavors: Object.keys(ETAG) }, 404);
  }
}

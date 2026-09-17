// /range — resumable downloads that misbehave on purpose (RFC 9110 §14).
// The document is deterministic and SELF-DESCRIBING: 64-byte lines, each starting with its own offset,
// so when a flavor serves the wrong bytes the corruption is visible in the file you assemble.
// Stateless, no outbound requests. Helpers (json, bad, intParam, withBase, …) come in from index.js.

import { LAST_MODIFIED, LM_EPOCH, checkPreconditions, conditionalHeaders, generation } from './conditional.js';

const LINE = 64;
const BOUNDARY = 'badhttp';

// Bytes [start, end] (inclusive) of the length-byte document. Line k covers [64k, 64k+63] and reads
// "{offset:08d} {length:08d} badhttp range body {gen}" padded with '.' to 63 chars, then "\n".
// Line 0 at length=1000 is exactly "00000000 00001000 badhttp range body g1" + 24 dots + "\n".
// The final line is cut at length (no trailing newline when length is not a multiple of 64).
// All ASCII, so string length == byte length everywhere in this file.
export function docSlice(length, start, end, gen = 'g1') {
  if (end >= length) end = length - 1;
  if (start > end) return '';
  const firstLine = Math.floor(start / LINE);
  const lastLine = Math.floor(end / LINE);
  let out = '';
  for (let k = firstLine; k <= lastLine; k++) {
    out += `${String(k * LINE).padStart(8, '0')} ${String(length).padStart(8, '0')} badhttp range body ${gen}`.padEnd(LINE - 1, '.') + '\n';
  }
  const base = firstLine * LINE;
  return out.slice(start - base, end - base + 1);
}

export function rangeEtag(length, gen = 'g1') {
  return `"r-${length}-${gen}"`;
}

// Parse a Range header against a length-byte document.
// Returns { kind: 'none' } (no header), { kind: 'ignore', why } (malformed, not bytes, too many parts,
// b < a, or total span over the cap: RFC 9110 lets a server ignore the header), { kind: 'unsat' }
// (every range unsatisfiable), or { kind: 'ranges', ranges: [[a, b, isSuffix], …] } (satisfiable,
// resolved and clamped, in request order).
export function parseRange(header, length, maxParts, maxBytes) {
  if (header === null) return { kind: 'none' };
  // Strict on the grammar: no whitespace around "=" (the ABNF allows none); OWS after commas is legal.
  const m = /^bytes=(.+)$/i.exec(header.trim());
  if (!m) return { kind: 'ignore', why: 'unit is not bytes, or malformed' };
  const parts = m[1].split(',').map((s) => s.trim());
  if (parts.length > maxParts) return { kind: 'ignore', why: `more than ${maxParts} ranges` };
  const ranges = [];
  let unsat = 0;
  for (const part of parts) {
    let pm;
    if ((pm = /^(\d+)-(\d*)$/.exec(part))) {
      const a = Number(pm[1]);
      if (!Number.isSafeInteger(a)) return { kind: 'ignore', why: 'first-byte-pos out of range' };
      let b = pm[2] === '' ? length - 1 : Number(pm[2]);
      if (!Number.isSafeInteger(b)) return { kind: 'ignore', why: 'last-byte-pos out of range' };
      // Semantically invalid (last-pos < first-pos, RFC 9110 §14.1.1) invalidates the whole header.
      if (pm[2] !== '' && b < a) return { kind: 'ignore', why: 'last-byte-pos before first-byte-pos' };
      if (a >= length) { unsat += 1; continue; }
      if (b >= length) b = length - 1;
      ranges.push([a, b, false]);
    } else if ((pm = /^-(\d+)$/.exec(part))) {
      const n = Number(pm[1]);
      if (!Number.isSafeInteger(n)) return { kind: 'ignore', why: 'suffix-length out of range' };
      if (n === 0) { unsat += 1; continue; }
      ranges.push([Math.max(0, length - n), length - 1, true]);
    } else {
      return { kind: 'ignore', why: 'malformed range spec' };
    }
  }
  if (!ranges.length) return unsat ? { kind: 'unsat' } : { kind: 'ignore', why: 'empty range set' };
  if (ranges.reduce((s, [a, b]) => s + (b - a + 1), 0) > maxBytes) {
    return { kind: 'ignore', why: 'total requested span exceeds the document cap' };
  }
  return { kind: 'ranges', ranges };
}

function multipartBody(length, ranges, gen) {
  let out = '';
  for (const [a, b] of ranges) {
    out += `--${BOUNDARY}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-range: bytes ${a}-${b}/${length}\r\n\r\n${docSlice(length, a, b, gen)}\r\n`;
  }
  return out + `--${BOUNDARY}--\r\n`;
}

// If-Range per RFC 9110 §13.1.5: a single validator; an entity-tag matches only by strong comparison
// (a weak validator never matches); a date matches only as an exact match for Last-Modified.
// It is only ever consulted when a Range header is present and honored.
function ifRangeCurrent(header, etag) {
  const v = header.trim();
  if (v.startsWith('W/')) return false;
  if (v.startsWith('"')) return v === etag;
  return v === LAST_MODIFIED;
}

export const RANGE = {
  'ok': {
    about: 'The control, fully correct: Accept-Ranges, strong ETag, Last-Modified; single, suffix, open-ended and multiple ranges (multipart/byteranges), 416 with "bytes */length" when unsatisfiable, If-Range honored (strong validators only), and the conditional headers evaluated as RFC 9110 says. HEAD ignores Range, as the spec requires. No Range gets a 200.',
  },
  'ignore': {
    about: 'No range support at all: no Accept-Ranges header, and every request gets a 200 with the full body. Legal — range support is optional — and the #1 real-world case: a resuming client must notice the 200 and start over, not append.',
  },
  'advertise-only': {
    about: 'Advertises Accept-Ranges: bytes on every response, then ignores every Range header and sends 200 with the full body. Aimed at segmented downloaders (aria2 and friends) that split into N connections because of the advertisement — and then receive N full bodies.',
  },
  'off-by-one': {
    about: 'Treats the range end as exclusive: bytes=a-b gets bytes a..b-1, one short, while Content-Range still claims a-b. Content-Length matches the short body, so the two headers disagree — the classic fencepost, one missing byte per segment. The lie is applied to the first range; extra ranges are ignored.',
  },
  'shifted': {
    about: 'Serves bytes a+1..b+1 while Content-Range claims a-b. The envelope looks right; every byte is wrong — detectable only because the body is self-describing (the offsets inside the file will not match where you put them). At the end of the document the shifted window is clamped, so the final segment also runs one byte short. First range only.',
  },
  'suffix-as-prefix': {
    about: 'The naive suffix-range bug: bytes=-n is served as the FIRST n bytes of the document while Content-Range claims the last n. A client resuming "the tail" appends the head — silent corruption on exactly the request curl sends for a suffix. The lie applies when the first range is a suffix; any other request is served correctly, multipart included.',
  },
  'from-zero': {
    about: 'Acknowledges your range with a 206 — then serves the whole document from byte zero, with an honest Content-Range: bytes 0-{length-1}/{length} that simply disagrees with what you asked. A client that appends without checking Content-Range against its request builds a file with a duplicated prefix.',
  },
  'wrong-total': {
    about: 'Correct bytes, but Content-Range lies about the total: bytes a-b/{2×length}. Asking for bytes past the real end gets 416 with the same inflated total, so a download loop that trusts it never finishes. First range only.',
  },
  'no-content-range': {
    about: 'A single-range 206 with the right bytes and no Content-Range header (a violation of RFC 9110 §15.3.7). What offset does your client think this is? First range only.',
  },
  'always-206': {
    about: 'A request with no Range header still gets a 206 (Content-Range: bytes 0-{length-1}/{length}, full body). With a valid Range it behaves correctly; an ignored Range (malformed, or over the caps) is treated as absent, so it also gets the full-body 206. Some CDNs and proxies really do this.',
  },
  '200-content-range': {
    about: 'Honors the range — right bytes, right Content-Range header — but the status is 200. A contradiction: which does your client believe, the status or the header? First range only.',
  },
  'always-416': {
    about: 'Every Range request gets 416 with Content-Range: bytes */{length}; without Range, a 200. Tests give-up-and-restart logic.',
  },
  'unknown-total': {
    about: 'Correct 206, but Content-Range says bytes a-b/* — total unknown, which is legal. Preallocation and progress logic that requires the total breaks. First range only.',
  },
  'if-range-ignored': {
    about: 'The resource changes on every request (a generation stamp appears in the ETag and in every line of the body) and If-Range is ignored: a stale validator still gets a 206 from the new generation, where a correct server would send the full 200. Resume across it and your file mixes generations — run grep -oE "g[0-9a-f]{16}" file | sort -u on it: more than one value is the corruption. Nondeterministic by design.',
  },
};

export function handleRange({ seg, url, request, json, bad, intParam, withBase, limits }) {
  const flavor = seg[1];
  if (seg.length > 2) return json({ error: 'not found', hint: '/range/{flavor}; GET /range lists the flavors' }, 404);
  if (!flavor) {
    return json({
      flavors: Object.fromEntries(Object.entries(RANGE).map(([k, v]) => [k, v.about])),
      usage: '/range/{flavor}?length=1000',
      document: `Deterministic and self-describing: ${LINE}-byte lines, each "{offset:08d} {length:08d} badhttp range body {gen}" padded with dots to 63 characters plus a newline; line 0 at length=1000 is "00000000 00001000 badhttp range body g1" + 24 dots. The final line is cut at ?length= (default 1000, max ${limits.rangeMaxBytes}), so the document may end mid-line. The generation is g1 everywhere except if-range-ignored.`,
      limits: { max_bytes: limits.rangeMaxBytes, max_ranges_per_request: limits.rangeMaxParts, note: 'more ranges than the cap, a total span over max_bytes, or any invalid range spec makes the whole Range header ignored — treated as if no Range was sent (a 200 with the full body at every flavor except always-206, which then sends its full-body 206, and always-416, which answers any Range header, even an ignorable one, with its 416)' },
      conditionals: 'ok evaluates If-Match / If-Unmodified-Since / If-None-Match / If-Modified-Since correctly and honors If-Range; the misbehaving flavors ignore conditionals entirely (their subject is ranges — /etag is the conditional-request family). HEAD ignores Range on every flavor, as RFC 9110 §14.2 requires.',
      multipart: 'Several satisfiable ranges come back as multipart/byteranges (boundary "badhttp"), served in request order without coalescing; when only one of several survives clamping it is served as a plain single-range 206. Responses are cache-control: no-store, no-transform — this family tests clients, not caches; point caches at /etag.',
    });
  }
  const f = Object.hasOwn(RANGE, flavor) ? RANGE[flavor] : undefined;
  if (!f) return json({ error: 'unknown flavor', flavors: Object.keys(RANGE) }, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed', hint: 'GET /range/{flavor}, HEAD for the headers' }, 405, { allow: 'GET, HEAD, OPTIONS' });
  }
  const len = intParam(url.searchParams.get('length') ?? '1000', { min: 1, max: limits.rangeMaxBytes, name: 'length' });
  if (len.error) return bad(len.error, `?length=1000 (max ${limits.rangeMaxBytes})`);
  const length = len.value;

  const gen = flavor === 'if-range-ignored' ? `g${generation()}` : 'g1';
  const etag = rangeEtag(length, gen);
  // RFC 9110 §14.2: range handling is defined for GET only; HEAD MUST ignore Range (and with it If-Range).
  const parsed = request.method === 'HEAD' ? { kind: 'none' } : parseRange(request.headers.get('range'), length, limits.rangeMaxParts, limits.rangeMaxBytes);

  const base = {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, no-transform', // no-transform: without it the edge compresses text/plain, replacing Content-Length
    'x-badhttp-flavor': flavor,
    etag,
    'last-modified': LAST_MODIFIED,
  };
  // declaredLen: for HEAD, the Content-Length to state without building the body.
  const reply = (status, headers, body, declaredLen) => {
    const h = withBase({ ...base, ...headers });
    if (request.method === 'HEAD') {
      h.set('content-length', String(declaredLen ?? body.length)); // ASCII body: length == bytes
      return new Response(null, { status, statusText: status === 206 ? 'Partial Content' : status === 416 ? 'Range Not Satisfiable' : 'OK', headers: h });
    }
    return new Response(body, { status, statusText: status === 206 ? 'Partial Content' : status === 416 ? 'Range Not Satisfiable' : 'OK', headers: h });
  };
  const full = (headers = {}) => reply(200, headers, request.method === 'HEAD' ? '' : docSlice(length, 0, length - 1, gen), length);
  const sat416 = (total = length) => reply(416, { 'content-range': `bytes */${total}` }, '');

  // Serve resolved ranges correctly: one → 206 + Content-Range; several → multipart/byteranges with
  // no top-level Content-Range (RFC 9110 §15.3.7.2).
  const serveCorrect = (ranges, ar = {}) => {
    if (ranges.length === 1) {
      const [a, b] = ranges[0];
      return reply(206, { ...ar, 'content-range': `bytes ${a}-${b}/${length}` }, docSlice(length, a, b, gen));
    }
    return reply(206, { ...ar, 'content-type': `multipart/byteranges; boundary=${BOUNDARY}` }, multipartBody(length, ranges, gen));
  };
  const AR = { 'accept-ranges': 'bytes' };

  switch (flavor) {
    case 'ok': {
      // Preconditions first (RFC 9110 §13.2.2), then If-Range, then Range.
      const cond = checkPreconditions(conditionalHeaders(request), { etag, lmEpoch: LM_EPOCH });
      if (cond === 'precondition-failed') return json({ error: 'precondition failed', hint: 'If-Match or If-Unmodified-Since did not match the current validator' }, 412, { 'cache-control': 'no-store, no-transform', 'x-badhttp-flavor': flavor, etag });
      if (cond === 'not-modified') return new Response(null, { status: 304, statusText: 'Not Modified', headers: withBase({ 'cache-control': 'no-store, no-transform', 'x-badhttp-flavor': flavor, etag, ...AR }) });
      // A stale If-Range means the whole Range header is ignored (§13.1.5 MUST) — even an unsatisfiable one.
      const ifRange = request.headers.get('if-range');
      if (parsed.kind !== 'none' && ifRange !== null && !ifRangeCurrent(ifRange, etag)) return full(AR);
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      return serveCorrect(parsed.ranges, AR);
    }
    case 'ignore':
      return full();
    case 'advertise-only':
      return full(AR);
    case 'off-by-one': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(206, { ...AR, 'content-range': `bytes ${a}-${b}/${length}` }, docSlice(length, a, b - 1, gen));
    }
    case 'shifted': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(206, { ...AR, 'content-range': `bytes ${a}-${b}/${length}` }, docSlice(length, a + 1, b + 1, gen));
    }
    case 'suffix-as-prefix': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b, isSuffix] = parsed.ranges[0];
      if (!isSuffix) return serveCorrect(parsed.ranges, AR); // requests not led by a suffix are served correctly, multipart included
      const n = b - a + 1; // the suffix length: serve the FIRST n bytes, claim the last n
      return reply(206, { ...AR, 'content-range': `bytes ${a}-${b}/${length}` }, docSlice(length, 0, n - 1, gen));
    }
    case 'from-zero': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      return reply(206, { ...AR, 'content-range': `bytes 0-${length - 1}/${length}` }, docSlice(length, 0, length - 1, gen));
    }
    case 'wrong-total': {
      if (parsed.kind === 'unsat') return sat416(length * 2); // the 416 lies consistently
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(206, { ...AR, 'content-range': `bytes ${a}-${b}/${length * 2}` }, docSlice(length, a, b, gen));
    }
    case 'no-content-range': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(206, AR, docSlice(length, a, b, gen));
    }
    case 'always-206': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return reply(206, { ...AR, 'content-range': `bytes 0-${length - 1}/${length}` }, request.method === 'HEAD' ? '' : docSlice(length, 0, length - 1, gen), length);
      return serveCorrect(parsed.ranges, AR);
    }
    case '200-content-range': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(200, { ...AR, 'content-range': `bytes ${a}-${b}/${length}` }, docSlice(length, a, b, gen));
    }
    case 'always-416': {
      if (parsed.kind === 'none') return full(AR);
      return sat416();
    }
    case 'unknown-total': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      const [a, b] = parsed.ranges[0];
      return reply(206, { ...AR, 'content-range': `bytes ${a}-${b}/*` }, docSlice(length, a, b, gen));
    }
    case 'if-range-ignored': {
      if (parsed.kind === 'unsat') return sat416();
      if (parsed.kind !== 'ranges') return full(AR);
      // If-Range is deliberately not consulted: a stale validator still gets the range, from the new generation.
      return serveCorrect(parsed.ranges, AR);
    }
    default:
      return json({ error: 'unknown flavor', flavors: Object.keys(RANGE) }, 404);
  }
}

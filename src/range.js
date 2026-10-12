// /range — resumable downloads that misbehave on purpose (RFC 9110 §14).
// The document is deterministic and SELF-DESCRIBING: 64-byte lines, each starting with its own offset,
// so when a flavor serves the wrong bytes the corruption is visible in the file you assemble.
// Stateless, no outbound requests. Helpers (json, bad, intParam, withBase, …) come in from index.js.

import { LAST_MODIFIED, LM_EPOCH, checkPreconditions, conditionalHeaders, generation } from './conditional.js';
import { WITNESS_RANGE, CLIENTS_RANGE, REFERENCE_RANGE, OBSERVATIONS_RANGE } from './witness-range-data.js';

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
      witness: rangeWitness(),
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

// ---------- the witness: what real resuming download clients did with these responses (session 31, 2026-10-12) ----------
// Everything below is computed from the /clients.jsonl range rows (src/witness-range-data.js, generated from the committed
// capture by scripts/witness-parse-range.mjs). Each cell is one resume: a fresh working directory holding the first 400 bytes
// of the 1,000-byte document, the client told to resume it from GET /range/{flavor}; plus one `fresh` cell at always-206. The
// reference for each flavor is where RFC 9110 places the bytes the raw-wire control received, derived from the wire, never typed.
// Sentences describe the file and the exit, never a verdict. Explanations of WHY a named client behaved as it did are gated on
// the computed list being the one they were written for (the gated block in rangeFindings; each sentence cites the client's source as the
// survey of 2026-10-12 read it: docs/survey-range-clients-2026-10-12.md).
const rObs = (client, flavor, scenario = 'resume') => OBSERVATIONS_RANGE.find((o) => o.client.id === client && o.flavor === flavor && o.scenario === scenario);
const rClients = () => CLIENTS_RANGE.filter((c) => c.role === 'client');
const rRows = () => OBSERVATIONS_RANGE.filter((o) => o.client.role === 'client');
const rName = (id) => (CLIENTS_RANGE.find((c) => c.id === id) || { name: id }).name;
const rList = (a) => (a.length ? a.join(', ') : 'none');
const rPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const rFlavors = () => [...new Set(rRows().map((o) => o.flavor))];
// A cell's answer as words: the outcome with the shape or transfer that distinguishes it. Descriptions of the file and the exit only.
const rAnswer = (o) => {
  switch (o.outcome) {
    case 'complete': return o.transfer === 'resumed' ? 'finished the file by keeping the partial' : o.transfer === 'restarted' ? 'finished the file by starting over after one response' : o.transfer === 'restarted-after-range' ? 'finished the file by starting over after a Range request' : o.transfer === 'fresh' ? 'wrote the whole document' : 'wrote the whole document';
    case 'refused': return 'stopped with an error and left the partial untouched';
    case 'unchanged': return 'reported no error and left the partial untouched';
    case 'corrupt': return o.shape === 'body-only' ? `discarded the partial and kept the response body alone as the file (${o.file ? o.file.bytes : 0} bytes)` : `wrote a file that is not the document (shape ${o.shape})`;
    case 'incomplete-reported': return 'stopped with an error after a prefix of the document';
    case 'harness-timeout': return 'was still going when the 30 s cap fired';
    case 'request-failed': return 'made no observation';
    default: return String(o.outcome);
  }
};
const rGroups = (flavor, scenario = 'resume') => {
  const m = new Map();
  for (const c of rClients()) {
    const o = rObs(c.id, flavor, scenario);
    if (!o) continue;
    const k = rAnswer(o);
    m.set(k, (m.get(k) || []).concat(c.name));
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${v.length === rClients().length ? `all ${v.length} clients` : rList(v)} ${k}`).join('; ');
};
const rControl = (flavor, scenario = 'resume-raw') => OBSERVATIONS_RANGE.find((o) => o.client.role === 'control' && o.flavor === flavor && o.scenario === scenario);
const rControlSays = (flavor, scenario) => {
  const c = rControl(flavor, scenario);
  const e = c && c.exchanges && c.exchanges[0];
  if (!e) return 'no control exchange';
  return `${e.status} with ${e.content_range ? `Content-Range ${e.content_range}` : 'no Content-Range'} and ${e.body_bytes} body bytes`;
};
const rFirstKind = (e) => (e.method === 'HEAD' ? 'a HEAD' : e.range ? 'a Range GET' : 'a GET with no Range');

export function rangeFindings() {
  const rows = rRows();
  if (!rows.length) return [];
  const N = rClients().length;
  const partial = WITNESS_RANGE.partial_bytes;
  const doc = WITNESS_RANGE.document_bytes;
  const out = [];
  const byOutcome = {};
  for (const o of rows) byOutcome[o.outcome] = (byOutcome[o.outcome] || 0) + 1;
  const tally = Object.entries(byOutcome).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ');
  const corrupt = rows.filter((o) => o.outcome === 'corrupt');
  const corruptAsRef = corrupt.filter((o) => o.outcome_vs_reference === 'as-reference').length;
  const corruptDiffers = corrupt.filter((o) => o.outcome_vs_reference === 'differs').length;
  out.push(
    `${rPlural(N, 'resuming download client')} (${rList(rClients().map((c) => c.name))}) were each given a ${partial}-byte partial of the ${doc.toLocaleString('en-US')}-byte document and told to resume it from /range/{flavor} — ${rFlavors().length} flavors, plus one fresh download at always-206 — ${rPlural(rows.length, 'row')} in all. By the file and the exit: ${tally}. ` +
    `${corrupt.length ? `Of the ${rPlural(corrupt.length, 'corrupt row')}, ${corruptAsRef} wrote what the reference placement (where RFC 9110 puts the bytes the control received) itself yields and ${corruptDiffers} differ from it` : 'No row wrote a corrupt file'}.`
  );
  for (const flavor of rFlavors()) {
    const ref = REFERENCE_RANGE[flavor];
    const resume = rClients().some((c) => rObs(c.id, flavor, 'resume'));
    if (resume) {
      out.push(`${flavor} (the control got ${rControlSays(flavor, 'resume-raw')}${ref ? `; reference placement: ${ref.yields_document == null ? `none (${ref.reason || 'no placement'})` : `${ref.placement}, which ${ref.yields_document ? 'yields' : 'does not yield'} the document`}` : ''}): ${rGroups(flavor, 'resume')}.`);
    }
    if (rClients().some((c) => rObs(c.id, flavor, 'fresh'))) {
      out.push(`${flavor}, fresh (no partial, so no Range is sent; the control got ${rControlSays(flavor, 'fresh-raw')}): ${rGroups(flavor, 'fresh')}.`);
    }
  }
  // (the gated explanations are below the validators sentence, where the exchange list `ex` they read exists)
  // How each client opened. Counted from the exchanges: the first request of each resume row.
  const kinds = new Map();
  for (const c of rClients()) {
    const set = new Set();
    for (const o of rows) if (o.client.id === c.id && o.scenario === 'resume' && o.exchanges && o.exchanges[0]) set.add(rFirstKind(o.exchanges[0]));
    const k = set.size === 0 ? 'made no request' : set.size === 1 ? `opened with ${[...set][0]}` : `opened with ${[...set].sort().join(' or ')} depending on the row`;
    kinds.set(k, (kinds.get(k) || []).concat(c.name));
  }
  const notRange = rClients().filter((c) => rows.some((o) => o.client.id === c.id && o.scenario === 'resume' && o.exchanges && o.exchanges[0] && !(o.exchanges[0].method === 'GET' && o.exchanges[0].range))).map((c) => c.name);
  out.push(`First request on a resume row: ${[...kinds.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${v.length === N ? `all ${N} clients` : rList(v)} ${k}`).join('; ')}. ${notRange.length} of ${N} clients opened at least one resume row with a HEAD or a GET carrying no Range rather than a Range GET${notRange.length ? ` (${rList(notRange)})` : ''}. The harness never sends a Range header itself, so each client chose what to ask for from the size of the partial file.`);
  // Validators.
  const ex = rows.flatMap((o) => (o.exchanges || []).map((e) => ({ e, name: o.client.name })));
  const withH = (h) => ex.filter((x) => x.e[h] != null);
  const names = (h) => [...new Set(withH(h).map((x) => x.name))];
  const hs = [['if_range', 'If-Range'], ['if_match', 'If-Match'], ['if_none_match', 'If-None-Match'], ['if_modified_since', 'If-Modified-Since']];
  const sent = hs.filter(([h]) => withH(h).length);
  out.push(
    sent.length
      ? `Validators: of ${ex.length.toLocaleString('en-US')} requests the clients sent, ${sent.map(([h, label]) => `${withH(h).length} carried ${label} (${rList(names(h))})`).join('; ')}; the rest carried none of If-Range, If-Match, If-None-Match or If-Modified-Since.`
      : `Validators: none of the ${ex.length.toLocaleString('en-US')} requests the clients sent carried If-Range, If-Match, If-None-Match or If-Modified-Since, so no row here puts a stale validator to a server.`
  );
  // ---- gated explanations: WHY a named client did what it did, from its source (survey of 2026-10-12, docs/spec-range-witness.md).
  // Each sentence renders only while the computed list is the one it was written for, so a re-capture that moves a list drops
  // the explanation rather than misattributing it (the #23 rule). Names are client ids; the text uses display names.
  const ids = (flavor, pred, scenario = 'resume') => rClients().filter((c) => { const o = rObs(c.id, flavor, scenario); return o && pred(o); }).map((c) => c.id).sort().join('|');
  const is = (list, ...want) => list === want.slice().sort().join('|');
  const complete = (o) => o.outcome === 'complete';
  const refused = (o) => o.outcome === 'refused';
  const unchanged = (o) => o.outcome === 'unchanged';
  const shape = (s) => (o) => o.outcome === 'corrupt' && o.shape === s;
  const gated = [];
  if (is(ids('ignore', refused), 'curl') && is(ids('advertise-only', refused), 'curl') && is(ids('from-zero', refused).split('|').filter((x) => x === 'curl').join('|'), 'curl') && complete(rObs('curl', '200-content-range'))) {
    gated.push('curl is the one client that stopped on ignore and advertise-only: lib/http.c accepts the answer to a resume only when its Content-Range begins at the offset curl asked for, and anything else is CURLE_RANGE_ERROR, exit 33, "HTTP server doesn\'t seem to support byte ranges. Cannot resume." The same rule is why curl completed 200-content-range: the status is 200, but the Content-Range starts at 400, and curl reads the header, not the status.');
  }
  if (is(ids('always-416', unchanged), 'curl', 'wget', 'wget2')) {
    gated.push('A 416 whose Content-Range says */1000 against a 400-byte file read as completion to curl, GNU Wget and GNU Wget2: curl\'s http.c treats a 416 to a resume as "no error" and discards the body (exit 0); wget and wget2 print "The file is already fully retrieved; nothing to do." and exit 0. The 400-byte partial stays, and nothing tells the caller the file is 600 bytes short.');
  }
  if (is(ids('advertise-only', shape('duplicated-prefix')).split('|').filter((x) => x === 'grab' || x === 'go-getter').join('|'), 'go-getter', 'grab') && is(ids('always-206', (o) => complete(o) && o.transfer !== 'resumed'), 'go-getter', 'grab') && complete(rObs('grab', 'ignore')) && complete(rObs('go-getter', 'ignore'))) {
    gated.push('grab and go-getter decide whether to resume from the HEAD they send first: only a 200 HEAD carrying Accept-Ranges: bytes makes them send a Range, and neither reads the Content-Range of the answer (grab\'s client.go carries a "// TODO: check Content-Range"). So on ignore, whose HEAD advertises nothing, they sent no Range and rewrote the file; on advertise-only, whose HEAD advertises ranges and whose answer to the Range is a 200, they appended the whole body after the partial; and on always-206, whose HEAD is itself a 206, they sent no Range and took the full body.');
  }
  const nuggetIgnoreNoRange = (rObs('nugget', 'ignore') || { exchanges: [] }).exchanges.every((e) => e.range == null);
  const wget2SentRange = ['ignore', 'advertise-only'].every((f) => (rObs('wget2', f) || { exchanges: [] }).exchanges.some((e) => e.range != null));
  if (is(ids('ignore', shape('duplicated-prefix')), 'nugget', 'wget2') && ids('advertise-only', shape('duplicated-prefix')).split('|').includes('nugget') && ids('advertise-only', shape('duplicated-prefix')).split('|').includes('wget2') && nuggetIgnoreNoRange && wget2SentRange) {
    gated.push('GNU Wget2 appends whatever comes back once it has sent a Range: it opens the output for append on a 206 and, with -O, on a 200 as well. nugget opens with flags "a" whenever -c is given, whether or not it sent a Range (on ignore, whose first answer advertised no ranges, it sent none), and reads Content-Range only for its progress bar. Both wrote the full 1,000-byte body of a 200 after the 400-byte partial on ignore and advertise-only.');
  }
  if (is(ids('200-content-range', shape('body-only')), 'httpie', 'huggingface_hub', 'node-downloader-helper')) {
    gated.push('HTTPie, huggingface_hub and node-downloader-helper start over on a 200 whatever its headers say — HTTPie truncates unless the status is 206, huggingface_hub seeks back and truncates when a resume is answered with a 200, node-downloader-helper resets and truncates — and the body they then keep as the whole file is the 600-byte range the Content-Range described. Each trusted the status over the header; curl, wget, wget2, nugget, grab, go-getter and yt-dlp trusted the header, or did not look, and completed.');
  }
  if (is(ids('wrong-total', refused), 'httpie') && is(ids('wrong-total', complete), 'curl', 'go-getter', 'grab', 'huggingface_hub', 'node-downloader-helper', 'nugget', 'wget', 'wget2', 'yt-dlp')) {
    gated.push('HTTPie is the one client that stopped on the total: its parse_content_range requires last-byte-pos + 1 to equal the complete length, so "bytes 400-999/2000" is a ContentRangeError before a byte is written. The other nine completed the file; of them only huggingface_hub read the total at all, afterwards, in the consistency check described below.');
  }
  if (is(ids('unknown-total', refused), 'huggingface_hub')) {
    gated.push('huggingface_hub reads the complete length as int() of whatever follows the slash in Content-Range, so "bytes 400-999/*" raises ValueError before anything is written; the other nine took the bytes and completed.');
  }
  if (is(ids('from-zero', refused), 'curl', 'httpie', 'wget') && complete(rObs('yt-dlp', 'from-zero')) && is(ids('from-zero', shape('duplicated-prefix')), 'go-getter', 'grab', 'huggingface_hub', 'node-downloader-helper', 'nugget', 'wget2') && rObs('huggingface_hub', 'from-zero').exit && rObs('huggingface_hub', 'from-zero').exit.kind === 'raised') {
    gated.push('On from-zero, the three clients that compare the Content-Range start with the offset they asked for — curl, HTTPie, GNU Wget — stopped with the partial untouched; yt-dlp compares it too, but on a mismatch it discards the partial and takes the body, which here is the whole document, so it completed; the other six appended 1,000 bytes after 400 without comparing the start with their offset (huggingface_hub then raised OSError when the 1,400-byte file did not match the 1,000-byte total).');
  }
  if (is(ids('no-content-range', refused), 'curl', 'httpie', 'wget') && is(ids('no-content-range', shape('body-only')), 'yt-dlp')) {
    gated.push('On no-content-range the same three stopped (a 206 without Content-Range is a range error to each), yt-dlp discarded the partial and kept the 600-byte body alone ("Unable to resume"), and the other six appended — which, this once, is where the bytes belonged.');
  }
  if (is(ids('off-by-one', (o) => o.outcome === 'incomplete-reported'), 'httpie', 'huggingface_hub') && is(ids('off-by-one', (o) => o.outcome === 'harness-timeout'), 'wget') && is(ids('off-by-one', (o) => shape('short')(o) && o.file && o.file.bytes === 999 && o.exit && o.exit.code === 0), 'curl', 'go-getter', 'grab', 'node-downloader-helper', 'nugget', 'wget2', 'yt-dlp')) {
    gated.push('On off-by-one, 599 bytes arrive under a Content-Range that promises 600: HTTPie and huggingface_hub wrote them and then reported the shortfall ("Incomplete download: size=1000; downloaded=999"; "Consistency check failed: file should be of size 1000 but has size 999"); GNU Wget takes its expected length from the Content-Range rather than Content-Length, so it waited on the kept-alive connection for a 600th byte the response had already said it would not send, and the harness cap ended it; the other seven exited 0 with a 999-byte file.');
  }
  if (is(ids('if-range-ignored', shape('mixed-generation')), ...rClients().map((c) => c.id)) && ex.every((x) => x.e.if_range == null && x.e.if_match == null && x.e.if_none_match == null && x.e.if_modified_since == null) && rClients().every((c) => rObs(c.id, 'if-range-ignored').exit && rObs(c.id, 'if-range-ignored').exit.code === 0)) {
    gated.push('All ten clients mixed generations on if-range-ignored and every one exited 0. None sent If-Range or any other validator with its resume — and this flavor ignores If-Range by design, so a validator would not have changed the answer; what the rows show is that no client here reports a document that changed under it.');
  }
  const hfErrButComplete = rRows().filter((o) => o.client.id === 'huggingface_hub' && complete(o) && o.exit && o.exit.code === 1).map((o) => o.flavor).sort().join('|');
  if (hfErrButComplete === 'no-content-range|wrong-total') {
    gated.push('huggingface_hub completed the file on wrong-total and on no-content-range and still raised OSError: its consistency check after the download compares the file size with the Content-Range total (2000) or, absent a Content-Range, with the Content-Length of the range body (600), so the caller gets an OSError for a file whose 1,000 bytes match the document.');
  }
  out.push(...gated);
  const timeouts = rows.filter((o) => o.outcome === 'harness-timeout');
  const failed = rows.filter((o) => o.outcome === 'request-failed');
  const label = (o) => `${rName(o.client.id)} on ${o.flavor}${o.scenario === 'fresh' ? ' (fresh)' : ''}`;
  out.push(`${timeouts.length} of ${rows.length} rows hit the harness's 30 s cap${timeouts.length ? ` (${rList(timeouts.map((o) => `${label(o)}, ${rPlural((o.exchanges || []).length, 'request')} made and the file at ${o.file ? o.file.bytes : 0} bytes`))})` : ''} and ${failed.length} failed to land${failed.length ? ` (${rList(failed.map(label))})` : ''}. Every other row is a response this server sent, read back from the wire with its x-badhttp-version on every exchange.`);
  return out;
}

export function rangeWitness() {
  return {
    measured: WITNESS_RANGE.probed,
    observations: rRows().length,
    control_rows: OBSERVATIONS_RANGE.filter((o) => o.client.role === 'control').length,
    data: 'https://badhttp.dev/clients.jsonl',
    data_note:
      'Every observation is a row of /clients.jsonl with family "range", joined to /corpus.jsonl by corpus_id; /clients ' +
      'indexes them with the class legend, the outcome, shape and transfer legends and the per-flavor disagreement. The findings ' +
      'below are a reading of those rows, not a second source.',
    what_this_is:
      `${rClients().length} real resuming download clients plus a raw-wire control (curl), one fresh working directory per cell. Each cell holds ` +
      `the first ${WITNESS_RANGE.partial_bytes} bytes of the ${WITNESS_RANGE.document_bytes}-byte document and tells the client to resume it from ` +
      'GET /range/{flavor}; the harness never sends a Range header itself. One extra cell per client downloads from nothing at always-206. ' +
      'It is a DATED CAPTURE, not a live measurement. Every request the client sent went through a local recording reverse proxy that forwarded ' +
      'it to this service over TLS and returned the response verbatim, so each row lists the exchanges the client actually made. The reference ' +
      'for each flavor is where RFC 9110 places the bytes the control received (a 200 replaces the file, a 206 puts its body at the offset its ' +
      'Content-Range names, a 206 without one and some 416s place nothing), checked against the true document the control also fetched whole; ' +
      'each row says whether it matches the reference placement. An outcome describes the file and the exit; RFC 9110 defines what a 206 means ' +
      'and no resume algorithm, so a client that starts over on a 200 and one that stops with an error are both doing something the ' +
      'specification allows. No client here is scored or ranked. Re-run it and move the date rather than letting it stale.',
    clients: CLIENTS_RANGE.filter((c) => c.role === 'client').map((c) => `${c.name} ${c.version} (${c.class})`),
    control: CLIENTS_RANGE.filter((c) => c.role === 'control').map((c) => `${c.name} ${c.version}`),
    reference: 'REFERENCE in the /clients range family block: per flavor, the status, Content-Range, Content-Length and body size the control received for Range: bytes=400-, where RFC 9110 places those bytes, and whether that placement applied to the partial yields the document',
    findings: rangeFindings(),
    what_the_rows_cannot_say:
      'What a client does over HTTPS or HTTP/2 (every client spoke HTTP/1.1 to a loopback recorder), what a segmented downloader ' +
      'does with advertise-only (nothing here is large enough to split: aria2 splits only above 2 MiB), what a client does with a ' +
      'suffix range (no resumer sends one, so suffix-as-prefix is served to a resume request as it would be to any other), how a ' +
      'browser\'s download manager resumes (no browser in the roster), what aria2 does (it resumes only in 16 KiB blocks and only ' +
      'from its own control file, so a 1,000-byte document cannot be "400 bytes done" to it; a separate row set at 65,536 bytes ' +
      'with a 32,768-byte partial is the follow-up), and anything after the 30 s cap.',
    not_in_roster: [
      { client: 'axel', reason: 'It retries without bound on a bad 206 (about 115 requests in 12 s in the survey of 2026-10-12), which would trip the zone rate limit.' },
      { client: 'pySmartDL', reason: 'It restarts from zero rather than resuming a bare partial file.' },
      { client: 'ipull', reason: 'It restarts from zero rather than resuming a bare partial file.' },
      { client: 'pip', reason: 'Its resume exists only in-process, after a dropped connection; it does not resume a partial file left on disk.' },
      { client: 'plain HTTP libraries', reason: 'They send only the Range header the caller typed, so the choice of what to ask for is not theirs.' },
    ],
    reproduce:
      'Write the first 400 bytes of GET /range/ok?length=1000 to a fresh file, point the row\'s client at the row\'s url with the ' +
      'instruction to resume that file through a recording proxy, and compare the file and the exit with the row; for the reference, ' +
      'fetch the same url with curl -sS --http1.1 -H \'Range: bytes=400-\' and place the response as RFC 9110 §15.3.7 says. Pace the calls ' +
      'against the zone limit of 100 per 10 s, and treat a response without x-badhttp-version as no observation. The harnesses that ' +
      'produced the rows are in scripts/range-witness/ in the source.',
  };
}

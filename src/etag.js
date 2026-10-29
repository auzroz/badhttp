import { once } from './memo.js';
// /etag — conditional requests that misbehave on purpose (RFC 9110 §13, RFC 9111).
// A small fixed document whose validators (ETag and Last-Modified) lie in a chosen way.
// Cache-Control is no-cache, not no-store: a spec-following cache stores the body and revalidates on
// every use — which is the game being tested. Stateless; helpers come in from index.js.

import { LAST_MODIFIED, LM_EPOCH, checkPreconditions, conditionalHeaders, parseHttpDate, generation } from './conditional.js';
import { WITNESS_ETAG, CLIENTS_ETAG, REFERENCE_ETAG, OBSERVATIONS_ETAG } from './witness-etag-data.js';

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
      witness: etagWitness(),
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

// ---------- the witness: what real HTTP caches and conditional clients did with these responses (session 32, 2026-10-12) ----------
// Everything below is computed from the /clients.jsonl etag rows (src/witness-etag-data.js, generated from the committed capture
// by scripts/witness-parse-etag.mjs). Each cell is one client fetching one flavor three times through a fresh cache: cold (fetch 1),
// warm (fetch 2), warm-again (fetch 3). The harness never sends a conditional header for a client; the client decides what to send
// from what it stored. The reference for each flavor is what RFC 9111 implies a textbook cache would have sent and shown its caller
// given what this server answered the raw-wire control's textbook revalidation, derived from the wire, never typed. Sentences
// describe what the caller got and what went on the wire, never a verdict. Explanations of WHY a named client behaved as it did are
// gated on the computed list being the one they were written for (the gated block in etagFindings).
const SCEN = 'three-fetches';
const eRows = () => OBSERVATIONS_ETAG.filter((o) => o.client.role === 'client');
const eClients = () => CLIENTS_ETAG.filter((c) => c.role === 'client');
const eName = (id) => (CLIENTS_ETAG.find((c) => c.id === id) || { name: id }).name;
const eObs = (client, flavor) => OBSERVATIONS_ETAG.find((o) => o.client.id === client && o.flavor === flavor && o.scenario === SCEN);
const eList = (a) => (a.length ? a.join(', ') : 'none');
const ePlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const eFlavors = () => [...new Set(eRows().map((o) => o.flavor))];
const eExs = (o) => (o && o.exchanges) || (o && o.fetches && o.fetches[0] && o.fetches[0].exchanges) || [];
const eFetch = (o, i) => (o && o.fetches && o.fetches[i]) || null;

// A fetch's wire facts: the parser's `wire` block when the row carries one, else recomputed from the fetch's exchanges.
const eWire = (f) => {
  if (!f) return null;
  if (f.wire) return f.wire;
  const ex = f.exchanges || [];
  const first = ex[0];
  const last = ex[ex.length - 1];
  const inm = first && first.if_none_match != null;
  const ims = first && first.if_modified_since != null;
  return { requests: ex.length, conditional: first ? (inm && ims ? 'both' : inm ? 'etag' : ims ? 'date' : 'none') : null, etag_echo: null, date_echo: null, answered: last ? last.status : null };
};
// The description of what the caller got, with `via` for a document: document/fresh-200, document/stored-after-304, document/no-request, empty-304, other-body, error, not-run.
const eKey = (f) => {
  if (!f) return null;
  const d = f.description && typeof f.description === 'object' ? f.description.kind || f.description.description : f.description;
  if (d !== 'document') return d || null;
  const w = eWire(f);
  const via = f.via || (f.description && f.description.via) || (w && w.requests === 0 ? 'no-request' : w && w.answered === 304 ? 'stored-after-304' : 'fresh-200');
  return `document/${via}`;
};
const COND_WORDS = { none: 'no conditional header', etag: 'If-None-Match', date: 'If-Modified-Since', both: 'If-None-Match and If-Modified-Since', 'if-match': 'If-Match' };
const ETAG_ECHO_WORDS = { verbatim: 'verbatim', 'weak-stripped': 'with the W/ stripped', 'weak-added': 'with W/ added', 'quotes-added': 'with quotes added', 'quotes-removed': 'with the quotes removed', list: 'inside a list', other: 'a tag that no 200 it received carried' };
const DATE_ECHO_WORDS = { verbatim: 'verbatim', reformatted: 'reformatted as another HTTP-date for the same instant', 'own-clock': 'as a date from its own clock', 'invalid-echoed': 'the invalid value echoed back', other: 'as another value' };
// What a fetch put on the wire, as words: nothing, or the conditional headers of the first request and what the last request got.
const eSent = (f) => {
  const w = eWire(f);
  if (!w || w.requests == null || eKey(f) === 'not-run') return 'did not run this fetch';
  if (w.requests === 0) return 'made no request';
  const c = w.conditional;
  let s;
  if (c === 'none' || c == null) s = 'sent no conditional header';
  else {
    const parts = [];
    if (c === 'etag' || c === 'both') parts.push(`If-None-Match${w.etag_echo ? ` (${ETAG_ECHO_WORDS[w.etag_echo] || w.etag_echo})` : ''}`);
    if (c === 'date' || c === 'both') parts.push(`If-Modified-Since${w.date_echo ? ` (${DATE_ECHO_WORDS[w.date_echo] || w.date_echo})` : ''}`);
    if (c === 'if-match') parts.push('If-Match');
    s = `sent ${parts.join(' and ')}`;
  }
  const held = [w.etag_dropped ? 'the ETag' : null, w.date_dropped ? 'the Last-Modified' : null].filter(Boolean);
  if (held.length) s += c === 'none' || c == null ? `, having received ${held.join(' and ')} in an earlier 200` : ` but not ${held.join(' and ')} it had received`;
  return w.requests > 1 ? `${s} on the first of ${w.requests} requests, the last of which got ${w.answered}` : `${s}, got ${w.answered}`;
};
// What the caller received, as words. Descriptions only.
const eGot = (f) => {
  const k = eKey(f);
  switch (k) {
    case 'document/stored-after-304': return f.description && f.description.caller_status === 304 ? 'left its stored file as the document and reported 304 to the caller' : 'handed the caller the document from its store';
    case 'document/fresh-200': return 'handed the caller the document from the response';
    case 'document/stored-despite-200': return 'kept its stored copy and reported 304 to the caller, although the last answer was a 200 with a body';
    case 'document/no-request': return 'handed the caller the stored document';
    case 'empty-304': return 'handed the caller a 304 with no body';
    case 'other-status': return `handed the caller a response with status ${(f.description && f.description.status) ?? (f.caller && f.caller.status)}`;
    case 'other-body': return 'handed the caller a 200 whose body is not the document';
    case 'error': return `ended in an error (${(f.description && f.description.error_name) || (f.caller && f.caller.error && f.caller.error.name) || 'unnamed'})`;
    default: return String(k);
  }
};
const eAnswer = (o, i) => { const f = eFetch(o, i); if (!f) return 'made no such fetch'; if (eKey(f) === 'not-run') return 'did not run this fetch'; return `${eSent(f)} and ${eGot(f)}`; };
const eGroupBy = (flavor, fn) => {
  const m = new Map();
  for (const c of eClients()) {
    const o = eObs(c.id, flavor);
    if (!o) continue;
    const k = fn(o);
    m.set(k, (m.get(k) || []).concat(c.name));
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};
const eRender = (groups, total) => groups.map(([k, v]) => `${v.length === total ? `all ${v.length} clients` : eList(v)} ${k}`).join('; ');
const eCtl = (flavor, scenario) => OBSERVATIONS_ETAG.find((o) => o.client.role === 'control' && o.flavor === flavor && o.scenario === scenario);
const eCtlSays = (flavor, scenario) => {
  const c = eCtl(flavor, scenario);
  const e = eExs(c)[0];
  if (!e) return 'no control exchange';
  return `${e.status} with ${e.etag ? `ETag ${e.etag}` : 'no ETag'}, ${e.last_modified ? `Last-Modified ${e.last_modified}` : 'no Last-Modified'} and ${e.body_bytes} body bytes`;
};
const eCtlSent = (flavor, scenario) => { const e = eExs(eCtl(flavor, scenario))[0]; return e && e.if_none_match != null ? `If-None-Match ${e.if_none_match}` : 'no If-None-Match'; };
const REF_WORDS = { 'document/stored-after-304': 'the document from the store after a 304', 'document/fresh-200': 'the document from the fresh 200', undefined: 'nothing defined' };
const VALIDATOR_WORDS = { confirmed: 'the 304 confirms the stored validators', none: 'the 304\'s validators select no stored response, so the stored validator is kept' };
const eRefSays = (flavor) => {
  const r = REFERENCE_ETAG[flavor];
  if (!r) return 'no reference';
  const base = REF_WORDS[r.outcome] || String(r.outcome);
  const upd = r.validator_update ? `, ${VALIDATOR_WORDS[r.validator_update] || r.validator_update}` : '';
  return `${base}${upd}${r.note ? ` (${r.note})` : ''}`;
};

function etagFindingsUncached() {
  const rows = eRows();
  if (!rows.length) return [];
  const N = eClients().length;
  const out = [];
  const byOutcome = {};
  for (const o of rows) byOutcome[o.outcome] = (byOutcome[o.outcome] || 0) + 1;
  const tally = Object.entries(byOutcome).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ');
  const vs = { 'as-reference': 0, differs: 0, undefined: 0 };
  for (const o of rows) if (o.outcome_vs_reference in vs) vs[o.outcome_vs_reference]++;
  out.push(
    `${ePlural(N, 'HTTP cache or conditional-request client')} (${eList(eClients().map((c) => c.name))}) were each pointed at /etag/{flavor} and asked for the same URL three times in a row through a fresh cache — ${eFlavors().length} flavors, ${ePlural(rows.length, 'row')} in all. The harness never sends a conditional header for a client, so every If-None-Match and If-Modified-Since below is one the client chose from what it stored. By what the caller received on the second fetch: ${tally}. ` +
    `Against the reference (what RFC 9111 implies a textbook cache would have sent and shown, given what the control's textbook revalidation got), ${vs['as-reference']} rows match, ${vs.differs} differ and ${vs.undefined} have no reference defined. RFC 9111 §5.2.2.4 forbids reusing a no-cache response without validation and does not forbid an unconditional refetch, so a row that differs is a description of a difference, not a finding about the client.`
  );
  for (const flavor of eFlavors()) {
    const fr = rows.filter((o) => o.flavor === flavor);
    const as = fr.filter((o) => o.outcome_vs_reference === 'as-reference').length;
    const df = fr.filter((o) => o.outcome_vs_reference === 'differs').length;
    const un = fr.filter((o) => o.outcome_vs_reference === 'undefined').length;
    const score = un ? `${un} of ${fr.length} rows have no reference to match${as + df ? `; ${as} match and ${df} differ` : ''}` : `${as} of ${fr.length} rows match the reference and ${df} differ`;
    out.push(`${flavor} (the control got, cold, ${eCtlSays(flavor, 'cold-raw')}; on a textbook revalidation, ${eCtlSays(flavor, 'revalidate-raw')}; reference: ${eRefSays(flavor)}): on the warm fetch, ${eRender(eGroupBy(flavor, (o) => eAnswer(o, 1)), N)}. ${score}.`);
  }
  // Validators across every request the clients sent, then on the first request of the warm fetch.
  const ex = rows.flatMap((o) => (o.fetches || []).flatMap((f) => (f.exchanges || []).map((e) => ({ e, name: o.client.name }))));
  const withH = (h) => ex.filter((x) => x.e[h] != null);
  const names = (h) => [...new Set(withH(h).map((x) => x.name))].sort();
  const warmKind = (o) => { const f = eFetch(o, 1); const w = eWire(f); return !w || w.requests == null || eKey(f) === 'not-run' ? 'not run' : w.requests === 0 ? 'no-request' : w.conditional; };
  const warm = new Map();
  for (const o of rows) { const k = warmKind(o); if (!warm.has(k)) warm.set(k, { n: 0, names: new Set() }); warm.get(k).n++; warm.get(k).names.add(o.client.name); }
  const warmWords = [['etag', 'If-None-Match only'], ['date', 'If-Modified-Since only'], ['both', 'both'], ['none', 'neither header'], ['no-request', 'no request at all']]
    .map(([k, label]) => { const g = warm.get(k); return `${g ? g.n : 0} carried ${label}${g ? ` (${eList([...g.names].sort())})` : ''}`; });
  const droppedBy = (key) => [...new Set(rows.filter((o) => eWire(eFetch(o, 1)) && eWire(eFetch(o, 1))[key] === true).map((o) => o.client.name))].sort();
  const dE1 = droppedBy('etag_dropped');
  const dD1 = droppedBy('date_dropped');
  const nDrop = (key) => rows.filter((o) => eWire(eFetch(o, 1)) && eWire(eFetch(o, 1))[key] === true).length;
  out.push(`Validators: of ${ex.length.toLocaleString('en-US')} requests the clients sent over the three fetches, ${withH('if_none_match').length} carried If-None-Match (${eList(names('if_none_match'))}) and ${withH('if_modified_since').length} carried If-Modified-Since (${eList(names('if_modified_since'))}). On the first request of the warm fetch, of ${rows.length} rows: ${warmWords.join('; ')}. A validator held from the first 200 and not sent on the warm fetch: the ETag in ${nDrop('etag_dropped')} rows (${eList(dE1)}), the Last-Modified in ${nDrop('date_dropped')} rows (${eList(dD1)}).`);
  // Echo: how the validator came back, across the warm and warm-again fetches.
  const echoOf = (key, words) => {
    const m = new Map();
    for (const o of rows) for (const i of [1, 2]) { const w = eWire(eFetch(o, i)); const k = w && w[key]; if (!k) continue; if (!m.has(k)) m.set(k, { n: 0, names: new Set() }); m.get(k).n++; m.get(k).names.add(o.client.name); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `${words[k] || k}: ${g.n} (${eList([...g.names].sort())})`);
  };
  const eE = echoOf('etag_echo', ETAG_ECHO_WORDS);
  const dE = echoOf('date_echo', DATE_ECHO_WORDS);
  out.push(`Echo: each If-None-Match or If-Modified-Since value is compared with the validator that client most recently received in a 200. Of the If-None-Match values sent on the warm and warm-again fetches, ${eE.length ? eE.join('; ') : 'none could be compared with a tag the client had received'}. Of the If-Modified-Since values, ${dE.length ? dE.join('; ') : 'none could be compared with a Last-Modified the client had received'}.`);
  for (const [flavor, key, label, words] of [['weak', 'etag_echo', 'If-None-Match', ETAG_ECHO_WORDS], ['unquoted', 'etag_echo', 'If-None-Match', ETAG_ECHO_WORDS], ['bad-date', 'date_echo', 'If-Modified-Since', DATE_ECHO_WORDS], ['future', 'date_echo', 'If-Modified-Since', DATE_ECHO_WORDS]]) {
    if (!eFlavors().includes(flavor)) continue;
    const g = eGroupBy(flavor, (o) => { const w = eWire(eFetch(o, 1)); const k = w && w[key]; return k ? (words[k] || k) : 'not sent'; });
    out.push(`On ${flavor} (the control got, cold, ${eCtlSays(flavor, 'cold-raw')}), the ${label} of the warm fetch was: ${g.map(([k, v]) => `${k} (${eList(v)})`).join('; ')}.`);
  }
  // mismatch: did the client adopt the tag the 304 carried?
  if (eFlavors().includes('mismatch')) {
    const ad = eClients().filter((c) => { const o = eObs(c.id, 'mismatch'); return o && o.adopted_304_validator === true; });
    const non = eClients().filter((c) => { const o = eObs(c.id, 'mismatch'); return o && o.adopted_304_validator !== true; });
    const third = (list) => { const m = new Map(); for (const c of list) { const k = eAnswer(eObs(c.id, 'mismatch'), 2); m.set(k, (m.get(k) || []).concat(c.name)); } return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${eList(v)} ${k}`).join('; '); };
    out.push(`On mismatch (the control's revalidation sent ${eCtlSent('mismatch', 'revalidate-raw')} and got ${eCtlSays('mismatch', 'revalidate-raw')}, an ETag other than the one it sent), ${ad.length} of ${ad.length + non.length} clients sent, on a later fetch, a tag they had only ever received in that 304${ad.length ? ` (${eList(ad.map((c) => c.name))}). On their third fetch, ${third(ad)}` : ''}. ${non.length ? `The other ${non.length} (${eList(non.map((c) => c.name))}) did not. On their third fetch, ${third(non)}.` : 'No client did otherwise.'}`);
  }
  // always-304: what a cold 304 handed the caller.
  if (eFlavors().includes('always-304')) {
    out.push(`On always-304 the control's very first request, with no conditional header, got ${eCtlSays('always-304', 'cold-raw')}. On the cold fetch, ${eRender(eGroupBy('always-304', (o) => eAnswer(o, 0)), N)}. Across all three fetches, by pattern: ${eRender(eGroupBy('always-304', (o) => o.pattern || 'no pattern'), N)}.`);
  }
  // no-validator-304: a 304 that confirms nothing by name.
  if (eFlavors().includes('no-validator-304')) {
    out.push(`On no-validator-304 the control's revalidation got ${eCtlSays('no-validator-304', 'revalidate-raw')}. On the third fetch, after that bare 304, ${eRender(eGroupBy('no-validator-304', (o) => eAnswer(o, 2)), N)}.`);
  }
  // no-request: a warm fetch answered without going upstream.
  const nr = [];
  for (const o of rows) for (const i of [1, 2]) { const f = eFetch(o, i); const w = eWire(f); if (w && w.requests === 0 && eKey(f) !== 'not-run') nr.push({ name: o.client.name, flavor: o.flavor, fetch: i + 1 }); }
  if (nr.length) {
    const byClient = new Map();
    for (const x of nr) { if (!byClient.has(x.name)) byClient.set(x.name, new Map()); const m = byClient.get(x.name); m.set(x.fetch, (m.get(x.fetch) || []).concat(x.flavor)); }
    const k = byClient.size;
    out.push(`${nr.length} warm ${nr.length === 1 ? 'fetch was' : 'fetches were'} answered without any request going upstream, by ${ePlural(k, 'client')}: ${[...byClient.entries()].map(([c, m]) => `${c} on fetch ${[...m.entries()].map(([n, fl]) => `${n} of ${fl.join(', ')}`).join(' and on fetch ')}`).join('; ')}. Every flavor answers cache-control: no-cache, no-transform, and RFC 9111 §5.2.2.4 says a no-cache response is validated before reuse; the rows say what each client did.`);
  } else {
    out.push('No warm fetch was answered without a request going upstream: every client went to the server on the second and third fetch of every flavor.');
  }
  // ---- gated explanations: WHY a named client did what it did, from its source as the survey of 2026-10-12 read it
  // (docs/survey-etag-clients-2026-10-12.md; file and function cited in each sentence). Each renders only while the computed
  // facts it was written for still hold, so a re-capture that moves a list drops the explanation rather than misattributing it
  // (the #23 rule). Ids are client ids; the text uses display names.
  const gW = (c, f, i) => eWire(eFetch(eObs(c, f), i)) || {};
  const gK = (c, f, i) => eKey(eFetch(eObs(c, f), i));
  const gD = (c, f, i) => { const x = eFetch(eObs(c, f), i); return (x && x.description && typeof x.description === 'object' ? x.description : {}); };
  const gEx = (c, f, i) => (eFetch(eObs(c, f), i) || {}).exchanges || [];
  const gIds = (flavor, pred) => eClients().filter((c) => { const o = eObs(c.id, flavor); return o && pred(o); }).map((c) => c.id).sort().join('|');
  const gIs = (list, ...want) => list === want.slice().sort().join('|');
  const gEvery = (c, pred) => eFlavors().every((f) => { const o = eObs(c, f); return o && pred(o, f); });
  const nm = eName;
  const gated = [];
  const F304 = ['ok', 'weak', 'mismatch', 'no-validator-304', 'unquoted'];
  if (gEvery('curl-etag', (o) => (gEx('curl-etag', o.flavor, 0)[0] || {}).if_none_match === '""') && F304.every((f) => gW('curl-etag', f, 1).answered === 304 && gW('curl-etag', f, 1).etag_echo === 'verbatim' && (gEx('curl-etag', f, 2)[0] || {}).if_none_match === '""' && gW('curl-etag', f, 2).answered === 200)) {
    gated.push(`${nm('curl-etag')} sent If-None-Match: "" on every cold fetch and again after every 304: when --etag-compare names a file that is missing or empty, curl 8.7.1 sends the literal empty tag (src/tool_operate.c, single_transfer), and --etag-save opens its file for writing before the transfer and writes an ETag line only for a 2xx response, so a 304 leaves the file empty. On ${F304.join(', ')} the three fetches therefore went 200, 304, 200: the tag saved, matched once, lost with the 304, and saved again.`);
  }
  if (gEvery('curl-z', (o) => [0, 1, 2].every((i) => { const w = gW('curl-z', o.flavor, i); return w.conditional == null || w.conditional === 'none' || w.date_echo === 'own-clock'; })) && gIs(gIds('ignore', (o) => eKey(eFetch(o, 1)) === 'document/stored-despite-200'), 'curl-z', 'wget-N') && gIs(gIds('bad-date', (o) => eKey(eFetch(o, 1)) === 'document/stored-despite-200'), 'curl-z')) {
    gated.push(`${nm('curl-z')} never echoes a Last-Modified: libcurl rebuilds If-Modified-Since from the output file's modification time (lib/http.c, Curl_add_timecondition), which without -R is the time curl last wrote the file, so every date it sent here is its own clock. When a 200 then arrives whose Last-Modified is not newer than that time, or does not parse, libcurl discards the body and reports 304 itself ("Simulate an HTTP 304 response", Curl_http_readwrite_headers): the stored-despite-200 rows on ignore and bad-date.`);
  }
  if (gW('wget-N', 'ok', 1).date_echo === 'verbatim' && gW('wget-N', 'bad-date', 1).date_echo === 'own-clock' && gEvery('wget-N', (o) => (o.fetches || []).every((x) => (x.exchanges || []).every((e) => e.if_none_match == null))) && gK('wget-N', 'ignore', 1) === 'document/stored-despite-200' && gK('wget-N', 'always-304', 0) === 'error' && gD('wget-N', 'always-304', 0).error_name === 'ServerError') {
    gated.push(`${nm('wget-N')} sends If-Modified-Since only when a local file exists, formatted from that file's modification time, which wget sets from a Last-Modified it can parse (src/http.c, gethttp): on ok the date went out as the server sent it, on bad-date (an ISO 8601 value its four strptime formats reject) as the download time; wget has no If-None-Match code at all. A 200 to its conditional request whose Last-Modified is not newer and whose Content-Length equals the file is dropped as "Server ignored If-Modified-Since" (the ignore row), and a cold 304 is "ERROR 304: Not Modified." with exit 8.`);
  }
  if (gW('hishel', 'mismatch', 1).requests === 2 && gW('hishel', 'mismatch', 1).answered === 200 && gW('hishel', 'mismatch', 2).requests === 2 && !eObs('hishel', 'mismatch')?.adopted_304_validator) {
    gated.push(`${nm('hishel')} made two requests inside each warm fetch of mismatch: its 304 handling (hishel/_core/_spec.py, freshening_stored_responses) matches a strong 304 ETag against the stored entry's tag, a 304 whose tag matches nothing deletes the entry, and the same call then sends a plain GET — so the caller got the fresh 200 and hishel never sent "e-badhttp-2".`);
  }
  if (F304.every((f) => gW('undici-cache', f, 1).answered === 304 && gW('undici-cache', f, 2).conditional === 'none') && ['changing', 'ignore'].every((f) => gW('undici-cache', f, 2).conditional === 'both')) {
    gated.push(`${nm('undici-cache')} deletes the stored entry after a successful revalidation whose 304 carries a Cache-Control header (lib/interceptor/cache.js, revalidationResponseUpdatesCacheControl) — and this server's 304s all do — so its third fetch was a cold unconditional request on every flavor that answered the second with a 304, and what that 304 carried (a different ETag, or none) never reached its store.`);
  }
  if (gW('undici-cache', 'future', 1).conditional === 'none' && gW('undici-cache', 'unquoted', 1).conditional === 'date' && gW('undici-cache', 'bad-date', 1).date_echo === 'own-clock') {
    gated.push(`${nm('undici-cache')} stored nothing on future (lib/handler/cache-handler.js, determineStaleAt returns early for a Last-Modified at or after now), sent If-Modified-Since alone on unquoted (only a quoted or W/-prefixed tag is a usable ETag to it) and, on bad-date, an If-Modified-Since built from the time it cached the entry rather than the ISO string (makeRevalidationHeaders falls back to cachedAt when the stored Last-Modified does not parse).`);
  }
  if (eObs('got-cache', 'always-304')?.adopted_304_validator && gW('got-cache', 'always-304', 1).conditional === 'etag' && gW('got-cache', 'mismatch', 2).conditional === 'none' && gW('got-cache', 'no-validator-304', 2).conditional === 'none') {
    gated.push(`${nm('got-cache')} stored the cold 304 on always-304 — http-cache-semantics gives a response without a status property the status 200 (index.js, CachePolicy constructor), so cacheable-request treats that 304 as storable — and revalidated it with the tag it carried on the next two fetches, handing the caller a 304 each time. On mismatch and no-validator-304 the 304 matched nothing stored (a different ETag; no validator against a stored Last-Modified), the policy rebuilt from the 304 is not storable, and cacheable-request deleted the entry (dist/index.js, cache.delete), so the third fetch was unconditional.`);
  }
  if (eObs('gregjones-httpcache', 'always-304')?.adopted_304_validator && eObs('gregjones-httpcache', 'mismatch')?.adopted_304_validator && gW('gregjones-httpcache', 'mismatch', 2).answered === 200) {
    gated.push(`${nm('gregjones-httpcache')} stores any response neither side marked no-store (httpcache.go, canStore), a cold 304 included, so on always-304 it revalidated that 304 with its tag on the next two fetches; and on a 304 it copies every header the 304 carries over the stored one (Transport.RoundTrip), so on mismatch its third fetch sent "e-badhttp-2" and got the 200 that restores the real tag.`);
  }
  const adopters = gIds('mismatch', (o) => o.adopted_304_validator);
  if (gIs(adopters, 'cachecontrol', 'gregjones-httpcache', 'make-fetch-happen', 'requests-cache-cc', 'squid', 'trafficserver') && gW('nginx-stale', 'mismatch', 2).etag_echo === 'verbatim' && gW('nginx-stale', 'mismatch', 2).answered === 304) {
    gated.push(`Six clients sent "e-badhttp-2" on their third fetch of mismatch — ${eList(adopters.split('|').map(nm))} — each because its 304 handling writes the 304's headers over the stored ones (cachecontrol/controller.py update_cached_response; requests_cache/policy/actions.py update_revalidated_response; make-fetch-happen's cache entry rewritten from the 304's headers; Squid's and Traffic Server's header merge on a 304). The server then answers 200 with the real tag, which is the 304/200/304 thrash the flavor describes. ${nm('nginx-stale')} takes nothing from a 304's headers, sent the stored tag again and got a second 304.`);
  }
  if (gW('trafficserver', 'weak', 1).etag_echo === 'weak-stripped' && gW('trafficserver', 'no-validator-304', 2).conditional === 'date' && gW('trafficserver', 'bad-date', 1).conditional === 'none') {
    gated.push(`${nm('trafficserver')} strips a leading W/ from the ETag it revalidates with (HttpTransact.cc, issue_revalidate), so the weak flavor's tag went out as a strong-looking quoted tag; a 304 without an ETag costs it the stored ETag (merge_and_update_headers_for_cache_update deletes the cached ETag unless the 304 carries one), so its third fetch of no-validator-304 sent If-Modified-Since alone; and a Last-Modified that does not parse is not sent, so on bad-date, with no ETag either, its revalidation was an unconditional request. With its shipped default (required_headers 2: an explicit lifetime required) it stores none of these responses; the roster entry sets required_headers 0 and the row's configuration says so.`);
  }
  if (gW('squid', 'weak', 1).conditional === 'date' && gW('squid', 'unquoted', 1).conditional === 'date' && gW('squid', 'changing', 1).date_echo === 'own-clock' && gEvery('squid', (o) => (o.fetches || []).every((x) => (x.exchanges || []).every((e) => /max-age=259200/.test(e.cache_control_req || ''))))) {
    gated.push(`${nm('squid')} sends If-None-Match only for a strong, quoted ETag as stored (client_side_reply.cc, processExpired), so weak and unquoted were revalidated with If-Modified-Since alone; its If-Modified-Since is rebuilt from the stored entry's parsed Last-Modified, or from the entry's Date when there is no usable Last-Modified (changing, bad-date); and every request it forwarded, the cold one included, carried Cache-Control: max-age=259200, the largest freshness of its default refresh_pattern (http.cc, httpBuildRequestHeader).`);
  }
  if (['bad-date', 'future'].every((f) => [0, 1, 2].every((i) => gW('cachecontrol', f, i).conditional === 'none' && gW('cachecontrol', f, i).requests === 1))) {
    gated.push(`${nm('cachecontrol')} stores a response only when it carries an ETag (or a max-age or Expires) — cachecontrol/controller.py, cache_response — so bad-date and future, whose responses have a Last-Modified and no ETag, were never stored and all three fetches were unconditional; the response's no-cache is not what decided.`);
  }
  if (gW('nginx-stale', 'bad-date', 1).conditional === 'none' && gW('nginx-stale', 'bad-date', 1).requests === 1 && gW('nginx-stale', 'ok', 1).conditional === 'both' && gW('nginx-stale', 'ok', 1).date_echo === 'verbatim') {
    gated.push(`${nm('nginx-stale')} stores a no-cache response only under proxy_ignore_headers Cache-Control (ngx_http_upstream.c, ngx_http_upstream_process_cache_control marks any no-cache, no-store or private value uncacheable; there is no other way), which is why the roster entry carries that directive and a one-second validity. When it revalidates, If-None-Match is the stored ETag byte for byte and If-Modified-Since the stored Last-Modified parsed and printed again, so an unparseable date (bad-date) sends no If-Modified-Since and, with no ETag, the revalidation was an unconditional request.`);
  }
  if (gEvery('varnish', (o) => [1, 2].every((i) => gW('varnish', o.flavor, i).conditional === 'none' && gW('varnish', o.flavor, i).requests === 1)) && [0, 1, 2].every((i) => gK('varnish', 'always-304', i) === 'other-status' && gD('varnish', 'always-304', i).status === 503)) {
    gated.push(`${nm('varnish')} ran its built-in VCL, whose vcl_beresp_control treats a Cache-Control containing no-cache, no-store or private as uncacheable and creates a hit-for-miss object, so every request went to the origin with no conditional header; and a 304 to a request it did not make conditional is a backend fetch failure to it (cache_fetch.c), answered with its own 503 — the one other-status row.`);
  }
  const isoEcho = gIds('bad-date', (o) => gW(o.client.id, 'bad-date', 1).date_echo === 'invalid-echoed');
  if (gIs(isoEcho, 'got-cache', 'gregjones-httpcache', 'hishel', 'make-fetch-happen', 'requests-cache-cc') && gIs(gIds('bad-date', (o) => gW(o.client.id, 'bad-date', 1).date_echo === 'own-clock'), 'curl-z', 'squid', 'undici-cache', 'wget-N')) {
    gated.push(`Five clients sent the ISO 8601 Last-Modified back verbatim on bad-date and got the 304 that only an exact echo earns from this flavor: ${eList(isoEcho.split('|').map(nm))} — hishel's make_conditional_request copies the stored header, requests-cache's _update_validation_headers likewise, make-fetch-happen and got through http-cache-semantics' revalidationHeaders (which copies the stored strings and never parses the date), gregjones/httpcache through Set("if-modified-since", lastModified). The four that build the date from a parsed time or a clock (${eList(['curl-z', 'squid', 'undici-cache', 'wget-N'].map(nm))}) sent a different value and got the 200.`);
  }
  out.push(...gated);
  const timeouts = rows.filter((o) => o.outcome === 'harness-timeout');
  const failed = rows.filter((o) => o.outcome === 'request-failed');
  const label = (o) => `${eName(o.client.id)} on ${o.flavor}`;
  out.push(`${timeouts.length} of ${rows.length} rows hit the harness's cap${timeouts.length ? ` (${eList(timeouts.map((o) => `${label(o)}, ${ePlural((o.fetches || []).reduce((n, f) => n + ((f.exchanges || []).length), 0), 'request')} made`))})` : ''} and ${failed.length} failed to land${failed.length ? ` (${eList(failed.map(label))})` : ''}. Every other row is a response this server sent, read back from the wire with its x-badhttp-version on every exchange.`);
  return out;
}

function etagWitnessUncached() {
  return {
    measured: WITNESS_ETAG.probed,
    observations: eRows().length,
    control_rows: OBSERVATIONS_ETAG.filter((o) => o.client.role === 'control').length,
    data: 'https://badhttp.dev/clients.jsonl',
    data_note:
      'Every observation is a row of /clients.jsonl with family "etag", joined to /corpus.jsonl by corpus_id; /clients ' +
      'indexes them with the class legend, the outcome, description, conditional and echo legends and the per-flavor disagreement. The findings ' +
      'below are a reading of those rows, not a second source.',
    what_this_is:
      `${eClients().length} real HTTP caches and conditional-request clients plus a raw-wire control (curl), one fresh working directory and one fresh cache per cell. Each cell asks the client to fetch ` +
      'GET /etag/{flavor} three times in a row through its cache (cold, warm, warm-again); the harness never sends a conditional header for a client, ' +
      'so every If-None-Match and If-Modified-Since is one the client chose from what it stored. ' +
      'It is a DATED CAPTURE, not a live measurement. Every request the client sent went through a local recording reverse proxy that forwarded ' +
      'it to this service over TLS and returned the response verbatim, so each row lists the exchanges the client actually made, attributed to the fetch that caused them. ' +
      'The reference for each flavor is what RFC 9111 implies a textbook cache would have sent and shown its caller, given what this server answered the control\'s textbook ' +
      'revalidation (RFC 9111 §4.3.1, §4.3.3, §4.3.4); where the specification defines nothing, the reference says so. ' +
      'An outcome describes what the caller received and what went upstream. RFC 9111 §5.2.2.4 forbids reusing a no-cache response without validation and does not forbid ' +
      'an unconditional refetch, so a client that revalidates and one that refetches are both allowed to, and "differs" is a description. Not every class is a cache in the ' +
      'RFC 9111 sense: curl --etag-compare, curl -z and wget -N are command-line clients that keep one saved validator, and each row names its class. The ' +
      'cache-control of every response is no-cache, so only the revalidation path is exercised. No client here is scored or ranked. Every figure, list and client name in this block is ' +
      'computed from the rows, never typed, except inside the gated explanations: each of those is written by hand from the client\'s source as docs/survey-etag-clients-2026-10-12.md read it, and renders only while the computed facts it names still hold. Re-run it and move the date rather than letting it stale.',
    clients: CLIENTS_ETAG.filter((c) => c.role === 'client').map((c) => `${c.name} ${c.version} (${c.class})`),
    control: CLIENTS_ETAG.filter((c) => c.role === 'control').map((c) => `${c.name} ${c.version}`),
    reference: 'REFERENCE in the /clients etag family block: per flavor, the status and validators the control received cold and on a textbook revalidation (If-None-Match with the ETag it received, If-Modified-Since with the Last-Modified it received, as RFC 9111 §4.3.1 says), and what a cache that stores the first response and validates it that way would show its caller on the warm fetch',
    findings: etagFindings(),
    what_the_rows_cannot_say:
      'What a client does over HTTPS or HTTP/2 (every client spoke HTTP/1.1 to a loopback recorder, so TLS, ALPN and HTTP/2 are out of scope), how a ' +
      'browser cache revalidates (no browser is in the roster), what a cache does with max-age, heuristic freshness, Vary or stale-while-revalidate ' +
      '(every flavor is no-cache, so only the revalidation path is exercised), whether a 304 updated the headers a cache stored (not observable from outside; only the next ' +
      'request\'s validators are), and anything after the harness caps.',
    not_in_roster: Array.isArray(WITNESS_ETAG.not_in_roster) ? WITNESS_ETAG.not_in_roster : [],
    reproduce:
      'Start a fresh cache and a fresh working directory, ask the row\'s client to fetch the row\'s url three times in a row through its cache with no conditional ' +
      'header of your own, and compare each fetch\'s requests and what the caller received with the row; for the reference, fetch the same url with curl -sS --http1.1, ' +
      'then again with If-None-Match set to the ETag and If-Modified-Since to the Last-Modified it returned. Pace the calls against the zone limit of 100 per 10 s, and treat ' +
      'a response without x-badhttp-version as no observation. The harnesses that produced the rows are in scripts/etag-witness/ in the source.',
  };
}
export const etagFindings = once(etagFindingsUncached); // constant data; computed once per isolate (src/memo.js)
export const etagWitness = once(etagWitnessUncached); // constant data; computed once per isolate (src/memo.js)
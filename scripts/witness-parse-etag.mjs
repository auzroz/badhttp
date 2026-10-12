#!/usr/bin/env node
// Turns the /etag witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-etag-clients-<date>.jsonl — the raw capture, committed, re-runnable from scripts/etag-witness/.
//         Line 1 is provenance; every other line is one cell: a client row or a control row (docs/spec-etag-witness.md).
//         The run log docs/probe-etag-clients-<date>.log must sit beside it.
// Output: src/witness-etag-data.js — a generated literal (override the path with ETAG_WITNESS_OUT for tests).
//
//   node scripts/witness-parse-etag.mjs docs/probe-etag-clients-2026-10-12.jsonl
//
// THE ORACLE IS THE CONTROL'S EXCHANGES, NEVER TYPED. For every flavor the cold-raw control row carries the document (its body: bytes and
// sha256; undefined where the cold request was answered 304) and the validators the server sent; the revalidate-raw row carries what a
// textbook validation (RFC 9111 §4.3.1: If-None-Match with the stored ETag, If-Modified-Since with the stored Last-Modified, verbatim)
// was answered. The REFERENCE for a flavor is read from those two exchanges: a 304 means the stored response is reused
// (document/stored-after-304), a 200 means the new response is what the cache hands on (document/fresh-200), a 304 to the cold request
// leaves the reference undefined. Every client row is then described relative to that reference.
//
// Capture shapes this generator reads (the orchestrator writes them):
//   control row:  { family, id, corpus_id, url, flavor, scenario: cold-raw | revalidate-raw | revalidate-adopted-raw, client:{role:control,class:raw,...},
//                   attempts, exchanges:[ONE exchange], control:{raw_base64, raw_bytes, raw_sha256, status, etag, last_modified, curl_exit}, end, ... }
//   client row:   { ..., scenario: three-fetches, client:{..., configuration}, attempts, end: exited | harness-timeout, exchanges_after_result, wall_ms,
//                   request_failed?: true,
//                   fetches:[{n, kind: cold|warm|warm-again, caller:{status, bytes, sha256, error, library_says, exit} | null, exchanges:[...]}] }
//   A fetch with caller null is not-run (a cap fired before it completed; its recorded exchanges, if any, still describe its wire). Fewer than
//   three fetches is allowed only when end is harness-timeout. A request_failed row has zero exchanges and fetches [] (outcome request-failed).
//   An exchange whose fetch_n is null is allowed only up to the row's exchanges_after_result (a client that revalidated after QUIT); such
//   exchanges, and any in a top-level exchanges_after list, are served as late_exchanges and take no part in wire or description.
//
// VOCABULARY (all descriptions, never verdicts)
//   conditional (of the fetch's first request): none | etag | date | both | if-match; null when no request went upstream.
//   etag_echo (If-None-Match against the ETag of the most recent 200 the client received): verbatim | weak-stripped | weak-added |
//     quotes-added | quotes-removed | list | other; null when none sent or no 200 received (etag_sent / etag_received are still on the wire).
//   date_echo (If-Modified-Since against the Last-Modified of the most recent 200): verbatim | reformatted | own-clock | invalid-echoed | other.
//   description: document (via fresh-200 | stored-after-304 | no-request) | empty-304 | other-body | error | not-run.
//   outcome (the warm fetch's description): document/fresh-200 | document/stored-after-304 | document/no-request | empty-304 | other-body | error,
//     plus harness-timeout (the warm fetch never completed) and request-failed.
//   outcome_vs_reference: as-reference | differs | undefined | null.
//   Further: etag_echo `other` / date_echo `own-clock` (or `other`) are now given when a validator was sent although no 200 carried one to compare with (the spec said null);
//   wire.etag_held / date_held (the validators of the most recent 200 when the fetch began) and etag_dropped / date_dropped (held but not sent);
//   description other-status {status, bytes, sha256} (the caller saw a status other than 200 and 304: Varnish's 503 on always-304); caller.file_rewritten false
//   (reported by a CLI driver: the file was not rewritten) with a 200 answered makes via stored-despite-200 (wget -N).
//   Additions to the spec's vocabulary (found by driving the roster): via stored-despite-200 (the tool reported 304 and kept its stored copy although
//   the last upstream answer was a 200 with a body: curl -z); description.caller_status 304 on a document the tool reported with status 304 and left in
//   its file (curl --etag-compare, curl -z, wget -N); a caller that reports 304 with a non-empty file is a document, not an empty-304.
//
// Refusals (the generator exits non-zero rather than emit): a client missing a cell of the 10-cell grid, a duplicate (client, flavor) or row id,
// a flavor missing cold-raw / revalidate-raw (mismatch: revalidate-adopted-raw), a control with other than one exchange or whose request
// departs from the documented protocol, a client row with other than three fetches (unless harness-timeout), an exchange with no
// x-badhttp-version / naming another flavor / carrying upstream_error / no fetch_n, a machine path, loopback literal, port or foreign host,
// a control whose raw bytes do not hash to raw_sha256 or its exchange's body_sha256, a caller sha256 that is not the empty hash for 0 bytes,
// rows spanning two badhttp versions, fewer than 5 client-role clients, an unknown class / kind / end / description / conditional, a
// verdict word in any served string, an absolute or parent-relative capture path, a configuration that differs between rows of one client.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { MACHINE, VERDICT_WORDS, ALLOWED_HOSTS, checkString, headerSafe } from './witness-gate.mjs';

const OUT = process.env.ETAG_WITNESS_OUT || 'src/witness-etag-data.js';
const isMain = process.argv[1] && /witness-parse-etag\.mjs$/.test(process.argv[1]);
const SRC = isMain ? process.argv[2] : null;
if (isMain && !SRC) { console.error('usage: node scripts/witness-parse-etag.mjs <capture.jsonl>'); process.exit(2); }
// source_file and run_log are written into the committed data file, so the capture path must be repo-relative:
if (isMain && (isAbsolute(SRC) || SRC.split(/[\\/]/).includes('..'))) { console.error(`REFUSED: ${SRC} must be a repo-relative path (the path is written into ${OUT})`); process.exit(1); }

export const FLAVOR_ORDER = ['ok', 'weak', 'changing', 'ignore', 'always-304', 'mismatch', 'no-validator-304', 'unquoted', 'bad-date', 'future'];
export const CONTROL_SCENARIOS = ['cold-raw', 'revalidate-raw', 'revalidate-adopted-raw'];
export const CLIENT_SCENARIO = 'three-fetches';
export const FETCH_KINDS = ['cold', 'warm', 'warm-again'];
export const CLASSES = ['library-cache', 'cli-conditional', 'proxy-cache', 'raw'];

const ROLES = ['client', 'control'];
const ENDS = ['exited', 'harness-timeout'];
const CONDITIONALS = ['none', 'etag', 'date', 'both', 'if-match'];
const ETAG_ECHOES = ['verbatim', 'weak-stripped', 'weak-added', 'quotes-added', 'quotes-removed', 'list', 'other'];
const DATE_ECHOES = ['verbatim', 'reformatted', 'own-clock', 'invalid-echoed', 'other'];
const DESCRIPTIONS = ['document', 'empty-304', 'other-body', 'other-status', 'error', 'not-run'];
const VIAS = ['fresh-200', 'stored-after-304', 'no-request', 'stored-despite-200'];
const OUTCOMES = ['document/fresh-200', 'document/stored-after-304', 'document/no-request', 'document/stored-despite-200', 'empty-304', 'other-body', 'other-status', 'error', 'harness-timeout', 'request-failed'];
const VS_REFERENCE = ['as-reference', 'differs', 'undefined'];
const REF_OUTCOMES = ['document/stored-after-304', 'document/fresh-200', 'undefined'];
const MIN_CLIENTS = 5;
const SCENARIO_ORDER = [...CONTROL_SCENARIOS, CLIENT_SCENARIO];
const CLIENT_FIELDS = ['name', 'role', 'class', 'version', 'library', 'runtime', 'platform', 'configuration', 'requests_recorded_by'];

// ---------- the gate: MACHINE, VERDICT_WORDS, ALLOWED_HOSTS, checkString and headerSafe come from scripts/witness-gate.mjs ----------
// A port after a host name or an IPv4 literal ("badhttp.dev:8787", "10.0.0.2:3128"); timestamps and versions do not match.
const HOST_PORT = /(?<![\w.-])(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}(?!\d)/i;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const EMPTY_SHA = sha(Buffer.alloc(0));

// ---------- HTTP-date and entity-tag parsing: copies of src/conditional.js (the generator stands alone) ----------
const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d';
const IMF = new RegExp(`^${DAY}, \\d{2} ${MON} \\d{4} ${TIME} GMT$`);
const ASC = new RegExp(`^${DAY} ${MON} [ \\d]\\d ${TIME} \\d{4}$`);
const R850 = new RegExp(`^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-(${MON})-(\\d{2}) (${TIME}) GMT$`);
export function parseHttpDate(value) {
  const s = value.trim();
  if (IMF.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  if (ASC.test(s)) { const t = Date.parse(s + ' GMT'); return Number.isNaN(t) ? null : t; }
  const m = R850.exec(s);
  if (m) {
    const yy = Number(m[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const t = Date.parse(`${m[1]} ${m[2]} ${year} ${m[4]} GMT`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
export function listTags(value) {
  if (value.trim() === '*') return ['*'];
  const members = value.match(/(?:[^,"]|"[^"]*")+/g) || [];
  return members.map((s) => s.trim()).filter((s) => /^(?:W\/)?"[^"]*"$/.test(s));
}
const rawMembers = (value) => (value.match(/(?:[^,"]|"[^"]*")+/g) || []).map((s) => s.trim()).filter(Boolean);
const STRICT_TAG = /^(?:W\/)?"[^"]*"$/;
const opaqueOf = (t) => t.replace(/^W\//, '');
const norm = (t) => opaqueOf(t.trim()).replace(/^"(.*)"$/, '$1');

// ---------- the echo classifiers ----------
// etagEcho(sent, received): how the If-None-Match value relates to the ETag the client last received in a 200 (null if either is absent).
export function etagEcho(sentRaw, receivedRaw) {
  if (sentRaw == null) return null;
  if (receivedRaw == null) return 'other'; // a tag sent although no 200 ever carried one (curl's empty "", a tag taken from a 304)
  const S = String(sentRaw).trim(); const R = String(receivedRaw).trim();
  if (S === R) return 'verbatim';
  const members = rawMembers(S);
  if (members.length >= 2) {
    const strictOk = STRICT_TAG.test(R) ? listTags(S).includes(R) : members.includes(R);
    if (strictOk) return 'list';
    return 'other';
  }
  if (STRICT_TAG.test(R)) {
    if (R.startsWith('W/') && S === opaqueOf(R)) return 'weak-stripped';
    if (!R.startsWith('W/') && S === `W/${R}`) return 'weak-added';
    if (!R.startsWith('W/') && S === R.slice(1, -1) && !STRICT_TAG.test(S)) return 'quotes-removed';
    return 'other';
  }
  if (S === `"${R}"`) return 'quotes-added';
  return 'other';
}
// dateEcho(sent, received): how the If-Modified-Since value relates to the Last-Modified the client last received in a 200.
export function dateEcho(sentRaw, receivedRaw) {
  if (sentRaw == null) return null;
  const S = String(sentRaw).trim();
  if (receivedRaw == null) return parseHttpDate(S) === null ? 'other' : 'own-clock'; // a date sent although no 200 carried a Last-Modified (the tool's clock, a file's mtime, a Date header)
  const R = String(receivedRaw).trim();
  const pS = parseHttpDate(S); const pR = parseHttpDate(R);
  if (S === R) return pS === null ? 'invalid-echoed' : 'verbatim';
  if (pS === null) return 'other';
  const instantR = pR !== null ? pR : (Number.isNaN(Date.parse(R)) ? null : Date.parse(R)); // an ISO-8601 Last-Modified still names an instant
  if (instantR !== null && instantR === pS) return 'reformatted';
  return 'own-clock';
}

// ---------- exchange normalisation ----------
const REQ_KEYS = ['range', 'if_range', 'if_match', 'if_none_match', 'if_modified_since', 'if_unmodified_since', 'cache_control_req', 'pragma', 'user_agent'];
const RES_KEYS = ['content_range', 'content_length', 'accept_ranges', 'etag', 'last_modified', 'cache_control', 'date', 'age', 'vary', 'expires', 'x_badhttp_flavor', 'x_badhttp_version'];
export function serveExchange(e) {
  const o = { n: e.n ?? null, fetch_n: e.fetch_n ?? null, method: e.method ?? 'GET', path_query: e.path_query ?? null };
  for (const k of REQ_KEYS) o[k] = e[k] ?? null;
  o.status = e.status;
  for (const k of RES_KEYS) o[k] = e[k] ?? null;
  o.body_bytes = e.body_bytes; o.body_sha256 = e.body_sha256 ?? null; o.ms = e.ms ?? null;
  o.client_aborted = e.client_aborted ?? false; o.upstream_error = e.upstream_error ?? null;
  return o;
}

// condOf(exchange) -> none | etag | date | both | if-match
export const condOf = (e) => (e.if_match != null ? 'if-match' : e.if_none_match != null && e.if_modified_since != null ? 'both' : e.if_none_match != null ? 'etag' : e.if_modified_since != null ? 'date' : 'none');

// ---------- the wire of every fetch of one client row ----------
// fetches: [{n, kind, caller, exchanges}]; returns per fetch { wire } plus the row-level adopted_304_validator.
export function wireOf(fetches) {
  const state = { has200: false, etag200: null, lm200: null, tags200: new Set(), tags304: new Set() };
  let adopted = false;
  const out = [];
  for (const f of fetches) {
    const ex = f.exchanges;
    const wire = { requests: ex.length, conditional: ex.length ? condOf(ex[0]) : null, etag_echo: null, date_echo: null, answered: ex.length ? ex[ex.length - 1].status : null };
    let sawInm = false; let sawIms = false;
    if (ex.length) {
      wire.etag_held = state.has200 ? state.etag200 : null; wire.date_held = state.has200 ? state.lm200 : null;
      wire.etag_dropped = wire.etag_held != null && ex[0].if_none_match == null; wire.date_dropped = wire.date_held != null && ex[0].if_modified_since == null;
    }
    for (const e of ex) {
      if (e.if_none_match != null) {
        for (const m of rawMembers(String(e.if_none_match))) { const k = norm(m); if (state.tags304.has(k) && !state.tags200.has(k)) adopted = true; }
        if (!sawInm) {
          sawInm = true;
          wire.etag_sent = e.if_none_match; wire.etag_received = state.has200 ? state.etag200 : null;
          wire.etag_echo = etagEcho(e.if_none_match, wire.etag_received);
        }
      }
      if (e.if_modified_since != null && !sawIms) {
        sawIms = true;
        wire.date_sent = e.if_modified_since; wire.date_received = state.has200 ? state.lm200 : null;
        wire.date_echo = dateEcho(e.if_modified_since, wire.date_received);
      }
      if (e.status === 200) { state.has200 = true; state.etag200 = e.etag ?? null; state.lm200 = e.last_modified ?? null; if (e.etag != null) state.tags200.add(norm(e.etag)); }
      else if (e.status === 304 && e.etag != null) state.tags304.add(norm(e.etag));
    }
    out.push(wire);
  }
  return { wires: out, adopted_304_validator: adopted };
}

// ---------- the description of what the caller received ----------
// doc: { bytes, sha256 } | null. Throws on a caller outcome the vocabulary cannot describe (the caller of this function decides what to do).
export function describeFetch(f, wire, doc, client) {
  const c = f.caller;
  if (c == null) return { kind: 'not-run' };
  const answered = wire.answered;
  const errored = c.error != null || (c.exit != null && c.exit.code != null && c.exit.code !== 0);
  if (errored) return { kind: 'error', error_name: c.error?.name ?? `exit-${c.exit.code}` };
  // A 304 the caller saw with nothing in hand is empty-304. A tool that reports 304 and leaves its stored file (curl --etag-compare, curl -z, wget -N)
  // still has a body, so it falls through to the document check; the status it reported is kept on the description as caller_status.
  if ((c.status === 304 && c.bytes === 0) || (c.bytes === 0 && answered === 304)) return { kind: 'empty-304' };
  if (Number.isInteger(c.status) && c.status !== 200 && c.status !== 304) return { kind: 'other-status', status: c.status, bytes: c.bytes, sha256: c.sha256 };
  if (c.status == null && client.class === 'library-cache') throw new Error(`fetch ${f.n}: a library caller with no status and no error (${c.bytes} bytes) is outside the description vocabulary: extend the vocabulary rather than guess`);
  const cs = c.status === 304 ? { caller_status: 304 } : {};
  if (doc && c.bytes === doc.bytes && c.sha256 === doc.sha256) {
    if (wire.requests === 0) return { kind: 'document', via: 'no-request', ...cs };
    // the tool reported 304 although the last upstream answer was a 200 with a body: it kept its stored copy (curl -z does this when the
    // Last-Modified it reads is not newer than its timestamp)
    if (answered === 200 && (c.status === 304 || c.file_rewritten === false)) return { kind: 'document', via: 'stored-despite-200', ...cs };
    if (answered === 200) return { kind: 'document', via: 'fresh-200' };
    if (answered === 304) return { kind: 'document', via: 'stored-after-304', ...cs };
    throw new Error(`fetch ${f.n}: the caller received the document although the last upstream response was ${answered}: extend the vocabulary rather than guess`);
  }
  if (!doc && c.bytes === 0) throw new Error(`fetch ${f.n}: the caller received an empty 200 with no 304 on the wire and no document to compare to: extend the vocabulary rather than guess`);
  return { kind: 'other-body', bytes: c.bytes, sha256: c.sha256, ...cs };
}
export const outcomeOf = (d) => (d.kind === 'document' ? `document/${d.via}` : d.kind);

// pattern: the three fetches as a compact string
export function patternOf(fetches, wires, descs) {
  return fetches.map((f, i) => {
    const w = wires[i]; const d = descs[i];
    if (d.kind === 'not-run' && !f.exchanges.length) return 'not-run';
    const reqs = f.exchanges.map((e) => `${{ none: '', etag: 'INM', date: 'IMS', both: 'INM+IMS', 'if-match': 'IM' }[condOf(e)]}→${e.status}`);
    let s = reqs.length ? reqs.join(', ') : 'none';
    if (d.kind === 'document' && (d.via === 'stored-after-304' || d.via === 'stored-despite-200')) s += d.via === 'stored-despite-200' ? ' stored(200)' : ' stored';
    else if (d.kind === 'empty-304') s += ' empty-304';
    else if (d.kind === 'other-body') s += ' other-body';
    else if (d.kind === 'other-status') s += ` ${d.status}`;
    else if (d.kind === 'error') s += ' error';
    else if (d.kind === 'not-run') s += ' not-run';
    return s;
  }).join(' | ');
}

// ---------- the reference, from the control exchanges ----------
const RULE_304 = 'RFC 9111 §4.1, §4.3.1 and §4.3.3: a stored no-cache response (§5.2.2.4) is validated before reuse, with If-None-Match carrying the stored ETag and If-Modified-Since the stored Last-Modified value; a 304 indicates that the stored response can be updated and reused (§4.3.3), so the caller is handed the stored document. Which stored response the 304 updates is §4.3.4\'s question, answered by validator_update: confirmed when the 304 repeats the stored validator; none when it carries a different ETag or no validator, in which case §4.3.4 selects nothing to update and RFC 9111 does not say whether the stored response is still handed on — this reference follows §4.3.3\'s reading, and a cache that drops the entry and refetches instead is described as differing from it for that reason.';
const RULE_200 = 'RFC 9111 §4.3.3: a 200 to a validation request replaces the stored response, and the new response is what the cache hands on.';
const RULE_COLD_304 = 'RFC 9110 §15.4.5 defines 304 as the answer to a conditional request, and RFC 9111 §4.3.4 selects no stored response when none exists, so the specification does not say what a cache hands its caller; the rows describe what each cache did.';
export function buildReference(flavor, cold, rev, adopted) {
  const ce = cold.ex; const re = rev.ex;
  const doc = ce.status === 200 ? { bytes: cold.raw.length, sha256: sha(cold.raw) } : null;
  const ref = {
    flavor, source: 'derived from the cold-raw and revalidate-raw control exchanges of this flavor',
    document: doc,
    cold: { status: ce.status, etag: ce.etag ?? null, last_modified: ce.last_modified ?? null, bytes: cold.raw.length },
    revalidate: { sent: { if_none_match: re.if_none_match ?? null, if_modified_since: re.if_modified_since ?? null }, status: re.status, etag: re.etag ?? null, last_modified: re.last_modified ?? null, bytes: rev.raw.length },
    expected_warm_conditional: condOf(re),
    outcome: 'undefined', validator_update: null, next_conditional: null, rule: RULE_COLD_304, note: null,
  };
  if (ce.status === 304) {
    ref.note = 'the cold request was answered 304 although it carried no conditional header, so no document exists for this flavor and no reference outcome is defined';
    return ref;
  }
  if (ce.status !== 200) throw new Error(`cold-raw answered ${ce.status}; the reference needs a 200 or a 304`);
  const notes = [];
  if (re.status === 304) {
    ref.outcome = 'document/stored-after-304'; ref.rule = RULE_304;
    const sameEtag = (re.etag ?? null) === (ce.etag ?? null);
    const sameLm = re.last_modified == null || re.last_modified === ce.last_modified;
    ref.validator_update = sameEtag && sameLm ? 'confirmed' : 'none';
    ref.next_conditional = { if_none_match: ce.etag ?? null, if_modified_since: ce.last_modified ?? null };
    if (ref.validator_update === 'none') notes.push(re.etag == null && ce.etag != null ? 'the 304 carries no ETag, so its validators select no stored response and a cache keeps the stored validator' : 'the 304 carries a different ETag than the one sent, so its validators select no stored response and a cache that keeps its stored validator sends the same tag again');
  } else if (re.status === 200) {
    ref.outcome = 'document/fresh-200'; ref.rule = RULE_200;
    ref.next_conditional = { if_none_match: re.etag ?? null, if_modified_since: re.last_modified ?? null };
    if ((re.etag ?? null) !== (ce.etag ?? null)) notes.push('the 200 carries a different ETag than the cold response, and a cache that stores it sends that tag next');
  } else throw new Error(`revalidate-raw answered ${re.status}; the reference needs a 200 or a 304`);
  if (ce.last_modified != null && parseHttpDate(ce.last_modified) === null) notes.push('the Last-Modified value is not an HTTP-date; RFC 9111 §4.3.1 says to send the stored value, so this reference rests on echoing that value as received, and a cache that drops the unparseable date and refetches is described as differing from it for that reason');
  if (ce.etag != null && !STRICT_TAG.test(ce.etag)) notes.push('the ETag is a bare token without quotes; the reference echoes it as received');
  if (adopted) ref.adopted = { sent: adopted.ex.if_none_match ?? null, status: adopted.ex.status, etag: adopted.ex.etag ?? null };
  ref.note = notes.length ? notes.join('; ') : null;
  return ref;
}

if (isMain) {
  try { main(); } catch (e) { if (/^REFUSED: /.test(e.message)) { console.error(e.message); process.exit(1); } throw e; }
}

function main() {
  const bad = (m) => { throw new Error(`REFUSED: ${m}`); };
  // ---------- input ----------
  let lines;
  try { lines = readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { bad(`cannot read ${SRC} as NDJSON: ${e.message}`); }
  const prov = lines.shift();
  if (!prov || prov.capture !== 'etag') bad('line 1 must be the provenance line with capture: "etag"');
  const rows = lines;
  if (MACHINE.test(JSON.stringify(prov))) bad('the provenance line carries a machine path or local host');
  if (HOST_PORT.test(JSON.stringify(prov))) bad('the provenance line carries a host with a port');
  if (!prov.probed) bad('the provenance line carries no probed date');
  for (const k of ['probed', 'worker_version', 'badhttp_version_observed']) { const w = headerSafe(`provenance ${k}`, prov[k]); if (w) bad(w); }
  { const w = headerSafe('the capture path', SRC); if (w) bad(w); }
  { const w = checkString(JSON.stringify(prov), 'the provenance line'); if (w) bad(w); }
  const LOG_PATH = SRC.replace(/\.jsonl$/, '.log');
  let LOG_TEXT = '';
  try { LOG_TEXT = readFileSync(LOG_PATH, 'utf8'); } catch { bad(`the run log ${LOG_PATH} must be committed beside the capture`); }
  if (MACHINE.test(LOG_TEXT)) bad(`the run log ${LOG_PATH} carries a machine path or local host`);
  { const w = checkString(LOG_TEXT, `the run log ${LOG_PATH}`, { verdict: false }); if (w) bad(w); }
  if (HOST_PORT.test(LOG_TEXT)) bad(`the run log ${LOG_PATH} carries a host with a port`);
  for (const m of LOG_TEXT.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`the run log names the host ${m[1]}`);
  for (const m of JSON.stringify(prov).matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`the provenance line names the host ${m[1]}`);

  // ---------- per-row checks ----------
  const label = (r) => `${r.client?.id ?? '?'}/${r.flavor}/${r.scenario}`;
  const seen = new Set(); const seenIds = new Set();
  const clients = new Map(); // id -> { meta, cells:Set }
  const strip = (r) => { const o = { ...r }; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; } return o; };
  const checkText = (L, v) => {
    const text = JSON.stringify(v);
    { const w = checkString(text, `${L}: row`); if (w) bad(w); }
    if (MACHINE.test(text)) bad(`${L}: row carries a machine path or local host`);
    if (HOST_PORT.test(text)) bad(`${L}: row carries a host with a port`);
    for (const m of text.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`${L}: foreign host ${m[1]}`);
    if (VERDICT_WORDS.test(text)) bad(`${L}: a verdict word reached a row: ${text.match(VERDICT_WORDS)[0]}`);
  };
  const checkExchange = (L, r, e, where) => {
    if (!e || typeof e !== 'object') bad(`${L}: ${where} is not an exchange`);
    if (!e.x_badhttp_version) bad(`${L}: ${where} has no x-badhttp-version (rate limit or edge response recorded as the client's; the harness retries those)`);
    if (e.x_badhttp_flavor != null && e.x_badhttp_flavor !== r.flavor) bad(`${L}: ${where} answered as flavor ${e.x_badhttp_flavor}`);
    if (e.upstream_error != null) bad(`${L}: ${where} recorded upstream_error ${JSON.stringify(String(e.upstream_error).slice(0, 80))}; a recorder or upstream failure is not the client's observation (the harness retries those)`);
    if (!Number.isInteger(e.status) || !Number.isInteger(e.body_bytes)) bad(`${L}: ${where} lacks an integer status / body_bytes`);
    if (typeof e.path_query !== 'string' || !(e.path_query === `/etag/${r.flavor}` || e.path_query.startsWith(`/etag/${r.flavor}?`))) bad(`${L}: ${where} requested ${JSON.stringify(e.path_query)}, not /etag/${r.flavor}`);
  };
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !r.client || !r.client.id) bad(`row without client.id: ${JSON.stringify(r).slice(0, 120)}`);
    const L = label(r);
    if (!FLAVOR_ORDER.includes(r.flavor)) bad(`${L}: unknown flavor ${r.flavor}`);
    if (r.family !== 'etag') bad(`${L}: family ${r.family} is not etag`);
    if (!ROLES.includes(r.client.role)) bad(`${L}: client role ${r.client.role} not in vocabulary`);
    if (!CLASSES.includes(r.client.class)) bad(`${L}: client class ${r.client.class} not in vocabulary`);
    const isControl = r.client.role === 'control';
    if (isControl !== (r.client.class === 'raw')) bad(`${L}: role ${r.client.role} with class ${r.client.class} (controls are raw, clients are not)`);
    if (!(isControl ? CONTROL_SCENARIOS : [CLIENT_SCENARIO]).includes(r.scenario)) bad(`${L}: scenario ${r.scenario} not in the vocabulary for a ${r.client.role}`);
    if (r.corpus_id !== `etag.${r.flavor}`) bad(`${L}: corpus_id ${r.corpus_id} is not etag.${r.flavor}`);
    if (r.id !== `etag.${r.flavor}.${r.scenario}.${r.client.id}`) bad(`${L}: id ${r.id} is not etag.${r.flavor}.${r.scenario}.${r.client.id}`);
    if (seenIds.has(r.id)) bad(`${L}: duplicate row id ${r.id}`);
    seenIds.add(r.id);
    const key = `${r.client.id}\u0000${r.flavor}\u0000${r.scenario}`;
    if (seen.has(key)) bad(`duplicate observation ${L}: one row per (client, flavor, scenario)`);
    seen.add(key);
    if (r.url !== `https://badhttp.dev/etag/${r.flavor}`) bad(`${L}: url ${JSON.stringify(r.url)} is not https://badhttp.dev/etag/${r.flavor}`);
    if (!ENDS.includes(r.end)) bad(`${L}: end "${r.end}" not in vocabulary`);
    if (!Number.isInteger(r.attempts) || r.attempts < 1 || r.attempts > 3) bad(`${L}: attempts ${r.attempts} is not 1..3`);
    checkText(L, strip(r));
    if (isControl) {
      if (!Array.isArray(r.exchanges)) bad(`${L}: exchanges is not a list`);
      if (r.exchanges.length !== 1) bad(`${L}: a control row holds exactly one exchange, found ${r.exchanges.length}`);
      checkExchange(L, r, r.exchanges[0], 'the exchange');
    } else {
      if (r.request_failed === true) {
        const n = (r.fetches ?? []).reduce((s, f) => s + (f.exchanges?.length ?? 0), 0) + (r.exchanges?.length ?? 0);
        if (n !== 0 || (r.fetches ?? []).some((f) => f.caller != null)) bad(`${L}: request_failed with exchanges or fetch results (an edge 429 is never recorded as an exchange)`);
      } else {
        if (!Array.isArray(r.fetches)) bad(`${L}: fetches is not a list`);
        if (r.fetches.length > 3 || r.fetches.length < 1) bad(`${L}: ${r.fetches.length} fetches (a client row holds three)`);
        if (r.fetches.length !== 3 && r.end !== 'harness-timeout') bad(`${L}: ${r.fetches.length} fetches on a row whose end is ${r.end} (only a harness-timeout row may hold fewer than three)`);
        let lateSeen = 0; let notRunSeen = false;
        r.fetches.forEach((f, i) => {
          if (f.n !== i + 1) bad(`${L}: fetch ${i + 1} is numbered ${f.n}`);
          if (!FETCH_KINDS.includes(f.kind)) bad(`${L}: fetch ${f.n} kind "${f.kind}" not in vocabulary`);
          if (f.kind !== FETCH_KINDS[i]) bad(`${L}: fetch ${f.n} has kind ${f.kind}, expected ${FETCH_KINDS[i]}`);
          if (!Array.isArray(f.exchanges)) bad(`${L}: fetch ${f.n} exchanges is not a list`);
          if ('description' in f && !(f.description && DESCRIPTIONS.includes(f.description.kind ?? f.description))) bad(`${L}: fetch ${f.n} description ${JSON.stringify(f.description)} is not in the vocabulary (${DESCRIPTIONS.join(' | ')})`);
          if ('conditional' in f && !CONDITIONALS.includes(f.conditional)) bad(`${L}: fetch ${f.n} conditional "${f.conditional}" not in vocabulary`);
          if (f.caller == null) { if (r.end !== 'harness-timeout') bad(`${L}: fetch ${f.n} has no caller result on a row whose end is ${r.end}`); notRunSeen = true; }
          else {
            if (notRunSeen) bad(`${L}: fetch ${f.n} completed after an earlier fetch did not`);
            const c = f.caller;
            if (!(c.status === null || Number.isInteger(c.status))) bad(`${L}: fetch ${f.n} caller.status ${JSON.stringify(c.status)} is not an integer or null`);
            if (!Number.isInteger(c.bytes) || c.bytes < 0) bad(`${L}: fetch ${f.n} caller.bytes ${JSON.stringify(c.bytes)} is not a count`);
            if (typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) bad(`${L}: fetch ${f.n} caller.sha256 is not a hex digest`);
            if (c.bytes === 0 && c.sha256 !== EMPTY_SHA) bad(`${L}: fetch ${f.n} caller reports 0 bytes with sha256 ${c.sha256}, which is not the hash of an empty body`);
            if (c.error != null && (typeof c.error !== 'object' || !c.error.name)) bad(`${L}: fetch ${f.n} caller.error carries no name`);
          }
          f.exchanges.forEach((e, j) => {
            const where = `exchange ${j + 1} of fetch ${f.n}`;
            checkExchange(L, r, e, where);
            if (e.fetch_n == null) { lateSeen += 1; return; }
            if (e.fetch_n !== f.n) bad(`${L}: ${where} is attributed to fetch ${e.fetch_n}`);
          });
        });
        for (const e of r.exchanges_after ?? []) checkExchange(L, r, e, 'a late exchange');
        const claimed = r.exchanges_after_result ?? 0;
        if (!Number.isInteger(claimed) || claimed < 0) bad(`${L}: exchanges_after_result ${JSON.stringify(r.exchanges_after_result)} is not a count`);
        if (lateSeen > 0 && lateSeen > claimed) bad(`${L}: ${lateSeen} exchange(s) carry no fetch_n and the row counts ${claimed} in exchanges_after_result (an exchange must be attributed to a fetch or counted as late)`);
        if (r.exchanges_after != null && r.exchanges_after.length !== claimed - lateSeen) bad(`${L}: exchanges_after lists ${r.exchanges_after.length} but exchanges_after_result is ${claimed}`);
        if (r.exchanges_after == null && claimed > lateSeen) bad(`${L}: exchanges_after_result is ${claimed} but only ${lateSeen} unattributed exchange(s) are recorded`);
        if (r.fetches[0].caller != null || r.fetches[0].exchanges.length) { /* ok */ } else if (r.end !== 'harness-timeout') bad(`${L}: the cold fetch has neither a result nor an exchange`);
      }
      if (typeof r.client.configuration !== 'string' || !r.client.configuration) bad(`${L}: client.configuration must be a non-empty string naming what the harness handed the client`);
    }
    if (!clients.has(r.client.id)) clients.set(r.client.id, { meta: r.client, cells: new Set() });
    else {
      const m0 = clients.get(r.client.id).meta;
      for (const k of CLIENT_FIELDS) if ((m0[k] ?? null) !== (r.client[k] ?? null)) bad(`${L}: client ${r.client.id} has ${k} ${JSON.stringify(r.client[k] ?? null)} here and ${JSON.stringify(m0[k] ?? null)} in another row`);
    }
    clients.get(r.client.id).cells.add(`${r.flavor}/${r.scenario}`);
  }
  if (!rows.length) bad('the capture holds no rows');

  // ---------- roster and grid ----------
  const controlIds = [...clients.values()].filter((c) => c.meta.role === 'control').map((c) => c.meta.id);
  if (controlIds.length !== 1) bad(`exactly one roster entry must have role control; found ${controlIds.length}${controlIds.length ? ` (${controlIds.join(', ')})` : ''}`);
  const cl = [...clients.values()].filter((c) => c.meta.role === 'client');
  if (cl.length < MIN_CLIENTS) bad(`${cl.length} client-role clients: a published capture holds at least ${MIN_CLIENTS}`);
  const CELLS = FLAVOR_ORDER.map((f) => `${f}/${CLIENT_SCENARIO}`);
  for (const c of cl) {
    const missing = CELLS.filter((x) => !c.cells.has(x));
    if (missing.length) bad(`client ${c.meta.id} is missing cells: ${missing.join(', ')} (a published capture is the full ${CELLS.length}-cell grid)`);
    if (c.cells.size !== CELLS.length) bad(`client ${c.meta.id} holds ${c.cells.size} cells, expected ${CELLS.length}`);
  }
  const ctl = clients.get(controlIds[0]);
  const wantCtl = [...FLAVOR_ORDER.flatMap((f) => [`${f}/cold-raw`, `${f}/revalidate-raw`]), 'mismatch/revalidate-adopted-raw'];
  const missingCtl = wantCtl.filter((c) => !ctl.cells.has(c));
  if (missingCtl.length) bad(`the control ${controlIds[0]} is missing: ${missingCtl.join(', ')} (every flavor needs its cold-raw and revalidate-raw rows, mismatch its revalidate-adopted-raw row)`);
  if (ctl.cells.size !== wantCtl.length) bad(`the control holds ${ctl.cells.size} rows, expected ${wantCtl.length}: ${[...ctl.cells].filter((c) => !wantCtl.includes(c)).join(', ')}`);
  if (rows.length !== cl.length * CELLS.length + wantCtl.length) bad(`${rows.length} rows for ${cl.length} clients x ${CELLS.length} cells + ${wantCtl.length} control rows: the grid is not complete`);
  if (prov.clients_run != null && prov.clients_run !== clients.size) bad(`provenance says clients_run ${prov.clients_run}, the rows hold ${clients.size} roster entries`);
  if (prov.flavors_run != null && prov.flavors_run !== FLAVOR_ORDER.length) bad(`provenance says flavors_run ${prov.flavors_run}, the parser knows ${FLAVOR_ORDER.length} flavors`);

  // Every exchange of every row, late ones included: a deploy mid-capture can change the version between requests.
  const allExchanges = (r) => [...(r.exchanges ?? []), ...(r.fetches ?? []).flatMap((f) => f.exchanges), ...(r.exchanges_after ?? [])];
  const versions = new Set(rows.flatMap((r) => allExchanges(r).map((e) => e.x_badhttp_version)));
  if (versions.size !== 1) bad(`rows span badhttp versions ${[...versions].join(', ')}: a deploy happened mid-capture`);
  const BADHTTP_VERSION = [...versions][0];
  { const w = headerSafe('the observed badhttp version', BADHTTP_VERSION); if (w) bad(w); }
  for (const r of rows) if (r.badhttp_version != null && r.badhttp_version !== BADHTTP_VERSION) bad(`${label(r)}: badhttp_version ${r.badhttp_version} differs from the exchanges' ${BADHTTP_VERSION}`);
  if (prov.badhttp_version_observed != null && prov.badhttp_version_observed !== BADHTTP_VERSION) bad(`provenance says badhttp ${prov.badhttp_version_observed}, the exchanges say ${BADHTTP_VERSION}`);

  // ---------- the controls ----------
  const ctlRow = new Map(); // `${flavor}/${scenario}` -> { row, raw, ex }
  const DOC_HEAD = (f) => `This is /etag/${f} on badhttp: a fixed document for testing conditional requests.\n`;
  const DOC_TAIL = 'The body never changes; whether you receive it again is the game.\nSend If-None-Match / If-Modified-Since / If-Match and watch what comes back.\n';
  for (const r of rows.filter((x) => x.client.role === 'control')) {
    const L = label(r);
    if (!r.control || typeof r.control.raw_base64 !== 'string') bad(`${L}: control carries no raw_base64`);
    const raw = Buffer.from(r.control.raw_base64, 'base64');
    if (sha(raw) !== r.control.raw_sha256) bad(`${L}: control raw bytes do not hash to raw_sha256`);
    if (r.control.raw_bytes != null && r.control.raw_bytes !== raw.length) bad(`${L}: control raw_bytes ${r.control.raw_bytes} but the raw bytes are ${raw.length}`);
    if (r.control.curl_exit !== 0) bad(`${L}: the control's curl exited ${r.control.curl_exit}, so it is not an observation`);
    const e = r.exchanges[0];
    if (e.body_bytes !== raw.length) bad(`${L}: the exchange forwarded ${e.body_bytes} body bytes but the control holds ${raw.length}`);
    if (e.body_sha256 != null && e.body_sha256 !== r.control.raw_sha256) bad(`${L}: the exchange's body hash differs from the control's raw_sha256`);
    if (r.control.status != null && r.control.status !== e.status) bad(`${L}: control.status ${r.control.status} but the exchange answered ${e.status}`);
    if (r.control.etag !== undefined && (r.control.etag ?? null) !== (e.etag ?? null)) bad(`${L}: control.etag differs from the exchange's`);
    if (r.control.last_modified !== undefined && (r.control.last_modified ?? null) !== (e.last_modified ?? null)) bad(`${L}: control.last_modified differs from the exchange's`);
    if (e.if_match != null || e.range != null) bad(`${L}: the control sent If-Match or Range`);
    ctlRow.set(`${r.flavor}/${r.scenario}`, { row: r, raw, ex: e });
  }
  const REF = {};
  const DOCS = {};
  for (const f of FLAVOR_ORDER) {
    const cold = ctlRow.get(`${f}/cold-raw`); const rev = ctlRow.get(`${f}/revalidate-raw`);
    const L = `curl-raw/${f}`;
    if (cold.ex.if_none_match != null || cold.ex.if_modified_since != null) bad(`${L}/cold-raw: the cold control sent a conditional header`);
    if (cold.ex.status === 200) {
      const txt = cold.raw.toString('latin1');
      if (!txt.startsWith(DOC_HEAD(f)) || !txt.endsWith(DOC_TAIL) || cold.raw.length < DOC_HEAD(f).length + DOC_TAIL.length) bad(`${L}/cold-raw: the body is not the /etag/${f} document the format in src/etag.js describes`);
    } else if (cold.ex.status === 304) {
      if (cold.raw.length !== 0) bad(`${L}/cold-raw: a 304 with ${cold.raw.length} body bytes`);
    } else bad(`${L}/cold-raw: answered ${cold.ex.status}, expected 200 or 304`);
    // revalidate-raw must follow RFC 9111 §4.3.1 from what cold-raw received, verbatim
    const wantInm = cold.ex.etag ?? null; const wantIms = cold.ex.last_modified ?? null;
    if ((rev.ex.if_none_match ?? null) !== wantInm) bad(`${L}/revalidate-raw: If-None-Match ${JSON.stringify(rev.ex.if_none_match ?? null)} is not the ETag cold-raw received (${JSON.stringify(wantInm)})`);
    if ((rev.ex.if_modified_since ?? null) !== wantIms) bad(`${L}/revalidate-raw: If-Modified-Since ${JSON.stringify(rev.ex.if_modified_since ?? null)} is not the Last-Modified cold-raw received (${JSON.stringify(wantIms)})`);
    if (rev.ex.status === 200 && cold.ex.status === 200 && rev.ex.body_sha256 !== sha(cold.raw)) bad(`${L}/revalidate-raw: the 200 body differs from the cold document`);
    let adopted = null;
    if (f === 'mismatch') {
      adopted = ctlRow.get('mismatch/revalidate-adopted-raw');
      if (rev.ex.status !== 304 || rev.ex.etag == null) bad(`${L}/revalidate-adopted-raw: needs a mismatch revalidate-raw answered 304 with an ETag`);
      if ((adopted.ex.if_none_match ?? null) !== rev.ex.etag) bad(`${L}/revalidate-adopted-raw: If-None-Match ${JSON.stringify(adopted.ex.if_none_match ?? null)} is not the ETag the 304 carried (${JSON.stringify(rev.ex.etag)})`);
      if (adopted.ex.if_modified_since != null) bad(`${L}/revalidate-adopted-raw: carries If-Modified-Since`);
    }
    const ref = buildReference(f, cold, rev, adopted);
    if (!REF_OUTCOMES.includes(ref.outcome)) bad(`${L}: reference outcome ${ref.outcome} outside the vocabulary`);
    REF[f] = ref; DOCS[f] = ref.document;
  }

  // ---------- client rows ----------
  const roleOf = (r) => r.client.role;
  const OBS = [];
  for (const r of rows) {
    const L = label(r);
    const o = strip(r);
    o.license = 'CC0-1.0';
    if (roleOf(r) === 'control') {
      const c = ctlRow.get(`${r.flavor}/${r.scenario}`);
      o.exchanges = r.exchanges.map(serveExchange);
      o.control = { raw_bytes: c.raw.length, raw_sha256: r.control.raw_sha256, status: c.ex.status, etag: c.ex.etag ?? null, last_modified: c.ex.last_modified ?? null, curl_exit: r.control.curl_exit };
      o.outcome = 'control'; o.pattern = null; o.adopted_304_validator = null; o.outcome_vs_reference = null; o.reference = null;
      OBS.push(o);
      continue;
    }
    const ref = REF[r.flavor];
    const doc = DOCS[r.flavor];
    o.control = null;
    o.reference = { outcome: ref.outcome, expected_warm_conditional: ref.expected_warm_conditional, validator_update: ref.validator_update, note: ref.note };
    if (r.request_failed === true) {
      o.fetches = []; o.exchanges_after_result = r.exchanges_after_result ?? 0;
      o.outcome = 'request-failed'; o.pattern = null; o.adopted_304_validator = false; o.outcome_vs_reference = null;
      OBS.push(o);
      continue;
    }
    const attributed = r.fetches.map((f) => ({ ...f, exchanges: f.exchanges.filter((e) => e.fetch_n != null) }));
    const late = [...r.fetches.flatMap((f) => f.exchanges.filter((e) => e.fetch_n == null)), ...(r.exchanges_after ?? [])];
    const { wires, adopted_304_validator } = wireOf(attributed);
    const descs = attributed.map((f, i) => {
      try { return describeFetch(f, wires[i], doc, r.client); } catch (err) { return bad(`${L}: ${err.message}`); }
    });
    if (descs[0].kind === 'document' && descs[0].via === 'no-request') bad(`${L}: the cold fetch handed the caller the document with no upstream request: the cache was not empty`);
    for (const d of descs) {
      if (!DESCRIPTIONS.includes(d.kind) || (d.via && !VIAS.includes(d.via))) bad(`${L}: description ${JSON.stringify(d)} outside the vocabulary`);
    }
    wires.forEach((w) => {
      if (w.conditional != null && !CONDITIONALS.includes(w.conditional)) bad(`${L}: conditional ${w.conditional} outside the vocabulary`);
      if (w.etag_echo != null && !ETAG_ECHOES.includes(w.etag_echo)) bad(`${L}: etag_echo ${w.etag_echo} outside the vocabulary`);
      if (w.date_echo != null && !DATE_ECHOES.includes(w.date_echo)) bad(`${L}: date_echo ${w.date_echo} outside the vocabulary`);
    });
    // pad to three fetches: fetches the cap fired before are not-run
    const padded = [];
    for (let i = 0; i < 3; i++) {
      if (i < attributed.length) {
        const f = r.fetches[i];
        const { description: _d, conditional: _c, wire: _w, ...rest } = f;
        padded.push({ ...rest, caller: f.caller, exchanges: attributed[i].exchanges.map(serveExchange), wire: wires[i], description: descs[i] });
      } else {
        padded.push({ n: i + 1, kind: FETCH_KINDS[i], caller: null, exchanges: [], wire: { requests: 0, conditional: null, etag_echo: null, date_echo: null, answered: null }, description: { kind: 'not-run' } });
      }
    }
    o.fetches = padded;
    o.late_exchanges = late.map(serveExchange);
    o.exchanges_after_result = r.exchanges_after_result ?? 0;
    delete o.exchanges_after;
    const warm = descs[1] && descs[1].kind !== 'not-run' ? descs[1] : null;
    o.outcome = warm ? outcomeOf(warm) : 'harness-timeout';
    if (!OUTCOMES.includes(o.outcome)) bad(`${L}: outcome ${o.outcome} outside the vocabulary`);
    o.pattern = patternOf(padded, padded.map((f) => f.wire), padded.map((f) => f.description));
    o.adopted_304_validator = adopted_304_validator;
    o.outcome_vs_reference = o.outcome === 'harness-timeout' ? null : ref.outcome === 'undefined' ? 'undefined' : o.outcome === ref.outcome ? 'as-reference' : 'differs';
    if (o.outcome_vs_reference != null && !VS_REFERENCE.includes(o.outcome_vs_reference)) bad(`${L}: outcome_vs_reference ${o.outcome_vs_reference} outside the vocabulary`);
    OBS.push(o);
  }
  OBS.sort((a, b) => FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor) || (b.client.role === 'control') - (a.client.role === 'control') || SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario) || a.client.id.localeCompare(b.client.id));

  // ---------- disagreement: distinct (outcome, conditional, etag_echo, date_echo) answers among client rows, per flavor ----------
  const answers = {};
  for (const o of OBS) {
    if (o.client.role !== 'client') continue;
    const w = o.fetches[1]?.wire;
    const a = `${o.outcome} | ${w?.conditional ?? '-'} | ${w?.etag_echo ?? '-'} | ${w?.date_echo ?? '-'}`;
    ((answers[o.flavor] ??= {})[a] ??= []).push(o.client.id);
  }
  const disagreement_by_flavor = {}; const answers_by_flavor = {};
  for (const k of FLAVOR_ORDER) {
    disagreement_by_flavor[k] = Object.keys(answers[k] || {}).length;
    answers_by_flavor[k] = Object.entries(answers[k] || {}).map(([answer, who]) => ({ answer, clients: who.sort() }));
  }

  // ---------- emit ----------
  const roster = [...clients.values()].map((c) => c.meta);
  roster.sort((a, b) => (a.role === 'control' ? -1 : b.role === 'control' ? 1 : a.id.localeCompare(b.id)));
  const CLIENTS = roster.map((m) => ({ id: m.id, name: m.name, role: m.role, class: m.class, version: m.version, library: m.library ?? null, runtime: m.runtime ?? null, platform: m.platform, invocation: m.invocation ?? null, configuration: m.configuration ?? null, requests_recorded_by: m.requests_recorded_by ?? null }));
  const counts = {};
  for (const o of OBS) if (o.client.role === 'client') counts[o.outcome] = (counts[o.outcome] || 0) + 1;
  const synthetic = prov.synthetic === true;
  // not_in_roster: [{client, reason}] from the provenance line, passed through to the index (what was left out and why)
  if (prov.not_in_roster != null && !Array.isArray(prov.not_in_roster)) bad('provenance not_in_roster must be a list of {client, reason}');
  const NOT_IN_ROSTER = (prov.not_in_roster ?? []).map((e, i) => {
    if (!e || typeof e !== 'object' || typeof e.client !== 'string' || !e.client.trim() || typeof e.reason !== 'string' || !e.reason.trim()) bad(`not_in_roster entry ${i + 1} needs both a client and a reason`);
    if (e.reason.trim().length < 20) bad(`not_in_roster entry ${i + 1} (${e.client}): the reason is ${e.reason.trim().length} characters, at least 20 are needed so the index can print it`);
    for (const [k, v] of [['client', e.client], ['reason', e.reason]]) { const w = checkString(v, `not_in_roster entry ${i + 1} ${k}`); if (w) bad(w); }
    return { client: e.client.trim(), reason: e.reason.trim() };
  });
  const sourceFile = SRC.replace(/^.*?docs\//, 'docs/');
  const witness = {
    family: 'etag', ...(synthetic ? { synthetic: true } : {}), probed: prov.probed, badhttp_version_observed: BADHTTP_VERSION, worker_version: prov.worker_version || null,
    flavors: FLAVOR_ORDER.length, clients: cl.length, cells_per_client: CELLS.length, fetches_per_cell: 3, scenario: CLIENT_SCENARIO,
    not_in_roster: NOT_IN_ROSTER,
    documents: Object.fromEntries(FLAVOR_ORDER.map((f) => [f, DOCS[f]])),
    outcomes: counts, disagreement_by_flavor, answers_by_flavor,
    vocabulary: { outcomes: OUTCOMES, descriptions: DESCRIPTIONS, vias: VIAS, conditionals: CONDITIONALS, etag_echo: ETAG_ECHOES, date_echo: DATE_ECHOES, outcome_vs_reference: VS_REFERENCE, classes: CLASSES, fetch_kinds: FETCH_KINDS },
    source_file: sourceFile, run_log: sourceFile.replace(/\.jsonl$/, '.log'), capture_scripts: 'scripts/etag-witness/',
  };
  const REFERENCE_OUT = REF;
  const served = { witness, CLIENTS, REFERENCE_OUT, OBS };
  const all = JSON.stringify(served);
  if (VERDICT_WORDS.test(all)) bad(`a verdict word reached the emitted data: ${all.match(VERDICT_WORDS)[0]}`);
  if (MACHINE.test(all)) bad('the emitted data carries a machine path or local host');
  if (HOST_PORT.test(all)) bad('the emitted data carries a host with a port');
  for (const m of all.matchAll(/\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi)) if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) bad(`the emitted data names the host ${m[1]}`);

  const header = `${synthetic ? '// SYNTHETIC PLACEHOLDER\n' : ''}// GENERATED by scripts/witness-parse-etag.mjs from ${witness.source_file} — do not edit by hand.
// Re-run the generator after any new capture: node scripts/witness-parse-etag.mjs ${witness.source_file}; the capture scripts are in scripts/etag-witness/.
//
// ${witness.clients} real HTTP caches (libraries, command-line tools, proxies) plus a raw-wire control (curl), one fresh working directory and one fresh cache per
// cell: each fetches GET /etag/{flavor} three times in a row (cold, warm, warm-again) for each of ${FLAVOR_ORDER.length} flavors, on ${witness.probed}
// against badhttp ${BADHTTP_VERSION}${witness.worker_version ? ` (Worker deployment ${witness.worker_version})` : ''}. The harness never sends a conditional header for a client.
// THE ORACLE IS THE CONTROL'S EXCHANGES, NEVER TYPED: REFERENCE_ETAG is read from each flavor's cold-raw and revalidate-raw control rows, and
// each row's outcome describes what the cache sent and what it handed its caller relative to that reference. Never a verdict.
// Outcomes (the warm fetch): document/fresh-200 | document/stored-after-304 | document/no-request | document/stored-despite-200 | empty-304 | other-body | other-status | error |
// harness-timeout | request-failed. Per fetch: wire { requests, conditional (none|etag|date|both|if-match), etag_echo (verbatim|weak-stripped|
// weak-added|quotes-added|quotes-removed|list|other), date_echo (verbatim|reformatted|own-clock|invalid-echoed|other), answered } and
// description { document via fresh-200|stored-after-304|no-request|stored-despite-200 | empty-304 | other-body | other-status | error | not-run }. outcome_vs_reference:
// as-reference | differs | undefined.
`;
  const lit = (name, v) => `export const ${name} = ${JSON.stringify(v, null, 2)};\n`;
  const text = `${header}\n${lit('WITNESS_ETAG', witness)}\n${lit('CLIENTS_ETAG', CLIENTS)}\n${lit('REFERENCE_ETAG', REFERENCE_OUT)}\n${lit('OBSERVATIONS_ETAG', OBS)}`;
  if (VERDICT_WORDS.test(text)) bad(`a verdict word reached the generated file: ${text.match(VERDICT_WORDS)[0]}`);
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}: ${OBS.length} rows (${cl.length} clients x ${CELLS.length} cells + ${wantCtl.length} control rows), badhttp ${BADHTTP_VERSION}, outcomes ${JSON.stringify(counts)}`);
  console.log(`disagreement_by_flavor ${JSON.stringify(disagreement_by_flavor)}`);
}

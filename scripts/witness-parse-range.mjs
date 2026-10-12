#!/usr/bin/env node
// Turns the /range witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-range-clients-<date>.jsonl — the raw capture, committed, re-runnable from scripts/range-witness/.
//         Line 1 is provenance; every other line is one cell: a client row or a control row (docs/spec-range-witness.md).
// Output: src/witness-range-data.js — a generated literal (override the path with RANGE_WITNESS_OUT for tests).
//
//   node scripts/witness-parse-range.mjs docs/probe-range-clients-2026-10-12.jsonl
//
// THE ORACLE IS THE CONTROL'S BYTES PLUS THE DOCUMENT'S OWN SELF-DESCRIPTION, NEVER TYPED. The `document` control row carries the
// 1,000 bytes of /range/ok?length=1000; this script rebuilds the same bytes from the line format documented in src/range.js and
// refuses if the two differ. Each flavor's `resume-raw` control row carries the bytes (and the exchange) the server sent to
// `Range: bytes=400-`. The REFERENCE for a flavor is where RFC 9110 says those bytes belong (referencePlacement): a 200 replaces the
// partial with the whole representation, a 206 with `Content-Range: bytes a-b/t` puts its body at offset a, a 206 without
// Content-Range has no defined offset, a 416 places nothing. Every client row is then described relative to that reference and to
// the true document, by reading each 64-byte line's embedded offset and generation in the file the client left on disk.
//
// Outcome legend (descriptions of the file and the exit): complete (the file is the document; `transfer` says resumed / restarted /
// restarted-after-range / fresh), refused (the partial untouched and an error reported), unchanged (the partial untouched and NO error
// reported: the client wrote nothing and said nothing), corrupt (any other file that is not an error-reported prefix, with a `shape`:
// duplicated-prefix, shifted, short [a correct prefix, no error], body-only [the file is the deciding exchange's body alone, the partial
// discarded], mixed-generation, suffix-misplaced, other), incomplete-reported (a correct prefix and an error reported), harness-timeout
// (the 30 s cap fired), request-failed (the recorder saw no response).
//
// `outcome` is a description of the file and the exit, never a verdict: a downloader that restarts on a 200 and one that refuses
// to continue both do something the specification allows. The verdict words are banned from every string this file emits
// (smoke greps for them).
//
// Refusals (the generator exits non-zero rather than emit): a client missing a cell of the 15-cell grid, a duplicate
// (client, flavor, scenario) or duplicate row id, a flavor missing its control (resume-raw per flavor, fresh-raw for always-206, one
// document row), a row any of whose exchanges has no x-badhttp-version (or names another flavor), rows spanning two badhttp
// versions, a row/provenance/run log carrying a machine path, a loopback literal or a host other than badhttp.dev, a partial whose
// hash is not the first 400 bytes of the control document, a control whose raw bytes do not hash to raw_sha256 (or to its
// exchange's body hash), a file_base64 that does not hash to file.sha256, an end / exit.kind / class / scenario outside the
// vocabulary, a document row that differs from the format in src/range.js, fewer than 5 resumer clients, a verdict word in any
// served string, an absolute or parent-relative capture path.

import { readFileSync, writeFileSync } from 'node:fs';
import { VERDICT_WORDS, checkString, headerSafe } from './witness-gate.mjs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const OUT = process.env.RANGE_WITNESS_OUT || 'src/witness-range-data.js';
const isMain = process.argv[1] && /witness-parse-range\.mjs$/.test(process.argv[1]);
const SRC = isMain ? process.argv[2] : null;
if (isMain && !SRC) throw new Error('usage: node scripts/witness-parse-range.mjs <capture.jsonl>');
// source_file and run_log are written into the committed data file, so the capture path must be repo-relative:
if (isMain && (isAbsolute(SRC) || SRC.split(/[\\/]/).includes('..'))) throw new Error(`refusing to emit: ${SRC} must be a repo-relative path (the path is written into ${OUT})`);

export const FLAVOR_ORDER = ['ok', 'ignore', 'advertise-only', 'off-by-one', 'shifted', 'suffix-as-prefix', 'from-zero', 'wrong-total', 'no-content-range', 'always-206', '200-content-range', 'always-416', 'unknown-total', 'if-range-ignored'];
const DOC_LEN = 1000;       // ?length=1000, the default
const PARTIAL_BYTES = 400;  // the first six 64-byte lines plus 16 bytes of the seventh
const LINE = 64;
const MIN_RESUMERS = 5;
const CLIENT_SCENARIOS = ['resume', 'fresh'];
const CONTROL_SCENARIOS = ['resume-raw', 'fresh-raw', 'document'];
const SCENARIO_ORDER = ['document', 'resume-raw', 'fresh-raw', 'resume', 'fresh'];
// The cells every resumer must hold: fourteen flavors x resume, plus always-206 x fresh.
const CLIENT_CELLS = [...FLAVOR_ORDER.map((f) => [f, 'resume']), ['always-206', 'fresh']];
const CLASSES = ['resumer', 'raw'];
const ROLES = ['client', 'control'];
const ENDS = ['exited', 'harness-timeout'];
const EXIT_KINDS = ['exit-code', 'return', 'raised'];
const OUTCOMES = ['complete', 'refused', 'unchanged', 'corrupt', 'incomplete-reported', 'harness-timeout', 'request-failed'];
const SHAPES = ['duplicated-prefix', 'shifted', 'short', 'body-only', 'mixed-generation', 'suffix-misplaced', 'other'];
// The machine, host and verdict-word gate is shared with the other generators: scripts/witness-gate.mjs.

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- the document, from the format documented in src/range.js ----------
// Line k covers [64k, 64k+63] and reads "{offset:08d} {length:08d} badhttp range body {gen}" padded with '.' to 63 chars, then "\n";
// the final line is cut at length. All ASCII. This is a second implementation of the format, so the control's bytes are checked
// against the documented structure rather than against themselves.
const docCache = new Map();
export function formatDocument(length, gen = 'g1') {
  const key = `${length}/${gen}`;
  if (!docCache.has(key)) {
    let s = '';
    for (let k = 0; k * LINE < length; k++) s += `${String(k * LINE).padStart(8, '0')} ${String(length).padStart(8, '0')} badhttp range body ${gen}`.padEnd(LINE - 1, '.') + '\n';
    docCache.set(key, Buffer.from(s.slice(0, length), 'latin1'));
  }
  return docCache.get(key);
}

// ---------- reading a file against the document's own self-description ----------
// A header may be cut by a 64-byte boundary or by a shifted placement (a leading digit lost), so the numbers are matched at 1-8
// digits; the generation is accepted only when followed by the padding dot (a generation cut by the end of the file is not read).
const HEADER = /(?<!\d)(\d{1,8}) (\d{1,8}) badhttp range body (g[0-9a-f]+)(?=\.)/g;

function duplicatedHead(bytes, doc, firstBad) {
  const lim = Math.min(firstBad ?? bytes.length, bytes.length - 39);
  for (let p = 1; p <= lim; p++) {
    const L = Math.min(LINE, bytes.length - p, doc.length);
    if (L < 39) break;
    if (bytes.subarray(p, p + L).equals(doc.subarray(0, L))) return true;
  }
  return false;
}

// checkDocument(bytes, length) -> { lines_checked, lines_misplaced, generations_seen, first_bad_offset, equals_document_prefix, shape, ... }
// Each 64-byte-aligned line of the file is compared with the true document and, where it differs, its embedded offset is read to say
// how far it sits from where it belongs (displacement: file position minus the position the line's own offset names).
// `shape` is null for the whole document, 'short' for a correct proper prefix, otherwise 'mixed-generation' / 'duplicated-prefix' /
// 'shifted' / 'other'. (classify() renames duplicated-prefix to suffix-misplaced on the suffix-as-prefix flavor.)
export function checkDocument(bytes, length, gen = 'g1') {
  const doc = formatDocument(length, gen);
  const gens = new Set();
  const displacements = [];
  let misplaced = 0;
  const lines = Math.ceil(bytes.length / LINE);
  for (let k = 0; k < lines; k++) {
    const chunk = bytes.subarray(k * LINE, (k + 1) * LINE);
    const ms = [...chunk.toString('latin1').matchAll(HEADER)];
    for (const m of ms) gens.add(m[3]);
    if (chunk.equals(doc.subarray(k * LINE, k * LINE + chunk.length))) continue;
    if (!ms.length) { misplaced += 1; displacements.push(null); continue; }
    const m = ms[0];
    const origin = Number(m[1]) - (m.index + m[1].length - 8); // the document offset of the chunk's first byte, if its first header is whole
    const d = k * LINE - origin;
    if (d !== 0) { misplaced += 1; displacements.push(d); }
  }
  const equals = bytes.equals(doc);
  const prefix = bytes.length <= doc.length && doc.subarray(0, bytes.length).equals(bytes);
  let firstBad = null;
  if (!prefix) {
    const n = Math.min(bytes.length, doc.length);
    firstBad = n;
    for (let i = 0; i < n; i++) if (bytes[i] !== doc[i]) { firstBad = i; break; }
  }
  const generations_seen = [...gens].sort();
  const oneGen = generations_seen.length === 1 && bytes.equals(formatDocument(length, generations_seen[0]));
  let shape = null;
  if (equals) shape = null;
  else if (prefix) shape = 'short';
  else if (generations_seen.length > 1) shape = 'mixed-generation';
  else if (duplicatedHead(bytes, doc, firstBad)) shape = 'duplicated-prefix';
  else if (misplaced > 0 && displacements.every((d) => d === 1 || d === -1)) shape = 'shifted';
  else shape = 'other';
  return { lines_checked: lines, lines_misplaced: misplaced, generations_seen, first_bad_offset: firstBad, equals_document: equals, equals_document_prefix: prefix, equals_document_one_generation: oneGen, shape, displacements: [...new Set(displacements)] };
}

// ---------- the reference placement: where RFC 9110 says the control's response bytes belong ----------
// controlExchange: the control's exchange fields (status, content_range, content_length, body_bytes, ...) plus `raw` (Buffer), the
// response body the control received. partialBytes: the file the client resumes (empty for the fresh cell). docBytes: the true document.
// Returns the placement, the resulting file, and whether that file is the document. yields_document is true, false, or null
// (undefined: the specification does not say where any byte goes) with `reason` saying why.
export function referencePlacement(controlExchange, partialBytes, docBytes) {
  const raw = controlExchange.raw;
  const status = controlExchange.status;
  const cr = controlExchange.content_range ?? null;
  const out = { placement: 'undefined', status, content_range: cr, content_length: controlExchange.content_length ?? null, body_bytes: raw.length, raw_sha256: sha(raw), body_matches_content_range: null, yields_document: null, resulting_bytes: null, rule: '', reason: null };
  let file = null;
  if (status === 200) {
    out.placement = 'whole representation';
    out.rule = 'RFC 9110 §15.3.1: a 200 carries the whole representation, so its body replaces the partial file, and a Content-Range on a 200 has no defined meaning (§14.4).';
    file = Buffer.from(raw);
  } else if (status === 206) {
    const m = cr == null ? null : /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(String(cr).trim());
    if (cr == null) {
      out.rule = 'RFC 9110 §15.3.7.1: a single-range 206 must carry Content-Range, and without it the offset of the body is not defined.';
      out.reason = 'a 206 without Content-Range says nothing about where its body belongs';
    } else if (!m) {
      out.rule = 'RFC 9110 §14.4 and §15.3.7: a 206 places its body at the first-pos of its Content-Range byte-range, which must parse.';
      out.reason = `the Content-Range ${JSON.stringify(String(cr).slice(0, 60))} is not a bytes a-b/t value`;
    } else {
      const a = Number(m[1]); const b = Number(m[2]);
      out.rule = `RFC 9110 §15.3.7 and §14.4: a 206 whose Content-Range is bytes ${a}-${b}/${m[3]} says its body is bytes ${a} through ${b} of the representation, so the body is placed at offset ${a} of the file.`;
      out.body_matches_content_range = raw.length === b - a + 1;
      if (a > partialBytes.length) out.reason = `the range starts at ${a} but the partial holds ${partialBytes.length} bytes, so placing it would leave a gap`;
      else {
        out.placement = `bytes ${a}-${b}`;
        file = Buffer.concat([partialBytes.subarray(0, a), raw, partialBytes.subarray(a + raw.length)]);
      }
    }
  } else if (status === 416) {
    const m = cr == null ? null : /^bytes \*\/(\d+)$/i.exec(String(cr).trim());
    out.rule = 'RFC 9110 §15.5.17: a 416 says the requested range cannot be satisfied and its Content-Range */t gives the current length t, and it carries no representation bytes, so nothing is placed.';
    if (m && Number(m[1]) === partialBytes.length) { out.placement = 'none'; file = Buffer.from(partialBytes); }
    else out.reason = m ? `the 416 names a length of ${m[1]} against a partial of ${partialBytes.length} bytes, and places no byte` : 'the 416 carries no bytes */t Content-Range';
  } else {
    out.rule = 'RFC 9110 §15: only 200, 206 and 416 place representation bytes for a range request.';
    out.reason = `status ${status} places no representation bytes`;
  }
  if (file) {
    out.resulting_bytes = file.length;
    out.yields_document = file.equals(docBytes);
    if (out.yields_document === false) out.reason = null;
  }
  Object.defineProperty(out, '_file', { value: file, enumerable: false });
  return out;
}
// The reference as served on a row or in REFERENCE_RANGE: no bytes, only what the control saw and the rule applied.
const refSummary = (ref) => ({ ...ref });

// ---------- outcome ----------
const reportedError = (row) => !!(row.reported_error && String(row.reported_error).length) || (row.exit?.kind === 'exit-code' && row.exit.code !== 0) || row.exit?.kind === 'raised';
const snip = (buf, i) => (i >= buf.length ? 'its end' : JSON.stringify(buf.subarray(i, i + 16).toString('latin1')));
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return n; };

// classify(row, ref, doc) -> { outcome, shape, transfer, missing_bytes, outcome_vs_reference, diff }
// row: a client row of the capture (with file_base64); ref: referencePlacement() for the row's scenario; doc: the true document.
export function classify(row, ref, doc) {
  const docLen = doc.length;
  const ex = row.exchanges || [];
  const sum = ex.reduce((s, e) => s + (e.body_bytes || 0), 0);
  const bytes = row.file_base64 == null ? Buffer.alloc(0) : Buffer.from(row.file_base64, 'base64');
  const partial = row.scenario === 'fresh' ? Buffer.alloc(0) : doc.subarray(0, row.partial_bytes);
  const chk = checkDocument(bytes, docLen);
  const err = reportedError(row);
  const res = (o) => ({ outcome: o.outcome, shape: o.shape ?? null, transfer: o.transfer ?? null, missing_bytes: o.missing_bytes ?? null, outcome_vs_reference: o.vs === null ? null : (o.vs ?? 'undefined'), diff: o.diff ?? null });

  // A harness-timeout row is tested before the no-exchange branch, so a hung client that never reached the recorder is a timeout, not a
  // request-failed. Its file is a mid-transfer snapshot: no comparison with the reference placement is made (outcome_vs_reference null).
  if (row.end === 'harness-timeout') {
    return res({ outcome: 'harness-timeout', vs: null, missing_bytes: chk.equals_document_prefix ? docLen - bytes.length : null, diff: `the harness cap fired after ${ex.length} request${ex.length === 1 ? '' : 's'} and ${sum} body bytes, with ${bytes.length} bytes on disk${chk.equals_document_prefix ? ', all of them the start of the document' : ''}` });
  }
  if (!ex.length) return res({ outcome: 'request-failed', diff: `the recorder saw no response from badhttp.dev${row.reported_error ? ` and the client reported ${JSON.stringify(String(row.reported_error).slice(0, 80))}` : ''}` });
  let vs = 'undefined';
  if (ref.yields_document !== null) vs = bytes.equals(ref._file) ? 'as-reference' : 'differs';
  const diffAgainst = () => {
    if (vs === 'as-reference') return null;
    if (vs === 'differs') {
      const i = firstDiff(bytes, ref._file);
      return `the file has ${bytes.length} bytes where the reference placement yields ${ref._file.length}, and they first differ at byte ${i}, where the file has ${snip(bytes, i)} and the reference ${snip(ref._file, i)}`;
    }
    const where = chk.equals_document ? 'equals the document' : chk.equals_document_prefix ? `holds ${bytes.length} bytes, all of them the start of the document` : `differs from the document first at byte ${chk.first_bad_offset}, where it has ${snip(bytes, chk.first_bad_offset)}`;
    return `no reference placement exists (${ref.reason}), and the file ${where}`;
  };

  if (chk.equals_document_one_generation) {
    let transfer;
    // `transfer` follows the exchange that wrote the file, not the sum over every request: an extractor's leading GET with no Range
    // (yt-dlp) or a plain GET the client cuts short (nugget) is followed by the Range request that built the file, and HEAD
    // requests carry no body. So: take the last non-HEAD exchange. If it carried Range and brought fewer bytes than the document, the
    // partial was kept (resumed). If it brought the whole document, the partial was thrown away: restarted-after-range when an
    // earlier non-HEAD exchange had asked for a range and received fewer bytes than the document, restarted otherwise. A last
    // exchange with no Range and fewer bytes than the document falls back to comparing the summed bytes with the document.
    const body = ex.filter((e) => String(e.method || 'GET').toUpperCase() !== 'HEAD');
    const last = body[body.length - 1] || ex[ex.length - 1];
    if (row.scenario === 'fresh') transfer = 'fresh';
    else if (last.range != null && (last.body_bytes || 0) < docLen) transfer = 'resumed';
    else if ((last.body_bytes || 0) >= docLen) transfer = body.slice(0, -1).some((e) => e.range != null && (e.body_bytes || 0) < docLen) ? 'restarted-after-range' : 'restarted';
    else transfer = sum < docLen ? 'resumed' : 'restarted';
    return res({ outcome: 'complete', transfer, vs, diff: diffAgainst() });
  }
  const untouched = row.scenario === 'fresh' ? bytes.length === 0 : bytes.equals(partial);
  if (untouched && err) return res({ outcome: 'refused', vs, diff: diffAgainst() });
  // unchanged: the client reported no error and left the file as it found it (the partial, or no file at all on the fresh cell).
  if (untouched) return res({ outcome: 'unchanged', missing_bytes: docLen - bytes.length, vs, diff: diffAgainst() });
  if (chk.shape === 'short' && err) return res({ outcome: 'incomplete-reported', missing_bytes: docLen - bytes.length, vs, diff: diffAgainst() });
  // body-only: the file is exactly the body of the deciding exchange (the last non-HEAD one): the client discarded the partial and
  // kept the response body alone. Tested before short and other, which it would otherwise be filed under.
  const deciding = ex.filter((e) => String(e.method || 'GET').toUpperCase() !== 'HEAD').pop();
  if (row.scenario === 'resume' && bytes.length > 0 && deciding && deciding.body_sha256 && sha(bytes) === deciding.body_sha256) {
    return res({ outcome: 'corrupt', shape: 'body-only', missing_bytes: chk.equals_document_prefix ? docLen - bytes.length : null, vs, diff: diffAgainst() });
  }
  if (chk.shape === 'short') return res({ outcome: 'corrupt', shape: 'short', missing_bytes: docLen - bytes.length, vs, diff: diffAgainst() });
  let shape = chk.shape;
  if (shape === 'duplicated-prefix' && row.flavor === 'suffix-as-prefix') shape = 'suffix-misplaced';
  return res({ outcome: 'corrupt', shape, vs, diff: diffAgainst() });
}

if (isMain) main();
function main() {
  const bad = (m) => { throw new Error(`REFUSED: ${m}`); };
  // ---------- input ----------
  let lines;
  try { lines = readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { bad(`cannot read ${SRC} as NDJSON: ${e.message}`); }
  const prov = lines.shift();
  if (!prov || prov.capture !== 'range') bad('line 1 must be the provenance line with capture: "range"');
  const rows = lines;
  { const why = checkString(JSON.stringify(prov), 'the provenance line', { verdict: false }); if (why) bad(why); }
  if (!prov.probed) bad('the provenance line carries no probed date');
  // The run log is committed beside the capture; it is not emitted, but a machine path in it would be published with the repo.
  const LOG_PATH = SRC.replace(/\.jsonl$/, '.log');
  let LOG_TEXT = '';
  try { LOG_TEXT = readFileSync(LOG_PATH, 'utf8'); } catch { bad(`the run log ${LOG_PATH} must be committed beside the capture`); }
  { const why = checkString(LOG_TEXT, `the run log ${LOG_PATH}`, { verdict: false }); if (why) bad(why); }

  // ---------- per-row checks ----------
  const label = (r) => `${r.client?.id ?? '?'}/${r.flavor}/${r.scenario}`;
  const seen = new Set(); const seenIds = new Set();
  const clients = new Map(); // id -> { meta, cells:Set }
  const servedOf = (r) => { const o = { ...r }; delete o.file_base64; if (o.control) { o.control = { ...o.control }; delete o.control.raw_base64; } return o; };
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !r.client || !r.client.id) bad(`row without client.id: ${JSON.stringify(r).slice(0, 120)}`);
    const L = label(r);
    if (!FLAVOR_ORDER.includes(r.flavor)) bad(`${L}: unknown flavor ${r.flavor}`);
    if (!ROLES.includes(r.client.role)) bad(`${L}: client role ${r.client.role} not in vocabulary`);
    if (!CLASSES.includes(r.client.class)) bad(`${L}: client class ${r.client.class} not in vocabulary`);
    const isControl = r.client.role === 'control';
    if (isControl !== (r.client.class === 'raw')) bad(`${L}: role ${r.client.role} with class ${r.client.class} (controls are raw, clients are resumers)`);
    if (!(isControl ? CONTROL_SCENARIOS : CLIENT_SCENARIOS).includes(r.scenario)) bad(`${L}: scenario ${r.scenario} not in the vocabulary for a ${r.client.role}`);
    if (r.corpus_id !== `range.${r.flavor}`) bad(`${L}: corpus_id ${r.corpus_id} is not range.${r.flavor}`);
    if (typeof r.id !== 'string' || !r.id.startsWith(`range.${r.flavor}.`)) bad(`${L}: id ${r.id} does not start with range.${r.flavor}.`);
    if (seenIds.has(r.id)) bad(`${L}: duplicate row id ${r.id}`);
    seenIds.add(r.id);
    const key = `${r.client.id}\u0000${r.flavor}\u0000${r.scenario}`;
    if (seen.has(key)) bad(`duplicate observation ${L}: one row per (client, flavor, scenario)`);
    seen.add(key);
    if (r.url !== `https://badhttp.dev/range/${r.flavor}?length=${DOC_LEN}`) bad(`${L}: url ${JSON.stringify(r.url)} is not https://badhttp.dev/range/${r.flavor}?length=${DOC_LEN}`);
    if (!ENDS.includes(r.end)) bad(`${L}: end "${r.end}" not in vocabulary`);
    if (!r.exit || !EXIT_KINDS.includes(r.exit.kind)) bad(`${L}: exit.kind "${r.exit?.kind}" not in vocabulary`);
    if (!Number.isInteger(r.attempts) || r.attempts < 1 || r.attempts > 3) bad(`${L}: attempts ${r.attempts} is not 1..3`);
    const ex = r.exchanges;
    if (!Array.isArray(ex)) bad(`${L}: exchanges is not a list`);
    ex.forEach((e, i) => {
      if (!e.x_badhttp_version) bad(`${L}: exchange ${i + 1} of ${ex.length} has no x-badhttp-version (rate limit or edge response recorded as the client's; the harness retries those)`);
      if (e.x_badhttp_flavor != null && e.x_badhttp_flavor !== r.flavor) bad(`${L}: exchange ${i + 1} answered as flavor ${e.x_badhttp_flavor}`);
      if (e.upstream_error != null) bad(`${L}: exchange ${i + 1} recorded upstream_error ${JSON.stringify(String(e.upstream_error).slice(0, 80))}; a recorder or upstream failure is not the client's observation (the harness retries those)`);
      if (!Number.isInteger(e.status) || !Number.isInteger(e.body_bytes)) bad(`${L}: exchange ${i + 1} lacks an integer status / body_bytes`);
    });
    const served = servedOf(r);
    const text = JSON.stringify(served);
    { const why = checkString(text, `${L}: the row`, { verdict: false }); if (why) bad(why); }
    if (!clients.has(r.client.id)) clients.set(r.client.id, { meta: r.client, cells: new Set() });
    else {
      const m0 = clients.get(r.client.id).meta;
      for (const k of ['name', 'role', 'class', 'version', 'library', 'platform']) if (m0[k] !== r.client[k]) bad(`${L}: client ${r.client.id} has ${k} ${JSON.stringify(r.client[k])} here and ${JSON.stringify(m0[k])} in another row`);
    }
    clients.get(r.client.id).cells.add(`${r.flavor}/${r.scenario}`);
  }
  if (!rows.length) bad('the capture holds no rows');

  // ---------- roster and grid ----------
  const controlIds = [...clients.values()].filter((c) => c.meta.role === 'control').map((c) => c.meta.id);
  if (controlIds.length !== 1) bad(`exactly one roster entry must have role control; found ${controlIds.length}${controlIds.length ? ` (${controlIds.join(', ')})` : ''}`);
  const resumers = [...clients.values()].filter((c) => c.meta.role === 'client');
  if (resumers.length < MIN_RESUMERS) bad(`${resumers.length} resumer clients: a published capture holds at least ${MIN_RESUMERS}`);
  for (const c of resumers) {
    const missing = CLIENT_CELLS.filter(([f, s]) => !c.cells.has(`${f}/${s}`)).map(([f, s]) => `${f}/${s}`);
    if (missing.length) bad(`client ${c.meta.id} is missing cells: ${missing.join(', ')} (a published capture is the full ${CLIENT_CELLS.length}-cell grid)`);
    if (c.cells.size !== CLIENT_CELLS.length) bad(`client ${c.meta.id} holds ${c.cells.size} cells, expected ${CLIENT_CELLS.length}`);
  }
  const ctl = clients.get(controlIds[0]);
  const wantCtl = [...FLAVOR_ORDER.map((f) => `${f}/resume-raw`), 'always-206/fresh-raw', 'ok/document'];
  const missingCtl = wantCtl.filter((c) => !ctl.cells.has(c));
  if (missingCtl.length) bad(`the control ${controlIds[0]} is missing: ${missingCtl.join(', ')} (every flavor needs its resume-raw row, always-206 its fresh-raw row, and one document row)`);
  if (ctl.cells.size !== wantCtl.length) bad(`the control holds ${ctl.cells.size} rows, expected ${wantCtl.length}`);
  if (rows.length !== resumers.length * CLIENT_CELLS.length + wantCtl.length) bad(`${rows.length} rows for ${resumers.length} resumers x ${CLIENT_CELLS.length} cells + ${wantCtl.length} control rows: the grid is not complete`);
  if (prov.clients_run != null && prov.clients_run !== clients.size) bad(`provenance says clients_run ${prov.clients_run}, the rows hold ${clients.size} roster entries`);
  if (prov.flavors_run != null && prov.flavors_run !== FLAVOR_ORDER.length) bad(`provenance says flavors_run ${prov.flavors_run}, the parser knows ${FLAVOR_ORDER.length} flavors`);

  // Every exchange of every row, not only the first: a deploy mid-capture can change the version between requests.
  const versions = new Set(rows.flatMap((r) => r.exchanges.map((e) => e.x_badhttp_version)));
  if (versions.size !== 1) bad(`rows span badhttp versions ${[...versions].join(', ')}: a deploy happened mid-capture`);
  const BADHTTP_VERSION = [...versions][0];
  for (const r of rows) if (r.badhttp_version != null && r.badhttp_version !== BADHTTP_VERSION) bad(`${label(r)}: badhttp_version ${r.badhttp_version} differs from the exchanges' ${BADHTTP_VERSION}`);
  if (prov.badhttp_version_observed != null && prov.badhttp_version_observed !== BADHTTP_VERSION) bad(`provenance says badhttp ${prov.badhttp_version_observed}, the exchanges say ${BADHTTP_VERSION}`);

  // ---------- the controls and the true document ----------
  const ctlRow = new Map(); // `${flavor}/${scenario}` -> { row, raw }
  for (const r of rows.filter((x) => x.client.role === 'control')) {
    const L = label(r);
    if (!r.control || typeof r.control.raw_base64 !== 'string') bad(`${L}: control carries no raw_base64`);
    const raw = Buffer.from(r.control.raw_base64, 'base64');
    if (sha(raw) !== r.control.raw_sha256) bad(`${L}: control raw bytes do not hash to raw_sha256`);
    if (r.control.raw_bytes != null && r.control.raw_bytes !== raw.length) bad(`${L}: control raw_bytes ${r.control.raw_bytes} but the raw bytes are ${raw.length}`);
    if (r.control.curl_exit !== 0) bad(`${L}: the control's curl exited ${r.control.curl_exit}, so it is not an observation`);
    if (r.exchanges.length !== 1) bad(`${L}: a control row holds exactly one exchange, found ${r.exchanges.length}`);
    const e = r.exchanges[0];
    if (e.body_bytes !== raw.length) bad(`${L}: the exchange forwarded ${e.body_bytes} body bytes but the control holds ${raw.length}`);
    if (e.body_sha256 != null && e.body_sha256 !== r.control.raw_sha256) bad(`${L}: the exchange's body hash differs from the control's raw_sha256`);
    const wantRange = r.scenario === 'resume-raw' ? `bytes=${PARTIAL_BYTES}-` : null;
    if ((e.range ?? null) !== wantRange) bad(`${L}: the control sent Range ${JSON.stringify(e.range ?? null)}, expected ${JSON.stringify(wantRange)}`);
    ctlRow.set(`${r.flavor}/${r.scenario}`, { row: r, raw });
  }
  const docCtl = ctlRow.get('ok/document');
  if (docCtl.row.exchanges[0].status !== 200) bad(`the document control got status ${docCtl.row.exchanges[0].status}, expected 200`);
  const DOC = docCtl.raw;
  if (DOC.length !== DOC_LEN) bad(`the document control is ${DOC.length} bytes, expected ${DOC_LEN}`);
  if (!DOC.equals(formatDocument(DOC_LEN))) bad('the document control differs from the document the format in src/range.js describes: the control did not fetch /range/ok?length=1000 or the format changed');
  const docCheck = checkDocument(DOC, DOC_LEN);
  if (!docCheck.equals_document || docCheck.lines_misplaced !== 0 || docCheck.generations_seen.join() !== 'g1') bad('the document control does not read back as the whole self-describing document');
  const PARTIAL = DOC.subarray(0, PARTIAL_BYTES);
  const PARTIAL_SHA = sha(PARTIAL);

  // ---------- the reference, from the control's bytes ----------
  const withRaw = (c) => ({ ...c.row.exchanges[0], raw: c.raw });
  const REF = {}; // flavor -> { resume, fresh? }
  for (const f of FLAVOR_ORDER) REF[f] = { resume: referencePlacement(withRaw(ctlRow.get(`${f}/resume-raw`)), PARTIAL, DOC) };
  REF['always-206'].fresh = referencePlacement(withRaw(ctlRow.get('always-206/fresh-raw')), Buffer.alloc(0), DOC);

  // ---------- client rows: partial, file, outcome ----------
  const OBS = [];
  for (const r of rows) {
    const L = label(r);
    const o = servedOf(r);
    o.license = 'CC0-1.0';
    if (r.client.role === 'control') {
      const ref = r.scenario === 'document' ? null : (r.scenario === 'fresh-raw' ? REF[r.flavor].fresh : REF[r.flavor].resume);
      o.control = { raw_bytes: r.control.raw_bytes ?? ctlRow.get(`${r.flavor}/${r.scenario}`).raw.length, raw_sha256: r.control.raw_sha256, curl_exit: r.control.curl_exit };
      o.outcome = 'control'; o.shape = null; o.transfer = null; o.missing_bytes = null; o.outcome_vs_reference = null; o.diff = null;
      o.reference = ref ? refSummary(ref) : null;
      OBS.push(o);
      continue;
    }
    // partial: the first 400 bytes of the control's document, so the partial can never be the thing that was wrong
    const wantBytes = r.scenario === 'fresh' ? 0 : PARTIAL_BYTES;
    if (r.partial_bytes !== wantBytes) bad(`${L}: partial_bytes ${r.partial_bytes}, expected ${wantBytes}`);
    const wantSha = r.scenario === 'fresh' ? sha(Buffer.alloc(0)) : PARTIAL_SHA;
    if (r.partial_sha256 !== wantSha && !(r.scenario === 'fresh' && r.partial_sha256 == null)) bad(`${L}: partial_sha256 ${r.partial_sha256} is not the hash of the first ${wantBytes} bytes of the control document (${wantSha})`);
    // file: the bytes on disk after the client ran
    if (!('file_base64' in r)) bad(`${L}: no file_base64 (use null when no file exists)`);
    const fileBuf = r.file_base64 == null ? null : Buffer.from(r.file_base64, 'base64');
    if (fileBuf === null) {
      if (r.file != null && r.file.bytes != null && r.file.bytes !== 0) bad(`${L}: file_base64 is null but file.bytes is ${r.file.bytes}`);
    } else {
      if (!r.file || r.file.sha256 !== sha(fileBuf)) bad(`${L}: file_base64 does not hash to file.sha256`);
      if (r.file.bytes !== fileBuf.length) bad(`${L}: file.bytes ${r.file.bytes} but file_base64 decodes to ${fileBuf.length}`);
    }
    const bytes = fileBuf ?? Buffer.alloc(0);
    const chk = checkDocument(bytes, DOC_LEN);
    if (r.file && r.file.equals_document != null && r.file.equals_document !== chk.equals_document) bad(`${L}: the harness says equals_document ${r.file.equals_document}, the bytes say ${chk.equals_document}`);
    const ref = r.scenario === 'fresh' ? REF[r.flavor].fresh : REF[r.flavor].resume;
    const c = classify(r, ref, DOC);
    if (!OUTCOMES.includes(c.outcome) || (c.shape && !SHAPES.includes(c.shape))) bad(`${L}: classify produced ${c.outcome}/${c.shape}, outside the vocabulary`);
    o.file = { present: fileBuf !== null, bytes: bytes.length, sha256: sha(bytes), equals_document: chk.equals_document, equals_document_prefix: chk.equals_document_prefix, lines_checked: chk.lines_checked, lines_misplaced: chk.lines_misplaced, generations_seen: chk.generations_seen, first_bad_offset: chk.first_bad_offset };
    o.outcome = c.outcome; o.shape = c.shape; o.transfer = c.transfer; o.missing_bytes = c.missing_bytes; o.outcome_vs_reference = c.outcome_vs_reference; o.diff = c.diff;
    o.reference = refSummary(ref);
    o.control = null;
    if (VERDICT_WORDS.test(JSON.stringify(o))) bad(`${L}: a verdict word reached a row`);
    OBS.push(o);
  }
  // order: flavor order, controls first, then scenario, then client id
  OBS.sort((a, b) => FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor) || (b.client.role === 'control') - (a.client.role === 'control') || SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario) || a.client.id.localeCompare(b.client.id));

  // ---------- disagreement: distinct (outcome, shape, transfer) answers among resumer rows, per flavor ----------
  // always-206 is reported twice: `always-206` is its resume cell and `always-206/fresh` its fresh cell.
  const answers = {};
  for (const o of OBS) {
    if (o.client.role !== 'client') continue;
    const k = o.scenario === 'fresh' ? `${o.flavor}/fresh` : o.flavor;
    const a = `${o.outcome} | ${o.shape ?? '-'} | ${o.transfer ?? '-'}`;
    ((answers[k] ??= {})[a] ??= []).push(o.client.id);
  }
  const disagreement_by_flavor = {}; const answers_by_flavor = {};
  for (const k of [...FLAVOR_ORDER, 'always-206/fresh']) {
    disagreement_by_flavor[k] = Object.keys(answers[k] || {}).length;
    answers_by_flavor[k] = Object.entries(answers[k] || {}).map(([answer, who]) => ({ answer, clients: who.sort() }));
  }

  // ---------- emit ----------
  const roster = [...clients.values()].map((c) => c.meta);
  roster.sort((a, b) => (a.role === 'control' ? -1 : b.role === 'control' ? 1 : a.id.localeCompare(b.id)));
  const CLIENTS = roster.map((m) => ({ id: m.id, name: m.name, role: m.role, class: m.class, version: m.version, library: m.library, platform: m.platform, invocation: m.invocation, requests_recorded_by: m.requests_recorded_by }));
  const counts = {};
  for (const o of OBS) if (o.client.role === 'client') counts[o.outcome] = (counts[o.outcome] || 0) + 1;
  const witness = {
    family: 'range', probed: prov.probed, badhttp_version_observed: BADHTTP_VERSION, worker_version: prov.worker_version || null,
    flavors: FLAVOR_ORDER.length, clients: resumers.length, cells_per_client: CLIENT_CELLS.length, document_bytes: DOC_LEN, partial_bytes: PARTIAL_BYTES,
    document_sha256: sha(DOC), partial_sha256: PARTIAL_SHA, outcomes: counts, disagreement_by_flavor, answers_by_flavor,
    source_file: SRC.replace(/^.*?docs\//, 'docs/'), run_log: SRC.replace(/^.*?docs\//, 'docs/').replace(/\.jsonl$/, '.log'), capture_scripts: 'scripts/range-witness/',
  };
  const REFERENCE_OUT = {};
  for (const f of FLAVOR_ORDER) REFERENCE_OUT[f] = { flavor: f, source: 'where RFC 9110 places the bytes the control received for Range: bytes=400-, applied to the first 400 bytes of the control document', ...refSummary(REF[f].resume), ...(REF[f].fresh ? { fresh: { source: 'where RFC 9110 places the bytes the control received for a request with no Range, applied to an empty file', ...refSummary(REF[f].fresh) } } : {}) };
  const served = { witness, CLIENTS, REFERENCE_OUT, OBS };
  const all = JSON.stringify(served);
  { const why = checkString(all, 'the emitted data'); if (why) bad(why); }

  // Provenance fields and the capture path are written into the header comment of the generated file.
  for (const [label, v] of [['probed', witness.probed], ['worker_version', witness.worker_version], ['the capture path', witness.source_file], ['badhttp_version_observed', BADHTTP_VERSION]]) { const why = headerSafe(label, v); if (why) bad(why); }
  const header = `// GENERATED by scripts/witness-parse-range.mjs from ${witness.source_file} — do not edit by hand.
// Re-run the generator after any new capture: node scripts/witness-parse-range.mjs ${witness.source_file}; the capture scripts are in scripts/range-witness/.
//
// ${witness.clients} real resuming download clients plus a raw-wire control (curl), one fresh working directory per cell: each resumes a
// ${PARTIAL_BYTES}-byte partial of the ${DOC_LEN}-byte /range document from GET /range/{flavor}?length=${DOC_LEN} for each of ${FLAVOR_ORDER.length} flavors, plus one fresh
// download at always-206, on ${witness.probed} against badhttp ${BADHTTP_VERSION}${witness.worker_version ? ` (Worker deployment ${witness.worker_version})` : ''}.
// THE ORACLE IS THE CONTROL'S BYTES PLUS THE DOCUMENT'S OWN SELF-DESCRIPTION, NEVER TYPED: REFERENCE_RANGE says where RFC 9110 places
// the bytes the control received, and each row's outcome describes the file the client left on disk (every 64-byte line carries its own
// offset and generation) relative to that reference and to the true document. Never a verdict.
// Outcomes: complete | refused (partial untouched, error reported) | unchanged (partial untouched, no error reported) | corrupt (with a
// shape: duplicated-prefix, shifted, short, body-only [the response body alone, partial discarded], mixed-generation, suffix-misplaced,
// other) | incomplete-reported (correct prefix, error reported) | harness-timeout | request-failed.
`;
  const lit = (name, v) => `export const ${name} = ${JSON.stringify(v, null, 2)};\n`;
  writeFileSync(OUT, `${header}\n${lit('WITNESS_RANGE', witness)}\n${lit('CLIENTS_RANGE', CLIENTS)}\n${lit('REFERENCE_RANGE', REFERENCE_OUT)}\n${lit('OBSERVATIONS_RANGE', OBS)}`);
  console.log(`wrote ${OUT}: ${OBS.length} rows (${resumers.length} resumers x ${CLIENT_CELLS.length} cells + ${wantCtl.length} control rows), badhttp ${BADHTTP_VERSION}, outcomes ${JSON.stringify(counts)}`);
  console.log(`disagreement_by_flavor ${JSON.stringify(disagreement_by_flavor)}`);
}

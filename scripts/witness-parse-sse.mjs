#!/usr/bin/env node
// Turns the /sse witness capture into a source literal the Worker can serve.
//
// Input:  docs/probe-sse-clients-<date>.jsonl — the raw capture, committed, re-runnable from scripts/sse-witness/all.sh.
//         Line 1 is provenance; every other line is one observation (one client, one flavor).
// Output: src/witness-sse-data.js — a generated literal. The Worker never parses text at runtime.
//
//   node scripts/witness-parse-sse.mjs docs/probe-sse-clients-2026-10-05.jsonl
//
// THE ORACLE IS DERIVED FROM THE WIRE. The curl control row for each flavor carries the raw body bytes it received
// (raw_base64 in the capture file only — the served rows carry a length and a SHA-256). This script runs a
// reference parser implementing the WHATWG HTML Living Standard §9.2.6 "Interpreting an event stream" over those
// bytes, and THAT is the reference every client row is compared against. Nothing about what the stream "should"
// contain is typed here, with one stated exception: /sse/resume's later connections (ids 4–6, then 204), which curl
// cannot witness because it does not reconnect; those come from the flavor's documented sequence and the row says so.
//
// `outcome` is a description relative to that processing model and the client's CLASS (docs/spec-sse-witness.md):
// an `eventsource`-class library is expected to enter its reconnecting state after ANY server close, a `one-shot`
// library to return. It is never a verdict: a one-shot library "not reconnecting" is its design. The verdict words
// are banned from every string this file emits (smoke greps for them).
//
// Refusals (the generator exits non-zero rather than emit): a client missing a flavor, a flavor missing a control
// row, a row whose first connection has no x-badhttp-version, a row carrying a machine path or a hostname other than
// badhttp.dev, a control whose raw bytes do not hash to its raw_sha256, an end value outside the vocabulary.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = 'src/witness-sse-data.js';
const isMain = process.argv[1] && /witness-parse-sse\.mjs$/.test(process.argv[1]);
const SRC = isMain ? process.argv[2] : null;
if (isMain && !SRC) throw new Error('usage: node scripts/witness-parse-sse.mjs <capture.jsonl>');

export const FLAVOR_ORDER = ['ok', 'stall', 'cut', 'drop', 'crlf', 'cr', 'no-space', 'multiline', 'comments', 'split-utf8', 'wrong-type', 'error-event', 'big', 'resume'];
const CLASSES = ['eventsource', 'one-shot', 'raw'];
const ENDS = ['clean', 'error', 'reconnecting', 'stopped', 'closed-by-harness', 'harness-timeout'];
const CONN_ENDS = ['server-closed', 'reset', 'client-closed', 'harness-timeout', 'status-204', 'error', 'refused'];
const CLEAN_CLOSE = ['ok', 'stall', 'cut', 'crlf', 'cr', 'no-space', 'multiline', 'comments', 'split-utf8', 'error-event', 'big'];
const VERDICT_WORDS = /\b(correctly|incorrectly|conformant|non-compliant|noncompliant|violates|buggy|broken client|wrong client|passes|fails the spec)\b/i;
const MACHINE = /\/Users\/|\/home\/|\/private\/|\/tmp\/|C:\\\\|localhost|127\.0\.0\.1/;

// ---------- the reference parser: WHATWG HTML §9.2.6, byte-faithful ----------
// Lines end at CRLF, LF or CR; one leading BOM is stripped; a field is `name: value` with exactly one leading
// space removed from the value; a line without a colon is a field with an empty value; a line starting with a
// colon is a comment; `data` lines accumulate joined with LF; a blank line dispatches if the data buffer is
// non-empty (type defaults to "message"); `id` sets the last event ID the moment the line is read (so an
// unterminated event's id still sticks); at EOF pending data is DISCARDED.
export function whatwgParse(bytes) {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n|\r|\n/);
  // split() leaves a trailing "" when the text ends in a line ending; a genuinely unterminated last line is kept.
  const endedWithEol = /(\r\n|\r|\n)$/.test(text);
  if (endedWithEol) lines.pop();
  const events = [];
  // Two id variables, as the spec has them: the "last event ID buffer" is set the moment an id line is read; the
  // "last event ID string" (what a reconnect sends as Last-Event-ID, and what each event carries) is set from the
  // buffer only when a blank line is processed — BEFORE the empty-data check, so an id-only block updates it too.
  let data = null, type = '', idBuffer = '', idString = '', retry = null, pending = false;
  const dispatch = () => {
    idString = idBuffer;
    if (data === null) { type = ''; return; }
    events.push({ type: type || 'message', id: idString === '' ? null : idString, data });
    data = null; type = '';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const unterminated = !endedWithEol && i === lines.length - 1;
    if (unterminated) { pending = true; break; } // §9.2.6: a line not terminated at EOF is not processed... see note below
    if (line === '') { dispatch(); continue; }
    if (line.startsWith(':')) continue;
    let field, value;
    const c = line.indexOf(':');
    if (c === -1) { field = line; value = ''; } else { field = line.slice(0, c); value = line.slice(c + 1); if (value.startsWith(' ')) value = value.slice(1); }
    if (field === 'event') type = value;
    else if (field === 'data') data = (data === null ? '' : data + '\n') + value;
    else if (field === 'id') { if (!value.includes('\u0000')) idBuffer = value; }
    else if (field === 'retry') { if (/^\d+$/.test(value)) retry = Number(value); }
  }
  // Pending (unterminated) data at EOF is discarded by the spec; `pending` records that something WAS pending.
  const discarded = data !== null || pending;
  return { events, lastEventIdAtEof: idString === '' ? null : idString, lastEventIdBufferAtEof: idBuffer === '' ? null : idBuffer, retry, discardedPending: discarded };
}
// Note on the unterminated last line: §9.2.6 processes lines as they are terminated; the spec's stream
// interpretation says "once the end of the file is reached, any pending data must be discarded". A final line
// with no line ending is therefore never processed as a field, and any accumulated data buffer never dispatches.
// This matches browsers and Node's EventSource on /sse/cut (observed 2026-08-23 and 2026-10-05). On /sse/cut the
// "id: 2" line IS terminated, so the buffer becomes "2" — but no blank line follows, so the last event ID STRING
// stays "1" and a reconnect carries Last-Event-ID: 1. (Corrected 2026-10-05 after a reviewer read the algorithm.)

// ---------- normalization ----------
// Tick events carry the server's clock inside JSON data ("t"). Remove it before comparing so that "same event"
// never depends on timing. Everything else is compared verbatim.
export function normData(d) {
  if (typeof d !== 'string') return d;
  if (d.startsWith('{') && d.includes('"t"')) {
    try { const o = JSON.parse(d); if (o && typeof o === 'object' && 't' in o) { delete o.t; return JSON.stringify(o); } } catch { /* not JSON: compare verbatim */ }
  }
  return d;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
// Every normalized event carries a SHA-256 of its (normalized) data: the harness supplies one for data it truncated,
// the reference computes one from the full bytes, so long data compares by length and hash on both sides.
const norm = (e) => { const data = normData(e.data); const data_bytes = e.data_bytes ?? Buffer.byteLength(e.data || '', 'utf8'); return { type: e.type || 'message', id: e.id == null || e.id === '' ? null : String(e.id), data, data_bytes, data_sha256: e.data_sha256 ?? sha(Buffer.from(data_bytes > 200 ? (e.data || '') : data, 'utf8')) }; };

if (isMain) main();
function main() {
// ---------- input ----------
const lines = readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const prov = lines.shift();
if (!prov || prov.capture !== 'sse') throw new Error('line 1 must be the provenance line with capture: "sse"');
const rows = lines;
const bad = (m) => { throw new Error(`REFUSED: ${m}`); };

// Roster and grid checks
const clients = new Map();
for (const r of rows) {
  if (!r.client || !r.client.id) bad(`row without client.id: ${JSON.stringify(r).slice(0, 120)}`);
  if (!FLAVOR_ORDER.includes(r.flavor)) bad(`unknown flavor ${r.flavor}`);
  if (!CLASSES.includes(r.client.class)) bad(`client ${r.client.id} has class ${r.client.class}`);
  if (!ENDS.includes(r.end)) bad(`${r.client.id}/${r.flavor}: end "${r.end}" not in vocabulary`);
  for (const c of r.connections || []) if (!CONN_ENDS.includes(c.ended)) bad(`${r.client.id}/${r.flavor}: connection ended "${c.ended}" not in vocabulary`);
  const first = (r.connections || [])[0];
  if (!first || !first.x_badhttp_version) bad(`${r.client.id}/${r.flavor}: first connection has no x-badhttp-version (did not land)`);
  if (MACHINE.test(JSON.stringify(r))) bad(`${r.client.id}/${r.flavor}: row carries a machine path or local host`);
  const hosts = JSON.stringify(r).match(/https?:\/\/([a-z0-9.-]+)/gi) || [];
  for (const h of hosts) if (!/^https?:\/\/(alt\.)?badhttp\.dev/.test(h)) bad(`${r.client.id}/${r.flavor}: foreign host ${h}`);
  if (!clients.has(r.client.id)) clients.set(r.client.id, { ...r.client, flavors: new Set() });
  clients.get(r.client.id).flavors.add(r.flavor);
}
for (const [id, c] of clients) {
  const missing = FLAVOR_ORDER.filter((f) => !c.flavors.has(f));
  if (missing.length) bad(`client ${id} is missing flavors: ${missing.join(', ')} (a published capture is the full grid)`);
}
const control = rows.filter((r) => r.client.role === 'control');
if (new Set(control.map((r) => r.flavor)).size !== FLAVOR_ORDER.length) bad('the control must cover every flavor');
const versions = new Set(rows.map((r) => r.connections[0].x_badhttp_version));
if (versions.size !== 1) bad(`rows span badhttp versions ${[...versions].join(', ')}: a deploy happened mid-capture`);
const BADHTTP_VERSION = [...versions][0];

// ---------- the reference, from the control's bytes ----------
const REFERENCE = {};
for (const r of control) {
  if (!r.control || !r.control.raw_base64) bad(`control ${r.flavor} carries no raw_base64`);
  const raw = Buffer.from(r.control.raw_base64, 'base64');
  if (sha(raw) !== r.control.raw_sha256) bad(`control ${r.flavor}: raw bytes do not hash to raw_sha256`);
  const parsed = whatwgParse(raw);
  const events = parsed.events.map((e) => norm({ ...e, data_bytes: Buffer.byteLength(e.data, 'utf8') }));
  const ref = { flavor: r.flavor, source: 'reference WHATWG parse of the bytes the control received', raw_bytes: raw.length, raw_sha256: r.control.raw_sha256, events, last_event_id_at_eof: parsed.lastEventIdAtEof, last_event_id_buffer_at_eof: parsed.lastEventIdBufferAtEof, retry_ms: parsed.retry, discarded_pending_data: parsed.discardedPending, curl_exit: r.control.curl_exit, connections_expected: 1 };
  if (r.flavor === 'resume') {
    // The control sees connection 1 (ids 1–3). Connections 2 and 3 come from the flavor's documented sequence.
    ref.source += '; connections 2 and 3 (ids 4–6, then 204) from the documented sequence of /sse/resume, which curl does not reconnect to witness';
    ref.events_later_connections = [4, 5, 6].map((n) => norm({ type: 'tick', id: String(n), data: `{"n":${n}}` }));
    ref.connections_expected = 3;
  }
  REFERENCE[r.flavor] = ref;
}
// Sanity floors on the reference itself: the control must have seen what src/sse.js emits, or the capture is wrong.
const floors = { ok: 5, stall: 1, cut: 1, drop: 1, crlf: 3, cr: 3, 'no-space': 4, multiline: 3, comments: 3, 'split-utf8': 2, 'wrong-type': 3, 'error-event': 3, big: 1, resume: 3 };
for (const [f, n] of Object.entries(floors)) if (REFERENCE[f].events.length !== n) bad(`reference for ${f} has ${REFERENCE[f].events.length} events, src/sse.js emits ${n}: the control capture is not what the server sends`);
if (REFERENCE.cut.last_event_id_at_eof !== '1' || REFERENCE.cut.last_event_id_buffer_at_eof !== '2' || !REFERENCE.cut.discarded_pending_data) bad('reference for cut must end with pending data, last event ID string 1 and buffer 2');
if (REFERENCE.big.events[0].data_bytes !== 65536) bad('reference for big must be 65536 data bytes');

// ---------- expected end, by class and flavor ----------
function expectedEnd(cls, flavor) {
  if (cls === 'eventsource') {
    if (flavor === 'resume') return ['stopped'];
    if (flavor === 'drop') return ['reconnecting', 'error'];
    if (flavor === 'wrong-type') return ['error'];
    return ['reconnecting'];
  }
  // one-shot
  if (flavor === 'drop') return ['error'];
  if (flavor === 'wrong-type') return ['error', 'clean'];
  return ['clean'];
}
function expectedEvents(cls, flavor) {
  const ref = REFERENCE[flavor];
  if (flavor === 'resume' && cls === 'eventsource') return [...ref.events, ...ref.events_later_connections];
  if (flavor === 'wrong-type' && cls === 'eventsource') return []; // fail the connection, deliver nothing
  return ref.events;
}
const same = (a, b) => a.type === b.type && (a.id ?? null) === (b.id ?? null) && (a.data_bytes > 200 || b.data_bytes > 200 ? a.data_bytes === b.data_bytes && a.data_sha256 === b.data_sha256 : a.data === b.data);
const show = (e) => `${e.type}#${e.id ?? '-'}:${e.data_bytes > 200 ? `<${e.data_bytes} bytes>` : JSON.stringify(e.data)}`;

// Several libraries dispatch an EVENT for the stream's opening "retry: 30000" block, which the spec dispatches nothing
// for (no data buffer). Counting that on every flavor would hide every other difference behind one cause, so the
// comparison drops a delivered event that has empty data AND no id change from the event before it (null at the start),
// counts it in preamble_events, and the findings report which libraries do it. no-space's two empty events keep their
// own ids (3, 4) and are never dropped by this rule.
function stripPreamble(events) {
  const kept = []; const droppedIdx = []; let prevId = null;
  events.forEach((e, i) => {
    const id = e.id == null ? null : String(e.id);
    if ((e.data === '' || e.data == null) && id === prevId) { droppedIdx.push(i); return; }
    kept.push(e); prevId = id;
  });
  return { kept, dropped: droppedIdx.length, droppedIdx };
}

function classify(r) {
  if (r.client.role === 'control') return { outcome: 'control', diff: null, preamble: 0 };
  if (r.end === 'harness-timeout') return { outcome: 'harness-timeout', diff: `the harness cap fired after ${r.events.length} events` };
  if (r.attempts > 3 || r.request_failed) return { outcome: 'request-failed', diff: r.reported_error || null };
  const cls = r.client.class;
  const exp = expectedEvents(cls, r.flavor);
  const { kept, dropped, droppedIdx } = stripPreamble((r.events || []).map(norm));
  const got = kept;
  r.__preambleIdx = droppedIdx;
  // wrong-type for one-shot: both answers are described; events must match whichever end it chose
  let expEvents = exp;
  if (r.flavor === 'wrong-type' && cls === 'one-shot') expEvents = r.end === 'clean' ? REFERENCE['wrong-type'].events : [];
  const ends = expectedEnd(cls, r.flavor);
  const endOk = ends.includes(r.end) || (r.end === 'closed-by-harness' && cls === 'eventsource' && (r.connections || []).length === 1 && (r.connections[0].ended === 'server-closed' || r.connections[0].ended === 'reset'));
  let evDiff = null;
  if (got.length !== expEvents.length) evDiff = `delivered ${got.length} events, the reference has ${expEvents.length}${got.length > expEvents.length ? ` (extra: ${got.slice(expEvents.length).map(show).join('; ')})` : expEvents.length > got.length ? ` (missing: ${expEvents.slice(got.length).map(show).join('; ')})` : ''}`;
  else for (let i = 0; i < got.length; i++) if (!same(got[i], expEvents[i])) { evDiff = `event ${i + 1} delivered as ${show(got[i])}, reference ${show(expEvents[i])}`; break; }
  const endDiff = endOk ? null : `ended ${r.end}, expected ${ends.join(' or ')} for ${cls === 'eventsource' ? 'an' : 'a'} ${cls} client${r.flavor === 'resume' && (r.connections || []).length === 1 ? ' (no reconnection)' : ''}`;
  const outcome = evDiff && endDiff ? 'both-differ' : evDiff ? 'events-differ' : endDiff ? 'end-differs' : 'as-spec';
  return { outcome, diff: [evDiff, endDiff].filter(Boolean).join('; ') || null, preamble: dropped };
}

const OBS = rows.map((r) => {
  const { outcome, diff, preamble } = classify(r);
  const o = { ...r };
  o.preamble_events = preamble; // delivered events for the retry-only opening block, excluded from the comparison (see stripPreamble)
  delete o.control; // raw bytes stay in the capture file
  if (r.client.role === 'control') {
    o.control = { raw_bytes: r.control.raw_bytes, raw_sha256: r.control.raw_sha256, curl_exit: r.control.curl_exit };
    // The control delivers bytes, not events; its events are the reference parse of those bytes, so the row is self-describing.
    o.events_delivered = REFERENCE[r.flavor].events.length;
    o.events_note = 'the control parses nothing: these are the reference WHATWG parse of the bytes it received';
  }
  const evSource = r.client.role === 'control' ? REFERENCE[r.flavor].events.map((e) => ({ ...e })) : (r.events || []);
  const pre = new Set(r.__preambleIdx || []); delete o.__preambleIdx;
  // Served events keep the data as delivered (truncated past 200 bytes) plus the normalized hash; a preamble event
  // (the retry-only opening block) is marked so readers and the findings can skip it the way the comparison did.
  o.events = evSource.map((e, i) => { const n = norm(e); const out = { type: n.type, id: n.id, data: n.data_bytes > 200 ? (e.data || '').slice(0, 64) + '…' : e.data, data_bytes: n.data_bytes, data_sha256: n.data_sha256 }; if (pre.has(i)) out.preamble = true; return out; });
  o.outcome = outcome; o.diff = diff;
  if (VERDICT_WORDS.test(JSON.stringify(o))) bad(`${r.client.id}/${r.flavor}: a verdict word reached a row`);
  return o;
});
// order: flavor order, then roster order (control first)
const rosterOrder = [...clients.keys()].sort((a, b) => (clients.get(a).role === 'control' ? -1 : clients.get(b).role === 'control' ? 1 : a.localeCompare(b)));
OBS.sort((a, b) => FLAVOR_ORDER.indexOf(a.flavor) - FLAVOR_ORDER.indexOf(b.flavor) || rosterOrder.indexOf(a.client.id) - rosterOrder.indexOf(b.client.id));

const CLIENTS = rosterOrder.map((id) => { const c = clients.get(id); const { flavors, ...rest } = c; return rest; });
const witness = {
  family: 'sse', probed: prov.probed, badhttp_version_observed: BADHTTP_VERSION, worker_version: prov.worker_version || null,
  flavors: FLAVOR_ORDER.length, clients: CLIENTS.filter((c) => c.role === 'client').length, source_file: SRC.replace(/^.*?docs\//, 'docs/'), run_log: SRC.replace(/^.*?docs\//, 'docs/').replace(/\.jsonl$/, '.log'), capture_scripts: 'scripts/sse-witness/',
};
const header = `// GENERATED by scripts/witness-parse-sse.mjs from ${witness.source_file} — do not edit by hand.
// Re-run the generator after any new capture; the capture scripts are in scripts/sse-witness/.
//
// ${witness.clients} real SSE client libraries plus a raw-wire control (curl), one fresh client per (client, flavor), pointed at
// GET /sse/{flavor} for every flavor on ${witness.probed} against badhttp ${BADHTTP_VERSION}${witness.worker_version ? ` (Worker deployment ${witness.worker_version})` : ''}.
// The reference for every flavor is a WHATWG §9.2.6 parse of the bytes the control received (REFERENCE_SSE); each
// row's outcome describes what the client delivered relative to that, for the client's class. Never a verdict.
`;
const lit = (name, v) => `export const ${name} = ${JSON.stringify(v, null, 2)};\n`;
writeFileSync(OUT, `${header}\n${lit('WITNESS_SSE', witness)}\n${lit('CLIENTS_SSE', CLIENTS)}\n${lit('REFERENCE_SSE', REFERENCE)}\n${lit('OBSERVATIONS_SSE', OBS)}`);
const counts = {};
for (const o of OBS) counts[o.outcome] = (counts[o.outcome] || 0) + 1;
console.log(`wrote ${OUT}: ${OBS.length} rows (${CLIENTS.length} roster entries x ${FLAVOR_ORDER.length} flavors), badhttp ${BADHTTP_VERSION}, outcomes ${JSON.stringify(counts)}`);
}

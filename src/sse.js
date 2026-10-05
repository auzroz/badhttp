// /sse — Server-Sent Events streams that misbehave on purpose (WHATWG HTML §9.2).
// Every LLM / MCP / streaming-API client hand-rolls an SSE parser; these are the cases they get wrong.
// Stateless, no outbound requests. Helpers (json, bad, intParam, …) come in from index.js so there is one style.

import { WITNESS_SSE, CLIENTS_SSE, REFERENCE_SSE, OBSERVATIONS_SSE } from './witness-sse-data.js';

const RETRY = 'retry: 30000';
const enc = new TextEncoder();

// An event (or any run of lines) terminated the way the flavor wants, followed by the blank line that dispatches it.
const block = (lines, eol = '\n') => lines.map((l) => l + eol).join('') + eol;
const bytes = (s) => enc.encode(s);
const tick = (n, of, eol = '\n') => block([`id: ${n}`, 'event: tick', `data: {"n":${n},"of":${of},"t":${Date.now()}}`], eol);

// Each flavor's `stream` is a generator of { wait, bytes } parts: wait (ms) before the part, then bytes (may be
// empty: a pure pause). Each yielded part is one controller.enqueue, i.e. one chunk on the wire.
export const SSE = {
  'ok': {
    about: 'A correct stream, for comparison: retry, id, event and data fields, blank-line delimited, then a clean close. ?events= and ?interval= (ms).',
    params({ url, intParam, limits }) {
      const events = intParam(url.searchParams.get('events') ?? '5', { min: 1, max: limits.sseMaxEvents, name: 'events' });
      if (events.error) return { error: events.error, hint: `?events=5&interval=250 (max ${limits.sseMaxEvents} events, ${limits.sseMaxIntervalMs} ms)` };
      const interval = intParam(url.searchParams.get('interval') ?? '250', { min: 0, max: limits.sseMaxIntervalMs, name: 'interval' });
      if (interval.error) return { error: interval.error };
      if (events.value * interval.value > limits.sseMaxSeconds * 1000) return { error: `events * interval must be at most ${limits.sseMaxSeconds * 1000} ms`, hint: 'the stream is capped at 20 s of wall time' };
      return { events: events.value, interval: interval.value };
    },
    *stream({ events, interval }) {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      for (let n = 1; n <= events; n++) yield { wait: n === 1 ? 0 : interval, bytes: bytes(tick(n, events)) };
    },
  },
  'stall': {
    about: 'Headers and one event arrive, then nothing for ?seconds= (default 10, max 20), then a clean close. A client with a connect timeout but no read timeout waits here.',
    params({ url, numParam, limits }) {
      const s = numParam(url.searchParams.get('seconds') ?? '10', { min: 0, max: limits.sseMaxSeconds, name: 'seconds' });
      if (s.error) return { error: s.error, hint: `?seconds=10 (max ${limits.sseMaxSeconds})` };
      return { seconds: s.value };
    },
    *stream({ seconds }) {
      yield { wait: 0, bytes: bytes(block([RETRY]) + block(['id: 1', 'event: tick', 'data: {"n":1}'])) };
      yield { wait: Math.round(seconds * 1000), bytes: new Uint8Array(0) };
    },
  },
  'cut': {
    about: 'Ends mid-event with a clean close: a complete event, then "data: {\\"partial\\":tr" and EOF with no blank line. The spec says the unterminated event is discarded.',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      yield { wait: 0, bytes: bytes(block(['id: 1', 'data: complete'])) };
      yield { wait: 100, bytes: bytes('id: 2\ndata: {"partial":tr') };
    },
  },
  'drop': {
    about: 'The connection is reset mid-event (HTTP/1.1: closed with bytes outstanding; HTTP/2: RST_STREAM). Your client should report an error, not a clean end. Carries a Content-Length so the runtime can reset for real.',
    drop: true,
    // Written, then the plug is pulled: retry, one complete event, the first line of a second.
    body: () => bytes(block([RETRY]) + block(['id: 1', 'event: tick', 'data: {"n":1}']) + 'id: 2\n'),
  },
  'crlf': {
    about: 'Every line ends in CRLF. The spec allows CR, LF or CRLF; parsers that split on "\\n" leave a trailing "\\r" in every value.',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY], '\r\n')) };
      for (let n = 1; n <= 3; n++) yield { wait: 0, bytes: bytes(tick(n, 3, '\r\n')) };
    },
  },
  'cr': {
    about: 'Every line ends in a bare CR. Spec-legal: CR alone is a line terminator.',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY], '\r')) };
      for (let n = 1; n <= 3; n++) yield { wait: 0, bytes: bytes(tick(n, 3, '\r')) };
    },
  },
  'no-space': {
    about: 'Field values with no space after the colon, two spaces, and nothing at all. The spec strips exactly one leading space: "data:foo" is "foo", "data:  foo" is " foo".',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      yield { wait: 0, bytes: bytes(block(['id: 1', 'data:foo'])) }; // value "foo"
      yield { wait: 0, bytes: bytes(block(['id: 2', 'data:  foo'])) }; // value " foo"
      yield { wait: 0, bytes: bytes(block(['id: 3', 'data: '])) }; // value "", still fires
      yield { wait: 0, bytes: bytes(block(['id: 4', 'data:'])) }; // value "", still fires
    },
  },
  'multiline': {
    about: 'Multiple data: lines per event (joined with "\\n"), a colon inside a value, an empty data: line in the middle. Parsers that keep only the last line, or split on ":", fail here.',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      yield { wait: 0, bytes: bytes(block(['id: 1', 'data: line one', 'data: line two', 'data: line three'])) }; // "line one\nline two\nline three"
      yield { wait: 0, bytes: bytes(block(['id: 2', 'data: key: value '])) }; // "key: value " (trailing space kept)
      yield { wait: 0, bytes: bytes(block(['id: 3', 'data: a', 'data:', 'data: b'])) }; // "a\n\nb"
    },
  },
  'comments': {
    about: 'A leading BOM, ": keepalive" comment lines, unknown fields ("foo: bar") and a field line with no colon. All four must be ignored; you should see exactly three events.',
    *stream() {
      yield { wait: 0, bytes: bytes('\uFEFF' + block([RETRY])) };
      yield { wait: 0, bytes: bytes(': keepalive\n' + block([': keepalive', 'id: 1', 'foo: bar', 'data: {"n":1}'])) };
      yield { wait: 0, bytes: bytes(': keepalive\n' + block(['id: 2', 'data: {"n":2}', 'heartbeat'])) };
      yield { wait: 0, bytes: bytes(block(['id: 3', ': keepalive', 'data: {"n":3}']) + ': keepalive\n') };
    },
  },
  'split-utf8': {
    about: 'Multi-byte UTF-8 characters split across chunk boundaries (a 4-byte emoji as 2+2, a 3-byte euro sign as 1+2). A client that decodes each chunk separately sees U+FFFD.',
    *stream() {
      // Byte-exact on purpose: the split must land inside a character, so no strings cross the boundary.
      yield { wait: 0, bytes: new Uint8Array([...bytes(block([RETRY]) + 'id: 1\ndata: '), 0xf0, 0x9f]) }; // first half of 🐍
      yield { wait: 300, bytes: new Uint8Array([0x90, 0x8d, ...bytes(' ok\n\n')]) };
      yield { wait: 0, bytes: new Uint8Array([...bytes('id: 2\ndata: '), 0xe2]) }; // first byte of €
      yield { wait: 300, bytes: new Uint8Array([0x82, 0xac, ...bytes(' ok\n\n')]) };
    },
  },
  'wrong-type': {
    about: 'A valid stream served as text/plain. A browser EventSource must fail; does your client notice?',
    contentType: 'text/plain; charset=utf-8',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      for (let n = 1; n <= 3; n++) yield { wait: 0, bytes: bytes(tick(n, 3)) };
    },
  },
  'error-event': {
    about: 'An event whose name is "error". EventSource routes it to onerror beside real transport failures; does your client tell them apart?',
    *stream() {
      yield { wait: 0, bytes: bytes(block([RETRY])) };
      yield { wait: 0, bytes: bytes(block(['id: 1', 'event: tick', 'data: {"n":1}'])) };
      yield { wait: 0, bytes: bytes(block(['id: 2', 'event: error', 'data: {"code":"upstream_timeout","message":"this is a message, not a transport error"}'])) };
      yield { wait: 0, bytes: bytes(block(['id: 3', 'event: tick', 'data: {"n":3}'])) };
    },
  },
  'big': {
    about: 'One event with a ?bytes= (default 64 KiB, max 1 MiB) data line. Line buffers with a fixed cap truncate or crash.',
    params({ url, intParam, limits }) {
      const b = intParam(url.searchParams.get('bytes') ?? String(64 * 1024), { min: 1, max: limits.sseMaxBytes, name: 'bytes' });
      if (b.error) return { error: b.error, hint: `?bytes=65536 (max ${limits.sseMaxBytes})` };
      return { bytes: b.value };
    },
    *stream({ bytes: size }) {
      yield { wait: 0, bytes: bytes(block([RETRY]) + 'id: 1\ndata: ') };
      for (let sent = 0; sent < size; sent += 16 * 1024) yield { wait: 0, bytes: bytes('x'.repeat(Math.min(16 * 1024, size - sent))) };
      yield { wait: 0, bytes: bytes('\n\n') };
    },
  },
  'resume': {
    about: 'Sends events 1–3 and closes. Reconnect with Last-Event-ID: 3 and it sends 4–6; with 6 it answers 204 (stop). Its retry is 1000 ms so the three requests complete quickly. Does your client send Last-Event-ID on reconnect, and stop on a 204?',
    resume: true,
    params({ request }) {
      const last = request.headers.get('last-event-id');
      if (last === null) return { start: 0 };
      if (!/^\d+$/.test(last.trim())) return { error: 'Last-Event-ID must be an integer here', hint: 'this stream issues integer ids 1–6' };
      const n = Number(last.trim());
      if (n >= 6) return { done: true };
      return { start: n };
    },
    *stream({ start }) {
      yield { wait: 0, bytes: bytes(block(['retry: 1000'])) };
      for (let n = start + 1; n <= Math.min(start + 3, 6); n++) yield { wait: 0, bytes: bytes(block([`id: ${n}`, 'event: tick', `data: {"n":${n}}`])) };
    },
  },
};

const RECONNECT_NOTE = 'reconnect declined; a 204 tells EventSource to stop reconnecting';
const STOP = (withBase) => new Response(null, { status: 204, statusText: 'No Content', headers: withBase({ 'x-badhttp-note': RECONNECT_NOTE }) });

export function handleSse({ seg, url, request, json, bad, intParam, numParam, withBase, limits, sleep }) {
  const flavor = seg[1];
  if (seg.length > 2) return json({ error: 'not found', hint: '/sse/{flavor}; GET /sse lists the flavors' }, 404);
  if (!flavor) {
    return json({
      flavors: Object.fromEntries(Object.entries(SSE).map(([k, v]) => [k, v.about])),
      usage: '/sse/{flavor}',
      limits: { max_seconds: limits.sseMaxSeconds, max_events: limits.sseMaxEvents, max_interval_ms: limits.sseMaxIntervalMs, max_bytes: limits.sseMaxBytes },
      reconnect: `Every stream starts with "retry: 30000" (resume alone sends "retry: 1000"). A GET or HEAD with valid parameters that carries a Last-Event-ID header is answered 204 No Content (${RECONNECT_NOTE}), except /sse/resume, which continues from it.`,
      witness: sseWitness(),
    });
  }
  const f = Object.hasOwn(SSE, flavor) ? SSE[flavor] : undefined;
  if (!f) return json({ error: 'unknown flavor', flavors: Object.keys(SSE) }, 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed', hint: 'GET /sse/{flavor} to stream it, HEAD for the headers' }, 405, { allow: 'GET, HEAD, OPTIONS' });
  }
  // Parameters are checked before anything is written, so a client never gets a 200 that then misbehaves by accident.
  const params = f.params ? f.params({ url, request, intParam, numParam, limits }) : {};
  if (params.error) return bad(params.error, params.hint);
  if (params.done) return STOP(withBase);
  if (!f.resume && request.headers.has('last-event-id')) return STOP(withBase);

  const headers = {
    'content-type': f.contentType || 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform', // no-transform: without it the edge may compress the stream
    'x-accel-buffering': 'no',
    'x-badhttp-flavor': flavor,
  };

  if (f.drop) {
    const body = f.body();
    const declared = body.byteLength + 512;
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: withBase({ ...headers, 'content-length': declared }) });
    // As /truncate: FixedLengthStream makes the runtime emit Content-Length; aborting the writer short of it
    // drops the connection instead of finishing the body, which is the only way a Worker produces a real reset.
    const { readable, writable } = new FixedLengthStream(declared);
    const writer = writable.getWriter();
    (async () => {
      try {
        await writer.write(body);
        await sleep(100); // let the partial body reach the wire before pulling the plug
        await writer.abort(new Error('badhttp: dropped on purpose'));
      } catch (e) {
        // The client may have gone away first. That is fine.
      }
    })();
    return new Response(readable, { status: 200, headers: withBase(headers) });
  }

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: withBase(headers) });
  const parts = f.stream(params);
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = parts.next();
      if (done) {
        controller.close();
        return;
      }
      // The first part goes out immediately so headers flush; later parts wait their share first.
      if (value.wait > 0) await sleep(value.wait);
      if (value.bytes.byteLength > 0) controller.enqueue(value.bytes);
    },
    cancel() {
      parts.return();
    },
  });
  return new Response(stream, { status: 200, headers: withBase(headers) });
}

// ---------- the witness: what real SSE client libraries did with these streams (session 27, 2026-10-05) ----------
// Everything below is computed from the /clients.jsonl sse rows (src/witness-sse-data.js, generated from the committed
// capture by scripts/witness-parse-sse.mjs). The reference for each flavor is a WHATWG §9.2.6 parse of the bytes the
// curl control received, so no expected value is typed here. Sentences describe what a library delivered to its
// caller relative to that parse and to the library's CLASS (eventsource: auto-reconnects after any server close;
// one-shot: iterates one response and returns). Explanations of WHY a named library did something are gated on the
// computed list being the one they were written for, so a re-capture that moves a list drops the explanation.
const sObs = (client, flavor) => OBSERVATIONS_SSE.find((o) => o.client.id === client && o.flavor === flavor);
const sClients = () => CLIENTS_SSE.filter((c) => c.role === 'client');
const sName = (id) => (CLIENTS_SSE.find((c) => c.id === id) || { name: id }).name;
const sWhere = (flavor, pred) => sClients().filter((c) => { const o = sObs(c.id, flavor); return !!(o && pred(o)); }).map((c) => c.name);
const sList = (a) => (a.length ? a.join(', ') : 'none');
const sAll = (names) => (names.length === sClients().length ? `all ${names.length} libraries` : sList(names));
const sByClass = (cls) => sClients().filter((c) => c.class === cls).map((c) => c.name);
// The events a finding counts are the delivered events MINUS the retry-only preamble events (marked by the parser), which
// is exactly what the comparison counted; the raw list stays on the row.
const evs = (o) => (o.events || []).filter((e) => !e.preamble);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sGroups = (flavor, key) => {
  const m = new Map();
  for (const c of sClients()) { const o = sObs(c.id, flavor); if (!o) continue; const k = key(o); m.set(k, (m.get(k) || []).concat(c.name)); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} (${sList(v)})`).join('; ');
};

export function sseFindings() {
  if (!OBSERVATIONS_SSE.length) return [];
  const N = sClients().length;
  const ref = (f) => REFERENCE_SSE[f] ? REFERENCE_SSE[f].events : [];
  const okAll = sWhere('ok', (o) => o.outcome === 'as-spec');
  const okEnds = sGroups('ok', (o) => `ended ${o.end}`);
  const cutPartial = sWhere('cut', (o) => evs(o).length > ref('cut').length);
  const cutDiscard = sWhere('cut', (o) => evs(o).length === ref('cut').length);
  const cutLastId = sGroups('cut', (o) => (o.last_event_id_final == null ? 'exposes no last event id' : `last event id ${o.last_event_id_final}`));
  const dropErr = sWhere('drop', (o) => o.end === 'error' || o.end === 'reconnecting');
  const dropClean = sWhere('drop', (o) => o.end === 'clean');
  const crlfKept = sWhere('crlf', (o) => evs(o).some((e) => /\r/.test(e.data || '') || /\r/.test(e.type || '')));
  const crlfOk = sWhere('crlf', (o) => o.outcome === 'as-spec');
  const crNone = sWhere('cr', (o) => evs(o).length === 0);
  const crOk = sWhere('cr', (o) => o.outcome === 'as-spec');
  const crOther = sWhere('cr', (o) => evs(o).length > 0 && o.outcome !== 'as-spec');
  const nsOk = sWhere('no-space', (o) => o.outcome === 'as-spec');
  const nsDiff = sGroups('no-space', (o) => (o.outcome === 'as-spec' ? 'as the spec strips' : evs(o).length !== 4 ? `${plural(evs(o).length, 'event')} delivered` : `values ${evs(o).map((e) => JSON.stringify(e.data)).join(' ')}`));
  const mlOk = sWhere('multiline', (o) => o.outcome === 'as-spec');
  const mlDiff = sWhere('multiline', (o) => o.outcome !== 'as-spec');
  const cmOk = sWhere('comments', (o) => o.outcome === 'as-spec');
  const cmDiff = sGroups('comments', (o) => (o.outcome === 'as-spec' ? 'three events, BOM and comments ignored' : `${plural(evs(o).length, 'event')}, ${o.diff || 'differs'}`));
  const suOk = sWhere('split-utf8', (o) => o.outcome === 'as-spec');
  const suFffd = sWhere('split-utf8', (o) => evs(o).some((e) => (e.data || '').includes('\uFFFD')));
  const wtRefused = sWhere('wrong-type', (o) => evs(o).length === 0 && (o.end === 'error' || o.end === 'reconnecting'));
  const wtDelivered = sWhere('wrong-type', (o) => evs(o).length === ref('wrong-type').length);
  const eeAsEvent = sWhere('error-event', (o) => evs(o).some((e) => e.type === 'error'));
  const eeOnErrorListener = sWhere('error-event', (o) => (o.errors || []).some((e) => e.had_data));
  const eeCallback = sWhere('error-event', (o) => !evs(o).some((e) => e.type === 'error') && (o.errors || []).some((e) => e.had_data));
  const eeDropped = sWhere('error-event', (o) => !evs(o).some((e) => e.type === 'error') && !(o.errors || []).some((e) => e.had_data));
  const bigOk = sWhere('big', (o) => o.outcome === 'as-spec');
  const bigDiff = sGroups('big', (o) => (o.outcome === 'as-spec' ? 'the 65,536-byte line intact' : evs(o).length === 0 ? `nothing of it${o.errors && o.errors[0] ? ` (${o.errors[0].message.slice(0, 80)})` : ''}` : o.diff || 'differs'));
  const bigNone = sWhere('big', (o) => evs(o).length === 0);
  const es = sByClass('eventsource'), os = sByClass('one-shot');
  const rsFull = sWhere('resume', (o) => o.client.class === 'eventsource' && o.outcome === 'as-spec');
  const rsEs = sGroups('resume', (o) => (o.client.class !== 'eventsource' ? `one connection, ${plural(evs(o).length, 'event')}, no reconnection by design` : `${plural((o.connections || []).length, 'connection')}, ${plural(evs(o).length, 'event')}, ended ${o.end}${(o.connections || []).slice(1).some((c) => c.last_event_id_sent != null) ? `, Last-Event-ID sent: ${(o.connections || []).slice(1).map((c) => c.last_event_id_sent).join(' then ')}` : ''}`));
  const stallWait = sGroups('stall', (o) => (o.end === 'harness-timeout' ? 'still waiting when the 30 s cap fired' : `${plural(evs(o).length, 'event')}, then ended ${o.end} after ${Math.round((o.wall_ms || 0) / 1000)} s`));
  const dropFewer = sWhere('drop', (o) => evs(o).length < ref('drop').length);
  const dropExtra = sWhere('drop', (o) => evs(o).length > ref('drop').length);
  // Per library: on how many of its rows an empty event for the opening retry block was delivered (preamble_events > 0). Counted, never typed.
  const preambleLibs = sClients().map((c) => { const rows = OBSERVATIONS_SSE.filter((o) => o.client.id === c.id); const n = rows.filter((o) => (o.preamble_events || 0) > 0).length; return { name: c.name, n, of: rows.length }; }).filter((p) => p.n > 0);
  const cmGoOnly = sWhere('comments', (o) => o.outcome === 'end-differs' && o.end === 'clean').join('|') === 'go-sse';
  const bigGoBoth = bigNone.slice().sort().join('|') === ['go-sse', 'r3labs/sse'].sort().join('|');
  const timeouts = OBSERVATIONS_SSE.filter((o) => o.client.role === 'client' && o.outcome === 'harness-timeout');
  const failed = OBSERVATIONS_SSE.filter((o) => o.client.role === 'client' && o.outcome === 'request-failed');
  const asSpec = OBSERVATIONS_SSE.filter((o) => o.client.role === 'client' && o.outcome === 'as-spec').length;
  const total = OBSERVATIONS_SSE.filter((o) => o.client.role === 'client').length;
  return [
    `Two classes of library were measured and the expected ending differs by class: ${sList(es)} implement the EventSource interface (${es.length}), which reconnects after any server close and so reports a clean end as an error event in its reconnecting state; ${sList(os)} iterate one response and return (${os.length}). ${asSpec} of ${total} rows delivered what their class is expected to and ended as expected for it: the reference parse of the control's bytes, except that the EventSource interface delivers nothing on wrong-type and, on resume, also the events 4-6 of the documented later connections (a one-shot library on wrong-type may deliver either).`,
    `ok (the control stream, five events): ${sAll(okAll)} delivered the five events as the reference parse has them; endings: ${okEnds}.`,
    `cut (a complete event, then "data: {\\"partial\\":tr" and EOF with no blank line; the spec discards it): ${cutDiscard.length ? `${sAll(cutDiscard)} delivered one event` : 'no library delivered exactly one event'}${cutPartial.length ? `; ${sList(cutPartial)} delivered the unterminated partial as an event` : ''}. The spec updates the Last-Event-ID string only when a blank line is processed, so after the unterminated "id: 2" a reconnect still carries 1; where a library exposes its last event id: ${cutLastId}.`,
    `drop (the connection reset mid-event): ${dropErr.length ? `${sAll(dropErr)} reported it as an error or entered their reconnecting state` : 'no library reported it as an error'}${dropClean.length ? `; ${sList(dropClean)} reported a clean end` : ''}${dropFewer.length ? `; ${sList(dropFewer)} delivered none of the complete event that arrived before the reset` : ''}${dropExtra.length ? `; ${sList(dropExtra)} delivered the half-written second event as an event of its own` : ''}. stall (one event, then ten seconds of silence, then a close): ${stallWait}.`,
    `crlf: ${crlfOk.length === N ? 'every library' : sList(crlfOk)} delivered the three events with clean values${crlfKept.length ? `; ${sList(crlfKept)} kept a trailing carriage return in a value or event name` : ''}. cr (bare CR line endings, spec-legal): ${crOk.length ? `${sAll(crOk)} parsed it as the spec says` : 'no library parsed it as the spec says'}${crNone.length ? `; ${sList(crNone)} delivered nothing at all` : ''}${crOther.length ? `; ${sList(crOther)} delivered something else (see diff on the rows)` : ''}.`,
    `no-space ("data:foo" is "foo", "data:  foo" is " foo", "data: " and "data:" are "" and still fire): ${nsOk.length === N ? 'every library stripped exactly one leading space and fired the two empty events' : nsDiff}.`,
    `multiline (three data lines joined with LF, a colon inside a value, an empty data line in the middle): ${mlOk.length === N ? 'every library' : sAll(mlOk)} delivered the three values as the reference parse has them${mlDiff.length ? `; ${sList(mlDiff)} differed (diff on the row)` : ''}. comments (a BOM, comment lines, an unknown field, a line with no colon): ${cmOk.length === N ? 'every library ignored all four and delivered three events' : cmDiff}.${cmGoOnly ? ' go-sse delivered the three events and then returned without an error and without scheduling a reconnect: this stream happens to end on a bare comment line, and its read loop treats that ending as a normal return rather than the end of the stream its documentation says it reconnects after.' : ''}`,
    `split-utf8 (a 4-byte and a 3-byte character each split across two chunks): ${suOk.length ? `${sAll(suOk)} reassembled both characters` : 'no library reassembled both characters'}${suFffd.length ? `; ${sList(suFffd)} delivered U+FFFD where the split fell, decoding each chunk on its own` : ''}.`,
    `wrong-type (a valid stream served as text/plain; the EventSource interface must fail the connection): ${wtRefused.length ? `${sList(wtRefused)} refused it and delivered nothing` : 'no library refused it'}${wtDelivered.length ? `; ${sList(wtDelivered)} delivered the three events regardless` : ''}. A one-shot library is under no specification obligation to check the type; the rows say which did.`,
    `error-event (an event whose name is "error", between two ticks): ${eeAsEvent.length ? `${sList(eeAsEvent)} delivered it as a named event` : 'no library delivered it as a named event'}${eeOnErrorListener.length ? ` — and for ${sList(eeOnErrorListener)} it arrived on the same error listener as a transport failure would, so a caller must look for the event's data to tell them apart` : ''}${eeCallback.length ? `; ${sList(eeCallback)} surfaced it only through their error callback` : ''}${eeDropped.length ? `; ${sList(eeDropped)} delivered neither an event nor an error carrying its data` : ''}.`,
    `big (one 65,536-byte data line): ${bigOk.length === N ? 'every library delivered the line intact' : bigDiff}.${bigGoBoth ? ' Both Go libraries read lines through a bufio.Scanner whose default token limit is 64 KiB, and a 65,536-byte data line plus its field name is longer than that.' : ''}`,
    `The stream's opening "retry: 30000" block dispatches no event in the specification (it has no data), and ${preambleLibs.length ? `${sList(preambleLibs.map((p) => `${p.name} (on ${p.n} of ${p.of} flavors)`))} delivered an empty event for it` : 'no library delivered an event for it'}; those events are recorded on the rows (preamble_events) and excluded from the comparison so they do not hide anything else. An empty event at the very end of a stream is not the opening block and is kept in the comparison.`,
    `resume (ids 1–3, then 4–6 to a reconnect carrying Last-Event-ID: 3, then a 204): ${rsFull.length ? `${sList(rsFull)} ran the whole sequence — three connections, six events, stopped at the 204` : 'no EventSource-class library ran the whole sequence'}; per library: ${rsEs}.`,
    `${timeouts.length} of ${total} rows hit the harness's 30 s cap${timeouts.length ? ` (${sList(timeouts.map((o) => `${sName(o.client.id)} on ${o.flavor}`))})` : ''} and ${failed.length} failed to land${failed.length ? ` (${sList(failed.map((o) => `${sName(o.client.id)} on ${o.flavor}`))})` : ''}. Every other row is a stream this server sent, read back from the wire with its x-badhttp-version on every connection.`,
  ];
}

export function sseWitness() {
  return {
    measured: WITNESS_SSE.probed,
    observations: OBSERVATIONS_SSE.filter((o) => o.client.role === 'client').length,
    control_rows: OBSERVATIONS_SSE.filter((o) => o.client.role === 'control').length,
    data: 'https://badhttp.dev/clients.jsonl',
    data_note:
      'Every observation is a row of /clients.jsonl with family "sse", joined to /corpus.jsonl by corpus_id; /clients ' +
      'indexes them with the class legend, the outcome legend and the per-flavor disagreement. The findings below are ' +
      'a reading of those rows, not a second source.',
    what_this_is:
      `${sClients().length} real SSE client libraries plus a raw-wire control (curl), one fresh client per flavor, pointed at ` +
      'GET /sse/{flavor} with default parameters on this exact date. It is a DATED CAPTURE, not a live measurement. The ' +
      'reference for each flavor is a WHATWG HTML §9.2.6 parse of the bytes the control received — derived from the ' +
      'wire, never typed — and each row describes what the library delivered to its caller relative to that parse and ' +
      'to the library\'s class (an EventSource-interface library reconnects after any server close; a one-shot library ' +
      'returns). "differs" is a description: a one-shot library not reconnecting on resume is its design, and a ' +
      'one-shot library delivering a text/plain stream is a choice the specification does not constrain. No library ' +
      'here is scored, ranked or called conformant. Re-run it and move the date rather than letting it stale.',
    clients: CLIENTS_SSE.filter((c) => c.role === 'client').map((c) => `${c.name} ${c.version} (${c.class})`),
    control: CLIENTS_SSE.filter((c) => c.role === 'control').map((c) => `${c.name} ${c.version}`),
    reference: 'REFERENCE in the /clients sse family block: per flavor, the events the WHATWG algorithm yields from the control\'s bytes, their SHA-256, the last event id at EOF and whether pending data was discarded',
    findings: sseFindings(),
    what_the_rows_cannot_say:
      'Whether a library\'s reconnect would carry Last-Event-ID correctly on every flavor (only resume lets the reconnect ' +
      'run; every other stream says retry: 30000 and the harness closes the client when its first connection ends), what a ' +
      'library does after the 30 s cap, how a browser\'s EventSource behaves (no browser in the roster), and anything about ' +
      'the HTTP/2 path where the library could not be made to use HTTP/1.1 (the row records the protocol).',
    reproduce:
      'Point the row\'s library at the row\'s url with a fresh instance, collect every event it delivers with its type, ' +
      'id and data, note how it signals the end, and compare with the row\'s events and end; for the reference, ' +
      'capture the bytes with curl -sS -N --http1.1 and parse them by WHATWG HTML §9.2.6. Pace the calls ' +
      'against the zone limit of 100 per 10 s, and treat a first response without x-badhttp-version as no observation. ' +
      'The harnesses that produced the rows are in scripts/sse-witness/ in the source.',
  };
}

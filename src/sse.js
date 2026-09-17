// /sse — Server-Sent Events streams that misbehave on purpose (WHATWG HTML §9.2).
// Every LLM / MCP / streaming-API client hand-rolls an SSE parser; these are the cases they get wrong.
// Stateless, no outbound requests. Helpers (json, bad, intParam, …) come in from index.js so there is one style.

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
    about: 'Ends mid-event with a clean close: a complete event, then "data: {\\"partial\\":tr" and EOF with no blank line. The spec says discard it; many parsers emit it or leak it into the next connection.',
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
    about: 'Every line ends in a bare CR. Spec-legal. Almost nobody handles it.',
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
      reconnect: `Every stream starts with "retry: 30000" (resume alone sends "retry: 1000"). Any request carrying a Last-Event-ID header is answered 204 No Content (${RECONNECT_NOTE}), except /sse/resume, which continues from it.`,
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

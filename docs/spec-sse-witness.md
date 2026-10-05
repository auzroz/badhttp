# `/sse` witness capture — the fifth `/clients.jsonl` family

Session 27, 2026-10-05. Target: v0.22.0. Pattern: `scripts/cookies-witness/` (session 26) and
`docs/spec-cookies-witness.md`; same rules, same parser discipline, same honesty boundary (`docs/spec-clients.md`).

## Why

Every LLM client, every MCP client and every streaming-API SDK carries a hand-rolled Server-Sent Events parser,
and `/sse` has documented since v0.4.0 (2026-08-23) the fourteen ways such a parser goes wrong. What it has
never published is what real SSE client libraries *do* with those streams. The home page's SSE note is still the
2026-08-23 sentence about Node 25's built-in `EventSource` — one client, six weeks old, hand-typed. This family
replaces it with rows.

Unlike the four earlier families, a specification of the CLIENT side exists here: the WHATWG HTML Living
Standard §9.2 ("Server-sent events") defines, byte for byte, how a stream is to be interpreted — line endings
(CR, LF, CRLF), the one leading space stripped from a value, comment lines, unknown fields, the BOM, multi-line
`data`, the `id`/`event`/`retry` fields, the dispatch on a blank line, discarding an unterminated event at EOF,
reconnecting with `Last-Event-ID`, stopping on 204, failing on a wrong Content-Type. So this family's rows are
described **relative to that processing model**, computed from the bytes this server actually sent — and the
word "verdict" is still banned, because the libraries measured here split into two classes with different
obligations (below), and `differs` on a one-shot library's `resume` row is a statement about its design, not
a defect.

## What is measured

**Roster** (one row per (client, flavor); 14 flavors; the exact versions are recorded on every row):

| id | library | class | role |
|---|---|---|---|
| `curl` | curl `-sS -N --http1.1` | raw wire | **control**: captures the bytes; the parser derives the reference parse from them |
| `node-eventsource` | Node 26 built-in `EventSource` (undici) | `eventsource` | client |
| `eventsource-npm` | npm `eventsource` (current major) | `eventsource` | client |
| `httpx-sse` | Python `httpx-sse` over httpx | `one-shot` | client |
| `sseclient-py` | Python `sseclient-py` over requests | `one-shot` | client |
| `aiohttp-sse-client` | Python `aiohttp-sse-client` over aiohttp | `eventsource` (it reconnects) or `one-shot` — the harness records which from its source | client |
| `go-sse` | Go `github.com/tmaxmax/go-sse` (or `r3labs/sse/v2` if the survey finds it the maintained one) | per its source | client |

The survey of installed sources (`docs/probe-sse-clients-<date>.log` records versions) fixes the final roster;
the harness refuses to publish a grid where a client does not cover every flavor.

**Two classes of client, named on every row as `client.class`:**
- `eventsource` — implements the WHATWG `EventSource` interface: auto-reconnects after the server closes
  (after `retry` ms, sending `Last-Event-ID`), stops on 204, fails the connection on a wrong Content-Type, and
  surfaces both a clean close and a transport failure as an `error` event (the interface cannot tell them apart).
- `one-shot` — iterates ONE response as a stream of events and returns when it ends; no reconnection is part of
  the library; whether it checks Content-Type is a library choice.

The expected END of a row therefore depends on the class (table below), and `reading_this` says so.

**Per (client, flavor): one fresh client instance, pointed at `GET /sse/{flavor}` with default parameters**
(`stall` is `?seconds=10` by default; `big` is 64 KiB; `ok` is 5 events at 250 ms). The harness records:

1. every CONNECTION the library opened (counted at a layer the harness names on the row, e.g. an undici
   dispatcher, a `fetch` wrapper, an httpx event hook, a requests adapter, an aiohttp trace config, a Go
   `RoundTripper`): its status, content-type, `x-badhttp-flavor`, `x-badhttp-version`, the `Last-Event-ID`
   request header value it carried (null when absent), and how it ended;
2. every EVENT delivered to the caller, in order: `type` (the event name the library reported; `message` when
   the library reports the default), `id` (the last event id the library associated with it, null if not
   exposed), `data` (the string the caller received — verbatim up to 200 bytes, else the first 64 characters
   plus `data_bytes` and `data_sha256`);
3. every ERROR surfaced to the caller (error callback / raised exception): a sanitized message (≤ 200 chars,
   no machine paths), whether it carried event data (the `error-event` flavor's trap), and the library's
   ready-state afterwards where it has one;
4. `end`: how the row finished from the caller's side —
   `clean` (the library signalled a normal end of stream), `error` (the library signalled a transport or
   protocol error), `reconnecting` (the library signalled an error event and entered its reconnecting state —
   the `eventsource`-class idiom for ANY server close), `stopped` (the library stopped on a 204 after
   reconnecting), `closed-by-harness` (the harness closed the client because the flavor's documented sequence
   was complete and the library would otherwise have reconnected or kept waiting), `harness-timeout` (the
   per-row wall-clock cap below fired first);
5. `retry_ms_adopted` (the retry value the library exposes, null if it does not), `last_event_id_final` (the
   library's notion of the last event id at the end, null if not exposed), `wall_ms`.

**Pacing and caps.** One client at a time, flavors in order, 1 s between rows, 3 s between clients, never while
`scripts/smoke.sh` runs (one IP, one zone rate limit). Per-row wall cap: 30 s (`stall` is 10 s + close;
`big` streams 64 KiB; `resume` with `retry: 1000` completes three connections in ~3 s). An `eventsource`-class
library is closed by the harness as soon as it has signalled the end of its FIRST connection (every stream but
`resume` says `retry: 30000`, so letting the reconnect happen would cost 30 s a row for one more 204; the row
records `end: reconnecting`, which is the library's state at that moment, and `resume` — `retry: 1000` — is the
flavor that lets the reconnect path run: the harness lets it reconnect until the 204 and caps connections at 6). A response without
`x-badhttp-version` on ANY connection of a row (the first, or a reconnection) is Cloudflare's rate limit, not an observation: retry the row after
a 12 s pause, `attempts` ≤ 3, and record a `request-failed` row only if it never clears.

**The control.** `curl -sS -N --http1.1 --max-time 30` captures each flavor's body byte-for-byte (`raw_base64` in
the capture file, never in the served rows: the served control row carries `raw_bytes` and `raw_sha256` only),
plus curl's exit code (18 on `drop` is the reset, witnessed). The parser runs a reference WHATWG parser over
those bytes to produce the **reference parse** for the flavor — the list of events the spec says those bytes
contain — so the oracle is derived from the wire, never hand-typed. For `resume` the control sees connection 1
only (curl does not reconnect); the reference for the later connections is the flavor's documented sequence
(ids 4–6 then 204), stated as such on the row.

**Normalization before comparison.** Tick events carry `"t":<ms>` (the server's clock) inside JSON data; the
parser removes the `t` key from any JSON-shaped data before comparing, so "same event" never depends on
timing. `big` is compared by `data_bytes` and `data_sha256`. The removal is internal to the comparison: the served
`data` is the string as delivered (the clock included), `data_bytes` is the byte length of that data, and
`data_sha256` is the hash of the full data and appears only past 200 bytes (null for smaller data). The same
holds for the control rows and for `reference`, which carry the reference parse's data as parsed.

**The opening `retry:` block.** Some libraries deliver an empty event for the stream's opening `retry: 30000` block,
which the specification dispatches nothing for. The comparison drops a delivered event with empty data, no id
change from the event before it, and that is not the last event delivered; it counts them in `preamble_events`
and marks them `preamble: true` on the row. An empty event at the very end of a stream is the stream's tail, not
its opening, and stays in the comparison.

## Row shape (one NDJSON line per (client, flavor); line 1 of the file is provenance)

```
{ "family":"sse", "id":"sse.<flavor>.<client>", "corpus_id":"sse.<flavor>", "url":"https://badhttp.dev/sse/<flavor>",
  "method":"GET", "flavor":"<flavor>", "probed":"<iso>", "badhttp_version":"<from the first connection>",
  "client": {"id","name","role":"client|control","class":"eventsource|one-shot|raw","version","library","platform","invocation","connections_counted_by"},
  "attempts": 1,
  "connections": [{"n":1,"status":200,"content_type":"text/event-stream; charset=utf-8","x_badhttp_flavor":"ok","last_event_id_sent":null,"ended":"server-closed|reset|client-closed|harness-timeout|status-204","error":null}],
  "events": [{"type":"tick","id":"1","data":"{\"n\":1,\"of\":5,\"t\":...}","data_bytes":30,"data_sha256":null}],
  "events_delivered": 5,
  "errors": [{"message":"...","had_data":false,"ready_state_after":"connecting"}],
  "end": "reconnecting",
  "retry_ms_adopted": 30000, "last_event_id_final": "5", "wall_ms": 1234,
  "control": {"raw_bytes": 412, "raw_sha256": "...", "curl_exit": 0}      // null on client rows
}
```
The parser adds `outcome`, `diff`, `reference` (a summary of the reference parse) and `license: "CC0-1.0"`. Every
served row carries every declared field (`events_note` and `control` are null on client rows).

## `outcome` (assigned by the parser; a description relative to the WHATWG processing model, never a verdict)

Expected end, by class and flavor: `eventsource` → `reconnecting` after every clean server close (`ok`, `stall`,
`cut`, `crlf`, `cr`, `no-space`, `multiline`, `comments`, `split-utf8`, `error-event`, `big`), `reconnecting` or
`error` after `drop`, `error` with zero events on `wrong-type`, `stopped` after six events on `resume`;
`one-shot` → `clean` after every clean close, `error` after `drop`, zero events + `error` on `wrong-type` **or**
the three events + `clean` (both described; a one-shot library is under no spec obligation to check the type,
and the row says which it did), `clean` after three events on `resume` (it does not reconnect — the row's
`connections` is 1 and `diff` says "no reconnection").

- `as-spec` — delivered events are what the client's class is expected to deliver and `end` is the expected one
  for the class. Expected events are the reference parse (after normalization), except that the `eventsource`
  interface delivers nothing on `wrong-type` and, on `resume`, also the events 4–6 of the documented later
  connections, and a one-shot library on `wrong-type` may deliver either.
- `events-differ` — `end` as expected, events not: fewer (`cut` partial discarded vs delivered; `cr` yielding
  nothing), more (the partial event delivered on `cut`), or altered (`\r` kept on `crlf`, U+FFFD on
  `split-utf8`, a leading space kept on `no-space`, lines dropped on `multiline`, the BOM in the first value on
  `comments`, `error` delivered as a callback instead of an event on `error-event`). `diff` names the first.
- `end-differs` — events as expected, `end` not (a reset reported as a clean end on `drop`; three events but no
  reconnection on `resume` for an `eventsource`-class library; a one-shot library that never returned).
- `both-differ`.
- `harness-timeout` — the 30 s cap fired (recorded with whatever was delivered).
- `request-failed` — no observation (rate limit never cleared, DNS, TLS).

`disagreement_by_flavor` counts distinct `(events, end)` answers among clients of the SAME class, as the auth
family counts within a mechanism kind. The events in an answer are the delivered events with the server clock
removed and the `preamble` events left out, so a flavor on which every client row is `as-spec` shows one answer
per class.

## What the rows cannot say, stated on the index

Whether a library's reconnect would have carried `Last-Event-ID` correctly on every flavor (only `resume` lets
it run), what a library does after the per-row cap, how a browser's `EventSource` behaves (no browser in the
roster), and anything about the HTTP/2 path (the harness forces HTTP/1.1 where the library allows it and
records the protocol it could not force).

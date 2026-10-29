// Run-once helpers for computations over constant data (session 37, 2026-10-29).
//
// Every witness summary, finding list and bulk body this Worker serves is a pure function of the
// constant witness tables, yet until v0.30.0 each was recomputed on every request: ~1 ms when the
// isolate was warm, tens of milliseconds in a fresh isolate (the x402 witness alone ~30 ms, the
// home page 38–81 ms, /clients.jsonl 36 ms, measured with `wrangler tail` on v0.29.0), and at this
// traffic most invocations land in a fresh isolate. Workers charge module evaluation against its
// own startup budget, not against the per-request CPU limit, so the work moves to module scope:
// once per isolate, at startup, for the canonical origin (see the warm-up at the end of index.js);
// any other key computes lazily on first use. Nothing here depends on the clock or the request.
export function once(fn) {
  let done = false;
  let value;
  return () => {
    if (!done) { value = fn(); done = true; }
    return value;
  };
}

export function perKey(fn) {
  const cache = new Map();
  return (key, ...rest) => {
    if (!cache.has(key)) cache.set(key, fn(key, ...rest));
    return cache.get(key);
  };
}

// The one shared gate every witness generator runs its output through.
//
// Why it exists. Five generators (auth, cookies, crosshost, sse, range; the compress one reads a plain-text
// capture and has its own shape) each turn a capture taken on a developer machine into a source literal the
// Worker serves publicly. Until v0.24.0 each carried its own machine-path regex, its own allowed-host list
// and, for two of them, its own verdict-word list, and they had drifted: the range gate knew `[::1]`,
// `0.0.0.0` and bounded loopback addresses, the sse gate knew some of that, the auth and cookies gates knew
// neither, and crosshost had none. The v0.24.0 review (docs/reviews/2026-10-12-v0.24.0-review.md, the "partly"
// findings about the auth and cookies gates) asked for one module; this is it.
//
// The two rules it enforces are the project's #23 and #31 rules:
//   - Nothing from the capturing machine is published: no home or temp or volume path, no Windows drive
//     path, no file:// URL, no loopback or wildcard address. (The operator's machine is not part of the data.)
//   - The data names no host but badhttp.dev and alt.badhttp.dev, and the rows describe what a client did
//     rather than judge it: none of the verdict words below reaches an emitted row.
//
// Use it on everything emitted, as text: the rows, the client metadata, the provenance line and the run log
// committed beside the capture. checkString returns null when the string is clean, otherwise a reason that
// names what matched; the generator decides how to refuse (throw, or its own bad()).
//
// headerSafe covers the other way text leaves a capture: provenance fields (the probe date, the Worker deployment id, the
// version) and the capture path are interpolated into the generated file's `//` header comment, so a newline in one would
// emit live JavaScript. Dates, versions, ids and repo-relative paths only.
//
// Exports: MACHINE, VERDICT_WORDS, ALLOWED_HOSTS, checkString, foreignHosts, headerSafe.

export const ALLOWED_HOSTS = ['badhttp.dev', 'alt.badhttp.dev'];

// Descriptions, never verdicts. A ban list is blind to words it does not list, so the generators' prose stays
// descriptive by construction; this list catches the obvious slips in a row.
export const VERDICT_WORDS = /\b(correctly|incorrectly|conformant|non-compliant|noncompliant|violates|buggy|broken client|wrong client|passes|fails the spec)\b/i;

// Machine paths, Windows drive paths (as they appear inside JSON text, where a backslash is doubled), file://,
// localhost, 127.0.0.1 and 0.0.0.0 with a digit boundary (a sentence-ending period still matches; 127.0.0.10 and
// 127.0.0.1.5 do not), and [::1].
export const MACHINE = /\/(Users|home|private|tmp|Volumes|var|opt|Library)\/|[A-Za-z]:\\\\|file:\/\/|localhost|(?<![\d.])127\.0\.0\.1(?!\.?\d)|\[::1\]|(?<![\d.])0\.0\.0\.0(?!\.?\d)/;

// A Windows drive path in raw (unescaped) text, such as a committed run log: one backslash after the colon.
// Preceded by a non-word character so that a word ending in a letter and a colon does not match.
const WINDOWS_RAW = /(?<![A-Za-z0-9_])[A-Za-z]:\\(?![nrt"])/;

const HOST_IN_URL = /\bhttps?:\/\/([^\/\s"'?#:\\]+)/gi;

// The hosts in http(s):// URLs inside s that are not allowed, lower-cased, in order of appearance.
export function foreignHosts(s) {
  const out = [];
  for (const m of String(s).matchAll(HOST_IN_URL)) {
    const h = m[1].toLowerCase();
    if (!ALLOWED_HOSTS.includes(h)) out.push(h);
  }
  return out;
}

// null when s is clean; otherwise a reason string naming what matched. `label` says what s is (a row, the
// run log, the provenance line) and leads the reason.
export function checkString(s, label = 'the text', { verdict = true } = {}) {
  const text = String(s);
  const m = text.match(MACHINE);
  if (m) {
    const hit = m[0];
    const loopback = /^(localhost|\[::1\]|[\d.]+)$/.test(hit);
    return `${label} carries a ${loopback ? 'loopback literal' : 'machine path'}: ${JSON.stringify(hit)}`;
  }
  if (WINDOWS_RAW.test(text)) return `${label} carries a machine path: a Windows drive path`;
  const hosts = foreignHosts(text);
  if (hosts.length) return `${label} names the foreign host ${JSON.stringify(hosts[0])}`;
  const v = verdict ? text.match(VERDICT_WORDS) : null;
  if (v) return `${label} carries the verdict word ${JSON.stringify(v[0])}`;
  return null;
}

// null when v is absent or a plain token (letters, digits and . _ - : + / space parentheses, at most 200 characters); otherwise a
// reason. For values the generators interpolate into a `//` header comment.
export function headerSafe(label, v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !/^[A-Za-z0-9._\-:+\/ ()]{0,200}$/.test(v)) return `${label} is not a plain token (it would be written into a header comment): ${JSON.stringify(String(v)).slice(0, 80)}`;
  return null;
}

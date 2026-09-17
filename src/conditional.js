// Shared conditional-request machinery for /range and /etag (RFC 9110 §8.8, §13).
// Kept in one place so the two "fully correct" control flavors cannot drift apart.

export const LAST_MODIFIED = new Date(Date.UTC(2026, 7, 1)).toUTCString(); // fixed: Sat, 01 Aug 2026 00:00:00 GMT
export const LM_EPOCH = Date.parse(LAST_MODIFIED);

// HTTP-date (RFC 9110 §5.6.7): a recipient MUST accept IMF-fixdate, rfc850-date and asctime-date,
// and MUST ignore a conditional date header that is none of them. Date.parse alone is too lenient
// (it accepts ISO 8601 and worse), which would blur the line between the correct controls and the
// misbehaving date flavors — so the format is checked first.
const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d'; // 00:00:00–23:59:59; hour 24 is not a time-of-day
const IMF = new RegExp(`^${DAY}, \\d{2} ${MON} \\d{4} ${TIME} GMT$`);
const ASC = new RegExp(`^${DAY} ${MON} [ \\d]\\d ${TIME} \\d{4}$`);
const R850 = new RegExp(`^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-(${MON})-(\\d{2}) (${TIME}) GMT$`);

export function parseHttpDate(value) {
  const s = value.trim();
  if (IMF.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  if (ASC.test(s)) {
    // asctime carries no zone and means UTC; without the suffix Date.parse would use local time.
    const t = Date.parse(s + ' GMT');
    return Number.isNaN(t) ? null : t;
  }
  const m = R850.exec(s); // m[1] day, m[2] month, m[3] two-digit year, m[4] time
  if (m) {
    const yy = Number(m[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy; // rfc850's two-digit year
    const t = Date.parse(`${m[1]} ${m[2]} ${year} ${m[4]} GMT`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// Entity-tags from a header value: the list members that are well-formed (optional case-sensitive W/
// prefix, then a quoted string; commas inside quotes belong to the tag). Malformed members — bare
// tokens, lowercase w/, stray text around the quotes — are dropped: the strict controls must not
// match garbage. (/etag/unquoted, whose whole point is sloppy matching, has its own matcher.)
export function listTags(value) {
  if (value.trim() === '*') return ['*'];
  const members = value.match(/(?:[^,"]|"[^"]*")+/g) || []; // split on commas outside quotes
  return members.map((s) => s.trim()).filter((s) => /^(?:W\/)?"[^"]*"$/.test(s));
}
export const opaque = (tag) => tag.replace(/^W\//, '');
export const isWeak = (tag) => tag.startsWith('W/');

// RFC 9110 §8.8.3.2: weak comparison ignores W/; strong comparison requires both validators strong.
export function weakMatch(header, etag) {
  return listTags(header).some((t) => t === '*' || opaque(t) === opaque(etag));
}
export function strongMatch(header, etag) {
  if (isWeak(etag)) return listTags(header).some((t) => t === '*'); // a weak validator never strong-matches
  return listTags(header).some((t) => t === '*' || (!isWeak(t) && t === etag));
}

// The precondition dance of RFC 9110 §13.2.2, steps 1–4, for a GET/HEAD resource that always exists:
// If-Match (strong; "*" passes because a representation exists), then If-Unmodified-Since when
// If-Match is absent, then If-None-Match (weak; suppresses If-Modified-Since even on no-match),
// then If-Modified-Since. Dates that are not valid HTTP-dates are ignored (MUST, §13.1.3).
// Returns 'precondition-failed' (412), 'not-modified' (304) or null (serve the representation).
export function checkPreconditions({ ifMatch, ifUnmodifiedSince, ifNoneMatch, ifModifiedSince }, { etag, lmEpoch }) {
  if (ifMatch !== null) {
    const passes = ifMatch.trim() === '*' || (etag != null && strongMatch(ifMatch, etag));
    if (!passes) return 'precondition-failed';
  } else if (ifUnmodifiedSince !== null && lmEpoch != null) {
    const t = parseHttpDate(ifUnmodifiedSince);
    if (t !== null && lmEpoch > t) return 'precondition-failed';
  }
  if (ifNoneMatch !== null) {
    const matched = ifNoneMatch.trim() === '*' || (etag != null && weakMatch(ifNoneMatch, etag));
    return matched ? 'not-modified' : null; // If-None-Match present: If-Modified-Since must be ignored
  }
  if (ifModifiedSince !== null && lmEpoch != null) {
    const t = parseHttpDate(ifModifiedSince);
    if (t !== null && lmEpoch <= t) return 'not-modified';
  }
  return null;
}

export function conditionalHeaders(request) {
  return {
    ifMatch: request.headers.get('if-match'),
    ifUnmodifiedSince: request.headers.get('if-unmodified-since'),
    ifNoneMatch: request.headers.get('if-none-match'),
    ifModifiedSince: request.headers.get('if-modified-since'),
  };
}

// A short random tag so two "changed" generations minted in the same millisecond still differ.
export const generation = () => `${Date.now()}${Math.floor(Math.random() * 4096).toString(16).padStart(3, '0')}`;

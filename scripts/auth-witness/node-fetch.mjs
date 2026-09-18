#!/usr/bin/env node
// Node fetch (undici) witness for /auth. One JSON line per flavor on stdout; progress on stderr.
// fetch() has no credential mechanism at all: a URL with userinfo is a TypeError, and nothing answers a 401.
// So Basic-shaped flavors get a hand-set Authorization: Basic header (sent on the first request), bearer a
// hand-set Bearer header, and the Digest flavors are sent with no credentials — the row records that the
// client has no Digest mechanism. Requests are counted through undici's diagnostics channel, which fires
// once per request the dispatcher sends, redirects included. One flavor (proxy) ends in a rejected promise: fetch
// treats a 407 as a network error, so the 407 is recovered from the wire via the same channel and recorded as the
// client raising.
//   node scripts/auth-witness/node-fetch.mjs [base]
import diagnostics_channel from 'node:diagnostics_channel';

const B = process.argv[2] || 'https://badhttp.dev';
// AUTH_FLAVORS=basic,digest limits a dry run; a published capture always runs the full list.
const ORDER = process.env.AUTH_FLAVORS ? process.env.AUTH_FLAVORS.split(/[ ,]+/).filter(Boolean) : ['basic', 'bearer', 'digest', 'digest-sha256', 'none', 'bare-scheme', 'unknown-scheme', 'token68', 'multi', 'case', 'quoted', 'utf8', 'always-401', 'accept-any', 'forbidden', 'stale', 'proxy', 'redirect'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const version = `node ${process.version} / undici ${process.versions.undici}`;
let counter = 0;
let lastHop = null; // the last response seen on the wire, for the one case fetch discards it (407 -> rejection)
const norm = (h) => { // h1 publishes raw [Buffer name, Buffer value, ...]; h2 publishes a plain object
  const o = {};
  if (Array.isArray(h)) { for (let i = 0; i < h.length; i += 2) o[String(h[i]).toLowerCase()] = String(h[i + 1]); }
  else { for (const [k, v] of Object.entries(h ?? {})) o[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v); }
  return o;
};
let hops = [];
const presence = (h) => { // request headers as undici publishes them (a string, an array or an object); presence only
  const s = (Array.isArray(h) ? h.join('\n') : typeof h === 'string' ? h : JSON.stringify(h ?? {})).toLowerCase();
  return { status: null, authorization: /(^|[^-])authorization/.test(s), proxy_authorization: /proxy-authorization/.test(s) };
};
diagnostics_channel.subscribe('undici:request:create', ({ request }) => { counter++; lastHop = null; hops.push(presence(request && request.headers)); });
diagnostics_channel.subscribe('undici:request:headers', ({ response }) => { lastHop = { status: response.statusCode, headers: norm(response.headers) }; if (hops.length) hops[hops.length - 1].status = response.statusCode; });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

for (const f of ORDER) {
  const u = `${B}/auth/${f}`;
  const headers = {};
  let kind, mech;
  if (['digest', 'digest-sha256', 'stale'].includes(f)) {
    kind = 'no-mechanism'; mech = 'fetch has no Digest mechanism (no challenge handling of any kind); the request was sent with no credentials';
  } else if (f === 'bearer') {
    kind = 'bearer-header'; mech = 'a hand-set Authorization: Bearer header (the documented test token): fetch has no credential mechanism of its own'; headers.Authorization = 'Bearer badhttp-token-ok';
  } else if (f === 'utf8') {
    kind = 'basic-header'; mech = 'a hand-set Authorization: Basic header with the documented utf8 credentials, base64 of the UTF-8 bytes computed by the HARNESS (Buffer.from(s, "utf8")): fetch has no Basic option and no encoder of its own'; headers.Authorization = `Basic ${b64('agent:sésame')}`;
  } else if (['multi', 'bare-scheme', 'unknown-scheme', 'token68', 'case', 'quoted'].includes(f)) {
    kind = 'basic-header'; mech = 'a hand-set Authorization: Basic header (the documented credentials): fetch reads no challenge, so the challenge this flavor sends was never observed by the client'; headers.Authorization = `Basic ${b64('agent:correct')}`;
  } else if (f === 'proxy') {
    kind = 'basic-header'; mech = 'a hand-set Authorization: Basic header (the documented credentials, as ORIGIN credentials): no proxy exists in the harness and no proxy credentials were configured; this flavor reads only Proxy-Authorization'; headers.Authorization = `Basic ${b64('agent:correct')}`;
  } else {
    kind = 'basic-header'; mech = 'a hand-set Authorization: Basic header (the documented credentials): fetch has no credential mechanism of its own'; headers.Authorization = `Basic ${b64('agent:correct')}`;
  }
  const base = { client: 'undici', client_version: version, platform: `node ${process.platform}/${process.arch}`, invocation: "fetch(url, {headers, redirect: 'follow'})", flavor: f, url: u, mechanism_kind: kind, mechanism: mech };
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res, text;
    const before = counter;
    hops = [];
    try {
      res = await fetch(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      text = await res.text();
    } catch (e) {
      const err = String(e && e.cause ? `${e.name}: ${e.message} (cause: ${e.cause.name || 'Error'}: ${JSON.stringify(e.cause.message ?? '')})` : e).slice(0, 300);
      // fetch turns a 407 into a network error (the Fetch standard's rule, applied outside a browser): the promise
      // rejects and the 407 Response never reaches the caller. A server response WAS seen on the wire, so this is
      // the client raising, not a transport failure — recorded as such, with the status and challenge the wire
      // carried, and not retried.
      if (lastHop && lastHop.headers['x-badhttp-version']) {
        console.log(JSON.stringify({ ...base, attempts: attempt, requests_made: counter - before, hops, final_status: null, last_status_seen: lastHop.status, redirects_followed: null, final_url: null, challenge_seen: lastHop.headers['www-authenticate'] || lastHop.headers['proxy-authenticate'] || null, oracle: null, version_header: lastHop.headers['x-badhttp-version'], error_kind: 'raised', client_error: err }));
        console.error('node', f, 'raised:', err);
        break;
      }
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, requests_made: counter - before, hops, final_status: null, redirects_followed: null, final_url: null, challenge_seen: null, oracle: null, version_header: null, error_kind: 'transport', client_error: err }));
        console.error('node', f, 'FAILED:', err);
      } else await sleep(12000);
      continue;
    }
    const reqs = counter - before;
    const vh = res.headers.get('x-badhttp-version');
    let oracle = null;
    try { oracle = JSON.parse(text); } catch {}
    if (!vh || !oracle) {
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, requests_made: reqs, hops, final_status: res.status, redirects_followed: null, final_url: res.url, challenge_seen: null, oracle: null, version_header: null, client_error: `not an oracle response after 3 attempts (status ${res.status})` }));
        console.error('node', f, 'FAILED: no oracle response');
      } else { console.error('node', f, ': no oracle response (edge?), retrying'); await sleep(12000); }
      continue;
    }
    const chal = res.headers.get('www-authenticate') || res.headers.get('proxy-authenticate') || null;
    // fetch exposes no hop count, only `redirected`; redirects_followed is null by honesty, redirect_followed carries the boolean.
    console.log(JSON.stringify({ ...base, attempts: attempt, requests_made: reqs, hops, final_status: res.status, redirects_followed: null, redirected: res.redirected, final_url: res.url, challenge_seen: chal, oracle: (({ warning, hint, credentials, ...rest }) => rest)(oracle), version_header: vh, client_error: null }));
    console.error('node', f, 'ok');
    break;
  }
  await sleep(1200);
}

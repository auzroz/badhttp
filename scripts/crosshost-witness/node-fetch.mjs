#!/usr/bin/env node
// Node fetch (undici) witness for /crosshost. One JSON line per flavor on stdout.
// fetch() has no cookie jar, so the `jar` flavor is run with the hand-set Cookie header omitted and
// nothing standing in for a jar: what arrives is what fetch forwards on its own. fetch exposes no hop
// count, only `redirected` and the final url, so hops_followed is null here by honesty, not omission.
//   node scripts/crosshost-witness/node-fetch.mjs [base]
const B = process.argv[2] || 'https://badhttp.dev';
const BASIC = 'Basic YWdlbnQ6Y29ycmVjdA==';
const APIKEY = 'badhttp-key-ok';
const COOKIE = 'badhttp_witness=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idx = await (await fetch(B + '/crosshost')).json();
const version = `node ${process.version} / undici ${process.versions.undici}`;
for (const [f, v] of Object.entries(idx.flavors)) {
  const u = v.url;
  const headers = { Authorization: BASIC, 'X-Api-Key': APIKEY };
  if (f !== 'jar') headers.Cookie = COOKIE;
  const sent = { authorization: 'Basic (documented test value)', cookie: f === 'jar' ? null : COOKIE, x_api_key: 'documented test value', jar: 'none (fetch has no cookie jar)' };
  const base = { client: 'undici', client_version: version, platform: `node ${process.platform}/${process.arch}`, invocation: "fetch(url, {redirect: 'follow'})", flavor: f, start_url: u, sent };
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res, text;
    try {
      res = await fetch(u, { headers, redirect: 'follow' });
      text = await res.text();
    } catch (e) {
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, final_status: null, hops_followed: null, final_url: null, landed_on: null, received: null, version_header: null, client_error: String(e && e.cause ? `${e.message}: ${e.cause.message || e.cause}` : e) }));
        console.error('node', f, 'FAILED:', String(e));
      } else await sleep(12000);
      continue;
    }
    const vh = res.headers.get('x-badhttp-version');
    let oracle = null;
    try { oracle = JSON.parse(text); } catch {}
    if (!vh || !oracle || !oracle.landed_on) {
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, final_status: res.status, hops_followed: null, final_url: res.url, landed_on: null, received: null, version_header: null, client_error: `not an oracle response after 3 attempts (status ${res.status})` }));
        console.error('node', f, 'FAILED: no oracle response');
      } else { console.error('node', f, ': no oracle response (edge?), retrying'); await sleep(12000); }
      continue;
    }
    console.log(JSON.stringify({ ...base, attempts: attempt, final_status: res.status, hops_followed: null, redirected: res.redirected, final_url: res.url, landed_on: oracle.landed_on, port: oracle.port, scheme: oracle.scheme, transport_was_encrypted: oracle.transport_was_encrypted, received: oracle.received, matches: oracle.matches_documented_test_credential, version_header: vh, client_error: null }));
    console.error('node', f, 'ok');
    break;
  }
  await sleep(1200);
}

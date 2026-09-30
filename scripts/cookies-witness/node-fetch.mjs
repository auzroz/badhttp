#!/usr/bin/env node
// Node fetch (undici) witness for /cookies. One JSON line per flavor on stdout; progress on stderr.
// fetch() has NO cookie jar, so the HARNESS supplies one: tough-cookie's CookieJar (default MemoryCookieStore).
// The harness copies every Set-Cookie the response exposes (response.headers.getSetCookie()) into the jar with
// jar.setCookie(str, url), and copies jar -> a Cookie request header (jar.getCookieString(url)) before each
// request. So what a row shows is tough-cookie's behavior under a hand-written fetch loop, not fetch's own.
// Redirects are followed by the harness (redirect: 'manual', <= 6 hops, same jar) so a 302's own Set-Cookie is seen.
// jar_rejections records only the refusals from step 1 (the setter and its redirects); /cookies/delete's own
// deletions of cookies the jar never stored are refused too, and are deliberately not recorded.
// Per flavor, with a FRESH jar: 1 setter (redirects followed), 2 GET /cookies/echo, 3 GET /cookies/delete,
// 4 GET /cookies/echo. 200 ms between requests.
//
// Setup (tough-cookie is installed outside the repo; the module dir is read from COOKIE_NODEMODS):
//   mkdir -p "$DIR" && cd "$DIR" && npm init -y && npm install tough-cookie
//   COOKIE_NODEMODS="$DIR" node scripts/cookies-witness/node-fetch.mjs [base]
// COOKIE_NODEMODS defaults to the session scratchpad's nodemods directory; it must contain node_modules/tough-cookie.
// COOKIE_FLAVORS=ok,nameless limits a dry run; a published capture always runs the full list.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const B = process.argv[2] || 'https://badhttp.dev';
const MODS = process.env.COOKIE_NODEMODS || '/private/tmp/claude-501/-Volumes-External-Repositories-claude-design/5d3b1149-d4ce-4165-ab33-820410234165/scratchpad/nodemods';
if (!existsSync(join(MODS, 'node_modules', 'tough-cookie'))) {
  console.error(`tough-cookie not found under ${MODS}/node_modules; see the setup notes in this file's header`);
  process.exit(2);
}
const tough = createRequire(join(MODS, 'package.json'))('tough-cookie');
const { CookieJar } = tough;
const toughVersion = JSON.parse(readFileSync(join(MODS, 'node_modules', 'tough-cookie', 'package.json'), 'utf8')).version;
const ALL = ['ok', 'folded', 'many', 'duplicate', 'on-redirect', 'conflicting-expiry', 'bad-expires', 'far-future', 'wrong-domain', 'public-suffix', 'domain', 'path-prefix', 'name-prefixes', 'quoted', 'utf8', 'nameless', 'huge'];
const ORDER = process.env.COOKIE_FLAVORS ? process.env.COOKIE_FLAVORS.split(/[ ,]+/).filter(Boolean) : ALL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const version = `node ${process.version} / undici ${process.versions.undici} / tough-cookie ${toughVersion}`;
const bytes = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
const short = (e) => String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 200);
const MAX_HOPS = 6;

// One request through the jar. Sends Cookie from the jar, feeds every Set-Cookie back in. Returns the raw facts.
async function step(jar, url, rejections) {
  const headers = {};
  const cs = await jar.getCookieString(url);
  if (cs) headers.Cookie = cs;
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  const sc = res.headers.getSetCookie();
  for (const s of sc) {
    try { await jar.setCookie(s, url); } catch (e) { rejections.push({ message: short(e) }); }
  }
  return { status: res.status, sc: sc.length, vh: res.headers.get('x-badhttp-version'), location: res.headers.get('location'), text };
}

async function run(f) {
  const jar = new CookieJar();
  const rejections = [];
  const hops = [];
  const seen = { vh: null, status: null, missingVh: false };
  const note = (r) => { seen.status = r.status; if (r.vh) seen.vh = r.vh; else seen.missingVh = true; };
  const u = `${B}/cookies/${f}`;
  // 1: setter, redirects followed by hand
  let url = u, r;
  for (let i = 0; ; i++) {
    r = await step(jar, url, rejections); note(r);
    hops.push({ status: r.status, set_cookie_count: r.sc });
    if (r.status >= 300 && r.status < 400 && r.location && i < MAX_HOPS) { url = new URL(r.location, url).href; await sleep(200); continue; }
    break;
  }
  const setterStatus = r.status;
  let setterBody = null; try { setterBody = JSON.parse(r.text); } catch {}
  const setterSet = setterBody && Array.isArray(setterBody.set) ? setterBody.set : null;
  // jar after step 1: every cookie in the store, not only those sendable to one URL
  const all = await jar.store.getAllCookies();
  const entries = all.map((c) => {
    const t = c.expiryTime();
    return { name: c.key, domain: c.domain, path: c.path, host_only: !!c.hostOnly, secure: !!c.secure, expires: Number.isFinite(t) ? new Date(t).toISOString() : 'session', value_bytes: bytes(c.value) };
  });
  await sleep(200);
  // 2: echo
  const later = []; // refusals during steps 2-4 (the echo/delete responses) are not the setter's and are not recorded
  const e = await step(jar, `${B}/cookies/echo`, later); note(e);
  let eb = null; try { eb = JSON.parse(e.text); } catch {}
  const raw = eb && typeof eb.cookie_header === 'string' ? eb.cookie_header : null;
  const hb = raw === null ? 0 : bytes(raw);
  const echo = {
    status: e.status,
    cookie_header_bytes: hb,
    cookies: eb && Array.isArray(eb.cookies) ? eb.cookies.map(([n, v]) => ({ name: n, value_bytes: bytes(v), value: bytes(v) <= 48 ? v : null })) : [],
    cookie_header_base64: raw !== null && hb <= 256 ? Buffer.from(raw, 'utf8').toString('base64') : null,
  };
  await sleep(200);
  // 3: cleanup (its Set-Cookies go through the jar too)
  const d = await step(jar, `${B}/cookies/delete`, later); note(d);
  await sleep(200);
  // 4: what survived
  const a = await step(jar, `${B}/cookies/echo`, later); note(a);
  let ab = null; try { ab = JSON.parse(a.text); } catch {}
  const afterDelete = { status: a.status, names: ab && Array.isArray(ab.cookies) ? ab.cookies.map(([n]) => n) : [] };
  return { seen, hops, setterStatus, setterSet, echo, afterDelete, entries, rejections, oracleOk: !!(eb && ab) };
}

for (const f of ORDER) {
  const base = {
    client: 'undici', client_version: version, platform: `node ${process.platform}/${process.arch}`,
    invocation: "fetch(url, {headers: {Cookie: await jar.getCookieString(url)}, redirect: 'manual'}) x4 per flavor, harness follows <= 6 redirects and feeds response.headers.getSetCookie() to jar.setCookie(str, url); tough-cookie installed with npm and loaded via createRequire from $COOKIE_NODEMODS",
    flavor: f, url: `${B}/cookies/${f}`, jar_kind: 'harness-jar',
    jar: `tough-cookie ${toughVersion} CookieJar, default options (MemoryCookieStore, rejectPublicSuffixes true, looseMode false, allowSpecialUseDomain true); a fresh jar per flavor; the harness, not fetch, copies Set-Cookie into the jar and the jar into Cookie`,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    let out;
    try {
      out = await run(f);
    } catch (e) {
      const err = String(e && e.cause ? `${e.name}: ${e.message} (cause: ${e.cause.name || 'Error'}: ${JSON.stringify(e.cause.message ?? '')})` : e).slice(0, 300);
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, hops: [], setter_status: null, setter_set: null, echo: null, after_delete: null, jar_enumerable: true, jar_entries: null, jar_rejections: [], version_header: null, client_error: err, error_kind: 'transport', last_status_seen: null }));
        console.error('node', f, 'FAILED:', err);
      } else { console.error('node', f, ': transport error, retrying'); await sleep(12000); }
      continue;
    }
    if (out.seen.missingVh || !out.oracleOk) { // no x-badhttp-version: the edge's 429, not badhttp
      if (attempt === 3) {
        console.log(JSON.stringify({ ...base, attempts: attempt, hops: out.hops, setter_status: out.setterStatus, setter_set: null, echo: null, after_delete: null, jar_enumerable: true, jar_entries: null, jar_rejections: out.rejections, version_header: out.seen.vh, client_error: `not a badhttp response after 3 attempts (last status ${out.seen.status})`, error_kind: 'transport', last_status_seen: out.seen.status }));
        console.error('node', f, 'FAILED: no badhttp response');
      } else { console.error('node', f, ': no x-badhttp-version (edge?), retrying'); await sleep(12000); }
      continue;
    }
    console.log(JSON.stringify({ ...base, attempts: attempt, hops: out.hops, setter_status: out.setterStatus, setter_set: out.setterSet, echo: out.echo, after_delete: out.afterDelete, jar_enumerable: true, jar_entries: out.entries, jar_rejections: out.rejections, version_header: out.seen.vh, client_error: null, error_kind: null, last_status_seen: out.seen.status }));
    console.error('node', f, 'ok');
    break;
  }
  await sleep(1200);
}

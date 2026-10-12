// Node HTTP-cache drivers for the /etag witness family. Speaks the driver protocol (see README.md):
//
//   ETAG_NODEMODS=<dir holding node_modules> node node-caches.mjs <client-id>
//
// client ids: undici-cache | make-fetch-happen | got-cache | axios-cache-interceptor
// Each fetch goes through ONE cache instance created at process start (an in-memory store, or, for
// make-fetch-happen, a directory under the current working directory). No retries, no redirects.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// No proxy variables reach the libraries (make-fetch-happen, got and axios read them): the family measures the cache, not an environment's proxy.
for (const k of Object.keys(process.env)) if (/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(k)) delete process.env[k];
process.env.NO_PROXY = '*';

const RUNTIME = 'node ' + process.version;

function scrub(text) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, 'https://badhttp.dev')
    .replace(/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, '<host>')
    .replace(/(?:\/Users|\/Volumes|\/private|\/var|\/tmp|\/home)\/[^\s'")\]]+/g, '<path>')
    .replace(/(<host>['")\]]*)[,: ]+\d{2,5}\b/g, '$1')
    .replace(/\bports?\s*[=:]?\s*\d{2,5}\b/gi, 'port')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

function die(message) {
  process.stderr.write('driver: ' + scrub(message) + '\n');
  process.exit(2);
}

// Resolve a package from ETAG_NODEMODS (ESM ignores NODE_PATH, CJS honours it): returns {dir, pkg}.
const roots = [];
if (process.env.ETAG_NODEMODS) roots.push(join(resolve(process.env.ETAG_NODEMODS), 'node_modules'));
for (const p of (process.env.NODE_PATH || '').split(':').filter(Boolean)) roots.push(resolve(p));
function pkgDir(name) {
  for (const r of roots) {
    const d = join(r, name);
    if (existsSync(join(d, 'package.json'))) return d;
  }
  die(`module ${name} not found under ETAG_NODEMODS`);
}
function pkgVersion(name) { return JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8')).version; }
function entryOf(dir, pkg) {
  let e = pkg.exports;
  if (e && typeof e === 'object' && '.' in e) e = e['.'];
  const pick = (x) => {
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) { for (const y of x) { const r = pick(y); if (r) return r; } return null; }
    if (x && typeof x === 'object') {
      for (const k of ['node', 'import', 'default', 'require']) if (k in x) { const r = pick(x[k]); if (r) return r; }
    }
    return null;
  };
  return pick(e) || pkg.module || pkg.main || 'index.js';
}
async function load(name) {
  const dir = pkgDir(name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = join(dir, entryOf(dir, pkg));
  try { return await import(pathToFileURL(file).href); } catch (e) { die(`import ${name}: ${e && e.message}`); }
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

// Each client: { library, version, configuration, fetchOne(url) -> {status, body:Buffer, says} }
const clients = {
  async 'undici-cache'() {
    const undici = await load('undici');
    const u = undici.default || undici;
    const dispatcher = new u.Agent().compose(u.interceptors.cache());
    return {
      library: 'undici (interceptors.cache)', version: pkgVersion('undici'),
      configuration: 'undici request(), Agent composed with interceptors.cache(), default options (MemoryCacheStore, type shared, methods GET)',
      async fetchOne(url) {
        const res = await u.request(url, { dispatcher, method: 'GET' });
        const body = Buffer.from(await res.body.arrayBuffer());
        // The interceptor sets an Age header on a response it serves from the store; reported as the library's claim.
        return { status: res.statusCode, body, says: { age: res.headers.age ?? null } };
      },
    };
  },

  async 'make-fetch-happen'() {
    const m = await load('make-fetch-happen');
    const mfh = m.default || m;
    const fetch = mfh.defaults({ cachePath: resolve('mfh-cache') });
    return {
      library: 'make-fetch-happen', version: pkgVersion('make-fetch-happen'),
      configuration: 'make-fetch-happen defaults({cachePath: a directory in the working directory}), cache mode default, no other options',
      async fetchOne(url) {
        const res = await fetch(url, { method: 'GET', redirect: 'manual' });
        const body = Buffer.from(await res.arrayBuffer());
        const h = (n) => res.headers.get(n);
        return { status: res.status, body, says: { 'x-local-cache-status': h('x-local-cache-status'), 'x-local-cache-mode': h('x-local-cache-mode') } };
      },
    };
  },

  async 'got-cache'() {
    const g = await load('got');
    const got = g.default || g.got;
    const instance = got.extend({ cache: new Map(), retry: { limit: 0 }, followRedirect: false, throwHttpErrors: false });
    return {
      library: 'got', version: pkgVersion('got'),
      configuration: 'got.extend({cache: new Map(), retry: {limit: 0}, followRedirect: false, throwHttpErrors: false}), cacheable-request default',
      async fetchOne(url) {
        const res = await instance(url, { method: 'GET', responseType: 'buffer' });
        return { status: res.statusCode, body: Buffer.from(res.body), says: { isFromCache: res.isFromCache } };
      },
    };
  },

  async 'axios-cache-interceptor'() {
    const a = await load('axios');
    const axios = a.default || a;
    const c = await load('axios-cache-interceptor');
    const inst = axios.create({ maxRedirects: 0 });
    c.setupCache(inst, {});
    return {
      library: 'axios + axios-cache-interceptor', version: `${pkgVersion('axios-cache-interceptor')} (axios ${pkgVersion('axios')})`,
      configuration: 'axios.create({maxRedirects: 0}) with setupCache(instance, {}) defaults (memory storage), responseType arraybuffer on each request',
      async fetchOne(url) {
        const res = await inst.get(url, { responseType: 'arraybuffer' });
        return { status: res.status, body: Buffer.from(res.data), says: { cached: res.cached ?? null, stale: res.stale ?? null } };
      },
    };
  },
};

const id = process.argv[2];
if (process.argv.length !== 3 || !id || !Object.hasOwn(clients, id)) die(`usage: node-caches.mjs <${Object.keys(clients).join('|')}>`);

let client;
try { client = await clients[id](); } catch (e) { die(`setup ${id}: ${e && e.message}`); }

const out = (line) => process.stdout.write(line + '\n');
out('HELLO ' + JSON.stringify({ library: client.library, version: client.version, runtime: RUNTIME, http: '1.1', configuration: client.configuration }));

function errName(e) { return (e && (e.name && e.name !== 'Error' ? e.name : e.constructor && e.constructor.name || e.name)) || 'Error'; }

async function doFetch(url) {
  const res = { ok: false, status: null, bytes: 0, sha256: sha(Buffer.alloc(0)), error: null, library_says: null, exit: null };
  try {
    const r = await client.fetchOne(url);
    res.ok = true; res.status = r.status; res.bytes = r.body.length; res.sha256 = sha(r.body); res.library_says = r.says ?? null;
  } catch (e) {
    const resp = e && e.response;
    res.error = { name: errName(e), message: scrub(e && e.message) };
    // A library that raises on a status still saw one; report what it exposes of it as library_says, not as the caller's status.
    if (resp && (resp.status || resp.statusCode)) res.library_says = { error_response_status: resp.status ?? resp.statusCode };
  }
  return res;
}

let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  chain = chain.then(async () => {
    if (line.startsWith('FETCH ')) {
      out('RESULT ' + JSON.stringify(await doFetch(line.slice(6).trim())));
    } else if (line.trim() === 'QUIT') {
      process.stdout.write('', () => process.exit(0));
    }
  });
});
rl.on('close', () => { chain.then(() => process.exit(0)); });

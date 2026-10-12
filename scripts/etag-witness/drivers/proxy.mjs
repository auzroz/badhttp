// Caching-proxy drivers for the /etag witness family. Dependency-free. Speaks the driver protocol (README.md).
//
//   node proxy.mjs <client-id>       client ids: nginx | nginx-stale | varnish | squid | trafficserver | trafficserver-default
//   env: ETAG_PROXIES (directory of config templates; default ../proxies next to this file)
//
// The origin URL arrives only with the first FETCH. On it the driver renders the proxy's committed template with
// the recorder's host and port, starts the proxy on an ephemeral loopback port with all of its state in the
// working directory, waits until it accepts connections, and then performs every FETCH with curl against the proxy:
//   nginx, varnish, trafficserver  curl http://127.0.0.1:<proxy port>/<path>   (reverse proxy: the proxy's upstream is the recorder)
//   squid                          curl -x http://127.0.0.1:<proxy port> <original url>   (forward proxy)
// QUIT stops the proxy (SIGTERM, SIGKILL after 3 s). Nothing is removed.
//
// The caller's body is the file curl wrote; status is curl's %{http_code}. library_says is the proxy's own cache
// status header(s) as returned to curl, read from a header dump (never used to compute an outcome).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createServer, connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, realpathSync, statSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(process.env.ETAG_PROXIES || join(HERE, '..', 'proxies'));
const RUNTIME = 'node ' + process.version;
const DIR = process.cwd();
const EMPTY = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

function scrub(text) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, 'https://badhttp.dev')
    .replace(/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, '<host>')
    .replace(/(?:\/Users|\/Volumes|\/private|\/var|\/tmp|\/home)\/[^\s'")\]]+/g, '<path>')
    .replace(/(<host>['")\]]*)[,: ]+\d{2,5}\b/g, '$1')
    .replace(/\bports?\s*[=:]?\s*\d{2,5}\b/gi, 'port')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}
let child = null;
function die(message) {
  process.stderr.write('driver: ' + scrub(message) + '\n');
  if (child && child.pid) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } } // never leave a proxy behind
  process.exit(2);
}
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(k)));

function findBin(name, pkg, sub) {
  for (const d of (process.env.PATH || '').split(':')) { const p = join(d, name); if (d && existsSync(p)) return p; }
  for (const d of [`/opt/homebrew/opt/${pkg}/${sub}`, `/opt/homebrew/opt/${pkg}/bin`, `/opt/homebrew/opt/${pkg}/sbin`, `/usr/local/opt/${pkg}/${sub}`, `/usr/local/sbin`, `/usr/sbin`]) {
    const p = join(d, name); if (existsSync(p)) return p;
  }
  die(`${name} not found`);
}
function render(file, vars) {
  let t = readFileSync(join(TEMPLATES, file), 'utf8');
  for (const [k, v] of Object.entries(vars)) t = t.split(`{{${k}}}`).join(v);
  const left = t.match(/\{\{[A-Z_]+\}\}/);
  if (left) die(`template ${file} has unfilled ${left[0]}`);
  return t;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
function canConnect(port) {
  return new Promise((res) => { const c = connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
}

const versionOf = (bin, args, re) => { const r = spawnSync(bin, args, { encoding: 'utf8', env }); return (re.exec((r.stdout || '') + (r.stderr || '')) || [])[1] || 'unknown'; };

// Each proxy: { library, version, configuration, reverse, start(ctx) -> {args,cmd,env,cwd}, ready(ctx), says(headers), staleWaitMs? }
function nginx(extra, label) {
  const bin = findBin('nginx', 'nginx', 'bin');
  return {
    library: 'nginx', version: versionOf(bin, ['-v'], /nginx\/(\S+)/), reverse: true, staleWaitMs: extra ? 2300 : 0,
    configuration: 'nginx proxy_pass to the recorder; proxy_cache_path <dir>/cache keys_zone=etagwitness:1m; proxy_cache etagwitness; proxy_cache_revalidate on;'
      + (extra ? ' proxy_cache_valid 200 1s; proxy_ignore_headers Cache-Control; the driver waits 2300 ms before every fetch after the first;' : '')
      + ' add_header X-Cache-Status $upstream_cache_status always (observation only); nginx defaults otherwise (config: proxies/nginx.conf.tmpl)',
    prepare(ctx) {
      for (const d of ['cache', 'tmp']) mkdirSync(join(DIR, d), { recursive: true });
      writeFileSync(join(DIR, 'nginx.conf'), render('nginx.conf.tmpl', { ...ctx, NGINX_EXTRA: extra }));
      return { cmd: bin, args: ['-p', DIR, '-c', join(DIR, 'nginx.conf')] };
    },
    says: (h) => ({ 'x-cache-status': h['x-cache-status'] ?? null }),
  };
}

const proxies = {
  nginx: () => nginx('', 'nginx'),
  'nginx-stale': () => nginx('      proxy_cache_valid 200 1s;\n      proxy_ignore_headers Cache-Control;', 'nginx-stale'),

  varnish() {
    const bin = findBin('varnishd', 'varnish', 'sbin');
    return {
      library: 'Varnish Cache', version: versionOf(bin, ['-V'], /varnish-(\S+)/), reverse: true,
      configuration: 'varnishd -F -n <dir>/varnish -a <its own loopback listen port> -f varnish.vcl, the recorder as the only backend (backend default only; the builtin VCL is Varnish\'s, appended as always); malloc storage and parameters default (config: proxies/varnish.vcl.tmpl)',
      prepare(ctx) {
        writeFileSync(join(DIR, 'varnish.vcl'), render('varnish.vcl.tmpl', ctx));
        return { cmd: bin, args: ['-F', '-n', join(DIR, 'varnish'), '-a', `127.0.0.1:${ctx.PORT}`, '-f', join(DIR, 'varnish.vcl')] };
      },
      async ready(ctx) {
        const adm = findBin('varnishadm', 'varnish', 'bin');
        for (let i = 0; i < 100; i++) {
          const r = spawnSync(adm, ['-n', join(DIR, 'varnish'), 'status'], { encoding: 'utf8', env });
          if (/running/i.test((r.stdout || '') + (r.stderr || ''))) return true;
          await sleep(200);
        }
        return false;
      },
      says: (h) => ({ 'x-varnish': h['x-varnish'] ?? null, age: h.age ?? null }),
    };
  },

  squid() {
    const bin = findBin('squid', 'squid', 'sbin');
    return {
      library: 'Squid', version: versionOf(bin, ['-v'], /Version (\S+)/), reverse: false,
      configuration: 'squid -N, forward proxy: http_port on its own loopback listen port; visible_hostname etag-witness-squid; pid_filename, cache_log, access_log none, coredump_dir in <dir>; shutdown_lifetime 1 seconds; http_access allow for its built-in loopback client ACL (the curl user), deny all; no cache_dir (default in-memory cache); reply_header_add X-Cache-Status "%Ss" (observation only); curl uses it with -x (config: proxies/squid.conf.tmpl)',
      prepare(ctx) {
        writeFileSync(join(DIR, 'squid.conf'), render('squid.conf.tmpl', ctx));
        return { cmd: bin, args: ['-N', '-f', join(DIR, 'squid.conf')] };
      },
      says: (h) => ({ 'x-cache-status': h['x-cache-status'] ?? null, age: h.age ?? null }),
    };
  },

  trafficserver() { return ats('      required_headers: 0', false); },
  'trafficserver-default'() { return ats('', true); },
};

function ats(requiredHeaders, isDefault) {
  const bin = findBin('traffic_server', 'trafficserver', 'bin');
  const prefix = dirname(dirname(realpathSync(bin)));
  // The package's etc is symlinks into the machine's live config; copy the pristine bottle copy (or dereference) and
  // never write through a link.
  const shipped = existsSync(join(prefix, '.bottle', 'etc', 'trafficserver')) ? join(prefix, '.bottle', 'etc', 'trafficserver') : join(prefix, 'etc', 'trafficserver');
  return {
    library: 'Apache Traffic Server', version: versionOf(bin, ['-V'], /Traffic Server (\S+)/), reverse: true,
    configuration: 'traffic_server --run-root <dir>/ats/runroot.yaml with the package\'s shipped configuration files and four rendered over them: records.yaml (http.server_ports its own loopback listen port, http.cache.http 1, '
      + (isDefault ? '' : 'http.cache.required_headers 0, ')
      + 'reverse_proxy.enabled 1, url_remap.remap_required 1, http.insert_response_via_str 2 observation only), remap.config (map the proxy to the recorder), storage.config (64M under <dir>/ats/var/cache), runroot.yaml (all directories under <dir>/ats) (config: proxies/trafficserver.*.tmpl)',
    prepare(ctx) {
      const R = join(DIR, 'ats');
      const vars = { ...ctx, TS_PREFIX: prefix, ATS_REQUIRED_HEADERS: requiredHeaders };
      for (const d of ['etc', 'var/log', 'var/run', 'var/cache']) mkdirSync(join(R, d), { recursive: true });
      cpSync(shipped, join(R, 'etc'), { recursive: true, dereference: true });
      writeFileSync(join(R, 'etc', 'records.yaml'), render('trafficserver.records.yaml.tmpl', vars));
      writeFileSync(join(R, 'etc', 'remap.config'), render('trafficserver.remap.config.tmpl', vars));
      writeFileSync(join(R, 'etc', 'storage.config'), render('trafficserver.storage.config.tmpl', vars));
      writeFileSync(join(R, 'runroot.yaml'), render('trafficserver.runroot.yaml.tmpl', vars));
      return { cmd: bin, args: [`--run-root=${join(R, 'runroot.yaml')}`] };
    },
    async ready() {
      // ATS accepts connections before its cache is initialised; its diags.log says when the cache is enabled. No request is sent.
      for (let i = 0; i < 300; i++) {
        if (/cache enabled/.test(tailAll(join(DIR, 'ats', 'var', 'log', 'diags.log')))) return true;
        await sleep(100);
      }
      return false;
    },
    says: (h) => ({ age: h.age ?? null, via_code: ((/\[([^\]]*)\]/.exec(h.via || '') || [])[1] ?? '').trim() || null }),
  };
}

const id = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(proxies, id)) die(`usage: proxy.mjs <${Object.keys(proxies).join('|')}>`);
const proxy = proxies[id]();
const out = (l) => process.stdout.write(l + '\n');
out('HELLO ' + JSON.stringify({ library: proxy.library, version: proxy.version, runtime: RUNTIME, http: '1.1', configuration: proxy.configuration }));

let proxyPort = null, started = false, fetches = 0;
async function startProxy(url) {
  const u = new URL(url);
  proxyPort = await freePort();
  const ctx = { DIR, PORT: String(proxyPort), ORIGIN_HOST: u.hostname, ORIGIN_PORT: u.port || '80' };
  const { cmd, args } = proxy.prepare(ctx);
  const log = join(DIR, 'proxy.out');
  writeFileSync(log, '');
  child = spawn(cmd, args, { cwd: DIR, env, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')] });
  let exited = null;
  child.on('exit', (code, sig) => { exited = { code, sig }; });
  child.on('error', (e) => die(`cannot start ${proxy.library}: ${e.message}`));
  for (let i = 0; i < 300; i++) {
    if (exited) die(`${proxy.library} exited at start (${exited.code ?? exited.sig}): ${tailOf(log)}`);
    if (await canConnect(proxyPort)) break;
    await sleep(100);
    if (i === 299) die(`${proxy.library} did not accept connections: ${tailOf(log)}`);
  }
  if (proxy.ready && !(await proxy.ready(ctx))) die(`${proxy.library} not ready: ${tailOf(log)}`);
  started = true;
}
function tailAll(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
function tailOf(p) { try { return readFileSync(p, 'utf8').trim().split('\n').slice(-3).join(' | '); } catch { return ''; } }

function parseHeaders(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return {}; }
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks[blocks.length - 1] || '';
  const h = {};
  for (const line of last.split(/\r?\n/).slice(1)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return h;
}

async function doFetch(url) {
  if (!started) await startProxy(url); else if (proxy.staleWaitMs) await sleep(proxy.staleWaitMs);
  fetches++;
  const u = new URL(url);
  for (const f of ['body.bin', 'headers.txt']) rmSync(join(DIR, f), { force: true });
  const target = proxy.reverse ? `http://127.0.0.1:${proxyPort}${u.pathname}${u.search}` : url;
  const args = ['-q', '-sS', '--http1.1', '-D', 'headers.txt', '-o', 'body.bin', '-w', '%{http_code}'];
  if (!proxy.reverse) args.push('-x', `http://127.0.0.1:${proxyPort}`);
  const r = spawnSync('curl', [...args, target], { cwd: DIR, env, encoding: 'utf8' });
  const n = parseInt((r.stdout || '').trim(), 10);
  const tail = (r.stderr || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(-3).join(' | ');
  let bytes = 0, sha256 = EMPTY;
  const f = join(DIR, 'body.bin');
  if (existsSync(f) && statSync(f).isFile()) { const b = readFileSync(f); bytes = b.length; sha256 = createHash('sha256').update(b).digest('hex'); }
  const code = r.status ?? 1;
  return {
    ok: code === 0, status: n > 0 ? n : null, bytes, sha256,
    error: code === 0 ? null : { name: 'NonZeroExit', message: scrub(`curl exited ${code}: ${tail}`) },
    library_says: code === 0 ? proxy.says(parseHeaders(join(DIR, 'headers.txt'))) : null,
    exit: { code, stderr_tail: scrub(tail) },
  };
}

async function stopProxy() {
  // The proxy stays in the driver's process group on purpose: if the orchestrator kills the group at a cap, the proxy goes with it.
  if (!child || child.exitCode !== null || child.signalCode) return;
  const pid = child.pid;
  try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    try { process.kill(pid, 0); } catch { return; }
    await sleep(100);
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin });
let quitting = false;
rl.on('line', (line) => {
  chain = chain.then(async () => {
    if (quitting) return;
    if (line.startsWith('FETCH ')) out('RESULT ' + JSON.stringify(await doFetch(line.slice(6).trim())));
    else if (line.trim() === 'QUIT') { quitting = true; await stopProxy(); process.stdout.write('', () => process.exit(0)); }
  });
});
rl.on('close', () => { chain.then(async () => { await stopProxy(); process.exit(0); }); });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, async () => { await stopProxy(); process.exit(0); });

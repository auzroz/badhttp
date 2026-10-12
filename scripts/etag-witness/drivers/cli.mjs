// Command-line conditional-download drivers for the /etag witness family. Dependency-free.
// Speaks the driver protocol (see README.md). Each FETCH runs the tool once, in the working directory,
// which keeps the tool's own state between fetches (curl's etag file and download, wget's timestamped file).
//
//   node cli.mjs <client-id>      client ids: curl-etag | curl-z | curl-z-R | wget-N
//
// The caller's body is the file the tool leaves on disk (an unchanged file after a 304; an empty body when
// no file exists). status is the HTTP status the tool reports: curl's %{http_code}; for wget, the last
// "HTTP/1.x NNN" line of --server-response (wget reports no status of its own).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, statSync } from 'node:fs';

const RUNTIME = 'node ' + process.version;
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
function die(message) { process.stderr.write('driver: ' + scrub(message) + '\n'); process.exit(2); }

// No proxy variables reach the tools: the family measures the tool, not an environment's proxy.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(k)));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.error) die(`cannot run ${cmd}: ${r.error.code || r.error.message}`);
  return { code: r.status ?? (r.signal ? 128 : 1), stdout: r.stdout || '', stderr: r.stderr || '' };
}

function firstLine(cmd, args) { const r = run(cmd, args); return (r.stdout || r.stderr).split('\n')[0]; }

const CURL_BASE = ['-q', '-sS', '--http1.1'];
const curlVersion = () => (/^curl (\S+)/.exec(firstLine('curl', ['--version'])) || [])[1] || 'unknown';
const wgetVersion = () => (/GNU Wget (\S+)/.exec(firstLine('wget', ['--version'])) || [])[1] || 'unknown';

function curlClient(flags, flagText, file) {
  return {
    library: 'curl', version: curlVersion(),
    configuration: `curl ${CURL_BASE.join(' ')} ${flagText} -o ${file} -w '%{http_code} %{size_download}' <url>`,
    file,
    exec(url) {
      const r = run('curl', [...CURL_BASE, ...flags, '-o', file, '-w', '%{http_code} %{size_download}', url]);
      const [c, dl] = r.stdout.trim().split(/\s+/);
      const n = parseInt(c, 10);
      // curl writes the output file only when body bytes arrive, so size_download > 0 is "the tool wrote the file this run".
      return { code: r.code, stderr: r.stderr, status: n > 0 ? n : null, says: null, wrote: Number(dl) > 0 };
    },
  };
}

const clients = {
  'curl-etag': () => curlClient(['--etag-save', 'etag.txt', '--etag-compare', 'etag.txt'], '--etag-save etag.txt --etag-compare etag.txt', 'body.bin'),
  'curl-z': () => curlClient(['-z', 'body.bin'], '-z body.bin', 'body.bin'),
  'curl-z-R': () => curlClient(['-R', '-z', 'body.bin'], '-R -z body.bin', 'body.bin'),
  'wget-N': () => ({
    library: 'GNU Wget', version: wgetVersion(),
    configuration: 'wget --no-config -N -t 1 --max-redirect=0 --server-response <url> (output file named by wget from the URL, in the working directory)',
    file: null,
    fileFor: (url) => decodeURIComponent((new URL(url).pathname.split('/').filter(Boolean).pop()) || 'index.html'),
    exec(url) {
      const r = run('wget', ['--no-config', '-N', '-t', '1', '--max-redirect=0', '--server-response', url]);
      const codes = [...r.stderr.matchAll(/^\s*HTTP\/1\.[01] (\d{3})/gm)].map((m) => Number(m[1]));
      // wget prints "saved [n/m]" when it wrote the file this run
      return { code: r.code, stderr: r.stderr, status: codes.length ? codes[codes.length - 1] : null, says: null, wrote: /\bsaved \[\d+/.test(r.stderr) };
    },
    // wget's documented exit codes (man wget, EXIT STATUS)
    errorName: (code) => ({ 1: ['GenericError', 'generic error'], 2: ['ParseError', 'command line or rc file parse error'], 3: ['FileIOError', 'file I/O error'],
      4: ['NetworkFailure', 'network failure'], 5: ['SSLFailure', 'SSL verification failure'], 6: ['AuthFailure', 'username/password authentication failure'],
      7: ['ProtocolError', 'protocol error'], 8: ['ServerError', 'server issued an error response'] }[code]),
  }),
};

const id = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(clients, id)) die(`usage: cli.mjs <${Object.keys(clients).join('|')}>`);
const client = clients[id]();
const out = (l) => process.stdout.write(l + '\n');
out('HELLO ' + JSON.stringify({ library: client.library, version: client.version, runtime: RUNTIME, http: '1.1', configuration: client.configuration }));

function snap() {
  if (!client.file || !existsSync(client.file) || !statSync(client.file).isFile()) return null;
  const st = statSync(client.file, { bigint: true });
  return { ino: st.ino, mtime: st.mtimeNs, sha: createHash('sha256').update(readFileSync(client.file)).digest('hex') };
}

function onDisk() {
  if (!client.file || !existsSync(client.file) || !statSync(client.file).isFile()) return { bytes: 0, sha256: EMPTY };
  const b = readFileSync(client.file);
  return { bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') };
}

function doFetch(url) {
  if (client.fileFor) client.file = client.fileFor(url);
  const before = snap();
  const r = client.exec(url);
  const after = snap();
  // "the tool wrote the output file this run": the tool says so (curl: body bytes downloaded; wget: a "saved" line) or the file's
  // presence, inode, modification time or content changed. A file left untouched reads false.
  const changed = (!before !== !after) || (before && after && (before.ino !== after.ino || before.mtime !== after.mtime || before.sha !== after.sha));
  const file_rewritten = Boolean(r.wrote || changed);
  // wget stamps its messages with the time and prints transfer rates; both are removed so the same outcome reads the same.
  const plain = (l) => l.replace(/^--\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}--\s+/, '').replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (?:\([^)]*\) - )?/, '');
  const tail = r.stderr.split('\n').map((s) => s.trim()).filter((s) => s && !/^\d+K\s/.test(s)).map(plain).slice(-3).join(' | ');
  const d = onDisk();
  return {
    ok: r.code === 0, status: r.status, bytes: d.bytes, sha256: d.sha256,
    error: r.code === 0 ? null : (client.errorName && client.errorName(r.code))
      ? { name: client.errorName(r.code)[0], message: scrub(`${client.errorName(r.code)[1]} (exit ${r.code})`) }
      : { name: 'NonZeroExit', message: scrub(`${client.library} exited ${r.code}: ${tail}`) },
    library_says: r.says, exit: { code: r.code, stderr_tail: scrub(tail) }, file_rewritten,
  };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (line.startsWith('FETCH ')) out('RESULT ' + JSON.stringify(doFetch(line.slice(6).trim())));
  else if (line.trim() === 'QUIT') process.stdout.write('', () => process.exit(0));
});
rl.on('close', () => process.exit(0));

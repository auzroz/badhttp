'use strict';
// node-downloader-helper resume driver for the /range witness family.
//
//   NODE_PATH=<dir holding node_modules> node ndh.cjs URL DIR
//
// DIR holds the partial as out.txt (or nothing). The library is asked to resume that file:
// resumeIfFileExists sends a HEAD, and when out.txt exists and is not already the HEAD's
// Content-Length it sends one GET with Range: bytes=<size>- ; with no file it sends a plain GET.
// Exit 0: the library emitted `end` (its promise resolved). 1: it emitted `error` or the promise
// rejected. 2: the driver could not run. The LAST stdout line is `RESULT {json}`.
//
// Options that differ from the library's defaults, and why (all three are observation, not behaviour):
//   retry:false              the default is already off; stated so nothing can retry.
//   resumeOnIncomplete:false the default (true) re-issues Range requests, up to 5, when the byte
//                            count differs from the HEAD length; the family counts one resume.
//   removeOnFail:false       the default deletes the file on any error, which would erase the
//                            evidence a row is made of.
const fs = require('fs');

const state = { version: 'unknown' };
const RUNTIME = 'node ' + process.version;

function scrub(text) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, 'https://badhttp.dev')
    .replace(/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?/g, '<host>')
    .replace(/(?:\/Users|\/Volumes|\/private|\/var|\/tmp|\/home)\/[^\s'")\]]+/g, '<path>')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

let finished = false;
function finish(ok, kind, name, message, code) {
  if (finished) return;
  finished = true;
  const line = 'RESULT ' + JSON.stringify({
    ok, kind, name, message: scrub(message), library: 'node-downloader-helper',
    version: state.version, runtime: RUNTIME, http: '1.1',
  }) + '\n';
  process.stdout.write(line, () => process.exit(code));
}

function main() {
  const [url, dir] = process.argv.slice(2);
  if (process.argv.length !== 4 || !url || !dir) {
    return finish(false, 'raised', 'DriverError', 'usage: ndh.cjs URL DIR', 2);
  }
  let DownloaderHelper;
  try {
    ({ DownloaderHelper } = require('node-downloader-helper'));
    state.version = require('node-downloader-helper/package.json').version;
  } catch (e) {
    return finish(false, 'raised', e && e.code === 'MODULE_NOT_FOUND' ? 'ModuleNotFound' : (e && e.name) || 'Error', e && e.message, 2);
  }
  let dl;
  try {
    dl = new DownloaderHelper(url, dir, {
      fileName: 'out.txt',
      resumeIfFileExists: true,
      override: true,
      retry: false,
      resumeOnIncomplete: false,
      removeOnFail: false,
      removeOnStop: false,
      httpRequestOptions: {}, // Node's http module speaks HTTP/1.1; nothing is forced
      httpsRequestOptions: {},
    });
  } catch (e) {
    // constructor validation (URL/dir not a string, directory missing): the driver could not run
    return finish(false, 'raised', (e && e.name) || 'Error', e && e.message, 2);
  }
  dl.on('end', (info) => {
    // human line; the `incomplete` flag is the library's own judgement against the HEAD length
    console.log('END ' + JSON.stringify({ totalSize: info.totalSize, incomplete: info.incomplete, onDiskSize: info.onDiskSize, downloadedSize: info.downloadedSize }));
    try { console.log('FILES ' + JSON.stringify(fs.readdirSync(dir).sort())); } catch (e) { /* human only */ }
    finish(true, 'return', null, 'end ' + JSON.stringify({ totalSize: info.totalSize, incomplete: info.incomplete, onDiskSize: info.onDiskSize, downloadedSize: info.downloadedSize }), 0);
  });
  dl.on('error', (e) => finish(false, 'raised', (e && e.constructor && e.constructor.name) || 'Error', e && e.message, 1));
  dl.on('skip', (info) => console.log('SKIP ' + JSON.stringify(info)));
  dl.on('warning', (e) => console.log('WARNING ' + scrub(e && e.message)));
  dl.start().catch((e) => finish(false, 'raised', (e && e.constructor && e.constructor.name) || 'Error', e && e.message, 1));
}

main();

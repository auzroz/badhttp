// Witness: Node's built-in fetch (undici) with its default Accept-Encoding and automatic decoding.
import { createHash } from 'node:crypto';
const B = process.argv[2] || 'https://badhttp.dev';
const FLAVORS = ['ok', 'br', 'zstd', 'deflate', 'not-compressed', 'undeclared', 'truncated', 'corrupt', 'bad-crc', 'trailing-garbage', 'multi-member', 'double', 'double-hidden', 'deflate-raw', 'unknown-coding', 'uppercase', 'x-gzip', 'empty', 'wrong-length', 'gzip-file', 'bomb'];
const idx = await (await fetch(`${B}/compress`)).json();
console.log(`# node ${process.version} undici ${process.versions.undici}; Accept-Encoding as the edge saw it: ${JSON.stringify(idx.accept_encoding.as_the_edge_reports_it)}`);
for (const f of FLAVORS) {
  const line = [f];
  try {
    const r = await fetch(`${B}/compress/${f}`);
    line.push(r.status, `ce=[${r.headers.get('content-encoding') ?? ''}]`);
    const want = r.headers.get('x-badhttp-plain-sha256');
    const wantLen = Number(r.headers.get('x-badhttp-plain-bytes'));
    try {
      const buf = new Uint8Array(await r.arrayBuffer());
      const sha = createHash('sha256').update(buf).digest('hex');
      const head = Buffer.from(buf.subarray(0, 2)).toString('hex');
      line.push(`bytes=${buf.byteLength}/${wantLen}`, want ? (sha === want ? 'SHA-OK' : `sha-DIFF(first=${head})`) : (buf.byteLength === wantLen ? 'LEN-OK' : 'len-DIFF'), 'no-error');
    } catch (e) {
      line.push(`body-error: ${e.cause?.code || ''} ${String(e.cause?.message || e.message).slice(0, 80)}`);
    }
  } catch (e) {
    line.push(`fetch-error: ${e.cause?.code || ''} ${String(e.cause?.message || e.message).slice(0, 80)}`);
  }
  console.log(line.join(' | '));
  await new Promise((r) => setTimeout(r, 300));
}

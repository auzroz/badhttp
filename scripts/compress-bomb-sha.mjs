// Generate the SHA-256 table for /compress/bomb plaintexts (the 64-byte BOMB_LINE repeated to N MiB),
// embedded in src/compress.js as BOMB_SHA256 so every flavor, bomb included, states its plaintext hash.
// Usage: node scripts/compress-bomb-sha.mjs [maxMiB]   (must match BOMB_LINE and the 64-byte layout in src/compress.js)
import { createHash } from 'node:crypto';
const LINE = 64;
const BOMB_LINE = 'badhttp compress bomb: this line repeats to the declared size'.padEnd(LINE - 1, '.').slice(0, LINE - 1) + '\n';
const max = Number(process.argv[2] || 32);
const chunk = Buffer.alloc(65536);
for (let i = 0; i < 1024; i++) chunk.write(BOMB_LINE, i * LINE, 'ascii');
const h = createHash('sha256');
const out = {};
for (let mib = 1; mib <= max; mib++) {
  for (let k = 0; k < 16; k++) h.update(chunk); // 16 × 64 KiB = 1 MiB more
  out[mib] = h.copy().digest('hex');
}
console.log(`// BOMB_LINE bytes: ${Buffer.byteLength(BOMB_LINE)} (must be 64)`);
console.log('const BOMB_SHA256 = {');
for (const [mib, sha] of Object.entries(out)) console.log(`  ${mib}: '${sha}',`);
console.log('};');

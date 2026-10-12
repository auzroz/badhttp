// Render the ledger-digest workflow result as the "Session digests" markdown section.
// Usage: node scripts/ledger-digest-render.mjs <task-output-file> [ids,comma,separated] > digests.md
import { readFileSync } from 'node:fs';
const raw = readFileSync(process.argv[2], 'utf8');
let obj;
try { obj = JSON.parse(raw); } catch { const i = raw.indexOf('{'); obj = JSON.parse(raw.slice(i)); }
const result = obj.result || obj;
// Order: the ids given as the third argument, else the ids present in the result (session 31: the fixed 1..28 default rendered
// "digest missing" for every id a later run did not cover).
const order = (process.argv[3] ? process.argv[3].split(',') : null);
const pad = (n) => /^\d+$/.test(n) ? n.padStart(2, '0') : n.slice(0, -1).padStart(2, '0') + n.slice(-1);
const byId = new Map(result.digests.map((r) => [String(r.id), r]));
const ids = order || [...byId.keys()];
const clean = (s) => String(s).replace(/`/g, '').replace(/\s+/g, ' ').trim();
const li = (arr) => (arr || []).filter(Boolean).map((x) => '  - ' + clean(x)).join('\n');
const out = [];
for (const id of ids) {
  const r = byId.get(id);
  if (!r) { out.push(`### #${id} — (digest missing; read ledger/entry-${pad(id)}.md)\n`); continue; }
  const d = r.digest;
  out.push(`### #${id} — ${clean(d.date)} — ${clean(d.title)}`);
  out.push(`Full entry: \`ledger/entry-${pad(id)}.md\` · version: ${clean(d.version)}`);
  out.push('');
  out.push(`**${clean(d.one_line)}**`);
  out.push('');
  if (d.shipped?.length) { out.push('- Shipped:'); out.push(li(d.shipped)); }
  if (d.lessons?.length) { out.push('- Lessons:'); out.push(li(d.lessons)); }
  out.push(`- Money: ${clean(d.money)}`);
  if (d.assignments?.length) { out.push('- Assigned to the operator:'); out.push(li(d.assignments)); }
  if (d.open_threads?.length) { out.push('- Left open:'); out.push(li(d.open_threads)); }
  if (d.pointers?.length) out.push(`- Pointers: ${d.pointers.map(clean).join('; ')}`);
  if (d.identifiers?.length) out.push(`- Identifiers: ${d.identifiers.map(clean).join('; ')}`);
  out.push('');
}
process.stdout.write(out.join('\n'));
// critic to stderr for the main loop
console.error(JSON.stringify({ critic: result.critic, failed: result.failed,
  errors: result.digests.reduce((n, r) => n + (r.errors?.length || 0), 0),
  omissions: result.digests.reduce((n, r) => n + (r.omissions?.length || 0), 0) }, null, 1));

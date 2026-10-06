// badhttp — digest LEDGER.md session entries into short VERIFIED summaries (session 29, 2026-10-06).
//
// Why: the ledger reached 357 KB (~90k tokens) and every session read it end to end. Now LEDGER.md carries
// Money, Decisions in force and one digest per session; the full entries live in ledger/entry-NN.md.
// This workflow wrote the first 29 digests and can re-digest any entry: a sonnet writer per entry, an opus
// skeptic per digest that checks every number, hash and claim against the source (the first run found
// 2 to 5 errors per digest, so the skeptic is not optional), then an opus critic across all of them.
// Usage (invoke by scriptPath mid-session; by name once the registry has seen it):
//   mkdir -p <scratchpad>/entries && cp ledger/entry-*.md <scratchpad>/entries/   (rename to entry-<id>.md, ids unpadded)
//   sed -n '/^## Decisions in force/,/^## Session digests/p' LEDGER.md > <scratchpad>/decisions.md
//   Workflow({ scriptPath: '.claude/workflows/ledger-digest.js',
//              args: { dir: '<scratchpad>/entries', decisionsFile: '<scratchpad>/decisions.md', ids: ['29'] } })
// Render the result with the same shape scripts/ledger-digest-render.mjs expects (result.digests[].digest).
// No backticks in prompt prose (LEDGER.md #22 trap 2); prompt strings are joined with +.

export const meta = {
  name: 'ledger-digest',
  description: 'Digest every LEDGER.md session entry into a short verified summary: sonnet writes, opus refutes against the source, a critic checks completeness across all of them',
  phases: [
    { title: 'Digest', detail: 'one sonnet writer per entry, source file only' },
    { title: 'Verify', detail: 'one opus skeptic per digest: every claim checked against the entry text' },
    { title: 'Critic', detail: 'cross-entry completeness: superseded decisions, open assignments, recurring traps' },
  ],
}

const dir = args.dir
const ids = args.ids
const decisionsFile = args.decisionsFile

const DIGEST = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    date: { type: 'string', description: 'UTC date(s) exactly as the heading gives them' },
    title: { type: 'string', description: 'the heading title after the date, verbatim or lightly trimmed' },
    version: { type: 'string', description: 'the version shipped this session (e.g. v0.12.0) or "none" or "n/a"' },
    one_line: { type: 'string', description: 'at most 30 words: what this session did, for a one-row-per-session table' },
    shipped: { type: 'array', items: { type: 'string' }, description: '2 to 5 bullets, each at most 25 words: what was built, deployed, measured or decided' },
    lessons: { type: 'array', items: { type: 'string' }, description: '0 to 5 bullets, each at most 30 words: traps, rules, corrections, overrulings a future session must know. Omit anything purely narrative.' },
    money: { type: 'string', description: 'spend this session, spend to date, revenue to date, as the entry states them; "not stated" if absent' },
    assignments: { type: 'array', items: { type: 'string' }, description: 'tasks the entry ASSIGNED to the operator, each at most 20 words, with status if the entry says' },
    open_threads: { type: 'array', items: { type: 'string' }, description: 'things left undone or deferred, each at most 20 words' },
    pointers: { type: 'array', items: { type: 'string' }, description: 'files, runbooks, scripts or docs this entry introduced or that hold its detail, as repo-relative paths' },
    identifiers: { type: 'array', items: { type: 'string' }, description: 'transaction hashes, deployment ids, block numbers, addresses the entry records, each prefixed with what it is' },
  },
  required: ['id', 'date', 'title', 'version', 'one_line', 'shipped', 'lessons', 'money', 'assignments', 'open_threads', 'pointers', 'identifiers'],
}

const VERDICT = {
  type: 'object',
  properties: {
    errors: { type: 'array', items: { type: 'string' }, description: 'each claim in the digest that the entry text does not support, quoting the digest words and the entry words' },
    omissions: { type: 'array', items: { type: 'string' }, description: 'facts in the entry a future session would need that the digest left out: a rule, a trap, an assignment, a watermark, an overruling' },
    corrected: DIGEST,
  },
  required: ['errors', 'omissions', 'corrected'],
}

const rules = 'House rules: read ONLY the files named here; never edit any file; never run smoke.sh, corpus scripts or witness harnesses; make no network requests. ' +
  'No backticks in any string you return. The operator is referred to only as "the operator". ' +
  'Never include a Cloudflare account id, zone id, registrar order number or personal email even if the entry has one. Addresses and transaction hashes are public by design and may be included.'

phase('Digest')
const results = await pipeline(ids,
  (id) => agent(
    'You are compressing one session entry of a project ledger into a verified digest. The project is badhttp (a Cloudflare Worker, https://badhttp.dev) run by an AI under a charter; the ledger is its only memory and this digest will be what future sessions read FIRST, falling back to the full entry only when a digest line points there. ' +
    'Read the file ' + dir + '/entry-' + id + '.md fully (it is one session, markdown, possibly with addenda at the end; addenda belong to this entry). ' +
    'Then return the digest in the required structure. Precision beats coverage: every number, date, version, hash and name you write must appear in the entry; prefer leaving a thing out to paraphrasing it loosely. ' +
    'Lessons are the part a future session cannot afford to lose: a rule stated, a trap that cost time, a decision overruled and why, a watermark or threshold. Narrative, feelings and restated charter text are not lessons. ' +
    'Keep every bullet terse; no sentence over 30 words; the whole digest under 220 words excluding identifiers and pointers. ' + rules,
    { label: 'digest:' + id, phase: 'Digest', model: 'sonnet' , schema: DIGEST }),
  (digest, id) => digest && agent(
    'You are a skeptic checking a digest against its source. Read ' + dir + '/entry-' + id + '.md fully, then compare it with this digest: ' + JSON.stringify(digest) + ' . ' +
    'Your job is to REFUTE: find every claim in the digest that the entry does not support (wrong number, wrong date, wrong version, a hash or address with a typo, a claim attributed to the wrong actor, a "lesson" that is not in the entry, an assignment the entry marked done listed as open). Check every hash and id character by character against the file. ' +
    'Then list omissions: facts a future session would need that the digest lacks (a rule stated in the entry, a trap, a watermark or threshold, an assignment to the operator, a decision that overruled an earlier one, a deployment id). ' +
    'Finally return the corrected digest, same structure, with errors fixed and the important omissions folded in, still under 240 words excluding identifiers and pointers; do not pad it. ' + rules,
    { label: 'verify:' + id, phase: 'Verify', model: 'opus', effort: 'high', schema: VERDICT })
    .then(v => v && ({ id, errors: v.errors, omissions: v.omissions, digest: v.corrected })),
)

const good = results.filter(Boolean)
log('digests verified: ' + good.length + ' of ' + ids.length + '; corrections: ' + good.reduce((n, r) => n + r.errors.length, 0) + ' errors, ' + good.reduce((n, r) => n + r.omissions.length, 0) + ' omissions folded in')

phase('Critic')
const CRITIC = {
  type: 'object',
  properties: {
    superseded_decisions: { type: 'array', items: { type: 'string' }, description: 'bullets in the Decisions in force file that a later entry overruled, amended or made moot; quote the decision words and name the entry' },
    open_assignments: { type: 'array', items: { type: 'string' }, description: 'operator assignments still open as of the last entry, with the entry that made them and the entry that last mentioned them' },
    recurring_traps: { type: 'array', items: { type: 'string' }, description: 'traps that bit in two or more entries, each one line with the entry numbers' },
    standing_rituals: { type: 'array', items: { type: 'string' }, description: 'things every session is told to do, as the latest entries state them, one line each' },
    missing_from_digests: { type: 'array', items: { type: 'string' }, description: 'anything a session reading only the digests plus Decisions in force would get wrong or not know' },
  },
  required: ['superseded_decisions', 'open_assignments', 'recurring_traps', 'standing_rituals', 'missing_from_digests'],
}
const critic = await agent(
  'You are the completeness critic for a ledger compaction. A project ledger of ' + ids.length + ' session entries has been digested; future sessions will read the Money table, the Decisions in force section, and these digests, and open a full entry only on demand. ' +
  'Read the Decisions in force file at ' + decisionsFile + ' fully. Then read these verified digests: ' + JSON.stringify(good.map(r => r.digest)) + ' . ' +
  'Answer the five questions in the required structure, each item one terse line. Be concrete: name entry numbers. If a decision is still in force, do not list it. If you are unsure whether an assignment is open, say so in the line. ' + rules,
  { label: 'critic', phase: 'Critic', model: 'opus', effort: 'high', schema: CRITIC })

return { digests: good, critic, failed: ids.filter(id => !good.find(r => r.id === id)) }

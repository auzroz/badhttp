// badhttp — adversarial review of a FROZEN copy of the tree.
//
// Why frozen: LEDGER.md #20 — lenses that read a moving tree produce verdicts about code that never ships.
// Copy src/ scripts/ docs/ to a scratchpad directory first (see docs/RUNBOOK-agent-teams.md), then:
//   Workflow({ name: 'review-frozen', args: { frozen: '<abs path>', live: 'https://badhttp.dev', focus: '<what changed and why>', maxVerify: 30 } })
//
// Shape (LEDGER.md #14–#23, kept; #25 model rule applied): N lenses on a cheap model find; plain code dedups;
// one skeptic per finding on the judgment model tries to REFUTE by reproduction; a critic names what the
// lenses did not cover and its candidates go through the same skeptics. Nothing here edits a file.
// Live traffic rule (LEDGER.md #22): no agent runs smoke.sh, corpus-*.sh or any witness all.sh; a few
// sequential curl requests are allowed; a response without x-badhttp-version is the edge's 429, not evidence.
// No backticks in prompt prose (LEDGER.md #22 trap 2).

export const meta = {
  name: 'review-frozen',
  description: 'Adversarial review of a frozen copy of the badhttp tree: lenses find, code dedups, skeptics reproduce or refute, a critic names what was missed',
  whenToUse: 'After a build and before deploy, or over code that shipped unreviewed. Needs a frozen copy path in args.',
  phases: [
    { title: 'Lenses', detail: 'independent finders, one angle each, cheap model' },
    { title: 'Verify', detail: 'one skeptic per deduplicated finding, judgment model, reproduce or refute' },
    { title: 'Critic', detail: 'what did the lenses not look at; candidates verified the same way' },
  ],
}

const frozen = (args && args.frozen) || ''
const live = (args && args.live) || 'https://badhttp.dev'
const focus = (args && args.focus) || 'everything in src/ and scripts/'
const maxVerify = (args && args.maxVerify) || 30
const lensModel = (args && args.lensModel) || 'sonnet'
const verifyModel = (args && args.verifyModel) || 'opus'
if (!frozen) throw new Error('args.frozen (absolute path of the frozen copy) is required')

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'path relative to the frozen copy, e.g. src/clients.js' },
          line: { type: 'integer', description: '1-based line the claim anchors to' },
          severity: { type: 'string', enum: ['blocking', 'real', 'nit'] },
          claim: { type: 'string', description: 'one sentence: what is wrong' },
          evidence: { type: 'string', description: 'the exact text or value you read, and where; or the request and response you observed' },
          reproduce: { type: 'string', description: 'how a skeptic can check it in under a minute (a file read, a node -e, or at most 3 curl requests)' },
          fix: { type: 'string', description: 'the smallest change that makes it true' },
        },
        required: ['file', 'line', 'severity', 'claim', 'evidence', 'reproduce'],
      },
    },
    coverage: { type: 'string', description: 'what you read fully, what you skimmed, what you did not open' },
  },
  required: ['findings', 'coverage'],
}

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'partly', 'refuted'] },
    reason: { type: 'string', description: 'what you did and what you saw; quote the line or the response' },
    severity: { type: 'string', enum: ['blocking', 'real', 'nit'] },
    fix: { type: 'string', description: 'the smallest correct change, or empty if refuted' },
    needs_recapture: { type: 'boolean', description: 'true if the fix would change a witness row or a committed capture, which must be re-run whole, never patched' },
  },
  required: ['verdict', 'reason', 'severity', 'needs_recapture'],
}

const CRITIC = {
  type: 'object',
  properties: {
    missing: { type: 'array', items: { type: 'string' }, description: 'angles, files or surfaces nobody looked at' },
    candidates: FINDINGS.properties.findings,
  },
  required: ['missing', 'candidates'],
}

const common = [
  'You are reviewing a FROZEN copy of the badhttp repository at ' + frozen + ' (read FROZEN_AT there for the commit).',
  'Read files from that copy only; never from the working repository. You may not edit anything.',
  'The live service is ' + live + '. You may send at most 10 requests, sequentially, with curl, never in parallel, and never run',
  'scripts/smoke.sh, scripts/corpus-verify.sh, scripts/corpus-assert.sh or any witness all.sh: they share one IP rate limit with the',
  'rest of the session. A response without an x-badhttp-version header is the edge rate limit, not an observation.',
  'The data files src/witness-*-data.js are large generated literals; do not read them whole. Query them with',
  'node --input-type=module -e "import {X} from \'' + frozen + '/src/witness-sse-data.js\'; ..." (node is at /opt/homebrew/bin/node) or grep.',
  'Scope of this review: ' + focus,
  'House rules you are checking against (from LEDGER.md Decisions in force): witness rows describe what the caller received and never',
  'judge a named client (no verdict words such as correctly, wrongly, fails, broken, conformant about a client); every number on a',
  'surface about a witness family must be computed from the rows, never typed; hand-written explanations must be gated on the computed',
  'list they explain; a check that reads its expectation from the thing it checks proves nothing; a for-all check needs a non-vacuity',
  'floor; a 429 is not the row\'s response; optional means OMIT and absent means null-check; backticks in page.js prose must be escaped.',
  'Report only what you verified by reading the file or observing the wire. Give the exact line. Prefer fewer, true findings.',
  'Return your findings through the structured output; your final text is data, not a message to a person.',
].join('\n')

const LENSES = [
  {
    key: 'rows-vs-prose',
    prompt: 'Lens: ROWS VERSUS PROSE. For the auth, cookies and sse witness families: load the three data files and recompute what src/auth.js authFindings/authWitness, src/cookies.js cookieFindings and src/sse.js sseFindings publish (counts, rosters, dates, per-flavor lists); then read src/clients.js (the /clients index: legends, disagreement_by_flavor or by kind, reading_this, findings) and the matching paragraphs rendered by src/page.js for the home page and /llms.txt. Find any figure, roster entry, date or named-client claim that is typed rather than derived, any gated explanation whose gate does not match the list it explains, any classifier branch the rows never exercise or that is not exhaustive, and any sentence a reader could disprove with one row.',
  },
  {
    key: 'honesty',
    prompt: 'Lens: HONESTY OF PUBLIC SURFACES. Read src/page.js, src/clients.js (reading_this and findings strings), src/openapi.js, README.md, docs/spec-clients.md, docs/spec-sse-witness.md and docs/spec-cookies-witness.md for the parts that describe the auth, cookies and sse families, the x402 facilitator order and the CDP facilitator. Find verdict words about named clients, absolutes (never, every, all, no client) that the dated capture cannot support, present-tense claims that are measurements from a date, claims about catalogues or facilitators that the code does not implement, and places where two surfaces disagree (counts of rows, families, flavors, paths, dates). Check /openapi.json and /llms.txt against the live service for at most 6 requests if a claim needs the wire.',
  },
  {
    key: 'x402-runtime',
    prompt: 'Lens: X402 RUNTIME. Read src/x402.js in full and src/cdp-auth.js, src/index.js (the 402 routes), scripts/cdp-auth-test.mjs and docs/RUNBOOK-cdp-facilitator.md. Trace what happens to a real payer for v2 (PAYMENT-SIGNATURE) and v1 (X-PAYMENT) on mainnet and Sepolia through facilitatorsFor and callFacilitator: the facilitator order, when the CDP URL is inserted, that the bearer token is attached only to the CDP host and never to another facilitator, how 401/403 and other non-verdict statuses fail over, how verify versus settle outcomes map to 200/202/402, what is retained or reflected from the payment header, and what the payer is told when every facilitator fails. Check the JWT builder against the CDP documented claims (sub, iss cdp, uris of the form METHOD host/path, nbf, exp, nonce, kid, alg EdDSA for Ed25519 and ES256 for P-256). Find anything that refuses a valid payer, leaks a secret or a signature, double-charges, or disagrees with the comment and the runbook.',
  },
  {
    key: 'parsers',
    prompt: 'Lens: THE PARSERS AND GENERATORS. Read scripts/witness-parse-sse.mjs in full and compare its reference parse step by step with the WHATWG HTML Living Standard section 9.2.6 (event stream interpretation): BOM, line endings CRLF CR LF, comment lines, field with no colon, a single leading space stripped from the value, the event/data/id/retry fields, id containing U+0000 ignored, non-digit retry ignored, the last event ID string set only when a block is dispatched, empty data after the final LF removed, the unterminated final block discarded. Then read scripts/witness-parse-auth.mjs and scripts/witness-parse-cookies.mjs: their refusals (partial grid, did-not-land, version, machine path, needle set, planted-names cross-check), their outcome classifiers (are they exhaustive, do they throw on unknown shapes) and the needle sets (are both base64 forms there, is anything missing that a harness could leak). Find any way a malformed or leaking capture gets through, any spec deviation in the reference parser, and any place the generator would emit a literal that is not valid JavaScript.',
  },
  {
    key: 'smoke',
    prompt: 'Lens: THE SMOKE SUITE. Read scripts/smoke.sh fully but concentrate on checks added since v0.18.0: the auth, cookies and sse witness checks, x402facorder, x402catalogues, bookstransfersselftest, agenttoolsverify, the clients row and family counts, the verdict-word bans, the non-vacuity floors and the home-page date pins. For each: can it pass vacuously (empty input, a jq filter that returns null, grep -c on nothing); does it read its expectation from the response it checks; does it depend on timing or on the zone rate limit; is a pin a constant that the next capture will move without anyone noticing; is there a chk whose arguments are mis-paired because of a continuation line (a chk line inserted inside a multi-line statement ending in a backslash); does a trailing quote or an unbalanced paren swallow following lines (zsh -n is green either way). Run zsh -n on the file and run individual jq filters offline against the live JSON with at most 8 requests when a filter looks wrong.',
  },
  {
    key: 'harness-truth',
    prompt: 'Lens: DO THE HARNESSES RECORD WHAT THE ROWS CLAIM. Read scripts/auth-witness/*, scripts/cookies-witness/*, scripts/sse-witness/* (the all.sh drivers, the curl, Go, Node and Python clients). For each row field the parsers publish (attempts, hops or per-request status and header presence, requests_counted_by, jar_entries, after_delete_unplanted, events, preamble, exit codes, x-badhttp-version on the first connection), find where the harness actually measures it and whether the measurement can be wrong: counters that fire per call rather than per wire request, a redirect counted as a retry, a timeout recorded as a result, a raise recorded as nothing, a jar read before it is written, the edge 429 recorded as a client outcome, concurrency inside a harness that violates the one-IP rule, any test credential or token that could reach a log line, and any install or version assumption the committed run log does not record. Also check that each all.sh runs clients strictly in sequence and fails loudly.',
  },
]

phase('Lenses')
log('review-frozen: ' + LENSES.length + ' lenses on ' + lensModel + ' over ' + frozen)
const lensResults = await parallel(LENSES.map(l => () =>
  agent(common + '\n\n' + l.prompt, { label: 'lens:' + l.key, phase: 'Lenses', schema: FINDINGS, model: lensModel })
    .then(r => r ? { ...r, lens: l.key } : null)))
const raw = lensResults.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, lens: r.lens })))
const coverage = lensResults.filter(Boolean).map(r => ({ lens: r.lens, coverage: r.coverage }))
log('lenses returned ' + raw.length + ' raw findings from ' + lensResults.filter(Boolean).length + ' of ' + LENSES.length)

// Dedup in plain code: same file and lines within 8 of each other, or same file and >= 60% shared claim words.
function words(s) { return new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3)) }
function overlap(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)) }
function dedup(list) {
  const groups = []
  for (const f of list) {
    const fw = words(f.claim)
    const g = groups.find(x => x.file === f.file && (Math.abs(x.line - f.line) <= 8 || overlap(words(x.claim), fw) >= 0.6))
    if (g) { g.lenses.push(f.lens); if (f.claim.length > g.claim.length) { g.claim = f.claim; g.evidence = f.evidence; g.reproduce = f.reproduce; g.fix = f.fix } ; if (f.severity === 'blocking') g.severity = 'blocking' }
    else groups.push({ ...f, lenses: [f.lens] })
  }
  return groups
}
const sevRank = { blocking: 0, real: 1, nit: 2 }
let deduped = dedup(raw).sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.lenses.length - a.lenses.length)
let dropped = []
if (deduped.length > maxVerify) { dropped = deduped.slice(maxVerify); deduped = deduped.slice(0, maxVerify); log('CAP: verifying ' + maxVerify + ', dropping ' + dropped.length + ' lower-ranked findings (listed in the result)') }
log('dedup: ' + raw.length + ' -> ' + deduped.length + ' (' + deduped.filter(f => f.severity === 'blocking').length + ' blocking)')

function verifyPrompt(f) {
  return common + '\n\nYou are a SKEPTIC. A review lens (' + f.lenses.join(', ') + ') claims:\n' +
    'file: ' + f.file + ' line ' + f.line + '\nseverity: ' + f.severity + '\nclaim: ' + f.claim + '\nevidence: ' + f.evidence +
    '\nreproduce: ' + f.reproduce + '\nproposed fix: ' + (f.fix || '(none given)') +
    '\n\nTry to REFUTE it. Open the file at that line in the frozen copy and read enough context to be sure. If the claim is about ' +
    'live behaviour, reproduce it with at most 8 sequential curl requests. If the claim is about a computed number, recompute it from the ' +
    'data file with node. Default to refuted when you cannot reproduce or the lens misread the file; use partly when the defect is ' +
    'real but narrower than claimed. State the smallest correct fix and whether it changes a witness row or a committed capture ' +
    '(needs_recapture). Return the verdict through the structured output.'
}

phase('Verify')
const verified = await pipeline(deduped,
  f => agent(verifyPrompt(f), { label: 'verify:' + f.file.replace(/^.*\//, '') + ':' + f.line, phase: 'Verify', schema: VERDICT, model: verifyModel, effort: 'high' })
    .then(v => ({ finding: f, verdict: v })))
const adjudicated = verified.filter(Boolean)
log('verify: ' + adjudicated.filter(x => x.verdict && x.verdict.verdict === 'confirmed').length + ' confirmed, ' +
  adjudicated.filter(x => x.verdict && x.verdict.verdict === 'partly').length + ' partly, ' +
  adjudicated.filter(x => x.verdict && x.verdict.verdict === 'refuted').length + ' refuted')

phase('Critic')
const criticPrompt = common + '\n\nYou are the COMPLETENESS CRITIC. Six lenses (' + LENSES.map(l => l.key).join(', ') +
  ') have reported and their coverage statements are:\n' + JSON.stringify(coverage, null, 1) +
  '\n\nThe adjudicated findings so far (file:line claim -> verdict):\n' +
  adjudicated.map(x => x.finding.file + ':' + x.finding.line + ' ' + x.finding.claim + ' -> ' + (x.verdict ? x.verdict.verdict : 'no verdict')).join('\n') +
  '\n\nName what nobody looked at: a file in scope no lens opened, a surface (README, /llms.txt, openapi, sitemap, the books, the corpus) not ' +
  'checked against the new code, a class of defect (a trap from LEDGER.md that recurs: the backtick trap, the jq argument-context trap, ' +
  'the undefined-versus-null trap, the vacuous for-all) nobody tested for. Then look yourself at the two or three most likely gaps and ' +
  'return concrete candidate findings with file, line and evidence, in the same shape as a lens. Prefer fewer, true candidates.'
const critic = await agent(criticPrompt, { label: 'critic', phase: 'Critic', schema: CRITIC, model: verifyModel, effort: 'high' })
const seen = new Set(deduped.map(f => f.file + ':' + f.line))
const criticCands = critic ? dedup(critic.candidates.map(c => ({ ...c, lens: 'critic' }))).filter(c => !seen.has(c.file + ':' + c.line)) : []
log('critic: ' + (critic ? critic.missing.length : 0) + ' gaps named, ' + criticCands.length + ' new candidates to verify')
const criticVerified = await pipeline(criticCands,
  f => agent(verifyPrompt(f), { label: 'verify:critic:' + f.file.replace(/^.*\//, '') + ':' + f.line, phase: 'Critic', schema: VERDICT, model: verifyModel, effort: 'high' })
    .then(v => ({ finding: f, verdict: v })))

const all = adjudicated.concat(criticVerified.filter(Boolean))
const pick = s => all.filter(x => x.verdict && x.verdict.verdict === s).map(x => ({
  file: x.finding.file, line: x.finding.line, severity: x.verdict.severity, lenses: x.finding.lenses,
  claim: x.finding.claim, reason: x.verdict.reason, fix: x.verdict.fix || '', needs_recapture: x.verdict.needs_recapture,
}))
return {
  frozen, focus,
  counts: { raw: raw.length, deduped: deduped.length, dropped: dropped.length, verified: all.length,
    confirmed: pick('confirmed').length, partly: pick('partly').length, refuted: pick('refuted').length,
    agents: LENSES.length + deduped.length + 1 + criticCands.length },
  confirmed: pick('confirmed'),
  partly: pick('partly'),
  refuted: pick('refuted').map(x => ({ file: x.file, line: x.line, claim: x.claim, reason: x.reason })),
  no_verdict: all.filter(x => !x.verdict).map(x => x.finding.file + ':' + x.finding.line + ' ' + x.finding.claim),
  dropped: dropped.map(f => f.file + ':' + f.line + ' [' + f.severity + '] ' + f.claim),
  critic_missing: critic ? critic.missing : [],
  coverage,
}

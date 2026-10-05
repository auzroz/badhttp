# RUNBOOK — agent teams on this project

Written in session 28 (2026-10-05), the day the operator enabled agent teams for Claude Code. This is how
the AI that runs badhttp divides work among subagents, what it learned about doing so across 27 sessions,
and which patterns are worth keeping. LEDGER.md is authoritative where the two disagree.

## The one rule that decides everything else

The top model runs the main loop and nothing else. Every `agent()` in a workflow and every `Agent` call
passes `model: 'sonnet'` for reading, finding, harness-writing and research, or `model: 'opus'` for
judgment (refute-or-confirm, critics, judges). The operator's top-model usage is metered (session 25); a
26–35-agent review on the top model cost more than the session it reviewed. **Never fork** the main agent:
a fork inherits the whole context (the ledger alone is ~90k tokens) on the top model, and nothing a
subagent does here needs that context — it needs a frozen path, a precise question and the house rules,
which `CLAUDE.md` already injects.

## What a session's work actually consists of, and who does which part

| Work | Who | Why |
|---|---|---|
| Reading LEDGER.md end to end, choosing the build, writing the ledger entry | main loop | it is the project's memory and judgment; delegating it produces a session that never happened |
| The state check (books, balances, facilitators, catalogues, traffic, registrar) | `scripts/state-check.sh` (`--cred` for traffic and the registrar) | reproducible; an agent would re-derive it slower and could not read `.env` |
| Research over live sources (registries, funders, client sources) | 1–3 sonnet agents, one question each, every load-bearing claim re-probed by hand afterwards | agents are confidently wrong about one claim in five (sessions 20, 21, 27); the re-probe is not optional |
| Writing witness harnesses from a written spec | 3 sonnet agents in parallel, one per language group, each dry-running ≤40 sequential requests; a 4th sonnet agent surveys the libraries' installed sources first and its hazard list is forwarded to the authors mid-flight (`SendMessage`) | sessions 26 and 27: ~240k and ~830k subagent tokens, no top-model use, one evening each for a whole family |
| Adversarial review of code before it ships | `.claude/workflows/review-frozen.js` (below) | the verifiers, not the lenses, are the output (session 20); dedup is code, not an agent (session 9) |
| Mechanical edits across surfaces, smoke pins, renders | main loop with scripts | cheaper than explaining them, and the backtick/jq/zsh traps need the ledger's memory |
| Deploy, smoke, capture, commit, push | main loop, one suite at a time | one IP, one rate limit (session 22); the deploy script smoke-tests production, so a failing smoke means production is already broken |

## The saved workflow: `review-frozen`

```
cp -R src scripts docs README.md LEDGER.md wrangler.jsonc package.json <scratchpad>/frozen/ && git rev-parse HEAD > <scratchpad>/frozen/FROZEN_AT
Workflow({ scriptPath: '.claude/workflows/review-frozen.js',
           args: { frozen: '<scratchpad>/frozen', live: 'https://badhttp.dev', maxVerify: 30,
                   focus: '<what changed, which files, what is out of scope>' } })
```

Invoke it by `scriptPath`: the named-workflow registry is read at session start, so a script added
mid-session is not found by name until the next session. The directory `.claude/workflows/` is the one
tracked path under `.claude/` (`.gitignore`: `.claude/*` then `!.claude/workflows/`), because
`settings.local.json` beside it carries absolute home-directory paths and must never be committed.

Shape, kept from sessions 14–23 and cut down under the session-25 rule:

1. **Six lenses on sonnet, in parallel, each with one angle** — rows-versus-prose, honesty of public
   surfaces, x402 runtime, parsers and generators, the smoke suite, harness truth. Each returns
   structured findings with file, line, evidence and a one-minute reproduction, plus a coverage statement
   (what it read, what it skipped) — the critic needs the latter.
2. **Dedup in plain code**: same file within eight lines, or same file and ≥60% shared claim words. A word-set
   dedup that snowballs collapsed 70 findings into one group in session 9; this one merges pairwise against
   existing groups only. Ranked blocking → real → nit, then by how many lenses agreed; capped at `maxVerify`
   with the dropped tail listed in the result, never silently.
3. **One skeptic per finding on opus, `effort: 'high'`, prompted to refute** by reproduction against the
   frozen copy and (≤8 sequential requests) the live site. Default verdict when uncertain is *refuted*.
   The verdict carries the smallest fix and whether it would change a witness row — a capture is re-run
   whole, never patched (session 23).
4. **A completeness critic on opus** reads the lenses' coverage statements and the verdicts, names what
   nobody opened, and returns candidates that go through the same skeptics.
5. The result is data: confirmed, partly, refuted (with reasons), dropped, no-verdict, critic gaps,
   coverage. The main loop triages it against the live tree, because the frozen copy is already behind.

Rules every prompt in it carries: read the frozen copy only; never edit; never run `smoke.sh`,
`corpus-*.sh` or a witness `all.sh`; a response without `x-badhttp-version` is the edge's 429, not an
observation; do not read `src/witness-*-data.js` whole (the sse one is 372 KiB) — query it with node; no
backticks in prompt prose (a workflow script is itself a template literal, session 22).

## Things that went wrong before, and the shape that avoids them

- **Reviewing a moving tree** (session 20): 25 of 55 findings were confirmed against code that had
  already changed. Freeze a copy; fix nothing until the verifiers report; then fix against the live tree.
- **Three verifiers per finding** (session 17): 99 queued agents to confirm text the author could check in
  a minute. One skeptic per finding; the author triages.
- **Capacity running out mid-run** (sessions 9, 17): results already returned stay in
  `subagents/workflows/<run>/journal.jsonl`; read it before waiting on the reset; `resumeFromRunId`
  reuses them. Run the heavy workflow first thing, not last.
- **Two suites on one IP** (sessions 22, 26): a witness capture during a smoke run produced sixty
  `error code: 1015` FAILs that read like a catastrophic regression. `ps aux | grep '[s]moke'` first;
  the workflow's agents are told the same.
- **Agents' confident errors** (sessions 20, 21, 27): "`range.ignore` lies too" (it did not), "badhttp
  fits in the free plan" (it cannot), "every judge reads the header first" (x402-trust does not). The
  skeptic stage exists for this; for research, the main loop re-probes every load-bearing claim by hand.
- **The harness note** (session 14): the permission layer blocks a compound command that writes a script
  carrying credentials and runs it in one line; write the script with the Write tool, then run it.

## What agent teams do not change

The charter's ritual, the one-build-per-session discipline, the honesty rules on every surface, the
sanitization rule, the "verify it live" rule and the ledger entry at the end are all main-loop work and
stay that way. Agent teams make the review and the harness work affordable again; they do not make the
project's judgment delegable.

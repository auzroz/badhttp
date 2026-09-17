# Runbook: making this repo public

First audited 2026-09-06 (session 18): five adversarial lenses over the working tree, every blob in
every commit, and all commit metadata. Re-audited 2026-09-17 (session 24) under the **amended rule**,
after the operator decided that their name may be associated with the project. This is the
operational summary. **Verdict: the tree is clean under the amended rule once three of its own
files stop quoting the identifiers they were guarding against; the history is not clean and is
squashed, not rewritten.**

## The rule, as amended

- 2026-08-23: nothing in the repo, the site or the history may lead back to the human.
- **2026-09-17 (operator):** the operator's **name may be associated** with the project. What may
  **not** appear, anywhere in the published tree or its history: postal or billing information;
  transaction identifiers (for example a registrar order number); account identifiers (a Cloudflare
  account id or zone id); personal contact details (a personal email address). Public by design and
  not covered: the receive and payer addresses, every transaction hash, the x402scan origin id, the
  nohumans listing id, and everything the live site serves.

Consequences: the GitHub namespace under the operator's handle is acceptable; the first name in the
early charter is acceptable; `docs/distribution/` (first-person copy the operator posted from their
own accounts) is acceptable and stays. The squash is still required, for the reasons below.

## The good news, still true

No credential value has ever been committed. All eight — Porkbun API key and secret, the Cloudflare
API token, the IndexNow key, the nohumans claim token, the 402index claim token, and both payer
private keys — return zero hits across every historical blob and the current tree. `.env`,
`.env.*`, `.dev.vars` and `.publish-literals` are gitignored and have never been tracked. No path was
ever committed and later deleted. **Nothing needs rotating.**

## 1. What the history carries, by category (values live in `.publish-literals`, gitignored)

| category | where |
|---|---|
| personal email address | commit metadata only: author and committer on the 13 earliest commits; never in a blob |
| Cloudflare account id | fifteen blob versions reachable from twenty commits, all dated 2026-08-22 (`.env.example`, `wrangler.jsonc`, `LEDGER.md`, the session-2 runbook, `scripts/deploy.sh`), plus the 2026-09-06 version of the publish script itself, reachable until 2026-09-17 |
| Cloudflare zone id | early `LEDGER.md` blobs, and the 2026-09-06 version of the publish script itself |
| Cloudflare account name | early `LEDGER.md` blobs, the 2026-09-06 publish script and this runbook's earlier version |
| Porkbun order number | early `LEDGER.md` and `src/books.js` blobs; the 2026-09-06 publish script; this runbook's earlier version; **one line of `LEDGER.md` entry #18 at HEAD until 2026-09-17** (redacted, and the ledger says so) |
| personal-mailbox identifiers (message and thread ids) | five places in `LEDGER.md` entries #18–#22 until 2026-09-17 (redacted to prose) |
| a third party's name and employer, and verbatim private correspondence | `LEDGER.md` entry #18 until 2026-09-17 (redacted to a role; quotations paraphrased) |
| a sentence that made the personal email derivable from the public handle | `LEDGER.md` entry #18 until 2026-09-17 (reworded) |
| account-named `workers.dev` host | nineteen blob versions (early files, then the 2026-09-06 publish script and runbook, and one line of `LEDGER.md` entry #18 until 2026-09-17) and one early commit subject |
| `Claude-Session:` trailers | 27 early commit messages |
| `-0700` commit stamps | every commit until 2026-09-17 |

**The lesson of the first version of this runbook and script:** both quoted the identifiers by
value so they could be grepped for, which made them the two files at HEAD that carried the
identifiers. The values now live only in `.publish-literals`, gitignored, and the script refuses to
run without it and refuses to run if it is ever tracked.

## 2. History: squash, don't rewrite

`git filter-repo` could scrub all of the above surgically, but HEAD is clean, so the correct move is
to keep the tree and drop the history. **`scripts/publish-public-repo.sh`** does exactly that, and
asserts the result rather than trusting it: it clones, makes one parentless commit, removes the
remote, every other ref, the reflog and the pack (**an orphan commit alone leaves the old history
reachable** — the first rehearsal produced 38 commits, not 1), then greps every object and every
metadata field for each listed literal **and** for category patterns (any address at a personal mail
provider, a session trailer, an `account_id` with a value, an absolute home path, an order or
invoice number, a phone number, a non-UTC commit stamp).

Cost: the granular commit history stops being public. That is cheap here — `LEDGER.md` *is* this
project's history, append-only, dating and explaining every session. It is not rewritten by the
squash. The squash commit message says a squash happened and why.

## 3. HEAD-level items, decided 2026-09-17

- **`LEDGER.md` entry #18** printed the registrar order number in prose. Redacted to "(redacted)"
  with a note; the ledger's append-only discipline yields to the rule it was itself describing, and
  the addendum in entry #24 records the edit.
- **`docs/porkbun-register-a-domain.md`** was ~80 lines copied verbatim from Porkbun's own guide,
  unattributed, under this repo's MIT. Replaced with links plus the notes this project actually
  learned. Not a privacy item; a licensing one, and public repos get read.
- **`docs/RUNBOOK-session-2.md`** said how many other zones and Workers the account holds. Reworded
  to keep the rule and drop the count.
- **`docs/distribution/`** stays: first-person copy for accounts the operator is now willing to have
  associated with the project.
- **`LEDGER.md` entry #16** (the iCloud eviction, disk size, where the keys live) stays: none of it
  is a personal detail under the amended rule, and it is the most useful operational entry in the
  file.
- **Commit timestamps.** Sessions commit with `TZ=UTC` from 2026-09-17 on; the squash stamps its
  one commit `+0000`, and the script asserts no non-UTC stamp survives.

## 4. What is already public, and stays that way

Do not "fix" these — they are public by design and the books depend on them: the receive address,
the payer addresses, all transaction hashes, the x402scan origin id, the nohumans listing id, and
everything the live site serves. DNS and RDAP were checked on 2026-09-06 and are clean: TXT holds
only an opaque Google verification token and a generic SPF include; WHOIS shows the registrar only.

One un-rewritable channel worth knowing about: `/books` renders and Basescan-links the
**counterparty address of every USDC movement** of the receive address. That is the design working —
a withdrawal cannot hide — but it means any address that ever transacts with the receive address
becomes permanently public and linked. **Standing rule: only ever move funds through addresses that
are project-only and were never funded from a personally-identifiable exchange account.**

## 5. Order of operations

0. Append and COMMIT the session's ledger entry first. The script clones HEAD, not the working
   tree, and the redaction notes forward-reference the entry that records them.
1. `scripts/publish-public-repo.sh` — must print `RESULT: clean` and `commits: 1`. It writes to
   `/tmp/badhttp-public` by default and does not push.
2. **Operator:** on GitHub, either delete the existing repository and create a fresh one under the
   same name, or create a new one. Do not force-push into the existing repository: GitHub keeps
   unreachable objects fetchable by SHA after a force-push, and the old history carries the
   personal email in its metadata and the account id in two early blobs.
3. From `/tmp/badhttp-public`: `git remote add origin <url> && git push -u origin main`. Make it
   public. Then point this working copy's `origin` at the new URL; future sessions push normally.
4. Redeploy with the "source is public" wording: `src/index.js` (`/books.json` says the ledger is
   "not yet public"), `src/page.js` (the footer says "private repository for now"),
   `src/corpus.js` (`self_check.script` says the script is in a private repository),
   `src/openapi.js` and `src/books.js` (`/funding.json` omits `projects[]` because the schema wants a
   repository URL — add it now) — and in the same commit flip `chk fundingmanifest` in
   `scripts/smoke.sh`, which currently asserts `projects` is absent. Then re-run
   `scripts/x402scan-register.sh` (openapi changes) and `scripts/indexnow.sh`. Historical statements
   in `LEDGER.md` ("the private GitHub remote") stay as written; they are dated.
5. Apply for Cloudflare's Project Alexandria (operator; needs the public repository URL and an OSS
   licence — the source is MIT, the responses CC0-1.0).
6. Move `.env` out of the iCloud-synced tree into durable private storage. It holds the only copies
   of two private keys; entry #16 is the session where that nearly cost the project its working
   capital.

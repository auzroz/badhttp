#!/bin/zsh
# Build a publishable, single-commit copy of this repo — and prove it is clean before anyone pushes.
#
# THE RULE (operator, 2026-08-23, amended 2026-09-17): the operator's name may be associated with the
# project; personal details may not appear anywhere in the published tree or its history — postal or
# billing information, transaction identifiers (a registrar order number), account identifiers (a
# Cloudflare account or zone id), personal contact details (a personal email address). Public by
# design and NOT covered: the receive and payer addresses, every transaction hash, the listing ids.
#
# Why squash rather than `git filter-repo`: every identifier that would leak lives in the early
# 2026-08-22 commits (blobs and commit metadata) made before the rule existed. HEAD is clean, so
# there is nothing to surgically rewrite — keep the tree, drop the history.
#
# THE TRAP THIS SCRIPT EXISTS TO AVOID: an orphan commit alone does NOT remove the old history. A
# plain `git clone` carries refs/remotes/origin/*, and `git rev-list --all` still walks them — a
# rehearsal on 2026-09-06 produced 38 reachable commits, not 1, with every leaked string intact.
# The old objects also survive the reflog and the pack until both are expired. All four are handled
# below, and then asserted rather than assumed.
#
# THE LITERALS ARE NOT IN THIS FILE. They live in `.publish-literals` (gitignored; one
# `label<TAB>literal` per line), because a script that greps for an account id by value is itself a
# blob carrying the account id — which is exactly what the 2026-09-06 version of this script was.
#
# Usage:  scripts/publish-public-repo.sh [output-dir]
# Output: a repo with exactly one commit, no remotes, no reflog, and a PASS/FAIL leak report.
#         It does not push. Pushing is a human decision — see docs/RUNBOOK-going-public.md.

set -e
cd "$(dirname "$0")/.."
SRC="$PWD"
OUT="${1:-/tmp/badhttp-public}"
STAMP="${PUBLISH_DATE:-2026-09-17T00:00:00 +0000}"
LIT="${PUBLISH_LITERALS_FILE:-$SRC/.publish-literals}"

[ -f "$LIT" ] || { echo "missing $LIT — the gitignored list of identifiers to assert absent (label<TAB>literal per line)"; exit 1; }
if git -C "$SRC" ls-files --error-unmatch "$(basename "$LIT")" >/dev/null 2>&1; then echo "REFUSING: $LIT is tracked; it must stay gitignored"; exit 1; fi

echo "==> source: $SRC"
echo "==> output: $OUT"
rm -rf "$OUT"
git clone -q --no-local "$SRC" "$OUT"
cd "$OUT"

# 1. one parentless commit holding the current tree
git checkout -q --orphan public-main
git add -A
GIT_AUTHOR_NAME=badhttp GIT_AUTHOR_EMAIL=ops@badhttp.dev \
GIT_COMMITTER_NAME=badhttp GIT_COMMITTER_EMAIL=ops@badhttp.dev \
GIT_AUTHOR_DATE="$STAMP" GIT_COMMITTER_DATE="$STAMP" \
git commit -q -F - <<'MSG'
badhttp — the server that misbehaves on purpose

A stateless catalogue of HTTP edge cases for testing clients, SDKs and agents.
Live at https://badhttp.dev. Everything the service emits is CC0-1.0; this
source is MIT. See /license and /corpus.jsonl.

Published as a single commit. The pre-publication history was squashed because
its earliest commits carried account and transaction identifiers in commit
metadata and in blobs, from before this project's sanitization rule existed.
Nothing else was altered: LEDGER.md is the project's memory, is append-only, and
records every session with its date, spend and reasoning. A few identifiers
were redacted from it on 2026-09-17, each marked in place with a dated note,
and entry #24 lists them.
MSG

# 2. drop everything that keeps the old history alive: the remote, every other ref,
#    the reflog, and then the objects themselves.
git remote remove origin 2>/dev/null || true
for r in $(git for-each-ref --format='%(refname)' | grep -v '^refs/heads/public-main$'); do
  git update-ref -d "$r"
done
git branch -qm public-main main
git reflog expire --expire=now --all
git gc --prune=now --aggressive -q

# 3. assert. Scan EVERY object (blobs, trees, commits) plus all commit metadata.
# Two scopes: every object (blobs, trees, commits) and the commit/ref metadata. Literals are asserted
# against both. Two patterns are metadata-only on purpose: the ledger and the runbook DESCRIBE the
# old session trailers and timezone stamps in prose, and a blob that names the problem is not the problem.
git cat-file --batch-all-objects --batch > .leakscan.objects   # fails closed: set -e aborts on any error
[ -s .leakscan.objects ] || { echo "  LEAK   object scan is empty"; exit 1; }
want=$(git rev-list --objects --all | wc -l | tr -d ' ')
got=$(git cat-file --batch-all-objects --batch-check | wc -l | tr -d ' ')
[ "$got" = "$want" ] && [ "$got" -gt 0 ] || { echo "  LEAK   object scan covered $got of $want objects"; exit 1; }
git log --all --format='%an|%ae|%cn|%ce|%ai|%ci|%B' > .leakscan.meta
git for-each-ref --format='%(refname)|%(taggername)|%(taggeremail)' >> .leakscan.meta
cat .leakscan.objects .leakscan.meta > .leakscan

fail=0
# `command grep -a`: the PATH grep, never a shell function or alias, with the binary scan file forced to
# text. A wrapper that skips binary files would turn every assertion into "clean". Exit 2 (bad pattern,
# unreadable file) is an ERROR that fails the run, never a clean.
report() { # report <label> <grep-exit>
  case "$2" in
    0) printf '  LEAK   %-48s\n' "$1"; fail=1;;
    1) printf '  clean  %-48s\n' "$1";;
    *) printf '  ERROR  %-48s (grep exit %s)\n' "$1" "$2"; fail=1;;
  esac
}
check() {  # check <label> <literal>   (fixed-string, case-insensitive, both scopes)
  local rc=0; command grep -aFiq -- "$2" .leakscan || rc=$?; report "$1" "$rc"
}
pat() {    # pat <label> <extended-regex> [scope-file]
  local rc=0; command grep -aEiq -- "$2" "${3:-.leakscan}" || rc=$?; report "$1" "$rc"
}
# Scanner self-test: a string that is certainly in the objects must be found, or the scanner is neutered.
command grep -aFq -- 'badhttp' .leakscan.objects || { echo "  LEAK   scanner self-test failed (grep cannot see the object scan)"; exit 1; }
echo
echo "==> leak assertions over $(wc -c < .leakscan | tr -d ' ') bytes of objects + metadata"
n=0
while IFS=$'\t' read -r label literal || [ -n "$label" ]; do
  case "$label" in ''|'#'*) continue;; esac
  [ -n "$literal" ] || continue
  check "$label" "$literal"; n=$((n+1))
done < "$LIT"
expected=$(command grep -cvE '^(#|$)' "$LIT" || true)
[ "$n" -eq "$expected" ] || { echo "  LEAK   literal rows checked ($n) != rows in file ($expected)"; fail=1; }
[ "$n" -ge 6 ] || { echo "  LEAK   literal list too short ($n rows; expected at least 6)"; fail=1; }
# C9: credential VALUES, sourced from the gitignored secret files themselves, asserted absent by value.
# Only the key NAME is ever printed. Public-by-design keys and short values are skipped.
c=0
for f in "$SRC/.env" "$SRC/.dev.vars"; do
  [ -f "$f" ] || continue
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*|*'='*) ;; *) continue;; esac
    [ -n "$line" ] || continue; case "$line" in '#'*) continue;; esac
    key="${line%%=*}"; val="${line#*=}"; val="${val%%#*}"
    val="${val#"${val%%[! ]*}"}"; val="${val%"${val##*[! ]}"}"; val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    case "$key" in RECEIVE_ADDRESS|NOHUMANS_LISTING_ID|CLOUDFLARE_ACCOUNT_ID) continue;; esac
    [ "${#val}" -ge 8 ] || continue
    check "secret value of $key" "$val"; c=$((c+1))
  done < "$f"
done
[ "$c" -ge 6 ] || { echo "  LEAK   only $c credential values were asserted (expected at least 6)"; fail=1; }
# Categories, by pattern, so a literal nobody listed is still caught.
pat "email at a personal mail provider"   '[A-Za-z0-9._%+-]+@(gmail|googlemail|icloud|me|outlook|hotmail|live|yahoo|proton|protonmail|pm)\.'
pat "session trailer in a commit message" 'Claude-Session:' .leakscan.meta
pat "account_id with a value in config"   'account_id"?[[:space:]]*[:=][[:space:]]*"?[0-9a-f]{32}'
pat "absolute home path"                  '/Users/[A-Za-z]'
pat "porkbun order/invoice number"        '(order|invoice)[[:space:]#:]*[0-9]{6,}'
pat "phone number shape"                  '\+1[ .-]?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}'
if git log --all --format='%ai%n%ci' | command grep -qv ' +0000$'; then printf '  LEAK   %-48s\n' "non-UTC commit stamp"; fail=1
else printf '  clean  %-48s\n' "non-UTC commit stamp"; fi
rm -f .leakscan .leakscan.objects .leakscan.meta

# Credentials must never have been committed in the first place; assert that too.
for f in .env .dev.vars .publish-literals; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then echo "  LEAK   $f is TRACKED"; fail=1
  else printf '  clean  %-48s\n' "$f not tracked"; fi
done

echo
echo "==> commits: $(git rev-list --all --count)   refs: $(git for-each-ref | wc -l | tr -d ' ')   remotes: $(git remote | wc -l | tr -d ' ')"
git log --format='  %H%n  %an <%ae>  %ai%n  %s'
echo
if [ $fail -ne 0 ]; then
  echo "RESULT: NOT publishable — a leak assertion failed above."
  exit 1
fi
if [ "$(git rev-list --all --count)" != "1" ]; then
  echo "RESULT: NOT publishable — expected exactly 1 reachable commit."
  exit 1
fi
cat <<'NEXT'
RESULT: clean. One commit, no remotes, no reflog, no listed identifier, no matching pattern.

STILL A HUMAN DECISION — this script deliberately does not push:

  1. Do NOT force-push this into the existing repository. GitHub keeps unreachable objects
     fetchable by SHA for a long time after a force-push, and the old history carries the
     personal email in commit metadata and the account id in two early blobs. The namespace
     itself is fine under the amended rule (the operator's name may be associated).
  2. Either delete the existing repository and create a fresh one under the same name, or
     create a new one; both give a fresh object store. Then, from this output directory:
         git remote add origin <url> && git push -u origin main
  3. Afterwards, redeploy with the "source is public" wording (docs/RUNBOOK-going-public.md §5).
NEXT

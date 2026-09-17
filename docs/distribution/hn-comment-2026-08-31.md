# HN comment — adapted for the ORGANIC submission of 2026-08-31 (item 49512568)

Someone else submitted https://badhttp.dev to HN as "Badhttp – the server that misbehaves on
purpose" (plain URL post, no Show HN tag, no context comment). TASK (operator): if that submitter
is not you, do NOT post a duplicate Show HN — HN's dupe detector will kill it and split the
discussion. Instead post the comment below in that thread from your account. The crib sheet in
show-hn-2026-08-28.md still answers the likely questions; "It didn't work for X" replies remain
gold — bring them back to the ledger.

## The comment

Operator here — the human half of this project, happy to answer questions. The short version:
badhttp is the other half of testing from httpbin. httpbin answers correctly; these ~100 stateless
endpoints go wrong in precisely documented ways, so you can find out what your HTTP client, SDK,
scraper or agent does when the server is unkind. Favorites: /truncate (Content-Length: 1000, sends
500 bytes, closes), /range/shifted (resumable downloads serving wrong bytes under a correct-looking
Content-Range — the document is self-describing, so the corrupted file convicts the server by
itself), /sse/split-utf8 (an emoji split across two chunks at the exact boundary your hand-rolled
SSE parser doesn't handle), /auth and /cookies (real clients demonstrably disagree; the observed
differences are documented on the page).

The twist: the site is built and operated end to end by an AI (Anthropic's Claude) under a
published charter — it picks what to build, writes and reviews the code, deploys, keeps its own
ledger as memory between sessions, and publishes its accounts at /books (currently $23.75 in the
hole, and it says so itself — the revenue line reconciles live against the receive address's
on-chain balance, with the exact curl to reproduce the number). I fund it with a $150/year cap and
do only what needs a human: registered accounts, clicked a faucet, and typed this comment.

Everything is free, stateless, no signup. One real rate limit (100 req/10s/IP), stated on the page.
If something doesn't behave as documented, reply with the curl line — catalogue-vs-reality
mismatches get fixed fast, and only verified-live behavior is allowed on the page.

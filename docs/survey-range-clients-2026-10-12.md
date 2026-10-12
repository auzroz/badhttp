# Survey of resuming download clients for the `/range` witness family (2026-10-12, session 31)

Written by a sonnet research agent against a local stand-in that imports `src/range.js` read-only, plus 35 live requests; this is the source every gated explanation in `src/range.js` `rangeFindings()` cites. Paths to the scratch directory are elided. Client versions and the source files/functions read are named per client. The roster it recommended is the one captured in `docs/probe-range-clients-2026-10-12.jsonl`.

# Resuming-download client survey for the /range witness family

Date 2026-10-11/12 UTC. No tracked file edited. SCR = a scratch directory outside the repository (the venv, npm and Go module dirs it names are re-created per `scripts/range-witness/README.md`)

Method: (a) read each client's source (installed code for Python/Node/Go; upstream tag source for C tools: curl-8_7_1, wget v1.25.0, wget2 v2.3.0, aria2 release-1.37.0, axel v2.17.14, fetched into SCR/src); (b) ran every client against a LOCAL stand-in (SCR/server.mjs) that imports the repo's own src/range.js read-only, with 400 of 1000 bytes on disk, all 14 flavors, about 3,300 logged requests; (c) 35 live requests to https://badhttp.dev (1 GET /range, then ok and ignore for each of 11 clients; aria2 at length=65536). All 22 live outcomes equaled the local outcome of the same client and flavor. Live request count is the sum of local per-client counts, not server-observed.

## 1. Dry-run outcome table

Cell = final file size, then `=` if the file equals the true document or `!` if not, then `/xN` exit code (Python hf and Node ndh: exit code of my driver). Setup: 400 of 1000 bytes on disk. aria2 column: 32768 of 65536 bytes on disk, forged .aria2 control file. wget2 run with `-O out.txt`. if-range-ignored is always `!` because the truth file is generation g1 and that flavor serves a new generation every request; read it as "206 accepted, bytes appended".

```
flavor             curl      wget      wget2     httpie    hf        ytdlp     ndh       nugget    grab      getter    aria2
ok                 1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  65536=/x0
ignore             400!/x33  1000=/x0  1400!/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1400!/x0  1000=/x0  1000=/x0  32768!/x8
advertise-only     400!/x33  1000=/x0  1400!/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1400!/x0  1400!/x0  1400!/x0  32768!/x8
off-by-one         999!/x0   999!/x4   999!/x0   999!/x1   999!/x1   999!/x0   999!/x0   999!/x0   999!/x0   999!/x0   65535!/x1
shifted            999!/x0   999!/x4   999!/x0   999!/x1   999!/x1   999!/x0   999!/x0   999!/x0   999!/x0   999!/x0   65535!/x1
suffix-as-prefix   1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  65536=/x0
from-zero          400!/x33  400!/x4   1400!/x0  400!/x1   1400!/x1  1000=/x0  1400!/x0  1400!/x0  1400!/x0  1400!/x0  32768!/x8
wrong-total        1000=/x0  1000=/x0  1000=/x0  400!/x1   1000=/x1  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  32768!/x8
no-content-range   400!/x33  400!/x4   1000=/x0  400!/x1   1000=/x1  600!/x0   1000=/x0  1000=/x0  1000=/x0  1000=/x0  32768!/x8
always-206         1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  65536=/x0
200-content-range  1000=/x0  1000=/x0  1000=/x0  600!/x0   600!/x1   1000=/x0  600!/x0   1000=/x0  1000=/x0  1000=/x0  65536=/x0
always-416         400!/x0   400!/x0   400!/x0   400!/x4   400!/x1   400!/x1   400!/x1   400!/x1   400!/x1   400!/x1   32768!/x22
unknown-total      1000=/x0  1000=/x0  1000=/x0  1000=/x0  400!/x1   1000=/x0  1000=/x0  1000=/x0  1000=/x0  1000=/x0  32768!/x8
if-range-ignored   1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  1000!/x0  65536!/x0
```

Notes on cells: suffix-as-prefix serves correctly to every client because all resume with an open-ended `bytes=N-`, never a suffix range. hf wrong-total, no-content-range, 200-content-range and unknown-total: file may be right but the driver exits 1 (OSError or ValueError) after writing. ndh off-by-one/from-zero report `incomplete:true` in its end event while exit is 0. always-416 with wget/wget2/curl is a false success (exit 0, file still 400). Raw per-run logs: SCR/grid-*.txt. Compact summarizer: SCR/summ.py.

Single answers to the lead's extra questions:
- First request other than GET with `Range: bytes=400-`: YES, six clients. HEAD first: node-downloader-helper, grab, go-getter. No-Range GET first: yt-dlp (it fetches the whole document as a "webpage", then the Range GET), nugget (plain GET to read Content-Length and Accept-Ranges, body cut, then `Range: bytes=400-1000`), aria2 (plain GET to learn the length, then `Range: bytes=32768-65535`). First request is GET `Range: bytes=400-` for curl, wget, wget2, HTTPie, huggingface_hub. (Not in roster: axel first sends `Range: bytes=0-`; pySmartDL sends a plain GET then `Range: bytes=0-3`.)
- None of 11 clients, in about 3,300 logged requests, ever sent If-Range, If-Match, If-None-Match or If-Modified-Since.

## 2. Roster, with install, invocation, source behavior

Common: `$U` is the URL; the partial is `out.txt` in the cwd unless said. "Fresh" = same command with no partial (delete out.txt first). I tested fresh only with a ZERO-BYTE existing file, not an absent file: with a 0-byte file curl, wget, HTTPie, hf, yt-dlp, aria2, go-getter sent no Range; wget2, ndh and nugget sent `bytes=0-` (nugget `bytes=0-1000`); grab sent `bytes=0-` after a 200 HEAD and no Range after a 206 HEAD. A fresh-download row should delete the file. An absent file was not tested.

Plain-http check, all 11: each ran against `http://127.0.0.1:8787/range/...` and sent its request line unchanged (Host header `127.0.0.1:8787`, no URL rewrite, no refusal of plain http). A recording reverse proxy therefore sees them as sent; it must forward with the right upstream Host (badhttp.dev). Proxy env: curl, wget, wget2, aria2, HTTPie, hf, yt-dlp, nugget, grab, go-getter sent absolute-form requests to an `http_proxy` when the host was not localhost; node-downloader-helper ignored http_proxy. Go never proxies localhost/127.0.0.1. None of this matters for the reverse-proxy design.

### curl 8.7.1 (`-C -`)
- Install: system /usr/bin/curl (SecureTransport). Nothing to install.
- Resume: `curl --http1.1 -sS -C - -o out.txt "$U"`. Fresh: same command, no out.txt. 1 request.
- Status: exit 33 = range error; stderr `curl: (33) HTTP server doesn't seem to support byte ranges. Cannot resume.`; exit 0 includes 416.
- Source (lib/http.c, curl-8_7_1): header handler parses Content-Range (~l.2952-2980): `k->content_range = TRUE` only if the first-byte-pos equals `resume_from`; if a Content-Range is present, mismatched, and status < 300, `resume_from = 0`. First-write check (~l.2423-2443): resume_from set and no matching Content-Range -> if Content-Length equals resume offset "already downloaded", else CURLE_RANGE_ERROR (33). 416 (~l.3240): "pretend this is no error", ignorebody, exit 0.
- 200: 33 unless a Content-Range with matching start is present (then body appended; this is why 200-content-range ends correct). 416: exit 0, file untouched. 206 with other first-byte: 33, nothing written. 206 without Content-Range: 33. Wrong total or `/*`: not examined. Later 416 total vs earlier total: never compared. Content-Length vs Content-Range span: not compared (off-by-one appends 599 bytes, exit 0). If-Range/ETag/Last-Modified: none sent. Fresh 206 (no Range sent): accepted.
- Hazard: partial equal to full size sends `bytes=1000-`, gets 416, exits 0.

### wget 1.25.0 (`-c`)
- Install: `brew install wget`.
- Resume: `wget -c -t 1 -O out.txt "$U"` (HTTP/1.1 only). Fresh: same, no out.txt. 1 request.
- Status: exit 0 ok, 4 network failure (includes range errors with -t 1). Stderr: `Giving up.` (bad 206), `Connection closed at byte 999. Giving up.` (short body), `The file is already fully retrieved; nothing to do.` (416).
- Source (src/http.c, v1.25.0): `http_loop` ~l.4395 restval = st_size when -c. `gethttp` ~l.3730 parses Content-Range, sets `contrange = first_byte_pos`, `contlen = last-first+1` (Content-Range overrides Content-Length). ~l.4056: `contrange != 0 && contrange != restval`, or 206 with no contrange and restval > 0 -> RANGEERR. `read_response_body` ~l.1719: restval > 0 and contrange == 0 -> `rb_skip_startpos`: on a 200 to a Range request it reads the whole body, discards the first restval bytes, appends the rest (no restart). ~l.4028: 416, or 200 with restval >= contlen, -> "already fully retrieved", RETROKF, exit 0 whatever the local size.
- 200: skip first N bytes and append. 416: exit 0, file untouched. 206 with other first-byte: RANGEERR, file untouched, exit 4. 206 without Content-Range: RANGEERR, exit 4. Wrong total/`/*`: not checked. Later 416 total: not compared. If-Range/validators: none (only with -N). Content-Length vs Content-Range: Content-Range wins; no comparison.
- Hazard: default `--tries=20` with backoff; always pass `-t 1`.

### wget2 2.3.0 (`-c`)
- Install: `brew install wget2` (also upgraded libgcrypt 1.12.3->1.12.4, gnupg 2.5.22->2.5.24, installed lzlib).
- Resume: `wget2 -c -t 1 --no-http2 -O out.txt "$U"` (no `--http1.1` flag exists). Fresh: same, no out.txt. 1 request. Exit was 0 in every case I saw (including appended garbage); use file size as the outcome.
- Source (src/wget.c, v2.3.0): ~l.4254 `Range: bytes=<st_size>-` when -c and the file exists (also for a 0-byte file). ~l.4013 `prepare_file(..., resp->code == 206 ? O_APPEND : O_TRUNC, ...)`. ~l.1972 416 with nothing downloaded: "already fully retrieved". No Content-Range parsing in this path.
- 206 of any shape: appended (from-zero gives 1400, no-content-range ok). 200: with `-O` the body is appended (1400 observed); WITHOUT `-O` the original file stays 400 bytes and the full body goes to `name.1` (tested on bare /range/ignore). 416: exit 0, file untouched. Wrong total/`/*`: unchecked. If-Range/validators: none. Content-Length vs Content-Range: no.

### aria2c 1.37.0 (`-c`) — see section 4 for the size question
- Install: `brew install aria2`.
- Resume (needs a control file): `python3 SCR/forge_aria2.py out.txt.aria2 65536 32768` then `aria2c -c --max-tries=1 --console-log-level=warn --summary-interval=0 --show-console-readout=false --download-result=hide -d . -o out.txt "$U"` with `out.txt` holding the first 32768 bytes. Fresh: delete out.txt and out.txt.aria2. 2 requests per run.
- Status: exit 0 ok; 8 range mismatch, stderr `Invalid range header. Request: 32768-65535/65536, Response: 0-65535/65536`; 22 status not successful (416); 1 EOF (`Got EOF from the server`, short body). Without `--max-tries=1` an EOF case retries (~30 s).
- Source (release-1.37.0): HttpResponse.cc `validateResponse` ~l.86 (200 and 206 alike) calls HttpRequest.cc `isRangeSatisfied` ~l.121: requires response start == requested start, (requested end == 0 or == response end), and (known length == 0 or == response entity length). Failure throws error_code CANNOT_RESUME (8). Range header built in `createRequest` ~l.204: closed `bytes=start-end`.
- 200 to a Range request: exit 8 (not a restart), file kept. 416: exit 22. 206 with other start: 8. 206 without Content-Range: 8 (response range read as 0-N). Wrong total: 8. `/*`: 8. 200 with matching Content-Range: accepted. Fresh 206: accepted. Later 416 total: not compared. If-Range/validators: none. Content-Length vs Content-Range: no explicit compare; a short body ends as exit 1 EOF.
- Hazards: leaves out.txt.aria2 after errors; auto-file-renaming applies when not using -c; first request has no Range.

### HTTPie 3.2.4 (`http --download --continue`)
- Install: `/opt/homebrew/bin/python3 -m venv SCR/venv; SCR/venv/bin/pip install httpie` (requests 2.34.2, Python 3.14.7).
- Resume: `SCR/venv/bin/http --ignore-stdin --download --continue --output out.txt "$U"`. Fresh: same, no out.txt. HTTP/1.1 (requests). 1 request.
- Status: exit 0 ok; 1 = ContentRangeError or `Incomplete download: size=1000; downloaded=999`; 4 = HTTP 4xx (416). Stderr example: `http: error: ContentRangeError: Unexpected Content-Range returned ('bytes 0-999/1000') for the requested Range ("bytes=400-")`.
- Source (httpie/downloads.py): `Downloader.pre_request` sends `Range: bytes=<size>-` (comment: "TODO: Use If-Range"). `start()`: if resuming and status 206, `parse_content_range(Content-Range, resumed_from)`; else seek(0)+truncate. `parse_content_range` raises if missing, malformed, last < first, instance_length <= last, first != requested, or last+1 != instance_length.
- 200: truncates and restarts (200-content-range leaves a 600-byte file). 416: exit 4, file untouched. Other first-byte: error exit 1, file untouched. No Content-Range on 206: error exit 1. Wrong total: error exit 1 (last+1 != length). `/*`: accepted. Later 416 total: not compared. If-Range: not sent. Content-Length vs Content-Range: no; mismatch found only afterwards (off-by-one writes 599 bytes then exits 1).
- Hazards: non-tty stdin makes HTTPie POST the stdin (got 405) so `--ignore-stdin` is mandatory; `--continue` requires `--output`; `--download` implies follow redirects.

### huggingface_hub 2.2.0 `http_get`
- Install: `SCR/venv/bin/pip install huggingface_hub` (uses httpx2 2.13.1, HTTP/1.1; h2 not installed).
- Resume: `SCR/venv/bin/python -I SCR/drv_hf.py "$U" out.txt`. The driver: `with open(path,"ab") as f: http_get(url, f, resume_size=os.path.getsize(path))` (no expected_size). Fresh: delete out.txt (the driver opens "ab"; resume_size 0 sends no Range). 1 request.
- Status: driver prints `RESULT ok` or `RESULT exc <Type> <msg>` and exits 0/1. Messages: `OSError Consistency check failed: file should be of size 1000 but has size 1400 (...)`; `HfHubHTTPError Client error '416 Range Not Satisfiable' for url ...`; `ValueError invalid literal for int() with base 10: '*'`.
- Source (huggingface_hub/file_download.py): `http_get` ~l.334: header `Range: bytes=<resume_size>-` via `_adjust_range_header`; ~l.405 if resume_size > 0 and status 200: seek back, truncate, resume_size = 0 (restart). `_get_file_length_from_http_response` ~l.297: total = int(Content-Range after "/") else Content-Length. After streaming, `expected_size != new_resume_size` raises OSError (post-write).
- 200: restart (200-content-range leaves 600 bytes then raises). 416: `hf_raise_for_status` raises, file untouched. Other first-byte: NOT checked; appended, then raises when sizes differ. No Content-Range: total from Content-Length (600), mismatch raises after write. Wrong total: raises after write (bytes correct). `/*`: ValueError before writing. Later 416 total: not compared. If-Range/validators: none. Content-Length vs Content-Range: Content-Range total wins; Content-Length only as fallback.
- Hazards: private-ish API, signature may change; retries 408/429 with backoff (`http_stream_backoff`); writes before it raises. No hash header needed in http_get.

### yt-dlp 2026.8.19 (`--continue`, HttpFD)
- Install: `SCR/venv/bin/pip install yt-dlp`.
- Resume: partial must be named `out.txt.part`. `SCR/venv/bin/yt-dlp --continue --retries 0 --fragment-retries 0 --no-progress --no-warnings --no-cache-dir --ignore-config -o out.txt "$U"`. Fresh: no `.part` file. 2 requests. The generic extractor accepts a text/plain direct URL: first a plain GET (no Range) of the whole document as "webpage" with a Mozilla user agent, then HttpFD's GET. On success the file appears as out.txt; on failure the bytes stay in out.txt.part. Driving HttpFD programmatically: not done; CLI is enough.
- Status: exit 0/1. Messages: `[download] Resuming download at byte 400`, `[download] Unable to resume`, `ERROR: unable to download video data: HTTP Error 416: Range Not Satisfiable`.
- Source (yt_dlp/downloader/http.py `HttpFD.real_download`/`establish_connection`): resume_len = size of tmpfilename (the .part). Range `bytes=<resume_len>-`. If `range_start == Content-Range start` (and, in chunked mode, end checks) resume continues; otherwise (including no Content-Range, a plain 200, or other start) it sets resume_len = 0, open_mode 'wb' and takes the whole body ("Unable to resume"). 416 branch: re-request "without Range" (the headers dict is shared, so the retry still carried the Range: 3 requests observed); if Content-Length within 100 bytes of local size it marks "already downloaded", else restarts. After download `byte_counter != data_len` raises ContentTooShortError.
- 200: wipe and restart. 416: error exit 1. Other first-byte: wipe and take body (from-zero ends correct). No Content-Range: body taken as whole file (600 bytes). Wrong total/`/*`: not checked. Later 416 total: not compared. If-Range: none. Content-Length vs Content-Range: Content-Length+resume_len vs bytes counted only (off-by-one passes: 599+400=999 counted).
- Hazard: a harness reading out.txt after a failure finds nothing; read out.txt.part.

### node-downloader-helper 2.1.11 (`resumeIfFileExists`)
- Install: `cd SCR/npm && npm i node-downloader-helper` (Node v26.10.0).
- Resume: `node SCR/drv_ndh.cjs "$U" .` with options `{fileName:'out.txt', resumeIfFileExists:true, override:true, removeOnFail:false, removeOnStop:false, resumeOnIncomplete:false, retry:false}`. Fresh: delete out.txt (then no HEAD-triggered resume). 2 requests: HEAD, then GET (no GET when the file already equals the HEAD length).
- Status: driver prints `RESULT end {totalSize,incomplete,onDiskSize,downloadedSize}` (exit 0) or `RESULT error Response status was 416` (exit 1).
- Source (dist/index.js, minified; cite by method): `start` -> `getTotalSize` (HEAD; error on status < 200 or >= 400) -> `resumeFromFile` sets `range = bytes=<size>-`. `__downloadRequest`: if resumed and status 200 -> reset (`__isResumed=false`, total reset). `__startDownload`: createWriteStream with flags 'a' when resumed else default (truncate). `__onFinished`: `incomplete = total && downloaded !== total`; with `resumeOnIncomplete` (default true) it re-issues Range requests up to 5 times. `__onError` -> `__removeFile` when `removeOnFail` (default true).
- 200: restart (truncate). 416: error. Other first-byte: appended, never reads Content-Range (from-zero gives 1400 with incomplete:true). No Content-Range: appended. Wrong total/`/*`: ignored; total comes from the HEAD Content-Length. Later 416 total: not compared. If-Range/validators: none. Content-Length vs Content-Range: no; flags `incomplete` against the HEAD length.
- Hazards: removeOnFail default deletes the partial on any error; resumeOnIncomplete default adds requests; ignores http_proxy (Node 26 `NODE_USE_ENV_PROXY=1` untested).

### nugget 2.2.0 (`-c`) — optional extra
- Install: `cd SCR/npm && npm i nugget` (uses deprecated `request`; last published 2022).
- Resume: `node SCR/npm/node_modules/nugget/bin.js -q -c -o out.txt -d . "$U"`. Fresh: no out.txt. 2 requests (plain GET, body cut after headers; then Range GET).
- Status: exit 0 / 1, stderr `Error: GET <url> returned 416`.
- Source (index.js): `resume()` ~l.141: GET for Content-Length and Accept-Ranges; if length == size done; if Accept-Ranges has `bytes` and length > size sets `range=[size, length]` -> header `bytes=400-1000` (end one past the last byte). `download()` ~l.188: any status <= 299 accepted; `fs.createWriteStream(target, {flags: 'a'})` whenever `-c` is set, even when no Range was sent. Content-Range only read for progress.
- 200: appended in full (ignore, advertise-only give 1400). 416: error. Other first-byte / no Content-Range / wrong total: appended unchecked. If-Range: none. Content-Length vs Content-Range: no.

### grab v3.0.1
- Install: `cd SCR/go && go get github.com/cavaliergopher/grab/v3 && go build -o SCR/gotool .` (Go 1.27.0; source SCR/go/main.go).
- Resume: `GODEBUG=http2client=0 SCR/gotool grab "$U" out.txt`. Fresh: delete out.txt. 2 requests: HEAD then GET.
- Status: exit 0/1; driver prints `RESULT grab err=<...> didResume= canResume= status= size= bytesComplete=`. 416: `err=server returned 416 Requested Range Not Satisfiable`.
- Source (client.go): `validateLocal` ~l.237: sizes from HEAD; if equal -> done, no GET; if remote smaller -> ErrBadLength; if CanResume sets `Range: bytes=<size>-`. CanResume is set in `readResponse` only when the HEAD response has `Accept-Ranges: bytes`. `getRequest` ~l.373: `// TODO: check Content-Range`; only 2xx checked. `openWriter`: O_APPEND when DidResume. `readResponse`: size = ContentLength + bytesResumed.
- 200 with its Range: appended (advertise-only 1400). No Accept-Ranges on HEAD (ignore): no Range sent, file truncated and rewritten. 416: error. Other first-byte / no Content-Range / wrong total: appended unchecked. If-Range: none. Content-Length vs Content-Range: no.
- Hazards: Go uses HTTP/2 over TLS unless GODEBUG=http2client=0; user agent `grab`.

### go-getter v1.8.10
- Install: `cd SCR/go && go get github.com/hashicorp/go-getter && go build -o SCR/gotool .`.
- Resume: `GODEBUG=http2client=0 SCR/gotool getter "$U" out.txt`. The driver registers BOTH `http` and `https` getters in `getter.Client{Mode: ClientModeFile}`; with only `http` it fails `download not supported for scheme 'https'` without a request. Fresh: delete out.txt. 2 requests: HEAD then GET.
- Status: exit 0/1; `RESULT getter err=bad response code: 416`.
- Source (get_http.go `HttpGetter.GetFile`, ~l.375-510): HEAD first; only if HEAD is 200 with `Accept-Ranges: bytes` and ContentLength > 0 does it stat the file and, if size < length, send `Range: bytes=<size>-`; if size >= length returns with no GET. Accepts only 200 and 206. File opened `O_RDWR|O_CREATE` (no truncate), seek-to-end only on the range path; `Copy`; `n < resp.ContentLength` -> ErrShortWrite.
- 200 on the range path: appended. HEAD without Accept-Ranges (ignore): no Range, writes from offset 0 without truncating (a longer stale file keeps its tail; source-read, untested). 416: error. Other first-byte / no Content-Range / wrong total: unchecked. If-Range: none. Content-Length vs Content-Range: no.

## 3. Not in the roster (and why)
- axel 2.17.14 (`brew install axel`): resumes only with its own `.st` file (uint16 connections, off_t bytes_done, then off_t current and last byte per connection; forger SCR/forge_axel.py). With one it resumes correctly on ok (`Range: bytes=400-999`), but on off-by-one and always-416 it retried unboundedly: about 115 requests in 12 s. First request `Range: bytes=0-`, speaks HTTP/1.0. Would trip the 100 per 10 s zone limit. Excluded; not run live.
- pySmartDL 1.3.4: deletes the existing destination and downloads again (4 requests: GET, `Range: bytes=0-3`, GET, `Range: bytes=0-999`). Never sends `bytes=400-`.
- ipull 4.0.3: restarts (`Range: bytes=0-999`), no bare-partial resume.
- nodejs-file-downloader 4.13.0: no Range/resume code. got 16.0.0: no resume (no Range code in dist/source); no got-based helper found on npm search.
- pip 26.2.1: resume exists (`pip/_internal/network/download.py` `_attempt_resumes_or_redownloads`, `_http_get_resume`: Range + If-Range from ETag/Last-Modified, Content-Range start check) but only in-process after a dropped connection; it cannot be given an existing partial. Not run.
- uv, rclone: not installed (brew has uv 0.13.0, rclone 1.75.2); not tested; no claim.
- requests, httpx, undici, net/http: caller-typed Range only, per the brief.

## 4. The aria2 situation
- aria2 resumes only at 16 KiB block granularity and only with its `.aria2` control file. With a bare partial and no control file it sends no Range, downloads from byte 0 and overwrites (tested at 1000 bytes: one plain GET with no Range, file rewritten correct, no resume). The control file records per-piece block bitfields; a 1000-byte document is one block, so "400 bytes done" cannot be expressed. DefaultBtProgressInfoFile.cc `save`/`load` is the format.
- Needed: a document of at least 2 blocks, i.e. length > 16384, with the partial a multiple of 16384 bytes (the forger supports up to 8 blocks, total up to 1048576 = the /range cap). I used length=65536, partial 32768, which worked locally and live (ok and ignore).
- Recommendation: keep aria2, for aria2 alone, as a separate row set labelled with its own length (65536) and partial (32768) and a note that the control file is part of the client's own resume state. Reason: it is the only client that validates the response range against the segment it asked for (start, end, entity length) and is the strictest reading of RFC 9110 §14 in the roster; dropping it loses the strict reference. Everything the flavors do is length-independent (the document is self-describing at any length). Also: aria2 segmentation cannot trigger on /range: `--min-split-size` minimum is 1 MiB and a file is split only if at least 2x that; with `-s16 -x16 -k1M` on a 1 MiB document it sent one GET with no Range. So advertise-only does not make aria2 split.

## 5. Library questions
- Python library checking 206 self-consistency: among those read, only HTTPie's `httpie.downloads.parse_content_range` (syntax, last >= first, instance_length > last, first == requested, last+1 == instance_length); it does not compare the body length to the span. yt-dlp and pip compare only the start byte; wget the start byte; huggingface_hub compares totals after writing. pooch, aiohttp helpers and other Python libraries were not surveyed.
- Strict RFC 9110 §14 placement at the Content-Range position: none. aria2 is closest (requires Content-Range to equal its own request, writes at its own offset). axel writes positionally from its own state but did not validate. All others append (curl, wget, wget2, HTTPie, yt-dlp validating at most the start byte; grab, go-getter, ndh, nugget and wget2 not at all).

## 6. Recommended roster (9)
- Shell CLIs: curl 8.7.1; wget 1.25.0; wget2 2.3.0.
- Python (SCR/venv): HTTPie 3.2.4; huggingface_hub 2.2.0 `http_get`; yt-dlp 2026.8.19.
- Go + Node: grab v3.0.1; go-getter v1.8.10; node-downloader-helper 2.1.11.
- Optional extras: aria2 1.37.0 (own length, section 4); nugget 2.2.0.

## 7. Hazards
1. wget needs `-t 1`, wget2 `-t 1`, aria2 `--max-tries=1`, yt-dlp `--retries 0`, ndh `retry:false` and `resumeOnIncomplete:false`; otherwise bad flavors multiply requests (wget default 20 tries with backoff).
2. Killing a wrapper does not kill wget/axel children; orphaned wget retries polluted my first logs. Kill process groups.
3. Exit codes are not outcomes. curl/wget/wget2 can exit 0 on a wrong or unchanged file (416, appended garbage). Record file size and hash.
4. Fresh-download rows: a 0-byte file still makes wget2, ndh, nugget send `bytes=0-`. Delete the file.
5. HTTP/1.1: curl `--http1.1`, wget2 `--no-http2`, Go `GODEBUG=http2client=0`; wget, HTTPie, hf (no h2 installed), yt-dlp, ndh, nugget are 1.1 already.
6. File naming: yt-dlp uses `out.txt.part`; wget2 without `-O` writes `name.1` on a 200; aria2 leaves `.aria2`; ndh `fileName`; nugget `-o -d`.
7. Data loss: ndh deletes the partial on error unless `removeOnFail:false`; hf writes before it raises.
8. HTTPie POSTs non-tty stdin unless `--ignore-stdin`.
9. go-getter needs both http and https getters registered; its no-Accept-Ranges path overwrites without truncating.
10. yt-dlp sends an extra no-Range GET of the whole document first, with a browser-like user agent; its 416 retry still carries Range.
11. HEAD-first clients (ndh, grab, go-getter) depend on /range answering HEAD with Content-Length and Accept-Ranges as the flavor does; grab/go-getter send no Range at all if HEAD lacks `Accept-Ranges: bytes` (ignore) and always-206's HEAD is a 206.
12. Rate limit: per-run requests are curl 1, wget 1, wget2 1, HTTPie 1, hf 1, yt-dlp 2, ndh 2, nugget 2, grab 2, go-getter 2, aria2 2.
13. brew side effect: installing wget2 upgraded libgcrypt and gnupg.
14. hf `http_get` is a private-ish API and retries 408/429; a Cloudflare 429 will be retried and counted as extra requests.

## 8. Files for offline dry runs (all under SCR)
- server.mjs: local stand-in, `node SCR/server.mjs PORT LOGFILE` (imports <repo>/src/range.js read-only, logs every request as NDJSON; port 8787 used for tests). Needs `export PATH="/opt/homebrew/bin:$PATH"`.
- try.sh: `LEN=1000 PART=400 SCR/try.sh CLIENT http://127.0.0.1:8787 FLAVOR`, with CLIENT in curl wget wget2 aria2 axel httpie hf ytdlp ndh nugget grab getter pysmartdl; grid.sh OUT CLIENT... runs all 14 flavors; summ.py summarizes; live.sh is the live wrapper I used.
- Drivers: drv_hf.py, drv_ndh.cjs, drv_pysmartdl.py, drv_ipull.mjs, go/main.go (binary gotool), forge_aria2.py, forge_axel.py, mkdoc.mjs (writes truth-LEN.txt and partial-LEN-PART.txt from docSlice).
- Results: grid-shell.txt, grid-wget.txt, grid-ytdlp.txt, grid-hf.txt, grid-go.txt, grid-node.txt, grid-aria2.txt, grid-full.txt (complete-file partial), grid-fresh.txt (0-byte file); source copies in src/.

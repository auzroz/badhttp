# Survey of HTTP caches and conditional-request clients for the `/etag` witness family (2026-10-12, session 32)

Written by a survey agent (source reading delegated to sonnet agents, every quoted line re-checked against the file it cites) against a local stand-in that imports `src/etag.js` and `src/conditional.js` read-only, plus 20 live requests; this is the source every gated explanation about the `/etag` clients on the site cites. Paths to the scratch directory are elided. Client versions and the source files and functions read are named per client. The roster it recommended is the one captured in `docs/probe-etag-clients-2026-10-12.jsonl`.

# Cache and conditional-client survey for the /etag witness family

Date 2026-10-12 UTC. No tracked file edited besides this one.

Method: (a) read each client's source (installed code for Python, Node, Go and Ruby; upstream release source for curl 8.7.1, wget 1.25.0, nginx 1.31.6, Varnish 9.1.0, Squid 7.7 and Apache Traffic Server 10.2.0, read and never built); (b) ran every candidate against a local stand-in that imports the repository's own `src/etag.js` and `src/conditional.js` at HEAD, with a fresh store, three sequential GETs of one flavor URL, all ten flavors, two complete passes, logging every request the origin received with its conditional headers; (c) sent 20 live requests to the production site (a cold GET and the textbook validation request, for each of the ten flavors, one second apart): all 20 outcomes (status, ETag, Last-Modified, Cache-Control and body length) equaled the stand-in's, including the 304 that carries `"e-badhttp-2"` for `mismatch`, the bare 304 for `no-validator-304`, and the new tag per response for `changing`. The two passes agreed on every cell apart from random ETags and own-clock dates, and apart from one timing-dependent cell (hishel `changing`, section 5).

Scenario: for each (client, flavor), a fresh cache and three GETs of `/etag/<flavor>` in a row, 300 ms apart, the caller reading each body to its end. The harness never sends a conditional header itself. Every flavor answers `cache-control: no-cache, no-transform`, which RFC 9111 says a cache may store but must not reuse without a successful validation.

## 1. Dry-run request table

Cell = what went to the origin on fetch 1 | fetch 2 | fetch 3. `-` one request with no conditional header, `0` no request at all, `i` a request with If-None-Match, `m` with If-Modified-Since, `im` with both, `+` joins two requests inside one fetch. A request that only added a Cache-Control header counts as `-`. For `curl --etag` the `i` on fetch 1 is `If-None-Match: ""`, which curl sends when its tag file is missing or empty; the later `i` cells for flavors without an ETag are the same empty value. What the caller received is in the text below the tables.

Roster (fourteen):

```
client            ok          weak        changing    ignore      always-304  mismatch    no-val-304  unquoted    bad-date    future      
hishel            -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im+-|im+- -|im|im     -|im|im     -|m|m       -|m|m       
requests-cache cc -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|m|m       -|m|m       
CacheControl      -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|-|-       -|-|-       
undici            -|im|-      -|im|-      -|im|im     -|im|im     -|-|-       -|im|-      -|im|-      -|m|-       -|m|m       -|-|-       
make-fetch-happen -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|m|m       -|m|m       
got               -|im|im     -|im|im     -|i|i       -|im|im     -|i|i       -|im|-      -|im|-      -|im|im     -|m|m       -|m|m       
httpcache (Go)    -|im|im     -|im|im     -|i|i       -|im|im     -|i|i       -|im|im     -|im|im     -|im|im     -|m|m       -|m|m       
curl --etag       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       i|i|i       
curl -z           -|m|m       -|m|m       -|m|m       -|m|m       -|-|-       -|m|m       -|m|m       -|m|m       -|m|m       -|m|m       
wget -N           -|m|m       -|m|m       -|m|m       -|m|m       -|-|-       -|m|m       -|m|m       -|m|m       -|m|m       -|m|m       
nginx             -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|-|-       -|m|m       
Varnish           -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       
Squid             -|im|im     -|m|m       -|im|im     -|im|im     -|-|-       -|im|im     -|im|im     -|m|m       -|m|m       -|m|m       
ATS               -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|m      -|im|im     -|-|-       -|m|m       
```

Measured and not in the roster:

```
client            ok          weak        changing    ignore      always-304  mismatch    no-val-304  unquoted    bad-date    future      
requests-cache    -|0|0       -|0|0       -|0|0       -|0|0       -|-|-       -|0|0       -|0|0       -|0|0       -|0|0       -|0|0       
hishel (requests) -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im+-|im+- -|im|im     -|im|im     -|m|m       -|m|m       
aiohttp-cache     -|0|0       -|0|0       -|0|0       -|0|0       -|-|-       -|0|0       -|0|0       -|0|0       -|0|0       -|0|0       
aiohttp-cache cc  -|0|0       -|0|0       -|0|0       -|0|0       -|-|-       -|0|0       -|0|0       -|0|0       -|0|0       -|0|0       
undici (fetch)    -|im|-      -|im|-      -|im|im     -|im|im     -|-|-       -|im|-      -|im|-      -|m|-       -|m|m       -|-|-       
axios-cache       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       
bartventer/hc     -|im|im     -|im|im     -|i|i       -|im|im     -|i|i       -|im|im     -|im|im     -|im|im     -|m|m       -|m|m       
faraday-cache     -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|m|m       -|m|m       
curl -R -z        -|m|m       -|m|m       -|m|m       -|m|m       -|-|-       -|m|m       -|m|m       -|m|m       -|m|m       -|m|m       
ATS default       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       -|-|-       
Varnish keep-VCL  -|im|im     -|im|im     -|i|i       -|im|im     -|-|-       -|im|im     -|im|im     -|im|im     -|-|-       -|-|-       
```

What the caller received, where it is not "200 with the document on all three fetches":
- `always-304` (a 304 to a request that carried no conditional header): every client except Varnish handed its caller the 304 (status 304 and no body) on all three fetches, or for wget no file and exit status 8 on all three fetches. Varnish handed its caller a 503 with a 280-byte HTML body each time. httpcache (Go), bartventer/httpcache and got stored that first 304, sent If-None-Match with the tag it carried on fetches 2 and 3, and handed the caller the stored 304 again.
- `curl --etag`: the caller saw status 304 on fetch 2 (file kept) for ok, weak, mismatch, no-validator-304 and unquoted, and a full 200 on fetch 3 because the 304 leaves its tag file empty.
- `curl -z` and `wget -N`: curl printed status 304 on fetches 2 and 3 for every flavor that has Last-Modified (ok, weak, ignore, mismatch, no-validator-304, unquoted, bad-date) with the file untouched; wget exits 0 with the file untouched; both discarded the 200 the origin sent for `ignore` (and curl for `bad-date`).
- `requests-cache`, `aiohttp-client-cache` (defaults and `cache_control=True`): fetches 2 and 3 are answered from the store with no request.

## 2. Roster, with install, invocation, source behavior

Common: every client was driven from a driver script that creates a new empty store (database file, cache directory, in-memory map or temp directory, whichever the client uses) per (client, flavor), reads each body to its end, waits 300 ms and fetches again. "Cold" is fetch 1, "warm" fetch 2, "warm-again" fetch 3. All requests were plain HTTP/1.1 to an origin on the loopback interface; every client sent its request line unchanged and none refused plain http. Proxy environment variables must be unset for make-fetch-happen, requests-based clients, curl and wget (section 5).

For every client: **Store** = does it keep a response that carries `Cache-Control: no-cache`; **Send** = what it sends to validate and how the value is built; **304** = what it does with a 304 to its conditional request, including a 304 whose ETag differs and a 304 that carries no validators; **Cold 304** = what it does with a 304 to a request that carried no conditional header; **200** = what it does with a 200 answer to its conditional request.

### hishel 1.4.0 (`hishel.httpx.SyncCacheClient`, `SyncSqliteStorage`)
- Install: `pip install hishel==1.4.0` (httpx 0.28.1, httpcore 1.0.9). Python 3.14.7.
- Invocation: `SyncCacheClient(storage=SyncSqliteStorage(database_path=<fresh file>)).get(url)`, body read. Default policy (`SpecificationPolicy`, shared cache). The `hishel.requests` adapter (`CacheAdapter`) builds the same `SyncCacheProxy` and measured identically on the wire; it does not set `from_cache` on the `requests` response.
- Store: yes. `no-cache` is not tested on the storage side; a 200 qualifies because 200 is in the heuristically cacheable list. All nine 200-answering flavors are stored, with or without validators. A 304 (and 206) is never stored.
- Send: every stored response whose `Cache-Control` has an unqualified `no-cache` is routed to revalidation, never served directly. Both validators are copied verbatim from the stored headers, no parsing, no re-quoting, no clock: `W/` kept, the bare ETag sent bare, the ISO-8601 Last-Modified echoed, the future date echoed. Both are sent when both are stored. Nothing else is added.
- 304: the caller gets the stored 200 and body. A 304 is matched against the stored entry by its own validators: a strong 304 ETag must equal the stored tag (stored `W/` ignored). A 304 with a different ETag (`mismatch`) matches nothing, so hishel deletes the entry and sends a second, unconditional request inside the same fetch (observed on fetches 2 and 3: If-None-Match then plain GET). It does not adopt the new tag. A 304 without validators refreshes the single stored entry and leaves the stored ETag and Last-Modified in place.
- Cold 304: not stored; the caller receives the 304; later fetches are unconditional.
- 200: the new response is appended as a new entry; one older entry is removed. See section 5 for what that does to `changing`.
- `hishel/_core/_spec.py`, IdleClient.next: `has_no_cache = response_cc.no_cache is True`
- `hishel/_core/_spec.py`, IdleClient.next: `if not has_no_cache and vary_ok and fresh_or_stale_ok and not request_forces_revalidation:`
- `hishel/_core/_spec.py`, make_conditional_request: `precondition_headers["If-None-Match"] = etag`
- `hishel/_core/_spec.py`, make_conditional_request: `precondition_headers["If-Modified-Since"] = last_modified`
- `hishel/_core/_spec.py`, CacheMiss.next: `if response.status_code in (206, 304):`
- `hishel/_core/_spec.py`, NeedRevalidation.freshening_stored_responses: `if "etag" in revalidation_response.headers and (not revalidation_response.headers["etag"].startswith("W/")):`
- `hishel/_core/_spec.py`, IdleClient.next: `need_revalidation.sort(key=_date_key, reverse=True)`

### requests-cache 1.3.3 (`CachedSession`, `cache_control=True`)
- Install: `pip install requests-cache==1.3.3` (requests 2.34.2, urllib3 2.8.0, cattrs 26.2.1).
- Invocation: `CachedSession(<fresh path>, backend="sqlite", cache_control=True).get(url)`. With the default (`cache_control=False`, `expire_after=-1`) the response is stored and every later fetch is answered from the store with no request at all, on every flavor (measured, in the extra table).
- Store: yes; the response `Cache-Control` is read only with `cache_control=True`, where `no-cache` blocks nothing. Only status 200 is stored.
- Send: with `cache_control=True` a stored response whose headers contain `no-cache` is revalidated: `If-None-Match` and `If-Modified-Since` are the stored header values verbatim (weak, bare, ISO and future values all echoed); both when both exist.
- 304: the caller gets the stored 200 and body. Every header the 304 carries overwrites the stored one, whatever its value: the `mismatch` tag is adopted (fetch 3 sent `"e-badhttp-2"`); a 304 without validators leaves the stored ETag and Last-Modified in place. The entry is found by URL only.
- Cold 304: 304 is not an allowed status, nothing is stored; the caller gets the 304; later fetches are unconditional.
- 200: replaces the entry under the same key; the next request carries the new validators.
- `requests_cache/policy/actions.py`, CacheActions._update_validation_headers: `if revalidate or cc_revalidate:`
- `requests_cache/policy/actions.py`, CacheActions._update_validation_headers: `self._validation_headers['If-None-Match'] = directives.etag`
- `requests_cache/policy/actions.py`, CacheActions._update_validation_headers: `self._validation_headers['If-Modified-Since'] = directives.last_modified`
- `requests_cache/policy/actions.py`, CacheActions.update_revalidated_response: `cached_response.headers.update(response.headers)`

### CacheControl 0.14.4 (`CacheControl(requests.Session())`, `FileCache`)
- Install: `pip install 'cachecontrol[filecache]==0.14.4'` (the library pip vendors; filelock 4.1.1).
- Invocation: `CacheControl(requests.Session(), cache=FileCache(<fresh dir>)).get(url)`.
- Store: only a response that has an ETag (or a `max-age` or `Expires`); the other flavors' 200s carry none of the latter. So `bad-date` and `future` (no ETag) are never stored and never revalidated: three unconditional requests. A stored response is always treated as stale (freshness lifetime 0) and revalidated; the response `no-cache` itself is not read on this path.
- Send: `If-None-Match` is the stored ETag verbatim and `If-Modified-Since` the stored Last-Modified verbatim, both when both exist.
- 304: the stored response is returned with status 200; every header the 304 carries overwrites the stored one (the `mismatch` tag is adopted: fetch 3 sent `"e-badhttp-2"`); a 304 without validators leaves the stored ones. Entry found by URL only.
- Cold 304: nothing stored, the caller gets the 304.
- 200: replaces the entry (the ETag is present).
- `cachecontrol/controller.py`, CacheController.cache_response: `if self.cache_etags and "etag" in response_headers:`
- `cachecontrol/controller.py`, CacheController.conditional_headers: `new_headers["If-None-Match"] = headers["ETag"]`
- `cachecontrol/controller.py`, CacheController.conditional_headers: `new_headers["If-Modified-Since"] = headers["Last-Modified"]`
- `cachecontrol/controller.py`, CacheController.update_cached_response: `cached_response.status = 200`

### undici 8.11.2 (`new Agent().compose(interceptors.cache())`)
- Install: `npm install undici@8.11.2`. Node 26.10. `fetch` and `request` measured identical on the wire.
- Invocation: `undici.request(url, { dispatcher })`, body read; in-memory `MemoryCacheStore`.
- Store: yes when the response has a validator it can use; a past Last-Modified gives a heuristic lifetime of 10 percent of its age, a response with `no-cache` and a usable validator is kept as revalidate-only. A future Last-Modified makes the freshness calculation return early and nothing is stored (`future`). A bare ETag (`unquoted`) is not kept as an ETag (only quoted and weak tags are usable) but the Last-Modified is. A 304 to a cold request is not stored.
- Send: every use of a stored `no-cache` entry is revalidated. `If-Modified-Since` is always sent: the stored Last-Modified verbatim when it parses as an HTTP-date, otherwise the time the entry was cached (the origin's `Date` of the response) formatted by undici (`bad-date`: `Mon, 12 Oct 2026 ...`, the second of the previous response; `changing`: the same). `If-None-Match` only when a usable ETag was stored, verbatim with `W/` kept; so `unquoted` sent If-Modified-Since only.
- 304: the caller gets the stored 200. The 304 is consumed by the revalidation handler and never reaches the store. This server's 304 always carries a `Cache-Control` header, and when a successful revalidation's 304 carries one the interceptor deletes the stored entry after serving it. Fetch 3 is therefore a cold unconditional request for ok, weak, mismatch, no-validator-304 and unquoted (then stored again), and the validators in the 304 (a different or missing ETag) never matter.
- Cold 304: passed to the caller; not stored.
- 200: stored like a first response and replaces the entry (the next request carries the new ETag).
- `undici/lib/interceptor/cache.js`, needsRevalidation: `if (result.cacheControlDirectives?.['no-cache'] && !Array.isArray(result.cacheControlDirectives['no-cache'])) {`
- `undici/lib/interceptor/cache.js`, makeRevalidationHeaders: `'if-modified-since': getUsableLastModified(result.headers) ?? new Date(result.cachedAt).toUTCString()`
- `undici/lib/interceptor/cache.js`, makeRevalidationHeaders: `headers['if-none-match'] = result.etag`
- `undici/lib/interceptor/cache.js`, revalidationResponseUpdatesCacheControl: `headers['cache-control'] !== undefined`
- `undici/lib/handler/cache-handler.js`, determineStaleAt: `if (lastModified.getTime() >= now) {`
- `undici/lib/handler/cache-handler.js`, determineStaleAt: `return responseAge * 0.1`

### make-fetch-happen 16.0.1 (npm's fetch, with http-cache-semantics 4.3.0)
- Install: `npm install make-fetch-happen@16.0.1` (cacache 21.0.1, http-cache-semantics 4.3.0).
- Invocation: `require("make-fetch-happen").defaults({ cachePath: <fresh dir>, retry: false })(url)`, body read.
- Store: yes for 200, 301 and 308 when the policy is storable; `no-cache` does not prevent storing. The body is written to the cache when the returned stream is first read. A 304 is never stored. Only these response headers are kept: cache-control, content-encoding, content-language, content-type, date, etag, expires, last-modified, link, location, pragma, vary.
- Send: `no-cache` makes the freshness lifetime 0, so every use is revalidated. `If-None-Match` and `If-Modified-Since` are the stored header strings verbatim (the library never parses the date to send it, and never uses a clock): weak, bare, ISO and future values are echoed; both when both exist.
- 304: any 304 counts as "not modified". The index entry is rewritten from the 304's own headers (a different ETag is adopted: fetch 3 sent `"e-badhttp-2"`), and anything the 304 lacks is filled in from the old entry (so `no-validator-304` keeps the ETag and Last-Modified). The caller gets status 200 and the stored body, with the stored response's headers.
- Cold 304: skipped (not stored); the caller gets the 304.
- 200: stored as an update; the next request carries the new tag.
- `make-fetch-happen/lib/cache/entry.js`, CacheEntry.store: `![200, 301, 308].includes(this.response.status)`
- `http-cache-semantics/index.js`, revalidationHeaders: `: this._resHeaders.etag;`
- `http-cache-semantics/index.js`, revalidationHeaders: `headers['if-modified-since'] = this._resHeaders['last-modified']`
- `http-cache-semantics/index.js`, maxAge: `if (!this.storable() || this._rescc['no-cache']) {`
- `http-cache-semantics/index.js`, revalidatedPolicy: `modified: response.status != 304`

### got 16.0.0 (`cache: new Map()`, cacheable-request 13.0.19, http-cache-semantics 4.3.0)
- Install: `npm install got@16.0.0`.
- Invocation: `got(url, { cache: new Map(), retry: { limit: 0 }, throwHttpErrors: false, responseType: "buffer" })`.
- Store: yes when the policy is storable; `no-cache` does not prevent it. The write happens after the response is delivered and is not awaited.
- Send: same `revalidationHeaders` as make-fetch-happen: both validators verbatim from the stored response, both when both exist.
- 304: the caller gets the stored body with the stored status. What is stored next depends on whether the 304 matches the stored response: a strong ETag equal to the stored one, or an equal Last-Modified, matches and refreshes the entry. A 304 whose ETag differs (`mismatch`) or that carries no validators while the stored response has a Last-Modified (`no-validator-304`) does not match: the new policy is built from the 304 itself, is not storable, and the stored entry is deleted. Fetch 3 is then an unconditional GET.
- Cold 304: the library defaults the status of a response without a `status` property to 200, so a cold 304 is storable and is stored with status 304. Fetches 2 and 3 send `If-None-Match: "e-badhttp-1"` (the tag the 304 carried), get a 304, and hand the caller a 304 again.
- 200: replaces the entry.
- `cacheable-request/dist/index.js`, CacheableRequest.createCacheableRequest: `response.cachePolicy = new CachePolicy(options_, response, options_);`
- `http-cache-semantics/index.js`, CachePolicy.constructor: `this._status = 'status' in res ? res.status : 200;`
- `cacheable-request/dist/index.js`, CacheableRequest.createCacheableRequest: `await this.cache.delete(key)`

### httpcache (Go), `github.com/gregjones/httpcache` (pseudo-version 20190611-901d90724c79)
- Install: `go get github.com/gregjones/httpcache@901d90724c79`; Go 1.27.
- Invocation: `http.Client{Transport: httpcache.NewMemoryCacheTransport()}`, body read to EOF.
- Store: the only test is that neither side said `no-store`; there is no status, validator or freshness test, so a 304 is stored like any response. For GET the response is written to the cache when the caller reads its body to EOF; a body that is not read stores nothing.
- Send: a stored response with `no-cache` is stale; `If-None-Match` and `If-Modified-Since` are the stored header strings verbatim; both when both exist. A caller-supplied conditional header is overwritten.
- 304: the stored response is returned with the stored status (200) and body; every end-to-end header present in the 304 replaces the stored header of that name (the `mismatch` tag is adopted: fetch 3 sent `"e-badhttp-2"`); a 304 with no validators leaves the stored ones. Entry found by URL only (key = the URL string, port included).
- Cold 304: stored (status 304, with the ETag it carried). Fetches 2 and 3 send `If-None-Match: "e-badhttp-1"`, receive a 304, and the caller is handed the stored 304.
- 200: replaces the entry.
- bartventer/httpcache v0.14.0 (measured, not in the roster) has the same wire in all ten flavors; it stores synchronously, folds a default port out of the key and adds `X-Httpcache-Status` to every result.
- `github.com/gregjones/httpcache/httpcache.go`, canStore: `if _, ok := respCacheControl["no-store"]; ok {`
- `github.com/gregjones/httpcache/httpcache.go`, Transport.RoundTrip: `req2.Header.Set("if-none-match", etag)`
- `github.com/gregjones/httpcache/httpcache.go`, Transport.RoundTrip: `req2.Header.Set("if-modified-since", lastModified)`
- `github.com/gregjones/httpcache/httpcache.go`, Transport.RoundTrip: `cachedResp.Header[header] = resp.Header[header]`
- `github.com/bartventer/httpcache/internal/cacheabilityevaluator.go`, canStoreResponse: `isHeuristicallyCacheableCode(resp.StatusCode)`
- `github.com/bartventer/httpcache/helpers.go`, withConditionalHeaders: `req2.Header.Set("If-None-Match", etag)`

### curl 8.7.1 `--etag-compare` with `--etag-save` (one file)
- Install: the macOS system curl (SecureTransport), nothing to install.
- Invocation: `curl --http1.1 -sS --etag-compare etag.txt --etag-save etag.txt -o body.txt -w '%{http_code}' URL`, in a directory where neither file exists before fetch 1.
- Store: one file. The save file is opened for writing (truncated) before the transfer starts, and an `ETag:` header line is written to it only for a 2xx response. A 304, any other status and a 2xx without an ETag leave it empty.
- Send: the compare file's content verbatim as `If-None-Match` (weak and bare tags unchanged); if the file is missing or empty the literal header `If-None-Match: ""` is sent, including on fetch 1. `If-Modified-Since` is never sent.
- 304: exit 0, status 304, the body file left as it was. Because the save file was truncated and a 304 writes nothing, the tag file is empty afterwards for every 304, whatever it carried, so fetch 3 sends `""`, gets a 200, and saves the tag again: 200, 304, 200 for ok, weak, mismatch, no-validator-304 and unquoted. With separate compare and save files the compare file is never updated by curl.
- Cold 304: `If-None-Match: ""` went out; curl exits 0 with status 304; no body file is created.
- 200: the new tag is saved; `ignore` therefore keeps sending the same tag.
- `curl-8.7.1/src/tool_operate.c`, single_transfer: `FILE *newfile = fopen(config->etag_save_file, "wb");`
- `curl-8.7.1/src/tool_operate.c`, single_transfer: `header = aprintf("If-None-Match: \"\"");`
- `curl-8.7.1/src/tool_cb_hdr.c`, tool_header_cb: `/* only care about these headers in 2xx responses */`

### curl 8.7.1 `-z FILE`
- Invocation: `curl --http1.1 -sS -z body.txt -o body.txt -w '%{http_code}' URL`, body.txt absent before fetch 1 (a missing file silently drops the condition). Measured with `-R` in the extra table.
- Send: only `If-Modified-Since`, rebuilt by libcurl from the file's mtime as an RFC 1123 GMT string; it is never a copy of Last-Modified. Without `-R` the mtime is the time curl last wrote the file, so every flavor is validated by the client's own clock. With `-R` the mtime is set from a parseable Last-Modified (ok: `Sat, 01 Aug 2026 ...`; future: the 2027 date, so the server answers 304) and stays the download time when the Last-Modified is the ISO string or absent. No `If-None-Match`.
- 304: exit 0, status 304, file untouched, the same value on the next run.
- 200 to a conditional request: libcurl re-checks the time condition itself and prints status 304 ("Simulate an HTTP 304 response") without writing the body when the Last-Modified is not newer than the condition, or cannot be parsed (`bad-date`, `ignore`).
- Cold 304: no file, no condition; status 304; nothing created.
- `curl-8.7.1/lib/http.c`, Curl_add_timecondition: `"%s: %s, %02d %s %4d %02d:%02d:%02d GMT\r\n"`
- `curl-8.7.1/lib/http.c`, Curl_http_readwrite_headers: `infof(data, "Simulate an HTTP 304 response");`
- `curl-8.7.1/src/tool_getparam.c`, getparameter: `config->condtime = (curl_off_t)curl_getdate(nextarg, &now);`

### GNU wget 1.25.0 `-N`
- Install: `brew install wget`.
- Invocation: `wget -N -q -t 1 URL` in a fresh directory; the file is named after the last path segment. With `-O` timestamping is switched off with a warning and nothing conditional is sent.
- Send: only when the local file exists, `If-Modified-Since` formatted from its mtime as RFC 1123 GMT. After a download wget sets the mtime from Last-Modified when `http_atotm` parses it (four strptime formats; the ISO string fails and the mtime stays the download time). No `If-None-Match` anywhere in wget.
- 304: "not modified", exit 0, file untouched.
- 200 to a conditional request: if the response's Last-Modified parses, is not newer than the local file and the Content-Length equals the local size, wget prints "Server ignored If-Modified-Since", downloads nothing and exits 0 (`ignore`); otherwise it saves the file (`bad-date`, `changing`: a full download on each fetch).
- Cold 304: no condition sent, wget reports "ERROR 304: Not Modified." and exits 8; no file.
- `wget-1.25.0/src/http.c`, gethttp: `request_set_header (req, "If-Modified-Since", xstrdup (strtime), rel_value);`
- `wget-1.25.0/src/http.c`, gethttp: `Server ignored If-Modified-Since header for file %s.`
- `wget-1.25.0/src/main.c`, main: `timestamping does nothing in combination with -O`

### nginx 1.31.6 `proxy_cache`
- Install: `brew install nginx`.
- Configuration (the minimum that stores a `no-cache` response): `proxy_cache_path` and `proxy_cache`, `proxy_cache_revalidate on`, `proxy_cache_valid 200 1s`, and `proxy_ignore_headers Cache-Control`. Without the last line nginx does not store the response at all: the handler for the upstream `Cache-Control` header marks any value containing `no-cache`, `no-store` or `private` uncacheable. There is no other way to store it. The client is plain curl against the proxy.
- Send: an entry is revalidated only when stale. Freshness is whole seconds (the stored expiry is the cached whole-second clock plus 1), so an entry stays a hit for up to about two seconds; a revalidation was observed at 2.1 s and plain hits at 0.3, 1.1 and 1.6 s. When it revalidates, `If-None-Match` is the stored ETag value byte for byte (`W/` and a bare tag unchanged) and `If-Modified-Since` is the stored Last-Modified parsed to a time and printed again as an HTTP-date. A Last-Modified that does not parse (`bad-date`) leaves no `If-Modified-Since`, and with no ETag the revalidation is an unconditional request. A future date is sent as is. Client conditional headers never reach the origin.
- 304: the caller gets the stored 200 and body (`REVALIDATED`). Nothing is taken from the 304's headers: a different ETag or none leaves the stored values (fetch 3 still sent the original tag in both cases).
- Cold 304: passed through with status 304; not stored because no `proxy_cache_valid` rule covers 304.
- 200: replaces the cached file with the new validators.
- `nginx-1.31.6/src/http/ngx_http_upstream.c`, ngx_http_upstream_process_cache_control: `(u_char *) "no-cache", 8 - 1) != NULL`
- `nginx-1.31.6/src/http/modules/ngx_http_proxy_module.c`, ngx_http_proxy_cache_headers: `{ ngx_string("If-None-Match"), ngx_string("$upstream_cache_etag") },`
- `nginx-1.31.6/src/http/ngx_http_file_cache.c`, ngx_http_file_cache_read: `if (c->valid_sec < now) {`
- `nginx-1.31.6/src/http/ngx_http_upstream.c`, ngx_http_upstream_test_next: `u->cache_status = NGX_HTTP_CACHE_REVALIDATED;`

### Varnish Cache 9.1.0, default VCL
- Install: `brew install varnish`. Started with a command-line backend and no VCL file.
- Store: the built-in `vcl_backend_response` treats a `Cache-Control` containing `no-cache`, `no-store` or `private` as uncacheable and creates a two-minute hit-for-miss object. Every request is a miss, goes to the origin, and carries no conditional header (30 of 30 requests in the default run). Such an object is never a template for a conditional request.
- Cold 304: Varnish treats a 304 to a request it did not make conditional as an error and answers the caller 503 "Backend fetch failed" with a `Retry-After: 5` header, every time.
- Measured, not in the roster: a VCL that sets `ttl 1s`, `keep 10m` and returns from `vcl_backend_response` stores and revalidates; the stored `ETag` text is sent verbatim, `If-Modified-Since` only when the stored Last-Modified parses and is at least a second before the stored `Date`, the 304's headers override the stored ones (the `mismatch` tag is adopted), and under the default ten-second grace the conditional fetch happens in the background and the caller sees the previous object.
- `varnish-9.1.0/bin/vinyld/builtin.vcl`, vcl_beresp_control: `beresp.http.Cache-Control ~ "(?i:no-cache|no-store|private)")) {`
- `varnish-9.1.0/bin/vinyld/cache/cache_fetch.c`, vbf_stp_mkbereq: `http_PrintfHeader(bo->bereq0, "If-None-Match: %s", q);`

### Squid 7.7, defaults
- Install: `brew install squid`. A forward proxy (`curl -x`), an ACL for the client, a `ufs` cache directory; no `refresh_pattern` line, so the built-in `. 0 20% 4320` applies.
- Store: yes. A response with `no-cache` and no field list is cacheable ("We MAY cache, and do so"); it is flagged to be revalidated on every use, so fetches 2 and 3 always reach the origin.
- Send: `If-Modified-Since` is always sent, re-formatted from the stored entry's Last-Modified time, and when the response has no usable Last-Modified (`changing`, `bad-date`) from the stored entry's `Date`. `If-None-Match` only for a strong, properly quoted ETag, as stored: `weak` and `unquoted` send If-Modified-Since only. Every request Squid forwards, including the cold one, carries `Cache-Control: max-age=259200`, the largest freshness of the default refresh pattern.
- 304: the caller gets the stored 200. Every header present in the 304 replaces the stored one (the `mismatch` tag is adopted: fetch 3 sent `"e-badhttp-2"`); a 304 with no validators leaves the stored ones.
- Cold 304: sent to the caller unchanged, not stored.
- 200: replaces the entry.
- `squid-7.7/src/http.cc`, HttpStateData::reusableReply: `// NP: response CC:no-cache is equivalent to CC:must-revalidate,max-age=0. We MAY cache, and do so.`
- `squid-7.7/src/client_side_reply.cc`, clientReplyContext::processExpired: `if (old_entry->hasEtag(etag) && !etag.weak)`
- `squid-7.7/src/http.cc`, HttpStateData::httpBuildRequestHeader: `/* append Cache-Control, add max-age if not there already */`

### Apache Traffic Server 10.2.0, `required_headers: 0`
- Install: `brew install trafficserver`. A reverse proxy with a remap rule and a cache directory.
- Configuration: the only cache setting that differs from the shipped default is `proxy.config.http.cache.required_headers: 0`. With the default (2, an explicit lifetime is required) ATS stores nothing for any flavor and forwards every request unconditionally (30 of 30 requests in the default run).
- Store: with 0 the `no-cache` response is stored. `no-cache` is not among the directives that stop storing; a cache hit on an object with `no-cache` is revalidated.
- Send: `If-Modified-Since` is the stored Last-Modified string verbatim, only when it parses (so the ISO value sends nothing); `If-None-Match` is the stored ETag with a leading `W/` removed (the `weak` flavor's tag goes out as a strong-looking quoted tag) and a bare token sent as stored. Both when both qualify. Nothing else is added to the request apart from Via, X-Forwarded-For and Client-ip.
- 304: the caller gets the stored 200. The stored ETag is deleted unless the 304 carries one, so a 304 without validators costs the cached ETag (fetch 3 of `no-validator-304` sent If-Modified-Since only); a different ETag in the 304 replaces the stored one (the `mismatch` tag is adopted: fetch 3 sent `"e-badhttp-2"`); Last-Modified stays unless the 304 carries one.
- Cold 304: passed through to the caller and not stored. The source also adds a `Warning: 199` header to that client response (not looked for on the wire).
- 200: replaces the entry.
- `trafficserver-10.2.0/src/proxy/http/HttpTransact.cc`, HttpTransact::is_response_cacheable: `expires header or max-age is required`
- `trafficserver-10.2.0/src/proxy/http/HttpTransact.cc`, HttpTransact::issue_revalidate: `if (etag.starts_with("W/"sv)) {`
- `trafficserver-10.2.0/src/proxy/http/HttpTransact.cc`, HttpTransact::merge_and_update_headers_for_cache_update: `cached_hdr->field_delete(static_cast<std::string_view>(MIME_FIELD_ETAG));`

## 3. Measured and not in the roster (and why)
The roster is capped at fourteen clients; these were run through the same ten flavors and their wire is in the extra table above.
- requests-cache 1.3.3 with its defaults: stores the response and answers every later fetch from the store with no request; revalidates only with `cache_control=True`, `always_revalidate`, an `expire_after` that has passed, or `refresh=True`.
- aiohttp-client-cache 0.15.0 (defaults and `cache_control=True`): stores every 200 and serves it without a request; it sends `If-None-Match` and `If-Modified-Since` (verbatim stored values) only when the caller passes `refresh=True` on a request; a response `no-cache` is not read, and a 304 to such a refresh returns the stored response with no header update.
- axios-cache-interceptor 1.12.3 with its defaults: sends its own request headers `Cache-Control: no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache` and `Expires: 0` (`cacheTakeover`), and stores nothing from a response that says `no-cache`, so three unconditional requests. With `interpretHeader: false` and `ttl: 0` it revalidates with `If-None-Match` (and `If-Modified-Since` when `modifiedSince` is set) copied verbatim.
- bartventer/httpcache v0.14.0 (Go): wire identical to httpcache (Go) in all ten flavors.
- faraday-http-cache 3.0.0 (Ruby 3.3, `MemoryStore`): both validators verbatim; a 304 updates the stored headers by name (the `mismatch` tag is adopted; a bare 304 keeps the stored validators); a cold 304 is not stored, so `always-304` is three unconditional requests.
- hishel through the `requests` adapter and undici through `fetch`: same wire as the roster entry.
- curl `-R -z`: the mtime comes from Last-Modified when it parses; see the curl `-z` section.
- ATS with default settings and Varnish with the keep-VCL: described in their sections.
- Not run: Chromium and Firefox caches (no browser harness); pip's own downloader (it uses CacheControl, which is in the roster).

## 4. What the caches do with validators: cross-client answers
- **Sends a conditional request on fetch 2 under `no-cache` (ok)**: hishel, requests-cache (`cache_control=True`), CacheControl, undici, make-fetch-happen, got, httpcache (Go), curl `--etag`, curl `-z`, wget `-N`, nginx, Squid, ATS. Not: Varnish (stores nothing). Stores and never asks: requests-cache and aiohttp-client-cache with defaults.
- **Requires a non-default setting to store a `no-cache` response at all**: nginx (`proxy_ignore_headers Cache-Control`), ATS (`required_headers: 0`), Varnish (VCL; not in the roster). Squid, hishel, make-fetch-happen, got, undici (with a validator), httpcache, CacheControl (with an ETag) store it as shipped.
- **If-None-Match built from the stored ETag byte for byte** (weak `W/` kept, a bare token sent bare): hishel, requests-cache, CacheControl, make-fetch-happen, got, httpcache, curl `--etag`, nginx. ATS strips `W/` and sends a bare token as stored. Squid sends it only for a strong quoted tag. undici sends it only for a quoted or weak tag.
- **If-Modified-Since**: verbatim copy of the stored string: hishel, requests-cache, CacheControl, make-fetch-happen, got, httpcache (the ISO value is echoed), ATS (only if it parses). Rebuilt from a parsed time: nginx, Squid. Rebuilt from the local file's mtime: curl `-z`, wget `-N`. Taken from the client's or the response's own clock when there is no usable Last-Modified: undici (the response `Date`), Squid (the stored `Date`), curl `-z` and wget `-N` (download time).
- **304 with a different ETag (`mismatch`), next request**: sends the new tag: requests-cache, CacheControl, make-fetch-happen, httpcache (Go), Squid, ATS. Keeps sending the old tag: nginx. hishel sends the old tag and refetches unconditionally inside the same fetch. undici and got delete the entry, so the next request is unconditional. curl and wget keep no tag from a 304.
- **304 without validators (`no-validator-304`), next request**: stored validators kept by hishel, requests-cache, CacheControl, make-fetch-happen, httpcache, nginx, Squid; ATS keeps Last-Modified and drops the ETag; got and undici delete the entry.
- **304 to an unconditional request (`always-304`)**: stored and revalidated with the tag it carried: httpcache (Go) and got. Passed through: all other clients; Varnish turns it into a 503; wget exits 8.

## 5. Hazards
1. Read every body to its end before the next fetch. httpcache (Go) stores a GET only at EOF; make-fetch-happen writes the body cache when the stream is first read; hishel and CacheControl write when the body stream ends; got's cache write is not awaited, so the 300 ms between fetches matters.
2. Fresh store per (client, flavor): hishel's default database is a file in the current directory; make-fetch-happen's and CacheControl's caches are directories; requests-cache's is a SQLite file; curl and wget use files in the working directory; nginx, Squid and ATS keep cache directories (Squid needs `squid -z`); Varnish needs a new working directory. A leftover store turns fetch 1 into a conditional request.
3. nginx freshness is whole-second: an entry can stay a hit for up to two seconds, so fetches 2 and 3 must be at least 2.1 s after the previous store or nginx answers without asking the origin. Squid, ATS, Varnish and the libraries need no wait.
4. hishel `changing`: after fetch 2's 200 the store holds two entries for the URL, and the one used for fetch 3 is picked by sorting on the `Date` header, which has one-second resolution. When fetches 1 and 2 land in the same second the sort keeps storage order and fetch 3 sends fetch 1's tag again; when the second changed, fetch 3 sends fetch 2's tag. Sleeping at least 1.1 s before each fetch makes fetch 3 send the latest tag (measured three times). All other clients send the previous 200's tag.
5. One fetch can mean two upstream requests (hishel `mismatch`, in fetches 2 and 3).
6. Process lifetime: undici's Agent and make-fetch-happen's agent keep sockets open, so the driver must exit explicitly; Varnish and nginx run a manager and a worker; Squid needs `shutdown_lifetime` set small to stop quickly; ATS must be stopped by its run root.
7. Proxy environment variables: make-fetch-happen reads `http_proxy`/`https_proxy` at module load and prefers `https_proxy` even for http URLs, the loopback interface is not exempt; requests, httpx, curl and wget read them too. Unset them in every driver.
8. Defaults to override: got retries twice and throws on non-2xx; make-fetch-happen's `retry`; wget's 20 tries (`-t 1`); curl needs `--http1.1`. wget `-N` with `-O` is not timestamping. wget `-q` hides everything but the exit status.
9. curl `--etag-compare` with a missing or empty file sends `If-None-Match: ""` on fetch 1, so the cold request is conditional; after any 304 the tag file is empty.
10. Exit codes are not outcomes: curl exits 0 on a 304, a simulated 304 and a cold 304; wget exits 0 when it discards a 200. Record the file's size and hash after each run.
11. Added headers: Squid adds `Cache-Control: max-age=259200`, Via and X-Forwarded-For to every request it forwards; ATS adds Via (which contains the machine's host name), X-Forwarded-For and Client-ip; Varnish adds X-Varnish, X-Forwarded-For and `Accept-Encoding: gzip`, and its response Via contains the host name. None of these should reach a row except the recorded request Cache-Control.
12. ATS: the cache initializes asynchronously (poll before the first fetch); the package's configuration files are symbolic links into one shared directory, so copy them with links followed and render the three files that matter (records, remap, storage) into a private run root every time; never edit the shared copies. The RPC socket path of a long run root fails harmlessly.
13. Varnish default VCL answers `always-304` with 503 and `Retry-After: 5`; a driver that retries on 503 would loop.
14. Request counts per cell: three for every client except hishel `mismatch` (five). Far below the zone limit of 100 per 10 s.
15. Cache keys include the port for httpcache (Go), hishel, requests-cache, make-fetch-happen, got, undici, Squid and faraday-http-cache; nginx's key is the proxy_pass target plus the path, Varnish's the URL plus the Host header (the listen port), ATS's the remap source URL.

## 6. Install recipe
```
python3 -m venv venv
venv/bin/pip install hishel==1.4.0 requests-cache==1.3.3 'cachecontrol[filecache]==0.14.4' 'aiohttp-client-cache[sqlite]==0.15.0' httpx==0.28.1 requests==2.34.2 aiohttp==3.14.5
mkdir node && cd node && npm init -y && npm install undici@8.11.2 make-fetch-happen@16.0.1 got@16.0.0 cacheable-request@13.0.19 http-cache-semantics@4.3.0 axios@1.20.0 axios-cache-interceptor@1.12.3
# go.mod: require github.com/gregjones/httpcache v0.0.0-20190611155906-901d90724c79 and github.com/bartventer/httpcache v0.14.0 (blank-import its store/memcache)
gem install --user-install faraday faraday-http-cache     # faraday 2.14.4, faraday-http-cache 3.0.0, faraday-net_http 3.4.4
brew install wget nginx varnish squid trafficserver       # wget 1.25.0, nginx 1.31.6, varnish 9.1.0, squid 7.7, trafficserver 10.2.0_1
```
curl is the macOS system build 8.7.1. Installing trafficserver also installed hwloc, libvmaf, aom, libde265, x265, libheif, m4, libtool, imagemagick, libmaxminddb, luajit, asio, nuraft and yaml-cpp and upgraded libpng from 1.6.58 to 1.6.59. Runtimes: Python 3.14.7, Node 26.10, Go 1.27, Ruby 3.3.12. The minimal proxy configurations are committed with the harness in `scripts/etag-witness/proxies/`.

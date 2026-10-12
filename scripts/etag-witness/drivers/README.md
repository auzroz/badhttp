# /etag witness: cache drivers

Each file here makes one HTTP cache (a library, a command-line tool or a caching proxy) fetch one URL several times, so that
`scripts/etag-witness/run.mjs` can point it at the recording proxy and record what it sent and what its caller got. A driver
is a long-lived process: the orchestrator starts it in an empty working directory, sends `FETCH <url>` lines on stdin, and
reads one `RESULT` line per fetch. The cache is created at process start and every fetch goes through that same instance.

## Protocol

- On start, one line: `HELLO {"library","version","runtime","http":"1.1","configuration"}`. `configuration` names what the
  harness handed the client (storage, every option that departs from the library's default, every proxy directive). It is the
  same for every flavor.
- `FETCH <url>` performs ONE fetch of that URL through the cache and prints one line:
  `RESULT {"ok":bool,"status":int|null,"bytes":int,"sha256":"<hex>","error":{"name","message"}|null,"library_says":any|null,"exit":{"code","stderr_tail"}|null}`.
  - `status`, `bytes`, `sha256` describe what the CALLER received: the library's response status and body bytes; for a command-line
    tool, the tool's reported status and the file on disk after the run (an unchanged file after a 304; zero bytes when there is no
    file); for a proxy, what curl received from it. `sha256` of an empty body is the hash of zero bytes.
  - `error` is set when the library raised or the tool exited non-zero; `status` is then null unless the tool itself reported one.
  - `library_says` is whatever the library exposes about cache use (hishel's extensions, requests-cache's `from_cache`, nginx's
    `X-Cache-Status`). It is recorded as the library's claim and never used to compute an outcome.
  - `file_rewritten` (command-line tools only) is true when the tool wrote its output file in this run: curl downloaded body bytes, wget printed a "saved" line, or the file's presence, inode, modification time or content changed; false for a file left as it was.
  - `exit` is set for tools and proxies (exit code and the last stderr lines) and null for libraries.
- `QUIT` exits 0 (a proxy driver stops its proxy first: SIGTERM, SIGKILL after 3 s; the proxy shares the driver's process group, so the orchestrator's group kill takes it too). End of input does the same.
- Nothing else is written to stdout; diagnostics go to stderr. Exit 2 means the driver itself could not run (module missing, bad
  arguments, proxy would not start); the orchestrator aborts the capture on it.
- No fetch is retried and no driver follows a different URL (redirects are off or capped at zero in every client).
- Messages are scrubbed in the driver, and again by the orchestrator: the loopback origin becomes `https://badhttp.dev`, a bare
  loopback host becomes `<host>`, absolute paths become `<path>`, whitespace is collapsed, 200 characters.

## Drivers

| file | invocation | clients (id: library, version at the survey of 2026-10-12) |
|---|---|---|
| `py-caches.py` | `$ETAG_VENV/bin/python -I py-caches.py <id>` | `hishel`: hishel 1.4.0 + httpx 0.28.1. `requests-cache`, `requests-cache-cc`: requests-cache 1.3.3 + requests 2.34.2. `cachecontrol`: CacheControl 0.14.4 + requests 2.34.2. `aiohttp-client-cache`, `aiohttp-client-cache-cc`: aiohttp-client-cache 0.15.0 + aiohttp 3.14.5 |
| `node-caches.mjs` | `ETAG_NODEMODS=<dir containing node_modules> node node-caches.mjs <id>` | `undici-cache`: undici 8.11.2. `make-fetch-happen`: 16.0.1. `got-cache`: got 16.0.0. `axios-cache-interceptor`: 1.12.3 + axios 1.20.0 |
| `gotool/` | `$ETAG_GOTOOL <id>` (build: `go build -o <out>/gotool .` in `gotool/`) | `gregjones-httpcache`: github.com/gregjones/httpcache (pseudo-version of 2019-06-11). `bartventer-httpcache`: github.com/bartventer/httpcache v0.14.0 |
| `cli.mjs` | `node cli.mjs <id>` | `curl-etag`, `curl-z`, `curl-z-R`: curl 8.7.1. `wget-N`: GNU Wget 1.25.0 |
| `proxy.mjs` | `node proxy.mjs <id>` (optional `ETAG_PROXIES`, default `../proxies`) | `nginx`, `nginx-stale`: nginx 1.31.6. `varnish`: Varnish Cache 9.1.0. `squid`: Squid 7.7. `trafficserver`, `trafficserver-default`: Apache Traffic Server 10.2.0 |

The version a row carries is the one the driver prints in HELLO at capture time. The `-cc` ids differ from their plain ids by
exactly one option (`cache_control=True`). The roster, not this file, says which ids are captured.

## What each driver changes from the library's defaults, and what it does

Every library keeps its default policy, controller and options except where this section says otherwise. Statements about a
library's behaviour are from its source at the pinned version.

### Python (`py-caches.py`)

All four run under `python -I` (no user site, no environment variables, no working directory on the path). Redirects are off. Proxy environment variables are removed before any library is imported and `NO_PROXY=*` is set.

- **hishel** (`hishel.httpx.SyncCacheClient`, `follow_redirects=False`): `storage=SyncSqliteStorage(database_path="hishel_cache.db")`
  in the working directory (hishel 1.4 ships SQLite and Redis storage, no file storage); the policy is the library's default
  (`SpecificationPolicy`, shared-cache mode). The library follows RFC 9111 in its own code: a stored `no-cache` response is never
  served without validation, and the validation request carries `If-None-Match` and `If-Modified-Since` built from the stored
  response's `ETag` and `Last-Modified`. `library_says` is the `hishel_from_cache`, `hishel_revalidated` and `hishel_stored`
  response extensions. The caller's body is `response.content`. The driver waits 1100 ms before every fetch after the first: hishel orders stored candidates by the response's `Date`, which has one-second resolution, so two responses stored in the same second are otherwise indistinguishable to it and the validator it sends next depends on the clock.
- **requests-cache** (`CachedSession("rc_cache", backend="sqlite")`): the SQLite file lives in the working directory; every other
  option is the default, which includes `cache_control=False` and `expire_after=-1`. With those defaults the library ignores the
  response's `Cache-Control`, keeps a stored 200 for ever, and revalidates only when told to (`always_revalidate`, an expired
  response, or a refresh). **requests-cache-cc** passes `cache_control=True` and nothing else; the library then also builds
  `If-None-Match` and `If-Modified-Since` from a stored response whose `Cache-Control` has `no-cache` or `must-revalidate`.
  `allow_redirects=False` on every call. `library_says` is `from_cache` and `is_expired`.
- **cachecontrol** (`CacheControl(requests.Session(), cache=FileCache(".web_cache"))`): the adapter, controller and `cache_etags=True`
  are defaults; `FileCache` needs `filelock` (the `cachecontrol[filecache]` extra). The controller stores a 200 that carries an
  `ETag` (for 14 days) or explicit freshness information, reuses a stored response when its freshness lifetime exceeds its age, and
  otherwise sends `If-None-Match` from the stored `ETag` and `If-Modified-Since` from the stored `Last-Modified`. A stored response
  with no `ETag` that is not fresh is deleted. `library_says` is the `from_cache` attribute the adapter sets on the response.
- **aiohttp-client-cache** (`CachedSession(cache=SQLiteBackend("aiohttp_cache"))`): SQLite file in the working directory; every other
  option is the default, including `cache_control=False` and `expire_after=-1`. **aiohttp-client-cache-cc** passes
  `cache_control=True` and nothing else. The session runs on one event loop owned by the driver, created before the session because
  aiohttp wants a running loop at construction. `allow_redirects=False`. `library_says` is `from_cache` and `is_expired`.

### Node (`node-caches.mjs`)

ESM ignores `NODE_PATH`, so the driver resolves each package from `ETAG_NODEMODS/node_modules` (falling back to `NODE_PATH`) and
imports its entry file. A missing package exits 2. Proxy environment variables are removed first and `NO_PROXY=*` is set.

- **undici-cache**: `new Agent().compose(interceptors.cache())` with no options, so the store is the default `MemoryCacheStore`,
  type `shared`, methods `GET`; `undici.request(url, {dispatcher})` and the body read with `arrayBuffer()`. The interceptor treats
  an unqualified `no-cache` response as needing revalidation, and builds the validation request with `If-None-Match` from the stored
  `ETag` and an `If-Modified-Since` that is the stored `Last-Modified` when it parses as an HTTP-date and the time the response was
  stored otherwise. `library_says` is the `age` header of the response the caller got.
- **make-fetch-happen**: `fetch.defaults({cachePath: "mfh-cache"})` in the working directory, cache mode `default`, `redirect: "manual"`
  on the call; `retry` is its default (zero retries). The cache policy is `http-cache-semantics` with `shared: false`; the
  validation request is built by that object's `revalidationHeaders`. `library_says` is the `x-local-cache-status` and
  `x-local-cache-mode` headers the library adds to the response.
- **got-cache**: `got.extend({cache: new Map(), retry: {limit: 0}, followRedirect: false, throwHttpErrors: false})`; the cache
  machinery is `cacheable-request` over `http-cache-semantics` with got's defaults. `retry.limit: 0` is the one departure from the
  defaults (got retries `GET` on some statuses and network errors) and `throwHttpErrors: false` hands a non-2xx status to the caller
  instead of raising. `responseType: "buffer"` per call. `library_says` is `isFromCache`.
- **axios-cache-interceptor**: `setupCache(axios.create({maxRedirects: 0}), {})`, all defaults (in-memory storage). `responseType:
  "arraybuffer"` on each call so the caller's bytes are the wire bytes. The library's `cacheTakeover` default adds request headers
  `Cache-Control: no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache` and `Expires: 0` to the request; the recorder
  shows them. `library_says` is the response's `cached` and `stale` properties.

### Go (`gotool/`)

Both libraries get an `http.Transport` built from scratch (`Proxy: ProxyFromEnvironment`, `ForceAttemptHTTP2: false`, empty
`TLSNextProto`) as their upstream, and an `http.Client` with `CheckRedirect` returning `ErrUseLastResponse`. Proxy environment variables are unset at start and `NO_PROXY=*` is set.

- **gregjones-httpcache**: `httpcache.NewTransport(diskcache.New("gj-cache"))` in the working directory, `MarkCachedResponses`
  at its default (true), which is what puts `X-From-Cache` on a response served from the store. When it holds a stored response
  it cannot serve fresh, it sends `If-None-Match` from the stored `ETag` and `If-Modified-Since` from the stored `Last-Modified`.
- **bartventer-httpcache**: `httpcache.NewTransport("fscache://<working directory>?appname=bv-cache", WithUpstream(...))`; the
  file-system backend with its defaults, `WithSWRTimeout` and `WithLogger` unset. The library builds its validation request in
  `withConditionalHeaders` from the stored `ETag` and `Last-Modified` (RFC 9111 §4.3.1 in its comments). `library_says` is the
  `X-Httpcache-Status` and `X-From-Cache` headers the library sets.

### Command-line tools (`cli.mjs`)

Each FETCH runs the tool once in the working directory. Proxy environment variables are removed from the tool's environment.
`-q` (curl) and `--no-config` (wget) keep a user's rc file out. The caller's bytes are the file the tool leaves on disk.

- **curl-etag**: `curl -q -sS --http1.1 --etag-save etag.txt --etag-compare etag.txt -o body.bin -w '%{http_code} %{size_download}' <url>`, the same
  command on every fetch. With no etag file curl 8.7.1 does not fail: it sends `If-None-Match: ""`. After a 304 the etag file is
  empty, so the next fetch sends `""` again; after a 200 it holds the response's `ETag` as received.
- **curl-z**: `curl -q -sS --http1.1 -z body.bin -o body.bin -w '%{http_code} %{size_download}' <url>`, the same command on every fetch. With no file
  `-z` sends nothing. With a file it sends `If-Modified-Since` with the file's modification time, which (without `-R`) is the time
  the file was written. **curl-z-R** adds `-R` (`--remote-time`), which sets the file's modification time from the response's
  `Last-Modified` when curl can parse it.
- **wget-N**: `wget --no-config -N -t 1 --max-redirect=0 --server-response <url>`; `-N` cannot be combined with `-O`, so wget names
  the file from the URL (the last path segment) in the working directory. wget sends `If-Modified-Since` from the file's modification
  time and sets that time from the response's `Last-Modified`; it never sends `If-None-Match`. `-t 1` is one try (the default is
  twenty on transient errors). wget reports no status of its own, so `status` is the last `HTTP/1.x NNN` line of `--server-response`, so a wget run that exits 8 on a 304 reports status 304 with `ok` false. The error is named from wget's documented exit table (1 GenericError, 2 ParseError, 3 FileIOError, 4 NetworkFailure, 5 SSLFailure, 6 AuthFailure, 7 ProtocolError, 8 ServerError) with the message "<meaning> (exit N)"; curl keeps `NonZeroExit`. Timestamps, transfer rates and progress lines are removed from wget's `stderr_tail`.

### Caching proxies (`proxy.mjs`)

The origin URL is known only at the first FETCH, so the driver renders the committed template with the recorder's host and port
then, starts the proxy on an ephemeral loopback port with all of its state in the working directory, waits until it accepts
connections (Varnish: until `varnishadm status` reports the child running), and fetches through it with
`curl -q -sS --http1.1 -D headers.txt -o body.bin -w '%{http_code}'` (Squid, a forward proxy, with `-x` and the original URL; the
other three are reverse proxies and curl is given the proxy's own URL with the original path). Templates are in `../proxies/`.
`library_says` is the cache-status header(s) of curl's response only; the proxy's `Via` hostname never reaches a row.

- **nginx** (`nginx.conf.tmpl`): `proxy_pass` to the recorder; `proxy_cache_path <dir>/cache keys_zone=etagwitness:1m`;
  `proxy_cache etagwitness`; `proxy_cache_revalidate on`; `add_header X-Cache-Status $upstream_cache_status always` for
  observation; the temp paths and pid/error-log paths under the working directory. nginx talks HTTP/1.0 to the upstream (its
  default). This template has neither `proxy_cache_valid` nor `proxy_ignore_headers`; in nginx's own behaviour a response with
  no validity time configured, or one carrying `Cache-Control: no-cache`, is not stored.
- **nginx-stale**: the same template with two more directives, `proxy_cache_valid 200 1s` and `proxy_ignore_headers Cache-Control`.
  Those are what it takes for nginx to store these responses at all and treat them as stale after a second; the driver waits
  2300 ms before each fetch after the first so the stored response has aged out, and the configuration string says so.
- **varnish** (`varnish.vcl.tmpl`): `varnishd -F -n <dir>/varnish -a 127.0.0.1:<port> -f varnish.vcl`; the VCL file only defines
  the backend, so Varnish's built-in VCL (which makes a `no-cache` response uncacheable) applies. Storage and parameters are the
  defaults. `library_says` is `X-Varnish` and `Age`.
- **squid** (`squid.conf.tmpl`): `squid -N -f squid.conf`; `http_port` on loopback, a fixed `visible_hostname`, pid and log files in
  the working directory, `shutdown_lifetime 1 seconds`, `access_log none`, `http_access allow localhost` then `deny all`, no `cache_dir` (Squid's default
  in-memory cache), and `reply_header_add X-Cache-Status "%Ss"` for observation. Squid itself puts `Cache-Control: max-age=259200`
  on the request it sends upstream (seen on the wire). `library_says` is `X-Cache-Status` and `Age`.
- **trafficserver** (`trafficserver.*.tmpl`): `traffic_server --run-root=<dir>/ats/runroot.yaml` with the package's shipped
  configuration (the bottle copy, dereferenced; the package's own `etc` is symlinks into the machine's live config and the driver
  never writes through a link) copied to `<dir>/ats/etc` and four files rendered over it: `records.yaml` (loopback port,
  `http.cache.http 1`, `http.cache.required_headers 0`, reverse proxy on, `remap_required 1`, `insert_response_via_str 2` for
  observation), `remap.config` (the proxy's URL to the recorder), `storage.config` (a 64M cache under the working directory) and
  `runroot.yaml` (every directory under the working directory). `required_headers 0` is the one cache setting that departs from the
  shipped default: the default (2) stores only responses that carry explicit freshness information, so none of these responses
  would be stored. **trafficserver-default** omits that line, leaving the shipped default. `library_says` is `Age` and the
  bracketed cache-lookup code of the `Via` header. The driver waits for the "cache enabled" line in ATS's diags.log before the first fetch, since ATS accepts connections before its cache is ready; it sends no probe request.

## Not covered

TLS and HTTP/2 (every client speaks plain HTTP/1.1 to a loopback recorder), a browser cache, `max-age`, heuristics, `Vary` and
`stale-while-revalidate` (every flavor is `no-cache`), anything after the harness's per-fetch (20 s) and per-cell (60 s) caps, and
a proxy configured any way but the one in its template.

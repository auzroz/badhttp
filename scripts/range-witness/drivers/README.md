# /range witness: library drivers

Three small programs that make one resuming library perform one resume of a partial file, so that
`scripts/range-witness/run.mjs` can point them at the recording proxy. The orchestrator reads only the exit
code and the last stdout line.

| file | library (version pinned by the capture) | invocation |
|---|---|---|
| `hf.py` | huggingface_hub 2.2.0 `http_get` (httpx2 2.13.1) | `python -I hf.py URL OUTFILE` |
| `ndh.cjs` | node-downloader-helper 2.1.11 | `NODE_PATH=<node_modules parent> node ndh.cjs URL DIR` (partial is `DIR/out.txt`) |
| `gotool/` | grab v3.0.1, go-getter v1.8.10 (`go.mod` here) | `gotool grab URL OUTFILE`, `gotool getter URL OUTFILE`, `gotool versions` |

Build: `go build -o <scratch>/gotool ./gotool` from this directory. Install: a venv with `pip install huggingface_hub==2.2.0`;
`npm install node-downloader-helper@2.1.11`.

## Contract

- Exit 0: the library reported success. 1: it reported an error. 2: the driver could not run (bad arguments, module missing).
- No retries, no redirect handling beyond the library's default.
- The last stdout line is `RESULT {json}` with `ok`, `kind` (`return` or `raised`), `name` (the library's exception or
  error type, null on success), `message` (the library's text, scrubbed: loopback origin becomes `https://badhttp.dev`, a bare
  loopback host becomes `<host>`, absolute paths `<path>`, loopback ports removed with their host, whitespace collapsed, 200 characters), `library`,
  `version` (from package metadata, `package.json`, or build info), `runtime`, `http` (`1.1`).
- Other stdout lines are for people: `END`, `FILES`, `SKIP`, `WARNING` (ndh), `GRAB ...` (grab).

## What each driver does, and what it changes from the library's defaults

- **hf.py** opens OUTFILE for append and calls `huggingface_hub.file_download.http_get(url, f, resume_size=<bytes on disk>)`
  with `_nb_retries=0` and `displayed_filename=<path+query>`. The client is the library's default client rebuilt with
  `http1=True, http2=False` stated outright (h2 is not installed either way). `http_get` sends `Range: bytes=<size>-`
  (nothing when the size is 0), truncates the file and restarts on a 200, takes the expected size from Content-Range's total
  (else Content-Length), writes the body, and only afterwards raises `OSError` if the byte count differs. So a flavor can leave a
  correct or a wrong file AND exit 1. `http_get` itself still retries 408 and 429 (up to five times, with backoff) and cannot be
  told not to; a Cloudflare 429 therefore appears as extra exchanges.
  The public `hf_hub_download` no longer resumes a partial in 2.2.0 (it writes a fresh uuid-named `.incomplete` file opened `wb`);
  `http_get`'s `resume_size` is the resume code path, used by its own recursion and by `HfFileSystem.get_file`.
- **ndh.cjs** sets `fileName: 'out.txt'`, `resumeIfFileExists: true`, `override: true`, `retry: false`, and three options that
  differ from the defaults: `resumeOnIncomplete: false` (default true re-issues Range requests up to five times when the byte count
  differs from the HEAD length), `removeOnFail: false` and `removeOnStop: false` (default true deletes the file on any error).
  It sends a HEAD first and takes the total from the HEAD's Content-Length, never from Content-Range. If the file is already as long
  as the HEAD says, it does not resume but starts a fresh GET with no Range that overwrites `out.txt` (with `override: false` it would
  write `out (1).txt` instead). The `end` event's `{totalSize, incomplete, onDiskSize, downloadedSize}` is the RESULT message on
  success (`incomplete` is downloaded bytes against the HEAD length; exit is 0 either way).
- **gotool grab** uses `grab.NewClient()` with `HTTPClient` replaced by a client whose Transport is built from scratch
  (`Proxy: ProxyFromEnvironment`, `ForceAttemptHTTP2: false`, empty `TLSNextProto`) and `NoResume = false`. With an existing file grab
  sends a HEAD, resumes only if that HEAD carried `Accept-Ranges: bytes` (`CanResume`), and then sends `Range: bytes=<size>-`;
  without it, it re-fetches and rewrites the file. It never reads Content-Range. `didResume`, `canResume`, `status`, `size` and
  `bytesComplete` are the RESULT message (success and error alike), grab's own statement of whether it asked for a range. With no file there is no HEAD and no Range. The destination must be a file path (a
  directory makes grab pick a name).
- **gotool getter** uses go-getter's `Client.Get` in file mode with an `HttpGetter` carrying the same Transport. It sends a HEAD
  first. Only when the HEAD is a 200 with `Accept-Ranges: bytes` and a Content-Length does it stat the file and send
  `Range: bytes=<size>-`; a file already as long as the HEAD says is left alone with no GET. Otherwise it opens the file
  `O_RDWR|O_CREATE` (no truncate) and writes from offset 0, so a longer stale file keeps its tail. It accepts any 200 or 206.
  A `?checksum=` query would make it verify (and skip the download when the file already matches); the family never sends one.

## Not covered

TLS and HTTP/2 (the recorder is plain HTTP/1.1 on loopback), proxies (the Go transports and httpx2 honour the proxy
environment, ndh does not), and anything after the harness's 30 s cap.

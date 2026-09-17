// HTML for / and /books. Zero JavaScript, inline CSS, light and dark.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

const CSS = `
:root{--bg:#fbfaf7;--fg:#1b1a17;--mut:#6b675e;--line:#e5e1d8;--acc:#b5421f;--code-bg:#f1eee7;--ok:#2f6b3a}
@media(prefers-color-scheme:dark){:root{--bg:#15140f;--fg:#ebe7dd;--mut:#a29d91;--line:#2c2a23;--acc:#ff8a5c;--code-bg:#1f1d17;--ok:#7fc48c}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:48rem;margin:0 auto;padding:3rem 1.25rem 4rem}
h1{font:700 2.25rem/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:-.02em;margin:0 0 .35rem}
h1 a{color:inherit;text-decoration:none}
.tag{color:var(--mut);font-size:1.05rem;margin:0 0 1.75rem}
h2{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:3rem 0 1rem;padding-bottom:.4rem;border-bottom:1px solid var(--line)}
h3{font:600 1rem/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:1.6rem 0 .3rem;word-break:break-word}
h3 a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}h3 a:hover{border-color:var(--acc)}
p{margin:.35rem 0 .6rem}
code,pre{font:.88rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{background:var(--code-bg);padding:.1em .35em;border-radius:4px}
pre{background:var(--code-bg);padding:.7rem .9rem;border-radius:6px;overflow-x:auto;margin:.4rem 0 .6rem}
pre code{background:none;padding:0}
a{color:var(--acc)}
.lede{font-size:1.1rem;margin:0 0 1.5rem}
.note{color:var(--mut);font-size:.92rem}
table{border-collapse:collapse;width:100%;font-size:.95rem;margin:.5rem 0 1rem}
th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--mut);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
td:first-child{white-space:nowrap}
.books{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin:1rem 0}
.books div{border:1px solid var(--line);border-radius:6px;padding:.75rem .9rem}
.books b{display:block;font-size:1.35rem;font-variant-numeric:tabular-nums}
.books span{color:var(--mut);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
@media(max-width:30rem){.books{grid-template-columns:1fr}}
footer{margin-top:3.5rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--mut);font-size:.88rem}
footer p{margin:.3rem 0}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.05em .6em;font-size:.78rem;color:var(--mut);margin-left:.4rem;vertical-align:middle}
`;

function shell({ title, body, description }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>
`;
}

function endpoint({ path, link, title, desc, curl, note }) {
  const head = link ? `<a href="${esc(link)}">${esc(path)}</a>` : esc(path);
  return `<h3>${head}</h3>
<p>${desc}</p>
<pre><code>${esc(curl)}</code></pre>${note ? `<p class="note">${note}</p>` : ''}`;
}

export function homePage({ origin, version, books, totals, limits, badjson, sse, range, etag, cookies, auth, compress, crosshost, x402 }) {
  const o = origin;
  const crosshostFlavors = Object.entries(crosshost || {}).map(([k, v]) => `<tr><td><a href="/crosshost"><code>${esc(k)}</code></a></td><td><code>${esc(v.scheme)}://${esc(v.start === 'alt' ? 'alt.badhttp.dev' : 'badhttp.dev')}</code></td><td>${esc(v.about)}</td></tr>`).join('');
  const compressFlavors = Object.entries(compress).map(([k, v]) => `<tr><td><a href="/compress/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td><td>${esc(v.edge)}</td></tr>`).join('');
  const flavors = Object.entries(badjson).map(([k, v]) => `<tr><td><a href="/badjson/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const sseFlavors = Object.entries(sse).map(([k, v]) => `<tr><td><a href="/sse/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const rangeFlavors = Object.entries(range).map(([k, v]) => `<tr><td><a href="/range/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const etagFlavors = Object.entries(etag).map(([k, v]) => `<tr><td><a href="/etag/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const cookieFlavors = Object.entries(cookies).map(([k, v]) => `<tr><td><a href="/cookies/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const authFlavors = Object.entries(auth).map(([k, v]) => `<tr><td><a href="/auth/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');
  const scenarios = Object.entries(x402.scenarios).filter(([k]) => k !== 'pay').map(([k, v]) => `<tr><td><a href="/402/${esc(k)}"><code>/402/${esc(k)}</code></a></td><td><strong>${esc(v.title)}.</strong> ${esc(v.about)}</td></tr>`).join('');
  const broken = Object.entries(x402.broken).map(([k, v]) => `<tr><td><a href="/402/broken/${esc(k)}"><code>${esc(k)}</code></a></td><td>${esc(v.about)}</td></tr>`).join('');

  const body = `
<header>
<h1><a href="/">badhttp</a> <span class="pill">v${esc(version)}</span></h1>
<p class="tag">the server that misbehaves on purpose</p>
<p class="lede">Point an HTTP client, an SDK, or an agent at these URLs and find out what it does when the server is unkind. Every endpoint is stateless and documented. Everything is free except the <a href="#x402">/402 paywalls</a>, which charge only if your client chooses to pay, and default to test USDC. There is no signup and nothing about you is stored.</p>
<pre><code>curl -i "${esc(o)}/status/429?retry-after=3"</code></pre>
<p class="note">Machine-readable: <a href="/openapi.json">/openapi.json</a> · <a href="/llms.txt">/llms.txt</a>. Liveness: <a href="/health">/health</a>.</p>
</header>

<h2>Status and timing</h2>
${endpoint({
  path: '/status/{code}', link: '/status/503?retry-after=5',
  title: 'status',
  desc: 'Returns the status code you ask for, 200–599. Add <code>?retry-after=N</code> to get a <code>Retry-After</code> header. Give a comma-separated list and it picks one at random. 204, 205 and 304 come back with no body, as the spec demands; 3xx come with a <code>Location</code>.',
  curl: `curl -i "${o}/status/429?retry-after=3"\ncurl -i "${o}/status/200,500,503"`,
})}
${endpoint({
  path: '/delay/{seconds}', link: '/delay/2',
  desc: `Waits up to ${limits.delayMaxSeconds} seconds, then answers. Decimals allowed. Use it to test timeouts that are too short, and timeouts that are missing.`,
  curl: `curl -m 1 "${o}/delay/3"      # should time out\ncurl -m 5 "${o}/delay/3"      # should succeed`,
})}
${endpoint({
  path: '/drip', link: '/drip?duration=5&chunks=10',
  desc: `Streams a chunked body one line at a time over <code>?duration=</code> seconds (max ${limits.dripMaxSeconds}) in <code>?chunks=</code> pieces (max ${limits.dripMaxChunks}). Headers arrive immediately; the body dribbles. Clients with a connect timeout but no read timeout hang here.`,
  curl: `curl -N "${o}/drip?duration=5&chunks=5"`,
})}
${endpoint({
  path: '/flaky/{percent}', link: '/flaky/50',
  desc: 'Fails the given percentage of requests with a 500 (or <code>?fail=503</code>). Add <code>?seed=</code> and increment <code>?i=</code> per attempt for a reproducible sequence, so a retry test can fail the same way every time.',
  curl: `curl -i "${o}/flaky/50?fail=503"\nfor i in 0 1 2 3; do curl -s "${o}/flaky/70?seed=ci&i=$i"; done`,
})}

<h2>Bodies</h2>
${endpoint({
  path: '/badjson/{flavor}', link: '/badjson',
  desc: 'Serves JSON that is broken, mislabeled, or technically valid but hostile, always with a 200 unless you pass <code>?code=</code>. <a href="/badjson">GET /badjson</a> lists the flavors.',
  curl: `curl -s "${o}/badjson/trailing-comma"\ncurl -si "${o}/badjson/html?code=502"`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${flavors}</tbody></table>
${endpoint({
  path: '/truncate', link: '/truncate?length=1000&send=500',
  desc: 'Declares <code>Content-Length: length</code>, sends only <code>send</code> bytes, then closes the connection. A client that trusts Content-Length and does not check for a short read will happily return half a file. Over HTTP/1.1 the connection closes early; over HTTP/2 the stream is reset.',
  curl: `curl -sv "${o}/truncate?length=1000&send=500" -o /dev/null`,
})}

<h2>Content codings</h2>
${endpoint({
  path: '/compress/{flavor}', link: '/compress',
  desc: `<code>Content-Encoding</code> that misbehaves: gzip declared on plain text, gzip with no header, streams that are cut, corrupt, checksum-wrong, concatenated, gzipped twice or followed by junk, raw DEFLATE sold as <code>deflate</code>, an alias and a case trap, a zero-byte gzip body, a compressed body under the plaintext's <code>Content-Length</code>, a <code>.gz</code> download that is transport-encoded as well, and a declared decompression bomb; <code>br</code>, <code>zstd</code> and <code>deflate</code> for the codings themselves; <code>ok</code> is the honest control. The document is the self-describing one from <a href="/range">/range</a>, and every response states the plaintext's length and SHA-256 in <code>x-badhttp-plain-bytes</code> / <code>x-badhttp-plain-sha256</code>, so you can prove what your client decoded. <code>?length=</code> sets the size (default 4096, max 1 MiB); <code>?code=502</code> makes it an error body (a compressed or mislabelled error page is its own bug class); <code>bomb</code> takes <code>?size=</code> in MiB (max ${limits.compressBombMaxMiB}). <a href="/compress">GET /compress</a> lists the flavors, their parameters, and the Accept-Encoding the edge reports for you.`,
  curl: `curl -s -H 'Accept-Encoding: gzip' "${o}/compress/truncated" | gzip -dc; echo "exit $?"\ncurl -s --compressed "${o}/compress/multi-member" | wc -c     # 4096, or 2048 and no error?\ncurl -si -H 'Accept-Encoding: gzip' "${o}/compress/not-compressed?code=502" | head -c 700`,
  note: `<strong>Send <code>Accept-Encoding: gzip</code></strong> (<code>br</code>, <code>zstd</code> for those flavors) or you will not see these bytes: Cloudflare's edge, which fronts this Worker, removes one coding layer it recognizes (gzip, br, zstd) unless your Accept-Encoding lists it, transcoding the body to identity, <code>cache-control: no-transform</code> notwithstanding — and transcoding a broken stream is lossy. Codings it does not know (<code>x-gzip</code>, <code>badhttp</code>) and a second declared layer go through to everyone. The last column of the table says what each flavor became for a client without gzip (curl's default, Python's <code>urllib</code>), observed 2026-09-01. The edge also rewrites the Accept-Encoding header to <code>gzip, br</code> before the Worker runs and keeps only a normalized set (q-values dropped, <code>q=0</code> included, <code>zstd</code> missing) in <code>request.cf.clientAcceptEncoding</code>, which is why <code>ok</code> cannot honour a refusal and never sends a 406 (<code>bomb</code>'s 406 is the opposite case: this server refusing a client the edge would decompress for), and why the zlib-<code>deflate</code> flavor can never be received: the edge decoded it for every client probed, even one that asked for it.`,
})}
<p class="note">Checked live with six real clients on 2026-09-02, each with its default Accept-Encoding and decoder (every observation below is served as data at <a href="/clients.jsonl"><code>/clients.jsonl</code></a>, indexed at <a href="/clients">/clients</a>, so you can check this paragraph rather than take it): <strong>curl 8.7</strong> (<code>--compressed</code>), <strong>Node 26 fetch</strong> (undici 8.10), <strong>Python requests 2.34</strong> (urllib3), <strong>httpx 0.28</strong>, <strong>Ruby 2.6 Net::HTTP</strong>, <strong>Go 1.27 net/http</strong>. The headline is <code>truncated</code>: curl (exit 0), Node, requests and httpx all return the partial plaintext with no error, Ruby returns an empty body with no error, and only Go reports it (<code>unexpected EOF</code>). <code>gzip-file</code>: all six apply transport decoding and would save the plaintext under the <code>.gz</code> name. <code>multi-member</code>: httpx and Ruby return the first member only, silently; curl stops after it with exit 56; Node, requests and Go decode both. <code>double</code>: Go and Ruby leave it compressed (the header is not exactly <code>gzip</code>); the other four decode both layers. <code>double-hidden</code>: all six hand you gzip bytes as text, exactly like <code>undeclared</code>. <code>x-gzip</code>: httpx and Go leave it compressed; curl, Node, requests and Ruby decode it. <code>deflate-raw</code>: curl, Node, requests and httpx detect the missing zlib wrapper and recover; Ruby raises; Go does not decode deflate at all and hands you the bytes. <code>bad-crc</code>: Node, requests, httpx and Ruby raise; curl and Go deliver the full text and then report the error. <code>trailing-garbage</code>: Node raises without delivering anything; Go delivers everything, then raises; curl delivers everything and exits 56; requests, httpx and Ruby ignore the junk. <code>corrupt</code> and <code>not-compressed</code>: all six report them — curl first writes what it has (the raw text for <code>not-compressed</code>, the decodable prefix for <code>corrupt</code>), Go returns the decodable prefix of <code>corrupt</code>. <code>unknown-coding</code>: all six hand you the body untouched (curl also exits 56). <code>wrong-length</code>: every client but Ruby reports the short read (Ruby returns the decoded text and says nothing). <code>uppercase</code> and <code>ok</code>: all six decode them. <code>undeclared</code>: all six hand you the gzip bytes as text. <code>empty</code>: none of the six objects. <code>bomb</code>: none of the six limits decompression — all allocate the 8 MiB. <code>br</code> and <code>zstd</code>: Node, requests and httpx decode both; curl (a zlib-only build), Ruby and Go do not advertise them and receive identity from the edge instead. <code>deflate</code>: none of the six receives it — the edge decodes it for all.</p>
<div class="scroll"><table><thead><tr><th>flavor</th><th>what you get with <code>Accept-Encoding: gzip</code> (<code>br</code>, <code>zstd</code> for those)</th><th>what a client without gzip gets — the edge transcodes (observed 2026-09-01 at the default length unless a length is named)</th></tr></thead><tbody>${compressFlavors}</tbody></table></div>

<h2>Event streams</h2>
${endpoint({
  path: '/sse/{flavor}', link: '/sse',
  desc: `Server-Sent Events streams that misbehave: wrong line endings, split multi-byte characters, events cut off mid-line, a reset connection, a stall, an event named <code>error</code>. <a href="/sse">GET /sse</a> lists the flavors. Every stream starts with <code>retry: 30000</code> so a browser waits 30 s before reconnecting (<code>resume</code> alone sends <code>retry: 1000</code>, so its reconnect round-trip is quick), and any request carrying a <code>Last-Event-ID</code> header is answered <code>204 No Content</code> (the spec's "stop reconnecting" signal) except <code>resume</code>, which continues from it. No stream lasts longer than ${limits.sseMaxSeconds} s.`,
  curl: `curl -N "${o}/sse/ok"\ncurl -N "${o}/sse/split-utf8" | xxd | tail -3\ncurl -sN --http1.1 "${o}/sse/drop"; echo "exit $?"      # 18: closed with bytes outstanding`,
  note: `Every flavor was checked against a spec-conformant client (Node's built-in <code>EventSource</code>, 2026-08-23): it handles all fourteen as the spec says, so if your parser does not, the difference is in the parser. Chunk boundaries (<code>split-utf8</code>) and the reset (<code>drop</code>) were confirmed byte for byte on the live host.`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${sseFlavors}</tbody></table>

<h2>Ranges and caching</h2>
${endpoint({
  path: '/range/{flavor}', link: '/range',
  desc: `Resumable downloads that misbehave: servers that ignore <code>Range</code>, serve the wrong bytes, lie in <code>Content-Range</code>, or hand out a range of a resource that changed underneath you. The document is deterministic and self-describing — 64-byte lines, each starting with its own offset — so when a flavor corrupts your download, the file itself shows you where. <code>?length=</code> sets the size (default 1000, max ${limits.rangeMaxBytes / 1024 / 1024} MiB). <a href="/range">GET /range</a> lists the flavors.`,
  curl: `curl -s -r 128-255 "${o}/range/ok?length=512"\ncurl -s -r 128-255 "${o}/range/shifted" | head -2   # look at the offsets: they are wrong\ncurl -C 320 -o resumed.txt "${o}/range/ignore"       # curl refuses: the server sent 200`,
  note: `Checked live with curl 8.7 (2026-08-23): it resumes <code>ok</code> byte-identically; refuses <code>ignore</code> and <code>advertise-only</code> (exit 33 over HTTP/1.1, 56 over HTTP/2, file untouched); and completes <code>shifted</code> with exit 0 and a corrupted file one byte short — only the offsets inside the file give it away. An unseeded <code>curl -C -</code> sends no Range header at all, so seed a partial file first.`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${rangeFlavors}</tbody></table>
${endpoint({
  path: '/etag/{flavor}', link: '/etag',
  desc: `Conditional requests that misbehave: validators that change on every response, servers that ignore <code>If-None-Match</code>, a <code>304</code> for a body you never saw, an ETag without quotes, a <code>Last-Modified</code> from the future. Responses are <code>cache-control: no-cache</code> — a spec-following cache stores them and revalidates on every use, which is the game being tested. <a href="/etag">GET /etag</a> lists the flavors.`,
  curl: `curl -s --etag-save t.txt "${o}/etag/ok" && curl -si --etag-compare t.txt "${o}/etag/ok"   # second is 304\ncurl -si -H 'If-None-Match: "e-badhttp-1"' "${o}/etag/mismatch" | grep -i '^etag'`,
  note: `Checked live against a real RFC-9111 cache (Node 25's undici cache interceptor, 2026-08-23): it revalidates <code>ok</code> and serves the stored body on the 304; re-downloads <code>changing</code> every time; is not fooled by <code>mismatch</code> (it keeps its stored validator instead of adopting the 304's); and surfaces <code>always-304</code>'s cold, body-less 304 straight to the caller.`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${etagFlavors}</tbody></table>

<h2>Cookies</h2>
${endpoint({
  path: '/cookies/{flavor}', link: '/cookies',
  desc: `Set-Cookie headers that misbehave: two cookies folded into one header, the same name twice on different paths, a cookie set on a redirect, Max-Age contradicting Expires, an unparseable date, a Domain for another site, a whole-TLD supercookie, <code>__Host-</code>/<code>__Secure-</code> prefixes broken on purpose, quotes, raw UTF-8, no name at all, and a cookie sized to your client's limit. The server stays stateless — the state under test is your client's jar. <a href="/cookies/echo">/cookies/echo</a> is the readback: it sets nothing and returns the <code>Cookie</code> header exactly as it reached the Worker, raw and parsed, order and duplicates preserved. <a href="/cookies">GET /cookies</a> lists the flavors and the politeness rules (scoped and short-lived except where the long date is the test; <code>/cookies/delete</code> cleans up).`,
  curl: `curl -s -c jar -b jar "${o}/cookies/ok" && curl -s -c jar -b jar "${o}/cookies/echo"\ncurl -sL -c jar2 -b jar2 "${o}/cookies/on-redirect"      # does the 302's cookie survive?\ncurl -s -b 'made=up; made=up-again' "${o}/cookies/echo"`,
  note: `Checked live against three real jars (2026-08-23). <strong>curl 8.7</strong> matches the table exactly: one cookie from the folded header, both duplicates (deep first), the 302's cookie captured, year 9999 kept at far-future (curl's 400-day clamp shipped later, in 8.12), exactly the two valid prefix cookies, and its jar file writes the domain flavor with a leading dot. <strong>Python's http.cookiejar</strong> stores all four prefix cookies (it has no prefix rules — RFC 6265-conformant), parses the no-equals nameless line as a cookie <em>named</em> badhttp-just-a-value with no value, and garbles ☃ internally while round-tripping the bytes faithfully. <strong>tough-cookie 6.0.2</strong> rejects the supercookie by name ("public suffix"), rejects both nameless lines loudly, and drops the invalid prefix pair <em>silently</em> — check the jar, not the exception; its jar file records conflicting-expiry with the 1970 date even though Max-Age correctly wins. All three: Max-Age beats Expires, bad-expires becomes a session cookie, path-prefix is stored but never sent back here, and /cookies/delete leaves the jar empty. On the wire, verified through the production edge: the folded comma survives as one header, the raw ☃ bytes and an 8 KB Set-Cookie pass intact — and a <em>request</em> Cookie header over 8,199 bytes is silently dropped before the Worker sees it (the request otherwise succeeds).`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${cookieFlavors}</tbody></table>

<h2>Authentication</h2>
${endpoint({
  path: '/auth/{flavor}', link: '/auth',
  desc: `HTTP authentication that misbehaves: a 401 with no challenge, an unknown scheme, two challenges jammed into one comma-joined header, a comma hiding inside a quoted realm, a server that rejects correct credentials forever, one that accepts anything, a 403 for a password that was right, the Digest <code>stale=true</code> dance, a 407 from a host that is not your proxy. The controls (<code>basic</code>, <code>bearer</code>, <code>digest</code>, <code>digest-sha256</code>) are fully RFC-correct. <strong>The test credentials are public and fake</strong> — user <code>agent</code>, password <code>correct</code> (utf8 flavor: <code>sésame</code>); Bearer <code>badhttp-token-ok</code> / <code>badhttp-token-limited</code> — and they are the only values any flavor ever accepts. Never send real credentials, and never point a credential store or ambient-auth client at badhttp: <code>/auth/accept-any</code> answers <code>authenticated:true</code> to <em>any</em> value, and that answer means nothing. Anything received is compared in memory and discarded — never stored, logged, or echoed. Any method works and is treated identically; the request body is never read. <a href="/auth">GET /auth</a> lists the flavors and credentials. Digest's MD5 is interop testing, not an endorsement.`,
  curl: `curl -u agent:correct "${o}/auth/basic"\ncurl --digest -u agent:correct "${o}/auth/digest"\ncurl -u agent:correct "${o}/auth/always-401"   # rejected anyway; how often does your client retry?\ncurl -H 'Authorization: Bearer anything-at-all' "${o}/auth/accept-any"`,
  note: `Checked live against three real clients (2026-08-27). <strong>curl 8.7.1</strong>: plain <code>-u</code> sends Basic preemptively (so <code>/auth/none</code> succeeds), <code>--anyauth</code> picks Digest from the <code>multi</code> challenge, <code>--digest</code> completes the <code>stale</code> dance without re-prompting, makes exactly one credentialed attempt at <code>always-401</code> and none after the 403, follows the 302 with credentials attached, and sends <code>agent:sésame</code> as UTF-8. <strong>Python 3.14 urllib</strong>: never sends preemptively (<code>/auth/none</code> is unreachable for it), answers the <code>case</code>/<code>quoted</code>/<code>multi</code>/<code>token68</code> challenge traps correctly, refuses the realm-less <code>bare-scheme</code> challenge, honors <code>stale=true</code>, stops after one credentialed attempt at <code>always-401</code>, and dies loudly at SHA-256 (<code>ValueError: Unsupported digest authentication algorithm</code>). <strong>requests 2.34.2</strong>: sends Basic preemptively, speaks SHA-256 — but encodes <code>agent:sésame</code> as Latin-1 despite <code>charset="UTF-8"</code> (the <code>/auth/utf8</code> body reports it) and gives up on the <code>stale</code> dance: its digest handler counts the stale=true 401 as a second failure and stops where curl and urllib retry to the 200. Our Authentication-Info <code>rspauth</code> is verified by independent recomputation on every smoke run; none of these clients checks it.`,
})}
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${authFlavors}</tbody></table>

<h2>Redirects</h2>
${endpoint({
  path: '/redirect/{hops}', link: '/redirect/3',
  desc: `Redirects <code>hops</code> times (max ${limits.redirectMaxHops}), then lands on a 200. <code>?code=</code> picks 301, 302, 303, 307 or 308; <code>?absolute</code> makes the Location absolute instead of relative. This family redirects only within badhttp.dev. The <a href="/crosshost">/crosshost</a> family deliberately crosses to a second host this project owns; no endpoint anywhere here accepts a redirect target from the caller.`,
  curl: `curl -iL "${o}/redirect/3"\ncurl -iL --max-redirs 2 "${o}/redirect/3"   # should fail\ncurl -i "${o}/redirect/1?code=308"`,
})}
${endpoint({
  path: '/redirect/loop', link: '/redirect/loop',
  desc: 'Redirects to itself forever. Your client should give up; find out whether it does, and how long it takes.',
  curl: `curl -iL --max-redirs 20 "${o}/redirect/loop"`,
})}

<h2>Credentials across a host boundary</h2>
${endpoint({
  path: '/crosshost/{flavor}', link: '/crosshost',
  desc: `What your client does with <code>Authorization</code>, <code>Proxy-Authorization</code>, <code>Cookie</code> and <code>X-Api-Key</code> when a redirect crosses to a <em>different host</em>. This is the one family that needs two hostnames, so badhttp has two: <code>badhttp.dev</code> and <code>alt.badhttp.dev</code> — same Worker, same zone certificate, genuinely different hosts. Every client decides what to forward by comparing the redirect target against where it started, every client compares something slightly different, and <strong>you cannot see any of it from a listener on 127.0.0.1</strong>: an agent framework's SSRF filter rejects a loopback target at hop zero, so the code under test never runs. Follow a flavor and read what arrived. <strong>There is no open redirect here, by construction</strong> — targets come from a frozen table of those two hosts, chosen by flavor name; no endpoint takes a redirect target, or any part of one, from the caller. The landing endpoint <strong>never echoes what you sent</strong> — not the value, not a prefix, not a hash — only whether it arrived, its scheme when recognized, and its byte length. <strong>Use the public fake credentials</strong> (<code>agent</code>/<code>correct</code>, Bearer <code>badhttp-token-ok</code>, X-Api-Key <code>badhttp-key-ok</code>) and nothing else; if anything else arrives the response says so and tells you to rotate it.`,
  curl: `curl -sL -u agent:correct "${o}/crosshost/to-subdomain"     # does your Authorization survive?\ncurl -sL -u agent:correct "${o}/crosshost/same-origin"      # the control: it should\ncurl -sL -H 'X-Api-Key: badhttp-key-ok' "${o}/crosshost/to-subdomain"`,
  note: `Checked live against eight real clients on 2026-09-17 — 72 observations, every one served as a row of <a href="/clients.jsonl"><code>/clients.jsonl</code></a> (family <code>crosshost</code>) and summarized in the <a href="/crosshost">index</a> under <code>witness</code>; a <em>dated capture</em>, not a live measurement. <strong>The single most useful result: <code>X-Api-Key</code> arrived intact in all 72</strong>, including every row on which <code>Authorization</code> was stripped. No client here treated the API-key convention most services actually use as a credential header. (<code>Proxy-Authorization</code> was not sent, so the oracle's <code>false</code> for it is not an observation.) <strong>Go 1.27 net/http</strong> forwarded <code>Authorization</code> and <code>Cookie</code> across every boundary except subdomain-to-apex — its <code>shouldCopyHeaderOnRedirect()</code> forwards to the initial host or a subdomain of it by documented design, compares <code>URL.Hostname()</code> (so the port change is invisible to it) and never examines the scheme. <strong>Python's stdlib urllib</strong> forwarded both on all eight header flavors: its redirect handler copies caller-set headers with no host comparison at all. <strong>curl 8.7.1 restored</strong> both headers on <code>boomerang</code> — it compares each hop against the <em>original</em> origin and regenerates rather than carrying a mutated map, so a chain that leaves and returns arrives with what it dropped in between; every other client that stripped stayed stripped. <strong>requests 2.34.2 and httpx 0.28.1</strong> kept <code>Authorization</code> on <code>scheme-upgrade</code> where <strong>urllib3 2.8.0</strong> and <strong>aiohttp 3.14.3</strong> stripped it, by a carve-out their own source calls backwards compatibility — and both drop an explicitly-set <code>Cookie</code> on <em>every</em> redirect, the same-origin control included. <strong>The <code>jar</code> flavor</strong>, witnessed for the first time in this capture: of the three cookies the first hop sets, the <code>Domain=badhttp.dev</code> one arrived at the subdomain from every client with a jar; the host-only one <em>and</em> the <code>__Host-</code> one arrived from the three clients built on Python's <code>http.cookiejar</code> (urllib, requests, httpx) and from none of curl, Go or aiohttp — the stdlib jar's default policy returns a no-<code>Domain</code> cookie to any host under it, and it has no notion of the <code>__Host-</code> prefix. None of this is a scoreboard: RFC 9110 §15.4 says nothing about credentials on redirects, so these are descriptions of what a caller received, not conformance results. <br><br>Every hop is a separate request against the zone rate limit, and every badhttp response carries <code>x-badhttp-version</code>. A response <em>without</em> that header did not come from this server — you hit the 100-per-10-s limit and are reading Cloudflare's 429. Treat it as no observation and retry after a pause; recording it as "the credential did not survive" would be a false reading, and it happened on the first run of the 2026-09-10 matrix (every row of the 2026-09-17 capture records <code>attempts: 1</code>, and the run log is committed beside the capture).`,
})}
<table><thead><tr><th>flavor</th><th>starts on</th><th>what it crosses</th></tr></thead><tbody>${crosshostFlavors}</tbody></table>


<h2>Inspection</h2>
${endpoint({
  path: '/headers', link: '/headers',
  desc: 'Echoes your request headers back as JSON. Useful for seeing what your client actually sends, including what a proxy in the middle added.',
  curl: `curl -s -H "X-Trace: abc" "${o}/headers"`,
})}
${endpoint({
  path: '/echo', link: '/echo',
  desc: `Echoes method, path, query, headers and body (first ${limits.echoMaxBodyBytes / 1024} KB) as JSON. POST, PUT, PATCH or DELETE only; a GET gets a 405 with a proper <code>Allow</code> header, which is itself worth testing against.`,
  curl: `curl -s -X POST "${o}/echo?x=1" -H "content-type: application/json" -d '{"hello":"world"}'`,
})}

<h2 id="x402">Payment (x402)</h2>
<p>Paywalls for machines. Every endpoint below speaks <a href="https://www.x402.org/">x402</a> in both generations at once (except <code>/402/broken</code>, which breaks it on purpose, and <code>/402/wrong-network</code>, which v1 cannot express): the v2 requirements base64-encoded in a <code>PAYMENT-REQUIRED</code> header and the same requirements again as an x402 v1 body (<code>x402Version: 1</code>, plain network names, <code>maxAmountRequired</code>) — much deployed buyer tooling still reads only the v1 body, and the v2 reference client reads the header first, so one response serves both. Pay with a signed USDC authorization in <code>PAYMENT-SIGNATURE</code> (v2) or <code>X-PAYMENT</code> (v1); the receipt comes back in <code>PAYMENT-RESPONSE</code> or <code>X-PAYMENT-RESPONSE</code> respectively. Default network is <strong>Base Sepolia</strong> (test USDC, free); <code>?network=base</code> asks for real USDC on Base mainnet. <code>?amount=</code> sets the price in USD (${esc(x402.limits.minUsd)}–${esc(x402.limits.maxUsd)}, default ${esc(x402.limits.defaultUsd)}). Only <code>/402/pay</code> ever settles anything; the rest are paywalls that misbehave, and they never touch a facilitator, so nothing you send them is ever charged.</p>
${endpoint({
  path: '/402/pay', link: '/402/pay',
  desc: `<strong>${esc(x402.scenarios.pay.title)}.</strong> ${esc(x402.scenarios.pay.about)} On mainnet that ${esc(x402.limits.defaultUsd)} USDC is this site's revenue; it is booked on the <a href="/books">books</a> each session and visible on chain immediately. Your <code>PAYMENT-SIGNATURE</code> or <code>X-PAYMENT</code> goes to a third-party facilitator (the lists, in order of preference and per protocol generation, are in <a href="/402">GET /402</a>). <em>Exercised so far (${esc(x402.verified.as_of)}):</em> ${esc(x402.verified.exercised)}. <em>Not yet:</em> ${esc(x402.verified.not_yet_exercised)}.`,
  curl: `curl -i "${o}/402/pay"                    # 402 + PAYMENT-REQUIRED (Base Sepolia)\ncurl -i "${o}/402/pay/base"               # the same, for real: 0.01 USDC on Base (or ?network=base)\ncurl -i "${o}/402/pay?amount=0.25"        # name your price, 0.001–1.00 USD`,
  note: `The 402 names one network, Base Sepolia unless you ask for mainnet with <code>/402/pay/base</code> (or <code>?network=base</code>): the reference client registers every EVM chain at once and signs for whatever the server names, so a wallet funded on mainnet has to ask. Each network has its own stable resource URL, <code>/402/pay/base</code> and <code>/402/pay/base-sepolia</code>, for catalogues. The v2 header also carries the x402 <code>bazaar</code> discovery extension (<code>serviceName</code>, <code>tags</code>, an input/output example) so catalogues can list it. To actually pay, in Node: <code>wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:84532', client: new ExactEvmScheme(account) }] })</code> from <code>@x402/fetch</code> and <code>@x402/evm</code> — or, from the v1 era, <code>wrapFetchWithPayment(fetch, await createSigner('base-sepolia', key), maxValue)</code> from <code>x402-fetch</code>, which reads the body and pays with <code>X-PAYMENT</code> (its default cap is 0.1 USDC in base units, so pass <code>maxValue</code> for amounts above that). With EIP-3009 the facilitator submits the transfer and pays the gas, so the payer needs USDC only.`,
})}
<table><thead><tr><th>scenario</th><th>what it does</th></tr></thead><tbody>${scenarios}</tbody></table>
<h3><a href="/402/broken">/402/broken/{flavor}</a></h3>
<p>Malformed 402 responses — except <code>v1-body</code>, which is a spec-valid x402 v1 response served without the v2 header, so what it tests is whether a v2 client can see it at all (observed 2026-08-26: the official <code>@x402/fetch</code> 2.23.0 parses it through its v1 body fallback, then stops with “No client registered for x402 version: 1” — loud, nothing signed; the legacy v1 client signs it happily and gets its 402 back, since nothing under <code>/402/broken</code> ever reads a payment). A client should fail loudly and sign nothing on the rest. The official client does for eight of those nine and signs <code>no-resource</code> anyway.</p>
<pre><code>curl -i "${esc(o)}/402/broken/decimal-amount"</code></pre>
<table><thead><tr><th>flavor</th><th>what you get</th></tr></thead><tbody>${broken}</tbody></table>

<h2>For machines</h2>
<p>The catalogue is an OpenAPI 3.1 document at <a href="/openapi.json">/openapi.json</a>: every operation declares <code>security: []</code> (no API key), and <code>/402/pay</code> alone carries <code>x-payment-info</code>. Short guidance for agents is at <a href="/llms.txt">/llms.txt</a>; a sitemap is at <a href="/sitemap.xml">/sitemap.xml</a>. An agent that wants the real paywall should ask for <code>/402/pay/base</code> and expect a receipt, nothing more. The catalogue is listed on <a href="https://www.x402scan.com/server/2ec99179-1c7e-4e36-9bf3-4fba1d6e904a">x402scan</a> (mainnet paywall plus the free endpoints; x402scan does not list testnets).</p>
<p>Registries that ingest the OpenAPI document store its path templates as URLs, and their probers then request <code>/sse/{flavor}</code> literally, braces and all — 285, 312 and 314 times on 2026-09-05, -06 and -07 here, across all thirteen path templates <a href="/openapi.json">the spec</a> publishes. (A further 0, 10 and 14 requests those days used brace shapes it does not publish, from <code>/402/pay/{network}</code>, which answers, to <code>/nope/{x}</code>, which correctly 404s.) So the documented templates answer for themselves: a catalogue URL whose <code>{placeholder}</code> arrives unsubstituted returns <code>200</code> with the valid values, example URLs and a pointer back to the spec, any method except <code>OPTIONS</code>. Try it: <a href="/sse/%7Bflavor%7D"><code>/sse/{flavor}</code></a>.</p>
<p>The whole catalogue is also available as data: <a href="/corpus.jsonl"><code>/corpus.jsonl</code></a> is one JSON object per line, one line per documented <em>defect</em> behaviour, carrying the URL, the request headers you must send to observe the defect, what the defect is, which RFCs define correct behaviour, whether the bytes are stable enough to pin a digest on, and a ready-to-run capture command. The <a href="/corpus">index</a> lists what is deliberately not a row — the template explainers above are correct behaviour, not defects — and explains the capture traps — chiefly that on <code>/compress</code> what you receive depends on your <code>Accept-Encoding</code>, because the CDN in front of this Worker removes a coding layer you did not ask for.</p>
<p>And what real clients <em>do</em> with it is available as data too: <a href="/clients.jsonl"><code>/clients.jsonl</code></a> is one row per observation, across two families so far — six real HTTP clients and two non-decoding controls against all 21 <code>/compress</code> flavors (captured 2026-09-02), and eight real clients started at every one of the nine <code>/crosshost</code> flavors — eight boundaries and a same-origin control — (captured 2026-09-17). Each row carries the client's version, what it received and what it reported: for <code>/compress</code>, whether the bytes were the documented plaintext; for <code>/crosshost</code>, which of the headers it was sent arrived on the far side of the redirect, on which host, over which transport. This is the only data here that badhttp did not write about itself, and the two paragraphs above about those clients are checkable rather than merely asserted. The <a href="/clients">index</a> counts how many distinct answers each flavor produced — the disagreement is the finding — and states plainly that an outcome describes what the caller received and is never a verdict on the client: on <code>undeclared</code> handing back the bytes unchanged is correct, on <code>truncated</code> the same outcome is the bug, and whether a credential should cross a given redirect boundary is something RFC 9110 does not say.</p>
<p>It also records, in the same file, what badhttp is <em>not</em> a source of. Every response this service emits is <strong>syntactically conformant HTTP/1.1</strong> — 151 endpoints were captured over <code>http/1.1</code> and judged against the RFC 9112 grammar on 2026-09-06, and none violated it. That is a property of the platform, not a choice: Cloudflare re-serializes every response, so no malformed start-line, malformed field-line, obs-fold or conflicting framing header can reach you. If you are building fixtures for the request-smuggling surface, capture them from a raw socket you control, not from anything behind a CDN. badhttp misbehaves one layer up: two endpoints break RFC 9112 §6.3 completeness (<code>/truncate</code>, <code>/sse/drop</code>) and everything else is a semantic defect inside a well-formed message.</p>

<h2>Licence</h2>
<p>Everything this server emits — response heads and bodies, the catalogue documents, every JSON index, <code>/openapi.json</code>, <code>/corpus.jsonl</code> — is <strong>CC0-1.0</strong>: public domain. Capture it, redistribute it, relicense it, sell it, put it in a test corpus under whatever licence you like. No conditions, and attribution is requested rather than required. The Worker source is MIT, which is a different question about a different thing; until 2026-09-06 only that one was stated, and <a href="/openapi.json"><code>info.license</code></a> advertised it in a field that reads as a licence for the API, which is exactly the ambiguity that made someone stop and write to <a href="/license">ask</a>. Full statement, including the parts of a captured response this project did not author and so cannot dedicate: <a href="/license">/license</a>.</p>

<h2>Coming</h2>
<p>Client conformance reports — point the suite at your HTTP client, pay per run via x402, get a scored, dated report of how it handled the catalogue — are the leading candidate for a paid product; the <a href="/books">books</a> fund the timeline. Each addition is a URL that will keep working.</p>

<h2>Who runs this, and on what</h2>
<p>badhttp is built and operated by an AI (Claude) under a charter that caps spending at $${esc(books.budget_per_year)} a year and requires every dollar to be published. Costs, revenue, and the address that accepts payment are on the <a href="/books">books page</a>, updated each session.</p>
<div class="books">
<div><span>spent to date</span><b>${esc(usd(totals.costs))}</b></div>
<div><span>earned to date</span><b>${esc(usd(totals.revenue))}</b></div>
<div><span>net</span><b>${esc(usd(totals.net))}</b></div>
</div>
<p>If badhttp is useful to you, it accepts support on the one rail an AI can operate end to end: USDC on <strong>Base</strong>, to the receive address on the <a href="/books">books</a> — <code>${esc(books.receive_address)}</code> (<a href="https://basescan.org/address/${esc(books.receive_address)}#tokentxns">Basescan</a>; Base network only). A machine can pay the real paywall (<code>/402/pay/base</code>, <code>?amount=</code> up to $1.00) and get a receipt; a human with a wallet can send any amount directly. Either way it appears in the chain reconciliation on the books within minutes and is booked as revenue at the next session — in public, like every other cent this project touches.</p>

<footer>
<p>Stateless: no database, no request logging by this Worker (Workers invocation logs are off, so a discarded <code>PAYMENT-SIGNATURE</code> is not retained by it; Cloudflare's edge keeps sampled request metadata, not headers or bodies), no outbound requests except <code>/402/pay</code>'s calls to an x402 facilitator and <a href="/books">/books</a>' cached reads of two of our own addresses — the receive address's balance and the project payer wallet's balance from a public Base RPC, and the receive address's itemized transfer list from a public Blockscout indexer. One rate limit, at the zone and before this Worker runs: 100 requests per 10 seconds per IP. Past that Cloudflare answers 429 with a text/plain body (<code>error code: 1015</code>) and a <code>Retry-After</code> for 10 seconds. It is not one of the scenarios above; treat it as real.</p>
<p>Source and ledger: private repository for now. Built 2026-08-23. Contact: <a href="mailto:ops@badhttp.dev">ops@badhttp.dev</a> (received and read; never send credentials or secrets by mail either). <a href="/openapi.json">OpenAPI</a> · <a href="/books.json">books.json</a></p>
</footer>`;

  return shell({ title: 'badhttp — the server that misbehaves on purpose', description: 'A stateless catalogue of HTTP edge cases for testing clients, SDKs and agents: slow responses, broken JSON, redirect loops, truncated bodies, flaky endpoints, and x402 paywalls that misbehave.', body });
}

function transfersSection(tr, balanceUsdc) {
  if (!tr) return '';
  if (tr.error) {
    return `
<h3>Every movement, itemized</h3>
<p class="note">${esc(tr.error)}</p>
<pre><code>${esc(tr.reproduce)}</code></pre>`;
  }
  const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
  const when = (ts) => `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC`;
  const rows = tr.items.length
    ? tr.items.map((it) => {
      const other = it.direction === 'out' ? it.to : it.from;
      const alarm = it.label === 'UNEXPLAINED WITHDRAWAL';
      return `<tr><td>${esc(when(it.timestamp))}</td><td class="num">${it.direction === 'out' ? '−' : '+'}${esc(it.amount_usdc)}</td><td><code><a href="https://basescan.org/address/${esc(other)}">${esc(short(other))}</a></code></td><td><code><a href="https://basescan.org/tx/${esc(it.tx)}">${esc(short(it.tx))}</a></code></td><td>${alarm ? '<strong>' : ''}${esc(it.label)}${alarm ? '</strong>' : ''}${it.note ? `<br><span class="note">${esc(it.note)}</span>` : ''}</td></tr>`;
    }).join('')
    : `<tr><td colspan="5" class="note">No movements yet.</td></tr>`;
  const freshness = tr.source === 'stale-cache'
    ? `an edge-cached copy from ${esc(tr.age_seconds)} s ago; a fresh read started in the background`
    : `${tr.age_seconds < 2 ? 'read just now' : 'read ' + esc(tr.age_seconds) + ' s ago'}`;
  const crossCheck = tr.matches_balance === false
    ? `<p class="note">The itemized rows sum to ${esc(tr.itemized_net_usdc)} USDC while the balance above reads ${esc(balanceUsdc ?? 'differently')} — the two sources were read at different moments (indexer lag or cache age). The RPC balance is authoritative; this list catches up within minutes.</p>`
    : '';
  const truncNote = tr.truncated
    ? `<p class="note">Only the newest ${esc(String(tr.items.length))} movements are itemized here (one indexer page per direction); the balance identity above still counts everything. The curl below pages through the rest.</p>`
    : '';
  const dropNote = tr.dropped_invalid_rows
    ? `<p class="note">${esc(String(tr.dropped_invalid_rows))} row${tr.dropped_invalid_rows === 1 ? '' : 's'} from the indexer failed validation and ${tr.dropped_invalid_rows === 1 ? 'is' : 'are'} not shown; this list is incomplete until the indexer answers cleanly.</p>`
    : '';
  const alarm = tr.unexplained_out_count > 0
    ? `<p><strong>${esc(String(tr.unexplained_out_count))} outgoing transfer${tr.unexplained_out_count === 1 ? '' : 's'} ha${tr.unexplained_out_count === 1 ? 's' : 've'} no book entry explaining ${tr.unexplained_out_count === 1 ? 'it' : 'them'}.</strong> Money left the address unrecorded; treat the books as broken until the ledger explains it. That this line can appear — automatically, on the page itself — is the point of publishing the itemization.</p>`
    : '';
  return `
<h3>Every movement, itemized</h3>
<p>Each USDC transfer in or out of the address, from the public Blockscout indexer (${freshness}), labeled from the books by transaction hash. An incoming transfer the books don't know is <em>unbooked</em> (usually: someone just paid, and the next session books it). An outgoing one the books don't explain would be flagged in bold as unexplained — the project holds no key to this address, and this table is how a quiet withdrawal by anyone who does would surface.</p>
<div class="scroll"><table><thead><tr><th>when (UTC)</th><th class="num">usdc</th><th>counterparty</th><th>tx</th><th>label</th></tr></thead><tbody>${rows}</tbody></table></div>
${alarm}${crossCheck}${truncNote}${dropNote}
<p class="note">Reproduce the list yourself (no key needed):</p>
<pre><code>${esc(tr.reproduce)}</code></pre>`;
}

function chainSection(chain, books) {
  if (!chain) return '';
  if (chain.error) {
    return `
<h2>Reconciliation — from chain</h2>
<p class="note">The chain read is unavailable right now: ${esc(chain.error)}. The number this section reads is one <code>eth_call</code> anyone can reproduce:</p>
<pre><code>${esc(chain.reproduce)}</code></pre>${transfersSection(chain.transfers, undefined)}`;
  }
  const tr = chain.transfers;
  // The per-movement claim is earned only when the itemized list actually came back complete and
  // clean; the aggregate identity alone cannot vouch for individual rows.
  const itemizedClean = !!(tr && !tr.error && !tr.truncated && tr.unexplained_out_count === 0 && tr.unbooked_in_count === 0);
  const statusLine = {
    reconciled: `<p><strong>The chain and the books agree.</strong>${itemizedClean ? ' Every movement of the address is accounted for below.' : ''}</p>`,
    unbooked_receipts: `<p><strong>USDC has arrived on chain that is not yet booked above.</strong> Booking happens by hand at the next session — if you just paid or donated: thank you, this line is you.</p>`,
    bookkeeping_bug: `<p><strong>The books account for more USDC than the address holds.</strong> Labeled movements plus booked revenue exceed the balance the RPC reports — either a movement is missing or mislabeled in the books, or money left the address unrecorded. The itemized list below shows which. Treat this as a bookkeeping bug (or reproduce the number below to rule out an RPC fault) until the ledger explains it.</p>`,
  }[chain.status] || '';
  const freshness = chain.source === 'stale-cache'
    ? `an edge-cached copy from ${esc(chain.age_seconds)} s ago; a fresh read started in the background`
    : `${chain.age_seconds < 2 ? 'read just now' : 'read ' + esc(chain.age_seconds) + ' s ago'}, refreshed at most every ${esc(chain.fresh_seconds)} s per edge location`;
  return `
<h2>Reconciliation — from chain</h2>
<p>The project holds no key that can spend from the receive address — from the project's side it is receive-only. The address itself is a normal wallet (the operator holds its key), so every USDC movement in or out of it is public, and each one must be explained by the books: the balance identity here, and the per-transaction labels below. Balance via <code>${esc(chain.rpc)}</code> (${freshness}):</p>
<div class="scroll"><table><tbody>
<tr><td>USDC balance at the receive address</td><td class="num">${esc(chain.balance_usdc)} USDC</td></tr>
<tr><td>− labeled movements, net</td><td class="num">${esc(chain.movements_net_usdc)} USDC</td></tr>
<tr><td>− revenue booked in the table above</td><td class="num">${esc(chain.booked_revenue_usdc)} USDC</td></tr>
<tr><td><strong>= unbooked</strong></td><td class="num"><strong>${esc(chain.unbooked_usdc)} USDC</strong></td></tr>
</tbody></table></div>
<p class="note">Labeled movements: ${esc(chain.movements_in_usdc)} USDC in − ${esc(chain.movements_out_usdc)} USDC out — operator capital passing through, and self-test settlements; each itemized below.</p>
${statusLine}
<p class="note">Reproduce the balance yourself (no key needed):</p>
<pre><code>${esc(chain.reproduce)}</code></pre>${transfersSection(chain.transfers, chain.balance_usdc)}`;
}

// What this project actually consumes, against what Cloudflare's plans include. The point is not
// that hosting is cheap: it is that the $5.00/mo above is an ATTRIBUTION and this section is the
// measurement beside it, so a reader can tell which question each number answers. Both are stated
// because only stating the smaller one would be the flattering half of a true story.
function hostingMeasuredSection(books, u) {
  const m = books.hosting_measured;
  if (!m || !u) return '';
  const pct = (n) => `${n}%`;
  // Thousands separators: this is a page about money and 30000000 is not a readable number.
  // Done with a regex rather than toLocaleString so the page never depends on which Intl data the
  // runtime happens to carry — a books page that 500s is worse than one with ugly numbers.
  const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `
<h3>What it actually uses</h3>
<p class="note">Measured on ${esc(m.measured_on)} over ${esc(String(m.window.days))} days (${esc(m.window.from)} to ${esc(m.window.to)}), from ${esc(m.source)}. Cloudflare's plan figures were read from <a href="${esc(m.plan.source_url)}">their pricing page</a> on ${esc(m.plan.read_on)}.</p>
<table><thead><tr><th>measured</th><th class="num">per 30 days</th><th>against the paid plan's included allowance</th></tr></thead><tbody>
<tr><td>requests<br><span class="note">${esc(n(m.requests))} in the window, ${esc(n(u.requests_per_day))}/day</span></td><td class="num">${esc(n(u.projected_requests_per_month))}</td><td>${esc(pct(u.percent_of_paid_included_requests))} of ${esc(n(m.plan.paid_included_requests_per_month))}</td></tr>
<tr><td>CPU time<br><span class="note">${esc(n(m.cpu_ms))} ms in the window, mean ${esc(String(u.mean_cpu_ms_per_request))} ms per request</span></td><td class="num">${esc(n(u.projected_cpu_ms_per_month))} ms</td><td>${esc(pct(u.percent_of_paid_included_cpu))} of ${esc(n(m.plan.paid_included_cpu_ms_per_month))} ms</td></tr>
<tr><td>subrequests<br><span class="note">the RPC and indexer reads on this page</span></td><td class="num">${esc(n(Math.round(m.subrequests / m.window.days * 30)))}</td><td class="note">not separately metered</td></tr>
<tr><td>egress</td><td class="num">${esc(String(u.projected_egress_gb_per_month))} GB</td><td class="note">Workers does not bill egress</td></tr>
</tbody></table>
<p>So there are two honest answers to &ldquo;what does hosting cost&rdquo;, and they answer different questions. <strong>On the account that already carries the plan</strong> &mdash; the operator's, active before this project existed and covering other work &mdash; this project's usage sits inside the included allowance and the metered charge it adds is <strong>$${esc(u.incremental_hosting_usd_per_year.toFixed(2))}</strong>. <strong>Standing on its own</strong> it would pay the paid plan's floor, <strong>$${esc(u.standalone_hosting_usd_per_year.toFixed(2))}/year</strong> &mdash; because it could not use the free plan at all.</p>
<p class="note">Why not the free plan, when this uses only ${esc(pct(u.percent_of_free_daily_requests))} of its ${esc(n(m.plan.free_requests_per_day))} requests/day? Because the binding limit there is per invocation, not per day. ${esc(u.free_plan_blocker)}</p>
<p class="note">The books charge themselves the larger figure. The charter attributes ~$${esc(String(books.hosting.rate_usd_per_month))}/mo to this project and the accrual above is unchanged by this measurement; publishing the smaller number as the headline would be picking the flattering half of a true story. What this section adds is the basis, which the books did not have until ${esc(m.measured_on)}.</p>`;
}

// Assets against the one bill. This is the whole of "is it self-sustaining?" reduced to a number.
function solvencySection(s, books) {
  if (!s) return '';
  // USDC-derived amounts can carry six decimals; trailing zeros are noise, but never round away a
  // significant digit of a shortfall — $1.655 must not print as $1.65.
  const money = (n) => {
    if (n === null || n === undefined) return '—';
    const s = Number(n).toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return `$${s.includes('.') ? s : `${s}.00`}`;
  };
  const known = s.assets_on_hand_usd !== null;
  const runway = !known
    ? `<p class="note">${esc(s.error || 'The borrowed-capital line is unavailable this request.')}</p>`
    : s.covers_next_bill
      ? `<p class="note">Counting the operator's capital as well, there is enough on hand to pay the renewal, with ${esc(money(s.assets_on_hand_usd - s.next_bill.amount))} to spare. That is a statement about runway, not about earning.</p>`
      : `<p class="note">Counting the operator's capital as well, the total on hand is ${esc(money(s.assets_on_hand_usd))} against ${esc(money(s.next_bill.amount))} &mdash; ${esc(money(s.shortfall_usd))} short. That is a statement about runway, not about earning, and it is the number this section originally led with until two reviewers pointed out that it makes a one-cent service look nearly self-funding.</p>`;
  return `
<h2>Can it pay its own next bill?</h2>
<p class="lede">One bill, one date, one number. Everything else on this page is history; this is the only forward-looking line. Self-sustainability is a claim about money earned from other people, so it is answered here from what the project has earned &mdash; not from what the operator has lent it.</p>
<table><thead><tr><th></th><th class="num">usd</th><th>what this is</th></tr></thead><tbody>
<tr><td><strong>earned, from anyone but this project</strong><br><span class="note">since ${esc(books.project_started)} &mdash; every booked revenue row above</span></td><td class="num"><strong>${esc(s.earned_to_date_usd.toFixed(2))}</strong></td><td class="note">the only column that bears on self-sustainability</td></tr>
${s.next_bill ? `<tr><td><strong>next bill</strong>: ${esc(s.next_bill.item)}<br><span class="note">due ${esc(s.next_bill.due)}, in ${esc(String(s.days_until_next_bill))} days</span></td><td class="num"><strong>${esc(s.next_bill.amount.toFixed(2))}</strong></td><td class="note">registrar API, auto-renew on</td></tr>` : ''}
</tbody></table>
${s.next_bill ? `<p>Earnings cover <strong>${esc(String(s.earned_share_of_next_bill_percent))}%</strong> of the next bill. On its own record this service does <strong>not</strong> pay for itself, and nothing in the measurements above changes that &mdash; the cost side is small, the earned side is one cent.</p>` : ''}
<h3>What is actually on hand, and whose it is</h3>
<table><thead><tr><th>held</th><th class="num">usd</th><th>how this figure is known</th></tr></thead><tbody>
<tr><td>USDC on Base at the project's payer wallet<br><span class="note"><code><a href="https://basescan.org/address/${esc(s.payer_address)}#tokentxns">${esc(s.payer_address)}</a></code> &mdash; ${esc(s.payer_note)}</span></td><td class="num">${esc(s.payer_usdc === null ? '—' : s.payer_usdc.toFixed(6))}</td><td class="note">${s.error ? 'unavailable this request' : `read from chain ${esc(String(s.age_seconds))} s ago (${esc(s.source)})`}</td></tr>
<tr><td>Porkbun account credit<br><span class="note">${esc(s.registrar_credit_note)}</span></td><td class="num">${esc(s.registrar_credit_usd.toFixed(2))}</td><td class="note">stated, dated ${esc(s.registrar_credit_dated)} &mdash; not a live read</td></tr>
<tr><td><strong>total on hand</strong><br><span class="note">both rows are the operator's money: capital they sent the project and credit they bought</span></td><td class="num"><strong>${esc(known ? s.assets_on_hand_usd.toFixed(6) : '—')}</strong></td><td class="note">runway, not revenue</td></tr>
</tbody></table>
${runway}
<p class="note">The payer balance is read from chain on every render rather than typed here, for the same reason hosting accrues on a clock: a figure a human has to remember to update is one that goes quietly wrong. Reproduce it: <code>${esc(s.reproduce)}</code>. The registrar credit is the one number on this page nobody can verify &mdash; Porkbun publishes no balance endpoint &mdash; so it is dated rather than asserted.</p>
<p class="note">${esc(s.conversion_rail)}</p>`;
}

export function booksPage(books, totals, version, chain, usage, solv) {
  const rows = (items) => items.length
    ? items.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.item)}${c.note ? `<br><span class="note">${esc(c.note)}</span>` : ''}</td><td class="num">${esc(usd(c.amount))}</td></tr>`).join('')
    : `<tr><td colspan="3" class="note">Nothing yet.</td></tr>`;
  const body = `
<header>
<h1><a href="/">badhttp</a> <span class="pill">books</span></h1>
<p class="tag">every dollar, in public</p>
<p class="lede">This service is run by an AI with a budget of $${esc(books.budget_per_year)} per year and an obligation to publish its accounts. One-off costs and booked revenue are maintained by hand each session and must match the project ledger line for line; hosting accrues on a clock and is computed here, with its arithmetic printed beside it, because a figure that goes stale on a date is one nobody is obliged to notice. The receive address's balance and every one of its transfers are read from chain below (cached briefly at the edge) and reconciled against them, so an unbooked payment — or a bookkeeping error, or a withdrawal — normally shows here before any human touches the books.</p>
</header>
<div class="books">
<div><span>spent to date</span><b>${esc(usd(totals.costs))}</b></div>
<div><span>earned to date</span><b>${esc(usd(totals.revenue))}</b></div>
<div><span>net</span><b>${esc(usd(totals.net))}</b></div>
</div>
<p class="note">Budget: $${esc(books.budget_per_year)}/year, all-in. &ldquo;Spent to date&rdquo; is cumulative since the project started on ${esc(books.project_started)}, not a figure against that annual cap &mdash; it grows by $${esc(books.hosting.rate_usd_per_month)} of accrued hosting every month, so the two are only comparable in the first year. Books last updated ${esc(books.updated)}.</p>

<h2>Costs</h2>
<table><thead><tr><th>date</th><th>item</th><th class="num">usd</th></tr></thead><tbody>${rows(books.costs)}<tr><td>${esc(books.hosting.since)} →</td><td>${esc(books.hosting.item)}, ${esc(totals.hosting_months)} month${totals.hosting_months === 1 ? '' : 's'} accrued<br><span class="note">${esc(totals.hosting_months)} × ${esc(usd(books.hosting.rate_usd_per_month))} = ${esc(usd(totals.hosting_accrued))}. ${esc(books.hosting.basis)} Next accrual ${esc(totals.next_accrual)}.</span></td><td class="num">${esc(usd(totals.hosting_accrued))}</td></tr></tbody></table>
<p class="note">This row is the only cost <em>entry</em> computed from the clock rather than typed by hand — and so, through it, are &ldquo;spent to date&rdquo; and &ldquo;net&rdquo; above. It was a fixed <code>$5.00</code> until 2026-09-08, which would have understated the project's own costs from 2026-09-23 with nothing obliged to notice. The arithmetic is above so you can redo it; <a href="/books.json">books.json</a> carries <code>hosting.basis</code>, <code>totals.hosting_months</code>, <code>totals.hosting_accrued</code> and <code>totals.next_accrual</code> as data.</p>
${books.commitments && books.commitments.length ? `<h3>Committed, not yet spent</h3>
<table><thead><tr><th>due</th><th>item</th><th class="num">usd</th></tr></thead><tbody>${books.commitments.map((c) => `<tr><td>${esc(c.due)}</td><td>${esc(c.item)}${c.note ? `<br><span class="note">${esc(c.note)}</span>` : ''}</td><td class="num">${esc(usd(c.amount))}</td></tr>`).join('')}</tbody></table>
<p class="note">Not included in "spent to date", which is spend that has actually happened.</p>` : ''}
${hostingMeasuredSection(books, usage)}

<h2>Revenue</h2>
<table><thead><tr><th>date</th><th>item</th><th class="num">usd</th></tr></thead><tbody>${rows(books.revenue)}</tbody></table>
${chainSection(chain, books)}
${solvencySection(solv, books)}
<h2>Paying for it</h2>
${books.receive_address
  ? `<p>USDC on <strong>Base</strong> (chain id 8453), by direct transfer or x402. Send on the Base network only.</p><pre><code>${esc(books.receive_address)}</code></pre><p class="note">Verify on chain: <a href="https://basescan.org/address/${esc(books.receive_address)}#tokentxns">basescan.org</a>.</p>`
  : `<p>There is no payment address yet. When one exists it will be published here and nowhere else; if you see a badhttp address anywhere other than this page, it is not ours.</p>`}
<p class="note">Donations are welcome and are booked as revenue. No tokens, no custody, no accounts.</p>

<footer><p><a href="/">catalogue</a> · <a href="/books.json">books.json</a> · v${esc(version)}</p></footer>`;
  return shell({ title: 'badhttp — books', description: 'Public accounts for badhttp: every cost and every dollar of revenue.', body });
}

// A compact rounded square with a bent-over "?" stroke: the server that misbehaves. Dark on light, light on dark.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#b5421f"/><text x="16" y="23" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="19" font-weight="700" fill="#fbfaf7">4!</text></svg>`;

// llms.txt (llmstxt.org): one H1, a blockquote, a few facts, H2 link lists. Kept short on purpose; /openapi.json has the detail.
export function llmsTxt({ origin, version, limits, x402Limits }) {
  const o = origin;
  return `# badhttp

> The server that misbehaves on purpose: a free, stateless catalogue of HTTP edge-case endpoints (slow responses, broken JSON, redirect loops, truncated bodies, flaky failures, SSE streams, range requests, conditional requests, Set-Cookie headers, HTTP authentication and content codings that misbehave) for testing HTTP clients, SDKs and agents, plus x402 paywalls (v2 and v1 in the same responses), one real and several that misbehave.

Version ${version}. No signup, no API key, nothing stored about callers (the only cross-request state is edge-cached copies of our own on-chain balances and transfer list for /books). This Worker writes no logs and Workers invocation logs are off, but Cloudflare's edge keeps sampled traffic analytics (client IP, path, user agent) as for any Cloudflare zone, so keep secrets out of URLs. Every endpoint is deterministic unless the page says otherwise. Limits: /delay at most ${limits.delayMaxSeconds} s, /drip at most ${limits.dripMaxSeconds} s and ${limits.dripMaxChunks} chunks, /echo reads the first ${limits.echoMaxBodyBytes / 1024} KB, /redirect at most ${limits.redirectMaxHops} hops, /sse streams at most ${limits.sseMaxSeconds} s, /range documents at most ${limits.rangeMaxBytes} bytes and ${limits.rangeMaxParts} ranges per request, /cookies at most ${limits.cookiesMaxCount} cookies per response from /cookies/many (the /cookies/delete cleanup sends 45 expirations) and ${limits.cookiesMaxBytes} bytes of cookie name+value (the Set-Cookie header itself runs ~30 bytes longer), /compress documents at most ${limits.compressMaxBytes} bytes and /compress/bomb at most ${limits.compressBombMaxMiB} MiB inflated. Redirect targets come from a fixed table of two hosts this project owns, badhttp.dev and alt.badhttp.dev: no endpoint accepts a redirect target, or any part of one, from the caller, so there is no open redirect here. Rate limit: 100 requests per 10 s per IP, enforced at the zone before the Worker runs; Cloudflare answers 429 (text/plain, error code 1015) with Retry-After. A documented path template requested literally with the braces intact (e.g. ${o}/sse/{flavor}) answers 200 with the valid values for the placeholder, any method except OPTIONS.

Payment: only ${o}/402/pay settles anything (x402, USDC, EIP-3009; price ${x402Limits.minUsd}–${x402Limits.maxUsd} USD via ?amount=, default ${x402Limits.defaultUsd}). Its 402 speaks both protocol generations at once: x402 v2 in the PAYMENT-REQUIRED header, and a spec-valid x402 v1 body (plain network names, maxAmountRequired) for older clients that only read bodies; pay with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) and the receipt arrives in PAYMENT-RESPONSE or X-PAYMENT-RESPONSE respectively. The 402 names Base Sepolia (test USDC, free); ${o}/402/pay/base (or ?network=base) is the same paywall for real USDC on Base mainnet. You get a 200 with a receipt and the transaction hash, nothing else; settlement is verified end to end with both client generations on BOTH networks (2026-08-28; the mainnet proof was a project-funded self-test, booked as working capital, not revenue — transaction hashes in GET ${o}/402's "verified" object). The first payment from someone else arrived 2026-09-01: 0.01 USDC on Base from nohumans.directory's paying scout, booked as revenue on ${o}/books with its transaction hash. Every other /402 scenario is a paywall that misbehaves on purpose and never charges; do not expect them to succeed. One exception to the dual-form rule: /402/wrong-network's 402 body stays v2-shaped (v1 cannot name its nonexistent chain), and the body's no_v1_form field says why.

Operated by an AI under a published charter; every cost and every dollar of revenue is at ${o}/books.json. Contact: ops@badhttp.dev (received and read). Support is welcome on the one rail the AI operates end to end: pay ${o}/402/pay/base (?amount= up to ${x402Limits.maxUsd} USD) or send USDC on Base directly to the receive address on ${o}/books — either lands in the public chain reconciliation within minutes and is booked as revenue.

## Catalogue

- [OpenAPI 3.1](${o}/openapi.json): every endpoint, parameter and response; free operations carry security: [], the paid one carries x-payment-info
- [Home page](${o}/): the same catalogue for humans, with curl examples
- [Status codes](${o}/status/429?retry-after=3): /status/{code}, or a comma-separated list to pick from at random
- [Delay](${o}/delay/2): /delay/{seconds}
- [Drip](${o}/drip?duration=5&chunks=10): a slow chunked body
- [Flaky](${o}/flaky/50): /flaky/{percent}, deterministic with ?seed=&i=
- [Bad JSON](${o}/badjson): /badjson/{flavor}; GET /badjson lists the flavors
- [Truncate](${o}/truncate?length=1000&send=500): Content-Length lies, then the connection closes
- [Event streams](${o}/sse): /sse/{flavor}; GET /sse lists the flavors; any request with Last-Event-ID gets 204 except /sse/resume
- [Ranges](${o}/range): /range/{flavor}; resumable downloads that misbehave over a self-describing document (64-byte lines, each starting with its own offset); ?length= up to ${limits.rangeMaxBytes} bytes
- [Conditional requests](${o}/etag): /etag/{flavor}; validators that lie, cache-control: no-cache so a real cache revalidates every use
- [Cookies](${o}/cookies): /cookies/{flavor}; Set-Cookie edge cases (folded headers, duplicate names, prefixes, supercookies, unparseable dates); /cookies/echo reads back the Cookie header as it reached the Worker
- [Authentication](${o}/auth): /auth/{flavor}; challenges and credential checks that misbehave (a 401 with no challenge, unknown schemes, multi-challenge headers, always-reject, accept-anything, the Digest stale dance, a 407 from an origin). The ONLY accepted credentials are the published fake ones (user "agent", password "correct"; Bearer badhttp-token-ok) — NEVER send real credentials or point a credential store at this host; /auth/accept-any returns authenticated:true for ANY value and that answer means nothing. Anything received is compared in memory and discarded, never stored, logged or echoed. Any method; the request body is never read.
- [Content codings](${o}/compress): /compress/{flavor}; Content-Encoding that misbehaves (gzip declared on plain text, gzip with no header, streams that are truncated, corrupt, CRC-wrong, concatenated, gzipped twice or followed by junk, raw DEFLATE as "deflate", the x-gzip alias, GZIP in capitals, an unknown coding, an empty gzip body, a compressed body under the plaintext's Content-Length, a .gz download also transport-encoded, a declared decompression bomb; br, zstd and deflate; ok is the control; ?code= makes any of them an error body). Send Accept-Encoding: gzip (br, zstd for those) to receive the bytes as sent: Cloudflare's edge removes one coding layer it recognizes (gzip, br, zstd) unless your Accept-Encoding lists it, transcoding to identity, lossily for broken streams, and passes codings it does not know through — the index's edge_transcoding says what each flavor became. x-badhttp-plain-bytes / x-badhttp-plain-sha256 let you verify what you decoded
- [Redirects](${o}/redirect/3): /redirect/{hops} and /redirect/loop
- [Credentials across a host boundary](${o}/crosshost): /crosshost/{flavor}; what your client does with Authorization, Proxy-Authorization, Cookie and X-Api-Key when a redirect crosses to a DIFFERENT HOST. Two hosts, badhttp.dev and alt.badhttp.dev, same Worker and same zone certificate, so the boundary is real DNS and a real certificate rather than a loopback listener — which matters because you cannot observe this from 127.0.0.1: an SSRF filter rejects a loopback target at hop zero and the code under test never runs. Flavors cross apex-to-subdomain, subdomain-to-apex, out-and-back, http-to-https and https-to-http, plus a cookie-jar scoping hop. THERE IS NO OPEN REDIRECT: targets come from a frozen table of those two hosts selected by flavor name, no endpoint accepts a redirect target or any part of one from the caller, and every Location is checked against a fixed pattern before it is sent. The landing endpoint NEVER echoes what you sent — not the value, not a prefix, not a hash — only presence, the scheme when it is one it recognizes, and a byte length; cookie names are listed only for cookies this server itself set. Use the published fake credentials (agent/correct, Bearer badhttp-token-ok, X-Api-Key badhttp-key-ok) and nothing else. Two flavors do not start on https://badhttp.dev: from-subdomain starts on alt.badhttp.dev and scheme-upgrade starts over plaintext http, because the direction and the scheme are the measurement. Every response carries x-badhttp-version; a response without it is Cloudflare's rate-limit 429, not a badhttp answer, and is not an observation.
- [Headers](${o}/headers): your request headers as JSON
- [Echo](${o}/echo): method, path, query, headers and the first 16 KB of body, reflected back (POST, PUT, PATCH, DELETE)

## Payment (x402)

- [Index](${o}/402): networks, price limits, pay-to address, facilitators, what has been verified live
- [Pay](${o}/402/pay): the real paywall, test USDC on Base Sepolia
- [Pay on Base mainnet](${o}/402/pay/base): the same paywall for real USDC
- [Misbehaving paywalls](${o}/402): /402/never, /402/reject, /402/slow, /402/crash, /402/bad-receipt, /402/overpriced, /402/wrong-network
- [Malformed 402s](${o}/402/broken): /402/broken/{flavor}

## Optional

- [Books](${o}/books.json): public accounts, machine-readable; the \`chain\` object reconciles the receive address's live on-chain USDC balance against booked revenue (labeled non-revenue movements excluded) and \`chain.transfers\` itemizes every USDC movement of the address in both directions, each labeled from the books by tx hash — so an unbooked payment, a bookkeeping error, or an unexplained withdrawal is visible before any human touches the books. The project holds no key that can spend from the address; the operator does. Two figures beside the tables answer questions the books used to leave to assertion: \`hosting_measured\` and \`hosting_usage\` publish what this Worker actually consumes against Cloudflare's published allowances (so the reader can see that the $5/mo hosting line is the charter's attribution, what the project would pay standing alone, and what it adds to a bill that already exists — all three), and \`solvency\` reads the project's payer wallet live and sets it against the next bill, which is the whole self-sustainability question as one number
- [Corpus](${o}/corpus.jsonl): the catalogue of defects as one flat NDJSON file, one row per documented defect behaviour (the template explainers and the discovery surfaces are deliberately not rows; \`what_is_not_a_row\` on the index says so) — url, request headers to send, the defect, the RFCs, whether the bytes are stable enough to pin a digest on, and a ready-to-run capture curl. [Index and capture notes](${o}/corpus). Read the \`rfc9112_message_syntax\` object before capturing: this service emits NO RFC 9112 message-syntax violations and cannot (a CDN re-serializes every response), so it is not a source of malformed start-lines, malformed field-lines or request-smuggling fixtures; its defects live one layer up
- [Client observations](${o}/clients.jsonl): what real HTTP clients actually did, one NDJSON row per observation, two families so far: six decoding clients and two non-decoding controls against all 21 \`/compress\` flavors (dated 2026-09-02), and eight clients started at each of the nine \`/crosshost\` flavors, eight boundaries and a same-origin control (dated 2026-09-17) — which of the headers each was sent arrived after the redirect, on which host, over which transport. Each row carries the client's version. The only data here this project did not author about itself; \`corpus_id\` joins each row back to the corpus and \`family\` names the legend that applies. [Index, per-family outcome legends and the per-flavor disagreement count](${o}/clients). Read \`reading_this\` first: the \`outcome\` field describes what the caller received, and is never a verdict on the client
- [Health](${o}/health): liveness
- [Sitemap](${o}/sitemap.xml)

## Licence

Everything this server emits — response heads and bodies, the catalogue documents, every JSON index, /openapi.json, this file — is **CC0-1.0** (public domain dedication): capture it, store it, redistribute it, relicense it, put it in a test corpus under any licence you like. No conditions and no attribution required; a link back is welcome and is not a condition. The Worker source is MIT, which is a different question about a different thing. Full statement, including the parts of a captured response this project did not author and so cannot dedicate: [${o}/license](${o}/license).
`;
}

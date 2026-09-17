# /compress witnesses

Real HTTP clients with their default Accept-Encoding and decoding, run against every /compress flavor.
Each prints one line per flavor: status | Content-Encoding as the client saw it | bytes/declared |
SHA-256 verdict against x-badhttp-plain-sha256 | error. The dated output lives in
docs/probe-compress-clients-YYYY-MM-DD.txt; the home page's "checked live with six real clients" note is
written from it. Run them sequentially (the zone rate limit is shared):

    ./curl.sh https://badhttp.dev
    node node-fetch.mjs https://badhttp.dev
    python3 -m venv .venv && .venv/bin/pip install requests 'httpx[brotli,zstd]' && .venv/bin/python py-clients.py https://badhttp.dev all
    ruby ruby-nethttp.rb https://badhttp.dev
    go run go-nethttp.go https://badhttp.dev

#!/bin/zsh
# Witness: curl --compressed (this build: zlib only, so it advertises "deflate, gzip" and decodes those).
B="${1:-https://badhttp.dev}"; T=$(mktemp -d)
echo "# $(curl --version | head -1 | cut -d' ' -f1-3), --compressed sends Accept-Encoding: $(curl -s --compressed "$B/compress" | /usr/bin/jq -r '.accept_encoding.as_the_edge_reports_it')"
for f in ok br zstd deflate not-compressed undeclared truncated corrupt bad-crc trailing-garbage multi-member double double-hidden deflate-raw unknown-coding uppercase x-gzip empty wrong-length gzip-file bomb; do
  curl -s --compressed -m 60 -D $T/h -o $T/b "$B/compress/$f"; rc=$?
  code=$(head -1 $T/h | awk '{print $2}')
  ce=$(tr -d '\r' < $T/h | awk 'tolower($1)=="content-encoding:"{sub(/^[^:]*: /,""); print}' | tail -1)
  want=$(tr -d '\r' < $T/h | awk 'tolower($1)=="x-badhttp-plain-sha256:"{print $2}' | tail -1)
  wl=$(tr -d '\r' < $T/h | awk 'tolower($1)=="x-badhttp-plain-bytes:"{print $2}' | tail -1)
  n=$(wc -c < $T/b | tr -d ' '); got=$(shasum -a 256 $T/b | cut -c1-64); first=$(head -c 2 $T/b | od -An -tx1 | tr -d ' \n')
  if [ -n "$want" ]; then if [ "$got" = "$want" ]; then v=SHA-OK; else v="sha-DIFF(first=$first)"; fi; else if [ "$n" = "$wl" ]; then v=LEN-OK; else v=len-DIFF; fi; fi
  echo "$f | $code | ce=[$ce] | bytes=$n/$wl | $v | exit=$rc"
  sleep 0.3
done
rm -rf $T

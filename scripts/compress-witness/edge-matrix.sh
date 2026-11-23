#!/bin/zsh
# The /compress EDGE probe matrix: every flavor x a fixed set of client Accept-Encoding values, one request each,
# printed in the column layout of docs/probe-compress-2026-09-01.txt plus the set the edge reported to the Worker
# (x-badhttp-negotiated-from, on `ok`). Written in session 38 (2026-11-23) when the edge began treating q=0 as a
# refusal; re-run it whenever a compress pin in scripts/smoke.sh fails, and commit the output as
# docs/probe-compress-edge-YYYY-MM-DD.txt.
#
#   scripts/compress-witness/edge-matrix.sh https://badhttp.dev > docs/probe-compress-edge-$(date -u +%F).txt
#
# Sequential on purpose (a sequential loop never trips the zone rate limit). Needs gzip, brotli and zstd.
setopt noglob
B=${1:?base url}
export LC_ALL=C
T=$(mktemp -d); trap 'rm -rf $T' EXIT
FLAVORS=(ok br zstd deflate not-compressed undeclared truncated corrupt bad-crc trailing-garbage multi-member double double-hidden deflate-raw unknown-coding uppercase x-gzip empty wrong-length gzip-file bomb)
AES=('(absent)' '' '*' 'identity' 'gzip' 'gzip, deflate, br, zstd' 'br' 'zstd' 'deflate' 'x-gzip' 'GZIP' 'gzip;q=0' 'gzip;q=0.0' 'gzip;q=0.001' 'x-gzip;q=0' 'br;q=0' 'gzip;q=0, br' 'identity;q=0' 'gzip, identity;q=0' '*;q=0' 'br;q=0.5, gzip;q=0, x-gzip, *, foo')
echo "# /compress edge probe matrix against $B, $(date -u +%FT%TZ), from one client location (cf-ray colo shown per block)."
echo "# Columns: flavor, client Accept-Encoding (ae; (absent) = no header, '' = empty value), curl exit, status, content-encoding as"
echo "# received, content-length, wire bytes, first 4 bytes, declared plaintext bytes, local decode by the received coding, SHA-256 vs"
echo "# x-badhttp-plain-sha256, Vary, and on ok the set the edge reported to the Worker (x-badhttp-negotiated-from)."
for proto in --http1.1 --http2; do
  echo; echo "################ $proto"
  for f in "${FLAVORS[@]}"; do
    url="$B/compress/$f"; [ $f = wrong-length ] && url="$url?length=4096"
    for ae in "${AES[@]}"; do
      # curl: "Name:" removes a header (and curl sends no Accept-Encoding by default); "Name;" sends it with an empty value.
      if [ "$ae" = '(absent)' ]; then h=(-H 'Accept-Encoding:'); elif [ -z "$ae" ]; then h=(-H 'Accept-Encoding;'); else h=(-H "Accept-Encoding: $ae"); fi
      curl -s $proto $h -D $T/h -o $T/b "$url"; rc=$?
      tr -d '\r' < $T/h > $T/hh
      hv(){ awk -v k="$1" 'tolower($1)==k":"{sub(/^[^:]*: */,""); v=$0} END{print v}' $T/hh; }
      st=$(awk 'NR==1{print $2}' $T/hh); ce=$(hv content-encoding); cl=$(hv content-length); vary=$(hv vary); plain=$(hv x-badhttp-plain-bytes); psha=$(hv x-badhttp-plain-sha256); neg=$(hv x-badhttp-negotiated-from); ray=$(hv cf-ray)
      wire=$(wc -c < $T/b | tr -d ' '); first=$(head -c 4 $T/b | od -An -tx1 | tr -d ' \n')
      case "$ce" in
        gzip|x-gzip|GZIP) gzip -dc < $T/b > $T/d 2>/dev/null; dec="gzip:$?";;
        br) brotli -dc < $T/b > $T/d 2>/dev/null; dec="br:$?";;
        zstd) zstd -dcq < $T/b > $T/d 2>/dev/null; dec="zstd:$?";;
        '') cp $T/b $T/d; dec=identity;;
        *) cp $T/b $T/d; dec="undecoded($ce)";;
      esac
      if [ -n "$psha" ]; then [ "$(shasum -a 256 < $T/d | cut -c1-64)" = "$psha" ] && sha=SHA-OK || sha=sha-DIFF; else sha=no-sha; fi
      printf '%-17s %-38s rc=%-2s %s ce=[%s] cl=[%s] wire=%s first=%s plain=%s dec=%s %s vary=[%s]%s colo=%s\n' "$f" "ae=$ae" $rc "$st" "$ce" "$cl" $wire "$first" "$plain" "$dec" $sha "$vary" "${neg:+ neg=[$neg]}" "${ray##*-}"
    done
  done
done

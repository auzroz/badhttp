#!/bin/zsh
# Tell IndexNow-participating search engines (Bing, Yandex, Naver, Seznam) that our pages changed. Google does not take part.
# Proves host control by serving the key at /{key}.txt (src/index.js). Run after a deploy. Usage: scripts/indexnow.sh [origin]
O="${1:-https://badhttp.dev}"; H="${O#https://}"
set -a; source "$(dirname "$0")/../.env"; set +a
K="$INDEXNOW_KEY"; [ -n "$K" ] || { echo "INDEXNOW_KEY missing from .env (it must also be a Worker secret: wrangler secret put INDEXNOW_KEY)"; exit 1; }
[ "$(curl -s "$O/$K.txt" | tr -d '\n')" = "$K" ] || { echo "key file not served at $O/$K.txt (is the Worker secret set?)"; exit 1; }
curl -s -o /dev/null -w 'indexnow: HTTP %{http_code} (200/202 = accepted)\n' -X POST https://api.indexnow.org/indexnow -H 'content-type: application/json; charset=utf-8' \
  -d "{\"host\":\"$H\",\"key\":\"$K\",\"keyLocation\":\"$O/$K.txt\",\"urlList\":[\"$O/\",\"$O/books\",\"$O/badjson\",\"$O/sse\",\"$O/range\",\"$O/etag\",\"$O/cookies\",\"$O/402\",\"$O/openapi.json\",\"$O/llms.txt\"]}"

#!/bin/zsh
# Register (or re-register) badhttp's x402 resources on x402scan.com from its OpenAPI document.
# x402scan probes the one paid operation (/402/pay must answer a valid 402) and lists the `security: []`
# operations beside it as free rows. Same call the site's own "register" form makes; no account, no key, no identity.
# Usage: scripts/x402scan-register.sh [origin]     (default https://badhttp.dev)
O="${1:-https://badhttp.dev}"
echo "discovery check:"
curl -s -m 60 -G "https://www.x402scan.com/api/trpc/public.resources.checkDiscovery" --data-urlencode "input={\"json\":{\"origin\":\"$O\"}}" | jq -c '.result.data.json | {found, source, resourceCount}'
echo "register from origin:"
curl -s -m 180 -X POST "https://www.x402scan.com/api/trpc/public.resources.registerFromOrigin" -H 'content-type: application/json' -d "{\"json\":{\"origin\":\"$O\"}}" \
  | jq -c '.result.data.json | {success, registered, siwx, publicCount, originId, failed: [.failedDetails[]? | {url, error}], error}'

#!/bin/zsh
# The session ritual's "state found" paragraph, as one command (LEDGER.md session 28).
# Usage: scripts/state-check.sh            public facts only (no credentials needed)
#        scripts/state-check.sh --cred     also traffic (Cloudflare GraphQL) and the registrar, sourcing .env
# Prints derived facts only; never a credential, account id or zone id. Addresses come from LEDGER.md, never from .env.
# Does not run the smoke suite (run scripts/smoke.sh separately, and never two suites at once: one IP, one rate limit).
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH"
JQ=/usr/bin/jq; B=https://badhttp.dev
RECEIVE=0x2b14ad50d63c7fee5a33847f95153ac37a690170      # receive address (public by design)
PAYER=0xa4A3E7857bE6b14F9e2570Af6805bDd183CDfE5a        # mainnet self-test payer (public by design)
PAYER_SEPOLIA=0x29f4C6323fED771F7cDBBA6c3deE3d4A002A273D
USDC_BASE=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
USDC_SEPOLIA=0x036CbD53842c5426634e7929541eC2318f3dCF7e

say(){ printf '\n--- %s\n' "$1"; }

say "git"; git status --short | head -5; git log --oneline -1
say "node_modules"; [ -x node_modules/.bin/wrangler ] && echo present || echo "MISSING (npm ci)"
say "live"; curl -s -m 10 $B/health | $JQ -c '{ok, version}'
say "books"; curl -s -m 20 $B/books.json | $JQ -c '{updated, chain_status: .chain.status, balance: .chain.balance_usdc, unbooked: .chain.unbooked_usdc, unexplained_out: .chain.unexplained_out_count, costs: .totals.costs, revenue: .totals.revenue, hosting_months: .totals.hosting_months, next_accrual: .totals.next_accrual}'

say "balances (USDC; from public RPCs; addresses from the ledger)"
bal(){ local data="0x70a08231000000000000000000000000${3#0x}"
  local hex=$(curl -s -m 12 -H 'Content-Type: application/json' "$1" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$2\",\"data\":\"$data\"},\"latest\"]}" | $JQ -r '.result // empty')
  [ -n "$hex" ] && printf '%-16s %s\n' "$4" "$(node -e "console.log((Number(BigInt('$hex'))/1e6).toFixed(6))")" || printf '%-16s rpc-unavailable\n' "$4"; }
bal https://mainnet.base.org $USDC_BASE $RECEIVE receive-mainnet
bal https://mainnet.base.org $USDC_BASE $PAYER payer-mainnet
bal https://sepolia.base.org $USDC_SEPOLIA $RECEIVE receive-sepolia
bal https://sepolia.base.org $USDC_SEPOLIA $PAYER_SEPOLIA payer-sepolia

say "facilitators (/supported)"
for f in $(curl -s -m 10 $B/402 | $JQ -r '.facilitators.base[], .facilitators["base-sepolia"][]' | sort -u); do printf '%-45s %s\n' $f "$(curl -s -m 8 -o /dev/null -w '%{http_code}' $f/supported)"; done
say "mainnet facilitator order (CDP first means the operator stored the CDP secrets)"; curl -s -m 10 $B/402 | $JQ -c '.facilitators.base'

say "catalogues and directories"
printf 'payai listing  '; curl -s -m 15 'https://facilitator.payai.network/discovery/listing-status?resource=https%3A%2F%2Fbadhttp.dev%2F402%2Fpay%2Fbase' | $JQ -c '{listed, hidden, probe: .lastProbe.status, lastWrite: .lastWrite.source}' 2>/dev/null || echo unavailable
printf 'payai stats    '; curl -s -m 15 'https://facilitator.payai.network/discovery/resources/https%3A%2F%2Fbadhttp.dev%2F402%2Fpay%2Fbase/stats' | $JQ -c '{settlements, buyers}' 2>/dev/null || echo unavailable
printf 'nohumans       '; curl -s -m 15 https://nohumans.directory/v1/listings/133b72cc-19f | $JQ -c '{status, paid_verified, probe_count}' 2>/dev/null || echo unavailable
printf 'x402-list      '; curl -s -m 15 'https://x402-list.com/api/v1/services?q=badhttp' | $JQ -c '.data[0] | {slug, status, verified, payment_ready}' 2>/dev/null || echo unavailable
printf 'agent-tools    '; curl -s -m 15 'https://agent-tools.cloud/api/v1/services/badhttp-dev-scan' | $JQ -c '{slug, url, owner_verified}' 2>/dev/null || echo unavailable
printf '402index       '; curl -s -m 15 'https://402index.io/api/v1/services/679c711d-cf5e-4c85-8bc0-b7683837cbe7' | $JQ -c '{name, status, health_status, probe_status}' 2>/dev/null || echo unavailable

say "testnet receipts (Blockscout Sepolia; anything newer than the ledger's last noted one is a new external testnet payer, never revenue)"
curl -s -m 25 "https://base-sepolia.blockscout.com/api/v2/addresses/$RECEIVE/token-transfers?type=ERC-20&filter=to" | $JQ -c '.items[]? | select(.token.symbol=="USDC") | {t: .timestamp, from: .from.hash, v: .total.value, tx: .transaction_hash}' 2>/dev/null | head -5

if [ "$1" = "--cred" ]; then
  set -a; source .env; set +a
  MYIP=$(curl -s -m 10 https://api.ipify.org)
  ZONE=$(curl -s -m 15 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 'https://api.cloudflare.com/client/v4/zones?name=badhttp.dev' | $JQ -r '.result[0].id')
  say "traffic (own IP excluded, /__internal/% filtered; today and the previous 3 days)"
  for i in 3 2 1 0; do
    d=$(date -u -v-${i}d +%Y-%m-%d)
    Q="{\"query\":\"{ viewer { zones(filter:{zoneTag:\\\"$ZONE\\\"}) { total: httpRequestsAdaptiveGroups(limit:1, filter:{date:\\\"$d\\\", clientIP_neq:\\\"$MYIP\\\", clientRequestPath_notlike:\\\"/__internal/%\\\"}) { count } r429: httpRequestsAdaptiveGroups(limit:1, filter:{date:\\\"$d\\\", clientIP_neq:\\\"$MYIP\\\", clientRequestPath_notlike:\\\"/__internal/%\\\", edgeResponseStatus:429}) { count } pay200: httpRequestsAdaptiveGroups(limit:20, filter:{date:\\\"$d\\\", clientRequestPath_like:\\\"/402/pay%\\\", edgeResponseStatus:200}) { count dimensions { clientRequestPath userAgent clientCountryName } } ua: httpRequestsAdaptiveGroups(limit:6, orderBy:[count_DESC], filter:{date:\\\"$d\\\", clientIP_neq:\\\"$MYIP\\\", clientRequestPath_notlike:\\\"/__internal/%\\\"}) { count dimensions { userAgent } } } } }\"}"
    R=$(curl -s -m 30 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' https://api.cloudflare.com/client/v4/graphql -d "$Q")
    echo "$d total=$(echo "$R" | $JQ -r '.data.viewer.zones[0].total[0].count // 0') r429=$(echo "$R" | $JQ -r '.data.viewer.zones[0].r429[0].count // 0')"
    echo "$R" | $JQ -c '.data.viewer.zones[0].pay200[]? | {pay200: .dimensions.clientRequestPath, ua: .dimensions.userAgent, cc: .dimensions.clientCountryName, n: .count}'
    echo "$R" | $JQ -c '[.data.viewer.zones[0].ua[]? | {ua: .dimensions.userAgent[0:40], n: .count}]'
    echo "$R" | $JQ -c '.errors // empty'
  done
  say "registrar"
  curl -s -m 20 -X POST https://api.porkbun.com/api/json/v3/domain/listAll -H 'Content-Type: application/json' \
    -d "{\"apikey\":\"$PORKBUN_API_KEY\",\"secretapikey\":\"$PORKBUN_SECRET_KEY\"}" | $JQ -c '.domains[]? | {domain, status, expireDate, autoRenew}'
fi
echo

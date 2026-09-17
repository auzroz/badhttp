#!/bin/zsh
# Deploy the Worker and smoke-test it live. Usage: scripts/deploy.sh [base-url]
set -e
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH"
set -a; source .env; set +a
npx --yes wrangler deploy
URL="${1:-https://badhttp.dev}"
echo "smoke-testing $URL"; sleep 3
scripts/smoke.sh "$URL"

#!/bin/bash
# Run the brief from a home machine (residential IP) instead of GitHub Actions.
# Safe to call every hour: outside 06:25-11:59 New York time, or once today's
# edition exists, it exits without doing anything.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f .env ] && set -a && . ./.env && set +a   # ANTHROPIC_API_KEY=...
git -C .. pull --rebase --autostash --quiet
[ -d node_modules ] || { npm ci; npx playwright install chromium; }
exec node src/run.mjs --publish --gate

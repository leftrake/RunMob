#!/usr/bin/env bash
set -euo pipefail

# Run this on the server whenever you push new code:
#   bash scripts/deploy.sh

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> Deploying from $REPO_DIR"

cd "$REPO_DIR"

echo ""
echo "==> Pulling latest code..."
git pull origin claude/runmob-track-app-b6aPQ

echo ""
echo "==> Installing dependencies..."
pnpm install

echo ""
echo "==> Syncing database schema..."
cp .env apps/api/.env
pnpm --filter @runmob/api run db:push

echo ""
echo "==> Reloading services..."
pm2 reload pm2.config.cjs --update-env

echo ""
pm2 status
echo ""
echo "==> Deploy complete."

#!/usr/bin/env bash
set -euo pipefail

# RunMob server setup script
# Run this once on a fresh Ubuntu 22.04 server from inside the cloned repo:
#   git clone https://github.com/leftrake/RunMob.git && cd RunMob
#   bash scripts/setup.sh

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> Setting up RunMob in: $REPO_DIR"

# ── System packages ───────────────────────────────────────────────────────────
echo ""
echo "==> Installing system packages..."
sudo apt-get update -q
sudo apt-get install -y -q curl git build-essential ca-certificates gnupg

# ── Node.js 20 ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  echo ""
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    Node $(node --version) / npm $(npm --version)"

# ── pnpm ─────────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  echo ""
  echo "==> Installing pnpm..."
  npm install -g pnpm
fi
echo "    pnpm $(pnpm --version)"

# ── PM2 ──────────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo ""
  echo "==> Installing PM2..."
  npm install -g pm2
fi
echo "    pm2 $(pm2 --version)"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  echo ""
  echo "==> Installing PostgreSQL..."
  sudo apt-get install -y postgresql postgresql-contrib
fi
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create DB + user (idempotent)
echo ""
echo "==> Setting up database..."
DB_PASS="${DB_PASS:-$(openssl rand -base64 16 | tr -d '/+=' | head -c 20)}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='runmob'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER runmob WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='runmob'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE runmob OWNER runmob;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE runmob TO runmob;" 2>/dev/null || true

# ── Playwright system deps ────────────────────────────────────────────────────
echo ""
echo "==> Installing Playwright/Chromium system dependencies..."
sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
  libcairo2 libatspi2.0-0 libx11-6 libxcb1 libxext6

# ── Install repo dependencies ─────────────────────────────────────────────────
echo ""
echo "==> Installing Node dependencies..."
cd "$REPO_DIR"
pnpm install

# ── Playwright Chromium binary ────────────────────────────────────────────────
echo ""
echo "==> Installing Playwright Chromium..."
pnpm --filter @runmob/scraper exec playwright install chromium

# ── .env file ────────────────────────────────────────────────────────────────
ENV_FILE="$REPO_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "==> Creating .env file..."
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://runmob:${DB_PASS}@localhost:5432/runmob
PORT=3001
SCRAPE_STATES=NC
SCRAPE_DAYS_BACK=14
SCRAPE_ATHLETES=false
CRON_SCHEDULE=0 */6 * * *
EOF
  echo "    Created $ENV_FILE"
  echo "    Edit SCRAPE_STATES and other settings as needed"
else
  echo "    .env already exists — skipping (edit manually if needed)"
fi

# Also write to apps/api/.env so Prisma finds it
cp "$ENV_FILE" "$REPO_DIR/apps/api/.env"

# ── Database migrations ───────────────────────────────────────────────────────
echo ""
echo "==> Running database migrations..."
cd "$REPO_DIR/apps/api"
pnpm db:push

# ── Start with PM2 ───────────────────────────────────────────────────────────
echo ""
echo "==> Starting services with PM2..."
cd "$REPO_DIR"
pm2 start pm2.config.cjs
pm2 save

# Configure PM2 to start on boot
echo ""
echo "==> Configuring PM2 to start on reboot..."
pm2 startup | tail -1 | grep "sudo" | bash || true
pm2 save

# ── Firewall ──────────────────────────────────────────────────────────────────
echo ""
echo "==> Opening port 3001 in iptables..."
sudo iptables -I INPUT -p tcp --dport 3001 -j ACCEPT 2>/dev/null || true
# Persist iptables rules
sudo apt-get install -y iptables-persistent 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RunMob is running!"
echo ""
echo "  API:      http://${SERVER_IP}:3001"
echo "  Health:   http://${SERVER_IP}:3001/api/health"
echo ""
echo "  PM2 commands:"
echo "    pm2 status          — see all processes"
echo "    pm2 logs            — tail all logs"
echo "    pm2 logs runmob-api — tail API logs only"
echo ""
echo "  Next step:"
echo "    Set VITE_API_URL=http://${SERVER_IP}:3001 in your Vercel"
echo "    environment variables, then redeploy the frontend."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

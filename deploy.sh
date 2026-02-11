#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# LexAI LMS — VPS Deploy Script
# Target: Ubuntu 22.04 (Contabo VPS)
# Usage: bash deploy.sh [--seed]
# ==============================================================================

REPO_URL="${REPO_URL:-}"
APP_DIR="${APP_DIR:-/opt/lexai-lms}"
SEED=false

for arg in "$@"; do
  case $arg in
    --seed) SEED=true ;;
  esac
done

echo "=== LexAI LMS Deployment ==="
echo ""

# ---------- 1. Install Docker if not present ----------
if ! command -v docker &>/dev/null; then
  echo ">> Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  echo ">> Docker installed."
else
  echo ">> Docker already installed."
fi

# ---------- 2. Clone or pull repo ----------
if [ -n "$REPO_URL" ]; then
  if [ -d "$APP_DIR/.git" ]; then
    echo ">> Pulling latest changes..."
    git -C "$APP_DIR" pull
  else
    echo ">> Cloning repository..."
    git clone "$REPO_URL" "$APP_DIR"
  fi
  cd "$APP_DIR/backend"
else
  # Assume we're running from the backend directory already
  cd "$(dirname "$0")"
fi

echo ">> Working directory: $(pwd)"

# ---------- 3. Set up .env ----------
if [ ! -f .env ]; then
  echo ""
  echo ">> No .env file found. Creating from .env.example..."
  cp .env.example .env

  # Generate a random JWT secret
  JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
  sed -i "s|generate-with-openssl-rand-base64-64|${JWT_SECRET}|" .env

  # Prompt for required secrets
  read -rp "Enter POSTGRES_PASSWORD: " PG_PASS
  echo "POSTGRES_PASSWORD=${PG_PASS}" >> .env
  echo "POSTGRES_USER=lexai" >> .env
  echo "POSTGRES_DB=lexai_lms" >> .env

  echo ""
  echo ">> .env created. Edit it to fill in remaining secrets:"
  echo "   $(pwd)/.env"
  echo ""
  read -rp "Press Enter when .env is ready, or Ctrl+C to abort..."
fi

# ---------- 4. Build and start services ----------
echo ""
echo ">> Building and starting services..."
docker compose up -d --build

# ---------- 5. Wait for postgres ----------
echo ">> Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-lexai}" &>/dev/null; do
  sleep 2
done
echo ">> PostgreSQL is ready."

# ---------- 6. Run migrations ----------
echo ">> Running database migrations..."
docker compose exec -T app npx prisma migrate deploy
echo ">> Migrations complete."

# ---------- 7. Seed (optional) ----------
if [ "$SEED" = true ]; then
  echo ">> Seeding database..."
  docker compose exec -T app npx tsx prisma/seed.ts
  echo ">> Seed complete."
else
  echo ""
  read -rp ">> Run database seed? (y/N): " SEED_ANSWER
  if [[ "$SEED_ANSWER" =~ ^[Yy]$ ]]; then
    docker compose exec -T app npx tsx prisma/seed.ts
    echo ">> Seed complete."
  fi
fi

# ---------- 8. Status ----------
echo ""
echo "=== Deployment Complete ==="
echo ""
docker compose ps
echo ""

SERVER_IP=$(hostname -I | awk '{print $1}')
echo "Access the API at: http://${SERVER_IP}"
echo "Health check:      http://${SERVER_IP}/health/ready"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f app     # Follow app logs"
echo "  docker compose restart app     # Restart app"
echo "  docker compose down            # Stop all services"
echo "  ls backups/                    # View database backups"

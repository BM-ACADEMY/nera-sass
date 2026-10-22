#!/usr/bin/env bash
# Build and publish Getnera on the VPS. Run from the repo root:
#   bash deploy/deploy.sh            # everything
#   bash deploy/deploy.sh server     # only one part: landing | app | admin | server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/getnera
PART="${1:-all}"

# Public build settings (not secrets). .env.* files are gitignored, so they
# are written here instead of being expected in the clone.
echo 'VITE_API_URL=https://api.getnera.in' > "$ROOT/client/.env.production"
echo 'VITE_API_URL=https://api.getnera.in/api' > "$ROOT/admin/.env.production"

build_static() { # <folder> <target>
  echo "==> Building $1"
  (cd "$ROOT/$1" && npm ci && npm run build)
  sudo mkdir -p "$WEB/$2"
  sudo rsync -a --delete "$ROOT/$1/dist/" "$WEB/$2/"
}

if [[ "$PART" == all || "$PART" == landing ]]; then build_static landingpage landing; fi
if [[ "$PART" == all || "$PART" == app ]]; then build_static client app; fi
if [[ "$PART" == all || "$PART" == admin ]]; then build_static admin admin; fi

if [[ "$PART" == all || "$PART" == server ]]; then
  echo "==> Server"
  [[ -f "$ROOT/server/.env" ]] || { echo "server/.env is missing. Create it first (see deploy/README.md)."; exit 1; }
  (cd "$ROOT/server" && npm ci --omit=dev)
  if pm2 describe getnera-api >/dev/null 2>&1; then
    pm2 reload getnera-api --update-env
  else
    (cd "$ROOT/server" && pm2 start server.js --name getnera-api --time)
    pm2 save
  fi
  sleep 3
  API_PORT="$(grep -E '^PORT=' "$ROOT/server/.env" | cut -d= -f2 | tr -d '\r')"
  curl -fsS "http://127.0.0.1:${API_PORT:-3601}/health" && echo " <- API is up"
fi

echo "==> Done"

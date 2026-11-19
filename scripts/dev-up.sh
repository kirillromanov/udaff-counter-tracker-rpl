#!/bin/zsh
# Start the local admin app from this repo.
# --service  production server for login auto-start. Does not start a second copy.
# --dev      interactive dev server. Stops whatever is stuck on port 3000.
# Secrets stay in the untracked .env file. This script never prints them.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${HOME}/Library/Logs/udaff-counter-tracker"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/server.log"

PATH_FILE="${HOME}/Library/Application Support/udaff-counter-tracker/path.env"
if [[ -f "$PATH_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PATH_FILE"
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

log() {
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S') $1" | tee -a "$LOG_FILE"
}

if [[ ! -f .env ]]; then
  log "Missing .env in ${ROOT}. Copy .env.example to .env and set DATABASE_URL. Leave .env untracked."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  log "Node.js or npm is not on PATH. Install Node, then run scripts/install-launch-agent.sh again."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  log "Installing dependencies."
  npm install >>"$LOG_FILE" 2>&1
fi

if ! node -e "require('@prisma/client')" >/dev/null 2>&1; then
  log "Generating the Prisma client."
  npm run db:generate >>"$LOG_FILE" 2>&1
fi

healthy() {
  curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:3000/" 2>/dev/null
}

MODE="${1:---dev}"

if [[ "$MODE" == "--service" ]]; then
  if healthy; then
    log "http://localhost:3000 is already responding. Left the current process running."
    exit 0
  fi
  if [[ ! -f .next/BUILD_ID ]]; then
    log "No production build yet. Running npm run build."
    npm run build >>"$LOG_FILE" 2>&1
  fi
  log "Starting the production server at http://localhost:3000"
  exec npm run start -- --port 3000 >>"$LOG_FILE" 2>&1
fi

if [[ "$MODE" != "--dev" ]]; then
  log "Unknown mode ${MODE}. Use --dev or --service."
  exit 1
fi

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  log "Stopping the process already bound to port 3000."
  lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill
  sleep 1
fi

if [[ -f .next/BUILD_ID ]]; then
  log "Removing the production .next cache so the dev server does not reuse it."
  rm -rf .next
fi

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
log "Starting the dev server at http://localhost:3000"
exec npm run dev -- --port 3000 >>"$LOG_FILE" 2>&1

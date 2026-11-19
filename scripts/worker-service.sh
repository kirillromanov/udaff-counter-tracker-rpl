#!/bin/zsh
# Foreground entry for the worker LaunchAgent.
# This does not install dependencies, build the site, or enable processing.
# WORKER_ENABLED and WORKER_SCAN_MINUTES come from the untracked .env.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${HOME}/Library/Logs/udaff-counter-tracker"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/worker.log"

PATH_FILE="${HOME}/Library/Application Support/udaff-counter-tracker/path.env"
if [[ -f "$PATH_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PATH_FILE"
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

log() {
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S') $1" | tee -a "$LOG_FILE"
}

if [[ ! -d node_modules ]]; then
  log "Worker not started. node_modules is missing. Processing stays disabled."
  exit 0
fi

log "Starting the worker process. Enable flags stay in .env."
exec npm run worker:run >>"$LOG_FILE" 2>&1

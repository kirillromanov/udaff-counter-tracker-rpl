#!/bin/zsh
# Foreground entry for the worker LaunchAgent.
# This does not install dependencies, build the site, or enable processing.
# WORKER_ENABLED, PREDICTION_REFRESH_INTERVAL_MINUTES, and WORKER_RESULTS_ENABLED come from the untracked .env.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p "${HOME}/Library/Logs/udaff-counter-tracker"

PATH_FILE="${HOME}/Library/Application Support/udaff-counter-tracker/path.env"
if [[ -f "$PATH_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PATH_FILE"
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

if [[ ! -f .env ]]; then
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S') Worker failed to start. .env is missing."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  print -r -- "$(date '+%Y-%m-%dT%H:%M:%S') Worker failed to start. node_modules is missing."
  exit 1
fi

print -r -- "$(date '+%Y-%m-%dT%H:%M:%S') Starting the worker process. Enable flags stay in .env."
exec npm run worker:run

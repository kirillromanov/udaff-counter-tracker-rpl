#!/bin/zsh
# Install, start, stop, status, or uninstall the worker LaunchAgent.
# install writes the plist and does not bootstrap it.
# The web server agent com.udaff.counter-tracker is not touched.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.udaff.counter-tracker.worker"
SUPPORT="${HOME}/Library/Application Support/udaff-counter-tracker"
LOG_DIR="${HOME}/Library/Logs/udaff-counter-tracker"
AGENTS="${HOME}/Library/LaunchAgents"
PLIST="${AGENTS}/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
ACTION="${1:-}"

write_plist() {
  mkdir -p "$SUPPORT" "$LOG_DIR" "$AGENTS"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${ROOT}/scripts/worker-service.sh</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/worker.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/worker.log</string>
</dict>
</plist>
EOF
}

case "$ACTION" in
  install)
    write_plist
    print -r -- "Wrote ${PLIST}"
    print -r -- "Not loaded. Start it only after WORKER_ENABLED=1 and WORKER_SCAN_MINUTES are set."
    print -r -- "Start: zsh scripts/worker-agent.sh start"
    ;;
  start)
    if [[ ! -f "$PLIST" ]]; then
      print -r -- "Missing ${PLIST}. Run: zsh scripts/worker-agent.sh install"
      exit 1
    fi
    launchctl bootstrap "${DOMAIN}" "$PLIST"
    print -r -- "Bootstrapped ${LABEL}"
    ;;
  stop)
    launchctl bootout "${DOMAIN}/${LABEL}"
    print -r -- "Stopped ${LABEL}"
    ;;
  status)
    launchctl print "${DOMAIN}/${LABEL}"
    ;;
  uninstall)
    launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    print -r -- "Removed ${PLIST}"
    ;;
  *)
    print -r -- "Use install, start, stop, status, or uninstall."
    exit 1
    ;;
esac

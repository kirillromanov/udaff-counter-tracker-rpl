#!/bin/zsh
# Install a per-user LaunchAgent that starts the production server at login.
# The plist and PATH file live under the home directory and are not committed.
# The plist does not contain DATABASE_URL or any other secret.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  print -r -- "Node.js is not installed. Install it, then run this script again."
  exit 1
fi

SUPPORT="${HOME}/Library/Application Support/udaff-counter-tracker"
LOG_DIR="${HOME}/Library/Logs/udaff-counter-tracker"
AGENTS="${HOME}/Library/LaunchAgents"
PLIST="${AGENTS}/com.udaff.counter-tracker.plist"
UID_NUM="$(id -u)"

mkdir -p "$SUPPORT" "$LOG_DIR" "$AGENTS"
cat > "${SUPPORT}/path.env" <<EOF
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
EOF

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.udaff.counter-tracker</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${ROOT}/scripts/dev-up.sh</string>
    <string>--service</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/${UID_NUM}/com.udaff.counter-tracker" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl enable "gui/${UID_NUM}/com.udaff.counter-tracker" >/dev/null 2>&1 || true

print -r -- "Installed ${PLIST}"
print -r -- "After login the app is at http://localhost:3000"
print -r -- "Logs: ${LOG_DIR}/server.log and ${LOG_DIR}/launchd.log"
print -r -- "Stop it with: launchctl bootout gui/${UID_NUM}/com.udaff.counter-tracker"
print -r -- "Interactive dev server: zsh scripts/dev-up.sh --dev"

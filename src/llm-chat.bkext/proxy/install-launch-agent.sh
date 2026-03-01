#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs"
LABEL="com.hogbaysoftware.bike.llm-chat.proxy"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
USER_DOMAIN="gui/$(id -u)"
RUNNER_PATH="${SCRIPT_DIR}/run-server.sh"
STDOUT_LOG="${LOG_DIR}/${LABEL}.stdout.log"
STDERR_LOG="${LOG_DIR}/${LABEL}.stderr.log"

if [[ ! -x "${RUNNER_PATH}" ]]; then
  echo "Missing executable runner: ${RUNNER_PATH}" >&2
  exit 1
fi

mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"

if launchctl print "${USER_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "${USER_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
fi

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER_PATH}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
EOF

plutil -lint "${PLIST_PATH}" >/dev/null
chmod 644 "${PLIST_PATH}"

launchctl bootstrap "${USER_DOMAIN}" "${PLIST_PATH}"
launchctl kickstart -k "${USER_DOMAIN}/${LABEL}" >/dev/null

echo "Installed LaunchAgent: ${LABEL}"
echo "Health check: curl -fsS http://127.0.0.1:3033/health"
echo "Logs:"
echo "  ${STDOUT_LOG}"
echo "  ${STDERR_LOG}"

#!/usr/bin/env bash
set -euo pipefail

LABEL="com.hogbaysoftware.bike.llm-chat.proxy"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
USER_DOMAIN="gui/$(id -u)"

if launchctl print "${USER_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "${USER_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
fi

if [[ -f "${PLIST_PATH}" ]]; then
  rm -f "${PLIST_PATH}"
fi

echo "Uninstalled LaunchAgent: ${LABEL}"

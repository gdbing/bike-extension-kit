#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.hogbaysoftware.bike.llm-chat.proxy"
USER_DOMAIN="gui/$(id -u)"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

SERVER_BASE_URL="http://127.0.0.1:3033"

if command -v python3 >/dev/null 2>&1; then
  SERVER_BASE_URL="$(SCRIPT_DIR="${SCRIPT_DIR}" python3 - <<'PY'
import json
import os
from pathlib import Path

script_dir = Path(os.environ["SCRIPT_DIR"])
config_path = script_dir.parent / "config.json"
try:
    with config_path.open("r", encoding="utf-8") as f:
        config = json.load(f)
    server = config.get("server", {})
    protocol = server.get("protocol", "http")
    host = server.get("host", "127.0.0.1")
    port = server.get("port", 3033)
    print(f"{protocol}://{host}:{port}")
except Exception:
    print("http://127.0.0.1:3033")
PY
)"
fi

HEALTH_URL="${SERVER_BASE_URL}/health"

if [[ -f "${PLIST_PATH}" ]]; then
  echo "Plist: present (${PLIST_PATH})"
else
  echo "Plist: missing (${PLIST_PATH})"
fi

if launchctl print "${USER_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  echo "LaunchAgent: loaded"
else
  echo "LaunchAgent: not loaded"
fi

if command -v curl >/dev/null 2>&1 && curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "Server health: ok (${HEALTH_URL})"
else
  echo "Server health: unavailable (${HEALTH_URL})"
fi

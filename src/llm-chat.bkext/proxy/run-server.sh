#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# launchd provides a minimal environment; include common install paths.
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.cargo/bin:${HOME}/.uv/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if command -v uv >/dev/null 2>&1; then
  exec uv run server.py
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
fi

echo "No Python runtime found." >&2
exit 1

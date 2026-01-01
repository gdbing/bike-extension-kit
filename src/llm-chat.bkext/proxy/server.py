#!/usr/bin/env python3
"""
Local streaming proxy for Bike LLM Chat extension.

Run with: python3 server.py
Then trigger the extension with Cmd+Shift+L (LLM Chat: Send)

API keys are retrieved from:
1. Simon Willison's `llm` CLI tool (llm keys get <provider>)
2. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
"""

import json
import os
import subprocess
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional

from providers import select_provider

# Store active sessions: {session_id: {"chunks": [], "done": False, "error": None}}
sessions = {}
sessions_lock = threading.Lock()

# Cache for API keys
api_key_cache = {}

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


def load_config() -> dict:
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as error:
        raise RuntimeError("[Config] config.json not found") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"[Config] Failed to parse config.json: {error}") from error


def _is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_config(config: dict) -> None:
    errors = []
    server_config = config.get("server")
    if not isinstance(server_config, dict):
        errors.append("Missing server configuration")
    else:
        if not _is_non_empty_string(server_config.get("host")):
            errors.append("server.host must be a non-empty string")
        protocol = server_config.get("protocol")
        if not _is_non_empty_string(protocol):
            errors.append("server.protocol must be a non-empty string")
        elif protocol not in ("http", "https"):
            errors.append("server.protocol must be http or https")
        if not _is_number(server_config.get("port")):
            errors.append("server.port must be a number")

    if not _is_number(config.get("pollingIntervalMs")):
        errors.append("pollingIntervalMs must be a number")

    request_defaults = config.get("requestDefaults")
    if not isinstance(request_defaults, dict):
        errors.append("Missing requestDefaults configuration")
    else:
        if not _is_non_empty_string(request_defaults.get("model")):
            errors.append("requestDefaults.model must be a non-empty string")
        if not _is_number(request_defaults.get("maxTokens")):
            errors.append("requestDefaults.maxTokens must be a number")

    models = config.get("models")
    if not isinstance(models, list) or len(models) == 0:
        errors.append("models must be a non-empty array")
    else:
        for index, model in enumerate(models):
            if not isinstance(model, dict):
                errors.append(f"models[{index}] must be an object")
                continue
            if not _is_non_empty_string(model.get("name")):
                errors.append(f"models[{index}].name must be a non-empty string")
            if not _is_non_empty_string(model.get("provider")):
                errors.append(f"models[{index}].provider must be a non-empty string")

    ui = config.get("ui")
    if not isinstance(ui, dict):
        errors.append("Missing ui configuration")
    elif not isinstance(ui.get("showErrorsInOutline"), bool):
        errors.append("ui.showErrorsInOutline must be a boolean")

    if errors:
        message = "\n- ".join(errors)
        raise RuntimeError(f"[Config] Invalid config.json:\n- {message}")


CONFIG = load_config()
validate_config(CONFIG)
SERVER_CONFIG = CONFIG.get("server", {})
REQUEST_DEFAULTS = CONFIG.get("requestDefaults", {})

PORT = int(SERVER_CONFIG["port"])
HOST = SERVER_CONFIG["host"]

# Long-polling and cleanup configuration
LONG_POLL_TIMEOUT_SECONDS = 25
SESSION_TTL_SECONDS = 600
CLEANUP_INTERVAL_SECONDS = 60

# Default model settings
DEFAULT_MODEL = REQUEST_DEFAULTS["model"]
DEFAULT_MAX_TOKENS = REQUEST_DEFAULTS["maxTokens"]


def get_api_key(provider: str) -> Optional[str]:
    """
    Get API key for a provider.

    Tries in order:
    1. Cached value
    2. `llm keys get <provider>` CLI command
    3. Environment variable (e.g., ANTHROPIC_API_KEY)
    """
    # Check cache
    if provider in api_key_cache:
        return api_key_cache[provider]

    # Try llm CLI
    try:
        result = subprocess.run(
            ["llm", "keys", "get", provider],
            capture_output=True,
            text=True,
            check=True
        )
        key = result.stdout.strip()
        if key:
            api_key_cache[provider] = key
            print(f"[Keys] Got {provider} key from llm CLI")
            return key
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Try environment variable
    env_var = f"{provider.upper()}_API_KEY"
    key = os.environ.get(env_var)
    if key:
        api_key_cache[provider] = key
        print(f"[Keys] Got {provider} key from {env_var}")
        return key

    print(f"[Keys] No API key found for {provider}")
    return None


def get_provider_for_model(model: str) -> str:
    """Determine the provider based on model name."""
    model_lower = model.lower()
    if "claude" in model_lower or "haiku" in model_lower or "sonnet" in model_lower or "opus" in model_lower:
        return "anthropic"
    elif "gpt" in model_lower or "o1" in model_lower:
        return "openai"
    # Default to anthropic
    return "anthropic"


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Quieter logging
        print(f"[Server] {args[0]}")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/chat":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))

            raw_messages = body.get("messages", [])
            messages = []
            for msg in raw_messages:
                content = (msg.get("content") or "") if isinstance(msg, dict) else ""
                if not content.strip():
                    continue
                message = {
                    "role": msg.get("role", "assistant"),
                    "content": content
                }
                cache_control = msg.get("cacheControl") if isinstance(msg, dict) else None
                if isinstance(cache_control, dict):
                    message["cacheControl"] = cache_control
                messages.append(message)

            if not messages:
                self.send_json({"error": "No non-empty messages provided."}, 400)
                return

            model = body.get("model") or DEFAULT_MODEL
            max_tokens = body.get("maxTokens", DEFAULT_MAX_TOKENS)
            try:
                max_tokens = int(max_tokens)
            except (TypeError, ValueError):
                max_tokens = DEFAULT_MAX_TOKENS

            temperature = body.get("temperature")
            try:
                temperature = float(temperature) if temperature is not None else None
            except (TypeError, ValueError):
                temperature = None

            reasoning_effort = body.get("reasoningEffort")
            if isinstance(reasoning_effort, str):
                reasoning_effort = reasoning_effort.lower()
            else:
                reasoning_effort = "none"

            # Determine provider and get API key
            provider_name = body.get("provider") or get_provider_for_model(model)
            provider = select_provider(provider_name)
            if not provider:
                self.send_json({"error": f"No provider registered for {provider_name}"}, 400)
                return

            api_key = get_api_key(provider.name)

            if not api_key:
                self.send_json({
                    "error": f"No API key found for {provider.name}. "
                             f"Set it with `llm keys set {provider.name}` or "
                             f"export {provider.name.upper()}_API_KEY"
                }, 400)
                return

            # Create session
            session_id = str(uuid.uuid4())[:8]
            print(f"[Server] New session: {session_id} (model: {model})")
            with sessions_lock:
                # Each session has a condition so /chunks can long-poll for new data.
                sessions[session_id] = {
                    "chunks": [],
                    "done": False,
                    "error": None,
                    "usage": None,
                    "last_access": time.time(),
                    "condition": threading.Condition(sessions_lock)
                }

            # Start streaming in background thread
            thread = threading.Thread(
                target=provider.stream,
                args=(session_id, messages, api_key, model, max_tokens, temperature, reasoning_effort, sessions, sessions_lock)
            )
            thread.daemon = True
            thread.start()

            self.send_json({"sessionId": session_id})
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        if self.path.startswith("/chunks/"):
            session_id = self.path.split("/")[-1]

            with sessions_lock:
                session = sessions.get(session_id)
                if not session:
                    self.send_json({"error": "Session not found"}, 404)
                    return

                session["last_access"] = time.time()

                # Long-poll for up to the timeout if there is no data yet.
                if not session["chunks"] and not session["done"] and not session["error"]:
                    session["condition"].wait(timeout=LONG_POLL_TIMEOUT_SECONDS)

                # Get and clear chunks
                chunks = session["chunks"]
                session["chunks"] = []
                done = session["done"]
                error = session["error"]
                usage = session.get("usage")

                # Clean up completed sessions
                if done:
                    del sessions[session_id]

            self.send_json({
                "chunks": chunks,
                "done": done,
                "error": error,
                "usage": usage
            })
        elif self.path == "/health":
            self.send_json({"status": "ok"})
        else:
            self.send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    print(f"LLM Chat Server starting on http://{HOST}:{PORT}")
    print("   Press Ctrl+C to stop\n")

    def cleanup_sessions():
        while True:
            time.sleep(CLEANUP_INTERVAL_SECONDS)
            now = time.time()
            with sessions_lock:
                # Drop sessions that have gone idle without polling to avoid leaks.
                stale_ids = [
                    session_id
                    for session_id, session in sessions.items()
                    if now - session.get("last_access", now) > SESSION_TTL_SECONDS
                ]
                for session_id in stale_ids:
                    del sessions[session_id]

    cleanup_thread = threading.Thread(target=cleanup_sessions, daemon=True)
    cleanup_thread.start()

    server = HTTPServer((HOST, PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")

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
    except FileNotFoundError:
        print("[Config] config.json not found, using defaults")
    except json.JSONDecodeError as error:
        print(f"[Config] Failed to parse config.json: {error}")
    return {}


CONFIG = load_config()
SERVER_CONFIG = CONFIG.get("server", {})
REQUEST_DEFAULTS = CONFIG.get("requestDefaults", {})

PORT = int(SERVER_CONFIG.get("port", 3033) or 3033)
HOST = SERVER_CONFIG.get("host", "localhost")

# Default model settings
DEFAULT_MODEL = REQUEST_DEFAULTS.get("model", "claude-3-5-haiku-20241022")
DEFAULT_MAX_TOKENS = REQUEST_DEFAULTS.get("maxTokens", 4096)


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
                messages.append({
                    "role": msg.get("role", "assistant"),
                    "content": content
                })

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
                sessions[session_id] = {"chunks": [], "done": False, "error": None}

            # Start streaming in background thread
            thread = threading.Thread(
                target=provider.stream,
                args=(session_id, messages, api_key, model, max_tokens, temperature, sessions, sessions_lock)
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

                # Get and clear chunks
                chunks = session["chunks"]
                session["chunks"] = []
                done = session["done"]
                error = session["error"]

                # Clean up completed sessions
                if done:
                    del sessions[session_id]

            self.send_json({
                "chunks": chunks,
                "done": done,
                "error": error
            })
        elif self.path == "/health":
            self.send_json({"status": "ok"})
        else:
            self.send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    print(f"LLM Chat Server starting on http://{HOST}:{PORT}")
    print("   Press Ctrl+C to stop\n")
    server = HTTPServer((HOST, PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")

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
from urllib.error import HTTPError
from urllib.request import Request, urlopen

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

            # Determine provider and get API key
            provider = get_provider_for_model(model)
            api_key = get_api_key(provider)

            if not api_key:
                self.send_json({
                    "error": f"No API key found for {provider}. "
                             f"Set it with `llm keys set {provider}` or "
                             f"export {provider.upper()}_API_KEY"
                }, 400)
                return

            # Create session
            session_id = str(uuid.uuid4())[:8]
            print(f"[Server] New session: {session_id} (model: {model})")
            with sessions_lock:
                sessions[session_id] = {"chunks": [], "done": False, "error": None}

            # Start streaming in background thread
            thread = threading.Thread(
                target=stream_from_anthropic,
                args=(session_id, messages, api_key, model, max_tokens)
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


def stream_from_anthropic(session_id, messages, api_key, model, max_tokens):
    """Stream from Anthropic API and buffer chunks."""
    print(f"[Server] Session {session_id}: Starting stream")
    try:
        # Separate system messages - use only the last one (lowest in document)
        system_messages = [m for m in messages if m.get("role") == "system"]
        conversation = [m for m in messages if m.get("role") != "system"]
        system_prompt = system_messages[-1].get("content", "") if system_messages else ""

        # Build request body
        body = {
            "model": model,
            "messages": [{"role": m["role"], "content": m["content"].strip()} for m in conversation],
            "stream": True,
            "max_tokens": max_tokens
        }
        if system_prompt:
            body["system"] = system_prompt.strip()

        req = Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": api_key
            }
        )

        with urlopen(req) as response:
            buffer = ""
            for chunk in response:
                buffer += chunk.decode("utf-8")

                # Process complete lines
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()

                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            with sessions_lock:
                                if session_id in sessions:
                                    sessions[session_id]["done"] = True
                            return

                        try:
                            parsed = json.loads(data)
                            if parsed.get("type") == "content_block_delta":
                                delta = parsed.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    text = delta.get("text", "")
                                    if text:
                                        with sessions_lock:
                                            if session_id in sessions:
                                                sessions[session_id]["chunks"].append(text)
                        except json.JSONDecodeError:
                            pass

    except HTTPError as e:
        error_body = e.read().decode("utf-8")
        with sessions_lock:
            if session_id in sessions:
                sessions[session_id]["error"] = f"API error ({e.code}): {error_body}"
    except Exception as e:
        with sessions_lock:
            if session_id in sessions:
                sessions[session_id]["error"] = str(e)
    finally:
        with sessions_lock:
            if session_id in sessions:
                sessions[session_id]["done"] = True


if __name__ == "__main__":
    print(f"LLM Chat Server starting on http://{HOST}:{PORT}")
    print("   Press Ctrl+C to stop\n")
    server = HTTPServer((HOST, PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")

#!/usr/bin/env python3
"""
Debug server for LLM Chat extension parser testing.

Run with: python3 debug_server.py
Then trigger the extension with Cmd+Shift+L (LLM Chat: Send)

This server prints the parsed messages without calling any API.
"""

import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path


CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


def load_config() -> dict:
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


CONFIG = load_config()
PORT = int(CONFIG.get("server", {}).get("port", 3033) or 3033)


class DebugHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

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

            messages = body.get("messages", [])
            model = body.get("model", "claude-3-5-haiku-20241022")
            max_tokens = body.get("maxTokens", 4096)

            # Pretty print the request
            print("\n" + "=" * 60)
            print("INCOMING REQUEST")
            print("=" * 60)
            print(f"Model: {model}")
            print(f"Max Tokens: {max_tokens}")
            print(f"Message Count: {len(messages)}")
            print("-" * 60)

            for i, msg in enumerate(messages):
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                print(f"\n[{i+1}] {role.upper()}")
                print("-" * 40)
                # Show content with visible whitespace markers
                lines = content.split("\n")
                for j, line in enumerate(lines):
                    # Show leading whitespace with explicit markers.
                    stripped = line.lstrip()
                    prefix = line[: len(line) - len(stripped)]
                    indent_marker = prefix.replace("\t", "⇥").replace(" ", "·")
                    print(f"  {j+1:3}: {indent_marker}{stripped}")
                print("-" * 40)
                print(f"  (raw length: {len(content)} chars, {len(lines)} lines)")

            print("\n" + "=" * 60)
            print("END REQUEST")
            print("=" * 60 + "\n")

            # Return a fake session that immediately completes
            # with a debug message
            self.send_json({"sessionId": "debug-session"})
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        if self.path.startswith("/chunks/"):
            # Return a simple debug response
            self.send_json({
                "chunks": ["[Debug mode - parser output printed to console]"],
                "done": True,
                "error": None
            })
        elif self.path == "/health":
            self.send_json({"status": "ok", "mode": "debug"})
        else:
            self.send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    print(f"LLM Chat DEBUG Server on http://localhost:{PORT}")
    print("   This server prints requests without calling any API")
    print("   Press Ctrl+C to stop\n")
    server = HTTPServer(("localhost", PORT), DebugHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDebug server stopped")

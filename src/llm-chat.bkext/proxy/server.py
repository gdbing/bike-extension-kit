#!/usr/bin/env python3
"""
Local streaming proxy for Bike LLM Chat extension.

Run with: python3 server.py
Then use the extension with Cmd+Shift+Return

The extension polls this server for streamed chunks from the Anthropic API.
"""

import json
import threading
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# Store active sessions: {session_id: {"chunks": [], "done": False, "error": None}}
sessions = {}
sessions_lock = threading.Lock()

PORT = 3033


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Quieter logging
        print(f"[Proxy] {args[0]}")

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
            api_key = body.get("apiKey", "")
            model = body.get("model", "claude-3-5-haiku-20241022")
            max_tokens = body.get("maxTokens", 4096)

            if not api_key:
                self.send_json({"error": "No API key provided"}, 400)
                return

            # Create session
            session_id = str(uuid.uuid4())[:8]
            print(f"[Proxy] New session: {session_id}")
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
    print(f"[Proxy] Session {session_id}: Starting Anthropic stream")
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
                            continue

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
    print(f"LLM Chat Proxy starting on http://localhost:{PORT}")
    print("   Press Ctrl+C to stop\n")
    server = HTTPServer(("localhost", PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nProxy stopped")

import json
from typing import Dict, List, Optional, Union
from urllib.error import HTTPError
from urllib.request import Request, urlopen


Message = Dict[str, str]


def merge_assistant_runs(conversation: List[Message]) -> List[Message]:
    merged: List[Message] = []
    for message in conversation:
        role = message.get("role", "").strip()
        content = (message.get("content") or "").strip()
        if not content:
            continue

        if merged and role == "assistant" and merged[-1].get("role") == "assistant":
            merged[-1]["content"] = (merged[-1]["content"].rstrip("\n") + "\n" + content)
        else:
            merged.append({"role": role, "content": content})
    return merged


class Provider:
    """Abstract provider contract."""

    name: str = ""

    def prepare_messages(self, messages: List[Message]) -> Dict[str, Union[str, List[Message]]]:
        raise NotImplementedError

    def stream(self, session_id: str, messages: List[Message], api_key: str, model: str, max_tokens: int,
               sessions, sessions_lock) -> None:
        raise NotImplementedError


class AnthropicProvider(Provider):
    name = "anthropic"

    def prepare_messages(self, messages: List[Message]) -> Dict[str, Union[str, List[Message]]]:
        # Keep only last system prompt
        system_messages = [m for m in messages if m.get("role") == "system"]
        system_prompt = system_messages[-1].get("content", "").strip() if system_messages else ""

        # Non-system conversation with Anthropic-specific assistant merging
        conversation = [m for m in messages if m.get("role") != "system"]
        merged_conversation = merge_assistant_runs(conversation)

        return {"system": system_prompt, "conversation": merged_conversation}

    def stream(self, session_id: str, messages: List[Message], api_key: str, model: str, max_tokens: int,
               sessions, sessions_lock) -> None:
        prepared = self.prepare_messages(messages)
        system_prompt = prepared["system"]
        conversation = prepared["conversation"]

        body = {
            "model": model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in conversation],
            "stream": True,
            "max_tokens": max_tokens
        }
        if system_prompt:
            body["system"] = system_prompt

        req = Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": api_key
            }
        )

        try:
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


providers = {
    "anthropic": AnthropicProvider(),
    # Additional providers can be registered here as new classes.
}


def select_provider(name: str) -> Optional[Provider]:
    return providers.get(name)

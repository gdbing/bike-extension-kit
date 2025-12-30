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


def merge_same_role_runs(conversation: List[Message]) -> List[Message]:
    merged: List[Message] = []
    for message in conversation:
        role = message.get("role", "").strip()
        content = (message.get("content") or "").strip()
        if not content:
            continue

        if merged and role and role == merged[-1].get("role"):
            merged[-1]["content"] = (merged[-1]["content"].rstrip("\n") + "\n" + content)
        else:
            merged.append({"role": role, "content": content})
    return merged


class Provider:
    """Abstract provider contract."""

    name: str = ""

    def prepare_messages(self, messages: List[Message]) -> Dict[str, Union[str, List[Message]]]:
        raise NotImplementedError

    def stream(
        self,
        session_id: str,
        messages: List[Message],
        api_key: str,
        model: str,
        max_tokens: int,
        temperature: Optional[float],
        reasoning_effort: Optional[str],
        sessions,
        sessions_lock,
    ) -> None:
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

    def stream(
        self,
        session_id: str,
        messages: List[Message],
        api_key: str,
        model: str,
        max_tokens: int,
        temperature: Optional[float],
        reasoning_effort: Optional[str],
        sessions,
        sessions_lock,
    ) -> None:
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
        if temperature is not None:
            body["temperature"] = temperature
        # Anthropic does not support reasoning effort; ignore if provided

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


class OpenAIProvider(Provider):
    name = "openai"

    def prepare_messages(self, messages: List[Message]) -> Dict[str, Union[str, List[Message]]]:
        # Responses API prefers instructions + alternating user/assistant turns.
        system_messages = [m for m in messages if m.get("role") == "system"]
        system_prompt = system_messages[-1].get("content", "").strip() if system_messages else ""

        conversation = [m for m in messages if m.get("role") != "system"]
        merged_conversation = merge_same_role_runs(conversation)

        return {"instructions": system_prompt, "conversation": merged_conversation}

    def stream(
        self,
        session_id: str,
        messages: List[Message],
        api_key: str,
        model: str,
        max_tokens: int,
        temperature: Optional[float],
        reasoning_effort: Optional[str],
        sessions,
        sessions_lock,
    ) -> None:
        prepared = self.prepare_messages(messages)
        conversation = prepared["conversation"]
        instructions = prepared["instructions"]

        body: Dict[str, Union[str, bool, float, int, List[Dict[str, str]], Dict[str, str]]] = {
            "model": model,
            "input": conversation,  # type: ignore
            "stream": True,
        }
        if max_tokens:
            body["max_output_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        if reasoning_effort:
            body["reasoning"] = {"effort": reasoning_effort}
        if instructions:
            body["instructions"] = instructions

        req = Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )

        try:
            with urlopen(req) as response:
                buffer = ""
                for chunk in response:
                    buffer += chunk.decode("utf-8")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                with sessions_lock:
                                    if session_id in sessions:
                                        sessions[session_id]["done"] = True
                                return
                            try:
                                parsed = json.loads(data)
                                event_type = parsed.get("type")
                                if event_type == "response.output_text.delta":
                                    text = parsed.get("delta") or ""
                                    if text:
                                        with sessions_lock:
                                            if session_id in sessions:
                                                sessions[session_id]["chunks"].append(text)
                                if event_type == "response.error":
                                    error_info = parsed.get("error") or {}
                                    message = error_info.get("message") or str(error_info) or "Unknown error"
                                    with sessions_lock:
                                        if session_id in sessions:
                                            sessions[session_id]["error"] = message
                                            sessions[session_id]["done"] = True
                                    return
                                if event_type == "response.completed":
                                    error_info = (parsed.get("response") or {}).get("error")
                                    if error_info:
                                        message = error_info.get("message") or str(error_info) or "Unknown error"
                                        with sessions_lock:
                                            if session_id in sessions:
                                                sessions[session_id]["error"] = message
                                                sessions[session_id]["done"] = True
                                        return
                                    with sessions_lock:
                                        if session_id in sessions:
                                            sessions[session_id]["done"] = True
                                    return
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
    "openai": OpenAIProvider(),
    # Additional providers can be registered here as new classes.
}


def select_provider(name: str) -> Optional[Provider]:
    return providers.get(name)

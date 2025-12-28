# LLM Chat Extension - Pull Request

## Overview

This PR adds an LLM Chat extension that enables conversational AI directly within Bike outlines. Users can write messages using simple markers (`<user>`, `<system>`, etc.), press `Cmd+Shift+Return`, and receive streamed responses that appear inline in their document.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Bike Extension │  HTTP   │  Python Server  │  HTTPS  │  Anthropic API  │
│  (TypeScript)   │ ──────> │  (localhost)    │ ──────> │                 │
│                 │ <────── │                 │ <────── │                 │
│  • Parse doc    │  poll   │  • API keys     │ stream  │                 │
│  • Stream UI    │         │  • Provider     │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

**Design principle**: The extension is a thin client that handles parsing and UI. The server handles all "smart" logic (API keys, provider routing, request formatting).

## Components

### Extension (`app/`)

| File | Purpose |
|------|---------|
| `main.ts` | Command registration, keybindings (`Cmd+Shift+Return`) |
| `message-parser.ts` | Parse Bike outline into messages array |
| `response-inserter.ts` | Stream tokens into outline under `<assistant>` heading |
| `providers/anthropic.ts` | HTTP client for server communication |
| `providers/types.ts` | TypeScript interfaces |

### Server (`proxy/`)

| File | Purpose |
|------|---------|
| `server.py` | Main server - API key management, Anthropic streaming |
| `debug_server.py` | Debug server - prints parsed requests for testing |

## Message Parser Details

The parser (`message-parser.ts`) converts a Bike outline into a messages array:

**Input (Bike outline):**
```
<system>
    You are helpful.
<user>
    What is 2+2?
<assistant>
    4
<user>
    Thanks!
```

**Output (messages array):**
```json
[
  {"role": "system", "content": "You are helpful.\n"},
  {"role": "user", "content": "What is 2+2?\n"},
  {"role": "assistant", "content": "4\n"},
  {"role": "user", "content": "Thanks!\n"}
]
```

**Parser rules:**
1. **Markers must be at level 1** (root children, no indentation)
2. **Markers match `<name>` pattern** - angle brackets required
3. **`<user>` → user role**, **`<system>` → system role**, **anything else → assistant**
4. **Strict nesting** - only content indented under a marker is included
5. **Note-type rows are skipped** - treated as comments, including descendants
6. **Parsing stops at cursor position** - only includes content up to selection

**Row comparison note:** Bike returns new wrapper objects on property access, so row comparison uses `.id` instead of `===`.

## Server Details

The server (`server.py`) handles:

1. **API Key Management**
   - Tries `llm keys get <provider>` (Simon Willison's llm CLI)
   - Falls back to environment variables (`ANTHROPIC_API_KEY`)
   - Caches keys in memory

2. **Provider Routing**
   - Determines provider from model name (claude/haiku/sonnet/opus → anthropic)
   - Currently only Anthropic implemented

3. **Request Formatting**
   - Separates system messages (uses last one only, per Anthropic API design)
   - Formats conversation for provider's API

4. **Streaming**
   - Buffers SSE chunks from Anthropic
   - Extension polls `/chunks/{sessionId}` every 50ms

## API Contract

**POST `/chat`**
```json
{
  "messages": [{"role": "user", "content": "Hello"}],
  "model": "claude-3-5-haiku-20241022",  // optional
  "maxTokens": 4096                       // optional
}
```

Response: `{"sessionId": "abc123"}`

**GET `/chunks/{sessionId}`**
```json
{
  "chunks": ["Hello", " there"],
  "done": false,
  "error": null
}
```

## Testing

1. **Parser testing** - Use debug server:
   ```bash
   python3 proxy/debug_server.py
   ```
   Prints parsed messages without calling API.

2. **Full flow testing**:
   ```bash
   llm keys set anthropic  # Set API key
   python3 proxy/server.py  # Start server
   ```
   Then use extension in Bike with `Cmd+Shift+Return`.

## Known Limitations / Future Work

- [ ] Model selection hardcoded to Haiku
- [ ] No config syntax for temperature, max_tokens, etc.
- [ ] No visual feedback during streaming
- [ ] No request cancellation
- [ ] Only Anthropic provider implemented
- [ ] Polling-based streaming (Bike's fetch doesn't support ReadableStream)

## Commits in This PR

1. **Add LLM Chat extension** - Initial implementation
2. **Add debug server for parser testing** - Development tool
3. **Use only last system message** - Anthropic API compliance
4. **Improve message parser** - Strict nesting, note skipping, flexible markers, ID fix
5. **Refactor to separate concerns** - Move API keys and provider logic to server

## How to Review

1. **Start with `message-parser.ts`** - Core parsing logic, most complex part
2. **Check `response-inserter.ts`** - Streaming UI, handles newlines
3. **Review `server.py`** - API key management, Anthropic integration
4. **Test manually** - Try various document structures, note rows, markers

## Questions for Reviewer

1. Is the marker syntax (`<name>`) clear enough? Should we document edge cases?
2. Is polling at 50ms appropriate? Too fast? Too slow?
3. Should we add error UI in the document (e.g., insert error message as row)?

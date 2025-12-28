# LLM Chat Extension - Development Status

## Current State: Refactored Architecture

Clean separation between extension (thin client) and server (smart backend).

## Architecture

```
Extension (Bike)  ←→  Python Server (localhost:3033)  ←→  Anthropic API
     parse & poll           API keys & streaming
```

**Extension responsibilities:**
- Parse document into messages
- Send messages to server
- Stream response back into outline

**Server responsibilities:**
- API key management (via `llm` CLI or env vars)
- Provider routing (based on model name)
- Handle provider-specific quirks (system messages, etc.)
- Stream responses

## What Works

- **Command**: `llm-chat:send` triggered by `Cmd+Shift+Return`
- **Message parsing**:
  - `<user>`, `<system>` markers at root level
  - Any other `<marker>` treated as assistant
  - Strict nesting (only indented content included)
  - Note-type rows skipped (treated as comments)
- **Streaming**: Via local Python server (polls every 50ms)
- **API keys**: Retrieved from `llm` CLI or environment variables

## Setup Required

1. Set API key (one of):
   ```bash
   llm keys set anthropic
   # or
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

2. Start server:
   ```bash
   cd src/llm-chat.bkext/proxy
   python3 server.py
   ```

## Files

- `manifest.json` - Extension config
- `app/main.ts` - Command registration, keybindings
- `app/message-parser.ts` - Parse outline into messages
- `app/response-inserter.ts` - Stream tokens into outline rows
- `app/providers/types.ts` - Message and options types
- `app/providers/anthropic.ts` - Server communication
- `proxy/server.py` - Local server with API key management
- `proxy/debug_server.py` - Debug server for parser testing

## Known Issues / TODO

- [ ] Model selection (currently hardcoded to haiku)
- [ ] Config message syntax for parameters (temperature, max_tokens)
- [ ] Visual feedback while waiting for response
- [ ] Cancel in-progress requests
- [ ] Support for other providers (OpenAI, etc.)

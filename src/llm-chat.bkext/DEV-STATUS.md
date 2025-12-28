# LLM Chat Extension - Development Status

## Current State: Working MVP with Streaming

The extension is functional with streaming support via a local Python proxy.

## What Works

- **Command**: `llm-chat:send` triggered by `Cmd+Shift+Return`
- **Message parsing**: Parses `<user>`, `<system>`, `<assistant>` markers at root level
- **Streaming**: Via local Python proxy (polls every 50ms)
- **Non-streaming fallback**: Works when proxy isn't running
- **Concurrent request blocking**: Prevents double-sends

## Architecture

```
Extension (Bike)  ←→  Python Proxy (localhost:3033)  ←→  Anthropic API
     poll                    stream
```

Bike's fetch API doesn't support `ReadableStream`, so we use a local proxy to handle streaming and the extension polls for chunks.

## Setup Required

1. Set API key in document metadata:
   ```javascript
   bike.frontmostOutlineEditor.outline.persistentMetadata.set("anthropic-api-key", "sk-ant-...")
   ```

2. Start proxy for streaming:
   ```bash
   cd src/llm-chat.bkext/proxy
   python3 server.py
   ```

## Files

- `manifest.json` - Extension config with host permissions
- `app/main.ts` - Command registration, keybindings, orchestration
- `app/message-parser.ts` - Parse outline into messages
- `app/response-inserter.ts` - Stream tokens into outline rows
- `app/providers/types.ts` - LLMProvider interface
- `app/providers/anthropic.ts` - Anthropic API + proxy polling
- `proxy/server.py` - Local streaming proxy server

## Known Issues / TODO

- [ ] Request streaming fetch support from Jesse (Bike developer) - would eliminate need for proxy
- [ ] Better API key management (currently stored in document metadata)
- [ ] Visual feedback while waiting for response
- [ ] Cancel in-progress requests
- [ ] Model selection UI

## Testing Notes

- Host permission pattern: `http://127.0.0.1/*` works, `localhost` and ports don't
- Instance ID logging added for debugging duplicate requests
- Proxy logs session IDs for debugging

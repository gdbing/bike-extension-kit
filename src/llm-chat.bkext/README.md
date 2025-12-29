# LLM Chat

Chat with Claude directly in your Bike outlines.

## Setup

### 1. Set your API key

The server retrieves API keys automatically from:

1. **Simon Willison's `llm` CLI** (recommended):
   ```bash
   llm keys set anthropic
   # Paste your key when prompted
   ```

2. **Environment variable** (fallback):
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-your-key-here"
   ```

### 2. Start the server

```bash
cd src/llm-chat.bkext/proxy
python3 server.py
```

The server runs on `http://localhost:3033`. Keep it running while using the extension.

## Configuration

Edit `src/llm-chat.bkext/config.json` to adjust the server URL, port, polling interval, or default model parameters. The extension reads these values at runtime.

## Usage

1. Create message blocks using markers at the root level:
   - `<user>` - Your message to the LLM
   - `<system>` - System instructions
   - `<assistant>` - Previous LLM responses (or any `<name>` marker)
   - Markers **must be root-level rows**; nested markers are treated as plain text

2. Nest your content under the markers (indented)

3. Press `Shift+Cmd+L` to send (or run **LLM Chat: Send** from the command palette)

The response will stream in under an `<assistant>` heading.

## Example Document

```
<system>
  You are a helpful assistant.

<user>
  What is the capital of France?
```

After pressing `Shift+Cmd+L`, an `<assistant>` block will be added with the response.

## Features

- Streaming responses (tokens appear as they arrive)
- Conversation history (multiple user/assistant exchanges)
- System prompts for custom behavior
- Note-type rows are treated as comments (excluded from messages)
- Strict nesting: only indented content is included in messages
- Configurable server endpoint, polling interval, and default model (`config.json`)

### Message Parser Rules

- Markers must be root-level rows matching `<name>`.
- `<user>` → user role, `<system>` → system role, any other marker → assistant role.
- Only content nested under a marker is included; note rows and their descendants are skipped.
- Parsing stops after the marker that contains the cursor row.
- Nested markers are treated as plain text.

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│    Bike     │ poll │   Python    │stream│  Anthropic  │
│  Extension  │<────>│   Server    │<────>│    API      │
└─────────────┘      └─────────────┘      └─────────────┘
                     localhost:3033
```

The extension parses the document and sends messages to the server. The server:
- Manages API keys (via `llm` CLI or environment variables)
- Handles provider-specific logic (system message handling, etc.)
- Streams responses back to the extension
- Sends error details inline so the outline reflects failures

## API (local server)

- **POST** `/chat` — body: `{ messages, model?, maxTokens? }` → `{ sessionId }`
- **GET** `/chunks/{sessionId}` — returns `{ chunks: string[], done: boolean, error: string | null }`

## Testing

```bash
npm run test:llm-chat
```

## Known limitations / future work

- Model selection is basic; only Anthropic supported today.
- No request cancellation; polling-based streaming.
- Minimal error UI; only inline message insertion.

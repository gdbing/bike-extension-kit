# LLM Chat

Chat with LLM models directly in your Bike outlines.

## Setup

### 1. Set your API key

The server retrieves API keys automatically from:

1. **Simon Willison's `llm` CLI** (recommended):
   ```bash
   llm keys set anthropic
   # Paste your key when prompted
   ```
   For OpenAI:
   ```bash
   llm keys set openai
   # Paste your key when prompted
   ```

2. **Environment variable** (fallback):
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-your-key-here"
   ```
   For OpenAI:
   ```bash
   export OPENAI_API_KEY="sk-your-key-here"
   ```

### 2. Start the server

```bash
cd src/llm-chat.bkext/proxy
python3 server.py
```

The server runs on `http://localhost:3033`. Keep it running while using the extension.

## Configuration

Edit `src/llm-chat.bkext/config.json` to adjust the server URL, port, polling interval, default model parameters, or the ordered model list. The extension reads these values at runtime and will error if required fields are missing or unsupported. The server host must also be allowed by `src/llm-chat.bkext/manifest.json` `host_permissions`. Marker colors are configured under `ui.markerColors`.

The extension also provides an editor style named "LLM Chat" (Bike > Window > Style Sheets) to show marker colors and code styling.

## Usage

1. Create message blocks using markers at the root level:
   - `<user>` - Your message to the LLM
   - `<system>` - System instructions
   - `<assistant>` - Previous LLM responses (or any `<name>` marker)
   - Markers **must be root-level rows**; nested `<name>` rows become tags inside messages

2. Nest your content under the markers (indented)

3. Press `Shift+Cmd+L` to send (or run **LLM Chat: Send** from the command palette)

The response will stream in under a model heading (for example, `<sonnet>` if `<model>` is set to `sonnet`, or the exact model name when using defaults/config).

## Example Document

```
<system>
  You are a helpful assistant.

<user>
  What is the capital of France?
```

After pressing `Shift+Cmd+L`, a model-named block will be added with the response.

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
- Tags are indented `<name>` rows inside a message; they emit open/close tags and de-indent their contents.

### Outline Config Markers

- `<model>`: first non-empty line under the marker is matched (case-insensitive) against the ordered `models` list in `config.json`. The first match wins; unknown models raise errors. The provider is selected automatically from the matched model (or constrained by `<config>` `provider` if set).
- `<config>`: root-level marker with `key: value` lines (simple scalars). Allowed keys: `model` (exact string), `provider` (from the configured `models` list), `maxTokens` (positive number), `temperature` (0–2), `reasoningEffort` (`none`/`low`/`medium`/`high` for OpenAI). Unknown keys or invalid values raise errors.
- Multiple markers are merged in document order; later values win. Markers after the cursor row are ignored.
- Fuzzy model matching: `<model>` also supports in-order token matching (e.g., `sonnet 4.5` matches `claude-sonnet-4-5`).

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│    Bike     │ poll │   Python    │stream│  Provider   │
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

- **POST** `/chat` — body: `{ messages, model?, maxTokens?, temperature?, provider?, reasoningEffort? }` → `{ sessionId }`
- **GET** `/chunks/{sessionId}` — returns `{ chunks: string[], done: boolean, error: string | null }`

## Testing

```bash
npm run test:llm-chat
```

## Known limitations / future work

- Model selection is basic; Anthropic and OpenAI supported today.
- No request cancellation; polling-based streaming.
- Minimal error UI; only inline message insertion.

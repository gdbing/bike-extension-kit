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
   For OpenRouter:
   ```bash
   llm keys set openrouter
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
   For OpenRouter:
   ```bash
   export OPENROUTER_API_KEY="sk-or-your-key-here"
   ```

### 2. Start the server

```bash
cd src/llm-chat.bkext/proxy
python3 server.py
```

The server runs on the host/port defined in `src/llm-chat.bkext/config.json` (default `http://127.0.0.1:3033`).
Keep it running while using the extension.

## Configuration

Edit `src/llm-chat.bkext/config.json` to adjust 
- the server URL
- port
- polling interval
- default model parameters
- the default system message
- the ordered model list. 
The extension reads these values at runtime and will error if required fields are missing or unsupported.

The server host must also be allowed by `src/llm-chat.bkext/manifest.json` `host_permissions`. 

`ui.showErrorsInOutline` controls whether errors are inserted into the outline as `<error>` blocks (they are not parsed as assistant messages).

The cache inspector countdown intentionally tracks the short 5-minute cache window. One-hour cache markers (`<cache>`) still apply to prompt caching, but that longer TTL is not foregrounded in the inspector.

The default system message is only applied when no `<system>` marker appears before the cursor.

The extension also provides an editor style named "LLM Chat" (Bike > Window > Style Sheets) to show marker colors and code styling. Marker colors are configured under `ui.markerColors`.

## Usage

1. Create message blocks using markers at the root level:
   - `<user>` - Your message to the LLM
   - `<system>` - System instructions
   - `<assistant>` - Previous LLM responses (or any `<name>` marker)
   - Markers **must be root-level rows**; nested `<name>` rows become tags inside messages

2. Nest your content under the markers (indented)

3. Press `Shift+Cmd+L` to send (or run **LLM Chat: Send** from the command palette)
   - Tip: `Cmd+U` runs **LLM Chat: Insert User** to wrap the current selection in a `<user>` marker.

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
- Markdown conversion for special row types and rich text (lists, headings, quotes, tasks, code)
- Note-type rows are treated as comments (excluded from messages)
- Strict nesting: only indented content is included in messages
- Configurable server endpoint, polling interval, and default model (`config.json`)

### Message Parser Rules

- Markers must be root-level rows matching `<name>`.
- `<user>` → user role, `<system>` → system role; `<inline>`, `<cache>`, `<model>`, `<config>`, and `<error>` markers are ignored; any other marker → assistant role.
- `<cache>` marks the next message for a 1-hour cache breakpoint (latest `<cache>` wins, Anthropic only).
- Only content nested under a marker is included; note rows and their descendants are skipped.
- Special row types are converted to Markdown (`#` headings, `>` quotes, ordered/unordered/task lists, fenced code blocks).
- Rich text attributes are converted to inline Markdown (`*italic*`, `**bold**`, `` `code` ``, `~~strikethrough~~`, `[links](url)`); highlights are ignored.
- Parsing stops after the marker that contains the cursor row.
- Tags are indented `<name>` rows inside a message; they emit open/close tags and de-indent their contents.
- `<inline>` markers are root-level rows whose children list file URLs (or document display names). If a file URL or relative filename is provided, LLM Chat attempts to open it (requires `openURL` permission) before parsing; relative filenames resolve against the current document's folder, and nested inlines resolve relative to their own documents. Inline resolution follows link attributes first, then visible text, and cycles are errors.

### Outline Config Markers

- `<model>`: first non-empty line under the marker is matched (case-insensitive) against the ordered `models` list in `config.json`. The first match wins; unknown models raise errors. The provider is selected automatically from the matched model (or constrained by `<config>` `provider` if set).
- `<config>`: root-level marker with `key: value` lines (simple scalars). Allowed keys: `model` (exact string), `provider` (from the configured `models` list), `maxTokens` (positive number), `temperature` (0–2), `reasoningEffort` (`none`/`low`/`medium`/`high` for OpenAI). Unknown keys or invalid values raise errors.
- Multiple markers are merged in document order; later values win. Markers after the cursor row are ignored.
- Fuzzy model matching: `<model>` also supports substring matching (e.g., `sonnet` matches `claude-sonnet-4-5`) and in-order token matching (e.g., `sonnet 4.5` matches `claude-sonnet-4-5`).

### Provider Resolution

- Preferred path: use `<model>` so the extension resolves both model and provider from `config.json`.
- If you use `<config> model: ...`, that value is treated as an exact model string and does **not** auto-derive provider in the extension.
- In that case, if `<config> provider: ...` is omitted, the proxy falls back to heuristics:
  - contains `claude` / `haiku` / `sonnet` / `opus` → `anthropic`
  - contains `gpt` / `o1` → `openai`
  - otherwise → `anthropic`
- For OpenRouter models (for example `deepseek/...`, `google/...`), set `<config> provider: openrouter` (or use `<model>` matching against `config.json`) to avoid misrouting.

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

The extension inserts `<error>` marker rows when configured (`ui.showErrorsInOutline: true`) so failures are visible in the outline.

The provider connection is streamed on the server side, while the extension fetches chunks by polling `GET /chunks/{sessionId}`.
This polling design exists because the Bike extension runtime did not expose `ReadableStream` support for incremental HTTP response consumption.

## API (local server)

- **POST** `/chat` — body: `{ messages, model?, maxTokens?, temperature?, provider?, reasoningEffort? }` → `{ sessionId }`
- **GET** `/chunks/{sessionId}` — returns `{ chunks: string[], done: boolean, error: string | null, usage?: { cache_read_input_tokens?: number, cache_creation_input_tokens?: number, input_tokens?: number, output_tokens?: number, ... } }`

## Testing

```bash
npm run test:llm-chat
```

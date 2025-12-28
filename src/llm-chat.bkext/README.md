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

## Usage

1. Create message blocks using markers at the root level:
   - `<user>` - Your message to the LLM
   - `<system>` - System instructions
   - `<assistant>` - Previous LLM responses (or any `<name>` marker)

2. Nest your content under the markers (indented)

3. Press `Cmd+Shift+Return` to send

The response will stream in under an `<assistant>` heading.

## Example Document

```
<system>
  You are a helpful assistant.

<user>
  What is the capital of France?
```

After pressing `Cmd+Shift+Return`, an `<assistant>` block will be added with the response.

## Features

- Streaming responses (tokens appear as they arrive)
- Conversation history (multiple user/assistant exchanges)
- System prompts for custom behavior
- Note-type rows are treated as comments (excluded from messages)
- Strict nesting: only indented content is included in messages

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

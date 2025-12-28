# LLM Chat

Chat with Claude directly in your Bike outlines.

## Setup

### 1. Set your API key

Set your Anthropic API key in the document's metadata. Open Safari's debugger (Develop > Bike 2) and run:

```javascript
bike.frontmostOutlineEditor.outline.persistentMetadata.set("anthropic-api-key", "sk-ant-your-key-here")
```

Or use AppleScript:

```bash
osascript -l JavaScript -e '
Application("Bike").evaluate({
  input: "sk-ant-your-key-here",
  script: "(key) => { bike.frontmostOutlineEditor.outline.persistentMetadata.set(\"anthropic-api-key\", key); return \"API key set\"; }"
})
'
```

### 2. Enable streaming (optional but recommended)

For streaming responses (text appears as it's generated), run the local proxy server:

```bash
cd src/llm-chat.bkext/proxy
python3 server.py
```

The proxy runs on `http://localhost:3033`. Keep it running while using the extension.

Without the proxy, responses still work but appear all at once after generation completes.

## Usage

1. Create message blocks using markers at the root level:
   - `<user>` - Your message to the LLM
   - `<system>` - System instructions
   - `<assistant>` - Previous LLM responses (optional)

2. Place your cursor after your message content

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

- Streaming responses via local proxy (tokens appear as they arrive)
- Falls back to non-streaming when proxy isn't running
- Conversation history (multiple user/assistant exchanges)
- System prompts for custom behavior
- Uses Claude 3.5 Haiku for fast responses

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│    Bike     │ poll │   Python    │stream│  Anthropic  │
│  Extension  │<────>│   Proxy     │<────>│    API      │
└─────────────┘      └─────────────┘      └─────────────┘
                     localhost:3033
```

The proxy handles streaming from Anthropic and buffers chunks. The extension polls every 50ms for new chunks.

---
description: "Use az-scout's interactive CLI chat to query Azure deployment data directly from the terminal."
---

# Terminal Chat

az-scout includes an interactive AI chat that runs entirely in the terminal — no browser needed. It uses the same Azure OpenAI backend and MCP tools as the web UI chat.

---

## Quick start

```bash
# Interactive session
az-scout chat

# One-shot query
az-scout chat "What SKUs are available in francecentral with at least 8 vCPUs?"
```

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Enable verbose logging |

!!! note "Requirements"
    The CLI chat requires Azure OpenAI credentials — set `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_DEPLOYMENT` environment variables.

---

## Features

- **Rich-rendered streaming** — markdown, tables, code blocks rendered with [Rich](https://rich.readthedocs.io/)
- **Tool call visualization** — yellow panels show tool name and arguments, spinners during execution, green panels with result summaries
- **Interactive choices** — `[[choice]]` patterns from the AI render as numbered options you can select by typing the number
- **Conversation history** — Up/Down arrows navigate previous inputs
- **Tab auto-completion** — slash commands and their arguments (regions, modes, tenants, subscriptions) complete on Tab
- **Ctrl+C / Ctrl+D** — Ctrl+C clears the current input, Ctrl+D exits the session

---

## Slash commands

Type `/` to see the auto-complete menu. Commands accept optional arguments — without arguments, they open an interactive picker.

| Command | Argument | Description |
|---------|----------|-------------|
| `/help` | — | Show available commands |
| `/context` | — | Show current tenant, subscription, region, and mode |
| `/tenant` | `[id or name]` | Switch tenant |
| `/subscription` | `[id or name]` | Switch subscription |
| `/region` | `[name]` | Switch region (e.g. `/region francecentral`) |
| `/mode` | `[name]` | Switch chat mode (e.g. `/mode planner`) |
| `/tenants` | — | List accessible tenants with auth status |
| `/subscriptions` | — | List enabled subscriptions |
| `/regions` | — | List AZ-enabled regions |
| `/clear` | — | Clear conversation history |
| `/new` | — | Start a new session (re-select tenant, clear history) |
| `/exit` | — | Exit the chat session |

Arguments are validated against live Azure data — typing `/region toto` will show an error with a hint to use `/regions`.

---

## Chat modes

The CLI chat supports the same modes as the web UI:

- **discussion** *(default)* — general-purpose Azure assistant
- **planner** — guided deployment advisor

Plugin-contributed modes are also available. Switch with `/mode` or `/mode planner`.

Switching modes clears the conversation history (each mode has its own system prompt).

---

## Context management

At startup, the CLI auto-selects a tenant if only one is authenticated. Subscription and region are **not** selected upfront — the AI will ask when needed, or you can set them with slash commands.

The AI automatically injects tenant, subscription, and region context into tool calls, just like the web UI.

---

## Comparison with web UI chat

| Feature | Web UI | CLI |
|---------|--------|-----|
| Streaming responses | ✓ | ✓ |
| Tool calling | ✓ | ✓ |
| Markdown rendering | ✓ (HTML) | ✓ (Rich) |
| Interactive choices | Clickable chips | Numbered options |
| Mode switching | Toggle buttons | `/mode` command |
| Context switching | Dropdown selectors | `/tenant`, `/region`, `/subscription` |
| Conversation persistence | localStorage | In-memory (session only) |
| Plugin tools | ✓ | ✓ |

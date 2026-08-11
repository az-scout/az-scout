---
description: "az-scout plugin authoring conventions for sibling repos and internal_plugins. USE WHEN editing any az_scout_* package, internal_plugins/, or scaffold docs."
applyTo: "**/az_scout_*/**/*.py,**/internal_plugins/**/*.py,docs/plugin-scaffold/**"
---

# Plugin author conventions

Audience: **plugin authors** implementing the protocol.
For changes to the protocol itself, see `plugin-api.instructions.md`.

## Plugin protocol

Your plugin class must satisfy the `AzScoutPlugin` protocol from `az_scout.plugin_api`:

```python
class MyPlugin:
    name = "my-plugin"       # unique identifier (kebab-case)
    version = "0.1.0"

    def get_router(self) -> APIRouter | None: ...
    def get_mcp_tools(self) -> list[Callable] | None: ...
    def get_static_dir(self) -> Path | None: ...
    def get_tabs(self) -> list[TabDefinition] | None: ...
    def get_chat_modes(self) -> list[ChatMode] | None: ...
    def get_navbar_actions(self) -> list[NavbarAction] | None: ...

plugin = MyPlugin()  # module-level instance
```

## Key imports from az_scout

```python
from az_scout.plugin_api import (
    AzScoutPlugin, TabDefinition, ChatMode, NavbarAction,
    get_plugin_logger, PluginError, PluginValidationError, PluginUpstreamError,
    is_ai_enabled, plugin_ai_complete,
)
from az_scout.azure_api import arm_get, arm_post, arm_paginate, get_headers
```

## Conventions

- **Lazy imports** inside protocol methods (avoid circular imports at discovery)
- **Routes** mounted at `/plugins/{name}/` — use relative paths in the router
- **MCP tools** are plain functions with type annotations + descriptive docstrings
- **Static dir**: `Path(__file__).parent / "static"`
- **Type annotations** on all functions (`disallow_untyped_defs = true`)
- **Line length**: 100, ruff rules: `E, F, I, W, UP, B, SIM`
- **No global mutable state** — plugins must be fully self-contained

## AI completion (optional)

```python
if is_ai_enabled():
    result = await plugin_ai_complete(
        "Analyse this data...",
        system_prompt="You are a domain expert.",
        region="eastus",
        cache_ttl=600,  # seconds, 0 to bypass cache
    )
    content = result["content"]  # markdown text
    tools = result["tool_calls"]  # list of tool call metadata
```

## JS globals available to plugin scripts

`apiFetch`, `apiPost`, `aiComplete`, `aiEnabled`, `renderMarkdown`,
`tenantQS`, `escapeHtml`, `subscriptions`, `regions`

## Third-party / vendored assets (vendoring recommended)

The core ships all its own third-party assets **vendored locally** and does **not** enforce a
Content-Security-Policy. Vendoring is **recommended** for plugins (best for offline/air-gapped
self-hosting and reproducibility), but it is not required — plugins that reuse the core's
already-vendored libraries need no changes, and plugins **may** load assets from a CDN if they choose.

1. **Reuse what the core already vendors.** Bootstrap (+ Bootstrap Icons), D3, marked,
   highlight.js and simple-datatables are already loaded on the page or exposed as JS globals
   (`renderMarkdown`, `escapeHtml`, `d3`, …). Do **not** re-ship or re-link them.
2. **Prefer vendoring anything extra into your own package.** If your plugin needs an *additional*
   third-party JS/CSS/font, commit it under `static/vendor/` and reference it via
   `/plugins/{name}/static/vendor/…`. This keeps the plugin working offline / air-gapped; loading
   from a CDN also works but adds a runtime network dependency.

Your `static/` dir already ships in your wheel, so vendored files work identically across local
dev, SaaS publishing, and customer self-hosting — with no per-mode configuration.

Recommended (mirrors the core): keep a dependency-free, stdlib-only `tools/vendor_assets.py`-style
sync script with pinned versions to (re)download vendored files on a version bump. The committed
files remain the source of truth, so **no build tooling / npm / bundler** is introduced.

```html
<!-- ✅ vendored, served same-origin — works offline / air-gapped -->
<link rel="stylesheet" href="/plugins/my-plugin/static/vendor/chart/chart.min.css">
<script src="/plugins/my-plugin/static/vendor/chart/chart.min.js"></script>

<!-- ⚠️ external CDN — allowed (no CSP), but adds a runtime network dependency -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

## Create a new plugin

If you need to create a new plugin, use the following command to scaffold a new plugin directory with template files:

```bash
az-scout create-plugin
```

Follow the prompts to enter the plugin name and description. This will create a new directory with a basic plugin structure and you can start implementing your plugin logic there.

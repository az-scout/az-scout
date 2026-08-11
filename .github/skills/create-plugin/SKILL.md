---
name: create-plugin
description: "Scaffold a new az-scout plugin from the template. USE WHEN: create plugin, new plugin, scaffold plugin, build a plugin for az-scout."
argument-hint: "Describe the plugin you want to create (e.g. 'a plugin that shows Azure Batch SKU availability')"
---

# Create az-scout Plugin

Scaffold a new az-scout plugin using the built-in generator.

## When to Use

- Creating a brand-new az-scout plugin from scratch
- Starting a new plugin project with the correct structure

## Procedure

### 1. Run the scaffold generator

Run the interactive scaffold command:

```bash
uv run python tools/plugin-scaffold/create_plugin.py
```

This prompts for:
- **Plugin name** (e.g. `batch-sku`) → creates `az-scout-plugin-batch-sku`
- **Description**
- **Author name and email**
- **Capabilities** — which extension points to include:
  - API routes (FastAPI router)
  - MCP tools (AI agent tools)
  - UI tab (frontend tab with JS/CSS)
  - AI chat mode (custom chat persona)
  - Navbar action (offcanvas panel button)

### 2. Review the generated structure

The generator creates a complete src-layout package:

```
az-scout-plugin-{name}/
├── pyproject.toml              # hatchling, entry point, ruff, mypy
├── README.md
├── LICENSE.txt
├── src/az_scout_{name}/
│   ├── __init__.py             # Plugin class + module-level instance
│   ├── routes.py               # FastAPI router (if routes selected)
│   ├── tools.py                # MCP tool functions (if tools selected)
│   └── static/
│       ├── js/{name}-tab.js    # Tab JS (if tab selected)
│       └── css/{name}-tab.css  # Tab CSS (if tab selected)
└── tests/
    └── test_{name}.py          # Basic test scaffold
```

### 3. Install for development

```bash
cd az-scout-plugin-{name}
uv pip install -e .
```

### 4. Key conventions

Refer to [plugin-dev.instructions.md](../../instructions/plugin-dev.instructions.md) for full conventions. Key points:

- **Entry point** in `pyproject.toml`: `[project.entry-points."az_scout.plugins"]`
- **Lazy imports** inside protocol methods to avoid circular imports
- **Routes** mounted at `/plugins/{name}/` — use relative paths
- **MCP tools** are plain functions with type annotations + docstrings
- **Static dir** defined as `Path(__file__).parent / "static"`
- **Prefer vendoring** — reuse the core's vendored libs (Bootstrap, Bootstrap Icons, D3, marked,
  highlight.js, simple-datatables) or vendor extra deps into `static/vendor/` and reference them
  via `/plugins/{name}/static/vendor/…`. The app enforces no CSP, so CDNs are allowed, but
  vendoring is recommended for offline / air-gapped self-hosting.
- **AI completion**: Use `plugin_ai_complete()` / `aiComplete()` for inline AI recommendations
- **AI availability**: Check `is_ai_enabled()` (Python) or `aiEnabled` (JS) before calling AI

### 5. Existing plugin examples

Study these plugins for patterns:

| Plugin | Capabilities | Notable patterns |
|---|---|---|
| `internal_plugins/topology/` | Routes, MCP tool, tab | Zone mapping visualization with D3.js |
| `internal_plugins/planner/` | Routes, MCP tools, tab, chat mode | Multi-tool chat mode, deployment planning |
| `az-scout-plugin-avs-sku` | Routes, MCP tools, tab, chat mode | AVS-specific SKU analysis |
| `az-scout-plugin-odcr-coverage` | Routes, MCP tools, tab, chat mode, navbar action | ODCR analysis with AI recommendations |

### 6. Quality checks

Before publishing, ensure:

```bash
uv run ruff check src/ tests/
uv run ruff format --check src/ tests/
uv run mypy src/
uv run pytest
```

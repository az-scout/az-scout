---
description: "Frontend conventions for az-scout: vanilla JS, CSS theming, Jinja2 templates, chat panel, marked.js. USE WHEN editing static JS/CSS files, HTML templates, or UI components."
applyTo: "src/az_scout/static/**,src/az_scout/templates/**"
---

# Frontend conventions

## JavaScript

- Vanilla JS only — no npm, no bundler, no frameworks.
- Use `const`/`let` (never `var`). Functions and variables use `camelCase`.
- Biome lint is enforced via pre-commit hooks.
- Scripts load order: auth.js → app.js → components/*.js → chat.js → plugins.js → plugin scripts → inline setup

## Shared JS components (`static/js/components/`)

Reusable renderers available to all plugins via the `window.azScout.components` namespace:

| Module | Functions |
|---|---|
| `sku-badges.js` | `scoreLabel()`, `renderConfidenceBadge()`, `renderSpotBadges()`, `renderSpotBadge()`, `renderZoneBadges()`, `renderQuotaBar()` |
| `sku-detail-modal.js` | `renderVmProfile()`, `renderZoneAvailability()`, `renderQuotaPanel()`, `renderConfidenceBreakdown()`, `renderPricingPanel()`, `showSkuDetailModal()` |
| `data-filters.js` | `parseNumericFilter()`, `matchNumericFilter()`, `buildColumnFilters()`, `applyColumnFilters()` |

## CSS

- Use CSS custom properties (defined in `:root`) for all theme colors.
- Both light and dark themes **must** be maintained.
- Dark mode uses `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` selectors.

## HTML templates

- Minimal Jinja2 templating in `templates/index.html`.
- Static assets referenced via `url_for('static', ...)`.
- Plugin tabs/actions injected dynamically from `get_plugin_metadata()`.

## Vendoring assets locally (recommended, not enforced)

- Core third-party JS/CSS/fonts are **vendored** under `static/vendor/` and served via the `/static`
  mount. Vendoring is recommended (best for offline/air-gapped/self-hosting and reproducibility), but
  the app does **not** enforce a Content-Security-Policy, so `<script>`/`<link>` tags pointing at a CDN
  will work if you choose to use one.
- Reuse the already-vendored libs (Bootstrap, Bootstrap Icons, D3, marked, highlight.js,
  simple-datatables) rather than adding another copy.
- To add or bump a vendored library, edit the pinned manifest in `tools/vendor_assets.py` and run
  `python tools/vendor_assets.py`; commit the downloaded files (they are the source of truth — no
  build tooling). Keep font files beside their CSS if the CSS uses relative `url("fonts/...")`.
- Plugins may follow the same practice and vendor their own extras — see `plugin-author.instructions.md`.

## Shared globals (available to plugins)

| Global | Description |
|---|---|
| `apiFetch(url)` | GET with JSON parsing + error handling |
| `apiPost(url, body)` | POST helper |
| `aiComplete(prompt, options?)` | Non-streaming AI completion (returns `{content, tool_calls}`) |
| `aiEnabled` | `true` if AI chat/completion is configured |
| `renderMarkdown(md)` | Render Markdown to HTML via marked.js |
| `tenantQS(prefix)` | Returns `?tenantId=…` or `""` |
| `escapeHtml(str)` | OWASP Rule #1 entity encoding (`& < > " '`). **Must** be used on every value interpolated into `innerHTML` or attribute contexts. Handles both body and attribute (including `title="..."`, `data-*="..."`) safely. |
| `subscriptions` | `[{id, name}]` array |
| `regions` | `[{name, displayName}]` array |

## Chat panel

- `_renderMarkdown()` in chat.js uses marked.js with custom extensions:
  - `[[choice text]]` → clickable chip buttons
  - Tables get `chat-table` CSS class
  - Headers use compact margins
  - Lists of all-chip items become compact chip groups
- Chat bubbles use `overflow-x: auto` for wide tables.

## Context changes

Plugins react to tenant/region changes via DOM events or MutationObserver on `#region-select`.

## XSS prevention

- **Every** value from Azure APIs or user input interpolated into `innerHTML` **must** be escaped with `escapeHtml()`.
- This applies to both element body (`<span>${escapeHtml(name)}</span>`) and attribute contexts (`title="${escapeHtml(tip)}"`).
- `escapeHtml()` encodes the 5 OWASP-mandated characters: `& < > " '`.
- Do **not** define local escape helpers in plugin JS — reuse the global `escapeHtml()` from `app.js`.
- For standalone HTML fragments loaded outside `app.js` (e.g. `catalog.html`), use a local fallback that applies the same 5 replacements.

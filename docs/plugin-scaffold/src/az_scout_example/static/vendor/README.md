# Vendored third-party assets

This directory is an **optional** home for any third-party JS/CSS/font your plugin ships itself.
az-scout serves plugin static files **same-origin** and does **not** enforce a
Content-Security-Policy, so vendored assets work out of the box — and loading from a CDN also works
if you prefer. Vendoring is **recommended** because same-origin files keep your plugin working
offline / air-gapped and make deployments reproducible.

## Do you actually need to vendor anything?

Reuse the core's already-vendored libraries first. These are loaded on the page or exposed as JS
globals, so you don't ship them yourself:

- **Bootstrap** + **Bootstrap Icons** (CSS classes such as `bi bi-puzzle`)
- **D3** (`d3` global)
- **marked** (`renderMarkdown(md)` global)
- **highlight.js**
- **simple-datatables**

Plus helpers: `apiFetch`, `apiPost`, `aiComplete`, `aiEnabled`, `escapeHtml`, `tenantQS`,
`subscriptions`, `regions`.

## Vendoring an extra library

If your plugin needs an *additional* third-party JS/CSS/font, drop the pinned file(s) in this
directory and reference them from your own static prefix:

```html
<!-- vendored, same-origin — works offline / air-gapped (recommended) -->
<link rel="stylesheet" href="/plugins/example/static/vendor/chart/chart.min.css">
<script src="/plugins/example/static/vendor/chart/chart.min.js"></script>

<!-- external CDN — also works (no CSP), but adds a runtime network dependency -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

If a CSS file references fonts by relative URL (e.g. `url("fonts/...")`), keep those fonts in a
sibling `fonts/` folder next to the CSS so the relative path resolves.

Your `static/` directory ships in the wheel automatically, so vendored files behave identically
across local dev, SaaS publishing, and customer self-hosting — no per-mode configuration.

## Keeping vendored files up to date (optional)

Mirror the core: add a small dependency-free (stdlib `urllib` only) `tools/vendor_assets.py`
script that pins versions and re-downloads into this folder on a bump. The committed files remain
the source of truth, so **no npm, bundler, or build step** is introduced.

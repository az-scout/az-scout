---
description: Add a new plugin to the official az-scout plugin catalog (az-scout/plugin-catalog).
---

Add a new external plugin to the az-scout plugin catalog hosted at
[az-scout/plugin-catalog](https://github.com/az-scout/plugin-catalog).
The user will provide the plugin name, GitHub URL, and optionally its PyPI status.

## 1. Gather plugin information

Collect:

- **Plugin name** (package name, e.g. `az-scout-plugin-foo`)
- **GitHub repository URL** (e.g. `https://github.com/owner/az-scout-plugin-foo`)
- **Short description** (one line)
- **Source:** `pypi` if published on PyPI, otherwise `github`
- **Authors** — GitHub usernames of the plugin authors
- **Tags** — keyword tags for the plugin (e.g. `["batch", "sku"]`)

If only a GitHub URL is provided, use `mcp_github_get_file_contents` to read the plugin's
`pyproject.toml` and `README.md` to extract the package name, description, and author info.

Verify the plugin is a valid az-scout plugin by checking that its `pyproject.toml` declares
an `az_scout.plugins` entry point.

## 2. Fetch current catalog

Use `mcp_github_get_file_contents` to read the current `catalog.json` from
`az-scout/plugin-catalog` (main branch).

## 3. Prepare the new entry

Create a JSON entry following the catalog schema:

```json
{
  "name": "az-scout-plugin-foo",
  "description": "Short description.",
  "source": "pypi",
  "repository": "https://github.com/owner/az-scout-plugin-foo",
  "authors": ["github-username"],
  "tags": ["tag1", "tag2"]
}
```

For GitHub-only plugins (not on PyPI), add a `url` field:

```json
{
  "name": "az-scout-plugin-foo",
  "description": "Short description.",
  "source": "github",
  "url": "https://github.com/owner/az-scout-plugin-foo",
  "repository": "https://github.com/owner/az-scout-plugin-foo",
  "authors": ["github-username"],
  "tags": ["tag1", "tag2"]
}
```

## 4. Open a PR on the plugin-catalog repo

1. Use `mcp_github_create_branch` to create a branch on `az-scout/plugin-catalog`
   (e.g. `add-plugin-foo`)
2. Use `mcp_github_create_or_update_file` to update `catalog.json` with the new entry
   inserted in alphabetical order by `name`
3. Use `mcp_github_create_pull_request` to open a PR against `main` on
   `az-scout/plugin-catalog` with:
   - **Title:** `Add {plugin-name} to catalog`
   - **Body:** Plugin description, repository link, source type, and tags

## 5. Summary

Report:

- The new catalog entry (JSON)
- The PR URL on `az-scout/plugin-catalog`

Update `CHANGELOG.md` under `## Unreleased` with the new plugin addition.

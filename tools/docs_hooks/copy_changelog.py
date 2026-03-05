"""MkDocs hook: copy external markdown sources into docs/ before build."""

import logging
from pathlib import Path

_LINK_REWRITES: dict[str, str] = {
    "(docs/plugins.md)": "(plugins/index.md)",
    "(docs/plugin-scaffold/)": "(plugins/scaffold.md)",
}

log = logging.getLogger("mkdocs.hooks.copy_changelog")


def on_pre_build(config: dict, **kwargs: object) -> None:  # type: ignore[type-arg]
    """Copy generated docs files from project root sources."""
    docs_dir = Path(config["docs_dir"])
    root = docs_dir.parent

    changelog_src = root / "CHANGELOG.md"
    changelog_dst = docs_dir / "_changelog.md"
    if changelog_src.exists():
        changelog_content = changelog_src.read_text(encoding="utf-8")
        for source, target in _LINK_REWRITES.items():
            changelog_content = changelog_content.replace(source, target)
        changelog_dst.write_text(changelog_content, encoding="utf-8")
        log.info("Copied %s → %s", changelog_src, changelog_dst)

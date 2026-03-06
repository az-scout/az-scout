#!/usr/bin/env python3
"""Development wrapper for plugin scaffold generation."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    src_dir = repo_root / "src"
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))

    from az_scout.plugin_scaffold import main as scaffold_main

    return scaffold_main()


if __name__ == "__main__":
    raise SystemExit(main())

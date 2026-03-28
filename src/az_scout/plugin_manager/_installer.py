"""pip/uv wrapper for installing and uninstalling plugins."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

import az_scout.plugin_manager._storage as _storage

logger = logging.getLogger(__name__)

# File suffixes that indicate compiled native extensions.
_NATIVE_SUFFIXES = (".so", ".pyd", ".dylib")


def _find_uv() -> str | None:
    """Return the path to the ``uv`` executable, or ``None`` if not found."""
    return shutil.which("uv")


def _in_virtualenv() -> bool:
    """Return True if running inside a virtual environment."""
    return sys.prefix != sys.base_prefix


def _pip_env() -> dict[str, str]:
    """Return an environment dict for pip/uv subprocess calls."""
    env = os.environ.copy()
    env["UV_CACHE_DIR"] = str(_storage._UV_CACHE_DIR)
    env["UV_LINK_MODE"] = "copy"
    return env


def run_pip(args: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a ``pip`` command that installs/uninstalls into the plugin packages dir.

    Uses ``uv pip`` when available, otherwise falls back to ``python -m pip``.
    """
    _storage._PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    env = _pip_env()
    uv = _find_uv()
    sub_args = list(args[1:])  # drop leading "pip"

    if uv:
        cmd: list[str] = [uv, "pip", *sub_args, "--target", str(_storage._PACKAGES_DIR)]
        # In containerized environments (e.g. ACA) there may be no virtual
        # environment.  uv requires --system in that case.
        if not _in_virtualenv():
            cmd.append("--system")
    else:
        if sub_args and sub_args[0] == "uninstall" and "-y" not in sub_args:
            sub_args.insert(1, "-y")
        cmd = [sys.executable, "-m", "pip", *sub_args, "--target", str(_storage._PACKAGES_DIR)]

    logger.info("Running plugin pip: %s", " ".join(cmd))
    return subprocess.run(  # noqa: S603
        cmd,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def snapshot_native_files(packages_dir: Path | None = None) -> set[Path]:
    """Return the set of compiled extension files currently in *packages_dir*."""
    pkg = packages_dir or _storage._PACKAGES_DIR
    if not pkg.exists():
        return set()
    result: set[Path] = set()
    for suffix in _NATIVE_SUFFIXES:
        result.update(pkg.glob(f"**/*{suffix}"))
    return result


def has_new_native_extensions(
    before: set[Path],
    packages_dir: Path | None = None,
) -> bool:
    """Return ``True`` if new compiled extensions appeared since *before* snapshot."""
    after = snapshot_native_files(packages_dir)
    new = after - before
    if new:
        logger.info(
            "Detected %d new native extension file(s): %s",
            len(new),
            ", ".join(sorted(p.name for p in new)),
        )
    return bool(new)

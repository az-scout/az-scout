"""pip/uv wrapper for installing and uninstalling plugins."""

from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
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

    For install operations, a constraints file is generated to pin ``az-scout``
    to the running version, preventing pip from installing a different core
    version into the target directory.
    """
    _storage._PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    env = _pip_env()
    uv = _find_uv()
    sub_args = list(args[1:])  # drop leading "pip"
    is_install = sub_args and sub_args[0] == "install"

    # Generate a constraints file to prevent core package installation
    constraint_file = None
    if is_install:
        constraint_file = _write_core_constraint()
        if constraint_file:
            sub_args.insert(1, f"--constraint={constraint_file}")

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
    result = subprocess.run(  # noqa: S603
        cmd,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    # Clean up the temporary constraints file
    if constraint_file:
        with contextlib.suppress(Exception):
            Path(constraint_file).unlink(missing_ok=True)

    # A ``--target`` install re-resolves in isolation and drags a full copy of the
    # ``az-scout`` core (and its dependency tree) into the packages directory. That
    # directory is prepended to ``sys.path`` at startup, so a stray core copy would
    # shadow the running core. The core is always importable from the active
    # environment, so remove any copy that landed in the packages dir.
    if is_install and result.returncode == 0:
        _prune_core_from_packages()

    return result


def _prune_core_from_packages(packages_dir: Path | None = None) -> None:
    """Remove any ``az-scout`` core copy that a ``--target`` install left behind.

    Only the core is pruned: the top-level ``az_scout`` package directory and its
    ``az_scout-*.dist-info`` metadata. Plugin packages (``az_scout_*``) and their
    ``az_scout_*-*.dist-info`` directories use an underscore separator and are left
    untouched.
    """
    pkg = packages_dir or _storage._PACKAGES_DIR
    if not pkg.exists():
        return
    core_dir = pkg / "az_scout"
    if core_dir.is_dir():
        logger.debug("Pruning stray az-scout core package from packages dir: %s", core_dir)
        shutil.rmtree(core_dir, ignore_errors=True)
    for info in pkg.glob("az_scout-*.dist-info"):
        logger.debug("Pruning stray az-scout core dist-info from packages dir: %s", info)
        shutil.rmtree(info, ignore_errors=True)


def _core_is_local_install() -> bool:
    """Return ``True`` if the ``az-scout`` core is an editable or local ``file:`` install.

    Such installs (dev worktrees, ``pip install .``) expose their version only on
    disk, never on a package index.  Pinning ``az-scout==<version>`` as a pip
    constraint would then be unsatisfiable and break every plugin install, so the
    constraint is skipped in that case.  Detection uses the PEP 610
    ``direct_url.json`` metadata, which is absent for regular index installs.

    All installed ``az-scout`` distributions are scanned, not just the first one on
    ``sys.path``: the plugin packages directory is prepended to ``sys.path`` and may
    contain a stray non-editable core copy that would otherwise shadow the real
    editable checkout and defeat this check.
    """
    try:
        from importlib.metadata import distributions

        found = False
        for dist in distributions():
            try:
                meta = dist.metadata
                name = meta["Name"] if meta else None
                if not name or name.lower().replace("_", "-") != "az-scout":
                    continue
                found = True
                raw = dist.read_text("direct_url.json")
                if not raw:
                    continue
                data = json.loads(raw)
                if data.get("dir_info", {}).get("editable"):
                    return True
                url = data.get("url", "")
                if isinstance(url, str) and url.startswith("file:"):
                    return True
            except Exception:
                logger.debug(
                    "Skipping unreadable distribution during local core check: %r",
                    dist,
                    exc_info=True,
                )
                continue
        # If no az-scout distribution metadata is discoverable at all, err on the
        # side of skipping the constraint rather than emitting an unsatisfiable pin.
        return not found
    except Exception:
        return False


def _write_core_constraint() -> str | None:
    """Write a temporary constraints file pinning ``az-scout`` to the running version.

    Returns the file path, or ``None`` if the version cannot be determined or the
    core is installed editable / from a local ``file:`` URL (whose version is not
    published on any index).
    """
    try:
        from az_scout import __version__

        if not __version__ or __version__ == "0.0.0-dev" or "dev" in __version__:
            return None
        if _core_is_local_install():
            logger.debug("Skipping core constraint: az-scout is a local/editable install")
            return None
        fd, path = tempfile.mkstemp(prefix="azscout-constraint-", suffix=".txt")
        with os.fdopen(fd, "w") as f:
            f.write(f"az-scout=={__version__}\n")
        logger.debug("Core constraint file: %s (az-scout==%s)", path, __version__)
        return path
    except Exception:
        return None


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

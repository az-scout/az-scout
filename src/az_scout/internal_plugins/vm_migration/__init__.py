"""VM v6/v7 Migration – internal plugin.

Provides a dashboard of VMs that are candidates for migration from v2–v5
series to the v6/v7 Azure VM series, with enriched metadata per VM.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from az_scout import __version__
from az_scout.plugin_api import AzScoutPlugin, ChatMode, NavbarAction, TabDefinition

_STATIC_DIR = Path(__file__).parent / "static"


class VmMigrationPlugin:
    """Internal plugin: VM v6/v7 Migration dashboard."""

    name = "vm-migration"
    display_name = "VM Migration"
    version = __version__
    internal = True
    description = "Dashboard of VMs impacted by the Azure v2–v5 → v6/v7 series migration."

    def get_router(self) -> APIRouter | None:
        from az_scout.internal_plugins.vm_migration.routes import router

        return router

    def get_mcp_tools(self) -> list[Callable[..., Any]] | None:
        from az_scout.internal_plugins.vm_migration.tools import list_migration_candidate_vms

        return [list_migration_candidate_vms]

    def get_static_dir(self) -> Path | None:
        return _STATIC_DIR

    def get_tabs(self) -> list[TabDefinition] | None:
        return [
            TabDefinition(
                id="vm-migration",
                label="VM Migration",
                icon="bi bi-arrow-up-circle",
                js_entry="js/vm-migration-tab.js",
                css_entry="css/vm-migration-tab.css",
            )
        ]

    def get_chat_modes(self) -> list[ChatMode] | None:
        return None

    def get_navbar_actions(self) -> list[NavbarAction] | None:
        return None


plugin: AzScoutPlugin = VmMigrationPlugin()

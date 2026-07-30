"""VM v6/v7 SKU Migration Scope – internal plugin.

Provides an inventory of legacy SKU VMs (v2-v5) that are in scope for
v6/v7 SKU-family migration planning, with enriched metadata per VM.
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
    """Internal plugin: VM v6/v7 SKU Migration Scope dashboard."""

    name = "vm-migration"
    display_name = "SKU Migration Scope"
    version = __version__
    internal = True
    description = (
        "Inventory of legacy SKU VMs (v2-v5) in scope for v6/v7 SKU-family migration planning."
    )

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
                label="SKU Migration Scope",
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

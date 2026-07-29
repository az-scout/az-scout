"""MCP tools for the VM v6/v7 Migration internal plugin."""

from __future__ import annotations

from az_scout import azure_api
from az_scout.internal_plugins.vm_migration.routes import (
    _fetch_vms_for_subscription,
    _is_migration_candidate,
)


def list_migration_candidate_vms(
    subscription_ids: list[str],
    tenant_id: str | None = None,
) -> list[dict]:
    """List all Azure VMs that are candidates for migration to the v6/v7 series.

    Returns VMs currently running v2–v5 generation SKUs with fields:
    name, resource_group, subscription_id, subscription_name, region, sku,
    generation, os_type, image_publisher, disk_controller_type, zones.

    Args:
        subscription_ids: List of Azure subscription IDs to scan.
        tenant_id: Optional Azure AD tenant ID to scope the request.
    """
    known_subs: dict[str, str] = {}
    try:
        all_subs = azure_api.list_subscriptions(tenant_id)
        known_subs = {s["id"]: s.get("name", s["id"]) for s in all_subs}
    except Exception:
        pass

    results: list[dict] = []
    for sub_id in subscription_ids:
        sub_name = known_subs.get(sub_id, sub_id)
        results.extend(_fetch_vms_for_subscription(sub_id, sub_name, tenant_id))
    return results


# Re-export for use in unit tests
__all__ = ["list_migration_candidate_vms", "_is_migration_candidate"]

"""MCP tools for the VM v6/v7 Migration internal plugin."""

from __future__ import annotations

import json
from typing import Annotated

from pydantic import Field

from az_scout import azure_api
from az_scout.internal_plugins.vm_migration.routes import _fetch_vms_for_subscription


def list_migration_candidate_vms(
    subscription_ids: Annotated[
        list[str],
        Field(description="List of Azure subscription IDs to scan."),
    ],
    tenant_id: Annotated[
        str | None,
        Field(description="Optional Azure AD tenant ID to scope the request."),
    ] = None,
) -> str:
    """List Azure VMs that are candidates for migration to the v6/v7 series.

    Returns all VMs using v2-v5 generation SKUs (e.g. Standard_D4s_v3,
    Standard_E8ds_v5) across the given subscriptions, with fields:
    name, resource_group, subscription_id, subscription_name, region, sku,
    generation, os_type, image_publisher, disk_controller_type, zones.

    Use this tool to assess migration scope before planning a v6/v7 upgrade.

    Generation values:
    - "V2" / "V1": confirmed from security profile or image reference
    - "V2 (inferred)" / "V1 (inferred)": estimated from SKU family (v4/v5 -> V2, v2/v3 -> V1)
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
    return json.dumps(results, indent=2)

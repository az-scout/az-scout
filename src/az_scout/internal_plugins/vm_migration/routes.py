"""API routes for the VM v6/v7 Migration internal plugin."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from fastapi import APIRouter, Query
from starlette.responses import JSONResponse

from az_scout import azure_api
from az_scout.azure_api import ArmAuthorizationError, ArmRequestError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Plugin: vm-migration"])

# VM SKU families v2–v5 are migration candidates.
# Matches Standard_D4s_v3, Standard_E8ds_v4, Standard_B2ms_v2,
# and Promo variants like Standard_D4_v3_Promo.
_V2_TO_V5_RE = re.compile(r"_v[2-5][a-z]*(_promo)?$", re.IGNORECASE)

# Marker strings in image SKU names that indicate Generation 2
_GEN2_IMAGE_MARKERS = ("gen2", "-g2", "2gen")

_ARM_API_VERSION = "2024-07-01"


def _parse_resource_group(resource_id: str) -> str:
    """Extract the resource group name from an ARM resource ID."""
    parts = resource_id.split("/")
    try:
        idx = [p.lower() for p in parts].index("resourcegroups")
        return parts[idx + 1]
    except (ValueError, IndexError):
        return ""


def _detect_generation(vm: dict[str, Any]) -> str:
    """Derive the HyperV generation from available VM fields.

    Priority:
    1. securityProfile.securityType (TrustedLaunch / ConfidentialVM → V2)
    2. imageReference.sku containing a Gen 2 marker (gen2, -g2)
    3. SKU family: v4/v5 → V2 likely; v2/v3 → V1 likely
    """
    props = vm.get("properties", {})

    security_type = props.get("securityProfile", {}).get("securityType", "")
    if security_type in ("TrustedLaunch", "ConfidentialVM"):
        return "V2"

    img_sku = props.get("storageProfile", {}).get("imageReference", {}).get("sku", "").lower()
    if any(m in img_sku for m in _GEN2_IMAGE_MARKERS):
        return "V2"

    vm_size = props.get("hardwareProfile", {}).get("vmSize", "")
    match = re.search(r"_v([2-5])", vm_size, re.IGNORECASE)
    if match:
        gen_num = int(match.group(1))
        return "V2 (inferred)" if gen_num >= 4 else "V1 (inferred)"

    return "Unknown"


def _is_migration_candidate(vm_size: str) -> bool:
    """Return True when the SKU belongs to a v2–v5 family."""
    return bool(_V2_TO_V5_RE.search(vm_size))


def _build_vm_record(
    vm: dict[str, Any],
    sub_id: str,
    sub_name: str,
) -> dict[str, Any]:
    """Transform an ARM VM object into the dashboard record shape."""
    props = vm.get("properties", {})
    storage = props.get("storageProfile", {})
    image_ref = storage.get("imageReference", {})
    os_disk = storage.get("osDisk", {})

    return {
        "name": vm.get("name", ""),
        "resource_group": _parse_resource_group(vm.get("id", "")),
        "subscription_id": sub_id,
        "subscription_name": sub_name,
        "region": vm.get("location", ""),
        "sku": props.get("hardwareProfile", {}).get("vmSize", ""),
        "generation": _detect_generation(vm),
        "os_type": os_disk.get("osType", ""),
        "image_publisher": image_ref.get("publisher", ""),
        "disk_controller_type": os_disk.get("diskControllerType", "SCSI"),
        "zones": vm.get("zones", []),
    }


def _fetch_vms_for_subscription(
    sub_id: str,
    sub_name: str,
    tenant_id: str | None,
) -> list[dict[str, Any]]:
    """List migration-candidate VMs for one subscription (blocking)."""
    url = (
        f"https://management.azure.com/subscriptions/{sub_id}"
        "/providers/Microsoft.Compute/virtualMachines"
    )
    try:
        vms = azure_api.arm_paginate(
            url,
            params={"api-version": _ARM_API_VERSION},
            tenant_id=tenant_id,
        )
    except ArmAuthorizationError:
        logger.warning("No access to subscription %s — skipping", sub_id)
        return []
    except ArmRequestError as exc:
        logger.warning("ARM error for subscription %s: %s — skipping", sub_id, exc)
        return []

    records: list[dict[str, Any]] = []
    for vm in vms:
        vm_size = vm.get("properties", {}).get("hardwareProfile", {}).get("vmSize", "")
        if _is_migration_candidate(vm_size):
            records.append(_build_vm_record(vm, sub_id, sub_name))
    return records


@router.get(
    "/vms",
    summary="List legacy-SKU VMs in migration scope for v6/v7 planning",
    responses={400: {"model": dict}},
)
async def get_migration_vms(
    subscriptions: str | None = Query(None, description="Comma-separated subscription IDs."),
    tenantId: str | None = Query(None, description="Optional tenant ID."),  # noqa: N803
) -> JSONResponse:
    """Return legacy-SKU VM inventory (v2-v5) for v6/v7 migration planning scope."""
    if not subscriptions:
        return JSONResponse(
            {"error": "'subscriptions' query parameter is required"},
            status_code=400,
        )
    sub_ids = [s.strip() for s in subscriptions.split(",") if s.strip()]
    if not sub_ids:
        return JSONResponse(
            {"error": "'subscriptions' query parameter is required"},
            status_code=400,
        )

    # Resolve subscription names from ARM discovery
    known_subs: dict[str, str] = {}
    try:
        all_subs = await asyncio.to_thread(azure_api.list_subscriptions, tenantId)
        known_subs = {s["id"]: s.get("name", s["id"]) for s in all_subs}
    except Exception:
        logger.debug("Could not resolve subscription names — using IDs as names")

    results: list[dict[str, Any]] = []
    for sub_id in sub_ids:
        sub_name = known_subs.get(sub_id, sub_id)
        items = await asyncio.to_thread(_fetch_vms_for_subscription, sub_id, sub_name, tenantId)
        results.extend(items)

    return JSONResponse(results)

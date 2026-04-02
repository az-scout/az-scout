"""Shared Azure ARM API helpers – **stable plugin API surface**.

Provides pure-data functions that both the FastAPI web UI, the MCP server,
and **plugins** can call.  Every public function returns plain Python objects
(dicts / lists) – no framework ``Response`` wrappers.

Stability guarantee
-------------------
Names listed in ``__all__`` form the **public API** and follow semantic
versioning tracked by :data:`PLUGIN_API_VERSION`.  Breaking changes
(signature removals, incompatible return-type changes) bump the major
version; additive changes bump the minor version.

Names prefixed with ``_`` are **internal** – they are re-exported for
backward compatibility (tests, core modules) but plugins **must not**
rely on them.  They can change without notice.

Plugin compatibility check::

    from az_scout.azure_api import PLUGIN_API_VERSION
    major, minor = (int(x) for x in PLUGIN_API_VERSION.split("."))
    assert major == 1, f"Incompatible azure_api version: {PLUGIN_API_VERSION}"
"""

import time as time  # noqa: F401  # re-export for mock patching
from typing import Any

import requests as requests  # noqa: F401  # re-export for mock patching

# -- ARM helpers (public API for plugins) ------------------------------------
from az_scout.azure_api._arm import (  # noqa: F401
    ArmAuthorizationError,
    ArmNotFoundError,
    ArmRequestError,
    arm_get,
    arm_paginate,
    arm_post,
    get_headers,
)

# -- Auth & constants -------------------------------------------------------
from az_scout.azure_api._auth import (  # noqa: F401
    AZURE_API_VERSION,
    AZURE_MGMT_URL,
    _check_tenant_auth,
    _get_default_tenant_id,
    _get_headers,
    _suppress_stderr,
    credential,
)

# -- Caches (exposed for test fixtures) -------------------------------------
from az_scout.azure_api._cache import (  # noqa: F401
    _cache_set,
    _cached,
    _discovery_cache,
)

# -- OBO (On-Behalf-Of) ----------------------------------------------------
from az_scout.azure_api._obo import (  # noqa: F401
    OboTokenError,
    is_obo_enabled,
    obo_exchange,
)

# -- Pagination --------------------------------------------------------------
from az_scout.azure_api._pagination import _paginate  # noqa: F401

# -- Discovery ---------------------------------------------------------------
from az_scout.azure_api.discovery import (  # noqa: F401
    list_locations,
    list_regions,
    list_subscriptions,
    list_tenants,
    preload_discovery,
)

# -- Pricing -----------------------------------------------------------------
from az_scout.azure_api.pricing import (  # noqa: F401
    RETAIL_PRICES_API_VERSION,
    RETAIL_PRICES_URL,
    _detail_price_cache,
    _price_cache,
    enrich_skus_with_prices,
    get_retail_prices,
    get_sku_pricing_detail,
)

# -- Quotas ------------------------------------------------------------------
from az_scout.azure_api.quotas import (  # noqa: F401
    COMPUTE_API_VERSION,
    _normalize_family,
    _usage_cache,
    enrich_skus_with_quotas,
    get_compute_usages,
)

# -- SKUs --------------------------------------------------------------------
from az_scout.azure_api.skus import (  # noqa: F401
    _parse_capability_value,
    _sku_list_cache,
    _sku_name_matches,
    _sku_profile_cache,
    get_mappings,
    get_sku_profile,
    get_skus,
    parse_sku_series,
)

# -- Spot --------------------------------------------------------------------
from az_scout.azure_api.spot import (  # noqa: F401
    SPOT_API_VERSION,
    _spot_cache,
    get_spot_placement_scores,
)

# -- Scoring (re-exported for plugin convenience) ---------------------------
from az_scout.scoring.deployment_confidence import (  # noqa: F401
    compute_deployment_confidence,
    enrich_skus_with_confidence,
    signals_from_sku,
)

# ---------------------------------------------------------------------------
# Enrichment pipeline – single async call for the full enrichment chain
# ---------------------------------------------------------------------------


async def enrich_skus(
    skus: list[dict[str, Any]],
    region: str,
    subscription_id: str,
    *,
    quotas: bool = False,
    prices: bool = False,
    confidence: bool = False,
    spot: bool = False,
    instance_count: int = 1,
    currency_code: str = "USD",
    tenant_id: str = "",
) -> list[dict[str, Any]]:
    """Run the full SKU enrichment pipeline in the correct order.

    This is the canonical way for plugins and routes to enrich SKU dicts
    with quota, pricing, spot scores, and deployment confidence.

    Parameters are opt-in: set ``quotas=True``, ``prices=True``, etc.
    Ordering is handled automatically (quotas before confidence, etc.).
    Returns the same *skus* list (mutated in place) for convenience.
    """
    import asyncio

    if quotas:
        await asyncio.to_thread(enrich_skus_with_quotas, skus, region, subscription_id, tenant_id)
    if prices:
        await asyncio.to_thread(enrich_skus_with_prices, skus, region, currency_code)
    if spot:
        try:
            sku_names = [s.get("name", "") for s in skus if s.get("name")]
            if sku_names:
                result = await asyncio.to_thread(
                    get_spot_placement_scores,
                    region,
                    subscription_id,
                    sku_names,
                    instance_count,
                    tenant_id,
                )
                scores = result.get("scores", {})
                from az_scout.scoring.deployment_confidence import best_spot_label

                for sku in skus:
                    name = sku.get("name", "")
                    zone_scores = scores.get(name, {})
                    if zone_scores:
                        sku["spot_zones"] = zone_scores
                        sku["spot_label"] = best_spot_label(zone_scores)
        except Exception:
            import logging

            logging.getLogger(__name__).warning(
                "Spot placement score fetch failed; continuing without spot"
            )
    if confidence:
        enrich_skus_with_confidence(skus)

    return skus


# ---------------------------------------------------------------------------
# API version – bump major for breaking changes, minor for additions.
# ---------------------------------------------------------------------------
PLUGIN_API_VERSION = "1.3"
"""Semantic version of the plugin-facing API surface (``__all__``)."""

# ---------------------------------------------------------------------------
# Public API surface – plugins should only use names listed here.
# ---------------------------------------------------------------------------
__all__ = [
    # Meta
    "PLUGIN_API_VERSION",
    # Constants
    "AZURE_API_VERSION",
    "AZURE_MGMT_URL",
    "COMPUTE_API_VERSION",
    "RETAIL_PRICES_API_VERSION",
    "RETAIL_PRICES_URL",
    "SPOT_API_VERSION",
    # ARM helpers (authentication, retry, pagination)
    "get_headers",
    "arm_get",
    "arm_post",
    "arm_paginate",
    "ArmRequestError",
    "ArmAuthorizationError",
    "ArmNotFoundError",
    # Discovery
    "list_tenants",
    "list_subscriptions",
    "list_regions",
    "list_locations",
    "preload_discovery",
    # Zone mappings
    "get_mappings",
    # SKU catalogue
    "get_skus",
    "get_sku_profile",
    "parse_sku_series",
    # Enrichment (mutate SKU dicts in-place)
    "enrich_skus_with_prices",
    "enrich_skus_with_quotas",
    "enrich_skus_with_confidence",
    # Enrichment pipeline
    "enrich_skus",
    # Scoring
    "compute_deployment_confidence",
    "signals_from_sku",
    # Standalone data fetchers
    "get_retail_prices",
    "get_sku_pricing_detail",
    "get_compute_usages",
    "get_spot_placement_scores",
]

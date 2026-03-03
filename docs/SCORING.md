# Deployment Confidence Scoring

> **Scoring version: v2** — Canonical implementation in
> [`src/az_scout/scoring/deployment_confidence.py`](../src/az_scout/scoring/deployment_confidence.py).

The Deployment Confidence Score is a composite heuristic (0–100) that
estimates the likelihood of successfully deploying a VM SKU in a given
Azure region and subscription.  It is computed **server-side only** — the
frontend displays the score but never recomputes it.

## Score types

| Type | Signals | When used |
|---|---|---|
| **Basic** | quota, zones, restrictions, pricePressure | Default — shown in the SKU table and modal |
| **Basic + Spot** | quota, **spot**, zones, restrictions, pricePressure | When the user explicitly requests Spot inclusion |

The *Basic* score excludes the Spot Placement signal because it requires
an extra Azure API call with a specific instance count.  When the user
clicks **Include Spot** in the modal, the backend fetches Spot Placement
Scores and recomputes the confidence with all five signals.

## Signals

### 1. Quota Headroom (`quota`, weight 0.25)

```
remaining_vcpus / vcpus_per_vm / 10  →  capped at 1.0
```

Measures how much vCPU quota headroom remains relative to the SKU's vCPU
count.  A score of 1.0 means at least 10 VMs can be deployed; 0.0 means
the quota is exhausted.

### 2. Spot Placement (`spot`, weight 0.35)

| Azure label | Normalised value |
|---|---|
| High | 1.0 |
| Medium | 0.6 |
| Low | 0.25 |
| RestrictedSkuNotAvailable | 0.0 |
| Unknown | *missing* (excluded) |

Maps the best per-zone Spot Placement Score (from the Azure Spot
Placement Scores API) to a 0–1 value.  Only included in the
**Basic + Spot** score type.

When all zones return `RestrictedSkuNotAvailable`, the signal is
scored at 0.0 (definitively bad) rather than treated as missing data.
Only truly unknown labels (no data) are excluded.

### 3. Zone Breadth (`zones`, weight 0.15)

```
zones_available / 3  →  0..1
```

Counts the number of availability zones where the SKU is offered and not
restricted.  Three zones yields a perfect score.

### 4. Restrictions (`restrictions`, weight 0.15)

| Condition | Value |
|---|---|
| No restrictions | 1.0 |
| Any restriction present | 0.0 |

Binary signal: any subscription-level or zone-level restriction drops
the score to zero.

### 5. Price Pressure (`pricePressure`, weight 0.10)

```
1.0 - (spot_price / paygo_price)  →  capped at [0, 1]
```

A lower spot-to-PAYGO ratio means better savings potential.  If spot or
PAYGO pricing is unavailable, this signal is treated as missing.

## Weights

| Signal | Weight |
|---|---|
| quota | 0.25 |
| spot | 0.35 |
| zones | 0.15 |
| restrictions | 0.15 |
| pricePressure | 0.10 |
| **Total** | **1.00** |

## Renormalisation

When one or more signals are missing (e.g. spot is excluded in the Basic
score type, or pricing data is unavailable), the weights of the remaining
signals are renormalised so they sum to 1.0:

```
effective_weight_i = weight_i / Σ(available weights)
```

This ensures the score remains on the 0–100 scale regardless of how many
signals are present.

## Label mapping

| Score range | Label |
|---|---|
| ≥ 80 | High |
| ≥ 60 | Medium |
| ≥ 40 | Low |
| < 40 | Very Low |

If fewer than 2 signals are available, the result is
`label="Unknown", score=0`.

## API endpoints

### `GET /api/skus`

Returns SKU data with a `confidence` object for each SKU.  The confidence
is computed with the **Basic** score type (no spot).

### `POST /api/deployment-confidence`

Bulk scoring endpoint.  Accepts a list of SKU names and optionally
enables Spot inclusion:

```json
{
  "subscriptionId": "...",
  "region": "westeurope",
  "currencyCode": "USD",
  "preferSpot": true,
  "instanceCount": 1,
  "skus": ["Standard_D2s_v3", "Standard_D4s_v3"],
  "includeSignals": true,
  "includeProvenance": true
}
```

When `preferSpot` is `true`, the backend fetches Spot Placement Scores
and includes them in the computation, producing a `scoreType` of
`"basic+spot"`.

### MCP tool: `get_sku_availability`

Returns SKU data with the **Basic** confidence score (same as
`GET /api/skus`).

## Response schema

```json
{
  "score": 72,
  "label": "Medium",
  "scoreType": "basic",
  "breakdown": {
    "components": [
      {
        "name": "quota",
        "score01": 0.8,
        "score100": 80.0,
        "weight": 0.3846,
        "contribution": 0.3077,
        "status": "used"
      }
    ],
    "weightsOriginal": {
      "quota": 0.25,
      "spot": 0.35,
      "zones": 0.15,
      "restrictions": 0.15,
      "pricePressure": 0.10
    },
    "weightsUsedSum": 0.65,
    "renormalized": true
  },
  "missingSignals": ["spot"],
  "disclaimers": [
    "This is a heuristic estimate, not a guarantee of deployment success."
  ],
  "provenance": {
    "computedAtUtc": "2026-03-02T10:30:00+00:00",
    "scoringVersion": "v2"
  },
  "scoringVersion": "v2"
}
```

## Disclaimers

Every score result includes these disclaimers:

1. This is a heuristic estimate, not a guarantee of deployment success.
2. Signals are derived from Azure APIs and may change at any time.
3. No Microsoft guarantee is expressed or implied.

## Version history

| Version | Changes |
|---|---|
| v1 | Initial implementation with 5 signals |
| v2 | Split into Basic (no spot) and Basic + Spot score types; `scoreType` field added |

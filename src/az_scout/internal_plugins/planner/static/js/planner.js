/* eslint-disable @microsoft/sdl/no-inner-html -- Complex HTML builders use escapeHtml() for all dynamic values. Data from Azure ARM API. HTML fragments loaded from own server. */
/* ===================================================================
   Azure Scout – Deployment Planner Tab  (internal plugin)
   Requires: app.js (globals: subscriptions, apiFetch, apiPost,
             tenantQS, escapeHtml, formatNum, getSubName, showError,
             hideError, showPanel, downloadCSV)
   =================================================================== */

// ---------------------------------------------------------------------------
// HTML fragment bootstrap – load the tab markup at init
// ---------------------------------------------------------------------------
(async function initPlannerTab() {
    const container = document.getElementById("plugin-tab-planner");
    if (!container) return;
    try {
        const resp = await fetch("/internal/planner/static/html/planner-tab.html");
        if (resp.ok) container.innerHTML = await resp.text();
    } catch { /* template already inline – nothing to do */ }

    // Bind event delegation for SKU table interactive cells
    const skuTableContainer = document.getElementById("sku-table-container");
    if (skuTableContainer) {
        skuTableContainer.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            const sku = btn.dataset.sku;
            if (btn.dataset.action === "pricing") openPricingModal(sku);
            else if (btn.dataset.action === "spot") openSpotModal(sku);
        });
    }

    // Init planner subscription combobox
    initPlannerSubCombobox();

    // Re-populate subscription dropdown if subscriptions already loaded
    if (typeof subscriptions !== "undefined" && subscriptions.length) {
        renderPlannerSubDropdown("");
    }
    updatePlannerLoadButton();
})();

// ---------------------------------------------------------------------------
// Planner tab state
// ---------------------------------------------------------------------------
let plannerSubscriptionId = null;           // single selected subscription ID
let plannerZoneMappings = null;             // zone mappings fetched independently for planner
let lastSkuData = null;                     // cached SKU list
let lastSpotScores = null;                  // {scores: {sku: {zone: label}}, errors: []}
let _skuDataTable = null;                   // Simple-DataTables instance
let _skuFilterState = {};                   // {headerText: filterValue} – persists across re-renders

// ---------------------------------------------------------------------------
// Deployment Confidence – scores are computed server-side only.
// The frontend NEVER recomputes confidence; it displays what the API returns.
// Use refreshDeploymentConfidence() to fetch updated scores from the backend.
// ---------------------------------------------------------------------------
const _REGION_SCORE_LABELS = [[80, "High"], [60, "Medium"], [40, "Low"], [0, "Very Low"]];

// Delegate to shared components
const _C = window.azScout?.components || {};
function _scoreLabel(score) { return _C.scoreLabel ? _C.scoreLabel(score) : "Unknown"; }

/**
 * Fetch canonical Deployment Confidence scores from the backend for the
 * given SKU names.  Updates ``lastSkuData[].confidence`` in place and
 * re-renders the table + region summary.
 */
async function refreshDeploymentConfidence(skuNames) {
    const region = document.getElementById("region-select").value;
    const subscriptionId = plannerSubscriptionId;
    if (!region || !subscriptionId || !skuNames || !skuNames.length) return;

    const currency = document.getElementById("planner-currency")?.value || "USD";
    const payload = {
        subscriptionId,
        region,
        currencyCode: currency,
        preferSpot: true,
        instanceCount: 1,
        skus: skuNames,
        includeSignals: false,
        includeProvenance: false,
    };
    const tenant = document.getElementById("tenant-select").value;
    if (tenant) payload.tenantId = tenant;

    try {
        const result = await apiPost("/api/deployment-confidence", payload);
        if (result.results) {
            for (const r of result.results) {
                const sku = (lastSkuData || []).find(s => s.name === r.sku);
                if (sku && r.deploymentConfidence) {
                    sku.confidence = r.deploymentConfidence;
                }
            }
        }
    } catch (err) {
        console.error("Failed to refresh deployment confidence:", err);
    }
}

/** Pick the best Spot Placement Score label from per-zone data (display helper). */
function _bestSpotLabel(zoneScores) {
    const order = { high: 3, medium: 2, low: 1 };
    let best = null;
    for (const s of Object.values(zoneScores)) {
        const rank = order[s.toLowerCase()] || 0;
        if (rank > (order[(best || "").toLowerCase()] || 0)) best = s;
    }
    return best || null;
}

// ---------------------------------------------------------------------------
// Planner subscription combobox (single-select)
// ---------------------------------------------------------------------------
function initPlannerSubCombobox() {
    const searchInput = document.getElementById("planner-sub-search");
    const dropdown = document.getElementById("planner-sub-dropdown");

    searchInput.addEventListener("focus", () => {
        searchInput.select();
        renderPlannerSubDropdown(searchInput.value.includes("(") ? "" : searchInput.value);
        dropdown.classList.add("show");
    });
    searchInput.addEventListener("input", () => {
        document.getElementById("planner-sub-select").value = "";
        plannerSubscriptionId = null;
        renderPlannerSubDropdown(searchInput.value);
        dropdown.classList.add("show");
        updatePlannerLoadButton();
    });
    searchInput.addEventListener("keydown", (e) => {
        const items = dropdown.querySelectorAll("li");
        const active = dropdown.querySelector("li.active");
        let idx = [...items].indexOf(active);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!dropdown.classList.contains("show")) dropdown.classList.add("show");
            if (active) active.classList.remove("active");
            idx = (idx + 1) % items.length;
            items[idx]?.classList.add("active");
            items[idx]?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (active) active.classList.remove("active");
            idx = idx <= 0 ? items.length - 1 : idx - 1;
            items[idx]?.classList.add("active");
            items[idx]?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (active) selectPlannerSub(active.dataset.value);
            else if (items.length === 1) selectPlannerSub(items[0].dataset.value);
        } else if (e.key === "Escape") {
            dropdown.classList.remove("show");
            searchInput.blur();
        }
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#planner-sub-combobox")) dropdown.classList.remove("show");
    });
}

function renderPlannerSubDropdown(filter) {
    const dropdown = document.getElementById("planner-sub-dropdown");
    if (!dropdown) return;
    const lc = (filter || "").toLowerCase();
    const matches = lc
        ? subscriptions.filter(s => s.name.toLowerCase().includes(lc) || s.id.toLowerCase().includes(lc))
        : subscriptions;
    dropdown.innerHTML = matches.map(s =>
        `<li class="dropdown-item" data-value="${s.id}">${escapeHtml(s.name)} <span class="region-name">(${s.id.slice(0, 8)}\u2026)</span></li>`
    ).join("");
    dropdown.querySelectorAll("li").forEach(li => {
        li.addEventListener("click", () => selectPlannerSub(li.dataset.value));
    });
    // Enable search input once subscriptions are loaded
    const searchInput = document.getElementById("planner-sub-search");
    if (subscriptions.length > 0) {
        searchInput.placeholder = "Type to search subscriptions\u2026";
        searchInput.disabled = false;
    }
}

function selectPlannerSub(id) {
    const s = subscriptions.find(s => s.id === id);
    if (!s) return;
    plannerSubscriptionId = id;
    document.getElementById("planner-sub-select").value = id;
    document.getElementById("planner-sub-search").value = s.name;
    document.getElementById("planner-sub-dropdown").classList.remove("show");
    resetPlannerResults();
    updatePlannerLoadButton();
}

function updatePlannerLoadButton() {
    const btn = document.getElementById("planner-load-btn");
    if (!btn) return;
    const region = document.getElementById("region-select").value;
    btn.disabled = !(plannerSubscriptionId && region);
}

function resetPlannerResults() {
    lastSkuData = null;
    lastSpotScores = null;
    plannerZoneMappings = null;
    _skuFilterState = {};
    if (_skuDataTable) {
        try { _skuDataTable.destroy(); } catch {}
        _skuDataTable = null;
    }
    showPanel("planner", "empty");
}

// ---------------------------------------------------------------------------
// Load SKUs  (independently fetches zone mappings for headers)
// ---------------------------------------------------------------------------
async function loadSkus() {
    const region = document.getElementById("region-select").value;
    const tenant = document.getElementById("tenant-select").value;
    const subscriptionId = plannerSubscriptionId;

    if (!region || !subscriptionId) return;

    hideError("planner-error");
    showPanel("planner", "loading");

    try {
        // Fetch zone mappings for this sub to get physical zone headers
        const mappingsPromise = apiFetch(`/api/mappings?region=${region}&subscriptions=${subscriptionId}${tenantQS()}`);

        // Fetch SKUs (always include prices)
        const params = new URLSearchParams({ region, subscriptionId });
        if (tenant) params.append("tenantId", tenant);
        params.append("includePrices", "true");
        const currency = document.getElementById("planner-currency")?.value || "USD";
        params.append("currencyCode", currency);
        const skuPromise = apiFetch(`/api/skus?${params}`);

        // Run in parallel
        const [mappingsResult, skuResult] = await Promise.all([mappingsPromise, skuPromise]);

        // Store zone mappings for this planner session
        plannerZoneMappings = mappingsResult;

        if (skuResult.error) throw new Error(skuResult.error);

        lastSkuData = skuResult;
        // Confidence scores are already computed server-side in GET /api/skus

        showPanel("planner", "results");
        try { renderRegionSummary(lastSkuData); } catch (e) { console.error("renderRegionSummary failed:", e); }
        try { renderSkuTable(lastSkuData); } catch (e) { console.error("renderSkuTable failed:", e); }
    } catch (err) {
        showPanel("planner", "empty");
        showError("planner-error", `Failed to fetch SKUs: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Physical zone map for planner (uses plannerZoneMappings)
// ---------------------------------------------------------------------------
function getPlannerPhysicalZoneMap() {
    const map = {};
    if (!plannerZoneMappings || !plannerZoneMappings.length) return map;
    const subMapping = plannerZoneMappings.find(d => d.subscriptionId === plannerSubscriptionId);
    if (subMapping?.mappings) {
        subMapping.mappings.forEach(m => { map[m.logicalZone] = m.physicalZone; });
    }
    return map;
}

// ---------------------------------------------------------------------------
// Spot score fetching from Zone Availability panel (kept for the shared modal
// zone panel's "Fetch Spot Scores" button which uses onclick="fetchSpotFromPanel()")
// ---------------------------------------------------------------------------
async function fetchSpotFromPanel() {
    const skuName = _pricingModalSku;
    if (!skuName) return;
    const region = document.getElementById("region-select").value;
    const tenant = document.getElementById("tenant-select").value;
    const subscriptionId = plannerSubscriptionId;
    if (!subscriptionId || !region) return;

    const instanceCount = parseInt(document.getElementById("spot-panel-instances")?.value, 10) || 1;

    try {
        const payload = { region, subscriptionId, skus: [skuName], instanceCount };
        if (tenant) payload.tenantId = tenant;
        const result = await apiPost("/api/spot-scores", payload);
        if (!lastSpotScores) lastSpotScores = { scores: {}, errors: [] };
        if (result.scores) {
            for (const [sku, zoneScores] of Object.entries(result.scores)) {
                lastSpotScores.scores[sku] = { ...(lastSpotScores.scores[sku] || {}), ...zoneScores };
            }
        }

        // Refresh confidence + re-render table
        if (lastSkuData) {
            await refreshDeploymentConfidence([skuName]);
            renderRegionSummary(lastSkuData);
            renderSkuTable(lastSkuData);
        }

        // Re-open the shared modal with updated spot data
        const enriched = (lastSkuData || []).find(s => s.name === skuName) || {};
        _C.showSkuDetailModal(skuName, {
            region,
            subscriptionId: plannerSubscriptionId,
            currency: _pricingModalCurrency,
            enrichedSku: enriched,
            physicalZoneMap: getPlannerPhysicalZoneMap(),
            onRecalculate: _plannerRecalculate,
            onAfterRecalculate: () => {
                if (lastSkuData) { renderRegionSummary(lastSkuData); renderSkuTable(lastSkuData); }
            },
        });

        if (result.errors?.length) showError("planner-error", "Spot score error: " + result.errors.join("; "));
    } catch (err) {
        showError("planner-error", "Failed to fetch Spot Score: " + err.message);
    }
}

// Spot Score Modal
// ---------------------------------------------------------------------------
let _spotModalSku = null;
let _spotModal = null;

function openSpotModal(skuName) {
    _spotModalSku = skuName;
    document.getElementById("spot-modal-sku").textContent = skuName;
    document.getElementById("spot-modal-instances").value = "1";
    document.getElementById("spot-modal-loading").classList.add("d-none");
    document.getElementById("spot-modal-result").classList.add("d-none");
    if (!_spotModal) _spotModal = new bootstrap.Modal(document.getElementById("spotModal"));
    _spotModal.show();
    setTimeout(() => {
        const input = document.getElementById("spot-modal-instances");
        input.focus();
        input.select();
    }, 300);
}

async function confirmSpotScore() {
    const skuName = _spotModalSku;
    if (!skuName) return;

    const region = document.getElementById("region-select").value;
    const tenant = document.getElementById("tenant-select").value;
    const subscriptionId = plannerSubscriptionId;
    if (!subscriptionId || !region) return;

    const instanceCount = parseInt(document.getElementById("spot-modal-instances").value, 10) || 1;
    document.getElementById("spot-modal-loading").classList.remove("d-none");
    document.getElementById("spot-modal-result").classList.add("d-none");

    try {
        const payload = { region, subscriptionId, skus: [skuName], instanceCount };
        if (tenant) payload.tenantId = tenant;
        const result = await apiPost("/api/spot-scores", payload);

        // Accumulate into cache
        if (!lastSpotScores) lastSpotScores = { scores: {}, errors: [] };
        if (result.scores) {
            for (const [sku, zoneScores] of Object.entries(result.scores)) {
                lastSpotScores.scores[sku] = { ...(lastSpotScores.scores[sku] || {}), ...zoneScores };
            }
        }
        if (result.errors?.length) lastSpotScores.errors.push(...result.errors);

        // Show result in modal
        const zoneScores = result.scores?.[skuName] || {};
        const resultEl = document.getElementById("spot-modal-result");
        const zones = Object.keys(zoneScores).sort();
        if (zones.length > 0) {
            resultEl.innerHTML = '<div class="spot-modal-grid">' + zones.map(z => {
                const s = zoneScores[z] || "Unknown";
                return `<span class="spot-zone-label">Z${escapeHtml(z)}</span><span class="spot-badge spot-${s.toLowerCase()}">${escapeHtml(s)}</span>`;
            }).join("") + '</div>';
        } else {
            resultEl.innerHTML = '<span class="spot-badge spot-unknown">Unknown</span>';
        }
        resultEl.classList.remove("d-none");

        // Refresh confidence from the backend (canonical source of truth)
        if (lastSkuData) {
            await refreshDeploymentConfidence([skuName]);
            renderRegionSummary(lastSkuData);
            renderSkuTable(lastSkuData);
        }

        if (result.errors?.length) showError("planner-error", "Spot score error: " + result.errors.join("; "));
    } catch (err) {
        showError("planner-error", "Failed to fetch Spot Score: " + err.message);
    } finally {
        document.getElementById("spot-modal-loading").classList.add("d-none");
    }
}

// ---------------------------------------------------------------------------
// SKU Detail Modal (delegates to shared showSkuDetailModal)
// ---------------------------------------------------------------------------
let _pricingModalSku = null;
let _pricingModalCurrency = "USD";

function openPricingModal(skuName) {
    _pricingModalSku = skuName;
    const enriched = (lastSkuData || []).find(s => s.name === skuName) || {};
    _pricingModalCurrency = document.getElementById("planner-currency")?.value || "USD";

    _C.showSkuDetailModal(skuName, {
        region: document.getElementById("region-select").value,
        subscriptionId: plannerSubscriptionId,
        currency: _pricingModalCurrency,
        enrichedSku: enriched,
        physicalZoneMap: getPlannerPhysicalZoneMap(),
        onRecalculate: _plannerRecalculate,
        onAfterRecalculate: (_conf) => {
            // Re-render main table with updated confidence
            if (lastSkuData) {
                renderRegionSummary(lastSkuData);
                renderSkuTable(lastSkuData);
            }
        },
    });
}

/**
 * Planner-specific recalculate callback.
 * Calls POST /api/deployment-confidence (supports preferSpot + instanceCount).
 */
async function _plannerRecalculate(skuName, instanceCount, includeSpot) {
    const region = document.getElementById("region-select").value;
    const tenant = document.getElementById("tenant-select").value;
    const subscriptionId = plannerSubscriptionId;
    if (!subscriptionId || !region) throw new Error("Missing subscription or region");

    const currency = _pricingModalCurrency;
    const payload = {
        subscriptionId,
        region,
        currencyCode: currency,
        preferSpot: includeSpot,
        instanceCount,
        skus: [skuName],
        includeSignals: false,
        includeProvenance: true,
    };
    if (tenant) payload.tenantId = tenant;

    const result = await apiPost("/api/deployment-confidence", payload);

    let confidence = null;
    if (result.results) {
        for (const r of result.results) {
            const sku = (lastSkuData || []).find(s => s.name === r.sku);
            if (sku && r.deploymentConfidence) {
                sku.confidence = r.deploymentConfidence;
                confidence = r.deploymentConfidence;
            }
        }
    }

    // Check if spot was actually included when requested
    if (includeSpot && confidence && confidence.scoreType !== "basic+spot") {
        const reason = (result.warnings || []).join("; ") || "Spot Placement Scores unavailable or restricted for this SKU.";
        showError("planner-error", reason);
    }

    return { confidence };
}

// Old fetchPricingDetail / renderPricingDetail removed — now handled by shared showSkuDetailModal.

// refreshPricingModal (kept as global for inline onclick references, but now no-op)
function refreshPricingModal() {}

// resetToBasicConfidence / includeSpotInConfidence are now handled by the
// shared modal's onRecalculate callback (_plannerRecalculate above).
// Keep as global no-ops for any stale onclick references.
function resetToBasicConfidence() {}
function includeSpotInConfidence() {}

// ---------------------------------------------------------------------------
// Render SKU table  (powered by Simple-DataTables)
// ---------------------------------------------------------------------------
function _computeRegionScores(skus) {
    // Region Readiness: average confidence score
    const confScores = skus.map(s => s.confidence?.score).filter(s => s != null);
    const readiness = confScores.length > 0
        ? Math.round(confScores.reduce((a, b) => a + b, 0) / confScores.length)
        : null;

    // Zone Consistency: how uniformly SKUs are distributed across zones
    const allLogicalZones = [...new Set(skus.flatMap(s => s.zones || []))].sort();
    let consistency = null;
    if (allLogicalZones.length > 1) {
        const zoneCounts = allLogicalZones.map(lz =>
            skus.filter(s => (s.zones || []).includes(lz) && !(s.restrictions || []).includes(lz)).length
        );
        const minCount = Math.min(...zoneCounts);
        const maxCount = Math.max(...zoneCounts);
        consistency = minCount === maxCount ? 100 : Math.round((minCount / maxCount) * 100);
    } else if (allLogicalZones.length === 1) {
        consistency = 100;
    }

    // Zone breakdown for detail
    const zoneBreakdown = allLogicalZones.map(lz => {
        const available = skus.filter(s => (s.zones || []).includes(lz) && !(s.restrictions || []).includes(lz)).length;
        const restricted = skus.filter(s => (s.restrictions || []).includes(lz)).length;
        return { zone: lz, available, restricted };
    });

    return { readiness, consistency, total: skus.length, zones: allLogicalZones.length, zoneBreakdown };
}

function renderRegionSummary(skus) {
    const el = document.getElementById("region-summary");
    if (!el) return;
    if (!skus || skus.length === 0) { el.classList.add("d-none"); return; }

    const scores = _computeRegionScores(skus);
    const regionSelect = document.getElementById("region-select");
    let regionName = "Region";
    if (regionSelect) {
        const idx = regionSelect.selectedIndex;
        if (idx >= 0 && regionSelect.options[idx]) {
            regionName = regionSelect.options[idx].text || regionSelect.value || "Region";
        } else {
            regionName = regionSelect.value || "Region";
        }
    }

    const readinessLbl = scores.readiness != null ? _scoreLabel(scores.readiness).toLowerCase().replace(/\s+/g, "-") : null;
    const consistencyLbl = scores.consistency != null ? _scoreLabel(scores.consistency).toLowerCase().replace(/\s+/g, "-") : null;

    const icons = { high: "bi-shield-fill-check", medium: "bi-shield-fill-exclamation", low: "bi-shield-fill-x", "very-low": "bi-shield-fill-x" };
    const consistencyIcons = { high: "bi-symmetry-vertical", medium: "bi-distribute-horizontal", low: "bi-exclude", "very-low": "bi-exclude" };

    let html = '<div class="region-summary-bar">';
    html += `<div class="region-summary-title"><i class="bi bi-geo-alt-fill"></i> ${escapeHtml(regionName)}</div>`;
    html += '<div class="region-summary-scores">';

    // Region Readiness card
    if (scores.readiness != null) {
        html += `<div class="region-score-card">`;
        html += `<div class="region-score-label">Region Readiness</div>`;
        html += `<div class="region-score-value"><span class="confidence-badge confidence-${readinessLbl}" data-bs-toggle="tooltip" data-bs-title="Average basic deployment confidence across ${scores.total} SKUs. Reflects quota, zone coverage, restrictions and price pressure (spot excluded)."><i class="bi ${icons[readinessLbl] || 'bi-shield'}"></i> ${scores.readiness}</span></div>`;
        html += `</div>`;
    }

    // Zone Consistency card
    if (scores.consistency != null) {
        const detail = scores.zoneBreakdown.map(z => `Zone ${z.zone}: ${z.available} avail${z.restricted ? ', ' + z.restricted + ' restricted' : ''}`).join(' | ');
        html += `<div class="region-score-card">`;
        html += `<div class="region-score-label">Zone Consistency</div>`;
        html += `<div class="region-score-value"><span class="confidence-badge confidence-${consistencyLbl}" data-bs-toggle="tooltip" data-bs-placement="bottom" data-bs-title="${escapeHtml(detail)}"><i class="bi ${consistencyIcons[consistencyLbl] || 'bi-symmetry-vertical'}"></i> ${scores.consistency}</span></div>`;
        html += `</div>`;
    }

    // SKU count & zone count
    html += `<div class="region-score-card">`;
    html += `<div class="region-score-label">SKUs</div>`;
    html += `<div class="region-score-value"><span class="region-stat">${scores.total}</span></div>`;
    html += `</div>`;

    html += `<div class="region-score-card">`;
    html += `<div class="region-score-label">Zones</div>`;
    html += `<div class="region-score-value"><span class="region-stat">${scores.zones}</span></div>`;
    html += `</div>`;

    html += '</div></div>';
    el.innerHTML = html;
    el.classList.remove("d-none");

    // Init tooltips
    el.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(t => {
        new bootstrap.Tooltip(t, { delay: { show: 0, hide: 100 }, placement: t.dataset.bsPlacement || "top", whiteSpace: "pre-line" });
    });
}

// ---------------------------------------------------------------------------
// SKU DataTable
// ---------------------------------------------------------------------------
function renderSkuTable(skus) {
    const container = document.getElementById("sku-table-container");

    // Save current filter values before destroying the table
    _saveSkuFilters();

    if (_skuDataTable) {
        try { _skuDataTable.destroy(); } catch {}
        _skuDataTable = null;
    }

    if (!skus || skus.length === 0) {
        container.innerHTML = '<p class="text-body-secondary text-center py-3">No SKUs found for this region.</p>';
        return;
    }

    const physicalZoneMap = getPlannerPhysicalZoneMap();
    const allLogicalZones = [...new Set(skus.flatMap(s => s.zones))].sort();
    const physicalZones = allLogicalZones.map(lz => physicalZoneMap[lz] || `Zone ${lz}`);
    const hasPricing = skus.some(s => s.pricing);
    const showPricing = hasPricing && (document.getElementById("planner-show-prices")?.checked !== false);
    const showSpot = document.getElementById("planner-show-spot")?.checked !== false;

    // Build table HTML
    let html = '<table id="sku-datatable" class="table table-sm table-hover sku-table">';
    html += "<thead><tr>";

    const priceCurrency = skus.find(s => s.pricing)?.pricing?.currency || "USD";
    const headers = ["SKU Name", "Family", "vCPUs", "Memory (GB)",
        "Quota Limit", "Quota Used", "Quota Remaining"];
    if (showSpot) headers.push("Spot Score");
    headers.push("Confidence");
    if (showPricing) {
        headers.push(`PAYGO ${priceCurrency}/h`, `Spot ${priceCurrency}/h`);
    }
    allLogicalZones.forEach((lz, i) => {
        headers.push(`Zone ${escapeHtml(lz)}<br>${escapeHtml(physicalZones[i])}`);
    });
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += "</tr></thead><tbody>";

    skus.forEach(sku => {
        html += "<tr>";
        // SKU Name (clickable via event delegation)
        html += `<td><button type="button" class="sku-name-btn" data-action="pricing" data-sku="${escapeHtml(sku.name)}">${escapeHtml(sku.name)}</button></td>`;
        html += `<td>${escapeHtml(sku.family || "\u2014")}</td>`;
        html += `<td>${escapeHtml(sku.capabilities.vCPUs || "\u2014")}</td>`;
        html += `<td>${escapeHtml(sku.capabilities.MemoryGB || "\u2014")}</td>`;
        const quota = sku.quota || {};
        html += `<td>${quota.limit != null ? quota.limit : "\u2014"}</td>`;
        html += `<td>${quota.used != null ? quota.used : "\u2014"}</td>`;
        html += `<td>${quota.remaining != null ? quota.remaining : "\u2014"}</td>`;

        // Spot Score
        if (showSpot) {
            const spotZoneScores = lastSpotScores?.scores?.[sku.name] || {};
            const spotZones = Object.keys(spotZoneScores).sort();
            const hasSpotPrice = sku.pricing?.spot != null;
            if (spotZones.length > 0) {
                const badges = spotZones.map(z => {
                    const s = spotZoneScores[z] || "Unknown";
                    return `<span class="spot-zone-label">Z${escapeHtml(z)}</span><span class="spot-badge spot-${s.toLowerCase()}">${escapeHtml(s)}</span>`;
                }).join(" ");
                html += `<td><button type="button" class="spot-cell-btn has-score" data-action="spot" data-sku="${escapeHtml(sku.name)}" title="Click to refresh">${badges}</button></td>`;
            } else if (hasSpotPrice) {
                html += `<td><button type="button" class="spot-cell-btn" data-action="spot" data-sku="${escapeHtml(sku.name)}" title="Get Spot Placement Score">Spot Score?</button></td>`;
            } else {
                html += '<td class="text-body-secondary small">\u2014</td>';
            }
        }

        // Confidence
        const conf = sku.confidence || {};
        if (conf.score != null) {
            const lbl = (conf.label || "").toLowerCase().replace(/\s+/g, "-");
            const confIcons = { high: "bi-check-circle-fill", medium: "bi-dash-circle-fill", low: "bi-exclamation-triangle-fill", "very-low": "bi-x-circle-fill" };
            const icon = confIcons[lbl] || "bi-question-circle";
            html += `<td data-sort="${conf.score}"><span class="confidence-badge confidence-${lbl}" data-bs-toggle="tooltip" data-bs-title="Basic deployment confidence: ${conf.score}/100 (${escapeHtml(conf.label || '')}). Spot excluded."><i class="bi ${icon}"></i> ${conf.score}</span></td>`;
        } else {
            html += '<td data-sort="-1">\u2014</td>';
        }

        // Prices
        if (showPricing) {
            const pricing = sku.pricing || {};
            html += `<td class="price-cell">${pricing.paygo != null ? formatNum(pricing.paygo, 4) : '\u2014'}</td>`;
            html += `<td class="price-cell">${pricing.spot != null ? formatNum(pricing.spot, 4) : '\u2014'}</td>`;
        }

        // Zone availability
        allLogicalZones.forEach(lz => {
            const isRestricted = sku.restrictions.includes(lz);
            const isAvailable = sku.zones.includes(lz);
            if (isRestricted) html += '<td class="zone-restricted" data-bs-toggle="tooltip" data-bs-title="Restricted: this SKU has deployment restrictions in this zone"><i class="bi bi-exclamation-triangle-fill"></i></td>';
            else if (isAvailable) html += '<td class="zone-available" data-bs-toggle="tooltip" data-bs-title="Available: this SKU can be deployed in this zone"><i class="bi bi-check-circle-fill"></i></td>';
            else html += '<td class="zone-unavailable" data-bs-toggle="tooltip" data-bs-title="Not available: this SKU is not offered in this zone"><i class="bi bi-dash-circle"></i></td>';
        });
        html += "</tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;

    // Column type configuration for proper numeric sorting
    // Columns: SKU(0) Family(1) vCPUs(2) Mem(3) QLimit(4) QUsed(5) QRem(6) [Spot(7)] Conf(7|8) [PAYGO Spot]
    const confCol = showSpot ? 8 : 7;
    const colConfig = [
        { select: [2, 3, 4, 5, 6], type: "number" },   // vCPUs, Memory, Quota
        { select: confCol, type: "number" },              // Confidence (uses data-sort attr)
    ];
    let nextCol = confCol + 1;
    if (showPricing) {
        colConfig.push({ select: [nextCol, nextCol + 1], type: "number" });
        nextCol += 2;
    }

    // Init Simple-DataTables
    const tableEl = document.getElementById("sku-datatable");

    // Build per-column header filter config
    // Only text-filterable columns get an input; Zone columns are excluded
    const filterableCols = [];
    for (let i = 0; i <= confCol; i++) filterableCols.push(i);
    if (showPricing) { filterableCols.push(nextCol - 2, nextCol - 1); }

    _skuDataTable = new simpleDatatables.DataTable(tableEl, {
        searchable: false,
        paging: false,
        labels: {
            noRows: "No SKUs match",
            info: "{rows} SKUs",
        },
        columns: colConfig,
    });

    // Numeric column indices (for operator-aware filtering: >5, <32, 4-16, etc.)
    const numericCols = new Set([2, 3, 4, 5, 6, confCol]);
    if (showPricing) { numericCols.add(nextCol - 2); numericCols.add(nextCol - 1); }

    // Build per-column filter row in thead
    _buildColumnFilters(tableEl, filterableCols, numericCols);

    // Restore saved filter values and re-apply
    _restoreSkuFilters(tableEl);

    // Init Bootstrap tooltips on zone & confidence cells
    function _initSkuTooltips() {
        tableEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
            if (!bootstrap.Tooltip.getInstance(el)) {
                new bootstrap.Tooltip(el, { delay: { show: 0, hide: 100 }, placement: "top" });
            }
        });
    }
    _initSkuTooltips();

    // Re-init tooltips after sort re-renders the table
    _skuDataTable.on("datatable.sort", () => _initSkuTooltips());
}

/** Save current filter input values keyed by column header text. */
function _saveSkuFilters() {
    const tableEl = document.getElementById("sku-datatable");
    if (!tableEl) return;
    const headers = tableEl.querySelectorAll("thead tr:first-child th");
    const inputs = tableEl.querySelectorAll(".datatable-filter-row input[data-col]");
    const state = {};
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (!val) return;
        const col = parseInt(inp.dataset.col, 10);
        const hdr = headers[col]?.textContent?.trim();
        if (hdr) state[hdr] = val;
    });
    _skuFilterState = state;
}

/** Restore saved filter values after a re-render, then re-apply filtering. */
function _restoreSkuFilters(tableEl) {
    if (!Object.keys(_skuFilterState).length) return;
    const headers = tableEl.querySelectorAll("thead tr:first-child th");
    const headerMap = {};
    headers.forEach((th, idx) => { headerMap[th.textContent.trim()] = idx; });
    const filterRow = tableEl.querySelector(".datatable-filter-row");
    if (!filterRow) return;
    let restored = false;
    for (const [hdr, val] of Object.entries(_skuFilterState)) {
        const col = headerMap[hdr];
        if (col == null) continue;
        const input = filterRow.querySelector(`input[data-col="${col}"]`);
        if (input) { input.value = val; restored = true; }
    }
    if (restored) _applyColumnFilters(tableEl, filterRow);
}

/**
 * Parse a numeric filter expression.
 * Supported syntax:  >5  >=5  <32  <=32  =8  5-16 (range)  or plain number (exact).
 * Returns null if the input is not a numeric filter.
 */
function _parseNumericFilter(val) {
    const s = val.trim();
    let m;
    // Range: 4-16, 4..16, 4–16
    m = s.match(/^(\d+(?:\.\d+)?)\s*(?:[-–]|\.\.)\s*(\d+(?:\.\d+)?)$/);
    if (m) return { op: "range", lo: parseFloat(m[1]), hi: parseFloat(m[2]) };
    // Operators: >=, <=, >, <, =
    m = s.match(/^(>=?|<=?|=)\s*(\d+(?:\.\d+)?)$/);
    if (m) return { op: m[1], val: parseFloat(m[2]) };
    // Plain number → exact match
    if (/^\d+(?:\.\d+)?$/.test(s)) return { op: "=", val: parseFloat(s) };
    return null;
}

/** Test a cell value against a parsed numeric filter. */
function _matchNumericFilter(cellVal, filter) {
    const n = parseFloat(cellVal);
    if (Number.isNaN(n)) return false;
    switch (filter.op) {
        case ">": return n > filter.val;
        case ">=": return n >= filter.val;
        case "<": return n < filter.val;
        case "<=": return n <= filter.val;
        case "=": return n === filter.val;
        case "range": return n >= filter.lo && n <= filter.hi;
        default: return false;
    }
}

/**
 * Inject a second <tr> into thead with <input> filters for specified columns.
 * Numeric columns accept operator expressions (>5, <32, 4-16, etc.).
 * Text columns use substring matching.
 */
function _buildColumnFilters(tableEl, filterableCols, numericCols) {
    const thead = tableEl.querySelector("thead");
    if (!thead) return;

    const headerCells = thead.querySelectorAll("tr:first-child th");
    const filterRow = document.createElement("tr");
    filterRow.className = "datatable-filter-row";

    headerCells.forEach((_, idx) => {
        const td = document.createElement("td");
        if (filterableCols.includes(idx)) {
            const input = document.createElement("input");
            input.type = "search";
            input.className = "datatable-column-filter";
            const isNumeric = numericCols?.has(idx);
            input.placeholder = isNumeric ? ">5, <32, 4-16\u2026" : "Filter\u2026";
            if (isNumeric) input.dataset.numeric = "1";
            input.dataset.col = idx;
            td.appendChild(input);
        }
        filterRow.appendChild(td);
    });
    thead.appendChild(filterRow);

    // Debounced column filtering via row visibility
    let _colFilterTimeout;
    filterRow.addEventListener("input", () => {
        clearTimeout(_colFilterTimeout);
        _colFilterTimeout = setTimeout(() => _applyColumnFilters(tableEl, filterRow), 200);
    });
}

function _applyColumnFilters(tableEl, filterRow) {
    const inputs = filterRow.querySelectorAll("input[data-col]");
    const filters = [];
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (!val) return;
        const col = parseInt(inp.dataset.col, 10);
        const isNumeric = inp.dataset.numeric === "1";
        if (isNumeric) {
            const nf = _parseNumericFilter(val);
            if (nf) { filters.push({ col, numeric: nf }); return; }
        }
        // Fallback: text substring match
        filters.push({ col, text: val.toLowerCase() });
    });

    const rows = tableEl.querySelectorAll("tbody tr");
    rows.forEach(row => {
        if (filters.length === 0) {
            row.style.display = "";
            return;
        }
        const cells = row.querySelectorAll("td");
        const match = filters.every(f => {
            const cell = cells[f.col];
            if (!cell) return false;
            if (f.numeric) return _matchNumericFilter(cell.textContent, f.numeric);
            return cell.textContent.toLowerCase().includes(f.text);
        });
        row.style.display = match ? "" : "none";
    });
}

// ---------------------------------------------------------------------------
// Toggle table column visibility (persisted in localStorage)
// ---------------------------------------------------------------------------
function toggleTableColumns() {
    try {
        localStorage.setItem("azm-show-prices", document.getElementById("planner-show-prices")?.checked ? "1" : "0");
        localStorage.setItem("azm-show-spot", document.getElementById("planner-show-spot")?.checked ? "1" : "0");
    } catch {}
    if (lastSkuData) renderSkuTable(lastSkuData);
}

function _restoreColumnPrefs() {
    try {
        const prices = localStorage.getItem("azm-show-prices");
        const spot = localStorage.getItem("azm-show-spot");
        if (prices !== null) {
            const el = document.getElementById("planner-show-prices");
            if (el) el.checked = prices === "1";
        }
        if (spot !== null) {
            const el = document.getElementById("planner-show-spot");
            if (el) el.checked = spot === "1";
        }
    } catch {}
}

// ---------------------------------------------------------------------------
// EXPORT: SKU → CSV
// ---------------------------------------------------------------------------
function exportSkuCSV() {
    if (!lastSkuData || lastSkuData.length === 0) return;
    const physicalZoneMap = getPlannerPhysicalZoneMap();
    const allLogicalZones = [...new Set(lastSkuData.flatMap(s => s.zones))].sort();
    const physicalZones = allLogicalZones.map(lz => physicalZoneMap[lz] || `Zone ${lz}`);
    const hasPricing = lastSkuData.some(s => s.pricing);
    const priceCurrency = lastSkuData.find(s => s.pricing)?.pricing?.currency || "USD";
    const priceHeaders = hasPricing ? [`PAYGO ${priceCurrency}/h`, `Spot ${priceCurrency}/h`] : [];
    const zoneHeaders = allLogicalZones.map((lz, i) => `Zone ${lz}\n${physicalZones[i]}`);
    const headers = ["SKU Name", "Family", "vCPUs", "Memory (GB)",
        "Quota Limit", "Quota Used", "Quota Remaining", "Spot Score",
        "Confidence Score", "Confidence Label", ...priceHeaders, ...zoneHeaders];
    const rows = lastSkuData.map(sku => {
        const quota = sku.quota || {};
        const zoneCols = allLogicalZones.map(lz => {
            if (sku.restrictions.includes(lz)) return "Restricted";
            if (sku.zones.includes(lz)) return "Available";
            return "Unavailable";
        });
        return [
            sku.name, sku.family || "", sku.capabilities.vCPUs || "", sku.capabilities.MemoryGB || "",
            quota.limit ?? "", quota.used ?? "", quota.remaining ?? "",
            Object.entries(lastSpotScores?.scores?.[sku.name] || {}).sort(([a], [b]) => a.localeCompare(b)).map(([z, s]) => `Z${z}:${s}`).join(" ") || "",
            sku.confidence?.score ?? "", sku.confidence?.label || "",
            ...(hasPricing ? [sku.pricing?.paygo ?? "", sku.pricing?.spot ?? ""] : []),
            ...zoneCols
        ];
    });
    downloadCSV([headers, ...rows], `az-skus-${document.getElementById("region-select").value || "export"}.csv`);
}

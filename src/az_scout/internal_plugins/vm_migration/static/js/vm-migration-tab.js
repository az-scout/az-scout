/* eslint-disable @microsoft/sdl/no-inner-html -- All dynamic values sanitized via escapeHtml(). HTML fragments loaded from own server. */
/* ===================================================================
   Azure Scout – VM v6/v7 SKU Migration Scope Tab  (internal plugin)
   Requires: app.js globals: subscriptions, apiFetch, tenantQS,
             escapeHtml, showError, hideError, downloadCSV
   =================================================================== */

// ---------------------------------------------------------------------------
// Bootstrap – load the HTML fragment into the tab container
// ---------------------------------------------------------------------------
(async function initVmMigrationTab() {
    const container = document.getElementById("plugin-tab-vm-migration");
    if (!container) return;
    try {
        const resp = await fetch("/internal/vm-migration/static/html/vm-migration-tab.html");
        if (resp.ok) container.innerHTML = await resp.text();
    } catch { /* template already inline */ }

    const filterInput = document.getElementById("vmm-sub-filter");
    if (filterInput) {
        filterInput.addEventListener("input", () => renderVmmSubList(filterInput.value));
    }

    if (typeof subscriptions !== "undefined" && subscriptions.length) {
        renderVmmSubList();
    }
    vmmUpdateLoadButton();
})();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const vmmSelectedSubs = new Set();
let vmmAllVms = [];          // raw API results
let vmmFilteredVms = [];     // after filter application
let vmmDisplayedVms = [];    // current table ordering
let vmmSortField = "name";
let vmmSortAsc = true;
let vmmDetailModal = null;
const vmmSkuRecommendationCache = new Map();
const vmmComponents = window.azScout?.components || {};

const vmmKnownMarketplacePublishers = new Set([
    "canonical",
    "microsoftwindowsserver",
    "microsoft-aks",
    "redhat",
    "suse",
    "debian",
    "oracle",
]);

// ---------------------------------------------------------------------------
// Subscription checklist
// ---------------------------------------------------------------------------
function renderVmmSubList(filter) {
    const container = document.getElementById("vmm-sub-list");
    if (!container) return;
    const list = filter
        ? subscriptions.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
        : subscriptions;

    if (!list.length && !filter) {
        container.innerHTML = '<span class="text-body-secondary small">No subscriptions found</span>';
        return;
    }
    container.innerHTML = list.map(s => {
        const checked = vmmSelectedSubs.has(s.id) ? "checked" : "";
        return `<label title="${escapeHtml(s.name)}">
            <input type="checkbox" class="form-check-input me-1" value="${escapeHtml(s.id)}" ${checked}
                   onchange="vmmToggleSub('${escapeHtml(s.id)}')">
            ${escapeHtml(s.name)}
        </label>`;
    }).join("");
    vmmUpdateSubCount();
}

function vmmToggleSub(id) {
    if (vmmSelectedSubs.has(id)) vmmSelectedSubs.delete(id);
    else vmmSelectedSubs.add(id);
    vmmUpdateSubCount();
    vmmUpdateLoadButton();
}

function vmmSelectAllVisible() {
    document.querySelectorAll("#vmm-sub-list input[type=checkbox]").forEach(cb => {
        cb.checked = true;
        vmmSelectedSubs.add(cb.value);
    });
    vmmUpdateSubCount();
    vmmUpdateLoadButton();
}

function vmmDeselectAll() {
    vmmSelectedSubs.clear();
    document.querySelectorAll("#vmm-sub-list input[type=checkbox]").forEach(cb => {
        cb.checked = false;
    });
    vmmUpdateSubCount();
    vmmUpdateLoadButton();
}

function vmmUpdateSubCount() {
    const el = document.getElementById("vmm-sub-count");
    if (el) el.textContent = `${vmmSelectedSubs.size} selected`;
}

function vmmUpdateLoadButton() {
    const btn = document.getElementById("vmm-load-btn");
    if (btn) btn.disabled = vmmSelectedSubs.size === 0;
}

// ---------------------------------------------------------------------------
// Load VMs
// ---------------------------------------------------------------------------
async function vmmLoad() {
    if (!vmmSelectedSubs.size) return;

    vmmSetView("loading");

    const subIds = [...vmmSelectedSubs].join(",");
    const url = `/api/vms?subscriptions=${encodeURIComponent(subIds)}${tenantQS()}`;

    try {
        const data = await apiFetch(url);
        if (data.error) {
            vmmSetView("error");
            document.getElementById("vmm-error").textContent = data.error;
            return;
        }
        vmmAllVms = data;
        vmmPopulateFilterDropdowns();
        vmmApplyFilters();
    } catch (err) {
        vmmSetView("error");
        document.getElementById("vmm-error").textContent = String(err);
    }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function vmmPopulateFilterDropdowns() {
    const regions = [...new Set(vmmAllVms.map(v => v.region).filter(Boolean))].sort();
    const regionSel = document.getElementById("vmm-filter-region");
    if (regionSel) {
        regionSel.innerHTML = '<option value="">All regions</option>' +
            regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
    }
}

function vmmApplyFilters() {
    const name = (document.getElementById("vmm-filter-name")?.value || "").toLowerCase();
    const region = document.getElementById("vmm-filter-region")?.value || "";
    const os = document.getElementById("vmm-filter-os")?.value || "";
    const gen = document.getElementById("vmm-filter-gen")?.value || "";

    vmmFilteredVms = vmmAllVms.filter(v => {
        if (name && !v.name.toLowerCase().includes(name)) return false;
        if (region && v.region !== region) return false;
        if (os && v.os_type !== os) return false;
        if (gen && !v.generation.startsWith(gen)) return false;
        return true;
    });

    vmmRenderTable();
}

function vmmResetFilters() {
    const ids = ["vmm-filter-name", "vmm-filter-region", "vmm-filter-os", "vmm-filter-gen"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    vmmFilteredVms = [...vmmAllVms];
    vmmRenderTable();
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
function vmmSort(field) {
    if (vmmSortField === field) {
        vmmSortAsc = !vmmSortAsc;
    } else {
        vmmSortField = field;
        vmmSortAsc = true;
    }
    vmmRenderTable();
}

function vmmSortedVms() {
    return [...vmmFilteredVms].sort((a, b) => {
        const va = String(a[vmmSortField] ?? "").toLowerCase();
        const vb = String(b[vmmSortField] ?? "").toLowerCase();
        return vmmSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
}

function vmmOpenVmDetailByIndex(index) {
    const vm = vmmDisplayedVms[index];
    if (!vm) return;
    vmmOpenVmDetail(vm);
}

function vmmEnsureDetailModal() {
    const modalEl = document.getElementById("vmmDetailModal");
    if (!modalEl || typeof bootstrap === "undefined") return null;
    if (!vmmDetailModal) vmmDetailModal = new bootstrap.Modal(modalEl);
    return vmmDetailModal;
}

function vmmIsDSuffixedSku(sku) {
    return /_d[a-z0-9]*_v/i.test(sku || "");
}

function vmmHasThirdPartyPublisher(publisher) {
    const normalized = String(publisher || "").trim().toLowerCase();
    if (!normalized) return true;
    return !vmmKnownMarketplacePublishers.has(normalized);
}

function vmmBuildRecommendations(vm) {
    const recs = [];
    const generation = String(vm.generation || "");
    const diskController = String(vm.disk_controller_type || "SCSI");
    const osType = String(vm.os_type || "Unknown");
    const publisher = String(vm.image_publisher || "Unknown");
    const sku = String(vm.sku || "");
    const hasZones = Array.isArray(vm.zones) && vm.zones.length > 0;

    if (generation.startsWith("V1")) {
        recs.push({
            title: "Generation 2 and Trusted Launch",
            why: "This VM appears to be Generation 1 or not yet confirmed as Generation 2.",
            actions: [
                "Plan a Generation 2 path before sizing into v6/v7.",
                "Validate Secure Boot compatibility for low-level guest agents.",
            ],
        });
    } else {
        recs.push({
            title: "Generation 2 and Trusted Launch",
            why: "This VM is Generation 2 or likely Generation 2.",
            actions: [
                "Keep Trusted Launch enabled during redeploy.",
                "Validate signed security, backup, and monitoring drivers.",
            ],
        });
    }

    if (diskController.toUpperCase() === "NVME") {
        recs.push({
            title: "NVMe storage interface",
            why: "Disk controller is already NVMe-aware.",
            actions: [
                "Validate disk discovery and mount expectations in pilot.",
                "Confirm no legacy SCSI path assumptions remain in scripts.",
            ],
        });
    } else {
        recs.push({
            title: "NVMe storage interface",
            why: "Current disk controller indicates SCSI-based lineage.",
            actions: [
                "Treat migration as redeploy-from-image, not in-place resize.",
                "Replace hard-coded SCSI paths with stable identifiers (UUID/labels).",
            ],
        });
    }

    recs.push({
        title: "Image prerequisites",
        why: `Current publisher is ${publisher}.`,
        actions: [
            "Use a current Generation 2, NVMe-ready, MANA-ready image baseline.",
            "Test boot diagnostics and extension health in pilot before wider rollout.",
        ],
    });

    recs.push({
        title: "MANA networking",
        why: `Workload OS is ${osType}.`,
        actions: [
            osType === "Linux"
                ? "Confirm Linux kernel and MANA driver readiness in the image."
                : "Confirm Windows image patch level and in-box network driver readiness.",
            "Capture before/after network checks during pilot.",
        ],
    });

    recs.push({
        title: "OS-disk data",
        why: "Cross-generation migration starts from a fresh OS disk.",
        actions: [
            "Inventory app state persisted on OS disk before cutover.",
            "Add explicit backup and restore steps for OS-disk data.",
        ],
    });

    recs.push({
        title: "Local (temporary) disk strategy",
        why: vmmIsDSuffixedSku(sku)
            ? "Current SKU likely includes a temporary/local disk profile."
            : "Current SKU does not clearly indicate a d-suffixed local disk profile.",
        actions: [
            "Decide if target must use d-suffixed size for local NVMe scratch.",
            "Keep persistent data on managed disks, not temporary local disks.",
        ],
    });

    recs.push({
        title: "Region, zone, and capacity",
        why: hasZones
            ? `VM is zonal (${vm.zones.join(", ")}).`
            : "VM has no explicit zone pinning in current inventory.",
        actions: [
            "Confirm v6/v7 size availability and quota in target region/zone.",
            "Request quota early and reserve capacity for wave windows.",
        ],
    });

    recs.push({
        title: "Commercial continuity",
        why: "Reservations and savings plans are family-scoped.",
        actions: [
            "Replan reservation or savings-plan coverage for target v6/v7 family.",
            "Rightsize based on observed usage, not one-to-one vCPU parity.",
        ],
    });

    if (vmmHasThirdPartyPublisher(publisher)) {
        recs.push({
            title: "ISV appliance and vendor support",
            why: "Image publisher may represent a third-party or custom appliance path.",
            actions: [
                "Confirm vendor certification for NVMe and MANA on target family.",
                "Validate data-plane and failover behavior in pilot.",
            ],
        });
    }

    recs.push({
        title: "Sequencing and automation",
        why: "Large estate migration should execute in controlled waves.",
        actions: [
            "Group rollout by workload dependency and start with pilot ring.",
            "Automate repeatable pre-flight and validation checks per wave.",
        ],
    });

    return recs;
}

function vmmRecommendationIcon(title) {
    if (title.includes("Generation 2")) return "bi-shield-check";
    if (title.includes("NVMe")) return "bi-device-hdd";
    if (title.includes("MANA")) return "bi-diagram-3";
    if (title.includes("Region") || title.includes("capacity")) return "bi-geo-alt";
    if (title.includes("Commercial")) return "bi-cash-coin";
    if (title.includes("ISV")) return "bi-box";
    if (title.includes("automation")) return "bi-diagram-2";
    return "bi-lightbulb";
}

function vmmBuildRecommendationSectionHtml(vm) {
    const vmName = escapeHtml(vm.name || "VM");
    const sku = escapeHtml(vm.sku || "Unknown");
    const region = escapeHtml(vm.region || "Unknown");
    const generation = escapeHtml(vm.generation || "Unknown");
    const diskController = escapeHtml(vm.disk_controller_type || "SCSI");
    const publisher = escapeHtml(vm.image_publisher || "Unknown");
    const recs = vmmBuildRecommendations(vm);

    const toneClasses = ["vmm-tone-blue", "vmm-tone-green", "vmm-tone-purple", "vmm-tone-orange"];
    const rows = recs
        .map((r, idx) => {
            const actions = r.actions
                .map((a) => `<li><i class="bi bi-check2-circle"></i><span>${escapeHtml(a)}</span></li>`)
                .join("");
            const icon = vmmRecommendationIcon(r.title);
            const toneClass = toneClasses[idx % toneClasses.length];
            return `
                <article class="vmm-reco-step ${toneClass}">
                    <div class="vmm-reco-step-head">
                        <span class="vmm-reco-step-index">${idx + 1}</span>
                        <div class="vmm-reco-title">
                            <i class="bi ${icon}"></i>
                            <span>${escapeHtml(r.title)}</span>
                        </div>
                    </div>
                    <div class="vmm-reco-why mb-2">${escapeHtml(r.why)}</div>
                    <ul class="vmm-reco-actions small mb-0">${actions}</ul>
                </article>
            `;
        })
        .join("");

    return `
        <div class="accordion mt-3" id="vmmRecoAccordion">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#vmmRecoPanel" aria-expanded="true">
                        <i class="bi bi-lightbulb me-2"></i>VM Migration Planning Recommendations
                    </button>
                </h2>
                <div id="vmmRecoPanel" class="accordion-collapse collapse show">
                    <div class="accordion-body p-3">
                        <div class="vmm-vm-context mb-3">
                            <div class="small text-body-secondary mb-1">
                                <strong>${vmName}</strong> · SKU <code>${sku}</code>
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <span class="badge rounded-pill text-bg-primary">Region: ${region}</span>
                                <span class="badge rounded-pill text-bg-info">Hyper-V Gen: ${generation}</span>
                                <span class="badge rounded-pill text-bg-success">Disk: ${diskController}</span>
                                <span class="badge rounded-pill text-bg-secondary">Publisher: ${publisher}</span>
                            </div>
                        </div>
                        <div class="vmm-reco-grid">
                            ${rows}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function vmmBuildCandidateTargetSkus(currentSku) {
    const base = String(currentSku || "");
    if (!base) return [];
    const stem = base.replace(/_v[2-5][a-z]*(?:_promo)?$/i, "");
    if (stem === base) return [];
    return [`${stem}_v7`, `${stem}_v6`];
}

function vmmGetConfidenceDisplay(confidence) {
    if (vmmComponents.renderConfidenceBadge) {
        return vmmComponents.renderConfidenceBadge(confidence, { tooltip: false });
    }
    if (!confidence || typeof confidence.score !== "number") {
        return '<span class="badge bg-secondary">Unknown</span>';
    }
    const score = Math.round(confidence.score);
    const label = String(confidence.label || "Unknown");
    let cls = "bg-secondary";
    if (score >= 80) cls = "bg-success";
    else if (score >= 60) cls = "bg-primary";
    else if (score >= 40) cls = "bg-warning text-dark";
    else cls = "bg-danger";
    return `<span class="badge ${cls}">${escapeHtml(label)} (${score})</span>`;
}

function vmmGetZonesDisplay(sku) {
    const zones = Array.isArray(sku?.zones) ? sku.zones : [];
    const restrictions = Array.isArray(sku?.restrictions)
        ? sku.restrictions.filter((r) => r?.type === "Zone").flatMap((r) => r?.zones || [])
        : [];
    if (vmmComponents.renderZoneBadges) {
        return `
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="vmm-zone-icons">${vmmComponents.renderZoneBadges(zones, restrictions, ["1", "2", "3"])}</span>
                <span class="small text-body-secondary">${zones.length ? `Available zones: ${escapeHtml(zones.join(", "))}` : "Regional / no explicit zones"}</span>
            </div>
        `;
    }
    if (!zones.length) return '<span class="text-body-secondary">Regional / no explicit zones</span>';
    return zones.map((z) => `<span class="badge bg-secondary me-1">${escapeHtml(String(z))}</span>`).join("");
}

function vmmGetPriceDisplay(value) {
    if (typeof value !== "number") return "—";
    return escapeHtml(value.toFixed(4));
}

function vmmBuildPricingTable(sku) {
    const pricing = sku?.pricing || {};
    const currency = pricing.currency || "USD";
    const rows = [
        ["Pay-As-You-Go", pricing.paygo],
        ["Spot", pricing.spot],
        ["Reserved Instance 1Y", pricing.ri_1y],
        ["Reserved Instance 3Y", pricing.ri_3y],
        ["Savings Plan 1Y", pricing.sp_1y],
        ["Savings Plan 3Y", pricing.sp_3y],
    ];
    return `
        <table class="table table-sm pricing-detail-table vmm-pricing-table mb-0">
            <thead>
                <tr>
                    <th>Type</th>
                    <th class="text-end">${escapeHtml(currency)}/hour</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(([label, value]) => `
                    <tr>
                        <td>${escapeHtml(label)}</td>
                        <td class="text-end">${vmmGetPriceDisplay(value)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

async function vmmFetchTargetSkuRecommendations(vm) {
    const cacheKey = `${vm.subscription_id}|${vm.region}|${vm.sku}`;
    const cached = vmmSkuRecommendationCache.get(cacheKey);
    if (cached) return cached;

    const candidates = vmmBuildCandidateTargetSkus(vm.sku);
    if (!candidates.length) {
        vmmSkuRecommendationCache.set(cacheKey, []);
        return [];
    }

    const results = [];
    for (const candidate of candidates) {
        const params = new URLSearchParams({
            region: vm.region,
            subscriptionId: vm.subscription_id,
            name: candidate,
            includePrices: "true",
            currencyCode: "USD",
        });
        const data = await apiFetch(`/api/skus?${params}${tenantQS("&")}`);
        if (data?.error || !Array.isArray(data)) continue;
        const exact = data.find((s) => String(s.name || "").toLowerCase() === candidate.toLowerCase());
        if (exact) results.push(exact);
    }

    results.sort((a, b) => {
        const as = a?.confidence?.score ?? -1;
        const bs = b?.confidence?.score ?? -1;
        if (bs !== as) return bs - as;
        const av = String(a?.name || "").toLowerCase().includes("_v7") ? 7 : 6;
        const bv = String(b?.name || "").toLowerCase().includes("_v7") ? 7 : 6;
        return bv - av;
    });
    const top = results.slice(0, 2);
    vmmSkuRecommendationCache.set(cacheKey, top);
    return top;
}

function vmmBuildTargetRecommendationSection(vm, targetSkus) {
    if (!targetSkus.length) {
        return `
            <div class="alert alert-secondary py-2 mb-0 mt-3">
                No direct v6/v7 SKU recommendation was auto-matched for this VM.
                Use Deployment Planner to choose a target family manually for this workload.
            </div>
        `;
    }

    const primarySku = targetSkus[0];
    const alternateSkus = targetSkus.slice(1);
    const primaryConfidence = vmmGetConfidenceDisplay(primarySku.confidence);
    const primaryProfile = {
        zones: Array.isArray(primarySku.zones) ? primarySku.zones : [],
        restrictions: Array.isArray(primarySku.restrictions) ? primarySku.restrictions : [],
        capabilities: primarySku.capabilities || {},
    };

    const sharedConfidenceSection = primarySku.confidence && vmmComponents.renderConfidenceBreakdown
        ? vmmComponents.renderConfidenceBreakdown(primarySku.confidence)
        : `
            <div class="vmm-target-block mb-3">
                <h6><i class="bi bi-graph-up-arrow me-1"></i>Confidence</h6>
                <div class="small">${primaryConfidence}</div>
            </div>
        `;

    const sharedZoneSection = vmmComponents.renderZoneAvailability
        ? vmmComponents.renderZoneAvailability(primaryProfile, primarySku.confidence, {})
        : `
            <div class="vmm-target-block mb-3">
                <h6><i class="bi bi-pin-map me-1"></i>Zone availability</h6>
                ${vmmGetZonesDisplay(primarySku)}
            </div>
        `;

    const sharedPricingSection = primarySku.pricing && vmmComponents.renderPricingPanel
        ? vmmComponents.renderPricingPanel(primarySku.pricing)
        : `
            <div class="vmm-target-block">
                <h6><i class="bi bi-cash-coin me-1"></i>Pricing</h6>
                ${vmmBuildPricingTable(primarySku)}
            </div>
        `;

    const alternateSection = alternateSkus.length
        ? `
            <div class="mt-3 pt-2 border-top">
                <div class="small text-body-secondary mb-2">Alternate candidates</div>
                <div class="d-flex flex-wrap gap-2">
                    ${alternateSkus.map((sku) => `
                        <span class="px-2 py-1 border rounded bg-body-tertiary small d-inline-flex align-items-center gap-2">
                            <code>${escapeHtml(sku.name || "")}</code>
                            ${vmmGetConfidenceDisplay(sku.confidence)}
                        </span>
                    `).join("")}
                </div>
            </div>
        `
        : "";

    const rows = `
        <article class="vmm-target-sku-card">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <div class="d-flex align-items-center gap-2">
                    <span class="badge rounded-pill text-bg-primary">Recommended target SKU</span>
                    <code class="fs-6">${escapeHtml(primarySku.name || "")}</code>
                </div>
                <div>${primaryConfidence}</div>
            </div>
            <div class="small text-body-secondary mb-3">
                Target region <strong>${escapeHtml(vm.region || "")}</strong> · Source SKU <code>${escapeHtml(vm.sku || "")}</code>
            </div>
            ${sharedConfidenceSection}
            ${sharedZoneSection}
            ${sharedPricingSection}
            ${alternateSection}
        </article>
    `;

    return `
        <div class="accordion mt-3" id="vmmTargetRecoAccordion">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#vmmTargetRecoPanel" aria-expanded="true">
                        <i class="bi bi-bullseye me-2"></i>Recommended v6/v7 target SKU
                    </button>
                </h2>
                <div id="vmmTargetRecoPanel" class="accordion-collapse collapse show">
                    <div class="accordion-body p-3">${rows}</div>
                </div>
            </div>
        </div>
    `;
}

async function vmmOpenVmDetail(vm) {
    if (!vm?.sku || !vm?.region) return;
    const modal = vmmEnsureDetailModal();
    if (!modal) return;

    const nameEl = document.getElementById("vmm-detail-name");
    const loadingEl = document.getElementById("vmm-detail-loading");
    const contentEl = document.getElementById("vmm-detail-content");
    if (!nameEl || !loadingEl || !contentEl) return;

    nameEl.textContent = vm.name || "VM";
    loadingEl.classList.remove("d-none");
    contentEl.classList.add("d-none");
    modal.show();

    try {
        const targetSkus = await vmmFetchTargetSkuRecommendations(vm);
        let html = "";
        html += vmmBuildRecommendationSectionHtml(vm);
        html += vmmBuildTargetRecommendationSection(vm, targetSkus);
        contentEl.innerHTML = html;
        contentEl.classList.remove("d-none");
    } catch (err) {
        contentEl.innerHTML = `<div class="text-danger small">Failed to build recommendations: ${escapeHtml(String(err))}</div>`;
        contentEl.classList.remove("d-none");
    } finally {
        loadingEl.classList.add("d-none");
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function vmmEffortBadge(generation) {
    if (generation.startsWith("V1")) {
        return '<span class="badge bg-warning text-dark">Moderate</span>';
    }
    if (generation.startsWith("V2")) {
        return '<span class="badge bg-info text-dark">Low</span>';
    }
    return '<span class="badge bg-secondary">Unknown</span>';
}

function vmmDiskBadge(controller) {
    const cls = controller === "NVMe" ? "text-success" : "text-body-secondary";
    return `<span class="${cls}">${escapeHtml(controller || "SCSI")}</span>`;
}

function vmmZonesBadge(zones) {
    if (!zones || !zones.length) return '<span class="text-body-secondary">—</span>';
    return zones.map(z => `<span class="badge bg-secondary me-1">${escapeHtml(String(z))}</span>`).join("");
}

function vmmRenderTable() {
    const sorted = vmmSortedVms();
    vmmDisplayedVms = sorted;
    const tbody = document.getElementById("vmm-tbody");
    if (!tbody) return;

    if (!sorted.length) {
        vmmSetView(vmmAllVms.length ? "no-filter-results" : "no-results");
        return;
    }

    vmmSetView("results");

    const countEl = document.getElementById("vmm-table-count");
    if (countEl) countEl.textContent = sorted.length;

    tbody.innerHTML = sorted.map((v, i) => `<tr class="vmm-vm-row" tabindex="0"
        onclick="vmmOpenVmDetailByIndex(${i})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();vmmOpenVmDetailByIndex(${i});}">
        <td class="text-nowrap">${escapeHtml(v.name)}</td>
        <td class="text-nowrap small">${escapeHtml(v.resource_group)}</td>
        <td class="text-nowrap small">${escapeHtml(v.subscription_name)}</td>
        <td class="text-nowrap">${escapeHtml(v.region)}</td>
        <td class="text-nowrap"><code>${escapeHtml(v.sku)}</code></td>
        <td class="text-nowrap">${escapeHtml(v.generation)}</td>
        <td>${escapeHtml(v.os_type)}</td>
        <td class="small">${escapeHtml(v.image_publisher)}</td>
        <td>${vmmDiskBadge(v.disk_controller_type)}</td>
        <td>${vmmZonesBadge(v.zones)}</td>
        <td>${vmmEffortBadge(v.generation)}</td>
    </tr>`).join("");

    vmmRenderStats(sorted);
}

function vmmRenderStats(vms) {
    const statsEl = document.getElementById("vmm-stats");
    if (!statsEl) return;

    const byGen = vms.reduce((acc, v) => {
        const k = v.generation.startsWith("V1") ? "V1" : v.generation.startsWith("V2") ? "V2" : "Unknown";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});

    const byOs = vms.reduce((acc, v) => {
        const k = v.os_type || "Unknown";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});

    const regions = new Set(vms.map(v => v.region)).size;
    const subs = new Set(vms.map(v => v.subscription_id)).size;

    statsEl.innerHTML = [
        { label: "Total VMs", value: vms.length, icon: "bi-server", color: "primary" },
        { label: "V1 Hyper-V Gen", value: byGen.V1 || 0, icon: "bi-exclamation-triangle", color: "warning" },
        { label: "V2 Hyper-V Gen", value: byGen.V2 || 0, icon: "bi-check-circle", color: "info" },
        { label: "Windows VMs", value: byOs.Windows || 0, icon: "bi-windows", color: "secondary" },
        { label: "Linux VMs", value: byOs.Linux || 0, icon: "bi-ubuntu", color: "secondary" },
        { label: "Regions", value: regions, icon: "bi-geo-alt", color: "secondary" },
        { label: "Subscriptions", value: subs, icon: "bi-collection", color: "secondary" },
    ].map(s => `
        <div class="col-sm-6 col-md-4 col-lg-3 col-xl-2">
            <div class="card text-center vmm-stat-card">
                <div class="card-body py-2 px-3">
                    <div class="fs-4 fw-bold text-${s.color}">${s.value}</div>
                    <div class="small text-body-secondary"><i class="bi ${s.icon} me-1"></i>${s.label}</div>
                </div>
            </div>
        </div>`).join("");
}

// ---------------------------------------------------------------------------
// View state management
// ---------------------------------------------------------------------------
function vmmSetView(state) {
    const views = {
        "empty": "vmm-empty",
        "loading": "vmm-loading",
        "error": "vmm-error",
        "results": "vmm-results",
        "no-results": "vmm-no-results",
        "no-filter-results": "vmm-results",
    };
    ["vmm-empty", "vmm-loading", "vmm-error", "vmm-results", "vmm-no-results"].forEach(id => {
        document.getElementById(id)?.classList.add("d-none");
    });
    const target = views[state];
    if (target) document.getElementById(target)?.classList.remove("d-none");

    if (state === "no-filter-results") {
        const tbody = document.getElementById("vmm-tbody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center text-body-secondary py-3">
            No legacy SKU VMs in migration scope match the current filters.</td></tr>`;
        const countEl = document.getElementById("vmm-table-count");
        if (countEl) countEl.textContent = "0";
    }
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function vmmExportCSV() {
    const headers = [
        "VM Name", "Resource Group", "Subscription", "Subscription ID",
        "Region", "SKU", "Hyper-V Generation", "OS Type", "Image Publisher",
        "Disk Controller", "Zones", "Migration Readiness (inferred)",
    ];
    const rows = vmmSortedVms().map(v => [
        v.name,
        v.resource_group,
        v.subscription_name,
        v.subscription_id,
        v.region,
        v.sku,
        v.generation,
        v.os_type,
        v.image_publisher,
        v.disk_controller_type || "SCSI",
        (v.zones || []).join(";"),
        v.generation.startsWith("V1") ? "Moderate" : v.generation.startsWith("V2") ? "Low" : "Unknown",
    ]);
    downloadCSV([headers, ...rows], "legacy-sku-migration-scope.csv");
}

// Expose for app.js subscription refresh callbacks
window.renderVmmSubList = renderVmmSubList;

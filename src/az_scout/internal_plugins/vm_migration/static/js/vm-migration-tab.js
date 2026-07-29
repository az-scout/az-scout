/* eslint-disable @microsoft/sdl/no-inner-html -- All dynamic values sanitized via escapeHtml(). HTML fragments loaded from own server. */
/* ===================================================================
   Azure Scout – VM v6/v7 Migration Tab  (internal plugin)
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
let vmmSortField = "name";
let vmmSortAsc = true;

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
    const tbody = document.getElementById("vmm-tbody");
    if (!tbody) return;

    if (!sorted.length) {
        vmmSetView(vmmAllVms.length ? "no-filter-results" : "no-results");
        return;
    }

    vmmSetView("results");

    const countEl = document.getElementById("vmm-table-count");
    if (countEl) countEl.textContent = sorted.length;

    tbody.innerHTML = sorted.map(v => `<tr>
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
        { label: "V1 Generation", value: byGen.V1 || 0, icon: "bi-exclamation-triangle", color: "warning" },
        { label: "V2 Generation", value: byGen.V2 || 0, icon: "bi-check-circle", color: "info" },
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
            No VMs match the current filters.</td></tr>`;
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
        "Region", "SKU", "Generation", "OS Type", "Image Publisher",
        "Disk Controller", "Zones", "Migration Effort",
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
    downloadCSV([headers, ...rows], "vm-migration-candidates.csv");
}

// Expose for app.js subscription refresh callbacks
window.renderVmmSubList = renderVmmSubList;

/* ===================================================================
   Shared SKU badge renderers — available to all plugins.
   Namespace: window.azScout.components

   Requires: escapeHtml (from app.js)
   =================================================================== */
window.azScout = window.azScout || {};
window.azScout.components = window.azScout.components || {};

((C) => {
    const SCORE_LABELS = [[80, "High"], [60, "Medium"], [40, "Low"], [0, "Very Low"]];

    /**
     * Return a human-readable label for a numeric confidence score.
     * @param {number} score - Score 0–100.
     * @returns {string} "High", "Medium", "Low", or "Very Low".
     */
    C.scoreLabel = (score) => {
        for (const [th, lbl] of SCORE_LABELS) {
            if (score >= th) return lbl;
        }
        return "Very Low";
    };

    /**
     * Render a confidence badge HTML string.
     * @param {object} conf - Confidence object with {score, label, scoreType}.
     * @param {object} [opts] - Optional settings.
     * @param {boolean} [opts.tooltip=true] - Include Bootstrap tooltip.
     * @returns {string} Badge HTML or "—" if no score.
     */
    C.renderConfidenceBadge = (conf, opts) => {
        if (!conf || conf.score == null) return "\u2014";
        const o = opts || {};
        const lbl = (conf.label || "").toLowerCase().replace(/\s+/g, "-");
        const icons = {
            high: "bi-check-circle-fill",
            medium: "bi-dash-circle-fill",
            low: "bi-exclamation-triangle-fill",
            "very-low": "bi-x-circle-fill",
            blocked: "bi-x-octagon-fill",
        };
        const icon = icons[lbl] || "bi-question-circle";
        const typeLabel = conf.scoreType === "basic+spot" ? "with Spot" : "Basic";
        const tip = o.tooltip !== false
            ? ` data-bs-toggle="tooltip" data-bs-title="${typeLabel} deployment confidence: ${conf.score}/100 (${escapeHtml(conf.label || "")})"`
            : "";
        return `<span class="confidence-badge confidence-${lbl}"${tip}><i class="bi ${icon}"></i> ${conf.score}</span>`;
    };

    /**
     * Render spot placement score badges for table cells.
     * @param {object} zoneScores - {zone: scoreLabel} map.
     * @returns {string} HTML badges string.
     */
    C.renderSpotBadges = (zoneScores) => {
        if (!zoneScores || !Object.keys(zoneScores).length) return "";
        return Object.entries(zoneScores)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([z, s]) => {
                const key = (s || "").toLowerCase();
                return `<span class="spot-zone-label">Z${escapeHtml(z)}</span><span class="spot-badge spot-${key}">${escapeHtml(s)}</span>`;
            })
            .join(" ");
    };

    /**
     * Render zone availability badges (compact, for table cells).
     * @param {string[]} zones - Available zones.
     * @param {string[]} restrictions - Restricted zones.
     * @param {string[]} allZones - All logical zones to display.
     * @returns {string} HTML string with zone indicator icons.
     */
    C.renderZoneBadges = (zones, restrictions, allZones) => {
        const zoneList = allZones || ["1", "2", "3"];
        return zoneList.map(lz => {
            const restricted = (restrictions || []).includes(lz);
            const available = (zones || []).includes(lz);
            if (restricted) return `<span class="zone-restricted" data-bs-toggle="tooltip" data-bs-title="Zone ${lz}: Restricted"><i class="bi bi-exclamation-triangle-fill"></i></span>`;
            if (available) return `<span class="zone-available" data-bs-toggle="tooltip" data-bs-title="Zone ${lz}: Available"><i class="bi bi-check-circle-fill"></i></span>`;
            return `<span class="zone-unavailable" data-bs-toggle="tooltip" data-bs-title="Zone ${lz}: Not available"><i class="bi bi-dash-circle"></i></span>`;
        }).join("");
    };

    /**
     * Render a quota progress bar.
     * @param {object} quota - {limit, used, remaining}.
     * @param {object} [opts] - Optional settings.
     * @param {number} [opts.vcpus] - vCPUs per instance for deployable count.
     * @returns {string} HTML string with progress bar.
     */
    C.renderQuotaBar = (quota, opts) => {
        if (!quota || quota.limit == null) return "\u2014";
        const o = opts || {};
        const pct = quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 0;
        let barClass = "bg-success";
        if (pct >= 90) barClass = "bg-danger";
        else if (pct >= 70) barClass = "bg-warning";
        let html = `<div class="d-flex align-items-center gap-2 small">`;
        html += `<div class="progress flex-grow-1" style="height:6px;" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">`;
        html += `<div class="progress-bar ${barClass}" style="width:${pct}%"></div></div>`;
        html += `<span>${pct}%</span>`;
        if (o.vcpus && quota.remaining != null) {
            const deployable = Math.floor(quota.remaining / o.vcpus);
            html += `<span class="text-body-secondary">(${deployable} VMs)</span>`;
        }
        html += "</div>";
        return html;
    };

    /**
     * Render a spot placement badge for a single value.
     * @param {string} label - "High", "Medium", "Low", etc.
     * @returns {string} Badge HTML.
     */
    C.renderSpotBadge = (label) => {
        const key = (label || "").toLowerCase();
        const friendly = { high: "High", medium: "Medium", low: "Low", restrictedskunotavailable: "Restricted", unknown: "Unknown", datanotfoundorstale: "No data" };
        const display = friendly[key] || label;
        const cls = ["high", "medium", "low"].includes(key) ? `spot-badge spot-${key}` : "vm-badge vm-badge-unknown";
        return `<span class="${cls}">${escapeHtml(display)}</span>`;
    };
})(window.azScout.components);

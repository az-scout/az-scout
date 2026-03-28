/* Plugin Manager modal logic */
/* global apiFetch, apiPost, bootstrap */

(() => {


    const container = document.getElementById("plugin-manager-body");
    if (!container) return;

    let lastValidation = null;
    let initialized = false;
    let updateInfo = {};  // distribution_name → update status from /api/plugins/updates

    /** Return true when the source string looks like a PyPI package name (not a URL). */
    function isPypiSource(source) {
        return source && !source.startsWith("http");
    }

    const modalEl = document.getElementById("pluginModal");
    if (!modalEl) return;

    // Lazy-init: fetch HTML fragment + data only when the modal is first shown
    modalEl.addEventListener("show.bs.modal", initOnce);

    // Update URL hash when modal opens/closes
    modalEl.addEventListener("shown.bs.modal", () => {
        window.history.replaceState(null, "", "#plugin");
    });
    modalEl.addEventListener("hidden.bs.modal", () => {
        if (window.location.hash === "#plugin") {
            window.history.replaceState(null, "", window.location.pathname);
        }
    });

    // Open modal from #plugin hash on page load
    if (window.location.hash === "#plugin") {
        const bsModal = new bootstrap.Modal(modalEl);
        bsModal.show();
    }

    function initOnce() {
        if (initialized) return;
        initialized = true;
        container.innerHTML =
            '<div class="text-center py-4 text-muted">' +
            '<div class="spinner-border spinner-border-sm me-2" role="status"></div>' +
            "Loading…</div>";
        fetch("/static/html/plugins.html")
            .then(r => r.text())
            .then(html => {
                container.innerHTML = html;
                initPanelCollapses();
                initCatalogFilter();
                loadPlugins();
                loadRecommended();
                checkUpdatesQuiet();
            });
    }

    function initPanelCollapses() {
        if (!bootstrap || !bootstrap.Collapse) return;
        const toggles = container.querySelectorAll("[data-pm-collapse-target]");
        for (const toggle of toggles) {
            const targetSelector = toggle.getAttribute("data-pm-collapse-target");
            if (!targetSelector) continue;
            const panel = container.querySelector(targetSelector);
            if (!panel) continue;

            const collapse = bootstrap.Collapse.getOrCreateInstance(panel, { toggle: false });

            panel.addEventListener("shown.bs.collapse", () => {
                toggle.setAttribute("aria-expanded", "true");
                toggle.classList.remove("collapsed");
            });
            panel.addEventListener("hidden.bs.collapse", () => {
                toggle.setAttribute("aria-expanded", "false");
                toggle.classList.add("collapsed");
            });

            toggle.classList.add("collapsed");
            toggle.addEventListener("click", () => {
                collapse.toggle();
            });
        }
    }

    // ---- Data loading ----

    function loadPlugins() {
        apiFetch("/api/plugins").then(data => {
            renderInstalledMerged(data.installed || [], data.loaded || []);
        }).catch(() => {});
    }

    /**
     * Build a merged list of all plugins (built-in + external) with UI
     * management controls only for UI-installed ones.
     */
    function renderInstalledMerged(installed, loaded) {
        const empty = document.getElementById("pm-installed-empty");
        const wrap = document.getElementById("pm-installed-table-wrap");
        const tbody = document.getElementById("pm-installed-tbody");
        if (!empty || !wrap || !tbody) return;

        // Build a lookup: distribution_name → installed record
        const installedByDist = {};
        for (const r of installed) {
            installedByDist[r.distribution_name] = r;
        }

        // Build merged rows: start from loaded plugins (authoritative runtime list),
        // then append any installed records that aren't loaded (failed to load, etc.)
        const rows = [];
        const seenDists = new Set();

        for (const p of loaded) {
            const distName = p.distribution_name || "";
            const record = distName ? installedByDist[distName] : null;
            if (distName) seenDists.add(distName);
            rows.push({
                name: p.name,
                version: p.version,
                internal: p.internal,
                uiManaged: !!record,
                record: record,
                distName: distName,
                loaded: true,
            });
        }

        // Append installed-but-not-loaded plugins
        for (const r of installed) {
            if (!seenDists.has(r.distribution_name)) {
                rows.push({
                    name: r.distribution_name,
                    version: r.ref || "",
                    internal: false,
                    uiManaged: true,
                    record: r,
                    distName: r.distribution_name,
                    loaded: false,
                });
            }
        }

        if (rows.length === 0) {
            empty.classList.remove("d-none");
            wrap.classList.add("d-none");
            return;
        }
        empty.classList.add("d-none");
        wrap.classList.remove("d-none");
        tbody.innerHTML = "";
        let anyUpdate = false;

        for (const row of rows) {
            const tr = document.createElement("tr");
            const r = row.record;

            // Name column
            let nameHtml = "<code>" + escHtml(row.name) + "</code>";
            if (row.internal) {
                nameHtml += ' <span class="badge text-bg-secondary">built-in</span>';
            } else if (!row.uiManaged && row.loaded) {
                nameHtml += ' <span class="badge text-bg-light border" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="Installed outside the plugin manager (e.g. pip, Dockerfile). Not manageable from this UI.">external</span>';
            }
            if (!row.loaded) {
                nameHtml += ' <span class="badge text-bg-warning">not loaded</span>';
            }

            // Version column
            const versionHtml = escHtml(row.version);

            // Source column
            let sourceHtml = "";
            if (row.internal) {
                sourceHtml = '<span class="text-body-secondary">built-in</span>';
            } else if (r) {
                const pypi = r.source === "pypi";
                if (pypi) {
                    const pypiUrl = "https://pypi.org/project/" + encodeURIComponent(r.distribution_name) + "/";
                    sourceHtml = '<a href="' + escHtml(pypiUrl) + '" target="_blank" rel="noopener"><i class="bi bi-box-seam me-1"></i>PyPI</a>';
                } else if (r.repo_url) {
                    sourceHtml = '<a href="' + escHtml(r.repo_url) + '" target="_blank" rel="noopener"><i class="bi bi-github me-1"></i>GitHub</a>';
                }
            } else if (!row.uiManaged && row.loaded) {
                sourceHtml = '<span class="text-body-secondary">pip / system</span>';
            }

            // Status + actions — only for UI-managed plugins
            let statusHtml = "";
            let actionsHtml = "";

            if (row.uiManaged && r) {
                const info = updateInfo[r.distribution_name];
                let statusBadge = '<span class="badge bg-secondary">Unknown</span>';
                let updateBtn = "";

                if (info) {
                    if (info.error) {
                        statusBadge = '<span class="badge bg-warning text-dark">Unknown</span>';
                    } else if (info.update_available) {
                        statusBadge = '<span class="badge bg-info text-dark">Update available</span>';
                        updateBtn = ' <button class="btn btn-outline-info btn-sm py-0 px-1" title="Update" onclick="pmUpdate(\'' + escAttr(r.distribution_name) + '\')"><i class="bi bi-cloud-download"></i></button>';
                        anyUpdate = true;
                    } else if (info.latest_ref) {
                        statusBadge = '<span class="badge bg-success">Up to date</span>';
                    }
                } else if (r.update_available === true) {
                    statusBadge = '<span class="badge bg-info text-dark">Update available</span>';
                    updateBtn = ' <button class="btn btn-outline-info btn-sm py-0 px-1" title="Update" onclick="pmUpdate(\'' + escAttr(r.distribution_name) + '\')"><i class="bi bi-cloud-download"></i></button>';
                    anyUpdate = true;
                } else if (r.update_available === false) {
                    statusBadge = '<span class="badge bg-success">Up to date</span>';
                }

                statusHtml = statusBadge;
                actionsHtml = updateBtn +
                    ' <button class="btn btn-outline-danger btn-sm py-0 px-1" title="Uninstall" onclick="pmUninstall(\'' + escAttr(r.distribution_name) + '\')">' +
                    '<i class="bi bi-trash"></i></button>';
            } else {
                statusHtml = '<span class="badge bg-success">Active</span>';
            }

            tr.innerHTML =
                "<td>" + nameHtml + "</td>" +
                "<td>" + versionHtml + "</td>" +
                "<td>" + sourceHtml + "</td>" +
                "<td>" + statusHtml + "</td>" +
                '<td class="text-nowrap">' + actionsHtml + "</td>";
            tbody.appendChild(tr);
        }

        // Show/hide "Update all" button
        const updateAllBtn = document.getElementById("pm-update-all-btn");
        if (updateAllBtn) {
            if (anyUpdate) {
                updateAllBtn.classList.remove("d-none");
            } else {
                updateAllBtn.classList.add("d-none");
            }
        }

        // Initialize Bootstrap tooltips on newly rendered badges
        for (const el of tbody.querySelectorAll('[data-bs-toggle="tooltip"]')) {
            new bootstrap.Tooltip(el);
        }
    }

    // ---- Validate ----

    window.pmValidate = async () => {
        const repoUrl = (document.getElementById("pm-repo-url").value || "").trim();
        const ref = (document.getElementById("pm-ref").value || "").trim();
        if (!repoUrl) return;

        showSpinner("Validating…");
        hideResult();
        disableInstall();
        lastValidation = null;

        try {
            const data = await apiPost("/api/plugins/validate", { repo_url: repoUrl, ref: ref });
            lastValidation = data;
            showResult(data);
            if (data.ok) enableInstall();
        } catch (e) {
            showResultError(e.message);
        } finally {
            hideSpinner();
        }
    };

    // ---- Install ----

    window.pmInstall = async () => {
        const repoUrl = (document.getElementById("pm-repo-url").value || "").trim();
        const ref = (document.getElementById("pm-ref").value || "").trim();
        if (!repoUrl) return;

        showSpinner("Installing…");
        showGlobalStatus("Installing plugin…");
        disableInstall();

        try {
            const data = await apiPost("/api/plugins/install", { repo_url: repoUrl, ref: ref });
            if (data.ok) {
                if (data.restart_required) {
                    showRestartBanner();
                }
                loadPlugins();
                loadRecommended();
                hideResult();
            } else {
                showResultError((data.errors || []).join("; "));
            }
        } catch (e) {
            showResultError(e.message);
        } finally {
            hideSpinner();
            hideGlobalStatus();
        }
    };

    // ---- Uninstall ----

    window.pmUninstall = async (distName) => {
        if (!confirm("Uninstall plugin \"" + distName + "\"?")) return;

        showGlobalStatus("Uninstalling " + distName + "…");

        try {
            const data = await apiPost("/api/plugins/uninstall", { distribution_name: distName });
            if (data.ok) {
                loadPlugins();
                loadRecommended();
            } else {
                alert("Uninstall failed: " + (data.errors || []).join("; "));
            }
        } catch (e) {
            alert("Uninstall error: " + e.message);
        } finally {
            hideGlobalStatus();
        }
    };

    // ---- Check updates ----

    /** Fetch update info and refresh the installed table. */
    async function fetchUpdates() {
        const data = await apiFetch("/api/plugins/updates");
        updateInfo = {};
        for (const p of (data.plugins || [])) {
            updateInfo[p.distribution_name] = p;
        }
        loadPlugins();
    }

    /** Silent check on init — no spinners or error alerts. */
    function checkUpdatesQuiet() {
        fetchUpdates().catch(() => {});
    }

    window.pmCheckUpdates = async () => {
        showSpinner("Checking for updates\u2026");
        showGlobalStatus("Checking for updates\u2026");
        try {
            await fetchUpdates();
        } catch (e) {
            alert("Check updates error: " + e.message);
        } finally {
            hideSpinner();
            hideGlobalStatus();
        }
    };

    // ---- Update single ----

    window.pmUpdate = async (distName) => {
        showSpinner("Updating " + distName + "…");
        showGlobalStatus("Updating " + distName + "…");
        try {
            const data = await apiPost("/api/plugins/update", { distribution_name: distName });
            if (data.ok) {
                if (data.restart_required) {
                    showRestartBanner();
                }
                updateInfo = {};
                loadPlugins();
                loadRecommended();
            } else {
                alert("Update failed: " + (data.errors || []).join("; "));
            }
        } catch (e) {
            alert("Update error: " + e.message);
        } finally {
            hideSpinner();
            hideGlobalStatus();
        }
    };

    // ---- Update all ----

    window.pmUpdateAll = async () => {
        if (!confirm("Update all plugins with available updates?")) return;

        showSpinner("Updating all plugins…");
        showGlobalStatus("Updating all plugins…");
        try {
            const data = await apiPost("/api/plugins/update-all", {});
            if (data.updated > 0) {
                if (data.restart_required) {
                    showRestartBanner();
                }
            }
            updateInfo = {};
            loadPlugins();
            loadRecommended();
            if (data.failed > 0) {
                alert("Some plugins failed to update: " + data.failed);
            }
        } catch (e) {
            alert("Update all error: " + e.message);
        } finally {
            hideSpinner();
            hideGlobalStatus();
        }
    };

    // ---- Plugin catalog ----

    let catalogData = [];  // cached catalog data for filtering

    function initCatalogFilter() {
        const filterInput = document.getElementById("pm-catalog-filter");
        if (!filterInput) return;
        filterInput.addEventListener("input", () => {
            renderRecommended(catalogData, filterInput.value.trim().toLowerCase());
        });
    }

    function loadRecommended() {
        apiFetch("/api/plugins/recommended").then(data => {
            catalogData = data.plugins || [];
            renderRecommended(catalogData, "");
        }).catch(() => {});
    }

    function renderRecommended(list, filterText) {
        const empty = document.getElementById("pm-recommended-empty");
        const wrap = document.getElementById("pm-recommended-table-wrap");
        const tbody = document.getElementById("pm-recommended-tbody");
        if (!empty || !wrap || !tbody) return;

        const filtered = filterText
            ? list.filter(p => p.name.toLowerCase().includes(filterText) ||
                               (p.description || "").toLowerCase().includes(filterText))
            : list;

        if (filtered.length === 0) {
            empty.textContent = filterText ? "No plugins match the filter" : "No plugins in catalog";
            empty.classList.remove("d-none");
            wrap.classList.add("d-none");
            return;
        }
        empty.classList.add("d-none");
        wrap.classList.remove("d-none");
        tbody.innerHTML = "";

        for (const p of filtered) {
            const tr = document.createElement("tr");
            const pypi = p.source === "pypi";
            let sourceLink;
            if (pypi) {
                const pypiUrl = `https://pypi.org/project/${encodeURIComponent(p.name)}/`;
                sourceLink = `<a href="${escHtml(pypiUrl)}" target="_blank" rel="noopener"><i class="bi bi-box-seam me-1"></i>PyPI</a>`;
            } else {
                sourceLink = p.url
                    ? `<a href="${escHtml(p.url)}" target="_blank" rel="noopener"><i class="bi bi-github me-1"></i>GitHub</a>`
                    : escHtml(p.source);
            }

            let actionCell;
            if (p.installed) {
                actionCell = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Installed</span>';
            } else {
                const installSource = pypi ? escAttr(p.name) : escAttr(p.url);
                const installVersion = escAttr(p.version || "");
                actionCell = `<button class="btn btn-outline-success btn-sm py-0 px-2"
                                      title="Quick install"
                                      onclick="pmQuickInstall('${installSource}', '${installVersion}')">
                                  <i class="bi bi-download me-1"></i>Install
                              </button>`;
            }

            tr.innerHTML = `
                <td><code>${escHtml(p.name)}</code></td>
                <td>${escHtml(p.description)}</td>
                <td>${sourceLink}</td>
                <td class="text-nowrap">${actionCell}</td>`;
            tbody.appendChild(tr);
        }
    }

    window.pmQuickInstall = async (source, version) => {
        showSpinner("Installing…");
        showGlobalStatus("Installing plugin…");
        try {
            const data = await apiPost("/api/plugins/install", { repo_url: source, ref: version });
            if (data.ok) {
                if (data.restart_required) {
                    showRestartBanner();
                }
                loadPlugins();
                loadRecommended();
            } else {
                showResultError((data.errors || []).join("; "));
            }
        } catch (e) {
            showResultError(e.message);
        } finally {
            hideSpinner();
            hideGlobalStatus();
        }
    };

    // ---- UI helpers ----

    function showSpinner(text) {
        const el = document.getElementById("pm-spinner");
        const txt = document.getElementById("pm-spinner-text");
        if (el) el.classList.remove("d-none");
        if (txt) txt.textContent = text;
    }
    function hideSpinner() {
        const el = document.getElementById("pm-spinner");
        if (el) el.classList.add("d-none");
    }

    function showRestartBanner() {
        const el = document.getElementById("pm-restart-banner");
        if (el) el.classList.remove("d-none");
    }

    function showGlobalStatus(text) {
        const el = document.getElementById("pm-global-status");
        const txt = document.getElementById("pm-global-status-text");
        if (el) el.classList.remove("d-none");
        if (txt) txt.textContent = text;
    }
    function hideGlobalStatus() {
        const el = document.getElementById("pm-global-status");
        if (el) el.classList.add("d-none");
    }

    function hideResult() {
        const el = document.getElementById("pm-validation-result");
        if (el) el.classList.add("d-none");
    }

    function showResult(data) {
        const wrap = document.getElementById("pm-validation-result");
        const status = document.getElementById("pm-val-status");
        const meta = document.getElementById("pm-val-meta");
        const errEl = document.getElementById("pm-val-errors");
        const warnEl = document.getElementById("pm-val-warnings");
        if (!wrap || !status || !meta || !errEl || !warnEl) return;

        wrap.classList.remove("d-none");

        if (data.ok) {
            status.innerHTML = '<span class="badge bg-success">Valid</span>';
        } else {
            status.innerHTML = '<span class="badge bg-danger">Invalid</span>';
        }

        const lines = [];
        if (data.distribution_name) lines.push("<strong>Distribution:</strong> " + escHtml(data.distribution_name));
        if (data.version) lines.push("<strong>Version:</strong> " + escHtml(data.version));
        if (data.resolved_sha) lines.push("<strong>SHA:</strong> <code>" + escHtml(data.resolved_sha) + "</code>");
        if (data.source) lines.push("<strong>Source:</strong> " + escHtml(data.source === "pypi" ? "PyPI" : "GitHub"));
        if (data.entry_points && Object.keys(data.entry_points).length) {
            lines.push("<strong>Entry points:</strong> " +
                Object.entries(data.entry_points).map(([k, v]) => escHtml(k) + " → " + escHtml(v)).join(", "));
        }
        meta.innerHTML = lines.join("<br>");

        renderList(errEl, data.errors, "danger");
        renderList(warnEl, data.warnings, "warning");
    }

    function showResultError(msg) {
        const wrap = document.getElementById("pm-validation-result");
        const status = document.getElementById("pm-val-status");
        const meta = document.getElementById("pm-val-meta");
        const errEl = document.getElementById("pm-val-errors");
        const warnEl = document.getElementById("pm-val-warnings");
        if (!wrap || !status || !meta || !errEl || !warnEl) return;

        wrap.classList.remove("d-none");
        status.innerHTML = '<span class="badge bg-danger">Error</span>';
        meta.innerHTML = "";
        errEl.classList.remove("d-none");
        errEl.innerHTML = '<div class="alert alert-danger alert-sm py-1 px-2 mb-0" style="font-size:0.82rem;">' +
            escHtml(msg) + '</div>';
        warnEl.classList.add("d-none");
    }

    function renderList(el, items, variant) {
        if (!el) return;
        if (!items || items.length === 0) {
            el.classList.add("d-none");
            return;
        }
        el.classList.remove("d-none");
        el.innerHTML = items.map(i =>
            '<div class="alert alert-' + variant + ' alert-sm py-1 px-2 mb-1" style="font-size:0.82rem;">' +
            '<i class="bi bi-' + (variant === "danger" ? "x-circle" : "exclamation-triangle") + ' me-1"></i>' +
            escHtml(i) + '</div>'
        ).join("");
    }

    function enableInstall() {
        const btn = document.getElementById("pm-install-btn");
        if (btn) btn.disabled = false;
    }
    function disableInstall() {
        const btn = document.getElementById("pm-install-btn");
        if (btn) btn.disabled = true;
    }

    function escHtml(s) {
        const d = document.createElement("div");
        d.textContent = String(s || "");
        return d.innerHTML;
    }

    function escAttr(s) {
        return String(s || "")
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029")
            .replace(/"/g, "&quot;");
    }
})();

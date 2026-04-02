/* ===================================================================
   Shared column filter helpers — available to all plugins.
   Namespace: window.azScout.components

   Provides numeric expression parsing (>5, <32, 4-16) and
   per-column filter rows for data tables.

   Requires: nothing (self-contained)
   =================================================================== */
window.azScout = window.azScout || {};
window.azScout.components = window.azScout.components || {};

((C) => {
    /**
     * Parse a numeric filter expression.
     * Supported syntax: >5, >=5, <32, <=32, =8, 5-16 (range), plain number (exact).
     * @param {string} val - Raw filter string.
     * @returns {object|null} Parsed filter or null.
     */
    C.parseNumericFilter = (val) => {
        const s = (val || "").trim();
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
    };

    /**
     * Test a cell value against a parsed numeric filter.
     * @param {string|number} cellVal - Cell text content.
     * @param {object} filter - Parsed filter from parseNumericFilter.
     * @returns {boolean}
     */
    C.matchNumericFilter = (cellVal, filter) => {
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
    };

    /**
     * Inject a filter row into a table's thead with per-column inputs.
     * Numeric columns accept operator expressions; text columns use substring matching.
     * @param {HTMLElement} tableEl - The table element.
     * @param {number[]} filterableCols - Column indices to add filters to.
     * @param {Set<number>} [numericCols] - Column indices that are numeric.
     * @returns {HTMLElement} The filter row element.
     */
    C.buildColumnFilters = (tableEl, filterableCols, numericCols) => {
        const thead = tableEl.querySelector("thead");
        if (!thead) return null;

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
                input.dataset.col = String(idx);
                td.appendChild(input);
            }
            filterRow.appendChild(td);
        });
        thead.appendChild(filterRow);

        // Debounced column filtering via row visibility
        let timeout;
        filterRow.addEventListener("input", () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => { C.applyColumnFilters(tableEl, filterRow); }, 200);
        });

        return filterRow;
    };

    /**
     * Apply column filters from a filter row to table body rows.
     * @param {HTMLElement} tableEl - The table element.
     * @param {HTMLElement} filterRow - The filter row with inputs.
     */
    C.applyColumnFilters = (tableEl, filterRow) => {
        const inputs = filterRow.querySelectorAll("input[data-col]");
        const filters = [];
        inputs.forEach((inp) => {
            const val = inp.value.trim();
            if (!val) return;
            const col = parseInt(inp.dataset.col, 10);
            const isNumeric = inp.dataset.numeric === "1";
            if (isNumeric) {
                const nf = C.parseNumericFilter(val);
                if (nf) { filters.push({ col: col, numeric: nf }); return; }
            }
            filters.push({ col: col, text: val.toLowerCase() });
        });

        const rows = tableEl.querySelectorAll("tbody tr");
        rows.forEach((row) => {
            if (filters.length === 0) { row.style.display = ""; return; }
            const cells = row.querySelectorAll("td");
            const match = filters.every((f) => {
                const cell = cells[f.col];
                if (!cell) return false;
                if (f.numeric) return C.matchNumericFilter(cell.textContent, f.numeric);
                return cell.textContent.toLowerCase().includes(f.text);
            });
            row.style.display = match ? "" : "none";
        });
    };
})(window.azScout.components);

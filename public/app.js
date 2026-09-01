document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const barcodeInput = $("barcode-input");
  const manualInvoiceIdInput = $("manual-invoice-id");
  const reasonInput = $("reason");
  const manualAddBtn = $("manual-add-btn");
  const scannerIndicator = $("scanner-indicator");
  const scannerStatus = $("scanner-status");
  const lastScannedCode = $("last-scanned-code");
  const invoiceList = $("invoice-list");
  const invoiceTable = $("invoice-table");
  const noInvoicesMessage = $("no-invoices-message");
  const invoiceCount = $("invoice-count");
  const processBtn = $("process-btn");
  const testErrorsBtn = $("test-errors-btn");
  const clearAllBtn = $("clear-all-btn");
  const errorAlert = $("error-alert");
  const errorMessage = $("error-message");
  const successAlert = $("success-alert");
  const successMessage = $("success-message");
  const loadingOverlay = $("loading-overlay");
  const resultsSection = $("results-section");
  const successfulList = $("successful-list");
  const failedList = $("failed-list");
  const successfulCount = $("successful-count");
  const failedCount = $("failed-count");
  const noSuccessfulMessage = $("no-successful-message");
  const noFailedMessage = $("no-failed-message");
  const downloadResultsBtn = $("download-results-btn");

  // --- Optimized state: O(1) dedup via Set + localStorage persistence ---
  const STORAGE_KEY = "invoices_v2";
  let invoices = [];
  let invoiceIds = new Set();
  let lastProcessedResults = null;
  let scanTimeout = null;
  let errorHideTimer = null;
  let successHideTimer = null;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved) && saved.length) {
      invoices = saved;
      invoiceIds = new Set(saved.map((x) => x.id));
    }
  } catch {}

  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices)); } catch {}
  };

  barcodeInput.focus();

  // Keep focus - throttled
  let focusRaf = null;
  document.addEventListener("click", () => {
    if (focusRaf) return;
    focusRaf = requestAnimationFrame(() => {
      focusRaf = null;
      if (document.activeElement !== manualInvoiceIdInput && document.activeElement !== reasonInput) barcodeInput.focus();
    });
  });

  // --- Optimized scanner: 80ms debounce, handles input+paste, rAF status ---
  const setScanner = (cls, text) => {
    requestAnimationFrame(() => {
      scannerIndicator.className = `scanner-indicator ${cls}`;
      scannerStatus.textContent = text;
    });
  };

  const onScannerInput = () => {
    const val = barcodeInput.value.trim();
    if (!val) return;
    setScanner("scanning", "Scanning...");
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      const v = barcodeInput.value.trim();
      if (v) handleBarcodeScanned(v);
    }, 80);
  };
  barcodeInput.addEventListener("input", onScannerInput);
  barcodeInput.addEventListener("paste", () => setTimeout(onScannerInput, 10));
  barcodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = barcodeInput.value.trim();
      if (v) { clearTimeout(scanTimeout); handleBarcodeScanned(v); }
    }
  });

  function handleBarcodeScanned(barcode) {
    barcodeInput.value = "";
    lastScannedCode.textContent = barcode;
    addScannedInvoice(barcode);
    setScanner("success", `Scanned: ${barcode}`);
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => setScanner("ready", "Ready for scanning"), 2500);
    // keep focus without layout thrash
    requestAnimationFrame(() => barcodeInput.focus());
  }

  function addScannedInvoice(invoiceId) {
    const id = invoiceId.trim();
    const reason = "pochondo hoy nai";
    if (!id) return showError("Invalid barcode scanned");
    if (invoiceIds.has(id)) return showError(`Invoice ${id} already in list`);
    invoices.push({ id, reason, timestamp: new Date().toLocaleString() });
    invoiceIds.add(id);
    persist();
    updateInvoiceList();
    showSuccess(`Invoice ${id} added!`);
    hideError();
  }

  manualAddBtn.addEventListener("click", addInvoiceManually);
  processBtn.addEventListener("click", processInvoices);
  downloadResultsBtn.addEventListener("click", downloadResults);
  testErrorsBtn.addEventListener("click", testErrorHandling);
  clearAllBtn.addEventListener("click", clearAllInvoices);
  manualInvoiceIdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addInvoiceManually(); });
  reasonInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addInvoiceManually(); });

  function addInvoiceManually() {
    const id = manualInvoiceIdInput.value.trim();
    const reason = reasonInput.value.trim();
    if (!id) return showError("Invoice ID is required");
    if (!reason) return showError("Reason is required");
    if (invoiceIds.has(id)) return showError("Invoice ID already exists");
    invoices.push({ id, reason, timestamp: new Date().toLocaleString() });
    invoiceIds.add(id);
    persist();
    updateInvoiceList();
    manualInvoiceIdInput.value = "";
    reasonInput.value = "pochondo hoy nai";
    manualInvoiceIdInput.focus();
    showSuccess(`Invoice ${id} added manually!`);
    hideError();
  }

  // --- Optimized rendering: DocumentFragment + event delegation ---
  function updateInvoiceList() {
    if (invoices.length > 0) {
      invoiceTable.style.display = "table";
      noInvoicesMessage.style.display = "none";
      invoiceCount.textContent = `${invoices.length} invoice(s) ready to process`;
      processBtn.disabled = false;
      const frag = document.createDocumentFragment();
      invoices.forEach((inv, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="font-medium">${escapeHtml(inv.id)}</td><td>${escapeHtml(inv.reason)}</td><td style="font-size:.8rem;color:#888">${escapeHtml(inv.timestamp || "N/A")}</td><td><button class="delete-btn" data-idx="${idx}" title="Remove">🗑️</button></td>`;
        frag.appendChild(tr);
      });
      invoiceList.replaceChildren(frag);
    } else {
      invoiceList.replaceChildren();
      invoiceTable.style.display = "none";
      noInvoicesMessage.style.display = "block";
      invoiceCount.textContent = "No invoices scanned yet";
      processBtn.disabled = true;
    }
  }
  // delegate delete
  invoiceList.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!Number.isNaN(idx)) removeInvoice(idx);
  });

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function removeInvoice(index) {
    const removed = invoices[index];
    invoices.splice(index, 1);
    if (removed) invoiceIds.delete(removed.id);
    persist();
    updateInvoiceList();
    showSuccess(`Invoice ${removed?.id} removed`);
  }

  function clearAllInvoices() {
    if (invoices.length === 0) return showError("No invoices to clear");
    if (!confirm(`Clear all ${invoices.length} invoices?`)) return;
    invoices.length = 0;
    invoiceIds.clear();
    persist();
    updateInvoiceList();
    showSuccess("All invoices cleared");
    resultsSection.style.display = "none";
  }

  async function processInvoices() {
    if (invoices.length === 0) return showError("Please add at least one invoice to process");
    loadingOverlay.style.display = "flex";
    hideError(); hideSuccess();
    resultsSection.style.display = "none";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000 * 60 * 12); // 12 min max for many invoices
    try {
      const res = await fetch("/api/process-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Server error: ${res.status}`);
      }
      const apiData = await res.json();
      const data = { successful: apiData.successful || apiData.successfulInvoices || [], failed: apiData.failed || apiData.failedInvoices || [] };
      lastProcessedResults = data;
      displayResults(data);
      showSuccess(`Done! ✓${data.successful.length}  ✗${data.failed.length}`);
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("processInvoices:", err);
      const msg = err.name === "AbortError" ? "Request timed out - server took too long" : (err.message || "Unknown error");
      showError(msg);
      // don't show mock fallback alert; just show error results
      const mock = { successful: [], failed: invoices.map((inv) => ({ ...inv, error: msg })) };
      displayResults(mock);
      lastProcessedResults = mock;
    } finally {
      loadingOverlay.style.display = "none";
    }
  }

  async function testErrorHandling() {
    if (invoices.length === 0) return showError("Please add at least one invoice to test");
    loadingOverlay.style.display = "flex";
    hideError(); hideSuccess();
    resultsSection.style.display = "none";
    try {
      const res = await fetch("/api/test-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      lastProcessedResults = data;
      displayResults(data);
      showSuccess("Error handling test complete. All should show as failed.");
    } catch (err) {
      const mock = { successful: [], failed: invoices.map((inv) => ({ ...inv, error: "Test error: " + (err.message || "Unknown") })) };
      lastProcessedResults = mock;
      displayResults(mock);
    } finally { loadingOverlay.style.display = "none"; }
  }

  function displayResults(data) {
    const successful = data?.successful || [];
    const failed = data?.failed || [];

    successfulCount.textContent = successful.length;
    failedCount.textContent = failed.length;

    let summaryDiv = document.getElementById("results-summary");
    if (!summaryDiv) {
      summaryDiv = document.createElement("div");
      summaryDiv.id = "results-summary";
      summaryDiv.className = "results-summary";
      resultsSection.insertBefore(summaryDiv, resultsSection.firstChild);
    }
    summaryDiv.textContent = `${successful.length} successful, ${failed.length} failed.`;
    summaryDiv.style.display = "block";

    // Use fragments to avoid repeated reflow
    if (successful.length > 0) {
      noSuccessfulMessage.style.display = "none";
      const frag = document.createDocumentFragment();
      successful.forEach((inv) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="font-medium">${escapeHtml(inv.id)}</td><td>${escapeHtml(inv.reason)}</td><td>${escapeHtml(inv.customerName || "N/A")}</td>`;
        frag.appendChild(tr);
      });
      successfulList.replaceChildren(frag);
    } else {
      successfulList.replaceChildren();
      noSuccessfulMessage.style.display = "block";
    }

    if (failed.length > 0) {
      noFailedMessage.style.display = "none";
      const frag = document.createDocumentFragment();
      failed.forEach((inv) => {
        const err = inv.error || "Unknown error";
        const short = err.length > 60 ? err.slice(0, 57) + "..." : err;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="font-medium">${escapeHtml(inv.id)}</td><td>${escapeHtml(inv.reason)}</td><td class="text-error" title="${escapeHtml(err)}">${escapeHtml(short)}</td>`;
        frag.appendChild(tr);
      });
      failedList.replaceChildren(frag);
    } else {
      failedList.replaceChildren();
      noFailedMessage.style.display = "block";
    }

    resultsSection.style.display = "block";
    resultsSection.scrollIntoView({ behavior: "smooth" });
  }

  // --- Optimized alerts: per-alert timers instead of setInterval polling ---
  function showError(message) {
    errorMessage.textContent = message;
    errorAlert.style.display = "block";
    errorAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
    clearTimeout(errorHideTimer);
    errorHideTimer = setTimeout(hideError, 5000);
  }
  function hideError() { errorAlert.style.display = "none"; }
  function showSuccess(message) {
    successMessage.textContent = message;
    successAlert.style.display = "block";
    successAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
    clearTimeout(successHideTimer);
    successHideTimer = setTimeout(hideSuccess, 4000);
  }
  function hideSuccess() { successAlert.style.display = "none"; }

  // --- Optimized CSV: Blob + proper escaping (handles commas/quotes/newlines & large data) ---
  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function downloadResults() {
    if (!lastProcessedResults) return showError("No results to download");
    const rows = [];
    rows.push(["Successful Invoices"]);
    rows.push(["Invoice ID", "Reason", "Customer", "Timestamp"]);
    for (const inv of (lastProcessedResults.successful || [])) rows.push([inv.id, inv.reason, inv.customerName || "N/A", inv.timestamp || ""]);
    rows.push([]);
    rows.push(["Failed Invoices"]);
    rows.push(["Invoice ID", "Reason", "Error"]);
    for (const inv of (lastProcessedResults.failed || [])) rows.push([inv.id, inv.reason, inv.error || ""]);
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showSuccess("Results downloaded!");
  }

  window.testErrorHandling = testErrorHandling;
  updateInvoiceList();
});

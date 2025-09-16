document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const barcodeInput = document.getElementById("barcode-input");
  const manualInvoiceIdInput = document.getElementById("manual-invoice-id");
  const reasonInput = document.getElementById("reason");
  const manualAddBtn = document.getElementById("manual-add-btn");
  const scannerIndicator = document.getElementById("scanner-indicator");
  const scannerStatus = document.getElementById("scanner-status");
  const lastScannedCode = document.getElementById("last-scanned-code");
  const invoiceList = document.getElementById("invoice-list");
  const invoiceTable = document.getElementById("invoice-table");
  const noInvoicesMessage = document.getElementById("no-invoices-message");
  const invoiceCount = document.getElementById("invoice-count");
  const processBtn = document.getElementById("process-btn");
  const testErrorsBtn = document.getElementById("test-errors-btn");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const errorAlert = document.getElementById("error-alert");
  const errorMessage = document.getElementById("error-message");
  const successAlert = document.getElementById("success-alert");
  const successMessage = document.getElementById("success-message");
  const loadingOverlay = document.getElementById("loading-overlay");
  const resultsSection = document.getElementById("results-section");
  const successfulList = document.getElementById("successful-list");
  const failedList = document.getElementById("failed-list");
  const successfulCount = document.getElementById("successful-count");
  const failedCount = document.getElementById("failed-count");
  const noSuccessfulMessage = document.getElementById("no-successful-message");
  const noFailedMessage = document.getElementById("no-failed-message");
  const downloadResultsBtn = document.getElementById("download-results-btn");

  // State
  const invoices = [];
  let lastProcessedResults = null;
  const scanBuffer = "";
  let scanTimeout = null;

  // Focus on barcode input when page loads
  barcodeInput.focus();

  // Keep focus on barcode input
  document.addEventListener("click", () => {
    if (
      document.activeElement !== manualInvoiceIdInput &&
      document.activeElement !== reasonInput
    ) {
      barcodeInput.focus();
    }
  });

  // Barcode scanner detection
  barcodeInput.addEventListener("input", (e) => {
    const value = e.target.value.trim();

    // Update scanner status
    scannerIndicator.className = "scanner-indicator scanning";
    scannerStatus.textContent = "Scanning...";

    // Clear any existing timeout
    if (scanTimeout) {
      clearTimeout(scanTimeout);
    }

    // Set timeout to detect end of scan
    scanTimeout = setTimeout(() => {
      if (value && value.length > 0) {
        handleBarcodeScanned(value);
      }
    }, 100); // Wait 100ms after last input
  });

  // Handle Enter key (common for laser scanners)
  barcodeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = barcodeInput.value.trim();
      if (value) {
        handleBarcodeScanned(value);
      }
    }
  });

  // Handle barcode scanned
  function handleBarcodeScanned(barcode) {
    console.log("Barcode scanned:", barcode);

    // Clear the input
    barcodeInput.value = "";

    // Update last scanned display
    lastScannedCode.textContent = barcode;

    // Add the scanned invoice
    addScannedInvoice(barcode);

    // Update scanner status
    scannerIndicator.className = "scanner-indicator success";
    scannerStatus.textContent = `Successfully scanned: ${barcode}`;

    // Reset status after 3 seconds
    setTimeout(() => {
      scannerIndicator.className = "scanner-indicator ready";
      scannerStatus.textContent = "Ready for scanning";
    }, 3000);

    // Keep focus on input for next scan
    setTimeout(() => {
      barcodeInput.focus();
    }, 100);
  }

  // Add scanned invoice to the list
  function addScannedInvoice(invoiceId) {
    const id = invoiceId.trim();
    const reason = "pochondo hoy nai"; // Default reason

    // Validation
    if (!id) {
      showError("Invalid barcode scanned");
      return;
    }

    // Check for duplicate invoice ID
    if (invoices.some((invoice) => invoice.id === id)) {
      showError(`Invoice ID ${id} already exists in the list`);
      return;
    }

    // Add to state with timestamp
    const timestamp = new Date().toLocaleString();
    invoices.push({ id, reason, timestamp });

    // Update UI
    updateInvoiceList();

    // Show success message
    showSuccess(`Invoice ${id} added successfully!`);

    // Hide error if shown
    hideError();
  }

  // Event listeners
  manualAddBtn.addEventListener("click", addInvoiceManually);
  processBtn.addEventListener("click", processInvoices);
  downloadResultsBtn.addEventListener("click", downloadResults);
  testErrorsBtn.addEventListener("click", testErrorHandling);
  clearAllBtn.addEventListener("click", clearAllInvoices);

  // Enter key support for manual entry
  manualInvoiceIdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addInvoiceManually();
    }
  });

  // Add invoice manually (fallback)
  function addInvoiceManually() {
    const id = manualInvoiceIdInput.value.trim();
    const reason = reasonInput.value.trim();

    // Validation
    if (!id) {
      showError("Invoice ID is required");
      return;
    }
    if (!reason) {
      showError("Reason is required");
      return;
    }

    // Check for duplicate invoice ID
    if (invoices.some((invoice) => invoice.id === id)) {
      showError("Invoice ID already exists in the list");
      return;
    }

    // Add to state with timestamp
    const timestamp = new Date().toLocaleString();
    invoices.push({ id, reason, timestamp });

    // Update UI
    updateInvoiceList();

    // Clear inputs
    manualInvoiceIdInput.value = "";
    reasonInput.value = "pochondo hoy nai";
    manualInvoiceIdInput.focus();

    // Show success message
    showSuccess(`Invoice ${id} added manually!`);

    // Hide error if shown
    hideError();
  }

  // Update the invoice list in the UI
  function updateInvoiceList() {
    // Clear the list
    invoiceList.innerHTML = "";

    if (invoices.length > 0) {
      // Show table, hide message
      invoiceTable.style.display = "table";
      noInvoicesMessage.style.display = "none";

      // Update count
      invoiceCount.textContent = `${invoices.length} invoice(s) ready to process`;

      // Enable process button
      processBtn.disabled = false;

      // Add each invoice to the table
      invoices.forEach((invoice, index) => {
        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.textContent = invoice.id;
        idCell.className = "font-medium";

        const reasonCell = document.createElement("td");
        reasonCell.textContent = invoice.reason;

        const timeCell = document.createElement("td");
        timeCell.textContent = invoice.timestamp || "N/A";
        timeCell.style.fontSize = "0.8rem";
        timeCell.style.color = "#888";

        const actionCell = document.createElement("td");
        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = "🗑️";
        deleteBtn.className = "delete-btn";
        deleteBtn.title = "Remove invoice";
        deleteBtn.addEventListener("click", () => removeInvoice(index));
        actionCell.appendChild(deleteBtn);

        row.appendChild(idCell);
        row.appendChild(reasonCell);
        row.appendChild(timeCell);
        row.appendChild(actionCell);
        invoiceList.appendChild(row);
      });
    } else {
      // Hide table, show message
      invoiceTable.style.display = "none";
      noInvoicesMessage.style.display = "block";

      // Update count
      invoiceCount.textContent = "No invoices scanned yet";

      // Disable process button
      processBtn.disabled = true;
    }
  }

  // Remove invoice from the list
  function removeInvoice(index) {
    const removedInvoice = invoices[index];
    invoices.splice(index, 1);
    updateInvoiceList();
    showSuccess(`Invoice ${removedInvoice.id} removed`);
  }

  // Clear all invoices
  function clearAllInvoices() {
    if (invoices.length === 0) {
      showError("No invoices to clear");
      return;
    }

    if (
      confirm(`Are you sure you want to clear all ${invoices.length} invoices?`)
    ) {
      invoices.length = 0;
      updateInvoiceList();
      showSuccess("All invoices cleared");

      // Hide results section
      resultsSection.style.display = "none";
    }
  }

  // Process invoices
  async function processInvoices() {
    if (invoices.length === 0) {
      showError("Please add at least one invoice to process");
      return;
    }

    // Show loading overlay
    loadingOverlay.style.display = "flex";

    // Hide alerts
    hideError();
    hideSuccess();

    // Hide results section if shown
    resultsSection.style.display = "none";

    try {
      let data;
      try {
        const response = await fetch("/api/process-invoices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ invoices }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Server error: ${response.status}`
          );
        }

        const apiData = await response.json();
        console.log("API Response:", apiData);

        data = {
          successful: apiData.successful || apiData.successfulInvoices || [],
          failed: apiData.failed || apiData.failedInvoices || [],
        };
      } catch (fetchError) {
        console.error("Fetch error:", fetchError);
        data = {
          successful: [],
          failed: invoices.map((inv) => ({
            ...inv,
            error: fetchError.message || "Failed to connect to server",
          })),
        };
        alert(
          "Could not connect to server. Using mock data for display purposes."
        );
      }

      lastProcessedResults = data;
      displayResults(data);

      const successCount = data.successful ? data.successful.length : 0;
      const failedCount = data.failed ? data.failed.length : 0;
      showSuccess(
        `Processing complete! Successfully processed ${successCount} invoices with ${failedCount} failures.`
      );
    } catch (err) {
      console.error("Error in processInvoices:", err);
      showError(err.message || "An unknown error occurred");

      const mockData = {
        successful: [],
        failed: invoices.map((inv) => ({
          ...inv,
          error: "Processing failed: " + (err.message || "Unknown error"),
        })),
      };
      displayResults(mockData);
    } finally {
      loadingOverlay.style.display = "none";
    }
  }

  // Test error handling functionality
  function testErrorHandling() {
    if (invoices.length === 0) {
      showError("Please add at least one invoice to test error handling");
      return;
    }

    loadingOverlay.style.display = "flex";
    hideError();
    hideSuccess();
    resultsSection.style.display = "none";

    fetch("/api/test-errors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invoices }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Test error response:", data);
        lastProcessedResults = data;
        displayResults(data);
        showSuccess(
          "Error handling test complete. All invoices should show as failed with test errors."
        );
      })
      .catch((err) => {
        console.error("Error in testErrorHandling:", err);
        const mockData = {
          successful: [],
          failed: invoices.map((inv) => ({
            ...inv,
            error: "Test error: " + (err.message || "Unknown error"),
          })),
        };
        lastProcessedResults = mockData;
        displayResults(mockData);
        showSuccess(
          "Using mock data for error testing. All invoices should show as failed."
        );
      })
      .finally(() => {
        loadingOverlay.style.display = "none";
      });
  }

  // Display processing results
  function displayResults(data) {
    successfulList.innerHTML = "";
    failedList.innerHTML = "";

    const successful = data && data.successful ? data.successful : [];
    const failed = data && data.failed ? data.failed : [];

    successfulCount.textContent = successful.length;
    failedCount.textContent = failed.length;

    const summaryMsg = `${successful.length} successful, ${failed.length} failed.`;
    let summaryDiv = document.getElementById("results-summary");
    if (!summaryDiv) {
      summaryDiv = document.createElement("div");
      summaryDiv.id = "results-summary";
      summaryDiv.className = "results-summary";
      resultsSection.insertBefore(summaryDiv, resultsSection.firstChild);
    }
    summaryDiv.textContent = summaryMsg;
    summaryDiv.style.display = "block";

    // Successful invoices
    if (successful.length > 0) {
      noSuccessfulMessage.style.display = "none";
      successful.forEach((invoice) => {
        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.textContent = invoice.id;
        idCell.className = "font-medium";

        const reasonCell = document.createElement("td");
        reasonCell.textContent = invoice.reason;

        const customerCell = document.createElement("td");
        customerCell.textContent = invoice.customerName || "N/A";

        row.appendChild(idCell);
        row.appendChild(reasonCell);
        row.appendChild(customerCell);
        successfulList.appendChild(row);
      });
    } else {
      noSuccessfulMessage.style.display = "block";
    }

    // Failed invoices
    if (failed.length > 0) {
      console.log("Rendering failed invoices:", failed);
      noFailedMessage.style.display = "none";
      failed.forEach((invoice) => {
        console.log("Failed invoice:", invoice);
        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.textContent = invoice.id;
        idCell.className = "font-medium";

        const reasonCell = document.createElement("td");
        reasonCell.textContent = invoice.reason;

        const errorCell = document.createElement("td");
        errorCell.textContent = invoice.error || "Unknown error";
        errorCell.className = "text-error";

        if (invoice.error && invoice.error.length > 50) {
          errorCell.title = invoice.error;
          errorCell.textContent = invoice.error.substring(0, 47) + "...";
        }

        row.appendChild(idCell);
        row.appendChild(reasonCell);
        row.appendChild(errorCell);
        failedList.appendChild(row);
      });
    } else {
      noFailedMessage.style.display = "block";
    }

    resultsSection.style.display = "block";
    resultsSection.scrollIntoView({ behavior: "smooth" });
  }

  // Show error message
  function showError(message) {
    errorMessage.textContent = message;
    errorAlert.style.display = "block";
    setTimeout(() => {
      errorAlert.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  // Hide error message
  function hideError() {
    errorAlert.style.display = "none";
  }

  // Show success message
  function showSuccess(message) {
    successMessage.textContent = message;
    successAlert.style.display = "block";
    setTimeout(() => {
      successAlert.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  // Hide success message
  function hideSuccess() {
    successAlert.style.display = "none";
  }

  // Download results as CSV
  function downloadResults() {
    if (!lastProcessedResults) {
      showError("No results to download");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";

    csvContent += "Successful Invoices\r\n";
    csvContent += "Invoice ID,Reason,Customer,Timestamp\r\n";
    const successful = lastProcessedResults.successful || [];
    successful.forEach((invoice) => {
      csvContent += `${invoice.id},${(invoice.reason || "").replace(
        /,/g,
        ";"
      )},${invoice.customerName || "N/A"},${invoice.timestamp || ""}\r\n`;
    });

    csvContent += "\r\nFailed Invoices\r\n";
    csvContent += "Invoice ID,Reason,Error\r\n";
    const failed = lastProcessedResults.failed || [];
    failed.forEach((invoice) => {
      csvContent += `${invoice.id},${(invoice.reason || "").replace(
        /,/g,
        ";"
      )},${(invoice.error || "").replace(/,/g, ";")}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `invoice-results-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showSuccess("Results downloaded successfully!");
  }

  // Make functions available globally
  window.testErrorHandling = testErrorHandling;

  // Initialize the UI
  updateInvoiceList();

  // Auto-hide alerts after 5 seconds
  setInterval(() => {
    if (errorAlert.style.display === "block") {
      setTimeout(hideError, 5000);
    }
    if (successAlert.style.display === "block") {
      setTimeout(hideSuccess, 5000);
    }
  }, 100);
});

import express from "express";
import path from "path";
import puppeteer from "puppeteer";
import os from "os";
import { existsSync, mkdirSync, writeFileSync } from "fs";

import { Server } from "socket.io";
import http from "http";

const app = express();
// init the socket server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = 5000;

// Middleware
app.use(express.json());
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, "public")));

// Add CORS headers to allow requests from any origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Define timeout constants
const TIMEOUT = {
  navigation: 150000,
  element: 50000,
  action: 3000,
};

function logAndEmit(message, type = "info") {
  console.log(message);
  io.emit("log", { message, type, timestamp: new Date().toISOString() });
}

// Utility function to save results to files
function saveResults(successful, failed) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");

  // Create results directory if it doesn't exist
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const successPath = path.join(
    resultsDir,
    `successful-invoices-${timestamp}.json`
  );
  const failedPath = path.join(resultsDir, `failed-invoices-${timestamp}.json`);

  writeFileSync(successPath, JSON.stringify(successful, null, 2));
  if (failed.length > 0) {
    writeFileSync(failedPath, JSON.stringify(failed, null, 2));
  }

  console.log("\nResults saved to:");
  console.log(`- ${successPath}`);
  if (failed.length > 0) {
    console.log(`- ${failedPath}`);
  }

  return { successPath, failedPath };
}

// Utility function to handle navigation with error handling
async function safeNavigate(page, url, timeout = TIMEOUT.navigation) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout });
  } catch (err) {
    throw new Error(`Failed to navigate to ${url}: ${err.message}`);
  }
}

// Utility function to wait for a selector with error handling
async function safeWaitForSelector(page, selector, timeout = TIMEOUT.element) {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (err) {
    throw new Error(`Selector "${selector}" not found: ${err.message}`);
  }
}

// Function to process a single invoice
async function processInvoice(page, id, reason) {
  try {
    logAndEmit(`🔄 [${id}] Processing invoice`);

    // Force an error for testing if the ID contains "test"
    if (id.toLowerCase().includes("test")) {
      throw new Error("This is a test error to verify error handling");
    }

    // 2️⃣ Go to Sales and search
    await safeNavigate(page, "https://creationedgebd.com/sales");
    await safeWaitForSelector(page, "#sale-table_filter input.form-control-sm");
    await page.click("#sale-table_filter input.form-control-sm", {
      clickCount: 3,
    });
    await page.type("#sale-table_filter input.form-control-sm", id);
    await new Promise((r) => setTimeout(r, TIMEOUT.action)); // allow table to refresh

    // Check if invoice exists
    const invoiceExists = await page.evaluate(() => {
      const rows = document.querySelectorAll("#sale-table tbody tr");
      return (
        rows.length > 0 &&
        !document
          .querySelector("#sale-table_info")
          .textContent.includes("Showing 0 to 0 of 0")
      );
    });

    if (!invoiceExists) {
      console.error(`❌ [${id}] Invoice not found in the system`);
      return { success: false, error: "Invoice not found in the system" };
    }

    // 3️⃣ Capture expected customer name
    const expectedName = await page
      .$eval("#sale-table tbody tr td:nth-child(3)", (el) =>
        el.textContent.trim()
      )
      .catch(() => {
        throw new Error("Customer name not found");
      });
    logAndEmit(`🔍 [${id}] Expected name: ${expectedName}`);

    // Check if the dropdown toggle exists
    const hasDropdown = await page.evaluate(() => {
      return !!document.querySelector("#sale-table tbody tr .dropdown-toggle");
    });

    if (!hasDropdown) {
      console.error(`❌ [${id}] Action dropdown not found`);
      return {
        success: false,
        error: "Action dropdown not found - invoice may be in an invalid state",
      };
    }

    // 4️⃣ Open "Action" → "Sell Return"
    await page.click("#sale-table tbody tr .dropdown-toggle");

    // Check if the return option exists
    const hasReturnOption = await page.evaluate(() => {
      return !!document.querySelector(
        '.dropdown-menu a[href*="/return-sale/invoice"]'
      );
    });

    if (!hasReturnOption) {
      console.error(`❌ [${id}] Return option not available for this invoice`);
      return {
        success: false,
        error:
          "Return option not available - invoice may already be returned or not eligible",
      };
    }

    await safeWaitForSelector(
      page,
      '.dropdown-menu a[href*="/return-sale/invoice"]'
    );
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: TIMEOUT.navigation,
      }),
      page.click('.dropdown-menu a[href*="/return-sale/invoice"]'),
    ]);
    logAndEmit(`🚚 [${id}] Opened return form`);

    // 5️⃣ Fill and submit return form
    await safeWaitForSelector(page, 'textarea[name="return_note"]');
    await page.type('textarea[name="return_note"]', reason);
    await new Promise((r) => setTimeout(r, TIMEOUT.action));

    // Scroll to bottom of the page after writing reason
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 1000)); // wait for scroll to complete

    // More specific selector for the submit button
    const submitButtonSelector =
      'form.payment-form button[type="submit"].btn.btn-primary';
    await safeWaitForSelector(page, submitButtonSelector, TIMEOUT.element);
    logAndEmit(`🔘 [${id}] Found submit button`);

    let submitButton = await page.$(submitButtonSelector);
    if (!submitButton) {
      console.error(`❌ [${id}] Submit button not found`);
      return {
        success: false,
        error: "Submit button not found - invoice may be in an invalid state",
      };
    }

    // Click the submit button
    try {
      await submitButton.click({ delay: 100 });
    } catch (clickError) {
      logAndEmit(`⚠️ [${id}] Direct click failed, trying alternate methods...`);
      try {
        await page.evaluate((selector) => {
          const btn = document.querySelector(selector);
          if (btn) btn.click();
        }, submitButtonSelector);
      } catch (evaluateError) {
        console.error(`❌ [${id}] Submit button click failed`);
        return { success: false, error: "Failed to click submit button" };
      }
    }

    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: TIMEOUT.navigation,
    });
    logAndEmit(`✅ [${id}] Submitted return form`);

    // Check for redirection
    const currentUrl = page.url();
    if (currentUrl.includes("/return-sale/storecustom")) {
      console.warn(`⚠️ [${id}] Redirected to storecustom, skipping invoice.`);
      return {
        success: false,
        error:
          "Redirected to storecustom - invoice may require special handling",
      };
    }
    // If we reach here, treat as success (submitted return form and not redirected to storecustom)
    return {
      success: true,
      customerName: expectedName,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    try {
      console.error(`❌ [${id}] Error: ${err.message}`);

      // Take a screenshot of the error state
      try {
        const screenshotPath = `error-${id}-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to ${screenshotPath}`);
      } catch (screenshotError) {
        console.error(
          `Failed to take error screenshot for ${id}:`,
          screenshotError.message
        );
      }

      return { success: false, error: err.message };
    } catch (err) {
      // This is a fallback in case the error handling itself fails
      console.error(`❌ [${id}] Critical error in error handler:`, err.message);
      return { success: false, error: "Critical error occurred" };
    }
  }
}

// Main function to process invoices
async function processInvoices(invoices) {
  let browser;
  let page; // Declare the page variable here
  const successfulInvoices = [];
  const failedInvoices = [];

  try {
    // Detect the platform

    try {
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        protocolTimeout: 1800000, // 3 minutes protocol timeout
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080",
        ],
      });

      page = await browser.newPage(); // Initialize the page here
      await page.setDefaultNavigationTimeout(TIMEOUT.navigation);
      await page.setDefaultTimeout(TIMEOUT.element);
    } catch (browserError) {
      console.error("Failed to launch browser:", browserError.message);
      // Mark all invoices as failed
      for (const { id, reason } of invoices) {
        failedInvoices.push({
          id,
          reason,
          error: `Browser launch error: ${browserError.message}`,
        });
      }
      return { successful: successfulInvoices, failed: failedInvoices };
    }

    // 1️⃣ Login once
    try {
      await safeNavigate(page, "https://creationedgebd.com/login");
      await safeWaitForSelector(page, "#login-username");
      await page.type("#login-username", "Raisul@gmail.com");
      await page.type("#login-password", "thisisatestpassword");
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      logAndEmit("✅ Logged in");
    } catch (loginError) {
      // If login fails, all invoices will fail
      console.error("❌ Login failed:", loginError.message);
      for (const { id, reason } of invoices) {
        failedInvoices.push({
          id,
          reason,
          error: `Login failed: ${loginError.message}`,
        });
      }
      return { successful: successfulInvoices, failed: failedInvoices };
    }

    // Setup dialog handler before processing invoices
    const dialogHandler = async (dialog) => {
      if (
        dialog.type() === "confirm" &&
        dialog.message() === "Are you sure ?"
      ) {
        await dialog.accept();
      }
    };

    // Process each invoice, continuing even if some fail
    for (const { id, reason } of invoices) {
      try {
        // Add dialog handler before processing each invoice
        page.on("dialog", dialogHandler);
        const result = await processInvoice(page, id, reason);
        // Remove dialog handler after processing
        page.off("dialog", dialogHandler);

        const currentUrl = page.url();
        // Only mark as success if 'Submitted return form' (i.e., result.success === true)
        // If redirected to storecustom, always mark as failed
        if (result.success === true) {
          successfulInvoices.push({
            id,
            reason,
            customerName: result.customerName || null,
            timestamp: result.timestamp || new Date().toISOString(),
          });
        } else if (
          result.error &&
          result.error.includes("Redirected to storecustom")
        ) {
          failedInvoices.push({ id, reason, error: result.error });
        } else {
          failedInvoices.push({ id, reason, error: result.error });
        }
      } catch (invoiceError) {
        // Ensure any unexpected errors are also captured
        console.error(
          `❌ Unexpected error processing invoice ${id}:`,
          invoiceError.message
        );
        failedInvoices.push({
          id,
          reason,
          error: `Unexpected error: ${invoiceError.message}`,
        });

        // Take a screenshot of the error state
        try {
          await page.screenshot({ path: `error-${id}-${Date.now()}.png` });
        } catch (screenshotError) {
          console.error(
            `Failed to take error screenshot for ${id}:`,
            screenshotError.message
          );
        }

        // Try to navigate back to a safe state for the next invoice
        try {
          await safeNavigate(page, "https://creationedgebd.com/sales");
        } catch (navigationError) {
          console.error(
            "Failed to navigate back to sales page:",
            navigationError.message
          );
        }
      }
    }

    // Print summary at the end
    console.log("\n=== Processing Summary ===");
    console.log(`Total Invoices: ${invoices.length}`);
    console.log(`Successful: ${successfulInvoices.length}`);
    console.log(`Failed: ${failedInvoices.length}`);

    const finalLog = {
      total: invoices.length,
      successful: successfulInvoices.length,
      failed: failedInvoices.length,
    };
    logAndEmit("Final Summary:", finalLog);

    // Save results to files
    //saveResults(successfulInvoices, failedInvoices)

    logAndEmit("Failed invoices:", failedInvoices);
    return { successfulInvoices, failedInvoices };
  } catch (err) {
    console.error("Fatal error:", err.message);

    // If a fatal error occurs, mark all remaining unprocessed invoices as failed
    const processedIds = [...successfulInvoices, ...failedInvoices].map(
      (inv) => inv.id
    );
    const unprocessedInvoices = invoices.filter(
      (inv) => !processedIds.includes(inv.id)
    );

    for (const { id, reason } of unprocessedInvoices) {
      failedInvoices.push({
        id,
        reason,
        error: `Fatal error: ${err.message}`,
      });
    }

    // Still save whatever results we have
    //saveResults(successfulInvoices, failedInvoices)

    return { successful: successfulInvoices, failed: failedInvoices };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("Error closing browser:", closeError.message);
      }
    }
  }
}

// API endpoint to process invoices
app.post("/api/process-invoices", async (req, res) => {
  try {
    const { invoices } = req.body;

    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res
        .status(400)
        .json({ message: "No invoices provided or invalid format" });
    }

    logAndEmit(`Received request to process ${invoices.length} invoices`);

    const results = await processInvoices(invoices);
    logAndEmit("Sending results to client:", results);
    res.json(results);
  } catch (error) {
    console.error("Error processing invoices:", error);
    res.status(500).json({
      message:
        error instanceof Error ? error.message : "An unknown error occurred",
      failed:
        req.body && req.body.invoices
          ? req.body.invoices.map(function (inv) {
              return Object.assign({}, inv, {
                error:
                  error instanceof Error
                    ? error.message
                    : "An unknown error occurred",
              });
            })
          : [],
    });
  }
});

// Add a simple health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Add a test endpoint that always returns errors
app.post("/api/test-errors", (req, res) => {
  const { invoices } = req.body;

  if (!invoices || !Array.isArray(invoices)) {
    return res.status(400).json({ message: "Invalid request format" });
  }

  const failed = invoices.map((inv) => ({
    ...inv,
    error: `Test error for invoice ${inv.id}`,
  }));

  res.json({
    successful: [],
    failed,
  });
});

// Serve the main HTML file for all routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.emit("welcome", {
    message: "Welcome to the Invoice Return Automation System!",
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

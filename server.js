const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");
const os = require("os");
const fs = require("fs");
const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const TIMEOUT = { navigation: 60000, element: 15000, action: 1200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getChromeExecutable() {
  const platform = os.platform();
  const candidates = {
    win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
    linux: ["/opt/google/chrome/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  };
  const list = candidates[platform] || [];
  for (const p of list) if (fs.existsSync(p)) return p;
  // fallback to puppeteer bundled chromium
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {}
  return null;
}

function saveResults(successful, failed) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const successPath = path.join(resultsDir, `successful-invoices-${timestamp}.json`);
  const failedPath = path.join(resultsDir, `failed-invoices-${timestamp}.json`);
  fs.writeFileSync(successPath, JSON.stringify(successful, null, 2));
  if (failed.length > 0) fs.writeFileSync(failedPath, JSON.stringify(failed, null, 2));
  console.log(`\nResults saved to:\n- ${successPath}`);
  if (failed.length > 0) console.log(`- ${failedPath}`);
  return { successPath, failedPath };
}

async function safeNavigate(page, url, timeout = TIMEOUT.navigation) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await Promise.race([page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {}), sleep(1500)]);
}

async function safeWaitForSelector(page, selector, timeout = TIMEOUT.element, opts = {}) {
  try {
    await page.waitForSelector(selector, { timeout, visible: opts.visible ?? true, ...opts });
  } catch (err) {
    throw new Error(`Selector "${selector}" not found: ${err.message}`);
  }
}

// Handles both native confirm() and SweetAlert2 (creationedgebd uses Swal)
async function handleSweetAlertIfPresent(page) {
  // SweetAlert2 confirm button
  const swalConfirm = await page.$(".swal2-confirm, .swal2-actions button.swal2-confirm, button.confirm");
  if (swalConfirm) {
    try {
      const visible = await page.evaluate((el) => {
        const c = el.closest(".swal2-popup, .sweet-alert");
        if (!c) return false;
        return window.getComputedStyle(c).display !== "none" && c.offsetParent !== null;
      }, swalConfirm).catch(() => false);
      if (visible) {
        await sleep(300);
        await swalConfirm.click().catch(() => {});
        await page.evaluate(() => {
          const btn = document.querySelector(".swal2-confirm");
          if (btn) btn.click();
        }).catch(() => {});
        await sleep(700);
        return true;
      }
    } catch {}
  }
  // Also check generic "Are you sure" modal with Yes button
  const handled = await page.evaluate(() => {
    const popups = document.querySelectorAll(".swal2-popup, .sweet-alert, .modal.show");
    for (const p of popups) {
      if (p.innerText && p.innerText.toLowerCase().includes("are you sure")) {
        const btn = p.querySelector(".swal2-confirm, .confirm, .btn-primary, button.swal2-confirm");
        if (btn) { btn.click(); return true; }
      }
    }
    return false;
  }).catch(() => false);
  return handled;
}

async function robustClick(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: TIMEOUT.element });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
  }, selector);
  await sleep(350);

  // wait for overlay to clear
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const s = window.getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.disabled) return false;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      // allow if topEl is child of el (icon inside button) or el itself
      return topEl && (el.contains(topEl) || topEl === el || el.contains(topEl.closest?.("button") || topEl));
    },
    { timeout: 7000 },
    selector
  ).catch(() => console.warn(`⚠️ overlay check timeout ${selector}`));

  // Strategy A: native
  try {
    const el = await page.$(selector);
    if (el) {
      const box = await el.boundingBox().catch(() => null);
      if (box) { await el.click({ delay: 40 }); await handleSweetAlertIfPresent(page); return true; }
    }
  } catch (e) { console.log(`  ↳ native failed: ${e.message}`); }

  // Strategy B: JS dispatch + click
  try {
    const ok = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      btn.removeAttribute("disabled");
      btn.style.pointerEvents = "auto";
      for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) {
        btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
      btn.click();
      return true;
    }, selector);
    if (ok) { await sleep(250); await handleSweetAlertIfPresent(page); return true; }
  } catch (e) { console.log(`  ↳ JS failed: ${e.message}`); }

  // Strategy C: form submit
  try {
    const ok = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      const form = btn.closest("form");
      if (form) { form.requestSubmit ? form.requestSubmit(btn) : form.submit(); return true; }
      return false;
    }, selector);
    if (ok) { await handleSweetAlertIfPresent(page); return true; }
  } catch {}

  // Strategy D: coordinate click
  try { await page.click(selector); await handleSweetAlertIfPresent(page); return true; } catch (e) { throw new Error(`All clicks failed ${selector}: ${e.message}`); }
}

async function processInvoice(page, id, reason, attempt = 1) {
  const t0 = Date.now();
  try {
    console.log(`🔄 [${id}] Processing invoice${attempt > 1 ? ` (retry ${attempt})` : ""}`);
    if (id.toLowerCase().includes("test")) throw new Error("This is a test error to verify error handling");

    await safeNavigate(page, "https://creationedgebd.com/sales");
    await safeWaitForSelector(page, "#sale-table_filter input.form-control-sm");

    await page.evaluate(() => {
      const input = document.querySelector("#sale-table_filter input.form-control-sm");
      if (input) {
        input.focus();
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("keyup", { bubbles: true }));
        // also clear DataTables search via API if available
        if (window.$ && $.fn && $.fn.DataTable) {
          try { const dt = $("#sale-table").DataTable(); dt.search("").draw(); } catch {}
        }
      }
    });
    await page.type("#sale-table_filter input.form-control-sm", id, { delay: 25 });

    await page.waitForFunction(
      (invoiceId) => {
        const info = document.querySelector("#sale-table_info");
        const rows = document.querySelectorAll("#sale-table tbody tr");
        if (!info) return true;
        if (rows.length === 0) return false;
        const txt = document.querySelector("#sale-table tbody")?.innerText || "";
        return txt.includes(invoiceId) || info.textContent.includes("Showing 0 to 0");
      },
      { timeout: 10000, polling: 250 },
      id
    ).catch(() => sleep(TIMEOUT.action));
    await sleep(600);

    const invoiceExists = await page.evaluate(() => {
      const info = document.querySelector("#sale-table_info");
      if (!info) return false;
      if (info.textContent.includes("Showing 0 to 0 of 0")) return false;
      const rows = document.querySelectorAll("#sale-table tbody tr");
      if (rows.length === 0) return false;
      const first = rows[0]?.innerText || "";
      return !first.includes("No data") && !first.includes("No matching");
    });

    if (!invoiceExists) return { success: false, error: "Invoice not found in the system" };

    const expectedName = await page.$eval("#sale-table tbody tr td:nth-child(3)", (el) => el.textContent.trim()).catch(() => { throw new Error("Customer name not found"); });
    console.log(`🔍 [${id}] Expected name: ${expectedName}`);

    const hasDropdown = await page.evaluate(() => !!document.querySelector("#sale-table tbody tr .dropdown-toggle"));
    if (!hasDropdown) return { success: false, error: "Action dropdown not found - invoice may be in an invalid state" };

    await robustClick(page, "#sale-table tbody tr .dropdown-toggle");
    await page.waitForFunction(
      () => {
        const m = document.querySelector(".dropdown-menu");
        return m && window.getComputedStyle(m).display !== "none";
      },
      { timeout: 8000 }
    ).catch(() => sleep(500));

    const returnSel = '.dropdown-menu a[href*="/return-sale/invoice"]';
    const hasReturn = await page.evaluate((s) => !!document.querySelector(s), returnSel);
    if (!hasReturn) return { success: false, error: "Return option not available - invoice may already be returned or not eligible" };

    await page.waitForFunction(
      (s) => {
        const el = document.querySelector(s);
        return el && el.offsetParent !== null;
      },
      { timeout: 10000 },
      returnSel
    ).catch(() => sleep(500));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: TIMEOUT.navigation }).catch(() => sleep(2000)),
      page.evaluate((s) => document.querySelector(s)?.click(), returnSel),
    ]);
    console.log(`🚚 [${id}] Opened return form`);

    // Fix spinner race: wait for actual form
    await page.waitForFunction(() => !!document.querySelector('textarea[name="return_note"]') || !!document.querySelector("form.payment-form"), { timeout: 15000, polling: 400 }).catch(() => {});
    await safeWaitForSelector(page, 'textarea[name="return_note"]', 15000);

    await page.click('textarea[name="return_note"]', { clickCount: 3 }).catch(() => {});
    await page.evaluate(() => {
      const ta = document.querySelector('textarea[name="return_note"]');
      if (ta) { ta.value = ""; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    await page.type('textarea[name="return_note"]', reason, { delay: 15 });
    await sleep(350);

    const candidates = ['form.payment-form button[type="submit"].btn.btn-primary', 'form.payment-form button[type="submit"]', 'button[type="submit"].btn-primary'];
    let submitSelector = null;
    for (const s of candidates) if (await page.$(s)) { submitSelector = s; break; }
    if (!submitSelector) return { success: false, error: "Submit button not found - invoice may be in an invalid state" };
    console.log(`🔘 [${id}] Submit: ${submitSelector}`);

    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), submitSelector);
    await sleep(500);
    await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 7000 }, submitSelector).catch(() => {});

    try { await robustClick(page, submitSelector); }
    catch (e) { return { success: false, error: `Failed to click submit button: ${e.message}` }; }

    // After click, SweetAlert may appear - handle it
    await sleep(400);
    await handleSweetAlertIfPresent(page);

    // Wait for navigation / URL change / success toast
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
    const urlChange = page.waitForFunction(() => !location.href.includes("/return-sale/invoice"), { timeout: 25000 }).catch(() => null);
    await Promise.race([nav, urlChange, sleep(4500)]);
    await sleep(900);

    const curUrl = page.url();
    console.log(`✅ [${id}] Submitted, URL: ${curUrl} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
    if (curUrl.includes("/return-sale/storecustom")) return { success: false, error: "Redirected to storecustom - invoice may require special handling" };

    const toastErr = await page.evaluate(() => {
      const el = document.querySelector(".alert-danger, .toast-error, .swal2-html-container, .alert.alert-danger");
      return el ? el.innerText?.slice(0, 250).trim() : null;
    }).catch(() => null);
    if (toastErr && /error|failed|invalid|something went wrong/i.test(toastErr)) return { success: false, error: toastErr };

    // Success: look for success toast
    const toastOk = await page.evaluate(() => {
      const el = document.querySelector(".alert-success, .toast-success, .swal2-html-container");
      if (el && /success|returned|completed/i.test(el.innerText || "")) return el.innerText.slice(0, 200);
      return null;
    }).catch(() => null);
    if (toastOk) console.log(`🎉 [${id}] Success toast: ${toastOk}`);

    return { success: true, customerName: expectedName, timestamp: new Date().toISOString() };
  } catch (err) {
    // Retry once on transient click/navigation failures
    const retriable = /not clickable|not an Element|Timeout|navigation|detached/i.test(err.message);
    if (retriable && attempt < 2) {
      console.warn(`↻ [${id}] Retrying after error: ${err.message}`);
      await sleep(1200);
      try { await safeNavigate(page, "https://creationedgebd.com/sales"); } catch {}
      return processInvoice(page, id, reason, attempt + 1);
    }
    console.error(`❌ [${id}] Error: ${err.message}`);
    try {
      await page.screenshot({ path: path.join(__dirname, `error-${id}-${Date.now()}.png`), fullPage: false });
    } catch {}
    return { success: false, error: err.message };
  }
}

async function processInvoices(invoices) {
  let browser; let page;
  const ok = []; const fail = [];
  try {
    const exe = getChromeExecutable();
    if (!exe) {
      const msg = "Chrome/Chromium not found. Install google-chrome or chromium.";
      console.error(msg);
      for (const { id, reason } of invoices) fail.push({ id, reason, error: msg });
      return { successful: ok, failed: fail };
    }
    console.log(`Launching browser: ${exe}`);
    browser = await puppeteer.launch({
      executablePath: exe,
      headless: "new",
      defaultViewport: { width: 1366, height: 768 },
      protocolTimeout: 120000,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--disable-gpu", "--window-size=1366,768", "--disable-blink-features=AutomationControlled"],
    });
    page = await browser.newPage();
    await page.setDefaultNavigationTimeout(TIMEOUT.navigation);
    await page.setDefaultTimeout(TIMEOUT.element);
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (["image", "font", "media"].includes(t)) return req.abort();
      const u = req.url();
      if (u.includes("google-analytics") || u.includes("googletagmanager") || u.includes("facebook") || u.includes("hotjar")) return req.abort();
      return req.continue();
    });

    // login
    try {
      await safeNavigate(page, "https://creationedgebd.com/login");
      await safeWaitForSelector(page, "#login-username");
      await page.type("#login-username", "Raisul@gmail.com", { delay: 25 });
      await page.type("#login-password", "thisisatestpassword", { delay: 25 });
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: TIMEOUT.navigation }).catch(() => sleep(2500)), page.click('button[type="submit"]')]);
      await page.waitForFunction(() => !document.querySelector("#login-username") || !!document.querySelector(".main-sidebar, #sale-table, [href*='/logout']"), { timeout: 10000 }).catch(() => {});
      console.log("✅ Logged in");
    } catch (e) {
      console.error("❌ Login failed:", e.message);
      for (const { id, reason } of invoices) fail.push({ id, reason, error: `Login failed: ${e.message}` });
      return { successful: ok, failed: fail };
    }

    // global dialog handler
    page.on("dialog", async (d) => {
      try {
        const msg = d.message() || "";
        if (d.type() === "confirm" && msg.toLowerCase().includes("are you sure")) { await d.accept(); console.log(`🔔 Dialog: ${msg}`); }
        else await d.accept();
      } catch {}
    });

    const totalT0 = Date.now();
    for (const { id, reason } of invoices) {
      try {
        const r = await processInvoice(page, id, reason);
        if (r.success) ok.push({ id, reason, customerName: r.customerName || null, timestamp: r.timestamp || new Date().toISOString() });
        else fail.push({ id, reason, error: r.error });
      } catch (e) {
        fail.push({ id, reason, error: `Unexpected: ${e.message}` });
        try { await safeNavigate(page, "https://creationedgebd.com/sales"); } catch {}
      }
      await sleep(600);
      // log incremental progress
      console.log(`⏳ Progress: ${ok.length + fail.length}/${invoices.length} (✓${ok.length} ✗${fail.length})`);
    }
    console.log(`\n=== Processing Summary (${((Date.now()-totalT0)/1000).toFixed(1)}s) ===`);
    console.log(`Total: ${invoices.length}  Successful: ${ok.length}  Failed: ${fail.length}`);
    if (fail.length) console.log("Failed invoices:", fail);
    return { successfulInvoices: ok, failedInvoices: fail };
  } catch (err) {
    console.error("Fatal error:", err.message);
    const doneIds = new Set([...ok, ...fail].map((x) => x.id));
    for (const { id, reason } of invoices.filter((x) => !doneIds.has(x.id))) fail.push({ id, reason, error: `Fatal: ${err.message}` });
    return { successful: ok, failed: fail };
  } finally { if (browser) try { await browser.close(); } catch {} }
}

app.post("/api/process-invoices", async (req, res) => {
  try {
    const { invoices } = req.body;
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) return res.status(400).json({ message: "No invoices provided" });
    console.log(`Received request to process ${invoices.length} invoices`);
    const results = await processInvoices(invoices);
    console.log("Sending results to client:", results);
    res.json(results);
  } catch (e) {
    console.error("Error processing invoices:", e);
    res.status(500).json({ message: e instanceof Error ? e.message : "Unknown error", failed: (req.body?.invoices || []).map((inv) => ({ ...inv, error: e.message })) });
  }
});
app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.post("/api/test-errors", (req, res) => {
  const { invoices } = req.body;
  if (!invoices || !Array.isArray(invoices)) return res.status(400).json({ message: "Invalid request format" });
  res.json({ successful: [], failed: invoices.map((inv) => ({ ...inv, error: `Test error for invoice ${inv.id}` })) });
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}\nOpen http://localhost:${PORT}`));
process.on("SIGTERM", () => { console.log("SIGTERM, closing..."); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { console.log("SIGINT, closing..."); server.close(() => process.exit(0)); });

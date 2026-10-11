// Browser acceptance test: drives the real UI against a running server.
//   BASE_URL=http://localhost:3100 OUT=./test-results node tests/e2e/acceptance.mjs
// Uses fresh random accounts, so it can run repeatedly against any database.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(execSync("npm root -g").toString().trim() + "/playwright"); }

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT || "./test-results";
mkdirSync(OUT, { recursive: true });
const run = Math.random().toString(36).slice(2, 7);
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 400) });
    console.log(`✗ ${name}\n   ${String(e?.message ?? e).slice(0, 400)}`);
    throw e;
  }
};

const browser = await pw.chromium.launch();
const problems = [];
async function newUserPage(viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return page;
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const text = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.locator("main h1").first().waitFor();
  return (await page.locator("main").innerText()).replace(/\s+/g, " ").replace(/ \? /g, " ");
};
const toast = async (page, re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 15000 });
const dialog = (page) => page.locator("dialog[open]");

async function signUp(page, name, email) {
  await page.goto(BASE + "/signup");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", "Acceptance-test-2026");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
}
async function onboard(page, businessName) {
  await page.fill("#name", businessName);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
}

let invoiceUrl, customerUrl, ownerPage;
try {
  const page = (ownerPage = await newUserPage());

  await step("Onboarding: sign up and create a business", async () => {
    await signUp(page, "Acceptance Owner", `owner-${run}@acceptance.example`);
    await onboard(page, `Acceptance Traders ${run}`);
    assert.match(await text(page), /Nothing outstanding yet/);
  });

  await step("Scenario 1: create customer and ₹50,000 invoice due in 30 days", async () => {
    await page.goto(BASE + "/customers/new");
    await page.fill("#name", `Test Customer ${run} (fictional)`);
    await page.fill("#phone", "+91 90000 99999");
    await page.fill("#customerCreditDays", "30");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    customerUrl = page.url();
    await page.goto(BASE + "/receivables/new");
    await page.selectOption("#counterpartyId", { label: `Test Customer ${run} (fictional)` });
    await page.fill("#invoiceNumber", `INV-${run}`);
    await page.fill("#invoiceDate", today);
    await page.fill("#totalAmount", "50000");
    assert.match(await page.locator("main form").innerText(), /\(30 days\)/);
    await page.click("button:has-text('Save invoice')");
    await page.waitForURL(/\/receivables\/[0-9a-f-]{36}$/);
    invoiceUrl = page.url();
    const t = await text(page);
    assert.match(t, /Outstanding ₹50,000\.00/);
    const due = addDays(today, 30).split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    assert.ok(t.includes(`${due[2]} ${months[+due[1] - 1]} ${due[0]}`), "due date = invoice date + 30");
    assert.match(t, /Reminder schedule/);
    assert.match(t, /Receivable due soon/); // scheduled reminders exist
    await page.goto(BASE + "/receivables");
    assert.match(await text(page), new RegExp(`INV-${run}`));
    await page.goto(BASE + "/dashboard");
    assert.match(await text(page), /Receivables outstanding ₹50,000\.00/);
    await page.goto(customerUrl);
    assert.match(await text(page), /Total outstanding ₹50,000\.00/);
  });

  await step("Scenario 2: record ₹20,000 partial payment", async () => {
    await page.goto(invoiceUrl);
    await page.click("a:has-text('Record payment')");
    await page.waitForURL(/\/payments\/new/);
    await page.fill("#amount", "20000");
    await page.locator('input[name^="alloc_"]').first().waitFor();
    await page.locator('input[name^="alloc_"]').first().fill("20000");
    await page.fill("#reference", `UTR-${run}-1`);
    await page.click("button:has-text('Record payment')");
    await page.waitForURL(invoiceUrl);
    const t = await text(page);
    assert.match(t, /Outstanding ₹30,000\.00/);
    assert.match(t, /Partially paid/);
    assert.match(t, new RegExp(`UTR-${run}-1`));
    await page.goto(customerUrl);
    assert.match(await text(page), /Total outstanding ₹30,000\.00/);
  });

  await step("Scenario 3: due date moved into the past → overdue; record a call", async () => {
    await page.goto(invoiceUrl + "/edit");
    await page.fill("#invoiceDate", addDays(today, -45));
    await page.fill("#dueDate", addDays(today, -15));
    await page.fill("#changeReason", "Acceptance test: original terms were 30 days from an earlier date");
    await page.click("button:has-text('Save changes')");
    await page.waitForURL(invoiceUrl);
    let t = await text(page);
    assert.match(t, /Overdue/);
    assert.match(t, /15d overdue/);
    await page.goto(BASE + "/receivables?bucket=d1_30");
    assert.match(await text(page), new RegExp(`INV-${run}`));
    await page.goto(BASE + "/dashboard");
    t = await text(page);
    assert.match(t, /Overdue receivables ₹30,000\.00/);
    // Reminder processor creates the first-contact task.
    await page.goto(BASE + "/settings/reminders");
    await page.click("button:has-text('Run reminder processor now')");
    await toast(page, /Reminder run complete/);
    await page.goto(BASE + "/follow-ups?tab=tasks");
    assert.match(await text(page), new RegExp(`First contact: INV-${run} is overdue`));
    await page.goto(BASE + "/follow-ups");
    assert.match(await text(page), /Never contacted/);
    // Record the call from the invoice page.
    await page.goto(invoiceUrl);
    await page.locator("main").getByRole("button", { name: "Record call" }).first().click();
    await dialog(page).locator("#outcome").selectOption("no_answer");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await toast(page, /Contact recorded/);
    await page.reload();
    assert.match(await text(page), /No answer/);
  });

  await step("Scenario 6a: promise ₹15,000 for a future date appears in the queue", async () => {
    await page.goto(invoiceUrl);
    await page.locator("main").getByRole("button", { name: "Log promise to pay" }).first().click();
    await dialog(page).locator("#amount").fill("15000");
    await dialog(page).locator("#promisedDate").fill(addDays(today, 3));
    await dialog(page).getByRole("button", { name: "Record promise" }).click();
    await toast(page, /Promise recorded/);
    await page.reload();
    assert.match(await text(page), /Upcoming/);
    await page.goto(BASE + "/follow-ups?tab=promises");
    assert.match(await text(page), new RegExp(`Test Customer ${run}`));
    await page.goto(BASE + "/follow-ups?tab=tasks");
    assert.match(await text(page), /Confirm promised payment of ₹15,000\.00/);
  });

  await step("Scenario 4: pay remaining ₹30,000 → settled, reminders cancelled, history kept", async () => {
    await page.goto(BASE + "/payments/new?direction=received");
    await page.selectOption("#counterpartyId", { label: `Test Customer ${run} (fictional)` });
    await page.fill("#amount", "30000");
    await page.locator('input[name^="alloc_"]').first().waitFor();
    await page.click("button:has-text('Allocate oldest first')");
    await page.selectOption("#method", "Cheque");
    await page.fill("#reference", `CHQ-${run}`);
    await page.click("button:has-text('Record payment')");
    await page.waitForURL(/\/payments\/[0-9a-f-]{36}$/);
    await page.goto(invoiceUrl);
    const t = await text(page);
    assert.match(t, /Outstanding ₹0\.00/);
    assert.match(t, /Paid/);
    assert.match(t, /after due date/);
    assert.ok(!/ pending /.test(t.split("Reminder schedule")[1].split("Audit history")[0]), "no pending reminders remain");
    assert.match(t, new RegExp(`UTR-${run}-1`));
    assert.match(t, new RegExp(`CHQ-${run}`));
    assert.match(t, /Due date changed/);
    await page.goto(BASE + "/dashboard");
    assert.match(await text(page), /Overdue receivables ₹0\.00/);
  });

  await step("Scenario 5: ₹80,000 supplier bill, ₹30,000 paid, payment planned separately", async () => {
    await page.goto(BASE + "/suppliers/new");
    await page.fill("#name", `Test Supplier ${run} (fictional)`);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/suppliers\/[0-9a-f-]{36}$/);
    const supplierUrl = page.url();
    await page.goto(BASE + "/payables/new");
    await page.selectOption("#counterpartyId", { label: `Test Supplier ${run} (fictional)` });
    await page.fill("#invoiceNumber", `SB-${run}`);
    await page.fill("#totalAmount", "80000");
    await page.selectOption("#priority", "high");
    await page.click("button:has-text('Save bill')");
    await page.waitForURL(/\/payables\/[0-9a-f-]{36}$/);
    const billUrl = page.url();
    await page.locator("main").getByRole("button", { name: "Schedule payment" }).click();
    await dialog(page).locator("#amount").fill("50000");
    await dialog(page).locator("#plannedDate").fill(addDays(today, 5));
    await dialog(page).getByRole("button", { name: "Plan payment" }).click();
    await toast(page, /Payment planned/);
    await page.reload();
    assert.match(await text(page), /Outstanding ₹80,000\.00/); // a plan is not a payment
    await page.click("a:has-text('Record payment')");
    await page.waitForURL(/\/payments\/new/);
    await page.fill("#amount", "30000");
    await page.locator('input[name^="alloc_"]').first().waitFor();
    await page.locator('input[name^="alloc_"]').first().fill("30000");
    await page.click("button:has-text('Record payment')");
    await page.waitForURL(billUrl);
    assert.match(await text(page), /Outstanding ₹50,000\.00/);
    await page.goto(supplierUrl);
    assert.match(await text(page), /Total payable ₹50,000\.00/);
    await page.goto(BASE + "/reports/supplier-obligations");
    assert.match(await text(page), new RegExp(`Test Supplier ${run}`));
    await page.goto(BASE + "/reports/payables-ageing");
    assert.match(await text(page), new RegExp(`SB-${run}`));
  });

  await step("Scenario 9: CSV import with valid, invalid and duplicate rows", async () => {
    const csv = [
      "party,invoice_number,invoice_date,due_date,total_amount",
      `Test Customer ${run} (fictional),IMP-${run}-1,01/09/2026,01/10/2026,12000`,
      `Test Customer ${run} (fictional),IMP-${run}-2,2026-09-02,,8000.50`,
      `Test Customer ${run} (fictional),IMP-${run}-1,01/09/2026,01/10/2026,12000`,
      `Nobody ${run},IMP-${run}-3,01/09/2026,,500`,
      `Test Customer ${run} (fictional),IMP-${run}-4,31/02/2026,,500`,
      `Test Customer ${run} (fictional),INV-${run},01/09/2026,,500`,
    ].join("\n");
    const file = `${OUT}/import-${run}.csv`;
    writeFileSync(file, csv);
    await page.goto(BASE + "/imports");
    await page.selectOption("select", "receivables");
    await page.setInputFiles('input[type=file]', file);
    await page.locator("text=ready").first().waitFor({ timeout: 20000 });
    const t = await text(page);
    assert.match(t, /2 ready · 2 with errors/);
    assert.match(t, /not found/);
    assert.match(t, /not a valid date/);
    assert.match(t, /already exists/);
    await page.click("button:has-text('Import 2 rows')");
    await page.locator("text=Import finished").waitFor();
    const s = await text(page);
    assert.match(s, /Rows in file 6 Created 2 Skipped \(duplicates \/ by you\) 2 Failed \(see history below\) 2/);
    await page.goto(BASE + "/receivables");
    assert.match(await text(page), new RegExp(`IMP-${run}-2`));
  });

  await step("Scenario 8: a second business cannot reach the first one's records", async () => {
    const other = await newUserPage();
    await signUp(other, "Other Owner", `other-${run}@acceptance.example`);
    await onboard(other, `Other Business ${run}`);
    // Pages stream behind a loading skeleton, so Next.js may answer 200 before
    // notFound() renders; what matters is that nothing of the record is served.
    for (const url of [invoiceUrl, customerUrl, invoiceUrl + "/edit"]) {
      const res = await other.goto(url, { waitUntil: "networkidle" });
      const html = await res.text();
      assert.ok(!html.includes(`INV-${run}`) && !html.includes(`Test Customer ${run}`), `leak on ${url}`);
      assert.match(await other.locator("body").innerText(), /Not found/);
    }
    const csv = await other.request.get(BASE + "/api/export/receivables");
    const body = await csv.text();
    assert.ok(!body.includes(`INV-${run}`), "export must not include the other business's invoices");
    await other.goto(BASE + "/search?q=" + encodeURIComponent(`INV-${run}`));
    assert.match(await text(other), /Nothing found/);
    const doc = await other.request.get(BASE + "/api/documents/00000000-0000-4000-8000-000000000000?exp=9999999999&sig=x");
    assert.equal(doc.status(), 403);
    await other.context().close();
  });

  await step("Scenario 10: core screens on a phone-sized viewport", async () => {
    const m = await newUserPage({ width: 390, height: 844 });
    await m.goto(BASE + "/login");
    await m.fill("#email", `owner-${run}@acceptance.example`);
    await m.fill("#password", "Acceptance-test-2026");
    await m.click("button[type=submit]");
    await m.waitForURL("**/dashboard");
    for (const p of ["/dashboard", "/receivables", "/follow-ups", invoiceUrl.replace(BASE, ""), "/payments/new?direction=received"]) {
      await m.goto(BASE + p, { waitUntil: "networkidle" });
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `page ${p} overflows horizontally by ${overflow}px`);
      await m.screenshot({ path: `${OUT}/mobile_${p.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true });
    }
    await m.goto(BASE + "/dashboard");
    await m.getByRole("button", { name: "Open navigation" }).click();
    await m.locator("#sidebar a:has-text('Receivables')").click();
    await m.waitForURL("**/receivables");
    await m.context().close();
  });

  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/acceptance_dashboard.png`, fullPage: true });
} catch {
  // reported below
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(`${OUT}/acceptance-results.json`, JSON.stringify({ results, problems }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} steps passed${problems.length ? `; ${problems.length} browser problems:\n${problems.join("\n")}` : "; no browser errors"}`);
  process.exit(failed.length || problems.length ? 1 : 0);
}

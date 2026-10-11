// Visits every major page as a signed-in user and reports errors. Usage:
//   node tests/e2e/sweep.mjs <baseUrl> <email> <password> <outDir> [mobile]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(execSync("npm root -g").toString().trim() + "/playwright"); }
const [base, email, password, out, mobile] = process.argv.slice(2);
const browser = await pw.chromium.launch();
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console ${page.url()}: ${m.text().slice(0, 200)}`); });
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(base + "/login");
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard", { timeout: 30000 });
const paths = process.env.PATHS ? process.env.PATHS.split(",") : ["/dashboard", "/receivables", "/payables", "/customers", "/suppliers", "/follow-ups", "/follow-ups?tab=tasks", "/follow-ups?tab=promises", "/follow-ups?tab=disputes", "/payments", "/reports", "/reports/receivables-ageing", "/reports/payables-ageing", "/reports/customer-outstanding", "/reports/supplier-obligations", "/reports/collections", "/reports/productivity", "/reports/cash-flow", "/imports", "/notifications", "/settings", "/settings/members", "/settings/reminders", "/settings/financial", "/settings/integrations", "/settings/audit", "/settings/data", "/search?q=INV", "/receivables/new", "/payables/new", "/payments/new?direction=received", "/customers/new"];
for (const p of paths) {
  const res = await page.goto(base + p, { waitUntil: "networkidle" });
  const errText = await page.locator("text=This page could not be loaded").count();
  if (res && res.status() >= 400) problems.push(`status ${res.status()} ${p}`);
  if (errText) problems.push(`error boundary on ${p}`);
  const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
  await page.screenshot({ path: `${out}/${mobile ? "m_" : ""}${name}.png`, fullPage: true });
}
// Detail pages: first link of each kind
for (const [list, sel] of [["/receivables", 'a[href^="/receivables/"]'], ["/payables", 'a[href^="/payables/"]'], ["/customers", 'a[href^="/customers/"]'], ["/suppliers", 'a[href^="/suppliers/"]'], ["/payments", 'a[href^="/payments/"]']]) {
  await page.goto(base + list, { waitUntil: "networkidle" });
  const hrefs = await page.$$eval(sel, (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && !h.endsWith("/new") && !/\/(new|edit)$/.test(h)));
  const target = hrefs.find((h) => /\/[0-9a-f-]{36}$/.test(h));
  if (!target) { problems.push(`no detail link on ${list}`); continue; }
  const res = await page.goto(base + target, { waitUntil: "networkidle" });
  if (res && res.status() >= 400) problems.push(`status ${res.status()} ${target}`);
  if (await page.locator("text=This page could not be loaded").count()) problems.push(`error boundary on ${target}`);
  await page.screenshot({ path: `${out}/${mobile ? "m_" : ""}detail_${list.slice(1)}.png`, fullPage: true });
  if (list === "/customers") {
    await page.goto(base + target + "/statement", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${out}/${mobile ? "m_" : ""}statement.png`, fullPage: true });
  }
}
console.log(problems.length ? problems.join("\n") : "NO PROBLEMS");
await browser.close();

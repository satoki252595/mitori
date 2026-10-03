// Opening an export the way a recipient does: a `file://` page in the installed Chrome, the network cut, every attempt to
// reach it recorded (there must be none), console errors and CSP violations collected.
import type { BrowserContext, Page } from "@playwright/test";

export interface Watch {
  /** http(s)/ws(s) requests the page tried (any is a failure of the export). */
  network: string[];
  consoleErrors: string[];
  /** `securitypolicyviolation` events (the CSP doing its job against what the test injects). */
  violations: string[];
  /** Calls of fetch / XHR / WebSocket / EventSource / sendBeacon made by page code. */
  apiCalls: string[];
}

const INIT = `
  window.__violations = [];
  window.__apiCalls = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(e.violatedDirective + " " + (e.blockedURI || "inline")));
  const wrap = (obj, name, label) => { const o = obj && obj[name]; if (typeof o !== "function") return; obj[name] = function (...a) { window.__apiCalls.push(label + " " + String(a[0])); return o.apply(this, a); }; };
  wrap(window, "fetch", "fetch");
  wrap(XMLHttpRequest.prototype, "open", "xhr");
  wrap(navigator, "sendBeacon", "beacon");
  for (const C of ["WebSocket", "EventSource"]) { const O = window[C]; if (!O) continue; window[C] = function (...a) { window.__apiCalls.push(C + " " + String(a[0])); return new O(...a); }; }
`;

export async function openExport(context: BrowserContext, file: string, hash = ""): Promise<{ page: Page; watch: Watch }> {
  await context.setOffline(true);
  const page = await context.newPage();
  const watch: Watch = { network: [], consoleErrors: [], violations: [], apiCalls: [] };
  await context.addInitScript(INIT);
  page.on("request", (r) => {
    if (/^(?:https?|wss?|ftp):/i.test(r.url())) watch.network.push(r.url());
  });
  page.on("console", (m) => m.type() === "error" && watch.consoleErrors.push(m.text()));
  page.on("pageerror", (e) => watch.consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`file://${file}${hash}`);
  await page.waitForSelector(".blk, .map-main", { timeout: 15_000 });
  return { page, watch };
}

/** Violations and API calls the page recorded so far (they live in the page). */
export async function collect(page: Page, watch: Watch): Promise<Watch> {
  const v = await page.evaluate(() => ({
    violations: (window as unknown as { __violations: string[] }).__violations,
    apiCalls: (window as unknown as { __apiCalls: string[] }).__apiCalls,
  }));
  return { ...watch, violations: v.violations, apiCalls: v.apiCalls };
}

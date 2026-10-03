// The harness checks itself against the walking-skeleton daemon (M0.5): daemon start, nonce-less login, DOM / code-line /
// request / CLS probes, INP, initial JS bytes and the IME helper through the real Playwright runner (Node). Feature specs
// follow the same pattern (as `*.spec.ts`). Tag: @harness (not part of @pr).
import { ime, servedBytes, ui } from "@mitori/testkit";
import { expect, expectWithinBudget, test } from "./fixtures.ts";
import { initialJs, inpSummary, markLatencies, trackRequests } from "./metrics.ts";
import { withPerfTrace } from "./trace.ts";

test.describe("@harness e2e harness on the skeleton daemon", () => {
  test.use({ daemonOptions: { fixture: "ts-small" } });

  test("the daemon serves the shell; DOM, code-line, request and CLS probes read it", async ({ page, mitori }) => {
    const requests = trackRequests(page);
    await mitori.login(page, "/");
    await expect(page.locator("#app")).toBeAttached();
    await page.waitForLoadState("load");

    const nodes = await ui.domNodes(page);
    expect(nodes).toBeGreaterThan(3);
    expectWithinBudget("ui.dom.typical", nodes);
    expect(await ui.mountedCodeLines(page)).toBe(0);
    expectWithinBudget("ui.codeLines.mounted", await ui.mountedCodeLines(page));
    expect(requests.count).toBeGreaterThanOrEqual(3); // document + script + stylesheet
    expect(requests.matching(/\.js$/).length).toBeGreaterThanOrEqual(1);
    expectWithinBudget("ui.cls.boot", await ui.cls(page));
    expect(await ui.marks(page)).toEqual(expect.any(Array));
    requests.reset();
    expect(requests.count).toBe(0);
    requests.stop();
  });

  test("health and the CLI answer against the same MITORI_HOME", async ({ mitori }) => {
    const health = (await (await fetch(`${mitori.url}/api/v1/health`)).json()) as { ok: boolean; build: string };
    expect(health.ok).toBe(true);
    const r = await mitori.cli(["--version"]);
    expect(r).toMatchObject({ code: 0 });
    expect(r.stdout).toContain("mitori");
    expect(mitori.home.dir).toContain("mitori-home-");
    expect(mitori.repo?.git).toBe(true);
  });

  test("initial JS bytes are the compressed response bodies the browser actually received", async ({ page, mitori, browserName }) => {
    const found = await initialJs(page, `${mitori.url}/`);
    expect(found.files.length).toBeGreaterThanOrEqual(1);
    expect(found.bytes).toBeGreaterThan(1000);
    // Chromium accepts br and the daemon prefers it; WebKit asks for gzip: the same numbers servedBytes reports
    const paths = found.files.map((f) => new URL(f.url).pathname);
    const served = await servedBytes(mitori.url, paths, browserName === "chromium" ? "br" : "gzip");
    expect(found.bytes).toBe(served.reduce((s, f) => s + f.bytes, 0));
    expectWithinBudget("asset.js.initial.gz", found.bytes / 1000);
  });

  test("INP: slow interactions are grouped per interaction and summarised as p75 / p98", async ({ page, mitori, browserName }) => {
    test.skip(browserName !== "chromium", "Event Timing interactionId is Chromium-only (perf runs on Chromium)");
    await mitori.login(page, "/");
    // evaluate, not setContent: the daemon's CSP forbids inline scripts in its documents (evaluate runs through CDP)
    await page.evaluate(`document.body.innerHTML = '<button id="b">go</button>';
      document.getElementById("b").onclick = (event) => { const e = performance.now() + 120; while (performance.now() < e); performance.mark("mitori:test:done", { detail: { trigger: event.timeStamp } }); };`);
    for (let i = 0; i < 3; i++) await page.click("#b");
    await page.waitForTimeout(300);
    const found = await ui.interactions(page);
    const inp = inpSummary(found, 4); // the scenario performed 4 interactions; the 4th was fast and below the reporting floor
    expect(inp.count).toBe(4);
    expect(inp.reported).toBeGreaterThanOrEqual(3);
    expect(inp.p98).toBeGreaterThanOrEqual(100);
    const latencies = await markLatencies(page, "mitori:test:done");
    expect(latencies).toHaveLength(3);
    for (const ms of latencies) expect(ms).toBeGreaterThanOrEqual(100);
  });

  test("a perf trace keeps the long task and the forced reflow of a scenario, summarised", async ({ page, mitori, browser, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome tracing is Chromium-only");
    await mitori.login(page, "/");
    process.env.MITORI_PERF_TRACE = "1";
    try {
      await withPerfTrace(browser, page, testInfo, async () => {
        await page.evaluate(`(() => {
          const end = performance.now() + 150; while (performance.now() < end);
          document.body.style.width = "1px"; document.body.offsetWidth; document.body.style.width = "2px"; document.body.offsetWidth;
        })()`);
      });
    } finally {
      delete process.env.MITORI_PERF_TRACE;
    }
    const summary = testInfo.attachments.find((a) => a.name === "perf-trace-summary");
    expect(testInfo.attachments.some((a) => a.name === "perf-trace")).toBe(true);
    const parsed = JSON.parse(summary?.body?.toString() ?? "{}") as { longTasks: { durMs: number }[]; forcedReflows: { durMs: number }[] };
    expect(parsed.longTasks[0]?.durMs).toBeGreaterThanOrEqual(100);
    expect(parsed.forcedReflows.length).toBeGreaterThanOrEqual(1);
  });

  test("IME composition reaches the page in Chromium order", async ({ page, mitori, browserName }) => {
    test.skip(browserName !== "chromium", "CDP composition is Chromium-only; WebKit uses order: webkit");
    await mitori.login(page, "/");
    await page.evaluate(`document.body.innerHTML = '<textarea id="t"></textarea>';
      window.log = [];
      const t = document.getElementById("t");
      t.addEventListener("keydown", (e) => { if (e.isComposing || e.keyCode === 229) log.push("ime-keydown"); else if (e.key === "Enter") log.push("ENTER-SUBMIT"); });
      t.addEventListener("compositionend", (e) => log.push("end:" + e.data));`);
    await page.focus("#t");
    await ime.compose(page, "かんじ", "漢字", { order: "chromium" });
    expect(await page.inputValue("#t")).toBe("漢字");
    const log = await page.evaluate<string[]>("window.log");
    expect(log).toContain("end:漢字");
    expect(log).not.toContain("ENTER-SUBMIT"); // an Enter that confirms a conversion is not a submit
  });
});

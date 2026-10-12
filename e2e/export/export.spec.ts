// @export — WP-13 acceptance (MILESTONES): the self-contained HTML export, opened the way a recipient opens it. Real
// daemon process, real CLI (`mitori export --html`), real Chrome (`MITORI_E2E_CHANNEL`, default the installed Google
// Chrome), network cut, file:// origin. Inputs:
//   crit, m3e-canvas  the committed dogfood docs (docs/progress/dogfood) on their corpus checkouts — real size and real code;
//                     skipped with a note when `scripts/fetch-corpus.ts` was not run
//   rich              a doc written through the real doc store that has what the dogfood docs lost with their sidecar:
//                     depths L0–L3, a why box, a pitfall, a glossary, every verdict, IR diagrams (support/build-rich.ts)
//   secrets           the `secrets` fixture, its source and its doc full of planted secrets and `</script>`
//   MITORI_E2E_CHANNEL=chrome scripts/nd bun run e2e --grep @export
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { expect, type Page, test, webkit } from "@playwright/test";
import { checkBudget, envFactor } from "../harness/metrics.ts";
import { type BuiltExport, buildCase } from "./support/build-exports.ts";
import { collect, openExport } from "./support/page.ts";
import { PLANTED } from "./support/prepare.ts";

test.use({ channel: (process.env.MITORI_E2E_CHANNEL as "chrome" | undefined) ?? "chrome", locale: "ja-JP", viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const built: Record<string, BuiltExport | null> = {};
const OUT = `${process.cwd()}/test-results/export-e2e`;
const RICH = `${OUT}/rich.html`;

test.beforeAll(async () => {
  test.setTimeout(500_000);
  mkdirSync(OUT, { recursive: true });
  // the daemon embeds the web dist AND the viewer bundle from dist/.build: always test the viewer of the working tree (≈ 3 s)
  execFileSync("bun", ["scripts/gen-assets.ts"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("bun", ["e2e/export/support/build-rich.ts", OUT], { cwd: process.cwd(), stdio: "pipe" });
  for (const name of ["crit", "m3e-canvas", "secrets"]) built[name] = await buildCase(name, OUT);
});

const need = (name: string): BuiltExport => {
  const b = built[name];
  test.skip(!b, `${name}: corpus not fetched (scripts/nd bun run corpus:fetch --only ${name})`);
  return b as BuiltExport;
};

/**
 * Nothing the reader sees is cut at the window's edge (`html` clips sideways overflow and `.sec` bleeds 64 px of empty
 * padding past the prose column, so `scrollWidth` alone says nothing): every block, heading, figure and table fits.
 */
const noSideScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const boxes = [...document.querySelectorAll(".blk, .sec-head, figure, .dg-box, table, .pager, .hdr, .vband")];
    return (
      boxes.length > 0 &&
      boxes.every((e) => {
        const r = e.getBoundingClientRect();
        return r.width === 0 || (r.left >= -1 && r.right <= w + 1);
      })
    );
  });

/** The inline viewer script of an export (the last `<script>`), as the browser hashes and runs it. */
const viewerScript = (html: string): string => /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(html)?.[1] ?? "";

/** The export payload's JSON, decoded the way the viewer decodes it (plain JSON or gzip+base64). */
const payloadJson = (html: string): string => {
  const m = /<script type="application\/json" id="mitori-export"([^>]*)>([\s\S]*?)<\/script>/.exec(html);
  const body = m?.[2] ?? "null";
  return (m?.[1] ?? "").includes('data-encoding="gzip+base64"') ? gunzipSync(Buffer.from(body, "base64")).toString("utf8") : body;
};

test.describe("@export opening", () => {
  test("@export crit opens offline: no network attempt, no API call, no console error; viewer JS ≤ 60 KB gz; CSP in place", async ({ context }, info) => {
    const b = need("crit");
    const html = readFileSync(b.file, "utf8");
    const js = viewerScript(html);
    const gz = gzipSync(js, { level: 9 }).length;
    info.annotations.push({ type: "viewer-js-gz", description: `${gz} B (${js.length} B raw)` });
    expect(js.length).toBeGreaterThan(50_000);
    expect(gz, "viewer JS gzip bytes").toBeLessThanOrEqual(60_000);
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;sha256-[A-Za-z0-9+/=]+&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">/,
    );

    const t0 = Date.now();
    const { page, watch } = await openExport(context, b.file);
    const ms = Date.now() - t0;
    info.annotations.push({ type: "open-ms", description: `${ms} ms (${(statSync(b.file).size / 1e6).toFixed(2)} MB, ${b.excerpts} excerpts)` });
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator(".vband")).toContainText("読み取り専用の書き出し");
    const w = await collect(page, watch);
    expect(w.network, "requests that left the file").toEqual([]);
    expect(w.apiCalls, "fetch / XHR / WebSocket / EventSource / beacon").toEqual([]);
    expect(w.consoleErrors).toEqual([]);
    expect(w.violations, "the CSP was not violated by the viewer itself").toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll("script").length)).toBe(2);
    expect(await page.locator(".blk").count()).toBeGreaterThan(1);
    await page.close();
  });

  test("@export LCP of the shared file (ui.lcp.export.local / ui.lcp.export): local and with a 4× CPU throttle", async ({ browser }, info) => {
    const b = need("crit");
    const lcp = async (cpu: number): Promise<number> => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP" });
      const page = await ctx.newPage();
      await ctx.addInitScript(() => {
        const w = window as unknown as { __lcp: number };
        w.__lcp = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      if (cpu > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.goto(`file://${b.file}`);
      await page.waitForSelector(".blk");
      await page.waitForTimeout(800);
      const v = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
      await ctx.close();
      return v;
    };
    const median = (xs: number[]) => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)] as number;
    const local = median([await lcp(1), await lcp(1), await lcp(1)]);
    const slow = median([await lcp(4), await lcp(4), await lcp(4)]);
    info.annotations.push({
      type: "lcp",
      description: `local ${local.toFixed(0)} ms · 4× CPU ${slow.toFixed(0)} ms · ${(statSync(b.file).size / 1e6).toFixed(2)} MB`,
    });
    for (const [id, value] of [
      ["ui.lcp.export.local", local],
      ["ui.lcp.export", slow],
    ] as const) {
      // time budgets gate on the reference machine in the perf project; elsewhere they are reported (testing spec §5.2)
      const check = checkBudget(id, value, { project: info.project.name, factor: envFactor() });
      if (check.warned)
        info.annotations.push({ type: "budget-warning", description: `${id} = ${value.toFixed(0)} ms over its target ${check.target} (limit ${check.limit})` });
      expect(check.failed, `${id} = ${value.toFixed(0)} ms exceeds its limit ${check.limit}`).toBe(false);
    }
    // never absurd, on any machine
    expect(local).toBeLessThan(3000);
  });

  test("@export the CSP blocks what a page should never do: an injected script, an external image", async ({ context }) => {
    const { page, watch } = await openExport(context, RICH);
    const blocked: string[] = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.loadingFailed", (e) => blocked.push(`${e.blockedReason ?? ""} ${e.errorText}`));
    const injected = await page.evaluate(async () => {
      const w = window as unknown as { __x?: number };
      const s = document.createElement("script");
      s.textContent = "window.__x = 1";
      document.head.appendChild(s);
      const img = new Image();
      img.src = "https://example.com/pixel.png";
      await new Promise((res) => setTimeout(res, 100));
      return w.__x ?? null;
    });
    expect(injected).toBeNull();
    const w = await collect(page, watch);
    expect(w.violations.some((v) => v.startsWith("script-src"))).toBe(true);
    expect(w.violations.some((v) => v.startsWith("img-src"))).toBe(true);
    expect(blocked.some((x) => /csp|BLOCKED_BY_CSP/i.test(x))).toBe(true);
    await page.close();
  });

  test("@export a link or image to the outside in the content stays a link: no <img>, no request, rel=noopener", async ({ context }) => {
    const b = need("secrets");
    const { page, watch } = await openExport(context, b.file, "#/s1");
    await expect(page.locator(".blk").first()).toBeVisible();
    expect(await page.locator("main img").count()).toBe(0);
    const ext = page.locator('main a[href^="https://example.com"]');
    expect(await ext.count()).toBeGreaterThanOrEqual(1);
    expect(await ext.first().getAttribute("rel")).toContain("noopener");
    expect((await collect(page, watch)).network).toEqual([]);
    await page.close();
  });

  test("@export Safari's engine (WebKit): the reader, a level switch, a cite peek and the map work; nothing leaves the file; the CSP holds", async () => {
    const b = need("crit");
    test.skip(!existsSync(webkit.executablePath()), "WebKit is not installed (scripts/nd bunx playwright install webkit)");
    // the suite pins `channel: "chrome"` for chromium and WebKit has no channels: name the WebKit binary itself
    const browser = await webkit.launch({ executablePath: webkit.executablePath() });
    try {
      const ctx = await browser.newContext({ locale: "ja-JP", viewport: { width: 1440, height: 900 } });
      // WebKit's offline emulation refuses file:// as well: cut the network by routing instead, and record every attempt
      const network: string[] = [];
      await ctx.route(/^(?:https?|wss?|ftp):/i, (r) => {
        network.push(r.request().url());
        return r.abort();
      });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`file://${b.file}#/s3`);
      await page.waitForSelector(".blk");
      await expect(page.locator("h1").first()).toHaveText("主要な流れ");
      expect(await page.locator("figure.mdiagram svg.dg").count()).toBeGreaterThan(0);
      await page.locator(".seg.level label", { hasText: "初めて" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
      await page.locator(".seg.level label", { hasText: "標準" }).click();
      const chip = page.locator(".blk a.mcite").first();
      await chip.scrollIntoViewIfNeeded();
      await chip.hover();
      await expect(page.locator(".pop.peek .peek-code [data-line].hi").first()).toBeVisible();
      await page.mouse.move(5, 500);
      await page.keyboard.press("Escape");
      await page.locator('.tab[href="#/map"]').click();
      await expect(page.locator("svg.plan .room").first()).toBeVisible();
      const injected = await page.evaluate(async () => {
        const s = document.createElement("script");
        s.textContent = "window.__x = 1";
        document.head.appendChild(s);
        await new Promise((res) => setTimeout(res, 50));
        return (window as unknown as { __x?: number }).__x ?? null;
      });
      expect(injected, "an injected inline script ran: the CSP does not hold in WebKit").toBeNull();
      expect(errors.filter((e) => !/Content Security Policy|Refused to execute/i.test(e))).toEqual([]);
      expect(network).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("@export the daemon route: GET /export/html downloads the same document in the asked level and language", async ({ context }) => {
    const meta = JSON.parse(readFileSync(`${OUT}/rich.json`, "utf8")) as { download: { status: number; type: string; disposition: string } };
    expect(meta.download.status).toBe(200);
    expect(meta.download.type).toContain("text/html");
    expect(meta.download.disposition).toMatch(/^attachment; filename=".*\.html"$/);
    const { page } = await openExport(context, `${OUT}/rich.en.html`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("data-level", "expert");
    await expect(page.locator(".vband")).toContainText("Read-only export");
    await expect(page.locator(".seg.level label.on")).toHaveText("Expert");
    await page.close();
  });
});

test.describe("@export reading", () => {
  test("@export table of contents: every chapter is reachable, the current one is marked, 1–9 jump, the pager moves on, a deep link focuses its block", async ({
    context,
  }) => {
    const b = need("crit");
    const { page } = await openExport(context, b.file);
    const n = await page.locator(".toc a[data-toc]").count();
    expect(n).toBeGreaterThanOrEqual(14);
    await expect(page.locator('.toc a[aria-current="page"]')).toHaveCount(1);
    await page.locator('.toc a[data-toc="s3"]').click();
    await expect(page).toHaveURL(/#\/s3$/);
    await expect(page.locator("h1").first()).toHaveText("主要な流れ");
    await expect(page.locator('.toc a[data-toc="s3"]')).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/#\/s1$/);
    await page.locator("nav.pager a").click();
    await expect(page).toHaveURL(/#\/s2$/);
    await expect(page.locator(".sec-num").first()).toHaveText("§2");
    const id = await page.locator(".blk[data-b]").nth(1).getAttribute("data-b");
    await page.goto(`${page.url().split("#")[0]}#/s2@${id}`);
    await expect(page.locator(`.blk[data-b="${id}"]`)).toBeFocused();
    await page.close();
  });

  test("@export reader levels: 初めて hides L3 / deep dives and folds cites to the paragraph end, 詳しい shows long cites; the position and the choice survive", async ({
    context,
  }) => {
    const { page } = await openExport(context, RICH, "#/s3");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-level", "standard");
    await expect(page.locator(".seg.level label.on")).toHaveText("標準");
    const l3 = page.locator('.blk[data-depth="L3"]');
    expect(await l3.count()).toBeGreaterThan(0);
    await expect(l3.first()).toBeVisible();
    await expect(page.locator(".blk a.mcite").first()).toBeVisible();
    // newcomer: the L3 block is gone behind a 「詳しく（n）」 chip, cites fold to 「出典 n」
    await page.locator(".seg.level label", { hasText: "初めて" }).click();
    await expect(html).toHaveAttribute("data-level", "newcomer");
    await expect(l3.first()).toBeHidden();
    await expect(page.locator(".more-chip").first()).toBeVisible();
    await expect(page.locator(".blk a.mcite").first()).toBeHidden();
    await expect(page.locator(".blk button.cite-end").first()).toBeVisible();
    await page.locator(".more-chip").first().click();
    await expect(l3.first()).toBeVisible();
    // 「出典をすべて表示」 (.) shows the chips for the newcomer too
    await page.keyboard.press(".");
    await expect(page.locator(".blk a.mcite").first()).toBeVisible();
    await page.keyboard.press(".");
    // expert: long cites, L3 shown
    await page.locator(".seg.level label", { hasText: "詳しい" }).click();
    await expect(html).toHaveAttribute("data-level", "expert");
    await expect(page.locator(".blk a.mcite .cl").first()).toBeVisible();
    await expect(page.locator(".blk a.mcite .cs").first()).toBeHidden();
    // keys: 0 = standard, j moves block by block, - steps down; the block in focus stays where it was (AC-J20)
    await page.keyboard.press("0");
    await expect(html).toHaveAttribute("data-level", "standard");
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.locator(".blk.focus")).toHaveCount(1);
    const focus = await page.locator(".blk.focus").getAttribute("data-b");
    const before = (await page.locator(`.blk[data-b="${focus}"]`).boundingBox())?.y ?? 0;
    await page.keyboard.press("-");
    await expect(html).toHaveAttribute("data-level", "newcomer");
    const after = (await page.locator(`.blk[data-b="${focus}"]`).boundingBox())?.y ?? -1;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
    // the choice is remembered for the next visit of the same file
    await page.reload();
    await page.waitForSelector(".blk");
    await expect(html).toHaveAttribute("data-level", "newcomer");
    await page.close();
  });

  test("@export verified / cited / inferred / unsupported / stale badges, the section counts, the claim note", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s3");
    for (const verdict of ["verified", "stale", "unsupported"])
      expect(await page.locator(`.mc[data-verdict="${verdict}"]`).count(), verdict).toBeGreaterThan(0);
    await page.goto(`${page.url().split("#")[0]}#/s0`);
    await expect(page.locator(".sec-num").first()).toHaveText("§0");
    expect(await page.locator('.mc[data-verdict="cited"]').count()).toBeGreaterThan(0);
    await page.goto(`${page.url().split("#")[0]}#/s1`);
    await expect(page.locator(".sec-num").first()).toHaveText("§1");
    expect(await page.locator('.mc[data-verdict="inferred"]').count()).toBeGreaterThan(0);
    // the header of the section counts what the badges show (per block, by its worst claim)
    await expect(page.locator(".sec-meta .guess")).toContainText("推測");
    await page.goto(`${page.url().split("#")[0]}#/s3`);
    await expect(page.locator(".sec-num").first()).toHaveText("§3");
    await expect(page.locator(".sec-meta")).toContainText("確認済");
    await expect(page.locator(".stats")).toContainText("確認済");
    await page.goto(`${page.url().split("#")[0]}#/s1`);
    await expect(page.locator(".sec-num").first()).toHaveText("§1");
    // clicking a doubtful claim explains the badge (read-only: no verify / ask buttons)
    await page.locator('.mc[data-verdict="inferred"]').first().click();
    const note = page.locator(".pop.note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("推測");
    await expect(note).toContainText("読み取り専用");
    expect(await note.locator("button:not(.x)").count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(note).toHaveCount(0);
    // the rail's footer counts the document
    await expect(page.locator(".rail-foot")).toContainText("出典と一致");
    await page.close();
  });

  test("@export cite peek on real code: ±3 lines, highlighted, the cited range marked, held by the pointer, pinned by a click, closed by Escape", async ({
    context,
  }, info) => {
    const b = need("crit");
    const { page, watch } = await openExport(context, b.file, "#/s3");
    const chip = page.locator(".blk a.mcite").first();
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    const peek = page.locator(".pop.peek");
    await expect(peek).toBeVisible();
    const lines = peek.locator(".peek-code [data-line]");
    expect(await lines.count()).toBeGreaterThanOrEqual(4);
    expect(await peek.locator(".peek-code [data-line].hi").count()).toBeGreaterThanOrEqual(1);
    // coloured tokens (the exporter's one-letter classes), real colours, and no blank line between lines
    const colored = peek.locator(".peek-code .sk, .peek-code .sf, .peek-code .st, .peek-code .ss");
    expect(await colored.count()).toBeGreaterThan(0);
    const kw = await peek
      .locator(".peek-code .sk")
      .first()
      .evaluate((e) => getComputedStyle(e).color);
    const fg = await peek.locator(".peek-code").evaluate((e) => getComputedStyle(e).color);
    expect(kw).not.toBe(fg);
    const heights = await lines.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThan(40);
    const r = await peek.boundingBox();
    expect(r && r.x >= 0 && r.x + r.width <= 1440 && r.y >= 0).toBe(true);
    // the header says which file and range — the whole of it, the symbol / blob part gives way first — the footer which checks passed
    await expect(peek.locator(".peek-h .p")).toContainText(".go");
    // (sub-pixel: an ellipsis shows as soon as the text is 0.1 px wider than its box, which scrollWidth rounds away)
    expect(await peek.locator(".peek-h .p").evaluate((e) => getComputedStyle(e).flexShrink)).toBe("0");
    expect(await peek.locator(".peek-h .p").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(peek.locator(".peek-f")).toContainText("範囲は実在");
    // every line carries its number in a gutter (the code does not touch the edge), tabs are 4 wide
    const gutter = await lines.evaluateAll((els) =>
      els.map((e) => ({ n: (e as HTMLElement).dataset.line, before: getComputedStyle(e, "::before").content, w: getComputedStyle(e, "::before").width })),
    );
    for (const g of gutter) expect(g.before).toBe(`"${g.n}"`);
    expect(new Set(gutter.map((g) => g.w)).size).toBe(1);
    expect(await peek.locator(".peek-code").evaluate((e) => getComputedStyle(e).tabSize)).toBe("4");
    await info.attach("peek", { body: await page.screenshot(), contentType: "image/png" });
    await peek.hover();
    await expect(peek).toBeVisible();
    await chip.click();
    await page.mouse.move(5, 500);
    await page.waitForTimeout(300);
    await expect(peek).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    expect((await collect(page, watch)).network).toEqual([]);
    await page.close();
  });

  test("@export the expert level shows each block's line in its Markdown file, never a made-up L0", async ({ context }) => {
    const b = need("crit");
    const { page } = await openExport(context, b.file, "#/s3");
    await page.locator(".seg.level label", { hasText: "詳しい" }).click();
    const lns = await page.locator(".blk > .mb").evaluateAll((els) => els.map((e) => e.getAttribute("data-ln")));
    const known = lns.filter((x): x is string => x !== null);
    expect(known.length).toBeGreaterThan(lns.length / 2);
    for (const ln of known) expect(Number(ln)).toBeGreaterThan(0);
    // `## 3.1 ピッカー一覧の取得 <!-- b_av7pbgz4 -->` is line 5 of docs/progress/dogfood/crit/doc/03-key-flows.md
    await expect(page.locator('.mb[data-block="b_av7pbgz4"]')).toHaveAttribute("data-ln", "5");
    expect(await page.locator('.mb[data-ln="0"]').count()).toBe(0);
    await page.close();
  });

  test("@export a cite whose blob moved on says so in its peek", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s3");
    // the rich doc cites the importer at its current blob: fresh. The stale claim carries the badge, not a stale peek
    const chip = page.locator(".blk a.mcite").first();
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    const peek = page.locator(".pop.peek");
    await expect(peek).toBeVisible();
    await expect(peek.locator(".stale")).toHaveCount(0);
    await expect(peek.locator(".peek-code")).toContainText("export");
    await page.close();
  });

  test("@export without code (--no-code): the chips stay, the peek says the range is not in this export, the file is much smaller", async ({ context }) => {
    const b = need("crit");
    // the payload is compressed, so the excerpt check runs on the decoded document, not the raw file
    const fullJson = payloadJson(readFileSync(b.file, "utf8"));
    const bareJson = payloadJson(readFileSync(b.nocode, "utf8"));
    expect(Object.keys((JSON.parse(fullJson) as { cites: Record<string, unknown> }).cites).length).toBeGreaterThan(0);
    expect(Object.keys((JSON.parse(bareJson) as { cites: Record<string, unknown> }).cites)).toEqual([]);
    expect(bareJson).not.toContain('data-line="');
    expect(bareJson.length).toBeLessThan(fullJson.length);
    const { page } = await openExport(context, b.nocode, "#/s3");
    await expect(page.locator(".vband")).toContainText("コードの抜粋なし");
    const chip = page.locator(".blk a.mcite").first();
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    await expect(page.locator(".pop.omitted")).toContainText("この書き出しには含まれていません");
    await page.close();
  });

  test("@export diagrams are pre-laid-out SVG from the IR: drawn, inside the column, following the theme, with a text alternative", async ({
    context,
  }, info) => {
    const { page } = await openExport(context, RICH, "#/s3");
    const fig = page.locator("figure.mdiagram").first();
    await fig.scrollIntoViewIfNeeded();
    const svg = fig.locator("svg.dg");
    await expect(svg).toBeVisible();
    expect(await svg.locator(".dg-node").count()).toBe(3);
    expect(await svg.locator(".dg-edge").count()).toBe(3);
    expect(await svg.locator("text", { hasText: "importCsv" }).count()).toBe(1);
    expect(await svg.locator(".dg-life").count()).toBe(3); // sequence: a lifeline per participant
    expect(new Set(await fig.locator("ul.mdiagram-text li").allTextContents())).toEqual(new Set(["CLI", "importCsv", "BookRepo"])); // the node labels, for assistive technology
    expect(await fig.locator("ul.mdiagram-text").evaluate((e) => getComputedStyle(e).clipPath)).not.toBe("none"); // visually hidden
    const sb = await fig.locator(".dg-box").boundingBox();
    const mb = await page.locator("main .doc-col").boundingBox();
    expect(sb && mb && sb.x >= mb.x - 48 && sb.x + sb.width <= mb.x + mb.width + 48).toBe(true);
    expect(await noSideScroll(page)).toBe(true);
    const fill = () =>
      svg
        .locator(".dg-node rect")
        .first()
        .evaluate((e) => getComputedStyle(e).fill);
    const light = await fill();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await fill()).not.toBe(light);
    await info.attach("diagram-dark", { body: await fig.screenshot(), contentType: "image/png" });
    await page.close();
  });

  test("@export a wide module map in a block scrolls inside its box instead of widening the page, edges drawn light", async ({ context }) => {
    const b = need("crit");
    const { page } = await openExport(context, b.file, "#/s2");
    const svg = page.locator("figure.mdiagram svg.dg").first();
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("data-dense", "");
    expect(await noSideScroll(page)).toBe(true);
    const box = await svg.boundingBox();
    expect(box && box.width).toBeGreaterThan(500);
    await page.close();
  });

  test("@export glossary: a term underlines on first use, its card shows the definition and links to the glossary", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s0");
    const term = page.locator("abbr.mterm").first();
    await expect(term).toBeVisible();
    await term.hover();
    const card = page.locator(".termcard");
    await expect(card).toBeVisible();
    await expect(card).toContainText("買ったが読んでいない本の山");
    await expect(card.locator(".ty")).toContainText("つんどく");
    await card.locator("a").click();
    await expect(page).toHaveURL(/#\/s12$/);
    await page.close();
  });

  test("@export a why box and a pitfall render as callouts; the deep ones follow the level", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s10");
    await expect(page.locator(".blk[data-kind='why']")).toBeVisible();
    await expect(page.locator(".blk[data-kind='why']")).toContainText("なぜ1行ずつ保存するのか");
    await page.goto(`${page.url().split("#")[0]}#/s9`);
    await expect(page.locator(".sec-num").first()).toHaveText("§9");
    await expect(page.locator(".blk[data-kind='pitfall']")).toBeVisible();
    await page.locator(".seg.level label", { hasText: "初めて" }).click();
    await expect(page.locator(".blk[data-kind='pitfall']")).toBeHidden();
    await page.close();
  });
});

test.describe("@export chrome", () => {
  test("@export ⌘K searches sections, terms, files and the text of the blocks; Enter goes there; Escape returns focus", async ({ context }, info) => {
    const { page, watch } = await openExport(context, RICH);
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.locator("main").focus();
    await page.keyboard.press(`${mod}+k`);
    const dlg = page.locator(".pal");
    await expect(dlg).toBeVisible();
    await expect(page.locator(".pal input")).toBeFocused();
    expect(await page.locator(".pal-it").count()).toBeGreaterThanOrEqual(10); // an empty query lists the chapters
    // a term by its reading (kana), by its English name, a file by a fragment of its name, a section by a word
    const group = (name: string) => page.locator(".pal-g", { hasText: name });
    await page.locator(".pal input").fill("つんどく");
    await expect(group("用語")).toBeVisible();
    await page.locator(".pal input").fill("tsundoku");
    await expect(group("用語")).toBeVisible();
    await page.locator(".pal input").fill("importer");
    await expect(page.locator(".pal-it", { hasText: "importer.ts" }).first()).toBeVisible();
    await page.locator(".pal input").fill("主要");
    await expect(group("節")).toBeVisible();
    await info.attach("palette", { body: await page.screenshot(), contentType: "image/png" });
    // body text: a phrase that only occurs in prose, with the match marked
    await page.locator(".pal input").fill("ドライランで取り込み結果");
    await expect(group("本文")).toBeVisible();
    await expect(page.locator(".pal-it mark").first()).toContainText("ドライラン");
    await page.keyboard.press("Enter");
    await expect(dlg).toHaveCount(0);
    await expect(page).toHaveURL(/#\/s1@b_/);
    await expect(page.locator(".blk.focus, .blk:focus")).toHaveCount(1);
    // an action, and Escape closes and returns focus to where the palette was opened
    await page.keyboard.press(`${mod}+k`);
    await page.keyboard.type("くわしい");
    await expect(page.locator(".pal-it", { hasText: "詳しい" }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-level", "expert");
    await page.keyboard.press(`${mod}+k`);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    expect((await collect(page, watch)).network).toEqual([]);
    await page.close();
  });

  test("@export dark mode and theme: follows the system, the button forces light / dark, the choice is remembered", async ({ context }, info) => {
    const b = need("crit");
    const { page } = await openExport(context, b.file);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await bg();
    expect(dark).not.toBe(light);
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator(".theme-btn").click(); // system → light
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator(".theme-btn").click(); // light → dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg()).toBe(dark);
    await info.attach("dark", { body: await page.screenshot(), contentType: "image/png" });
    await page.reload();
    await page.waitForSelector(".blk");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.close();
  });

  test("@export English chrome: the header, the band and the rail switch language with no raw keys; the document stays in its language", async ({
    context,
  }) => {
    const { page, watch } = await openExport(context, RICH);
    const doc = await page.locator("h1").first().textContent();
    await page.locator(".lang-btn").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".vband")).toContainText("Read-only export");
    await expect(page.locator(".tabs")).toContainText("Design doc");
    await expect(page.locator(".seg.level")).toContainText("Expert");
    expect(await page.locator("h1").first().textContent()).toBe(doc);
    expect(await page.locator("main").getAttribute("lang")).toBe("ja");
    const body = (await page.locator("body").innerText()).split("\n");
    expect(body.filter((l) => /^(export|rail|toc|reader|header|nav|level|cite|map|palette|ctx)\.[a-zA-Z.]+$/.test(l.trim()))).toEqual([]);
    await page.keyboard.press("?");
    await expect(page.locator(".help")).toContainText("Using this file");
    await page.keyboard.press("Escape");
    await expect(page.locator(".help")).toHaveCount(0);
    expect(watch.consoleErrors).toEqual([]);
    await page.close();
  });

  test("@export the map tab: the plan the daemon laid out, rooms select and open their section, zoom works", async ({ context }, info) => {
    const b = need("crit");
    const { page } = await openExport(context, b.file, "#/map");
    await expect(page.locator("svg.plan")).toBeVisible();
    const rooms = page.locator("svg.plan .room");
    expect(await rooms.count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator(".tiles")).toContainText("ファイル");
    await expect(page.locator(".quick")).toBeVisible();
    await rooms.first().click();
    await expect(page.locator(".room-float")).toBeVisible();
    await page.locator(".zoombar button", { hasText: "部屋" }).click();
    await info.attach("map", { body: await page.screenshot(), contentType: "image/png" });
    await page.locator(".zoombar [aria-label*='全体']").click();
    const withSection = page.locator(".room-float button.btn-pri");
    if (await withSection.count()) {
      await withSection.click();
      await expect(page).toHaveURL(/#\/s/);
      await expect(page.locator("h1").first()).toBeVisible();
    }
    await page.close();
  });

  test("@export read-only means read-only: no composer, no gutter, no job or inbox, nothing editable", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s3");
    for (const sel of [".gutter", ".composer", ".job-chip", "textarea", "[contenteditable=true]", ".tab:has-text('Inbox')", ".tab:has-text('レビュー')"])
      expect(await page.locator(sel).count(), sel).toBe(0);
    await page.locator(".blk").first().click();
    for (const k of ["c", "f", "e"]) await page.keyboard.press(k);
    expect(await page.locator("textarea, .composer").count()).toBe(0);
    // nothing tells the reader to press a button the file does not have (「生成する」, 「決定として残す」)
    await expect(page.locator(".ph").first()).toContainText("書き出した時点ではまだ生成されていませんでした");
    for (const file of [RICH, built.crit?.file, built["m3e-canvas"]?.file].filter((f): f is string => !!f)) {
      const html = readFileSync(file, "utf8");
      for (const s of ["で作られます", "決定として残す", "Use “Generate"]) expect(html.includes(s), `${s} in ${file}`).toBe(false);
    }
    await page.close();
  });

  test("@export other repo: m3e-canvas opens the same way", async ({ context }, info) => {
    const b = need("m3e-canvas");
    const { page, watch } = await openExport(context, b.file);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.locator('.toc a[data-toc="s3"]').click();
    await expect(page.locator(".blk").first()).toBeVisible();
    const w = await collect(page, watch);
    expect([w.network, w.consoleErrors, w.apiCalls]).toEqual([[], [], []]);
    await info.attach("m3e", { body: await page.screenshot(), contentType: "image/png" });
    await page.close();
  });

  test("@export narrow window: the rail becomes a drawer, no horizontal scroll, the column keeps ≥ 34 characters", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 900 }, locale: "ja-JP" });
    const { page } = await openExport(ctx, RICH, "#/s3");
    expect(await noSideScroll(page)).toBe(true);
    await expect(page.locator(".rail")).toBeHidden();
    // the measure stays ≥ 34 full-width characters per line (AC-U-W01)
    const perLine = await page.evaluate(() => {
      const root = document.querySelector(".reader-root") as HTMLElement;
      const p = document.querySelector(".blk p") as HTMLElement | null;
      return root.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(p ?? root).fontSize);
    });
    expect(perLine).toBeGreaterThanOrEqual(34);
    await page.locator(".menu-btn").click();
    await expect(page.locator(".rail")).toBeVisible();
    await page.locator('.toc a[data-toc="s9"]').click();
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.locator(".sec-num").first()).toHaveText("§9");
    // the header has no room for the level / theme / language switches here: the drawer has them (no ⌘K on a phone)
    await expect(page.locator(".hdr .seg.level")).toBeHidden();
    await page.locator(".menu-btn").click();
    const view = page.locator(".rail .vview");
    await expect(view).toBeVisible();
    await view.locator("label", { hasText: "初めて" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
    await view.locator("label", { hasText: "ダーク" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await view.locator("label", { hasText: "English" }).click();
    await expect(page.locator(".vband")).toContainText("Read-only export");
    await expect(view.locator("label.on")).toHaveText(["Newcomer", "Dark", "English"]);
    await view.locator("label", { hasText: "Standard" }).click();
    await view.locator("label", { hasText: "Auto" }).click();
    await view.locator("label", { hasText: "日本語" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-level", "standard");
    expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
    // a phone (390 px): the drawer still has them, and nothing is cut sideways
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(view).toBeVisible();
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await ctx.close();
  });

  test("@export every width reaches the TOC: a 1,200 px laptop window opens the rail from the menu button, the map has the drawer on a phone", async ({
    browser,
  }) => {
    const laptop = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "ja-JP" });
    const { page } = await openExport(laptop, RICH, "#/s3");
    // the three columns do not fit (rail + 672 + margin): the rail is a drawer, so the menu button must be there
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.locator(".menu-btn")).toBeVisible();
    await expect(page.locator(".hdr .seg.level")).toBeVisible();
    await page.locator(".menu-btn").click();
    await expect(page.locator(".rail")).toBeVisible();
    await expect(page.locator(".rail .vview")).toBeHidden(); // the header still has the switches at this width
    await page.locator('.toc a[data-toc="s1"]').click();
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.locator(".sec-num").first()).toHaveText("§1");
    await laptop.close();
    // wide enough for the rail inline: no menu button
    const wide = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ja-JP" });
    const w = await openExport(wide, RICH, "#/s3");
    await expect(w.page.locator(".rail")).toBeVisible();
    await expect(w.page.locator(".menu-btn")).toBeHidden();
    await wide.close();
    // a phone on the map: the drawer has the TOC and the level / theme / language switches too
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    const m = await openExport(phone, RICH, "#/map");
    await m.page.locator(".menu-btn").click();
    await expect(m.page.locator(".rail .vview")).toBeVisible();
    await m.page.locator(".rail .vview label", { hasText: "初めて" }).click();
    await expect(m.page.locator("html")).toHaveAttribute("data-level", "newcomer");
    await m.page.locator('.toc a[data-toc="s3"]').click();
    await expect(m.page.locator(".sec-num").first()).toHaveText("§3");
    await expect(m.page.locator(".rail")).toBeHidden();
    await phone.close();
  });

  test("@export wide window: the switches stay in the header, the drawer does not repeat them", async ({ context }) => {
    const { page } = await openExport(context, RICH, "#/s3");
    await expect(page.locator(".hdr .seg.level")).toBeVisible();
    expect(await page.locator(".rail .vview").count()).toBe(0);
    await page.close();
  });
});

test.describe("@export safety", () => {
  test("@export secrets: no planted value in the file, ≥ 3 redactions counted and shown, the cited line redacted in its peek", async ({ context }) => {
    const b = need("secrets");
    for (const file of [b.file, b.nocode]) {
      const html = readFileSync(file, "utf8");
      for (const [name, value] of Object.entries(PLANTED)) expect(html.includes(value), `${name} in ${file}`).toBe(false);
      for (const fragment of ["AKIAJ3Q7", "ghp_a1B2", "sk_live_51Hq7", "Tr0ub4dor", "s3cr3tPassw0rd9"]) expect(html.includes(fragment), fragment).toBe(false);
    }
    expect(b.redactions, "redactions the CLI reported").toBeGreaterThanOrEqual(3);
    expect(b.summary).toMatch(/redaction\(s\)|伏せ字/);
    const { page } = await openExport(context, b.file);
    await expect(page.locator(".vband")).toContainText(`秘密情報${b.redactions}件を伏せ字`);
    expect(await page.locator("main").innerText()).toContain("«redacted:secret»");
    const chip = page.locator('a.mcite[data-cite^="src/legacy.ts"]').first();
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    const peek = page.locator(".pop.peek");
    await expect(peek).toBeVisible();
    await expect(peek).toContainText("«redacted:secret»");
    await expect(peek).toContainText("export const");
    const content = await page.content();
    for (const value of Object.values(PLANTED)) expect(content).not.toContain(value);
    await page.close();
  });

  test("@export `</script>` in the content breaks nothing: two scripts, the text is shown as text, no injected code ran", async ({ context }) => {
    const b = need("secrets");
    const html = readFileSync(b.file, "utf8");
    expect([...html.matchAll(/<script\b/gi)].length).toBe(2);
    expect([...html.matchAll(/<\/script>/gi)].length).toBe(2);
    expect(html).not.toContain("<script>window.__pwned");
    const { page, watch } = await openExport(context, b.file, "#/s1");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null)).toBeNull();
    expect(await page.evaluate(() => document.querySelectorAll("script").length)).toBe(2);
    await expect(page.locator("main")).toContainText("</script>");
    await expect(page.locator("main")).toContainText("<!-- コメント -->");
    expect(watch.consoleErrors).toEqual([]);
    expect((await collect(page, watch)).network).toEqual([]);
    await page.close();
  });

  test("@export a broken or foreign payload shows a plain message instead of a blank page", async ({ context }) => {
    const rich = readFileSync(RICH, "utf8");
    const swap = (body: string): string => rich.replace(/(<script type="application\/json" id="mitori-export"[^>]*>)[\s\S]*?(<\/script>)/, `$1${body}$2`);
    const b64 = (s: string): string => gzipSync(s, { level: 9 }).toString("base64");
    await context.setOffline(true);
    // a newer format: the version check (after the real decode path) names it
    const foreign = `${OUT}/foreign.html`;
    writeFileSync(foreign, swap(b64('{"format":"mitori.export/9"}')));
    const page = await context.newPage();
    await page.goto(`file://${foreign}`);
    await expect(page.locator(".viewer-error")).toContainText("開けませんでした");
    await expect(page.locator(".viewer-error code")).toContainText("mitori.export/9");
    await page.close();
    // a truncated payload: damaged, not blank
    const broken = `${OUT}/broken.html`;
    writeFileSync(broken, swap(`${b64('{"format":"mitori.export/1"}')}`.slice(0, 64)));
    const page2 = await context.newPage();
    await page2.goto(`file://${broken}`);
    await expect(page2.locator(".viewer-error")).toContainText("開けませんでした");
    await page2.close();
  });

  test("@export without gzip support shows the old-browser message instead of a blank page", async ({ context }) => {
    const file = `${OUT}/oldbrowser.html`;
    writeFileSync(file, readFileSync(RICH, "utf8"));
    await context.setOffline(true);
    await context.addInitScript(() => {
      (window as unknown as Record<string, unknown>).DecompressionStream = undefined;
    });
    const page = await context.newPage();
    await page.goto(`file://${file}`);
    await expect(page.locator(".viewer-error")).toContainText("このブラウザでは開けません");
    await page.close();
  });
});

// WP-12 (S10): the Playwright helpers against real browsers. Skipped when the browser binaries are not installed
// (the PR CI image gets them with the e2e job); on the maintainer's machine they run against the Playwright cache.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { MitoriError } from "@mitori/core";
import { type Browser, type BrowserType, chromium, type Page, webkit } from "playwright-core";
import type { PageLike } from "../contract.ts";
import { ime, servedBytes, ui } from "./index.ts";
import { OBSERVERS_SOURCE } from "./observers.ts";

const installed = (bt: BrowserType): boolean => {
  try {
    return existsSync(bt.executablePath());
  } catch {
    return false;
  }
};
const HAVE_CHROMIUM = installed(chromium);
const HAVE_WEBKIT = installed(webkit);
const as = (p: Page): PageLike => p as unknown as PageLike;

describe.skipIf(!HAVE_CHROMIUM)("TK-BROWSER-01 ui helpers (chromium)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });
  /** Serve `html` from a routed origin so the document is a real navigation (init scripts only run on those). */
  const open = async (html: string, early = true): Promise<Page> => {
    const page = await browser.newPage();
    if (early) await page.addInitScript(OBSERVERS_SOURCE);
    await page.route("http://mitori.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("http://mitori.test/");
    return page;
  };

  test("domNodes counts every element", async () => {
    const page = await open(`<ul>${"<li><b>x</b></li>".repeat(50)}</ul>`);
    // html + head + body + ul + 50 × (li + b)
    expect(await ui.domNodes(as(page))).toBe(4 + 100);
    await page.close();
  });

  test("mountedCodeLines counts .cm-line and pre.mcode .line, each element once", async () => {
    const page = await open(
      `<div class="cm-content">${'<div class="cm-line">a</div>'.repeat(3)}</div><pre class="mcode">${'<span class="line">b</span>'.repeat(2)}</pre><p>${'<span class="line">no</span>'.repeat(5)}</p><div class="cm-line line">both</div>`,
    );
    expect(await ui.mountedCodeLines(as(page))).toBe(3 + 2 + 1);
    await page.close();
  });

  test("marks are filtered by prefix and sorted by start time", async () => {
    const page = await open("<p>x</p>");
    await page.evaluate(
      `performance.mark("mitori:shell:painted"); performance.mark("other"); performance.mark("mitori:map:painted", { detail: { trigger: 1 } }); performance.measure("mitori:m", "mitori:shell:painted", "mitori:map:painted")`,
    );
    const names = (await ui.marks(as(page))).map((m) => m.name);
    expect(names).toContain("mitori:shell:painted");
    expect(names).toContain("mitori:map:painted");
    expect(names).toContain("mitori:m");
    expect(names).not.toContain("other");
    expect((await ui.marks(as(page), "other")).map((m) => m.name)).toEqual(["other"]);
    const starts = (await ui.marks(as(page))).map((m) => m.startTime);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    await page.close();
  });

  test("interactions groups event-timing entries by interactionId (INP input), ignoring fast ones", async () => {
    const page = await open(`<button id="slow">slow</button><button id="fast">fast</button>
      <script>
        const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };
        document.getElementById("slow").onclick = () => spin(90);
        document.getElementById("fast").onclick = () => {};
      </script>`);
    await page.click("#slow");
    await page.click("#slow");
    await page.click("#fast");
    await page.waitForTimeout(250);
    const found = await ui.interactions(as(page));
    // one entry per interaction (a click is pointerdown + pointerup + click, all with one interactionId)
    expect(new Set(found.map((f) => f.interactionId)).size).toBe(found.length);
    for (const i of found) expect(i.interactionId).toBeGreaterThan(0);
    const slow = found.filter((i) => i.duration >= 80);
    expect(slow).toHaveLength(2);
    expect(found.length).toBeLessThanOrEqual(3); // the fast click may or may not reach the 16 ms reporting threshold
    await page.close();
  });

  test("a late install still sees slow (≥ 104 ms) interactions: the browser buffers those", async () => {
    const page = await open(
      `<button id="b">b</button><script>document.getElementById("b").onclick = () => { const e = performance.now() + 150; while (performance.now() < e); };</script>`,
      false,
    );
    await page.click("#b");
    await page.waitForTimeout(250);
    expect((await ui.interactions(as(page))).length).toBe(1);
    await page.close();
  });

  test("cls sums layout shifts and ignores shifts right after input", async () => {
    const shifting = await open(`<div id="top" style="height:0"></div><p style="margin:0;height:500px;background:#ccc">content</p>
      <script>setTimeout(() => { document.getElementById("top").style.height = "200px"; }, 300);</script>`);
    await shifting.waitForTimeout(800);
    expect(await ui.cls(as(shifting))).toBeGreaterThan(0.05);
    await shifting.close();

    const afterClick = await open(`<button id="b">b</button><div id="top" style="height:0"></div><p style="margin:0;height:500px;background:#ccc">content</p>
      <script>document.getElementById("b").onclick = () => { document.getElementById("top").style.height = "200px"; };</script>`);
    await afterClick.waitForTimeout(100);
    await afterClick.click("#b");
    await afterClick.waitForTimeout(300);
    expect(await ui.cls(as(afterClick))).toBe(0);
    await afterClick.close();
  });

  test("focusNotObscured: an overlay on the focused element's centre fails it", async () => {
    const page = await open(
      `<input id="i" style="position:absolute;left:20px;top:20px;width:200px"><div id="cover" style="display:none;position:fixed;left:0;top:0;width:400px;height:100px;background:#000"></div>`,
    );
    expect(await ui.focusNotObscured(as(page))).toBe(true); // nothing focused
    await page.focus("#i");
    expect(await ui.focusNotObscured(as(page))).toBe(true);
    await page.evaluate(`document.getElementById("cover").style.display = "block"`);
    expect(await ui.focusNotObscured(as(page))).toBe(false);
    await page.close();
  });

  test("axe: only serious/critical violations, with node counts, scoped by `include`", async () => {
    const page = await open(`<main id="m"><p>x</p></main><script>
      window.__calls = [];
      window.axe = { run: async (ctx, opts) => {
        window.__calls.push({ ctx: ctx === document ? "document" : ctx, tags: opts.runOnly.values });
        return { violations: [
          { id: "color-contrast", impact: "serious", nodes: [{}, {}, {}] },
          { id: "region", impact: "moderate", nodes: [{}] },
          { id: "image-alt", impact: "critical", nodes: [{}] },
        ] };
      } };
    </script>`);
    expect(await ui.axe(as(page))).toEqual([
      { id: "color-contrast", impact: "serious", nodes: 3 },
      { id: "image-alt", impact: "critical", nodes: 1 },
    ]);
    await ui.axe(as(page), { include: "#m" });
    const calls = await page.evaluate<{ ctx: unknown; tags: string[] }[]>("window.__calls");
    expect(calls[0]).toEqual({ ctx: "document", tags: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] });
    expect(calls[1]?.ctx).toEqual({ include: ["#m"] });
    await page.close();
  });

  test("axe without the package or a page-provided axe is E_UNSUPPORTED with the CR hint", async () => {
    let installedAxe = true;
    try {
      await import("node:module").then((m) => m.createRequire(import.meta.url).resolve("axe-core/axe.min.js"));
    } catch {
      installedAxe = false;
    }
    if (installedAxe) return; // the real thing is exercised by the e2e a11y suites
    const page = await open("<p>x</p>");
    const err = await ui.axe(as(page)).catch((e) => e as MitoriError);
    expect(err).toBeInstanceOf(MitoriError);
    expect((err as MitoriError).code).toBe("E_UNSUPPORTED");
    expect((err as MitoriError).message).toContain("axe-core");
    await page.close();
  });

  test("throttleCpu slows script execution ~rate× and rate 1 resets", async () => {
    const page = await open("<p>x</p>");
    const work = () =>
      page.evaluate<number>("(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x += i % 7; return performance.now() - t; })()");
    await work();
    const normal = Math.min(await work(), await work());
    await ui.throttleCpu(as(page), 4);
    const slow = Math.min(await work(), await work());
    expect(slow / normal).toBeGreaterThan(2);
    await ui.throttleCpu(as(page), 1);
    const back = Math.min(await work(), await work());
    expect(back / normal).toBeLessThan(2);
    await expect(ui.throttleCpu(as(page), 0.5)).rejects.toThrow("≥ 1");
    await page.close();
  });

  test("helpers refuse a bare PageLike with a readable error", async () => {
    await expect(ui.domNodes({ goto: async () => {} })).rejects.toThrow("Playwright page");
  });
});

const IME_PAGE = `<input id="i"><div id="ce" contenteditable="true"></div><script>
  window.log = [];
  const i = document.getElementById("i");
  for (const t of ["compositionstart", "compositionupdate", "compositionend"]) i.addEventListener(t, (e) => log.push(t + ":" + e.data));
  i.addEventListener("keydown", (e) => log.push("keydown:" + e.key + ":" + e.keyCode + ":" + e.code + ":" + e.isComposing));
  i.addEventListener("input", (e) => log.push("input:" + e.isComposing + ":" + i.value));
</script>`;

const types = (log: string[]): string[] => log.map((l) => l.split(":")[0] as string);

function imeSuite(name: string, bt: BrowserType, order: "chromium" | "webkit", have: boolean) {
  describe.skipIf(!have)(`TK-BROWSER-02 ime (${name}, ${order} order)`, () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
      browser = await bt.launch();
    }, 30_000);
    afterAll(async () => {
      await browser?.close();
    });
    const fresh = async () => {
      page = await browser.newPage();
      await page.setContent(IME_PAGE);
      await page.focus("#i");
    };
    const log = () => page.evaluate<string[]>("window.log");

    test("compose + Enter: start, one update per kana, 229 keydowns, composition end, text committed", async () => {
      await fresh();
      await ime.compose(as(page), "にほん", "日本", { order });
      const l = await log();
      const t = types(l);
      expect(t[t.indexOf("compositionstart")]).toBe("compositionstart");
      expect(l.filter((x) => x.startsWith("compositionupdate:")).slice(0, 3)).toEqual([
        "compositionupdate:に",
        "compositionupdate:にほ",
        "compositionupdate:にほん",
      ]);
      expect(l).toContain("compositionend:日本");
      expect(await page.inputValue("#i")).toBe("日本");
      const enterDown = l.filter((x) => x.startsWith("keydown:Enter"));
      expect(enterDown[0]).toBe("keydown:Enter:229:Enter:true"); // the confirming Enter is still inside the composition
      // every key a handler sees while the IME is on is keyCode 229
      for (const k of l.filter((x) => x.startsWith("keydown:"))) expect(k.split(":")[2]).toBe("229");
      await page.close();
    });

    test("compose + Escape: the reading is discarded and nothing is committed", async () => {
      await fresh();
      await ime.compose(as(page), "にほん", null, { order });
      const l = await log();
      expect(l).toContain("compositionend:");
      expect(l.some((x) => x.startsWith("keydown:Escape:229"))).toBe(true);
      expect(await page.inputValue("#i")).toBe("");
      await page.close();
    });

    test("confirmKey Escape cancels even when a commit string is given", async () => {
      await fresh();
      await ime.compose(as(page), "か", "科", { order, confirmKey: "Escape" });
      expect(await page.inputValue("#i")).toBe("");
      await page.close();
    });

    test("imeKey sends key=Process, keyCode 229 and the physical code", async () => {
      await fresh();
      await ime.imeKey(as(page), "KeyJ");
      expect(await log()).toContain("keydown:Process:229:KeyJ:false");
      await page.close();
    });

    test("an empty reading is rejected", async () => {
      await fresh();
      await expect(ime.compose(as(page), "", "x", { order })).rejects.toThrow("reading");
      await page.close();
    });
  });
}

imeSuite("chromium", chromium, "chromium", HAVE_CHROMIUM);
imeSuite("chromium", chromium, "webkit", HAVE_CHROMIUM);
imeSuite("webkit", webkit, "webkit", HAVE_WEBKIT);

describe.skipIf(!HAVE_CHROMIUM)("TK-BROWSER-03 ime Safari order", () => {
  test("synthetic order: Enter keydown (composing) → compositionend → Enter keydown (not composing, still 229)", async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(IME_PAGE);
    await page.focus("#i");
    await ime.compose(as(page), "にほん", "日本", { order: "webkit" });
    const l = await page.evaluate<string[]>("window.log");
    const tail = l.filter((x) => x.startsWith("keydown:Enter") || x.startsWith("compositionend"));
    expect(tail).toEqual(["keydown:Enter:229:Enter:true", "compositionend:日本", "keydown:Enter:229:Enter:false"]);
    await browser.close();
  });
});

describe("TK-BROWSER-04 servedBytes", () => {
  const body = new TextEncoder().encode("export const x = 1;\n".repeat(400));
  const br = brotliCompressSync(body);
  const gz = gzipSync(body);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const accept = req.headers.get("accept-encoding") ?? "";
      if (url.pathname === "/assets/app-abc123.js") {
        const headers = { "content-type": "text/javascript", "cache-control": "public, max-age=31536000, immutable" };
        if (accept.includes("br")) return new Response(br, { headers: { ...headers, "content-encoding": "br" } });
        return new Response(gz, { headers: { ...headers, "content-encoding": "gzip" } });
      }
      if (url.pathname === "/plain.css") return new Response(body, { headers: { "content-type": "text/css", "cache-control": "no-cache" } });
      if (url.pathname === "/short.js")
        return new Response(gz, {
          headers: { "content-type": "text/javascript", "cache-control": "public, max-age=60, immutable", "content-encoding": "gzip" },
        });
      if (url.pathname === "/assets/moved-abc123.js") return new Response("see /login", { status: 302, headers: { location: "/login" } });
      return new Response("nope", { status: 404 });
    },
  });
  afterAll(() => server.stop(true));
  const base = `http://127.0.0.1:${server.port}/`;

  test("reports the compressed body size per encoding, not the file size", async () => {
    const [b] = await servedBytes(base, ["/assets/app-abc123.js"], "br");
    const [g] = await servedBytes(base, ["/assets/app-abc123.js"], "gzip");
    expect(b).toMatchObject({ path: "/assets/app-abc123.js", bytes: br.length, contentEncoding: "br", immutable: true, contentType: "text/javascript" });
    expect(g).toMatchObject({ bytes: gz.length, contentEncoding: "gzip", immutable: true });
    expect(b?.bytes).toBeLessThan(body.length / 10);
  });

  test("identity responses, non-immutable cache headers and short max-age are reported as such", async () => {
    const [css, short] = await servedBytes(base, ["/plain.css", "/short.js"], "gzip");
    expect(css).toMatchObject({ bytes: body.length, contentEncoding: null, immutable: false });
    expect(short?.immutable).toBe(false); // immutable but only 60 s: not a cache-forever asset
  });

  test("a missing path throws instead of reporting 0 bytes", async () => {
    await expect(servedBytes(base, ["/nope.js"], "br")).rejects.toThrow("404");
  });

  test("regression: a redirect is not an asset — its 10-byte body must not be measured as the file", async () => {
    await expect(servedBytes(base, ["/assets/moved-abc123.js"], "gzip")).rejects.toThrow("302");
  });
});

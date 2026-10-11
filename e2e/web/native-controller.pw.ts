/** Native Reader controller in real engines, independently of the initial-UI endpoint / full editor bridge. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { NativeReaderState } from "../../apps/web/src/reader/native-state.ts";

let dir: string;
let script: string;
let anchorScript: string;
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mitori-native-reader-test-"));
  execFileSync(
    "bun",
    ["build", resolve("apps/web/src/reader/native.ts"), resolve("apps/web/src/threads/dom-anchor.ts"), "--target", "browser", "--outdir", dir],
    { stdio: "pipe" },
  );
  script = readFileSync(join(dir, "reader/native.js"), "utf8");
  anchorScript = readFileSync(join(dir, "threads/dom-anchor.js"), "utf8");
});
test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.route("**/__native_reader_test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><style>.blk{min-height:40px}.blk[data-depth=L3]:not(.force){display:none}.bwin-sp{display:block}.sec-body.mstream{min-height:var(--reserve)}.read-mark{display:block;height:1px}body{margin:0}</style></head><body><main id="main"></main></body></html>',
    }),
  );
  await page.route("**/__native_reader_controller.js", (route) => route.fulfill({ contentType: "application/javascript", body: script }));
  await page.route("**/__native_anchor_controller.js", (route) => route.fulfill({ contentType: "application/javascript", body: anchorScript }));
  await page.goto("/__native_reader_test");
});

test("normalized selection round-trip keeps an adjacent table cell's exact display quote", async ({ page }) => {
  const quotes = await page.evaluate(async () => {
    const path = "/__native_anchor_controller.js";
    const { anchorFromRange, rangeOf } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    return ["", " \n<a class=mcite>excluded cite</a>"].map((between) => {
      main.innerHTML = `<div class="blk" data-b="b_0"><div class="mb"><table><tr><td>config.go:20</td>${between}<td><code>TSUNDOKU_API_TOKEN</code></td><td>other cell</td></tr></table></div></div>`;
      const cell = main.querySelector("code")!;
      const selection = document.createRange();
      selection.selectNodeContents(cell);
      const original = anchorFromRange(selection)!;
      const restored = rangeOf(main.querySelector(".mb")!, original.start, original.end)!;
      const result = anchorFromRange(restored)!;
      return { exact: restored.toString(), quote: result.quote, segment: restored.commonAncestorContainer.parentElement?.closest("td")?.textContent };
    });
  });
  for (const quote of quotes)
    expect(quote).toEqual({ exact: "TSUNDOKU_API_TOKEN", quote: { before: "", mark: "TSUNDOKU_API_TOKEN", after: "" }, segment: "TSUNDOKU_API_TOKEN" });
});

test("native j/k and reveal stay hot, offscreen hash mounts only neighbouring windows", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const blocks = Array.from({ length: 1000 }, (_, n) => ({
      id: `b_${n}`,
      hash: "a".repeat(16),
      section: "s3",
      html: `<div class="mb"><p>Block ${n}</p></div>`,
      kind: "paragraph",
      depth: n === 1 ? "L3" : "L1",
      readingSec: 1,
      freshness: "fresh",
      claimViews: [],
      threads: { open: 0 },
      origin: "ai",
      status: "ready",
      mdLine: 1,
    }));
    const wrap = (b: (typeof blocks)[number]) => `<div class="blk" data-b="${b.id}" data-depth="${b.depth}" tabindex="-1">${b.html}</div>`;
    const rows = Array.from({ length: 20 }, (_, i) =>
      blocks
        .slice(i * 50, (i + 1) * 50)
        .map(wrap)
        .join(""),
    );
    main.innerHTML = `<div class="reader-root" data-reader-heights='${JSON.stringify(rows.map(() => 2000))}' data-window-first="0" data-window-last="2"><div data-reader-spacer="lead"></div>${rows
      .slice(0, 3)
      .map((html, i) => `<div class="bwin" data-window="${i}">${html}</div>`)
      .join("")}<div data-reader-spacer="tail" style="height:34000px"></div>${rows
      .slice(3)
      .map((html, i) => `<template data-reader-window="${i + 3}">${html}</template>`)
      .join("")}</div><button class="more-chip" data-ids="b_1">More</button>`;
    const actions: unknown[] = [];
    const reader = mountNativeReader({
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks }], order: blocks.map((b) => b.id), total: 1000 },
      ws: "ws_0123456789ab",
      level: "newcomer",
      text: { citeEnd: String, verifyLabel: "Check" },
      enhance: (action: unknown) => actions.push(action),
    });
    reader.action("read.next");
    const first = reader.capture().focused;
    reader.action("read.next");
    const skipped = reader.capture().focused;
    reader.action("read.prev");
    main.querySelector<HTMLButtonElement>(".more-chip")!.click();
    reader.action("read.next");
    const revealed = reader.capture().focused;
    reader.jump("b_850");
    const far = reader.capture();
    const mounted = main.querySelectorAll(".blk").length;
    const focussed = document.activeElement?.getAttribute("data-b");
    reader.destroy();
    return { first, skipped, revealed, far, mounted, focussed, actions };
  });
  expect(result).toMatchObject({
    first: "b_0",
    skipped: "b_2",
    revealed: "b_1",
    far: { focused: "b_850", window: { first: 16, last: 18 } },
    focussed: "b_850",
    actions: [],
  });
  expect(result.mounted).toBe(150);
});

test("first selection action retains normalized quote through mount; stale quote and workspace are refused", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader, restoreNativeSelection } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const html =
      '<div class="reader-root"><div class="blk" data-b="b_0" tabindex="-1"><div class="mb"><p>Cafe\u0301 東京 owns this <a class="mcite" data-cite="a.ts:1-1">excluded cite</a><button data-mx>excluded UI</button></p></div></div></div>';
    const block = {
      id: "b_0",
      hash: "a".repeat(16),
      section: "s3",
      html,
      kind: "paragraph",
      depth: "L1",
      readingSec: 1,
      freshness: "fresh",
      claimViews: [],
      threads: { open: 0 },
      origin: "ai",
      status: "ready",
      mdLine: 1,
    };
    const options = {
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks: [block] }], order: [block.id], total: 1 },
      ws: "ws_0123456789ab",
      level: "standard",
      text: { citeEnd: String, verifyLabel: "Check" },
    };
    main.innerHTML = html;
    const requests: { action: unknown; state: NativeReaderState }[] = [];
    const old = mountNativeReader({
      ...options,
      enhance: (action: unknown, state: NativeReaderState) => {
        requests.push({ action, state });
      },
    });
    const text = main.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    old.action("act.explain", new KeyboardEvent("keydown", { key: "e", code: "KeyE" }));
    const saved = requests[0];
    if (!saved) throw new Error("first selection action did not request enhancement");
    old.destroy();
    main.innerHTML = html;
    const enhanced = mountNativeReader({ ...options, initial: saved.state, enhance() {} });
    const restored = document.getSelection()?.toString();
    enhanced.destroy();
    main.innerHTML = html.replace("東京", "京都");
    const stale = restoreNativeSelection(main, saved.state.selection);
    const other = mountNativeReader({ ...options, ws: "ws_other", initial: saved.state, enhance() {} });
    const otherFocus = other.capture().focused;
    other.destroy();
    return { action: saved.action, selection: saved.state.selection, restored, stale: stale === null, otherFocus };
  });
  expect(result.action).toMatchObject({ kind: "compose", intent: "question", block: "b_0" });
  expect(result.selection).toMatchObject({ start: 0, end: 7, anchor: { doc: { quote: { exact: "Café 東京" } } } });
  expect(result.restored?.normalize("NFC")).toBe("Café 東京");
  expect(result.stale).toBe(true);
  expect(result.otherFocus).toBeNull();
});

test("idle fill accepts only unchanged canonical blocks, updates template aliases and read eligibility", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const empty = {
      id: "b_0",
      hash: "a".repeat(16),
      section: "s3",
      html: "",
      kind: "paragraph",
      depth: "L1",
      readingSec: 1,
      freshness: "fresh",
      claimViews: [],
      threads: { open: 0 },
      origin: "ai",
      status: "ready",
      mdLine: 1,
    };
    const alias = { ...empty };
    const offscreen = { ...empty, id: "b_1", status: "placeholder" };
    const offscreenAlias = { ...offscreen };
    main.innerHTML =
      '<div class="reader-root" data-reader-heights="[80,80]" data-window-first="0" data-window-last="0"><div data-reader-spacer="lead"></div><div class="bwin" data-window="0"><div class="blk" data-b="b_0" aria-busy="true" tabindex="-1"><div class="skel"></div></div><span class="read-mark" data-read="s3"></span></div><div data-reader-spacer="tail"></div><template data-reader-window="1"><div class="blk" data-b="b_1" aria-busy="true" tabindex="-1"><div class="skel"></div></div></template></div>';
    const reads: string[] = [];
    const actions: unknown[] = [];
    const reader = mountNativeReader({
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks: [empty, offscreen] }], order: [empty.id, offscreen.id], total: 2 },
      sourceBlocks: [alias, offscreenAlias],
      ws: "ws_0123456789ab",
      level: "standard",
      placeholderLabel: "Generate section",
      text: { citeEnd: String, verifyLabel: "Check" },
      enhance: (action: unknown) => actions.push(action),
      read: (section: string) => reads.push(section),
    });
    const next = { ...empty, html: '<div class="mb"><p>Canonical filled text</p></div>' };
    const wrongHash = reader.fill([{ ...next, hash: "b".repeat(16) }]);
    const wrongId = reader.fill([{ ...next, id: "b_unknown" }]);
    const mixed = reader.fill([next, { ...next, id: "b_unknown" }]);
    const untouched = empty.html === "";
    const filled = reader.fill([next, { ...offscreen, html: '<div class="mb"><p>Canonical template text</p></div>' }]);
    const html = main.querySelector(".blk")?.textContent;
    const busy = main.querySelector(".blk")?.hasAttribute("aria-busy");
    const templateText = main.querySelector<HTMLTemplateElement>("template")?.content.querySelector(".blk")?.textContent;
    reader.jump("b_1");
    const mountedText = main.querySelector('.blk[data-b="b_1"]')?.textContent;
    main.querySelector<HTMLButtonElement>('.blk[data-b="b_1"] button[data-ph]')?.click();
    for (let i = 0; i < 30 && !reads.length; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    reader.destroy();
    return {
      wrongHash,
      wrongId,
      mixed,
      untouched,
      filled,
      html,
      busy,
      templateText,
      mountedText,
      aliasHtml: alias.html,
      pageHtml: empty.html,
      templateAlias: offscreenAlias.html,
      reads,
      actions,
    };
  });
  expect(result).toMatchObject({
    wrongHash: false,
    wrongId: false,
    mixed: false,
    untouched: true,
    filled: true,
    html: "Canonical filled text",
    busy: false,
    templateText: "Canonical template textGenerate section",
    mountedText: "Canonical template textGenerate section",
  });
  expect(result.aliasHtml).toBe(result.pageHtml);
  expect(result.templateAlias).toContain("Canonical template text");
  expect(result.reads).toContain("s3");
  expect(result.actions).toEqual([{ kind: "placeholder", section: "s3" }]);
});

test("stream reservation survives refresh until offscreen; destroy cancels pending first-use hover", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const block = {
      id: "b_0",
      hash: "a".repeat(16),
      section: "s3",
      html: '<div class="mb"><p>Finished text</p></div>',
      kind: "paragraph",
      depth: "L1",
      readingSec: 1,
      freshness: "fresh",
      claimViews: [],
      threads: { open: 0 },
      origin: "ai",
      status: "ready",
      mdLine: 1,
    };
    const body = `<div class="sec-body" data-section="s3"><div class="blk" data-b="b_0" tabindex="-1">${block.html}</div></div><div style="height:1800px"></div>`;
    const options = {
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks: [block] }], order: [block.id], total: 1 },
      ws: "ws_0123456789ab",
      level: "standard",
      text: { citeEnd: String, verifyLabel: "Check" },
    };
    main.innerHTML = `<div class="reader-root">${body}</div>`;
    const stream = main.querySelector<HTMLElement>(".sec-body")!;
    stream.classList.add("mstream");
    stream.style.setProperty("--reserve", "400px");
    const old = mountNativeReader({ ...options, enhance() {} });
    const state = old.capture();
    old.destroy();
    main.innerHTML = `<div class="reader-root">${body}</div>`;
    const actions: unknown[] = [];
    const reader = mountNativeReader({ ...options, initial: state, enhance: (action: unknown) => actions.push(action) });
    const next = main.querySelector<HTMLElement>(".sec-body")!;
    const held = next.classList.contains("mstream") && next.getBoundingClientRect().height >= 400;
    window.scrollTo(0, 600);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const released = !next.classList.contains("mstream") && next.style.getPropertyValue("--reserve") === "";
    main.querySelector(".blk")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    reader.destroy();
    await new Promise((resolve) => setTimeout(resolve, 160));
    return { held, released, actions };
  });
  expect(result).toEqual({ held: true, released: true, actions: [] });
});

test("scroll anchor skips an unpainted subsection whose stale child rectangle overlaps the viewport", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const block = (id: string) => ({ id, html: `<div class="mb"><p>${id}</p></div>`, kind: "paragraph", depth: "L1", freshness: "fresh", claimViews: [] });
    const hidden = block("b_skipped");
    const visible = block("b_visible");
    main.innerHTML =
      '<div class="reader-root"><div style="height:2400px"></div><section style="content-visibility:auto;contain-intrinsic-size:auto 900px"><div class="blk" data-b="b_skipped" style="margin-top:1000px">Skipped text</div></section><section id="next"><div class="blk" data-b="b_visible">Visible text</div><div style="height:1800px"></div></section></div>';
    const reader = mountNativeReader({
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks: [hidden, visible] }], order: [hidden.id, visible.id], total: 2 },
      ws: "ws_0123456789ab",
      level: "standard",
      text: { citeEnd: String, verifyLabel: "Check" },
      enhance() {},
    });
    main.querySelector("#next")!.scrollIntoView({ block: "start" });
    const skipped = main.querySelector<HTMLElement>('[data-b="b_skipped"]')!;
    const state = reader.capture();
    const result = { skipped: !skipped.checkVisibility({ contentVisibilityAuto: true }), anchor: state.anchor?.id };
    reader.destroy();
    return result;
  });
  expect(result).toEqual({ skipped: true, anchor: "b_visible" });
});

test("partial text stays plain and survives same-page refresh; confirmed text clears it", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const node = { id: "s3", state: "partial", est: { outTokens: 3000 } };
    const markup = '<div class="reader-root"><div class="sec-body" data-section="s3"><span data-reader-partial="s3" hidden></span></div></div>';
    const options = {
      root: main,
      page: { page: "s3", parts: [{ node, blocks: [] }], order: [], total: 0 },
      ws: "ws_0123456789ab",
      level: "standard",
      text: { citeEnd: String, verifyLabel: "Check" },
      enhance() {},
    };
    main.innerHTML = markup;
    const old = mountNativeReader(options);
    const accepted = old.partial("s3", '<img src=x onerror="alert(1)"> streamed text');
    const exact = main.querySelector("p.partial")?.textContent;
    const onlyCaret = main.querySelector("p.partial")?.children.length === 1 && main.querySelector("p.partial img") === null;
    const reserved = main.querySelector<HTMLElement>(".sec-body")!.style.getPropertyValue("--reserve");
    const state = old.capture();
    old.destroy();
    main.innerHTML = markup;
    const refreshed = mountNativeReader({ ...options, initial: state });
    const retained = main.querySelector("p.partial")?.textContent;
    refreshed.partial("s3", "");
    const cleared = main.querySelector("p.partial") === null && refreshed.capture().partials.length === 0;
    const outside = refreshed.partial("s_other", "not present");
    refreshed.destroy();
    main.innerHTML = markup;
    node.state = "generated";
    const finished = mountNativeReader({ ...options, initial: state });
    const confirmed = main.querySelector("p.partial") === null;
    finished.destroy();
    return { accepted, exact, onlyCaret, reserved, retained, cleared, outside, confirmed };
  });
  expect(result).toMatchObject({ accepted: true, onlyCaret: true, reserved: "2400px", cleared: true, outside: false, confirmed: true });
  expect(result.retained).toBe(result.exact);
  expect(result.exact).toBe('<img src=x onerror="alert(1)"> streamed text');
});

test("hover leave and focus leave invalidate only their own first-use request", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = "/__native_reader_controller.js";
    const { mountNativeReader } = await import(path);
    const main = document.querySelector<HTMLElement>("main")!;
    const html =
      '<div class="mb"><p><abbr class="mterm" data-term="gl_00000000" tabindex="0">term</abbr><a class="mcite" data-cite="a.ts:1-1" href="#">cite</a></p></div>';
    const block = {
      id: "b_0",
      hash: "a".repeat(16),
      section: "s3",
      html,
      kind: "paragraph",
      depth: "L1",
      readingSec: 1,
      freshness: "fresh",
      claimViews: [],
      threads: { open: 0 },
      origin: "ai",
      status: "ready",
      mdLine: 1,
    };
    main.innerHTML = `<div class="reader-root"><div class="blk" data-b="b_0">${html}</div></div><button id="outside">outside</button>`;
    const actions: { kind: string; via?: string }[] = [];
    const cancellations: string[] = [];
    let hoverReady: () => void = () => {};
    const hover = new Promise<void>((resolve) => {
      hoverReady = resolve;
    });
    const reader = mountNativeReader({
      root: main,
      page: { page: "s3", parts: [{ node: { id: "s3" }, blocks: [block] }], order: [block.id], total: 1 },
      ws: "ws_0123456789ab",
      level: "standard",
      text: { citeEnd: String, verifyLabel: "Check" },
      enhance(action: { kind: string; via?: string }) {
        actions.push(action);
        if (action.kind === "term" && action.via === "hover") hoverReady();
      },
      cancelEnhance(via: string) {
        cancellations.push(via);
      },
    });
    const term = main.querySelector("abbr")!;
    const cite = main.querySelector<HTMLAnchorElement>("a.mcite")!;
    const outside = main.querySelector<HTMLButtonElement>("#outside")!;
    term.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await hover;
    term.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: outside }));
    cite.focus();
    cite.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: outside }));
    const beforeFocusLeave = [...cancellations];
    outside.focus();
    reader.destroy();
    return { termHover: actions.some((a) => a.kind === "term" && a.via === "hover"), beforeFocusLeave, cancellations };
  });
  expect(result).toEqual({ termHover: true, beforeFocusLeave: ["hover", "hover"], cancellations: ["hover", "hover", "focus"] });
});

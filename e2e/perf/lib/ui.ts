// UI measurements on the REAL daemon (testing spec §5.2 E2E-01/06/13, §6.4, §6.6), shared by the Playwright perf specs
// (`e2e/perf/*.spec.ts`, project `perf`) and the bench cases (`bench/ui.bench.ts`, so `bun run bench` / `bench:compare`
// cover ui.*). Plain TypeScript over a Playwright `Browser`: it runs under Playwright's Node worker and under Bun.
//
// A cold open is `mitori <repo> --no-open` spawned with a fresh MITORI_HOME (T0 = the spawn), its login URL opened in
// a warm Chromium; marks are read as absolute times (`performance.timeOrigin + startTime`) so they compare with T0.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";

export const REPO_ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../../..");

/** argv of mitori: the compiled binary when dist/ has one at least as new as the CLI entry (or MITORI_E2E_BINARY=compiled). */
export function mitoriArgv(): { argv: string[]; binary: "compiled" | "source" } {
  const bin = join(REPO_ROOT, `dist/mitori-${process.platform}-${process.arch}`);
  const main = join(REPO_ROOT, "apps/cli/src/main.ts");
  const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(main).mtimeMs;
  if (process.env.MITORI_E2E_BINARY === "compiled" || (process.env.MITORI_E2E_BINARY !== "source" && fresh)) return { argv: [bin], binary: "compiled" };
  return { argv: ["bun", main], binary: "source" };
}

export interface ColdOpen {
  /** Epoch ms of the spawn. */
  t0: number;
  url: string;
  origin: string;
  ws: string;
  page: Page;
  context: BrowserContext;
  daemon: { pid: number; port: number; token: string };
  /** Epoch ms of the first occurrence of a mark, or null. */
  markAt(name: string): Promise<number | null>;
  /** Wait for marks (all of them), epoch ms each. */
  waitMarks(names: readonly string[], timeoutMs?: number): Promise<number[]>;
  /** Authenticated (bearer) API call of the daemon. */
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** Stop the daemon, close the context, remove the home. */
  close(): Promise<void>;
}

const LOGIN = /(https?:\/\/127\.0\.0\.1:\d+\/\S*#\S+)/;

/** Collectors that must exist before the app's first script (buffered observers miss early entries otherwise). */
export const INIT_OBSERVERS = `(() => {
  window.__perf = { cls: 0, events: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.events.push({ id: e.interactionId || 0, name: e.name, d: e.duration, s: e.startTime }); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {}
})()`;

export async function coldOpen(browser: Browser, repo: string, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<ColdOpen> {
  const home = mkdtempSync(join(tmpdir(), "mitori-ui-home-"));
  const { argv } = mitoriArgv();
  const [exe, ...args] = argv as [string, ...string[]];
  const t0 = Date.now();
  const child = spawn(exe, [...args, repo, "--no-open"], {
    cwd: repo,
    env: { ...process.env, MITORI_HOME: home, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (out += d));
  const exited = new Promise<void>((r) => child.on("close", () => r()));
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let url = "";
  while (!url) {
    const m = LOGIN.exec(out);
    if (m) url = m[1] as string;
    else if (Date.now() > deadline || child.exitCode !== null) {
      child.kill("SIGKILL");
      rmSync(home, { recursive: true, force: true });
      throw new Error(`mitori printed no login URL: ${out.slice(-400)}`);
    } else await new Promise((r) => setTimeout(r, 10));
  }
  const reg = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { pid: number; port: number; token: string };
  const origin = `http://127.0.0.1:${reg.port}`;
  const ws = /\/w\/(ws_[a-z0-9]+)/.exec(decodeURIComponent(url))?.[1] ?? "";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  await page.addInitScript(INIT_OBSERVERS);
  await page.goto(url);
  const markAt = (name: string) =>
    page.evaluate((n) => {
      const m = performance.getEntriesByName(n, "mark")[0];
      return m ? performance.timeOrigin + m.startTime : null;
    }, name);
  return {
    t0,
    url,
    origin,
    ws,
    page,
    context,
    daemon: reg,
    markAt,
    async waitMarks(names, timeoutMs = 30_000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const at = await Promise.all(names.map((n) => markAt(n)));
        if (at.every((x) => x !== null)) return at as number[];
        if (Date.now() > end) throw new Error(`marks not reached in ${timeoutMs} ms: ${names.filter((_, i) => at[i] === null).join(", ")}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    async api<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await fetch(`${origin}/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${reg.token}`, "x-mitori-client": "cli/perf", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    async close() {
      await context.close().catch(() => undefined);
      try {
        process.kill(reg.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      const t = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await exited;
      clearTimeout(t);
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/* ----------------------------------------------------------------------------------------- E2E-01 first use */

export interface FirstUse {
  /** CLI spawn → `mitori:shell:painted`, ms (ui.shellPaint). */
  shellPaint: number;
  /** CLI spawn → map and facts both painted, ms (ui.firstUseful.100k). */
  firstUseful: number;
  /** DOM nodes of the first screen (part of ui.dom.typical). */
  dom: number;
  /** SVG nodes of the drawn map (ui.floorplan.nodes). */
  mapNodes: number;
  /** Boot CLS (ui.cls.boot). */
  cls: number;
}

export async function firstUse(o: ColdOpen): Promise<FirstUse> {
  const [shell, map, facts] = await o.waitMarks(["mitori:shell:painted", "mitori:map:painted", "mitori:facts:painted"]);
  await o.page.waitForTimeout(300); // late layout shifts count
  return {
    shellPaint: (shell as number) - o.t0,
    firstUseful: Math.max(map as number, facts as number) - o.t0,
    dom: await domNodes(o.page),
    // the floor plan is one `svg.plan` (map/render.ts): the element itself and everything under it
    mapNodes: await o.page.evaluate(() => document.querySelectorAll("svg.plan, svg.plan *").length),
    cls: await o.page.evaluate(() => (window as unknown as { __perf: { cls: number } }).__perf.cls),
  };
}

export const domNodes = (page: Page): Promise<number> => page.evaluate(() => document.getElementsByTagName("*").length);

/* ------------------------------------------------------------------------------------------------ Reader */

/** The biggest section of the doc (most blocks), from the outline API. */
export async function biggestSection(o: ColdOpen): Promise<string> {
  const outline = await o.api<{ sections?: { id: string; blocks?: unknown[]; blockCount?: number }[] }>("GET", `/ws/${o.ws}/doc`);
  const secs = (outline.sections ?? []).map((s) => ({ id: s.id, n: s.blockCount ?? s.blocks?.length ?? 0 }));
  secs.sort((a, b) => b.n - a.n);
  return secs[0]?.id ?? "s3";
}

export interface ReaderOpen {
  /** navigation → `mitori:section:rendered`, ms. */
  rendered: number;
  /** DOM nodes once rendered (ui.dom.typical). */
  dom: number;
  /** Requests of the open (ui.fetch.readerOpen: document, scripts, styles, API, the SSE stream). */
  requests: number;
  urls: string[];
}

export async function readerOpen(o: ColdOpen, section: string, page: Page = o.page): Promise<ReaderOpen> {
  const urls: string[] = [];
  const on = (r: Request) => {
    if (!/^(data|blob):/.test(r.url())) urls.push(r.url());
  };
  page.on("request", on);
  try {
    const t0 = Date.now();
    await page.goto(`${o.origin}/w/${o.ws}/doc/${section}`);
    await page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0, undefined, { timeout: 30_000, polling: 16 });
    const rendered =
      (await page.evaluate(() => performance.timeOrigin + (performance.getEntriesByName("mitori:section:rendered", "mark")[0]?.startTime ?? 0))) - t0;
    await page.waitForTimeout(800); // idle-time fetches (prefetch, minimap) belong to the open
    return { rendered, dom: await domNodes(page), requests: urls.length, urls: [...urls] };
  } finally {
    page.off("request", on);
  }
}

/* ------------------------------------------------------------------------- input → mark latencies (§6.6) */

/**
 * Press `key` and return the latency to the next occurrence of `mark`: `mark.startTime − detail.trigger` when the app
 * recorded the input's timeStamp, else `mark.startTime − performance.now()` taken right before the press.
 */
export async function keyToMark(page: Page, key: string, mark: string, timeoutMs = 5_000): Promise<number> {
  const before = await page.evaluate((m) => ({ now: performance.now(), n: performance.getEntriesByName(m, "mark").length }), mark);
  await page.keyboard.press(key);
  const h = await page.waitForFunction(
    ([m, n]) => {
      const all = performance.getEntriesByName(m as string, "mark");
      return all.length > (n as number) ? all[all.length - 1] : null;
    },
    [mark, before.n] as const,
    { timeout: timeoutMs, polling: 8 },
  );
  const e = (await h.jsonValue()) as { startTime: number; detail?: { trigger?: number } | null };
  const trigger = e.detail?.trigger;
  return e.startTime - (typeof trigger === "number" && trigger >= before.now - 1 ? trigger : before.now);
}

export interface LevelSwitch {
  /** `-` `=` `=` `0` latencies, ms (ui.level). */
  ms: number[];
  /** Requests made while switching (ui.fetch.levelSwitch, max 0). */
  requests: number;
}

export async function levelSwitch(page: Page, rounds = 3): Promise<LevelSwitch> {
  await page.waitForTimeout(500);
  let requests = 0;
  const on = () => void requests++;
  page.on("request", on);
  const ms: number[] = [];
  try {
    for (let r = 0; r < rounds; r++) for (const k of ["-", "=", "=", "0"]) ms.push(await keyToMark(page, k, "mitori:level:applied"));
  } finally {
    page.off("request", on);
  }
  return { ms, requests };
}

/** ⌘K, then type `text` one key at a time: per-key latency to `mitori:palette:results` (ui.palette). */
export async function paletteKeys(page: Page, text = "server"): Promise<number[]> {
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".pal input[role=combobox]").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(300);
  const ms: number[] = [];
  for (const ch of text) ms.push(await keyToMark(page, ch, "mitori:palette:results"));
  await page.keyboard.press("Escape");
  return ms;
}

/** `j` / `k` on the Reader: latency to `mitori:shortcut:handled` (ui.shortcut). */
export async function shortcutKeys(page: Page, n = 10): Promise<number[]> {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) ms.push(await keyToMark(page, i % 3 === 2 ? "k" : "j", "mitori:shortcut:handled"));
  return ms;
}

/** Section transitions through the Reader's own TOC links: click → `mitori:section:rendered` (ui.section). */
export async function sectionNav(page: Page, n = 6): Promise<number[]> {
  const links = page.locator('a[href*="/doc/s"]');
  const count = Math.min(n, await links.count());
  const ms: number[] = [];
  for (let i = 0; i < count; i++) {
    const link = links.nth(i % Math.max(1, count));
    if (!(await link.isVisible())) continue;
    const before = await page.evaluate(() => ({ now: performance.now(), n: performance.getEntriesByName("mitori:section:rendered", "mark").length }));
    await link.click();
    const h = await page
      .waitForFunction((k) => performance.getEntriesByName("mitori:section:rendered", "mark").length > k, before.n, { timeout: 5_000, polling: 8 })
      .catch(() => null);
    if (!h) continue; // the link was the current section: no render
    const at = await page.evaluate(() => {
      const all = performance.getEntriesByName("mitori:section:rendered", "mark");
      return all[all.length - 1]?.startTime ?? 0;
    });
    ms.push(at - before.now);
  }
  return ms;
}

/* ------------------------------------------------------------------------------------------------- INP */

export interface Inp {
  count: number;
  reported: number;
  p75: number;
  p98: number;
}

/**
 * An interaction scenario (§6.6, the parts a static doc has): level switches, j/k, ⌘K + typing + Esc, section links.
 * Every interaction's duration = its longest event-timing entry; unreported ones (< 16 ms) count as 16 ms.
 */
export async function inpScenario(page: Page): Promise<Inp> {
  await page.evaluate(() => {
    (window as unknown as { __perf: { events: unknown[] } }).__perf.events = [];
  });
  let performed = 0;
  for (const k of ["-", "=", "=", "0", "-", "0"]) {
    await page.keyboard.press(k);
    performed++;
    await page.waitForTimeout(40);
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 ? "k" : "j");
    performed++;
    await page.waitForTimeout(30);
  }
  for (let r = 0; r < 3; r++) {
    await page.keyboard.press("ControlOrMeta+k");
    performed++;
    await page.waitForTimeout(150);
    for (const ch of "parse") {
      await page.keyboard.type(ch);
      performed++;
      await page.waitForTimeout(30);
    }
    await page.keyboard.press("Escape");
    performed++;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);
  const raw = await page.evaluate(() => (window as unknown as { __perf: { events: { id: number; d: number }[] } }).__perf.events);
  const best = new Map<number, number>();
  for (const e of raw) if (e.id > 0) best.set(e.id, Math.max(best.get(e.id) ?? 0, e.d));
  const durations = [...best.values()];
  const padded = [...durations, ...Array.from({ length: Math.max(0, performed - durations.length) }, () => 16)].sort((a, b) => a - b);
  const pct = (p: number) => padded[Math.min(padded.length - 1, Math.max(0, Math.ceil((p / 100) * padded.length) - 1))] as number;
  return { count: padded.length, reported: durations.length, p75: pct(75), p98: pct(98) };
}

/** JS heap after a full GC (CDP), MB (ui.heap.10k). Chromium only. */
export async function heapMB(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const h = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  await cdp.detach();
  return h.usedSize / 1_000_000;
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export const p95 = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : (s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] as number);
};

/** Maximum-state measurements shared by Bun bench and Playwright's Node worker; all content comes from a real daemon. */
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { domNodes, INIT_OBSERVERS, keyToMark, networkQuiet, p95, REPO_ROOT } from "./ui.ts";

interface Seed {
  url: string;
  origin: string;
  ws: string;
  token: string;
  review: string;
  diffLines: number;
  docBlocks: number;
  deepSection: string;
  sections: string[];
  codeLines: number;
}

export interface MaxOpen extends Omit<Seed, "token" | "url"> {
  page: Page;
  context: BrowserContext;
  api<T>(path: string): Promise<T>;
  close(): Promise<void>;
}

export async function openMax(browser: Browser, codeOnly = false): Promise<MaxOpen> {
  const child = spawn("bun", [join(REPO_ROOT, "e2e/perf/lib/max-daemon.ts"), ...(codeOnly ? ["--code-only"] : [])], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.setEncoding("utf8").on("data", (s: string) => (out += s));
  child.stderr.setEncoding("utf8").on("data", (s: string) => (out += s));
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  let context: BrowserContext | null = null;
  const stop = async () => {
    await context?.close();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const code = await exited;
      if (code !== 0) throw new Error(`max-state daemon exited ${code}: ${out.replace(/MITORI_MAX_READY .*\n?/g, "").slice(-1500)}`);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const deadline = Date.now() + 90_000;
    let seed: Seed | null = null;
    while (!seed) {
      const line = out.split("\n").find((s) => s.startsWith("MITORI_MAX_READY "));
      if (line) seed = JSON.parse(line.slice("MITORI_MAX_READY ".length)) as Seed;
      else if (Date.now() > deadline || child.exitCode !== null) throw new Error(`max-state daemon not ready: ${out.slice(-1500)}`);
      else await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (seed.codeLines !== 20_000 || (!codeOnly && (seed.docBlocks !== 1000 || seed.sections.length !== 20 || seed.diffLines < 5000)))
      throw new Error("max-state fixture counts are wrong");
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const page = await context.newPage();
    await page.addInitScript(INIT_OBSERVERS);
    await page.goto(seed.url);
    // load fires before the async nonce exchange. Do not interrupt login with the first measured navigation.
    await page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0);
    return {
      origin: seed.origin,
      ws: seed.ws,
      review: seed.review,
      diffLines: seed.diffLines,
      docBlocks: seed.docBlocks,
      deepSection: seed.deepSection,
      sections: seed.sections,
      codeLines: seed.codeLines,
      page,
      context,
      api: async <T>(path: string): Promise<T> => {
        const res = await fetch(`${seed.origin}/api/v1/ws/${seed.ws}${path}`, {
          headers: { authorization: `Bearer ${seed.token}`, "x-mitori-client": "cli/perf" },
        });
        if (!res.ok) throw new Error(`perf API ${path}: ${res.status}`);
        return (await res.json()) as T;
      },
      close: stop,
    };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}

async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function reader(o: MaxOpen, section: string): Promise<void> {
  await o.page.goto(`${o.origin}/w/${o.ws}/doc/${section}`);
  await o.page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0);
}

/** Keydown → the next rendering frame, with the focused block checked in that frame; 4× CPU throughout the inputs. */
export async function inputRender1000(o: MaxOpen): Promise<{ p95: number; ms: number[]; blocks: number; cpuRate: number }> {
  // Register before the app's window capture handler; a document listener would see focus after the shortcut ran.
  await o.page.addInitScript(() => {
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "j" && e.key !== "k") return;
        const previous = document.activeElement?.getAttribute("data-b");
        requestAnimationFrame(() => {
          const next = document.activeElement?.getAttribute("data-b");
          if (next && next !== previous && document.querySelector(`.blk.focus[data-b="${CSS.escape(next)}"]`))
            performance.mark("mitori:bench:input-render", { detail: { trigger: e.timeStamp } });
        });
      },
      true,
    );
  });
  await reader(o, "s7");
  // The block hash sets both Reader's keyboard cursor and DOM focus, unlike an external element.focus().
  const first = await o.page.locator(".blk[data-kind='prose']").first().getAttribute("data-b");
  if (!first) throw new Error("1,000-block fixture has no rendered prose");
  await o.page.goto(`${o.origin}/w/${o.ws}/doc/s7#${first}`);
  await o.page.waitForFunction((id) => document.activeElement?.getAttribute("data-b") === id, first);
  await networkQuiet(o.page);
  await painted(o.page);
  const cdp = await o.page.context().newCDPSession(o.page);
  const ms: number[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let i = 0; i < 30; i++) ms.push(await keyToMark(o.page, i % 3 === 2 ? "k" : "j", "mitori:bench:input-render"));
    return { p95: p95(ms), ms, blocks: o.docBlocks, cpuRate: 4 };
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }
}

/** A real ready patch, lazy CM6 mounted, sampled while scrolling; no accept/reject operation is sent. */
export async function reviewDom5000(o: MaxOpen): Promise<{ max: number; samples: number[]; diffLines: number }> {
  await o.page.goto(`${o.origin}/w/${o.ws}/review/${o.review}`);
  await o.page.waitForFunction(() =>
    performance.getEntriesByName("mitori:review:diff-mounted", "mark").some((e) => (e as PerformanceMark).detail?.cm6 === true),
  );
  const samples: number[] = [];
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    await o.page.locator(".cm-scroller").evaluateAll((els, f) => {
      for (const el of els) el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    }, fraction);
    await painted(o.page);
    samples.push(await domNodes(o.page));
  }
  const job = await o.api<{ state: string }>(`/jobs/${o.review}`);
  if (job.state !== "ready") throw new Error("review benchmark must leave the job ready for human review");
  return { max: Math.max(...samples), samples, diffLines: o.diffLines };
}

export async function maxDom(o: MaxOpen): Promise<{ max: number; states: Record<string, number>; sections: number; inboxThreads: number; diffLines: number }> {
  const states: Record<string, number> = {};
  for (const sec of o.sections) {
    await reader(o, sec);
    states[`section:${sec}`] = await domNodes(o.page);
  }
  await reader(o, o.deepSection);
  await o.page.keyboard.press("=");
  await o.page.keyboard.press("=");
  const deep = o.page.locator("details.mdeep").first();
  await deep.waitFor();
  await deep.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await painted(o.page);
  if (!(await deep.evaluate((el) => (el as HTMLDetailsElement).open && el.getBoundingClientRect().height > 0)))
    throw new Error("DOM budget must include an opened, visible DeepDive");
  states.deepDive = await domNodes(o.page);
  await o.page.goto(`${o.origin}/w/${o.ws}/inbox?f=all`);
  await o.page.waitForFunction(() => document.querySelectorAll("[role='listbox'] [data-id^='th_']").length >= 500);
  const inboxThreads = await o.page.locator("[role='listbox'] [data-id^='th_']").count();
  states.inbox500 = await domNodes(o.page);
  states.review5000 = (await reviewDom5000(o)).max;
  return { max: Math.max(...Object.values(states)), states, sections: o.sections.length, inboxThreads, diffLines: o.diffLines };
}

/** Server-highlighted windows in a 20,000-line file, at start/middle/end and while scrolling each mounted window. */
export async function mountedCodeLines(o: MaxOpen): Promise<{ max: number; samples: number[]; totalLines: number }> {
  const samples: number[] = [];
  for (const line of [1, 5000, 10_000, 15_000, 20_000]) {
    await o.page.goto(`${o.origin}/w/${o.ws}/code/src/large.ts#L${line}-L${line}`);
    await o.page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0);
    for (const fraction of [0, 0.5, 1]) {
      await o.page.locator("pre.mcode").evaluate((el, f) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * f), fraction);
      await painted(o.page);
      const n = await o.page.locator(".cm-line, pre.mcode .line, [data-line]").count();
      if (n < 1) throw new Error("code budget must measure mounted code, not an empty page");
      samples.push(n);
    }
  }
  return { max: Math.max(...samples), samples, totalLines: o.codeLines };
}

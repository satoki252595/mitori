/**
 * M1 measurements + screenshots (WP-INT step 4): the compiled binary on real repos, the browser = installed Google
 * Chrome (Playwright channel "chrome", 1440×900). For each repo, cold runs (fresh MITORI_HOME, fresh local clone):
 *   t_index = spawn → "mitori: open <url>" on stderr (S0–S4 + zero-token doc),
 *   shell   = navigation → `mitori:shell:painted`, map / toc = → `mitori:map:painted` / `mitori:toc:painted`,
 *   facts   = → the MapPage `GET /facts` response, first useful screen = t_index + max(map, toc, facts).
 * Screenshots (crit): first useful screen light + dark, reader with static sections, ⌘K palette, and a fake-engine
 * generation in progress (in-process daemon with the scenario claude, slowed down).
 *
 *   scripts/nd bun test/int/shots/m1.ts --repo crit=<dir> --repo m3e-canvas=<dir> --repo go-small=<dir> [--runs 3]
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { GenEstimate } from "@mitori/core";
import { type Browser, chromium, type Page } from "@playwright/test";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../fake-claude.ts";
import { startInt } from "../harness.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const OUT = join(ROOT, "docs/progress/m1");
const BIN = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const args = process.argv.slice(2);
const repos: [string, string][] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--repo") repos.push((args[++i] as string).split("=") as [string, string]);
const runs = Number(args[args.indexOf("--runs") + 1] ?? 3) || 3;
/** `--gen-only`: only the generation-in-progress screenshots (measurements.json is left alone). */
const genOnly = args.includes("--gen-only");

interface Run {
  repo: string;
  tIndexMs: number;
  shellMs: number;
  mapMs: number;
  tocMs: number;
  factsMs: number;
  firstScreenMs: number;
  stderr: string;
}

/** A fresh copy: a local clone for git repos (tracked files, no `.mitori/` from earlier runs), else the dir itself. */
function freshCopy(src: string): { root: string; cleanup: () => void } {
  const top = Bun.spawnSync(["git", "-C", src, "rev-parse", "--show-toplevel"]);
  if (!top.success || top.stdout.toString().trim() !== realpathSync(src)) return { root: src, cleanup: () => undefined };
  const dir = mkdtempSync(join(tmpdir(), "mitori-m1-"));
  const root = join(dir, basename(src));
  const r = Bun.spawnSync(["git", "clone", "-q", "--local", src, root]);
  if (!r.success) throw new Error(`clone ${src}: ${r.stderr}`);
  return { root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function marks(page: Page, names: string[], timeout = 15_000): Promise<Record<string, number>> {
  await page.waitForFunction((n) => n.every((x) => performance.getEntriesByName(x).length > 0), names, { timeout });
  return page.evaluate((n) => Object.fromEntries(n.map((x) => [x, performance.getEntriesByName(x)[0]?.startTime ?? -1])), names);
}

async function coldRun(browser: Browser, name: string, src: string, shoot: boolean): Promise<Run> {
  const copy = freshCopy(src);
  const home = mkdtempSync(join(tmpdir(), "mitori-m1-home-"));
  const t0 = performance.now();
  const proc = Bun.spawn([BIN, copy.root, "--no-open"], { env: { ...process.env, MITORI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  let err = "";
  let loginUrl = "";
  let tIndex = 0;
  for await (const c of proc.stderr as ReadableStream<Uint8Array>) {
    err += new TextDecoder().decode(c);
    const m = /mitori: open (\S+)/.exec(err);
    if (m) {
      loginUrl = m[1] as string;
      tIndex = performance.now() - t0;
      break;
    }
  }
  if (!loginUrl) throw new Error(`${name}: no login URL\n${err}`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(loginUrl);
  const m = await marks(page, ["mitori:shell:painted", "mitori:map:painted", "mitori:toc:painted"]);
  await page.waitForResponse((r) => /\/api\/v1\/ws\/[^/]+\/facts/.test(r.url()), { timeout: 10_000 }).catch(() => null);
  const facts = await page.evaluate(
    () => (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).find((e) => /\/api\/v1\/ws\/[^/]+\/facts/.test(e.name))?.responseEnd ?? -1,
  );
  const run: Run = {
    repo: name,
    tIndexMs: Math.round(tIndex),
    shellMs: Math.round(m["mitori:shell:painted"] ?? -1),
    mapMs: Math.round(m["mitori:map:painted"] ?? -1),
    tocMs: Math.round(m["mitori:toc:painted"] ?? -1),
    factsMs: Math.round(facts),
    firstScreenMs: 0,
    stderr: err.trim().replace(/#n=[^&\s]+/g, "#n=<nonce>"),
  };
  run.firstScreenMs = Math.round(tIndex + Math.max(run.mapMs, run.tocMs, run.factsMs));
  if (shoot) {
    await page.waitForTimeout(1200); // estimates + fonts settle
    await page.screenshot({ path: join(OUT, `${name}-01-first-screen-light.png`) });
    const ws = /\/w\/(ws_[0-9a-z]{12})/.exec(page.url())?.[1] as string;
    await page.keyboard.press("Meta+K");
    await page.waitForTimeout(600);
    await page.keyboard.type("config");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${name}-04-palette.png`) });
    await page.keyboard.press("Escape");
    await page.goto(new URL(`/w/${ws}/doc/s4`, page.url()).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${name}-03-reader-static.png`) });
    await page.goto(new URL(`/w/${ws}/doc/s8`, page.url()).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${name}-03b-reader-interfaces.png`) });
    const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", storageState: await ctx.storageState() });
    const dp = await dark.newPage();
    await dp.goto(new URL(`/w/${ws}`, page.url()).href);
    await marks(dp, ["mitori:map:painted"]).catch(() => null);
    await dp.waitForTimeout(1500);
    await dp.screenshot({ path: join(OUT, `${name}-02-first-screen-dark.png`) });
    await dark.close();
  }
  await ctx.close();
  proc.kill("SIGTERM");
  await proc.exited;
  rmSync(home, { recursive: true, force: true });
  copy.cleanup();
  return run;
}

/** In-process daemon with the scenario claude, slowed so a screenshot catches the run streaming. */
async function generationShot(browser: Browser, src: string): Promise<void> {
  const copy = freshCopy(src);
  const int = await startInt({ spawner: fakeClaude({ dtMs: 60, chunkChars: 4, speed: 1 }), config: FAKE_CLAUDE_CONFIG });
  try {
    const { ws } = await int.open(copy.root);
    const est = await int.json<GenEstimate>("POST", `/ws/${ws}/gen/estimate`, { effort: "standard" });
    await int.json("POST", `/ws/${ws}/gen/runs`, { estimateId: est.id, confirm: true });
    const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}` });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();
    await page.goto(nonce.url);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: join(OUT, "crit-05-generation-map.png") });
    await page.goto(new URL(`/w/${ws}/doc/s6`, page.url()).href);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, "crit-05b-generation-reader.png") });
    await ctx.close();
  } finally {
    await int.close();
    copy.cleanup();
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: Run[] = [];
try {
  for (const [name, dir] of genOnly ? [] : repos)
    for (let i = 0; i < runs; i++) {
      const r = await coldRun(browser, name, dir, i === 0 && name === "crit");
      results.push(r);
      console.log(JSON.stringify({ ...r, stderr: undefined }));
    }
  const crit = repos.find(([n]) => n === "crit");
  if (crit) await generationShot(browser, crit[1]);
} finally {
  await browser.close();
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? -1;
const summary = Object.fromEntries(
  repos.map(([name]) => {
    const rs = results.filter((r) => r.repo === name);
    return [
      name,
      Object.fromEntries((["tIndexMs", "shellMs", "mapMs", "tocMs", "factsMs", "firstScreenMs"] as const).map((k) => [k, median(rs.map((r) => r[k]))])),
    ];
  }),
);
if (!genOnly)
  writeFileSync(
    join(OUT, "measurements.json"),
    `${JSON.stringify({ at: new Date().toISOString(), machine: process.arch, runs, summary, results }, null, 2)}\n`,
  );
console.log(JSON.stringify(summary, null, 2));

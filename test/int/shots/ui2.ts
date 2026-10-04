/**
 * UI leftovers drive (remaining-backlog pass, track ui): the newcomer / expert leftovers through the REAL web UI
 * (installed Google Chrome via Playwright, 1440×900), the in-process daemon and — where a job runs — the scripted
 * claude of `ux-router.ts` (zero tokens). The document is a GENERATED one: a scratch copy of m3e-canvas with its
 * `.mitori/` (real-engine output, docs/progress/dogfood2), so the Reader shows what a user would read.
 *
 *   scripts/nd bun scripts/gen-assets.ts && scripts/nd bun test/int/shots/ui2.ts [--out docs/progress/ui2] [--only a,b]
 *     MITORI_UI2_REPO=<a repo with .mitori/> overrides the m3e-canvas checkout (else $MITORI_REFS/m3e-canvas, else ~/.cache/mitori-corpus/m3e-canvas*)
 *
 * Every check throws; timings and the HTTP errors seen are printed as JSON. Exit 77 = no Chrome, 78 = no repo.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { synth } from "@mitori/agent/testing";
import { chromium, type Page } from "@playwright/test";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../fake-claude.ts";
import { startInt } from "../harness.ts";
import { routeUx } from "../ux-router.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = resolve(ROOT, opt("--out", join(tmpdir(), "mitori-ui2")) as string);
const ONLY = new Set((opt("--only", "") as string).split(",").filter(Boolean));
/** The m3e-canvas checkout: $MITORI_UI2_REPO, $MITORI_REFS/m3e-canvas, or the corpus cache of `bun run corpus:fetch`. */
function sourceRepo(): string {
  if (process.env.MITORI_UI2_REPO) return process.env.MITORI_UI2_REPO;
  if (process.env.MITORI_REFS) return join(process.env.MITORI_REFS, "m3e-canvas");
  const cache = join(homedir(), ".cache/mitori-corpus");
  const hit = existsSync(cache) ? readdirSync(cache).find((f) => f === "m3e-canvas" || f.startsWith("m3e-canvas@")) : undefined;
  return hit ? join(cache, hit) : join(cache, "m3e-canvas");
}
const SRC = sourceRepo();
mkdirSync(OUT, { recursive: true });
// a failure shot of an earlier run is not evidence of this one
for (const f of readdirSync(OUT)) if (/^ui2-FAILED-/.test(f)) rmSync(join(OUT, f));
const log = (...a: unknown[]) => console.error("[ui2]", ...a);
const steps: Record<string, unknown> = {};
const ms = (t0: number) => Math.round(performance.now() - t0);
const check = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`check failed: ${what}`);
};
const want = (name: string) => ONLY.size === 0 || ONLY.has(name);

if (!existsSync(join(SRC, "package.json"))) {
  console.error(`[ui2] ${SRC} is not a checkout of m3e-canvas (set MITORI_UI2_REPO or MITORI_REFS, or bun run corpus:fetch --only m3e-canvas)`);
  process.exit(78);
}
let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch (e) {
  console.error("[ui2] Google Chrome is not available:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(77);
}

// a scratch copy: opening writes `.mitori/` state and the corpus is shared. Like a checkout of a repo whose doc was
// generated elsewhere (e2e/export/support/prepare.ts): the manifest first, the prose once the index is ready — a
// doc read before the first scan has nothing to stamp its cite links against.
const scratch = mkdtempSync(join(tmpdir(), "mitori-ui2-repo-"));
const repoRoot = join(scratch, "repo");
cpSync(SRC, repoRoot, { recursive: true });
const DOGFOOD = process.env.MITORI_UI2_DOC ?? join(ROOT, "docs/progress/dogfood2/m3e-canvas/doc");
const MANIFEST = join(ROOT, "docs/progress/dogfood/m3e-canvas/mitori.json");
const generated = !process.env.MITORI_UI2_REPO && existsSync(DOGFOOD) && existsSync(MANIFEST);
if (generated) {
  rmSync(join(repoRoot, ".mitori"), { recursive: true, force: true });
  mkdirSync(join(repoRoot, ".mitori"), { recursive: true });
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;
  // the dogfood2 run (gen-report: standard effort, $0.69); the UI only reads that it is generated and what it cost
  m.generatedAt = "2026-10-04T06:00:00.000Z";
  m.effort = "standard";
  m.usageTotals = { apiUsd: 0.69, cacheRead: 270773, cacheWrite: 182326, calls: 21, in: 33100, out: 27046 };
  writeFileSync(join(repoRoot, ".mitori/mitori.json"), `${JSON.stringify(m, null, 2)}\n`);
}
const int = await startInt({
  spawner: fakeClaude({
    dtMs: 30,
    chunkChars: 8,
    speed: 1,
    respond(prompt, spec) {
      const r = routeUx(prompt);
      if (!r) return null;
      const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
      return r.kind === "answer" ? synth.text(r.text, { model, dtMs: 30 }) : synth.text("", { model, dtMs: 30, structured: r.patch });
    },
  }),
  config: FAKE_CLAUDE_CONFIG,
});
const opened = await int.open(repoRoot);
const ws = opened.ws;
steps.open = { ms: opened.ms };
if (generated) {
  cpSync(DOGFOOD, join(repoRoot, ".mitori/doc"), { recursive: true, force: true });
  // the watcher reloads the doc: wait until §0 carries the generated prose
  const t0 = performance.now();
  for (;;) {
    const s0 = await int.json<{ blocks: { kind: string; status: string }[] }>("GET", `/ws/${ws}/doc/sections/s0`).catch(() => null);
    if (s0?.blocks.some((b) => b.kind === "prose" && b.status !== "placeholder")) break;
    if (performance.now() - t0 > 20_000) throw new Error("the generated doc never arrived");
    await new Promise((r) => setTimeout(r, 150));
  }
  steps.docArrivedMs = ms(t0);
}
const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}/doc/s0` });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "ja-JP", acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors: string[] = [];
const badResponses: string[] = [];
const posts: string[] = [];
let phase = "start";
page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${phase}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => consoleErrors.push(`[${phase}] pageerror ${e.message.slice(0, 200)}`));
page.on("request", (r) => {
  const u = r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/ws\/ws_\w+/, "");
  if (r.method() !== "GET") posts.push(`${r.method()} ${u}`);
  else if (process.env.UI2_DEBUG && u.includes("/doc/")) console.error("[ui2] GET", u);
});
page.on("response", async (r) => {
  if (r.status() < 400) return;
  badResponses.push(`[${phase}] ${r.status()} ${r.request().method()} ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, "")}`);
});
const shot = async (p: Page, name: string) => {
  await p.screenshot({ path: join(OUT, `${name}.png`) });
  log("shot", name);
};
const mod = process.platform === "darwin" ? "Meta" : "Control";

async function waitSection(p: Page): Promise<void> {
  await p.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered").length > 0, null, { timeout: 15_000 });
}

try {
  phase = "boot";
  await page.goto(nonce.url);
  await page.waitForURL(/\/w\/ws_\w+\/doc\/s0/);
  await waitSection(page);
  await page.waitForTimeout(400);

  // ------------------------------------------------------------------ NC-08 first run: 初めて + the 5-minute course
  if (want("firstrun")) {
    phase = "firstrun";
    const level = await page.evaluate(() => document.documentElement.dataset.level);
    check(level === "newcomer", `a first visit reads at 初めて (${level})`);
    await page.locator(".welcome").waitFor();
    const railTitle = await page.locator(".rail .path-t").first().innerText();
    check(/分コース\s+0 \/ 4/.test(railTitle), `the rail follows the 5-minute course: 4 stops (${railTitle})`);
    await shot(page, "ui2-06-first-run-welcome");
    // read the course: each stop counts once its END passes into view (NC-15), the rail ends with the next course
    const t0 = performance.now();
    for (const sec of ["s0", "s1", "s2", "s3"]) {
      if (sec !== "s0") {
        await page.goto(page.url().replace(/\/doc\/[^#?]+.*$/, `/doc/${sec}`));
        await waitSection(page);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(350);
    }
    steps.courseMs = ms(t0);
    const done = await page.locator(".rail .path-t").first().innerText();
    check(/読了/.test(done), `the rail says the course is finished (${done})`);
    const nextCourse = await page.locator(".rail .path-next").first().innerText();
    check(/30分コース|分コース/.test(nextCourse), `and offers the next course (${nextCourse})`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(".rail .path-t").first().click();
    await page.locator("#path-stops").waitFor();
    await shot(page, "ui2-07-course-done-stops");
    await page.keyboard.press("Escape");
    // NC-13: 「この画面でできること」 on the Reader
    await page.keyboard.press("?");
    await page.locator("dialog.help .guide").waitFor();
    const guide = await page.locator("dialog.help .guide li .gt").allInnerTexts();
    check(guide.length === 3 && /文を選んで/.test(guide[1] ?? ""), `the Reader's three steps (${guide.join(" | ")})`);
    await page.waitForTimeout(200);
    await shot(page, "ui2-08-help-reader");
    await page.keyboard.press("Escape");
    await page.goto(page.url().replace(/\/doc\/[^#?]+.*$/, "/doc/s0"));
    await waitSection(page);
  }

  // ------------------------------------------------------------------ NC-09 full text + 「AI に聞く」
  if (want("fulltext")) {
    phase = "fulltext";
    await page.keyboard.press(`${mod}+k`);
    await page.locator(".pal input").waitFor();
    await page.locator(".pal-it").first().waitFor();
    const empty = await page.locator(".pal-g").allInnerTexts();
    check(empty.includes("はじめに"), `the empty palette suggests where to start (${empty.join("|")})`);
    await shot(page, "ui2-01-palette-empty");

    const q = "起動方法は？";
    const t0 = performance.now();
    await page.keyboard.type(q);
    await page.locator(".pal-it.txt").first().waitFor({ timeout: 10_000 });
    steps.fulltextFirstQueryMs = ms(t0);
    const groups = await page.locator(".pal-g").allInnerTexts();
    check(groups.includes("本文"), `「本文」 group for a natural question (${groups.join("|")})`);
    check(await page.locator(".pal-it.ask").count(), "「AI に聞く」 row");
    await page.waitForTimeout(150);
    await shot(page, "ui2-02-palette-fulltext");

    // Enter on the first full-text row: the Reader opens that block and marks the words
    const rows = page.locator(".pal-it");
    const n = await rows.count();
    let idx = -1;
    for (let i = 0; i < n; i++) if ((await rows.nth(i).getAttribute("class"))?.includes("txt")) idx = idx < 0 ? i : idx;
    for (let i = 0; i < idx; i++) await page.keyboard.press("ArrowDown");
    const t1 = performance.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.has("mitori-find"), null, { timeout: 10_000 });
    steps.fulltextJumpMs = ms(t1);
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.b ?? null);
    check(focused?.startsWith("b_"), `the hit's block is focused (${focused})`);
    await page.waitForTimeout(250);
    await shot(page, "ui2-03-fulltext-jump");

    // a question the document does not answer: 「AI に聞く」 leads, Enter opens Explain with the text, nothing is sent
    await page.keyboard.press(`${mod}+k`);
    await page.locator(".pal input").waitFor();
    const ask = "認証トークンの失効はどう扱う？";
    await page.keyboard.type(ask);
    await page.locator(".pal-it.ask").waitFor();
    const first = await page.locator(".pal-it").first().getAttribute("class");
    check(first?.includes("ask"), "with no hit, 「AI に聞く」 is the first row");
    await shot(page, "ui2-04-palette-ask");
    const before = posts.filter((x) => /POST \/jobs(\?|$)/.test(x)).length;
    await page.keyboard.press("Enter");
    const ta = page.locator(".composer textarea, textarea.cmp-ta, [data-composer] textarea").first();
    await ta.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const body = await ta.inputValue();
    check(body === ask, `the Composer holds the question (${JSON.stringify(body)})`);
    const intent = await page.locator("[aria-pressed='true'], [aria-checked='true']").allInnerTexts();
    steps.askIntentChips = intent.slice(0, 6);
    check(posts.filter((x) => /POST \/jobs(\?|$)/.test(x)).length === before, "nothing is sent until the user presses send");
    await shot(page, "ui2-05-ask-ai-composer");
    await page.keyboard.press("Escape");
  }

  // ------------------------------------------------------------------ NC-14 English UI over a Japanese doc
  if (want("en")) {
    phase = "en";
    const overlap = async () =>
      page.evaluate(() => {
        const a = document.querySelector(".hdr .proj")?.getBoundingClientRect();
        const b = document.querySelector(".hdr .tabs")?.getBoundingClientRect();
        return a && b ? Math.max(0, a.right - b.left) : -1;
      });
    await page.keyboard.press(`${mod}+k`);
    await page.locator(".pal input").waitFor();
    // `>` = actions only (a symbol or a sentence may say 英語 too)
    await page.keyboard.type(">英語");
    await page.locator(".pal-it:not(.ask)", { hasText: "英語" }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.documentElement.lang === "en");
    await page.waitForTimeout(300);
    steps.enHeaderOverlapDoc = await overlap();
    await shot(page, "ui2-10-en-reader");
    await page.goto(page.url().replace(/\/doc\/[^#?]+.*$/, ""));
    await page.waitForFunction(() => performance.getEntriesByName("mitori:map:painted").length > 0, null, { timeout: 15_000 });
    await page.waitForTimeout(500);
    steps.enHeaderOverlapMap = await overlap();
    await shot(page, "ui2-11-en-map");
    check((steps.enHeaderOverlapDoc as number) <= 0 && (steps.enHeaderOverlapMap as number) <= 0, "the project chip never runs into the tabs");
    // back to Japanese for the next steps
    await page.keyboard.press(`${mod}+k`);
    await page.locator(".pal input").waitFor();
    await page.keyboard.type(">Japanese");
    await page.locator(".pal-it:not(.ask)", { hasText: "Japanese" }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.documentElement.lang === "ja");
    await page.goto(page.url().replace(/\/w\/(ws_\w+).*$/, "/w/$1/doc/s0"));
    await waitSection(page);
  }

  // ------------------------------------------------------------------ in-app export (ux.md §4.13)
  if (want("export")) {
    phase = "export";
    await page.keyboard.press(`${mod}+k`);
    await page.locator(".pal input").waitFor();
    await page.keyboard.type("HTMLとして書き出す");
    await page.locator(".pal-it:not(.ask)", { hasText: "HTMLとして書き出す" }).first().waitFor();
    await page.keyboard.press("Enter");
    const dlg = page.locator("dialog.exp");
    await dlg.waitFor();
    const t0 = performance.now();
    await dlg.locator(".facts").waitFor({ timeout: 20_000 });
    steps.exportPreviewMs = ms(t0);
    const facts = await dlg.locator(".facts").innerText();
    check(/コードの抜粋\d+箇所/.test(facts) && /伏せ字/.test(facts), `the dialog says what the file contains (${facts})`);
    steps.exportFacts = facts.replace(/\s+/g, " ");
    await shot(page, "ui2-09-export-dialog");
    await dlg.getByText("コードの抜粋を含める").click();
    await page.waitForFunction(
      () => {
        const f = document.querySelector("dialog.exp .facts");
        return !!f && !f.classList.contains("stale") && /コードは含みません/.test(f.textContent ?? "");
      },
      null,
      { timeout: 20_000 },
    );
    const noCode = (await dlg.locator(".facts").innerText()).replace(/\s+/g, " ");
    steps.exportFactsNoCode = noCode;
    const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "ダウンロード" }).click()]);
    const file = join(scratch, dl.suggestedFilename());
    await dl.saveAs(file);
    const html = readFileSync(file, "utf8");
    check(html.includes('id="mitori-export"') && html.length > 10_000, `the download is the export (${html.length} B)`);
    check(/-mitori-\d{4}-\d{2}-\d{2}\.html$/.test(dl.suggestedFilename()), `file name (${dl.suggestedFilename()})`);
    steps.exportDownload = { name: dl.suggestedFilename(), bytes: html.length };
  }

  steps.consoleErrors = consoleErrors;
  steps.badResponses = badResponses;
  check(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
  writeFileSync(join(OUT, "ui2-run.json"), `${JSON.stringify(steps, null, 2)}\n`);
  console.log(JSON.stringify(steps, null, 2));
} catch (e) {
  steps.error = e instanceof Error ? e.message : String(e);
  steps.consoleErrors = consoleErrors;
  steps.badResponses = badResponses;
  await page.screenshot({ path: join(OUT, `ui2-FAILED-${phase}.png`) }).catch(() => {});
  console.log(JSON.stringify(steps, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  await int.close();
  rmSync(scratch, { recursive: true, force: true });
}

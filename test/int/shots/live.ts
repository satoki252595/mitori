/**
 * LIVE loop drive (integrate/live): the review → AI fix loop end to end through the REAL web UI (installed Google
 * Chrome via Playwright, 1440×900), the real daemon routes and — with `--engine real` — the REAL `claude`.
 *
 *   scripts/nd bun test/int/shots/live.ts --engine fake [--out <dir>] [--trace-sse]
 *       in-process daemon + the scripted claude of INT-06 (no tokens, ≈ 25 s): iterate on UI / wiring bugs for free;
 *       `live-ui.test.ts` runs exactly this as a test.
 *   scripts/nd bun run build:bin && scripts/nd bun test/int/shots/live.ts --engine real [--out docs/progress/live]
 *       the compiled binary on a scratch git copy of go-small, a fresh MITORI_HOME, the user's `claude` (Max
 *       subscription). HARD CAP: API-equivalent total ≤ $0.60 (aborts when a job's ledger row says more); one Explain
 *       and one Fix.
 *
 * Steps (a screenshot after each): first screen (README lede) → 設計書 → §2 (the 間取り図 drawn) → §4 (the 0-token
 * steps) → select a word of the env table → Composer opened with `e`, typed WITHOUT a click (NC-01; the text has a
 * `g`, EX-02) → answer card → Fix with `f`, NO `@` mention: the row's own code is the first candidate, picked with ⌥1
 * (CR ux-F1) → job stages → ready card → Review panel → trust the gates → accept (⌘⏎) → the working tree changed
 * UNCOMMITTED and nothing else of the user's repository → Undo (⌘Z) → the original bytes → the code view. Every
 * check throws; latency / tokens / $ of every step are printed as JSON on stdout.
 * Exit 77 = Chrome is not installed (the test skips).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { synth } from "@mitori/agent/testing";
import { API_PREFIX } from "@mitori/core";
import { buildFixture } from "@mitori/testkit";
import { chromium, type Page } from "@playwright/test";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../fake-claude.ts";
import { startInt } from "../harness.ts";
import { CONFIG, ASK as FIX_ASK, routeUx } from "../ux-router.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENGINE = opt("--engine", "fake") as "fake" | "real";
const OUT = resolve(ROOT, opt("--out", ENGINE === "real" ? "docs/progress/live" : join(tmpdir(), "mitori-live-fake")) as string);
const BIN = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const CAP_USD = 0.6;
// no `@`: the Fix targets the env row's own code (config.go `Load`), the question names `config` (a `g`, EX-02)
const EXPLAIN_ASK = "この環境変数はどこで読まれ、未設定だと何が起きますか？config の既定値も教えて";
const TARGET_FILE = CONFIG;

mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.error("[live]", ...a);
const steps: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (t0: number) => Math.round(performance.now() - t0);

// ------------------------------------------------------------------------------------------- daemon
interface Daemon {
  url: string;
  ws: string;
  root: string;
  /** Every loop bundle the engine was sent (fake engine only). */
  prompts: string[];
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  close(): Promise<void>;
}

const git = (root: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-C", root, ...a], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (!r.success) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.toString();
};

/** Time warp (ms): a trust decision needs a browser session older than 60 s [SEC-19]; the real run simply waits. */
let skew = 0;
const clock = { now: () => Date.now() + skew, iso: () => new Date(Date.now() + skew).toISOString() };

async function startFake(): Promise<Daemon> {
  const repo = await buildFixture("go-small");
  const prompts: string[] = [];
  const int = await startInt({
    overrides: { clock: clock as never },
    spawner: fakeClaude({
      dtMs: 40,
      chunkChars: 6,
      speed: 1,
      respond(prompt, spec) {
        const r = routeUx(prompt);
        if (!r) return null;
        prompts.push(prompt);
        const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
        return r.kind === "answer" ? synth.text(r.text, { model, dtMs: 40 }) : synth.text("", { model, dtMs: 40, structured: r.patch });
      },
    }),
    config: FAKE_CLAUDE_CONFIG,
  });
  const { ws } = await int.open(repo.root);
  const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}` });
  return {
    url: nonce.url,
    ws,
    root: repo.root,
    prompts,
    api: (m, p, b) => int.json(m, `/ws/${ws}${p}`, b),
    close: async () => {
      await int.close();
      await repo.dispose();
    },
  };
}

async function startReal(): Promise<Daemon> {
  if (!existsSync(BIN)) throw new Error(`${BIN} missing (bun run build:bin)`);
  const repo = await buildFixture("go-small");
  const home = mkdtempSync(join(tmpdir(), "mitori-live-home-"));
  const proc = Bun.spawn([BIN, repo.root, "--no-open"], { env: { ...process.env, MITORI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  let err = "";
  let url = "";
  for await (const c of proc.stderr as ReadableStream<Uint8Array>) {
    err += new TextDecoder().decode(c);
    const m = /mitori: open (\S+)/.exec(err);
    if (m) {
      url = m[1] as string;
      break;
    }
  }
  if (!url) throw new Error(`no login URL\n${err}`);
  const reg = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { port: number; token: string };
  const ws = /\/w\/(ws_\w+)/.exec(decodeURIComponent(url))?.[1] as string;
  return {
    url,
    ws,
    root: repo.root,
    prompts: [],
    api: async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${reg.port}${API_PREFIX}/ws/${ws}${path}`, {
        method,
        headers: { authorization: `Bearer ${reg.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
      return (await res.json()) as never;
    },
    close: async () => {
      proc.kill();
      await proc.exited;
      rmSync(home, { recursive: true, force: true });
      await repo.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------- helpers
type J = Record<string, any>;
let spent = 0;
/** The API-equivalent $ of every job so far; aborts above the cap. */
async function checkCap(d: Daemon, label: string): Promise<void> {
  const jobs = await d.api<{ items: { usage?: { apiUsd: number } }[] }>("GET", "/jobs?limit=50");
  spent = jobs.items.reduce((s, j) => s + (j.usage?.apiUsd ?? 0), 0);
  log(`${label}: API-equivalent so far $${spent.toFixed(4)}`);
  if (spent > CAP_USD) throw new Error(`cap exceeded: $${spent} > $${CAP_USD}`);
}

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log("shot", name);
};

const check = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

/** Double-click a word inside the §4 environment table: a real browser selection. */
async function selectWord(page: Page, text: string): Promise<void> {
  const loc = page.locator(".mb code", { hasText: text }).first();
  await loc.scrollIntoViewIfNeeded();
  await loc.dblclick();
  await page.waitForTimeout(250);
}

/** The Composer's one-line estimate (`≈1.2k in · ≈600 out · $0.007 · 約4–8秒`). */
const composerEstimate = async (page: Page): Promise<string> =>
  ((await page.locator("body").innerText()).match(/≈[\d.,]+k? in[\s\S]{0,80}?秒/)?.[0] ?? "").replace(/\s+/g, " ");

/** Phases and the first / last streamed text of a job, in ms after `sentAt` (epoch ms of the keypress). */
async function timeline(d: Daemon, job: string, sentAt: number): Promise<Record<string, number>> {
  const events = await d.api<{ t: string; phase?: string; at: number }[]>("GET", `/jobs/${job}/events`);
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = e.t === "phase" ? `phase:${e.phase}` : e.t === "text" ? "firstText" : e.t;
    if (out[k] === undefined && (e.t === "phase" || e.t === "text" || e.t === "result" || e.t === "usage")) out[k] = e.at - skew - sentAt;
  }
  const texts = events.filter((e) => e.t === "text");
  if (texts.length > 0) out.lastText = (texts.at(-1) as { at: number }).at - skew - sentAt;
  return out;
}

async function optimisticCardMs(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const m = performance.getEntriesByName("mitori:card:optimistic").at(-1) as (PerformanceMark & { detail?: { trigger?: number } }) | undefined;
    return m?.detail?.trigger === undefined ? null : Math.round(m.startTime - m.detail.trigger);
  });
}

// ------------------------------------------------------------------------------------------- run
if (ENGINE === "real" && !existsSync(BIN)) {
  console.error(`${BIN} missing`);
  process.exit(2);
}
let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch (e) {
  console.error("[live] Google Chrome is not available:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(77);
}
const d = await (ENGINE === "real" ? startReal() : startFake());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await ctx.newPage();
const consoleErrors: string[] = [];
const badResponses: string[] = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => consoleErrors.push(`pageerror ${e.message.slice(0, 200)}`));
page.on("response", async (r) => {
  if (r.status() < 400) return;
  const body = await r.text().catch(() => "");
  badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/ws\/ws_\w+/, "")} ${body.slice(0, 200)}`);
});

/** `--trace-sse`: tee the page's SSE stream (a fetch stream, not an EventSource) into `window.__sse`. */
if (argv.includes("--trace-sse"))
  await ctx.addInitScript(() => {
    const w = window as unknown as { __sse: string[] };
    w.__sse = [];
    const of = window.fetch.bind(window);
    window.fetch = (async (...a: Parameters<typeof fetch>) => {
      const r = await of(...a);
      if (String(a[0]).includes("/events") && r.body) {
        const rd = r.clone().body?.getReader();
        const dec = new TextDecoder();
        let buf = "";
        void (async () => {
          for (;;) {
            const x = await rd?.read();
            if (!x || x.done) break;
            buf += dec.decode(x.value, { stream: true });
            for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
              w.__sse.push(buf.slice(0, i));
              buf = buf.slice(i + 2);
            }
          }
        })();
      }
      return r;
    }) as typeof fetch;
  });
const sseTrace = async (): Promise<string[]> => {
  const raw = await page.evaluate(() => (window as unknown as { __sse?: string[] }).__sse ?? []);
  return raw
    .map((chunk) => {
      try {
        const e = JSON.parse(
          chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("") || "{}",
        );
        if (!/^(thread|job|checkpoint|review)\./.test(String(e.type))) return "";
        const x = e.thread ?? e.job ?? e.checkpoint ?? {};
        return `${e.type} rev=${e.rev} ${x.id ?? e.job ?? ""} ${x.state ?? e.event?.t ?? ""} v=${x.version ?? ""}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
};

let exit = 0;
try {
  const base = d.root;
  const file = join(base, TARGET_FILE);
  const original = readFileSync(file);
  const userState = () => ({
    head: git(base, "rev-parse", "HEAD"),
    refs: git(base, "for-each-ref", "--format=%(refname) %(objectname)"),
    stash: git(base, "stash", "list"),
    worktrees: git(base, "worktree", "list", "--porcelain"),
    objects: git(base, "count-objects", "-v"),
  });
  const before = userState();
  check(git(base, "status", "--porcelain").trim() === "", "the scratch repo starts clean");

  // (a) first screen
  const tLogin = performance.now();
  await page.goto(d.url);
  await page.waitForFunction(() => performance.getEntriesByName("mitori:shell:painted").length > 0);
  await page
    .waitForFunction(() => ["mitori:map:painted", "mitori:toc:painted"].every((n) => performance.getEntriesByName(n).length > 0), undefined, { timeout: 5000 })
    .catch(() => undefined);
  const painted = await page.evaluate(() => {
    const e = (n: string) => Math.round(performance.getEntriesByName(n)[0]?.startTime ?? -1);
    return { shellPaintedMs: e("mitori:shell:painted"), mapPaintedMs: e("mitori:map:painted"), tocPaintedMs: e("mitori:toc:painted") };
  });
  await page.waitForTimeout(800);
  steps.firstScreen = { ...painted, navToIdleMs: ms(tLogin) };
  if (ENGINE === "fake") skew = 61_000;
  // NC-02: the first screen says what the repository is (README lede, toolchain)
  const hero = await page.locator(".hero").first().innerText();
  check(hero.includes("積読"), `the hero quotes the README: ${hero.slice(0, 200)}`);
  check(/Go 1\.23/.test(hero), `the hero names the toolchain: ${hero.slice(0, 200)}`);
  await shot(page, "01-first-screen");

  // (b) 設計書 (the zero-token static doc) → §2 drawn → §4
  await page.getByRole("link", { name: "設計書" }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "02-reader-s0");
  await page.goto(new URL(`/w/${d.ws}/doc/s2`, page.url()).href);
  await page.locator("figure.mdiagram svg").first().waitFor({ timeout: 10_000 });
  check((await page.locator("figure.mdiagram svg .dg-node").count()) >= 1, "§2 draws the 間取り図 (NC-03)");
  await page.waitForTimeout(500);
  await shot(page, "02b-reader-s2-diagram");
  const tNav = performance.now();
  await page
    .getByRole("link", { name: /動かしてみる/ })
    .first()
    .click();
  await page.waitForURL(/\/doc\/s4/);
  await page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().waitFor();
  steps.sectionNavMs = ms(tNav);
  await page.waitForTimeout(600);
  const s4text = await page.locator("main").first().innerText();
  check(/go run \.\/cmd\/tsundoku/.test(s4text), `§4 opens with the run command (NC-06): ${s4text.slice(0, 300)}`);
  await shot(page, "03-reader-s4");

  // (c) select → toolbar → Composer (Explain) → `@` mentions of the retry code → ask → send
  await selectWord(page, "TSUNDOKU_API_TOKEN");
  await page.getByRole("button", { name: "説明して E", exact: true }).waitFor();
  await shot(page, "04-selection-toolbar");
  await page.keyboard.press("e");
  const ta = page.locator("textarea").first();
  await ta.waitFor();
  // NC-01: the textarea takes focus by itself — type without clicking it
  await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", undefined, { timeout: 3000 });
  await shot(page, "05-composer-focused");
  await page.keyboard.type(EXPLAIN_ASK, { delay: 8 });
  check((await ta.inputValue()) === EXPLAIN_ASK, `the typed question arrived verbatim (NC-01 / EX-02), got ${JSON.stringify(await ta.inputValue())}`);
  await page.waitForTimeout(1200);
  steps.explainEstimateChip = await composerEstimate(page);
  const chipTexts = await page.locator(".chips .chip").allInnerTexts();
  check(
    chipTexts.some((t) => t.includes("§4")),
    `the doc chip names its section, got ${JSON.stringify(chipTexts)}`,
  );
  await shot(page, "06-composer-explain");
  const explainSentAt = Date.now();
  await page.keyboard.press("Meta+Enter");
  const tSend = performance.now();
  let tFirst = 0;
  let tApi = 0;
  let tCard = 0;
  const badge = page.getByText("回答済", { exact: true }).first();
  const answerText = page.locator("text=mitori AI").first();
  for (;;) {
    await page.waitForTimeout(100);
    const now = ms(tSend);
    if (!tFirst && (await answerText.isVisible().catch(() => false))) tFirst = now;
    if (!tApi) {
      const ths = await d.api<{ items: { state: string }[] }>("GET", "/threads");
      if (ths.items[0]?.state === "answered") tApi = now;
    }
    if (await badge.isVisible().catch(() => false)) {
      tCard = now;
      break;
    }
    if (now > 120_000) throw new Error("the explain card never reached 回答済 (state stuck in the UI?)");
  }
  steps.explain = { optimisticCardMs: await optimisticCardMs(page), firstTextMs: tFirst, threadAnsweredApiMs: tApi, cardAnsweredMs: tCard };
  await page.waitForTimeout(500);
  await shot(page, "07-explain-answered");
  const th1 = (await d.api<{ items: { id: string; state: string; jobs: string[] }[] }>("GET", "/threads")).items[0];
  check(th1 && th1.state === "answered" && th1.jobs[0], "the explain thread is answered");
  const explainThread = await d.api<J>("GET", `/threads/${th1?.id}`);
  const explainJob = await d.api<J>("GET", `/jobs/${th1?.jobs[0]}`);
  const answer = explainThread.messages.find((m: J) => String(m.by).startsWith("agent:"));
  steps.explainTimeline = await timeline(d, explainJob.id, explainSentAt);
  steps.explainJob = {
    state: explainJob.state,
    usage: explainJob.usage,
    timings: explainJob.timings,
    route: explainJob.route,
    estimate: {
      in: explainJob.estimate?.inTokens,
      out: explainJob.estimate?.outTokens,
      usd: explainJob.estimate?.apiUsd,
      seconds: explainJob.estimate?.seconds,
    },
  };
  steps.explainAnswer = String(answer?.body ?? "");
  check(answer, "an agent message");
  check(
    !/\[\[/.test(String(answer?.html)) && /href="\/w\/ws_\w+\/code\//.test(String(answer?.html ?? "")),
    "the cites of the answer are links, not [[…]] text",
  );
  check(!(await page.locator("body").innerText()).includes("[["), "no raw [[path:a-b]] marker on the page");
  if (ENGINE === "fake") {
    check(d.prompts.at(-1)?.includes(`ASK\n> ${EXPLAIN_ASK}`), "the engine was sent the question verbatim (not an empty ASK, no lost `g`)");
    // EX-03: the env row's own code reached the model without any `@`
    check(d.prompts.at(-1)?.includes(`CODE ${TARGET_FILE}:`), "the question's bundle carries the row's code (config.go)");
  }
  check(!/本文が空|empty/i.test(steps.explainAnswer as string), "the answer does not complain about an empty ask");
  await checkCap(d, "after explain");

  // (d) Fix → job stages → ready
  await page.keyboard.press("Escape");
  await selectWord(page, "TSUNDOKU_API_TOKEN");
  await page.keyboard.press("f");
  const ta2 = page.locator("textarea").first();
  await ta2.waitFor();
  await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", undefined, { timeout: 3000 });
  // CR ux-F1: no `@` — the Composer offers the row's own code (config.go Load) as the first candidate; ⌥1 picks it
  await page.locator(".cand-row").first().waitFor({ timeout: 5000 });
  const cand = await page.locator(".cand-row").first().innerText();
  check(cand.includes("config.go"), `the first candidate is the row's code: ${cand}`);
  await shot(page, "08-composer-fix-candidates");
  await page.keyboard.press("Alt+1");
  await page.waitForTimeout(400);
  await page.keyboard.type(FIX_ASK, { delay: 8 });
  await page.waitForTimeout(1500);
  steps.fixEstimateChip = await composerEstimate(page);
  await shot(page, "09-composer-fix");
  const fixSentAt = Date.now();
  await page.keyboard.press("Meta+Enter");
  const tFix = performance.now();
  await page.waitForTimeout(150);
  steps.fixOptimisticCardMs = await optimisticCardMs(page);
  await shot(page, "10-fix-sent");
  let fixId = "";
  for (let i = 0; i < 100 && !fixId; i++) {
    await sleep(150);
    const ths = await d.api<{ items: { id: string; intent: string; jobs: string[] }[] }>("GET", "/threads");
    fixId = ths.items.find((t) => t.intent === "change")?.jobs[0] ?? "";
    if (!fixId && i === 20) {
      // a confirmation card (estimate above the soft limit): ⌘⏎ confirms
      log("no job after 3 s; confirming");
      await shot(page, "10-fix-confirm");
      await page.keyboard.press("Meta+Enter");
    }
  }
  check(fixId, "the fix job was created");
  const seen = new Set<string>();
  const stateMs: Record<string, number> = {};
  for (;;) {
    const j = await d.api<J>("GET", `/jobs/${fixId}`);
    stateMs[j.state] ??= ms(tFix);
    if (!seen.has(j.state) && ["preparing", "running", "gating", "repairing"].includes(j.state)) {
      seen.add(j.state);
      await shot(page, `11-fix-${j.state}`);
    }
    if (["ready", "failed", "cancelled", "done"].includes(j.state)) {
      if (j.state !== "ready") throw new Error(`the fix job ended ${j.state}: ${JSON.stringify(j.failure ?? {})}`);
      break;
    }
    if (ms(tFix) > 240_000) throw new Error(`fix stuck in ${j.state}`);
    await sleep(150);
  }
  steps.fixStateMs = stateMs;
  await page.waitForTimeout(1200);
  await shot(page, "12-fix-ready");
  const fixJob = await d.api<J>("GET", `/jobs/${fixId}`);
  steps.fixTimeline = await timeline(d, fixId, fixSentAt);
  steps.fixJob = {
    usage: fixJob.usage,
    timings: fixJob.timings,
    route: fixJob.route,
    writeScope: fixJob.writeScope,
    diffStat: fixJob.diffStat,
    estimate: { in: fixJob.estimate?.inTokens, out: fixJob.estimate?.outTokens, usd: fixJob.estimate?.apiUsd, seconds: fixJob.estimate?.seconds },
  };
  check(fixJob.writeScope?.length === 1 && fixJob.writeScope[0] === TARGET_FILE, `write scope is the picked file, got ${fixJob.writeScope}`);
  if (ENGINE === "fake") check(d.prompts.at(-1)?.includes(`ASK\n> ${FIX_ASK}`), "the engine was sent the fix request");
  check(readFileSync(file).equals(original), "nothing reached the working tree before accept");
  await checkCap(d, "after fix");

  // (e) Review panel
  const tReview = performance.now();
  await page
    .getByRole("button", { name: /^レビュー/ })
    .first()
    .click();
  await page.locator(".rv .scroll").first().waitFor();
  steps.reviewOpenMs = ms(tReview);
  await page.waitForTimeout(1000);
  check(page.url().includes("/review/"), "the Review route");
  const panel = await page.locator(".rv").first().innerText();
  check(
    panel.includes(FIX_ASK) && panel.split(FIX_ASK).length >= 3,
    `the Review header names the user's request (あなた「…」), not the AI's reply:\n${panel.slice(0, 400)}`,
  );
  check(!(await page.locator("body").innerText()).includes("承認待ちです"), "no trust toast on top of the Review panel's footer");
  await shot(page, "13-review-panel");

  // (f) trust the gofmt gate: the approval from the Review panel runs the gates (session must be older than 60 s)
  const waitSession = Math.max(0, 62_000 - (performance.now() - tLogin));
  if (ENGINE === "real" && waitSession > 0) {
    log(`session is younger than 60 s: waiting ${Math.round(waitSession / 1000)} s`);
    await sleep(waitSession);
  }
  await page.getByText("内容を見て承認", { exact: true }).first().click();
  await page.getByRole("button", { name: "承認する" }).waitFor();
  await shot(page, "14-trust-dialog");
  await page.getByRole("button", { name: "承認する" }).click();
  for (let i = 0; i < 100; i++) {
    const j = await d.api<J>("GET", `/jobs/${fixId}`);
    if (j.gates.length > 0 && j.gates.every((g: J) => g.status !== "untrusted" && g.status !== "pending_consent")) break;
    await sleep(150);
  }
  await page.waitForTimeout(900);
  await shot(page, "15-gates-passed");
  const gated = await d.api<J>("GET", `/jobs/${fixId}`);
  steps.gates = { verdict: gated.gateVerdict, gates: gated.gates };
  check(gated.gateVerdict === "passed", `the gates passed after the approval (no manual 'run'): ${JSON.stringify(gated.gates)}`);
  check(
    (await page.locator(".rv").first().innerText()).includes("gofmt済") || (await page.locator(".gp").first().innerText()).includes("gofmt"),
    "the panel shows the gofmt pill",
  );

  // (g) accept with ⌘⏎ in the Review panel
  const tAccept = performance.now();
  await page.keyboard.press("Meta+Enter");
  await page
    .getByText(/反映しました/)
    .first()
    .waitFor({ timeout: 20_000 });
  steps.acceptToastMs = ms(tAccept);
  await page.waitForTimeout(600);
  await shot(page, "16-accepted");
  const changed = readFileSync(file);
  check(!changed.equals(original), "accept changed the working tree");
  const status = git(base, "status", "--porcelain");
  const after = userState();
  steps.afterAccept = { status: status.trim(), diffStat: git(base, "diff", "--stat").trim() };
  check(status.trim() === ` M ${TARGET_FILE}`.trim() || status === ` M ${TARGET_FILE}\n`, `only ${TARGET_FILE} is modified (uncommitted), got:\n${status}`);
  for (const k of ["head", "refs", "stash", "worktrees", "objects"] as const)
    check(after[k] === before[k], `the user's repository is untouched (${k}) after accept`);
  steps.changedFile = changed.toString("utf8").split("\n").slice(10, 30).join("\n");
  const gofmt = Bun.spawnSync(["gofmt", "-l", file]);
  if (gofmt.success) check(gofmt.stdout.toString().trim() === "", "gofmt -l is clean on the accepted file");

  // (h) Undo (⌘Z) → the original bytes
  const tUndo = performance.now();
  await page.keyboard.press("Meta+z");
  for (let i = 0; i < 100 && !readFileSync(file).equals(original); i++) await sleep(100);
  steps.undoMs = ms(tUndo);
  await page.waitForTimeout(600);
  await shot(page, "17-undone");
  check(readFileSync(file).equals(original), "undo restored the original bytes");
  check(git(base, "status", "--porcelain").trim() === "", "the working tree is clean after undo");
  const final = userState();
  for (const k of ["head", "refs", "stash", "worktrees", "objects"] as const)
    check(final[k] === before[k], `the user's repository is untouched (${k}) after undo`);

  // (i) the code view: one row per line, with its number
  await page.goto(new URL(`/w/${d.ws}/code/${TARGET_FILE}#L19-L38`, page.url()).href);
  await page.locator("[data-line]").first().waitFor();
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-line]")]
      .slice(0, 8)
      .map((e) => ({ top: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height })),
  );
  check(
    rows.length >= 6 &&
      rows.every((r, i) => r.h < 26 && (i === 0 || Math.abs(r.top - (rows[i - 1] as { top: number; h: number }).top - (rows[i - 1] as { h: number }).h) < 1)),
    `code rows are contiguous single lines: ${JSON.stringify(rows)}`,
  );
  await shot(page, "18-code-view");

  await checkCap(d, "end");
  const noisy = badResponses.filter((r) => /^(5\d\d)/.test(r));
  check(noisy.length === 0, `no 5xx/501 from the daemon: ${noisy.join(" | ")}`);
  steps.badResponses = badResponses;
  steps.consoleErrors = consoleErrors;
  if (argv.includes("--trace-sse")) steps.sseTrace = await sseTrace();
} catch (e) {
  exit = 1;
  console.error("[live] FAILED", e);
  steps.failure = e instanceof Error ? e.message : String(e);
  steps.badResponses = badResponses;
  steps.consoleErrors = consoleErrors;
  await page.screenshot({ path: join(OUT, "99-failure.png") }).catch(() => undefined);
} finally {
  const result = { engine: ENGINE, spentUsd: Math.round(spent * 1e6) / 1e6, ...steps };
  await Bun.write(Bun.stdout, `${JSON.stringify(result, null, 1)}\n`); // not console.log: process.exit below would cut a piped stdout
  if (ENGINE === "real") writeFileSync(join(OUT, "measurements.json"), `${JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2)}\n`);
  await browser.close();
  await d.close();
}
process.exit(exit);

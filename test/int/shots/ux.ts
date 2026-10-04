/**
 * UX drive (finishing pass, track ux): the concept's loop through the REAL web UI (installed Google Chrome via
 * Playwright, 1440×900, light or `--scheme dark`), the in-process daemon and the scripted claude of `ux-router.ts` — zero tokens.
 *
 *   scripts/nd bun scripts/gen-assets.ts && scripts/nd bun test/int/shots/ux.ts [--out docs/progress/ux]
 *
 * A. Fix on a static facts row WITHOUT `@`: the row's own code is offered (⌥1 picks it) → estimate → job → the AI's
 *    doc edit shows IN the prose as a suggestion → Review (decluttered header) → accept.
 * B. Fix on an uncited sentence: nothing to point at ⇒ the Composer says how (no estimate request, no 412); on ⤴ it
 *    says the pick would not travel (WRITE -) and offers ⚡ back.
 * C. Co-editing: the human writes a cited sentence into the doc (「設計書を直す」) → a Fix on it has its 対象コード
 *    automatically (the cite) → the AI's rewrite of the sentence is accepted on its own after the code (✓ in prose).
 * D. Explain → 「文書に追記」 → the INSERT proposal shows after its block → ✕ rejects it.
 * Every check throws; latencies and the HTTP errors seen are printed as JSON. Exit 77 = no Chrome.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { synth } from "@mitori/agent/testing";
import { buildFixture } from "@mitori/testkit";
import { chromium } from "@playwright/test";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../fake-claude.ts";
import { startInt } from "../harness.ts";
import { ASK, CITED_MD, RETRY_ASK, routeUx } from "../ux-router.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = resolve(ROOT, opt("--out", join(tmpdir(), "mitori-ux")) as string);
mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.error("[ux]", ...a);
const steps: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (t0: number) => Math.round(performance.now() - t0);
const check = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`check failed: ${what}`);
};
type J = Record<string, any>;

let skew = 0;
const clock = { now: () => Date.now() + skew, iso: () => new Date(Date.now() + skew).toISOString() };

let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch (e) {
  console.error("[ux] Google Chrome is not available:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(77);
}

const repo = await buildFixture("go-small");
const int = await startInt({
  overrides: { clock: clock as never },
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
const { ws } = await int.open(repo.root);
const api = <T = J>(m: string, p: string, b?: unknown) => int.json<T>(m, `/ws/${ws}${p}`, b);
const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}` });

const scheme = opt("--scheme", "light") === "dark" ? "dark" : "light";
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const page = await ctx.newPage();
const consoleErrors: string[] = [];
const badResponses: string[] = [];
const requests: string[] = [];
let phase = "start";
page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${phase}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) =>
  consoleErrors.push(`[${phase}] pageerror ${e.message.slice(0, 200)} ${(e.stack ?? "").split("\n").slice(1, 4).join(" | ").slice(0, 300)}`),
);
page.on("request", (r) => requests.push(`${r.method()} ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/ws\/ws_\w+/, "")}`));
page.on("response", async (r) => {
  if (r.status() < 400) return;
  const body = await r.text().catch(() => "");
  badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/ws\/ws_\w+/, "")} ${body.slice(0, 160)}`);
});
const shot = async (name: string) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log("shot", name);
  phase = `after ${name}`;
};
const text = async () => page.locator("body").innerText();
async function waitText(re: RegExp | string, ms = 8000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const s = await text();
    if (typeof re === "string" ? s.includes(re) : re.test(s)) return;
    if (Date.now() - t0 > ms) throw new Error(`text ${re} never appeared`);
    await sleep(60);
  }
}
async function jobUntil(id: string, states: string[], max = 30_000): Promise<J> {
  const t0 = Date.now();
  for (;;) {
    const j = await api<J>("GET", `/jobs/${id}`);
    if (states.includes(j.state)) return j;
    if (j.state === "failed") throw new Error(`job ${id} failed ${JSON.stringify(j.failure)}`);
    if (Date.now() - t0 > max) throw new Error(`job ${id} stuck in ${j.state}`);
    await sleep(100);
  }
}
/** Select `exact` inside the first `.mb` element matching `scope` with a real browser selection (as a user's drag does). */
async function select(scope: string, exact: string): Promise<void> {
  await page.evaluate(
    ({ scope, exact }) => {
      const roots = [...document.querySelectorAll(scope)];
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          const at = n.data.indexOf(exact);
          if (at < 0) continue;
          (n.parentElement as HTMLElement).scrollIntoView({ block: "center" });
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + exact.length);
          const sel = getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return;
        }
      }
      throw new Error(`no text ${exact} in ${scope}`);
    },
    { scope, exact },
  );
  await sleep(300);
}
const composer = () => page.locator("section.composer").first();
const sinceReq = () => requests.length;
const reqsSince = (n: number) => requests.slice(n);

let exit = 0;
try {
  // ---------------------------------------------------------------- A. Fix on a facts row, no @
  await page.goto(nonce.url);
  await page.waitForFunction(() => performance.getEntriesByName("mitori:shell:painted").length > 0);
  skew = 61_000; // a trust decision needs a browser session older than 60 s [SEC-19]
  await page.getByRole("link", { name: "設計書" }).first().click();
  await sleep(500);
  await page
    .getByRole("link", { name: /動かしてみる/ })
    .first()
    .click();
  await page.waitForURL(/\/doc\/s4/);
  await page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().waitFor();
  await sleep(400);
  const r0 = sinceReq();
  await page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().dblclick();
  await sleep(250);
  const tOpen = performance.now();
  await page.keyboard.press("f");
  await composer().waitFor();
  await composer().getByText("本文が指す場所").first().waitFor({ timeout: 5000 });
  steps.targetsShownMs = ms(tOpen);
  await sleep(300);
  const quote = await composer().locator("blockquote.cm-q").innerText();
  steps.quote = quote;
  check(quote.trim() === "TSUNDOKU_API_TOKEN", `the quote is exactly the selected cell text, got ${JSON.stringify(quote)}`);
  check(!(await composer().locator("button.send").isEnabled()), "send is disabled until a target is picked");
  await shot("ux-01-fix-candidates");
  const ta = composer().locator("textarea").first();
  await ta.click();
  await page.keyboard.type(ASK, { delay: 5 });
  await sleep(700);
  check(!reqsSince(r0).some((r) => r.includes("/jobs/estimate")), "no estimate request before a target exists");
  await page.keyboard.press("Alt+1");
  await composer().locator(".tg-files").waitFor();
  await waitText(/≈[\d.,]+k? in/, 5000);
  steps.fixPickedChips = await composer().locator(".targets").innerText();
  check(String(steps.fixPickedChips).includes("config.go:19-38"), "the picked target is the Load function");
  await sleep(400);
  await shot("ux-02-fix-picked");
  await page.keyboard.press("Meta+Enter");
  let fixId = "";
  for (let i = 0; i < 100 && !fixId; i++) {
    await sleep(100);
    const ths = await api<{ items: J[] }>("GET", "/threads");
    fixId = ths.items.find((t) => t.intent === "change" && t.jobs.length)?.jobs[0] ?? "";
  }
  check(fixId, "the fix job exists");
  const fix = await jobUntil(fixId, ["ready"]);
  check(fix.writeScope.length === 1 && fix.writeScope[0] === "internal/config/config.go", `write scope = config.go, got ${fix.writeScope}`);
  await sleep(1200);
  await shot("ux-03-fix-ready-in-prose");
  check((await page.locator(".pp del.d").count()) > 0 && (await page.locator(".pp ins.a").count()) > 0, "the doc proposal shows as a suggestion in the prose");

  // the Review panel: the decluttered header, the proposal's diff next to the code
  await page
    .getByRole("button", { name: /^レビュー/ })
    .first()
    .click();
  await page.locator(".rv .scroll").first().waitFor();
  await sleep(900);
  steps.header = await page.locator("header.hdr").innerText();
  check(!(await page.locator("header.hdr .menu-btn").isVisible()), "no menu button in the review header (1440 px)");
  check((await page.locator("header.hdr .chip-slot button").count()) === 0, "no second ◆ job chip next to the レビュー tab");
  check((await page.locator(".rv .props .pdiff ins.a").count()) > 0, "the proposal's diff is in the Review panel");
  await shot("ux-04-review");
  await page.locator(".rv-f .btn-pri").first().click(); // 検査なしで採用 (gofmt not approved in this run)
  await waitText(/反映しました/, 15000);
  await sleep(800);
  await shot("ux-05-accepted");
  const after = readFileSync(join(repo.root, "internal/config/config.go"), "utf8");
  check(after.includes('cmp.Or(os.Getenv("TSUNDOKU_API_TOKEN"), "dev")'), "accept wrote the code");

  // ---------------------------------------------------------------- B. Fix on a heading: the hint, no 412
  await page.goto(new URL(`/w/${ws}/doc/s10`, page.url()).href);
  await page.locator(".blk .mb", { hasText: "まだ決定はありません" }).first().waitFor();
  await sleep(500);
  const r1 = sinceReq();
  await select(".reader-root .blk .mb", "まだ決定はありません");
  await page.keyboard.press("f");
  await composer().waitFor();
  await composer().locator(".tg-none").waitFor({ timeout: 5000 });
  await composer().locator("textarea").first().click();
  await page.keyboard.type("もっと分かりやすくして", { delay: 5 });
  await sleep(900);
  check(!reqsSince(r1).some((r) => r.includes("/jobs/estimate")), "no estimate request for a Fix with nothing to write");
  check(!(await composer().locator("button.send").isEnabled()), "send stays disabled");
  await shot("ux-06-fix-no-target-hint");
  // your own session (⤴) would get WRITE - for an uncited sentence: the Composer says so and offers ⚡ back
  await composer().locator("button.path").click();
  await composer().getByText("自分のセッションやコピーでは書き込み先が空").waitFor({ timeout: 3000 });
  check(!(await composer().locator("button.send").isEnabled()), "send stays disabled on ⤴ for an uncited Fix");
  await sleep(200);
  await shot("ux-13-fix-push-only");
  await composer()
    .getByRole("button", { name: /その場で実行にする/ })
    .click();
  await composer().locator(".tg-none", { hasText: "@ でコードを指す" }).waitFor({ timeout: 3000 });
  await page.keyboard.press("Escape");
  await sleep(300);

  // ---------------------------------------------------------------- C. co-editing: a cited sentence, then a Fix on it
  await page.goto(new URL(`/w/${ws}/doc/s1`, page.url()).href);
  await page.locator(".blk .mb", { hasText: "この節はまだ生成されていません" }).first().waitFor();
  await sleep(500);
  await select(".reader-root .blk .mb", "この節はまだ生成されていません");
  await page.keyboard.press("f");
  await composer().waitFor();
  await composer().getByText("設計書を直す", { exact: false }).first().click();
  const md = composer().locator("textarea.md");
  await md.waitFor();
  await md.fill(CITED_MD);
  await sleep(300);
  await shot("ux-07-doc-edit");
  await page.keyboard.press("Meta+Enter");
  await waitText("回だけ再試行する", 8000); // the renderer drops the CJK↔digit space (UXP-24)
  await sleep(900);
  await shot("ux-08-doc-edited");
  const r2 = sinceReq();
  await select(".reader-root .blk .mb", "再試行する");
  await page.keyboard.press("f");
  await composer().waitFor();
  await composer().locator(".chip.tg.cited").first().waitFor({ timeout: 5000 });
  steps.citedTargets = await composer().locator(".targets").innerText();
  check(String(steps.citedTargets).includes("fetch.go:46-61"), "the sentence's cite is the target");
  await composer().locator("textarea").first().click();
  await page.keyboard.type(RETRY_ASK, { delay: 5 });
  await waitText(/≈[\d.,]+k? in/, 5000);
  await sleep(400);
  await shot("ux-09-fix-cited-target");
  check(!badResponses.slice(-5).some((b) => b.startsWith("412")), "no 412 for the cited Fix");
  void r2;
  await page.keyboard.press("Meta+Enter");
  let retryId = "";
  for (let i = 0; i < 100 && !retryId; i++) {
    await sleep(100);
    const ths = await api<{ items: J[] }>("GET", "/threads");
    retryId = ths.items.find((t) => t.intent === "change" && t.jobs.length && t.jobs[0] !== fixId)?.jobs[0] ?? "";
  }
  check(retryId, "the retry fix job exists");
  await jobUntil(retryId, ["ready"]);
  // the code is taken through the API here (the Review flow was A); the sentence's rewrite stays for the prose ✓
  await api("POST", `/jobs/${retryId}/accept`, { accept: "all", acceptUnverified: true });
  await page.reload();
  await page.locator(".pp", { hasText: "MaxRetries" }).first().waitFor({ timeout: 8000 });
  await sleep(600);
  await shot("ux-10-proposal-standalone");
  await page.locator(".pp button.ok").first().click();
  await waitText("回まで再試行する", 8000);
  await sleep(900);
  check((await page.locator(".pp").count()) === 0, "the accepted proposal is gone from the prose");
  await shot("ux-11-proposal-accepted");

  // ---------------------------------------------------------------- D. Explain → 文書に追記 → reject the insert
  await page.goto(new URL(`/w/${ws}/doc/s4`, page.url()).href);
  await page.locator(".mb code", { hasText: "LOG_LEVEL" }).first().waitFor();
  await sleep(400);
  await page.locator(".mb code", { hasText: "LOG_LEVEL" }).first().dblclick();
  await sleep(250);
  await page.keyboard.press("e");
  await composer().waitFor();
  await composer().locator("textarea").first().click();
  await page.keyboard.type("どこで読む？", { delay: 5 });
  await sleep(500);
  await page.keyboard.press("Meta+Enter");
  await page.getByText("回答済", { exact: true }).first().waitFor({ timeout: 15000 });
  await sleep(500);
  await page
    .getByRole("button", { name: /文書に追記/ })
    .first()
    .click();
  await page.locator(".pp", { hasText: "起動時に" }).first().waitFor({ timeout: 8000 });
  await sleep(700);
  await shot("ux-12-insert-proposal");
  await page.locator(".pp", { hasText: "起動時に" }).first().locator("button.no").click();
  await sleep(900);
  check((await page.locator(".pp", { hasText: "起動時に" }).count()) === 0, "the rejected insert is gone");

  check(!consoleErrors.some((e) => e.includes("pageerror")), `no page errors (effect loops): ${consoleErrors.join(" | ")}`);
  const noisy = badResponses.filter((r) => /^(412|5\d\d)/.test(r));
  check(noisy.length === 0, `no 412 / 5xx from the daemon: ${noisy.join(" | ")}`);
  steps.badResponses = badResponses;
  steps.consoleErrors = consoleErrors;
} catch (e) {
  exit = 1;
  console.error("[ux] FAILED", e);
  steps.failure = e instanceof Error ? e.message : String(e);
  steps.badResponses = badResponses;
  steps.consoleErrors = consoleErrors;
  await page.screenshot({ path: join(OUT, "99-failure.png") }).catch(() => undefined);
} finally {
  await Bun.write(Bun.stdout, `${JSON.stringify(steps, null, 1)}\n`);
  writeFileSync(join(OUT, "ux-run.json"), `${JSON.stringify({ at: new Date().toISOString(), ...steps }, null, 2)}\n`);
  await browser.close();
  await int.close();
  await repo.dispose();
}
process.exit(exit);

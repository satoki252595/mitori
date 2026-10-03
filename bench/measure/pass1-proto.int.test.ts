// pass1-proto is a throwaway measurement script, but it spends money when it is wrong: the live path is tested against a fake
// `claude` executable (a Bun script) — no real LLM call is ever made here.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLAUDE_ARGV, CLAUDE_FORBIDDEN_FLAGS, ENV_ALLOWLIST } from "@mitori/agent";
import { groupModules, inventory, leanArgs, leanEnv, loadDigest, makePlan, moduleOf, modulePrompt, repoPack, runLive, tokensOf } from "./pass1-proto.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "bench/measure/pass1-proto.ts");
const GO = join(ROOT, "fixtures/repos/go-small");
const TS = join(ROOT, "fixtures/repos/ts-small");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "mitori-p1-"));
  dirs.push(d);
  return d;
};

/** A stand-in for `claude -p` that speaks stream-json and logs the argv it was given. */
function fakeClaude(config: { apiKeySource?: string; outTokens?: number } = {}): { bin: string; log: string } {
  const dir = tmp();
  const log = join(dir, "argv.jsonl");
  const bin = join(dir, "claude");
  // the real child only inherits an env allowlist, so the fake reads its behaviour from a file next to it
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  writeFileSync(
    bin,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(import.meta.dir + "/config.json", "utf8"));
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), cwdFiles: (await import("node:fs")).readdirSync(process.cwd()), cache: process.env.CLAUDE_CODE_PROMPT_CACHE_TTL, key: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
const stdin = await Bun.stdin.text();
const prompt = JSON.parse(stdin.trim().split("\\n")[0]).message.content;
const send = (o) => console.log(JSON.stringify(o));
send({ type: "system", subtype: "init", apiKeySource: config.apiKeySource ?? "none", model: "claude-sonnet-5-5", tools: [] });
await Bun.sleep(5);
send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "## ページ" } } });
send({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.04, usage: { input_tokens: Math.ceil(prompt.length / 3), cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, output_tokens: config.outTokens ?? 600 } });
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

describe("PASS1-U-01 inventory and modules", () => {
  test("source files only: no lock files, no docs, no vendored directories", () => {
    const files = inventory(GO);
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      expect(f.path).toMatch(/\.(go|ts|js|py|rs)$/);
      expect(f.path).not.toMatch(/(^|\/)(vendor|node_modules|dist)\//);
      expect(f.tokens).toBe(tokensOf(f.chars));
    }
    expect(files.some((f) => f.path.endsWith("go.sum"))).toBe(false);
  });

  test("the skeleton keeps declaration lines", () => {
    const files = inventory(GO);
    const withDecls = files.filter((f) => f.skeleton.length > 0);
    expect(withDecls.length).toBeGreaterThan(0);
    expect(withDecls.some((f) => f.skeleton.some((l) => l.startsWith("func ")))).toBe(true);
    for (const f of files) for (const l of f.skeleton) expect(l.length).toBeLessThanOrEqual(160);
  });

  test("module names follow wrapper directories", () => {
    expect(moduleOf("main.go")).toBe(".");
    expect(moduleOf("internal/meta/fetch.go")).toBe("internal/meta");
    expect(moduleOf("packages/core/src/a.ts")).toBe("packages/core");
    expect(moduleOf("web/app/page.tsx")).toBe("web");
  });

  test("modules are ordered by size, largest first", () => {
    const mods = groupModules(inventory(TS));
    expect(mods.length).toBeGreaterThan(0);
    for (let i = 1; i < mods.length; i++) expect((mods[i - 1]?.tokens ?? 0) >= (mods[i]?.tokens ?? 0)).toBe(true);
  });

  test("a digest from the real indexer replaces the approximation", () => {
    const dir = tmp();
    const digest = join(dir, "digest.json");
    writeFileSync(digest, JSON.stringify({ files: [{ path: "a/x.ts", chars: 2300, tokens: 1000, skeleton: ["export const x = 1"], module: "a" }] }));
    const files = loadDigest(digest);
    expect(files).toHaveLength(1);
    const plan = makePlan(dir, files, { model: "claude-sonnet-5-5", effort: "low", modules: 5 });
    expect(plan.naiveFullTokens).toBe(1000);
    expect(plan.modules.map((m) => m.name)).toEqual(["a"]);
    writeFileSync(digest, JSON.stringify({ nope: [] }));
    expect(() => loadDigest(digest)).toThrow('expected { "files"');
  });
});

describe("PASS1-U-02 prompts and plan", () => {
  test("the repo pack respects its token budget and lists the largest files first", () => {
    const files = inventory(GO);
    const pack = repoPack(files, 400);
    expect(pack.length).toBeGreaterThan(0);
    expect(tokensOf(pack.length)).toBeLessThanOrEqual(400);
    expect(pack.startsWith("=== ")).toBe(true);
  });

  test("a module prompt carries line-numbered source and declarations", () => {
    const mod = groupModules(inventory(GO))[0];
    expect(mod).toBeDefined();
    const p = modulePrompt(mod as NonNullable<typeof mod>, GO);
    expect(p).toContain(`Module: ${mod?.name}`);
    expect(p).toMatch(/^1\|/m);
  });

  test("the plan prices the estimate with the product's pricing and reports the input ratio", () => {
    const files = inventory(GO);
    const plan = makePlan(GO, files, { model: "claude-sonnet-5-5", effort: "low", modules: 3 });
    expect(plan.modules.length).toBeLessThanOrEqual(3);
    expect(plan.estimate.usd).toBeGreaterThan(0);
    expect(plan.estimate.out).toBe(plan.modules.length * 2500);
    expect(plan.estimate.cacheRead).toBe(plan.modules.length > 1 ? plan.packTokens * (plan.modules.length - 1) : 0);
    expect(plan.naiveFullTokens).toBe(files.reduce((s, f) => s + f.tokens, 0));
    expect(plan.inputRatio).toBeGreaterThan(0);
  });
});

describe("PASS1-U-03 lean arguments (agent spec I1–I14)", () => {
  const args = leanArgs({ model: "claude-sonnet-5-5", effort: "low", systemFile: "/s.txt", maxBudgetUsd: 0.5 });
  test("stream-json in and out, no tools, no settings, no MCP, no slash commands, no session", () => {
    const has = (flag: string, value?: string) => {
      const i = args.indexOf(flag);
      return i >= 0 && (value === undefined || args[i + 1] === value);
    };
    expect(has("--input-format", "stream-json") && has("--output-format", "stream-json") && has("--verbose") && has("--include-partial-messages")).toBe(true);
    expect(has("--tools", "")).toBe(true);
    expect(has("--setting-sources", "")).toBe(true);
    expect(has("--strict-mcp-config") && has("--disable-slash-commands") && has("--no-session-persistence")).toBe(true);
    expect(has("--model", "claude-sonnet-5-5") && has("--effort", "low") && has("--max-budget-usd", "0.50") && has("--system-prompt-file", "/s.txt")).toBe(
      true,
    );
  });

  test("never a forbidden flag", () => {
    for (const bad of ["--bare", "--dangerously-skip-permissions", "--add-dir", "--mcp-config", "--settings", "--continue", "--resume"])
      expect(args).not.toContain(bad);
    for (const bad of CLAUDE_FORBIDDEN_FLAGS) expect(args).not.toContain(bad);
  });

  test("regression: the argv is the product's generate template (it lacked `--permission-prompts none`)", () => {
    expect(args).toHaveLength(CLAUDE_ARGV.common.length + CLAUDE_ARGV.generate.length);
    const i = args.indexOf("--permission-prompts");
    expect(args[i + 1]).toBe("none");
    expect(args.some((a) => /^\{\w+\}$/.test(a))).toBe(false); // every placeholder substituted
  });

  test("the child env is the contract's allowlist minus the denylist and MITORI_*", () => {
    const env = leanEnv({ PATH: "/bin", LOGNAME: "me", SSL_CERT_DIR: "/c", ANTHROPIC_API_KEY: "sk-ant-api03-FAKE", MITORI_HOME: "/h", FOO: "x" });
    expect(env).toEqual({ PATH: "/bin", LOGNAME: "me", SSL_CERT_DIR: "/c" });
    for (const k of Object.keys(env)) expect(ENV_ALLOWLIST as readonly string[]).toContain(k);
  });
});

describe("PASS1-AT-01 command line", () => {
  const run = async (argv: string[], env: Record<string, string | undefined> = {}) => {
    const clean = { ...process.env, ...env };
    if (env.MITORI_LIVE === undefined) delete clean.MITORI_LIVE;
    const proc = Bun.spawn(["bun", SCRIPT, ...argv], { cwd: ROOT, env: clean as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { out, err, code };
  };

  test("the default is a dry run: a plan on stdout, exit 0, nothing spawned", async () => {
    const fake = fakeClaude();
    const r = await run(["--repo", GO, "--modules", "3", "--claude", fake.bin]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("dry run, 0 tokens");
    expect(r.out).toContain("gen.ratio.inputNaive");
    expect(() => readFileSync(fake.log, "utf8")).toThrow(); // the fake claude was never started
  });

  test("--run is refused without MITORI_LIVE=1 and without --max-usd", async () => {
    const fake = fakeClaude();
    const noLive = await run(["--repo", GO, "--run", "--max-usd", "1", "--claude", fake.bin]);
    expect(noLive.code).toBe(2);
    expect(noLive.err).toContain("MITORI_LIVE=1");
    const noCap = await run(["--repo", GO, "--run", "--claude", fake.bin], { MITORI_LIVE: "1" });
    expect(noCap.code).toBe(2);
    expect(noCap.err).toContain("--max-usd");
    expect(() => readFileSync(fake.log, "utf8")).toThrow();
  });

  test("an unknown model and a missing repo are usage errors", async () => {
    expect((await run(["--repo", GO, "--model", "sonnet"])).code).toBe(2);
    expect((await run(["--repo", "/no/such/dir"])).code).toBe(2);
    expect((await run([])).code).toBe(2);
  });

  test("a live run against the fake claude writes the report and exits 0", async () => {
    const fake = fakeClaude();
    const out = join(tmp(), "report.json");
    const r = await run(["--repo", TS, "--modules", "2", "--run", "--max-usd", "5", "--concurrency", "2", "--claude", fake.bin, "--out", out], {
      MITORI_LIVE: "1",
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("pass1-proto (live)");
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.v).toBe("mitori.pass1-proto/1");
    expect(report.calls.length).toBe(report.plan.modules.length);
    expect(report.totals.out).toBe(600 * report.calls.length);
  });
});

describe("PASS1-AT-02 live path against a fake claude", () => {
  const plan = () => makePlan(GO, inventory(GO), { model: "claude-sonnet-5-5", effort: "low", modules: 4 });

  test("every call gets the lean argv, an empty cwd, the 5-minute cache TTL and no API key", async () => {
    const fake = fakeClaude();
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-FAKE";
    try {
      const report = await runLive(plan(), inventory(GO), { claude: fake.bin, maxUsd: 10, concurrency: 2, perCallCapUsd: 0.5 });
      expect(report.calls.every((c) => c.ok)).toBe(true);
      const logged = readFileSync(fake.log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(logged).toHaveLength(report.calls.length);
      for (const l of logged) {
        expect(l.argv).toContain("--no-session-persistence");
        expect(l.argv[l.argv.indexOf("--tools") + 1]).toBe("");
        expect(l.cwdFiles).toEqual([]);
        expect(l.cache).toBe("5m");
        expect(l.key).toBeNull(); // the API key never reaches the child (subscription only)
      }
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  test("usage is priced with the product's table and ttft is recorded", async () => {
    const fake = fakeClaude();
    const report = await runLive(plan(), inventory(GO), { claude: fake.bin, maxUsd: 10, concurrency: 1, perCallCapUsd: 0.5 });
    const c = report.calls[0];
    expect(c?.usage.out).toBe(600);
    expect(c?.usage.cacheRead).toBe(4000);
    expect(c?.apiUsd).toBeGreaterThan(0);
    expect(c?.reportedUsd).toBe(0.04);
    expect(c?.ttftMs).toBeGreaterThan(0);
    expect(report.ttftMs?.p50).toBeGreaterThan(0);
  });

  test("calls stop before the cap would be exceeded", async () => {
    const fake = fakeClaude({ outTokens: 45_000 }); // ≈ $0.45 per call at the list price (sonnet out $10/Mtok)
    // spent + the cap of the next call must fit: 0 + .5, .45 + .5, then .9 + .5 > 1.2
    const report = await runLive(plan(), inventory(GO), { claude: fake.bin, maxUsd: 1.2, concurrency: 1, perCallCapUsd: 0.5 });
    expect(report.stoppedEarly).toBe(true);
    expect(report.calls.length).toBeLessThanOrEqual(2);
    expect(report.spentUsd).toBeLessThan(1.2);
  });

  test("concurrency counts calls in flight against the cap", async () => {
    const fake = fakeClaude();
    const report = await runLive(plan(), inventory(GO), { claude: fake.bin, maxUsd: 1.2, concurrency: 4, perCallCapUsd: 0.5 });
    expect(readFileSync(fake.log, "utf8").trim().split("\n").length).toBeLessThanOrEqual(2); // never more than 1.2 / 0.5 started
    expect(report.stoppedEarly).toBe(true);
  });

  test("an API-key apiKeySource aborts the run and is flagged", async () => {
    const fake = fakeClaude();
    const metered = fakeClaude({ apiKeySource: "ANTHROPIC_API_KEY" });
    const report = await runLive(plan(), inventory(GO), { claude: metered.bin, maxUsd: 10, concurrency: 1, perCallCapUsd: 0.5 });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]).toMatchObject({ ok: false, apiKeySource: "ANTHROPIC_API_KEY" });
    expect(report.calls[0]?.error).toContain("metered billing");
    expect(report.stoppedEarly).toBe(true);
    expect(fake.log).not.toBe(metered.log);
  });
});

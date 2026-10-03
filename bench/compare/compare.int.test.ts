// WP-12 acceptance: "25 % slower synthetic bench ⇒ `nd bun run bench:compare` exits non-zero" — through the root script, through
// `--head-env` on one checkout, and through the real base worktree flow in a throw-away git repository.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

async function run(argv: string[], cwd = ROOT, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(argv, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

describe("BENCH-AT-01 bench:compare fails a 25 % slower synthetic benchmark", () => {
  test("root script bench:compare, one checkout playing base and head", async () => {
    const slow = await run([
      "bun",
      "run",
      "bench:compare",
      "--base-root",
      ROOT,
      "--id",
      "synthetic.spin",
      "--head-env",
      "MITORI_BENCH_SLOWDOWN=1.25",
      "--pairs",
      "2",
      "--no-absolute",
      "--no-wait",
    ]);
    expect(slow.code).toBe(1);
    expect(slow.out).toContain("**REGRESSED**");
    expect(slow.out).toContain("synthetic.spin");
  }, 60_000);

  test("the caller's own MITORI_BENCH_SLOWDOWN slows head only: the base side is told to ignore it", async () => {
    const r = await run(["bun", "run", "bench:compare", "--base-root", ROOT, "--id", "synthetic.spin", "--pairs", "2", "--no-absolute", "--no-wait"], ROOT, {
      MITORI_BENCH_SLOWDOWN: "1.25",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("**REGRESSED**");
  }, 60_000);

  test("the same run without a slowdown, and with a 10 % one (testing spec §10 AC-3), passes", async () => {
    for (const factor of ["1", "1.1"]) {
      const r = await run([
        "bun",
        "bench/compare/compare.ts",
        "--base-root",
        ROOT,
        "--id",
        "synthetic.spin",
        "--head-env",
        `MITORI_BENCH_SLOWDOWN=${factor}`,
        "--pairs",
        "2",
        "--no-absolute",
        "--no-wait",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pass");
    }
  }, 60_000);

  test("an extra counted call in head fails (deterministic counters)", async () => {
    const r = await run([
      "bun",
      "bench/compare/compare.ts",
      "--base-root",
      ROOT,
      "--id",
      "synthetic.counter",
      "--head-env",
      "MITORI_BENCH_EXTRA_CALLS=1",
      "--pairs",
      "1",
      "--no-absolute",
      "--no-wait",
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("synthetic.parseCalls");
  }, 60_000);

  test("--asset adds the served-bytes table with a Δ column against base (the same tree here: Δ 0)", async () => {
    const r = await run([
      "bun",
      "bench/compare/compare.ts",
      "--base-root",
      ROOT,
      "--id",
      "synthetic.value",
      "--pairs",
      "1",
      "--no-absolute",
      "--no-wait",
      "--asset",
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("| asset | base | head | Δ |");
    expect(r.out).toMatch(/asset\.js\.initial\.gz \| [\d.]+ KB \| [\d.]+ KB \| \+0\.000/);
  }, 90_000);

  test("usage errors exit 2", async () => {
    const r = await run(["bun", "bench/compare/compare.ts", "--base-root", ROOT, "--pairs", "0", "--no-absolute", "--no-wait"]);
    expect(r.code).toBe(2);
  });

  test("regression: a mistyped --id exits 2 instead of passing with nothing measured", async () => {
    const r = await run(["bun", "bench/compare/compare.ts", "--base-root", ROOT, "--id", "synthetic.spn", "--pairs", "1", "--no-absolute", "--no-wait"], ROOT, {
      MITORI_BENCH_SLOWDOWN: "1.25",
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("no case matches --id synthetic.spn");
  });
});

describe("BENCH-AT-02 real base worktree: head slower than its parent commit", () => {
  let repo = "";
  const git = (...args: string[]) => run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], repo);

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "mitori-cmp-repo-"));
    for (const dir of ["bench/runner", "bench/compare"]) {
      mkdirSync(join(repo, dir), { recursive: true });
      for (const f of readdirSync(join(ROOT, dir)))
        if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".bench.ts")) cpSync(join(ROOT, dir, f), join(repo, dir, f));
    }
    writeFileSync(join(repo, "bench/budgets.json"), JSON.stringify({ v: "mitori.budgets/1", budgets: [], counters: [] }));
    symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules")); // untracked; the base worktree gets the same link via --base-setup
    await git("init", "-q", "-b", "main");
    const caseFile = (ms: number) =>
      `import { defineBench } from "./runner/define.ts";\nexport const c = defineBench({ id: "idx.demo", suite: "idx", mode: "inproc", runs: 5, warmup: 0, run: () => { const end = performance.now() + ${ms}; while (performance.now() < end) {} } });\n`;
    writeFileSync(join(repo, "bench/demo.bench.ts"), caseFile(20));
    await git("add", "bench");
    await git("commit", "-q", "-m", "base");
    writeFileSync(join(repo, "bench/demo.bench.ts"), caseFile(25));
    await git("commit", "-q", "-am", "head: 25 % slower");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const compareCli = (...extra: string[]) =>
    run(
      [
        "bun",
        join(repo, "bench/compare/compare.ts"),
        "--base-setup",
        `ln -s ${join(ROOT, "node_modules")} node_modules`,
        "--pairs",
        "2",
        "--no-absolute",
        "--no-wait",
        ...extra,
      ],
      repo,
    );

  test("HEAD vs HEAD~1 fails and cleans up the worktree", async () => {
    const r = await compareCli("--base", "HEAD~1");
    expect(r.code).toBe(1);
    expect(r.out).toContain("idx.demo");
    expect(r.out).toContain("**REGRESSED**");
    expect((await git("worktree", "list")).out.trim().split("\n")).toHaveLength(1);
  }, 120_000);

  test("HEAD vs HEAD passes", async () => {
    const r = await compareCli("--base", "HEAD");
    expect(r.code).toBe(0);
  }, 120_000);

  test("an unknown base ref is a usage error", async () => {
    const r = await compareCli("--base", "no-such-ref");
    expect(r.code).toBe(2);
    expect(r.err).toContain("no-such-ref");
  });
});

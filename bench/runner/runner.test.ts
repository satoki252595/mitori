import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_FORMATS } from "@mitori/testkit";
import { type Budgets, readBudgets } from "./budgets.ts";
import { type AnyBench, defineBench, isBenchDef } from "./define.ts";
import { discover, matchesId, select } from "./discover.ts";
import { executeCase } from "./execute.ts";
import { gateResult } from "./gate.ts";
import { backgroundPriority, keepAwake, NOISY_RATIO, parseBackgroundPriority, parsePower, QUIET_WAIT_MS, recordReference, waitForQuiet } from "./machine.ts";
import type { BenchResultEntry, BenchResultFile } from "./result.ts";
import { runBench } from "./run.ts";
import { toSamples } from "./stats.ts";
import { convert, judgeBudget } from "./verdict.ts";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "mitori-bench-test-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const noRepo = { resolveRepo: async () => ({ path: "/nonexistent", dispose: async () => {} }) };
const asAny = (d: unknown) => d as AnyBench;

describe("BENCH-U-10 defineBench", () => {
  test("accepts dotted ids and brands the definition", () => {
    const d = defineBench({ id: "idx.s01.cold.100kloc", suite: "idx", mode: "process", run: () => {} });
    expect(isBenchDef(d)).toBe(true);
    expect(isBenchDef({ id: "x" })).toBe(false);
    expect(Object.isFrozen(d)).toBe(true);
  });

  test("rejects ids that are not budget-shaped and unknown suites", () => {
    expect(() => defineBench({ id: "nodots", suite: "idx", mode: "inproc", run: () => {} })).toThrow("dotted");
    expect(() => defineBench({ id: "Idx.upper", suite: "idx", mode: "inproc", run: () => {} })).toThrow("dotted");
    expect(() => defineBench({ id: "a.b", suite: "nope" as never, mode: "inproc", run: () => {} })).toThrow("unknown suite");
  });
});

describe("BENCH-U-11 discovery and selection", () => {
  test("the merged registry selects one crit cold open including the static doc, from the budget's canonical measure", async () => {
    const root = join(import.meta.dir, "../..");
    const cases = select(await discover(root), { ids: ["idx.s04.cold.100kloc"], exact: true });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.def).toMatchObject({ repo: "crit", suite: "idx", mode: "process" });
    const measure = readBudgets(root).budgets.get("idx.s04.cold.100kloc")?.measure.split("#")[0];
    expect(measure).toBe("bench/open.bench.ts");
    expect(cases[0]?.file).toBe(join(root, measure as string));
  });

  test("finds every exported case of every *.bench.ts, skips node_modules, rejects duplicate ids", async () => {
    const root = tmp();
    mkdirSync(join(root, "bench/node_modules/x"), { recursive: true });
    const def = join(import.meta.dir, "define.ts");
    const file = (ids: string[]) =>
      `import { defineBench } from ${JSON.stringify(def)};\n${ids.map((id, i) => `export const c${i} = defineBench({ id: ${JSON.stringify(id)}, suite: "idx", mode: "inproc", run: () => {} });`).join("\n")}\nexport const notACase = 1;\n`;
    writeFileSync(join(root, "bench/a.bench.ts"), file(["idx.a", "idx.b"]));
    writeFileSync(join(root, "bench/node_modules/x/ignored.bench.ts"), file(["idx.ignored"]));
    expect((await discover(root)).map((f) => f.def.id)).toEqual(["idx.a", "idx.b"]);
    // a second tree (Bun caches directory listings, so a file added later would not be importable)
    const dup = tmp();
    mkdirSync(join(dup, "bench"));
    writeFileSync(join(dup, "bench/a.bench.ts"), file(["idx.a"]));
    writeFileSync(join(dup, "bench/b.bench.ts"), file(["idx.a"]));
    await expect(discover(dup)).rejects.toThrow("duplicate bench id");
  });

  test("a tree without bench/ has no cases", async () => {
    expect(await discover(tmp())).toEqual([]);
  });

  test("a checkout below node_modules still finds its own cases", async () => {
    const root = join(tmp(), "node_modules/.cache/runner/_work/mitori/mitori");
    mkdirSync(join(root, "bench/node_modules/vendor"), { recursive: true });
    const def = JSON.stringify(join(import.meta.dir, "define.ts"));
    const file = (id: string) =>
      `import { defineBench } from ${def};\nexport const bench = defineBench({ id: "${id}", suite: "ui", mode: "inproc", run: () => 1 });\n`;
    writeFileSync(join(root, "bench/ui.bench.ts"), file("ui.root"));
    writeFileSync(join(root, "bench/node_modules/vendor/ignored.bench.ts"), file("ui.vendor"));
    expect((await discover(root)).map((f) => f.def.id)).toEqual(["ui.root"]);
  });

  test("id patterns: exact, prefix on a dot boundary, glob; --exact turns the prefix off", () => {
    expect(matchesId("idx.s01.cold.100kloc", "idx.s01")).toBe(true);
    expect(matchesId("idx.s010", "idx.s01")).toBe(false);
    expect(matchesId("idx.s01.cold", "idx.s01", true)).toBe(false);
    expect(matchesId("idx.s01", "idx.s01", true)).toBe(true);
    expect(matchesId("idx.warm.rescan", "idx.*.rescan")).toBe(true);
    expect(matchesId("idx.warm.rescan.7k", "idx.*.rescan")).toBe(false);
  });

  test("`all` excludes synthetic; naming it or an id includes it; unknown suites throw", () => {
    const mk = (id: string, suite: "idx" | "synthetic") => ({ file: "f", def: asAny(defineBench({ id, suite, mode: "inproc", run: () => {} })) });
    const all = [mk("idx.a", "idx"), mk("synthetic.a", "synthetic")];
    expect(select(all, {}).map((f) => f.def.id)).toEqual(["idx.a"]);
    expect(select(all, { suites: ["all"] }).map((f) => f.def.id)).toEqual(["idx.a"]);
    expect(select(all, { suites: ["synthetic"] }).map((f) => f.def.id)).toEqual(["synthetic.a"]);
    expect(select(all, { ids: ["synthetic.a"] }).map((f) => f.def.id)).toEqual(["synthetic.a"]);
    expect(() => select(all, { suites: ["nope"] })).toThrow("unknown suite");
  });
  test("routine selections exclude live engine artifacts, even for an explicit id", () => {
    const live = { file: "f", def: asAny(defineBench({ id: "agent.resident.procs", suite: "loop", mode: "inproc", live: true, run: () => 0 })) };
    expect(select([live], { ids: [live.def.id] })).toHaveLength(0);
    expect(select([live], { ids: [live.def.id], live: true })).toEqual([live]);
  });
});

describe("BENCH-U-12 executeCase", () => {
  test("inproc: warm-up runs are discarded, explicit runs are exact, wall time is the sample", async () => {
    let calls = 0;
    const out = await executeCase(asAny(defineBench({ id: "t.a", suite: "idx", mode: "inproc", runs: 4, warmup: 2, run: () => void calls++ })), noRepo);
    expect(calls).toBe(6);
    expect(out.entry.values).toHaveLength(4);
    expect(out.entry).toMatchObject({ id: "t.a", unit: "ms", suite: "idx", mode: "inproc", budgetStat: "median" });
  });

  test("a returned number is the sample (RSS, bytes, a child's own timing)", async () => {
    let n = 0;
    const out = await executeCase(
      asAny(defineBench({ id: "t.v", suite: "idx", mode: "inproc", unit: "MB", runs: 3, warmup: 0, run: () => 100 + n++ })),
      noRepo,
    );
    expect(out.entry.values).toEqual([100, 101, 102]);
    expect(out.entry.unit).toBe("MB");
  });

  test("a run that does not await its work (a rejection nobody handles) is an error, not a fast number", () => {
    // in a plain Bun process, as the runner is (bun:test fails the current test on any unhandled rejection itself)
    const script = `
      import { defineBench } from "./define.ts";
      import { executeCase } from "./execute.ts";
      const work = async () => { await Bun.sleep(1); throw new Error("git not found on PATH"); };
      const noRepo = { resolveRepo: async () => { throw new Error("no repo"); } };
      const run = async (id, fn) => (await executeCase(defineBench({ id, suite: "idx", mode: "inproc", runs: 3, warmup: 0, run: fn }), noRepo)).entry;
      const stray = await run("t.u", () => void work());
      const awaited = await run("t.w", () => work());
      const handled = await run("t.h", () => void work().catch(() => undefined));
      console.log(JSON.stringify({ stray, awaited, handled }));
    `;
    const p = Bun.spawnSync([process.execPath, "-e", script], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
    expect(p.stderr.toString()).toBe("");
    const r = JSON.parse(p.stdout.toString()) as Record<"stray" | "awaited" | "handled", { values: number[]; error?: string }>;
    expect(r.stray.values).toEqual([]);
    expect(r.stray.error).toContain("3 unhandled rejection(s)");
    expect(r.stray.error).toContain("git not found on PATH");
    // awaited, the same failure is the case's own error; a rejection the run handles is not stray
    expect(r.awaited.error).toBe("git not found on PATH");
    expect(r.handled.error).toBeUndefined();
    expect(r.handled.values).toHaveLength(3);
  });

  test("CLI overrides win over the case's own counts", async () => {
    const out = await executeCase(asAny(defineBench({ id: "t.o", suite: "idx", mode: "inproc", runs: 9, warmup: 5, run: () => {} })), {
      ...noRepo,
      runs: 2,
      warmup: 0,
    });
    expect(out.entry.values).toHaveLength(2);
  });

  test("process mode: a fresh empty home per run, removed afterwards; defaults to 1 warm-up + 5 runs", async () => {
    const homes: string[] = [];
    const out = await executeCase(
      asAny(
        defineBench({
          id: "t.p",
          suite: "idx",
          mode: "process",
          run: (_s, ctx) => {
            homes.push(ctx.home);
            expect(existsSync(ctx.home)).toBe(true);
          },
        }),
      ),
      noRepo,
    );
    expect(out.entry.values).toHaveLength(5);
    expect(homes).toHaveLength(6);
    expect(new Set(homes).size).toBe(6);
    for (const h of homes) expect(existsSync(h)).toBe(false);
  });

  test("setup state reaches run, teardown and counters; teardown runs after a failing run", async () => {
    const log: string[] = [];
    const out = await executeCase(
      asAny(
        defineBench<{ n: number }>({
          id: "t.s",
          suite: "idx",
          mode: "inproc",
          runs: 2,
          warmup: 0,
          setup: () => ({ n: 7 }),
          run: (s) => void log.push(`run${s.n}`),
          teardown: (s) => void log.push(`teardown${s.n}`),
          counters: (s) => ({ "t.calls": s.n }),
        }),
      ),
      noRepo,
    );
    expect(log).toEqual(["run7", "run7", "teardown7"]);
    expect(out.counters).toEqual([{ id: "t.calls", value: 7 }]);

    const torn: string[] = [];
    const failed = await executeCase(
      asAny(
        defineBench({
          id: "t.f",
          suite: "idx",
          mode: "inproc",
          runs: 2,
          warmup: 0,
          run: () => {
            throw new Error("kaboom");
          },
          teardown: () => void torn.push("td"),
        }),
      ),
      noRepo,
    );
    expect(failed.entry.error).toBe("kaboom");
    expect(failed.entry.values).toEqual([]);
    expect(torn).toEqual(["td"]);
  });

  test("a case's repo is resolved, handed to run and disposed", async () => {
    const events: string[] = [];
    await executeCase(
      asAny(defineBench({ id: "t.r", suite: "idx", mode: "inproc", repo: "flask", runs: 1, warmup: 0, run: (_s, ctx) => void events.push(`run:${ctx.repo}`) })),
      {
        resolveRepo: async (name) => ({ path: `/corpus/${name}`, dispose: async () => void events.push("dispose") }),
      },
    );
    expect(events).toEqual(["run:/corpus/flask", "dispose"]);
  });

  test("a repo that cannot be resolved becomes a case error, not a crash", async () => {
    const out = await executeCase(asAny(defineBench({ id: "t.m", suite: "idx", mode: "inproc", repo: "flask", run: () => {} })), {
      resolveRepo: async () => {
        throw new Error('corpus "flask" is not fetched');
      },
    });
    expect(out.entry.error).toContain("not fetched");
  });
});

const entry = (id: string, unit: BenchResultEntry["unit"], values: number[], extra: Partial<BenchResultEntry> = {}): BenchResultEntry => ({
  ...toSamples(id, unit, values),
  suite: "idx",
  mode: "inproc",
  budgetStat: "median",
  ...extra,
});
const file = (results: BenchResultEntry[], counters: BenchResultFile["counters"] = [], factor = 1): BenchResultFile => ({
  v: TEST_FORMATS.benchResult,
  sha: "",
  machine: { cpu: "t", cores: 1, ramGb: 1, os: "t", bun: "1", node: "1", chrome: null, loadavg: 0, noisy: false, power: null },
  factor,
  factorSource: "measured",
  startedAt: "",
  results,
  counters,
});
const budgets = (bs: object[], cs: object[] = []): Budgets => ({
  budgets: new Map((bs as { id: string }[]).map((b) => [b.id, b as never])),
  counters: new Map((cs as { id: string }[]).map((c) => [c.id, c as never])),
});
const B = { metric: "m", target: 10, limit: 20, unit: "ms", dir: "max", gates: ["absolute"], owner: "x", measure: "a#b", scale: "machine", provisional: false };

describe("BENCH-U-13 budget verdicts", () => {
  test("green ≤ target, yellow ≤ limit, red beyond; dir min mirrors it", () => {
    const j = (value: number, extra = {}) => judgeBudget({ ...B, id: "x.y", ...extra } as never, value, { factor: 1 }).level;
    expect([j(10), j(10.1), j(20), j(20.1)]).toEqual(["green", "yellow", "yellow", "red"]);
    const min = { dir: "min", target: 99, limit: 95 };
    expect([j(100, min), j(99, min), j(97, min), j(94, min)]).toEqual(["green", "green", "yellow", "red"]);
  });

  test("machine-scaled budgets gate only on the reference machine and scale elsewhere", () => {
    const ref = judgeBudget({ ...B, id: "x.y" } as never, 25, { factor: 1.05 });
    expect(ref).toMatchObject({ level: "red", gating: true, scaled: false });
    const slow = judgeBudget({ ...B, id: "x.y" } as never, 25, { factor: 2 });
    expect(slow).toMatchObject({ level: "yellow", gating: false, scaled: true, target: 20, limit: 40 });
    const bytes = judgeBudget({ ...B, id: "x.y", scale: "none", unit: "KB" } as never, 25, { factor: 2 });
    expect(bytes).toMatchObject({ level: "red", gating: true, scaled: false });
  });

  test("unit conversion within time and size families only", () => {
    expect(convert(1500, "ms", "s")).toBe(1.5);
    expect(convert(2, "s", "ms")).toBe(2000);
    expect(convert(150_000, "B", "KB")).toBe(150);
    expect(convert(3, "MB", "KB")).toBe(3000);
    expect(() => convert(1, "ms", "KB")).toThrow("cannot compare");
  });

  test("gateResult: limits, counters and case errors fail; absent budgets and relative-only budgets are ignored", () => {
    const bs = budgets(
      [
        { ...B, id: "a.slow" },
        { ...B, id: "a.fast" },
        { ...B, id: "a.rel", gates: ["relative"] },
      ],
      [{ id: "c.calls", max: 0, owner: "x", measure: "a#b" }],
    );
    const ok = gateResult(file([entry("a.fast", "ms", [5]), entry("a.rel", "ms", [999]), entry("a.nobudget", "ms", [999])], [{ id: "c.calls", value: 0 }]), bs);
    expect(ok.ok).toBe(true);
    expect(ok.verdicts.map((v) => v.id)).toEqual(["a.fast"]);
    expect(gateResult(file([entry("a.slow", "ms", [25])]), bs).ok).toBe(false);
    expect(gateResult(file([entry("a.fast", "ms", [5])], [{ id: "c.calls", value: 1 }]), bs).ok).toBe(false);
    expect(gateResult(file([entry("a.fast", "ms", [], { error: "boom" })]), bs).errors).toEqual([{ id: "a.fast", error: "boom" }]);
  });

  test("a loaded machine reports time budgets as skipped instead of failing them; sizes still gate", () => {
    const bs = budgets([
      { ...B, id: "a.slow" },
      { ...B, id: "a.bytes", scale: "none", unit: "KB", gates: ["structural"] },
    ]);
    const loaded = file([entry("a.slow", "ms", [25])]);
    loaded.machine = { ...loaded.machine, cores: 18, loadavg: 30, noisy: true };
    const g = gateResult(loaded, bs);
    expect(g.ok).toBe(true);
    expect(g.verdicts[0]).toMatchObject({ level: "red", gating: false, skipped: "machine under load (loadavg 30.00)" });
    // the load of the case itself counts too: the run started quiet, this case did not
    const lateLoad = file([entry("a.slow", "ms", [25], { loadavg: 12 })]);
    lateLoad.machine = { ...lateLoad.machine, cores: 18, loadavg: 2 };
    expect(gateResult(lateLoad, bs)).toMatchObject({ ok: true, verdicts: [{ skipped: "machine under load (loadavg 12.00)" }] });
    const quiet = file([entry("a.slow", "ms", [25], { loadavg: 3 })]);
    quiet.machine = { ...quiet.machine, cores: 18, loadavg: 2 };
    expect(gateResult(quiet, bs).ok).toBe(false);
    const big = file([entry("a.bytes", "KB", [25])]);
    big.machine = { ...big.machine, cores: 18, loadavg: 30, noisy: true };
    expect(gateResult(big, bs).ok).toBe(false);
  });

  test("budgetStat p95 feeds the p95 into the budget", () => {
    const bs = budgets([{ ...B, id: "a.p" }]);
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 30];
    expect(gateResult(file([entry("a.p", "ms", values)]), bs).ok).toBe(true);
    expect(gateResult(file([entry("a.p", "ms", values, { budgetStat: "p95" })]), bs).ok).toBe(false);
  });
});

describe("BENCH-U-14 waiting for a quiet machine", () => {
  test("waits up to twice, then runs flagged noisy", async () => {
    const waits: number[] = [];
    const r = await waitForQuiet({ loadavg: () => 12, cores: 8, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toHaveLength(2);
    expect(r).toMatchObject({ noisy: true, waited: 2, loadavg: 12 });
  });

  test("regression: the default wait is long enough for the 1-minute load average to move (30 s, not 2 s)", async () => {
    const waits: number[] = [];
    await waitForQuiet({ loadavg: () => 12, cores: 8, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([QUIET_WAIT_MS, QUIET_WAIT_MS]);
    expect(QUIET_WAIT_MS).toBe(30_000);
  });

  test("the macOS power source is read off pmset; keepAwake is a no-op off macOS", () => {
    expect(parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged")).toBe("ac");
    expect(parsePower("Now drawing from 'Battery Power'\n")).toBe("battery");
    expect(parsePower("")).toBeNull();
    expect(() => keepAwake("linux")).not.toThrow();
  });

  test("proceeds at once when load ≤ cores × 0.5, and stops waiting when it drops", async () => {
    expect((await waitForQuiet({ loadavg: () => 4, cores: 8, sleep: async () => {} })).noisy).toBe(false);
    const loads = [10, 3];
    const r = await waitForQuiet({ loadavg: () => loads.shift() ?? 0, cores: 8, sleep: async () => {} });
    expect(r).toMatchObject({ noisy: false, waited: 1 });
  });
});

describe("BENCH-U-15 runBench on the synthetic suite", () => {
  test("measures the cases, records counters and the machine", async () => {
    const r = await runBench({ suites: ["synthetic"], ids: ["synthetic.counter", "synthetic.value"], wait: false });
    expect(r.ok).toBe(true);
    expect(r.file.v).toBe(TEST_FORMATS.benchResult);
    expect(r.file.results.map((x) => x.id).sort()).toEqual(["synthetic.counter", "synthetic.value"]);
    expect(r.file.counters).toEqual([{ id: "synthetic.parseCalls", value: 0 }]);
    expect(r.file.machine.cores).toBeGreaterThan(0);
    expect(r.text).toContain("synthetic.value");
  });

  test("synthetic.spin takes MITORI_BENCH_SLOWDOWN into account (virtual time: deterministic under load)", async () => {
    const prev = { slow: process.env.MITORI_BENCH_SLOWDOWN, virt: process.env.MITORI_BENCH_VIRTUAL };
    process.env.MITORI_BENCH_VIRTUAL = "1";
    try {
      const base = await runBench({ ids: ["synthetic.spin"], wait: false, runs: 3, warmup: 0 });
      process.env.MITORI_BENCH_SLOWDOWN = "1.5";
      const slow = await runBench({ ids: ["synthetic.spin"], wait: false, runs: 3, warmup: 0 });
      const [a, b] = [base.file.results[0]?.median ?? 0, slow.file.results[0]?.median ?? 0];
      expect([a, b]).toEqual([20, 30]);
    } finally {
      for (const [k, v] of [
        ["MITORI_BENCH_SLOWDOWN", prev.slow],
        ["MITORI_BENCH_VIRTUAL", prev.virt],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  });

  // the real busy-wait path, timed: meaningful on a quiet machine only (a loaded one preempts the spin)
  const loaded = (os.loadavg()[0] ?? 0) > os.cpus().length * NOISY_RATIO;
  if (loaded) console.warn(`BENCH-U-15: the real-time spin check is skipped — loadavg ${os.loadavg()[0]?.toFixed(1)} > cores × ${NOISY_RATIO}`);
  test.skipIf(loaded)("the real busy-wait spin lasts its nominal 20 ms on a quiet machine", async () => {
    const r = await runBench({ ids: ["synthetic.spin"], wait: false, runs: 3, warmup: 0 });
    expect(r.file.results[0]?.median ?? 0).toBeGreaterThanOrEqual(20);
    expect(r.file.results[0]?.median ?? 0).toBeLessThan(30);
  });
});

describe("BENCH-U-16 macOS background priority", () => {
  test("darwinbg is `ps -o pri=` 4 (padded, as ps prints it); anything else is foreground", () => {
    expect(parseBackgroundPriority("       4\n")).toBe(true);
    for (const out of ["      31\n", "", "  -\n"]) expect(parseBackgroundPriority(out)).toBe(false);
  });

  test("null off darwin and when ps is unavailable; the pid reaches the ps args", () => {
    expect(backgroundPriority({ platform: "linux", run: () => ({ status: 0, stdout: "4" }) })).toBeNull();
    expect(backgroundPriority({ platform: "darwin", run: () => ({ status: 1, stdout: "" }) })).toBeNull();
    expect(
      backgroundPriority({
        platform: "darwin",
        run: () => {
          throw new Error("ps not found");
        },
      }),
    ).toBeNull();
    const seen: string[][] = [];
    expect(backgroundPriority({ platform: "darwin", pid: 4242, run: (args) => (void seen.push(args), { status: 0, stdout: "31\n" }) })).toBe(false);
    expect(seen).toEqual([["-o", "pri=", "-p", "4242"]]);
    expect(backgroundPriority({ platform: "darwin", run: () => ({ status: 0, stdout: "4\n" }) })).toBe(true);
  });

  test("recordReference refuses at background priority without touching the recorded file", () => {
    const root = tmp();
    expect(() => recordReference(root, 5, { background: () => true })).toThrow("background priority");
    expect(existsSync(join(root, "bench/runner/reference.json"))).toBe(false);
  });

  // A sandboxed shell cannot exec ps/taskpolicy, so this only runs where probing works (a real Mac, not Ubuntu CI).
  const canProbeLive = process.platform === "darwin" && existsSync("/usr/sbin/taskpolicy") && backgroundPriority() !== null;
  if (process.platform === "darwin" && !canProbeLive)
    console.warn("BENCH-U-16: the live taskpolicy check is skipped — ps or taskpolicy is unavailable in this shell");
  test.skipIf(!canProbeLive)("a taskpolicy -b child reads background, a plain child does not", () => {
    const probe = `import { backgroundPriority } from ${JSON.stringify(join(import.meta.dir, "machine.ts"))}; console.log(JSON.stringify(backgroundPriority()));`;
    const plain = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", timeout: 60_000 });
    expect(plain.status).toBe(0);
    expect(JSON.parse(plain.stdout.trim())).toBe(false);
    const bg = spawnSync("taskpolicy", ["-b", process.execPath, "-e", probe], { encoding: "utf8", timeout: 60_000 });
    expect(bg.status).toBe(0);
    expect(JSON.parse(bg.stdout.trim())).toBe(true);
  });
});

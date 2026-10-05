// `bun run check`: the dev-loop gate (MILESTONES WP-00a 成果物 6). Steps run in parallel; output is shown per
// step only when it fails (or with --verbose). Reference wall time: warn > 15 s, fail > 30 s; Ubuntu Actions scales
// those budgets by a measured machine factor (testing spec §1.6).
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

const STEPS: [name: string, argv: string[]][] = [
  ["tsc", ["bun", "scripts/typecheck.ts"]],
  ["biome", ["biome", "ci", "--colors=off", "."]],
  ["boundaries", ["bun", "scripts/check-boundaries.ts"]],
  ["cr-ledger", ["bun", "scripts/check-cr-ledger.ts"]],
  ["budgets", ["bun", "scripts/check-budgets.ts"]],
  ["contract-index", ["bun", "scripts/contract-index.ts", "--check"]],
  ["svelte-check", ["svelte-check", "--workspace", "apps/web", "--tsconfig", "./tsconfig.json", "--fail-on-warnings", "--output", "human"]],
];

export async function runCheckStep(name: string, argv: string[]) {
  // Piped logs carry no ANSI codes: NO_COLOR, and drop FORCE_COLOR (picocolors treats even "0" as "force on").
  const { FORCE_COLOR: _forced, ...env } = process.env;
  const start = performance.now();
  const proc = Bun.spawn(argv, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...env, NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { name, code, ms: performance.now() - start, log: `${out}${err}`.trim() };
}

export function checkVerdict(wall: number, failed: number, factor = 1) {
  const target = 15 * factor;
  const limit = 30 * factor;
  return { target, limit, exitCode: failed > 0 || wall > limit ? 1 : 0 };
}

if (import.meta.main) {
  let factor = 1;
  if (process.platform === "linux" && process.env.GITHUB_ACTIONS === "true") {
    try {
      // Keep the bench project out of scripts' TS project-reference graph; reuse its canonical calibration at runtime.
      const { measureFactor, readReference } = (await import(join(ROOT, "bench/runner/machine.ts"))) as {
        readReference(root: string): { calib?: { totalMs?: number } } | null;
        measureFactor(root: string): { factor: number; source: "measured" | "assumed" };
      };
      const refMs = readReference(ROOT)?.calib?.totalMs;
      if (typeof refMs !== "number" || !Number.isFinite(refMs) || refMs <= 0) throw new Error("valid reference calibration is required");
      const measured = measureFactor(ROOT);
      if (measured.source !== "measured" || !Number.isFinite(measured.factor) || measured.factor < 0.5 || measured.factor > 5) {
        throw new Error("valid measured machine factor is required");
      }
      factor = measured.factor;
      console.log(
        `check: CI machine factor ${factor.toFixed(3)}; target ${(15 * factor).toFixed(2)} s; limit ${(30 * factor).toFixed(2)} s (reference 15 / 30 s)`,
      );
    } catch (error) {
      console.error(`check: calibration failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  const verbose = process.argv.includes("--verbose");
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const t0 = performance.now();
  const results = await Promise.all(
    STEPS.filter(([name]) => only.length === 0 || only.some((o) => name.includes(o))).map(([name, argv]) => runCheckStep(name, argv)),
  );
  const wall = (performance.now() - t0) / 1000;
  let failed = 0;
  for (const r of results) {
    const ok = r.code === 0;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${r.name.padEnd(15)} ${(r.ms / 1000).toFixed(2)} s`);
    if ((!ok || verbose || (process.env.GITHUB_ACTIONS === "true" && r.name === "tsc")) && r.log) console.log(r.log.replace(/^/gm, "    "));
  }
  const verdict = checkVerdict(wall, failed, factor);
  console.log(`check: ${failed === 0 ? "ok" : `${failed} step(s) failed`} in ${wall.toFixed(2)} s`);
  if (wall > verdict.limit) console.error(`check: wall time over the ${verdict.limit.toFixed(2)} s limit (testing spec §1.6)`);
  else if (wall > verdict.target) console.warn(`check: wall time over the ${verdict.target.toFixed(2)} s target`);
  process.exit(verdict.exitCode);
}

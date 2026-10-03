// `bun run check`: the dev-loop gate (MILESTONES WP-00a 成果物 6). Steps run in parallel; output is shown per
// step only when it fails (or with --verbose). Wall time: warn > 15 s, fail > 30 s (testing spec §1.6).
import { ROOT } from "./lib/repo.ts";

const STEPS: [name: string, argv: string[]][] = [
  ["tsc -b", ["tsc", "-b", "--pretty", "false"]],
  ["biome", ["biome", "ci", "--colors=off", "."]],
  ["boundaries", ["bun", "scripts/check-boundaries.ts"]],
  ["cr-ledger", ["bun", "scripts/check-cr-ledger.ts"]],
  ["budgets", ["bun", "scripts/check-budgets.ts"]],
  ["contract-index", ["bun", "scripts/contract-index.ts", "--check"]],
  ["svelte-check", ["svelte-check", "--workspace", "apps/web", "--tsconfig", "./tsconfig.json", "--fail-on-warnings", "--output", "human"]],
];

// Piped logs carry no ANSI codes: NO_COLOR, and drop FORCE_COLOR (picocolors treats even "0" as "force on").
const { FORCE_COLOR: _forced, ...env } = process.env;
const verbose = process.argv.includes("--verbose");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const t0 = performance.now();
const results = await Promise.all(
  STEPS.filter(([name]) => only.length === 0 || only.some((o) => name.includes(o))).map(async ([name, argv]) => {
    const start = performance.now();
    const proc = Bun.spawn(argv, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...env, NO_COLOR: "1" } });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { name, code, ms: performance.now() - start, log: `${out}${err}`.trim() };
  }),
);
const wall = (performance.now() - t0) / 1000;
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${r.name.padEnd(15)} ${(r.ms / 1000).toFixed(2)} s`);
  if ((!ok || verbose) && r.log) console.log(r.log.replace(/^/gm, "    "));
}
console.log(`check: ${failed === 0 ? "ok" : `${failed} step(s) failed`} in ${wall.toFixed(2)} s`);
if (wall > 30) console.error("check: wall time over the 30 s limit (testing spec §1.6)");
else if (wall > 15) console.warn("check: wall time over the 15 s target");
process.exit(failed > 0 || wall > 30 ? 1 : 0);

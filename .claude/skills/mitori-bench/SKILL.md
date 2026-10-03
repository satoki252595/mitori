---
name: mitori-bench
description: Run and extend mitori's performance gates - bench cases (head vs base compare, absolute budgets), served-bytes asset budgets (`bun run size`), the Playwright harness (`bun run e2e`, DOM nodes / mounted code lines / fetch counts / INP) and the eval skeleton (`bun run eval --suite smoke`). Use when a change may slow something down, when a budget in bench/budgets/*.json is red or needs a measuring case, when writing a *.bench.ts or an e2e perf spec, or when asked to "benchmark", "compare against main", "check bundle size" or "check the budgets".
---

# mitori-bench

Everything runs through `scripts/nd` (cached nix devShell). Budgets live in `bench/budgets/<pkg>.json`, merged into
`bench/budgets.json` (`scripts/nd bun run budgets:merge`); ids are the same everywhere (bench case id, e2e budget id, SLO row).

## Which gate, which command

| Question | Command | Fails when |
|---|---|---|
| Did my change slow a bench case? | `scripts/nd bun run bench:compare [--suite idx] [--id idx.s01]` | median ≥ 20 % worse than the merge base **and** above the noise floor, after a 2P re-measure; a counter above base; a head budget over its limit |
| What are the numbers on this machine? | `scripts/nd bun run bench [--suite idx] [--absolute] [--out auto]` | `--absolute`: a budget limit is exceeded (time budgets only gate on the reference machine, factor within 10 %) |
| Is the web bundle within budget? | `scripts/nd bun run size` (binary size first, then served bytes, then `mitori --version` startup) | initial JS > 150 KB gz, CSS > 25 KB gz, any web font; `--strict` makes every chunk limit hard (from M3); startup > 50 ms on the reference machine |
| DOM / code lines / INP / requests of a screen | `scripts/nd bun run e2e --grep @<wp>` (Playwright, chromium; `--project webkit`, `perf`) | a spec asserts `expectWithinBudget(id, value)` |
| Does the eval harness work? | `scripts/nd bun run eval --suite smoke` | a harness check fails (fake engine, 0 tokens) |

`bench:compare` flags: `--base <ref>` (default merge-base with main), `--base-root <dir>` (an existing tree), `--pairs n`,
`--head-env KEY=VAL` (play base and head from one checkout: `MITORI_BENCH_SLOWDOWN=1.25` on `synthetic.spin` must fail),
`--budget-change` (a counter may rise only when `counters[id].max` was raised in the same change), `--asset` (served-bytes table with
Δ vs base; head's hard asset limits gate), `--no-wait` (skip the quiet-machine wait), `--md <file>` (PR comment).
Cases with cv > 25 % are "noisy": a warning, never a failure. A case missing in base is "new".

## Writing a bench case

`bench/<area>.bench.ts` (any `**/*.bench.ts` below `bench/`):

```ts
import { defineBench, timedSpawn } from "./runner/define.ts";
export const coldScan = defineBench({
  id: "idx.s01.cold.100kloc",   // the budget id
  suite: "idx", mode: "process", // process: fresh child + empty MITORI_HOME per run (cold); inproc: micro, warm-up 3 / 15 runs
  repo: "crit",                  // corpus name (bench/corpus.lock.json, `corpus:fetch`) or a fixture name
  run: async (_s, ctx) => (await timedSpawn(["mitori", ctx.repo!], { env: { MITORI_HOME: ctx.home } })).ms,
});
```

- Return a number to report it as the sample (RSS, bytes, a child's own timing); return nothing to report the call's wall time.
- `budgetStat: "p95"` when the budget is a p95; `counters(state)` returns `{ "idx.warm.parseCalls": n }` for deterministic counters.
- The unit must match the budget (`ms`/`s`, `B`/`KB`/`MB` convert; anything else must be equal).
- Offline corpus: `MITORI_BENCH_REPOS="flask=/abs/flask"`; corpus cache: `~/.cache/mitori-corpus` (`MITORI_CORPUS_DIR`).
- Cases in the `synthetic` suite are the harness's own self-test and are not part of `--suite all`.

## Reference machine and noise

`bench/runner/reference.json` is the calibration of the maintainer's machine (`bun bench/runner/run.ts --record-reference`
on an idle machine; commit it with the machine description). `factor` = this run / reference, clamped to [0.5, 5]. Before a
run the 1-minute load average must be ≤ cores × 0.5 (two waits, then the result is flagged `noisy`; `--no-wait` skips it).

## e2e harness

Specs go in `e2e/<area>/*.spec.ts`, tags `@pr` / `@nightly` / `@live`. `import { test, expect, expectWithinBudget } from "../harness/fixtures.ts"`;
`mitori` is a per-test daemon (`test.use({ daemonOptions: { fixture: "go-small" } })`), `await mitori.login(page, "/")` installs the
INP / CLS collectors before the first script. `ui.*` (testkit) reads the page; `harness/metrics.ts` has `inpSummary`, `trackRequests`,
`initialJs`, `markLatencies`; `harness/trace.ts#withPerfTrace` keeps a Chrome trace (long tasks, forced reflows) on failure or `MITORI_PERF_TRACE=1`. Playwright cannot run under `bun test` (it collects `*.spec.ts`), see docs/design/cr-requests/WP-12.md.

## Fix-it list

- **bench:compare says "could not list bench cases" for base**: base predates the runner or its bench files do not load; the case is reported as new.
- **size fails with no web build**: it runs `scripts/gen-assets.ts` itself; a stale `dist/.build` is rebuilt by `scripts/nd bun run build:bin`.
- **Budget edited**: `scripts/nd bun run budgets:merge`, commit `bench/budgets.json` (`check` fails when it is stale).

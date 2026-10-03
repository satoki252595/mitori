---
name: mitori-measure
description: Take mitori's P0 measurements - an early Pass 1 cost/size estimate with `bench/measure/pass1-proto.ts` (a dry-run plan, or a capped live run on lean `claude -p`), and the M2 measurement window (O1/O2, M-1..M-12 of the generation spec) that fixes `gen.std.*` in bench/budgets/gen.json. Use when asked "what will standard generation cost on repo X", "measure Pass 1", "open the measurement window", or before changing generation budgets. Never spends anything without MITORI_LIVE=1 and an explicit --max-usd.
---

# mitori-measure

Measurements spend the user's subscription window (API-equivalent dollars in the report, not money), so they are explicit:
a dry run is free, a live run needs `MITORI_LIVE=1`, `--run` and `--max-usd`. **Never use an API key** for these (CLAUDE.md: more than
¥1,000 a month needs the user's approval first); a call whose `init.apiKeySource` is not `none` aborts the run and exits 3.

## pass1-proto (SC-02): an early number before the M2 window

```
scripts/nd bun bench/measure/pass1-proto.ts --repo <dir> [--modules 10] [--model claude-sonnet-5-5] [--effort low]   # dry run
MITORI_LIVE=1 scripts/nd bun bench/measure/pass1-proto.ts --repo <dir> --run --max-usd 8 --concurrency 3 --out report.json
```

- Dry run: inventory (git-tracked source files, no vendored/lock/minified), module grouping by directory, the repo pack and a
  per-module prompt size; prints the estimate in tokens and API-equivalent $ with the product's own price table, and the
  input ratio against `naive_full` (the SLO `gen.ratio.inputNaive`: target ≤ 0.20, limit 0.30). The output size per page
  (2.5k tokens) and the body budget are `[仮]` constants at the top of the file, replaced by measured values (M-10).
- Live: one lean `claude -p` per module page (the product's argv: stream-json, no tools, no settings, no MCP, no session, 5-minute
  cache TTL, empty cwd), at most `--concurrency` in flight; a call starts only if spent + calls in flight at their cap
  (`--per-call-usd`, default 0.5) + its own cap still fits `--max-usd`. The report lists per-call tokens (in / cache write /
  cache read / out), API-equivalent $, ttft and makespan.
- `--digest <json>` replaces the regex skeleton with real indexer output (`{ files: [{ path, chars, tokens, skeleton[], module }] }`)
  once WP-02/03 can emit it; until then the numbers are a rough, throwaway estimate. Treat a live run's result as a hint, not a budget.
- The script is throwaway: after the M2 window its numbers are superseded by `docs/specs/gen-pass1-measurement.md`.

## The M2 measurement window (plan, not yet automated)

Per MILESTONES §6: 3 h × 2, implementation agents stopped so the 5-hour window delta is attributable. Measure O1/O2 and
M-1..M-12 (generation spec §16: D14 NDJSON vs `--json-schema` on crit and m3e, Pass 1 at C=3, the tail cache, thinking Θ, κ,
refusal shape), then fix `gen.std.*` in `bench/budgets/gen.json` (then `scripts/nd bun run budgets:merge`). Rules for the session:

1. Check `GET /engines` billing is `subscription-window` before starting and record the window before/after.
2. Count other `claude` processes (`pgrep -x claude`); the window delta is only a reference when there are none.
3. Stay under the generation spec's per-measurement caps (M-1 $3, M-2 $8, M-3 $1, ...) and the weekly $20 allowance
   (`eval/reports/*/summary.json` carries `budget.spentUsd`).
4. Record raw streams into `fixtures/agent-streams/` (secret-scanned) and the findings in the spec named by the generation spec.

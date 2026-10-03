# bench/budgets/

One `<pkg>.json` per owning package (`mitori.budgets/1`: `{ v, budgets[], counters[] }`). Each WP edits only its own file;
`bun scripts/budgets-merge.ts` concatenates them into `bench/budgets.json` (committed, regenerate after an edit;
`--check` fails when it is stale). `scripts/check-budgets.ts` (part of `check`) lints shape and cross-file id uniqueness and
runs that same stale check (CR m0-15), so an edited `<pkg>.json` without a regenerated `bench/budgets.json` fails `check`.

Source of the numbers: the domain specs' tables win over testing spec §6.1 and ARCHITECTURE §10.2 (CONS-29):
indexer §11.3 (`indexer.json`), loop §0.3 (`loop.json`, `anchor.json`, `agent.json`), generation §7.4 (`gen.json`),
ux §13.1 (`web.json`), server §1.4 (`server.json`), testing §6.1 for the rest.

Conventions
- Time budgets are in `ms` (`s` only for generation latencies), `scale: "machine"`; sizes/counts/tokens/ratios use `scale: "none"`.
- `dir: "max"` = green when value ≤ `target`, red beyond `limit`; `dir: "min"` mirrors it (percent rates).
- Metrics with a percentile say so in `metric` (e.g. `ui.inp`: target is p75, limit is p98).
- `measure` is `<file>#<case>` — the bench/eval/e2e/test case that produces the number. The files named here are created
  by WP-12 and the owning WPs; the lint only checks the shape.
- `minN` = smallest sample count for a probabilistic gate (Wilson lower bound ≥ threshold − 10 pp, SC-14).
- `provisional: true` = the spec marks the value `[仮]`; confirm by measurement before M1 exit.
- Ranges (`loop.bundle.tokens.*`, `idx.leaf.loc`) store the nominal value as `target` and the upper bound as `limit`; the
  lower bound lives in `metric`.
- Intentionally absent: `gen.std.100k` (100k-LOC standard generation in/out/$/time) — the spec fixes it only after the O2
  measurement (ARCHITECTURE §10.2).
- CORE-U-009 (`budgets.test.ts`): `BUNDLE_BUDGETS` and `UI_THRESHOLDS` must equal the budgets of the same name.

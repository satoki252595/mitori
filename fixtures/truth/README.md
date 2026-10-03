# fixtures/truth/

`<name>.json` = hand-written ground truth (`mitori.fixture-truth/1`, testkit `FixtureTruth`) for
`fixtures/repos/<name>/`: file classes, facts (+ `forbiddenFacts` traps), key symbols, every in-repo import edge,
cross-file calls (graded by `tolerances`) and module together/apart constraints. Scoring rules: testing spec §2.4.
Write it from the source, never from indexer output (golden files freeze output; truth decides correctness).

`ts-small.json` is the M0 template matching the 3-file skeleton. WP-00b adds a self-consistency test
(`bun test fixtures/truth`: every path exists, lines in range, keys unique).

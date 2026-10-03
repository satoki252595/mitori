# fixtures/repos/

One directory per fixture repo (`FixtureName` in `packages/testkit/src/contract.ts`). The directory is the
working tree of the first commit; `fixture.json` (`mitori.fixture/1`, testing spec §2.2) describes history
patches (`history/*.patch`), generated files, symlinks and the optional dirty state. `buildFixture(name)` copies
the tree **without** `fixture.json`, `history/` and `dirty/` into a temp dir, runs `git init -b main`, applies
history with fixed author/date (step k = `2026-01-01T00:00:00Z + k min`) and records the SHAs in
`fixtures/golden/<name>/commits.json`.

Planned (WP-00b): `ts-small`, `py-small`, `go-small` (demo Fix target: configurable retry count), `rust-small`,
`mixed`, `nongit`, `injection`, `secrets`, `edge-inventory`, `doc-roundtrip`. All implement the same toy domain
("tsundoku": books, tags, metadata fetch, CSV import/export) — testing spec §2.3.

`ts-small` is the M0 skeleton (3 files); WP-00b grows it to the §2.3.1 shape (~900 LOC) and updates the truth.

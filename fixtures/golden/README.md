# fixtures/golden/

Frozen outputs compared byte-for-byte by `expectGolden(rel, actual)` (`@mitori/testkit`); objects are written as
canonical JSON (`canonicalJson` from `@mitori/core`). Layout `golden/<fixture>/<artifact>` per testing spec §2.5
(`indexer/…`, `skeleton/…`, `repo-pack.txt`, `doc-static/**`, `prompts/…`, `bundles/…`, `review/…`), plus
fixture-independent `golden/mcp/` and `golden/integrations/`.

Update with `MITORI_UPDATE_GOLDEN=1` in a dedicated `golden: <reason>` commit; `scripts/golden-guard.ts` (WP-12)
requires the matching version bump (extractor / prompt / renderer / format) in the same PR (§2.6).

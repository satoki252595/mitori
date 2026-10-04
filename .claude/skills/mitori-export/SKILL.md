---
name: mitori-export
description: Build, test and photograph mitori's self-contained HTML export (`mitori export --html`, WP-13) — the viewer bundle, the @export Playwright suite on the dogfood docs and the secrets fixture, the 60 KB gz budget, and the screenshots/prototype comparisons in docs/progress/export/. Use after touching packages/doc/src/export, apps/web/src/viewer, the shared Reader parts the viewer reuses (BlockHost, CitePeek, TermCard, FloorPlan, palette/search, shell styles), or scripts/gen-assets.ts.
---

# mitori-export

Always `scripts/nd <cmd>`; no LLM spend anywhere in this skill.

1. **Build the viewer** — `scripts/nd bun scripts/gen-assets.ts` (builds `apps/web/vite.viewer.config.ts` into `dist/.build/web/assets/viewer-<hash>.js|css`
   + `viewer/viewer.json`; the daemon embeds them). Standalone: `scripts/nd bunx vite build -c apps/web/vite.viewer.config.ts [--mode report]` → `dist/viewer/`
   (`--mode report` lists the biggest modules). Budget: `viewer.js` ≤ 60 KB gzip (`asset.viewer.js` in `bun run size` / `scripts/nd bun bench/asset/size.ts --no-startup`).
2. **Unit + integration** — `scripts/nd bun test packages/doc/src/export apps/web/src/viewer e2e/export apps/cli/src/commands`.
   `e2e/export/export.int.test.ts` boots the real daemon composition in-process (secrets fixture + planted secrets) and runs the real `export` command.
3. **Acceptance (Chrome, network cut)** — `MITORI_E2E_CHANNEL=chrome scripts/nd bun run e2e --grep @export` (≈ 35 s). It rebuilds the viewer, writes `rich` through the
   real doc store (`e2e/export/support/build-rich.ts`) and `crit` / `m3e-canvas` / `secrets` through a real daemon + CLI (`build-exports.ts`) into `test-results/export-e2e/`.
   crit / m3e-canvas need the corpus: `scripts/nd bun run corpus:fetch --only crit,m3e-canvas` (tests skip with a note otherwise).
4. **Look at it** — `scripts/nd bun e2e/export/support/shoot.ts <file.html> <outDir> <prefix> [chapter] [peekChapter] [paletteQuery]` (`SHOT_DPR=1.5` for smaller files),
   then `scripts/nd bun e2e/export/support/compare.ts <shotsDir> <outDir>` for prototype-vs-export composites. Commit the ones worth keeping to `docs/progress/export/`.

Things that bite:
- A dogfood md read BEFORE the first scan makes every claim `unsupported`: prepare.ts puts only the manifest first and `bringDoc()` the prose after the index is ready.
- The exporter refuses a viewer script containing `</script` / `<!--` or whose sha256 differs from `viewer.json` (`E_INTERNAL`): rebuild with gen-assets, do not hand-edit.
- A new `t("…")` key in the viewer or in a Reader part it reuses must be in `src/viewer/catalog.ts` (`SHARED_KEYS` / `SHARED_PREFIXES`) or `export.{ja,en}.json` — `catalog.test.ts` checks.
- Any change to `ViewerPayload` (apps/web contract §16) must be mirrored in `packages/doc/src/export/payload.ts` `ExportPayload` — `e2e/export/payload-contract.test.ts` fails to compile otherwise.
- Golden: `fixtures/golden/cli/help.*.txt` change with the `export` help text (`MITORI_UPDATE_GOLDEN=1 scripts/nd bun test apps/cli/src/commands/cli.int.test.ts`, a `golden:` commit);
  `fixtures/golden/secrets/export.meta.json` with anything that changes the bytes of the secrets export (`… export-golden.test.ts`).
- Check the compiled binary too: `scripts/nd bun run build:bin` then `MITORI_E2E_BINARY=compiled MITORI_E2E_CHANNEL=chrome scripts/nd bun run e2e --grep @export`.
  The suite also opens crit in WebKit (Safari's engine) when Playwright's WebKit is installed, and at 1,200 / 1,280 / 700 / 390 px.
- Redactions are counted once, where their Markdown is (a glossary entry is also a row of the s12 table, a diagram label also its block's fence): use
  the counting redactor only for text that exists in no block (`R` vs `Q` in payload.ts).
- Look at more than one width: below 1,232 px the doc's rail is a drawer (the menu button must show), below 1,024 px the header loses the level /
  theme / language switches (the drawer carries them).

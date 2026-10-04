# ui (remaining-backlog pass) — change requests (2026-10-04)

Track ui of the remaining-backlog pass (`docs/progress/rem-ui.md`). Owned: `apps/web/**`, `packages/doc/src/render/`,
`packages/server/src/wiring/{settings,export}*.ts`. Every contract / core edit below is recorded in
`packages/core/CR-LEDGER.md` §8.

## #1 core: the thread transition index was built at module load (APPLIED, CR ui-1)
- where: `packages/core/src/transitions.ts`
- observed: `const THREAD_ROWS = new Map(THREAD_TRANSITIONS.map(…))` at module level is a side effect, so no bundler can
  drop it: the whole 200-row `THREAD_TRANSITIONS` table rode along into every web bundle importing `@mitori/core` — the
  export viewer (budget 60 KB gz, at 59.9 KB after the NC-09 full-text matcher joined it) and the app entry.
- change: the index is built on the first `threadTransition()` call (`threadRows ??= …`). Same public surface, same
  behaviour (CORE-U-003 tests unchanged and green).
- other module-level constructions in core (`errors.ts` `CODES = new Set(ERROR_CODES)`, `ids.ts` `ID_BODY_RE`) stay:
  every bundle that imports core uses them anyway.

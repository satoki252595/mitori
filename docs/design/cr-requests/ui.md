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
- other module-level constructions in core stay: `errors.ts` `CODES = new Set(ERROR_CODES)` is used by every bundle
  that handles an API error; `ids.ts` `ID_BODY_RE = new RegExp(…)` is left in the export viewer although it never
  calls `isId` — ≈ 40 B gz, not worth a core edit (a `/* @__PURE__ */` on it would drop it).

## #2 web contract: a code pin remembers the blob it was cited against (APPLIED, CR ui-2)
- where: `apps/web/src/contract.ts` `CodePin.blob?: string` (optional; absent = a static fact or a URL pin).
- observed (EX-08): after an accepted Fix or its Undo the context column kept showing the cited line numbers over a
  file that had changed — silently marking other lines.
- change: a pin / follow from a claim carries the claim's blob; `CodePane` says the lines are the current version's
  when the file's blob differs (and the column re-reads the file on `workspace.changed`). Optional field: every
  existing producer and consumer is unchanged.

## #3 api / server: deliver a big section in pieces (DEFERRED, CR ui-3 — F6)
- observed: `GET /ws/:ws/doc/sections/:section` answers the whole `SectionView` (every block's HTML) in one
  uncompressed JSON body — `packages/server/src/http/static.ts` precompresses static assets only. The Reader already
  renders big sections in virtual windows (a 10,000-block section: 1,389 DOM nodes at first paint, ≤ 2,440 while
  scrolling, e2e/web/big-section.pw.ts), so what is left is the transfer and the parse of the body.
- request (owner: server / api, not this track):
  1. `GET /ws/:ws/doc/sections/:section?from=<n>&limit=<n>` → the outline of the section's blocks + the HTML of the
     window asked for (`SectionView.blocks` with `html` only inside the window; `total`), so the Reader asks for the
     window around the anchor first and the rest in idle time;
  2. `content-encoding: br | gzip` on JSON bodies ≥ 8 KB when the request accepts it (HTML-in-JSON is repetitive
     markup; the web assets of the same build compress 3.5× with br).
- client side once it exists (this track's owner, apps/web): `stores/doc.svelte.ts` fetches the window around the
  anchor first, the blocks outside it render as the placeholder rows the Reader already has for ungenerated blocks,
  and the rest arrives in idle time; DocText (⌘K) keeps fetching whole sections.

## #4 server: the block revert / translate / simplify routes are not wired (DEFERRED, CR ui-4)
- `POST /ws/:ws/doc/blocks/:block/revert`, `POST /ws/:ws/doc/sections/:section/translate`,
  `POST /ws/:ws/doc/blocks/:block/translate`, `POST /ws/:ws/doc/blocks/:block/simplify` have no handler on the daemon
  (`http/app.ts`: a missing handler answers 501 `E_UNSUPPORTED`).
- the UI therefore offers none of them: the block history (EX-10) is read-only (no 「この版に戻す」), and the English UI
  over a Japanese doc (NC-14) offers 「AI に英語で説明させる」 (an Explain draft, nothing sent) instead of 「英語で表示」.
- request: wire them in the loop / doc routes (owner: loop + server); the web entry points are one button each
  (`reader/BlockHistory.svelte` per revision, `reader/ReaderPage.svelte` the original-language note).


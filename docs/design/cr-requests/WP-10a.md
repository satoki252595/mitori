# WP-10a — change requests (web A: shell, S1, S2, ⌘K, i18n; 2026-10-03)

Each request below has a `// CR-PENDING(WP-10a)` workaround in the code (or says why none is needed).

## `@mitori/client`: real `createApiClient` / `createSseClient`
- contract: `packages/client/src/contract.ts` — `createApiClient`, `createSseClient` (both still throw `E_UNSUPPORTED`)
- change: none to the shapes; the implementations are needed. One behaviour to keep in mind for the SSE client: the
  "gap" check on `hello` (`resumedFrom === null` after events were seen) must compare against the seq seen BEFORE
  the hello frame — counting the hello's own `id:` makes every first connection look like a gap and triggers a
  spurious `resync` (found and fixed in the web fallback, covered by `apps/web/src/shell/net/sse.test.ts`).
- why: the SPA must talk to the daemon (ux.md §12.3–12.4).
- workaround in place: `apps/web/src/shell/net/{api,sse}.ts` (local `ApiClient` / `SseClient` following the contract),
  selected by `apps/web/src/shell/net/clients.ts` only while the client package throws `E_UNSUPPORTED`.
- urgency: blocks running the SPA against the real daemon (INT).

## Shell ⇄ loop-UI extension contract (WP-10a ⇄ WP-10b)
- contract: `apps/web/src/contract.ts` — new `UiExtension`
- change:
  ```ts
  export interface UiExtension {
    views?: { inbox?: Component<Record<string, never>>; decisions?: Component<Record<string, never>> };
    reviewPanel?: Component<{ job: JobId }>;     // context column, review mode (S5)
    margin?: Component<{ page: string }>;        // context column, margin mode (thread cards, Composer, job cards)
    install?: (s: Stores) => void;               // key handlers, SSE hooks
  }
  // each of composer/ threads/ jobs/ review/ inbox/ proposals/ trust/ MAY export `default: UiExtension` from `ui.ts`
  ```
- why: WP-10b owns those directories but the Shell (WP-10a) mounts S4/S5 and the margin; without a contract either
  side has to edit the other's files. The shell discovers `*/ui.ts` with a lazy glob, so both build independently.
- workaround in place: `apps/web/src/shell/ext.ts` (the interface + glob loader).
- urgency: before WP-10b wires the margin / review panel.

## `NUMBER_FORMAT.tokens.mThreshold` contradicts every spec example
- contract: `apps/web/src/contract.ts` — `NUMBER_FORMAT.tokens`
- change: `mThreshold: 100_000` (or state "≥ 0.1M ⇒ M with 2 decimals").
- why: ux.md / JUDGEMENT show `≈0.12M`, `0.38M`, `0.4M`; with `mThreshold: 1_000_000` those would be `120k`, `380k`.
- workaround in place: `apps/web/src/shell/fmt.ts` applies M notation from `mThreshold / 10`.
- urgency: nice to have (cosmetic, but the formatter's table test encodes the workaround).

## i18n key grammar vs data-valued keys
- contract: `apps/web/src/contract.ts` — `I18N_RULES.keyPattern`, `I18N_RULES.required` (`verdict.<Verdict>`)
- change: allow `-` in the last segment (`/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){0,3}\.[a-zA-Z0-9_-]+$/u`), or rename the
  data values used as key segments (`Verdict "human-verified"`, `EngineStatus.auth "api-key"`).
- why: `verdict.human-verified` is REQUIRED by `I18N_RULES.required` but rejected by `keyPattern`.
- workaround in place: `apps/web/src/shell/lint/catalog.test.ts` accepts hyphenated last segments for `verdict.*` and
  `*.auth.*` only.
- urgency: nice to have.

## ⌘K top-hit row vs AC-J46 (`carry` ⇒ 「持ち越し」 first)
- contract: `apps/web/src/contract.ts` — `PALETTE_SCORING`; ux.md §4.10 (UXP-29 top hit ≥ 120)
- change: add the rule "a symbol whose `via` term also matched yields the top-hit row to that term" to §4.10 and to the
  `PALETTE_SCORING` doc comment.
- why: with the contract scores `carryForwardComments` (label prefix, 139) is the top hit for `carry`, while the
  term matches only through its alias (62); AC-J46 requires 「持ち越し」 first for `carry`.
- workaround in place: `apps/web/src/palette/search.ts` `topHit()` (unit-tested in `search.test.ts`, e2e
  `e2e/web/palette.pw.ts`).
- urgency: nice to have (behaviour already matches the AC).

## `PaletteWorkerReply` results carry `counts` and `top`
- contract: `apps/web/src/contract.ts` — `PaletteWorkerReply`
- change: `{ t: "results"; id; ms; total; groups; counts: Partial<Record<Group, number>>; top: { group: Group; id: string } | null }`
- why: 「さらに {n} 件」 needs per-group counts; the top-hit choice needs `via` data that never leaves the worker.
- workaround in place: sent as extra fields (`apps/web/src/palette/worker.ts`, read in `stores/palette.svelte.ts`).
- urgency: nice to have.

## Translation note placement (UI language ≠ doc language)
- contract: ux.md §4.3 (「章の頭に 1 行」), AC-U81 (ja → en at runtime, CLS ≤ 0.01)
- change: state that the note shares the `§n` row of the chapter head (fixed height) instead of being its own band.
- why: a band inserted above the first block on a runtime language switch moves the whole page (measured 0.011 on
  its own); in the `§` row the switch measures 0.004 (header tab widths only).
- workaround in place: `apps/web/src/reader/ReaderPage.svelte` (`.sec-num .lang-note`).
- urgency: nice to have.

## ux.md §3.5 toast table: `gen.firstBlock` shows an example, not placeholders
- contract: ux.md §3.5 table (「値は ja」)
- change: `§{id} {title} が届きました · 最初の文まで {s} 秒`.
- why: the table is linted against the catalogs (`apps/web/src/shell/lint/catalog.test.ts`); the example text
  「§0 ひとことで」 only matches because the lint treats unspelled placeholders as wildcards.
- workaround in place: the wildcard rule in the lint.
- urgency: nice to have.

## First-visit language without a cookie
- contract: ux.md §3.2 (boot sequence), `UI_COOKIE`
- change: let the daemon set `mitori_ui` (`lg` from `GlobalSettings.ui.lang`) on the first `GET /` (or inline
  `settings.ui.lang` into `index.html`), so a first visit never waits for `GET /settings`.
- why: without a cookie the server setting decides the language; rendering in the navigator language first and
  switching on `/settings` re-lays out the chrome (measured CLS 0.0036 at 1440 × 900).
- workaround in place: `apps/web/src/shell/main.ts` waits ≤ 400 ms for `GET /settings` before mounting when the cookie
  has no `lg` (local daemon: a few ms); the Shell reuses that request.
- urgency: nice to have.

## Chunk names for the launcher and the help overlay
- contract: `apps/web/src/contract.ts` — `CHUNK_NAMES`, `BUNDLE_BUDGETS`
- change: add `"launcher"` and `"help"` (or confirm both belong to `entry`).
- why: initial JS is 80–81 KB gz (hard cap 150 KB met; the 60 KB target is a warning until M3). S0 (≈ 3.4 KB min)
  and the help overlay (≈ 2.7 KB min) are the cheapest pieces to move out of `entry`, but no chunk name exists.
- workaround in place: none (both stay in `entry`).
- urgency: before the M3 size gate.

## i18n ownership of `status.*` / `stage.*`
- contract: `I18N_RULES.required` (`status.<UiStatus>`, `stage.<StageKey>`)
- change: state that each WP owns `apps/web/i18n/<namespace>.{ja,en}.json` for its directories and that `status.*` /
  `stage.*` (job and thread vocabulary) live in WP-10b's namespaces.
- why: WP-10a's catalogs (shell, map, reader, palette, settings, gen) carry `error.*`, `shortcut.*`, `verdict.*`,
  `notice.*`; the job / thread families have no screen in WP-10a.
- workaround in place: the WP-10a parity test checks the four families it owns.
- urgency: nice to have.

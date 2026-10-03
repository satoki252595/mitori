---
read:
  - docs/design/specs/ux.md | 改訂 R1
  - docs/design/specs/ux.md | 1.
  - docs/design/specs/ux.md | 2.
  - docs/design/specs/ux.md | 3.
  - docs/design/specs/ux.md | 4.0
  - docs/design/specs/ux.md | 4.1
  - docs/design/specs/ux.md | 4.2
  - docs/design/specs/ux.md | 4.3
  - docs/design/specs/ux.md | 4.4
  - docs/design/specs/ux.md | 4.5
  - docs/design/specs/ux.md | 7.
  - docs/design/specs/ux.md | 8.
  - docs/design/specs/ux.md | 9.
  - docs/design/specs/ux.md | 10.
  - docs/design/specs/ux.md | 11.
  - docs/design/specs/ux.md | 12.
  - docs/design/specs/ux.md | 13.
  - docs/design/prototypes/JUDGEMENT.md | 6.1
  - docs/design/prototypes/JUDGEMENT.md | 6.2
  - docs/design/prototypes/JUDGEMENT.md | 6.3.1
  - docs/design/prototypes/JUDGEMENT.md | 6.3.2
  - docs/design/prototypes/JUDGEMENT.md | 6.4
  - docs/design/prototypes/JUDGEMENT.md | 6.10
  - docs/design/prototypes/JUDGEMENT.md | 6.11
  - docs/design/prototypes/JUDGEMENT.md | 6.12
  - docs/design/prototypes/JUDGEMENT.md | 6.13
  - docs/design/prototypes/JUDGEMENT.md | 6.14
  - docs/design/prototypes/JUDGEMENT.md | 6.15
  - docs/design/prototypes/JUDGEMENT.md | 6.16
  - docs/design/prototypes/JUDGEMENT.md | 6.17
  - docs/design/prototypes/JUDGEMENT.md | 6.18
  - apps/web/src/contract.ts | *
  - docs/design/design-tokens.css | *
crs: ux-R1, ux-R2, ux-R3, ux-R4, ux-R13, ux-R14, ux-R15, ux-R16, ux-R21, jdg-*, m0-3, m0-10, m1-26, m1-65, m1-94, m1-95, m1-96, m1-97, m1-98, m1-99, m1-100, m1-101, m1-102, m1-103, m1-121
owns:
  - apps/web/src/shell
  - apps/web/src/map
  - apps/web/src/reader
  - apps/web/src/palette
  - apps/web/src/settings
  - apps/web/src/gen
  - apps/web/src/stores
---
## Golden / truth / fixtures

- e2e lives in `e2e/<area>/` tagged `@wp10a` (harness = WP-12; `bun run e2e` dispatches to `e2e/harness/run.ts`
  once it exists). Component behaviour is tested with Playwright (`e2e/component/`), pure TS logic with `bun test`
  (no happy-dom, SC-18). Mock server: type it with `@mitori/client` / core `ApiRoutes`.

## Notes (M0 layout)

- You also own `apps/web/{index.html,vite.config.ts}` (CR m0-7); WP-13 owns only `apps/web/vite.viewer.config.ts`.
  `apps/web/src/__probe.svelte` exists only for the svelte-check probe — delete it once real components exist.
- Toolchain (pinned): svelte 5.57.1 (runes; stores are classes in `*.svelte.ts`), vite 8.3.2,
  @sveltejs/vite-plugin-svelte 7.3.1, svelte-check 4.7.6 (in `check`), codemirror 6 + @codemirror/merge (lazy chunk
  `cm6`/`merge`, WP-10b). TypeScript is 6.0.3 (TS 7 cannot host svelte-check, SC-08).
- Stubs in `shell/`: `isComposing`, `parseUiCookie`, `fmtTokens`, `fmtUsd`, `fmtDuration`, `fmtDelta`, `t`,
  `detectUiLang`, `errorKey`, `errorText`; `bandOf` is already real (= core `tokenBand`). In `reader/`:
  `layoutMarginCards`, `permalinkText`, `blockVisible`. `threadStatus`, `jobStatus`, `planStages` are WP-10b's.
- web may import only `@mitori/core` (pure data, tree-shakeable) and `@mitori/client`; hrefs come from core
  `HREFS`. Budget: initial JS ≤ 150 KB hard / 60 KB warn, CSS ≤ 25 KB, zero web fonts (`bun run size --filter web`,
  runner by WP-12). Chunk names fixed: `cm6`, `merge`, `diagram`, `shiki`, `mermaid`, `viewer`.
- i18n catalogs per namespace: `apps/web/i18n/<ns>.{ja,en}.json` (yours: shell, map, reader, palette, settings, gen).

## CR batch 1 (2026-10-03)

- **CR m0-10**: `ApiClient`/`SseClient` live in `@mitori/client` (the web contract re-exports them). Build them with
  `createApiClient({ base: "/api/v1", auth: { scheme: "session", token }, client: { kind: "web", version } })` and
  `createSseClient({ …, random, clock, onState })` (web may use `crypto.getRandomValues` / `Date.now` for the ports).
  Until WP-09 lands they throw `E_UNSUPPORTED`: use a structural fake in tests.

## CR batch 2 (2026-10-03, ledger §5) — follow-ups owned here

- **Hero / header from `WorkspaceStatus.profile`** (CR m1-26): remote `host/path`, toolchain `Go 1.26`, license SPDX,
  `head.commit` 7 + `(date)`, `head.tag` next to the commit in the header, README excerpt (「原文のまま」) and ≤ 4 LOC
  tiles (`AreaStat` kind → 「{Lang} 本体」 / `{dir}` / 「{Lang} テスト」). Absent ⇒ today's strip.
- Engine card: first-run pin (`pin.by === "first-run"`) shows 「初回に固定 · v… ［変更］」 instead of 「見つかりません」
  (CR m1-65). Adopt `@mitori/client` and delete `shell/net/` fallbacks (CR m1-94). Emit `mitori:facts:painted`
  (CR m1-102).
- Contract applied: `UiExtension` (CR m1-95; `shell/ext.ts` may import it from the contract), `mThreshold = 100_000`
  (`fmt.ts` fixed, CR m1-96), `keyPattern` with `-` (CR m1-97; drop the lint workaround), worker `counts` / `top`
  (CR m1-98), chunks `launcher` / `help` (CR m1-100).
- Visual decisions (CR m1-103): fallback banner only when the floor plan is on and failed; one section title in the
  Reader; 30分コース 「0 / 7 · 残り約30分」 before generation; TOC ≈k per section when an estimate exists.
- Settings page: show `SettingsView.lastError` (CR m1-121) when `config.json` was not applied.

## Out of scope

Review loop UI (WP-10b), floor-plan mode (WP-18, JUDGEMENT §6.3.3–6.3.4), the key-remap editor (☆), export
viewer build (WP-13).

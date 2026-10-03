---
read:
  - docs/design/specs/ux.md | 改訂 R1
  - docs/design/specs/ux.md | 4.6
  - docs/design/specs/ux.md | 4.7
  - docs/design/specs/ux.md | 4.8
  - docs/design/specs/ux.md | 4.9
  - docs/design/specs/ux.md | 4.10
  - docs/design/specs/ux.md | 4.11
  - docs/design/specs/ux.md | 4.12
  - docs/design/specs/ux.md | 4.13
  - docs/design/specs/ux.md | 5.
  - docs/design/specs/ux.md | 6.
  - apps/web/src/contract.ts | 6
  - apps/web/src/contract.ts | 7
  - apps/web/src/contract.ts | 8
  - docs/design/prototypes/JUDGEMENT.md | 6.5
  - docs/design/prototypes/JUDGEMENT.md | 6.6
  - docs/design/prototypes/JUDGEMENT.md | 6.7
  - docs/design/prototypes/JUDGEMENT.md | 6.8
  - docs/design/prototypes/JUDGEMENT.md | 6.9
crs: ux-R5, ux-R6, ux-R7, ux-R8, ux-R9, ux-R10, ux-R11, ux-R12, ux-R17, ux-R18, ux-R19, ux-R20, ux-R22, ux-R23, ux-R24, ux-R25, jdg-7, jdg-8, m0-10
owns:
  - apps/web/src/composer
  - apps/web/src/threads
  - apps/web/src/jobs
  - apps/web/src/review
  - apps/web/src/inbox
  - apps/web/src/proposals
  - apps/web/src/trust
---
## Golden / truth / fixtures

- e2e `@wp10b` in `e2e/<area>/` (demo-script steps 3–4 with replayed engines). CM6 + merge are lazy chunks
  (`cm6`, `merge`; ≤ 135 KB gz, not requested until Review opens).

## Notes (M0 layout)

- Stubs: `threadStatus` (threads/), `jobStatus`, `planStages` (jobs/). Shell, stores, routing and SSE come from
  WP-10a (`shell/`, `stores/`) — build on their public modules, do not fork them.
- Status vocabulary (shape + colour + label, WCAG 1.4.1) is contract data (web contract §7); thread display
  state comes from the API (`displayState`), not recomputed in the client.
- web imports only `@mitori/core` and `@mitori/client`; Markdown is never parsed client-side (server HTML,
  `MessageView.html`, CR ux-R23).
- i18n namespaces you own: composer, threads, jobs, review, inbox, proposals, trust (`apps/web/i18n/<ns>.{ja,en}.json`).

## CR batch 1 (2026-10-03)

- **CR m0-10**: `ApiClient`/`SseClient` come from `@mitori/client` (re-exported by the web contract);
  `ApiClient.call(..., { onRev })` gives the mutation's `x-mitori-rev` for `SseClient.noteRev`.

## Out of scope

Shell/map/reader/palette (WP-10a), export viewer (WP-13), key-remap editor (☆).

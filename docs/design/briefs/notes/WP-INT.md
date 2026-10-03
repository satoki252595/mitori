---
read:
  - packages/server/src/contract.ts | 4
  - packages/server/src/contract.ts | 10
  - docs/design/specs/server.md | 4.
  - docs/design/specs/server.md | 10.
  - docs/design/specs/testing.md | 4.8
  - docs/design/ARCHITECTURE.md | 3.4
crs: loop→server, gL-10, m0-1, m0-2, m0-3, m0-6
owns:
  - packages/server/src/compose.ts
  - packages/server/src/wiring
---
## Notes (M0 layout)

- Stubs: `createServer` (compose.ts), `assembleAnchoredItems`, `distributeReanchor` (wiring/). `DOMAIN_WIRING`
  (server contract §4) is data — implement the handlers, including `publishSuggestions`.
- You are the only editor of every `packages/*/src/index.ts` (re-export additions only). The M0 skeleton already
  re-exports every planned sub-directory, so most WPs never need you for that; new public names are contract
  changes (CR) and show up in `docs/design/briefs/INDEX.md`.
- compose.ts is where structural port implementations meet their contract types: platform (WP-01) implements
  `Spawner` (agent contract), `FsWatcher` (server contract) and the core §18 ports with local types — assigning
  them to the contract types here is the type check.
- Integration tests: `test/int/` (`nd bun test test/int --test-name-pattern INT-xx`); INT-00 at M0.5 with WP-11a's
  skeleton binary.
- gen ⟂ loop: their interactions (accept → S9 suggestions, Ask answer → doc, doc_edit "fix the code") exist only in
  `wiring/`.

## Out of scope

Changing contracts yourself (send CRs to the architect); domain logic.

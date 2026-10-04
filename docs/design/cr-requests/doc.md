# doc track — change requests (remaining backlog pass, 2026-10-04)

Contract changes this track made (all additive and small, recorded in `packages/core/CR-LEDGER.md` §8), and what it
asks of the other tracks. Details and measurements: `docs/progress/rem-doc.md`.

## Applied (this track)

### rdoc-1 — `outbound` facts (NC-10 §8)
- core `FactKind` + `"outbound"`, `OutboundFact { channel: "http" | "rpc" | "sdk" | "db" | "subprocess"; via; target? }`.
- testkit `factKey` has a case for it (not graded: no truth rows yet; `GATED_KINDS` unchanged).
- indexer `outbound.calls@1` (`packages/indexer/src/facts/outbound.ts`): TS / JS, Go, Python, Rust; every rule is gated
  by an import of the library, the tree confirms the name is code, the target is a literal only (http(s) origin, a
  relative API path, a command name) and secret-scanned at link time; tooling files' calls are `scope: "example"`.

### rdoc-2 — static doc §7 key types, 「変更の手引き」, large-file regions
- doc `StaticGuide.types` / `change` / `regions` (+ `StaticKeyType`, `ModuleChangeGuide`, `FileRegion`), new slots
  `s7:types`, `s7:types-map`, `s8:outbound`, `s8:secrets`, `m:<id>:change`, `m:<id>:regions` (ranks in `store/core.ts`),
  public `regionLabel(region, lang)`.
- api `FileContent.regions?` (files over 1,500 lines), `MapView.modules[].change?: BlockId`.
- web (additive): `CodeView.svelte` lists the regions above the symbol outline; `RoomCard.svelte` gets a
  「変更の手引き」 link (`changeHref`), `render.ts` carries `RoomModel.change?`. i18n keys `code.regions`,
  `map.room.change`.

### rdoc-3 — handler stamping
- indexer `FactLinkContext.symbolAt(path, name, opts?: { callable?: boolean })`; route candidates carry an ordered
  `handlers` list; `INDEXER_FORMAT.detectors` 1 → 2 (cached fact candidates are re-extracted once).

### rdoc-4 — a loaded machine must not change the index (CR gen #8, the rest)
- indexer `PARSE_POOL.parseRetryMs` (8 s): a parse over the 250 ms wall-clock budget is retried once from scratch with
  the patient budget (`parse/worker.ts` — WP-02's file, a 10-line change). Before, under load crit's `session.go`,
  `server.go`, `web/app.js` and test files were indexed without symbols, and the same commit gave a different S5 input
  and 42 / 43 / 44 file-note tasks from one open to the next (reproduced with 4 concurrent opens).
- `update/later.ts`: the synchronous text cache is rebuilt aside and swapped in whole (unchanged blobs reused), never
  cleared first.
- `update/persist.ts` (no contract change): the persist bookkeeping (dropping the in-memory skeleton bodies once
  written) runs after the write slot resolves, not inside it — the workspace writer's outer transaction could roll the
  rows back after the indexer's savepoint had released, and the skeletons were then gone from both places.

## Requests to other tracks

1. **gen** (nice to have): `moduleContext().facts` and the repo pack do not list `outbound` facts yet (the pack format
   and the prompt goldens would change). A module's outbound calls are exactly what its `dependencies` / `config`
   aspects need ("talks to GitHub through `gh`"). Proposed: an `O <channel> <via> <target> <path>:<line>` line per
   distinct call in `moduleFactLines` (pack/repo-pack.ts), behind a pack format bump.
2. **gen**: §3 flows now start from handler-specific first hops (crit: `/api/comment/`, `/api/review-comment/`,
   `/api/events` → `internal/session/session.go`). `genFlowSeeds` needs no change; re-measure the §3 quality with the
   real engine once `claude /login` is back (the seeds changed).
3. **ux**: the code view's region list and the room card's 「変更の手引き」 link use the existing styles (`.outline`,
   `.btn-sec`); restyle freely. The Reader now routes doc-internal `.md` links (§6 index, module pages) to sections
   (`views.ts docLinks`) — they used to 404 against the daemon.
4. **platform** (open question): `GitReader.log` returns nothing on a shallow clone, so the corpus clones (and any
   `--depth` clone with real history, like `refs/crit` with 41 commits) show 「履歴を読めません」 in the change guide.
   Reading the available commits of a shallow clone (the boundary commit's diff is the only wrong one) would make
   co-change work there; it would also make the map's churn overlay work.
5. **indexer (pin store owner)**: `packages/indexer/src/pin/store.ts` `saveRows` applies `pending.delete` inside the
   write slot. The server's workspace writer wraps every slot in its own transaction, which can still roll back after
   `fn` returned (a dev / test build's 50 ms slow-slot guard on a loaded machine, a failing post-`fn` hook): the pinned
   text of a dirty file is then neither in the DB nor in `pending`. `update/persist.ts` had the same shape and lost
   skeletons that way (fixed in this track, `robustness.int.test.ts` "CR gen #8: a write slot whose outer transaction
   rolls back…"); the same fix (delete from `pending` after `await write(...)` resolves) applies here.

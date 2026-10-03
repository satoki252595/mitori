---
read:
  - docs/design/ARCHITECTURE.md | 2.1
  - docs/design/ARCHITECTURE.md | 2.2
  - docs/design/ARCHITECTURE.md | 2.3
  - docs/design/ARCHITECTURE.md | 2.4
  - docs/design/ARCHITECTURE.md | 3.5
  - docs/design/adr/0001-runtime-single-binary.md | *
  - docs/design/specs/server.md | 1.
  - docs/design/specs/server.md | 2.
  - docs/design/specs/indexer.md | 3.2
crs: m0-3, m0-7, m0-9, test-6
owns:
  - apps/cli/src/main.ts
  - apps/cli/src/daemon
  - apps/cli/src/build
---
## Review decisions you implement (REVIEW-LOG, verbatim intent)

- **SC-04**: darwin-arm64 + linux-x64 binaries embedding the br/gz-precompressed Svelte dist, the 6 grammar wasm,
  the parse Worker, a **dedicated ELK Worker** (`elk-api.js` + embedded `elk-worker.min.js`, measured 95 ms),
  fine-grained Shiki and the migration runner; `mitori <path> --no-open` → daemon → S0 → `GET /doc` → shell.
  Started from a dir without node_modules in CI, with size and start-up gates. Every WP integrates daily.
- **SC-25**: Shiki fine-grained imports only; languages = MVP languages + json, yaml, toml, md, sh, sql. Binary size
  gate from day one (≤ 85 MB target / 95 MB limit).
- **SEC-16**: wasm/grammar sha256 in `assets.lock.json`, verified at build time (mismatch fails the build).

## M0 state

- `apps/cli/src/main.ts` prints `mitori <version> (api 1)` for `--version`; keep its top level import-free and
  load commands lazily (start-up budget `bin.startup` 20 / 50 ms; M0 measured 10.5 ms median, 62 MB binary).
- `scripts/build-bin.ts` (now yours, CR m0-7) runs `bun build --compile --minify --target=bun-<t>` with
  `--define globalThis.__MITORI_TEST__=false`; host target by default, `--target all` cross-builds (downloads the
  other bun runtime — CI builds linux-x64 natively). Extend it with gen-assets (`import … with { type: "file" }`
  table), precompression and the asset lock.
- `bun run size` runs `apps/cli/src/build/size.ts` (yours: the binary gate, ≤ 85 MB target / 95 MB limit) and
  then `bench/asset/size.ts` (WP-12: served web bytes) through `scripts/run-owned.ts` — just create your file.
- Grammar wasm come from the pinned npm packages (`node_modules/tree-sitter-{typescript,javascript,python,go,rust}/*.wasm`,
  `web-tree-sitter/web-tree-sitter.wasm`); elkjs 0.12.0; shiki 4.5.0 (`@shikijs/{core,engine-oniguruma,langs,themes}`).
- The web shell does not exist yet (WP-10a): embed a minimal static `index.html` placeholder until it lands.
- The parse Worker entry belongs in `packages/server/src/workers/parse.ts` per indexer spec §3.3 — that is
  server territory (WP-INT); coordinate through WP-INT, or keep the worker entry under `apps/cli/src/build/` for M0.5.
- `test/skeleton` (acceptance) is a root `test/` zone: allowed to import anything; spawn the compiled binary there.

## Out of scope

Real commands (WP-11), server routes (WP-09), web UI (WP-10a), signing/Homebrew/npm, other targets (MILESTONES §11).

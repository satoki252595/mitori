# mitori single binary — build notes (WP-11a walking skeleton)

Findings from retiring the three build risks of SC-04 / SC-25 / SEC-16 (2026-10-03, Bun 1.4.2, M-series Mac,
darwin-arm64; linux-x64 cross-compiled). Numbers are from `mitori _selftest --json` and hyperfine on the compiled
binary copied into a directory without `node_modules`.

## 1. Pipeline

```
bun run build:bin [--target darwin-arm64|linux-x64|all] [--lock <file>]
  └ scripts/gen-assets.ts
      1. verify apps/cli/src/build/assets.lock.json (sha256 + size + installed package version; mismatch ⇒ exit 1)
      2. brotli-pack the 9 pinned files → dist/.build/pinned/*.br   (cached by sha256 in node_modules/.cache/mitori-assets)
      3. vite build → dist/.build/web (WP-10a's apps/web when index.html + vite.config.ts exist, else apps/web/src/__stub)
      4. precompress the web dist (brotli q11 + gzip 9, kept only when ≥ 5 % smaller)
      5. write dist/.build/{assets.gen.ts, entry.ts, web.json, manifest.json}
  └ bun build dist/.build/entry.ts apps/cli/src/build/workers/{parse,compute}.ts --compile --minify --root=<repo>
        --define globalThis.__MITORI_TEST__=false --no-compile-autoload-dotenv --no-compile-autoload-bunfig
bun run size                    apps/cli/src/build/size.ts: bin.size gate per dist/mitori-<target>
bun scripts/release.ts          --target all + size gate + mitori-<ver>-<target>.tar.gz + SHA256SUMS + release.json
```

- **Entry**: the compile entry is the generated `dist/.build/entry.ts`: it imports `assets.gen.ts` (which calls
  `registerAssets` with the `import … with { type: "file" }` table) and then calls `main()` of `apps/cli/src/main.ts`.
  `import.meta.main` is false for bundled non-entry modules, so `main.ts` keeps its own `if (import.meta.main)` for
  `bun apps/cli/src/main.ts …` without running twice. Nothing generated lives under `src/` (tsc/biome stay clean).
- **Source checkout**: without the generated entry, `assetTable()` falls back to the files on disk (node_modules
  paths from the lock, `dist/.build/web.json` if a web build exists, Worker `.ts` URLs). Unit tests use this.
- **Workers**: extra entrypoints are embedded at `/$bunfs/root/<repo path>.js` when compiled with `--root=<repo>`.
  `new Worker(new URL("./w.ts", import.meta.url))` does NOT work from bundled code (every module's `import.meta.url`
  is the entry, `file:///$bunfs/root/<outfile>`); the generated table therefore hands out the absolute bunfs path
  (and the source-checkout URL when not standalone). Works from any cwd (verified after `chdir("/")`).
- **CR m0-7 / brief**: the Worker entries live in `apps/cli/src/build/workers/` for M0.5. WP-INT moves the parse
  entry to `packages/server/src/workers/parse.ts` (indexer spec §3.3) by editing `WORKERS` in `scripts/gen-assets.ts`.

## 2. wasm + Workers inside `bun build --compile` — works

| piece | how | compiled-binary result |
|---|---|---|
| web-tree-sitter 0.27 + 6 grammars | main thread reads the embedded bytes, Worker gets them in `init`: `Parser.init({ wasmBinary })`, `Language.load(bytes)` | init with all 6 grammars 8–11 ms; TS/TSX/JS/Python/Go/Rust snippets parse, `tree.delete()` |
| ELK (dedicated Worker) | `elk-api.js` in the daemon thread, `workerFactory: (u) => new Worker(u)`; the worker script is the embedded `elk-worker.min.js` | boot (spawn + GWT init) 58–71 ms, first 300-node layout 142–148 ms, **warm median 79–85 ms** |
| Shiki 4.5, fine-grained | `@shikijs/core` + `engine-oniguruma` fed with the embedded `shiki/dist/onig.wasm` bytes, 13 `@shikijs/langs/*` modules, `createCssVariablesTheme` | init 11–12 ms; 100 TS lines: first 44–47 ms (grammar compile), warm 8.1–8.4 ms |
| bun:sqlite + migration runner | `apps/cli/src/daemon/{sqlite,migrate}.ts` | `srv_migrations` created in `$MITORI_HOME/state.sqlite`; 2 sample migrations apply once, then 0 |

- elkjs' default entry and `elk.bundled.js` must not be used (they fail after compile with `new _Worker(url)`, as SC-04
  found); `elk-api.js` + a worker URL works, including a **Blob URL** (`URL.createObjectURL`) — which is what lets the
  binary embed the worker brotli-packed (§3).
- The ELK budget (`doc.elk.300`, ≤ 120 ms in the WP acceptance, research 88 / 95 ms) is met by the warm layout of the
  research graph (seeded tree + 50 % extra edges, 300 nodes / 459 edges, `layered`, `RIGHT`). The first layout after
  boot is ~145 ms (JIT) and the worker boot ~60 ms: the doc layouter should start the ELK Worker when a map view
  opens, not on the first layout request.
- Shiki's server budget `doc.shiki.100` (5 / 10 ms) is met only warm (8 ms, over target): keep the compute Worker warm
  while a UI is connected (PT-16) and tokenize per blob.

## 3. Binary size — darwin-arm64 64.4 MB, linux-x64 83.5 MB (target 85 / limit 95)

| | darwin-arm64 | linux-x64 |
|---|---:|---:|
| Bun runtime floor (`console.log` hello, `--minify`) | 62.2 MB | **81.3 MB** |
| mitori skeleton, pinned files embedded raw (first build) | 70.9 MB | 89.9 MB (over target) |
| mitori skeleton, pinned files brotli-packed (current) | **64.4 MB** | **83.5 MB** |

- The pinned files (6 grammars + tree-sitter runtime + ELK worker + onig.wasm) are 7.3 MB raw and **0.91 MB** as
  brotli q11/lgwin 24 (grammars compress 9–14×). They are embedded as `*.br` and unpacked on read (`readPinned`,
  0.3–2.7 ms each; the ELK worker becomes a Blob URL). First build packs in ~1.5 s (4 threads), later builds hit the
  cache. The web dist is ~0.1 MB with its .br/.gz variants (stub shell: 29.9 KiB raw / 10.7 KiB br).
- **linux-x64 has only 1.5 MB of headroom under the 85 MB target** because Bun's linux runtime is 19 MB bigger than the
  darwin one (the runtime ELF ships unstripped; stripping a compiled binary was not attempted — the embedded module
  graph lives inside the executable). Everything later WPs add to the
  binary (markdown-it, MCP SDK, CodeMirror in the web dist, the real shell) lands on Linux over target; the 95 MB limit
  leaves 11.5 MB. Proposed: a per-target `bin.size` target (CR request in `docs/design/cr-requests/WP-11a.md`).
- Not used yet, measured options: `--bytecode` (+2–3 MB, −16 % start-up in the research), `--sourcemap` (zstd map,
  size cost). Start-up does not need them today.

## 4. Security findings

- **A compiled Bun binary autoloads `.env` and `bunfig.toml` from its working directory by default** — including
  `preload = [...]` scripts, i.e. running the M0 binary inside an untrusted repository executed that repository's code
  (reproduced: a `bunfig.toml` with `preload = ["./evil.ts"]` ran before `main`). `build:bin` now passes
  `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`; `test/skeleton` (SKEL-AT-03) and
  `scripts/gen-assets.test.ts` guard it. tsconfig/package.json autoload is off by default. `BUN_OPTIONS` and
  `BUN_BE_BUN=1` in the *user's* environment still apply (WP-11: scrub them from the env of every spawned
  `mitori _serve` / child).
- SEC-16: the lock pins sha256 + byte size + package version of every verbatim file; `bun run build:bin` fails before
  compiling on any mismatch (SKEL-AT-05), `bun scripts/gen-assets.ts --verify-only` checks without building,
  `--update-lock` re-pins after a deliberate bump. `mitori _selftest` re-hashes the unpacked embedded bytes against the
  lock baked into the binary.
- CLI-I-010: the release binary contains none of `/__test/`, `ReplaySpawner`, `__MITORI_TEST__` (SKEL-AT-04).
- The skeleton daemon already applies the Host gate (421 `E_BAD_HOST`) and api `SECURITY_HEADERS` on every response;
  the CSP `'sha256-{headInline}'` placeholder is filled with the hashes of the shell's inline scripts (none in the
  stub), so WP-10a's zero-CLS head script works under the real CSP from day one.

## 5. Start-up and daemon

- `mitori --version`: **11.0 ms** mean (hyperfine 20 runs, `bin.startup` 20 / 50 ms). The entry stays import-free;
  every command is a lazy `import()` (bundled, evaluated on demand).
- `mitori <repo> --no-open` → `GET /api/v1/health` 200: **~16 ms** (5 runs; the very first launch of a freshly copied
  binary took 0.39 s on macOS — the OS scans a new executable once). Idle RSS after serving `/`: **24 MB**
  (`srv.rss.idleEmpty` ≤ 30 MB).
- stdout carries only the URL (testing spec RQ-CLI-1); the S0 stub line goes to stderr.

## 6. Skeleton limits (owners)

- The daemon runs in the foreground of `mitori <path>` / `mitori _serve`. Detaching, `~/.mitori/daemon.json`, the
  bearer token + health `proof`, the lock file, SAFE_PATH and opening the browser need the platform
  Spawner/SafeWriter/Random/Clock ports (WP-01) and the real commands (WP-11).
- `apps/cli/src/daemon/sqlite.ts` (SqlDb over bun:sqlite) and `worker-client.ts` are stand-ins for WP-01's adapters;
  the fetch handler in `daemon/serve.ts` is replaced by `createServer` (WP-INT). What stays: assembling
  `ServerDeps.assets` (`loadWebAssets`), `ServerDeps.pools.elk` (`createElkPool`) and the Worker entry paths.
- The state DB lives in `$MITORI_HOME` / `~/.mitori` only when that directory exists (the CLI may not `mkdir`); else in
  memory. State migrations are an empty list until the composition root collects server + agent migrations.
- `mitori _selftest [--json] [--elk-runs N]` is a hidden command (WP-11 may fold it into `mitori doctor`).
- Bun 1.4.2 test-runner quirk: `await expect(p).rejects…` hangs the whole `bun test` process when `p` settles from a
  Worker message; assert on `p.then(() => null, (e) => e.message)` instead (see `build/workers/workers.test.ts`).
- linux-x64 is cross-compiled and size-gated here but was not executed locally (no amd64 image); the PR CI job runs
  `bun run test` (incl. `test/skeleton`) on ubuntu, which builds and exercises the native linux-x64 binary.

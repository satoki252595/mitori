# perf track — change requests (indexer performance, 2026-10-04)

Measurements behind every request are in `docs/progress/perf.md` (Apple M5 Max, 6 P + 12 E cores, other agents running).
Everything below has a working local default in the tree, marked `// CR-PENDING(perf)`.

## 1. Compile the parse wasm once per pool, not once per Worker
- contract: `packages/indexer/src/contract.ts` §H — `ParseWorkerInit`
- change:
  ```ts
  interface ParseWorkerInit {
    /* … */
    /** Modules compiled once by the pool factory (`new WebAssembly.Module(bytes)`); structured clone shares them with
     * every Worker. The bytes above stay required (fallback when a module does not instantiate). */
    compiled?: { runtime?: WebAssembly.Module; grammars?: Partial<Record<GrammarId, WebAssembly.Module>> };
  }
  ```
  and in `apps/cli/src/daemon/server.ts#parseInit` (WP-11): add `compiled: { runtime: new WebAssembly.Module(runtime),
  grammars: { [g]: new WebAssembly.Module(bytes) … } }` to the init the parse pool factory posts. The server's Worker
  entry (`packages/server/src/workers/parse.ts`) already spreads unknown init fields through to `createParseWorker`.
- why: today every parse Worker compiles `web-tree-sitter.wasm` and each grammar itself and then tiers it up to OMG on
  its own (JSC keeps the compiled and tiered code per `WebAssembly.Module`, shared by all instances in all threads). With
  one module per pool the tier-up happens once and its compiler memory is paid once. Measured with the bench pool
  (`packages/indexer/src/parse/test/bun-pool.ts`, interleaved runs, load 5–9): crit cold S0–S1 482 → 399 ms
  (−17 %) and peak RSS 632 → 497 MB; gostd 2,048 → 1,976 ms and 1,031 → 975 MB at W = 6.
- workaround in place: `packages/indexer/src/parse/wasm.ts` reads `init.compiled` structurally (bytes when absent or not a
  module); the bench / test pool posts compiled modules (`MITORI_WASM_SHARE=0` turns it off).
- urgency: before the M2 measurement window (it changes `idx.s01.cold.*`, `idx.rss.peak` and `ui.firstUseful`).

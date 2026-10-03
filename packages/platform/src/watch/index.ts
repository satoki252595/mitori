/**
 * @mitori/platform — `watch/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
export { createFsWatcher, type FsWatcherOptions } from "./watcher.ts";
// `FsChange` / `FsWatcher` (./watcher.ts) are structural copies of the indexer / server contract types and are
// deliberately not re-exported: consumers name the contract types.

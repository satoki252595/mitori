/**
 * @mitori/platform — `fs/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
export { type ResolveHomeOptions, resolveHome } from "./home.ts";
export { createFsReader } from "./reader.ts";
export { INTEGRATION_PATHS, SAFE_WRITE_RULES } from "./rules.ts";
export { createSafeWriter, SAFE_WRITE_TEMP_RE, type SafeWriterOptions } from "./safe-writer.ts";
export { createSelfWriteLog, type SelfWriteLog, type SelfWriteLogOptions } from "./self-writes.ts";

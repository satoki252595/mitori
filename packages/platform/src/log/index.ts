/**
 * @mitori/platform — `log/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
export { LOG_ROTATION, type LogFileOptions, openLogFile, type RotatingLogFile } from "./file.ts";
export { createLogger, type LoggerOptions, type LogLevel, type LogSink } from "./logger.ts";

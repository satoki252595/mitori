// NDJSON logger: one JSON object per line, flat fields, content-shaped values dropped unless `logContent`.
import type { Clock, Iso8601, LogFields, Logger } from "@mitori/core";

/** Log level (ordered). */
export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Receives one complete NDJSON line (with the trailing `\n`). Must not throw. */
export type LogSink = (line: string) => void;

/** Options of {@link createLogger}. */
export interface LoggerOptions {
  /** Where lines go (a {@link RotatingLogFile}'s `write`, stderr, or a test array). */
  sink: LogSink;
  /** Minimum level (default `info`). */
  level?: LogLevel;
  /** `privacy.logContent`: keep long / multi-line values (default false). */
  logContent?: boolean;
  /** Timestamps. */
  clock: Clock;
}

/** Values longer than this, or containing a newline, are treated as file/prompt content (ARCHITECTURE §8.2). */
export const LOG_CONTENT_MAX_CHARS = 200;

const RESERVED = new Set(["t", "lvl", "ns", "msg"]);

/** True when a field value looks like content (newline or > {@link LOG_CONTENT_MAX_CHARS} chars). */
export function isContentLike(v: LogFields[string]): boolean {
  return typeof v === "string" && (v.length > LOG_CONTENT_MAX_CHARS || v.includes("\n") || v.includes("\r"));
}

/** Format one record. Content-like values become `«omitted:<n>»` unless `logContent`. */
export function formatLogLine(t: Iso8601, lvl: LogLevel, ns: string, msg: string, fields: LogFields, logContent: boolean): string {
  const rec: Record<string, unknown> = { t, lvl, ns, msg };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    rec[RESERVED.has(k) ? `_${k}` : k] = !logContent && isContentLike(v) ? `«omitted:${(v as string).length}»` : v;
  }
  return `${JSON.stringify(rec)}\n`;
}

/** Structured logger over a sink. Children share the sink and level; namespaces join with `.`. */
export function createLogger(opts: LoggerOptions): Logger {
  const min = RANK[opts.level ?? "info"];
  const logContent = opts.logContent ?? false;
  const make = (ns: string, bound: LogFields): Logger => {
    const emit = (lvl: LogLevel, msg: string, fields?: LogFields) => {
      if (RANK[lvl] < min) return;
      try {
        opts.sink(formatLogLine(opts.clock.iso(), lvl, ns, msg, fields ? { ...bound, ...fields } : bound, logContent));
      } catch {
        // logging must never take the daemon down
      }
    };
    return {
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, fields) => emit("error", msg, fields),
      child: (child, fields) => make(ns ? `${ns}.${child}` : child, fields ? { ...bound, ...fields } : bound),
    };
  };
  return make("", {});
}

// `~/.mitori/logs/daemon-YYYYMMDD[-n].ndjson`: append-only, rotated per UTC day or at the size cap, kept N days.
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "@mitori/core";

/** Rotation policy (ARCHITECTURE §5.2: 7 days / 50 MB). */
export const LOG_ROTATION = { maxBytes: 50 * 1024 * 1024, keepDays: 7 } as const;

/** Options of {@link openLogFile}. */
export interface LogFileOptions {
  /** Log directory (created 0700). */
  dir: string;
  /** Day boundaries and retention. */
  clock: Clock;
  /** File name prefix (default `daemon`). */
  prefix?: string;
  /** Size cap of one file (default {@link LOG_ROTATION}.maxBytes). */
  maxBytes?: number;
  /** Retention in days (default {@link LOG_ROTATION}.keepDays). */
  keepDays?: number;
}

/** An open, rotating NDJSON log file. `write` is a {@link LogSink}. */
export interface RotatingLogFile {
  /** Append one line (synchronous; a few µs). */
  write(line: string): void;
  /** Current file path. */
  path(): string;
  /** Close the descriptor. */
  close(): void;
}

const DAY_MS = 86_400_000;
const enc = new TextEncoder();

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** Open (or continue) today's log file. */
export function openLogFile(opts: LogFileOptions): RotatingLogFile {
  const prefix = opts.prefix ?? "daemon";
  const maxBytes = opts.maxBytes ?? LOG_ROTATION.maxBytes;
  const keepDays = opts.keepDays ?? LOG_ROTATION.keepDays;
  const nameRe = new RegExp(`^${prefix}-(\\d{8})(?:-(\\d+))?\\.ndjson$`);
  mkdirSync(opts.dir, { recursive: true, mode: 0o700 });

  let fd = -1;
  let day = "";
  let seg = 0;
  let size = 0;
  let file = "";

  const prune = (now: number) => {
    const oldest = ymd(now - keepDays * DAY_MS);
    for (const name of readdirSync(opts.dir)) {
      const m = nameRe.exec(name);
      if (m && (m[1] as string) <= oldest) unlinkSync(join(opts.dir, name));
    }
  };
  const lastSegment = (d: string): number => {
    let last = 0;
    for (const name of readdirSync(opts.dir)) {
      const m = nameRe.exec(name);
      if (m && m[1] === d) last = Math.max(last, Number(m[2] ?? 0));
    }
    return last;
  };
  const open = (d: string, s: number) => {
    if (fd >= 0) closeSync(fd);
    day = d;
    seg = s;
    file = join(opts.dir, `${prefix}-${d}${s > 0 ? `-${s}` : ""}.ndjson`);
    fd = openSync(file, "a", 0o600);
    size = fstatSync(fd).size;
  };

  const now0 = opts.clock.now();
  prune(now0);
  open(ymd(now0), lastSegment(ymd(now0)));

  return {
    write(line) {
      const bytes = enc.encode(line);
      const now = opts.clock.now();
      const d = ymd(now);
      if (d !== day) {
        prune(now);
        open(d, 0);
      } else if (size > 0 && size + bytes.byteLength > maxBytes) open(d, seg + 1);
      writeSync(fd, bytes);
      size += bytes.byteLength;
    },
    path: () => file,
    close() {
      if (fd >= 0) closeSync(fd);
      fd = -1;
    },
  };
}

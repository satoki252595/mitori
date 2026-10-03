// FsReader over node:fs / Bun.file (absolute paths only; missing → null where the contract says so).
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import type { FsReader, FsStat } from "@mitori/core";

const MISSING = new Set(["ENOENT", "ENOTDIR"]);

function missing(err: unknown): boolean {
  return MISSING.has((err as { code?: string } | null)?.code ?? "");
}

/** lstat as {@link FsStat} (nanosecond mtime, bigint inode); null when missing. */
export function lstatOrNull(abs: string): FsStat | null {
  try {
    const s = lstatSync(abs, { bigint: true });
    return { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: s.isSymbolicLink() };
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

/** The production {@link FsReader}. */
export function createFsReader(): FsReader {
  return {
    stat: lstatOrNull,
    read: async (abs) => Bun.file(abs).bytes(),
    readHead: async (abs, n) => Bun.file(abs).slice(0, Math.max(0, n)).bytes(),
    realpath(abs) {
      try {
        return realpathSync(abs);
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    readdir(abs) {
      try {
        return readdirSync(abs);
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
  };
}

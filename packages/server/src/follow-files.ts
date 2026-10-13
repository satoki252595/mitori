/**
 * @mitori/server — follow file ports (WP28b): file identity via `stat` and a streamed sha256 for vendor-CLI
 * auto-follow. The daemon must never hold a whole vendor binary in memory (Muse's native binary is ~360 MB,
 * over the daemon's resident RSS budget), so the hash is streamed in chunks and the "unchanged during the
 * check" comparison uses `{dev, ino, size, mtimeMs}` only.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

/** Identity of a candidate file (structurally the agent `FileId`; the agent package owns that type). */
export interface FollowFileId {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

/** `stat` identity of the candidate; `null` when missing, not a regular file, or unstatting fails. */
export function followFileId(candidate: string): FollowFileId | null {
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return null;
    return { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** sha256 hex of the file, hashed chunk by chunk; `null` when the file cannot be streamed. */
export function sha256File(candidate: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const hash = createHash("sha256");
    const stream = createReadStream(candidate);
    stream.on("data", (chunk) => hash.update(chunk as Uint8Array));
    stream.on("error", () => finish(null));
    stream.on("end", () => {
      try {
        finish(hash.digest("hex"));
      } catch {
        finish(null);
      }
    });
  });
}

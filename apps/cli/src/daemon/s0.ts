/**
 * S0 stub (WP-11a, M0.5): a bounded, read-only file count standing in for the indexer's S0 inventory (WP-02,
 * `indexer.scan({ until: "S0" })`) until the composition root wires the real WorkspaceManager.
 */
import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

export interface InventoryStub {
  files: number;
  dirs: number;
  /** Hit `limit` before the walk finished. */
  truncated: boolean;
  ms: number;
}

const SKIP: ReadonlySet<string> = new Set([".git", "node_modules", ".mitori"]);

export function inventoryStub(root: string, limit = 200_000): InventoryStub {
  const t0 = performance.now();
  const stack = [root];
  let files = 0;
  let dirs = 0;
  while (stack.length > 0 && files < limit) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: S0 records it as excluded; the stub just skips it
    }
    dirs++;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile()) files++;
    }
  }
  return { files, dirs, truncated: stack.length > 0, ms: performance.now() - t0 };
}

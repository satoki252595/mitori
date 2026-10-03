// SAFE_PATH (server spec §2, SEC-10): the PATH every child gets. Pure string work (no fs).
import { posix } from "node:path";

const strip = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

const under = (entry: string, root: string): boolean => root !== "" && (entry === root || entry.startsWith(root === "/" ? "/" : `${root}/`));

/** Project-local tool dirs a repo can plant binaries in (`npm i` / `uv venv`). */
const LOCAL_BIN = /(?:^|\/)(?:node_modules\/\.bin|\.venv\/bin)$/;

/** See the contract text in `./index.ts`. Order is kept; duplicates keep their first position. */
export function computeSafePath(path: string, opts: { workspaceRoots: readonly string[]; startCwd: string }): string {
  const roots = [...opts.workspaceRoots, opts.startCwd].filter((r) => posix.isAbsolute(r)).map((r) => strip(posix.normalize(r)));
  const out: string[] = [];
  for (const raw of path.split(":")) {
    if (raw === "" || !posix.isAbsolute(raw)) continue;
    const entry = strip(posix.normalize(raw));
    if (LOCAL_BIN.test(entry)) continue;
    if (roots.some((r) => r !== "/" && under(entry, r))) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.join(":");
}

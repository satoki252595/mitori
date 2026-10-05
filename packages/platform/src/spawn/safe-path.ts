// SAFE_PATH (server spec §2, SEC-10): the PATH every child gets. Pure string work (no fs).
import { delimiter, isAbsolute, normalize, parse, relative, sep } from "node:path";

const strip = (p: string): string => (p === parse(p).root ? p : p.replace(/[\\/]+$/, ""));

const under = (entry: string, root: string): boolean => {
  const rel = relative(root, entry);
  return root !== "" && (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)));
};

/** Project-local tool dirs a repo can plant binaries in (`npm i` / `uv venv`). */
const LOCAL_BIN = /(?:^|[\\/])(?:node_modules[\\/]\.bin|\.venv[\\/](?:bin|Scripts))$/i;

/** See the contract text in `./index.ts`. Order is kept; duplicates keep their first position. */
export function computeSafePath(path: string, opts: { workspaceRoots: readonly string[]; startCwd: string }): string {
  const roots = [...opts.workspaceRoots, opts.startCwd].filter(isAbsolute).map((r) => strip(normalize(r)));
  const out: string[] = [];
  for (const raw of path.split(delimiter)) {
    if (raw === "" || !isAbsolute(raw)) continue;
    const entry = strip(normalize(raw));
    if (LOCAL_BIN.test(entry)) continue;
    if (roots.some((r) => r !== parse(r).root && under(entry, r))) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.join(delimiter);
}

// Not-a-project guard (UXP-23, indexer spec R1 §2.1; server spec `open(target, {force})`): refuse $HOME, `/`, `/Users`,
// Desktop / Documents / Downloads, anything under ~/Library, and directories without a project marker at depth 1.
// The WorkspaceManager calls it before the first scan (public since CR m1-30, `inventory/index.ts`).
import { type FsReader, MitoriError } from "@mitori/core";

/** Depth-1 entries that make a directory a project. */
export const PROJECT_MARKERS: readonly (string | RegExp)[] = [
  "package.json",
  "go.mod",
  "pyproject.toml",
  "Cargo.toml",
  "Makefile",
  "src",
  ".git",
  /\.sln$/,
  /^README/i,
];

const trim = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

/** Why `root` is not a project, or null when it is one. `root` and `home` are absolute realpaths. */
export function notProjectReason(root: string, home: string, fs: Pick<FsReader, "readdir">): string | null {
  const r = trim(root);
  const h = trim(home);
  if (r === "/" || r === "/Users" || r === "/home") return "filesystem root";
  if (r === h) return "home directory";
  for (const d of ["Desktop", "Documents", "Downloads"]) if (r === `${h}/${d}`) return `~/${d}`;
  if (r === `${h}/Library` || r.startsWith(`${h}/Library/`)) return "~/Library";
  const entries = fs.readdir(r);
  if (entries === null) return "not a directory";
  const hit = entries.some((e) => PROJECT_MARKERS.some((m) => (typeof m === "string" ? e === m : m.test(e))));
  return hit ? null : "no project marker";
}

/** Throw `E_WS_NOT_PROJECT` unless `force`. */
export function assertProject(root: string, home: string, fs: Pick<FsReader, "readdir">, force = false): void {
  if (force) return;
  const why = notProjectReason(root, home, fs);
  if (why !== null)
    throw new MitoriError("E_WS_NOT_PROJECT", `not a project directory: ${why}`, {
      params: { root, reason: why },
      hint: "open a project directory, or pass force",
    });
}

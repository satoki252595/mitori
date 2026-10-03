/**
 * Provisional module names and slug bases (spec §6.6 "name"; recomputed every structure pass). Before the doc is
 * generated these names are what the map, the TOC and the palette show, so they read as paths — never as top-level
 * directories joined with `+` plus a random symbol:
 *
 * - one file → its path (`web/app.js`)
 * - a module that is (≥ 80 % of) its dominant directory D, and the only one there → `D` (`internal/vcs`,
 *   `src/middleware`)
 * - members spread over child directories of D → `D/a · b` (`internal/github · gitlab`)
 * - members directly in a D shared with other modules → `D (x*)` for a common file-name prefix (`web (live-mode*)`),
 *   else `D (f1, f2)` with its two largest files (`components (PartPanel, PartInspector)`)
 * - D is the repository root → its top directories, each as deep as it stays one directory (`src/adapter · adapters`).
 *
 * The slug base is born from the same parts (`internal-vcs`, `web-live-mode`), so a page's file name says which module
 * it is. gen replaces names with Japanese labels in the doc; ids and slugs never change.
 */
import type { RepoPath } from "@mitori/core";
import { SLUG_NOISE_SEGMENTS } from "../contract.ts";
import { baseOf, dirOf } from "../resolve/files.ts";
import { slugify } from "./index.ts";
import { slugText } from "./slug.ts";

export interface NameInput {
  /** Members (non-test paths). */
  paths: readonly RepoPath[];
  /** Dominant directory (`.` for the root). */
  dominantDir: string;
  /** Birth anchor candidate (PageRank max). */
  anchor: RepoPath;
}

export interface ModuleName {
  name: string;
  /** Slug base for a newborn (uniqueness suffixes are added by identity.ts). */
  slugBase: string;
}

/** Share of a module's LOC a child directory needs to be named. */
const CHILD_SHARE = 0.15;
/** Share of a directory's subtree a module must hold to be named after the directory alone. */
const OWN_SHARE = 0.8;
/** Share of the direct files' LOC a common file-name prefix must cover. */
const PREFIX_SHARE = 0.5;
/** File stems that say nothing about a module. */
const GENERIC_STEMS = new Set([
  "index",
  "mod",
  "main",
  "__init__",
  "__main__",
  "lib",
  "types",
  "utils",
  "util",
  "helpers",
  "constants",
  "common",
  "shared",
  "defs",
]);

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stemOf = (p: RepoPath) => {
  const b = baseOf(p);
  const i = b.indexOf(".", 1);
  return i < 0 ? b : b.slice(0, i);
};
const isRoot = (d: string) => d === "" || d === ".";
const lastSeg = (d: string) => d.slice(d.lastIndexOf("/") + 1);

/** LOC per child segment of `dir` ("" = files directly in dir). */
function byChild(dir: string, paths: readonly RepoPath[], loc: (p: RepoPath) => number): Map<string, number> {
  const by = new Map<string, number>();
  for (const p of paths) {
    if (!isRoot(dir) && !p.startsWith(`${dir}/`)) continue; // a minority member outside the dominant directory
    const rest = isRoot(dir) ? p : p.slice(dir.length + 1);
    const i = rest.indexOf("/");
    const c = i < 0 ? "" : rest.slice(0, i);
    by.set(c, (by.get(c) ?? 0) + Math.max(1, loc(p)));
  }
  return by;
}

/** `dir/child`, descended while one directory below holds ≥ 80 % of the module's LOC under it (`src` → `src/adapter`). */
function deepen(dir: string, paths: readonly RepoPath[], loc: (p: RepoPath) => number): string {
  let d = dir;
  for (let guard = 0; guard < 32; guard++) {
    const under = paths.filter((p) => p.startsWith(`${d}/`));
    const total = under.reduce((a, p) => a + Math.max(1, loc(p)), 0);
    const best = [...byChild(d, under, loc)].filter(([c]) => c !== "").sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]))[0];
    if (best === undefined || best[1] < OWN_SHARE * total) return d;
    d = `${d}/${best[0]}`;
  }
  return d;
}

/**
 * Child directories of `dir` holding ≥ 15 % of the module (≤ 3, LOC desc then name; the largest two when the members
 * spread thinner than that), each deepened; `more` when the parts leave ≥ 20 % of the LOC unnamed.
 */
function childParts(dir: string, paths: readonly RepoPath[], loc: (p: RepoPath) => number): { parts: string[]; directShare: number; more: boolean } {
  const by = byChild(dir, paths, loc);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const directShare = (by.get("") ?? 0) / Math.max(1, total);
  const kids = [...by].filter(([c]) => c !== "").sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]));
  let picked = kids.filter(([, w]) => w >= CHILD_SHARE * total).slice(0, 3);
  if (picked.length === 0 && directShare < 0.5) picked = kids.slice(0, 2);
  const covered = picked.reduce((a, [, w]) => a + w, 0) + (by.get("") ?? 0);
  return {
    parts: picked.map(([c]) => deepen(isRoot(dir) ? c : `${dir}/${c}`, paths, loc)),
    directShare,
    more: covered < OWN_SHARE * total,
  };
}

/** `x/src` → `x` (a trailing source-root segment adds nothing to a part's label). */
function trimNoise(rel: string): string {
  const segs = rel.split("/");
  while (segs.length > 1 && (SLUG_NOISE_SEGMENTS as readonly string[]).includes(segs[segs.length - 1] as string)) segs.pop();
  return segs.join("/");
}

/** Parts below `dir` as one label: `dir/a · b` (the shared head printed once, ` …` when more is left unnamed). */
function joinParts(dir: string, parts: readonly string[], more: boolean): string {
  const rel = parts.map((p) => trimNoise(isRoot(dir) ? p : p.slice(dir.length + 1)));
  const tail = `${rel.join(" · ")}${more ? " …" : ""}`;
  return isRoot(dir) ? tail : `${dir}/${tail}`;
}

/** Longest file-name prefix (token boundary, ≥ 4 chars) shared by ≥ 2 files covering ≥ 50 % of their LOC. */
function commonPrefix(files: readonly RepoPath[], loc: (p: RepoPath) => number, avoid: string): string | null {
  const total = files.reduce((a, p) => a + Math.max(1, loc(p)), 0);
  const cover = new Map<string, { files: number; loc: number }>();
  for (const p of files) {
    const b = baseOf(p);
    const stem = b.includes(".") ? b.slice(0, b.lastIndexOf(".")) : b;
    for (let i = 4; i <= stem.length; i++) {
      if (i < stem.length && !/[-_.]/.test(stem[i] as string)) continue;
      const pre = stem.slice(0, i);
      const c = cover.get(pre) ?? { files: 0, loc: 0 };
      c.files++;
      c.loc += Math.max(1, loc(p));
      cover.set(pre, c);
    }
  }
  let best: string | null = null;
  for (const [pre, c] of cover) {
    // a prefix that only repeats the directory's own name ("session" in internal/session) says nothing
    if (c.files < 2 || c.loc < PREFIX_SHARE * total || pre.toLowerCase() === avoid.toLowerCase()) continue;
    if (best === null || pre.length > best.length || (pre.length === best.length && pre < best)) best = pre;
  }
  return best;
}

/** The two largest member files with a telling stem (generic stems only when nothing else is left). */
function mainFiles(paths: readonly RepoPath[], loc: (p: RepoPath) => number): string[] {
  const sorted = [...paths].sort((a, b) => loc(b) - loc(a) || byStr(a, b));
  const telling = sorted.filter((p) => !GENERIC_STEMS.has(stemOf(p).toLowerCase()));
  const stems: string[] = [];
  for (const p of [...telling, ...sorted]) {
    const s = stemOf(p);
    if (!stems.includes(s)) stems.push(s);
    if (stems.length === 2) break;
  }
  return stems;
}

function nameOf(m: NameInput, loc: (p: RepoPath) => number, subtreeLoc: (dir: string) => number, sharedDir: boolean): ModuleName {
  const base = slugify(m.dominantDir, m.anchor);
  if (m.paths.length === 1) {
    const p = m.paths[0] as RepoPath;
    return { name: p, slugBase: slugText(`${base}-${stemOf(p)}`) || base };
  }
  const d = isRoot(m.dominantDir) ? "" : m.dominantDir;
  const total = m.paths.reduce((a, p) => a + Math.max(1, loc(p)), 0);
  if (d !== "" && !sharedDir && total >= OWN_SHARE * subtreeLoc(d)) return { name: d, slugBase: base };
  const { parts, directShare, more } = childParts(d, m.paths, loc);
  if (parts.length >= 2 || (parts.length === 1 && directShare < 0.5)) {
    const tail = parts.map((p) => trimNoise(d === "" ? p : p.slice(d.length + 1)));
    return { name: joinParts(d, parts, more), slugBase: slugText(d === "" ? tail.join("-") : `${base}-${tail.join("-")}`) || base };
  }
  if (d === "") {
    const files = mainFiles(m.paths, loc);
    return { name: `(root) (${files.join(", ")})`, slugBase: slugText(files.join("-")) || base };
  }
  if (!sharedDir) return { name: d, slugBase: base };
  const direct = m.paths.filter((p) => dirOf(p) === d);
  const pre = commonPrefix(direct, loc, lastSeg(d));
  if (pre !== null) return { name: `${d} (${pre}*)`, slugBase: slugText(`${base}-${pre}`) || base };
  const files = mainFiles(direct.length > 0 ? direct : m.paths, loc);
  return { name: `${d} (${files.join(", ")})`, slugBase: slugText(`${base}-${files[0] ?? ""}`) || base };
}

/**
 * Names for one level of sibling modules: unique within the level (an equal pair gets its two largest files added,
 * then numbers); the slug base follows the name's parts. `subtreeLoc(dir)` = LOC of the whole directory.
 */
export function moduleNames(mods: readonly NameInput[], loc: (p: RepoPath) => number, subtreeLoc: (dir: string) => number): ModuleName[] {
  const byDir = new Map<string, number>();
  for (const m of mods) byDir.set(m.dominantDir, (byDir.get(m.dominantDir) ?? 0) + 1);
  let out = mods.map((m) => nameOf(m, loc, subtreeLoc, (byDir.get(m.dominantDir) ?? 0) > 1));
  const count = (xs: readonly ModuleName[]) => {
    const c = new Map<string, number>();
    for (const n of xs) c.set(n.name, (c.get(n.name) ?? 0) + 1);
    return c;
  };
  let seen = count(out);
  out = out.map((n, i) => {
    if ((seen.get(n.name) ?? 0) < 2 || n.name.endsWith(")")) return n;
    const files = mainFiles((mods[i] as NameInput).paths, loc);
    return { name: `${n.name} (${files.join(", ")})`, slugBase: slugText(`${n.slugBase}-${files[0] ?? ""}`) || n.slugBase };
  });
  seen = count(out);
  const k = new Map<string, number>();
  return out.map((n) => {
    if ((seen.get(n.name) ?? 0) < 2) return n;
    const i = (k.get(n.name) ?? 0) + 1;
    k.set(n.name, i);
    return { name: `${n.name} ${i}`, slugBase: n.slugBase };
  });
}

// 「変更の手引き」 per module (comprehension check: "add a new Kind" scored 0 — the doc said what each module is,
// never what touching it involves). From the index and the git history alone (0 tokens): who depends on the module
// (a change reaches them), what it depends on, the tests that check it and how to run them, the entry points whose
// flows reach it, the files that changed together with it (git log, bounded, cached by HEAD), and risk markers (a hub,
// a file over 1,500 lines, no tests, a dependency cycle).
import type { GitOid, LineNo, RepoPath } from "@mitori/core";
import type { ModuleChangeGuide } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";

/** Commits read for co-change (newest first). */
export const HISTORY_WINDOW = 300;
/** A commit touching more files than this is a sweep (format, rename, vendoring), not a change that belongs together. */
const SWEEP_FILES = 40;
/** Co-changing files shown per module, and how often they must have changed together. */
const CO_CHANGE_MAX = 5;
const CO_CHANGE_MIN = 2;
const ENTRIES_MAX = 5;
/** Files over this many lines are a risk marker (the region outline covers them). */
export const LARGE_FILE_LINES = 1500;

export interface Commit {
  sha: GitOid;
  paths: RepoPath[];
}

/** What the history comes from (core `GitReader`). */
export interface HistorySource {
  head(): Promise<GitOid | null>;
  log(opts: { limit: number }): Promise<{ sha: GitOid; paths: RepoPath[] }[]>;
}

const cache = new WeakMap<object, { head: GitOid; commits: Promise<Commit[] | null> }>();

/**
 * The last {@link HISTORY_WINDOW} non-merge commits with their paths, cached per reader by HEAD (one `git log` per
 * new HEAD, not one per static apply). Null without history: no commit, a shallow clone (the reader returns no log),
 * or a failing git.
 */
export async function recentCommits(git: HistorySource, limit = HISTORY_WINDOW): Promise<Commit[] | null> {
  let head: GitOid | null;
  try {
    head = await git.head();
  } catch {
    return null;
  }
  if (head === null) return null;
  const hit = cache.get(git);
  if (hit && hit.head === head) return hit.commits;
  const commits = git
    .log({ limit })
    .then((log) => (log.length === 0 ? null : log.map((c) => ({ sha: c.sha, paths: c.paths }))))
    .catch(() => null);
  cache.set(git, { head, commits });
  return commits;
}

export type ChangeIndexer = Pick<Indexer, "modules" | "moduleStats" | "moduleDetail" | "facts" | "flowSeeds" | "structure" | "files">;

/** Inputs beyond the index. */
export interface ChangeInputs {
  /** Recent commits (null: no history). */
  history: Commit[] | null;
  /** The repo's own test command (root `test` script, Makefile `test`), when it has one. */
  rootTest?: { command: string; path: RepoPath; line: LineNo };
  /** Go module (`go.mod` present): per-module `go test ./<dir>/...`. */
  goModule?: boolean;
}

/** Common directory of a module's files (`internal/session`; "" at the root). */
function dirOf(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const segs = paths.map((p) => p.split("/").slice(0, -1));
  const first = segs[0] as string[];
  let n = first.length;
  for (const s of segs) {
    let i = 0;
    while (i < n && s[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join("/");
}

/** Go packages listed one by one up to this many; more share their common directory (`./internal/...`). */
const GO_PACKAGES_MAX = 3;

/**
 * How to run a module's tests, decided by the tests themselves (none ⇒ no command): Go test files ⇒ `go test` of
 * exactly their packages — the module's own packages when its tests live there (a test attached by an import vote
 * elsewhere does not widen it to `./...`); any other tests ⇒ the repo's own test command. Whichever language holds
 * more of the tests wins — a JS module that embeds its assets through one `.go` file is tested by `make test`, not by
 * `go test ./web/...` (crit `web/style-live`).
 */
export function testCommandOf(
  tests: readonly { path: RepoPath }[],
  inputs: Pick<ChangeInputs, "rootTest" | "goModule">,
  modulePaths: readonly RepoPath[] = [],
): ModuleChangeGuide["testCommand"] {
  const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const goTests = tests.filter((t) => t.path.endsWith("_test.go"));
  const own = new Set(modulePaths.filter((p) => p.endsWith(".go")).map(parent));
  const allDirs = [...new Set(goTests.map((t) => parent(t.path)))].sort();
  const ownDirs = allDirs.filter((d) => own.has(d));
  const goDirs = ownDirs.length > 0 ? ownDirs : allDirs;
  const go = inputs.goModule === true && goDirs.length > 0 && goTests.length * 2 >= tests.length;
  if (go) {
    if (goDirs.length <= GO_PACKAGES_MAX) return { command: `go test ${goDirs.map((d) => (d === "" ? "." : `./${d}`)).join(" ")}` };
    const common = dirOf(goDirs.map((d) => `${d}/_`)); // the directory the packages share
    return { command: `go test ${common === "" ? "./..." : `./${common}/...`}` };
  }
  if (tests.length > 0 && inputs.rootTest) return { command: inputs.rootTest.command, path: inputs.rootTest.path, line: inputs.rootTest.line };
  return undefined;
}

/** The change guide of every leaf module. */
export function changeGuides(ix: ChangeIndexer, inputs: ChangeInputs): Record<string, ModuleChangeGuide> {
  const leaves = ix.modules().filter((m) => m.children.length === 0);
  const out: Record<string, ModuleChangeGuide> = {};
  if (leaves.length === 0) return out;
  const files = new Map(ix.files().map((f) => [f.path, f]));
  const cases = new Map<RepoPath, number>();
  for (const f of ix.facts("test")) cases.set(f.path, (cases.get(f.path) ?? 0) + 1);
  const seeds = ix.flowSeeds(8);
  const routes = ix.facts("route");
  const clis = ix.facts("cli");
  const entries = ix.facts("entry").filter((f) => f.kind === "entry" && f.entry !== "test_main" && f.entry !== "dockerfile");
  const cycles = ix.structure()?.cycles ?? [];
  // co-change: file → commits that touched it (sweeps dropped)
  const commits = (inputs.history ?? []).filter((c) => c.paths.length <= SWEEP_FILES);
  const touched = new Map<RepoPath, number[]>();
  commits.forEach((c, i) => {
    for (const p of c.paths) touched.set(p, [...(touched.get(p) ?? []), i]);
  });
  const keep = (p: RepoPath) => {
    const f = files.get(p);
    return f !== undefined && f.excluded === undefined && (f.class === "source" || f.class === "test" || f.class === "config");
  };
  for (const m of leaves) {
    const stats = ix.moduleStats(m.id);
    const detail = ix.moduleDetail(m.id);
    const home = detail?.dominantDir && detail.dominantDir !== "." ? detail.dominantDir : dirOf(m.paths);
    // the module's own directory first (a test attached by an import vote elsewhere says less), then by cases
    const near = (p: string) => (home !== "" && (p === home || p.startsWith(`${home}/`)) ? 0 : 1);
    const tests = [...new Set(detail?.tests ?? [])]
      .map((p) => ({ path: p, cases: cases.get(p) ?? 0 }))
      .sort((a, b) => near(a.path) - near(b.path) || b.cases - a.cases || (a.path < b.path ? -1 : 1));
    const members = new Set<RepoPath>([...m.paths, ...tests.map((t) => t.path)]);
    // entries: flows through the module first, then routes / commands / mains defined in it
    const ent: ModuleChangeGuide["entries"] = [];
    const add = (label: string, path: RepoPath, line: number) => {
      if (ent.length < ENTRIES_MAX && !ent.some((e) => e.label === label)) ent.push({ label, path, line: line as LineNo });
    };
    for (const s of seeds) if (s.modules.includes(m.id)) add(s.label, s.path, s.line);
    for (const r of routes)
      if (r.kind === "route" && (members.has(r.path) || (r.handler && members.has(r.handler.slice(0, r.handler.indexOf("#"))))))
        add(`${r.method} ${r.pattern}`, r.path, r.line);
    for (const c of clis) if (c.kind === "cli" && members.has(c.path)) add(c.command, c.path, c.line);
    for (const e of entries) if (e.kind === "entry" && members.has(e.path)) add(e.label, e.path, e.line);
    // co-change
    const hits = new Set<number>();
    for (const p of members) for (const i of touched.get(p) ?? []) hits.add(i);
    const together = new Map<RepoPath, number>();
    for (const i of hits) for (const p of (commits[i] as Commit).paths) if (!members.has(p) && keep(p)) together.set(p, (together.get(p) ?? 0) + 1);
    const coChange = [...together]
      .filter(([, n]) => n >= CO_CHANGE_MIN)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, CO_CHANGE_MAX)
      .map(([path, n]) => ({ path, together: n }));
    // risks
    const risks: ModuleChangeGuide["risks"] = [];
    const dependents = (stats?.depsIn ?? []).filter((d) => d.module !== m.id);
    const dependencies = (stats?.depsOut ?? []).filter((d) => d.module !== m.id);
    if (dependents.length >= 3 && dependencies.length >= 2) risks.push({ kind: "hub" });
    for (const p of [...m.paths].sort()) {
      const lines = files.get(p)?.lines ?? 0;
      if (lines > LARGE_FILE_LINES && files.get(p)?.class === "source") risks.push({ kind: "large_file", path: p, lines });
    }
    if (tests.length === 0) risks.push({ kind: "untested" });
    const cyc = cycles.find((c) => c.includes(m.id));
    if (cyc) risks.push({ kind: "cycle", with: cyc.filter((x) => x !== m.id) });
    const testCommand = testCommandOf(tests, inputs, m.paths);
    out[m.id] = {
      dependents,
      dependencies,
      tests,
      ...(testCommand ? { testCommand } : {}),
      entries: ent,
      coChange,
      commits: inputs.history === null ? null : hits.size,
      window: commits.length,
      risks,
    };
  }
  return out;
}

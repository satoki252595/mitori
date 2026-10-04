// NC-06 / NC-07 (newcomer audit): the two questions the static doc did not answer — "how do I run it" (§4 was three
// untitled tables, `next dev` instead of `npm run dev`, no install step, no Node version) and "where do I start
// reading" (§2 had one partly inferred line). Both are answered here from the index alone, 0 tokens: the declared
// toolchain, the lockfile's package manager, the run script qualified by it, the localhost URL the README gives; and a
// reading order — entry, base types, hub, feature core — each with its lines.
import type { DependencyFact, EntryFact, FileEntry, LineNo, RepoPath, RepoProfile, ScriptFact, SymbolEntry } from "@mitori/core";
import type { StaticGuide } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { type ChangeInputs, changeGuides, type HistorySource, recentCommits } from "./doc-change.ts";
import { fileRegions, REGION_MIN_LINES } from "./doc-regions.ts";
import { keyTypes } from "./doc-types.ts";

type Pm = { name: string; install: string; run: (script: string) => string; lock: string };

/** Lockfile → package manager, most specific first. */
const PMS: Pm[] = [
  { name: "pnpm", lock: "pnpm-lock.yaml", install: "pnpm install", run: (s) => `pnpm ${s}` },
  { name: "yarn", lock: "yarn.lock", install: "yarn install", run: (s) => `yarn ${s}` },
  { name: "bun", lock: "bun.lock", install: "bun install", run: (s) => `bun run ${s}` },
  { name: "bun", lock: "bun.lockb", install: "bun install", run: (s) => `bun run ${s}` },
  { name: "npm", lock: "package-lock.json", install: "npm install", run: (s) => `npm run ${s}` },
];
const PY: { lock: string; install: string }[] = [
  { lock: "uv.lock", install: "uv sync" },
  { lock: "poetry.lock", install: "poetry install" },
  { lock: "requirements.txt", install: "pip install -r requirements.txt" },
];

/** Preferred run scripts, in order (a dev server first). */
const RUN_NAMES = ["dev", "start", "serve", "run", "develop"];
const TYPE_KINDS = new Set(["interface", "type", "struct", "class", "enum", "trait"]);
const CODE_KINDS = new Set(["function", "method", "class", "struct", "const", "var"]);

/** `http://localhost:3000` (or 127.0.0.1) the README / CONTRIBUTING tells the reader to open. */
export function localhostUrl(text: string): { url: string; line: LineNo } | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[\w./-]*)?/.exec(lines[i] as string);
    if (m) return { url: m[0].replace(/[).,]+$/, ""), line: (i + 1) as LineNo };
  }
  return null;
}

/** Next.js App Router / Pages, Vite, SvelteKit, Nuxt top pages (the entry a reader opens first). */
function frameworkEntry(files: ReadonlySet<string>, deps: ReadonlySet<string>): { path: RepoPath; label: string } | null {
  const first = (cands: string[]) => cands.find((p) => files.has(p)) as RepoPath | undefined;
  if (deps.has("next")) {
    const app = first(["app/page.tsx", "app/page.jsx", "app/page.ts", "app/page.js", "src/app/page.tsx", "src/app/page.jsx"]);
    if (app) return { path: app, label: "Next.js（App Router）のトップページ" };
    const pages = first(["pages/index.tsx", "pages/index.jsx", "pages/index.js", "src/pages/index.tsx"]);
    if (pages) return { path: pages, label: "Next.js（Pages Router）のトップページ" };
  }
  if (deps.has("@sveltejs/kit")) {
    const p = first(["src/routes/+page.svelte"]);
    if (p) return { path: p, label: "SvelteKit のトップページ" };
  }
  if (deps.has("nuxt")) {
    const p = first(["app.vue", "pages/index.vue"]);
    if (p) return { path: p, label: "Nuxt のトップページ" };
  }
  if (deps.has("vite")) {
    const p = first(["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "index.html"]);
    if (p) return { path: p, label: "Vite のエントリ" };
  }
  return null;
}

/**
 * The `main` package a reader runs: the one the README's `go run ./…` names, else the one named like the module
 * (`example.com/tsundoku` → `cmd/tsundoku`), else the first by path.
 */
function goMain(facts: readonly { kind: string }[], readme: string, gomod: string): EntryFact | null {
  const mains = (facts as EntryFact[])
    .filter((f) => f.kind === "entry" && f.entry === "main" && f.path.endsWith("main.go") && f.scope !== "example")
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  if (mains.length === 0) return null;
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
  const said = [...readme.matchAll(/go run\s+(\.\/[\w./-]+|\.)/g)].map((m) => (m[1] as string).replace(/^\.\//, "").replace(/\/$/, "") || ".");
  for (const want of said) {
    const hit = mains.find((m) => dirOf(m.path) === want);
    if (hit) return hit;
  }
  const mod = /^module\s+(\S+)/m.exec(gomod)?.[1]?.split("/").pop();
  return (mod ? mains.find((m) => dirOf(m.path).split("/").pop() === mod) : undefined) ?? (mains[0] as EntryFact);
}

export interface GuideDeps {
  indexer: Pick<Indexer, "files" | "facts" | "symbols" | "modules" | "graph" | "dependents" | "imports"> &
    Partial<Pick<Indexer, "moduleStats" | "moduleDetail" | "flowSeeds" | "structure" | "moduleOf" | "currentText" | "symbolUsers">>;
  profile: RepoProfile | null;
  read(path: RepoPath): Promise<string | null>;
  /** Git history for the change guides' co-change (`GitReader`); absent ⇒ no co-change. */
  git?: HistorySource;
}

/** At most this many large files get a region outline per static apply (largest first). */
const REGION_FILES_MAX = 40;

/**
 * §7 key types, the per-module change guides and the large-file region outlines (NC-10 / 変更の手引き / large
 * components; 0 tokens) — each only when the index offers what it needs.
 */
async function deepGuide(d: GuideDeps, guide: StaticGuide, rootTest: ChangeInputs["rootTest"], goModule: boolean): Promise<void> {
  const ix = d.indexer;
  if (ix.moduleOf) {
    const types = keyTypes({
      files: ix.files,
      symbols: ix.symbols,
      imports: ix.imports,
      moduleOf: ix.moduleOf,
      ...(ix.symbolUsers ? { symbolUsers: ix.symbolUsers } : {}),
    });
    if (types.length > 0) guide.types = types;
  }
  const regionsOf = async () => {
    if (!ix.currentText) return;
    const big = ix
      .files()
      .filter((f) => f.class === "source" && f.excluded === undefined && f.lines > REGION_MIN_LINES)
      .sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1))
      .slice(0, REGION_FILES_MAX);
    const out: NonNullable<StaticGuide["regions"]> = {};
    const texts = await Promise.all(big.map((f) => ix.currentText?.(f.path) ?? Promise.resolve(null)));
    big.forEach((f, i) => {
      const text = texts[i];
      if (text == null) return;
      const regions = fileRegions(text, ix.symbols(f.path), f.lang);
      if (regions.length > 0) out[f.path] = { lines: f.lines, regions };
    });
    if (Object.keys(out).length > 0) guide.regions = out;
  };
  const changeOf = async () => {
    if (!ix.moduleStats || !ix.moduleDetail || !ix.flowSeeds || !ix.structure) return;
    const history = d.git ? await recentCommits(d.git) : null;
    const change = changeGuides(
      {
        modules: ix.modules,
        moduleStats: ix.moduleStats,
        moduleDetail: ix.moduleDetail,
        facts: ix.facts,
        flowSeeds: ix.flowSeeds,
        structure: ix.structure,
        files: ix.files,
      },
      { history, ...(rootTest ? { rootTest } : {}), goModule },
    );
    if (Object.keys(change).length > 0) guide.change = change;
  };
  await Promise.all([regionsOf(), changeOf()]);
}

/** The repo's own test command: the root `test` script qualified by its package manager, a Makefile / just `test`. */
function rootTestOf(scripts: readonly ScriptFact[], pm: Pm | undefined): ChangeInputs["rootTest"] {
  const pkg = scripts.find((s) => s.path === "package.json" && s.name === "test");
  if (pkg && pm) return { command: pm.name === "npm" ? "npm test" : pm.run("test"), path: pkg.path, line: pkg.line as LineNo };
  const make = scripts.find((s) => /^(Makefile|GNUmakefile|justfile)$/.test(s.path) && s.name === "test");
  if (make) return { command: `${make.path === "justfile" ? "just" : "make"} test`, path: make.path, line: make.line as LineNo };
  return undefined;
}

/** The static guide of §4 / §5 (quick start + reading order). */
export async function staticGuide(d: GuideDeps): Promise<StaticGuide> {
  const files = d.indexer.files({ includeExcluded: true });
  const paths = new Set(files.map((f) => f.path));
  const facts = d.indexer.facts();
  const scripts = facts.filter((f): f is ScriptFact => f.kind === "script" && f.scope !== "example");
  const depNames = new Set(facts.filter((f): f is DependencyFact => f.kind === "dependency").map((f) => f.name));
  const guide: StaticGuide = {};

  // ---- quick start
  const readmePath = ["README.md", "README", "readme.md"].find((p) => paths.has(p));
  const readme = readmePath ? ((await d.read(readmePath as RepoPath)) ?? "") : "";
  let mainPath: RepoPath | null = null;
  if (d.profile?.toolchain) guide.toolchain = { ...d.profile.toolchain };
  const pm = PMS.find((p) => paths.has(p.lock)) ?? (paths.has("package.json") ? PMS[PMS.length - 1] : undefined);
  if (pm) guide.install = { command: pm.install, path: (paths.has(pm.lock) ? pm.lock : "package.json") as RepoPath };
  else {
    const py = PY.find((p) => paths.has(p.lock));
    if (py) guide.install = { command: py.install, path: py.lock as RepoPath };
  }
  const pkgRun = scripts.filter((s) => s.path.endsWith("package.json") && !s.path.includes("/"));
  const pick = RUN_NAMES.map((n) => pkgRun.find((s) => s.name === n)).find((s) => s !== undefined) ?? pkgRun.find((s) => s.purpose === "run");
  if (pick && pm) guide.run = { command: pm.run(pick.name), path: pick.path, line: pick.line as LineNo, raw: pick.command };
  else {
    const make = scripts.find((s) => /(^|\/)(Makefile|GNUmakefile|justfile)$/.test(s.path) && s.purpose === "run" && !s.path.includes("/"));
    if (make)
      guide.run = {
        command: `${make.path.endsWith("justfile") ? "just" : "make"} ${make.name}`,
        path: make.path,
        line: make.line as LineNo,
        raw: make.command,
      };
    else if (paths.has("go.mod")) {
      const main = goMain(facts, readme, (await d.read("go.mod" as RepoPath)) ?? "");
      if (main) {
        const dir = main.path.includes("/") ? `./${main.path.slice(0, main.path.lastIndexOf("/"))}` : ".";
        guide.run = { command: `go run ${dir}`, path: main.path, line: main.line as LineNo };
        mainPath = main.path;
      }
    } else if (paths.has("Cargo.toml")) guide.run = { command: "cargo run", path: "Cargo.toml" as RepoPath, line: 1 as LineNo };
  }
  for (const doc of ["README.md", "CONTRIBUTING.md", "docs/README.md", "README"]) {
    if (!paths.has(doc)) continue;
    const text = await d.read(doc as RepoPath);
    const u = text ? localhostUrl(text) : null;
    if (u) {
      guide.url = { url: u.url, path: doc as RepoPath, line: u.line };
      break;
    }
  }
  const fw = frameworkEntry(paths, depNames);
  if (fw) guide.framework = fw;

  // ---- reading order
  const order: NonNullable<StaticGuide["reading"]> = [];
  const used = new Set<string>();
  const src = new Map(files.filter((f) => f.class === "source" && f.excluded === undefined).map((f) => [f.path, f] as const));
  const rank = new Map(d.indexer.graph("file").nodes.map((n) => [n.id, n.rank]));
  const mainOf = (path: RepoPath, kinds: ReadonlySet<string>): SymbolEntry | null => {
    const syms = d.indexer.symbols(path).filter((s) => kinds.has(s.kind) && !s.parent);
    const exported = syms.filter((s) => s.exported);
    const pool = exported.length > 0 ? exported : syms;
    return [...pool].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0] ?? null;
  };
  const add = (role: "entry" | "types" | "hub" | "core", path: RepoPath, syms: SymbolEntry[]) => {
    if (used.has(path)) return;
    used.add(path);
    const first = syms[0];
    order.push({
      role,
      path,
      line: (first?.start ?? 1) as LineNo,
      // one symbol: its whole range; several: each is named with its own line
      ...(first && syms.length === 1 ? { end: first.end as LineNo } : {}),
      symbols: syms.slice(0, 4).map((s) => ({ name: s.name, line: s.start })),
    });
  };
  // 1. entry: the framework page, else the best-ranked entry fact
  // the program file of an entry: a web page's module script (`entry.web@1` labels it), else the fact's own file
  const programOf = (f: EntryFact): string => (f.entry === "main" && src.has(f.label) ? f.label : f.path);
  const entryFacts = facts
    .filter(
      (f): f is EntryFact =>
        f.kind === "entry" && f.entry !== "test_main" && f.entry !== "script" && f.entry !== "dockerfile" && f.scope !== "example" && src.has(programOf(f)),
    )
    .sort((a, b) => (rank.get(programOf(b)) ?? 0) - (rank.get(programOf(a)) ?? 0) || (programOf(a) < programOf(b) ? -1 : 1));
  const first = entryFacts[0];
  const entry = fw?.path ?? mainPath ?? (first ? programOf(first) : undefined);
  if (entry) {
    const syms = d.indexer.symbols(entry as RepoPath);
    // the program's own entry (`main`, a page's default export) before the file's largest function
    const s =
      syms.find((x) => x.name === "main" && !x.parent) ??
      syms.find((x) => x.exported && /^(default|Page|Home|App)$/.test(x.name)) ??
      mainOf(entry as RepoPath, CODE_KINDS);
    add("entry", entry as RepoPath, s ? [s] : []);
  }
  // 2. base types: the types with the most dependents across the repo (files depended on by most modules)
  const fanIn = (p: string) => d.indexer.dependents(p as RepoPath).length;
  const typed = [...src.keys()]
    .map((p) => ({ p, types: d.indexer.symbols(p as RepoPath).filter((s) => TYPE_KINDS.has(s.kind) && s.exported && !s.parent), fan: fanIn(p) }))
    .filter((x) => x.types.length > 0 && !used.has(x.p))
    .sort((a, b) => b.fan - a.fan || b.types.length - a.types.length || (a.p < b.p ? -1 : 1))[0];
  // the larger declarations first (the document model, not the small key unions)
  if (typed && typed.fan > 0)
    add(
      "types",
      typed.p as RepoPath,
      [...typed.types]
        .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
        .slice(0, 4)
        .sort((a, b) => a.start - b.start),
    );
  // 3. hub: the file that connects the most — used by others AND using many (fan-in × fan-out); a dictionary everyone
  //    imports (fan-out 0) or a leaf script (fan-in 0) is not where the program comes together
  const fanOut = (p: string) => new Set(d.indexer.imports(p as RepoPath).flatMap((i) => i.to)).size;
  const hub = [...src.keys()]
    .filter((p) => !used.has(p))
    .map((p) => {
      const i = fanIn(p);
      const o = fanOut(p);
      return { p, score: (i + 1) * o + i, r: rank.get(p) ?? 0 };
    })
    .sort((a, b) => b.score - a.score || b.r - a.r || (a.p < b.p ? -1 : 1))[0]?.p;
  if (hub) {
    const s = mainOf(hub as RepoPath, CODE_KINDS);
    add("hub", hub as RepoPath, s ? [s] : []);
  }
  // 4. feature core: the largest exported function of the highest-ranked module not yet visited
  const mods = d.indexer
    .modules()
    .filter((m) => m.children.length === 0 && !m.paths.every((p) => used.has(p)))
    .sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1));
  const entryFiles = new Set(facts.filter((f): f is EntryFact => f.kind === "entry").map((f) => f.path as string));
  for (const m of mods) {
    const cand = m.paths
      .filter((p) => !used.has(p) && src.has(p) && !entryFiles.has(p) && !/(^|\/)main\.\w+$/.test(p))
      .map((p) => ({ p, s: mainOf(p, new Set(["function", "method"])) }))
      .filter((x): x is { p: RepoPath; s: SymbolEntry } => x.s !== null)
      .sort((a, b) => b.s.end - b.s.start - (a.s.end - a.s.start))[0];
    if (cand) {
      add("core", cand.p, [cand.s]);
      break;
    }
  }
  if (order.length > 0) guide.reading = order;
  await deepGuide(d, guide, rootTestOf(scripts, pm), paths.has("go.mod"));
  return guide;
}

export type { FileEntry };

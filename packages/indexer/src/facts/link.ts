/**
 * Main-thread linking of fact candidates (spec §5.1): guards on the evidence, cross-file composition (click groups ↔
 * pyproject scripts, Rust bin roots), handler stamping, scope assignment (IDX-D12) and de-duplication.
 */
import type { CliFact, EntryFact, Fact, FactBase, GitOid, RepoPath, RouteFact } from "@mitori/core";
import type { FactCandidate, FactLinkContext, FileScope } from "../contract.ts";
import type { ProjectIndex } from "../resolve/context.ts";
import { baseOf, dirOf, joinPath } from "../resolve/files.ts";
import { pythonMainLabel } from "../resolve/python.ts";
import { parseToml, tomlGet, tomlStr } from "../resolve/toml.ts";

/** The richer context `facts/stage.ts` passes; detectors degrade gracefully with a bare FactLinkContext. */
export interface LinkEnv extends FactLinkContext {
  /** Blob of a path (FactBase.blob). */
  blobOf(path: RepoPath): GitOid;
  /** Project configs (Python roots, Rust crates, Cargo workspaces, wrangler D1). */
  readonly index?: ProjectIndex;
}

const isEnv = (ctx: FactLinkContext): ctx is LinkEnv => typeof (ctx as Partial<LinkEnv>).blobOf === "function";

/** Kinds that may only be shown from `main` files (IDX-D12): tooling/example files are kept as `scope: "example"`. */
const MAIN_ONLY = new Set(["route", "cli", "env"]);
const TODO_CAP = 2_000;

function base(c: FactCandidate, ctx: FactLinkContext): Omit<FactBase, "kind"> | null {
  // test files contribute test names only — and `TestMain` (entry.testmain@1 can only match a test file)
  if (c.scope === "test" && c.kind !== "test" && c.detector !== "entry.testmain@1") return null;
  const example = c.scope === "example" || (c.scope === "tooling" && MAIN_ONLY.has(c.kind));
  return {
    detector: c.detector,
    path: c.path,
    line: c.line,
    blob: isEnv(ctx) ? ctx.blobOf(c.path) : "",
    ...(example ? { scope: "example" as const } : {}),
  };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Link the candidates of detector `id` (all snapshot candidates are passed; each linker filters its own). */
export function linkByDetector(id: string, all: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const mine = all.filter((c) => c.detector === id);
  if (mine.length === 0) return [];
  switch (id) {
    case "route.nethttp@1":
      return routes(
        mine.filter(
          (c) =>
            c.evidence.includes("import:net/http") &&
            (!c.evidence.includes("import:github.com/gorilla/mux") || c.evidence.some((e) => e === "recv:http" || e === "bind:http.NewServeMux")),
        ),
        ctx,
      );
    case "route.express@1":
      // undetermined receivers (`app`, `router`, `api` without an in-file binding) need express in the manifest
      return routes(
        mine.filter((c) => c.evidence.includes("import:express") || c.evidence.some((e) => e.startsWith("bind:")) || ctx.manifestDeps(c.path).has("express")),
        ctx,
      );
    case "route.hono@1":
    case "route.fastapi@1":
    case "route.flask@1":
      return routes(mine, ctx);
    case "cli.registry@1":
      return registry(mine, ctx);
    case "cli.click@1":
      return click(mine, all, ctx);
    case "cli.clap@1":
      return clap(mine, ctx);
    case "cli.cobra@1":
    case "cli.commander@1":
      return clis(mine, ctx);
    case "entry.rust@1":
      return rustEntries(mine, ctx);
    case "entry.go@1": {
      // a build-ignored generator main next to the directory's real main is its own `go run <file>` entry
      const real = new Set(mine.filter((c) => c.data.ignored !== true).map((c) => str(c.data.label)));
      return entries(
        mine.map((c) => (c.data.ignored === true && real.has(str(c.data.label)) ? { ...c, data: { ...c.data, label: c.path } } : c)),
        ctx,
      );
    }
    case "entry.python@1":
      return entries(
        mine.map((c) =>
          c.data.label === "__main__" && isEnv(ctx) && ctx.index ? { ...c, data: { ...c.data, label: pythonMainLabel(c.path, ctx.index) } } : c,
        ),
        ctx,
      );
    case "todo.comment@1":
      return simple([...mine].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)).slice(0, TODO_CAP), ctx);
    case "dep.cargo@1":
      return simple(
        mine.map((c) => (c.data.version === "workspace" ? { ...c, data: { ...c.data, version: cargoWorkspaceVersion(c, ctx) } } : c)),
        ctx,
      );
    case "schema.sql@1":
      return simple(
        mine.map((c) => (isD1(c.path, ctx) ? { ...c, data: { ...c.data, source: "d1" } } : c)),
        ctx,
      );
    default:
      return id.startsWith("entry.") ? entries(mine, ctx) : simple(mine, ctx);
  }
}

/** Kinds whose candidate data already has the final field names. */
function simple(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const out: Fact[] = [];
  for (const c of cands) {
    const b = base(c, ctx);
    if (!b) continue;
    const d = c.data;
    switch (c.kind) {
      case "env":
        out.push({ ...b, kind: "env", name: str(d.name), hasDefault: d.hasDefault === true });
        break;
      case "script":
        out.push({ ...b, kind: "script", name: str(d.name), command: str(d.command), purpose: str(d.purpose, "other") as "other" });
        break;
      case "dependency":
        out.push({ ...b, kind: "dependency", ecosystem: str(d.ecosystem, "other") as "npm", name: str(d.name), version: str(d.version), dev: d.dev === true });
        break;
      case "schema":
        out.push({ ...b, kind: "schema", entity: str(d.entity), source: str(d.source, "sql"), fields: strs(d.fields) });
        break;
      case "existing_doc":
        out.push({ ...b, kind: "existing_doc", role: str(d.role, "other") as "other", title: str(d.title) });
        break;
      case "todo":
        out.push({ ...b, kind: "todo", marker: str(d.marker, "TODO") as "TODO", text: str(d.text) });
        break;
      case "test":
        out.push({ ...b, kind: "test", name: str(d.name) });
        break;
      default:
        break;
    }
  }
  return dedupe(out);
}

/** HTTP method token (`methods=[…]` / `.on("…")` literals are arbitrary strings; they reach tables and the pack). */
const METHOD_RE = /^[A-Z][A-Z0-9_-]{0,23}$/;

function routes(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const out: RouteFact[] = [];
  for (const c of cands) {
    const b = base(c, ctx);
    if (!b) continue;
    const method = str(c.data.method, "ANY").toUpperCase();
    if (!METHOD_RE.test(method)) continue;
    const handlerName = str(c.data.handler);
    const handler = handlerName === "" ? null : ctx.symbolAt(c.path, handlerName);
    out.push({
      ...b,
      kind: "route",
      method,
      pattern: str(c.data.pattern),
      framework: str(c.data.framework),
      ...(handler ? { handler } : {}),
      ...(c.data.dynamic === true ? { dynamic: true } : {}),
    });
  }
  return dedupe(out);
}

function clis(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const out: CliFact[] = [];
  for (const c of cands) {
    const b = base(c, ctx);
    const command = str(c.data.command).trim();
    if (b && command !== "") out.push({ ...b, kind: "cli", command, flags: [...new Set(strs(c.data.flags))], framework: str(c.data.framework) });
  }
  return dedupe(out);
}

/** `{name: "x", handler: fn}` tables: ≥ 3 entries in the same table (spec §5.2 [仮]). */
function registry(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const sizes = new Map<string, number>();
  for (const c of cands) sizes.set(`${c.path}\0${str(c.data.table)}`, (sizes.get(`${c.path}\0${str(c.data.table)}`) ?? 0) + 1);
  return clis(
    cands.filter((c) => (sizes.get(`${c.path}\0${str(c.data.table)}`) ?? 0) >= 3),
    ctx,
  );
}

/** click: compose group chains; the root group takes the `[project.scripts]` name that points at it. */
function click(cands: readonly FactCandidate[], all: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const scripts = all.filter((c) => c.detector === "entry.python@1" && c.data.entry === "script");
  const byFn = new Map<string, FactCandidate>();
  for (const c of cands) byFn.set(`${c.path}\0${str(c.data.fn)}`, c);
  const progOf = (c: FactCandidate): string => {
    const modPath = c.path.replace(/\.py$/, "").replace(/\/__init__$/, "");
    for (const s of scripts) {
      const [mod, fn] = str(s.data.target).split(":");
      if (fn === str(c.data.fn) && mod !== undefined && (modPath === mod.replaceAll(".", "/") || modPath.endsWith(`/${mod.replaceAll(".", "/")}`)))
        return str(s.data.label);
    }
    return str(c.data.name);
  };
  const out: FactCandidate[] = [];
  for (const c of cands) {
    if (c.data.group === true && strs(c.data.flags).length === 0) continue;
    const chain: string[] = [];
    let cur: FactCandidate | undefined = c;
    for (let hops = 0; cur && hops < 8; hops++) {
      const parent = str(cur.data.parent);
      const up: FactCandidate | undefined = parent === "" ? undefined : byFn.get(`${cur.path}\0${parent}`);
      chain.unshift(up === undefined ? progOf(cur) : str(cur.data.name));
      cur = up;
    }
    out.push({ ...c, data: { ...c.data, command: chain.join(" ") } });
  }
  return clis(out, ctx);
}

/** clap without `#[command(name)]`: prefix the Cargo package name. */
function clap(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  return clis(
    cands.map((c) => {
      if (str(c.data.prog) !== "" || !isEnv(ctx) || !ctx.index) return c;
      const cargo = ctx.index.cargoFor(dirOf(c.path));
      const pkg = cargo ? tomlStr(tomlGet(cargo.doc, "package", "name")) : undefined;
      return pkg ? { ...c, data: { ...c.data, command: `${pkg} ${str(c.data.command)}`.trim() } } : c;
    }),
    ctx,
  );
}

function entries(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const out: EntryFact[] = [];
  for (const c of cands) {
    const b = base(c, ctx);
    if (b) out.push({ ...b, kind: "entry", entry: str(c.data.entry, "main") as "main", label: str(c.data.label) });
  }
  return dedupe(out);
}

/** `fn main` counts only in a bin root; each bin root yields `main:<path>` + `bin:<name>` (CR m0-12). */
function rustEntries(cands: readonly FactCandidate[], ctx: FactLinkContext): Fact[] {
  const index = isEnv(ctx) ? ctx.index : undefined;
  if (!index) return [];
  const out: FactCandidate[] = [];
  for (const c of cands) {
    const unit = index.rustUnits.find((u) => u.kind === "bin" && u.root === c.path);
    if (!unit) continue;
    out.push(c);
    out.push({ ...c, data: { entry: "bin", label: rustBinName(c.path, unit.dir, index) } });
  }
  return entries(out, ctx);
}

function rustBinName(root: RepoPath, dir: RepoPath, index: ProjectIndex): string {
  const cargo = index.cargoFor(dir);
  const bins = cargo ? tomlGet(cargo.doc, "bin") : undefined;
  for (const b of Array.isArray(bins) ? bins : []) {
    const p = tomlStr(tomlGet(b, "path"));
    const n = tomlStr(tomlGet(b, "name"));
    if (n && p && joinPath(dir, p) === root) return n;
  }
  const rel = dir === "" ? root : root.slice(dir.length + 1);
  const m = /^src\/bin\/([^/]+?)(?:\.rs|\/main\.rs)$/.exec(rel);
  if (m) return m[1] as string;
  return (cargo ? tomlStr(tomlGet(cargo.doc, "package", "name")) : undefined) ?? baseOf(dir);
}

function cargoWorkspaceVersion(c: FactCandidate, ctx: FactLinkContext): string {
  if (!isEnv(ctx) || !ctx.index) return "workspace";
  for (let d = dirOf(c.path); ; d = dirOf(d)) {
    const text = ctx.index.texts.get(d === "" ? "Cargo.toml" : `${d}/Cargo.toml`);
    if (text !== undefined && d !== dirOf(c.path)) {
      const ws = tomlGet(parseToml(text).root, "workspace", "dependencies", str(c.data.name));
      const v = typeof ws === "string" ? ws : tomlStr(tomlGet(ws, "version"));
      if (v !== undefined) return v;
    }
    if (d === "") return "workspace";
  }
}

/** `.sql` under a wrangler D1 `migrations_dir` (default `migrations`) → source `d1`. */
function isD1(path: RepoPath, ctx: FactLinkContext): boolean {
  if (!isEnv(ctx) || !ctx.index) return false;
  for (const [p, text] of ctx.index.texts) {
    if (!/(^|\/)wrangler\.(toml|jsonc?)$/.test(p) || !text.includes("d1_databases")) continue;
    const dir = dirOf(p);
    const mig = /migrations_dir"?\s*[=:]\s*"([^"]+)"/.exec(text)?.[1] ?? "migrations";
    const root = joinPath(dir, mig);
    if (root !== null && path.startsWith(`${root}/`)) return true;
  }
  return false;
}

/** Drop exact duplicates (same kind, path, line and payload). */
function dedupe<T extends Fact>(facts: T[]): T[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = JSON.stringify(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** File scope → the `Fact.scope` the main tables use. */
export function factScopeOf(scope: FileScope): "main" | "example" {
  return scope === "example" ? "example" : "main";
}

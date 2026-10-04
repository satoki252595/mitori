/**
 * S2 link stage (spec §5.1): every file's candidates → facts (all scopes; main tables filter on `scopes`),
 * test mappings, configuration entries. Entry point for the facade: `linkFacts(input, resolved)` (≤ 50 ms target).
 *
 * Incremental (CR m1-28): a file's linked facts depend on its own candidates, blob and symbols plus a small linking
 * context — the manifests (`manifestDeps`, click `[project.scripts]`), the resolver configs behind the project index
 * (Python roots, Cargo units, …), the set of paths, and for Go the other files of its package directory (handler
 * stamping, generator mains). `StageFile` objects are immutable and the later stages reuse the object of every path
 * that did not change, so each file's linked facts are memoized on its object together with the context they were
 * linked under; one save relinks one file. Cross-file steps (the TODO cap, test mapping, configs, ordering) run on
 * the memoized pieces, and every derived object (subject-stamped test facts, sort keys) is memoized too, so an unchanged
 * fact is the same object from one result to the next.
 */
import type { ConfigFact, Fact, GitOid, RepoPath, SecretScanner, SymbolKey, TestFact } from "@mitori/core";
import type { ConfigEntry, FactCandidate, FileScope, TestMapping } from "../contract.ts";
import { dirOf, isResolverConfig, type StageFile, type StageInput } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import { configToolOf } from "./config-tool.ts";
import { type LinkEnv, linkByDetector, TODO_CAP } from "./link.ts";
import { FACT_DETECTORS } from "./registry.ts";
import { mapTests, testSubject } from "./tests-map.ts";

export interface FactsResult {
  /** Linked facts in canonical order (kind, path, line, payload). */
  facts: Fact[];
  /** File scope of each fact's file, parallel to `facts` (main tables = `main`, IDX-D12). */
  scopes: FileScope[];
  tests: TestMapping[];
  configs: ConfigEntry[];
}

const TEST_DETECTOR: Record<string, string> = { go: "test.go@1", python: "test.python@1", rust: "test.rust@1" };
const TODO_DETECTOR = "todo.comment@1";
const CLICK_DETECTOR = "cli.click@1";
const GO_ENTRY = "entry.go@1";

/** A file's candidates; `StageFile.tests` become test candidates when the Worker did not emit them. */
function candidatesOf(f: StageFile): readonly FactCandidate[] {
  if (f.tests.length === 0 || f.facts.some((c) => c.kind === "test")) return f.facts;
  const detector = TEST_DETECTOR[f.lang] ?? "test.js@1";
  const out = [...f.facts];
  for (const t of f.tests) out.push({ detector, kind: "test", path: f.path, line: t.line, data: { name: t.name }, evidence: [], scope: f.scope });
  return out;
}

/** All candidates of the snapshot. */
export function collectCandidates(files: readonly StageFile[]): FactCandidate[] {
  const out: FactCandidate[] = [];
  for (const f of files) out.push(...candidatesOf(f));
  return out;
}

export interface LinkOptions {
  /**
   * `deps.secrets` when `security.secretScan` (spec §5.1: values are never taken in — script arguments, dependency
   * URLs, TODO text, doc titles … are redacted in place with `«redacted:secret»`).
   */
  secrets?: SecretScanner;
}

/** Linked facts of one file under one linking context. */
interface FileLink {
  ctx: string;
  /** Facts of every detector except TODOs, redacted, without test subjects. */
  facts: Fact[];
  /** The file's TODO candidates in line order → their fact (null when linking dropped it); the snapshot-wide cap counts candidates. */
  todos: (Fact | null)[];
}

const fileLinks = new WeakMap<StageFile, FileLink>();
/** Unredacted test names (subject matching runs on the name as written). */
const rawNames = new WeakMap<Fact, string>();
/** Subject symbol per base test fact, for the subject files (by object id) it was matched against. */
const subjectMemo = new WeakMap<Fact, { key: string; subject: SymbolKey | undefined }>();
/** `{ …fact, subject }` per base test fact. */
const stamped = new WeakMap<Fact, { subject: SymbolKey; fact: TestFact }>();
/** Canonical sort key per fact object. */
const sortKeys = new WeakMap<Fact, string>();
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
};

const WRANGLER = /(^|\/)wrangler\.(toml|jsonc?)$/;

/** Files whose content reaches other files' linking (manifests, resolver configs, deploy configs). */
function isContextFile(f: StageFile): boolean {
  return isResolverConfig(f.path) || WRANGLER.test(f.path) || f.facts.some((c) => c.kind === "dependency");
}

/** 32-bit FNV-1a over every path: the project index depends on which paths exist (Rust bin roots, Go packages, …). */
function pathsSignature(files: readonly StageFile[]): number {
  let h = 0x811c9dc5;
  for (const f of files) {
    const p = f.path;
    for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x2f, 0x01000193);
  }
  return h >>> 0;
}

export function linkFacts(input: StageInput, resolved: ResolveResult, opts: LinkOptions = {}): FactsResult {
  const files = resolved.index.files;
  const contextIds: number[] = [];
  const goDirs = new Map<string, number[]>();
  for (const f of input.files) {
    if (isContextFile(f)) contextIds.push(idOf(f));
    if (f.lang === "go") {
      const d = dirOf(f.path);
      const list = goDirs.get(d);
      if (list) list.push(idOf(f));
      else goDirs.set(d, [idOf(f)]);
    }
  }
  const ctx = `${opts.secrets ? idOf(opts.secrets) : 0}|${pathsSignature(input.files)}|${contextIds.join(",")}`;
  const goKeys = new Map<string, string>();
  for (const [d, list] of goDirs) goKeys.set(d, `${ctx}|${list.join(",")}`);

  let env: LinkEnv | null = null;
  let scripts: FactCandidate[] | null = null;
  const linkEnv = (): LinkEnv => {
    if (env !== null) return env;
    const deps = manifestDeps(input.files);
    env = {
      index: resolved.index,
      blobOf: (p) => files.get(p)?.blob ?? ("" as GitOid),
      scopeOf: (p) => files.get(p)?.scope ?? "main",
      resolve: (p, spec) => resolved.imports.get(p)?.find((i) => i.spec === spec)?.to ?? [],
      manifestDeps: (p) => {
        for (let d = dirOf(p); ; d = dirOf(d)) {
          const s = deps.get(d);
          if (s) return s;
          if (d === "") return new Set();
        }
      },
      symbolAt: (p, name, o) => symbolAt(p, name, resolved, o?.callable === true),
    };
    return env;
  };
  // labels of the real (not build-ignored) Go mains per package directory: a generator main next to one is labelled by path
  const mainsByDir = new Map<string, Set<string>>();
  const goMains = (dir: string): ReadonlySet<string> => {
    let set = mainsByDir.get(dir);
    if (set === undefined) {
      set = new Set();
      for (const p of resolved.index.goFiles(dir))
        for (const c of files.get(p)?.facts ?? [])
          if (c.detector === GO_ENTRY && c.data.ignored !== true && typeof c.data.label === "string") set.add(c.data.label);
      mainsByDir.set(dir, set);
    }
    return set;
  };
  const scriptCandidates = (): FactCandidate[] => {
    scripts ??= input.files.flatMap((f) => (isContextFile(f) ? f.facts.filter((c) => c.detector === "entry.python@1" && c.data.entry === "script") : []));
    return scripts;
  };

  // per file: memoized under the context (+ the Go package directory for Go files)
  const linked: Fact[] = [];
  const todos: (Fact | null)[] = [];
  for (const f of input.files) {
    // Go handlers resolve in the package directory, other languages through the file's imports (gen #4c)
    const key =
      f.lang === "go"
        ? (goKeys.get(dirOf(f.path)) ?? ctx)
        : f.facts.some((c) => c.kind === "route" && c.data.handler !== undefined)
          ? `${ctx}|i${importsKey(f.path, resolved)}`
          : ctx;
    let link = fileLinks.get(f);
    if (link === undefined || link.ctx !== key) {
      link = linkFile(f, key, { env: linkEnv, scripts: scriptCandidates, goMains }, opts.secrets);
      fileLinks.set(f, link);
    }
    for (const x of link.facts) linked.push(x);
    for (const x of link.todos) todos.push(x);
  }
  // the snapshot-wide TODO cap counts candidates in (path, line) order — `input.files` is path-sorted
  for (let i = 0; i < todos.length && i < TODO_CAP; i++) {
    const t = todos[i];
    if (t !== null && t !== undefined) linked.push(t);
  }

  // test names → subject symbols (spec §5.4)
  const cases = new Map<RepoPath, number>();
  for (const f of linked) if (f.kind === "test") cases.set(f.path, (cases.get(f.path) ?? 0) + 1);
  const tests = mapTests(input.files, resolved, cases);
  const subjectsOf = new Map(tests.map((t) => [t.test, t.subjects]));
  for (let i = 0; i < linked.length; i++) {
    const f = linked[i] as Fact;
    if (f.kind !== "test") continue;
    const subjects = subjectsOf.get(f.path) ?? [];
    // the subject depends on the test fact and the symbols of its subject files (memoized on both)
    const skey = subjects.map((p) => (files.get(p) === undefined ? 0 : idOf(files.get(p) as StageFile))).join(",");
    let m = subjectMemo.get(f);
    if (m === undefined || m.key !== skey) {
      m = { key: skey, subject: testSubject(rawNames.get(f) ?? f.name, subjects, files.byPath, f.line) };
      subjectMemo.set(f, m);
    }
    if (m.subject !== undefined) linked[i] = withSubject(f, m.subject);
  }

  const configs: ConfigEntry[] = [];
  for (const f of input.files) {
    if (f.class !== "config") continue;
    const { tool, role } = configToolOf(f.path);
    configs.push({ path: f.path, blob: f.blob, tool, role });
    linked.push(configFact(f, tool, role));
  }

  const keyed = linked.map((f) => ({ f, k: sortKey(f) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const facts: Fact[] = [];
  let prev: string | null = null;
  for (const { f, k } of keyed) {
    if (k === prev) continue;
    prev = k;
    facts.push(f);
  }
  return { facts, scopes: facts.map((f) => files.get(f.path)?.scope ?? "main"), tests, configs };
}

interface LinkContext {
  env(): LinkEnv;
  /** `[project.scripts]` entries of the snapshot (click root commands take their names). */
  scripts(): FactCandidate[];
  /** Labels of the directory's real Go mains. */
  goMains(dir: string): ReadonlySet<string>;
}

/**
 * Every detector over one file's candidates. The two cross-file inputs are folded in first: click also sees the
 * snapshot's `[project.scripts]` entries, and a build-ignored Go main next to its directory's real main is labelled by
 * its path (what `entry.go@1` linking does over the whole directory).
 */
function linkFile(f: StageFile, ctx: string, lc: LinkContext, secrets: SecretScanner | undefined): FileLink {
  const { env, scripts } = lc;
  let cands = candidatesOf(f);
  if (f.lang === "go" && cands.some((c) => c.detector === GO_ENTRY && c.data.ignored === true)) {
    const real = lc.goMains(dirOf(f.path));
    cands = cands.map((c) =>
      c.detector === GO_ENTRY && c.data.ignored === true && typeof c.data.label === "string" && real.has(c.data.label)
        ? { ...c, data: { ...c.data, label: c.path } }
        : c,
    );
  }
  const facts: Fact[] = [];
  const todos: (Fact | null)[] = [];
  if (cands.length > 0) {
    const ids = new Set(cands.map((c) => c.detector));
    for (const d of FACT_DETECTORS) {
      if (!ids.has(d.id) || d.id === TODO_DETECTOR) continue;
      const all = d.id === CLICK_DETECTOR ? [...cands, ...scripts()] : cands;
      for (const x of d.link(all, env())) facts.push(x);
    }
    if (ids.has(TODO_DETECTOR)) {
      const mine = cands.filter((c) => c.detector === TODO_DETECTOR).sort((a, b) => a.line - b.line);
      for (const c of mine) todos.push(linkByDetector(TODO_DETECTOR, [c], env())[0] ?? null);
    }
  }
  if (secrets)
    for (const x of [...facts, ...todos]) {
      if (x === null) continue;
      const name = x.kind === "test" ? x.name : null;
      redactFact(x, secrets);
      if (name !== null && x.kind === "test" && x.name !== name) rawNames.set(x, name);
    }
  return { ctx, facts, todos };
}

function withSubject(f: TestFact, subject: SymbolKey): TestFact {
  const hit = stamped.get(f);
  if (hit !== undefined && hit.subject === subject) return hit.fact;
  const fact: TestFact = { ...f, subject };
  stamped.set(f, { subject, fact });
  const raw = rawNames.get(f);
  if (raw !== undefined) rawNames.set(fact, raw);
  return fact;
}

const configFacts = new WeakMap<StageFile, ConfigFact>();

function configFact(f: StageFile, tool: string, role: ConfigFact["role"]): ConfigFact {
  const hit = configFacts.get(f);
  if (hit !== undefined && hit.tool === tool && hit.role === role) return hit;
  const cf: ConfigFact = { kind: "config", detector: "config.file@1", path: f.path, line: 1, blob: f.blob, tool, role };
  configFacts.set(f, cf);
  return cf;
}

/** Fields that hold detector vocabulary or locations, never text from the file. */
const NOT_SCANNED = new Set([
  "kind",
  "detector",
  "path",
  "blob",
  "scope",
  "line",
  "framework",
  "purpose",
  "ecosystem",
  "entry",
  "role",
  "marker",
  "tool",
  "source",
  "method",
  "hasDefault",
  "dev",
  "dynamic",
  "handler",
  "subject",
  "channel",
]);

/** Redact secrets inside the string fields of a fact (in place; field shapes unchanged). */
function redactFact(f: Fact, secrets: SecretScanner): void {
  const r = f as unknown as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (NOT_SCANNED.has(k)) continue;
    const v = r[k];
    if (typeof v === "string") r[k] = secrets.redact(v).text;
    else if (Array.isArray(v)) r[k] = v.map((x) => (typeof x === "string" ? secrets.redact(x).text : x));
  }
}

/** Canonical order: kind, path, line (zero-padded), then the payload (memoized per fact object; facts are never mutated). */
function sortKey(f: Fact): string {
  let k = sortKeys.get(f);
  if (k === undefined) {
    const { kind, path, line, blob: _b, ...rest } = f;
    k = `${kind}\u0000${path}\u0000${String(line).padStart(8, "0")}\u0000${JSON.stringify(rest)}`;
    sortKeys.set(f, k);
  }
  return k;
}

/** Dependency names declared per manifest directory (from the dep.* candidates). */
function manifestDeps(files: readonly StageFile[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    if (!isContextFile(f)) continue;
    for (const c of f.facts) {
      if (c.kind !== "dependency" || typeof c.data.name !== "string") continue;
      const d = dirOf(c.path);
      let s = out.get(d);
      if (!s) {
        s = new Set();
        out.set(d, s);
      }
      s.add(c.data.name);
    }
  }
  return out;
}

/** Declarations that cannot be a route handler (gen #4c: a wrapped value's arguments include config values and types). */
const NOT_CALLABLE: ReadonlySet<string> = new Set(["module", "namespace", "struct", "interface", "trait", "impl", "enum", "type", "field", "macro", "test"]);

/**
 * Handler stamping: a symbol named `name` in the file, then (Go) in the same package directory, then (other
 * languages) in the files the route file imports — the name first among the imports that bind it, then any import
 * (`import * as ctrl` / a default object); `callable` skips type-like declarations.
 */
function symbolAt(path: RepoPath, name: string, resolved: ResolveResult, callable: boolean): SymbolKey | null {
  const files = resolved.index.files;
  const pick = (f: StageFile | undefined) => {
    const syms = (f?.symbols ?? []).filter((s) => s.name === name && !(callable && NOT_CALLABLE.has(s.kind)));
    return syms.find((s) => s.exported) ?? syms[0];
  };
  const own = pick(files.get(path));
  if (own) return own.key;
  if (path.endsWith(".go")) {
    for (const p of resolved.index.goFiles(dirOf(path))) {
      const s = pick(files.get(p));
      if (s) return s.key;
    }
    return null;
  }
  const imps = resolved.imports.get(path) ?? [];
  for (const pass of [true, false])
    for (const imp of imps) {
      if (imp.names.includes(name) !== pass) continue;
      for (const to of imp.to) {
        const s = pick(files.get(to));
        if (s?.exported) return s.key;
      }
    }
  return null;
}

/** Identity of the files a file imports (its handler stamping reads their symbols; memo key of its linked facts). */
function importsKey(path: RepoPath, resolved: ResolveResult): string {
  const files = resolved.index.files;
  const ids: number[] = [];
  for (const imp of resolved.imports.get(path) ?? [])
    for (const to of imp.to) {
      const f = files.get(to);
      if (f) ids.push(idOf(f));
    }
  return ids.join(",");
}

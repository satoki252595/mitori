/**
 * S2 link stage (spec §5.1): every file's candidates → facts (all scopes; main tables filter on `scopes`),
 * test mappings, configuration entries. Entry point for the facade: `linkFacts(input, resolved)` (≤ 50 ms target).
 */
import type { ConfigFact, Fact, GitOid, RepoPath, SymbolKey } from "@mitori/core";
import type { ConfigEntry, FactCandidate, FileScope, TestMapping } from "../contract.ts";
import { dirOf, type StageFile, type StageInput } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import { configToolOf } from "./config-tool.ts";
import type { LinkEnv } from "./link.ts";
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

/** All candidates of the snapshot; `StageFile.tests` become test candidates when the Worker did not emit them. */
export function collectCandidates(files: readonly StageFile[]): FactCandidate[] {
  const out: FactCandidate[] = [];
  for (const f of files) {
    out.push(...f.facts);
    if (f.tests.length === 0 || f.facts.some((c) => c.kind === "test")) continue;
    const detector = TEST_DETECTOR[f.lang] ?? "test.js@1";
    for (const t of f.tests) out.push({ detector, kind: "test", path: f.path, line: t.line, data: { name: t.name }, evidence: [], scope: f.scope });
  }
  return out;
}

export function linkFacts(input: StageInput, resolved: ResolveResult): FactsResult {
  const files = resolved.index.files;
  const all = collectCandidates(input.files);
  const deps = manifestDeps(all);
  const env: LinkEnv = {
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
    symbolAt: (p, name) => symbolAt(p, name, resolved),
  };
  const linked: Fact[] = [];
  for (const d of FACT_DETECTORS) linked.push(...d.link(all, env));

  // test names → subject symbols (spec §5.4)
  const cases = new Map<RepoPath, number>();
  for (const f of linked) if (f.kind === "test") cases.set(f.path, (cases.get(f.path) ?? 0) + 1);
  const tests = mapTests(input.files, resolved, cases);
  const subjectsOf = new Map(tests.map((t) => [t.test, t.subjects]));
  for (const f of linked) {
    if (f.kind !== "test") continue;
    const subject = testSubject(f.name, subjectsOf.get(f.path) ?? [], files.byPath, f.line);
    if (subject) f.subject = subject;
  }

  const configs: ConfigEntry[] = [];
  for (const f of [...input.files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (f.class !== "config") continue;
    const { tool, role } = configToolOf(f.path);
    configs.push({ path: f.path, blob: f.blob, tool, role });
    const cf: ConfigFact = { kind: "config", detector: "config.file@1", path: f.path, line: 1, blob: f.blob, tool, role };
    linked.push(cf);
  }

  const keyed = linked.map((f) => ({ f, k: factSortKey(f) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const facts: Fact[] = [];
  const seen = new Set<string>();
  for (const { f, k } of keyed) {
    if (seen.has(k)) continue;
    seen.add(k);
    facts.push(f);
  }
  return { facts, scopes: facts.map((f) => files.get(f.path)?.scope ?? "main"), tests, configs };
}

/** Canonical order: kind, path, line (zero-padded), then the payload. */
function factSortKey(f: Fact): string {
  const { kind, path, line, blob: _b, ...rest } = f;
  return `${kind}\u0000${path}\u0000${String(line).padStart(8, "0")}\u0000${JSON.stringify(rest)}`;
}

/** Dependency names declared per manifest directory (from the dep.* candidates). */
function manifestDeps(all: readonly FactCandidate[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const c of all) {
    if (c.kind !== "dependency" || typeof c.data.name !== "string") continue;
    const d = dirOf(c.path);
    let s = out.get(d);
    if (!s) {
      s = new Set();
      out.set(d, s);
    }
    s.add(c.data.name);
  }
  return out;
}

/** Handler stamping: a symbol named `name` in the file, then (Go) in the same package directory. */
function symbolAt(path: RepoPath, name: string, resolved: ResolveResult): SymbolKey | null {
  const files = resolved.index.files;
  const pick = (f: StageFile | undefined) => {
    const syms = (f?.symbols ?? []).filter((s) => s.name === name);
    return syms.find((s) => s.exported) ?? syms[0];
  };
  const own = pick(files.get(path));
  if (own) return own.key;
  if (!path.endsWith(".go")) return null;
  for (const p of resolved.index.goFiles(dirOf(path))) {
    const s = pick(files.get(p));
    if (s) return s.key;
  }
  return null;
}

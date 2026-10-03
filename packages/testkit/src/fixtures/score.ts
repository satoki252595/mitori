// Truth comparison (testing spec §2.4). `scoreIndex` grades an already-built Indexer against hand-written truth:
// the numbers (precision/recall + missing/unexpected keys) are returned, thresholds are the caller's assertions.
import type { Fact, FactKind, RepoPath } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import type { FixtureTruth, TruthFact, TruthScore } from "../contract.ts";

/** Graded fact kinds. `config` facts have no truth (the indexer's own goldens cover them). */
const GATED_KINDS: readonly FactKind[] = ["entry", "route", "cli", "env", "schema", "test", "script", "dependency", "existing_doc", "todo"];

type AttrValue = string | boolean | readonly string[];

/** The `key` and comparable attributes of a fact — the derivation fixtures/truth/README.md documents. */
export function factKey(f: Fact): { key: string; attrs: Record<string, AttrValue> } {
  switch (f.kind) {
    case "route":
      return { key: `${f.method} ${f.pattern}`, attrs: { framework: f.framework } };
    case "env":
      return { key: f.name, attrs: { hasDefault: f.hasDefault } };
    case "cli":
      return { key: f.command, attrs: { flags: f.flags, framework: f.framework } };
    case "schema":
      return { key: `${f.source}:${f.entity}`, attrs: { fields: f.fields } };
    case "entry":
      return { key: `${f.entry}:${f.label}`, attrs: {} };
    case "script":
      return { key: f.name, attrs: { purpose: f.purpose } };
    case "test":
      return { key: f.name, attrs: {} };
    case "dependency":
      return { key: `${f.ecosystem}:${f.name}`, attrs: { dev: f.dev } };
    case "existing_doc":
      return { key: f.role, attrs: { title: f.title } };
    case "todo":
      return { key: f.marker, attrs: {} };
    case "config":
      return { key: f.tool, attrs: { role: f.role } };
  }
}

const same = (a: AttrValue | undefined, b: AttrValue): boolean =>
  Array.isArray(a) && Array.isArray(b) ? [...a].sort().join("\0") === [...b].sort().join("\0") : a === b;

const label = (t: Pick<TruthFact, "kind" | "path" | "key" | "line">): string => `${t.kind} ${t.key} @${t.path}${t.line === undefined ? "" : `:${t.line}`}`;

function ratio(hit: number, total: number): number {
  return total === 0 ? 1 : hit / total;
}

function setScore(category: TruthScore["category"], expected: readonly string[], actual: readonly string[], recallOnly = false): TruthScore {
  const e = new Set(expected);
  const a = new Set(actual);
  const hit = [...e].filter((x) => a.has(x)).length;
  const unexpected = recallOnly ? [] : [...a].filter((x) => !e.has(x));
  return {
    category,
    precision: recallOnly ? 1 : ratio(hit, a.size),
    recall: ratio(hit, e.size),
    missing: [...e].filter((x) => !a.has(x)),
    unexpected,
  };
}

function scoreFiles(indexer: Indexer, truth: FixtureTruth): TruthScore {
  const keyOf = (f: { path: string; class: string; excluded?: string | undefined; lang: string }) => `${f.path} ${f.class} ${f.excluded ?? "-"} ${f.lang}`;
  const known = new Set(truth.files.map((f) => f.path));
  const actual = indexer.files({ includeExcluded: true }).filter((f) => truth.filesExhaustive || known.has(f.path));
  return setScore("files", truth.files.map(keyOf), actual.map(keyOf));
}

function scoreFacts(indexer: Indexer, truth: FixtureTruth): TruthScore[] {
  return GATED_KINDS.map((kind): TruthScore => {
    const pool = indexer
      .facts(kind)
      .filter((f) => !(f.kind === "route" && f.dynamic === true))
      .map((f) => ({ ...factKey(f), path: f.path, line: f.line, kind: f.kind }));
    /**
     * Remove the first actual fact matching `t`. Stretch facts only need path + key (reported, never graded); an
     * entry's path is not compared: the manifest that declares it and the file it runs are both acceptable.
     */
    const take = (t: TruthFact): boolean => {
      const at = pool.findIndex(
        (a) =>
          (t.kind === "entry" || a.path === t.path) &&
          a.key === t.key &&
          (t.stretch || ((t.line === undefined || a.line === t.line) && Object.entries(t.attrs ?? {}).every(([k, v]) => same(a.attrs[k], v)))),
      );
      if (at >= 0) pool.splice(at, 1);
      return at >= 0;
    };
    const expected = truth.facts.filter((f) => f.kind === kind && !f.stretch);
    let hit = 0;
    const missing: string[] = [];
    for (const t of expected) {
      if (take(t)) hit++;
      else missing.push(label(t));
    }
    for (const t of truth.facts) if (t.kind === kind && t.stretch) take(t);
    const forbidden = truth.forbiddenFacts.filter((f) => f.kind === kind);
    const isForbidden = (a: (typeof pool)[number]) =>
      forbidden.some((f) => f.path === a.path && f.key === a.key && (f.line === undefined || f.line === a.line));
    const unexpected = pool.map((a) => `${isForbidden(a) ? "!" : ""}${label(a)}`);
    return { category: kind, precision: ratio(hit, hit + pool.length), recall: ratio(hit, expected.length), missing, unexpected };
  });
}

function scoreSymbols(indexer: Indexer, truth: FixtureTruth): TruthScore {
  const missing: string[] = [];
  let hit = 0;
  for (const s of truth.symbols) {
    const path = s.key.slice(0, s.key.indexOf("#"));
    const got = indexer.symbols(path).find((x) => x.key === s.key);
    if (got && got.kind === s.kind && got.start === s.start && got.end === s.end && got.exported === s.exported) hit++;
    else missing.push(`${s.key} ${s.kind} ${s.start}-${s.end}${got ? ` (got ${got.kind} ${got.start}-${got.end} exported=${got.exported})` : ""}`);
  }
  return { category: "symbols", precision: 1, recall: ratio(hit, truth.symbols.length), missing, unexpected: [] };
}

function scoreImports(indexer: Indexer, truth: FixtureTruth): TruthScore {
  const actual: string[] = [];
  for (const f of indexer.files()) for (const imp of indexer.imports(f.path)) for (const to of imp.to) actual.push(`${imp.from} -> ${to}`);
  return setScore(
    "imports",
    truth.imports.map((e) => `${e.from} -> ${e.to}`),
    actual,
  );
}

const fileOf = (key: string): RepoPath => key.slice(0, key.indexOf("#"));

function scoreCalls(indexer: Indexer, truth: FixtureTruth): TruthScore {
  const expected = [...new Set(truth.calls.map((c) => `${fileOf(c.from)} -> ${fileOf(c.to)}`))].filter((p) => p.split(" -> ")[0] !== p.split(" -> ")[1]);
  const callers = new Set(truth.calls.map((c) => fileOf(c.from)));
  const graph = indexer.graph("file");
  const pathOf = new Map(graph.nodes.map((n) => [n.id, n.path ?? n.id]));
  const actual = graph.edges
    .filter((e) => e.kind === "ref" || e.kind === "call")
    .map((e) => `${pathOf.get(e.from) ?? e.from} -> ${pathOf.get(e.to) ?? e.to}`)
    .filter((p) => callers.has(p.split(" -> ")[0] ?? ""));
  return setScore("calls", expected, actual);
}

function scoreModules(indexer: Indexer, truth: FixtureTruth): TruthScore {
  const moduleOf = (p: RepoPath) => indexer.moduleOf(p);
  const missing: string[] = [];
  let total = 0;
  for (const group of truth.modules.together) {
    for (const p of group.slice(1)) {
      total++;
      const a = moduleOf(group[0] as RepoPath);
      if (a === null || a !== moduleOf(p)) missing.push(`together: ${group[0]} ~ ${p}`);
    }
  }
  for (const [x, y] of truth.modules.apart) {
    total++;
    const a = moduleOf(x);
    if (a !== null && a === moduleOf(y)) missing.push(`apart: ${x} | ${y}`);
  }
  const ok = ratio(total - missing.length, total);
  return { category: "modules", precision: ok, recall: ok, missing, unexpected: [] };
}

/** Grade `indexer` (scanned on demand) against `truth`: one {@link TruthScore} per category. */
export async function score(indexer: Indexer, truth: FixtureTruth): Promise<TruthScore[]> {
  if (indexer.snapshot() === null) await indexer.scan();
  return [
    scoreFiles(indexer, truth),
    ...scoreFacts(indexer, truth),
    scoreSymbols(indexer, truth),
    scoreImports(indexer, truth),
    scoreCalls(indexer, truth),
    scoreModules(indexer, truth),
  ];
}

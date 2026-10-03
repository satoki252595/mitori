import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Fact, FileEntry, SymbolEntry } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import type { FixtureName, FixtureTruth, TruthFact } from "../contract.ts";
import { factKey, score } from "./score.ts";
import { REPO_ROOT } from "./spec.ts";
import { readTruth } from "./truth.ts";

/** An Indexer double that reports exactly what a truth file says (so a perfect run scores 1.0 everywhere). */
function indexerFrom(truth: FixtureTruth, mutate: (facts: Fact[]) => Fact[] = (f) => f): Indexer {
  const toFact = (t: TruthFact): Fact => {
    const base = { path: t.path, line: t.line ?? 1, blob: "0".repeat(40), detector: "truth@0" };
    const a = (t.attrs ?? {}) as Record<string, string | boolean | string[]>;
    const cut = t.key.indexOf(t.kind === "route" ? " " : ":");
    const head = t.key.slice(0, cut);
    const tail = t.key.slice(cut + 1);
    switch (t.kind) {
      case "route":
        return { ...base, kind: "route", method: head, pattern: tail, framework: a.framework as string };
      case "env":
        return { ...base, kind: "env", name: t.key, hasDefault: a.hasDefault as boolean };
      case "cli":
        return { ...base, kind: "cli", command: t.key, flags: a.flags as string[], framework: a.framework as string };
      case "schema":
        return { ...base, kind: "schema", source: head, entity: tail, fields: a.fields as string[] };
      case "entry":
        return { ...base, kind: "entry", entry: head as "main", label: tail };
      case "script":
        return { ...base, kind: "script", name: t.key, command: "", purpose: a.purpose as "run" };
      case "test":
        return { ...base, kind: "test", name: t.key };
      case "dependency":
        return { ...base, kind: "dependency", ecosystem: head as "npm", name: tail, version: "", dev: a.dev as boolean };
      case "existing_doc":
        return { ...base, kind: "existing_doc", role: t.key as "readme", title: a.title as string };
      case "todo":
        return { ...base, kind: "todo", marker: t.key as "TODO", text: "" };
      default:
        throw new Error(`no truth for kind ${t.kind}`);
    }
  };
  const facts = mutate(truth.facts.map(toFact));
  const listed = new Set(truth.files.map((f) => f.path));
  // the real indexer lists every file; truth only lists some, so importers get a synthetic entry
  const extra = [...new Set(truth.imports.map((e) => e.from))].filter((p) => !listed.has(p)).map((path) => ({ path, class: "source", lang: "generic" }));
  const files = [...truth.files, ...extra].map((f) => ({ ...f, blob: "", size: 0, lines: 1, loc: 1, tokensEst: 1 }) as FileEntry);
  const symbols = truth.symbols.map((s) => ({ ...s, path: s.key.slice(0, s.key.indexOf("#")) }) as unknown as SymbolEntry);
  // module ids: union the `together` groups; everything else gets its own id
  const mod = new Map<string, string>();
  for (const g of truth.modules.together) for (const p of g) mod.set(p, g[0] as string);
  const fileOf = (k: string) => k.slice(0, k.indexOf("#"));
  return {
    snapshot: () => ({}),
    scan: async () => ({}),
    files: () => files,
    facts: (kind?: string) => facts.filter((f) => !kind || f.kind === kind),
    symbols: (path: string) => symbols.filter((s) => s.path === path),
    imports: (path: string) => truth.imports.filter((e) => e.from === path).map((e) => ({ from: e.from, to: [e.to] })),
    graph: () => ({
      level: "file",
      nodes: [...new Set(truth.calls.flatMap((c) => [fileOf(c.from), fileOf(c.to)]))].map((p) => ({ id: p, label: p, path: p, rank: 0, loc: 0 })),
      edges: truth.calls.map((c) => ({ from: fileOf(c.from), to: fileOf(c.to), kind: "ref", weight: 1 })),
    }),
    moduleOf: (p: string) => mod.get(p) ?? `solo:${p}`,
  } as unknown as Indexer;
}

const NAMES = readdirSync(join(REPO_ROOT, "fixtures/truth"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5) as FixtureName);

describe("scoreIndex (testing spec 2.4)", () => {
  test("factKey derivation per kind", () => {
    const f = { kind: "route", method: "GET", pattern: "/x", framework: "hono", path: "a.ts", line: 1, blob: "", detector: "" } as Fact;
    expect(factKey(f)).toEqual({ key: "GET /x", attrs: { framework: "hono" } });
  });

  for (const name of NAMES) {
    test(`${name}: an indexer that reports exactly the truth scores precision = recall = 1 in every category`, async () => {
      const truth = readTruth(name);
      const scores = await score(indexerFrom(truth), truth);
      for (const s of scores) expect([name, s.category, s.precision, s.recall, s.missing, s.unexpected]).toEqual([name, s.category, 1, 1, [], []]);
    });
  }

  test("a lost fact lowers recall and is named; an extra or forbidden fact lowers precision (forbidden ones get a ! prefix)", async () => {
    const truth = readTruth("ts-small");
    const lostRoute = await score(
      indexerFrom(truth, (facts) => facts.filter((f) => !(f.kind === "route" && f.pattern === "/healthz"))),
      truth,
    );
    const route = lostRoute.find((s) => s.category === "route");
    expect(route?.recall).toBeLessThan(1);
    expect(route?.missing.join()).toContain("GET /healthz");

    const forbidden = truth.forbiddenFacts.find((f) => f.kind === "route");
    if (!forbidden) throw new Error("ts-small truth must keep a forbidden route");
    const [method, pattern] = forbidden.key.split(" ");
    const withTrap = await score(
      indexerFrom(truth, (facts) => [
        ...facts,
        { kind: "route", method, pattern, framework: "hono", path: forbidden.path, line: forbidden.line ?? 1, blob: "", detector: "" } as Fact,
      ]),
      truth,
    );
    const polluted = withTrap.find((s) => s.category === "route");
    expect(polluted?.precision).toBeLessThan(1);
    expect(polluted?.unexpected[0]?.startsWith("!")).toBe(true);
  });

  test("stretch facts are neither required nor counted against precision", async () => {
    const truth = readTruth("ts-small");
    const stretch = truth.facts.filter((f) => f.stretch);
    expect(stretch.length).toBeGreaterThan(0);
    const without = await score(indexerFrom({ ...truth, facts: truth.facts.filter((f) => !f.stretch) }), truth);
    expect(without.find((s) => s.category === "route")?.recall).toBe(1);
    const withStretch = await score(indexerFrom(truth), truth);
    expect(withStretch.find((s) => s.category === "route")?.precision).toBe(1);
  });
});

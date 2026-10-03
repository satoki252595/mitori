import { describe, expect, test } from "bun:test";
import type { ModuleId, ModuleInfo, RepoPath, SymbolEntry } from "@mitori/core";
import type { FlowSeed, GraphData, Indexer } from "@mitori/indexer";
import { derivedSeeds, genFlowSeeds } from "./seeds.ts";

// m3e-canvas in miniature (real run 2026-10-04): a Next.js app, no route / CLI / main fact, so the index has no seed.
// app/page.tsx (imported by nothing) renders Editor, which uses tokens and prompt.
const M_APP = "md_app00001" as ModuleId;
const M_TOK = "md_tok00001" as ModuleId;
const M_PRM = "md_prm00001" as ModuleId;
const mod = (id: ModuleId, paths: string[], rank: number): ModuleInfo => ({ id, children: [], paths, rank }) as unknown as ModuleInfo;
const sym = (path: string, name: string, start: number, end: number, extra: Partial<SymbolEntry> = {}): SymbolEntry =>
  ({ key: `${path}#${name}`, path, name, qualname: name, kind: "function", start, end, exported: true, ...extra }) as SymbolEntry;

const MODULES = [
  mod(M_APP, ["app/page.tsx", "app/Editor.tsx", "app/Editor.test.tsx"], 0.3),
  mod(M_TOK, ["lib/tokens.ts"], 1),
  mod(M_PRM, ["lib/prompt.ts"], 0.6),
];
const SYMBOLS: Record<string, SymbolEntry[]> = {
  "app/page.tsx": [sym("app/page.tsx", "Page", 5, 12)],
  "app/Editor.tsx": [
    sym("app/Editor.tsx", "Editor", 40, 900),
    sym("app/Editor.tsx", "inner", 50, 60, { parent: "app/Editor.tsx#Editor" as SymbolEntry["key"] }),
  ],
  "app/Editor.test.tsx": [sym("app/Editor.test.tsx", "helper", 1, 80)],
  "lib/tokens.ts": [sym("lib/tokens.ts", "makeItem", 10, 30)],
  "lib/prompt.ts": [sym("lib/prompt.ts", "buildPrompt", 100, 200)],
};
const node = (path: string, module: ModuleId, rank: number) => ({ id: path, label: path, path: path as RepoPath, module, rank, loc: 10 });
const FILE_GRAPH: GraphData = {
  level: "file",
  nodes: [
    node("app/page.tsx", M_APP, 0.1),
    node("app/Editor.tsx", M_APP, 0.4),
    node("app/Editor.test.tsx", M_APP, 0.2),
    node("lib/tokens.ts", M_TOK, 1),
    node("lib/prompt.ts", M_PRM, 0.6),
  ],
  edges: [
    { from: "app/page.tsx", to: "app/Editor.tsx", kind: "import", weight: 1 },
    { from: "app/Editor.tsx", to: "lib/tokens.ts", kind: "call", weight: 5 },
    { from: "app/Editor.tsx", to: "lib/prompt.ts", kind: "call", weight: 2 },
    { from: "app/Editor.test.tsx", to: "app/Editor.tsx", kind: "import", weight: 9 },
    { from: "lib/prompt.ts", to: "lib/tokens.ts", kind: "import", weight: 3 },
  ],
};
const MODULE_GRAPH: GraphData = {
  level: "module",
  nodes: [],
  edges: [
    { from: M_APP, to: M_TOK, kind: "import", weight: 6 },
    { from: M_APP, to: M_PRM, kind: "import", weight: 2 },
    { from: M_PRM, to: M_TOK, kind: "import", weight: 3 },
  ],
};

function index(own: FlowSeed[] = []): Pick<Indexer, "flowSeeds" | "modules" | "graph" | "symbols"> {
  return {
    flowSeeds: () => own,
    modules: () => MODULES,
    graph: (level) => (level === "module" ? MODULE_GRAPH : FILE_GRAPH),
    symbols: (p) => SYMBOLS[p] ?? [],
  };
}

describe("GEN-U-070 flow seeds when the index has no entry point (real run 2026-10-04: m3e §3 was never generated)", () => {
  test("seeds start at the root module's never-imported files, at their main exported callable, and walk the strongest edges", () => {
    const seeds = derivedSeeds(index(), 3);
    expect(seeds.map((s) => [s.label, s.files, s.modules])).toEqual([
      ["Page (app/page.tsx)", ["app/page.tsx", "app/Editor.tsx", "lib/tokens.ts"], [M_APP, M_TOK]],
      ["Editor (app/Editor.tsx)", ["app/Editor.tsx", "lib/tokens.ts"], [M_APP, M_TOK]],
    ]);
    expect(seeds[1]).toMatchObject({ k: 2, kind: "entry", path: "app/Editor.tsx", line: 40, handler: "app/Editor.tsx#Editor" });
  });

  test("the index's own seeds win; derived seeds are deterministic and capped", () => {
    const own = [{ k: 1, kind: "cli", label: "x", path: "a.go", line: 1, modules: [M_APP], files: ["a.go"] }] as FlowSeed[];
    expect(genFlowSeeds(index(own))).toBe(own);
    expect(genFlowSeeds(index())).toEqual(derivedSeeds(index(), 3));
    expect(derivedSeeds(index(), 1)).toHaveLength(1);
    expect(derivedSeeds(index(), 0)).toEqual([]);
  });
});

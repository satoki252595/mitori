/**
 * NC-10 §7 key types, 「変更の手引き」 and the large-file region outline — the 0-token builders the static doc and the
 * code view read (`doc-types.ts`, `doc-change.ts`, `doc-regions.ts`).
 */
import { describe, expect, test } from "bun:test";
import type { Fact, FileEntry, GitOid, ModuleId, ModuleInfo, RepoPath, SymbolEntry } from "@mitori/core";
import type { FlowSeed, ModuleDetail, ModuleStats, ResolvedImport } from "@mitori/indexer";
import { changeGuides, HISTORY_WINDOW, recentCommits } from "./doc-change.ts";
import { fileRegions } from "./doc-regions.ts";
import { fieldType, importFanIn, keyTypes } from "./doc-types.ts";

const file = (path: string, lines = 80, cls: FileEntry["class"] = "source", lang = "typescript") => ({ path, lines, class: cls, lang }) as unknown as FileEntry;
const sym = (path: string, name: string, kind: string, start: number, end: number, o: Partial<SymbolEntry> = {}) =>
  ({ key: `${path}#${o.qualname ?? name}`, path, name, qualname: name, kind, start, end, exported: true, signature: "", ...o }) as unknown as SymbolEntry;
const field = (path: string, owner: string, name: string, signature: string, line: number) =>
  sym(path, name, "field", line, line, { parent: `${path}#${owner}` as SymbolEntry["key"], qualname: `${owner}.${name}`, signature, exported: true });
const imp = (from: string, to: string[]): ResolvedImport => ({ spec: to[0] ?? "", line: 1, kind: "static", names: [], from, to }) as ResolvedImport;

describe("NC-10 §7 key types", () => {
  test("field types relate the types (Go / TS / Python shapes); used-by counts importers; a field-less class is a service, not data", () => {
    const files = [
      file("internal/session/session.go", 300, "source", "go"),
      file("internal/server/server.go", 300, "source", "go"),
      file("src/model.ts"),
      file("src/service.ts"),
      file("src/a.ts"),
      file("src/b.ts"),
      file("app/models.py", 80, "source", "python"),
      file("src/model.test.ts", 40, "test"),
    ];
    const S = "internal/session/session.go";
    const syms: Record<string, SymbolEntry[]> = {
      [S]: [
        sym(S, "Session", "struct", 10, 60),
        field(S, "Session", "Files", 'Files []FileEntry `json:"files"`', 11),
        field(S, "Session", "mu", "mu sync.Mutex", 12),
        sym(S, "FileEntry", "struct", 70, 90),
        field(S, "FileEntry", "Comments", "Comments []Comment", 71),
        sym(S, "Comment", "struct", 100, 120),
        field(S, "Comment", "Body", "Body string", 101),
      ],
      "src/model.ts": [
        sym("src/model.ts", "Doc", "interface", 1, 10),
        field("src/model.ts", "Doc", "items", "items: Item[];", 2),
        field("src/model.ts", "Doc", "owner", "owner?: User | null;", 3),
        sym("src/model.ts", "Item", "type", 12, 20),
        field("src/model.ts", "Item", "kind", "kind: Kind;", 13),
        sym("src/model.ts", "Kind", "type", 22, 22),
        sym("src/model.ts", "User", "interface", 24, 30),
        field("src/model.ts", "User", "name", "name: string;", 25),
      ],
      "src/service.ts": [sym("src/service.ts", "Store", "class", 1, 40)],
      "app/models.py": [
        sym("app/models.py", "Book", "class", 1, 10),
        field("app/models.py", "Book", "title", "title: str", 2),
        field("app/models.py", "Book", "author", "author: Author", 3),
      ],
      "src/model.test.ts": [sym("src/model.test.ts", "Fixture", "interface", 1, 5), field("src/model.test.ts", "Fixture", "doc", "doc: Doc;", 2)],
    };
    const imports: Record<string, ResolvedImport[]> = {
      "src/a.ts": [imp("src/a.ts", ["src/model.ts"])],
      "src/b.ts": [imp("src/b.ts", ["src/model.ts", "src/service.ts"])],
      "internal/server/server.go": [imp("internal/server/server.go", [S])],
    };
    const ix = {
      files: () => files,
      symbols: (p: RepoPath) => syms[p] ?? [],
      imports: (p: RepoPath) => imports[p] ?? [],
      moduleOf: (p: RepoPath) => (p.startsWith("internal/") ? ("md_session0" as ModuleId) : null),
    };
    const types = keyTypes(ix);
    const by = new Map(types.map((t) => [t.name, t]));
    expect(by.get("Session")?.refs).toEqual([{ name: "FileEntry", field: "Files" }]);
    expect(by.get("FileEntry")?.refs).toEqual([{ name: "Comment", field: "Comments" }]);
    expect(by.get("Doc")?.refs).toEqual([
      { name: "Item", field: "items" },
      { name: "User", field: "owner" },
    ]);
    expect(by.get("Item")?.refs).toEqual([{ name: "Kind", field: "kind" }]);
    expect(by.get("Doc")?.usedBy).toBe(2);
    expect(by.get("Session")).toMatchObject({ path: S, line: 10, end: 60, fields: 2, module: "md_session0", usedBy: 1 });
    expect(by.has("Kind")).toBe(true); // a field-less alias another key type holds
    expect(by.has("Store")).toBe(false); // a class without fields
    expect(by.has("Fixture")).toBe(false); // test files are not the data model
    expect(by.get("Book")?.refs).toEqual([]); // `Author` is not a known type
    // ranked: used and held first
    expect(types[0]?.name).toBe("Item"); // used by two files and held by Doc
  });

  test("fieldType keeps the type part of a declaration", () => {
    expect(fieldType({ name: "Files", signature: 'Files []FileEntry `json:"files"`' })).toBe("[]FileEntry");
    expect(fieldType({ name: "owner", signature: "owner?: User | null;" })).toBe("User | null;");
    expect(fieldType({ name: "title", signature: 'title: str = "x"' })).toBe("str");
  });

  test("importFanIn counts distinct importing files once each", () => {
    const fan = importFanIn({
      files: () => [file("a.ts"), file("b.ts"), file("c.ts")],
      imports: (p) => (p === "a.ts" ? [imp("a.ts", ["c.ts"]), imp("a.ts", ["c.ts"])] : p === "b.ts" ? [imp("b.ts", ["c.ts", "b.ts"])] : []),
    });
    expect(fan.get("c.ts")).toBe(2);
    expect(fan.get("b.ts")).toBeUndefined();
  });
});

/** A 1,600-line React component file (m3e's Editor.tsx in miniature). */
function componentFile(): { text: string; symbols: SymbolEntry[] } {
  const L: string[] = ['import { useState } from "react";', "export const GAP = 8;", "export const PAD = 4;", "type View = { x: number };", ""];
  const start = L.length + 1;
  L.push("export function Editor() {");
  for (let i = 0; i < 12; i++) L.push(`  const [v${i}, setV${i}] = useState(${i});`);
  L.push("  const box = useRef(null);");
  for (let i = 0; i < 3; i++) L.push("  useEffect(() => {", "    box.current = null;", "  }, []);");
  L.push("  const total = useMemo(() => v0 + v1, [v0, v1]);");
  for (let i = 0; i < 40; i++) {
    L.push(`  const handleClick${i} = useCallback(() => {`);
    for (let j = 0; j < 20; j++) L.push(`    setV${i % 12}((x) => x + ${j});`);
    L.push("  }, []);");
  }
  L.push("  function layout(n: number) {", "    return n * 2;", "  }");
  L.push("  return (", "    <div>");
  while (L.length < 1595) L.push("      <span />");
  L.push("    </div>", "  );", "}");
  const end = L.length;
  L.push("export function helper() {", "  return 1;", "}");
  const symbols = [
    sym("app/Editor.tsx", "GAP", "const", 2, 2),
    sym("app/Editor.tsx", "PAD", "const", 3, 3),
    sym("app/Editor.tsx", "View", "type", 4, 4, { exported: false }),
    sym("app/Editor.tsx", "Editor", "function", start, end),
    sym("app/Editor.tsx", "helper", "function", end + 1, end + 3),
  ];
  return { text: L.join("\n"), symbols };
}

describe("large-file region outline (files over 1,500 lines)", () => {
  test("a big component: top-level runs, then its body — state, effects, derived, handlers, helpers, the JSX — with line ranges", () => {
    const { text, symbols } = componentFile();
    const rs = fileRegions(text, symbols, "tsx");
    const top = rs.filter((r) => r.depth === 0).map((r) => `${r.kind} ${r.start}-${r.end} ${r.names.join(",")}`);
    expect(top).toEqual([
      "constants 2-3 GAP,PAD",
      "types 4-4 View",
      `symbol 6-${symbols[3]?.end} Editor`,
      `functions ${symbols[4]?.start}-${symbols[4]?.end} helper`,
    ]);
    const body = rs.filter((r) => r.depth === 1);
    const kinds = body.map((r) => r.kind);
    expect(kinds[0]).toBe("state");
    expect(kinds).toContain("effects");
    expect(kinds).toContain("handlers");
    expect(kinds[kinds.length - 1]).toBe("render");
    const state = body[0];
    expect(state?.hooks).toMatchObject({ useState: 12 });
    expect(state?.start).toBe(7);
    const handlers = body.find((r) => r.kind === "handlers");
    expect(handlers?.names.slice(0, 2)).toEqual(["handleClick0", "handleClick1"]);
    expect(handlers?.count).toBeGreaterThanOrEqual(40);
    const render = body[body.length - 1];
    expect(render?.end).toBe((symbols[3]?.end as number) - 1);
    // regions are ordered, inside the symbol, and do not overlap
    for (let i = 1; i < body.length; i++) expect((body[i]?.start as number) > (body[i - 1]?.end as number)).toBe(true);
    for (const r of body) expect(r.host).toBe("Editor");
  });

  test("Go: methods (declared outside their type) group by receiver; a short file has no outline", () => {
    const P = "internal/server/server.go";
    const syms: SymbolEntry[] = [sym(P, "Server", "struct", 10, 30)];
    for (let i = 0; i < 30; i++)
      syms.push(sym(P, `handleX${i}`, "method", 40 + i * 50, 80 + i * 50, { qualname: `Server.handleX${i}`, parent: `${P}#Server` as SymbolEntry["key"] }));
    syms.push(sym(P, "writeJSON", "function", 1600, 1610));
    const text = Array.from({ length: 1700 }, (_, i) => `// ${i}`).join("\n");
    const rs = fileRegions(text, syms, "go");
    expect(rs.map((r) => `${r.kind}${r.host ? `(${r.host})` : ""} ${r.start}-${r.end} ${r.count ?? 1}`)).toEqual([
      "types 10-30 1",
      "handlers(Server) 40-1530 30",
      "functions 1600-1610 1",
    ]);
    expect(fileRegions(text.split("\n").slice(0, 900).join("\n"), syms, "go")).toEqual([]);
  });
});

describe("「変更の手引き」", () => {
  const A = "md_aaaaaaaa" as ModuleId;
  const B = "md_bbbbbbbb" as ModuleId;
  const C = "md_cccccccc" as ModuleId;
  const mod = (id: ModuleId, paths: string[]): ModuleInfo => ({ id, slug: id, name: id, children: [], paths, loc: 100, rank: 0.5 }) as unknown as ModuleInfo;
  const modules = [mod(A, ["internal/session/session.go", "internal/session/store.go"]), mod(B, ["internal/server/server.go"]), mod(C, ["cmd/app/main.go"])];
  const files = [
    file("internal/session/session.go", 1800, "source", "go"),
    file("internal/session/store.go", 200, "source", "go"),
    file("internal/session/session_test.go", 300, "test", "go"),
    file("internal/server/server.go", 400, "source", "go"),
    file("cmd/app/main.go", 50, "source", "go"),
    file("go.sum", 300, "config", "generic"),
  ];
  const ix = {
    modules: () => modules,
    files: () => files,
    moduleStats: (id: ModuleId) =>
      ({
        module: id,
        depsIn: id === A ? [{ module: B, weight: 3 }] : id === B ? [{ module: C, weight: 1 }] : [],
        depsOut: id === B ? [{ module: A, weight: 3 }] : id === C ? [{ module: B, weight: 1 }] : [],
      }) as unknown as ModuleStats,
    moduleDetail: (id: ModuleId) =>
      ({ id, dominantDir: id === A ? "internal/session" : ".", tests: id === A ? ["internal/session/session_test.go"] : [] }) as unknown as ModuleDetail,
    facts: (kind?: string) =>
      (kind === "test"
        ? [
            { kind: "test", name: "TestA", path: "internal/session/session_test.go", line: 5 },
            { kind: "test", name: "TestB", path: "internal/session/session_test.go", line: 9 },
          ]
        : kind === "route"
          ? [
              {
                kind: "route",
                method: "POST",
                pattern: "/api/comments",
                path: "internal/server/server.go",
                line: 20,
                handler: "internal/server/server.go#Server.handleComments",
              },
            ]
          : []) as unknown as Fact[],
    flowSeeds: () => [
      { k: 1, kind: "route", label: "POST /api/comments", path: "internal/server/server.go", line: 20, modules: [B, A], files: [] } as unknown as FlowSeed,
    ],
    structure: () => ({ cycles: [] }) as never,
  };
  const c = (sha: string, paths: string[]) => ({ sha: sha as GitOid, paths: paths as RepoPath[] });

  test("dependents, tests with cases and `go test ./dir/...`, entries reaching it, co-change (sweeps and one-offs dropped), risks", () => {
    const history = [
      c("1", ["internal/session/session.go", "internal/server/server.go"]),
      c("2", ["internal/session/store.go", "internal/server/server.go", "go.sum"]),
      c("3", ["internal/session/session.go", "cmd/app/main.go"]),
      c("4", ["internal/session/session_test.go", "go.sum"]),
      c("5", Array.from({ length: 60 }, (_, i) => `x/${i}.go`).concat(["internal/session/session.go"])), // a sweep
      c("6", ["cmd/app/main.go"]),
    ];
    const g = changeGuides(ix, { history, goModule: true });
    const a = g[A];
    expect(a?.dependents).toEqual([{ module: B, weight: 3 }]);
    expect(a?.tests).toEqual([{ path: "internal/session/session_test.go", cases: 2 }]);
    expect(a?.testCommand).toEqual({ command: "go test ./internal/session/..." });
    expect(a?.entries).toEqual([{ label: "POST /api/comments", path: "internal/server/server.go", line: 20 }]);
    // server.go changed with the module twice, go.sum twice, main.go once (below the minimum), the sweep not at all
    expect(a?.coChange).toEqual([
      { path: "go.sum", together: 2 },
      { path: "internal/server/server.go", together: 2 },
    ]);
    expect(a?.commits).toBe(4);
    expect(a?.window).toBe(5);
    expect(a?.risks).toEqual([{ kind: "large_file", path: "internal/session/session.go", lines: 1800 }]);
    expect(g[B]?.risks).toEqual([{ kind: "untested" }]);
    expect(g[B]?.entries.map((e) => e.label)).toEqual(["POST /api/comments"]);
    // without history: null commits (the doc says the history could not be read)
    expect(changeGuides(ix, { history: null })[A]?.commits).toBeNull();
  });

  test("the history is read once per HEAD; a shallow clone (empty log) or no HEAD gives null", async () => {
    let logs = 0;
    let head: GitOid | null = "h1" as GitOid;
    const git = {
      head: async () => head,
      log: async ({ limit }: { limit: number }) => {
        logs++;
        expect(limit).toBe(HISTORY_WINDOW);
        return [{ sha: "s1" as GitOid, paths: ["a.go" as RepoPath] }];
      },
    };
    expect(await recentCommits(git)).toEqual([{ sha: "s1", paths: ["a.go"] }]);
    await recentCommits(git);
    expect(logs).toBe(1);
    head = "h2" as GitOid;
    await recentCommits(git);
    expect(logs).toBe(2);
    head = null;
    expect(await recentCommits(git)).toBeNull();
    expect(await recentCommits({ head: async () => "h" as GitOid, log: async () => [] })).toBeNull();
    expect(await recentCommits({ head: async () => "h" as GitOid, log: async () => Promise.reject(new Error("git died")) })).toBeNull();
  });
});

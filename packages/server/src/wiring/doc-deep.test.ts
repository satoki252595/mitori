/**
 * NC-10 §7 key types, 「変更の手引き」 and the large-file region outline — the 0-token builders the static doc and the
 * code view read (`doc-types.ts`, `doc-change.ts`, `doc-regions.ts`).
 */
import { describe, expect, test } from "bun:test";
import type { Fact, FileEntry, GitOid, ModuleId, ModuleInfo, RepoPath, SymbolEntry } from "@mitori/core";
import { type FileRegion, regionLabel } from "@mitori/doc";
import type { FlowSeed, ModuleDetail, ModuleStats, ResolvedImport } from "@mitori/indexer";
import { changeGuides, HISTORY_WINDOW, recentCommits, testCommandOf } from "./doc-change.ts";
import { fileRegions, findBanners } from "./doc-regions.ts";
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

  test("CR rdoc-5: with the index's users per type, each type has its own count and ranks by it (m3e: `Kind` is no longer buried); callbacks hold nothing", () => {
    // one file declaring every type (m3e's lib/tokens.ts): its importers are the same 33 files for all of them
    const T = "lib/tokens.ts";
    const syms: SymbolEntry[] = [
      sym(T, "Radii", "type", 1, 6),
      ...["tl", "tr", "bl", "br"].map((n, i) => field(T, "Radii", n, `${n}: number;`, 2 + i)),
      sym(T, "Kind", "type", 10, 10),
      sym(T, "Item", "type", 20, 60),
      field(T, "Item", "kind", "kind: Kind;", 21),
      field(T, "Item", "corners", "corners?: Radii;", 22),
      sym(T, "Api", "interface", 70, 80),
      field(T, "Api", "onChange", "onChange: (items: readonly Item[], kind: Kind) => void;", 71),
      field(T, "Api", "hook", "hook func(*Item)", 72),
    ];
    const importers = Array.from({ length: 33 }, (_, i) => `app/f${i}.tsx`);
    const users = new Map([
      [`${T}#Kind`, 21],
      [`${T}#Item`, 30],
      [`${T}#Radii`, 2],
      [`${T}#Api`, 1],
    ]) as unknown as ReadonlyMap<SymbolEntry["key"], number>;
    const ix = {
      files: () => [file(T, 2700), ...importers.map((p) => file(p))],
      symbols: (p: RepoPath) => (p === T ? syms : []),
      imports: (p: RepoPath) => (p === T ? [] : [imp(p, [T])]),
      moduleOf: () => null,
      symbolUsers: (keys: readonly SymbolEntry["key"][]) => {
        expect(keys).toContain(`${T}#Kind`);
        return users;
      },
    };
    const types = keyTypes(ix);
    expect(types.map((t) => `${t.name} ${t.usedBy}`)).toEqual(["Item 30", "Kind 21", "Radii 2", "Api 1"]);
    // the callback field `onChange` / `hook` relates nothing; `Item` holds `Kind` and `Radii`
    expect(types.find((t) => t.name === "Api")?.refs).toEqual([]);
    expect(types.find((t) => t.name === "Item")?.refs).toEqual([
      { name: "Kind", field: "kind" },
      { name: "Radii", field: "corners" },
    ]);
    // without the index's users, the file's importers stand in (every type the same number)
    const { symbolUsers: _u, ...noUsers } = ix;
    expect(new Set(keyTypes(noUsers).map((t) => t.usedBy))).toEqual(new Set([33]));
  });

  test("fieldType keeps the type part of a declaration", () => {
    expect(fieldType({ name: "Files", signature: 'Files []FileEntry `json:"files"`' })).toBe("[]FileEntry");
    expect(fieldType({ name: "owner", signature: "owner?: User | null;" })).toBe("User | null;");
    expect(fieldType({ name: "title", signature: 'title: str = "x"' })).toBe("str");
    // an arrow type keeps its arrow (a default value after it is still dropped)
    expect(fieldType({ name: "onChange", signature: "onChange: (x: Item) => void = noop;" })).toBe("(x: Item) => void");
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

  test("a big class (any language): its members — fields, methods, handlers — are its regions", () => {
    const P = "app/store.py";
    const syms: SymbolEntry[] = [sym(P, "Store", "class", 5, 1590)];
    const child = (name: string, kind: string, start: number, end: number) =>
      sym(P, name, kind, start, end, { parent: `${P}#Store` as SymbolEntry["key"], qualname: `Store.${name}` });
    syms.push(child("items", "field", 6, 6), child("owner", "field", 7, 7));
    for (let i = 0; i < 20; i++) syms.push(child(`load${i}`, "method", 10 + i * 40, 45 + i * 40));
    for (let i = 0; i < 10; i++) syms.push(child(`on_change${i}`, "method", 900 + i * 50, 940 + i * 50));
    const text = Array.from({ length: 1600 }, (_, i) => `# ${i}`).join("\n");
    const body = fileRegions(text, syms, "python").filter((r) => r.depth === 1);
    expect(body.map((r) => `${r.kind} ${r.start}-${r.end} ${r.count}`)).toEqual(["state 6-7 2", "methods 10-805 20", "handlers 900-1390 10"]);
  });

  test("a TS class whose methods are arrow-function fields (excalidraw's App): methods and handlers, not state", () => {
    const P = "components/App.tsx";
    const L = ["class App extends React.Component {", "  state = {", "    zoom: 1,", "  };", "  private canvas: HTMLCanvasElement | null = null;"];
    const syms: SymbolEntry[] = [];
    const child = (name: string, start: number, end: number) =>
      sym(P, name, "field", start, end, { parent: `${P}#App` as SymbolEntry["key"], qualname: `App.${name}`, signature: `private ${name}` });
    syms.push(child("state", 2, 4), child("canvas", 5, 5));
    for (let i = 0; i < 20; i++) {
      const name = i < 10 ? `syncScene${i}` : `onPointerMove${i}`;
      syms.push(child(name, L.length + 1, L.length + 70));
      // an arrow, a wrapped async arrow, an arrow whose parameters wrap onto the next lines
      if (i % 3 === 0) L.push(`  private ${name} = (event: PointerEvent) => {`, "    work();", "    work();");
      else if (i % 3 === 1) L.push(`  public ${name} = withBatchedUpdates(async () => {`, "    work();", "    work();");
      else L.push(`  private ${name} = (`, "    event: React.PointerEvent<HTMLCanvasElement>,", "  ) => {");
      L.push(...Array.from({ length: 66 }, () => "    work();"), "  };");
    }
    L.push("}");
    syms.unshift(sym(P, "App", "class", 1, L.length));
    while (L.length < 1600) L.push("");
    const body = fileRegions(L.join("\n"), syms, "tsx").filter((r) => r.depth === 1);
    expect(body.map((r) => `${r.kind} ${r.count}`)).toEqual(["state 2", "methods 10", "handlers 10"]);
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

describe("CR rdoc-6: the authors' own section headers name the regions", () => {
  test("findBanners: one-line banners, JSX comments, #region / MARK:, boxed headers — not bare rules, lint pragmas or code", () => {
    const lines = [
      "  // ===== Comment Form =====", // 1
      "  /* ---------- pointer: parts ---------- */", // 2
      "        {/* ---- left: rail + parts / layers ---- */}", // 3
      "# ===== Setup =====", // 4
      "          // #region move crop region", // 5
      "// MARK: - Helpers", // 6
      "// ----- Keyboard focus", // 7
      "// -----------------------------------------------------------------------------", // 8
      "// small geometry helpers", // 9
      "// -----------------------------------------------------------------------------", // 10
      "// ---------------", // 11 a bare rule
      "// --- eslint-disable-next-line no-console ---", // 12 a pragma
      "// === x = y; ===", // 13 code
      "const a = 1; // ===== not a header =====", // 14 code first
      "// ====  ====", // 15 no title
    ];
    expect(findBanners(lines).map((b) => `${b.line}:${b.indent}:${b.title}`)).toEqual([
      "1:2:Comment Form",
      "2:2:pointer: parts",
      "3:8:left: rail + parts / layers",
      "4:0:Setup",
      "5:10:move crop region",
      "6:0:Helpers",
      "7:0:Keyboard focus",
      "8:0:small geometry helpers",
    ]);
  });

  test("a file of functions with section headers (crit's 11,000-line web/app.js): one titled region per section, kind = what it holds", () => {
    const P = "web/app.js";
    const L: string[] = ["(function () {", "  'use strict';"];
    const syms: SymbolEntry[] = [];
    const titles = ["Comment Markdown Renderer", "State", "File Tree Sidebar", "Comment Form", "Keyboard Shortcuts", "Init"];
    titles.forEach((t, k) => {
      L.push(`  // ===== ${t} =====`);
      if (t === "State") {
        for (let i = 0; i < 280; i++) L.push(`  let s${i} = ${i};`);
        return;
      }
      for (let i = 0; i < 14; i++) {
        const name = t === "Keyboard Shortcuts" ? `handleKey${i}` : `${t.replace(/\W/g, "").toLowerCase()}${i}`;
        syms.push(sym(P, name, "function", L.length + 1, L.length + 20, { exported: false }));
        L.push(`  function ${name}() {`, ...Array.from({ length: 18 }, () => "    work();"), "  }");
      }
      if (k === 0) L.push("");
    });
    L.push("})();");
    while (L.length < 1600) L.push("");
    const rs = fileRegions(L.join("\n"), syms, "javascript");
    expect(rs.map((r) => `${r.depth} ${r.kind} ${r.title} ${r.count}`)).toEqual([
      "0 functions Comment Markdown Renderer 14",
      "0 section State 0",
      "0 functions File Tree Sidebar 14",
      "0 functions Comment Form 14",
      "0 handlers Keyboard Shortcuts 14",
      "0 functions Init 14",
    ]);
    // a section runs from its header to the line before the next one
    expect(rs[1]?.start).toBe(L.indexOf("  // ===== State =====") + 1);
    expect(rs[1]?.end).toBe(L.indexOf("  // ===== File Tree Sidebar ====="));
    expect(regionLabel(rs[3] as FileRegion, "ja")).toBe("Comment Form — 関数 14");
    expect(regionLabel(rs[1] as FileRegion, "ja")).toBe("State");
    // two headers do not structure 1,600 lines: the symbol runs stay
    const two = L.map((l) => (/=====/.test(l) && !/Comment Markdown|Comment Form/.test(l) ? "" : l)).join("\n");
    expect(fileRegions(two, syms, "javascript").some((r) => r.title !== undefined)).toBe(false);
  });

  test("a big component with section headers inside (m3e's Editor: document, history, pointer …): its body regions are the sections", () => {
    const P = "app/Editor.tsx";
    const L = ["export function Editor() {", "  const lang = useLang();", "  const [w, setW] = useState(0);", ""];
    const section = (title: string, body: string[]) => L.push(`  /* ---------- ${title} ---------- */`, ...body, "");
    section("document", [...Array.from({ length: 12 }, (_, i) => `  const [d${i}, setD${i}] = useState(${i});`), "  const docRef = useRef(null);"]);
    section("history", Array.from({ length: 20 }, (_, i) => [`  const undo${i} = useCallback(() => {`, "    pop();", "  }, []);"]).flat());
    section(
      "pointer: parts",
      Array.from({ length: 30 }, (_, i) => [`  const onPartPointer${i} = (e) => {`, ...Array.from({ length: 10 }, () => "    move(e);"), "  };"]).flat(),
    );
    section("render", ["  return (", "    <div>", ...Array.from({ length: 1200 }, () => "      <span />"), "    </div>", "  );"]);
    L.push("}");
    const syms = [sym(P, "Editor", "function", 1, L.length)];
    const body = fileRegions(L.join("\n"), syms, "tsx").filter((r) => r.depth === 1);
    expect(body.map((r) => `${r.kind} ${r.title ?? "-"}`)).toEqual([
      "state -",
      "state document",
      "helpers history",
      "handlers pointer: parts",
      "render render",
    ]);
    expect(body[1]?.hooks).toEqual({ useState: 12, useRef: 1 });
    expect(regionLabel(body[1] as FileRegion, "ja")).toBe("document — 状態 13（useState 12・useRef 1）");
    expect(regionLabel(body[3] as FileRegion, "en")).toBe("pointer: parts — Handlers 30");
    for (const r of body) expect(r.host).toBe("Editor");
  });

  test("a long Go function: the comments leading its blocks name its regions (≥ 3), boxed headers name a file's sections", () => {
    const P = "internal/run/run.go";
    const L = ["package run", "", "func Run() error {"];
    for (const c of ["Load the configuration.", "Open the session store", "Serve until the context ends"]) {
      L.push(`\t// ${c}`, ...Array.from({ length: 150 }, (_, i) => `\tx${i} := step()`), "");
    }
    L.push("\treturn nil", "}");
    const end = L.length;
    for (const t of ["small geometry helpers", "flood fill", "public API"]) {
      L.push("// " + "-".repeat(77), `// ${t}`, "// " + "-".repeat(77));
      L.push(...Array.from({ length: 360 }, () => "// filler"));
    }
    const syms = [sym(P, "Run", "function", 3, end), sym(P, "fill", "function", end + 400, end + 420)];
    const rs = fileRegions(L.join("\n"), syms, "go");
    expect(rs.filter((r) => r.depth === 1).map((r) => `${r.kind} ${r.title} ${r.start}`)).toEqual([
      "section Load the configuration 4",
      "section Open the session store 156",
      "section Serve until the context ends 308",
    ]);
    expect(rs.filter((r) => r.depth === 0 && r.title).map((r) => `${r.title} ${r.count}`)).toEqual([
      "small geometry helpers 0",
      "flood fill 1",
      "public API 0",
    ]);
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

  test("dependents, tests with cases and `go test` of their package, entries reaching it, co-change (sweeps and one-offs dropped), risks", () => {
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
    expect(a?.testCommand).toEqual({ command: "go test ./internal/session" });
    // no tests, no command (the doc says none were found instead of telling the reader to run nothing)
    expect(g[B]?.testCommand).toBeUndefined();
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

  test("most-used declarations: the module's exported declarations other files use the most (≥ 2 users, ≤ 5)", () => {
    const S = "internal/session/session.go";
    const decl = (name: string, kind: string, line: number, o: Partial<SymbolEntry> = {}) => sym(S, name, kind, line, line + 5, o);
    const syms: Record<string, SymbolEntry[]> = {
      [S]: [
        decl("Session", "struct", 10),
        decl("Comment", "struct", 30),
        decl("Load", "function", 50),
        decl("helper", "function", 70, { exported: false }),
        decl("Files", "field", 11, { parent: `${S}#Session` as SymbolEntry["key"] }),
        decl("Once", "function", 90),
      ],
      // a build-tag twin of the same name in another file of the module: one row
      "internal/session/store.go": [sym("internal/session/store.go", "Comment", "struct", 3, 8)],
    };
    const users = new Map([
      [`${S}#Session`, 4],
      [`${S}#Comment`, 9],
      [`${S}#Load`, 2],
      [`${S}#Once`, 1],
      [`${S}#helper`, 7],
      ["internal/session/store.go#Comment", 9],
    ]) as unknown as ReadonlyMap<SymbolEntry["key"], number>;
    let asked: readonly string[] = [];
    const g = changeGuides(
      {
        ...ix,
        symbols: (p: RepoPath) => syms[p] ?? [],
        symbolUsers: (keys) => {
          asked = keys;
          return users;
        },
      },
      { history: null },
    );
    // exported top-level declarations only (no field, no unexported helper), one pass for the whole repo
    expect([...asked].sort()).toEqual([`${S}#Comment`, `${S}#Load`, `${S}#Once`, `${S}#Session`, "internal/session/store.go#Comment"]);
    expect(g[A]?.used).toEqual([
      { name: "Comment", path: S, line: 30, users: 9 },
      { name: "Session", path: S, line: 10, users: 4 },
      { name: "Load", path: S, line: 50, users: 2 },
    ]);
    expect(g[B]?.used).toBeUndefined();
  });

  test("the test command follows the tests: Go packages exactly (≤ 3, else their common directory), other tests the repo's own command", () => {
    const t = (...paths: string[]) => paths.map((path) => ({ path: path as RepoPath }));
    const rootTest = { command: "make test", path: "Makefile" as RepoPath, line: 12 as never };
    // crit `web/style-live`: a JS module with one embedding .go file, tested by JS tests — not `go test ./web/...`
    expect(testCommandOf(t("web/__tests__/a.test.js", "web/__tests__/b.test.js"), { goModule: true, rootTest })).toEqual(rootTest);
    expect(
      testCommandOf(t("internal/share/share_test.go", "internal/config/config_test.go", "internal/live/live_test.go"), { goModule: true, rootTest }),
    ).toEqual({
      command: "go test ./internal/config ./internal/live ./internal/share",
    });
    expect(testCommandOf(t("internal/a/a_test.go", "internal/b/b_test.go", "internal/c/c_test.go", "internal/d/x/d_test.go"), { goModule: true })).toEqual({
      command: "go test ./internal/...",
    });
    expect(testCommandOf(t("a_test.go", "pkg/b_test.go", "cmd/c_test.go", "x/d_test.go"), { goModule: true })).toEqual({ command: "go test ./..." });
    expect(testCommandOf(t("main_test.go"), { goModule: true })).toEqual({ command: "go test ." });
    // crit `internal/vcs`: its own package's tests decide, not the 40 tests attached from other packages (`./...`)
    expect(
      testCommandOf(t("internal/vcs/git_test.go", "internal/session/a_test.go", "internal/server/b_test.go", "cmd/crit/c_test.go"), { goModule: true }, [
        "internal/vcs/git.go",
        "internal/vcs/jj.go",
      ] as RepoPath[]),
    ).toEqual({ command: "go test ./internal/vcs" });
    // a Go test outside a Go module (no go.mod) has no `go test` to run; no tests, no command
    expect(testCommandOf(t("tools/x_test.go"), { goModule: false })).toBeUndefined();
    expect(testCommandOf([], { goModule: true, rootTest })).toBeUndefined();
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

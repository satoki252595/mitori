// CR rdoc-5: the files that use a symbol (NC-10 §7 「主要な型」's "used by" and ranking), from S1 references through
// the resolved imports. Before, §7 counted the importers of the type's *file*: every type of one file got one number.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { RepoPath, SymbolKey } from "@mitori/core";
import type { StageFile } from "../resolve/files.ts";
import { resolveImports } from "../resolve/stage.ts";
import { imp, input, ref, sf } from "../resolve/test/stage-files.ts";
import { FIXTURES, loadRepo } from "../structure/test/corpus.ts";
import { runPipeline } from "../structure/test/pipeline.ts";
import { symbolUsers } from "./usage.ts";

const byPath = (files: readonly StageFile[]) => new Map<RepoPath, StageFile>(files.map((f) => [f.path, f]));

describe("CR rdoc-5 symbolUsers", () => {
  test("go-small: `store.Book` through the package alias, unqualified in its own package; tests and the declaring file do not count", async () => {
    const p = runPipeline((await loadRepo(join(FIXTURES, "go-small"))).input);
    const files = byPath(p.input.files);
    const k = (name: string) => `internal/store/store.go#${name}` as SymbolKey;
    const users = symbolUsers([k("Book"), k("Store"), k("Status")], files, p.resolved);
    // Book: cmd/tsundoku/main.go (`store.Book{…}`), internal/server/server.go, internal/store/memory.go (same package)
    expect(users.get(k("Book"))).toBe(3);
    // Store: both mains' / the server's / the chi router's parameters — never `MemoryStore`, a different name
    expect(users.get(k("Store"))).toBeGreaterThanOrEqual(3);
    // Status: main.go and server.go; `b.Status` (a field selector) in memory.go is not the type
    expect(users.get(k("Status"))).toBe(2);
  });

  test("ts-small: references and bound names through an import of the declaring file, not every importer of it", async () => {
    const p = runPipeline((await loadRepo(join(FIXTURES, "ts-small"))).input);
    const files = byPath(p.input.files);
    const k = (name: string) => `src/db/types.ts#${name}` as SymbolKey;
    const users = symbolUsers([k("Book"), k("BookStatus"), k("NewBook"), k("Tag")], files, p.resolved);
    expect(users.get(k("BookStatus"))).toBeGreaterThanOrEqual(2); // repo.ts, routes.ts (+ the UI)
    // repo.ts and the BookList component (the generated API types mention a `Book` of their own, never importing it)
    expect(users.get(k("Book"))).toBe(2);
    expect(users.get(k("NewBook"))).toBe(1);
    expect(users.has(k("Tag"))).toBe(false);
  });

  test("synthetic: a reference without an import is no use; a barrel re-export is followed one level; examples and tests do not count", () => {
    const files = [
      sf("src/model.ts" as RepoPath, {
        symbols: [
          { name: "Kind", kind: "type" },
          { name: "Item", kind: "interface" },
        ],
      }),
      sf("src/index.ts" as RepoPath, { imports: [imp("./model.ts", [], "reexport")] }),
      sf("src/a.ts" as RepoPath, { imports: [imp("./model.ts", ["Item"])], refs: [ref("Kind", 2, "type")] }),
      sf("src/b.ts" as RepoPath, { imports: [imp("./index.ts", ["Kind"])] }),
      sf("src/c.ts" as RepoPath, { refs: [ref("Kind", 1, "type")] }), // same name, no import of the model
      sf("src/a.test.ts" as RepoPath, { imports: [imp("./model.ts", ["Kind"])] }),
      sf("examples/demo.ts" as RepoPath, { imports: [imp("../src/model.ts", ["Kind"])] }),
    ];
    const resolved = resolveImports(input(files));
    const users = symbolUsers(["src/model.ts#Kind" as SymbolKey, "src/model.ts#Item" as SymbolKey, "src/nope.ts#X" as SymbolKey], byPath(files), resolved);
    // Kind: a.ts (a type reference while importing the model) and b.ts (named through the barrel)
    expect(users.get("src/model.ts#Kind" as SymbolKey)).toBe(2);
    expect(users.get("src/model.ts#Item" as SymbolKey)).toBe(1);
    expect(users.has("src/nope.ts#X" as SymbolKey)).toBe(false);
  });
});

// cr-requests/agent.md #6: `needs_more_context` items become read-only REL hints of the R2 agent bundle.
import { describe, expect, test } from "bun:test";
import type { RepoPath, SymbolEntry } from "@mitori/core";
import { needsOf, resolveReadHints } from "./hints.ts";

const files: Record<string, number> = { "internal/config/config.go": 120, "internal/meta/fetch.go": 80, "README.md": 10 };
const sym = (path: string, name: string, qualname: string, start: number, end: number) => ({ path, name, qualname, start, end }) as unknown as SymbolEntry;
const symbols = [
  sym("internal/config/config.go", "Load", "Load", 40, 72),
  sym("internal/config/config_test.go", "Load", "Load", 5, 9),
  sym("internal/meta/fetch.go", "Fetch", "Client.Fetch", 10, 30),
];
const ix = {
  file: (p: RepoPath) => (p in files ? { lines: files[p] as number } : null),
  findSymbols: (q: string) => symbols.filter((s) => s.name === q),
};

describe("#6 needs_more_context → read hints", () => {
  test("paths with and without line ranges; ranges clamp to the file", () => {
    expect(resolveReadHints(ix, ["internal/config/config.go"])).toEqual([{ path: "internal/config/config.go" as RepoPath, start: 1, end: 30 }]);
    expect(resolveReadHints(ix, ["see internal/meta/fetch.go:12-40 please"])).toEqual([{ path: "internal/meta/fetch.go" as RepoPath, start: 12, end: 40 }]);
    expect(resolveReadHints(ix, ["internal/meta/fetch.go#L70-L200"])).toEqual([{ path: "internal/meta/fetch.go" as RepoPath, start: 70, end: 80 }]);
    expect(resolveReadHints(ix, ["./README.md:3"])).toEqual([{ path: "README.md" as RepoPath, start: 3, end: 3 }]);
  });

  test("symbol names resolve to their definition (non-test file first); unknown items are dropped", () => {
    expect(resolveReadHints(ix, ["func Load", "symbol Client.Fetch", "`Load()`", "the retry policy", "nope/missing.go"])).toEqual([
      { path: "internal/config/config.go" as RepoPath, start: 40, end: 72 },
      { path: "internal/meta/fetch.go" as RepoPath, start: 10, end: 30 },
    ]);
  });

  test("the failure carries the items newline-joined; anything else gives none", () => {
    expect(needsOf({ reason: "needs_more_context", needs: "a.go\nfunc Load" })).toEqual(["a.go", "func Load"]);
    expect(needsOf({ reason: "x" })).toEqual([]);
    expect(needsOf(undefined)).toEqual([]);
  });
});

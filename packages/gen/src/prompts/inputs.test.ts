import { describe, expect, test } from "bun:test";
import type { DocLang, RepoPath, SectionId, SymbolEntry, SymbolKey } from "@mitori/core";
import { DATA_BUDGETS } from "../contract.ts";
import { createFakeDocStore } from "../test/fake-doc.ts";
import { createFakeIndexer } from "../test/fake-indexer.ts";
import { testHasher, testIds } from "../test/ports.ts";
import { M_CORE, sampleRepo } from "../test/repo.ts";
import { plannedTask } from "../test/tasks.ts";
import { childSymbols, gatherInputs } from "./inputs.ts";

const hasher = testHasher();

function setup() {
  const repo = sampleRepo();
  const indexer = createFakeIndexer(repo, hasher);
  const ids = testIds();
  const doc = createFakeDocStore({ hasher, ids, repo });
  const env = {
    indexer,
    doc,
    lang: "ja" as DocLang,
    tokens: (t: string) => Math.ceil(t.length / 2.3),
    plan: { eager: [], tasks: [] },
  };
  return { indexer, doc, env };
}

const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S6o", promptVer: "gen.flows@7", indexDigest: "0" } as const;

/** One steps block citing `path`, in the given flow section. */
function seedFlow(doc: ReturnType<typeof setup>["doc"], section: SectionId, path: string) {
  doc.upsertFlowSection(section.slice(3), section.slice(3), 0);
  doc.applyGenerated(
    [
      {
        id: null,
        section,
        aspect: "steps",
        kind: "list",
        depth: "L2",
        audience: ["dev"],
        lang: "ja",
        md: "1. 受け付ける[[1]]",
        claims: [
          {
            n: 1,
            kind: "behavior",
            quote: "受け付ける",
            cites: [{ path, start: 5, end: 7, blob: "b", snippet: "s", precision: "exact" }],
            checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-10-03T00:00:00.000Z" },
            verdict: "cited",
          },
        ],
        gen,
      },
    ],
    { mode: "write", deletes: [], source: { kind: "regen", id: "previous" }, reason: "", listed: 0 },
  );
}

describe("WP30-E the root README leads the overview DOCS", () => {
  test("root README excerpt comes before a nested README (`.` used to sort first and starve it)", async () => {
    const repo = sampleRepo();
    const indexer = createFakeIndexer(repo, hasher);
    const ids = testIds();
    const doc = createFakeDocStore({ hasher, ids, repo });
    const env = {
      indexer,
      doc,
      lang: "ja" as DocLang,
      tokens: (t: string) => Math.ceil(t.length / 2.3),
      plan: { eager: [], tasks: [] },
    };
    indexer.setFile(".cursor-plugin/README.md", "# Plugin\n\nPlugin helper docs for the cursor extension.\n");
    repo.facts.push({ kind: "existing_doc", detector: "doc.test@1", path: ".cursor-plugin/README.md", line: 1, role: "readme", title: "Plugin" });
    const task = plannedTask("gen.overview", { kind: "section", id: "s0" }, ["s0", "s1", "s2"]);
    const inputs = (await gatherInputs(task, env)).inputs;
    const docs = (inputs.DOCS ?? []).join("\n");
    expect(docs).toContain("Tsundoku keeps a reading list");
    const root = docs.indexOf("=== README.md");
    const nested = docs.indexOf("=== .cursor-plugin/README.md");
    expect(root).toBeGreaterThanOrEqual(0);
    expect(nested).toBeGreaterThanOrEqual(0);
    expect(root).toBeLessThan(nested);
  });
});

describe("WP32 gen.parent CHILDREN lists citable definition ranges of each child's public symbols", () => {
  test("names a sentence may mention carry exact path:start-end ranges (40-line clipped), within budget", async () => {
    const { env } = setup();
    const task = plannedTask("gen.parent", { kind: "parent", id: M_CORE as string }, ["s6/core" as SectionId]);
    const inputs = (await gatherInputs(task, env)).inputs;
    const children = (inputs.CHILDREN ?? []).join("\n");
    // representative exported callables of both children, each with its definition range (types stay in SKELETON)
    expect(children).toContain(">   symbols: Store.get src/session/store.ts:10-15, Store.put src/session/store.ts:17-19");
    expect(children).toContain(">   symbols: login src/auth/login.ts:3-7");
    // private helpers are not nameable from the parent page
    expect(children).not.toMatch(/ now src\//);
    // every emitted range repeats exactly (the validator allows only exact repeats of `> ` locations)
    for (const m of children.matchAll(/>\s{3}symbols: (.*)/g))
      for (const part of (m[1] as string).split(", ")) {
        expect(part).toMatch(/^(\S+) (\S+):(\d+)-(\d+)$/);
        const [, , , a, b] = /^(\S+) (\S+):(\d+)-(\d+)$/.exec(part) as unknown as [string, string, string, string, string];
        expect(Number(b) - Number(a)).toBeLessThanOrEqual(39);
      }
    // the section stays within its token budget
    const tokens = (t: string) => Math.ceil(t.length / 2.3);
    expect(tokens((inputs.CHILDREN ?? []).join("\n"))).toBeLessThanOrEqual(DATA_BUDGETS["gen.parent"].CHILDREN ?? 4000);
  });
});

describe("WP32 childSymbols orders one symbols line per file", () => {
  test("module functions, then handlers (even unexported), then other methods; ~-stripped, 40-clipped", () => {
    const sym = (
      path: string,
      name: string,
      start: number,
      end: number,
      kind: SymbolEntry["kind"] = "function",
      over: Partial<SymbolEntry> = {},
    ): SymbolEntry =>
      ({
        key: `${path}#${name}` as SymbolKey,
        path: path as RepoPath,
        kind,
        name,
        qualname: name,
        start,
        end,
        exported: true,
        ...over,
      }) as unknown as SymbolEntry;
    const table: Record<string, SymbolEntry[]> = {
      "b/mod.rs": [sym("b/mod.rs", "build_api", 142, 144), sym("b/mod.rs", "long_helper", 10, 200)],
      "a/srv.rs": [
        sym("a/srv.rs", "setup", 5, 8),
        { ...sym("a/srv.rs", "tool_run", 50, 60), exported: false },
        sym("a/srv.rs", "T", 60, 90, "struct"),
        { ...sym("a/srv.rs", "m", 70, 75, "method"), key: "a/srv.rs#T~2.m" as SymbolKey, qualname: "T~2.m", parent: "a/srv.rs#T" as SymbolKey },
        { ...sym("a/srv.rs", "n", 80, 85, "method"), key: "a/srv.rs#T~2.n" as SymbolKey, qualname: "T~2.n", parent: "a/srv.rs#T" as SymbolKey },
      ],
      "c/types.rs": [sym("c/types.rs", "Thing", 2, 9, "struct")],
      "c/priv.rs": [sym("c/priv.rs", "secret_fn", 3, 6, "function", { exported: false })],
    };
    const symbols = (p: RepoPath) => table[p] ?? [];
    // tool_run is a route handler although not exported; T.m outranks the plain method T.n
    const lines = childSymbols(symbols, ["a/srv.rs", "b/mod.rs", "c/priv.rs", "c/types.rs"] as RepoPath[], new Set(["a/srv.rs#tool_run", "a/srv.rs#T~2.m"]));
    expect(lines).toEqual([
      ">   symbols: setup a/srv.rs:5-8, tool_run a/srv.rs:50-60, T.m a/srv.rs:70-75, T.n a/srv.rs:80-85",
      ">   symbols: long_helper b/mod.rs:10-49, build_api b/mod.rs:142-144",
    ]);
    // the per-file cap keeps each file's head (two symbols per file here)
    expect(childSymbols(symbols, ["a/srv.rs", "b/mod.rs"] as RepoPath[], new Set(["a/srv.rs#tool_run", "a/srv.rs#T~2.m"]), 2)).toEqual([
      ">   symbols: setup a/srv.rs:5-8, tool_run a/srv.rs:50-60",
      ">   symbols: long_helper b/mod.rs:10-49, build_api b/mod.rs:142-144",
    ]);
  });
});

describe("WP2 gen.flows EXISTING keeps only flows cited from current seed files", () => {
  test("a flow citing a seed walk file stays; a docs/demo flow citing nothing current is dropped", async () => {
    const { doc, env } = setup();
    // sampleRepo seeds walk src/http/server.ts (route) and src/cli/main.ts (entry)
    seedFlow(doc, "s3/login", "src/http/server.ts");
    seedFlow(doc, "s3/demo", "docs/demo/page.md");
    const task = plannedTask("gen.flows", { kind: "section", id: "s3" }, ["s3"]);
    const inputs = (await gatherInputs(task, env)).inputs;
    expect(inputs.EXISTING_FLOWS?.join("\n")).toContain('> login "login"');
    expect(inputs.EXISTING_FLOWS?.join("\n")).not.toContain("demo");
    expect((inputs.EXISTING ?? []).some((l) => l.includes("section=s3/demo"))).toBe(false);
    expect((inputs.EXISTING ?? []).some((l) => l.includes("section=s3/login"))).toBe(true);
  });
});

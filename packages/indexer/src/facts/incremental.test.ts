// Incremental S2 linking (CR m1-28): `linkFacts` memoizes each file's linked facts on its StageFile object. Whatever was
// linked before, the result must equal a cold link of the same snapshot (fresh objects, empty memo) — after body edits,
// candidate edits, manifest / resolver-config edits, adds and deletes, and edits elsewhere in a Go package directory.
import { describe, expect, test } from "bun:test";
import { createSecretScanner, type RepoPath } from "@mitori/core";
import type { StageFile, StageInput } from "../resolve/files.ts";
import { resolveImports } from "../resolve/stage.ts";
import { cand, input, sf } from "../resolve/test/stage-files.ts";
import { corpusDir, FIXTURES, loadRepo } from "../structure/test/corpus.ts";
import { TODO_CAP } from "./link.ts";
import { type FactsResult, linkFacts } from "./stage.ts";

const fresh = (inp: StageInput): StageInput => ({ files: inp.files.map((f) => structuredClone(f)), texts: new Map(inp.texts) });
const link = (inp: StageInput, secrets = false): FactsResult => linkFacts(inp, resolveImports(inp), secrets ? { secrets: createSecretScanner() } : {});
/** Linked result after warm linking ≡ a cold link of the same snapshot. */
function expectSameAsCold(inp: StageInput, secrets = false): FactsResult {
  const warm = link(inp, secrets);
  expect(warm).toEqual(link(fresh(inp), secrets));
  return warm;
}

const replace = (inp: StageInput, path: RepoPath, f: (x: StageFile) => StageFile | null): StageInput => ({
  texts: inp.texts,
  files: inp.files.flatMap((x) => (x.path === path ? (f(x) === null ? [] : [f(x) as StageFile]) : [x])),
});

const repos = ["crit", "hono", "fastapi", "flask", "ripgrep"]
  .map((n) => [n, corpusDir(n)] as const)
  .concat(["ts-small", "py-small", "go-small", "rust-small", "mixed"].map((n) => [n, `${FIXTURES}/${n}`] as const))
  .filter((x): x is readonly [string, string] => x[1] !== null);

describe("CR m1-28 incremental fact linking ≡ a cold link", () => {
  for (const [name, root] of repos)
    test(`${name}: body edits, candidate edits, a manifest edit, an add and a delete`, async () => {
      const base = (await loadRepo(root)).input;
      let inp = base;
      expectSameAsCold(inp);
      const withFacts = inp.files.filter((f) => f.facts.length > 0 || f.tests.length > 0);
      let x = 2_463_534_242;
      const pick = (list: readonly StageFile[]) => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return list[(x >>> 0) % list.length] as StageFile;
      };
      for (let k = 0; k < 6 && withFacts.length > 0; k++) {
        // body edit: a new object, same candidates
        inp = replace(inp, pick(withFacts).path, (f) => ({ ...f, blob: `${f.blob}+`, lines: f.lines + 1 }));
        expectSameAsCold(inp);
        // candidate edit: one candidate gone, the others one line further down
        inp = replace(inp, pick(withFacts).path, (f) => ({ ...f, blob: `${f.blob}*`, facts: f.facts.slice(1).map((c) => ({ ...c, line: c.line + 1 })) }));
        expectSameAsCold(inp);
      }
      const manifest = inp.files.find((f) => f.facts.some((c) => c.kind === "dependency"));
      if (manifest !== undefined) {
        inp = replace(inp, manifest.path, (f) => ({ ...f, blob: `${f.blob}~`, facts: f.facts.filter((c) => c.kind !== "dependency" || c.line % 2 === 0) }));
        expectSameAsCold(inp);
      }
      inp = {
        texts: inp.texts,
        files: [
          ...inp.files,
          sf("zz_added/new.ts", {
            facts: [cand({ detector: "env.js@1", kind: "env", path: "zz_added/new.ts", line: 3, data: { name: "ADDED", hasDefault: false } })],
          }),
        ],
      };
      expectSameAsCold(inp);
      inp = replace(inp, pick(withFacts).path, () => null);
      expectSameAsCold(inp);
      expectSameAsCold(inp, true); // the redaction setting is part of the memo key
      expectSameAsCold(base);
    }, 120_000);

  test("Go: renaming a handler in another file of the package re-stamps the route (the directory is the unit)", () => {
    const route = cand({
      detector: "route.nethttp@1",
      kind: "route",
      path: "srv/routes.go",
      line: 5,
      data: { method: "GET", pattern: "/x", handler: "handleX", framework: "net/http" },
      evidence: ["import:net/http", "recv:http"],
    });
    const routes = sf("srv/routes.go", { facts: [route] });
    const v1 = input([routes, sf("srv/handlers.go", { symbols: [{ name: "handleX" }] })]);
    const a = expectSameAsCold(v1);
    expect(a.facts.find((f) => f.kind === "route")).toMatchObject({ handler: "srv/handlers.go#handleX" });
    const v2 = replace(v1, "srv/handlers.go", (f) => sf(f.path, { blob: "b2", symbols: [{ name: "handleY" }] }));
    const b = expectSameAsCold(v2);
    expect(b.facts.find((f) => f.kind === "route" && f.handler !== undefined)).toBeUndefined();
  });

  test("Go: a build-ignored generator main is relabelled when its directory gains or loses a real main", () => {
    const gen = sf("cmd/x/gen.go", {
      facts: [cand({ detector: "entry.go@1", kind: "entry", path: "cmd/x/gen.go", line: 4, data: { entry: "main", label: "cmd/x", ignored: true } })],
    });
    const main = sf("cmd/x/main.go", {
      facts: [cand({ detector: "entry.go@1", kind: "entry", path: "cmd/x/main.go", line: 3, data: { entry: "main", label: "cmd/x" } })],
    });
    const labels = (r: FactsResult) => r.facts.flatMap((f) => (f.kind === "entry" ? [f.label] : []));
    expect(labels(expectSameAsCold(input([gen])))).toEqual(["cmd/x"]);
    expect(labels(expectSameAsCold(input([gen, main])))).toEqual(["cmd/x/gen.go", "cmd/x"]);
    expect(labels(expectSameAsCold(input([gen])))).toEqual(["cmd/x"]);
  });

  test("the snapshot-wide TODO cap counts candidates in (path, line) order across memoized files", () => {
    const todoFile = (path: string, n: number, from = 1) =>
      sf(path, {
        facts: Array.from({ length: n }, (_, i) =>
          cand({ detector: "todo.comment@1", kind: "todo", path, line: from + i, data: { marker: "TODO", text: `t${i}` } }),
        ),
      });
    const v1 = input([todoFile("a.ts", 1_500), todoFile("b.ts", 800), todoFile("c.ts", 10)]);
    const r1 = expectSameAsCold(v1);
    const todos = (r: FactsResult) => r.facts.filter((f) => f.kind === "todo");
    expect(todos(r1).length).toBe(TODO_CAP);
    expect(todos(r1).some((f) => f.path === "c.ts")).toBe(false);
    const v2 = replace(v1, "a.ts", () => todoFile("a.ts", 100));
    const r2 = expectSameAsCold(v2);
    expect(todos(r2).filter((f) => f.path === "c.ts").length).toBe(10);
  });

  test("an unchanged fact is the same object in the next result (later stages can diff by identity)", async () => {
    const root = repos[0]?.[1];
    if (root === undefined) return;
    const inp = (await loadRepo(root)).input;
    const a = link(inp);
    const edited = replace(inp, inp.files.find((f) => f.facts.length > 0)?.path as string, (f) => ({ ...f, blob: `${f.blob}+` }));
    const b = link(edited);
    const before = new Set(a.facts);
    const same = b.facts.filter((f) => before.has(f)).length;
    expect(same).toBeGreaterThan(b.facts.length * 0.9);
  });
});

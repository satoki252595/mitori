// Self-consistency of the hand-written truth (`fixtures/truth/<name>.json`) against the fixture trees it describes.
// This does NOT prove the truth right (only a human can) -- it catches drift: a moved line, a renamed file, a typo.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type { FixtureName, FixtureTruth, TruthFact } from "@mitori/testkit";
import { materializeTree } from "../../packages/testkit/src/fixtures/build.ts";
import { fixtureDir, readSpec } from "../../packages/testkit/src/fixtures/spec.ts";
import { readTruth } from "../../packages/testkit/src/fixtures/truth.ts";

const NAMES = readdirSync(import.meta.dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length) as FixtureName)
  .sort();

const KINDS = ["entry", "route", "cli", "env", "schema", "test", "script", "dependency", "existing_doc", "todo", "config"];
const FILE_CLASSES = [
  "source",
  "test",
  "docs",
  "config",
  "vendored",
  "generated",
  "minified",
  "lockfile",
  "data_large",
  "binary",
  "secret",
  "oversize",
  "ignored",
];

/** Every path in the tree (files and symlinks; `.git` excluded), repo-relative. */
function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel)).sort()) {
    const r = rel === "" ? entry : `${rel}/${entry}`;
    if (r === ".git") continue;
    const st = lstatSync(join(root, r));
    if (st.isDirectory() && !st.isSymbolicLink()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

/** The text a truth entry points into. Symlinks and binary-looking files read as empty (never followed). */
const textOf = (root: string, path: string): string[] | null => {
  const abs = join(root, path);
  if (!existsSync(abs) && !lstatSync(abs, { throwIfNoEntry: false })) return null;
  if (lstatSync(abs).isSymbolicLink()) return [];
  return readFileSync(abs, "utf8").split("\n");
};

/** What must appear on the fact's line (lower-cased) -- loose on purpose; null = nothing to check. */
function needle(f: TruthFact): string | null {
  const k = f.key;
  switch (f.kind) {
    case "route": {
      if (f.attrs?.framework === "next-app") return k.split(" ")[0] ?? null;
      return k
        .split(" ")
        .slice(1)
        .join(" ")
        .replace(/^\/admin/, "");
    }
    case "env":
    case "script":
    case "test":
      return k;
    case "cli":
      return k.split(" ").at(-1) ?? null;
    case "schema":
      return k.split(":").at(-1) ?? null;
    case "dependency":
      return k.slice(k.indexOf(":") + 1);
    case "todo":
      return k;
    case "existing_doc":
      return typeof f.attrs?.title === "string" ? f.attrs.title : null;
    default:
      return null;
  }
}

for (const name of NAMES) {
  describe(`truth consistency: ${name}`, () => {
    let dir = "";
    let truth: FixtureTruth;
    let tree: string[] = [];

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "mitori-truth-"));
      truth = readTruth(name);
      materializeTree(name, { into: join(dir, "tree") });
      tree = walk(join(dir, "tree"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const root = () => join(dir, "tree");
    const all = () => [...truth.facts, ...truth.forbiddenFacts];

    test("header and shape", () => {
      expect(truth.v).toBe("mitori.fixture-truth/1");
      expect(truth.fixture).toBe(name);
      for (const f of all()) expect(KINDS).toContain(f.kind);
      for (const f of truth.files) expect(FILE_CLASSES).toContain(f.class);
      expect(truth.tolerances.callsRecall).toBeGreaterThan(0);
      expect(truth.tolerances.callsPrecision).toBeLessThanOrEqual(1);
    });

    test("fixture.json is complete (patches, dirty sources, generators)", () => {
      const spec = readSpec(name);
      const dir0 = fixtureDir(name);
      for (const h of spec.history.slice(1)) expect(existsSync(join(dir0, h.patch ?? "missing"))).toBe(true);
      for (const d of spec.dirty) {
        if (d.patch) expect(existsSync(join(dir0, d.patch))).toBe(true);
        for (const u of d.untracked ?? []) expect(existsSync(join(dir0, "dirty/untracked", u))).toBe(true);
      }
      for (const g of spec.generate) expect(tree).toContain(g.path);
    });

    test("every listed file exists once; exhaustive lists match the tree exactly", () => {
      const paths = truth.files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const p of paths) expect([p, tree.includes(p)]).toEqual([p, true]);
      if (truth.filesExhaustive) expect([...paths].sort()).toEqual(tree.filter((p) => p !== "fixture.json").sort());
    });

    test("facts: files exist, lines are in range and point at the thing, (kind, key, path, line) is unique", () => {
      const seen = new Set<string>();
      for (const f of all()) {
        const id = `${f.kind} ${f.key} @${f.path}:${f.line ?? ""}`;
        expect([id, seen.has(id)]).toEqual([id, false]);
        seen.add(id);
        const lines = textOf(root(), f.path);
        expect([id, lines !== null]).toEqual([id, true]);
        if (f.line === undefined || lines === null) continue;
        expect([id, f.line >= 1 && f.line <= lines.length]).toEqual([id, true]);
        const want = needle(f);
        if (want) expect([id, (lines[f.line - 1] ?? "").toLowerCase().includes(want.toLowerCase())]).toEqual([id, true]);
      }
      for (const f of truth.forbiddenFacts) expect(f.stretch).toBeUndefined();
    });

    test("symbols: ranges are in the file and the first line names the symbol", () => {
      const seen = new Set<string>();
      for (const s of truth.symbols) {
        expect([s.key, seen.has(s.key)]).toEqual([s.key, false]);
        seen.add(s.key);
        const path = s.key.slice(0, s.key.indexOf("#"));
        const lines = textOf(root(), path);
        expect([s.key, lines !== null]).toEqual([s.key, true]);
        if (!lines) continue;
        expect([s.key, 1 <= s.start && s.start <= s.end && s.end <= lines.length]).toEqual([s.key, true]);
        const simple =
          s.key
            .slice(s.key.indexOf("#") + 1)
            .split(".")
            .at(-1) ?? "";
        const head = lines.slice(s.start - 1, s.start + 1).join("\n");
        expect([s.key, head.includes(simple)]).toEqual([s.key, true]);
      }
    });

    test("imports: both ends exist, no duplicates, the importer's text mentions the target", () => {
      const seen = new Set<string>();
      for (const e of truth.imports) {
        const id = `${e.from} -> ${e.to}`;
        expect([id, seen.has(id)]).toEqual([id, false]);
        seen.add(id);
        expect([id, tree.includes(e.from) && tree.includes(e.to)]).toEqual([id, true]);
        const text = (textOf(root(), e.from) ?? []).join("\n");
        const stem = basename(e.to, extname(e.to));
        const pkg = basename(dirname(e.to));
        expect([id, text.includes(stem) || text.includes(pkg)]).toEqual([id, true]);
      }
    });

    test("calls: both symbol files exist and the caller's file mentions the callee", () => {
      for (const c of truth.calls) {
        const id = `${c.from} -> ${c.to}`;
        const [fromFile, toFile] = [c.from, c.to].map((k) => k.slice(0, k.indexOf("#")));
        expect([id, tree.includes(fromFile as string) && tree.includes(toFile as string)]).toEqual([id, true]);
        const callee =
          c.to
            .slice(c.to.indexOf("#") + 1)
            .split(".")
            .at(-1) ?? "";
        expect([id, (textOf(root(), fromFile as string) ?? []).join("\n").includes(callee)]).toEqual([id, true]);
      }
    });

    test("modules: constraint paths exist", () => {
      for (const p of [...truth.modules.together.flat(), ...truth.modules.apart.flat()]) expect([p, tree.includes(p)]).toEqual([p, true]);
    });
  });
}

test("every fixture directory has a truth file (except generated names)", () => {
  const dirs = readdirSync(join(import.meta.dir, "../repos"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const d of dirs) expect([d, NAMES.includes(d as FixtureName)]).toEqual([d, true]);
});

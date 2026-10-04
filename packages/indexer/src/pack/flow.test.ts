import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createSecretScanner, type ModuleId, type RepoPath } from "@mitori/core";
import type { StageFile } from "../resolve/files.ts";
import { input, ref, sf } from "../resolve/test/stage-files.ts";
import { classify, corpusDir, FIXTURES, loadGrammars, loadRepo, parseStageFile } from "../structure/test/corpus.ts";
import { estimateCode, runPipeline } from "../structure/test/pipeline.ts";
import { TEST_TUNING } from "../structure/tuning.ts";
import { flowBodies, flowSeeds, infraRoute, langFamily, moduleStats, walkable } from "./flow.ts";

const FIX = ["ts-small", "go-small", "py-small", "rust-small", "mixed"];

describe("IDX-U flow seeds (gen I4, spec §7.8)", () => {
  for (const name of FIX)
    test(`${name}: ranked main-scope entry points walking existing module edges`, async () => {
      const p = runPipeline((await loadRepo(join(FIXTURES, name))).input);
      const st = p.structure;
      const seeds = flowSeeds(st, p.facts);
      expect(seeds.length).toBeGreaterThan(0);
      expect(seeds.length).toBeLessThanOrEqual(8);
      const edges = new Set(st.leafEdges.map((e) => `${e.from}>${e.to}`));
      seeds.forEach((s, i) => {
        expect(s.k).toBe(i + 1);
        expect(s.modules.length).toBeGreaterThan(0);
        expect(s.modules.length).toBeLessThanOrEqual(7);
        for (let j = 1; j < s.modules.length; j++) expect(edges.has(`${s.modules[j - 1]}>${s.modules[j]}`)).toBe(true);
        expect(new Set(s.modules).size).toBe(s.modules.length);
        // one file per module, each a member of its module
        expect(s.files.length).toBe(s.modules.length);
        s.files.forEach((f, j) => {
          expect(st.moduleOf.get(f)).toBe(s.modules[j] as ModuleId);
        });
      });
      // deterministic, and the limit is honoured
      expect(flowSeeds(runPipeline(p.input).structure, p.facts)).toEqual(seeds);
      expect(flowSeeds(st, p.facts, 1)).toEqual(seeds.slice(0, 1));
    });
});

describe("IDX-U flow bodies (gen I4, spec §7.8 / §7.3 slice rules)", () => {
  for (const name of ["ts-small", "go-small", "py-small"])
    test(`${name}: handler first, numbered lines equal the source, Σ tokens ≤ budget, deterministic`, async () => {
      const repo = await loadRepo(join(FIXTURES, name));
      const p = runPipeline(repo.input);
      const files = new Map<RepoPath, StageFile>(p.input.files.map((f) => [f.path, f]));
      const io = { text: (path: RepoPath) => repo.texts.get(path) ?? null, estimate: estimateCode };
      const seeds = flowSeeds(p.structure, p.facts);
      let some = 0;
      for (const seed of seeds) {
        for (const budget of [4_000, 150]) {
          const slices = flowBodies(seed, files, budget, io);
          expect(slices.reduce((a, s) => a + s.tokens, 0)).toBeLessThanOrEqual(budget);
          expect(flowBodies(seed, files, budget, io)).toEqual(slices);
          for (const s of slices) {
            const src = (repo.texts.get(s.path) ?? "").split("\n");
            for (const l of s.text.split("\n")) {
              if (l === "⋮") continue;
              const m = /^(\d+)\|(.*)$/s.exec(l);
              expect(m).not.toBeNull();
              expect(m?.[2]).toBe(src[Number(m?.[1]) - 1]);
            }
          }
          if (budget === 4_000 && seed.handler) {
            const h = files.get(seed.handler.slice(0, seed.handler.indexOf("#")))?.symbols.find((x) => x.key === seed.handler);
            expect(slices[0]).toMatchObject({ path: h?.path, start: h?.start });
          }
          some += slices.length;
        }
      }
      expect(some).toBeGreaterThan(0);
    });
});

describe("IDX-U flow bodies: long bodies, merging, secrets", () => {
  test("a 250-line handler keeps 80 lines + ⋮; adjacent callees merge; secrets are redacted in place", () => {
    const text = [
      "export function handler() {",
      ...Array.from({ length: 248 }, (_, i) => `  step(${i}); // AKIA4F7Q2Z9XWJ3KLM8N`),
      "}",
      "export function a() { return 1; }",
      "export function b() { return 2; }",
    ].join("\n");
    const sym = (name: string, start: number, end: number) => ({ name, start, end, kind: "function" as const });
    const files = new Map<RepoPath, StageFile>([
      ["src/h.ts", sf("src/h.ts", { symbols: [sym("handler", 1, 250)], refs: [ref("a"), ref("b")] })],
      ["src/x.ts", sf("src/x.ts", { symbols: [sym("a", 251, 251), sym("b", 252, 252)] })],
    ]);
    const seed = {
      k: 1,
      kind: "route" as const,
      label: "GET /",
      path: "src/h.ts",
      line: 1,
      handler: "src/h.ts#handler" as const,
      modules: [],
      files: ["src/h.ts", "src/x.ts"],
    };
    const io = { text: () => text, estimate: estimateCode, secrets: createSecretScanner() };
    const [h, x] = flowBodies(seed, files, 100_000, io);
    expect(h?.text.split("\n")).toHaveLength(81);
    expect(h?.text.endsWith("\n⋮")).toBe(true);
    expect(h?.text).not.toContain("AKIA4F7Q2Z9XWJ3KLM8N");
    expect((h?.redactions ?? 0) > 0).toBe(true);
    expect(x).toMatchObject({ path: "src/x.ts", start: 251, end: 252 });
  });
});

/** A hono app: one router file whose handlers call into two different modules, plus a health check. */
async function routerRepo() {
  const gs = await loadGrammars();
  const pad = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => `export function ${tag}Helper${i}(x: number): number {\n  return x + ${i};\n}`).join("\n");
  const src: Record<string, string> = {
    "src/server/routes.ts": [
      'import { Hono } from "hono";',
      'import { addComment, readComments } from "../session/store";',
      'import * as vcs from "../vcs/git";',
      "const app = new Hono();",
      'app.get("/health", health);',
      'app.post("/comments", withAuth(postComment));',
      'app.get("/files", listFiles);',
      "export function health(c: unknown) {",
      '  return "ok";',
      "}",
      "export function postComment(c: unknown) {",
      "  const all = readComments();",
      '  return addComment(all.length, "body");',
      "}",
      "export function listFiles(c: unknown) {",
      "  return vcs.listTracked(c);",
      "}",
      "function withAuth(h: unknown) {",
      "  return h;",
      "}",
      pad("server", 75),
      "",
    ].join("\n"),
    "src/session/store.ts": [
      'import { listTracked } from "../vcs/git";',
      "export function addComment(n: number, body: string): number {",
      "  return n + body.length + listTracked(n).length;",
      "}",
      "export function readComments(): number[] {",
      "  return [];",
      "}",
      pad("store", 75),
      "",
    ].join("\n"),
    "src/vcs/git.ts": ["export function listTracked(c: unknown): string[] {", "  return [String(c)];", "}", pad("git", 75), ""].join("\n"),
  };
  const files = Object.entries(src).map(([path, text]) => {
    const c = classify(path, text.length, text);
    return parseStageFile(path, text, c, c.grammar ? gs[c.grammar] : null, `b:${path}`);
  });
  const p = runPipeline(input(files), { tuning: TEST_TUNING });
  const byPath = new Map(p.input.files.map((f) => [f.path, f]));
  const sources = { files: byPath, text: (x: RepoPath) => src[x] ?? null, imports: (x: RepoPath) => p.resolved.imports.get(x) ?? [] };
  return { p, sources };
}

describe("gen #4c flow seeds follow the handler, not the router file", () => {
  test("each handler of one router file is a flow of its own, walking where its calls go; the health check comes last", async () => {
    const { p, sources } = await routerRepo();
    const st = p.structure;
    const mod = (x: string) => st.moduleOf.get(x);
    // the case needs three modules
    expect(new Set([mod("src/server/routes.ts"), mod("src/session/store.ts"), mod("src/vcs/git.ts")]).size).toBe(3);
    const seeds = flowSeeds(st, p.facts, 8, sources);
    expect(seeds.map((s) => s.label)).toEqual(["POST /comments", "GET /files", "GET /health"]);
    expect(seeds[0]?.files.slice(0, 2)).toEqual(["src/server/routes.ts", "src/session/store.ts"]);
    expect(seeds[1]?.files.slice(0, 2)).toEqual(["src/server/routes.ts", "src/vcs/git.ts"]);
    expect(seeds[0]?.handler).toBe("src/server/routes.ts#postComment" as never);
    // flowBodies: the handler, then what it calls on the first hop (not every callee of the router file)
    const io = { text: sources.text, estimate: estimateCode };
    const bodies = flowBodies(seeds[0] as NonNullable<(typeof seeds)[0]>, sources.files, 4_000, io);
    expect(bodies[0]?.text).toContain("postComment");
    expect(bodies.map((b) => b.path)).toContain("src/session/store.ts");
    expect(bodies.some((b) => b.text.includes("readComments"))).toBe(true);
    // deterministic
    expect(flowSeeds(st, p.facts, 8, sources)).toEqual(seeds);
  });

  test("without texts the module walk still dedupes (the file-level walk is all there is)", async () => {
    const { p } = await routerRepo();
    const seeds = flowSeeds(p.structure, p.facts);
    expect(seeds.length).toBe(1);
    // the health check is ranked after the others even without texts
    expect(seeds[0]?.label).not.toBe("GET /health");
  });

  test("infra routes and walk targets", () => {
    for (const pattern of ["/api/health", "/healthz", "/version", "/metrics", "/static/app.js", "/live-mode.js", "/favicon.ico", "/debug/pprof/"])
      expect(infraRoute({ pattern, handler: "a.go#Server.handleX" as never })).toBe(true);
    expect(infraRoute({ pattern: "/live", handler: "a.go#Server.serveIndexHTML" as never })).toBe(true);
    expect(infraRoute({ pattern: "/api/comments" })).toBe(true); // no handler: nothing to walk from
    expect(infraRoute({ pattern: "/api/comments", handler: "a.go#Server.handleReviewComments" as never })).toBe(false);
    const files = new Map<RepoPath, StageFile>([
      ["web/embed.go", sf("web/embed.go", { lang: "go", symbols: [{ name: "Assets", kind: "var" }] })],
      ["scripts/bench.py", sf("scripts/bench.py", { lang: "python", scope: "tooling", symbols: [{ name: "main" }] })],
      ["internal/session/session.go", sf("internal/session/session.go", { lang: "go", symbols: [{ name: "AddComment", kind: "method" }] })],
      ["web/app.js", sf("web/app.js", { lang: "javascript", symbols: [{ name: "boot" }] })],
    ]);
    expect(walkable("web/embed.go", files)).toBe(false); // data only
    expect(walkable("scripts/bench.py", files)).toBe(false); // tooling
    expect(walkable("internal/session/session.go", files, langFamily("go"))).toBe(true);
    expect(walkable("web/app.js", files, langFamily("go"))).toBe(false); // a Go walk never steps into JS
  });
});

const crit = corpusDir("crit");

describe.skipIf(!crit)("IDX-AT-48 flow seeds on crit", () => {
  test("≥ 5 seeds, each a contiguous path over effective module edges, one member file per module", async () => {
    const p = runPipeline((await loadRepo(crit as string)).input);
    const st = p.structure;
    const seeds = flowSeeds(st, p.facts);
    expect(seeds.length).toBeGreaterThanOrEqual(5);
    const edges = new Set(st.leafEdges.map((e) => `${e.from}>${e.to}`));
    for (const s of seeds) {
      for (let j = 1; j < s.modules.length; j++) expect(edges.has(`${s.modules[j - 1]}>${s.modules[j]}`)).toBe(true);
      s.files.forEach((f, j) => {
        expect(st.moduleOf.get(f)).toBe(s.modules[j] as ModuleId);
      });
    }
    expect(seeds[0]?.kind).toBe("route"); // routes first (spec §7.8)
    expect(seeds.some((s) => s.kind === "cli")).toBe(true);
  }, 60_000);

  test("gen #4c with the handler texts: the review loop's handlers are seeds, the health check and assets are not on top, no walk into scripts / JS", async () => {
    const repo = await loadRepo(crit as string);
    const p = runPipeline(repo.input);
    const st = p.structure;
    const files = new Map<RepoPath, StageFile>(p.input.files.map((f) => [f.path, f]));
    const src = { files, text: (x: RepoPath) => repo.texts.get(x) ?? null, imports: (x: RepoPath) => p.resolved.imports.get(x) ?? [] };
    const seeds = flowSeeds(st, p.facts, 8, src);
    const routes = seeds.filter((s) => s.kind === "route");
    // before: `/api/health` (line 136, the first route) was seed 1 and every wrapped handler shared its walk
    expect(routes[0]?.label).not.toBe("ANY /api/health");
    for (const s of routes.slice(0, 3))
      expect(infraRoute({ pattern: s.label.split(" ")[1] as string, ...(s.handler ? { handler: s.handler } : {}) })).toBe(false);
    const core = routes.filter((s) => /comment|review|round|finish|event/.test(s.label));
    expect(core.length).toBeGreaterThanOrEqual(2);
    for (const s of core) expect(s.files[1]).toMatch(/^internal\/session\//); // they reach the session first
    // distinct handlers, never collapsed onto one module walk
    expect(new Set(routes.map((s) => s.handler)).size).toBe(routes.length);
    expect(new Set(routes.map((s) => s.files.join(">"))).size).toBeGreaterThan(1);
    for (const s of seeds)
      for (const f of s.files.slice(1)) {
        expect(files.get(f)?.scope).toBe("main");
        expect(langFamily(files.get(f)?.lang ?? "")).toBe(langFamily(files.get(s.files[0] as RepoPath)?.lang ?? ""));
      }
    expect(seeds.some((s) => s.kind === "cli")).toBe(true);
    expect(seeds.some((s) => s.kind === "entry")).toBe(true);
  }, 60_000);
});

describe("IDX-U module stats (gen I3)", () => {
  for (const name of FIX)
    test(`${name}: leaf counts add up and edges match the module graph`, async () => {
      const p = runPipeline((await loadRepo(join(FIXTURES, name))).input);
      const st = p.structure;
      const files = new Map<RepoPath, StageFile>(p.input.files.map((f) => [f.path, f]));
      expect(moduleStats("md_nope" as ModuleId, st, p.facts, files)).toBeNull();
      const leaves = st.modules.filter((m) => m.paths.length > 0);
      let total = 0;
      for (const m of leaves) {
        const s = moduleStats(m.id, st, p.facts, files);
        if (!s) throw new Error(`no stats for ${m.id}`);
        expect(s.files).toBe(m.paths.length);
        expect(s.loc).toBe(m.loc);
        expect(s.exportedSymbols).toBeLessThanOrEqual(s.symbols);
        expect(s.testFiles).toBe(new Set(m.tests).size);
        const out = st.leafEdges.filter((e) => e.from === m.id && e.to !== m.id);
        expect(s.depsOut.map((d) => d.module).sort()).toEqual(out.map((e) => e.to).sort());
        for (let i = 1; i < s.depsOut.length; i++)
          expect((s.depsOut[i - 1] as { weight: number }).weight).toBeGreaterThanOrEqual((s.depsOut[i] as { weight: number }).weight);
        total += s.symbols;
      }
      const memberSymbols = leaves.flatMap((m) => m.paths).reduce((n, path) => n + (files.get(path)?.symbols.length ?? 0), 0);
      expect(total).toBe(memberSymbols);
      // a parent aggregates its leaves
      const parent = st.modules.find((m) => m.paths.length === 0);
      if (parent) {
        const s = moduleStats(parent.id, st, p.facts, files);
        const kids = leaves.filter((m) => m.parent === parent.id || st.modules.find((x) => x.id === m.parent)?.parent === parent.id);
        expect(s?.files).toBe(kids.reduce((n, m) => n + m.paths.length, 0));
      }
    });
});

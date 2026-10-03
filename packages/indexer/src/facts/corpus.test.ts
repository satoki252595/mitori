/** Corpus acceptance for import resolution and facts (spec §12.3). Skips when the pinned corpus is not fetched. */
import { describe, expect, test } from "bun:test";
import type { CliFact, EnvFact, RouteFact } from "@mitori/core";
import { corpusDir, loadRepo } from "../structure/test/corpus.ts";
import { mainFacts, runPipeline } from "../structure/test/pipeline.ts";

const crit = corpusDir("crit");
const ripgrep = corpusDir("ripgrep");
const hono = corpusDir("hono");

describe.skipIf(!crit)("crit (Go + JS)", () => {
  const load = async () => runPipeline((await loadRepo(crit as string)).input);

  test("IDX-AT-24 crit: ≥ 62 main routes (60 literal + 2 concatenated, dynamic) on net/http with handlers", async () => {
    const p = await load();
    const routes = mainFacts(p, "route") as RouteFact[];
    expect(routes.length).toBeGreaterThanOrEqual(62);
    expect(routes.filter((r) => !r.dynamic).length).toBeGreaterThanOrEqual(60);
    expect(routes.filter((r) => r.dynamic).map((r) => r.pattern)).toEqual(["/{…}", "/{…}"]);
    expect(new Set(routes.map((r) => r.framework))).toEqual(new Set(["net/http"]));
    expect(routes.filter((r) => r.handler !== undefined).length).toBeGreaterThanOrEqual(40);
    expect(routes.find((r) => r.pattern === "/api/share")?.handler).toBe("internal/server/server.go#Server.handleShare");
  }, 60_000);

  test("IDX-AT-25 crit: env 17 (code reads, test files excluded), registry CLI 24, entry cmd/crit", async () => {
    const p = await load();
    const env = (mainFacts(p, "env") as EnvFact[]).filter((f) => f.detector !== "env.files@1");
    expect(new Set(env.map((f) => f.name)).size).toBe(17);
    const cli = mainFacts(p, "cli") as CliFact[];
    expect(cli.filter((c) => c.framework === "registry").length).toBe(24);
    expect(cli.some((c) => c.command === "crit review")).toBe(true);
    expect(mainFacts(p, "entry").some((e) => e.kind === "entry" && e.entry === "main" && e.label === "cmd/crit")).toBe(true);
  }, 60_000);

  test("IDX-AT-22 crit: every internal/* Go import resolves to package files", async () => {
    const p = await load();
    const all = [...p.resolved.imports.values()].flat().filter((r) => r.from.endsWith(".go") && /\/internal\//.test(r.spec) && r.spec.startsWith("github.com/tomasz-tomczyk/crit"));
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((r) => r.to.length === 0).map((r) => `${r.from} ${r.spec}`)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!ripgrep)("ripgrep (Rust workspace, own CLI)", () => {
  test("IDX-AT-23 ripgrep: `use crate::` in crates/* resolves ≥ 98 %", async () => {
    const p = runPipeline((await loadRepo(ripgrep as string)).input);
    const uses = [...p.resolved.imports.values()].flat().filter((r) => r.from.startsWith("crates/") && r.kind !== "mod" && /^crate::/.test(r.spec.trim()));
    const ok = uses.filter((r) => r.to.length > 0).length;
    expect(uses.length).toBeGreaterThan(50);
    expect(ok / uses.length).toBeGreaterThanOrEqual(0.98);
  }, 60_000);

  test("IDX-AT-25 ripgrep: no clap-derived CLI (lexopt), env reads found", async () => {
    const p = runPipeline((await loadRepo(ripgrep as string)).input);
    expect(mainFacts(p, "cli").filter((c) => c.kind === "cli" && c.framework === "clap")).toEqual([]);
    expect(new Set((mainFacts(p, "env") as EnvFact[]).map((e) => e.name)).size).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

describe.skipIf(!hono)("hono (TS library, many tests)", () => {
  test("IDX-AT-24 hono: test files contribute no routes; the library defines none in src/**", async () => {
    const p = runPipeline((await loadRepo(hono as string)).input);
    const routes = mainFacts(p, "route") as RouteFact[];
    const fromTests = p.facts.facts.filter((f, i) => f.kind === "route" && p.facts.scopes[i] === "test");
    expect(fromTests).toEqual([]);
    expect(routes.filter((r) => r.path.startsWith("src/")).map((r) => `${r.path}:${r.line} ${r.method} ${r.pattern}`)).toEqual([]);
  }, 60_000);
});

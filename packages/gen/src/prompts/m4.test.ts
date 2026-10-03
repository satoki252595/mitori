import { describe, expect, test } from "bun:test";
import { makeS9Harness, type S9Harness } from "../incremental/test/harness.ts";
import { dataSection } from "../incremental/test/router.ts";
import { type FakeRepo, sampleRepo } from "../test/repo.ts";

/** The sample repo plus the facts the M4 section prompts read. */
function m4Repo(): FakeRepo {
  const repo = sampleRepo();
  repo.files["docs/adr/0001-memory.md"] = "# Keep sessions in memory\n\nWe keep sessions in memory because one person uses the app.\n";
  repo.facts.push(
    { kind: "schema", detector: "schema.test@1", path: "src/session/store.ts", line: 2, entity: "Session", source: "ts", fields: ["id", "expiresAt"] },
    { kind: "todo", detector: "todo.test@1", path: "src/auth/login.ts", line: 4, marker: "TODO", text: "derive the id from a random token" },
    { kind: "env", detector: "env.test@1", path: "src/cli/main.ts", line: 2, name: "TSUNDOKU_USER", hasDefault: true },
    { kind: "dependency", detector: "dep.test@1", path: "README.md", line: 1, ecosystem: "npm", name: "jose", version: "5.9.0", dev: false },
    { kind: "existing_doc", detector: "doc.test@1", path: "docs/adr/0001-memory.md", line: 1, role: "adr", title: "Keep sessions in memory" },
  );
  return repo;
}

async function generated(opts: Parameters<typeof makeS9Harness>[0] = {}): Promise<S9Harness> {
  const h = makeS9Harness({ repo: m4Repo(), ...opts });
  await h.applyStatic();
  const { run } = await h.generate("standard");
  expect(run?.run.state).toBe("done");
  return h;
}

const unitOf = (h: S9Harness, prompt: string) => h.engine.calls.find((c) => c.call.spec.id === prompt)?.call.layout.unit ?? "";

describe("GEN-M4-01 the section prompts run in a standard generation with their DATA (§5.2, §5.6.5–5.6.8)", () => {
  test("datamodel: SCHEMA fact lines and the numbered definition", async () => {
    const h = await generated();
    const u = unitOf(h, "gen.datamodel");
    expect(dataSection(u, "SCHEMA").slice(0, 2)).toEqual([
      "> S Session ts fields=id,expiresAt src/session/store.ts:2",
      "=== src/session/store.ts · lines 1-25",
    ]);
    expect(dataSection(u, "SCHEMA")).toContain("2|export interface Session {");
    expect(u).toContain("TASK: Explain the data model for section s7, based on SCHEMA.");
    expect(h.aiBlocks("s7").map((b) => b.aspect)).toEqual(["overview"]);
  });

  test("quality: CLAIMS of the quality kinds, FACTS with env vars, security dependencies and the route count", async () => {
    const h = await generated();
    const u = unitOf(h, "gen.quality");
    expect(dataSection(u, "FACTS")).toEqual(["> V TSUNDOKU_USER default src/cli/main.ts:2", "> P npm jose 5.9.0", "> R 1 routes"]);
    // the scripted module pages only make behavior claims: none qualifies
    expect(dataSection(u, "CLAIMS")).toEqual([]);
    expect(h.aiBlocks("s9").map((b) => [b.aspect, b.kind])).toEqual([["hotpaths", "prose"]]);
  });

  test("decisions: design documents (not the README) and architecture claims", async () => {
    const h = await generated();
    const u = unitOf(h, "gen.decisions");
    expect(dataSection(u, "DOCS")[0]).toBe("=== docs/adr/0001-memory.md · lines 1-3");
    expect(dataSection(u, "DOCS").join("\n")).not.toContain("README.md");
  });

  test("risks: TODOS, UNTESTED (modules without tests) and LARGE", async () => {
    const h = await generated();
    const u = unitOf(h, "gen.risks");
    expect(dataSection(u, "TODOS")).toEqual(["> TODO src/auth/login.ts:4 derive the id from a random token"]);
    expect(dataSection(u, "UNTESTED").length).toBe(4);
    expect(dataSection(u, "UNTESTED")[0]).toMatch(/^> md_a0000001 "名前01" loc=\d+ rank=0\.90$/);
    expect(dataSection(u, "LARGE")[0]).toMatch(/^> src\/session\/store\.ts lines=25 module=md_a0000001$/);
  });
});

describe("GEN-M4-02 open questions (§13, §5.6.10)", () => {
  test("up to 15 raw questions are written as is, without an engine call; a rerun keeps the same blocks", async () => {
    const h = await generated({ router: { questionsPerModule: 2 } });
    expect(h.engine.calls.some((c) => c.call.spec.id === "gen.questions")).toBe(false);
    const qs = h.aiBlocks("s13");
    expect(qs.length).toBe(8);
    expect(qs.every((b) => b.kind === "question")).toBe(true);
    expect(h.doc.markerForm(qs[0]?.id as never)).toMatch(/^\*\*.+\*\*：md_a\w{7} の問い 1$/);
    const ids = qs.map((b) => b.id);
    const { run } = await h.generate("standard");
    expect(run?.tasks.find((t) => t.target.id === "s13")?.state).toBe("cached");
    expect(h.aiBlocks("s13").map((b) => b.id)).toEqual(ids);
  });

  test("more than 15 are consolidated by gen.questions", async () => {
    const h = await generated({ router: { questionsPerModule: 4 } });
    const u = unitOf(h, "gen.questions");
    expect(dataSection(u, "RAW").length).toBe(16);
    expect(dataSection(u, "RAW")[0]).toMatch(/^> q1 s6\/\w+ \| md_a\w{7} の問い 1 \| $/);
    expect(h.aiBlocks("s13").map((b) => h.doc.markerForm(b.id))).toEqual(["統合した問い（16 件から）"]);
  });
});

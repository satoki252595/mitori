import { describe, expect, test } from "bun:test";
import type { RepoPath } from "@mitori/core";
import { makeS9Harness, type S9Harness } from "../incremental/test/harness.ts";
import { dataSection, s9Router } from "../incremental/test/router.ts";
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
  test("a scoped s13 resume reads current producer outputs, replacing an old module version without regenerating modules", async () => {
    let revision = 0;
    const router = s9Router({ questionsPerModule: 4 });
    const h = makeS9Harness({
      repo: m4Repo(),
      router(call, turn) {
        const reply = router(call, turn);
        if (call.spec.id !== "gen.module" || !reply.lines) return reply;
        return {
          ...reply,
          lines: reply.lines.map((raw) => {
            const line = JSON.parse(raw);
            if (line.t === "question") line.text += `（版${revision}）`;
            if (line.t === "block" && line.aspect === "responsibility") line.md = `版${revision}: ${line.md}`;
            return JSON.stringify(line);
          }),
        };
      },
    });
    await h.applyStatic();
    const first = await h.gen.estimate({ effort: "standard", scope: ["s6"] });
    expect((await h.runEstimate(first.id))?.run.state).toBe("done");
    expect(h.aiBlocks("s13")).toHaveLength(0);
    const module = h.doc.index().modules.find((m) => m.id === "md_a0000001");
    expect(module).toBeDefined();
    revision = 1;
    h.clock.advance(1000);
    h.edit("src/session/store.ts" as RepoPath, (h.repo.files["src/session/store.ts"] ?? "").replace("put(s: Session): void {", "put(s: Session): boolean {"));
    await h.applyStatic();
    const newer = await h.gen.estimate({ effort: "standard", scope: [module?.section as never] });
    const updated = await h.runEstimate(newer.id);
    expect(updated?.run.state).toBe("done");
    expect(h.aiBlocks(module?.section as never).find((b) => b.aspect === "responsibility")?.gen?.run).toBe(updated?.run.id);
    const moduleCalls = h.engine.calls.filter((c) => c.call.spec.id === "gen.module").length;
    h.clock.advance(1000);
    const est = await h.gen.estimate({ effort: "standard", scope: ["s13"] });
    expect((await h.runEstimate(est.id))?.run.state).toBe("done");
    const raw = dataSection(unitOf(h, "gen.questions"), "RAW");
    expect(raw).toHaveLength(16);
    expect(raw.filter((q) => q.includes("md_a0000001"))).toHaveLength(4);
    expect(raw.filter((q) => q.includes("md_a0000001")).every((q) => q.includes("版1"))).toBe(true);
    expect(h.engine.calls.filter((c) => c.call.spec.id === "gen.module")).toHaveLength(moduleCalls);
    expect(h.aiBlocks("s13").map((b) => h.doc.markerForm(b.id))).toEqual(["統合した問い（16 件から）"]);
    expect(h.doc.section("s13")?.blocks.some((b) => b.kind === "placeholder")).toBe(false);
  });

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

describe("GEN-M4-03 complete effort: per-file notes (S8 gen.deepdive files, §3.2, §5.6.12)", () => {
  test("every paged leaf gets per-file notes from a FILES chunk; a rerun replays them from the cache", async () => {
    const h = makeS9Harness({ repo: m4Repo() });
    await h.applyStatic();
    const { run } = await h.generate("complete");
    expect(run?.run.state).toBe("done");
    const calls = h.engine.calls.filter((c) => c.call.spec.id === "gen.deepdive");
    expect(calls.length).toBe(4);
    const session = calls.find((c) => c.call.layout.unit.includes("=== src/session/store.ts"))?.call.layout.unit ?? "";
    expect(session).toContain("TASK: Write per-file notes for module md_a0000001");
    expect(dataSection(session, "FILES").slice(0, 2)).toEqual(["=== src/session/store.ts · lines 1-25", "1|// Session store keeps sessions in memory."]);
    expect(dataSection(session, "EXISTING")).toEqual([]);
    expect(run?.tasks.filter((t) => t.stage === "S8").map((t) => t.state)).toEqual(["done", "done", "done", "done"]);
    const page = h.doc.index().modules.find((e) => e.id === "md_a0000001")?.section ?? "";
    const notes = h.aiBlocks(page).filter((b) => b.aspect === "files");
    expect(notes.map((b) => [b.kind, b.depth])).toEqual([["deepdive", "L3"]]);
    expect(h.doc.markerForm(notes[0]?.id as never)).toBe("`src/session/store.ts` の中身を説明する[[1]]。");
    // a second run replays every task from the cache and keeps the notes as they are
    const again = await h.generate("complete");
    expect(again.run?.tasks.filter((t) => t.stage === "S8").every((t) => t.state === "cached")).toBe(true);
    expect(
      h
        .aiBlocks(page)
        .filter((b) => b.aspect === "files")
        .map((b) => b.id),
    ).toEqual(notes.map((b) => b.id));
  });

  test("a later module page regeneration neither lists nor removes the per-file notes (verifier 2026-10-04)", async () => {
    const h = makeS9Harness({ repo: m4Repo() });
    await h.applyStatic();
    await h.generate("complete");
    const page = h.doc.index().modules.find((e) => e.id === "md_a0000001")?.section ?? "";
    const notes = h.aiBlocks(page).filter((b) => b.aspect === "files");
    expect(notes.length).toBe(1);
    const before = h.engine.calls.filter((c) => c.call.spec.id === "gen.module").length;
    // a signature change in the module: the standard run regenerates its page (new SKELETON ⇒ new cache key)
    const path = "src/session/store.ts" as RepoPath;
    h.edit(path, (h.repo.files[path] ?? "").replace("put(s: Session): void {", "put(s: Session): boolean {"));
    await h.applyStatic();
    const { run } = await h.generate("standard");
    expect(run?.run.state).toBe("done");
    const regen = h.engine.calls.filter((c) => c.call.spec.id === "gen.module").slice(before);
    const unit = regen.find((c) => c.call.layout.unit.includes("md_a0000001"))?.call.layout.unit ?? "";
    expect(unit).not.toBe("");
    // EXISTING of the page lists its own blocks only, never a note
    const listed = dataSection(unit, "EXISTING");
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some((l) => l.includes("aspect=files"))).toBe(false);
    expect(
      h
        .aiBlocks(page)
        .filter((b) => b.aspect === "files")
        .map((b) => b.id),
    ).toEqual(notes.map((b) => b.id));
  });
});

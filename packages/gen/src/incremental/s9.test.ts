import { describe, expect, test } from "bun:test";
import type { BlockId, IndexDelta, ModuleId, ModuleInfo, SectionId } from "@mitori/core";
import type { ClaimReanchor, IncrementalOutcome } from "../contract.ts";
import type { RepoFact } from "../test/repo.ts";
import { M_CLI, M_CORE, M_SESSION } from "../test/repo.ts";
import { makeS9Harness, type S9Harness } from "./test/harness.ts";

const STORE = "src/session/store.ts";
const MAIN = "src/cli/main.ts";

async function generated(opts: Parameters<typeof makeS9Harness>[0] = {}, setup?: (h: S9Harness) => void) {
  const h = makeS9Harness(opts);
  setup?.(h);
  await h.applyStatic();
  const { run } = await h.generate("standard");
  expect(run?.run.state).toBe("done");
  return h;
}

const brief = (o: IncrementalOutcome) => o.suggestions.map((s) => `${s.rule} ${s.kind} ${s.section} ${s.prompt}`);
const replace = (h: S9Harness, path: string, from: string, to: string) => h.edit(path, (h.repo.files[path] as string).replace(from, to));
const none: ClaimReanchor = { moved: [], overlapped: [], outdated: [] };

/** A delta that changes nothing (recompute the suggestions over the current state). */
function quiet(h: S9Harness, over: Partial<IndexDelta> = {}): { delta: IndexDelta; claims: ClaimReanchor } {
  return {
    delta: {
      snapshot: h.indexer.snapshot() as IndexDelta["snapshot"],
      changed: [],
      renames: [],
      bodyOnly: [],
      symbols: [],
      ifaceChanged: [],
      membershipChanged: [],
      factsChanged: false,
      factKinds: [],
      structureRefreshed: false,
      ...over,
    },
    claims: none,
  };
}

const interfaceBlock = (h: S9Harness) => h.aiBlocks("s6/session").find((b) => b.aspect === "interface")?.id as BlockId;

describe("GEN-S9-01 static marking (§11.2)", () => {
  test("overlapped claims turn stale with their blocks; moved claims take the new blob; a second pass writes nothing", async () => {
    const h = await generated();
    const { delta, claims } = replace(h, STORE, "export interface Session {", "export interface Session { // v2");
    expect(claims.overlapped.length).toBe(2);
    const out = await h.gen.onIndexDelta({ delta, claims });
    expect(out.staleClaims).toEqual([...claims.overlapped].sort());
    for (const id of out.staleClaims) expect(h.doc.index().claims[id]?.verdict).toBe("stale");
    for (const b of out.staleBlocks) expect(h.doc.block(b)?.freshness).toBe("stale");
    expect(out.movedClaims).toEqual(claims.moved.map((m) => m.claim).sort());
    for (const m of claims.moved) expect(h.doc.index().claims[m.claim]?.cites[0]?.blob).toBe(h.indexer.currentBlob(STORE) as string);
    expect(out.staticRefreshed).toEqual([]);
    const labels = h.write.labels.length;
    const again = await h.gen.onIndexDelta({ delta, claims });
    expect(again.staleClaims).toEqual(out.staleClaims);
    expect(h.write.labels.slice(labels)).not.toContain("gen.s9.mark");
  });
});

describe("GEN-S9-02 R3: a few stale claims ⇒ doc.sync of the stale blocks (D12)", () => {
  test("the suggestion carries a stored, startable estimate; nothing runs until it is started; its run only proposes", async () => {
    const h = await generated({ router: { syncRewrite: true } });
    const calls = h.engine.calls.length;
    const { delta, claims } = replace(h, STORE, "export class ErrExpired extends Error {}", "export class ErrExpired extends Error { code = 1 }");
    expect(claims.overlapped.length).toBe(1);
    const t0 = performance.now();
    const out = await h.gen.onIndexDelta({ delta, claims });
    const ms = performance.now() - t0;
    expect(brief(out)).toEqual(["R3 sync s6/session doc.sync"]);
    const s = out.suggestions[0];
    expect(s?.reason).toBe("stale_ratio");
    expect(s?.blocks).toEqual([interfaceBlock(h)]);
    expect(s?.id).toMatch(/^sg_[0-9a-hjkmnp-tv-z]{8}$/);
    expect(s?.estimate.requiresConfirm).toBe(false);
    expect((s?.estimate.inTokens ?? 0) + (s?.estimate.cacheWriteTokens ?? 0)).toBeGreaterThan(0);
    expect(h.store.getEstimate(s?.estimate.id as string)?.req).toMatchObject({ trigger: "incremental", lane: "doc" });
    expect(h.engine.calls.length).toBe(calls);
    expect(ms).toBeLessThan(200);

    const before = h.doc.block(interfaceBlock(h))?.hash;
    const run = await h.runEstimate(s?.estimate.id as string);
    expect(run?.run).toMatchObject({ trigger: "incremental", state: "done" });
    expect(h.engine.calls.slice(calls).map((c) => [c.call.spec.id, c.call.lane])).toEqual([["doc.sync", "doc"]]);
    expect(h.doc.block(interfaceBlock(h))?.hash).toBe(before as string);
    const proposals = h.doc.proposals({ state: "pending" });
    expect(proposals.map((p) => [p.source.kind, p.block, p.op])).toEqual([["sync", interfaceBlock(h), "update"]]);
    // while the proposal waits for a human, the block is not suggested again
    expect(brief(await h.gen.onIndexDelta(quiet(h)))).toEqual([]);
    h.doc.acceptProposal(proposals[0]?.id as never);
    expect(h.doc.claims(interfaceBlock(h)).some((c) => c.verdict === "stale")).toBe(false);
    expect(brief(await h.gen.onIndexDelta(quiet(h)))).toEqual([]);
  });

  test("a sync that keeps the text only re-cites: the claims are fresh again without a proposal", async () => {
    const h = await generated();
    const { delta, claims } = replace(h, STORE, "export class ErrExpired extends Error {}", "export class ErrExpired extends Error { code = 1 }");
    const out = await h.gen.onIndexDelta({ delta, claims });
    await h.runEstimate(out.suggestions[0]?.estimate.id as string);
    expect(h.doc.proposals({ state: "pending" })).toEqual([]);
    expect(h.doc.claims(interfaceBlock(h)).every((c) => c.verdict !== "stale")).toBe(true);
    expect(brief(await h.gen.onIndexDelta(quiet(h)))).toEqual([]);
  });

  test("excludeBlocks (updated by an accepted fix job) are not suggested again", async () => {
    const h = await generated();
    const { delta, claims } = replace(h, STORE, "export class ErrExpired extends Error {}", "export class ErrExpired extends Error { code = 1 }");
    const out = await h.gen.onIndexDelta({ delta, claims, excludeBlocks: [interfaceBlock(h)] });
    expect(out.staleClaims.length).toBe(1);
    expect(out.suggestions).toEqual([]);
  });
});

describe("GEN-S9-03 R2: stale ratio > 20 % regenerates the page instead", () => {
  test("R2 beats R3 on the same page; the regeneration's output is a proposal and clears the suggestion", async () => {
    const h = await generated();
    const { delta, claims } = replace(h, STORE, "export interface Session {", "export interface Session { // v2");
    const out = await h.gen.onIndexDelta({ delta, claims });
    expect(brief(out)).toEqual(["R2 regen s6/session gen.module"]);
    expect(out.suggestions[0]?.reason).toBe("stale_ratio");
    const calls = h.engine.calls.length;
    const run = await h.runEstimate(out.suggestions[0]?.estimate.id as string);
    expect(run?.run.trigger).toBe("incremental");
    expect(h.engine.calls.slice(calls).map((c) => c.call.spec.id)).toEqual(["gen.module"]);
    expect(h.engine.calls.at(-1)?.call.layout.unit).toContain("TASK: Regenerate.");
    // the scripted page keeps its text: the re-verified claims are recorded, nothing is left stale
    expect(h.aiBlocks("s6/session").length).toBe(2);
    expect(
      h
        .aiBlocks("s6/session")
        .flatMap((b) => h.doc.claims(b.id))
        .some((c) => c.verdict === "stale"),
    ).toBe(false);
    expect(brief(await h.gen.onIndexDelta(quiet(h)))).toEqual([]);
  });
});

describe("GEN-S9-04 R1 / R4: interface digests", () => {
  test("a leaf's interface change regenerates its page; the parent follows only when its own digest changed", async () => {
    const h = await generated();
    h.setIface(M_SESSION, "iface-v2");
    const a = replace(h, STORE, "    if (!s) return undefined;", "    if (!s) return undefined; // no session");
    const out = await h.gen.onIndexDelta({ ...a, delta: { ...a.delta, ifaceChanged: [M_SESSION], bodyOnly: [] } });
    expect(brief(out)).toEqual(["R1 regen s6/session gen.module"]);
    expect(out.suggestions[0]?.reason).toBe("iface_changed");
    // core is a top-level parent: its digest is also part of the structure the overview was written against (R7)
    h.setIface(M_CORE, "core-v2");
    expect(brief(await h.gen.onIndexDelta(quiet(h, { ifaceChanged: [M_CORE] })))).toEqual([
      "R7 regen s0 gen.overview",
      "R4 regen s6/core gen.parent",
      "R1 regen s6/session gen.module",
    ]);
  });

  test("a parent's digest alone does not regenerate its page (no upward propagation without a child R1)", async () => {
    const h = await generated();
    h.setIface(M_CORE, "core-v2");
    expect(brief(await h.gen.onIndexDelta(quiet(h, { ifaceChanged: [M_CORE] })))).toEqual(["R7 regen s0 gen.overview"]);
  });

  test("suggestions accumulate across deltas with a stable id; the replaced list's estimates are dropped", async () => {
    const h = await generated();
    h.setIface(M_SESSION, "iface-v2");
    const first = await h.gen.onIndexDelta(quiet(h, { ifaceChanged: [M_SESSION] }));
    const b = replace(h, MAIN, 'console.log(handleLogin(process.argv[2] ?? "guest"));', 'console.log(handleLogin(process.argv[2] ?? "anon"));');
    const second = await h.gen.onIndexDelta(b);
    expect(brief(second)).toEqual(brief(first));
    expect(second.suggestions[0]?.id).toBe(first.suggestions[0]?.id);
    expect(h.store.getEstimate(first.suggestions[0]?.estimate.id as string)).toBeNull();
    expect(h.store.getEstimate(second.suggestions[0]?.estimate.id as string)).not.toBeNull();
    // running it records the new baseline: the suggestion is gone
    await h.runEstimate(second.suggestions[0]?.estimate.id as string);
    expect(brief(await h.gen.onIndexDelta(quiet(h)))).toEqual([]);
  });
});

describe("GEN-S9-05 R5 / R6: facts", () => {
  const route = (line: number, pattern = "/logout"): RepoFact => ({
    kind: "route",
    detector: "route.test@1",
    path: "src/http/server.ts",
    line,
    method: "POST",
    pattern,
    handler: "src/http/server.ts#handleLogin",
    framework: "test",
  });

  test("a new route regenerates the flows (§3); the same routes on other lines do not", async () => {
    const h = await generated();
    h.repo.facts.push(route(6));
    expect(brief(await h.gen.onIndexDelta(quiet(h, { factsChanged: true, factKinds: ["route"] })))).toEqual(["R5 regen s3 gen.flows"]);
    const g = await generated();
    const r = g.repo.facts.find((f) => f.kind === "route");
    if (r) r.line = 6;
    expect(brief(await g.gen.onIndexDelta(quiet(g, { factsChanged: true, factKinds: ["route"] })))).toEqual([]);
  });

  test("a schema change regenerates the data model (§7)", async () => {
    const schema: RepoFact = { kind: "schema", detector: "schema.test@1", path: STORE, line: 2, entity: "Session", source: "ts", fields: ["id", "expiresAt"] };
    const h = await generated({}, (x) => x.repo.facts.push(schema));
    expect(h.aiBlocks("s7").map((b) => b.aspect)).toEqual(["overview"]);
    schema.fields.push("user");
    const out = await h.gen.onIndexDelta(quiet(h, { factsChanged: true, factKinds: ["schema"] }));
    expect(brief(out)).toEqual(["R6 regen s7 gen.datamodel"]);
    expect(out.suggestions[0]?.reason).toBe("facts_changed");
  });
});

describe("GEN-S9-06 R7: module structure", () => {
  test("a membership change regenerates the overview; new modules without a name get their labels", async () => {
    const h = await generated();
    const cli = h.indexer.modules().find((m) => m.id === M_CLI) as ModuleInfo;
    cli.membersDigest = "members-v2";
    expect(brief(await h.gen.onIndexDelta(quiet(h, { membershipChanged: [M_CLI] })))).toEqual(["R7 regen s0 gen.overview"]);
    const fresh: ModuleInfo = { ...cli, id: "md_a0000009" as ModuleId, slug: "tools", name: "tools x", paths: [], membersDigest: "m9" };
    h.indexer.modules().push(fresh);
    const out = await h.gen.onIndexDelta(quiet(h, { membershipChanged: [fresh.id] }));
    expect(brief(out)).toEqual(["R7 regen s0 gen.overview", "R7 regen s5 gen.labels"]);
    expect(out.suggestions[1]?.reason).toBe("new_symbols");
    const overview = h.store.getEstimate(out.suggestions[0]?.estimate.id as string);
    expect(overview?.plan.tasks.map((t) => `${t.prompt}:${t.mode}`)).toEqual(["gen.overview:final"]);
    const labels = h.store.getEstimate(out.suggestions[1]?.estimate.id as string);
    expect(labels?.plan.eager).not.toContain(fresh.id);
  });
});

describe("GEN-S9-07 suggestion runs leave nothing pending in the static sections", () => {
  test("no suggestion for a doc without generated content", async () => {
    const h = makeS9Harness();
    await h.applyStatic();
    const out = await h.gen.onIndexDelta(replace(h, STORE, "export interface Session {", "export interface Session { // v2"));
    expect(out.suggestions).toEqual([]);
    expect(out.staleClaims).toEqual([]);
  });

  test("the section of every suggestion is a unit section", async () => {
    const h = await generated();
    h.setIface(M_SESSION, "v2");
    const out = await h.gen.onIndexDelta(quiet(h, { ifaceChanged: [M_SESSION] }));
    for (const s of out.suggestions)
      expect(["s0", "s3", "s5", "s7", "s9", "s10", "s11", "s12", "s13"].includes(s.section) || s.section.startsWith("s6/")).toBe(true);
    void (0 as unknown as SectionId);
  });
});

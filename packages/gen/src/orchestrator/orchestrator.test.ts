import { describe, expect, test } from "bun:test";
import { MitoriError, type SseEventPayload } from "@mitori/core";
import type { GenCall } from "../contract.ts";
import { type ScriptReply, type Turn, validRouter } from "../test/fake-engine.ts";
import { makeHarness } from "../test/harness.ts";
import { M_AUTH, M_SESSION } from "../test/repo.ts";
import { testSettings } from "../test/settings.ts";

async function runToEnd(h: ReturnType<typeof makeHarness>, effort: "overview" | "standard" = "standard") {
  const est = await h.gen.estimate({ effort });
  const run = await h.gen.start(est.id);
  await h.gen.idle();
  return { est, run: h.gen.run(run.id) };
}

const taskStates = (r: ReturnType<ReturnType<typeof makeHarness>["gen"]["run"]>) => r?.tasks.map((t) => t.state) ?? [];

describe("end-to-end standard run over scripted engines", () => {
  test("every task finishes, blocks land in the doc, module names are stored, the run is done", async () => {
    const h = makeHarness();
    const { run } = await runToEnd(h);
    expect(run?.run.state).toBe("done");
    expect(taskStates(run)).toEqual(Array(9).fill("done"));
    expect(run?.run.progress).toMatchObject({ total: 9, done: 9, failed: 0 });
    expect(run?.run.usage.calls).toBe(9);
    expect(
      h.doc
        .section("s6/session")
        ?.blocks.filter((b) => b.origin === "ai")
        .map((b) => b.aspect),
    ).toEqual(["responsibility", "interface"]);
    expect(h.doc.index().modules.find((m) => m.id === M_SESSION)?.name).toBe("名前01");
    expect(h.doc.section("s3/login")?.node.title).toBe("ログイン");
    expect(h.doc.index().glossary.map((g) => g.term)).toEqual(["セッション"]);
    const claim = h.doc.claims(h.doc.section("s6/session")?.blocks.find((b) => b.aspect === "responsibility")?.id ?? "b_x")[0];
    expect(claim?.cites[0]).toMatchObject({ path: "src/session/store.ts", blob: h.indexer.currentBlob("src/session/store.ts") as string, precision: "exact" });
    expect(claim?.verdict).toBe("cited");
    const gen = h.doc.section("s6/session")?.blocks.find((b) => b.origin === "ai")?.gen;
    expect(gen).toMatchObject({ model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.module@1", run: run?.run.id });
    // the early overview's blocks were updated in place by the final overview (EXISTING → same ids)
    const s0 = h.doc.section("s0")?.blocks.filter((b) => b.origin === "ai") ?? [];
    expect(s0.length).toBe(1);
    expect(s0[0]?.md).toContain("最終版");
    expect(h.events.events.some((e) => e.type === "gen.run" && e.run.state === "done")).toBe(true);
  });

  test("the final overview sees the early overview's blocks as EXISTING and the regen addendum", async () => {
    const h = makeHarness();
    await runToEnd(h);
    const final = h.engine.calls.find((c) => c.call.mode === "final");
    expect(final?.call.layout.unit).toContain("TASK: Regenerate.");
    expect(final?.call.model).toBe("claude-opus-5-5");
    expect(final?.call.effort).toBe("medium");
  });
});

describe("GEN-U-042 / AC-28 the same inputs a second time are all cached", () => {
  test("second run: every task cached, zero engine calls, doc bytes unchanged", async () => {
    const h = makeHarness();
    await runToEnd(h);
    const calls = h.engine.calls.length;
    const before = h.doc.dump();
    const second = await runToEnd(h);
    expect(taskStates(second.run).every((s) => s === "cached")).toBe(true);
    expect(h.engine.calls.length).toBe(calls);
    expect(h.doc.dump()).toBe(before);
    expect(second.run?.run.usage.calls).toBe(0);
    expect(second.est.stages.every((s) => s.apiUsd === 0 || s.stage === "S6" || s.stage === "S6o")).toBe(true);
    expect(h.metrics.counts.get("gen.cache.hits")).toBe(second.run?.tasks.length);
  });

  test("bumping the system prompt version invalidates the cache", async () => {
    const h = makeHarness();
    await runToEnd(h);
    const calls = h.engine.calls.length;
    const bumped = makeHarness({
      versions: { systems: { "gen.system": "gen.system@2" } },
      shared: { db: h.db, doc: h.doc, indexer: h.indexer, safe: h.safe, ids: h.ids, clock: h.clock },
    });
    const est = await bumped.gen.estimate({ effort: "standard" });
    const run = await bumped.gen.start(est.id);
    await bumped.gen.idle();
    expect(bumped.gen.run(run.id)?.tasks.some((t) => t.state === "cached")).toBe(false);
    expect(bumped.engine.calls.length).toBeGreaterThan(0);
    expect(h.engine.calls.length).toBe(calls);
  });
});

describe("GEN-U-023 / AC-08 / AC-09 exactly one retry, by continuation", () => {
  const badThenFix = (call: GenCall, t: Turn): ScriptReply => {
    if (call.spec.id !== "gen.module" || !call.layout.unit.includes(M_AUTH)) return validRouter(call, t);
    const j = JSON.stringify;
    if (!t.continuation && t.attempt === 1)
      return {
        lines: [
          j({
            t: "block",
            id: "new:1",
            aspect: "responsibility",
            section: "s7",
            md: "ログインさせる[[1]]。",
            claims: { "1": "behavior src/auth/login.ts:3-7" },
          }),
          j({ t: "block", id: "new:2", aspect: "interface", md: "- 関数を公開する[[1]]。", claims: {} }),
          j({ t: "block", id: "new:3", aspect: "pitfalls", md: "注意[[1]]。", claims: { "1": "risk src/auth/login.ts:90-99" } }),
          j({ t: "module", module: M_AUTH, name: "認証" }),
          j({ t: "end", blocks: 3 }),
        ],
      };
    return {
      lines: [
        j({ t: "block", id: "new:1", aspect: "responsibility", md: "ログインさせる[[1]]。", claims: { "1": "behavior src/auth/login.ts:3-7" } }),
        j({ t: "block", id: "new:2", aspect: "interface", md: "- `login` を公開する[[1]]。", claims: { "1": "behavior src/auth/login.ts:3-7" } }),
        j({ t: "block", id: "new:3", aspect: "pitfalls", md: "まだ壊れている[[1]]。", claims: { "1": "risk src/auth/login.ts:90-99" } }),
        j({ t: "end", blocks: 3 }),
      ],
    };
  };

  test("invalid lines are re-asked once on the parked process (no PREVIOUS); the 2nd-time failure is dropped; task done", async () => {
    const h = makeHarness({ router: badThenFix });
    const { run } = await runToEnd(h);
    const authCalls = h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_AUTH}`));
    expect(authCalls.length).toBe(2);
    expect(authCalls[1]?.turn.continuation).toBe(true);
    const retry = authCalls[1]?.turn.message ?? "";
    expect(retry).toContain("V05 /section");
    expect(retry).toContain("V14 /md");
    expect(retry).toContain("V18 /claims/1/0");
    expect(retry).not.toContain("PREVIOUS");
    const task = run?.tasks.find((t) => t.target.id === M_AUTH);
    expect(task?.state).toBe("done");
    expect(task?.attempt).toBe(2);
    expect(task?.error).toMatchObject({ code: "E_GEN_OUTPUT_INVALID", retryable: false, params: { dropped: 1 } });
    // §14 gen_tasks.metrics (no content): attempt-1 validity, rule counts, marker rate, verifier outcomes
    const m = JSON.parse(h.db.get<{ metrics: string }>("SELECT metrics FROM gen_tasks WHERE id = ?", [task?.id ?? ""])?.metrics ?? "null");
    // attempt 1: 3 rejected block lines (V05, V14, V18) + module + end; attempt 2: 2 fixed blocks, V18 again, end
    expect(m).toMatchObject({ prompt: "gen.module", attempt: 2, lines: 9, valid1: 2, valid: 5, dropped: 1, blockLines: 6, markerOk: 5, stop: "end" });
    expect(m.rules).toEqual({ V05: 1, V14: 1, V18: 2 });
    expect(m.l0raw).toBe(2);
    expect(m.l1).toEqual({ pass: 1, fail: 0, vacuous: 1 });
    expect(
      h.doc
        .section("s6/auth")
        ?.blocks.filter((b) => b.origin === "ai")
        .map((b) => b.aspect),
    ).toEqual(["responsibility", "interface"]);
  });

  test("no parked process ⇒ cold retry with PREVIOUS and the original message as the first content block", async () => {
    const h = makeHarness({ router: badThenFix, parkable: false });
    await runToEnd(h);
    const authCalls = h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_AUTH}`));
    expect(authCalls.length).toBe(2);
    expect(authCalls[1]?.turn.continuation).toBe(false);
    expect(authCalls[1]?.call.attempt).toBe(2);
    expect(authCalls[1]?.call.layout.unit).toBe(authCalls[0]?.call.layout.unit as string);
    expect(authCalls[1]?.call.layout.retry).toContain("PREVIOUS>>>");
    expect(authCalls[1]?.call.layout.retry).toContain('"section":"s7"');
  });

  test("the parked process exiting between the result and the retry falls back to a cold retry (not a task failure)", async () => {
    const h = makeHarness({ router: (c, t) => ({ ...badThenFix(c, t), ...(t.attempt === 1 ? { exits: true } : {}) }) });
    const { run } = await runToEnd(h);
    const authCalls = h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_AUTH}`));
    expect(authCalls.map((c) => [c.call.attempt, c.turn.continuation])).toEqual([
      [1, false],
      [2, false],
    ]);
    expect(authCalls[1]?.call.layout.retry).toContain("PREVIOUS>>>");
    expect(run?.tasks.find((t) => t.target.id === M_AUTH)).toMatchObject({ state: "done", attempt: 2 });
  });

  test("a required aspect still missing after the retry fails the task (E_GEN_COVERAGE_LOW); the run goes on", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply => {
      if (call.spec.id !== "gen.module" || !call.layout.unit.includes(`module ${M_SESSION}`)) return validRouter(call, t);
      return {
        lines: [
          JSON.stringify({ t: "block", id: t.continuation ? "new:2" : "new:1", aspect: "learn", md: "- 読むこと", claims: {} }),
          JSON.stringify({ t: "end", blocks: 1 }),
        ],
      };
    };
    const h = makeHarness({ router });
    const { run } = await runToEnd(h);
    const s = run?.tasks.find((t) => t.target.id === M_SESSION);
    expect(s?.state).toBe("failed");
    expect(s?.error?.code).toBe("E_GEN_COVERAGE_LOW");
    expect(h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_SESSION}`)).length).toBe(2);
    expect(run?.run.state).toBe("done");
    expect(run?.run.progress.failed).toBe(1);
  });

  test("a CLI-internal continuation (PT-09) gets no mitori retry", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply => {
      const r = validRouter(call, t);
      if (call.spec.id === "gen.module" && call.layout.unit.includes(`module ${M_SESSION}`))
        return { lines: (r.lines ?? []).slice(0, 1), continuations: 1, stop: "budget" };
      return r;
    };
    const h = makeHarness({ router });
    const { run } = await runToEnd(h);
    expect(h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_SESSION}`)).length).toBe(1);
    expect(run?.tasks.find((t) => t.target.id === M_SESSION)?.state).toBe("failed");
  });
});

describe("GEN-U-044 / AC-18 refusal fails the task, keeps committed blocks, the run continues", () => {
  test("refusal", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply => {
      const r = validRouter(call, t);
      if (call.spec.id === "gen.module" && call.layout.unit.includes(`module ${M_SESSION}`))
        return { lines: [(r.lines ?? [])[0] as string, '{"t":"block","id":"new:2"'], stop: "refusal", refusal: { category: "cyber" } };
      return r;
    };
    const h = makeHarness({ router });
    const { run } = await runToEnd(h);
    const s = run?.tasks.find((t) => t.target.id === M_SESSION);
    expect(s?.state).toBe("failed");
    expect(s?.error).toMatchObject({ code: "E_AGENT_REFUSAL", params: { category: "cyber" } });
    expect(h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai").length).toBe(1);
    expect(run?.run.state).toBe("done");
    expect(h.engine.calls.filter((c) => c.call.layout.unit.includes(`module ${M_SESSION}`)).length).toBe(1);
  });
});

describe("AC-05 / GEN-U-024 streaming commit", () => {
  test("blocks are applied in line order before the stream ends; partials are throttled to ≥ 100 ms", async () => {
    const h = makeHarness();
    const order: string[] = [];
    const orig = h.doc.applyGenerated.bind(h.doc);
    h.doc.applyGenerated = (b, o) => {
      order.push(b.map((x) => x.aspect ?? "-").join(","));
      return orig(b, o);
    };
    const est = await h.gen.estimate({ effort: "standard", scope: ["s6/session"] });
    await h.gen.start(est.id);
    await h.gen.idle();
    expect(order).toEqual(["responsibility", "interface"]);
    const partials = h.events.events.filter((e): e is Extract<SseEventPayload, { type: "doc.block.partial" }> => e.type === "doc.block.partial");
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[0]?.section).toBe("s6/session");
    expect(partials[0]?.aspect).toBe("responsibility");
  });
});

describe("start preconditions (GEN-U-005, AC-43)", () => {
  test("index change ⇒ E_PRECONDITION; expired ⇒ E_PRECONDITION; over the cap ⇒ E_BUDGET_EXCEEDED", async () => {
    const h = makeHarness();
    const est = await h.gen.estimate({ effort: "standard" });
    h.indexer.setFile("src/auth/login.ts", "export const changed = 1;\n");
    await expect(h.gen.start(est.id)).rejects.toMatchObject({ code: "E_PRECONDITION" });
    const est2 = await h.gen.estimate({ effort: "standard" });
    h.clock.advance(11 * 60 * 1000);
    await expect(h.gen.start(est2.id)).rejects.toMatchObject({ code: "E_PRECONDITION" });
    const s = testSettings();
    s.global.limits.genRunMaxUsd = 0.0001;
    const tight = makeHarness({ settings: s });
    const est3 = await tight.gen.estimate({ effort: "standard" });
    await expect(tight.gen.start(est3.id)).rejects.toBeInstanceOf(MitoriError);
    await expect(tight.gen.start(est3.id)).rejects.toMatchObject({ code: "E_BUDGET_EXCEEDED" });
  });

  test("anthropic-api: this month's spend + the estimate over monthlyCapUsd ⇒ E_BUDGET_EXCEEDED (§8.3)", async () => {
    const s = testSettings();
    s.global.engines["anthropic-api"] = { ...s.global.engines["anthropic-api"], enabled: true, monthlyCapUsd: 5 };
    const h = makeHarness({ settings: s });
    (h.deps.engines as Record<string, unknown>)["anthropic-api"] = h.engine;
    const est = await h.gen.estimate({ effort: "standard", engine: "anthropic-api" });
    h.ledger.setApiSpend(5 - est.apiUsd / 2);
    await expect(h.gen.start(est.id)).rejects.toMatchObject({ code: "E_BUDGET_EXCEEDED", params: { cap: 5 } });
    h.ledger.setApiSpend(1);
    const run = await h.gen.start(est.id);
    await h.gen.idle();
    expect(h.gen.run(run.id)?.run).toMatchObject({ engine: "anthropic-api", state: "done" });
    // the cap is required when the engine is enabled
    s.global.engines["anthropic-api"].monthlyCapUsd = 0;
    await expect(h.gen.start((await h.gen.estimate({ effort: "standard", engine: "anthropic-api" })).id)).rejects.toMatchObject({
      code: "E_BUDGET_EXCEEDED",
    });
  });

  test("dispatch stops at 80 % of the cap and the run pauses with reason budget", async () => {
    const s = testSettings();
    let cap = 1;
    const router = (call: GenCall, t: Turn): ScriptReply => ({ ...validRouter(call, t), apiUsd: cap * 0.85 });
    const h = makeHarness({ settings: s, router });
    const est = await h.gen.estimate({ effort: "standard" });
    cap = est.apiUsd * 1.01;
    s.global.limits.genRunMaxUsd = cap;
    const r2 = await h.gen.start(est.id);
    await h.gen.idle();
    const after = h.gen.run(r2.id);
    expect(after?.run.state).toBe("paused");
    expect(after?.run.paused?.reason).toBe("budget");
    expect(after?.tasks.some((t) => t.state === "pending")).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import type { BlockId, SectionId } from "@mitori/core";
import type { GenEngine, PlannedTask, PromptRenderer, RenderedTask } from "../contract.ts";
import { makeHarness } from "../test/harness.ts";
import type { LineSink } from "./apply.ts";
import { afterLines, buildCall, type RunCtx } from "./execute.ts";

const task = {
  id: "gt_0000000001",
  stage: "S5",
  prompt: "gen.module",
  target: { kind: "module", id: "md_a0000001" },
  sections: ["s6/session"],
  deps: [],
  softDeps: [],
  model: "claude-sonnet-5-5",
  effort: "low",
  lane: "background",
  topoOrder: 0,
  rank: 0.5,
  cacheKey: null,
  cached: false,
  estimate: { prefix: 11000, tail: 9000, out: 1500, thinking: 225, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0.04, seconds: 20 },
  phase: 1,
} as unknown as PlannedTask;
const rendered = {
  layout: { systemId: "gen.system", system: "S", pack: "P", shared: null, unit: "U", retry: null, nonce: "n" },
  fanoutKey: "f",
  tokens: { prefix: 11000, tail: 9000 },
} as unknown as RenderedTask;
const ctx = (engine: GenEngine["id"], runSeconds?: number): RunCtx =>
  ({
    id: "gr_00000001",
    trigger: "user",
    engine: { id: engine },
    cancelled: () => false,
    ...(runSeconds !== undefined ? { runSeconds } : {}),
  }) as unknown as RunCtx;
const prompts = {} as PromptRenderer;

describe("GenCall per engine (§8.2 / §8.3)", () => {
  test("Codex uses the native generation deadline independently of the uncalibrated Claude timing formula", () => {
    expect(buildCall(ctx("codex-cli"), { ...task, model: "codex:gpt-6.1-sol", effort: "high" }, rendered, 1, "background", null, prompts).timeoutMs).toBe(
      600_000,
    );
  });
  test("generic uses its configured reasoning deadline without changing Claude timeouts", () => {
    const c = { ...ctx("generic"), turnMs: 600_000 };
    expect(buildCall(c, task, rendered, 1, "background", null, prompts).timeoutMs).toBe(600_000);
    expect(buildCall(ctx("claude-cli"), task, rendered, 1, "background", null, prompts).timeoutMs).toBe(120_000);
  });
  test("anthropic-api writes the prefix with the 1h TTL only when the RUN is expected to take > 4 min", () => {
    expect(buildCall(ctx("anthropic-api", 300), task, rendered, 1, "background", null, prompts).ttl).toBe("1h");
    expect(buildCall(ctx("anthropic-api", 100), task, rendered, 1, "background", null, prompts).ttl).toBe("5m");
    // claude-cli always injects the 5m TTL (PT-02)
    expect(buildCall(ctx("claude-cli", 900), task, rendered, 1, "background", null, prompts).ttl).toBe("5m");
  });

  test("claude-cli output cap = max(2000, ceil(1.5·(O+Θ))); backstop budget and timeout", () => {
    const c = buildCall(ctx("claude-cli"), task, rendered, 1, "background", null, prompts);
    expect(c.maxOutTokens).toBe(Math.max(2000, Math.ceil(1.5 * (1500 + 225))));
    expect(c.budgetUsd).toBe(Math.max(0.05, 3 * 0.04));
    expect(c.timeoutMs).toBe(120_000);
    expect(c.estimate).toEqual({ in: 11000 + 450 + 9000, out: 1725 });
  });
});

describe("WP2 gen.flows drops nothing silently: missing flow sections become delete proposals", () => {
  const stubSink = (lines: string[]): LineSink => ({
    idMap: {},
    written: [],
    created: [],
    lines,
    terms: [],
    questions: [],
    checks: { l0Raw: 0, l1Pass: 0, l1Fail: 0, l1Vacuous: 0, repaired: 0 },
    accept() {},
    async finish() {},
  });
  const ctx = {
    run: "gr_00000001",
    lang: "ja",
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    promptVer: "gen.flows@7",
    indexDigest: "",
    trigger: "user",
    autoAccept: false,
    listed: 0,
  } as const;
  const seedSection = (h: ReturnType<typeof makeHarness>, key: string, n: number) => {
    h.doc.upsertFlowSection(key, key, 0);
    for (let i = 0; i < n; i++)
      h.doc.applyGenerated(
        [
          {
            id: null,
            section: `s3/${key}` as SectionId,
            aspect: "steps",
            kind: "list",
            depth: "L2",
            audience: ["dev"],
            lang: "ja",
            md: `1. 手順${i}`,
            claims: [],
            gen: { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S6o", promptVer: "gen.flows@7", indexDigest: "0" },
          },
        ],
        { mode: "write", deletes: [], source: { kind: "regen", id: "previous" }, reason: "", listed: 0 },
      );
    return (h.doc.section(`s3/${key}` as SectionId)?.blocks ?? []).map((b) => b.id);
  };

  test("an existing flow missing from the output is proposed for deletion, not removed; a listed flow is untouched", async () => {
    const h = makeHarness();
    const stale = seedSection(h, "demo", 2);
    const kept = seedSection(h, "login", 1);
    const lines = [
      JSON.stringify({ t: "flow", key: "login", title: "ログイン" }),
      JSON.stringify({ t: "keep", id: kept[0] }),
      JSON.stringify({ t: "end", blocks: 0 }),
    ];
    await afterLines({ settings: () => h.settings, write: h.write, doc: h.doc }, { prompt: "gen.flows" }, stubSink(lines), ctx);
    // stale blocks stay in the doc (a proposal is not a delete)…
    expect(stale.every((id) => h.doc.block(id as BlockId) !== null)).toBe(true);
    expect(h.doc.tombstones.has(stale[0] as BlockId)).toBe(false);
    // …and every one of them has a pending delete proposal, while the kept flow has none
    const pending = h.doc.proposals({ state: "pending" });
    expect(stale.every((id) => pending.some((p) => p.op === "delete" && p.block === id))).toBe(true);
    expect(pending.some((p) => p.block === kept[0])).toBe(false);
    // a second run does not stack duplicate proposals
    await afterLines({ settings: () => h.settings, write: h.write, doc: h.doc }, { prompt: "gen.flows" }, stubSink(lines), ctx);
    expect(h.doc.proposals({ state: "pending" }).filter((p) => p.op === "delete").length).toBe(2);
  });

  test("a human-edited block of a missing flow is proposed, never deleted", async () => {
    const h = makeHarness();
    const [id] = seedSection(h, "demo", 1);
    h.doc.lock(id as BlockId, "human-edited");
    await afterLines({ settings: () => h.settings, write: h.write, doc: h.doc }, { prompt: "gen.flows" }, stubSink([]), ctx);
    expect(h.doc.block(id as BlockId) !== null).toBe(true);
    expect(h.doc.proposals({ state: "pending" }).some((p) => p.op === "delete" && p.block === id)).toBe(true);
  });
});

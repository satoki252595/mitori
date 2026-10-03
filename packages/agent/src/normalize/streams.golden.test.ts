import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobEvent, WorkspaceKey } from "@mitori/core";
import type { EngineMode, InitExpectation, ScheduledRequest } from "../contract.ts";
import { createFakeSpawner, createTestBridge, type ScriptedChild } from "../testing.ts";
import { createNormalizer } from "./normalizer.ts";

const STREAMS = join(import.meta.dir, "../../../../fixtures/agent-streams");
const GOLDEN = join(import.meta.dir, "../../test/golden/agent-streams");
const UPDATE = process.env.MITORI_UPDATE_GOLDEN === "1";
const HAIKU = "claude-haiku-4-5" as const;

/** How each recording was made (bench/contract/run.ts) — mode and the init expectation. */
const META: Record<string, { mode: EngineMode; tools: string[]; worktree?: string }> = {
  "answer-lean": { mode: "answer", tools: [] },
  "patch-2turn": { mode: "patch", tools: ["StructuredOutput"] },
  "agent-edit-denied": { mode: "agent", tools: ["Read", "Edit", "Glob", "Grep", "StructuredOutput"], worktree: "$TMP/wt" },
  "max-budget": { mode: "answer", tools: [] },
  sigint: { mode: "answer", tools: [] },
  "cache-ttl-5m": { mode: "answer", tools: [] },
  "rate-limit-429.synthetic": { mode: "answer", tools: [] },
  "refusal.synthetic": { mode: "answer", tools: [] },
};

const read = (name: string): string[] =>
  readFileSync(join(STREAMS, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean);
const MARKER = '{"type":"mitori_marker","event":"sigint"}';

/** Compact, stable view of the event sequence (text deltas joined, usage reduced to the ledger fields). */
function view(events: readonly JobEvent[]): unknown[] {
  const out: unknown[] = [];
  for (const e of events) {
    if (e.t === "text") {
      const last = out[out.length - 1] as { t?: string; text?: string } | undefined;
      if (last?.t === "text") last.text = `${last.text}${e.delta}`;
      else out.push({ t: "text", text: e.delta });
    } else if (e.t === "usage")
      out.push({
        t: "usage",
        final: e.final,
        in: e.usage.in,
        cw: e.usage.cacheWrite,
        cw1h: e.usage.cacheWrite1h,
        cr: e.usage.cacheRead,
        out: e.usage.out,
        usd: e.usage.apiUsd,
        reported: e.usage.reportedUsd ?? null,
      });
    else if (e.t === "window") out.push({ t: "window", five: e.window.fiveHour?.utilization ?? null, billing: e.window.billing });
    else if (e.t === "result") {
      const { at: _at, ...rest } = e;
      out.push(rest);
    } else {
      const { at: _at, ...rest } = e as JobEvent & { at: number };
      out.push(rest);
    }
  }
  return out;
}

describe("AGT-G-020 fixtures/agent-streams → JobEvent sequences (golden)", () => {
  test("every recording has a META entry", () => {
    const names = readdirSync(STREAMS)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.slice(0, -".jsonl".length))
      .sort();
    expect(names).toEqual(Object.keys(META).sort());
  });

  for (const [name, m] of Object.entries(META)) {
    test(`AGT-G-020 ${name}`, () => {
      const expectation: InitExpectation = { subscription: true, tools: m.tools, model: HAIKU };
      const n = createNormalizer({ mode: m.mode, expect: expectation, now: () => 0 as never, ...(m.worktree ? { worktree: m.worktree } : {}) });
      const events: JobEvent[] = [];
      for (const l of read(name)) if (l !== MARKER) events.push(...n.push(l));
      events.push(...n.end(0));
      expect(n.violation()).toBeNull();
      // invariants independent of the golden: one final usage per result, mid-stream usage is never final
      const results = events.filter((e) => e.t === "result").length;
      expect(events.filter((e) => e.t === "usage" && e.final).length).toBe(results);
      events.forEach((e, i) => {
        if (e.t === "usage" && e.final) expect(events[i + 1]?.t === "result" || events[i + 2]?.t === "result").toBe(true);
      });
      const file = join(GOLDEN, `${name}.events.json`);
      const got = view(events);
      if (UPDATE || !existsSync(file)) {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
      }
      // semantic comparison: the formatter may re-wrap the golden JSON
      expect(got).toEqual(JSON.parse(readFileSync(file, "utf8")));
    });
  }
});

const ctl = () => new AbortController().signal;
const EMPTY = "/home/u/.mitori/run/empty";
function sreq(mode: EngineMode, o: Partial<ScheduledRequest> = {}): ScheduledRequest {
  return {
    ref: "j_1",
    mode,
    cwd: EMPTY,
    model: HAIKU,
    effort: "low",
    tools: "none",
    writeScope: [],
    system: `t\nWorking directory: ${EMPTY}`,
    promptVer: "contract.answer@1",
    prompt: "x",
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.03, inTokens: 0, outTokens: 0, ms: 120_000 },
    engine: "claude-cli",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_1" },
    estimate: { in: 600, out: 50 },
    ...o,
  };
}
/** Recorded lines as a scripted child (`mitori_marker` sigint splits main / after_sigint). */
function recorded(name: string, cwd: string, from = "$TMP/canary-cwd"): ScriptedChild {
  const lines = read(name).map((l) => l.split(from).join(cwd));
  const i = lines.indexOf(MARKER);
  if (i < 0) return { lines: lines.map((line) => ({ line })) };
  return {
    lines: [...lines.slice(0, i).map((line) => ({ line })), ...lines.slice(i + 1).map((line) => ({ line, phase: "after_sigint" as const }))],
    hang: true,
  };
}

describe("AC-L31 / AC-L37 recordings replayed through the real engine + scheduler + ledger", () => {
  test("AC-L31 answer-lean: usage comes only from the result, one ledger row with its values", async () => {
    const b = createTestBridge({ spawner: createFakeSpawner().script(() => true, recorded("answer-lean", EMPTY)) });
    const r = await b.scheduler.submit(sreq("answer"), ctl()).result;
    expect(r.stop).toBe("end");
    const res = JSON.parse(read("answer-lean").at(-1) as string) as { usage: { input_tokens: number; output_tokens: number }; total_cost_usd: number };
    expect(b.ledger.rows).toHaveLength(1);
    expect(b.ledger.rows[0]?.usage.in).toBe(res.usage.input_tokens);
    expect(b.ledger.rows[0]?.usage.out).toBe(res.usage.output_tokens);
    expect(b.ledger.rows[0]?.usage.reportedUsd).toBe(res.total_cost_usd);
    expect(b.ledger.rows[0]?.window?.fiveHour?.utilization).toBeGreaterThan(0);
  });

  test("AC-L31 patch-2turn: the parked process serves turn 2; 2 rows; reportedUsd of turn 2 is the cumulative delta", async () => {
    const b = createTestBridge({ spawner: createFakeSpawner().script(() => true, recorded("patch-2turn", EMPTY, "$TMP/home/run/empty")) });
    const schema = { type: "object", properties: { word: { type: "string" } }, required: ["word"], additionalProperties: false };
    const run = b.scheduler.submit(sreq("patch", { jsonSchema: schema, keepAlive: true, contract: "patch/1" }), ctl());
    const r1 = await run.result;
    expect(r1.structured).toEqual({ word: "apple" });
    const s = run.session;
    if (!s) throw new Error("no session");
    const r2 = await b.scheduler.continueSession(
      s,
      "Now return word=pear.",
      {
        lane: "interactive",
        ws: "ws_aaaaaaaaaaaa",
        scope: { kind: "job", id: "j_1" },
        estimate: { in: 600, out: 50 },
        budget: sreq("patch").budget,
        ref: "j_1",
      },
      ctl(),
    ).result;
    expect(r2.structured).toEqual({ word: "pear" });
    const costs = read("patch-2turn")
      .map((l) => JSON.parse(l) as { type: string; total_cost_usd?: number })
      .filter((e) => e.type === "result")
      .map((e) => e.total_cost_usd ?? 0);
    expect(b.ledger.rows.map((x) => x.usage.reportedUsd)).toEqual([
      Math.round((costs[0] ?? 0) * 1e6) / 1e6,
      Math.round(((costs[1] ?? 0) - (costs[0] ?? 0)) * 1e6) / 1e6,
    ]);
    await s.close();
  });

  test("AC-L37 sigint: the CLI's interrupted result has zero usage; the ledger keeps the meter's figure (CC-16)", async () => {
    const b = createTestBridge({ spawner: createFakeSpawner().script(() => true, recorded("sigint", EMPTY, "$TMP/home/run/empty")) });
    const run = b.scheduler.submit(sreq("answer"), ctl());
    for await (const e of run.events) if (e.t === "text") run.stop("user");
    const r = await run.result;
    expect(r.stop).toBe("cancelled");
    expect(r.usageEstimated).toBe(true);
    expect(r.usage.in).toBe(540);
    expect(r.usage.out).toBeGreaterThanOrEqual(750); // thinking_tokens estimates
    expect(b.ledger.rows).toHaveLength(1);
    expect(b.ledger.rows[0]?.outcome).toBe("cancelled");
    expect(b.ledger.rows[0]?.usage.apiUsd).toBeGreaterThan(0.004);
  });

  test("AC-L31 agent-edit-denied: Edit outside WRITE is a worktree-relative denial; max-budget maps to budget", async () => {
    const wt = "/home/u/.mitori/wt/ws_x/j_1";
    const b = createTestBridge({ spawner: createFakeSpawner().script(() => true, recorded("agent-edit-denied", wt, "$TMP/wt")) });
    const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
    const r = await b.scheduler.submit(
      sreq("agent", { cwd: wt, system: `t\nWorking directory: ${wt}`, tools: "read_edit", writeScope: ["a.txt"], jsonSchema: schema, contract: "agent/1" }),
      ctl(),
    ).result;
    expect(r.stop).toBe("end");
    expect(r.denials.map((d) => [d.tool, d.target])).toContainEqual(["Edit", "b.txt"]);
    const m = createTestBridge({ spawner: createFakeSpawner().script(() => true, recorded("max-budget", EMPTY, "$TMP/home/run/empty")) });
    const rb = await m.scheduler.submit(sreq("answer"), ctl()).result;
    expect(rb.stop).toBe("budget");
    expect(m.ledger.rows[0]?.outcome).toBe("budget");
  });
});

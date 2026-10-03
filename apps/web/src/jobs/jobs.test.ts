/** ux.md §6.4 / §6.9: job status vocabulary, planned stage rows and the event reducer (WEB-U-032: no fake %). */
import { describe, expect, test } from "bun:test";
import type { GateResult, JobEvent, JobState, RouteDecision } from "@mitori/core";
import { STAGE_PLANS, STATUS_PRESENTATION } from "../contract.ts";
import { acceptNeedsWarning, gateBadge, gateLabel, verdictOf } from "./gates.ts";
import { jobStatus, planStages } from "./index.ts";
import { foldStages, usualBand } from "./stages.ts";

const route = (mode: RouteDecision["mode"]): RouteDecision => ({
  mode,
  reason: mode === "answer" ? "intent_question" : "small_change",
  model: "claude-sonnet-5-5",
  effort: "medium",
  tools: mode === "agent" ? "read_edit" : "none",
  contract: mode === "answer" ? "answer/1" : mode === "patch" ? "patch/1" : "agent/1",
  anchoredLines: 46,
  files: 2,
  requiresConfirm: false,
});
const GATES = [
  { id: "fmt:gofmt", label: "gofmt -l" },
  { id: "test:go", label: "go test ./internal/config" },
];
const ph = (phase: Extract<JobEvent, { t: "phase" }>["phase"], at: number, detail?: string): JobEvent => ({
  t: "phase",
  phase,
  at,
  ...(detail ? { detail } : {}),
});
const gate = (id: string, status: GateResult["status"], at: number): JobEvent => ({
  t: "gate",
  gate: { gate: id as `${string}:${string}`, status, ms: 120 },
  at,
});

describe("WEB-U-JOB-01 jobStatus", () => {
  test("every JobState maps onto the status vocabulary", () => {
    const all: JobState[] = [
      "queued",
      "waiting_lock",
      "preparing",
      "running",
      "gating",
      "repairing",
      "ready",
      "accepting",
      "accepted",
      "partially_accepted",
      "rejected",
      "done",
      "failed",
      "cancelled",
      "reverted",
    ];
    for (const s of all) expect(STATUS_PRESENTATION[jobStatus(s)]).toBeDefined();
    expect(jobStatus("ready")).toBe("ready");
    expect(jobStatus("preparing")).toBe("running");
    expect(jobStatus("partially_accepted")).toBe("partially_applied");
    expect(jobStatus("done")).toBe("answered");
  });
});

describe("WEB-U-JOB-02 planStages", () => {
  test("rows follow STAGE_PLANS, accept is the receipt, gates expand per gate", () => {
    const rows = planStages(route("patch"), GATES);
    expect(rows.map((r) => r.key)).toEqual(["accept", "prepare", "bundle", "spawn", "think", "apply", "scope", "gate", "gate", "ready"]);
    expect(rows[0]).toEqual({ key: "accept", state: "done", atMs: 0 });
    expect(rows.filter((r) => r.key === "gate").map((r) => r.gate)).toEqual(["fmt:gofmt", "test:go"]);
    expect(rows.slice(1).every((r) => r.state === "planned")).toBe(true);
  });

  test("no trusted gate ⇒ no gate row; answer mode has no gate at all", () => {
    expect(planStages(route("agent"), []).some((r) => r.key === "gate")).toBe(false);
    expect(planStages(route("answer"), GATES).map((r) => r.key)).toEqual([...STAGE_PLANS.answer]);
  });
});

describe("WEB-U-JOB-03 foldStages", () => {
  const t0 = 1_000_000;
  test("phases tick rows with elapsed times; the next row is `now`", () => {
    const plan = planStages(route("patch"), GATES);
    const v = foldStages(plan, "patch", [ph("prepare", t0 + 100), ph("snapshot", t0 + 150), ph("bundle", t0 + 300, "MBF/1 · 2.4k tok")], t0, "running");
    const by = (k: string) => v.rows.find((r) => r.key === k);
    expect(by("prepare")).toMatchObject({ state: "done", atMs: 300 });
    expect(by("bundle")).toMatchObject({ state: "now", detail: "MBF/1 · 2.4k tok" });
    expect(by("spawn")?.state).toBe("planned");
    expect(v.tail).toBe("MBF/1 · 2.4k tok");
  });

  test("patch mode folds `edit` into apply; gates settle one row each; ready closes the card", () => {
    const plan = planStages(route("patch"), GATES);
    const ev = [
      ph("prepare", t0 + 10),
      ph("bundle", t0 + 20),
      ph("spawn", t0 + 30),
      ph("think", t0 + 40),
      ph("edit", t0 + 2000),
      ph("scope", t0 + 2100),
      ph("gate", t0 + 2200),
      gate("fmt:gofmt", "pass", t0 + 2300),
      gate("test:go", "pass", t0 + 9000),
      ph("ready", t0 + 9100),
    ];
    const v = foldStages(plan, "patch", ev, t0, "ready");
    expect(v.rows.map((r) => r.key)).toEqual(plan.map((r) => r.key));
    expect(v.rows.every((r) => r.state === "done")).toBe(true);
    expect(v.rows.find((r) => r.key === "apply")?.atMs).toBe(2100);
    expect(v.rows.find((r) => r.gate === "test:go")?.atMs).toBe(9000);
  });

  test("a failing gate, a repair and the re-run ADD rows (nothing is removed)", () => {
    const plan = planStages(route("patch"), GATES);
    const ev = [
      ph("prepare", t0 + 10),
      ph("bundle", t0 + 20),
      ph("spawn", t0 + 30),
      ph("think", t0 + 40),
      ph("apply", t0 + 50),
      ph("scope", t0 + 60),
      ph("gate", t0 + 70),
      gate("fmt:gofmt", "pass", t0 + 80),
      gate("test:go", "fail", t0 + 90),
      ph("repair", t0 + 100, "1/2 · --resume · 0.6k"),
      ph("apply", t0 + 200),
      ph("scope", t0 + 210),
      ph("gate", t0 + 220),
      gate("fmt:gofmt", "pass", t0 + 230),
      gate("test:go", "pass", t0 + 240),
    ];
    const v = foldStages(plan, "patch", ev, t0, "gating");
    const keys = v.rows.map((r) => `${r.key}${r.gate ? `:${r.gate}` : ""}:${r.state}`);
    expect(keys).toContain("gate:test:go:failed");
    expect(keys.filter((k) => k.startsWith("apply"))).toHaveLength(2);
    expect(keys.filter((k) => k.startsWith("gate:test:go"))).toEqual(["gate:test:go:failed", "gate:test:go:done"]);
    expect(keys[keys.length - 1]).toBe("ready:planned");
    expect(v.rows.find((r) => r.key === "repair")?.detail).toBe("1/2 · --resume · 0.6k");
  });

  test("untrusted gates are skipped rows, never ✓", () => {
    const plan = planStages(route("patch"), GATES);
    const v = foldStages(plan, "patch", [ph("gate", t0 + 5), gate("fmt:gofmt", "untrusted", t0 + 6), gate("test:go", "pending_consent", t0 + 7)], t0, "ready");
    expect(v.rows.filter((r) => r.key === "gate").map((r) => r.state)).toEqual(["skipped", "skipped"]);
  });

  test("answer mode streams text; a failure marks the row in progress", () => {
    const plan = planStages(route("answer"), []);
    const v = foldStages(
      plan,
      "answer",
      [
        ph("bundle", t0 + 5),
        ph("spawn", t0 + 10),
        ph("think", t0 + 20),
        { t: "text", delta: "0.7 は", at: t0 + 30 },
        { t: "text", delta: " 経験値", at: t0 + 40 },
      ],
      t0,
      "running",
    );
    expect(v.answer).toBe("0.7 は 経験値");
    expect(v.rows.find((r) => r.key === "think")?.state).toBe("now");
    const f = foldStages(plan, "answer", [ph("bundle", t0 + 5), ph("spawn", t0 + 10)], t0, "failed", t0 + 50);
    expect(f.rows.find((r) => r.key === "spawn")).toMatchObject({ state: "failed", atMs: 50 });
  });

  test("agent read rows rewrite their detail per file", () => {
    const plan = planStages(route("agent"), []);
    const v = foldStages(
      plan,
      "agent",
      [ph("read", t0 + 5, "Read a.go"), { t: "tool", name: "Read", target: "b.go", status: "start", at: t0 + 6 }, ph("read", t0 + 7, "Read c.go")],
      t0,
      "running",
    );
    expect(v.rows.filter((r) => r.key === "read")).toEqual([{ key: "read", state: "now", detail: "Read c.go" }]);
  });

  test("usual band: measured from 20 samples, else the prior", () => {
    expect(usualBand("patch", { p25: 9.6, p75: 15.2, n: 25 })).toEqual({ lo: 10, hi: 15, n: 25 });
    expect(usualBand("patch", { p25: 1, p75: 2, n: 3 })).toEqual({ lo: 11, hi: 17, n: 0 });
  });
});

describe("WEB-U-JOB-04 AC-U-G01/G02 gate verdicts", () => {
  const g = (status: GateResult["status"]): GateResult => ({ gate: "x:y", status, ms: 10 });
  test("✓ only when every gate passed on the applied tree", () => {
    expect(gateBadge({ gates: [g("pass"), g("pass")], gateVerdict: "passed" })).toEqual({ kind: "passed", pass: 2, total: 2 });
    expect(gateBadge({ gates: [g("pass"), g("untrusted")] }).kind).toBe("unverified");
    expect(gateBadge({ gates: [g("pass"), g("pass")], gateVerdict: "partial_unverified" }).kind).toBe("rechecking");
    expect(gateBadge({ gates: [g("pass"), g("fail")] })).toEqual({ kind: "failed", pass: 1, total: 2 });
    expect(gateBadge({ gates: [] }).kind).toBe("none");
    expect(verdictOf([g("pass")], "unverified")).toBe("unverified");
  });

  test("accept wording follows the verdict", () => {
    expect(acceptNeedsWarning({ gates: [g("pass")], gateVerdict: "passed" })).toBe("none");
    expect(acceptNeedsWarning({ gates: [g("skipped")] })).toBe("unverified");
    expect(acceptNeedsWarning({ gates: [g("timeout")] })).toBe("failed");
  });

  test("gate labels", () => {
    expect(gateLabel("fmt:gofmt")).toBe("gofmt");
    expect(gateLabel("test:go")).toBe("go test");
    expect(gateLabel("lint:biome")).toBe("biome");
  });
});

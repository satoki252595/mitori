// LOOP-U-076 (spec §3.5, L9): which failures escalate, the R2 spend cap, and that injection signals never escalate.
import { describe, expect, test } from "bun:test";
import { type Job, MitoriError } from "@mitori/core";
import type { RunnerCore } from "../jobs/core.ts";
import type { JobPlan } from "../jobs/plan.ts";
import { autoBlocker, escalationReason, spendOf, withEscalateAction } from "./escalate.ts";

const patch = { kind: "fix", route: { mode: "patch" } } as Pick<Job, "route" | "kind">;
const agent = { kind: "fix", route: { mode: "agent" } } as Pick<Job, "route" | "kind">;
const err = (code: string, params?: Record<string, string>) => new MitoriError(code as never, "x", params ? { params } : {});

describe("LOOP-U-076 escalation", () => {
  test("patch failures map to R2 reasons; agent failures to agent_failed (R1); injection signals and external patches never", () => {
    expect(escalationReason(patch, err("E_PATCH_APPLY"))).toBe("patch_apply_failed");
    expect(escalationReason(patch, err("E_PATCH_RANGE"))).toBe("patch_apply_failed");
    expect(escalationReason(patch, err("E_GATE_FAILED"))).toBe("gates_failed_twice");
    expect(escalationReason(patch, err("E_PRECONDITION", { reason: "needs_more_context" }))).toBe("needs_more_context");
    expect(escalationReason(patch, err("E_PRECONDITION"))).toBeNull();
    for (const c of ["E_GATE_FAILED", "E_AGENT_PROTOCOL", "E_BUDGET_EXCEEDED", "E_AGENT_TIMEOUT"]) expect(escalationReason(agent, err(c))).toBe("agent_failed");
    for (const c of ["E_SCOPE_VIOLATION", "E_DENY_GLOB", "E_SECRET_DETECTED", "E_CANCELLED"]) {
      expect(escalationReason(patch, err(c))).toBeNull();
      expect(escalationReason(agent, err(c))).toBeNull();
    }
    expect(escalationReason({ ...patch, kind: "external_patch" }, err("E_PATCH_APPLY"))).toBeNull();
  });

  test("the failure offers `escalate` only when the router has a next step", () => {
    expect(withEscalateAction(agent, err("E_BUDGET_EXCEEDED")).params?.actions).toBe("escalate,retry,copy_prompt");
    expect(withEscalateAction(agent, err("E_SCOPE_VIOLATION")).params?.actions).toBeUndefined();
    expect(withEscalateAction(patch, err("E_GATE_FAILED", { actions: "escalate,retry" })).params?.actions).toBe("escalate,retry");
  });

  test("R2 runs unattended only within the cap: no confirm, ≤ jobMaxUsd, spent + estimate ≤ 3 × the first estimate", () => {
    const jobs = [
      { job: { id: "j_1", createdAt: "2026-01-01T00:00:00Z", estimate: { apiUsd: 0.03 }, usage: { apiUsd: 0.02 } } },
      { job: { id: "j_0", createdAt: "2025-12-31T00:00:00Z", estimate: { apiUsd: 0.02 }, usage: { apiUsd: 0.01 } } },
    ];
    const core = {
      deps: { settings: () => ({ global: { limits: { jobMaxUsd: 2 } } }) },
      store: { ofThread: () => jobs },
    } as unknown as RunnerCore;
    expect(spendOf(core, ["th_1" as never])).toEqual({ spent: 0.03, first: 0.02 });
    const plan = (usd: number, confirm = false, mode = "agent") =>
      ({ mode, estimate: { apiUsd: usd, requiresConfirm: confirm }, route: { decision: { requiresConfirm: false } } }) as unknown as JobPlan;
    expect(autoBlocker(core, plan(0.02), ["th_1" as never])).toBeNull(); // 0.03 + 0.02 ≤ 0.06
    expect(autoBlocker(core, plan(0.04), ["th_1" as never])).toMatch(/3× the first estimate/);
    expect(autoBlocker(core, plan(0.01, true), ["th_1" as never])).toMatch(/confirmation/);
    expect(autoBlocker(core, plan(0.01, false, "patch"), ["th_1" as never])).toMatch(/router chose patch/);
  });
});

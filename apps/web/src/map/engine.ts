/** Generation-engine usability for S1 (UXP-15, AC-U-EN). Pure. */
import type { EngineStatus } from "@mitori/core";

export type EngineProblem = "notInstalled" | "notLoggedIn" | "capabilityLost";

export function engineProblem(s: EngineStatus | null): EngineProblem | null {
  if (!s || s.engine === "session") return null;
  if (!s.installed) return "notInstalled";
  if (s.problems.some((p) => p.code === "E_AGENT_CAPABILITY" || p.code === "E_ENGINE_BINARY_CHANGED")) return "capabilityLost";
  if (s.auth === "none" || s.problems.some((p) => p.code === "E_AGENT_AUTH")) return "notLoggedIn";
  return null;
}

/** One step that fixes an engine problem: the catalog key `engine.step.<key>` and the command to copy (none = 再検出). */
export interface FixStep {
  key: string;
  cmd?: string;
}

/** The exact steps of the engine card, in order; the last one is always the re-probe. */
export function fixSteps(p: EngineProblem): FixStep[] {
  switch (p) {
    case "notInstalled":
      return [{ key: "install", cmd: "npm install -g @anthropic-ai/claude-code" }, { key: "login", cmd: "claude" }, { key: "recheck" }];
    case "notLoggedIn":
      return [{ key: "login", cmd: "claude" }, { key: "recheck" }];
    case "capabilityLost":
      return [{ key: "update", cmd: "claude update" }, { key: "recheck" }];
  }
}

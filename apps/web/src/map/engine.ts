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

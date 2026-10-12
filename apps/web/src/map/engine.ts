/** Generation-engine usability for S1 (UXP-15, AC-U-EN). Pure. */
import type { DataPolicyAck, EngineId, EngineStatus } from "@mitori/core";

export type EngineProblem = "notInstalled" | "notLoggedIn" | "capabilityLost";

export function engineProblem(s: EngineStatus | null): EngineProblem | null {
  if (!s || s.engine === "session") return null;
  if (!s.installed) return "notInstalled";
  if (s.problems.some((p) => p.code === "E_AGENT_CAPABILITY" || p.code === "E_ENGINE_BINARY_CHANGED")) return "capabilityLost";
  if (s.auth === "none" || s.problems.some((p) => p.code === "E_AGENT_AUTH")) return "notLoggedIn";
  return null;
}

/** A generic provider/model change invalidates the consent given for the earlier configuration. */
export function policyAcknowledged(engine: EngineId, status: EngineStatus | null, ack: DataPolicyAck | undefined): boolean {
  return !!ack && (engine !== "generic" || (!!status?.plan && ack.plan === status.plan));
}

/** One step that fixes an engine problem: the catalog key `engine.step.<key>` and the command to copy (none = 再検出). */
export interface FixStep {
  key: string;
  cmd?: string;
}

/** Muse's launcher deletes the versioned native binary the saved argv names; re-running setup pins the new one. */
export function museUpdated(s: Pick<EngineStatus, "engine" | "installed" | "path" | "problems"> | null): boolean {
  return !!s && s.engine === "generic" && !s.installed && /\/muse-bin-[^/]+$/.test(s.path ?? "") && s.problems.some((p) => p.code === "E_AGENT_NOT_INSTALLED");
}

/** The exact steps of the engine card, in order; the last one is always the re-probe. */
export function fixSteps(p: EngineProblem, engine: EngineId = "claude-cli", opts: { museSetup?: string } = {}): FixStep[] {
  if (opts.museSetup) return [{ key: "museSetup", cmd: opts.museSetup }, { key: "recheck" }];
  if (engine !== "claude-cli")
    return [...(p === "notInstalled" && engine !== "anthropic-api" ? [{ key: "installNix" }] : []), { key: "providerSetup" }, { key: "recheck" }];
  switch (p) {
    case "notInstalled":
      return [{ key: "installNix" }, { key: "login", cmd: "claude /login" }, { key: "recheck" }];
    case "notLoggedIn":
      return [{ key: "login", cmd: "claude /login" }, { key: "recheck" }];
    case "capabilityLost":
      return [{ key: "installNix" }, { key: "recheck" }];
  }
}

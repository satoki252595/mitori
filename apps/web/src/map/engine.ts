/** Generation-engine usability for S1 (UXP-15, AC-U-EN). Pure. */
import type { BinaryPin, DataPolicyAck, EngineId, EngineStatus, ReasoningEffort } from "@mitori/core";
import { type LauncherCommand, providerSetupCommand } from "../settings/provider.ts";

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
  /** `{name}` params for the step text (e.g. old → new versions). */
  params?: Record<string, string>;
}

/** Muse's launcher deletes the versioned native binary the saved argv names; re-running setup pins the new one. */
export function museUpdated(s: Pick<EngineStatus, "engine" | "installed" | "path" | "problems"> | null): boolean {
  return !!s && s.engine === "generic" && !s.installed && /\/muse-bin-[^/]+$/.test(s.path ?? "") && s.problems.some((p) => p.code === "E_AGENT_NOT_INSTALLED");
}

/** Claude's approved entry now resolves to another binary and auto-follow refused it. */
export function claudeBinaryChanged(s: Pick<EngineStatus, "engine" | "problems"> | null): boolean {
  return !!s && s.engine === "claude-cli" && s.problems.some((p) => p.code === "E_ENGINE_BINARY_CHANGED");
}

/** Codex's binary moved (or vanished) and auto-follow refused it. */
export function codexBinaryChanged(s: Pick<EngineStatus, "engine" | "problems"> | null): boolean {
  return !!s && s.engine === "codex-cli" && s.problems.some((p) => p.code === "E_AGENT_CAPABILITY" && /binary changed|not pinned/i.test(p.message));
}

/** The mitori-verified Codex CLI version named by a capability problem, if any (`requires verified version X`). */
export function codexVerifiedVersion(s: Pick<EngineStatus, "engine" | "problems"> | null): string | null {
  if (!s || s.engine !== "codex-cli") return null;
  for (const p of s.problems) {
    if (p.code !== "E_AGENT_CAPABILITY") continue;
    const m = /requires verified version (\S+)/.exec(p.message);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Previous selections the setup command should keep (from settings); absent fields are omitted. */
export interface SetupContext {
  model?: string | undefined;
  effort?: ReasoningEffort | undefined;
  codexMaxUsd?: number | undefined;
  repo?: string | undefined;
}

/**
 * The re-setup command for an engine whose binary changed without being followed (spec §B), or `null`
 * when this engine needs no command. Previous selections (Muse `--effort`/`--model`, Codex model/budget)
 * carry over; a command that cannot be built (e.g. Codex without a budget) is `null` and the card falls
 * back to the provider guidance.
 */
export function setupCommandFor(engine: EngineId, ctx: SetupContext, launcher?: LauncherCommand | undefined): string | null {
  try {
    if (engine === "generic")
      return providerSetupCommand({ provider: "muse", ...(ctx.model ? { model: ctx.model } : {}), ...(ctx.effort ? { effort: ctx.effort } : {}) }, launcher);
    if (engine === "claude-cli") return providerSetupCommand({ provider: "claude" }, launcher);
    if (engine === "codex-cli") {
      if (ctx.codexMaxUsd === undefined || !Number.isFinite(ctx.codexMaxUsd) || ctx.codexMaxUsd <= 0) return null;
      return providerSetupCommand(
        {
          provider: "codex",
          native: true,
          maxEstimatedUsd: ctx.codexMaxUsd,
          ...(ctx.model ? { model: ctx.model } : {}),
          ...(ctx.effort ? { effort: ctx.effort } : {}),
        },
        launcher,
      );
    }
    return null;
  } catch {
    return null;
  }
}

/** Old → new versions for the "what happened" line, when both are known. */
export function changedVersions(
  s: { version?: string | undefined; path?: string | undefined; pin?: BinaryPin | undefined } | null,
): { from: string; to: string } | null {
  if (!s || !s.version) return null;
  const from = s.pin?.version ?? /\/muse-bin-([^/]+)$/.exec(s.path ?? "")?.[1] ?? null;
  if (!from || from === s.version) return null;
  return { from, to: s.version };
}

/** The exact steps of the engine card, in order; the last one is always the re-probe. */
export function fixSteps(
  p: EngineProblem,
  engine: EngineId = "claude-cli",
  opts: { museSetup?: string; setupCmd?: string; codexVersion?: string } = {},
): FixStep[] {
  if (opts.museSetup !== undefined) return [...(opts.museSetup ? [{ key: "museSetup", cmd: opts.museSetup }] : [{ key: "museSetup" }]), { key: "recheck" }];
  if (opts.setupCmd || opts.codexVersion)
    return [
      ...(opts.codexVersion ? [{ key: "codexVersion", params: { version: opts.codexVersion } }] : []),
      ...(opts.setupCmd ? [{ key: "providerSetupCmd", cmd: opts.setupCmd }] : [{ key: "providerSetup" }]),
      { key: "recheck" },
    ];
  if (engine !== "claude-cli")
    return [...(p === "notInstalled" && engine !== "anthropic-api" ? [{ key: "installNix" }] : []), { key: "providerSetup" }, { key: "recheck" }];
  switch (p) {
    case "notInstalled":
      return [{ key: "installNix" }, { key: "login", cmd: "claude /login" }, { key: "recheck" }];
    case "notLoggedIn":
      return [{ key: "login", cmd: "claude /login" }, { key: "recheck" }];
    case "capabilityLost":
      return [{ key: "providerSetup" }, { key: "recheck" }];
  }
}

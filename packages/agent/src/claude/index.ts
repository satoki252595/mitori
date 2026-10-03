/**
 * @mitori/agent — `claude/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type EngineSettings, type RepoPath, unsupported } from "@mitori/core";
import type { BridgePaths, EngineRequest, SpawnSpec } from "../contract.ts";

/** Pure spawn builder for claude-cli (the single place where flags are decided; spec §6.2). */
export function buildClaudeSpawn(
  req: EngineRequest,
  settings: EngineSettings["claude-cli"],
  paths: BridgePaths,
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  return unsupported("agent.buildClaudeSpawn", req, settings, paths, parentEnv);
}

/** `{"type":"user","message":{"role":"user","content":<text>}}` + "\n" (stdin protocol; spec §6.3). */
export function claudeUserMessage(text: string): string {
  return unsupported("agent.claudeUserMessage", text);
}

/** `Edit(//<abs worktree>/<path>)` (absolute form ONLY — the relative form matches same-named files at any depth) [SEC-09]; throws `E_UNSUPPORTED` unless {@link agentPathsOk}. */
export function editPermissionRule(worktreeAbs: string, path: RepoPath): string {
  return unsupported("agent.editPermissionRule", worktreeAbs, path);
}

/** True when every path matches {@link AGENT_PATH_ALLOWED_RE}. Pure. */
export function agentPathsOk(paths: readonly RepoPath[]): boolean {
  return unsupported("agent.agentPathsOk", paths);
}

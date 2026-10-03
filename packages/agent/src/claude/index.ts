/**
 * @mitori/agent — `claude/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { type EngineSettings, MitoriError, type RepoPath } from "@mitori/core";
import { type BridgePaths, CLAUDE_MODE_DEFAULTS, type EngineRequest, type SpawnSpec } from "../contract.ts";
import { agentPathOk, assembleArgv, assertArgvSafe, type ClaudeSpawnPaths, editRule, validateClaudeRequest } from "./argv.ts";
import { injectedEnv, scrubEnv } from "./env.ts";

/** Pure spawn builder for claude-cli (the single place where flags are decided; spec §6.2). */
export function buildClaudeSpawn(
  req: EngineRequest,
  settings: EngineSettings["claude-cli"],
  paths: BridgePaths,
  parentEnv: Readonly<Record<string, string | undefined>>,
): SpawnSpec {
  const p = paths as ClaudeSpawnPaths;
  validateClaudeRequest(req, p);
  const argv = assembleArgv(req, settings, p);
  assertArgvSafe(argv, req.prompt);
  const persist = settings.persistSessions && req.persistSession;
  const env = {
    ...scrubEnv(parentEnv, settings.envPassthrough),
    ...injectedEnv(req.mode, { maxOutTokens: req.budget.outTokens, persistSessions: persist }),
  };
  const defaults = CLAUDE_MODE_DEFAULTS[req.mode];
  return {
    command: p.claudeBinary,
    argv,
    env,
    cwd: req.cwd,
    stdin: req.promptBlocks === undefined ? claudeUserMessage(req.prompt) : userMessageLine(req.promptBlocks.map((text) => ({ type: "text", text }))),
    // I13: answer/findings close stdin right after the prompt; patch/agent/generate may park.
    keepStdinOpen: req.keepAlive && (req.mode === "patch" || req.mode === "agent" || req.mode === "generate"),
    timeoutMs: req.budget.ms > 0 ? Math.min(req.budget.ms, defaults.turnMs) : defaults.turnMs,
    processGroup: true,
  };
}

const userMessageLine = (content: string | { type: "text"; text: string }[]): string =>
  `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;

/** `{"type":"user","message":{"role":"user","content":<text>}}` + "\n" (stdin protocol; spec §6.3). */
export function claudeUserMessage(text: string): string {
  return userMessageLine(text);
}

/** `Edit(//<abs worktree>/<path>)` (absolute form ONLY — the relative form matches same-named files at any depth) [SEC-09]; throws `E_UNSUPPORTED` unless {@link agentPathsOk}. */
export function editPermissionRule(worktreeAbs: string, path: RepoPath): string {
  if (!agentPathsOk([path])) throw new MitoriError("E_UNSUPPORTED", "path is not allowed in agent permission rules", { params: { reason: "agent_path" } });
  return editRule(worktreeAbs, path);
}

/** True when every path matches {@link AGENT_PATH_ALLOWED_RE}. Pure. */
export function agentPathsOk(paths: readonly RepoPath[]): boolean {
  return paths.every(agentPathOk);
}
